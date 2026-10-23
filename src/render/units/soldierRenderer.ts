import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  DataTexture,
  DynamicDrawUsage,
  FrontSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type AnimationClip,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type Side,
  type SkinnedMesh,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TICK_DT } from '../../sim/constants';
import { UNIT_TYPES } from '../../sim/data/balance';
import { wrapAngle } from '../../sim/math';
import { UNIT_TYPE_ORDER, type UnitStore } from '../../sim/units';
import { bakeSkinnedAnimations } from './bake';
import { WALK_THRESHOLD, chooseClip, type ClipRules } from './clipSelect';
import {
  ANIM_CLIP_NAMES,
  AnimClip,
  BAKE_FPS,
  CLIP_ENTRY_SIZE,
  LOOPING_CLIPS,
  bindPoseClipTable,
} from './clipTable';
import {
  createBoneTexture,
  createSharedUniforms,
  createSoldierMaterial,
  type SharedSoldierUniforms,
} from './soldierMaterial';

const TYPE_COUNT = UNIT_TYPE_ORDER.length;
/** aAnim = (클립 번호, 클립 시간(초), 팀) */
const ANIM_ITEM_SIZE = 3;
/** 반복 클립 위상 차이의 최대 폭(초). 병사 인덱스로 정해 수천 명이 똑같이 움직이지 않게 한다(ARCHITECTURE §11.5). */
const LOOP_PHASE_SPREAD = 2.0;
/** 황금비 소수부. 인덱스를 [0, 1) 에 고르게 흩는다. */
const GOLDEN = 0.6180339887;
/** 한 프레임에 반복 클립 위상을 진행시키는 최대 시간(초). 탭 전환 등으로 프레임이 크게 벌어져도 튀지 않게 한다. */
const MAX_FRAME_DT = 0.25;
/** 궁수는 4초마다 쏘므로 다음 발사 준비 동작 없이 쏜 뒤 이 시간(초)만 attack 을 유지한다. */
const RANGED_ATTACK_WINDOW = 1.0;
/** 근접 attack 유지 시간 = 공격 간격 + 이 여유(초). 다음 타격이 한두 틱 늦어도 idle 로 끊기지 않게 한다. */
const MELEE_ATTACK_SLACK = 0.15;
/**
 * attack 클립에 extras.hitTime 이 없을 때의 타격 프레임(docs/ANIMATION_GUIDE.md): 검·창 접촉 f12, 활 방출 f16.
 * 원거리 병종(궁수)의 attack 은 사격 동작이다.
 */
const DEFAULT_MELEE_CONTACT_FRAME = 12;
const DEFAULT_BOW_RELEASE_FRAME = 16;

/** 병종 하나를 그리는 데 필요한 GPU 리소스(로드·굽기 결과). */
export interface SoldierTypeAsset {
  /** position, normal, (uv), skinIndex, skinWeight 를 가진 지오메트리. 원점 = 발밑, 정면 = +Z */
  geometry: BufferGeometry;
  map: Texture | null;
  side: Side;
  boneTexture: DataTexture;
  clipEntries: Float32Array;
  hasAnimations: boolean;
  /** 클립 extras(ARCHITECTURE §7.5). 없으면 null → 병종 걷기·달리기 속도, 기본 타격 프레임으로 대체 */
  walkRefSpeed: number | null;
  runRefSpeed: number | null;
  hitTime: number | null;
}

/**
 * 병사 렌더러. 병종마다 InstancedMesh 하나(그리기 호출 4회)로 모든 병사를 그린다.
 *
 * - 애니메이션: 로드 시 클립을 본 행렬 텍스처로 굽는다(ARCHITECTURE §5.2). 프레임마다 CPU 가 병사별
 *   클립과 클립 시간을 sim 틱 기록·속도에서 고르고(clipSelect.ts, §11.5) 인스턴스 행렬과 float 3개만 쓴다.
 *   정점 셰이더가 그 값으로 텍스처에서 본 행렬을 읽어 스키닝한다.
 * - 팀 색: 텍스처 알파 마스크 부분에만 곱한다(ART_STYLE_GUIDE). 머티리얼은 불투명.
 * - 리소스 실패: 모델이 없으면 임시 캡슐, 클립 파일이 없으면 바인드 자세로 대체하고 경고만 남긴다.
 */
