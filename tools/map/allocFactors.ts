/**
 * 부대 단위 지형 질의 함수만의 할당 측정(T-022). 실제 전투를 예열한 뒤 그 순간의 병사 위치·진행 방향으로
 * moveFactorsInto·heightsInto 를 부대마다 불러, 함수 안에서 생긴 할당만 표본으로 잰다.
 *
 *   node --experimental-transform-types --no-warnings --import ./tools/map/register.mjs tools/map/allocFactors.ts [예열 틱] [반복]
 */
import { Session } from 'node:inspector';
import { createBattle } from '../../src/sim/battleSetup';
import { TICK_DT } from '../../src/sim/constants';
import { Pathfinder } from '../../src/sim/map/pathfinder';
import { createReedFord } from '../../src/sim/map/reedFord';
import { REED_FORD } from '../../src/sim/scenarios/reedFord';
import { heightsInto } from '../../src/sim/terrain';
import { moveFactorsInto } from '../../src/sim/terrainRules';
import { UNIT_TYPE_ORDER } from '../../src/sim/units';

const WARMUP_TICKS = Number(process.argv[2] ?? 2000);
const REPS = Number(process.argv[3] ?? 2000);
const SAMPLING_INTERVAL = 1024;
/** JIT 가 함수를 최적화하도록 재기 전에 돌리는 횟수 */
const JIT_WARMUP_REPS = 300;

interface ProfileNode {
  callFrame: { functionName: string };
  selfSize: number;
  children: ProfileNode[];
}

function post<T>(session: Session, method: string, params?: object): Promise<T> {
  return new Promise((resolve, reject) =>
    session.post(method, params ?? {}, (err, res) => (err ? reject(err) : resolve(res as T))),
  );
}

async function sampled(session: Session, run: () => void): Promise<Map<string, number>> {
  await post(session, 'HeapProfiler.startSampling', {
    samplingInterval: SAMPLING_INTERVAL,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  run();
  const { profile } = await post<{ profile: { head: ProfileNode } }>(
    session,
    'HeapProfiler.stopSampling',
  );
  const byFn = new Map<string, number>();
  const walk = (n: ProfileNode) => {
    if (n.selfSize > 0) {
      const k = n.callFrame.functionName || '(anonymous)';
      byFn.set(k, (byFn.get(k) ?? 0) + n.selfSize);
    }
    for (const c of n.children) walk(c);
  };
  walk(profile.head);
  return byFn;
}

async function main(): Promise<void> {
  const map = createReedFord();
  const world = createBattle({
    map,
    pathfinder: new Pathfinder(map),
    scenario: REED_FORD,
    seed: 1,
    aiTeams: [0, 1],
  });
  world.startBattle();
  for (let t = 0; t < WARMUP_TICKS && world.phase === 'battle'; t++) {
    world.step(TICK_DT);
    world.drainEvents();
  }

  // 부대별 병사 목록과 진행 방향(속도 방향, 정지면 0)
  const u = world.units;
  const n = u.count;
  const dirX = new Float64Array(n);
  const dirZ = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    dirX[i] = u.vx[i];
    dirZ[i] = u.vz[i];
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (!u.alive[i]) continue;
    const list = groups.get(u.squad[i]) ?? [];
    list.push(i);
    groups.set(u.squad[i], list);
  }
  const squads = [...groups.values()].map((list) => Int32Array.from(list));
  const cavalry = UNIT_TYPE_ORDER.indexOf('cavalry');
  const mountedOf = squads.map((idx) => u.type[idx[0]] === cavalry);
  const soldiers = squads.reduce((s, idx) => s + idx.length, 0);
  const out = new Float64Array(n);
  const outY = new Float32Array(n);

  const factorsPass = () => {
    for (let s = 0; s < squads.length; s++)
      moveFactorsInto(
        world.terrain,
        u.x,
        u.z,
        dirX,
        dirZ,
        mountedOf[s],
        squads[s],
        squads[s].length,
        out,
      );
  };
  const heightsPass = () => {
    for (let s = 0; s < squads.length; s++)
      heightsInto(world.terrain, u.x, u.z, squads[s], squads[s].length, outY);
  };

  const session = new Session();
  session.connect();
  for (const [name, pass, fn] of [
    ['moveFactorsInto', factorsPass, 'moveFactorsInto'],
    ['heightsInto', heightsPass, 'heightsInto'],
  ] as const) {
    for (let r = 0; r < JIT_WARMUP_REPS; r++) pass();
    const byFn = await sampled(session, () => {
      for (let r = 0; r < REPS; r++) pass();
    });
    const own = byFn.get(fn) ?? 0;
    const total = [...byFn.values()].reduce((a, b) => a + b, 0);
    const evals = REPS * soldiers;
    console.log(
      `${name}: 부대 ${squads.length}개·병사 ${soldiers}명 × ${REPS}회 = ${(evals / 1e6).toFixed(1)}M회 계산, ` +
        `함수 자체 할당 ${(own / 1024).toFixed(1)}KB (병사 1,000명당 ${((own / evals) * 1000).toFixed(3)}B), ` +
        `측정 구간 전체 ${(total / 1024).toFixed(1)}KB`,
    );
    for (const [k, v] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
      console.log(`    ${k}: ${(v / 1024).toFixed(1)}KB`);
    }
  }
  session.disconnect();
}

main();
