/**
 * 병사 단위 구현에 필요한 수치 중 밸런스 원본(balance.ts)에 없는 것. GDD 규칙을 바꾸는 값이 아니라
 * 병사 움직임과 판정 주기를 정하는 구현 상수다. 밸런스에 영향을 주는 값을 바꾸면 디자이너에게 알린다.
 */
export const SOLDIER = {
  /** 몸 반지름(m), 인덱스 = UNIT_TYPE_ORDER. 충돌 분리와 리치 판정(리치 = 중심 → 상대 몸 표면)에 쓴다 */
  bodyRadius: [0.4, 0.4, 0.4, 1.1] as readonly number[],
  /** 자기 자리보다 이만큼 넘게 뒤처지면 따라잡기 속도를 더한다(m) */
  catchUpDist: 1.5,
  catchUpSpeed: 1.5,
  /** 부대 속도 대비 병사 최고 속도 배율(자리로 모이기 위한 여유) */
  speedSlack: 1.2,
  /** 분리: 겹친 정도에 비례해 미는 속도(m/s, 완전히 겹쳤을 때) */
  separationSpeed: 3,
  turnRate: Math.PI * 2,
  /** 리치 안에 적이 없을 때 다시 찾기까지(초) */
  meleeRetry: 0.25,
  /** 공격 애니메이션을 유지하는 시간(초). 이 동안은 걷기 등으로 바꾸지 않는다 */
  attackAnimTime: 0.7,
  hitAnimTime: 0.3,
  /** 죽은 뒤 화면에서 지우기까지(초). 시체 누적은 MVP 범위 밖(GDD §11) */
  corpseTime: 3,
  /** 걷기 속도의 이 배율을 넘으면 달리기 애니메이션 */
  runAnimRatio: 1.35,
  moveAnimSpeed: 0.3,
  /** 패주 중 병사 간격 배율(대열이 흩어진 모습) */
  routSpreadMult: 1.6,
};

export const SQUAD = {
  /** 접근하던 부대는 두 대형(병사 몸 기준 사각형)의 간격이 이 값 이하가 되면 멈춘다(m) */
  stopGap: 0.3,
  /** 부대 방향 회전 속도(rad/s). 넓은 횡대가 순간적으로 돌지 않게 한다 */
  turnRateFoot: Math.PI / 5,
  turnRateMounted: Math.PI / 3,
  /** 목적지 도착 판정(m) */
  arriveDist: 0.5,
  /** 이 거리 안이면 경로 탐색 없이 표적으로 곧장 간다(m) */
  directApproachDist: 60,
  /** 공격 표적 경로를 다시 구하는 주기(초) */
  repathInterval: 2,
  /** 측면·후방 피격, 근접 교전 상태를 마지막 피격 뒤 유지하는 시간(초) */
  attackedWindow: 1.6,
  /** 대기 중 근접 부대의 자동 반응 거리와 추격 한계(GDD §7.2) */
  idleReactDist: 30,
  /** 전진 명령: 정면 이 거리 안의 보이는 적을 공격(GDD §7.2) */
  advanceEngageDist: 60,
  /** 궁수는 실제 사거리의 이 비율까지 다가가 멈춘다 */
  archerStandRatio: 0.9,
  /** 궁수 표적·시야선 재계산 주기(초) */
  rangedRetarget: 1,
  /** 자동 폭 조정: 앞쪽 이 거리까지 통로 폭을 본다(m) */
  corridorLookAhead: 12,
  corridorInterval: 0.5,
  /** 자동 폭 조정의 최소 열 수 */
  minAutoFiles: 3,
  /** 맵 가장자리 통과 불가 띠(m, GDD §10.1). 패주 부대만 닿을 수 있고 닿으면 괴멸 */
  edgeMargin: 40,
  /** 기병 돌격 충격: 앞 2행 기수가 이 거리 안의 적을 친다(m, GDD §5.4) */
  chargeImpactReach: 2.5,
  chargeImpactRanks: 2,
  /** 부대 표적·자동 반응 판단 주기(초) */
  thinkInterval: 0.5,
  /** 시야 갱신 주기(초, GDD §6.4) */
  visionInterval: 0.5,
  /** 시야를 잃은 적의 마지막 위치를 남기는 시간(초) */
  lastSeenTime: 10,
  /** 이벤트 로그: 같은 부대·같은 원인을 다시 내기까지(초, GDD §6.5) */
  logThrottle: 10,
  /** 승패·깃발 판정 주기(초, GDD §3) */
  ruleInterval: 1,
  /** 보이는 적: 시야선 판정 높이(m). 보병 눈높이와 기병 */
  footSightHeight: 1.7,
  mountedSightHeight: 2.4,
  /** 원거리 표적 높이(지면 +1m, GDD §5.5) */
  arrowTargetHeight: 1,
};
