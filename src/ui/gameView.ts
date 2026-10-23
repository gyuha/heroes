/**
 * UI가 읽는 게임 세션(D-011, INTERFACES §3.3). B의 `GameSession`(src/app/gameSession.ts)이
 * `implements UiSession`으로 이 목록을 구현한다. 개발 화면은 같은 타입의 목업(dev/session_mock.ts)을 쓴다.
 *
 * UI는 규칙(사거리, 경로, 이동 계수, 시야, 선분 분할)을 직접 계산하지 않고 세션에 묻는다.
 */
import type {
  BattleResult,
  Command,
  CommandResult,
  DeployCheck,
  FlagView,
  GamePhase,
  GameSpeed,
  MoveSlot,
  SimEvent,
  SquadView,
  TeamId,
  TeamStrength,
  UnitTypeId,
} from '../sim/api';
import type { Terrain } from '../sim/terrain';

export interface ZoneRect {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

export interface TerrainInfoView {
  /** 예: "여울" */
  readonly typeName: string;
  readonly height: number;
  readonly slopeDeg: number;
  readonly passable: boolean;
  /** 질의 병종 기준 가장 느린 방향(오르막) 이동 계수. 0 = 통과 불가, 병종 없음 = null */
  readonly moveFactor: number | null;
  /** 규칙 요약(GDD §6.5 "화면에 보여 줄 것"). 예: ["이동 50%", "돌격 불가", "공격 ×0.85"] */
  readonly effects: readonly string[];
}

export interface PathPreviewView {
  /** 출발점부터 도착점까지 (x, z) 쌍 */
  readonly points: Float32Array;
  /** 꼭짓점마다 그 지점의 이동 계수(종류 × 진행 방향 경사) */
  readonly factors: Float32Array;
  /** false = 목적지가 통과 불가라 옮겨졌거나 연결되지 않음 → "도달 불가" */
  readonly reachable: boolean;
  readonly etaSeconds: number;
  /** 예: ["돌격 불가: 숲 통과", "종대 통과: 다리"] */
  readonly warnings: readonly string[];
}

/** 궁수 실제 사거리(GDD §6.3). 방향 i의 각도 a = i / n × 2π, 방향 벡터 = (sin a, cos a). */
export interface RangeProfileView {
  readonly x: number;
  readonly z: number;
  /** 방향별 최대 사거리(m) */
  readonly radii: Float32Array;
  /** 방향별 직사 가능 거리(m). 이보다 멀고 radii 이내면 곡사만(빗금) */
  readonly directUntil: Float32Array;
}

export interface MapFeatureView {
  readonly kind: 'bridge' | 'ford';
  readonly x: number;
  readonly z: number;
}

/** 부대 하나의 도착 자리(선분 분할 결과). 정의는 sim이 갖는다(D-011, T-018). */
export type { MoveSlot } from '../sim/api';

export interface UiSession {
  // ---- B §2.2에 이미 있는 것
  readonly phase: GamePhase;
  readonly playerTeam: TeamId | null;
  readonly paused: boolean;
  readonly speed: GameSpeed;
  /** 지금 고를 수 있는 최고 배속(D-016: 한 틱이 4ms를 넘는 기기에서 4배속을 자동으로 막는다). */
  readonly maxSpeed: GameSpeed;
  /** maxSpeed가 4보다 낮은 이유, 제한이 없으면 null */
  readonly speedLimitReason: string | null;
  /** 성능 측정용 병력 배율(?scale=k, ARCHITECTURE §9.3). 1이 아니면 화면에 표시한다 */
  readonly scale: number;
  readonly battleTime: number;
  readonly timeLimit: number;
  readonly terrain: Terrain;

  chooseSide(team: TeamId): void;
  backToBriefing(): void;
  startBattle(): void;
  restart(): void;
  surrender(): void;
  setPaused(paused: boolean): void;
  setSpeed(speed: GameSpeed): void;

  issue(cmd: Command): CommandResult;
  canDeploy(squad: number, x: number, z: number, facing: number, files?: number): DeployCheck;

  squads(): readonly SquadView[];
  squad(id: number): SquadView;
  strength(team: TeamId): TeamStrength;
  flag(): FlagView;
  isVisible(squad: number, toTeam: TeamId): boolean;
  lastSeen(squad: number, byTeam: TeamId): { x: number; z: number; time: number } | null;
  deploymentZone(team: TeamId): ZoneRect;
  result(): BattleResult | null;
  onEvent(listener: (e: SimEvent) => void): () => void;

  // ---- UI 요구로 GameSession에 더할 것(INTERFACES §3.3)
  /**
   * move 명령과 같은 sim 순수 함수로 부대별 도착 자리를 계산한다(D-011). facing·width가 없으면
   * 클릭 이동(상대 배치 유지), 있으면 드래그 선분 분할.
   */
  planMoveSlots(
    squads: readonly number[],
    x: number,
    z: number,
    facing?: number,
    width?: number,
  ): readonly MoveSlot[];
  /** 마우스 오버 지형 정보. 병종을 주면 그 병종 이동 계수를 포함한다. */
  terrainInfo(x: number, z: number, type: UnitTypeId | null): TerrainInfoView;
  /** 경사 오버레이용. (dirX, dirZ) 방향 이동 계수(종류 × 경사), 0 = 통과 불가. UI는 병종이 바뀔 때만 칸마다 한 번 부른다. */
  moveFactorAt(type: UnitTypeId, x: number, z: number, dirX: number, dirZ: number): number;
  /** 우클릭 드래그 경로 미리보기. UI는 커서가 4m 넘게 움직였을 때만, 초당 최대 10회 부른다. */
  previewPath(squad: number, x: number, z: number): PathPreviewView;
  /** 궁수 실제 사거리. 궁수가 아니면 null. UI는 선택 변경·부대 이동 때만 부른다. */
  rangeProfile(squad: number): RangeProfileView | null;
  /** 전술 지도·미니맵 병목 아이콘(다리·여울) */
  mapFeatures(): readonly MapFeatureView[];
}