export class SoldierRenderer {
  readonly object: Object3D = new Group();
  readonly trianglesPerType: readonly number[];
  /** 병종별 LOD1(원거리) 삼각형 수, LOD1이 없으면 0 */
  readonly trianglesPerTypeLod1: readonly number[];
  readonly hasAnimations: readonly boolean[];

  /**
   * 메시 칸 = 병종 t + LOD × TYPE_COUNT. 0~3은 LOD0(가까운 거리), 4~7은 LOD1(먼 거리, 없으면 null).
   * 두 LOD가 같은 골격·같은 본 행렬 텍스처 배치를 쓰므로 클립 규칙은 병종마다 하나다.
   */
  private readonly meshes: (InstancedMesh | null)[] = [];
  private readonly matrices: (Float32Array | null)[] = [];
  private readonly animAttrs: (InstancedBufferAttribute | null)[] = [];
  private readonly animArrays: (Float32Array | null)[] = [];
  private readonly capacity: Int32Array;
  private readonly counts: Int32Array;
  private readonly lodAssets: readonly (SoldierTypeAsset | null)[];
  private readonly shared: SharedSoldierUniforms = createSharedUniforms();
  private readonly assets: readonly SoldierTypeAsset[];
  private readonly rules: ClipRules[] = [];
  /** 병사 인덱스별 반복 클립 위상(초). 재생 속도를 곱해 프레임마다 누적한다 */
  private phase = new Float64Array(0);
  private lastNowTick = Number.NaN;
  /** 마지막으로 버퍼를 채운 상태. 같으면(일시정지 등) 다시 채우거나 GPU에 올리지 않는다 */
  private syncedTick = Number.NaN;
  private syncedUnits: UnitStore | null = null;
  private syncedHidden: Uint8Array = new Uint8Array(0);
  private syncedLod: Uint8Array = new Uint8Array(0);
  private dirty = true;
  private readonly pick = new Float64Array(2);

  /**
   * 모델·클립을 모두 불러와 렌더러를 만든다. 실패해도 예외를 던지지 않는다(해당 병종만 대체).
   * capacityPerType[t] = 병종 t(UNIT_TYPE_ORDER 순서)를 동시에 그릴 수 있는 최대 수.
   */
  static async load(
    capacityPerType: readonly number[],
    baseUrl = '/assets/units',
    options: { lod?: boolean } = {},
  ): Promise<SoldierRenderer> {
    const loader = new GLTFLoader();
    const pairs = await Promise.all(
      UNIT_TYPE_ORDER.map((type) => loadTypeAssets(loader, baseUrl, type, options.lod ?? true)),
    );
    return new SoldierRenderer(
      pairs.map((p) => p.lod0),
      capacityPerType,
      pairs.map((p) => p.lod1),
    );
  }

