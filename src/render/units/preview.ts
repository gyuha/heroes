/**
 * 개발용 병사 렌더 미리보기(dev/units-preview.html). 게임 빌드에는 들어가지 않는다.
 *
 * - ?mode=grid (기본): 행 = 병종 4 × 팀 2, 열 = idle walk run attack hit die. 각 칸이 자기 클립을 반복 시연한다.
 * - ?mode=cycle: 병종 4 × 팀 2 가 6클립을 차례로 돌아가며 재생한다.
 * - ?mode=stress&n=10000: n 명을 100명 부대로 나눠 배치, 부대마다 다른 클립. FPS 측정용.
 * - ?freeze=<초>: 시뮬레이션 시각을 고정한다(스크린샷 비교용).
 * - ?cam=x,y,z&target=x,y,z: 카메라 위치·주시점.
 * - ?base=<경로>: 리소스 기준 경로(없는 경로로 실패 대체 동작을 확인).
 *
 * 시연 상태는 틱 번호만으로 정해지는 함수(applyDemo)라 freeze 로 같은 장면을 다시 만들 수 있다.
 */
import {
  AxesHelper,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TICK_DT } from '../../sim/constants';
import { UNIT_TYPES } from '../../sim/data/balance';
import { UNIT_TYPE_ORDER, UnitStore } from '../../sim/units';
import { ANIM_CLIP_NAMES, AnimClip } from './clipTable';
import { SoldierRenderer } from './soldierRenderer';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'grid';
const freeze = params.has('freeze') ? Number(params.get('freeze')) : null;
const hud = document.getElementById('hud')!;

/** 시연 클립 주기(틱) */
const DIE_PERIOD = 60;
const HIT_PERIOD = 20;
const ATTACK_PERIOD = 30;
const MOVE_PERIOD = 10;
const CYCLE_PERIOD = 50;

interface Demo {
  units: UnitStore;
  baseX: Float32Array;
  baseZ: Float32Array;
  /** 병사별 시연 클립(-1 = cycle 모드: 틱에 따라 바뀜) */
  clip: Int8Array;
  /** 병사별 시연 시작 틱 차이(부대마다 다르게) */
  offset: Int32Array;
}

function makeDemo(n: number): Demo {
  return {
    units: new UnitStore(n),
    baseX: new Float32Array(n),
    baseZ: new Float32Array(n),
    clip: new Int8Array(n),
    offset: new Int32Array(n),
  };
}

function addSoldier(
  d: Demo,
  team: number,
  type: number,
  x: number,
  z: number,
  clip: number,
  offset = 0,
) {
  const i = d.units.add(team, x, 0, z, 0, type);
  d.baseX[i] = x;
  d.baseZ[i] = z;
  d.clip[i] = clip;
  d.offset[i] = offset;
}

/** 틱 번호로 각 병사의 위치·틱 기록을 정한다(시뮬레이션 대신). */
function applyDemo(d: Demo, tick: number): void {
  const u = d.units;
  for (let i = 0; i < u.count; i++) {
    const tk = tick + d.offset[i];
    let clip = d.clip[i];
    let local = tk;
    if (clip < 0) {
      clip = Math.floor(tk / CYCLE_PERIOD) % ANIM_CLIP_NAMES.length;
      local = tk % CYCLE_PERIOD;
    }
    const stats = UNIT_TYPES[UNIT_TYPE_ORDER[u.type[i]]];
    u.deathTick[i] = -1;
    u.lastHitTick[i] = -1;
    u.lastAttackTick[i] = -1;
    u.alive[i] = 1;
    let along = 0;
    let prevAlong = 0;
    if (clip === AnimClip.Die) {
      u.alive[i] = 0;
      u.deathTick[i] = tick - (local % (d.clip[i] < 0 ? CYCLE_PERIOD : DIE_PERIOD));
    } else if (clip === AnimClip.Hit) {
      u.lastHitTick[i] = tick - (local % HIT_PERIOD);
    } else if (clip === AnimClip.Attack) {
      u.lastAttackTick[i] = tick - (local % ATTACK_PERIOD);
    } else if (clip === AnimClip.Walk || clip === AnimClip.Run) {
      // 정면(+Z, heading 0)으로 실제 속도로 MOVE_PERIOD 동안 움직인 뒤 제자리로 순간 이동한다.
      // prev 는 늘 한 틱 뒤 위치라 순간 이동하는 틱에도 속도(= 클립 선택)가 유지된다.
      const speed = clip === AnimClip.Walk ? stats.walkSpeed : stats.runSpeed;
      along = (local % MOVE_PERIOD) * TICK_DT * speed;
      prevAlong = along - TICK_DT * speed;
    }
    u.x[i] = u.prevX[i] = d.baseX[i];
    u.z[i] = d.baseZ[i] + along;
    u.prevZ[i] = d.baseZ[i] + prevAlong;
  }
}

function buildGrid(): Demo {
  const d = makeDemo(UNIT_TYPE_ORDER.length * 2 * ANIM_CLIP_NAMES.length);
  for (let t = 0; t < UNIT_TYPE_ORDER.length; t++) {
    for (let team = 0; team < 2; team++) {
      const row = t * 2 + team;
      for (let c = 0; c < ANIM_CLIP_NAMES.length; c++) {
        addSoldier(d, team, t, (c - 2.5) * 4, (3.5 - row) * 4.5, c);
      }
    }
  }
  return d;
}

function buildCycle(): Demo {
  const d = makeDemo(UNIT_TYPE_ORDER.length * 2);
  for (let t = 0; t < UNIT_TYPE_ORDER.length; t++) {
    for (let team = 0; team < 2; team++) {
      addSoldier(d, team, t, (t - 1.5) * 4, (team - 0.5) * 5, -1);
    }
  }
  return d;
}

