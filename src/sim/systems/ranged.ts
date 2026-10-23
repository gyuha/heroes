/**
 * 원거리(GDD §5.5). 표적은 부대 단위로 1초마다 고르고(ARCHITECTURE §11.6-5), 발사·명중은 병사 단위다.
 * 사수는 interval마다 1발, 명중률은 거리 선형 × 배율, 정면에서 맞으면 방패 막기 확률.
 */
import { len2 } from '../math';
import { COMBAT } from '../data/balance';
import { SQUAD } from '../data/simConfig';
import { fireLine } from '../terrainRules';
import { rangeWithHeight, rangedHitChance, reductionMult } from '../rules';
import type { Squad } from '../squad';
import { TerrainType } from '../terrain';
import type { World } from '../world';
import { damageSoldier, sideOf } from './combat';
import { isContact } from './morale';

/** 사격하려면 이만큼 정지해 있어야 한다(초, GDD §5.5). */
const STILL_BEFORE_FIRE = 1;

export function updateRanged(world: World, dt: number): void {
  for (const sq of world.squads) {
    const r = sq.stats.ranged;
    if (!r) continue;
    if (!sq.ready || sq.engaged || sq.stillTime < STILL_BEFORE_FIRE) {
      sq.fireTarget = -1;
      continue;
    }
    sq.retargetTimer -= dt;
    if (sq.retargetTimer <= 0 || !validTarget(world, sq, sq.fireTarget)) {
      sq.retargetTimer = SQUAD.rangedRetarget;
      const before = sq.fireTarget;
      chooseTarget(world, sq);
      if (sq.fireTarget >= 0 && sq.fireTarget !== before) staggerVolley(world, sq, r.interval);
    }
    if (sq.fireTarget >= 0) fire(world, sq, dt);
  }
}

function validTarget(world: World, sq: Squad, id: number): boolean {
  if (id < 0) return false;
  const t = world.squads[id];
  return t.alive && world.isVisible(id, sq.team);
}

/** 발사 시점을 0~간격에 흩는다(일제 사격처럼 한 틱에 몰리지 않게). */
function staggerVolley(world: World, sq: Squad, interval: number): void {
  const u = world.units;
  for (let k = 0; k < sq.n; k++) u.cooldown[sq.members[k]] = world.rng.next() * interval;
}

/** 명령 표적이 사거리 안이면 그 부대, 아니면 사거리 안 가장 가까운 보이는 적(아군과 근접 중이면 제외). */
function chooseTarget(world: World, sq: Squad): void {
  const r = sq.stats.ranged!;
  const ordered = sq.order.kind === 'attack' ? sq.order.target : -1;
  sq.fireTarget = -1;
  let bestD = Infinity;
  for (const t of world.squads) {
    if (t.team === sq.team || !t.alive || !world.isVisible(t.id, sq.team)) continue;
    const d = len2(t.x - sq.x, t.z - sq.z);
    const dh = sq.groundY - t.groundY;
    const R = rangeWithHeight(r.range, dh);
    if (t.id === ordered && d > R) {
      world.events.pushThrottled({
        kind: 'outOfRange',
        squad: sq.id,
        target: t.id,
        heightDiff: dh,
        range: R,
        time: world.time,
        x: sq.x,
        z: sq.z,
      });
    }
    if (d > R || d < r.minRange) continue;
    if (t.id !== ordered && t.engaged) continue;
    const line = fireLine(world.terrain, sq.x, sq.z, t.x, t.z);
    if (line === 'blocked') continue;
    const score = t.id === ordered ? -1 : d;
    if (score < bestD) {
      bestD = score;
      sq.fireTarget = t.id;
      sq.fireArc = line === 'arc';
    }
  }
}

function fire(world: World, sq: Squad, dt: number): void {
  const u = world.units;
  const r = sq.stats.ranged!;
  const t = world.squads[sq.fireTarget];
  const d = len2(t.x - sq.x, t.z - sq.z);
  const R = rangeWithHeight(r.range, sq.groundY - t.groundY);
  let p = rangedHitChance(r.hitNear, r.hitFar, d, R);
  if (sq.fireArc) p *= COMBAT.arcHitMult;
  if (t.mounted) p *= COMBAT.mountedTargetMult;
  if (world.terrain.typeAt(t.x, t.z) === TerrainType.Forest) p *= COMBAT.forestCoverHitMult;
  if (t.formation === 'loose') p *= COMBAT.looseHitMult;
  const ordered = sq.order.kind === 'attack' && sq.order.target === t.id;
  const friendlyRisk = ordered && t.engaged;
  const heading = Math.atan2(t.x - sq.x, t.z - sq.z);
  let fired = false;
  for (let k = 0; k < sq.n; k++) {
    const i = sq.members[k];
    u.cooldown[i] -= dt;
    if (u.cooldown[i] > 0) continue;
    u.cooldown[i] += r.interval;
    u.lastAttackTick[i] = world.tick;
    u.heading[i] = heading;
    fired = true;
    if (world.rng.next() >= p) continue;
    let victimSquad = t;
    if (friendlyRisk && world.rng.next() < COMBAT.friendlyFireShare) {
      const ally = alliedInContact(world, t, sq.team);
      if (ally) victimSquad = ally;
    }
    if (victimSquad.n <= 0) continue;
    const side = sideOf(victimSquad, sq.x, sq.z);
    if (side === 'front') {
      const block = victimSquad.stats.shield * (sq.fireArc ? COMBAT.arcShieldMult : 1);
      if (world.rng.next() < block) continue;
    }
    const victim = victimSquad.members[Math.floor(world.rng.next() * victimSquad.n)];
    damageSoldier(world, victim, r.damage * reductionMult(victimSquad.stats.armor), sq, true);
  }
  if (fired) world.vision?.markExposed(sq.id, world.time);
}

/** 표적과 근접 중인 사수 진영 부대(오사 대상). */
function alliedInContact(world: World, target: Squad, team: number): Squad | null {
  for (const s of world.squads) {
    if (s.team === team && s.alive && isContact(world, s, target)) return s;
  }
  return null;
}
