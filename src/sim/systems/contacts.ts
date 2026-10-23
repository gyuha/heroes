/**
 * 부대 접촉 판정과 첫 접촉 순간의 돌격 충격·Brace 반격(GDD §5.4).
 * 접촉 = 두 적 부대의 병사 몸 기준 대형 사각형 간격이 COMBAT.contactGap 이하.
 */
import { len2 } from '../math';
import type { ChargeFailReason, Side } from '../api';
import { COMBAT, MORALE } from '../data/balance';
import { SOLDIER, SQUAD } from '../data/simConfig';
import { moveFactor } from '../terrainRules';
import { chargeImpactMult, reductionMult } from '../rules';
import { Cause, type Squad } from '../squad';
import { TerrainType } from '../terrain';
import type { World } from '../world';
import {
  damageSoldier,
  meleeMult,
  meleeReduction,
  sideOf,
  soldierOnFord,
  squadGap,
} from './combat';
import { addMoraleLoss } from './morale';

/** 떨어진 지 이 틱 안에 다시 붙으면 같은 교전으로 본다(3초) */
const REENGAGE_TICKS = 60;
/** 이만큼 넘게 떨어진 부대 쌍은 사각형 간격을 계산하지 않는다(m). */
const CONTACT_BROAD_PHASE = 200;
const UPHILL_FAIL_DEG = 3;
const MAX_IMPACT_CANDIDATES = 256;
const candidates = new Int32Array(MAX_IMPACT_CANDIDATES);

export function updateContacts(world: World): void {
  const { squads } = world;
  const S = squads.length;
  const prev = world.contactNow;
  world.contactNow = world.contactPrev;
  world.contactPrev = prev;
  const now = world.contactNow;
  now.fill(0);
  for (const sq of squads) {
    sq.contactCount = 0;
  }
  for (let a = 0; a < S; a++) {
    const A = squads[a];
    if (!A.alive) continue;
    for (let b = a + 1; b < S; b++) {
      const B = squads[b];
      if (!B.alive || B.team === A.team) continue;
      if (Math.abs(A.x - B.x) > CONTACT_BROAD_PHASE || Math.abs(A.z - B.z) > CONTACT_BROAD_PHASE) {
        continue;
      }
      if (squadGap(A, B) > COMBAT.contactGap) continue;
      now[a * S + b] = 1;
      A.contactCount++;
      B.contactCount++;
      // 간격이 접촉 경계에서 흔들려 잠깐 떨어졌다 다시 붙은 것은 새 접촉으로 보지 않는다
      // (충격 판정·교전 이벤트·측후방 공격 집계가 되풀이되지 않게).
      const last = world.contactLastTick[a * S + b];
      world.contactLastTick[a * S + b] = world.tick;
      if (!world.contactPrev[a * S + b] && world.tick - last > REENGAGE_TICKS)
        onFirstContact(world, A, B);
    }
  }
  for (const sq of squads) {
    const was = sq.engaged;
    sq.engaged = sq.contactCount > 0;
    if (sq.engaged && !was) {
      // 첫 공격 시점을 0~간격 사이로 흩어 병사들이 동시에 치지 않게 한다(GDD §5.1).
      const u = world.units;
      for (let k = 0; k < sq.n; k++) {
        u.cooldown[sq.members[k]] = world.rng.next() * sq.stats.meleeInterval;
      }
    }
    if (sq.engaged) world.vision?.markExposed(sq.id, world.time);
  }
}

/** a, b가 이번 틱에 처음 닿았다. */
function onFirstContact(world: World, a: Squad, b: Squad): void {
  const sideOnB = sideOf(b, a.x, a.z);
  const sideOnA = sideOf(a, b.x, b.z);
  world.events.push({
    kind: 'engage',
    squad: a.id,
    enemy: b.id,
    side: sideOnB,
    time: world.time,
    x: (a.x + b.x) / 2,
    z: (a.z + b.z) / 2,
  });
  countFlankAttack(world, a, sideOnB);
  countFlankAttack(world, b, sideOnA);
  resolveImpact(world, a, b, sideOnB);
  resolveImpact(world, b, a, sideOnA);
}

