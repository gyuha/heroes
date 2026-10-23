/**
 * AI 상대(GDD §8). 전략층(계획·단계 전환)과 전술층(부대별 1초마다 표적 점수)으로 나뉜다.
 *
 * - 공정함: 플레이어와 같은 명령 경로(World.enqueue → 적용 시 판정)와 같은 시야(isVisible)만 쓴다.
 * - 반응 지연: 부대마다 1초 주기로 평가하고, 새 명령은 0.5~1.5초 뒤에 큐에 넣는다.
 * - 주기 작업은 부대 ID로 틱에 나눠 한 틱에 몰리지 않게 한다(ARCHITECTURE §11.6-1).
 */
import { len2 } from '../math';
import type { Command, TeamId, UnitTypeId } from '../api';
import { TICK_DT } from '../constants';
import { lookDownDeg } from '../rules';
import { Rng } from '../rng';
import type { Squad } from '../squad';
import { sideOf, squadGap } from '../systems/combat';
import { isContact } from '../systems/morale';
import { UNIT_TYPE_ORDER } from '../units';
import type { Controller, World } from '../world';
import {
  AI,
  ARCHER_MOUND,
  ATTACK_PLANS,
  type AttackPlanId,
  type Assignment,
  FEINT_HOLD,
  LANES,
  LANE_CROSSING,
  LANE_RALLY,
  type LaneId,
  PLAN_ASSIGNMENTS,
  RESERVE_STAGING,
  type Stance,
  EAST_ARCHER_POST,
} from './aiPlans';

const EVAL_TICKS = Math.round(AI.evalInterval / TICK_DT);

/** 병종 상성(GDD §5.7 "강한 상대/약한 상대"를 근접 표적 고르기에 맞춘 값) +1 강함, −1 약함 */
const AFFINITY: Record<UnitTypeId, Partial<Record<UnitTypeId, number>>> = {
  infantry: { spearman: 1, archer: 1 },
  spearman: { cavalry: 1, infantry: -1 },
  archer: { spearman: 1, cavalry: 1, infantry: -1 },
  cavalry: { archer: 1, infantry: -1, spearman: -1 },
};

interface Memo {
  stance: Stance | 'hold';
  lane: LaneId;
  wp: number;
  homeX: number;
  homeZ: number;
  homeFacing: number;
  /** 같은 명령을 다시 내지 않도록 마지막으로 낸 명령 요약 */
  last: string;
  pendingUntil: number;
  /** 방어 예비대 투입 여부, 공격 예비대 투입 여부 */
  committed: boolean;
  withdrawUntil: number;
}

interface Pending {
  tick: number;
  cmd: Command;
}

export class AiController implements Controller {
  readonly plan: AttackPlanId | 'defend';
  private readonly rng: Rng;
  private readonly memo: Memo[] = [];
  private readonly pending: Pending[] = [];
  private readonly attacking: boolean;
  private firstContactTime = -1;
  private reserveCommitted = false;
  /** 방어: 강을 건넌 적 부대가 출구 근처에 처음 보인 시각 */
  private readonly lingerSince = new Map<number, number>();

  constructor(
    world: World,
    readonly team: TeamId,
    seed: number,
    planOverride?: AttackPlanId,
  ) {
    this.rng = new Rng((seed * 2654435761 + team * 40503 + 1) >>> 0);
    this.attacking = world.scenario.attacker === team;
    this.plan = this.attacking
      ? (planOverride ?? ATTACK_PLANS[Math.floor(this.rng.next() * ATTACK_PLANS.length)])
      : 'defend';
    const counters = new Map<string, number>();
    for (const sq of world.squads) {
      if (sq.team !== team) {
        this.memo.push(emptyMemo(sq));
        continue;
      }
      const k = counters.get(sq.role) ?? 0;
      counters.set(sq.role, k + 1);
      const m = emptyMemo(sq);
      if (this.attacking && this.plan !== 'defend') {
        const list: readonly Assignment[] | undefined = PLAN_ASSIGNMENTS[this.plan][sq.role];
        const a = list
          ? list[Math.min(k, list.length - 1)]
          : { stance: 'reserve' as Stance, lane: 'ford' as LaneId };
        m.stance = a.stance;
        m.lane = a.lane;
      }
      this.memo.push(m);
    }
  }

