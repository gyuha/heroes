/**
 * [개발 화면] B의 GameSession 조립 전에 UI를 실제 브라우저에서 검증하는 화면.
 * 주소: /src/ui/dev/harness.html (pnpm dev). 빌드 입력이 아니다.
 *
 * 실제 것: A의 맵(public/maps/reed_ford)·지형 렌더·경로 탐색, B의 병사 렌더러(SoldierRenderer), UI 전체.
 * 목업: 세션(전투 규칙 흉내, session_mock.ts). 병사 애니메이션 상태는 목업이 채우지 않아 대부분 기본 자세다.
 *
 * 주소 파라미터(스크린샷용): ?phase=briefing|deployment|battle|result &team=0|1 &t=전투 초 &speed=1|2|4
 *   &maxSpeed=2 (4배속 제한 표시 확인)
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
import { createTerrainView } from '../../render/terrain/terrainView';
import { SoldierRenderer } from '../../render/units/soldierRenderer';
import { TICK_DT } from '../../sim/constants';
import { parseMap } from '../../sim/map/gameMap';
import { UnitStore } from '../../sim/units';
import { mountUi } from '../mountUi';
import { MockSession } from './session_mock';

const SKY = 0xbbcbd1;
const FOG = 0xb9c7c9;

async function loadMap(id: string) {
  const base = `${import.meta.env.BASE_URL}maps/${id}/`;
  const get = async (f: string) => {
    const r = await fetch(base + f);
    if (!r.ok) throw new Error(`${base}${f}: HTTP ${r.status}`);
    return r;
  };
  const [meta, height, types] = await Promise.all([
    get('map.json').then((r) => r.json()),
    get('height.u16').then((r) => r.arrayBuffer()),
    get('types.u8').then((r) => r.arrayBuffer()),
  ]);
  return parseMap(meta, height, types);
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const container = document.getElementById('app')!;
  const map = await loadMap('reed_ford');

  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  const scene = new Scene();
  scene.background = new Color(SKY);
  const fog = new Fog(FOG, 400, 1200);
  scene.fog = fog;
  scene.add(new HemisphereLight(0xdfe9ff, 0x4a4030, 1.2));
  const sun = new DirectionalLight(0xfff2dd, 2.0);
  sun.position.set(-0.5, 1, 0.3);
  scene.add(sun);
  const camera = new PerspectiveCamera(50, 1, 0.5, 3000);

  const terrainView = await createTerrainView(map);
  scene.add(terrainView.group);

  const session = new MockSession({ map, playerTeam: params.get('team') === '1' ? 1 : 0 });
  const units = new UnitStore(session.soldierCapacity);
  session.initSoldiers(units);
  const soldiers = await SoldierRenderer.load(
    session.soldierCapacityPerType,
    `${import.meta.env.BASE_URL}assets/units`,
  );
  scene.add(soldiers.object);
  const scale = Number(params.get('scale'));
  if (scale > 0) session.scale = scale;
  const maxSpeed = Number(params.get('maxSpeed'));
  if (maxSpeed === 1 || maxSpeed === 2) {
    session.maxSpeed = maxSpeed;
    session.speedLimitReason = '개발 화면 제한(?maxSpeed) — 시뮬레이션이 느린 기기 흉내';
  }

  const ui = mountUi({ container, session, view: { camera, scene, renderer } });

  const resize = () => {
    renderer.setSize(container.clientWidth, container.clientHeight);
    camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  // 주소 파라미터로 단계 건너뛰기
  const phase = params.get('phase');
  if (phase && phase !== 'briefing') {
    session.chooseSide(session.playerTeam ?? 0);
    if (phase === 'battle' || phase === 'result') {
      session.startBattle();
      session.fastForward(phase === 'result' ? 2000 : Number(params.get('t') ?? 0));
    }
  }
  const speed = Number(params.get('speed'));
  if (speed === 2 || speed === 4) session.setSpeed(speed);

  let acc = 0;
  let last = performance.now();
  const frame = (now: number) => {
    const frameSec = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (session.phase === 'battle' && !session.paused) {
      acc += frameSec * session.speed;
      let n = 0;
      while (acc >= TICK_DT && n < 20) {
        session.step(TICK_DT);
        acc -= TICK_DT;
        n++;
      }
      if (n > 0) session.writeSoldiers(units);
    } else if (session.phase === 'deployment') {
      session.writeSoldiers(units);
      acc = 0;
    }
    ui.update(frameSec);
    // B에게 요청한 동작을 개발 화면에서 대신 한다: 전술 지도에서 병사 숨김, 안개를 카메라 거리에 맞춤.
    soldiers.setVisible(!ui.camera.tacticalView);
    soldiers.sync(units, Math.min(1, acc / TICK_DT), session.tick);
    fog.near = ui.camera.distance + 150;
    fog.far = ui.camera.distance * 1.5 + 600;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  Object.assign(window, { __session: session, __ui: ui });
}

main().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="color:#ffb3aa;padding:24px;font:14px monospace">${String(e?.stack ?? e)}</pre>`,
  );
});
