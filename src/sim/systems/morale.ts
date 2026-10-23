/**
 * 사기·패주·재집결·괴멸·지휘관(GDD §4.4~§4.6). 수치는 BALANCE §4(MORALE).
 */
import { len2 } from '../math';
import { MORALE } from '../data/balance';
import { Cause, ROUT_CAUSES, type Squad } from '../squad';
import type { World } from '../world';
import { heightMult, removeSquadSoldiers } from './combat';

/** 아군 지휘관 부대가 60m 안에 있으면 모든 사기 감소가 ×0.75(GDD §4.6). */
function auraMult(world: World, sq: Squad): number {
  for (const c of world.squads) {
    if (!c.isCommander || c.team !== sq.team || !c.alive || c === sq) continue;
    if (len2(c.x - sq.x, c.z - sq.z) <= MORALE.commanderAuraRadius) {
      return MORALE.commanderAuraLossMult;
    }
  }
  return 1;
}

/** 사기 감소를 원인과 함께 기록한다. 지휘관 부대는 사기가 고정이다. */
export function addMoraleLoss(world: World, sq: Squad, amount: number, cause: number): void {
  if (sq.isCommander || !sq.alive || amount <= 0) return;
  const a = amount * auraMult(world, sq);
  sq.morale -= a;
  sq.moraleLoss[cause] += a;
}

/** 회복 상한 = 100 − 손실률(%) × 0.5, 지휘관을 잃은 진영은 추가로 −10(GDD §4.4, §4.6). */
function recoverCap(world: World, sq: Squad): number {
  const lossPct = 100 * (1 - sq.n / sq.startCount);
  let cap = MORALE.start - lossPct * MORALE.recoverCapLossFactor;
  if (world.teamStats[sq.team].commanderDead) cap -= MORALE.commanderDeathCapPenalty;
  return cap;
}

export function updateMorale(world: World, dt: number): void {
  for (const sq of world.squads) {
    if (sq.state === 'destroyed') continue;
    if (sq.n === 0) {
      destroy(world, sq, 'wiped');
      continue;
    }
    if (sq.lossesThisTick > 0) {
      const amount = (MORALE.perLossPct * 100 * sq.lossesThisTick) / sq.startCount;
      const arrowShare = sq.arrowLossesThisTick / sq.lossesThisTick;
      addMoraleLoss(world, sq, amount * (1 - arrowShare), Cause.Losses);
      addMoraleLoss(world, sq, amount * arrowShare, Cause.Arrows);
    }
    sq.lossesThisTick = 0;
    sq.arrowLossesThisTick = 0;
    if (sq.state === 'ready') updateReady(world, sq, dt);
    else updateRouting(world, sq, dt);
  }
}

function updateReady(world: World, sq: Squad, dt: number): void {
  if (sq.engaged) {
    sq.engagedTime += dt;
    addMoraleLoss(world, sq, MORALE.meleePerSec * dt, Cause.Melee);
    recordHeight(world, sq, dt);
  } else {
    sq.engagedTime = 0;
    sq.heightBonusPct = 0;
  }
  if (sq.rearTimer > 0) addMoraleLoss(world, sq, MORALE.rearPerSec * dt, Cause.Rear);
  else if (sq.flankTimer > 0) addMoraleLoss(world, sq, MORALE.flankPerSec * dt, Cause.Flank);
  if (!sq.engaged && world.time - sq.lastLossTime > RECOVER_DELAY) {
    const cap = recoverCap(world, sq);
    if (sq.morale < cap) sq.morale = Math.min(cap, sq.morale + MORALE.recoverPerSec * dt);
  }
  if (!sq.isCommander && sq.morale <= MORALE.rout) startRout(world, sq);
}
/** 회복은 최근 이 시간 동안 손실이 없어야 한다(초). */
const RECOVER_DELAY = 10;

