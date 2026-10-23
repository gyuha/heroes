import type {
  FormationId,
  MoraleBand,
  OrderKind,
  RoutCause,
  SquadActivity,
  SquadState,
  TeamId,
} from './api';
import { FORMATIONS, MORALE, type UnitTypeStats } from './data/balance';
import { SOLDIER } from './data/simConfig';
import { primeDoubleFields } from './math';

/** 사기 감소 원인 번호. RoutCause 문자열과 순서가 같다. */
export const ROUT_CAUSES: readonly RoutCause[] = [
  'losses',
  'melee',
  'flank',
  'rear',
  'charge',
  'nearbyRout',
  'commanderDeath',
  'arrows',
];
export const Cause = {
  Losses: 0,
  Melee: 1,
  Flank: 2,
  Rear: 3,
  Charge: 4,
  NearbyRout: 5,
  CommanderDeath: 6,
  Arrows: 7,
} as const;

export interface SquadOrder {
  kind: OrderKind;
  /** move: 목적지와 도착 후 정면(NaN = 이동 방향) */
  x: number;
  z: number;
  facing: number;
  /** attack: 표적 부대 ID */
  target: number;
  /** 보병 돌격(Z) 요청 */
  charge: boolean;
}

/**
 * 부대. 명령·대형·사기·상태는 부대 단위로 갖고, 병사는 UnitStore 인덱스로 가리킨다.
 *
 * 대형 자리: slot k → 행 r = floor(k / F), 열 f = k mod F (F = 현재 열 수). 앞 행이 slot 0부터다.
 * 병사가 죽으면 같은 열의 뒤 병사들이 한 행씩 앞으로 오고, 맨 뒤 빈자리는 마지막 slot 병사가 채운다.
 * 그래서 살아 있는 병사는 항상 slot 0..n-1을 빈틈없이 차지한다(GDD §4.3 "뒤 행이 앞으로 채운다").
 */
export class Squad {
  readonly members: Int32Array;
  n: number;
  readonly startCount: number;

  formation: FormationId = 'line';
  /** 플레이어·AI가 정한 열 수 */
  files: number;
  /** 통로가 좁을 때 줄인 열 수(0 = 줄이지 않음) */
  autoFiles = 0;

  /** 대형 중심과 정면 */
  x = 0;
  z = 0;
  facing = 0;
  /** 멈춘 뒤 돌아설 정면(NaN = 없음). 도착 후 지정 방향, 궁수가 표적 쪽으로 돌 때 */
  wantFacing = NaN;
  groundY = 0;
  /** 이번 틱 중심의 실제 이동 속도(m/s, 지형 계수 반영) */
  speed = 0;
  /** 이번 틱에 의도한 이동 속도(m/s, 지형 계수 반영). 마지막 틱이 접촉 간격에서 잘려도 줄지 않으므로 돌격 충격 속도비에 쓴다 */
  travelSpeed = 0;
  /** 지형 계수를 곱하기 전 속도(병사 따라잡기 기준) */
  baseSpeed = 0;

  order: SquadOrder = { kind: 'none', x: 0, z: 0, facing: NaN, target: -1, charge: false };
  path: number[] = [];
  pathIndex = 0;
  repathTimer = 0;

  state: SquadState = 'ready';
  morale: number = MORALE.start;
  rallies = 0;
  /** 정지해 있던 시간(초). 고수 보너스·Brace·사격 조건 */
  stillTime = 0;

  charging = false;
  /** 돌격 명령(Z)을 받은 기병: 다음 이동에서 거리와 관계없이 가속을 시작한다 */
  chargeRequested = false;
  chargeCooldown = 0;
  /** 보병 돌격: 이번 돌격에서 달린 거리 */
  runDist = 0;
  chargeBonusTime = 0;

  lastLossTime = -1e9;
  disengageTime = 0;
  /** 아군 부대에 막혀 있던 시간(초) */
  friendBlockedTime = 0;
  pursueTime = 0;
  /** 근접 교전(적 부대와 접촉) 중인가 — 매 틱 접촉 판정이 채운다 */
  engaged = false;
  contactCount = 0;
  /** 기병 치고 빠지기용: 연속 교전 시간 */
  engagedTime = 0;
  flankTimer = 0;
  rearTimer = 0;
  revealTimer = 0;
  concealed = false;
  heightBonusPct = 0;
  /** 사격 표적(원거리 병종), -1 = 없음 */
  fireTarget = -1;
  fireArc = false;
  retargetTimer = 0;
  thinkTimer = 0;
  corridorTimer = 0;
  /** 대기 중 자동 반응으로 쫓기 시작한 위치(NaN = 자동 반응 아님) */
  reactOriginX = NaN;
  reactOriginZ = NaN;

  lossesThisTick = 0;
  arrowLossesThisTick = 0;
  kills = 0;
  /** 원인별 누적 사기 감소(패주 원인 통계) */
  readonly moraleLoss = new Float32Array(ROUT_CAUSES.length);
  routTime = -1;
  routCause: RoutCause = 'losses';

