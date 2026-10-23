/**
 * 한 판의 세션(docs/INTERFACES.md §2.2, §3.3). UI가 읽고 명령을 넣는 유일한 창구이고,
 * 한 판 상태 머신(브리핑 → 배치 → 전투 → 결과, GDD §2)과 일시정지·배속을 맡는다.
 *
 * 규칙은 sim에 있다: 명령 검증·선분 분할은 sim/commands.ts, 전투는 World.step. 세션은 틱을 돌리고,
 * 틱이 끝날 때마다 World의 이벤트를 꺼내 구독자에게 넘긴다(ARCHITECTURE §11.3).
 */
import type {
  BattleResult,
  Command,
  CommandResult,
  DeployCheck,
  FlagView,
  GamePhase,
  GameSpeed,
  SimEvent,
  SquadView,
  TeamId,
  TeamStrength,
  UnitTypeId,
} from '../sim/api';
import { createBattle } from '../sim/battleSetup';
import { canDeploy, planGroupMove, planLineMove, validateCommand } from '../sim/commands';
import { TICK_DT } from '../sim/constants';
import { UNIT_TYPES } from '../sim/data/balance';
import type { GameMap } from '../sim/map/gameMap';
import type { Pathfinder } from '../sim/map/pathfinder';
import type { Scenario } from '../sim/scenario';
import { SquadViewAdapter } from '../sim/squadView';
import { buildResult, teamStrength } from '../sim/systems/battleRules';
import type { Terrain } from '../sim/terrain';
import { moveFactor } from '../sim/terrainRules';
import type { World } from '../sim/world';
import type {
  MapFeatureView,
  MoveSlot,
  PathPreviewView,
  RangeProfileView,
  TerrainInfoView,
  UiSession,
  ZoneRect,
} from '../ui/gameView';
import { FixedStepClock } from './fixedStepClock';
import { SpeedLimiter } from './speedLimiter';
import { mapFeatures, previewPath, rangeProfile, terrainInfo } from './terrainQueries';

export interface GameSessionOptions {
  map: GameMap;
  pathfinder: Pathfinder;
  scenario: Scenario;
  seed: number;
  /** null = AI 대 AI 관전. 브리핑을 건너뛰고 배치 단계로 시작한다 */
  spectate?: boolean;
  /** 성능 측정용 병력 배율(?scale=k). 시나리오에는 이미 적용돼 있고, 결과 화면 표시용으로만 둔다 */
  scale?: number;
}

export class GameSession implements UiSession {
  phase: GamePhase = 'briefing';
  playerTeam: TeamId | null = null;
  paused = false;
  speed: GameSpeed = 1;
  world: World;
  readonly terrain: Terrain;

  private views: SquadViewAdapter[] = [];
  private readonly listeners = new Set<(e: SimEvent) => void>();
  private readonly clock = new FixedStepClock(TICK_DT * 1000);
  private readonly features: MapFeatureView[];
  private readonly limiter = new SpeedLimiter();

  constructor(private readonly opts: GameSessionOptions) {
    this.terrain = opts.map.terrain;
    this.features = mapFeatures(opts.map);
    this.world = this.newWorld();
    if (opts.spectate) {
      this.world = this.newWorld([0, 1]);
      this.setPhase('deployment');
    }
  }

  // ------------------------------------------------------------------ 진행(app 루프가 프레임마다 부른다)

  /**
   * 경과 시간만큼 틱을 돌린다. 일시정지면 돌리지 않고(명령은 받아 둔다), 배속이면 시간에 배수를 곱한다
   * (ARCHITECTURE §11.2). @returns 이번 프레임에 실행한 틱 수
   */
  advance(frameMs: number): number {
    if (this.phase !== 'battle' || this.paused) {
      this.clock.advance(0);
      return 0;
    }
    const steps = this.clock.advance(frameMs * this.speed);
    for (let s = 0; s < steps && this.world.phase === 'battle'; s++) {
      const t0 = performance.now();
      this.world.step(TICK_DT);
      this.limiter.record(performance.now() - t0);
      this.flushEvents();
    }
    if (this.speed > this.limiter.maxSpeed) this.speed = this.limiter.maxSpeed;
    if (this.world.phase === 'result' && this.phase === 'battle') this.setPhase('result');
    return steps;
  }

  /** 직전 틱과 다음 틱 사이 보간 비율(렌더용). */
  get alpha(): number {
    return this.phase === 'battle' && !this.paused ? this.clock.alpha : 1;
  }

  get battleTime(): number {
    return this.world.time;
  }
  get timeLimit(): number {
    return this.opts.scenario.rules.timeLimit;
  }

  // ------------------------------------------------------------------ 단계 전환(GDD §2)

  chooseSide(team: TeamId): void {
    if (this.phase !== 'briefing') return;
    this.playerTeam = team;
    this.world = this.newWorld([team === 0 ? 1 : 0]);
    this.setPhase('deployment');
  }

  backToBriefing(): void {
    if (this.phase === 'briefing') return;
    this.playerTeam = null;
    this.world = this.newWorld();
    this.setPhase('briefing');
  }

  startBattle(): void {
    if (this.phase !== 'deployment') return;
    this.world.startBattle();
    this.paused = false;
    this.setPhase('battle');
    this.flushEvents();
  }

  restart(): void {
    if (this.phase !== 'result' && this.phase !== 'battle') return;
    const ai: TeamId[] = this.playerTeam === null ? [0, 1] : [this.playerTeam === 0 ? 1 : 0];
    this.world = this.newWorld(ai);
    this.setPhase('deployment');
  }