  /** 테스트·미리보기용. 보통은 load() 를 쓴다. lodAssets[t]가 있으면 그 병종은 먼 부대를 LOD1로 그린다. */
  constructor(
    assets: readonly SoldierTypeAsset[],
    capacityPerType: readonly number[],
    lodAssets: readonly (SoldierTypeAsset | null)[] = [],
  ) {
    this.assets = assets;
    this.lodAssets = UNIT_TYPE_ORDER.map((_, t) => lodAssets[t] ?? null);
    this.object.name = 'soldiers';
    this.capacity = new Int32Array(TYPE_COUNT);
    this.counts = new Int32Array(TYPE_COUNT * 2);
    for (let t = 0; t < TYPE_COUNT; t++) {
      this.capacity[t] = Math.max(0, Math.floor(capacityPerType[t] ?? 0));
      this.rules.push(buildClipRules(t, assets[t]));
    }
    // LOD0 메시를 먼저(자식 0~3), LOD1 메시를 뒤에(4~7) 붙인다
    for (let m = 0; m < TYPE_COUNT * 2; m++) {
      const t = m % TYPE_COUNT;
      const asset = m < TYPE_COUNT ? assets[t] : this.lodAssets[t];
      if (!asset) {
        this.meshes.push(null);
        this.matrices.push(null);
        this.animAttrs.push(null);
        this.animArrays.push(null);
        continue;
      }
      const mesh = this.createMesh(asset, this.capacity[t], m < TYPE_COUNT ? 0 : 1, t);
      this.meshes.push(mesh.mesh);
      this.matrices.push(mesh.mesh.instanceMatrix.array as Float32Array);
      this.animAttrs.push(mesh.attr);
      this.animArrays.push(mesh.array);
    }
    this.trianglesPerType = assets.map(triangleCount);
    this.trianglesPerTypeLod1 = this.lodAssets.map((a) => (a ? triangleCount(a) : 0));
    this.hasAnimations = assets.map((a) => a.hasAnimations);
  }

  private createMesh(
    asset: SoldierTypeAsset,
    cap: number,
    lod: number,
    type: number,
  ): { mesh: InstancedMesh; attr: InstancedBufferAttribute; array: Float32Array } {
    const { geometry } = asset;
    // 빈 GPU 버퍼를 피하려고 최소 1칸은 잡는다(그리는 수는 count 로 정한다).
    const alloc = Math.max(1, cap);
    const array = new Float32Array(alloc * ANIM_ITEM_SIZE);
    const attr = new InstancedBufferAttribute(array, ANIM_ITEM_SIZE);
    attr.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aAnim', attr);
    const material = createSoldierMaterial({
      map: asset.map,
      side: asset.side,
      boneTexture: asset.boneTexture,
      clipEntries: asset.clipEntries,
      shared: this.shared,
    });
    const mesh = new InstancedMesh(geometry, material, alloc);
    mesh.name = lod === 0 ? UNIT_TYPE_ORDER[type] : `${UNIT_TYPE_ORDER[type]}_lod1`;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // 병사가 계속 움직여 경계 구가 매 프레임 바뀐다. 컬링 대신 병종·LOD당 그리기 1회로 처리한다.
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.object.add(mesh);
    return { mesh, attr, array };
  }

  /** 지난 sync로 그리는 병사 삼각형 수(LOD 반영, 측정용) */
  drawnTriangles(): number {
    let tris = 0;
    for (let t = 0; t < TYPE_COUNT; t++) {
      tris += this.visibleCountLod(t, 0) * this.trianglesPerType[t];
      tris += this.visibleCountLod(t, 1) * this.trianglesPerTypeLod1[t];
    }
    return tris;
  }

  /** 병종 t에 LOD1 메시가 있는가 */
  hasLod1(type: number): boolean {
    return this.meshes[type + TYPE_COUNT] !== null;
  }

  /** 병종 t의 LOD별 현재 그리는 인스턴스 수(sync 결과). */
  visibleCountLod(type: number, lod: 0 | 1): number {
    return this.meshes[type + lod * TYPE_COUNT]?.count ?? 0;
  }

  /** 병종 t 의 현재 그리는 인스턴스 수(sync 결과). */
  visibleCount(type: number): number {
    return this.visibleCountLod(type, 0) + this.visibleCountLod(type, 1);
  }

  get visible(): boolean {
    return this.object.visible;
  }

  /**
   * 전술 지도(ARCHITECTURE §11.4)에서 병사 전체를 숨긴다. 숨긴 동안 sync 는 아무것도 하지 않는다.
   * 다시 보일 때는 setVisible(true) → sync() → 렌더 순서로 불러 옛 위치가 한 프레임 보이지 않게 한다.
   */
  setVisible(visible: boolean): void {
    if (visible && !this.object.visible) this.dirty = true;
    this.object.visible = visible;
  }

