/**
 * 실제 sim 한 판에서 공격 부대의 역할·경로·명령·위치를 일정 간격으로 출력한다(T-015, AI 정체 지점 찾기).
 *   node --experimental-transform-types --no-warnings --import ./tools/map/register.mjs tools/balance/game-trace.ts --plan B --seed 1 --every 60
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
const every = Number(arg('every') ?? 60);
const map = createReedFord();
const world = createBattle({
  map,
  pathfinder: new Pathfinder(map),
  scenario: REED_FORD,
  seed: Number(arg('seed') ?? 1),
  aiTeams: [0, 1],
  attackPlan: (arg('plan') ?? 'B') as AttackPlanId,
});
world.startBattle();
const ai = world.controllers.find((c) => c.team === REED_FORD.attacker) as unknown as {
  memo: { stance: string; lane: string; wp: number }[];
};
const f = REED_FORD.rules.flag;
let next = every;
while (world.phase === 'battle' && world.time < 960) {
  world.step(TICK_DT);
  world.drainEvents();
  if (world.time < next) continue;
  next += every;
  console.log(
    `t=${Math.round(world.time)}  flag ${world.flag.state} ${world.flag.progress.toFixed(0)}`,
  );
  for (const s of world.squads) {
    if (s.team !== REED_FORD.attacker || !s.alive) continue;
    const m = ai.memo[s.id];
    const o = s.order.kind === 'attack' ? `atk>${s.order.target}` : s.order.kind;
    console.log(
      `  ${String(s.id).padStart(2)} ${UNIT_TYPE_ORDER[s.typeIndex].padEnd(8)} ${m.stance.padEnd(9)} ${m.lane.padEnd(10)} wp${m.wp} ` +
        `n=${String(s.n).padStart(3)} m=${s.morale.toFixed(0).padStart(3)} ${s.state.padEnd(8)} ${s.activity.padEnd(11)} ${o.padEnd(7)} ` +
        `(${s.x.toFixed(0)},${s.z.toFixed(0)}) 깃발 ${Math.hypot(s.x - f.x, s.z - f.z).toFixed(0)}m`,
    );
  }
}