  constructor(
    readonly id: number,
    readonly team: TeamId,
    readonly typeIndex: number,
    readonly stats: UnitTypeStats,
    readonly isCommander: boolean,
    readonly name: string,
    size: number,
    /** 시나리오가 정한 AI 역할 이름(SquadSpec.role) */
    readonly role: string,
  ) {
    this.members = new Int32Array(size).fill(-1);
    this.n = 0;
    this.startCount = size;
    this.files = stats.files;
    primeDoubleFields(this, SQUAD_DOUBLE_FIELDS);
    primeDoubleFields(this.order, ['x', 'z', 'facing']);
  }

  addMember(soldier: number): void {
    this.members[this.n++] = soldier;
  }

  get spacingMult(): number {
    return this.formation === 'loose' ? FORMATIONS.loose.spacingMult : 1;
  }
  get fileSpacing(): number {
    return this.stats.fileSpacing * this.spacingMult;
  }
  get rankSpacing(): number {
    return this.stats.rankSpacing * this.spacingMult;
  }
  /** 실제 열 수 = min(정한 열 수, 자동 폭 조정, 병사 수) */
  get curFiles(): number {
    const want = this.autoFiles > 0 ? Math.min(this.files, this.autoFiles) : this.files;
    return Math.max(1, Math.min(want, this.n));
  }
  get ranks(): number {
    return Math.max(1, Math.ceil(this.n / this.curFiles));
  }
  /** 대형 폭·깊이(GDD §4.3: 열 수 × 간격) */
  get width(): number {
    return this.curFiles * this.fileSpacing;
  }
  get depth(): number {
    return this.ranks * this.rankSpacing;
  }
  get alive(): boolean {
    return this.state !== 'destroyed' && this.n > 0;
  }
  get ready(): boolean {
    return this.state === 'ready' && this.n > 0;
  }
  get mounted(): boolean {
    return this.stats.mounted;
  }
  /** 고수 명령으로 1초 이상 정지: 방패벽(보병 감소율 +10%), 보병 돌격 무효, 사격 조건 */
  get holding(): boolean {
    return this.ready && this.order.kind === 'hold' && this.stillTime >= HOLD_SETTLE;
  }
  get shieldWall(): boolean {
    return this.holding && this.stats.holdArmorBonus > 0;
  }
  get braced(): boolean {
    const b = this.stats.brace;
    return (
      !!b &&
      this.ready &&
      this.order.kind === 'hold' &&
      this.stillTime >= b.settleTime &&
      !this.onFord
    );
  }
  /** 여울 위에서는 Brace 불가(GDD §6.1). 중심 칸 기준, 틱마다 갱신 */
  onFord = false;

  get moraleBand(): MoraleBand {
    if (this.state === 'routing') return 'routing';
    return this.morale < MORALE.waver ? 'wavering' : 'steady';
  }

  get activity(): SquadActivity {
    if (this.disengageTime > 0) return 'disengaging';
    if (this.engaged) return 'engaged';
    if (this.charging || this.runDist > 0) return 'charging';
    if (this.braced) return 'braced';
    if (this.order.kind === 'hold') return 'holding';
    if (this.pursueTime > 0) return 'pursuing';
    if (this.speed > 0.05) return 'moving';
    return 'idle';
  }

  /** slot의 대형 안 위치(정면 기준 로컬: lateral = 오른쪽 +, forward = 앞 +). */
  slotLocal(slot: number, out: { lateral: number; forward: number }): void {
    const F = this.curFiles;
    const R = this.ranks;
    const rank = Math.floor(slot / F);
    const file = slot - rank * F;
    const inRank = rank === R - 1 ? this.n - rank * F : F;
    const spread = this.state === 'routing' ? SOLDIER.routSpreadMult : 1;
    out.lateral = (file - (inRank - 1) / 2) * this.fileSpacing * spread;
    out.forward = ((R - 1) / 2 - rank) * this.rankSpacing * spread;
  }

  /** 병사가 죽었을 때 대형을 메운다. 죽은 병사의 slot을 받아 처리하고 n을 줄인다. */
  removeAt(slot: number): void {
    const F = this.curFiles;
    let s = slot;
    while (s + F < this.n) {
      this.members[s] = this.members[s + F];
      s += F;
    }
    const last = this.n - 1;
    if (s !== last) this.members[s] = this.members[last];
    this.members[last] = -1;
    this.n--;
  }

  slotOfSoldier(soldier: number): number {
    for (let k = 0; k < this.n; k++) if (this.members[k] === soldier) return k;
    return -1;
  }
}

/** 전투 중 소수를 받는 부대 필드(primeDoubleFields 참고). 정수만 받는 필드(병사 수, 처치 수 등)는 넣지 않는다 */
const SQUAD_DOUBLE_FIELDS = [
  'x',
  'z',
  'facing',
  'wantFacing',
  'groundY',
  'speed',
  'travelSpeed',
  'baseSpeed',
  'repathTimer',
  'morale',
  'stillTime',
  'chargeCooldown',
  'runDist',
  'chargeBonusTime',
  'lastLossTime',
  'disengageTime',
  'friendBlockedTime',
  'pursueTime',
  'engagedTime',
  'flankTimer',
  'rearTimer',
  'revealTimer',
  'retargetTimer',
  'thinkTimer',
  'corridorTimer',
  'reactOriginX',
  'reactOriginZ',
  'routTime',
] as const;

/** 고수 명령 뒤 방패벽·고수 판정까지 정지해야 하는 시간(초, GDD §5.3). */
const HOLD_SETTLE = 1;
