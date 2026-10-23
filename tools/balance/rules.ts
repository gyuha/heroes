/**
 * GDD 공식의 기준 구현. src/sim 으로 그대로 옮길 수 있게 순수 함수로 둔다.
 */
import { COMBAT, TERRAIN } from './config.ts';

const DEG = 180 / Math.PI;

/** 진행 방향 경사각(도, 오르막 +)에 따른 이동 속도 계수. 통과 불가는 0. */
export function slopeSpeedFactor(dirSlopeDeg: number): number {
  if (Math.abs(dirSlopeDeg) > TERRAIN.impassableDeg) return 0;
  if (dirSlopeDeg >= 0) return Math.max(TERRAIN.upMin, 1 - TERRAIN.upPerDeg * dirSlopeDeg);
  const d = -dirSlopeDeg;
  if (d <= TERRAIN.downPeakDeg) return 1 + TERRAIN.downPerDeg * d;
  const peak = 1 + TERRAIN.downPerDeg * TERRAIN.downPeakDeg;
  return Math.max(TERRAIN.downMin, peak - TERRAIN.downDecelPerDeg * (d - TERRAIN.downPeakDeg));
}

/** 고도차(사수 높이 - 표적 높이, m)에 따른 최대 사거리(m). */
export function rangeWithHeight(baseRange: number, dh: number): number {
  const inner = 1 + (TERRAIN.heightRangeK * 4 * dh) / baseRange;
  const r = inner <= 0 ? 0 : (baseRange / 2) * (1 + Math.sqrt(inner));
  return Math.min(baseRange * TERRAIN.rangeMaxMult, Math.max(baseRange * TERRAIN.rangeMinMult, r));
}

/** 거리별 원거리 명중률(선형 보간). */
export function rangedHitChance(
  hitNear: number,
  hitFar: number,
  dist: number,
  range: number,
): number {
  const t = Math.min(1, Math.max(0, dist / range));
  return hitNear + (hitFar - hitNear) * t;
}

/** 근접 고저차 배율. aboveDeg = 공격자가 방어자를 내려다보는 각도(도). */
export function slopeMeleeMult(aboveDeg: number): number {
  const { perDeg, maxDeg } = COMBAT.slopeMelee;
  return 1 + perDeg * Math.max(-maxDeg, Math.min(maxDeg, aboveDeg));
}

/** 두 점 높이차와 수평거리로 내려다보는 각도(도). */
export function lookDownDeg(hFrom: number, hTo: number, horizDist: number): number {
  return Math.atan2(hFrom - hTo, Math.max(horizDist, 0.001)) * DEG;
}

/** 공격 가능한 열 수. */
export function attackRanks(reach: number, rankSpacing: number): number {
  return 1 + Math.max(0, Math.floor((reach - COMBAT.baseReach) / rankSpacing));
}

/** 피해 감소 합계 → 실제 배율. */
export function reductionMult(reduction: number): number {
  return 1 - Math.min(COMBAT.maxReduction, Math.max(0, reduction));
}

/** 돌격 충격 속도비 → 피해 배율(운동에너지 비례, 최소 속도 미만이면 0). */
export function chargeImpactMult(speedRatio: number, minSpeedRatio: number): number {
  if (speedRatio < minSpeedRatio) return 0;
  return speedRatio * speedRatio;
}

/**
 * 숲 LOS 예외(D-011): 시선의 양 끝점 중 하나에서 exemptDist 안에 있는 숲 칸은 장애물이 아니다.
 * t: 시선 위 진행 비율(0=보는 쪽, 1=보이는 쪽), dist: 시선 수평 거리(m).
 */
export function forestBlocksAt(t: number, dist: number, exemptDist: number): boolean {
  return Math.min(t, 1 - t) * dist > exemptDist;
}

/**
 * 직사 LOS. 높이 함수 h(t)(t: 0=사수, 1=표적, 사이 지형+장애물 높이)를 샘플링한다.
 * arcFactor=0 이면 직선, 1 이면 45° 탄도 근사(정점 높이 = 거리/4)의 곡사 판정.
 */
export function lineClear(
  shooterY: number,
  targetY: number,
  dist: number,
  obstacleAt: (t: number) => number,
  arcFactor: number,
  step = 2,
): boolean {
  const samples = Math.max(2, Math.ceil(dist / step));
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const lineY = shooterY + (targetY - shooterY) * t + arcFactor * dist * t * (1 - t);
    if (obstacleAt(t) > lineY) return false;
  }
  return true;
}