  /**
   * 병사 상태를 인스턴스 버퍼에 쓴다. 프레임마다 호출, 할당 없음(처음 한 번 위상 배열만 잡는다).
   * simTick = 현재 틱 번호(World.tick), alpha = 직전 틱과 현재 틱 사이 보간 비율(0~1).
   * hiddenSquads[squadId] === 1 인 부대의 병사는 그리지 않는다(전장의 안개).
   * lodSquads[squadId] === 1 인 부대의 병사는 LOD1 메시로 그린다(그 병종에 LOD1이 있을 때). 부대 단위로 바꿔
   * 한 부대가 섞인 모습이 되지 않고, 경계 판단(거리·히스테리시스)은 부르는 쪽이 한다.
   * removed 가 아닌 죽은 병사는 계속 그린다(die 클립 마지막 자세로 쓰러져 있음).
   */
  sync(
    units: UnitStore,
    alpha: number,
    simTick: number,
    hiddenSquads?: Uint8Array,
    lodSquads?: Uint8Array,
  ): void {
    if (!this.object.visible) return;
    const nowTick = simTick + alpha;
    // 틱도 보간 위치도 그대로면(일시정지, 틱 사이 같은 alpha) 쓸 값이 모두 같으므로 버퍼 갱신·업로드를 건너뛴다.
    if (
      !this.dirty &&
      nowTick === this.syncedTick &&
      units === this.syncedUnits &&
      sameMask(hiddenSquads, this.syncedHidden) &&
      sameMask(lodSquads, this.syncedLod)
    ) {
      this.lastNowTick = nowTick;
      return;
    }
    this.dirty = false;
    this.syncedTick = nowTick;
    this.syncedUnits = units;
    this.syncedHidden = copyMask(hiddenSquads, this.syncedHidden);
    this.syncedLod = copyMask(lodSquads, this.syncedLod);
    // 반복 클립 위상은 화면 시각이 흐른 만큼만 진행한다(일시정지면 0, 배속이면 빠르게).
    let frameDt = Number.isNaN(this.lastNowTick) ? 0 : (nowTick - this.lastNowTick) * TICK_DT;
    if (frameDt < 0) frameDt = 0;
    else if (frameDt > MAX_FRAME_DT) frameDt = MAX_FRAME_DT;
    this.lastNowTick = nowTick;
    if (this.phase.length < units.capacity) this.resetPhase(units.capacity);
    const phase = this.phase;
    const pick = this.pick;

    const counts = this.counts;
    counts.fill(0);
    const { x, y, z, heading, prevX, prevY, prevZ, prevHeading } = units;
    const { removed, squad, type, team, deathTick, lastHitTick, lastAttackTick } = units;
    const n = units.count;
    for (let i = 0; i < n; i++) {
      if (removed[i] !== 0) continue;
      const sq = squad[i];
      if (hiddenSquads !== undefined && sq >= 0 && hiddenSquads[sq] === 1) continue;
      const t = type[i];
      if (t >= TYPE_COUNT) continue;
      const far = lodSquads !== undefined && sq >= 0 && lodSquads[sq] === 1;
      const mi = far && this.meshes[t + TYPE_COUNT] !== null ? t + TYPE_COUNT : t;
      const slot = counts[mi];
      if (slot >= this.capacity[t]) continue;
      counts[mi] = slot + 1;

      const px = prevX[i] + (x[i] - prevX[i]) * alpha;
      const py = prevY[i] + (y[i] - prevY[i]) * alpha;
      const pz = prevZ[i] + (z[i] - prevZ[i]) * alpha;
      const h = prevHeading[i] + wrapAngle(heading[i] - prevHeading[i]) * alpha;
      const c = Math.cos(h);
      const s = Math.sin(h);
      // Y축 회전 + 이동 행렬(열 우선). 정면 +Z 가 (sin h, 0, cos h) 로 간다.
      const m = this.matrices[mi]!;
      const o = slot * 16;
      m[o] = c;
      m[o + 1] = 0;
      m[o + 2] = -s;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = 1;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = s;
      m[o + 9] = 0;
      m[o + 10] = c;
      m[o + 11] = 0;
      m[o + 12] = px;
      m[o + 13] = py;
      m[o + 14] = pz;
      m[o + 15] = 1;

      const dx = x[i] - prevX[i];
      const dz = z[i] - prevZ[i];
      const speed = Math.sqrt(dx * dx + dz * dz) / TICK_DT;
      const clip = chooseClip(
        this.rules[t],
        nowTick,
        TICK_DT,
        deathTick[i],
        lastHitTick[i],
        lastAttackTick[i],
        speed,
        pick,
      );
      let clipTime: number;
      if (LOOPING_CLIPS[clip]) {
        clipTime = phase[i] += frameDt * pick[1];
      } else {
        clipTime = pick[0];
      }
      const a = this.animArrays[mi]!;
      const ao = slot * ANIM_ITEM_SIZE;
      a[ao] = clip;
      a[ao + 1] = clipTime;
      a[ao + 2] = team[i];
    }

    for (let mi = 0; mi < TYPE_COUNT * 2; mi++) {
      const mesh = this.meshes[mi];
      if (!mesh) continue;
      const cnt = counts[mi];
      mesh.count = cnt;
      if (cnt === 0) continue;
      const im = mesh.instanceMatrix;
      im.clearUpdateRanges();
      im.addUpdateRange(0, cnt * 16);
      im.needsUpdate = true;
      const aa = this.animAttrs[mi]!;
      aa.clearUpdateRanges();
      aa.addUpdateRange(0, cnt * ANIM_ITEM_SIZE);
      aa.needsUpdate = true;
    }
  }

