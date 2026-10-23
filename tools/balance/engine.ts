/**
 * 부대 단위 전투 시뮬레이터(밸런스 검증용).
 *
 * 병사마다 HP를 따로 두고 한 명씩 죽인다. 대형은 직사각형(열 수 × 행 수)으로 보고,
 * 접촉 폭·방향(정면/측면/후방)·리치에 따른 공격 열 수로 "몇 명이 싸우는지"를 계산한다.
 * 실제 게임은 병사 개인 에이전트로 움직이므로, 이 결과는 수치의 상대 비교용이다.
 * 고정 틱은 게임과 같은 20Hz(src/sim/constants.ts TICK_RATE).
 */
import { Rng } from '../../src/sim/rng.ts';
import {
  COMBAT,
  MORALE,
  TERRAIN,
  UNIT_TYPES,
  type UnitTypeId,
  type UnitTypeStats,
} from './config.ts';
import {
  attackRanks,
  chargeImpactMult,
  forestBlocksAt,
  lineClear,
  lookDownDeg,
  rangeWithHeight,
  rangedHitChance,
  reductionMult,
  slopeMeleeMult,
  slopeSpeedFactor,
} from './rules.ts';

export const DT = 1 / 20;
const DEG = 180 / Math.PI;

export type TerrainKind = 'grass' | 'forest' | 'sand' | 'ford' | 'bridge' | 'water' | 'rock';

export interface BattleTerrain {
  height(x: number, z: number): number;
  kind(x: number, z: number): TerrainKind;
}

export const FLAT: BattleTerrain = { height: () => 0, kind: () => 'grass' };

export type Side = 'front' | 'flank' | 'rear';

export type Order =
  | { kind: 'hold' }
  | { kind: 'move'; x: number; z: number; run?: boolean }
  | { kind: 'attack'; target: number; charge?: boolean };

export interface UnitSpec {
  type: UnitTypeId;
  team: 0 | 1;
  x: number;
  z: number;
  facing: number; // 라디안, 0 = +Z
  size?: number;
  files?: number;
  order: Order;
  waypoints?: Array<[number, number]>; // attack 전에 거쳐 갈 지점
  cycleCharge?: boolean; // 기병: 교전 후 이탈·재돌격 반복
  pursue?: boolean; // 패주한 적 추격 여부(기본 true, hold면 무시)
  reserveRadius?: number; // hold 중 반경 안 아군이 교전하면 그 적을 공격(예비대)
  label?: string;
}

interface Contact {
  a: BUnit;
  b: BUnit;
  sideA: Side; // a 기준 b가 있는 방향
  sideB: Side;
  frontage: number;
}

export class BUnit {
  readonly t: UnitTypeStats;
  readonly hp: Float64Array;
  n: number;
  readonly start: number;
  files: number;
  x: number;
  z: number;
  facing: number;
  order: Order;
  morale = MORALE.start;
  state: 'ready' | 'routing' | 'shattered' = 'ready';
  rallies = 0;
  stillTime = 0;
  speed = 0;
  charging = false;
  chargeCooldown = 0;
  runDist = 0; // 보병 돌격: 연속으로 달린 거리
  chargeBonusTime = 0; // 보병 돌격: 남은 피해 보너스 시간
  lastLossTime = -999;
  engagedTime = 0;
  pursueTime = 0;
  disengageTime = 0;
  everEngaged = false;
  firstContactTime = -1;
  routTime = -1;
  kills = 0;
  readonly waypoints: Array<[number, number]>;
  readonly cycleCharge: boolean;
  readonly pursue: boolean;
  readonly reserveRadius: number;
  readonly label: string;
  // 틱마다 다시 계산
  contacts: Contact[] = [];
  attackedFlank = false;
  attackedRear = false;
  lossesThisTick = 0;

  readonly id: number;
  readonly team: 0 | 1;

  constructor(id: number, team: 0 | 1, spec: UnitSpec) {
    this.id = id;
    this.team = team;
    this.t = UNIT_TYPES[spec.type];
    this.start = spec.size ?? this.t.size;
    this.n = this.start;
    this.hp = new Float64Array(this.start).fill(this.t.hp);
    this.files = spec.files ?? this.t.files;
    this.x = spec.x;
    this.z = spec.z;
    this.facing = spec.facing;
    this.order = spec.order;
    this.waypoints = spec.waypoints ? spec.waypoints.slice() : [];
    this.cycleCharge = spec.cycleCharge ?? false;
    this.pursue = spec.pursue ?? true;
    this.reserveRadius = spec.reserveRadius ?? 0;
    this.label = spec.label ?? `${this.t.id}#${id}`;
  }