function countFlankAttack(world: World, att: Squad, side: Side): void {
  if (side === 'flank') world.teamStats[att.team].flankAttacks++;
  else if (side === 'rear') world.teamStats[att.team].rearAttacks++;
}

/** 돌격 속도가 모자란 원인(로그용, GDD §6.5). */
function failReason(world: World, att: Squad): ChargeFailReason {
  const k = world.terrain.typeAt(att.x, att.z);
  if (k === TerrainType.Forest) return 'forest';
  if (k === TerrainType.Ford) return 'ford';
  const s = Math.sin(att.facing);
  const c = Math.cos(att.facing);
  const f = moveFactor(world.terrain, att.x, att.z, s, c, att.mounted);
  const flat = moveFactor(world.terrain, att.x, att.z, 0, 0, att.mounted);
  if (f < flat && slopeDeg(world, att) > UPHILL_FAIL_DEG) return 'uphill';
  return 'shortRunUp';
}

const grad = new Float32Array(2);
function slopeDeg(world: World, sq: Squad): number {
  world.terrain.gradientAt(sq.x, sq.z, grad);
  return (Math.atan(grad[0] * Math.sin(sq.facing) + grad[1] * Math.cos(sq.facing)) * 180) / Math.PI;
}

/** att가 def에 처음 닿은 순간의 충격(보병 돌격·기병 돌격·Brace 반격). */
function resolveImpact(world: World, att: Squad, def: Squad, side: Side): void {
  if (!att.ready) return;
  const fc = att.stats.footCharge;
  if (fc && (att.runDist > 0 || att.order.charge)) {
    const blocked = side === 'front' && def.holding;
    if (att.runDist >= fc.runUp && !blocked) {
      att.chargeBonusTime = fc.duration;
      addMoraleLoss(
        world,
        def,
        side === 'front' ? MORALE.footChargeShockFront : MORALE.chargeShockFlank,
        Cause.Charge,
      );
    } else if (att.order.charge) {
      world.events.pushThrottled(
        {
          kind: 'chargeFailed',
          squad: att.id,
          target: def.id,
          reason: blocked ? 'bracedFront' : failReason(world, att),
          time: world.time,
          x: att.x,
          z: att.z,
        },
        1,
      );
    }
    if (att.runDist >= fc.runUp) att.chargeCooldown = fc.cooldown;
    att.runDist = 0;
    att.order.charge = false;
  }
  const ch = att.stats.charge;
  if (!ch || !att.charging) return;
  att.charging = false;
  att.chargeRequested = false;
  att.chargeCooldown = ch.cooldown;
  const ratio = att.travelSpeed / ch.speed;
  const mult = chargeImpactMult(ratio, ch.minSpeedRatio);
  if (mult === 0) {
    world.events.pushThrottled(
      {
        kind: 'chargeFailed',
        squad: att.id,
        target: def.id,
        reason: failReason(world, att),
        time: world.time,
        x: att.x,
        z: att.z,
      },
      0,
    );
    return;
  }
  const braced = def.braced && side === 'front';
  const kills = riderImpacts(world, att, def, ch.damage * mult, braced, side);
  addMoraleLoss(
    world,
    def,
    side === 'front' ? MORALE.chargeShockFront : MORALE.chargeShockFlank,
    Cause.Charge,
  );
  if (braced) braceCounter(world, def, att, mult);
  world.events.push({
    kind: 'chargeImpact',
    squad: att.id,
    target: def.id,
    side,
    speedRatio: ratio,
    braced,
    kills,
    time: world.time,
    x: (att.x + def.x) / 2,
    z: (att.z + def.z) / 2,
  });
}

/**
 * 기병 충격: 앞 2행 기수가 각자 정면 반원 안의 적 병사를 최대 2명까지 친다(명중 80%, GDD §5.4).
 * 둘째 행 기수는 앞 기수 뒤에 있으므로 행 간격만큼 더 먼 적까지 닿는 것으로 본다.
 */