  /** 위상 배열을 새로 잡고 병사 인덱스로 정한 고정 위상 차이로 채운다. */
  private resetPhase(capacity: number): void {
    this.phase = new Float64Array(capacity);
    for (let i = 0; i < capacity; i++) {
      const k = i * GOLDEN;
      this.phase[i] = (k - Math.floor(k)) * LOOP_PHASE_SPREAD;
    }
  }

  /**
   * 병종별 병사 수가 지금 용량보다 많으면(병력이 다른 판으로 다시 시작) 같은 리소스로 더 큰 렌더러를 만들어
   * 돌려주고 이 렌더러의 메시를 푼다. 넉넉하면 자신을 돌려준다. 용량을 넘는 병사를 조용히 버리지 않게 한다.
   */
  ensureCapacity(capacityPerType: readonly number[]): SoldierRenderer {
    let fits = true;
    for (let t = 0; t < TYPE_COUNT; t++)
      if ((capacityPerType[t] ?? 0) > this.capacity[t]) fits = false;
    if (fits) return this;
    const grown = UNIT_TYPE_ORDER.map((_, t) =>
      Math.max(this.capacity[t], capacityPerType[t] ?? 0),
    );
    const next = new SoldierRenderer(this.assets, grown, this.lodAssets);
    next.setVisible(this.visible);
    this.disposeMeshes();
    return next;
  }

  /** 메시·머티리얼만 푼다(리소스는 ensureCapacity가 만든 새 렌더러가 이어 쓴다). */
  private disposeMeshes(): void {
    for (const mesh of this.meshes) {
      if (!mesh) continue;
      (mesh.material as Material).dispose();
      mesh.dispose();
    }
    this.object.clear();
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      if (!mesh) continue;
      mesh.geometry.dispose();
      (mesh.material as Material).dispose();
      mesh.dispose();
    }
    for (const asset of [...this.assets, ...this.lodAssets]) {
      if (!asset) continue;
      asset.boneTexture.dispose();
      asset.map?.dispose();
    }
    this.object.clear();
  }
}