  get curFiles(): number {
    return Math.max(1, Math.min(this.files, this.n));
  }
  get ranks(): number {
    return Math.ceil(this.n / this.curFiles);
  }
  get width(): number {
    return this.curFiles * this.t.fileSpacing;
  }
  get depth(): number {
    return this.ranks * this.t.rankSpacing;
  }
  get alive(): boolean {
    return this.state !== 'shattered' && this.n > 0;
  }
  get braced(): boolean {
    return (
      !!this.t.brace &&
      this.state === 'ready' &&
      this.order.kind === 'hold' &&
      this.stillTime >= this.t.brace.settleTime
    );
  }
  get holding(): boolean {
    return this.state === 'ready' && this.order.kind === 'hold' && this.stillTime >= 1;
  }
}

export interface BattleOptions {
  terrain?: BattleTerrain;
  seed?: number;
  timeLimit?: number;
  /** 'rout': 한 부대라도 패주하면 종료(1:1 교전용). 'army': 실질 병력 25% 미만 팀 패배 */
  endMode?: 'rout' | 'army' | 'time';
  breakRatio?: number;
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** 직사 LOS 판정에서 숲 칸의 장애물 높이(m). 직사가 막히면 곡사(명중 ×0.6)로 쏜다 */
  forestHeight?: number;
  /** 매 틱 시작 전에 호출되는 시나리오 스크립트(간이 AI) */
  script?: (b: Battle) => void;
}

export interface BattleResult {
  winner: 0 | 1 | -1;
  time: number;
  units: BUnit[];
  firstContact: number;
  teamStart: [number, number];
  teamAlive: [number, number];
  teamEffective: [number, number];
}

export class Battle {
  readonly units: BUnit[] = [];
  readonly terrain: BattleTerrain;
  readonly rng: Rng;
  time = 0;
  private prevContacts = new Set<string>();
  private readonly opts: Required<Omit<BattleOptions, 'terrain' | 'seed' | 'bounds' | 'script'>> & {
    bounds: BattleOptions['bounds'];
    script: BattleOptions['script'];
  };
  private readonly teamStart: [number, number] = [0, 0];

  constructor(specs: UnitSpec[], opts: BattleOptions = {}) {
    this.terrain = opts.terrain ?? FLAT;
    this.rng = new Rng(opts.seed ?? 1);
    this.opts = {
      timeLimit: opts.timeLimit ?? 900,
      endMode: opts.endMode ?? 'army',
      breakRatio: opts.breakRatio ?? 0.25,
      forestHeight: opts.forestHeight ?? TERRAIN.forestLosHeight,
      bounds: opts.bounds,
      script: opts.script,
    };
    specs.forEach((s, i) => {
      const u = new BUnit(i, s.team, s);
      this.units.push(u);
      this.teamStart[s.team] += u.start;
    });
  }

  run(): BattleResult {
    let winner: 0 | 1 | -1 = -1;
    while (this.time < this.opts.timeLimit) {
      this.step();
      winner = this.checkEnd();
      if (winner !== -1 || this.ended) break;
    }
    const teamAlive: [number, number] = [0, 0];
    const teamEff: [number, number] = [0, 0];
    for (const u of this.units) {
      teamAlive[u.team] += u.n;
      if (u.state === 'ready') teamEff[u.team] += u.n;
    }
    const contacts = this.units
      .filter((u) => u.firstContactTime >= 0)
      .map((u) => u.firstContactTime);
    return {
      winner,
      time: this.time,
      units: this.units,
      firstContact: contacts.length ? Math.min(...contacts) : -1,
      teamStart: this.teamStart,
      teamAlive,
      teamEffective: teamEff,
    };
  }

  private ended = false;

