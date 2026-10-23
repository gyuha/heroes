/**
 * 전투 공통 계산: 방향 판정, 대형 사각형 간격, 피해 배율·감소율, 병사 피해·사망 처리(GDD §5.2, §5.3).
 */
import { len2 } from '../math';
import type { Side } from '../api';
import { COMBAT, MORALE, TERRAIN } from '../data/balance';
import { SOLDIER } from '../data/simConfig';
import { lookDownDeg, reductionMult, slopeMeleeMult } from '../rules';
import type { Squad } from '../squad';
import { TerrainType } from '../terrain';
import type { World } from '../world';

const DEG = 180 / Math.PI;
const FRONT_MAX_DEG = 45;
const REAR_MIN_DEG = 135;

/**
 * 점 (px, pz)가 방어 부대 sq의 어느 방향인지(GDD §5.2). 부대 폭·깊이로 정규화한다.
 * 이탈 중인 부대는 접촉한 적에게 후방 판정을 받는다(GDD §5.6).
 */
export function sideOf(sq: Squad, px: number, pz: number): Side {
  if (sq.disengageTime > 0) return 'rear';
  const dx = px - sq.x;
  const dz = pz - sq.z;
  const s = Math.sin(sq.facing);
  const c = Math.cos(sq.facing);
  const f = dx * s + dz * c;
  const l = dx * c - dz * s;
  const ang = Math.atan2(Math.abs(l) / (sq.width / 2 + 1), f / (sq.depth / 2 + 1)) * DEG;
  if (ang <= FRONT_MAX_DEG) return 'front';
  if (ang >= REAR_MIN_DEG) return 'rear';
  return 'flank';
}

/** 병사 몸 기준 대형 사각형의 반폭·반깊이(맨 끝 병사 중심 + 몸 반지름). */
export function halfExtents(sq: Squad, out: Float64Array): void {
  const body = SOLDIER.bodyRadius[sq.typeIndex];
  const spread = sq.state === 'routing' ? SOLDIER.routSpreadMult : 1;
  out[0] = ((sq.curFiles - 1) / 2) * sq.fileSpacing * spread + body;
  out[1] = ((sq.ranks - 1) / 2) * sq.rankSpacing * spread + body;
}

const ea = new Float64Array(2);
const eb = new Float64Array(2);

/**
 * 두 부대 대형 사각형 사이 간격(m, 겹치면 음수). 분리축 정리로 네 축 중 가장 큰 분리 값을 쓴다.
 * a의 중심을 (ax, az)로 옮겨 본 값도 계산할 수 있다(이동 전 미리 보기).
 */
export function squadGap(a: Squad, b: Squad, ax = a.x, az = a.z): number {
  halfExtents(a, ea);
  halfExtents(b, eb);
  const dx = b.x - ax;
  const dz = b.z - az;
  const sa = Math.sin(a.facing);
  const ca = Math.cos(a.facing);
  const sb = Math.sin(b.facing);
  const cb = Math.cos(b.facing);
  let gap = -Infinity;
  // 축: a 정면, a 오른쪽, b 정면, b 오른쪽
  for (let k = 0; k < 4; k++) {
    const ux = k === 0 ? sa : k === 1 ? ca : k === 2 ? sb : cb;
    const uz = k === 0 ? ca : k === 1 ? -sa : k === 2 ? cb : -sb;
    const dist = Math.abs(dx * ux + dz * uz);
    const extA = ea[0] * Math.abs(ca * ux - sa * uz) + ea[1] * Math.abs(sa * ux + ca * uz);
    const extB = eb[0] * Math.abs(cb * ux - sb * uz) + eb[1] * Math.abs(sb * ux + cb * uz);
    const g = dist - extA - extB;
    if (g > gap) gap = g;
  }
  return gap;
}

/**
 * 근접·충격 피해 배율(GDD §5.3): 방향 × 고저차 × 대기병 × 상태(동요, 여울, 보병 돌격 보너스).
 * 고저차는 부대 중심 높이 기준. onFord = 공격하는 병사가 여울 칸에 서 있는가.
 */
export function meleeMult(att: Squad, def: Squad, side: Side, onFord: boolean): number {
  let m = COMBAT.dirMult[side];
  m *= heightMult(att, def);
  if (def.mounted) m *= att.stats.antiMounted;
  if (att.morale < MORALE.waver && !att.isCommander) m *= COMBAT.waverDamageMult;
  if (att.chargeBonusTime > 0 && att.stats.footCharge) m *= att.stats.footCharge.mult;
  if (onFord) m *= TERRAIN.fordDamageMult;
  return m;
}

/** 고저차 근접 배율(부대 중심 기준, GDD §5.3). */
export function heightMult(att: Squad, def: Squad): number {
  const d = len2(def.x - att.x, def.z - att.z);
  return slopeMeleeMult(lookDownDeg(att.groundY, def.groundY, d));
}

/** 피해 감소율 합계 → 배율. 근접 정면이면 방패 × 30% + 방패벽 보너스(GDD §5.3). */
export function meleeReduction(def: Squad, side: Side): number {
  let r = def.stats.armor;
  if (side === 'front') {
    r += def.stats.shield * COMBAT.shieldMeleeFactor;
    if (def.shieldWall) r += def.stats.holdArmorBonus;
  }
  return reductionMult(r);
}

export function soldierOnFord(world: World, i: number): boolean {
  return world.terrain.typeAt(world.units.x[i], world.units.z[i]) === TerrainType.Ford;
}

/**
 * 병사 i에게 피해를 준다. 죽으면 대형을 메우고 손실을 기록한다.
 * @returns 죽었으면 true
 */
export function damageSoldier(
  world: World,
  i: number,
  amount: number,
  by: Squad,
  fromArrow: boolean,
): boolean {
  const u = world.units;
  if (!u.alive[i]) return false;
  u.hp[i] -= amount;
  u.lastHitTick[i] = world.tick;
  if (u.hp[i] > 0) return false;
  u.hp[i] = 0;
  u.alive[i] = 0;
  u.deathTick[i] = world.tick;
  const sq = world.squads[u.squad[i]];
  const slot = sq.slotOfSoldier(i);
  if (slot >= 0) sq.removeAt(slot);
  sq.lossesThisTick++;
  if (fromArrow) sq.arrowLossesThisTick++;
  sq.lastLossTime = world.time;
  by.kills++;
  world.teamStats[by.team].kills++;
  return true;
}

/** 부대의 남은 병사를 모두 전장에서 지운다(괴멸로 이탈). 손실로 센다(GDD §4.5). */
export function removeSquadSoldiers(world: World, sq: Squad): void {
  const u = world.units;
  for (let k = 0; k < sq.n; k++) {
    const i = sq.members[k];
    u.alive[i] = 0;
    u.removed[i] = 1;
    sq.members[k] = -1;
  }
  sq.n = 0;
}
