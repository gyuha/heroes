import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import type { GameMap } from '../sim/map/gameMap';
import type { World } from '../sim/world';
import { createTerrainView, type TerrainView } from './terrain/terrainView';
import { updateLodMask } from './units/lodSelect';
import { SoldierRenderer } from './units/soldierRenderer';
import { UNIT_TYPE_ORDER } from '../sim/units';

const SKY_COLOR = 0x9fc4e8;
/** 카메라 거리에 비례하는 안개·원근 범위(UI 요청, ARCHITECTURE §11.4): near = 거리 + 150, far = 거리 × 1.5 + 600 */
const FOG_NEAR_OFFSET = 150;
const FOG_FAR_MULT = 1.5;
const FOG_FAR_OFFSET = 600;
const CAMERA_FAR = 4000;
const CAMERA_NEAR = 0.5;
const FOV = 50;
const HEMI_INTENSITY = 0.8;
const SUN_INTENSITY = 2.6;
const SUN_DIR = [0.5, 0.65, 0.57] as const;

/**
 * 렌더링 계층의 진입점. 시뮬레이션 상태를 읽기만 하고 절대 바꾸지 않는다.
 * 카메라 입력(RtsCamera)은 UI 소유라 여기서는 카메라 객체만 만들어 넘긴다(INTERFACES §3.1).
 */
export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private readonly fog: Fog;
  private soldiers: SoldierRenderer | null = null;
  private terrainView: TerrainView | null = null;
  private hidden: Uint8Array;
  /** 마지막으로 그린 World. 다시 시작해 World가 바뀌면 병사 용량·안개 배열 크기를 다시 맞춘다 */
  private lastWorld: World | null = null;
  /** 부대별 LOD(1 = 원거리 모델). 카메라 거리로 프레임마다 갱신한다(lodSelect.ts) */
  private lod: Uint8Array;
  private lodEnabled = true;

  private constructor(container: HTMLElement, maxSquads: number) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(SKY_COLOR);
    this.fog = new Fog(SKY_COLOR, 400, 1200);
    this.scene.fog = this.fog;
    // 고저 가독성(D-012): 환경광을 줄이고 태양을 북서쪽(+x = 서) 고도 약 40°에 둔다(A 요청 값)
    this.scene.add(new HemisphereLight(0xdfe9ff, 0x4a4030, HEMI_INTENSITY));
    const sun = new DirectionalLight(0xfff2dd, SUN_INTENSITY);
    sun.position.set(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);
    this.scene.add(sun);

    this.camera = new PerspectiveCamera(FOV, 1, CAMERA_NEAR, CAMERA_FAR);
    this.hidden = new Uint8Array(maxSquads);
    this.lod = new Uint8Array(maxSquads);
    this.resize(container.clientWidth, container.clientHeight);
  }

  /** 지형 장면과 병종 모델을 모두 읽은 뒤 만든다(전투 중 추가 로딩 없음, ARCHITECTURE §7.8). */
  /** @param options.lod false면 원거리 LOD 모델을 불러오지 않고 모든 병사를 원본 모델로 그린다(`?lod=0`) */
  static async create(
    container: HTMLElement,
    map: GameMap,
    world: World,
    options: { lod?: boolean } = {},
  ): Promise<GameRenderer> {
    const r = new GameRenderer(container, world.squads.length);
    r.lodEnabled = options.lod ?? true;
    const [terrain, soldiers] = await Promise.all([
      createTerrainView(map),
      SoldierRenderer.load(soldiersPerType(world), `${import.meta.env.BASE_URL}assets/units`, {
        lod: r.lodEnabled,
      }),
    ]);
    r.soldiers = soldiers;
    r.terrainView = terrain;
    r.lastWorld = world;
    r.scene.add(terrain.group);
    r.scene.add(soldiers.object);
    return r;
  }

  /** GPU 자원을 모두 푼다. 페이지를 닫거나 개발 서버가 모듈을 다시 불러올 때 부른다. */
  dispose(): void {
    this.soldiers?.dispose();
    this.terrainView?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /** World가 바뀌었으면(다시 시작) 병사 용량과 안개 배열을 그 World에 맞춘다. */
  private adoptWorld(world: World): void {
    this.lastWorld = world;
    if (this.hidden.length < world.squads.length) {
      this.hidden = new Uint8Array(world.squads.length);
      this.lod = new Uint8Array(world.squads.length);
    }
    const soldiers = this.soldiers;
    if (!soldiers) return;
    const next = soldiers.ensureCapacity(soldiersPerType(world));
    if (next !== soldiers) {
      this.scene.remove(soldiers.object);
      this.scene.add(next.object);
      this.soldiers = next;
    }
  }

  /** 지난 프레임에 그린 병사 삼각형 수(LOD 반영) */
  get soldierTriangles(): number {
    return this.soldiers?.drawnTriangles() ?? 0;
  }

  /** LOD1로 그리는 부대 수 / 전체 부대 수(측정용 표시) */
  get lodSquadCount(): number {
    let n = 0;
    for (let s = 0; s < this.lod.length; s++) n += this.lod[s];
    return n;
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param alpha 직전 틱과 다음 틱 사이 보간 비율(0~1)
   * @param viewTeam 안개 기준 진영(null = 관전, 모두 보임)
   * @param tacticalView 전술 지도 거리면 병사를 숨기고 갱신도 건너뛴다(ARCHITECTURE §11.4)
   * @param cameraDistance 안개·원근 범위를 카메라 거리에 맞춘다
   */
  render(
    world: World,
    alpha: number,
    viewTeam: 0 | 1 | null,
    tacticalView: boolean,
    cameraDistance: number,
  ): void {
    this.fog.near = cameraDistance + FOG_NEAR_OFFSET;
    this.fog.far = cameraDistance * FOG_FAR_MULT + FOG_FAR_OFFSET;
    if (world !== this.lastWorld) this.adoptWorld(world);
    const soldiers = this.soldiers;
    if (soldiers) {
      if (tacticalView) soldiers.setVisible(false);
      else {
        for (let s = 0; s < world.squads.length; s++) {
          this.hidden[s] = viewTeam !== null && !world.isVisible(s, viewTeam) ? 1 : 0;
        }
        // 숨겨져 있었으면 켠 뒤 같은 프레임 안에서 sync로 버퍼를 새로 채우고 그린다(sync는 숨긴 동안 아무것도
        // 쓰지 않으므로 켜기가 먼저다. 켜고 그리기 전에 채우므로 옛 위치가 한 프레임 보이지 않는다).
        if (this.lodEnabled) {
          const p = this.camera.position;
          updateLodMask(this.lod, world.squads, p.x, p.y, p.z);
        }
        soldiers.setVisible(true);
        soldiers.sync(
          world.units,
          alpha,
          world.tick,
          this.hidden,
          this.lodEnabled ? this.lod : undefined,
        );
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}

/** World의 병종별 병사 수(병사 렌더러 인스턴스 용량). */
function soldiersPerType(world: World): number[] {
  const counts = UNIT_TYPE_ORDER.map(() => 0);
  for (let i = 0; i < world.units.count; i++) counts[world.units.type[i]]++;
  return counts;
}