/**
 * 병종 하나의 리소스: 원본 모델(LOD0)과, withLod면 원거리 모델 {병종}_lod1.glb(LOD1). 두 모델은 같은 골격이라
 * animations.glb 클립을 한 번 불러 각각에 굽는다. LOD1이 없거나 실패하면 null(그 병종은 LOD0만 쓴다).
 */
async function loadTypeAssets(
  loader: GLTFLoader,
  baseUrl: string,
  type: string,
  withLod: boolean,
): Promise<{ lod0: SoldierTypeAsset; lod1: SoldierTypeAsset | null }> {
  const clips = await loadClips(loader, baseUrl, type);
  const [lod0, lod1] = await Promise.all([
    loadModelAsset(loader, `${baseUrl}/${type}/${type}.glb`, type, clips),
    withLod ? loadModelAsset(loader, `${baseUrl}/${type}/${type}_lod1.glb`, type, clips) : null,
  ]);
  return { lod0: lod0 ?? createPlaceholderAsset(), lod1 };
}

/** animations.glb 의 클립 6종. 파일이 없으면 null(바인드 자세로 표시). */
async function loadClips(
  loader: GLTFLoader,
  baseUrl: string,
  type: string,
): Promise<(AnimationClip | null)[] | null> {
  const animUrl = `${baseUrl}/${type}/animations.glb`;
  try {
    const anims = await loader.loadAsync(animUrl);
    const found = ANIM_CLIP_NAMES.map(
      (name) => anims.animations.find((a) => a.name === name) ?? null,
    );
    const missing = ANIM_CLIP_NAMES.filter((_, c) => !found[c]);
    if (missing.length > 0) {
      console.warn(`[SoldierRenderer] ${type}: 클립 없음 → 바인드 자세 (${missing.join(', ')})`);
    }
    return found;
  } catch (err) {
    console.warn(
      `[SoldierRenderer] ${type}: 클립 파일 로드 실패, 바인드 자세로 표시 (${animUrl})`,
      err,
    );
    return null;
  }
}

/** 스키닝 모델 하나를 불러 클립을 본 행렬 텍스처로 굽는다. 실패하면 경고를 남기고 null. */
async function loadModelAsset(
  loader: GLTFLoader,
  modelUrl: string,
  type: string,
  clips: (AnimationClip | null)[] | null,
): Promise<SoldierTypeAsset | null> {
  let skinned: SkinnedMesh | null = null;
  try {
    const gltf = await loader.loadAsync(modelUrl);
    gltf.scene.traverse((o) => {
      if (!skinned && (o as SkinnedMesh).isSkinnedMesh) skinned = o as SkinnedMesh;
    });
    if (!skinned) throw new Error('SkinnedMesh 가 없음');
  } catch (err) {
    console.warn(`[SoldierRenderer] ${type}: 모델 로드 실패 (${modelUrl})`, err);
    return null;
  }
  const mesh: SkinnedMesh = skinned;
  const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
    MeshStandardMaterial | undefined;
  try {
    const baked = bakeSkinnedAnimations(mesh, clips ?? []);
    if (baked.droppedTracks.length > 0) {
      console.warn(
        `[SoldierRenderer] ${type}: 본 이름이 맞지 않아 무시한 트랙 ${baked.droppedTracks.length}개 (${modelUrl})`,
        baked.droppedTracks,
      );
    }
    return {
      geometry: mesh.geometry,
      map: source?.map ?? null,
      side: source?.side ?? FrontSide,
      boneTexture: createBoneTexture(baked.data, baked.width, baked.height),
      clipEntries: baked.table.entries,
      hasAnimations: clips !== null && clips.some((c) => c !== null),
      // GLTFLoader 는 glTF 애니메이션 extras 를 clip.userData 에 넣는다.
      walkRefSpeed: positiveOrNull(clips?.[AnimClip.Walk]?.userData.speed),
      runRefSpeed: positiveOrNull(clips?.[AnimClip.Run]?.userData.speed),
      hitTime: positiveOrNull(clips?.[AnimClip.Attack]?.userData.hitTime),
    };
  } catch (err) {
    console.warn(`[SoldierRenderer] ${type}: 애니메이션 굽기 실패 (${modelUrl})`, err);
    return null;
  }
}

