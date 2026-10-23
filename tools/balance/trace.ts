/**
 * S6 군대 전투 한 판을 60초 간격으로 출력한다(AI 스크립트·수치 디버깅용).
 *   node tools/balance/trace.ts <공격 편성 0~4> <f|r> [a]
 *   f = 평지, r = 능선 12°·25m, 세 번째 인자 a = 측면 고정
 */
import { Battle } from './engine.ts';
import { armySpecs, ATT_ARMIES, DEF_ARMY, ridge } from './scenarios.ts';
const which = Number(process.argv[2]);
const useRidge = process.argv[3] === 'r';
const anchored = process.argv[4] === 'a';
const lineZ = 420;
const t = useRidge ? ridge(12, 25, lineZ - 25 / Math.tan((12 * Math.PI) / 180)) : ridge(0, 0, 0);
const b = new Battle(armySpecs(ATT_ARMIES[which].c, DEF_ARMY, lineZ, false, anchored), {
  seed: 6000,
  endMode: 'army',
  timeLimit: 1200,
  terrain: t,
  bounds: { minX: -900, maxX: 900, minZ: -400, maxZ: 1200 },
});
let next = 0;
while (b.time < 1200) {
  b.step();
  if (b.time >= next) {
    next += 60;
    console.log(`t=${Math.round(b.time)}`);
    for (const u of b.units) {
      const o = u.order.kind === 'attack' ? `atk>${u.order.target}` : u.order.kind;
      console.log(
        `  ${u.id} T${u.team} ${u.t.id.padEnd(8)} n=${String(u.n).padStart(3)} m=${u.morale.toFixed(0).padStart(3)} ${u.state.padEnd(9)} (${u.x.toFixed(0)},${u.z.toFixed(0)}) ${o} c=${u.contacts.length} wp=${u.waypoints.length}`,
      );
    }
  }
}
