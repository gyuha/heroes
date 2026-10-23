import type { BattleResult, Command, FlagState, SimEvent, TeamId } from './api';
import { COMMANDER, UNIT_TYPES, type UnitTypeId } from './data/balance';
import { SQUAD, SOLDIER } from './data/simConfig';
import { EventBuffer } from './events';
import { Rng } from './rng';
import type { Rect, Scenario } from './scenario';
import { SpatialGrid } from './spatialGrid';
import { Squad } from './squad';
import type { Terrain } from './terrain';
import { UNIT_TYPE_ORDER, UnitStore } from './units';
import { applyCommand } from './commands';
import { placeSquadSoldiers } from './systems/formation';
import { stepBattle } from './systems/battleStep';
import type { VisionSquad } from './visibility';

/** 격자 칸 크기(m). 가장 자주 쓰는 근접 탐색 반경(병사 간 간격)의 두 배 정도로 둔다. */
const GRID_CELL_SIZE = 2;

export type WorldPhase = 'deployment' | 'battle' | 'result';

/** A의 Pathfinder(docs/INTERFACES.md §1.5) 중 World가 쓰는 부분. */
export interface PathfinderLike {
  findPath(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    opts: { mounted: boolean; allowBorder?: boolean },
  ): { found: boolean; points: { x: number; z: number }[]; minWidth: number };
  corridorWidth(x: number, z: number, dirX: number, dirZ: number): number;
}

/** A의 VisibilitySystem(§1.6) 중 World가 쓰는 부분. */
export interface VisionLike {
  update(time: number, squads: readonly VisionSquad[]): void;
  markExposed(squad: number, time: number): void;
  isVisible(squad: number, toTeam: TeamId): boolean;
  isConcealed(squad: number): boolean;
  lastSeen(squad: number, byTeam: TeamId): { x: number; z: number; time: number } | null;
}

/** A의 GameMap(§1.4) 중 World가 쓰는 맵 규칙. */
export interface MapRulesLike {
  inPlayArea(x: number, z: number): boolean;
}

/** AI 등 매 틱 명령을 내는 주체. World.enqueue로만 명령을 넣는다. */
export interface Controller {
  readonly team: TeamId;
  think(world: World): void;
}

export interface WorldOptions {
  terrain: Terrain;
  scenario: Scenario;
  seed: number;
  map?: MapRulesLike;
  pathfinder?: PathfinderLike;
  vision?: VisionLike;
}

/** 팀별 누적 통계(결과 화면). */
export class TeamStats {
  kills = 0;
  flankAttacks = 0;
  rearAttacks = 0;
  /** 근접 교전 병사·초, 그중 고지(고저차 배율 > 1) */
  meleeSoldierSec = 0;
  highGroundSoldierSec = 0;
  commanderDead = false;
}

export interface FlagStatus {
  state: FlagState;
  progress: number;
  overtime: boolean;
}

/**
 * 시뮬레이션 전체 상태와 틱 진행. three.js·DOM에 의존하지 않는다.
 * 한 판 = 배치(deployment) → 전투(battle) → 결과(result). 틱은 battle에서만 돈다.
 * 시스템 실행 순서는 systems/battleStep.ts 한 곳에서만 정한다.
 */
export class World {
  tick = 0;
  /** 전투 시간(초) */
  time = 0;
  phase: WorldPhase = 'deployment';
  readonly terrain: Terrain;
  readonly scenario: Scenario;
  readonly units: UnitStore;
  readonly grid: SpatialGrid;
  readonly squads: Squad[] = [];
  readonly events: EventBuffer;
  readonly rng: Rng;
  readonly teamStats: [TeamStats, TeamStats] = [new TeamStats(), new TeamStats()];
  readonly teamStart: [number, number] = [0, 0];
  readonly controllers: Controller[] = [];
  readonly flag: FlagStatus = { state: 'defended', progress: 0, overtime: false };
  result: BattleResult | null = null;
  /** 부대 i 와 j(i < j) 가 이번·직전 틱에 접촉했는가. 인덱스 i * squads + j */
  contactNow: Uint8Array;
  contactPrev: Uint8Array;
  /** 부대 쌍이 마지막으로 접촉한 틱(같은 인덱스). 잠깐 떨어졌다 다시 붙는 것을 새 교전과 가른다 */
  readonly contactLastTick: Int32Array;
  readonly map: MapRulesLike | undefined;
  readonly pathfinder: PathfinderLike | undefined;
  readonly vision: VisionLike | undefined;

  /**
   * 성능 측정 훅. 설정하면 틱 안 시스템 사이마다 단계 번호(STEP_PHASES)로 불린다. sim은 시계를 읽지 않으므로
   * 시간 측정은 이 훅을 건 쪽(app, 헤드리스 러너)이 한다. 컨트롤러(AI) 시간은 단계 −1.
   */
  probe: ((phase: number) => void) | undefined = undefined;

  private queue: Command[] = [];

