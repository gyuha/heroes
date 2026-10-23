/**
 * [목업] UiSession 개발용 구현. 실제 게임은 B의 src/app/gameSession.ts를 쓴다. 이 목업은 개발 화면에서
 * 원하는 장면(교전·결과)을 바로 열어 UI를 검증하는 데만 쓴다.
 *
 * 전투 규칙은 흉내만 낸다(교전 피해·사기·패주·AI는 단순화). 대신 지형 효과는 A·B의 실제 함수를 쓴다:
 * 맵(GameMap), 경로 탐색(Pathfinder), 이동 계수(terrainRules.moveFactor), 시야(lineOfSight),
 * 사격선(fireLine), 고도차 사거리(rules.rangeWithHeight).
 */
import type {
  BattleResult,
  Command,
  CommandResult,
  DeployCheck,
  FlagState,
  FlagView,
  FormationId,
  GamePhase,
  GameSpeed,
  MoraleBand,
  RoutCause,
  Side,
  SimEvent,
  SquadActivity,
  SquadState,
  SquadView,
  TeamId,
  TeamStrength,
  UnitTypeId,
} from '../../sim/api';
import { FORMATIONS, MORALE, TERRAIN, UNIT_TYPES } from '../../sim/data/balance';
import { rangeWithHeight } from '../../sim/rules';
import { type Terrain, TerrainType } from '../../sim/terrain';
import { fireLine, lineOfSight, moveFactor, typeSpeedFactor } from '../../sim/terrainRules';
import { TICK_DT } from '../../sim/constants';
import { UNIT_TYPE_ORDER, type UnitStore } from '../../sim/units';
import type {
  MapFeatureView,
  MoveSlot,
  PathPreviewView,
  RangeProfileView,
  TerrainInfoView,
  UiSession,
  ZoneRect,
} from '../gameView';
import type { GameMap } from '../../sim/map/gameMap';
import { Pathfinder } from '../../sim/map/pathfinder';

const TEAM_NAME = ['청람', '황토'] as const;
const KIND_NAME: Record<UnitTypeId, string> = {
  infantry: '보병',
  spearman: '창병',
  archer: '궁수',
  cavalry: '기병',
};
const CAPTURE_TIME = 60;
const TIME_LIMIT = 900;
const VISION_RANGE = 350;
const RANGE_DIRECTIONS = 72;
const RANGE_STEP = 4;
const PATH_STEP = 4;
const SQUAD_GAP = 4;
const LOG_COOLDOWN = 10;

class MockSquad implements SquadView {
  state: SquadState = 'ready';
  activity: SquadActivity = 'idle';
  order: SquadView['order'] = 'none';
  targetId = -1;
  formation: FormationId = 'line';
  files: number;
  width = 0;
  depth = 0;
  count: number;
  morale = 100;
  moraleBand: MoraleBand = 'steady';
  chargeCooldown = 0;
  canCharge: boolean;
  shieldWall = false;
  braced = false;
  concealed = false;
  autoNarrowed = false;
  heightBonusPct = 0;
  kills = 0;
  // 목업 내부 상태
  destX = 0;
  destZ = 0;
  destFacing: number | null = null;
  hasDest = false;
  stillTime = 0;
  exposedUntil = -1;
  visibleToEnemy = false;
  lastSeenByEnemy: { x: number; z: number; time: number } | null = null;
  routCause: RoutCause = 'losses';
  routTime = 0;
  causeLoss: Partial<Record<RoutCause, number>> = {};
  logAt = new Map<string, number>();
  chargeFailedLogged = false;
  slot0 = 0;

  constructor(
    readonly id: number,
    readonly team: TeamId,
    readonly type: UnitTypeId,
    readonly isCommander: boolean,
    readonly name: string,
    public x: number,
    public z: number,
    public facing: number,
    readonly startCount: number,
  ) {
    this.count = startCount;
    this.files = isCommander ? 10 : UNIT_TYPES[type].files;
    this.canCharge = type === 'cavalry';
    this.updateShape();
  }

  get stats() {
    return UNIT_TYPES[this.type];
  }

  spacingMult(): number {
    return this.formation === 'loose' ? FORMATIONS.loose.spacingMult : 1;
  }

  updateShape(): void {
    const files = Math.max(1, Math.min(this.files, this.count));
    this.width = files * this.stats.fileSpacing * this.spacingMult();
    this.depth = Math.ceil(this.count / files) * this.stats.rankSpacing * this.spacingMult();
  }
}

export interface MockOptions {
  map: GameMap;
  /** 처음 단계. 개발 화면에서 바로 전투·결과 화면을 볼 때 쓴다. */
  startPhase?: GamePhase;
  playerTeam?: TeamId;
}

export class MockSession implements UiSession {
  phase: GamePhase = 'briefing';
  playerTeam: TeamId | null = 0;
  paused = false;
  speed: GameSpeed = 1;
  /** 개발 화면 ?maxSpeed=2 로 4배속 제한 표시를 확인한다(D-016). */
  maxSpeed: GameSpeed = 4;
  speedLimitReason: string | null = null;
  /** 개발 화면 ?scale=k 표시 확인용(병력 수는 바꾸지 않는다) */
  scale = 1;
  battleTime = 0;
  readonly timeLimit = TIME_LIMIT;
  readonly terrain: Terrain;

  private readonly map: GameMap;
  private readonly pathfinder: Pathfinder;
  private readonly zones: readonly [ZoneRect, ZoneRect];
  private readonly flagPos: { x: number; z: number; radius: number };
  private squadList: MockSquad[] = [];
  private listeners = new Set<(e: SimEvent) => void>();
  private flagState: FlagState = 'defended';
  private flagProgress = 0;
  private overtime = false;
  private flagTimer = 0;
  private visTimer = 0;
  private lastResult: BattleResult | null = null;
  private flankCount: [number, number] = [0, 0];
  private rearCount: [number, number] = [0, 0];
  private highGroundSec: [number, number] = [0, 0];
  private meleeSec: [number, number] = [0, 0];
  private readonly attackerTeam: TeamId = 1;