  /** 일시정지 메뉴의 "포기": 패배로 기록하고 결과로 간다(GDD §2). */
  surrender(): void {
    if (this.phase !== 'battle' || this.playerTeam === null) return;
    const winner: TeamId = this.playerTeam === 0 ? 1 : 0;
    this.world.finish(buildResult(this.world, winner, 'surrender'));
    this.flushEvents();
    this.setPhase('result');
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }
  togglePause(): void {
    this.paused = !this.paused;
  }
  /** 기기가 느려 막힌 배속이면 고를 수 있는 최고 배속으로 낮춘다(maxSpeed, speedLimitReason). */
  setSpeed(speed: GameSpeed): void {
    this.speed = speed > this.limiter.maxSpeed ? this.limiter.maxSpeed : speed;
  }

  /** 지금 고를 수 있는 최고 배속(D-016: 최근 평균 틱이 4ms를 넘으면 2) */
  get maxSpeed(): GameSpeed {
    return this.limiter.maxSpeed;
  }
  /** maxSpeed가 4보다 낮은 이유(UI 툴팁·토스트), 제한이 없으면 null */
  get speedLimitReason(): string | null {
    return this.limiter.reason;
  }
  /** 최근 평균 틱 시간(ms). 표본이 부족하면 NaN(개발용 성능 표시) */
  get tickMsAverage(): number {
    return this.limiter.averageMs;
  }
  /** 성능 측정용 병력 배율. 1이 아니면 결과 화면에 표시한다(ARCHITECTURE §9.3) */
  get scale(): number {
    return this.opts.scale ?? 1;
  }

  // ------------------------------------------------------------------ 명령

  /** 즉시 검증 결과는 안내용이다. 적용은 다음 틱 시작에 하며 그때 다시 판정한다(ARCHITECTURE §11.2). */
  issue(cmd: Command): CommandResult {
    if (this.playerTeam !== null && cmd.team !== this.playerTeam) return 'notYourSquad';
    const r = validateCommand(this.world, cmd);
    if (r === 'ok') this.world.enqueue(cmd);
    return r;
  }

  canDeploy(squad: number, x: number, z: number, facing: number, files?: number): DeployCheck {
    const team = this.playerTeam ?? this.world.squads[squad]?.team ?? 0;
    return canDeploy(this.world, team, squad, x, z, facing, files);
  }

  planMoveSlots(
    squads: readonly number[],
    x: number,
    z: number,
    facing?: number,
    width?: number,
  ): readonly MoveSlot[] {
    if (facing !== undefined && width !== undefined) {
      return planLineMove(this.world, squads, x, z, facing, width);
    }
    return planGroupMove(this.world, squads, x, z, facing ?? NaN);
  }

  // ------------------------------------------------------------------ 읽기

  squads(): readonly SquadView[] {
    return this.views;
  }
  squad(id: number): SquadView {
    return this.views[id];
  }
  strength(team: TeamId): TeamStrength {
    return teamStrength(this.world, team);
  }
  flag(): FlagView {
    const r = this.opts.scenario.rules;
    const f = this.world.flag;
    return {
      x: r.flag.x,
      z: r.flag.z,
      radius: r.flag.radius,
      state: f.state,
      progress: f.progress,
      captureTime: r.captureTime,
      overtime: f.overtime,
    };
  }
  isVisible(squad: number, toTeam: TeamId): boolean {
    return this.world.isVisible(squad, toTeam);
  }
  lastSeen(squad: number, byTeam: TeamId): { x: number; z: number; time: number } | null {
    return this.world.vision?.lastSeen(squad, byTeam) ?? null;
  }
  deploymentZone(team: TeamId): ZoneRect {
    return this.world.deploymentZone(team);
  }
  result(): BattleResult | null {
    return this.world.result;
  }

  onEvent(listener: (e: SimEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ------------------------------------------------------------------ 지형 질의(§3.3)

  terrainInfo(x: number, z: number, type: UnitTypeId | null): TerrainInfoView {
    return terrainInfo(this.opts.map, x, z, type);
  }
  moveFactorAt(type: UnitTypeId, x: number, z: number, dirX: number, dirZ: number): number {
    return moveFactor(this.terrain, x, z, dirX, dirZ, UNIT_TYPES[type].mounted);
  }
  previewPath(squad: number, x: number, z: number): PathPreviewView {
    return previewPath(this.opts.map, this.opts.pathfinder, this.world.squads[squad], x, z);
  }
  rangeProfile(squad: number): RangeProfileView | null {
    return rangeProfile(this.opts.map, this.world.squads[squad]);
  }
  mapFeatures(): readonly MapFeatureView[] {
    return this.features;
  }

  // ------------------------------------------------------------------ 내부

  private newWorld(aiTeams: readonly TeamId[] = []): World {
    const w = createBattle({
      map: this.opts.map,
      pathfinder: this.opts.pathfinder,
      scenario: this.opts.scenario,
      seed: this.opts.seed,
      aiTeams,
    });
    this.views = w.squads.map((s) => new SquadViewAdapter(s));
    return w;
  }

  private setPhase(phase: GamePhase): void {
    this.phase = phase;
    this.emit({ kind: 'phase', phase, time: this.world.time, x: 0, z: 0 });
  }

  private flushEvents(): void {
    for (const e of this.world.drainEvents()) {
      // 세션이 단계 이벤트를 따로 내므로 World의 단계 이벤트는 넘기지 않는다(중복 방지).
      if (e.kind === 'phase') continue;
      this.emit(e);
    }
  }

  private emit(e: SimEvent): void {
    for (const l of this.listeners) l(e);
  }
}