function triangleCount(asset: SoldierTypeAsset): number {
  const g = asset.geometry;
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}

/** 부대 단위 마스크(안개·LOD)가 지난번에 쓴 것과 같은가 */
function sameMask(mask: Uint8Array | undefined, prev: Uint8Array): boolean {
  if (!mask) return prev.length === 0;
  if (mask.length !== prev.length) return false;
  for (let k = 0; k < mask.length; k++) if (mask[k] !== prev[k]) return false;
  return true;
}

/** 마스크를 기억해 둔다(크기가 같으면 prev 배열을 재사용해 할당하지 않는다) */
function copyMask(mask: Uint8Array | undefined, prev: Uint8Array): Uint8Array {
  if (!mask) return prev.length === 0 ? prev : new Uint8Array(0);
  const out = prev.length === mask.length ? prev : new Uint8Array(mask.length);
  out.set(mask);
  return out;
}

/**
 * 임시 병사: 캡슐 몸통 + 정면(+Z)을 알려 주는 방패 상자. 원점은 발밑.
 * 본 1개(단위 행렬)에 모든 정점을 묶어 같은 셰이더로 그린다. 텍스처가 없어 전체가 팀 색이 된다.
 */
export function createPlaceholderAsset(): SoldierTypeAsset {
  const body = new CapsuleGeometry(0.28, 1.1, 4, 14, 1);
  body.translate(0, 0.83, 0);
  const shield = new BoxGeometry(0.5, 0.6, 0.08);
  shield.translate(0, 0.9, 0.32);
  const geometry = mergeGeometries([body, shield]) ?? body;
  if (geometry !== body) body.dispose();
  shield.dispose();
  const count = geometry.getAttribute('position').count;
  const weights = new Float32Array(count * 4);
  for (let v = 0; v < count; v++) weights[v * 4] = 1;
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint8Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(weights, 4));

  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return {
    geometry,
    map: null,
    side: FrontSide,
    boneTexture: createBoneTexture(identity, 4, 1),
    clipEntries: bindPoseClipTable().entries,
    hasAnimations: false,
    walkRefSpeed: null,
    runRefSpeed: null,
    hitTime: null,
  };
}

function positiveOrNull(v: unknown): number | null {
  return typeof v === 'number' && v > 0 ? v : null;
}

/** 병종 밸런스 수치(UNIT_TYPES)와 클립 길이·extras 로 클립 선택 기준을 만든다. */
export function buildClipRules(type: number, asset: SoldierTypeAsset): ClipRules {
  const stats = UNIT_TYPES[UNIT_TYPE_ORDER[type]];
  const duration = (clip: number) => asset.clipEntries[clip * CLIP_ENTRY_SIZE + 2];
  const attackDuration = duration(AnimClip.Attack);
  const ranged = stats.ranged;
  return {
    walkThreshold: WALK_THRESHOLD,
    runThreshold: (stats.walkSpeed + stats.runSpeed) / 2,
    attackInterval: ranged ? ranged.interval : stats.meleeInterval,
    attackWindow: ranged ? RANGED_ATTACK_WINDOW : stats.meleeInterval + MELEE_ATTACK_SLACK,
    attackDuration,
    hitTime: Math.min(
      attackDuration,
      asset.hitTime ??
        (ranged ? DEFAULT_BOW_RELEASE_FRAME : DEFAULT_MELEE_CONTACT_FRAME) / BAKE_FPS,
    ),
    hitDuration: duration(AnimClip.Hit),
    // 클립이 1배속에서 병종의 걷기·달리기 속도에 맞게 만들어졌다고 본다.
    walkRefSpeed: asset.walkRefSpeed ?? stats.walkSpeed,
    runRefSpeed: asset.runRefSpeed ?? stats.runSpeed,
  };
}