  private checkEnd(): 0 | 1 | -1 {
    const mode = this.opts.endMode;
    if (mode === 'time') return -1;
    if (mode === 'rout') {
      const routed = this.units.filter((u) => u.state !== 'ready' || u.n === 0);
      if (routed.length === 0) return -1;
      this.ended = true;
      const teams = new Set(routed.map((u) => u.team));
      if (teams.size === 2) return -1;
      return routed[0].team === 0 ? 1 : 0;
    }
    const eff: [number, number] = [0, 0];
    for (const u of this.units) if (u.state === 'ready') eff[u.team] += u.n;
    const lost0 = eff[0] < this.teamStart[0] * this.opts.breakRatio;
    const lost1 = eff[1] < this.teamStart[1] * this.opts.breakRatio;
    if (lost0 && lost1) {
      this.ended = true;
      return -1;
    }
    if (lost0) return 1;
    if (lost1) return 0;
    return -1;
  }

  // ---------------------------------------------------------------- 한 틱
  step(): void {
    this.opts.script?.(this);
    for (const u of this.units) {
      u.contacts = [];
      u.attackedFlank = false;
      u.attackedRear = false;
      u.lossesThisTick = 0;
    }
    const contacts = this.findContacts();
    const now = new Set<string>();
    for (const c of contacts) {
      const key = `${c.a.id}-${c.b.id}`;
      now.add(key);
      if (!this.prevContacts.has(key)) {
        this.resolveImpact(c.a, c.b, c.sideB, c.frontage);
        this.resolveImpact(c.b, c.a, c.sideA, c.frontage);
        for (const u of [c.a, c.b]) {
          if (u.firstContactTime < 0) u.firstContactTime = this.time;
        }
      }
    }
    this.prevContacts = now;
    for (const c of contacts) {
      this.melee(c.a, c.b, c.sideB, c.sideA, c.frontage);
      this.melee(c.b, c.a, c.sideA, c.sideB, c.frontage);
    }
    for (const u of this.units) if (u.t.ranged) this.fire(u);
    this.updateMorale();
    this.move();
    this.time += DT;
  }

  // ---------------------------------------------------------------- 기하
  private side(of: BUnit, other: BUnit): Side {
    const dx = other.x - of.x;
    const dz = other.z - of.z;
    const fx = Math.sin(of.facing);
    const fz = Math.cos(of.facing);
    const f = dx * fx + dz * fz;
    const l = dx * fz - dz * fx;
    const fn = f / (of.depth / 2 + 1);
    const ln = Math.abs(l) / (of.width / 2 + 1);
    const ang = Math.atan2(ln, fn) * DEG;
    if (ang <= 45) return 'front';
    if (ang >= 135) return 'rear';
    return 'flank';
  }

  private support(u: BUnit, ux: number, uz: number): number {
    const fx = Math.sin(u.facing);
    const fz = Math.cos(u.facing);
    const along = Math.abs(ux * fx + uz * fz);
    const across = Math.abs(ux * fz - uz * fx);
    return (across * u.width) / 2 + (along * u.depth) / 2;
  }

  gap(a: BUnit, b: BUnit): number {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    const ux = dx / d;
    const uz = dz / d;
    return d - this.support(a, ux, uz) - this.support(b, -ux, -uz);
  }

  private edge(u: BUnit, s: Side): number {
    return s === 'flank' ? u.depth : u.width;
  }

  /** 변 식별자. 측면은 좌우를 따로 센다. */
  private sideKey(of: BUnit, other: BUnit, s: Side): string {
    if (s !== 'flank') return s;
    const l = (other.x - of.x) * Math.cos(of.facing) - (other.z - of.z) * Math.sin(of.facing);
    return l > 0 ? 'R' : 'L';
  }

  /** of의 s 변을 따라 other가 겹치는 길이(m). 정면·후방은 좌우축, 측면은 앞뒤축으로 투영한다. */
  private overlap(of: BUnit, other: BUnit, s: Side): number {
    const fx = Math.sin(of.facing);
    const fz = Math.cos(of.facing);
    const ax = s === 'flank' ? fx : fz;
    const az = s === 'flank' ? fz : -fx;
    const c = (other.x - of.x) * ax + (other.z - of.z) * az;
    const half = (s === 'flank' ? of.depth : of.width) / 2;
    const oh = this.support(other, ax, az);
    return Math.max(0, Math.min(half, c + oh) - Math.max(-half, c - oh));
  }

