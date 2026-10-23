// Node 24: node --experimental-transform-types --no-warnings --import ./tools/map/register.mjs tools/qa/session-smoke.ts
import { GameSession } from '../../src/app/gameSession';
import { createReedFord } from '../../src/sim/map/reedFord';
import { Pathfinder } from '../../src/sim/map/pathfinder';
import { REED_FORD } from '../../src/sim/scenarios/reedFord';

const map = createReedFord();
let checks = 0;
function check(value: boolean, label: string) {
  if (!value) throw new Error(label);
  console.log(`PASS ${++checks}: ${label}`);
}
function make(team: 0 | 1) {
  const s = new GameSession({
    map,
    pathfinder: new Pathfinder(map),
    scenario: REED_FORD,
    seed: 11,
  });
  s.chooseSide(team);
  return s;
}
for (const team of [0, 1] as const) {
  const s = make(team);
  const q = s.world.squads.find((q) => q.team === team && !q.isCommander)!;
  check(s.phase === 'deployment', `${team}: choose side`);
  check(
    s.issue({ kind: 'deploy', team, squad: q.id, x: -100, z: -100, facing: 0 }) ===
      'invalidPlacement',
    `${team}: outside deployment refused`,
  );
  check(
    s.issue({ kind: 'deploy', team, squad: q.id, x: q.x, z: q.z, facing: q.facing }) === 'ok',
    `${team}: valid deployment`,
  );
  s.startBattle();
  s.setPaused(true);
  check(s.advance(1000) === 0 && s.world.tick === 0, `${team}: pause freezes ticks`);
  check(
    s.issue({ kind: 'hold', team, squads: [q.id] }) === 'ok',
    `${team}: paused command accepted`,
  );
  s.setPaused(false);
  s.advance(50);
  check(q.order.kind === 'hold', `${team}: queued command applied after resume`);
  check(
    s.issue({ kind: 'hold', team, squads: [] }) === 'noSelection',
    `${team}: no selection refused`,
  );
  for (const formation of ['line', 'column', 'loose'] as const) {
    s.issue({ kind: 'formation', team, squads: [q.id], formation });
    s.advance(50);
    check(q.formation === formation, `${team}: ${formation}`);
  }
  q.state = 'routing';
  s.issue({ kind: 'move', team, squads: [q.id], x: q.x + 10, z: q.z });
  s.advance(50);
  check(q.order.kind !== 'move', `${team}: routed squad ignores move (injected routing)`);
  s.surrender();
  check(
    s.phase === 'result' && s.result()?.reason === 'surrender',
    `${team}: surrender reaches result`,
  );
  check(
    s.issue({ kind: 'hold', team, squads: [q.id] }) === 'wrongPhase',
    `${team}: result refuses command`,
  );
  s.restart();
  check(s.phase === 'deployment', `${team}: restart reaches deployment`);
}
// Controlled boundary fixtures: real rules and session transition, no result injection.
for (const reason of ['timeHeld', 'flagCaptured', 'collapse'] as const) {
  const s = make(0);
  s.startBattle();
  const w = s.world;
  if (reason === 'timeHeld') w.tick = 18000;
  if (reason === 'collapse')
    for (const q of w.squads)
      if (q.team === 1) {
        q.state = 'destroyed';
        q.n = 0;
      }
  if (reason === 'flagCaptured') {
    for (const q of w.squads) {
      q.x = q.team === 0 ? 100 : 512;
      q.z = q.team === 0 ? 100 : 300;
    }
    const q = w.squads.find((q) => q.team === 1)!;
    q.x = REED_FORD.rules.flag.x;
    q.z = REED_FORD.rules.flag.z;
    w.flag.progress = 59;
  }
  for (let i = 0; i < 40 && s.phase === 'battle'; i++) s.advance(50);
  console.log({ fixture: reason, phase: s.phase, time: w.time, tick: w.tick, result: s.result() });
  check(
    s.phase === 'result' && s.result()?.reason === reason,
    `${reason}: injected boundary reaches session result`,
  );
}
console.log(`Completed ${checks} checks. UI, natural play and GPU performance are not covered.`);