function riderImpacts(
  world: World,
  att: Squad,
  def: Squad,
  baseDamage: number,
  braced: boolean,
  side: Side,
): number {
  const u = world.units;
  const F = att.curFiles;
  const riders = Math.min(att.n, F * SQUAD.chargeImpactRanks);
  const fx = Math.sin(att.facing);
  const fz = Math.cos(att.facing);
  const targets = att.stats.charge!.targets;
  let kills = 0;
  for (let k = 0; k < riders; k++) {
    const r = att.members[k];
    if (r < 0 || !u.alive[r]) continue;
    const rank = Math.floor(k / F);
    const reach = SQUAD.chargeImpactReach + rank * att.rankSpacing;
    const cnt = world.grid.query(
      u.x,
      u.z,
      u.x[r],
      u.z[r],
      reach + SOLDIER.bodyRadius[def.typeIndex],
      candidates,
    );
    let b0 = -1;
    let d0 = Infinity;
    let b1 = -1;
    let d1 = Infinity;
    for (let c = 0; c < cnt; c++) {
      const j = candidates[c];
      if (u.squad[j] !== def.id || !u.alive[j]) continue;
      const dx = u.x[j] - u.x[r];
      const dz = u.z[j] - u.z[r];
      if (dx * fx + dz * fz <= 0) continue;
      const d = len2(dx, dz) - SOLDIER.bodyRadius[def.typeIndex];
      if (d > reach) continue;
      if (d < d0) {
        b1 = b0;
        d1 = d0;
        b0 = j;
        d0 = d;
      } else if (d < d1) {
        b1 = j;
        d1 = d;
      }
    }
    for (let t = 0; t < targets; t++) {
      const j = t === 0 ? b0 : b1;
      if (j < 0 || world.rng.next() >= COMBAT.chargeHitChance) continue;
      let dmg =
        baseDamage * meleeMult(att, def, side, soldierOnFord(world, r)) * meleeReduction(def, side);
      if (braced) dmg *= 1 - def.stats.brace!.impactReduction;
      u.lastAttackTick[r] = world.tick;
      if (damageSoldier(world, j, dmg, att, false)) kills++;
    }
  }
  return kills;
}

/**
 * Brace 반격: 앞 2행 창병이 각자 리치 안의 첫 행 기수를 친다. 피해 = 120 × 속도비² × (1 − 기병 감소율),
 * 명중 80%. 기병 속도는 0이 된다(GDD §5.4).
 */
function braceCounter(world: World, def: Squad, att: Squad, mult: number): void {
  const u = world.units;
  const F = def.curFiles;
  const spears = Math.min(def.n, F * SQUAD.chargeImpactRanks);
  const counter =
    def.stats.brace!.counterDamage *
    mult *
    reductionMult(att.stats.armor + att.stats.shield * COMBAT.shieldMeleeFactor);
  const reach = def.stats.reach + SOLDIER.bodyRadius[att.typeIndex];
  const firstRank = att.curFiles;
  for (let k = 0; k < spears; k++) {
    const s = def.members[k];
    if (s < 0 || !u.alive[s]) continue;
    const cnt = world.grid.query(u.x, u.z, u.x[s], u.z[s], reach, candidates);
    let best = -1;
    let bd = Infinity;
    for (let c = 0; c < cnt; c++) {
      const j = candidates[c];
      if (u.squad[j] !== att.id || !u.alive[j]) continue;
      const slot = att.slotOfSoldier(j);
      if (slot < 0 || slot >= firstRank) continue;
      const d = len2(u.x[j] - u.x[s], u.z[j] - u.z[s]);
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    if (best < 0 || world.rng.next() >= COMBAT.chargeHitChance) continue;
    u.lastAttackTick[s] = world.tick;
    damageSoldier(world, best, counter, def, false);
  }
  att.speed = 0;
  att.travelSpeed = 0;
  att.baseSpeed = 0;
}
