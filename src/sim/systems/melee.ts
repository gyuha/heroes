/**
 * 병사 단위 근접(GDD §5.1): 리치 안 적 병사를 meleeInterval마다 친다. 명중 60%, 피해는 §5.3 공식.
 * 리치는 공격자 중심에서 상대 몸 표면까지 잰다. 이 기하 덕분에 앞 행끼리 맞닿은 대형에서
 * 보병·궁수·기병은 1행, 창병(리치 3.5m)은 2행까지만 닿는다(GDD 표와 같은 결과).
 */
import { len2 } from '../math';
import { COMBAT } from '../data/balance';
import { SOLDIER, SQUAD } from '../data/simConfig';
import type { Squad } from '../squad';
import type { World } from '../world';
import { damageSoldier, meleeMult, meleeReduction, sideOf, soldierOnFord } from './combat';

const MAX_CANDIDATES = 64;
const candidates = new Int32Array(MAX_CANDIDATES);
const MAX_BODY = Math.max(...SOLDIER.bodyRadius);
/** 같은 거리면 자기 정면에 가까운 적을 고른다(GDD §5.1): 정면 쪽 적의 거리를 이만큼 줄여 본다(m) */
const FRONT_PREFERENCE = 0.3;

export function updateMelee(world: World, dt: number): void {
  const squads = world.squads;
  for (let s = 0; s < squads.length; s++) {
    const att = squads[s];
    if (att.ready && att.engaged && att.disengageTime <= 0) meleeSquad(world, att, dt);
  }
}

/**
 * 부대 하나의 근접 공격. 틱마다 한 번 불리는 큰 루프 대신 부대 단위 작은 함수로 둬 V8이 정상 최적화하게
 * 한다(루프 중간 최적화·해제 반복과 실수 박싱 가비지 방지, ARCHITECTURE §11.6-11).
 */
function meleeSquad(world: World, att: Squad, dt: number): void {
  const u = world.units;
  const cooldown = u.cooldown;
  const reach = att.stats.reach;
  const interval = att.stats.meleeInterval;
  const members = att.members;
  for (let k = 0; k < att.n; k++) {
    const i = members[k];
    cooldown[i] -= dt;
    if (cooldown[i] > 0) continue;
    const best = findMeleeTarget(world, att.team, i, reach);
    if (best < 0) {
      cooldown[i] = SOLDIER.meleeRetry;
      continue;
    }
    cooldown[i] = interval;
    u.lastAttackTick[i] = world.tick;
    u.heading[i] = Math.atan2(u.x[best] - u.x[i], u.z[best] - u.z[i]);
    if (world.rng.next() >= COMBAT.meleeHitChance) continue;
    strike(world, att, i, best);
  }
}

/** 병사 i의 리치 안 적 병사 중 가장 가까운(정면 우선) 병사, 없으면 −1. */
function findMeleeTarget(world: World, team: number, i: number, reach: number): number {
  const u = world.units;
  const xs = u.x;
  const zs = u.z;
  const px = xs[i];
  const pz = zs[i];
  const cnt = world.grid.query(xs, zs, px, pz, reach + MAX_BODY, candidates);
  const hx = Math.sin(u.heading[i]);
  const hz = Math.cos(u.heading[i]);
  let best = -1;
  let bestScore = Infinity;
  for (let c = 0; c < cnt; c++) {
    const j = candidates[c];
    if (u.team[j] === team || !u.alive[j]) continue;
    const dx = xs[j] - px;
    const dz = zs[j] - pz;
    const d = len2(dx, dz);
    if (d - SOLDIER.bodyRadius[u.type[j]] > reach) continue;
    const score = d - (FRONT_PREFERENCE * (dx * hx + dz * hz)) / Math.max(d, 1e-6);
    if (score < bestScore) {
      bestScore = score;
      best = j;
    }
  }
  return best;
}

/** 명중한 근접 공격 1회: 방향 판정, 측후방 사기 타이머, 로그, 피해. */
function strike(world: World, att: Squad, i: number, best: number): void {
  const def = world.squads[world.units.squad[best]];
  // 방향은 공격하는 부대 중심 기준(디자이너 시뮬레이터와 같음). 병사 위치로 판정하면 정면으로 맞붙은
  // 두 횡대의 양 끝 병사가 45° 경계를 넘나들어 정면 교전에도 측면 사기 감소가 계속 걸린다.
  const side = sideOf(def, att.x, att.z);
  if (side === 'flank') def.flankTimer = SQUAD.attackedWindow;
  else if (side === 'rear') def.rearTimer = SQUAD.attackedWindow;
  if (side !== 'front' && def.ready) {
    world.events.pushThrottled(
      { kind: 'attacked', squad: def.id, side, time: world.time, x: def.x, z: def.z },
      side === 'flank' ? 0 : 1,
    );
  }
  const dmg =
    att.stats.meleeDamage *
    meleeMult(att, def, side, soldierOnFord(world, i)) *
    meleeReduction(def, side);
  damageSoldier(world, best, dmg, att, false);
}