  think(world: World): void {
    for (let k = this.pending.length - 1; k >= 0; k--) {
      if (this.pending[k].tick <= world.tick) {
        world.enqueue(this.pending[k].cmd);
        this.pending.splice(k, 1);
      }
    }
    if (world.tick % EVAL_TICKS === 0) this.strategy(world);
    for (const sq of world.squads) {
      if (sq.team !== this.team || !sq.ready) continue;
      if ((sq.id + world.tick) % EVAL_TICKS !== 0) continue;
      if (this.memo[sq.id].pendingUntil > world.tick) continue;
      if (this.attacking) this.attackerTactics(world, sq);
      else this.defenderTactics(world, sq);
    }
  }

  // ------------------------------------------------------------------ 전략층

  private strategy(world: World): void {
    if (this.firstContactTime < 0 && world.squads.some((s) => s.team === this.team && s.engaged)) {
      this.firstContactTime = world.time;
    }
    if (!this.attacking || this.reserveCommitted || this.firstContactTime < 0) return;
    if (world.time - this.firstContactTime < AI.reserveCommitDelay) return;
    const f = world.scenario.rules.flag;
    let bestLane: LaneId = 'ford';
    let bestD = Infinity;
    for (const sq of world.squads) {
      const m = this.memo[sq.id];
      if (sq.team !== this.team || !sq.ready || m.stance !== 'assault') continue;
      const d = len2(sq.x - f.x, sq.z - f.z);
      if (d < bestD) {
        bestD = d;
        bestLane = m.lane;
      }
    }
    // GDD §8.3: 주공이 깃발 150m 안에 들지 못하면 가장 진척이 좋은 방면에 투입한다. 들었더라도 예비대를
    // 끝까지 세워 두면 쓰지 않는 병력이 되므로, 그때는 주공 방면을 증원한다(디자이너 확인 필요).
    this.reserveCommitted = true;
    for (const sq of world.squads) {
      const m = this.memo[sq.id];
      if (sq.team === this.team && (m.stance === 'reserve' || m.stance === 'feint')) {
        m.stance = 'assault';
        m.lane = bestLane;
        m.wp = 0;
      }
    }
  }

  // ------------------------------------------------------------------ 전술층: 공격

  private attackerTactics(world: World, sq: Squad): void {
    const m = this.memo[sq.id];
    if (this.selfPreservation(world, sq)) return;
    if (m.stance === 'commander') return this.followMain(world, sq);
    if (m.stance === 'archer') {
      // 접촉 전에는 진지에서 엄호하고, 싸움이 시작되면 사거리까지 다가가 쏜다.
      if (this.firstContactTime >= 0) {
        const t = this.bestTarget(world, sq, AI.archerAdvance);
        if (t) return this.attack(world, sq, t);
      }
      const post = m.lane === 'eastBridge' ? EAST_ARCHER_POST : ARCHER_MOUND;
      if (len2(sq.x - post[0], sq.z - post[1]) > AI.waypointReach) {
        this.move(world, sq, post[0] + this.slotOffset(world, sq, 70), post[1], Math.PI);
      } else this.order(world, sq, { kind: 'hold', team: this.team, squads: [sq.id] }, 'hold');
      return;
    }
    if (sq.engaged) return;
    const rally = LANE_RALLY[m.lane];
    const beforeRally = m.stance === 'assault' && rally >= 0 && !this.rallyOpen(world, m.lane);
    const engage =
      m.stance === 'assault' && !beforeRally
        ? AI.assaultEngage
        : m.stance === 'flank'
          ? AI.flankEngage
          : AI.feintEngage;
    if (m.stance !== 'reserve') {
      const t = this.bestTarget(world, sq, engage);
      if (t) return this.attack(world, sq, t);
    }
    if (m.stance === 'reserve') {
      const p = RESERVE_STAGING;
      if (len2(sq.x - p[0], sq.z - p[1]) > 60)
        this.move(world, sq, p[0] + this.slotOffset(world, sq, 65), p[1], Math.PI);
      return;
    }
    if (m.stance === 'feint') {
      const p = FEINT_HOLD[m.lane];
      if (len2(sq.x - p[0], sq.z - p[1]) > AI.waypointReach * 2) {
        this.move(world, sq, p[0] + this.slotOffset(world, sq, 65), p[1], Math.PI);
      } else this.order(world, sq, { kind: 'hold', team: this.team, squads: [sq.id] }, 'hold');
      return;
    }
    // 돌파·우회: 경유점을 차례로 지나 깃발로. 같은 경로 부대는 옆으로 벌려 서고, 도하 지점에서만 한 줄로 지난다.
    const lane = LANES[m.lane];
    const spread = this.slotOffset(world, sq, AI.laneSpacing);
    const wx = (k: number) => lane[k][0] + (k === LANE_CROSSING ? 0 : spread);
    while (m.wp < lane.length && len2(sq.x - wx(m.wp), sq.z - lane[m.wp][1]) < AI.waypointReach) {
      if (m.wp === rally) this.markRally(world, m.lane);
      if (m.wp === rally && beforeRally) break;
      m.wp++;
    }
    if (
      m.wp === rally &&
      beforeRally &&
      len2(sq.x - wx(m.wp), sq.z - lane[m.wp][1]) < AI.waypointReach
    ) {
      this.order(world, sq, { kind: 'hold', team: this.team, squads: [sq.id] }, 'hold');
      return;
    }
    if (m.wp < lane.length) {
      this.move(world, sq, wx(m.wp), lane[m.wp][1], NaN);
      return;
    }
    const f = world.scenario.rules.flag;
    const t = this.bestTarget(world, sq, Infinity);
    if (t) return this.attack(world, sq, t);
    this.move(world, sq, f.x + spread, f.z, NaN);
  }