  /**
   * 접촉 찾기. 접촉 폭 = 두 부대 변이 실제로 겹치는 길이. 한 변을 여러 적이 나눠 쓰면
   * 가까운 접촉부터 남은 길이만큼 배분한다(같은 변에 두 부대가 붙어도 싸우는 병사 수는 늘지 않는다).
   */
  private findContacts(): Contact[] {
    const live = this.units.filter((u) => u.alive);
    const cands: Array<{ a: BUnit; b: BUnit; g: number }> = [];
    for (const a of live) {
      if (a.team !== 0) continue;
      for (const b of live) {
        if (b.team !== 1) continue;
        if (Math.abs(a.x - b.x) > 250 || Math.abs(a.z - b.z) > 250) continue;
        const g = this.gap(a, b);
        if (g <= COMBAT.contactGap) cands.push({ a, b, g });
      }
    }
    cands.sort((p, q) => p.g - q.g || p.a.id - q.a.id || p.b.id - q.b.id);
    const used = new Map<string, number>();
    const out: Contact[] = [];
    for (const { a, b } of cands) {
      const sideA = this.side(a, b);
      const sideB = this.side(b, a);
      const ka = `${a.id}:${this.sideKey(a, b, sideA)}`;
      const kb = `${b.id}:${this.sideKey(b, a, sideB)}`;
      const remA = this.edge(a, sideA) - (used.get(ka) ?? 0);
      const remB = this.edge(b, sideB) - (used.get(kb) ?? 0);
      const frontage = Math.min(this.overlap(a, b, sideA), this.overlap(b, a, sideB), remA, remB);
      if (frontage < 1) continue;
      used.set(ka, (used.get(ka) ?? 0) + frontage);
      used.set(kb, (used.get(kb) ?? 0) + frontage);
      const c: Contact = { a, b, sideA, sideB, frontage };
      out.push(c);
      a.contacts.push(c);
      b.contacts.push(c);
    }
    return out;
  }

