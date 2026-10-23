/**
 * 기병 충격 0명 처치 원인 확인(T-015). 실제 sim으로 한 판을 돌리며 공격 측 chargeImpact 이벤트가 난 틱에
 * 앞 2행 기수와 가장 가까운 대상 병사 사이 거리를 잰다. 충격 판정 반경(SQUAD.chargeImpactReach + 행 간격)
 * 안에 대상 병사가 없으면 충격은 아무도 못 친다.
 *   node --experimental-transform-types --no-warnings --import ./tools/map/register.mjs tools/balance/charge-probe.ts --plan A --seed 1
 */
import type { AttackPlanId } from '../../src/sim/ai/aiPlans';
import { createBattle } from '../../src/sim/battleSetup';
import { TICK_DT } from '../../src/sim/constants';
import { SQUAD, SOLDIER } from '../../src/sim/data/simConfig';
import { createReedFord } from '../../src/sim/map/reedFord';
import { Pathfinder } from '../../src/sim/map/pathfinder';
import { REED_FORD } from '../../src/sim/scenarios/reedFord';

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
console.log(
  '| 시각 | 방향 | 속도비 | 처치 | 앞 2행 기수 | 판정 반경 안에 대상 병사가 있는 기수 | 기수→가장 가까운 대상 병사 거리 중앙값(m) | 부대 간격(m) |',
);
console.log('|---|---|---|---|---|---|---|---|');
while (world.phase === 'battle' && world.time < 960) {
  world.step(TICK_DT);
  for (const e of world.drainEvents()) {
    if (e.kind !== 'chargeImpact' || world.squads[e.squad].team !== REED_FORD.attacker) continue;
    const att = world.squads[e.squad];
    const def = world.squads[e.target];
    const F = att.curFiles;
    const riders = Math.min(att.n, F * SQUAD.chargeImpactRanks);
    const ds: number[] = [];
    let inReach = 0;
    for (let k = 0; k < riders; k++) {
      const r = att.members[k];
      if (r < 0) continue;
      const reach = SQUAD.chargeImpactReach + Math.floor(k / F) * att.rankSpacing;
      let best = Infinity;
      for (let q = 0; q < def.n; q++) {
        const j = def.members[q];
        const d = Math.hypot(u.x[j] - u.x[r], u.z[j] - u.z[r]) - SOLDIER.bodyRadius[def.typeIndex];
        if (d < best) best = d;
      }
      ds.push(best);
      if (best <= reach) inReach++;
    }
    ds.sort((a, b) => a - b);
    const gapAB = Math.hypot(att.x - def.x, att.z - def.z) - att.depth / 2 - def.depth / 2;
    console.log(
      `| ${e.time.toFixed(0)}s | ${e.side}${e.braced ? '+brace' : ''} | ${e.speedRatio.toFixed(2)} | ${e.kills} | ${riders} | ${inReach} | ${ds[Math.floor(ds.length / 2)].toFixed(1)} | ${gapAB.toFixed(1)} |`,
    );
  }
}