  constructor(opts: MockOptions) {
    this.map = opts.map;
    this.terrain = opts.map.terrain;
    this.pathfinder = new Pathfinder(opts.map);
    this.zones = [opts.map.deploymentZone(0), opts.map.deploymentZone(1)];
    this.flagPos = opts.map.flag() ?? { x: 420, z: 432, radius: 40 };
    this.playerTeam = opts.playerTeam ?? 0;
    this.spawn();
  }

  // ---------------------------------------------------------------- 단계 전환
  chooseSide(team: TeamId): void {
    this.playerTeam = team;
    this.spawn();
    this.setPhase('deployment');
  }
  backToBriefing(): void {
    this.spawn();
    this.setPhase('briefing');
  }
  startBattle(): void {
    if (this.phase !== 'deployment') return;
    this.setPhase('battle');
    this.planEnemy();
  }
  restart(): void {
    this.spawn();
    this.setPhase('deployment');
  }
  surrender(): void {
    if (this.phase !== 'battle' || this.playerTeam === null) return;
    this.finish(this.playerTeam === 0 ? 1 : 0, 'surrender');
  }
  setPaused(p: boolean): void {
    this.paused = p;
  }
  setSpeed(s: GameSpeed): void {
    this.speed = s;
  }

  // ---------------------------------------------------------------- 명령
  issue(cmd: Command): CommandResult {
    if (cmd.kind === 'deploy') {
      if (this.phase !== 'deployment') return 'wrongPhase';
      const s = this.squadList[cmd.squad];
      if (!s || s.team !== cmd.team) return 'notYourSquad';
      if (!this.canDeploy(cmd.squad, cmd.x, cmd.z, cmd.facing).ok) return 'invalidPlacement';
      s.x = cmd.x;
      s.z = cmd.z;
      s.facing = cmd.facing;
      if (cmd.files !== undefined) s.files = cmd.files;
      if (cmd.formation) s.formation = cmd.formation;
      s.updateShape();
      return 'ok';
    }
    if (cmd.squads.length === 0) return 'noSelection';
    const own = cmd.squads
      .map((id) => this.squadList[id])
      .filter((s) => s && s.team === cmd.team && s.state === 'ready');
    if (own.length === 0) return 'notYourSquad';
    if (this.phase !== 'battle' && cmd.kind !== 'formation') return 'wrongPhase';

    switch (cmd.kind) {
      case 'move': {
        const slots = this.planMoveSlots(
          own.map((s) => s.id),
          cmd.x,
          cmd.z,
          cmd.facing,
          cmd.width,
        );
        for (const slot of slots) {
          const s = this.squadList[slot.squadId];
          s.order = 'move';
          s.targetId = -1;
          s.destX = slot.x;
          s.destZ = slot.z;
          s.destFacing = cmd.facing ?? null;
          s.hasDest = true;
          if (cmd.width !== undefined) s.files = slot.files;
          this.clearHold(s);
        }
        return 'ok';
      }
      case 'attack': {
        const t = this.squadList[cmd.target];
        if (!t || t.team === cmd.team || t.state === 'destroyed') return 'invalidTarget';
        for (const s of own) {
          s.order = 'attack';
          s.targetId = t.id;
          s.hasDest = false;
          this.clearHold(s);
        }
        return 'ok';
      }
      case 'charge': {
        for (const s of own) {
          if (cmd.target !== undefined) s.targetId = cmd.target;
          if (s.targetId < 0) continue;
          s.order = 'attack';
          this.clearHold(s);
          if (s.canCharge && s.chargeCooldown <= 0 && s.moraleBand === 'steady') {
            s.activity = 'charging';
          }
        }
        return 'ok';
      }
      case 'advance':
        for (const s of own) {
          s.order = 'advance';
          s.hasDest = false;
          s.targetId = -1;
          this.clearHold(s);
        }
        return 'ok';
      case 'hold':
        for (const s of own) {
          s.order = 'hold';
          s.hasDest = false;
          s.activity = 'holding';
          s.stillTime = 0;
        }
        return 'ok';
      case 'formation':
        for (const s of own) {
          s.formation = cmd.formation;
          s.files =
            cmd.files ??
            (cmd.formation === 'column' ? FORMATIONS.column.files : UNIT_TYPES[s.type].files);
          s.updateShape();
        }
        return 'ok';
    }
  }

  canDeploy(squad: number, x: number, z: number, _facing?: number): DeployCheck {
    if (this.phase !== 'deployment') return { ok: false, reason: 'wrongPhase' };
    const s = this.squadList[squad];
    if (!s || s.team !== this.playerTeam) return { ok: false, reason: 'notYourSquad' };
    const zone = this.zones[s.team];
    if (x < zone.minX || x > zone.maxX || z < zone.minZ || z > zone.maxZ) {
      return { ok: false, reason: 'outsideZone' };
    }
    if (!this.terrain.passableAt(x, z) || !this.map.inPlayArea(x, z)) {
      return { ok: false, reason: 'impassable' };
    }
    return { ok: true };
  }

  planMoveSlots(
    squads: readonly number[],
    x: number,
    z: number,
    facing?: number,
    width?: number,
  ): MoveSlot[] {
    const list = squads.map((id) => this.squadList[id]).filter(Boolean);
    if (list.length === 0) return [];
    if (facing === undefined || width === undefined) {
      let cx = 0;
      let cz = 0;
      for (const s of list) {
        cx += s.x;
        cz += s.z;
      }
      cx /= list.length;
      cz /= list.length;
      return list.map((s) => ({
        squadId: s.id,
        x: x + s.x - cx,
        z: z + s.z - cz,
        facing: list.length === 1 ? Math.atan2(x - s.x, z - s.z) : Math.atan2(x - cx, z - cz),
        files: s.files,
      }));
    }
    // 오른쪽 벡터 = (−cos a, sin a). 선분 시작 = 중점 − 오른쪽 × 폭/2
    const ux = -Math.cos(facing);
    const uz = Math.sin(facing);
    const x0 = x - (ux * width) / 2;
    const z0 = z - (uz * width) / 2;
    const ordered = [...list].sort((a, b) => a.x * ux + a.z * uz - (b.x * ux + b.z * uz));
    const n = ordered.length;
    const segment = Math.max(1, (width - SQUAD_GAP * (n - 1)) / n);
    return ordered.map((s, i) => {
      const t = (width / n) * (i + 0.5);
      const spacing = s.stats.fileSpacing * s.spacingMult();
      const files = Math.round(segment / spacing);
      return {
        squadId: s.id,
        x: x0 + ux * t,
        z: z0 + uz * t,
        facing,
        files: Math.min(FORMATIONS.maxFiles, Math.max(FORMATIONS.minFiles, files)),
      };
    });
  }