  // ---------------------------------------------------------------- 전투
  private poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 30) {
      // 정규 근사
      const u1 = this.rng.next() || 1e-9;
      const u2 = this.rng.next();
      const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * g));
    }
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.rng.next();
    } while (p > L);
    return k - 1;
  }

  /** 방어자 병사 1명에게 피해. 앞쪽 slots 명 중 무작위. 죽으면 뒤 병사가 앞으로(스왑). */
  private damage(def: BUnit, amount: number, slots: number, by: BUnit): void {
    if (def.n <= 0) return;
    const k = Math.floor(this.rng.next() * Math.min(def.n, Math.max(1, slots)));
    def.hp[k] -= amount;
    if (def.hp[k] <= 0) {
      def.n--;
      def.hp[k] = def.hp[def.n];
      def.lossesThisTick++;
      def.lastLossTime = this.time;
      by.kills++;
    }
  }

  /** 피해 감소율. 원거리 방패는 막기 확률로 따로 처리하므로 여기에는 갑옷만 들어간다. */
  private reduction(def: BUnit, side: Side, ranged: boolean): number {
    let r = def.t.armor;
    if (side === 'front' && !ranged) {
      r += def.t.shield * COMBAT.shieldMeleeFactor + (def.holding ? def.t.holdArmorBonus : 0);
    }
    return r;
  }

  private meleeMult(att: BUnit, def: BUnit, defSide: Side): number {
    let m = COMBAT.dirMult[defSide];
    const d = Math.hypot(def.x - att.x, def.z - att.z);
    m *= slopeMeleeMult(
      lookDownDeg(this.terrain.height(att.x, att.z), this.terrain.height(def.x, def.z), d),
    );
    if (def.t.mounted) m *= att.t.antiMounted;
    if (att.morale < MORALE.waver) m *= COMBAT.waverDamageMult;
    if (att.chargeBonusTime > 0 && att.t.footCharge) m *= att.t.footCharge.mult;
    if (this.terrain.kind(att.x, att.z) === 'ford') m *= TERRAIN.fordDamageMult;
    return m;
  }

  private melee(att: BUnit, def: BUnit, defSide: Side, attSide: Side, frontage: number): void {
    if (att.state !== 'ready' || att.n <= 0 || def.n <= 0) return;
    if (att.disengageTime > 0) return;
    if (defSide === 'flank') def.attackedFlank = true;
    if (defSide === 'rear') def.attackedRear = true;
    // 공격자는 자신의 접촉 변에서 리치가 닿는 열까지 싸운다.
    const attFiles =
      attSide === 'flank' ? frontage / att.t.rankSpacing : frontage / att.t.fileSpacing;
    const ranks =
      attSide === 'front' ? Math.min(att.ranks, attackRanks(att.t.reach, att.t.rankSpacing)) : 1;
    const fighters = Math.min(att.n, Math.max(1, Math.floor(attFiles)) * ranks);
    const lambda = (fighters * DT * COMBAT.meleeHitChance) / att.t.meleeInterval;
    const hits = this.poisson(lambda);
    if (hits === 0) return;
    const per =
      att.t.meleeDamage *
      this.meleeMult(att, def, defSide) *
      reductionMult(this.reduction(def, defSide, false));
    const defSlots =
      defSide === 'flank'
        ? Math.floor(frontage / def.t.rankSpacing) * 2
        : Math.floor(frontage / def.t.fileSpacing);
    for (let i = 0; i < hits; i++) this.damage(def, per, defSlots, att);
  }

  /** 접촉 첫 틱: 돌격 충격과 Brace 반격. */
  private resolveImpact(att: BUnit, def: BUnit, defSide: Side, frontage: number): void {
    const fc = att.t.footCharge;
    if (fc && att.runDist > 0) {
      const blocked = defSide === 'front' && def.holding;
      if (att.runDist >= fc.runUp && att.state === 'ready' && !blocked) {
        att.chargeBonusTime = fc.duration;
        def.morale -= defSide === 'front' ? MORALE.footChargeShockFront : MORALE.chargeShockFlank;
      }
      if (att.runDist >= fc.runUp) att.chargeCooldown = fc.cooldown;
      att.runDist = 0;
    }
    if (!att.charging || !att.t.charge || att.state !== 'ready') return;
    const ch = att.t.charge;
    att.charging = false;
    att.chargeCooldown = ch.cooldown;
    const ratio = att.speed / ch.speed;
    const mult = chargeImpactMult(ratio, ch.minSpeedRatio);
    if (mult === 0) return;
    const riders = Math.min(
      att.n,
      Math.floor(frontage / att.t.fileSpacing) * Math.min(2, att.ranks),
    );
    const braced = def.braced && defSide === 'front';
    let per =
      ch.damage *
      mult *
      this.meleeMult(att, def, defSide) *
      reductionMult(this.reduction(def, defSide, false));
    if (braced) per *= 1 - def.t.brace!.impactReduction;
    const hits = this.poisson(riders * ch.targets * COMBAT.chargeHitChance);
    const slots = Math.floor(frontage / def.t.fileSpacing) * 2;
    for (let i = 0; i < hits; i++) this.damage(def, per, slots, att);
    def.morale -= defSide === 'front' ? MORALE.chargeShockFront : MORALE.chargeShockFlank;
    if (braced) {
      const spears = Math.min(def.n, Math.floor(frontage / def.t.fileSpacing) * 2);
      const firstRank = Math.min(att.n, Math.floor(frontage / att.t.fileSpacing));
      const counter =
        def.t.brace!.counterDamage * mult * reductionMult(this.reduction(att, 'front', false));
      const ch2 = this.poisson(spears * COMBAT.chargeHitChance);
      for (let i = 0; i < ch2; i++) this.damage(att, counter, firstRank, def);
      att.speed = 0;
    }
  }

  private losClear(a: BUnit, b: BUnit, arc: boolean): boolean {
    const ay = this.terrain.height(a.x, a.z) + TERRAIN.eyeHeight;
    const by = this.terrain.height(b.x, b.z) + 1;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const fh = this.opts.forestHeight;
    return lineClear(
      ay,
      by,
      d,
      (t) => {
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const forest =
          this.terrain.kind(x, z) === 'forest' && forestBlocksAt(t, d, TERRAIN.forestHideDist);
        return this.terrain.height(x, z) + (forest ? fh : 0);
      },
      arc ? 1 : 0,
    );
  }

  private fire(u: BUnit): void {
    const r = u.t.ranged!;
    if (u.state !== 'ready' || u.contacts.length > 0 || u.stillTime < 1 || u.n <= 0) return;
    const hy = this.terrain.height(u.x, u.z);
    let best: BUnit | null = null;
    let bestD = Infinity;
    const want = u.order.kind === 'attack' ? this.units[u.order.target] : null;
    for (const e of this.units) {
      if (e.team === u.team || !e.alive) continue;
      // 아군과 근접 중인 적은 오사 위험 때문에 자동 사격하지 않는다(명령 표적은 예외)
      if (e !== want && e.contacts.length > 0) continue;
      const d = Math.hypot(e.x - u.x, e.z - u.z);
      const R = rangeWithHeight(r.range, hy - this.terrain.height(e.x, e.z));
      if (d > R || d < r.minRange) continue;
      const score = e === want ? -1 : d;
      if (score < bestD) {
        bestD = score;
        best = e;
      }
    }
    if (!best) return;
    const d = Math.hypot(best.x - u.x, best.z - u.z);
    const R = rangeWithHeight(r.range, hy - this.terrain.height(best.x, best.z));
    const direct = this.losClear(u, best, false);
    if (!direct && !this.losClear(u, best, true)) return;
    let p = rangedHitChance(r.hitNear, r.hitFar, d, R);
    if (!direct) p *= COMBAT.arcHitMult;
    if (best.t.mounted) p *= COMBAT.mountedTargetMult;
    if (this.terrain.kind(best.x, best.z) === 'forest') p *= COMBAT.forestCoverHitMult;
    const side = this.side(best, u);
    const per = r.damage * reductionMult(this.reduction(best, side, true));
    const block = side === 'front' ? best.t.shield * (direct ? 1 : COMBAT.arcShieldMult) : 0;
    const hits = this.poisson((u.n * DT * p) / r.interval);
    for (let i = 0; i < hits; i++) {
      if (this.rng.next() < block) continue;
      this.damage(best, per, best.n, u);
    }
  }

  // ---------------------------------------------------------------- 사기
  private commanderNear(_u: BUnit): boolean {
    return false; // 시뮬레이터 v0.1은 지휘관 오라를 다루지 않는다
  }

  private updateMorale(): void {
    for (const u of this.units) {
      if (u.state !== 'shattered' && u.n === 0) u.state = 'shattered';
      if (!u.alive) continue;
      const lossMult = this.commanderNear(u) ? MORALE.commanderAuraLossMult : 1;
      if (u.lossesThisTick > 0) {
        u.morale -= ((MORALE.perLossPct * 100 * u.lossesThisTick) / u.start) * lossMult;
      }
      if (u.n === 0) {
        u.state = 'shattered';
        continue;
      }
      if (u.state === 'ready') {
        if (u.contacts.length > 0) {
          u.engagedTime += DT;
          u.everEngaged = true;
          u.morale -= MORALE.meleePerSec * DT * lossMult;
        }
        if (u.attackedRear) u.morale -= MORALE.rearPerSec * DT * lossMult;
        else if (u.attackedFlank) u.morale -= MORALE.flankPerSec * DT * lossMult;
        if (u.contacts.length === 0 && this.time - u.lastLossTime > 10) {
          const cap = MORALE.start - 100 * (1 - u.n / u.start) * MORALE.recoverCapLossFactor;
          if (u.morale < cap) u.morale = Math.min(cap, u.morale + MORALE.recoverPerSec * DT);
        }
        if (u.morale <= MORALE.rout) this.startRout(u);
      } else if (u.state === 'routing') {
        const near = this.nearestEnemy(u, false);
        const dist = near ? Math.hypot(near.x - u.x, near.z - u.z) : Infinity;
        if (dist >= MORALE.rallySafeDist) {
          u.morale = Math.min(MORALE.rallyMorale, u.morale + MORALE.rallyRecoverPerSec * DT);
          const canRally =
            u.rallies < MORALE.maxRallies && u.n / u.start >= MORALE.rallyMinStrength;
          if (canRally && u.morale >= MORALE.rallyMorale) {
            u.state = 'ready';
            u.rallies++;
            u.order = { kind: 'hold' };
            u.stillTime = 0;
          } else if (!canRally && dist > MORALE.shatterDist) {
            u.state = 'shattered';
          }
        }
        const b = this.opts.bounds;
        if (b && (u.x < b.minX || u.x > b.maxX || u.z < b.minZ || u.z > b.maxZ))
          u.state = 'shattered';
      }
    }
  }

  private startRout(u: BUnit): void {
    u.state = 'routing';
    u.routTime = this.time;
    u.charging = false;
    u.morale = Math.min(u.morale, MORALE.rout);
    for (const o of this.units) {
      if (o === u || o.team !== u.team || o.state !== 'ready') continue;
      if (Math.hypot(o.x - u.x, o.z - u.z) <= MORALE.nearbyRoutRadius)
        o.morale -= MORALE.nearbyRout;
    }
  }

  // ---------------------------------------------------------------- 이동
  nearestEnemy(u: BUnit, readyOnly: boolean): BUnit | null {
    let best: BUnit | null = null;
    let bd = Infinity;
    for (const e of this.units) {
      if (e.team === u.team || !e.alive) continue;
      if (readyOnly && e.state !== 'ready') continue;
      const d = Math.hypot(e.x - u.x, e.z - u.z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private terrainSpeed(u: BUnit, dirX: number, dirZ: number): number {
    const k = this.terrain.kind(u.x, u.z);
    if (k === 'water' || k === 'rock') return 0.2; // 시뮬레이터에서는 빠져나오기만 허용
    const ts = TERRAIN.typeSpeed[k as keyof typeof TERRAIN.typeSpeed];
    const typeF = ts ? ts[u.t.mounted ? 1 : 0] : 1;
    const e = 1;
    const h0 = this.terrain.height(u.x, u.z);
    const h1 = this.terrain.height(u.x + dirX * e, u.z + dirZ * e);
    const slopeDeg = Math.atan2(h1 - h0, e) * DEG;
    return typeF * Math.max(0.2, slopeSpeedFactor(slopeDeg));
  }

  private moveToward(
    u: BUnit,
    tx: number,
    tz: number,
    baseSpeed: number,
    stopDist: number,
  ): boolean {
    const dx = tx - u.x;
    const dz = tz - u.z;
    const d = Math.hypot(dx, dz);
    if (d <= stopDist + 1e-3) return true;
    const ux = dx / d;
    const uz = dz / d;
    u.facing = Math.atan2(ux, uz);
    const v = baseSpeed * this.terrainSpeed(u, ux, uz);
    u.speed = v;
    const step = Math.min(v * DT, d - stopDist);
    u.x += ux * step;
    u.z += uz * step;
    return false;
  }

  private move(): void {
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u.chargeCooldown > 0) u.chargeCooldown -= DT;
      if (u.chargeBonusTime > 0) u.chargeBonusTime -= DT;
      const moved = this.moveUnit(u);
      if (moved) u.stillTime = 0;
      else {
        u.stillTime += DT;
        u.speed = 0;
      }
    }
  }

  /** @returns 이번 틱에 움직였는지 */
  private moveUnit(u: BUnit): boolean {
    if (u.state === 'routing') {
      const e = this.nearestEnemy(u, true) ?? this.nearestEnemy(u, false);
      if (!e) return false;
      const dx = u.x - e.x;
      const dz = u.z - e.z;
      const d = Math.hypot(dx, dz) || 1;
      this.moveToward(
        u,
        u.x + (dx / d) * 10,
        u.z + (dz / d) * 10,
        u.t.runSpeed * MORALE.routSpeedMult,
        0,
      );
      return true;
    }
    if (u.disengageTime > 0) {
      u.disengageTime -= DT;
      const e = u.order.kind === 'attack' ? this.units[u.order.target] : this.nearestEnemy(u, true);
      if (e) {
        const dx = u.x - e.x;
        const dz = u.z - e.z;
        const d = Math.hypot(dx, dz) || 1;
        this.moveToward(u, u.x + (dx / d) * 10, u.z + (dz / d) * 10, u.t.runSpeed, 0);
      }
      if (u.disengageTime <= 0 && u.order.kind === 'attack') u.engagedTime = 0;
      return true;
    }
    // 예비대: hold 중 반경 안에 들어온 적, 또는 반경 안 아군과 교전 중인 적에게 반격
    if (u.order.kind === 'hold' && u.reserveRadius > 0 && u.contacts.length === 0) {
      const e = this.nearestEnemy(u, true);
      if (e && Math.hypot(e.x - u.x, e.z - u.z) <= u.reserveRadius) {
        u.order = { kind: 'attack', target: e.id };
      } else {
        for (const f of this.units) {
          if (f.team !== u.team || f === u || f.contacts.length === 0) continue;
          if (Math.hypot(f.x - u.x, f.z - u.z) > u.reserveRadius) continue;
          const c = f.contacts[0];
          const enemy = c.a === f ? c.b : c.a;
          u.order = { kind: 'attack', target: enemy.id };
          break;
        }
      }
    }
    if (u.order.kind === 'hold') return false;
    if (u.order.kind === 'move') {
      const o = u.order;
      if (u.contacts.length > 0) return false;
      const arrived = this.moveToward(u, o.x, o.z, o.run ? u.t.runSpeed : u.t.walkSpeed, 0.5);
      if (arrived) {
        u.order = { kind: 'hold' };
        return false;
      }
      return true;
    }
    // attack
    let target = this.units[u.order.target];
    const pursuitLimit = u.t.mounted ? MORALE.pursuitTimeMounted : MORALE.pursuitTimeFoot;
    if (
      !target.alive ||
      (target.state === 'routing' && (!u.pursue || u.pursueTime > pursuitLimit))
    ) {
      const next = this.nearestEnemy(u, true);
      u.pursueTime = 0;
      if (!next) return false;
      u.order = { kind: 'attack', target: next.id };
      target = next;
    }
    if (target.state === 'routing') u.pursueTime += DT;
    if (u.waypoints.length > 0) {
      const [wx, wz] = u.waypoints[0];
      if (this.moveToward(u, wx, wz, u.t.mounted ? u.t.runSpeed : u.t.walkSpeed, 2))
        u.waypoints.shift();
      return true;
    }
    // 원거리 병종은 사거리 안이면 멈춰 쏜다
    if (u.t.ranged) {
      const R = rangeWithHeight(
        u.t.ranged.range,
        this.terrain.height(u.x, u.z) - this.terrain.height(target.x, target.z),
      );
      const d = Math.hypot(target.x - u.x, target.z - u.z);
      if (d <= R * 0.9 && u.contacts.length === 0) return false;
    }
    const inContactWithTarget = u.contacts.some((c) => c.a === target || c.b === target);
    if (inContactWithTarget) {
      if (u.cycleCharge && u.t.charge && u.engagedTime > 6) {
        u.disengageTime = 5;
        u.engagedTime = 0;
      }
      return false;
    }
    if (u.contacts.length > 0) return false; // 다른 적과 교전 중이면 그 자리에서 싸운다
    const gap = this.gap(u, target);
    const ch = u.t.charge;
    let speed = u.t.walkSpeed;
    if (ch && u.chargeCooldown <= 0 && u.morale >= MORALE.waver && gap < ch.startGap) {
      u.charging = true;
    }
    if (u.charging && ch) {
      const accel = (ch.speed * ch.speed - u.t.walkSpeed * u.t.walkSpeed) / (2 * ch.runUp);
      const top = ch.speed;
      speed = Math.min(top, Math.max(u.speed, u.t.walkSpeed) + accel * DT);
    } else if (u.t.mounted) {
      speed = gap > 60 ? u.t.runSpeed : u.t.walkSpeed;
    } else if (target.state === 'routing') {
      speed = u.t.runSpeed;
    }
    const fc = u.t.footCharge;
    const footCharging =
      !!fc &&
      u.order.kind === 'attack' &&
      !!u.order.charge &&
      u.chargeCooldown <= 0 &&
      u.morale >= MORALE.waver &&
      gap < fc.startGap;
    if (footCharging) speed = u.t.runSpeed;
    const dx = target.x - u.x;
    const dz = target.z - u.z;
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d;
    const uz = dz / d;
    u.facing = Math.atan2(ux, uz);
    // 실제 속도 = 가속 속도 × 지형 계수. 충격 속도비는 이 실제 속도로 계산한다(내리막 보너스·숲 감속 반영).
    const v = speed * this.terrainSpeed(u, ux, uz);
    const step = Math.max(0, Math.min(v * DT, gap - COMBAT.contactGap * 0.5));
    u.x += ux * step;
    u.z += uz * step;
    u.speed = v;
    // 숲·여울처럼 달리기 속도의 70% 미만이면 돌격 거리로 치지 않는다
    if (footCharging && v >= u.t.runSpeed * 0.7) u.runDist += step;
    else if (!footCharging) u.runDist = 0;
    return step > 0;
  }
}

export function runBattle(specs: UnitSpec[], opts: BattleOptions = {}): BattleResult {
  return new Battle(specs, opts).run();
}
