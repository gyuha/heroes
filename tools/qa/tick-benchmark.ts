// Simulation-only synthetic population scaling; never an FPS/GPU or real-time soak test.
import { createBattle } from '../../src/sim/battleSetup';
import { createReedFord } from '../../src/sim/map/reedFord';
import { Pathfinder } from '../../src/sim/map/pathfinder';
import { REED_FORD } from '../../src/sim/scenarios/reedFord';
import { UNIT_TYPES, COMMANDER } from '../../src/sim/data/balance';
const map = createReedFord();
for (const target of [2500, 5000, 9560, 10000, 12000]) {
  const scenario = {
    ...REED_FORD,
    teams: REED_FORD.teams.map((team) =>
      team.map((q) => ({
        ...q,
        size: Math.max(
          1,
          Math.round(
            ((q.size ?? (q.commander ? COMMANDER.size : UNIT_TYPES[q.type].size)) * target) / 9560,
          ),
        ),
      })),
    ),
  };
  const w = createBattle({
    map,
    pathfinder: new Pathfinder(map),
    scenario: scenario as typeof REED_FORD,
    seed: 11,
    aiTeams: [0, 1],
    attackPlan: 'A',
  });
  w.startBattle();
  const times: number[] = [];
  for (let i = 0; i < 4800 && w.phase === 'battle'; i++) {
    const start = performance.now();
    w.step(0.05);
    const ms = performance.now() - start;
    w.drainEvents();
    if (i >= 200) times.push(ms);
  }
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      target,
      actual: w.units.count,
      simSeconds: w.time,
      samples: times.length,
      avg: times.reduce((a, b) => a + b, 0) / times.length,
      p95: times[Math.floor(times.length * 0.95)],
      p99: times[Math.floor(times.length * 0.99)],
      max: times.at(-1),
    }),
  );
}