function buildStress(n: number): Demo {
  const d = makeDemo(n);
  const squadSize = 100;
  const squads = Math.ceil(n / squadSize);
  const cols = Math.ceil(Math.sqrt(squads));
  const clips = [
    AnimClip.Idle,
    AnimClip.Walk,
    AnimClip.Run,
    AnimClip.Attack,
    AnimClip.Walk,
    AnimClip.Hit,
    AnimClip.Idle,
    AnimClip.Die,
  ];
  for (let i = 0; i < n; i++) {
    const s = Math.floor(i / squadSize);
    const k = i % squadSize;
    const type = s % UNIT_TYPE_ORDER.length;
    const spacing = type === 3 ? 2.4 : 1.5;
    const x = ((s % cols) - cols / 2) * 26 + (k % 10) * spacing;
    const z = (Math.floor(s / cols) - cols / 2) * 30 + Math.floor(k / 10) * spacing * 1.2;
    addSoldier(d, s % 2, type, x, z, clips[s % clips.length], s * 7);
    d.units.squad[i] = s;
  }
  return d;
}

async function main() {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x9fc4e8);
  scene.add(new HemisphereLight(0xdfe9ff, 0x4a4030, 1.2));
  const sun = new DirectionalLight(0xfff2dd, 2.0);
  sun.position.set(-0.5, 1, 0.3);
  scene.add(sun);
  const ground = new Mesh(
    new PlaneGeometry(2000, 2000),
    new MeshLambertMaterial({ color: 0x7a8c5a }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const grid = new GridHelper(
    mode === 'stress' ? 400 : 40,
    mode === 'stress' ? 100 : 40,
    0x333333,
    0x556644,
  );
  grid.position.y = 0.002;
  scene.add(grid);
  // 원점 표시: 빨강 +X, 초록 +Y, 파랑 +Z (정면)
  const axes = new AxesHelper(2);
  axes.position.y = 0.004;
  scene.add(axes);

  const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 3000);
  const n = Number(params.get('n') ?? 10000);
  const demo = mode === 'stress' ? buildStress(n) : mode === 'cycle' ? buildCycle() : buildGrid();
  if (mode === 'stress') camera.position.set(0, 140, 220);
  else if (mode === 'cycle') camera.position.set(6, 6, 14);
  else camera.position.set(4, 18, 26);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, mode === 'stress' ? 0 : 1, 0);
  // ?cam=x,y,z&target=x,y,z 로 카메라를 직접 놓는다(근접 스크린샷용).
  const vec = (key: string) =>
    params.get(key)?.split(',').map(Number) as [number, number, number] | undefined;
  const cam = vec('cam');
  const target = vec('target');
  if (cam) camera.position.set(...cam);
  if (target) controls.target.set(...target);
  controls.update();

  const capacity = UNIT_TYPE_ORDER.map((_, t) => {
    let c = 0;
    for (let i = 0; i < demo.units.count; i++) if (demo.units.type[i] === t) c++;
    return c;
  });
  const t0 = performance.now();
  const soldiers = await SoldierRenderer.load(capacity, params.get('base') ?? undefined);
  const loadMs = performance.now() - t0;
  scene.add(soldiers.object);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  let simTime = freeze ?? 0;
  let tick = -1;
  let last = performance.now();
  let frames = 0;
  let fpsTime = last;
  let fps = 0;
  let syncMs = 0;
  const info: Record<string, unknown> = {};
  (window as unknown as { __preview: unknown }).__preview = info;

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (freeze === null) simTime += dt;
    const tickNow = Math.floor(simTime / TICK_DT);
    if (tickNow !== tick) {
      tick = tickNow;
      applyDemo(demo, tick);
    }
    const alpha = simTime / TICK_DT - tick;
    const s0 = performance.now();
    soldiers.sync(demo.units, alpha, tick);
    syncMs = syncMs * 0.95 + (performance.now() - s0) * 0.05;
    controls.update();
    renderer.render(scene, camera);

    frames++;
    if (now - fpsTime >= 1000) {
      fps = (frames * 1000) / (now - fpsTime);
      frames = 0;
      fpsTime = now;
    }
    const r = renderer.info.render;
    Object.assign(info, {
      mode,
      fps: Math.round(fps * 10) / 10,
      calls: r.calls,
      triangles: r.triangles,
      soldiers: demo.units.count,
      visible: UNIT_TYPE_ORDER.map((_, t) => soldiers.visibleCount(t)),
      trianglesPerType: soldiers.trianglesPerType,
      hasAnimations: soldiers.hasAnimations,
      syncMs: Math.round(syncMs * 1000) / 1000,
      loadMs: Math.round(loadMs),
      simTime: Math.round(simTime * 1000) / 1000,
    });
    hud.textContent =
      `mode=${mode}${freeze !== null ? ` freeze=${freeze}` : ''}  t=${simTime.toFixed(2)}s\n` +
      `fps ${fps.toFixed(1)}  draw calls ${r.calls}  tris ${r.triangles}  sync ${syncMs.toFixed(2)}ms\n` +
      `soldiers ${demo.units.count}  tris/type ${soldiers.trianglesPerType.join('/')}\n` +
      `animations ${UNIT_TYPE_ORDER.map((t, i) => `${t}:${soldiers.hasAnimations[i] ? 'O' : 'X'}`).join(' ')}\n` +
      (mode === 'grid'
        ? `열(왼→오): ${ANIM_CLIP_NAMES.join(' ')}\n행(뒤→앞): ${UNIT_TYPE_ORDER.map((t) => `${t} 청람/황토`).join(', ')}`
        : '');
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