/** 교전 중 고저차 보너스(카드 "고지 +N%")와 지형 활용 통계. */
function recordHeight(world: World, sq: Squad, dt: number): void {
  let best: Squad | null = null;
  let bd = Infinity;
  for (const e of world.squads) {
    if (e.team === sq.team || !e.alive || !isContact(world, sq, e)) continue;
    const d = len2(e.x - sq.x, e.z - sq.z);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  if (!best) return;
  const m = heightMult(sq, best);
  sq.heightBonusPct = Math.round((m - 1) * 100);
  const st = world.teamStats[sq.team];
  st.meleeSoldierSec += sq.n * dt;
  if (m > 1) st.highGroundSoldierSec += sq.n * dt;
  if (sq.heightBonusPct >= HIGH_GROUND_LOG_PCT) {
    world.events.pushThrottled({
      kind: 'highGround',
      squad: sq.id,
      bonusPct: sq.heightBonusPct,
      time: world.time,
      x: sq.x,
      z: sq.z,
    });
  }
}
const HIGH_GROUND_LOG_PCT = 5;

export function isContact(world: World, a: Squad, b: Squad): boolean {
  const S = world.squads.length;
  return a.id < b.id
    ? world.contactNow[a.id * S + b.id] === 1
    : world.contactNow[b.id * S + a.id] === 1;
}

function nearestEnemyDist(world: World, sq: Squad): number {
  let bd = Infinity;
  for (const e of world.squads) {
    if (e.team === sq.team || !e.alive) continue;
    const d = len2(e.x - sq.x, e.z - sq.z);
    if (d < bd) bd = d;
  }
  return bd;
}

function updateRouting(world: World, sq: Squad, dt: number): void {
  const dist = nearestEnemyDist(world, sq);
  const canRally =
    sq.rallies < MORALE.maxRallies && sq.n / sq.startCount >= MORALE.rallyMinStrength;
  if (dist >= MORALE.rallySafeDist) {
    sq.morale = Math.min(MORALE.rallyMorale, sq.morale + MORALE.rallyRecoverPerSec * dt);
    if (canRally && sq.morale >= MORALE.rallyMorale) {
      sq.state = 'ready';
      sq.rallies++;
      sq.order.kind = 'hold';
      sq.order.target = -1;
      sq.stillTime = 0;
      world.events.push({ kind: 'rally', squad: sq.id, time: world.time, x: sq.x, z: sq.z });
      return;
    }
    if (!canRally && dist > MORALE.shatterDist) {
      destroy(world, sq, 'fled');
      return;
    }
  }
  if (!world.inPlayArea(sq.x, sq.z)) destroy(world, sq, 'edge');
}

export function startRout(world: World, sq: Squad): void {
  sq.state = 'routing';
  sq.routTime = world.time;
  sq.charging = false;
  sq.chargeRequested = false;
  sq.runDist = 0;
  sq.disengageTime = 0;
  sq.morale = Math.min(sq.morale, MORALE.rout);
  sq.order.kind = 'none';
  sq.order.target = -1;
  let worst = 0;
  for (let c = 1; c < ROUT_CAUSES.length; c++)
    if (sq.moraleLoss[c] > sq.moraleLoss[worst]) worst = c;
  sq.routCause = ROUT_CAUSES[worst];
  world.events.push({
    kind: 'rout',
    squad: sq.id,
    cause: sq.routCause,
    time: world.time,
    x: sq.x,
    z: sq.z,
  });
  for (const o of world.squads) {
    if (o === sq || o.team !== sq.team || o.state !== 'ready') continue;
    if (len2(o.x - sq.x, o.z - sq.z) <= MORALE.nearbyRoutRadius) {
      addMoraleLoss(world, o, MORALE.nearbyRout, Cause.NearbyRout);
    }
  }
}

function destroy(world: World, sq: Squad, reason: 'wiped' | 'fled' | 'edge'): void {
  sq.state = 'destroyed';
  if (sq.n > 0) removeSquadSoldiers(world, sq);
  world.events.push({
    kind: 'destroyed',
    squad: sq.id,
    reason,
    time: world.time,
    x: sq.x,
    z: sq.z,
  });
  if (sq.isCommander) commanderKilled(world, sq);
}

/** 지휘관 전사: 150m 안 −25, 밖 −10, 회복 상한 −10(GDD §4.6). 전투는 계속된다. */
function commanderKilled(world: World, cmd: Squad): void {
  world.teamStats[cmd.team].commanderDead = true;
  world.events.push({
    kind: 'commanderKilled',
    team: cmd.team,
    time: world.time,
    x: cmd.x,
    z: cmd.z,
  });
  for (const o of world.squads) {
    if (o.team !== cmd.team || o.state !== 'ready' || o === cmd) continue;
    const near = len2(o.x - cmd.x, o.z - cmd.z) <= MORALE.commanderDeathRadius;
    // 지휘관이 없으니 오라도 없다: addMoraleLoss의 오라 검사는 죽은 지휘관을 건너뛴다.
    addMoraleLoss(
      world,
      o,
      near ? MORALE.commanderDeathNear : MORALE.commanderDeathFar,
      Cause.CommanderDeath,
    );
  }
}
