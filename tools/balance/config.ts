/**
 * 밸런스 수치 원본(v0.1). docs/BALANCE.md 의 표는 이 파일과 같아야 한다.
 * 단위: 거리 m, 속도 m/s, 시간 초, 비율은 0~1 소수(문서에서는 %로 표기).
 *
 * 구현 시 src/sim 의 데이터 파일로 옮긴다(형식은 테크니컬 아키텍트와 확정).
 */

export type UnitTypeId = 'infantry' | 'spearman' | 'archer' | 'cavalry';

export interface RangedStats {
  damage: number; // 화살 1발 피해
  interval: number; // 발사 간격(초)
  range: number; // 평지 최대 사거리(m)
  minRange: number; // 최소 사거리(m)
  hitNear: number; // 0m 명중률
  hitFar: number; // 최대 사거리 명중률(그 사이 선형)
}

export interface ChargeStats {
  speed: number; // 돌격 속도(m/s)
  damage: number; // 충격 1회 피해(속도비 1.0 기준)
  targets: number; // 기수 1명이 충격을 주는 최대 병사 수
  runUp: number; // 최대 충격에 필요한 도움닫기 거리(m)
  minSpeedRatio: number; // 충돌 속도/돌격 속도가 이보다 낮으면 충격 없음
  cooldown: number; // 다음 돌격까지(초)
  startGap: number; // 목표와 이 간격 안에서 가속 시작(m)
}

export interface BraceStats {
  settleTime: number; // 고수 명령 후 정지 상태로 이 시간이 지나면 Brace
  impactReduction: number; // 정면 돌격 충격 피해 감소율
  counterDamage: number; // 충격 순간 앞 2열 창병이 첫 열 기수에게 주는 피해(속도비² 배)
}

export interface FootChargeStats {
  runUp: number; // 보너스에 필요한 달리기 거리(m)
  startGap: number; // 목표와 이 간격 안에서 달리기 시작(m)
  mult: number; // 접촉 후 근접 피해 배율
  duration: number; // 배율 지속(초)
  cooldown: number;
}
// 보병 돌격은 고수(방패벽·Brace) 중인 적의 정면에는 효과가 없다.

export interface UnitTypeStats {
  id: UnitTypeId;
  name: string;
  size: number; // 부대 기본 병사 수
  files: number; // 기본 횡대 열 수(가로 병사 수)
  fileSpacing: number; // 좌우 간격(m)
  rankSpacing: number; // 앞뒤 간격(m)
  hp: number;
  armor: number; // 피해 감소율(근접·원거리 공통)
  shield: number; // 정면 원거리 공격을 통째로 막을 확률. 근접은 피해 × (1 - shield × shieldMeleeFactor)
  meleeDamage: number;
  meleeInterval: number; // 근접 공격 간격(초)
  reach: number; // 근접 리치(m)
  walkSpeed: number;
  runSpeed: number;
  mounted: boolean;
  antiMounted: number; // 기병 대상 근접 피해 배율
  holdArmorBonus: number; // 고수 상태에서 정면 근접 피해 감소 추가(방패벽)
  ranged?: RangedStats;
  charge?: ChargeStats;
  footCharge?: FootChargeStats;
  brace?: BraceStats;
}

const FOOT_CHARGE: FootChargeStats = {
  runUp: 15,
  startGap: 40,
  mult: 1.25,
  duration: 8,
  cooldown: 30,
};

