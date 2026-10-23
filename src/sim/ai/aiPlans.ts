/**
 * "갈대 여울" AI 계획 데이터(GDD §8.3 v0.3). 좌표는 월드 m, +x = 서쪽, +z = 북쪽(D-012). 경로 탐색이 실제 길을 찾으므로 경유점은
 * "어느 도하 지점으로 건널지"를 정하는 데만 쓴다.
 */
export type AttackPlanId = 'A' | 'B' | 'C';
export const ATTACK_PLANS: readonly AttackPlanId[] = ['A', 'B', 'C'];

/** 공격 부대의 역할: 돌파(경로 끝까지 가며 싸움), 견제(도하 지점 북쪽에서 버팀), 예비, 기병 우회, 궁수 진지 */
export type Stance = 'assault' | 'feint' | 'reserve' | 'flank' | 'archer' | 'commander';

type Pt = readonly [number, number];

/** 도하 경로(북 → 남). 마지막 점 다음은 깃발로 간다. */
export const LANES: Record<'eastBridge' | 'ford' | 'westBridge' | 'westField', readonly Pt[]> = {
  eastBridge: [
    [240, 660],
    [241, 570],
    [262, 540],
  ],
  ford: [
    [520, 660],
    [520, 578],
    [500, 540],
  ],
  westBridge: [
    [800, 660],
    [801, 545],
    [770, 470],
    [620, 445],
  ],
  westField: [
    [800, 660],
    [801, 545],
    [935, 470],
    [935, 330],
    [640, 360],
  ],
};
export type LaneId = keyof typeof LANES;

/**
 * 경로마다 집결 경유점 번호. 돌파 부대는 강을 건넌 뒤 여기서 같은 경로 부대를 기다렸다가 함께 공격한다
 * (도착하는 대로 한 부대씩 들어가 각개 격파당하지 않게). -1 = 집결 없음.
 */
/** 경로의 도하 지점 경유점 번호. 이 점만은 옆으로 벌리지 않고 한 줄로 지난다. */
export const LANE_CROSSING = 1;
export const LANE_RALLY: Record<LaneId, number> = {
  eastBridge: 2,
  ford: 2,
  westBridge: 2,
  westField: -1,
};

/** 공격 궁수 진지(북쪽 둔덕, GDD §10.2)와 견제 위치 */
export const ARCHER_MOUND: Pt = [520, 735];
export const EAST_ARCHER_POST: Pt = [250, 690];
export const FEINT_HOLD: Record<LaneId, Pt> = {
  eastBridge: [240, 650],
  ford: [520, 645],
  westBridge: [800, 650],
  westField: [800, 650],
};
/** 예비대 집결 위치(공격 배치 구역 앞) */
export const RESERVE_STAGING: Pt = [520, 790];

/** 계획별로 시나리오 역할(SquadSpec.role)에 붙일 경로와 역할. 순서대로 같은 역할 부대에 배정된다. */
export interface Assignment {
  readonly stance: Stance;
  readonly lane: LaneId;
}

/**
 * 역할 이름(role) → 같은 역할 부대들에게 차례로 줄 배정 목록. 목록보다 부대가 많으면 마지막 항목을 반복한다.
 * A 중앙 돌파 / B 동쪽 망치 / C 서쪽 우회(GDD §8.3 표).
 */
