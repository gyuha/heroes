/**
 * 대형 결속도 측정(T-015). 부대 중심(대형 사각형)과 실제 병사 위치가 얼마나 어긋나는지 5초마다 잰다.
 * 접촉·충격·사기 판정은 부대 사각형으로 하고 피해는 병사 위치로 주므로, 둘이 어긋나면 "교전 중인데 아무도 못 치는" 상태가 된다.
 *   node --experimental-transform-types --no-warnings --import ./tools/map/register.mjs tools/balance/cohesion-probe.ts --plan A --seed 1
 */
import type { AttackPlanId } from '../../src/sim/ai/aiPlans';
import { createBattle } from '../../src/sim/battleSetup';
import { TICK_DT } from '../../src/sim/constants';
import { createReedFord } from '../../src/sim/map/reedFord';
import { Pathfinder } from '../../src/sim/map/pathfinder';
import { REED_FORD } from '../../src/sim/scenarios/reedFord';
import { UNIT_TYPE_ORDER } from '../../src/sim/units';

const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv;
const arg = (n: string) => {
  const k = argv.indexOf(`--${n}`);
  return k >= 0 ? argv[k + 1] : undefined;
};
const map = createReedFord();
const world = createBattle({
  map,
  pathfinder: new Pathfinder(map),
  scenario: REED_FORD,
  seed: Number(arg('seed') ?? 1),
  aiTeams: [0, 1],
  attackPlan: (arg('plan') ?? 'A') as AttackPlanId,
});
world.startBattle();
const u = world.units;
const local = { lateral: 0, forward: 0 };
/** key = 진영/병종/활동 → [표본 수, 자리와의 거리 합, 10m 넘게 벗어난 병사 비율 합, 앞 행 병사의 적 최근접 거리 합] */
const acc = new Map<string, number[]>();
const add = (k: string, v: number[]) => {
  const a = acc.get(k) ?? [0, 0, 0, 0];
  for (let i = 0; i < v.length; i++) a[i] += v[i];
  acc.set(k, a);
};
const every = Math.round(5 / TICK_DT);
while (world.phase === 'battle' && world.time < 960) {
  world.step(TICK_DT);
  world.drainEvents();
  if (world.tick % every !== 0) continue;
  for (const sq of world.squads) {
    if (!sq.ready || sq.n === 0) continue;
    const fx = Math.sin(sq.facing);
    const fz = Math.cos(sq.facing);
    let sum = 0;
    let far = 0;
    for (let k = 0; k < sq.n; k++) {
      sq.slotLocal(k, local);
      const sx = sq.x + fz * local.lateral + fx * local.forward;
      const sz = sq.z - fx * local.lateral + fz * local.forward;
      const i = sq.members[k];
      const d = Math.hypot(u.x[i] - sx, u.z[i] - sz);
      sum += d;
      if (d > 10) far++;
    }
    // 교전 중이면 앞 행 병사에서 가장 가까운 적 병사까지 거리
    let front = 0;
    if (sq.engaged) {
      const F = sq.curFiles;
      const ds: number[] = [];
      for (let k = 0; k < Math.min(F, sq.n); k++) {
        const i = sq.members[k];
        let best = Infinity;
        for (const e of world.squads) {
          if (e.team === sq.team || !e.alive) continue;
          if (Math.hypot(e.x - sq.x, e.z - sq.z) > 150) continue;
          for (let q = 0; q < e.n; q++) {
            const j = e.members[q];
            const d = Math.hypot(u.x[j] - u.x[i], u.z[j] - u.z[i]);
            if (d < best) best = d;
          }
        }
        ds.push(best);
      }
      ds.sort((a, b) => a - b);
      front = ds[Math.floor(ds.length / 2)];
    }
    const act = sq.engaged ? 'engaged' : sq.speed > 0.1 ? 'moving' : 'still';
    add(
      `${sq.team === REED_FORD.attacker ? '공격' : '방어'}|${UNIT_TYPE_ORDER[sq.typeIndex]}|${act}`,
      [1, sum / sq.n, far / sq.n, front],
    );
  }
}
console.log(
  '| 진영 | 병종 | 상태 | 표본(부대·5초) | 병사-자기 자리 평균 거리(m) | 자리에서 10m 넘게 벗어난 병사 | 교전 중 앞 행 병사→가장 가까운 적 병사(중앙값 평균, m) |',
);
console.log('|---|---|---|---|---|---|---|');
for (const [k, a] of [...acc.entries()].sort()) {
  const [team, type, act] = k.split('|');
  console.log(
    `| ${team} | ${type} | ${act} | ${a[0]} | ${(a[1] / a[0]).toFixed(1)} | ${Math.round((100 * a[2]) / a[0])}% | ${act === 'engaged' ? (a[3] / a[0]).toFixed(1) : '-'} |`,
  );
}