export const UNIT_TYPES: Record<UnitTypeId, UnitTypeStats> = {
  infantry: {
    id: 'infantry',
    name: '보병',
    size: 300,
    files: 40,
    fileSpacing: 1.4,
    rankSpacing: 1.6,
    hp: 100,
    armor: 0.3,
    shield: 0.55,
    meleeDamage: 16,
    meleeInterval: 1.5,
    reach: 1.5,
    walkSpeed: 2.0,
    runSpeed: 4.0,
    mounted: false,
    antiMounted: 1.0,
    holdArmorBonus: 0.1,
    footCharge: FOOT_CHARGE,
  },
  spearman: {
    id: 'spearman',
    name: '창병',
    size: 300,
    files: 40,
    fileSpacing: 1.4,
    rankSpacing: 1.6,
    hp: 90,
    armor: 0.2,
    shield: 0.3,
    meleeDamage: 9,
    meleeInterval: 1.5,
    reach: 3.5,
    walkSpeed: 2.0,
    runSpeed: 4.0,
    mounted: false,
    antiMounted: 1.5,
    holdArmorBonus: 0,
    brace: { settleTime: 3, impactReduction: 0.75, counterDamage: 120 },
    footCharge: FOOT_CHARGE,
  },
  archer: {
    id: 'archer',
    name: '궁수',
    size: 200,
    files: 40,
    fileSpacing: 1.6,
    rankSpacing: 1.8,
    hp: 80,
    armor: 0.1,
    shield: 0,
    meleeDamage: 9,
    meleeInterval: 1.5,
    reach: 1.5,
    walkSpeed: 2.2,
    runSpeed: 4.2,
    mounted: false,
    antiMounted: 1.0,
    holdArmorBonus: 0,
    ranged: { damage: 40, interval: 4, range: 160, minRange: 15, hitNear: 0.25, hitFar: 0.07 },
  },
  cavalry: {
    id: 'cavalry',
    name: '기병',
    size: 120,
    files: 30,
    fileSpacing: 2.2,
    rankSpacing: 3.5,
    hp: 200,
    armor: 0.3,
    shield: 0.2,
    meleeDamage: 20,
    meleeInterval: 1.5,
    reach: 2.0,
    walkSpeed: 3.5,
    runSpeed: 7.0,
    mounted: true,
    antiMounted: 1.0,
    holdArmorBonus: 0,
    charge: {
      speed: 9,
      damage: 80,
      targets: 2,
      runUp: 30,
      minSpeedRatio: 0.6,
      cooldown: 20,
      startGap: 120,
    },
  },
};

export const COMBAT = {
  meleeHitChance: 0.6,
  chargeHitChance: 0.8,
  shieldMeleeFactor: 0.3, // 근접에서 방패 효과는 원거리의 30%
  maxReduction: 0.8, // 피해 감소 합계 상한
  dirMult: { front: 1.0, flank: 1.3, rear: 1.6 },
  waverDamageMult: 0.85,
  /** 근접 고저차 보정: 1 + perDeg × clamp(내려다보는 각도°, -maxDeg, +maxDeg) */
  slopeMelee: { perDeg: 0.015, maxDeg: 15 },
  /** 공격 가능한 열 수 = 1 + floor((reach - baseReach) / rankSpacing) */
  baseReach: 1.5,
  contactGap: 0.6, // 이 간격 이하면 접촉(m)
  mountedTargetMult: 1.3, // 기병은 큰 표적: 화살 명중률 배율
  arcHitMult: 0.6, // 곡사(직사 LOS 차단) 명중률 배율
  arcShieldMult: 0.5, // 곡사는 방패 막기 확률 절반
  forestCoverHitMult: 0.5, // 숲 안 표적 명중률 배율
  looseHitMult: 0.5, // 산개 대형 표적 명중률 배율 (시뮬레이터 미적용)
  friendlyFireShare: 0.25, // 근접 중인 적을 명령 사격할 때 명중탄 중 아군에게 가는 비율 (시뮬레이터 미적용)
  disengageRearTime: 3, // 근접에서 이탈하는 부대는 이 시간 동안 후방 판정 (시뮬레이터 미적용)
};

/** 대형. 간격 배율은 병종 기본 간격에 곱한다. (시뮬레이터 미적용, 기본 횡대만 사용) */
export const FORMATIONS = {
  line: { name: '횡대', files: 'default', spacingMult: 1 },
  column: { name: '종대', files: 10, spacingMult: 1 },
  loose: { name: '산개', files: 'default', spacingMult: 2 },
  minFiles: 8,
  maxFiles: 80,
} as const;