  /** 공격 지휘관: 주공 부대들의 중심 뒤를 따라가 지휘 오라를 준다. */
  private followMain(world: World, sq: Squad): void {
    let x = 0;
    let z = 0;
    let n = 0;
    for (const s of world.squads) {
      if (s.team !== this.team || !s.ready || this.memo[s.id].stance !== 'assault') continue;
      x += s.x;
      z += s.z;
      n++;
    }
    if (n === 0) return;
    x /= n;
    z /= n;
    const tz = z + (this.attacking ? AI.commanderTrail : -AI.commanderTrail);
    if (len2(sq.x - x, sq.z - tz) > AI.commanderTrail / 2) this.move(world, sq, x, tz, NaN);
  }

  // ------------------------------------------------------------------ 전술층: 방어

  private defenderTactics(world: World, sq: Squad): void {
    const m = this.memo[sq.id];
    if (this.selfPreservation(world, sq)) return;
    const role = sq.role;
    if (sq.engaged) return;
    // 깃발이 점령 중이면 가까운 방어 부대가 탈환에 나선다
    const flag = world.flag;
    const f = world.scenario.rules.flag;
    if (flag.state === 'capturing' && role !== 'crest') {
      const capturer = this.nearestVisibleEnemy(world, f.x, f.z, f.radius + 20);
      if (capturer && len2(sq.x - f.x, sq.z - f.z) < 200) return this.attack(world, sq, capturer);
    }
    if (role === 'reserveWest' || role === 'reserveCenter' || role === 'commander') {
      if (role !== 'commander') {
        const t = this.reserveTarget(world, sq);
        if (t) {
          m.committed = true;
          return this.attack(world, sq, t);
        }
      }
      if (m.committed && sq.order.kind === 'attack') return;
      m.committed = false;
      return this.returnHome(world, sq);
    }
    // 전열·서쪽 다리·궁수: 제자리 고수. 밀려났으면 돌아간다.
    this.returnHome(world, sq);
  }

  private returnHome(world: World, sq: Squad): void {
    const m = this.memo[sq.id];
    if (len2(sq.x - m.homeX, sq.z - m.homeZ) > AI.homeLeash) {
      this.move(world, sq, m.homeX, m.homeZ, m.homeFacing);
    } else if (sq.order.kind !== 'hold' && sq.order.kind !== 'move') {
      this.order(world, sq, { kind: 'hold', team: this.team, squads: [sq.id] }, 'hold');
    }
  }