export const PLAN_ASSIGNMENTS: Record<AttackPlanId, Record<string, readonly Assignment[]>> = {
  A: {
    center: [{ stance: 'assault', lane: 'ford' }],
    eastGroup: [
      { stance: 'feint', lane: 'eastBridge' },
      { stance: 'feint', lane: 'eastBridge' },
      { stance: 'reserve', lane: 'ford' },
    ],
    westGroup: [{ stance: 'reserve', lane: 'ford' }],
    archers: [
      { stance: 'archer', lane: 'ford' },
      { stance: 'archer', lane: 'ford' },
      { stance: 'archer', lane: 'ford' },
      { stance: 'archer', lane: 'ford' },
      { stance: 'archer', lane: 'eastBridge' },
    ],
    cavalry: [{ stance: 'flank', lane: 'westField' }],
    commander: [{ stance: 'commander', lane: 'ford' }],
  },
  B: {
    eastGroup: [{ stance: 'assault', lane: 'eastBridge' }],
    center: [
      { stance: 'assault', lane: 'eastBridge' },
      { stance: 'assault', lane: 'eastBridge' },
      { stance: 'reserve', lane: 'ford' },
      { stance: 'reserve', lane: 'ford' },
      { stance: 'feint', lane: 'ford' },
      { stance: 'reserve', lane: 'eastBridge' },
    ],
    westGroup: [{ stance: 'reserve', lane: 'eastBridge' }],
    archers: [
      { stance: 'archer', lane: 'ford' },
      { stance: 'archer', lane: 'ford' },
      { stance: 'archer', lane: 'ford' },
      { stance: 'archer', lane: 'eastBridge' },
      { stance: 'archer', lane: 'eastBridge' },
    ],
    cavalry: [{ stance: 'flank', lane: 'westField' }],
    commander: [{ stance: 'commander', lane: 'eastBridge' }],
  },
  C: {
    westGroup: [{ stance: 'assault', lane: 'westBridge' }],
    center: [
      { stance: 'assault', lane: 'westBridge' },
      { stance: 'assault', lane: 'westBridge' },
      { stance: 'feint', lane: 'ford' },
      { stance: 'feint', lane: 'ford' },
      { stance: 'assault', lane: 'westBridge' },
      { stance: 'assault', lane: 'westBridge' },
      { stance: 'feint', lane: 'ford' },
    ],
    eastGroup: [{ stance: 'reserve', lane: 'ford' }],
    archers: [{ stance: 'archer', lane: 'ford' }],
    cavalry: [{ stance: 'flank', lane: 'westField' }],
    commander: [{ stance: 'commander', lane: 'westBridge' }],
  },
};

/** 수치(GDD §8.2·§8.3) */
export const AI = {
  /** 상황 평가 주기(초)와 명령 반응 지연 범위(초) */
  evalInterval: 1,
  reactionMin: 0.5,
  reactionMax: 1.5,
  affinityBonus: 30,
  distancePer10m: 1,
  opportunityBonus: 40,
  waveringBonus: 15,
  routingCavBonus: 20,
  bracedSpearRisk: 60,
  uphillRisk: 15,
  uphillRiskDeg: 10,
  /** 기병: 근접에 이만큼 묶이면 이탈해 물러났다가 재돌격 */
  cavStuckTime: 6,
  cavWithdrawDist: 50,
  /** 창병: 적 기병이 이 거리 안에서 걷기 속도의 1.5배 넘게, 정면(±45°)으로 달려오면 고수(Brace) */
  spearBraceDist: 150,
  cavThreatSpeedRatio: 1.5,
  cavThreatCos: 0.7,
  /** 같은 경로 부대의 좌우 간격(m)과, 도하 지점 경유점으로 보는 강 중심선 거리(m) */
  laneSpacing: 64,
  /** 다른 아군 부대 하나가 이미 노리는 적의 표적 점수 감점 */
  sharedTargetPenalty: 25,
  /** 측면 우회: 표적 측면에서 이만큼 떨어진 지점으로 먼저 간다(m) */
  flankClearance: 15,
  /** 사기 이 값 미만이면 지휘관 쪽으로 물러남 */
  retreatMorale: 30,
  /** 궁수: 근접 적이 이 거리 안이면 이만큼 물러남 */
  archerThreatDist: 40,
  archerFallback: 60,
  /** 경유점 도착 판정(m) */
  waypointReach: 15,
  /** 돌파 부대가 이 거리 안의 보이는 적을 공격한다(m). 견제 부대는 feintEngage */
  assaultEngage: 120,
  feintEngage: 40,
  flankEngage: 200,
  /** 집결: 같은 경로 돌파 부대의 이 비율이 모이거나, 첫 도착 후 이 시간이 지나면 함께 공격 */
  rallyShare: 0.75,
  rallyTimeout: 60,
  /** 공격 궁수: 첫 접촉 후 이 거리 안의 보이는 적에게 사거리까지 다가가 쏜다(m) */
  archerAdvance: 400,
  /** 공격 예비대 투입: 첫 접촉 후 이 시간 안에 주공이 깃발 반경 안에 들지 못하면(GDD §8.3) */
  reserveCommitDelay: 120,
  /** 방어 예비대: 강을 건넌 적이 이 시간 넘게 출구 근처에 머물면 측면 공격 */
  exitLingerTime: 30,
  exitRadius: 120,
  riverZ: 578,
  /** 방어 부대가 자기 자리에서 이보다 멀어지면 돌아간다 */
  homeLeash: 40,
  /** 방어 예비대가 반응하는 거리(전열·깃발 기준) */
  reserveReact: 220,
  /** 지휘관은 이 거리 뒤에서 따라간다 */
  commanderTrail: 70,
} as const;
