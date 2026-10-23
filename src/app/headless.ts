/**
 * 헤드리스 AI 대 AI 러너(BALANCE §7 검증, ARCHITECTURE §9.3 성능 측정). 브라우저 없이 실제 sim 코드로 여러 판을 돌린다.
 *
 * 실행: pnpm sim:headless [옵션]
 *   --games N      판 수(기본 10)          --seed S     첫 시드(기본 1, 판마다 +1)
 *   --plan A|B|C   공격 계획 고정(기본: 시드로 무작위)
 *   --scale k      부대마다 병사 수 × k(0.25~2, 성능 측정용, 기본 1)
 *   --seconds T    전투 T초에서 끊는다(측정용, 기본: 끝날 때까지)
 *   --profile      시스템별 ms/틱도 잰다(측정 훅 자체가 조금 할당하므로 가비지 측정과 같이 보지 않는다)
 *   --json FILE    판별 결과를 JSON으로 저장
 * 같은 시드·같은 계획·같은 배율이면 같은 결과가 나온다(결정론).
 * 가비지(할당량)는 V8 GCProfiler로 잰다: GC 직전 사용량 − 직전 GC 직후 사용량의 합 + 마지막 증가분.
 */
import type { AiController } from '../sim/ai/aiController';
import type { AttackPlanId } from '../sim/ai/aiPlans';
import { createBattle } from '../sim/battleSetup';
import { TICK_DT } from '../sim/constants';
import { createReedFord } from '../sim/map/reedFord';
import { Pathfinder } from '../sim/map/pathfinder';
import { scaleScenario } from '../sim/scenario';
import { REED_FORD } from '../sim/scenarios/reedFord';
import { STEP_PHASES } from '../sim/systems/battleStep';

/** 승패가 안 나도 이 시간에서 끊는다(제한 시간 + 연장전 + 여유, 초) */
const HARD_STOP = REED_FORD.rules.timeLimit + REED_FORD.rules.overtimeMax + 5;
const MAX_TICKS = Math.ceil(HARD_STOP / TICK_DT) + 1;
/** 처음 이 틱 수(30초)는 JIT 예열 구간으로 보고 '예열 뒤 최대'에서 뺀다 */
const WARMUP_TICKS = Math.round(30 / TICK_DT);

interface GameRecord {
  seed: number;
  plan: string;
  scale: number;
  winner: number;
  reason: string;
  time: number;
  firstContact: number;
  teams: { start: number; effective: number; routing: number; lost: number; kills: number }[];
  tickMsAvg: number;
  tickMsP50: number;
  tickMsP99: number;
  tickMsMax: number;
  /** 가장 느린 틱의 전투 시각(초)과, 처음 30초(JIT 예열)를 뺀 최대 */
  tickMaxAt: number;
  tickMsMaxAfterWarmup: number;
  /** 틱당 평균 할당(KB), 소규모·전체 GC 횟수 */
  allocKBPerTick: number;
  gcCount: number;
}

// 프로젝트에 Node 타입(@types/node)이 없으므로 쓰는 것만 좁게 선언해 꺼낸다.
const nodeProcess = (globalThis as unknown as { process: { argv: string[] } }).process;
const NODE_FS = 'node:fs';
const NODE_V8 = 'node:v8';
interface HeapStats {
  usedHeapSize: number;
}
interface GcStat {
  beforeGC: { heapStatistics: HeapStats };
  afterGC: { heapStatistics: HeapStats };
}
interface V8Module {
  GCProfiler: new () => { start(): void; stop(): { statistics: GcStat[] } };
  getHeapStatistics(): { used_heap_size: number };
}
const v8 = (await import(/* @vite-ignore */ NODE_V8)) as V8Module;

function arg(name: string): string | undefined {
  const k = nodeProcess.argv.indexOf(`--${name}`);
  return k >= 0 ? nodeProcess.argv[k + 1] : undefined;
}

const games = Number(arg('games') ?? 10);
const firstSeed = Number(arg('seed') ?? 1);
const plan = arg('plan') as AttackPlanId | undefined;
const scale = Number(arg('scale') ?? 1) || 1;
const profile = nodeProcess.argv.includes('--profile');
const stopAt = Math.min(HARD_STOP, Number(arg('seconds') ?? HARD_STOP) || HARD_STOP);
const jsonOut = arg('json');

const map = createReedFord();
const pathfinder = new Pathfinder(map);
const scenario = scaleScenario(REED_FORD, scale);
const phaseMs = new Float64Array(STEP_PHASES.length + 1);
const phaseMax = new Float64Array(STEP_PHASES.length + 1);
const tickMs = new Float64Array(MAX_TICKS);
const records: GameRecord[] = [];

