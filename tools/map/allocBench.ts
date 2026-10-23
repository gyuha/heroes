/**
 * 시뮬레이션 할당량 측정(T-020). 실제 AI 대 AI 전투를 돌리며 V8 표본 힙 프로파일러로 함수별 할당 바이트를 모은다.
 * GC로 이미 회수된 객체까지 센다(includeObjectsCollectedBy*GC). 끝에 최종 상태 지문을 찍어 전후 결과가 같은지 본다.
 *
 *   node --experimental-transform-types --no-warnings --import ./tools/map/register.mjs tools/map/allocBench.ts [틱 수] [시드] [예열 틱]
 * 예열 틱 동안은 재지 않는다. JIT가 자리 잡기 전(인터프리터·Maglev)의 할당이 섞이지 않게 한다.
 */
import { Session } from 'node:inspector';
import { createBattle } from '../../src/sim/battleSetup';
import { TICK_DT } from '../../src/sim/constants';
import { Pathfinder } from '../../src/sim/map/pathfinder';
import { createReedFord } from '../../src/sim/map/reedFord';
import { REED_FORD } from '../../src/sim/scenarios/reedFord';

const TICKS = Number(process.argv[2] ?? 4000);
const SEED = Number(process.argv[3] ?? 1);
const WARMUP = Number(process.argv[4] ?? 0);
/** 표본 간격(바이트). 작을수록 정확하고 느리다. */
const SAMPLING_INTERVAL = 4096;
const TOP = 15;

interface ProfileNode {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: ProfileNode[];
}

function post<T>(session: Session, method: string, params?: object): Promise<T> {
  return new Promise((resolve, reject) =>
    session.post(method, params ?? {}, (err, res) => (err ? reject(err) : resolve(res as T))),
  );
}

async function main(): Promise<void> {
  const map = createReedFord();
  const pathfinder = new Pathfinder(map);
  const world = createBattle({ map, pathfinder, scenario: REED_FORD, seed: SEED, aiTeams: [0, 1] });
  world.startBattle();
  for (let t = 0; t < WARMUP && world.phase === 'battle'; t++) {
    world.step(TICK_DT);
    world.drainEvents();
  }

  const session = new Session();
  session.connect();
  await post(session, 'HeapProfiler.startSampling', {
    samplingInterval: SAMPLING_INTERVAL,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  const start = performance.now();
  let ticks = 0;
  while (ticks < TICKS && world.phase === 'battle') {
    world.step(TICK_DT);
    world.drainEvents();
    ticks++;
  }
  const ms = performance.now() - start;
  const { profile } = await post<{ profile: { head: ProfileNode } }>(
    session,
    'HeapProfiler.stopSampling',
  );
  session.disconnect();

  const byFn = new Map<string, number>();
  /** 호출자 → 함수 할당(인라인된 함수는 표본에서 호출자 몫으로 잡힌다) */
  const byEdge = new Map<string, number>();
  let total = 0;
  const label = (n: ProfileNode) =>
    `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').pop() || '(native)'}:${n.callFrame.lineNumber + 1}`;
  const walk = (n: ProfileNode, parent: ProfileNode | null) => {
    if (n.selfSize > 0) {
      const key = label(n);
      byFn.set(key, (byFn.get(key) ?? 0) + n.selfSize);
      const edge = `${parent ? label(parent) : '(root)'} → ${key}`;
      byEdge.set(edge, (byEdge.get(edge) ?? 0) + n.selfSize);
      total += n.selfSize;
    }
    for (const c of n.children) walk(c, n);
  };
  walk(profile.head, null);

  console.log(
    `틱 ${ticks}(예열 ${WARMUP} 뒤), 시드 ${SEED}, ${ms.toFixed(0)}ms (틱당 ${(ms / ticks).toFixed(2)}ms, 표본 수집 포함)`,
  );
  console.log(
    `표본 할당 합계 ${(total / 1e6).toFixed(1)}MB (틱당 ${(total / ticks / 1024).toFixed(1)}KB)`,
  );
  for (const [key, bytes] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
    console.log(
      `  ${((bytes / total) * 100).toFixed(1).padStart(5)}%  ${(bytes / 1e6).toFixed(2).padStart(7)}MB  ${key}`,
    );
  }

  console.log('호출자별(상위):');
  for (const [edge, bytes] of [...byEdge].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
    console.log(`  ${((bytes / total) * 100).toFixed(1).padStart(5)}%  ${edge}`);
  }

  // 결정론 지문: 병사 위치·높이·체력과 전투 상태
  const u = world.units;
  let h = 2166136261;
  const mix = (v: number) => {
    h = Math.imul((h ^ (Math.fround(v) * 1e4)) | 0, 16777619) >>> 0;
  };
  for (let i = 0; i < u.count; i++) {
    mix(u.x[i]);
    mix(u.z[i]);
    mix(u.y[i]);
    mix(u.hp[i]);
  }
  console.log(
    `지문 ${h.toString(16)} (병사 ${u.count}, 시간 ${world.time.toFixed(2)}s, 단계 ${world.phase})`,
  );
}

main();