/** 지휘관 부대: 기병 수치를 쓰는 친위대. 사기 고정(패주하지 않음). (시뮬레이터 미적용) */
export const COMMANDER = {
  guardType: 'cavalry' as UnitTypeId,
  size: 40,
};

export const MORALE = {
  start: 100,
  perLossPct: 1.2, // 시작 병력 1% 손실마다 감소
  meleePerSec: 0.25, // 근접 교전 중 초당 감소
  flankPerSec: 1.5, // 측면 공격받는 동안 초당 감소
  rearPerSec: 3.0, // 후방 공격받는 동안 초당 감소
  chargeShockFront: 4, // 정면 돌격 충격 순간 감소
  chargeShockFlank: 12, // 측면·후방 돌격 충격 순간 감소
  footChargeShockFront: 5, // 보병 돌격(고수하지 않은 적 정면) 충격 순간 감소
  nearbyRout: 8, // 반경 내 아군 부대 패주 시 감소
  nearbyRoutRadius: 80,
  commanderDeathNear: 25,
  commanderDeathFar: 10,
  commanderDeathRadius: 150,
  commanderDeathCapPenalty: 10, // 지휘관 전사 후 그 진영의 회복 상한 감소 (시뮬레이터 미적용)
  commanderAuraRadius: 60, // 지휘관 오라 (시뮬레이터 미적용)
  commanderAuraLossMult: 0.75,
  waver: 40, // 이 값 미만이면 동요(피해 ×0.85, 돌격 불가)
  rout: 20, // 이 값 이하면 패주
  recoverPerSec: 1.5, // 비교전·10초간 손실 없음일 때 회복
  recoverCapLossFactor: 0.5, // 회복 상한 = start - 손실% × 이 값
  rallySafeDist: 60, // 가장 가까운 적과 이 거리 이상이면 패주 중 회복
  rallyRecoverPerSec: 3,
  rallyMorale: 40, // 이 값에 도달하면 재집결
  rallyMinStrength: 0.25, // 시작 병력 대비 이 비율 이상 남아야 재집결 가능
  maxRallies: 1,
  routSpeedMult: 0.9, // 패주 속도 = 달리기 속도 × 이 값
  shatterDist: 250, // 재집결 불가 패주 부대가 적과 이만큼 떨어지면 전장 이탈(괴멸)
  pursuitTimeFoot: 12, // 추격 최대 시간(초), 이후 다른 적으로 표적 변경
  pursuitTimeMounted: 25,
};

export const TERRAIN = {
  /** 경사 이동 계수: 오르막 */
  upPerDeg: 0.025,
  upMin: 0.35,
  /** 내리막: downFlatDeg까지 가속, 이후 감속 */
  downPerDeg: 0.01,
  downPeakDeg: 12,
  downDecelPerDeg: 0.04,
  downMin: 0.4,
  impassableDeg: 30,
  /** 지형 종류별 이동 계수 [보병류, 기병] */
  typeSpeed: {
    grass: [1.0, 1.0],
    forest: [0.6, 0.4],
    sand: [1.1, 1.1],
    ford: [0.5, 0.4],
    bridge: [1.0, 1.0],
  },
  fordDamageMult: 0.85,
  /** 고도차 사거리: R = R0/2 × (1 + sqrt(1 + k × 4Δh / R0)), Δh는 사수-표적 높이(m) */
  heightRangeK: 2.0,
  rangeMinMult: 0.6,
  rangeMaxMult: 1.4,
  forestLosHeight: 12, // 직사 LOS 판정 시 숲 칸의 장애물 높이(m). 양 끝점 forestHideDist 안의 숲 칸은 제외(D-011)
  forestHideDist: 40, // 숲 안 부대는 이 거리 안의 적에게만 보인다 (시뮬레이터 미적용)
  visionRange: 350, // (시뮬레이터 미적용)
  eyeHeight: 1.7,
  revealTime: 10, // 숲 안 부대가 사격·교전하면 이 시간 동안 드러남 (시뮬레이터 미적용)
};