for (let g = 0; g < games; g++) {
  const seed = firstSeed + g;
  const world = createBattle({
    map,
    pathfinder,
    scenario,
    seed,
    aiTeams: [0, 1],
    attackPlan: plan,
  });
  world.startBattle();
  if (profile) {
    let last = 0;
    world.probe = (p) => {
      const now = performance.now();
      if (p >= -1) {
        phaseMs[p + 1] += now - last;
        if (now - last > phaseMax[p + 1]) phaseMax[p + 1] = now - last;
      }
      last = now;
    };
  }
  let firstContact = -1;
  let n = 0;
  const gc = new v8.GCProfiler();
  const used0 = v8.getHeapStatistics().used_heap_size;
  gc.start();
  while (world.phase === 'battle' && world.time < stopAt) {
    const t0 = performance.now();
    world.step(TICK_DT);
    tickMs[n++] = performance.now() - t0;
    for (const e of world.drainEvents()) {
      if (e.kind === 'engage' && firstContact < 0) firstContact = e.time;
    }
  }
  const gcStats = gc.stop().statistics;
  const allocated = allocatedBytes(used0, gcStats, v8.getHeapStatistics().used_heap_size);
  let maxAt = 0;
  let maxAfterWarmup = 0;
  for (let k = 0; k < n; k++) {
    if (tickMs[k] > tickMs[maxAt]) maxAt = k;
    if (k >= WARMUP_TICKS && tickMs[k] > maxAfterWarmup) maxAfterWarmup = tickMs[k];
  }
  const sorted = Array.from(tickMs.subarray(0, n)).sort((a, b) => a - b);
  let sum = 0;
  for (const t of sorted) sum += t;
  const r = world.result;
  const ai = world.controllers.find((c) => c.team === world.scenario.attacker) as
    AiController | undefined;
  const rec: GameRecord = {
    seed,
    plan: ai?.plan ?? '?',
    scale,
    winner: r?.winner ?? -1,
    reason: r?.reason ?? 'timeout',
    time: Math.round(world.time),
    firstContact: Math.round(firstContact),
    teams: (r?.teams ?? []).map((t) => ({
      start: t.start,
      effective: t.effective,
      routing: t.routing,
      lost: t.lost,
      kills: t.kills,
    })),
    tickMsAvg: +(sum / n).toFixed(2),
    tickMsP50: +percentile(sorted, 0.5).toFixed(2),
    tickMsP99: +percentile(sorted, 0.99).toFixed(2),
    tickMsMax: +sorted[n - 1].toFixed(1),
    tickMaxAt: +((maxAt + 1) * TICK_DT).toFixed(1),
    tickMsMaxAfterWarmup: +maxAfterWarmup.toFixed(1),
    allocKBPerTick: +(allocated / n / 1024).toFixed(1),
    gcCount: gcStats.length,
  };
  records.push(rec);
  const t = rec.teams;
  console.log(
    `seed ${seed} plan ${rec.plan}${scale !== 1 ? ` scale ${scale}` : ''} → winner ` +
      `${rec.winner === 0 ? '방어(청람)' : rec.winner === 1 ? '공격(황토)' : '무승부'} ` +
      `${rec.reason} ${fmt(rec.time)} | 첫 접촉 ${fmt(rec.firstContact)} | ` +
      `청람 ${t[0]?.effective}/${t[0]?.start} (패주 ${t[0]?.routing}) 황토 ${t[1]?.effective}/${t[1]?.start} (패주 ${t[1]?.routing}) | ` +
      `틱 평균 ${rec.tickMsAvg} p50 ${rec.tickMsP50} p99 ${rec.tickMsP99} 최대 ${rec.tickMsMax}ms(${rec.tickMaxAt}초), ` +
      `예열 뒤 최대 ${rec.tickMsMaxAfterWarmup}ms | ` +
      `할당 ${rec.allocKBPerTick}KB/틱, GC ${rec.gcCount}회`,
  );
}

const defWins = records.filter((r) => r.winner === REED_FORD.defender).length;
const times = records.map((r) => r.time).sort((a, b) => a - b);
const median = times.length ? times[Math.floor(times.length / 2)] : 0;
const ticks = records.reduce((a, r) => a + r.time / TICK_DT, 0);
console.log(
  `\n${records.length}판: 방어 승률 ${((100 * defWins) / Math.max(1, records.length)).toFixed(0)}% ` +
    `(${defWins}/${records.length}), 전투 시간 중앙값 ${fmt(median)}`,
);
if (profile) {
  console.log(
    '시스템별 ms/틱 평균(최대): ' +
      ['ai', ...STEP_PHASES]
        .map((name, k) => `${name} ${(phaseMs[k] / ticks).toFixed(2)}(${phaseMax[k].toFixed(0)})`)
        .join(', '),
  );
}
if (jsonOut) {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as {
    writeFileSync(path: string, data: string): void;
  };
  fs.writeFileSync(jsonOut, JSON.stringify(records, null, 2));
}

/** 측정 구간에 새로 할당된 바이트 = Σ(GC 직전 사용량 − 직전 시점 사용량) + 마지막 GC 뒤 증가분. */
function allocatedBytes(used0: number, stats: GcStat[], usedEnd: number): number {
  let total = 0;
  let prev = used0;
  for (const s of stats) {
    total += Math.max(0, s.beforeGC.heapStatistics.usedHeapSize - prev);
    prev = s.afterGC.heapStatistics.usedHeapSize;
  }
  return total + Math.max(0, usedEnd - prev);
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function fmt(sec: number): string {
  if (sec < 0) return '-';
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
