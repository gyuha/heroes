/**
 * 승패·깃발 판정(GDD §3). 1초마다 판정한다.
 */
import { len2 } from '../math';
import type { BattleResult, EndReason, FlagState, TeamId, TeamResult, TeamStrength } from '../api';
import { SQUAD } from '../data/simConfig';
import { ROUT_CAUSES } from '../squad';
import type { World } from '../world';

/** 결과 화면 "패주 원인 상위 3개" */
const TOP_ROUT_CAUSES = 3;

export function teamStrength(world: World, team: TeamId): TeamStrength {
  let effective = 0;
  let routing = 0;
  for (const sq of world.squads) {
    if (sq.team !== team) continue;
    if (sq.state === 'ready') effective += sq.n;
    else if (sq.state === 'routing') routing += sq.n;
  }
  const start = world.teamStart[team];
  return { start, effective, routing, lost: start - effective - routing };
}

export function updateRules(world: World, dt: number): void {
  const ticksPerCheck = Math.max(1, Math.round(SQUAD.ruleInterval / dt));
  if (world.tick % ticksPerCheck !== 0) return;
  const step = ticksPerCheck * dt;
  const rules = world.scenario.rules;

  // 붕괴: 실질 병력 < 시작의 25%. 동시 붕괴는 무승부(GDD §3.1)
  const def = world.scenario.defender;
  const atk = world.scenario.attacker;
  const broken = [0, 1].map(
    (t) => teamStrength(world, t as TeamId).effective < world.teamStart[t] * rules.breakRatio,
  );
  if (broken[0] && broken[1]) return end(world, -1, 'draw');
  if (broken[def]) return end(world, atk, 'collapse');
  if (broken[atk]) return end(world, def, 'collapse');

  // 깃발(GDD §3.2)
  const f = rules.flag;
  let defenders = 0;
  let attackers = 0;
  for (const sq of world.squads) {
    if (!sq.ready) continue;
    if (len2(sq.x - f.x, sq.z - f.z) > f.radius) continue;
    if (sq.team === def) defenders++;
    else attackers++;
  }
  const flag = world.flag;
  const before: FlagState = flag.state;
  if (defenders > 0) {
    flag.state = 'defended';
    flag.progress = 0;
  } else if (attackers > 0) {
    flag.state = 'capturing';
    flag.progress += rules.captureRate * step;
  } else {
    flag.state = 'empty';
    flag.progress = Math.max(0, flag.progress - rules.decayRate * step);
  }
  if (flag.state !== before) {
    world.events.push({
      kind: 'flag',
      state: flag.state,
      progress: flag.progress,
      time: world.time,
      x: f.x,
      z: f.z,
    });
  }
  if (flag.progress >= rules.captureTime) return end(world, atk, 'flagCaptured');

  // 제한 시간과 연장전: 15:00에 진행도가 남아 있으면 0 또는 60이 될 때까지, 최대 60초
  if (world.time >= rules.timeLimit) {
    if (flag.progress > 0 && world.time < rules.timeLimit + rules.overtimeMax) {
      flag.overtime = true;
      return;
    }
    return end(world, def, 'timeHeld');
  }
}

export function end(world: World, winner: TeamId | -1, reason: EndReason): void {
  world.finish(buildResult(world, winner, reason));
}

export function buildResult(world: World, winner: TeamId | -1, reason: EndReason): BattleResult {
  const teams = [0, 1].map((t): TeamResult => {
    const s = teamStrength(world, t as TeamId);
    const st = world.teamStats[t];
    return {
      ...s,
      kills: st.kills,
      highGroundShare: st.meleeSoldierSec > 0 ? st.highGroundSoldierSec / st.meleeSoldierSec : 0,
      flankAttacks: st.flankAttacks,
      rearAttacks: st.rearAttacks,
    };
  }) as unknown as readonly [TeamResult, TeamResult];
  const routCauses = world.squads
    .filter((sq) => sq.routTime >= 0)
    .map((sq) => {
      const c = ROUT_CAUSES.indexOf(sq.routCause);
      return { squad: sq.id, cause: sq.routCause, moraleLost: sq.moraleLoss[c], time: sq.routTime };
    })
    .sort((a, b) => b.moraleLost - a.moraleLost || a.time - b.time)
    .slice(0, TOP_ROUT_CAUSES);
  return { winner, reason, time: world.time, teams, routCauses };
}