  constructor(opts: WorldOptions) {
    this.terrain = opts.terrain;
    this.scenario = opts.scenario;
    this.map = opts.map;
    this.pathfinder = opts.pathfinder;
    this.vision = opts.vision;
    this.rng = new Rng(opts.seed);

    let capacity = 0;
    for (const team of opts.scenario.teams) for (const s of team) capacity += specSize(s.type, s);
    this.units = new UnitStore(capacity);
    this.grid = new SpatialGrid(this.terrain.width, this.terrain.depth, GRID_CELL_SIZE, capacity);

    const counters = new Map<string, number>();
    for (let team = 0 as TeamId; team < 2; team = (team + 1) as TeamId) {
      for (const spec of opts.scenario.teams[team]) {
        const size = specSize(spec.type, spec);
        const typeIndex = UNIT_TYPE_ORDER.indexOf(spec.type);
        const key = `${team}:${spec.commander ? 'cmd' : spec.type}`;
        const num = (counters.get(key) ?? 0) + 1;
        counters.set(key, num);
        const squad = new Squad(
          this.squads.length,
          team,
          typeIndex,
          UNIT_TYPES[spec.type],
          !!spec.commander,
          squadName(team, spec.type, !!spec.commander, num),
          size,
          spec.role ?? '',
        );
        if (spec.formation) squad.formation = spec.formation;
        if (spec.files) squad.files = spec.files;
        squad.x = spec.x;
        squad.z = spec.z;
        squad.facing = spec.facing;
        for (let k = 0; k < size; k++) {
          const i = this.units.add(team, spec.x, 0, spec.z, spec.facing, typeIndex, squad.stats.hp);
          this.units.squad[i] = squad.id;
          squad.addMember(i);
        }
        placeSquadSoldiers(this, squad);
        this.squads.push(squad);
        this.teamStart[team] += size;
      }
    }
    const s = this.squads.length;
    this.contactNow = new Uint8Array(s * s);
    this.contactPrev = new Uint8Array(s * s);
    this.contactLastTick = new Int32Array(s * s).fill(-1_000_000);
    this.events = new EventBuffer(s);
  }

  /** 명령을 큐에 넣는다. 다음 step() 맨 앞에서 받은 순서대로 적용하며, 그때 다시 판정한다. */
  enqueue(cmd: Command): void {
    if (this.phase === 'deployment') {
      // 배치 단계에는 틱이 돌지 않으므로 바로 적용한다.
      applyCommand(this, cmd);
      return;
    }
    this.queue.push(cmd);
  }

  /** 배치 → 전투. */
  startBattle(): void {
    if (this.phase !== 'deployment') return;
    this.phase = 'battle';
    this.events.push({ kind: 'phase', phase: 'battle', time: 0, x: 0, z: 0 });
  }

  /** 고정 시간 dt(초) 만큼 진행한다. 전투 단계가 아니면 아무것도 하지 않는다. */
  step(dt: number): void {
    if (this.phase !== 'battle') return;
    this.events.clear();
    // 이번 step이 만드는 상태의 틱 번호. 병사 사실(deathTick 등)과 승패 판정 시각이 이 상태와 맞는다.
    this.tick++;
    this.time = this.tick * dt;
    const q = this.queue;
    this.queue = [];
    for (const cmd of q) applyCommand(this, cmd);
    this.probe?.(-2);
    for (const c of this.controllers) c.think(this);
    this.probe?.(-1);
    stepBattle(this, dt);
  }

  /** 이번 틱에 생긴 이벤트를 꺼낸다(세션이 틱마다 부른다). */
  drainEvents(): SimEvent[] {
    const out = this.events.list.slice();
    this.events.clear();
    return out;
  }

  /** 전투를 끝낸다(승패 판정 또는 포기). */
  finish(result: BattleResult): void {
    if (this.phase === 'result') return;
    this.result = result;
    this.phase = 'result';
    this.events.push({ kind: 'battleEnd', result, time: this.time, x: 0, z: 0 });
    this.events.push({ kind: 'phase', phase: 'result', time: this.time, x: 0, z: 0 });
  }

  deploymentZone(team: TeamId): Rect {
    return this.scenario.zones[team];
  }

  inPlayArea(x: number, z: number): boolean {
    if (this.map) return this.map.inPlayArea(x, z);
    const m = SQUAD.edgeMargin;
    return x >= m && z >= m && x <= this.terrain.width - m && z <= this.terrain.depth - m;
  }

  isVisible(squad: number, toTeam: TeamId): boolean {
    if (this.squads[squad].team === toTeam) return true;
    return this.vision ? this.vision.isVisible(squad, toTeam) : true;
  }

  bodyRadius(soldier: number): number {
    return SOLDIER.bodyRadius[this.units.type[soldier]];
  }
}

function specSize(type: UnitTypeId, spec: { size?: number; commander?: boolean }): number {
  if (spec.size !== undefined) return spec.size;
  return spec.commander ? COMMANDER.size : UNIT_TYPES[type].size;
}

const TEAM_NAMES = ['청람', '황토'];
function squadName(team: TeamId, type: UnitTypeId, commander: boolean, num: number): string {
  if (commander) return `${TEAM_NAMES[team]} 지휘관`;
  return `${TEAM_NAMES[team]} ${UNIT_TYPES[type].name} ${num}대`;
}