  // ---------------------------------------------------------------- 읽기
  squads(): readonly SquadView[] {
    return this.squadList;
  }
  squad(id: number): SquadView {
    return this.squadList[id];
  }
  strength(team: TeamId): TeamStrength {
    let start = 0;
    let effective = 0;
    let routing = 0;
    for (const s of this.squadList) {
      if (s.team !== team) continue;
      start += s.startCount;
      if (s.state === 'ready') effective += s.count;
      else if (s.state === 'routing') routing += s.count;
    }
    return { start, effective, routing, lost: start - effective - routing };
  }
  flag(): FlagView {
    return {
      x: this.flagPos.x,
      z: this.flagPos.z,
      radius: this.flagPos.radius,
      state: this.flagState,
      progress: this.flagProgress,
      captureTime: CAPTURE_TIME,
      overtime: this.overtime,
    };
  }
  isVisible(squad: number, toTeam: TeamId): boolean {
    const s = this.squadList[squad];
    return s.team === toTeam || s.visibleToEnemy;
  }
  lastSeen(squad: number, byTeam: TeamId) {
    const s = this.squadList[squad];
    if (s.team === byTeam || s.visibleToEnemy || !s.lastSeenByEnemy) return null;
    return this.battleTime - s.lastSeenByEnemy.time <= 10 ? s.lastSeenByEnemy : null;
  }
  deploymentZone(team: TeamId): ZoneRect {
    return this.zones[team];
  }
  result(): BattleResult | null {
    return this.lastResult;
  }
  onEvent(listener: (e: SimEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  terrainInfo(x: number, z: number, type: UnitTypeId | null): TerrainInfoView {
    const t = this.terrain;
    const id = t.typeAt(x, z);
    const slopeDeg = (t.slopeAt(x, z) * 180) / Math.PI;
    const passable = t.passableAt(x, z);
    const pct = (f: number) => `${Math.round(f * 100)}%`;
    const foot = typeSpeedFactor(id, false);
    const horse = typeSpeedFactor(id, true);
    const speedText =
      foot === horse ? `이동 ${pct(foot)}` : `이동 ${pct(foot)} · 기병 ${pct(horse)}`;
    const names: Record<number, string> = {
      [TerrainType.Grass]: '평지',
      [TerrainType.Forest]: '숲',
      [TerrainType.Rock]: '절벽',
      [TerrainType.Sand]: '흙길',
      [TerrainType.Water]: '강',
      [TerrainType.Ford]: '여울',
      [TerrainType.Bridge]: '다리',
    };
    const effects: string[] = [];
    if (!passable) {
      effects.push(
        id === TerrainType.Water || id === TerrainType.Rock
          ? '통과 불가'
          : '통과 불가 — 경사 30° 초과',
      );
    } else {
      if (id !== TerrainType.Grass) effects.push(speedText);
      if (id === TerrainType.Forest) {
        effects.push('은폐 — 40m 밖에서 안 보임', '돌격 불가', '안의 표적 화살 명중 ×0.5');
      }
      if (id === TerrainType.Ford)
        effects.push('돌격 불가', `공격 ×${TERRAIN.fordDamageMult}`, 'Brace 불가');
      if (id === TerrainType.Bridge) effects.push('좁은 통로 — 종대로 통과');
    }
    let factor: number | null = null;
    if (type) {
      const g = new Float32Array(2);
      t.gradientAt(x, z, g);
      const len = Math.hypot(g[0], g[1]);
      factor = moveFactor(
        t,
        x,
        z,
        len > 1e-6 ? g[0] : 0,
        len > 1e-6 ? g[1] : 1,
        UNIT_TYPES[type].mounted,
      );
    }
    return {
      typeName: names[id] ?? `종류 ${id}`,
      height: t.heightAt(x, z),
      slopeDeg,
      passable,
      moveFactor: factor,
      effects,
    };
  }

  moveFactorAt(type: UnitTypeId, x: number, z: number, dirX: number, dirZ: number): number {
    return moveFactor(this.terrain, x, z, dirX, dirZ, UNIT_TYPES[type].mounted);
  }

  previewPath(squad: number, toX: number, toZ: number): PathPreviewView {
    const s = this.squadList[squad];
    const mounted = s.stats.mounted;
    const r = this.pathfinder.findPath(s.x, s.z, toX, toZ, { mounted });
    const pts = [{ x: s.x, z: s.z }, ...r.points];
    const points = new Float32Array(pts.length * 2);
    const factors = new Float32Array(pts.length);
    let throughForest = false;
    let throughBridge = false;
    pts.forEach((p, i) => {
      points[i * 2] = p.x;
      points[i * 2 + 1] = p.z;
      const next = pts[Math.min(i + 1, pts.length - 1)];
      // 구간 중간 지점의 계수(색칠용)
      const mx = (p.x + next.x) / 2;
      const mz = (p.z + next.z) / 2;
      factors[i] = moveFactor(this.terrain, mx, mz, next.x - p.x, next.z - p.z, mounted);
    });
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / PATH_STEP));
      for (let k = 0; k <= n; k++) {
        const type = this.terrain.typeAt(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n);
        if (type === TerrainType.Forest) throughForest = true;
        if (type === TerrainType.Bridge) throughBridge = true;
      }
    }
    const warnings: string[] = [];
    if (throughForest && s.canCharge) warnings.push('돌격 불가 — 숲 통과');
    if (throughBridge || r.minWidth < s.width) warnings.push('종대 통과 — 좁은 길');
    return {
      points,
      factors,
      reachable: r.found && !r.snapped,
      etaSeconds: r.effort / s.stats.walkSpeed,
      warnings,
    };
  }

  rangeProfile(squad: number): RangeProfileView | null {
    const s = this.squadList[squad];
    const ranged = s.stats.ranged;
    if (!ranged) return null;
    const t = this.terrain;
    const h0 = t.heightAt(s.x, s.z);
    const radii = new Float32Array(RANGE_DIRECTIONS);
    const directUntil = new Float32Array(RANGE_DIRECTIONS);
    const maxR = ranged.range * TERRAIN.rangeMaxMult;
    for (let i = 0; i < RANGE_DIRECTIONS; i++) {
      const a = (i / RANGE_DIRECTIONS) * Math.PI * 2;
      const ux = Math.sin(a);
      const uz = Math.cos(a);
      let r = 0;
      let direct = 0;
      let directOpen = true;
      for (let d = RANGE_STEP; d <= maxR; d += RANGE_STEP) {
        const px = s.x + ux * d;
        const pz = s.z + uz * d;
        if (!t.contains(px, pz)) break;
        const reach = rangeWithHeight(ranged.range, h0 - t.heightAt(px, pz));
        if (d > reach) break;
        r = d;
        if (directOpen && fireLine(t, s.x, s.z, px, pz) === 'direct') direct = d;
        else directOpen = false;
      }
      radii[i] = r;
      directUntil[i] = direct;
    }
    return { x: s.x, z: s.z, radii, directUntil };
  }

  mapFeatures(): readonly MapFeatureView[] {
    return [
      ...this.map.meta.bridges.map((b) => ({ kind: 'bridge' as const, x: b.x, z: b.z })),
      ...this.map.meta.fords.map((f) => ({ kind: 'ford' as const, x: f.x, z: f.z })),
    ];
  }

  // ---------------------------------------------------------------- 진행 (개발 화면이 부른다)
  /** 고정 시간 dt(게임 초). 일시정지·배속은 호출하는 쪽이 처리한다. */
  step(dt: number): void {
    if (this.phase !== 'battle') return;
    this.battleTime += dt;
    for (const s of this.squadList) this.stepSquad(s, dt);
    this.resolveMelee(dt);
    this.visTimer -= dt;
    if (this.visTimer <= 0) {
      this.visTimer = 0.5;
      this.updateVisibility();
    }
    this.flagTimer -= dt;
    if (this.flagTimer <= 0) {
      this.flagTimer = 1;
      this.updateFlag();
      this.checkEnd();
    }
  }

  /** 스크린샷용: 전투를 빠르게 진행한다(시야는 거리만 본다). */
  fastForward(seconds: number): void {
    const dt = 0.1;
    this.cheapVision = true;
    for (let t = 0; t < seconds && this.phase === 'battle'; t += dt) this.step(dt);
    this.cheapVision = false;
    this.updateVisibility();
  }

  private cheapVision = false;

  /** 병사 위치를 UnitStore에 쓴다(개발 화면 렌더용). 부대마다 시작 병력만큼 고정 칸을 쓴다. */
  writeSoldiers(units: UnitStore): void {
    units.savePrevious();
    const t = this.terrain;
    for (const s of this.squadList) {
      const st = s.stats;
      const files = Math.max(1, Math.min(s.files, s.count));
      const sp = s.spacingMult();
      const fx = Math.sin(s.facing);
      const fz = Math.cos(s.facing);
      const rx = -fz;
      const rz = fx;
      const routing = s.state === 'routing';
      for (let k = 0; k < s.startCount; k++) {
        const i = s.slot0 + k;
        // 죽은 병사는 렌더러가 건너뛰도록 removed로 표시한다(목업은 사망 연출 없음).
        const gone = k >= s.count || s.state === 'destroyed';
        units.removed[i] = gone ? 1 : 0;
        units.alive[i] = gone ? 0 : 1;
        if (gone) continue;
        const col = k % files;
        const row = Math.floor(k / files);
        const jitter = routing ? (((k * 7919) % 97) / 97 - 0.5) * 6 : 0;
        const ox = (col - (files - 1) / 2) * st.fileSpacing * sp + jitter;
        const oz =
          -(row - (Math.ceil(s.count / files) - 1) / 2) * st.rankSpacing * sp + jitter * 0.5;
        const x = s.x + rx * ox + fx * oz;
        const z = s.z + rz * ox + fz * oz;
        units.x[i] = x;
        units.z[i] = z;
        units.y[i] = t.heightAt(x, z);
        units.heading[i] = s.facing;
      }
    }
  }

  get soldierCapacity(): number {
    return this.squadList.reduce((n, s) => n + s.startCount, 0);
  }

  /** 병종별 병사 수(UNIT_TYPE_ORDER 순서). 병사 렌더러 용량. */
  get soldierCapacityPerType(): number[] {
    return UNIT_TYPE_ORDER.map((t) =>
      this.squadList.filter((s) => s.type === t).reduce((n, s) => n + s.startCount, 0),
    );
  }

  /** 렌더러 애니메이션용 틱 번호(전투 시간 기준) */
  get tick(): number {
    return Math.round(this.battleTime / TICK_DT);
  }

  /** UnitStore에 병사를 처음 채운다(team 색). */
  initSoldiers(units: UnitStore): void {
    units.count = 0;
    for (const s of this.squadList) {
      const type = UNIT_TYPE_ORDER.indexOf(s.type);
      for (let k = 0; k < s.startCount; k++) {
        const i = units.add(s.team, s.x, 0, s.z, s.facing, type);
        units.squad[i] = s.id;
      }
    }
    this.writeSoldiers(units);
    this.writeSoldiers(units);
  }

  // ---------------------------------------------------------------- 내부
  private spawn(): void {
    const list: MockSquad[] = [];
    let id = 0;
    const counters = new Map<string, number>();
    const add = (team: TeamId, type: UnitTypeId, x: number, z: number, commander = false) => {
      const key = `${team}${commander ? 'c' : type}`;
      const n = (counters.get(key) ?? 0) + 1;
      counters.set(key, n);
      const name = commander
        ? `${TEAM_NAME[team]} 지휘관`
        : `${TEAM_NAME[team]} ${KIND_NAME[type]} ${n}대`;
      const size = commander ? 40 : UNIT_TYPES[type].size;
      list.push(
        new MockSquad(id++, team, type, commander, name, x, z, team === 0 ? 0 : Math.PI, size),
      );
    };
    // 청람(방어, 남쪽 능선) 16개 부대: 보병 5, 창병 3, 궁수 4, 기병 3, 지휘관 1
    for (let i = 0; i < 5; i++) add(0, 'infantry', 210 + i * 70 + (i > 2 ? 40 : 0), 462);
    for (let i = 0; i < 3; i++) add(0, 'spearman', 280 + i * 120, 478);
    for (let i = 0; i < 4; i++) add(0, 'archer', 250 + i * 100, 430);
    add(0, 'cavalry', 640, 400);
    add(0, 'cavalry', 700, 380);
    add(0, 'cavalry', 240, 560 - 30);
    add(0, 'cavalry', 420, 390, true);
    // 황토(공격, 북쪽) 26개 부대: 보병 8, 창병 6, 궁수 5, 기병 6, 지휘관 1
    for (let i = 0; i < 8; i++) add(1, 'infantry', 140 + i * 95, 860);
    for (let i = 0; i < 6; i++) add(1, 'spearman', 190 + i * 110, 890);
    for (let i = 0; i < 5; i++) add(1, 'archer', 380 + i * 60, 770);
    for (let i = 0; i < 6; i++) add(1, 'cavalry', 700 + (i % 3) * 70, 930 - Math.floor(i / 3) * 30);
    add(1, 'cavalry', 520, 940, true);
    let slot = 0;
    for (const sq of list) {
      sq.slot0 = slot;
      slot += sq.startCount;
    }
    this.squadList = list;
    this.battleTime = 0;
    this.flagState = 'defended';
    this.flagProgress = 0;
    this.overtime = false;
    this.lastResult = null;
    this.flankCount = [0, 0];
    this.rearCount = [0, 0];
    this.highGroundSec = [0, 0];
    this.meleeSec = [0, 0];
    this.updateVisibility();
  }

  private setPhase(phase: GamePhase): void {
    this.phase = phase;
    this.paused = false;
    this.emit({ kind: 'phase', phase, time: this.battleTime, x: 0, z: 0 });
  }

  private emit(e: SimEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** 같은 부대·같은 원인 로그는 10초에 한 번(GDD §6.5). */
  private emitThrottled(s: MockSquad, key: string, e: SimEvent): void {
    const last = s.logAt.get(key) ?? -Infinity;
    if (this.battleTime - last < LOG_COOLDOWN) return;
    s.logAt.set(key, this.battleTime);
    this.emit(e);
  }

  private clearHold(s: MockSquad): void {
    s.shieldWall = false;
    s.braced = false;
    s.stillTime = 0;
  }

  /** 상대 AI: 공격군은 가까운 도하 지점을 거쳐 깃발로, 방어군은 고수. */
  private planEnemy(): void {
    const enemy: TeamId = this.playerTeam === 0 ? 1 : 0;
    const crossings = this.mapFeatures();
    for (const s of this.squadList) {
      if (s.team !== enemy) continue;
      if (enemy === this.attackerTeam) {
        if (s.type === 'archer') {
          s.destX = s.x;
          s.destZ = 660;
        } else {
          let best = crossings[0];
          for (const c of crossings) if (Math.abs(c.x - s.x) < Math.abs(best.x - s.x)) best = c;
          s.destX = best.x + (s.x - best.x) * 0.15;
          s.destZ = best.z - 10;
        }
        s.hasDest = true;
        s.order = 'move';
        s.destFacing = Math.PI;
      } else {
        s.order = 'hold';
        s.activity = 'holding';
      }
    }
  }

  private nearestEnemy(s: MockSquad, maxDist: number, visibleOnly: boolean): MockSquad | null {
    let best: MockSquad | null = null;
    let bestD = maxDist;
    for (const o of this.squadList) {
      if (o.team === s.team || o.state === 'destroyed') continue;
      if (visibleOnly && o.state !== 'ready') continue;
      if (visibleOnly && s.team === this.playerTeam && !o.visibleToEnemy) continue;
      const d = Math.hypot(o.x - s.x, o.z - s.z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private stepSquad(s: MockSquad, dt: number): void {
    if (s.state === 'destroyed') return;
    s.chargeCooldown = Math.max(0, s.chargeCooldown - dt);
    const t = this.terrain;
    s.concealed = t.typeAt(s.x, s.z) === TerrainType.Forest && this.battleTime > s.exposedUntil;

    if (s.state === 'routing') {
      const foe = this.nearestEnemy(s, 1e9, false);
      if (foe) {
        const dx = s.x - foe.x;
        const dz = s.z - foe.z;
        const d = Math.hypot(dx, dz) || 1;
        this.moveToward(s, s.x + (dx / d) * 50, s.z + (dz / d) * 50, s.stats.runSpeed * 0.9, dt);
        if (d > MORALE.shatterDist) this.destroy(s, 'fled');
      }
      if (s.x < 40 || s.z < 40 || s.x > t.width - 40 || s.z > t.depth - 40) this.destroy(s, 'edge');
      return;
    }

    const engaged = s.activity === 'engaged';
    if (engaged) return; // 교전 중에는 resolveMelee가 처리

    // 표적 갱신
    let target = s.targetId >= 0 ? this.squadList[s.targetId] : null;
    if (target && target.state === 'destroyed') {
      s.targetId = -1;
      target = null;
      if (s.order === 'attack') s.order = 'none';
    }
    if (!target && s.order === 'advance') {
      const foe = this.nearestEnemy(s, 60, true);
      if (foe) {
        s.targetId = foe.id;
        target = foe;
      }
    }
    if (!target && s.order !== 'move' && s.order !== 'hold' && s.stats.ranged) {
      const foe = this.nearestEnemy(s, s.stats.ranged.range * 1.4, true);
      if (foe) target = foe;
    }

    if (s.stats.ranged && target) {
      const dist = Math.hypot(target.x - s.x, target.z - s.z);
      const reach = rangeWithHeight(
        s.stats.ranged.range,
        t.heightAt(s.x, s.z) - t.heightAt(target.x, target.z),
      );
      if (dist <= reach && s.order !== 'move') {
        s.facing = Math.atan2(target.x - s.x, target.z - s.z);
        s.activity = 'idle';
        s.targetId = target.id;
        this.shoot(s, target, dt);
        return;
      }
      if (s.order === 'attack' || s.order === 'advance') {
        this.moveToward(s, target.x, target.z, s.stats.walkSpeed, dt);
        if (dist < reach + 30) {
          this.emitThrottled(s, 'range', {
            kind: 'outOfRange',
            squad: s.id,
            target: target.id,
            heightDiff: t.heightAt(s.x, s.z) - t.heightAt(target.x, target.z),
            range: reach,
            time: this.battleTime,
            x: s.x,
            z: s.z,
          });
        }
        return;
      }
    }

    if (target && (s.order === 'attack' || s.order === 'advance')) {
      const charging =
        s.activity === 'charging' ||
        (s.canCharge &&
          s.chargeCooldown <= 0 &&
          s.moraleBand === 'steady' &&
          Math.hypot(target.x - s.x, target.z - s.z) < 120);
      if (charging && t.typeAt(s.x, s.z) === TerrainType.Forest) {
        if (!s.chargeFailedLogged) {
          s.chargeFailedLogged = true;
          this.emit({
            kind: 'chargeFailed',
            squad: s.id,
            target: target.id,
            reason: 'forest',
            time: this.battleTime,
            x: s.x,
            z: s.z,
          });
        }
        s.activity = 'moving';
      } else if (charging) {
        s.activity = 'charging';
      } else {
        s.activity = 'moving';
      }
      const speed = s.activity === 'charging' ? 9 : s.stats.walkSpeed;
      this.moveToward(s, target.x, target.z, speed, dt);
      if (this.inContact(s, target)) this.startMelee(s, target);
      return;
    }

    if (s.order === 'advance') {
      this.moveToward(
        s,
        s.x + Math.sin(s.facing) * 20,
        s.z + Math.cos(s.facing) * 20,
        s.stats.walkSpeed,
        dt,
      );
      s.activity = 'moving';
      return;
    }

    // 목업 상대 AI: 도하 지점에 닿으면 깃발로 진격한다.
    if (
      !s.hasDest &&
      s.order !== 'hold' &&
      s.team !== this.playerTeam &&
      s.team === this.attackerTeam
    ) {
      const foe = this.nearestEnemy(s, 160, true);
      if (foe && !s.stats.ranged) {
        s.order = 'attack';
        s.targetId = foe.id;
        return;
      }
      if (!s.stats.ranged) {
        s.destX = this.flagPos.x + ((s.id * 37) % 160) - 80;
        s.destZ = this.flagPos.z + 30;
        s.hasDest = true;
        s.order = 'move';
      }
    }

    if (s.hasDest) {
      s.activity = 'moving';
      const arrived = this.moveToward(s, s.destX, s.destZ, s.stats.walkSpeed, dt);
      if (arrived) {
        s.hasDest = false;
        if (s.destFacing !== null) s.facing = s.destFacing;
        s.activity = 'idle';
        if (s.order === 'move') s.order = 'none';
      }
      // 이동 중에도 적과 닿으면 싸운다.
      const foe = this.nearestEnemy(s, 25, false);
      if (foe && foe.state === 'ready' && this.inContact(s, foe)) this.startMelee(s, foe);
      return;
    }

    // 대기·고수
    s.stillTime += dt;
    if (s.order === 'hold') {
      s.activity = s.braced ? 'braced' : 'holding';
      if (s.type === 'infantry' && s.stillTime >= 1) s.shieldWall = true;
      if (s.type === 'spearman' && s.stillTime >= 3) {
        s.braced = true;
        s.activity = 'braced';
      }
    } else {
      s.activity = 'idle';
    }
    const foe = this.nearestEnemy(s, 30, false);
    if (foe && foe.state === 'ready' && !s.stats.ranged) {
      if (this.inContact(s, foe)) this.startMelee(s, foe);
      else if (s.order !== 'hold') this.moveToward(s, foe.x, foe.z, s.stats.walkSpeed, dt);
    }
  }

  /** 목표점으로 이동. 지형 계수(A의 moveFactor)를 곱한다. 도착하면 true. */
  private moveToward(s: MockSquad, tx: number, tz: number, speed: number, dt: number): boolean {
    const dx = tx - s.x;
    const dz = tz - s.z;
    const d = Math.hypot(dx, dz);
    if (d < 1) return true;
    const f = moveFactor(this.terrain, s.x, s.z, dx, dz, s.stats.mounted);
    const step = Math.min(d, speed * Math.max(f, 0) * dt);
    const ahead = moveFactor(
      this.terrain,
      s.x + (dx / d) * 4,
      s.z + (dz / d) * 4,
      dx,
      dz,
      s.stats.mounted,
    );
    if (ahead <= 0 && f > 0) {
      // 통과 불가 직전: 목업은 멈춘다(실제 게임은 경로 탐색으로 돌아간다).
      s.hasDest = false;
      return true;
    }
    s.x += (dx / d) * step;
    s.z += (dz / d) * step;
    const target = Math.atan2(dx, dz);
    let diff = target - s.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    s.facing += diff * Math.min(1, dt * 3);
    s.autoNarrowed = this.terrain.typeAt(s.x, s.z) === TerrainType.Bridge;
    return d - step < 1;
  }

  private inContact(a: MockSquad, b: MockSquad): boolean {
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    return d < (a.depth + b.depth) / 2 + 3;
  }

  private sideOf(defender: MockSquad, ax: number, az: number): Side {
    const vx = ax - defender.x;
    const vz = az - defender.z;
    const f = vx * Math.sin(defender.facing) + vz * Math.cos(defender.facing);
    const l = vx * -Math.cos(defender.facing) + vz * Math.sin(defender.facing);
    const ang =
      (Math.atan2(Math.abs(l) / (defender.width / 2 + 1), f / (defender.depth / 2 + 1)) * 180) /
      Math.PI;
    return ang <= 45 ? 'front' : ang >= 135 ? 'rear' : 'flank';
  }

  private startMelee(a: MockSquad, b: MockSquad): void {
    if (a.activity === 'engaged') return;
    const side = this.sideOf(b, a.x, a.z);
    if (a.activity === 'charging') {
      const kills = Math.min(
        b.count,
        Math.round(a.count * (b.braced && side === 'front' ? 0.05 : 0.5)),
      );
      this.applyLoss(b, kills, side === 'front' ? 'charge' : side === 'rear' ? 'rear' : 'flank');
      a.kills += kills;
      b.morale -= side === 'front' ? 4 : 12;
      a.chargeCooldown = 20;
      this.emit({
        kind: 'chargeImpact',
        squad: a.id,
        target: b.id,
        side,
        speedRatio: 1,
        braced: b.braced && side === 'front',
        kills,
        time: this.battleTime,
        x: b.x,
        z: b.z,
      });
    } else {
      this.emit({
        kind: 'engage',
        squad: a.id,
        enemy: b.id,
        side,
        time: this.battleTime,
        x: b.x,
        z: b.z,
      });
    }
    a.activity = 'engaged';
    a.targetId = b.id;
    a.exposedUntil = this.battleTime + TERRAIN.revealTime;
    if (b.activity !== 'engaged') {
      b.activity = 'engaged';
      b.targetId = a.id;
      b.exposedUntil = this.battleTime + TERRAIN.revealTime;
    }
    if (side !== 'front') {
      const team = a.team;
      if (side === 'flank') this.flankCount[team]++;
      else this.rearCount[team]++;
    }
  }

  private resolveMelee(dt: number): void {
    const t = this.terrain;
    for (const s of this.squadList) {
      if (s.state !== 'ready' || s.activity !== 'engaged') continue;
      const foe = s.targetId >= 0 ? this.squadList[s.targetId] : null;
      if (!foe || foe.state !== 'ready' || !this.inContact(s, foe)) {
        s.activity = 'idle';
        s.heightBonusPct = 0;
        if (foe && foe.state !== 'ready' && s.order === 'attack') s.targetId = -1;
        continue;
      }
      const side = this.sideOf(foe, s.x, s.z);
      const dist = Math.hypot(foe.x - s.x, foe.z - s.z);
      const look =
        (Math.atan2(t.heightAt(s.x, s.z) - t.heightAt(foe.x, foe.z), Math.max(dist, 1)) * 180) /
        Math.PI;
      const mult = 1 + 0.015 * Math.max(-15, Math.min(15, look));
      s.heightBonusPct = mult > 1.005 ? Math.round((mult - 1) * 100) : 0;
      if (s.heightBonusPct >= 5) {
        this.highGroundSec[s.team] += dt;
        this.emitThrottled(s, 'high', {
          kind: 'highGround',
          squad: s.id,
          bonusPct: s.heightBonusPct,
          time: this.battleTime,
          x: s.x,
          z: s.z,
        });
      }
      this.meleeSec[s.team] += dt;
      const dirMult = side === 'front' ? 1 : side === 'flank' ? 1.3 : 1.6;
      const rate =
        0.012 * s.stats.meleeDamage * mult * dirMult * (s.moraleBand === 'wavering' ? 0.85 : 1);
      const killsF = Math.min(
        foe.count,
        Math.max(0, (rate * Math.min(s.files, s.count) * dt) / 10),
      );
      foe.morale -= MORALE.meleePerSec * dt;
      if (side !== 'front') {
        foe.morale -= (side === 'flank' ? MORALE.flankPerSec : MORALE.rearPerSec) * dt;
        this.emitThrottled(foe, side, {
          kind: 'attacked',
          squad: foe.id,
          side,
          time: this.battleTime,
          x: foe.x,
          z: foe.z,
        });
      }
      const whole = Math.floor(killsF + Math.random() * 0.999);
      if (whole > 0) {
        this.applyLoss(foe, whole, side === 'front' ? 'melee' : side);
        s.kills += whole;
      }
    }
  }

  private shoot(s: MockSquad, target: MockSquad, dt: number): void {
    s.exposedUntil = this.battleTime + TERRAIN.revealTime;
    const hits = (s.count / 4) * 0.03 * dt * (target.concealed ? 0.5 : 1);
    const whole = Math.floor(hits + Math.random() * 0.999 * Math.min(1, hits * 4));
    if (whole > 0) {
      this.applyLoss(target, whole, 'arrows');
      s.kills += whole;
    }
  }

  private applyLoss(s: MockSquad, n: number, cause: RoutCause): void {
    if (s.state === 'destroyed' || n <= 0) return;
    const lost = Math.min(s.count, n);
    s.count -= lost;
    const moraleLoss = (lost / s.startCount) * 100 * MORALE.perLossPct;
    s.morale -= moraleLoss;
    s.causeLoss[cause] = (s.causeLoss[cause] ?? 0) + moraleLoss;
    s.updateShape();
    if (s.count <= 0) {
      this.destroy(s, 'wiped');
      return;
    }
    this.updateMorale(s, cause);
  }

  private updateMorale(s: MockSquad, cause: RoutCause): void {
    if (s.isCommander) {
      s.morale = 100;
      return;
    }
    s.morale = Math.max(0, s.morale);
    s.moraleBand =
      s.morale <= MORALE.rout ? 'routing' : s.morale < MORALE.waver ? 'wavering' : 'steady';
    if (s.state === 'ready' && s.morale <= MORALE.rout) {
      let top: RoutCause = cause;
      let best = -1;
      for (const [c, v] of Object.entries(s.causeLoss) as [RoutCause, number][]) {
        if (v > best) {
          best = v;
          top = c;
        }
      }
      s.state = 'routing';
      s.activity = 'idle';
      s.routCause = top;
      s.routTime = this.battleTime;
      s.targetId = -1;
      this.emit({ kind: 'rout', squad: s.id, cause: top, time: this.battleTime, x: s.x, z: s.z });
      for (const o of this.squadList) {
        if (
          o !== s &&
          o.team === s.team &&
          o.state === 'ready' &&
          Math.hypot(o.x - s.x, o.z - s.z) < MORALE.nearbyRoutRadius
        ) {
          o.morale -= MORALE.nearbyRout;
          o.causeLoss.nearbyRout = (o.causeLoss.nearbyRout ?? 0) + MORALE.nearbyRout;
          this.updateMorale(o, 'nearbyRout');
        }
      }
    }
  }

  private destroy(s: MockSquad, reason: 'wiped' | 'fled' | 'edge'): void {
    if (s.state === 'destroyed') return;
    const wasCommander = s.isCommander;
    s.state = 'destroyed';
    s.activity = 'idle';
    this.emit({ kind: 'destroyed', squad: s.id, reason, time: this.battleTime, x: s.x, z: s.z });
    if (wasCommander) {
      this.emit({ kind: 'commanderKilled', team: s.team, time: this.battleTime, x: s.x, z: s.z });
    }
  }

  private updateVisibility(): void {
    const t = this.terrain;
    for (const s of this.squadList) {
      const was = s.visibleToEnemy;
      let seen = false;
      if (s.state !== 'destroyed') {
        for (const o of this.squadList) {
          if (o.team === s.team || o.state === 'destroyed') continue;
          const d = Math.hypot(o.x - s.x, o.z - s.z);
          if (d > VISION_RANGE) continue;
          if (s.concealed && d > TERRAIN.forestHideDist) continue;
          const eye = TERRAIN.eyeHeight;
          if (
            this.cheapVision ||
            lineOfSight(
              t,
              o.x,
              t.heightAt(o.x, o.z) + eye,
              o.z,
              s.x,
              t.heightAt(s.x, s.z) + eye,
              s.z,
            )
          ) {
            seen = true;
            break;
          }
        }
      }
      s.visibleToEnemy = seen;
      if (was && !seen) s.lastSeenByEnemy = { x: s.x, z: s.z, time: this.battleTime };
    }
  }

  private updateFlag(): void {
    const defender: TeamId = this.attackerTeam === 1 ? 0 : 1;
    let def = false;
    let atk = false;
    for (const s of this.squadList) {
      if (s.state !== 'ready') continue;
      if (Math.hypot(s.x - this.flagPos.x, s.z - this.flagPos.z) > this.flagPos.radius) continue;
      if (s.team === defender) def = true;
      else atk = true;
    }
    const prev = this.flagState;
    if (def) {
      this.flagState = 'defended';
      this.flagProgress = 0;
    } else if (atk) {
      this.flagState = 'capturing';
      this.flagProgress = Math.min(CAPTURE_TIME, this.flagProgress + 1);
    } else {
      this.flagState = 'empty';
      this.flagProgress = Math.max(0, this.flagProgress - 2);
    }
    if (prev !== this.flagState) {
      this.emit({
        kind: 'flag',
        state: this.flagState,
        progress: this.flagProgress,
        time: this.battleTime,
        x: this.flagPos.x,
        z: this.flagPos.z,
      });
    }
  }

  private checkEnd(): void {
    if (this.flagProgress >= CAPTURE_TIME) return this.finish(this.attackerTeam, 'flagCaptured');
    const s0 = this.strength(0);
    const s1 = this.strength(1);
    const c0 = s0.effective < s0.start * 0.25;
    const c1 = s1.effective < s1.start * 0.25;
    if (c0 && c1) return this.finish(-1, 'draw');
    if (c0) return this.finish(1, 'collapse');
    if (c1) return this.finish(0, 'collapse');
    if (this.battleTime >= TIME_LIMIT) {
      if (this.flagProgress > 0 && this.battleTime < TIME_LIMIT + 60) {
        this.overtime = true;
        return;
      }
      this.finish(this.attackerTeam === 1 ? 0 : 1, 'timeHeld');
    }
  }

  private finish(winner: TeamId | -1, reason: BattleResult['reason']): void {
    const team = (t: TeamId) => {
      const st = this.strength(t);
      return {
        ...st,
        kills: this.squadList.filter((s) => s.team === t).reduce((n, s) => n + s.kills, 0),
        highGroundShare: this.meleeSec[t] > 0 ? this.highGroundSec[t] / this.meleeSec[t] : 0,
        flankAttacks: this.flankCount[t],
        rearAttacks: this.rearCount[t],
      };
    };
    const routs = this.squadList
      .filter((s) => s.state !== 'ready' && s.routTime > 0)
      .map((s) => ({
        squad: s.id,
        cause: s.routCause,
        moraleLost: s.causeLoss[s.routCause] ?? 0,
        time: s.routTime,
      }))
      .sort((a, b) => b.moraleLost - a.moraleLost);
    this.lastResult = {
      winner,
      reason,
      time: this.battleTime,
      teams: [team(0), team(1)],
      routCauses: routs,
    };
    this.setPhase('result');
    this.emit({
      kind: 'battleEnd',
      result: this.lastResult,
      time: this.battleTime,
      x: 0,
      z: 0,
    });
  }
}