  /**
   * 방어 예비대 표적: 강을 건넌 적이 다리·여울 출구 근처에 30초 넘게 머물거나, 아군 전열과 교전 중인
   * 적(측면을 칠 기회)이 반응 거리 안에 보이면 그 적.
   */
  private reserveTarget(world: World, sq: Squad): Squad | null {
    let best: Squad | null = null;
    let bestScore = -Infinity;
    for (const e of world.squads) {
      if (e.team === this.team || !e.alive || !world.isVisible(e.id, this.team)) continue;
      const d = len2(e.x - sq.x, e.z - sq.z);
      if (d > AI.reserveReact) continue;
      let trigger = e.engaged;
      if (e.z < AI.riverZ) {
        const since = this.lingerSince.get(e.id) ?? world.time;
        this.lingerSince.set(e.id, since);
        if (world.time - since >= AI.exitLingerTime) trigger = true;
      }
      if (!trigger) continue;
      const s = this.score(world, sq, e, d);
      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ 공통 규칙(GDD §8.2)

  /** 사기 저하 후퇴, 궁수 후퇴, 기병 치고 빠지기, 창병 Brace. 명령을 냈으면 true. */
  private selfPreservation(world: World, sq: Squad): boolean {
    const m = this.memo[sq.id];
    if (m.withdrawUntil > world.time) return true;
    if (
      !sq.isCommander &&
      sq.morale < AI.retreatMorale &&
      (sq.engaged || sq.flankTimer > 0 || sq.rearTimer > 0)
    ) {
      const c = world.squads.find((s) => s.team === this.team && s.isCommander && s.alive);
      if (c && len2(c.x - sq.x, c.z - sq.z) > 40) {
        this.move(world, sq, c.x, c.z, NaN);
        m.withdrawUntil = world.time + 10;
        return true;
      }
    }
    if (sq.stats.ranged) {
      const threat = this.nearestVisibleEnemy(world, sq.x, sq.z, AI.archerThreatDist + 30, true);
      if (threat && squadGap(sq, threat) < AI.archerThreatDist) {
        const a = Math.atan2(sq.x - threat.x, sq.z - threat.z);
        const tx = sq.x + Math.sin(a) * AI.archerFallback;
        const tz = sq.z + Math.cos(a) * AI.archerFallback;
        if (world.inPlayArea(tx, tz)) {
          this.move(world, sq, tx, tz, a + Math.PI);
          m.withdrawUntil = world.time + 8;
          return true;
        }
      }
    }
    if (sq.mounted && !sq.isCommander && sq.engaged && sq.engagedTime > AI.cavStuckTime) {
      const a = sq.facing + Math.PI;
      const tx = sq.x + Math.sin(a) * AI.cavWithdrawDist;
      const tz = sq.z + Math.cos(a) * AI.cavWithdrawDist;
      if (world.inPlayArea(tx, tz)) {
        this.move(world, sq, tx, tz, sq.facing);
        m.withdrawUntil = world.time + 6;
        return true;
      }
    }
    // 창병: 적 기병이 달려오면 고수로 Brace(GDD §8.2). 위협이 사라지면 다음 평가에서 원래 할 일로 돌아간다.
    if (
      UNIT_TYPE_ORDER[sq.typeIndex] === 'spearman' &&
      !sq.engaged &&
      this.cavalryThreat(world, sq)
    ) {
      if (sq.order.kind !== 'hold')
        this.order(world, sq, { kind: 'hold', team: this.team, squads: [sq.id] }, 'hold');
      return true;
    }
    return false;
  }

  /** 전술층 표적 점수 = 상성 + 거리 + 기회 − 위험(GDD §8.2). */
  private score(world: World, sq: Squad, e: Squad, d: number): number {
    const mine = UNIT_TYPE_ORDER[sq.typeIndex];
    const theirs = UNIT_TYPE_ORDER[e.typeIndex];
    let s = (AFFINITY[mine][theirs] ?? 0) * AI.affinityBonus - (d / 10) * AI.distancePer10m;
    const side = sideOf(e, sq.x, sq.z);
    if (e.engaged && side !== 'front') s += AI.opportunityBonus;
    if (e.moraleBand === 'wavering') s += AI.waveringBonus;
    if (e.state === 'routing') s += sq.mounted ? AI.routingCavBonus : -AI.opportunityBonus;
    if (sq.mounted && e.braced && side === 'front') s -= AI.bracedSpearRisk;
    if (lookDownDeg(e.groundY, sq.groundY, d) >= AI.uphillRiskDeg) s -= AI.uphillRisk;
    // 표적 분산: 이미 다른 아군이 노리는 적은 점수를 낮춰 전열 전체에 고르게 붙는다
    for (const a of world.squads) {
      if (
        a !== sq &&
        a.team === this.team &&
        a.ready &&
        a.order.kind === 'attack' &&
        a.order.target === e.id
      ) {
        s -= AI.sharedTargetPenalty;
      }
    }
    return s;
  }

  /** 집결 지점에 처음 부대가 닿은 시각(경로별) */
  private readonly rallyStart = new Map<LaneId, number>();
  /** 집결이 끝나 함께 공격해도 되는가(GDD §8.3 "주력을 한 곳에 모은다"). */
  private rallyOpen(world: World, lane: LaneId): boolean {
    const start = this.rallyStart.get(lane);
    if (start !== undefined && world.time - start >= AI.rallyTimeout) return true;
    const rally = LANE_RALLY[lane];
    let total = 0;
    let arrived = 0;
    for (const s of world.squads) {
      const m = this.memo[s.id];
      if (s.team !== this.team || !s.ready || m.stance !== 'assault' || m.lane !== lane) continue;
      total++;
      if (m.wp >= rally && (m.wp > rally || this.nearLanePoint(world, s, rally))) arrived++;
    }
    return total > 0 && arrived >= Math.ceil(total * AI.rallyShare);
  }
  private markRally(world: World, lane: LaneId): void {
    if (!this.rallyStart.has(lane)) this.rallyStart.set(lane, world.time);
  }
  private nearLanePoint(world: World, s: Squad, k: number): boolean {
    const p = LANES[this.memo[s.id].lane][k];
    return (
      Math.abs(s.z - p[1]) < AI.waypointReach * 2 &&
      Math.abs(s.x - p[0]) < AI.laneSpacing * 4 &&
      world.time >= 0
    );
  }

  /** 이 진영 부대가 t의 정면에서 t와 접촉해 있는가. */
  /** 보이는 적 기병이 이 부대 쪽으로 달려오는가(속도와 정면 방향만 본다: 플레이어도 화면에서 보는 정보). */
  private cavalryThreat(world: World, sq: Squad): boolean {
    for (const e of world.squads) {
      if (e.team === this.team || !e.ready || !e.mounted || !world.isVisible(e.id, this.team)) {
        continue;
      }
      const dx = sq.x - e.x;
      const dz = sq.z - e.z;
      const d = len2(dx, dz);
      if (d > AI.spearBraceDist) continue;
      const toward = (Math.sin(e.facing) * dx + Math.cos(e.facing) * dz) / Math.max(d, 1);
      if (e.speed > e.stats.walkSpeed * AI.cavThreatSpeedRatio && toward > AI.cavThreatCos) {
        return true;
      }
    }
    return false;
  }

  private bestTarget(world: World, sq: Squad, maxDist: number): Squad | null {
    let best: Squad | null = null;
    let bestScore = -Infinity;
    for (const e of world.squads) {
      if (e.team === this.team || !e.alive || !world.isVisible(e.id, this.team)) continue;
      const d = len2(e.x - sq.x, e.z - sq.z);
      if (d > maxDist) continue;
      const s = this.score(world, sq, e, d);
      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    }
    return best;
  }

  private nearestVisibleEnemy(
    world: World,
    x: number,
    z: number,
    maxDist: number,
    meleeOnly = false,
    mountedOnly = false,
  ): Squad | null {
    let best: Squad | null = null;
    let bd = maxDist;
    for (const e of world.squads) {
      if (e.team === this.team || !e.ready || !world.isVisible(e.id, this.team)) continue;
      if (meleeOnly && e.stats.ranged) continue;
      if (mountedOnly && !e.mounted) continue;
      const d = len2(e.x - x, e.z - z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /** 이 진영 부대가 t의 정면에서 t와 접촉해 있는가. */
  private allyFightsFront(world: World, t: Squad): boolean {
    for (const a of world.squads) {
      if (a.team !== this.team || !a.ready || !isContact(world, a, t)) continue;
      if (sideOf(t, a.x, a.z) === 'front') return true;
    }
    return false;
  }

  /**
   * 표적이 이미 아군과 정면으로 맞붙어 있고 이 부대가 그 정면 쪽에 있으면, 아군 뒤에 겹쳐 서지 말고
   * 표적의 측면 지점으로 먼저 돌아간 뒤 공격한다(망치와 모루, GDD §8.2 기회 점수).
   */
  private attack(world: World, sq: Squad, t: Squad): void {
    if (
      t.engaged &&
      !sq.engaged &&
      this.allyFightsFront(world, t) &&
      sideOf(t, sq.x, sq.z) === 'front'
    ) {
      const rx = Math.cos(t.facing);
      const rz = -Math.sin(t.facing);
      const s = (sq.x - t.x) * rx + (sq.z - t.z) * rz >= 0 ? 1 : -1;
      const off = t.width / 2 + sq.width / 2 + AI.flankClearance;
      const fx = t.x + rx * s * off;
      const fz = t.z + rz * s * off;
      if (world.inPlayArea(fx, fz) && len2(sq.x - fx, sq.z - fz) > AI.waypointReach) {
        this.move(world, sq, fx, fz, Math.atan2(-rx * s, -rz * s));
        return;
      }
    }
    if (sq.order.kind === 'attack' && sq.order.target === t.id) return;
    // 보병 돌격(Z)은 고수 중인 적 정면에는 효과가 없으므로 그때는 쓰지 않는다(GDD §5.4).
    const charge =
      !!sq.stats.footCharge &&
      squadGap(sq, t) < (sq.stats.footCharge?.startGap ?? 0) * 2 &&
      !(t.holding && sideOf(t, sq.x, sq.z) === 'front');
    this.order(
      world,
      sq,
      { kind: charge ? 'charge' : 'attack', team: this.team, squads: [sq.id], target: t.id },
      `atk${t.id}`,
    );
  }

  private move(world: World, sq: Squad, x: number, z: number, facing: number): void {
    const key = `mv${Math.round(x / 10)},${Math.round(z / 10)}`;
    const cmd: Command = Number.isNaN(facing)
      ? { kind: 'move', team: this.team, squads: [sq.id], x, z }
      : { kind: 'move', team: this.team, squads: [sq.id], x, z, facing };
    this.order(world, sq, cmd, key);
  }

  /** 반응 지연 뒤에 큐에 넣는다. 같은 명령을 연달아 내지 않는다. */
  private order(world: World, sq: Squad, cmd: Command, key: string): void {
    const m = this.memo[sq.id];
    if (m.last === key && orderMatches(sq, key)) return;
    m.last = key;
    const delay = AI.reactionMin + this.rng.next() * (AI.reactionMax - AI.reactionMin);
    const tick = world.tick + Math.max(1, Math.round(delay / TICK_DT));
    m.pendingUntil = tick;
    this.pending.push({ tick, cmd });
  }

  /** 같은 역할 부대를 나란히 세우기 위한 좌우 오프셋(m). */
  private slotOffset(world: World, sq: Squad, spacing: number): number {
    const m = this.memo[sq.id];
    let index = 0;
    let count = 0;
    for (const s of world.squads) {
      const o = this.memo[s.id];
      if (s.team !== this.team || !s.alive || o.stance !== m.stance || o.lane !== m.lane) continue;
      if (s.id === sq.id) index = count;
      count++;
    }
    return (index - (count - 1) / 2) * spacing;
  }
}

function orderMatches(sq: Squad, key: string): boolean {
  if (key === 'hold') return sq.order.kind === 'hold';
  if (key.startsWith('atk')) return sq.order.kind === 'attack';
  return sq.order.kind === 'move' || sq.speed > 0.1;
}

function emptyMemo(sq: Squad): Memo {
  return {
    stance: 'hold',
    lane: 'ford',
    wp: 0,
    homeX: sq.x,
    homeZ: sq.z,
    homeFacing: sq.facing,
    last: '',
    pendingUntil: -1,
    committed: false,
    withdrawUntil: -1,
  };
}
