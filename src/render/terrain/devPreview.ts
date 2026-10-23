/**
 * 지형 개발용 미리보기(게임 빌드에 들어가지 않는다). pnpm dev 후 /tools/map/preview.html
 * ?view=tactical|deploy|battle|battleNorth|ridge|mound|forest|cliff 로 카메라를 고른다. 카메라는 RtsCamera 와 같은
 * 방식(주시점·방위각·내려다보는 각·거리)으로 놓아 실제 게임 화면 거리와 맞춘다. 동서는 D-012(+x = 서쪽).
 * ?light=game 이면 지금 게임 조명, 없으면 A가 제안한 조명으로 그린다.
 * 로드 시간은 화면 왼쪽 위와 window.__terrainPreview 에 남긴다.
 */
import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseMap } from '../../sim/map/gameMap';
import { createTerrainView } from './terrainView';

const SKY_COLOR = 0xbbcbd1;
const FOG_COLOR = 0xb9c7c9;
/**
 * 주시점 (x, z), 방위각(yaw, π = 남쪽에서 북쪽을 봄), 내려다보는 각(°), 거리(m).
 * tactical = 전술 지도 최대 거리(rtsCamera MAX_DISTANCE, 수직 시점), battle = 기본 전투 카메라(120m, 50°).
 */
const VIEWS: Record<
  string,
  { x: number; z: number; yaw: number; pitch: number; distance: number }
> = {
  tactical: { x: 512, z: 512, yaw: Math.PI, pitch: 89, distance: 1250 },
  deploy: { x: 525, z: 355, yaw: Math.PI, pitch: 50, distance: 520 },
  battle: { x: 420, z: 470, yaw: Math.PI, pitch: 50, distance: 120 },
  battleNorth: { x: 420, z: 500, yaw: 0, pitch: 50, distance: 120 },
  ridge: { x: 420, z: 470, yaw: Math.PI, pitch: 35, distance: 320 },
  mound: { x: 520, z: 720, yaw: 0, pitch: 40, distance: 320 },
  forest: { x: 700, z: 430, yaw: Math.PI, pitch: 45, distance: 260 },
  cliff: { x: 200, z: 470, yaw: Math.PI, pitch: 40, distance: 300 },
};

/** 조명 비교: 지금 게임 조명과, 지형 음영(북서쪽 광원)과 방향을 맞춘 제안값. */
const GAME_LIGHT = {
  hemisphere: 1.2,
  sun: 2.0,
  sunDir: [-0.5, 1, 0.3] as [number, number, number],
};
const PROPOSED_LIGHT = {
  hemisphere: 0.8,
  sun: 2.6,
  sunDir: [0.5, 0.65, 0.57] as [number, number, number],
};

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const mapId = params.get('map') ?? 'reed_ford';
  const view = VIEWS[params.get('view') ?? 'tactical'] ?? VIEWS.tactical;

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(SKY_COLOR);
  scene.fog = new Fog(FOG_COLOR, 1400, 3000);
  // ?light=game: 현재 gameRenderer(B) 조명, 기본값: A가 요청한 조명(INTERFACES 요청 표)
  const light = params.get('light') === 'game' ? GAME_LIGHT : PROPOSED_LIGHT;
  scene.add(new HemisphereLight(0xdfe9ff, 0x4a4030, light.hemisphere));
  const sun = new DirectionalLight(0xfff2dd, light.sun);
  sun.position.set(...light.sunDir);
  scene.add(sun);

  const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 5000);
  const controls = new OrbitControls(camera, renderer.domElement);

  const t0 = performance.now();
  const base = `${import.meta.env.BASE_URL}maps/${mapId}/`;
  const get = async (f: string) => {
    const r = await fetch(base + f);
    if (!r.ok) throw new Error(`${base}${f}: HTTP ${r.status}`);
    return r;
  };
  const [meta, h, t] = await Promise.all([
    get('map.json').then((r) => r.json()),
    get('height.u16').then((r) => r.arrayBuffer()),
    get('types.u8').then((r) => r.arrayBuffer()),
  ]);
  const t1 = performance.now();
  const map = parseMap(meta, h, t);
  const t2 = performance.now();
  const terrainView = await createTerrainView(map);
  const pitch = (view.pitch * Math.PI) / 180;
  const targetY = map.terrain.heightAt(view.x, view.z);
  const horizontal = Math.cos(pitch) * view.distance;
  camera.position.set(
    view.x + Math.sin(view.yaw) * horizontal,
    targetY + Math.sin(pitch) * view.distance,
    view.z + Math.cos(view.yaw) * horizontal,
  );
  controls.target.set(view.x, targetY, view.z);
  controls.update();
  scene.add(terrainView.group);
  const t3 = performance.now();
  renderer.render(scene, camera);
  const t4 = performance.now();

  const timing = {
    fetchMs: t1 - t0,
    parseMs: t2 - t1,
    viewMs: t3 - t2,
    firstRenderMs: t4 - t3,
    totalMs: t4 - t0,
    triangles: renderer.info.render.triangles,
    drawCalls: renderer.info.render.calls,
  };
  (window as unknown as { __terrainPreview: typeof timing }).__terrainPreview = timing;
  const hud = document.createElement('pre');
  hud.style.cssText =
    'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;background:#0008;color:#fff;font:12px monospace';
  hud.textContent =
    `${map.meta.name} (${map.meta.id})\n` +
    Object.entries(timing)
      .map(([k, v]) => `${k} ${typeof v === 'number' && k.endsWith('Ms') ? v.toFixed(1) : v}`)
      .join('\n');
  document.body.appendChild(hud);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}

main().catch((err) => {
  document.body.textContent = String(err);
  console.error(err);
});
