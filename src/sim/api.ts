/**
 * 시뮬레이션 공개 인터페이스(docs/INTERFACES.md §2). UI·렌더·AI는 이 타입으로만 sim과 주고받는다.
 * - 입력: Command 를 GameSession.issue() 로 넣으면 다음 틱 시작 때 처리된다.
 * - 출력: 틱마다 SimEvent 를 내보내고, 상태는 SquadView 등 읽기 전용 값으로 읽는다.
 */

/** 0 = 청람(방어, 남쪽), 1 = 황토(공격, 북쪽). */
export type TeamId = 0 | 1;
export const TEAM_DEFENDER: TeamId = 0;
export const TEAM_ATTACKER: TeamId = 1;

export type { UnitTypeId } from './data/balance';
import type { UnitTypeId } from './data/balance';
export type FormationId = 'line' | 'column' | 'loose';
/** 방어 부대 기준 공격자가 있는 방향(GDD §5.2). */
export type Side = 'front' | 'flank' | 'rear';

export type SquadState = 'ready' | 'routing' | 'destroyed';
/** `ready` 안의 하위 상태(GDD §4.5). */
export type SquadActivity =
  'idle' | 'moving' | 'engaged' | 'charging' | 'holding' | 'braced' | 'disengaging' | 'pursuing';
export type MoraleBand = 'steady' | 'wavering' | 'routing';
export type OrderKind = 'none' | 'move' | 'attack' | 'advance' | 'hold';

/** 한 판의 단계(GDD §2). 일시정지·배속은 battle 안의 하위 상태다. */
export type GamePhase = 'briefing' | 'deployment' | 'battle' | 'result';
export type GameSpeed = 1 | 2 | 4;

// ------------------------------------------------------------------ 명령 (UI·AI → sim)

interface CommandBase {
  /** 명령을 내리는 진영. 자기 진영이 아닌 부대는 무시한다(AI도 같은 경로를 쓴다). */
  team: TeamId;
}
interface SquadsCommand extends CommandBase {
  /** 선택된 부대 ID 목록. 비어 있으면 아무 일도 하지 않는다(GDD §7.1). */
  squads: readonly number[];
}

export type Command =
  /**
   * 이동. (x, z)는 도착 위치 중심. facing(라디안, 0 = +Z)이 없으면 이동 방향을 정면으로 선다.
   * width(m)는 우클릭 드래그 선분 길이. 여러 부대면 선분을 부대 수로 나눠 나란히 세운다.
   * width가 없고 여러 부대면 부대들의 현재 상대 배치를 유지한 채 무리 중심을 (x, z)로 옮긴다.
   */
  | (SquadsCommand & { kind: 'move'; x: number; z: number; facing?: number; width?: number })
  | (SquadsCommand & { kind: 'attack'; target: number })
  /** 돌격(Z). target이 없으면 현재 공격 표적에 돌격한다. */
  | (SquadsCommand & { kind: 'charge'; target?: number })
  | (SquadsCommand & { kind: 'advance' })
  | (SquadsCommand & { kind: 'hold' })
  /** 대형 변경. files(8~80)를 주면 열 수도 바꾼다. */
  | (SquadsCommand & { kind: 'formation'; formation: FormationId; files?: number })
  /** 배치 단계에서만 유효. 배치 구역 밖·통과 불가면 거부된다(canDeploy로 미리 확인). */
  | (CommandBase & {
      kind: 'deploy';
      squad: number;
      x: number;
      z: number;
      facing: number;
      files?: number;
      formation?: FormationId;
    });

/**
 * 부대 하나의 도착 자리(드래그 선분 분할·상대 배치 유지 결과). planLineMove·planGroupMove와
 * GameSession.planMoveSlots가 돌려준다. UI 미리보기와 move 명령 적용이 같은 값을 쓴다(D-011).
 */
export interface MoveSlot {
  readonly squadId: number;
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly files: number;
}

export type CommandResult =
  'ok' | 'noSelection' | 'notYourSquad' | 'wrongPhase' | 'invalidTarget' | 'invalidPlacement';

export type DeployCheck =
  | { ok: true }
  | { ok: false; reason: 'outsideZone' | 'impassable' | 'notYourSquad' | 'wrongPhase' };

// ------------------------------------------------------------------ 읽기 전용 상태 (sim → UI·렌더)

export interface SquadView {
  readonly id: number;
  readonly team: TeamId;
  readonly type: UnitTypeId;
  readonly isCommander: boolean;
  /** 표시 이름. 예: "청람 창병 2대" */
  readonly name: string;
  readonly state: SquadState;
  readonly activity: SquadActivity;
  readonly order: OrderKind;
  /** 공격 표적 부대 ID, 없으면 -1 */
  readonly targetId: number;
  /** 이동 명령의 목적지(m). 이동 명령이 아니면 NaN */
  readonly destX: number;
  readonly destZ: number;
  readonly formation: FormationId;
  readonly files: number;
  /** 대형 중심(m)과 정면 방향(라디안), 대형 폭·깊이(m) */
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly width: number;
  readonly depth: number;
  readonly startCount: number;
  readonly count: number;
  /** 0~100 */
  readonly morale: number;
  readonly moraleBand: MoraleBand;
  /** 돌격 재사용 대기 남은 초(0이면 준비). 돌격이 없는 병종은 0 */
  readonly chargeCooldown: number;
  readonly canCharge: boolean;
  readonly shieldWall: boolean;
  readonly braced: boolean;
  /** 숲 은폐 중(GDD §6.4) */
  readonly concealed: boolean;
  /** 경로가 좁아 열 수를 자동으로 줄인 상태("종대 통과 중") */
  readonly autoNarrowed: boolean;
  /** 근접 교전 중 고저차 배율 보너스(%). 예: 18 → "고지 +18%". 교전 중이 아니면 0 */
  readonly heightBonusPct: number;
  readonly kills: number;
}

export interface TeamStrength {
  readonly start: number;
  /** 실질 병력: ready 부대의 생존 병사(GDD §3.1) */
  readonly effective: number;
  readonly routing: number;
  readonly lost: number;
}

export type FlagState = 'defended' | 'empty' | 'capturing';
export interface FlagView {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly state: FlagState;
  /** 0~captureTime(60) */
  readonly progress: number;
  readonly captureTime: number;
  readonly overtime: boolean;
}

export type EndReason = 'flagCaptured' | 'timeHeld' | 'collapse' | 'draw' | 'surrender';
export type RoutCause =
  'losses' | 'melee' | 'flank' | 'rear' | 'charge' | 'nearbyRout' | 'commanderDeath' | 'arrows';

export interface BattleResult {
  /** -1 = 무승부 */
  readonly winner: TeamId | -1;
  readonly reason: EndReason;
  /** 전투 시간(초) */
  readonly time: number;
  readonly teams: readonly [TeamResult, TeamResult];
  /** 패주 원인 상위(시간순 아님, 영향 큰 순). 결과 화면 "패주 원인 상위 3개" */
  readonly routCauses: readonly RoutRecord[];
}
export interface TeamResult extends TeamStrength {
  readonly kills: number;
  /** 근접 교전 병사·초 중 고지(고저차 배율 > 1)에서 싸운 비율 0~1 */
  readonly highGroundShare: number;
  readonly flankAttacks: number;
  readonly rearAttacks: number;
}
export interface RoutRecord {
  readonly squad: number;
  readonly cause: RoutCause;
  /** 그 원인으로 잃은 사기 합계 */
  readonly moraleLost: number;
  /** 패주 시각(초) */
  readonly time: number;
}

// ------------------------------------------------------------------ 이벤트 (sim → UI 로그·사운드·VFX)

interface EventBase {
  /** 전투 시간(초) */
  time: number;
  /** 로그 클릭 시 카메라가 갈 위치 */
  x: number;
  z: number;
}

export type ChargeFailReason = 'forest' | 'ford' | 'uphill' | 'shortRunUp' | 'bracedFront';

/**
 * 로그성 이벤트(engage 제외 전투 상황 알림)는 GDD §6.5대로 같은 부대·같은 원인을 10초에 한 번만 낸다.
 * 상태 전환 이벤트(rout, rally, destroyed, commanderKilled, flag, phase, battleEnd)는 항상 낸다.
 */
export type SimEvent =
  | (EventBase & { kind: 'engage'; squad: number; enemy: number; side: Side })
  | (EventBase & {
      kind: 'chargeImpact';
      squad: number;
      target: number;
      side: Side;
      speedRatio: number;
      braced: boolean;
      kills: number;
    })
  | (EventBase & { kind: 'chargeFailed'; squad: number; target: number; reason: ChargeFailReason })
  | (EventBase & { kind: 'attacked'; squad: number; side: 'flank' | 'rear' })
  | (EventBase & { kind: 'highGround'; squad: number; bonusPct: number })
  /** heightDiff = 사수 지면 − 표적 지면(m). 음수면 표적이 높다(rangeWithHeight의 Δh와 같은 부호) */
  | (EventBase & {
      kind: 'outOfRange';
      squad: number;
      target: number;
      heightDiff: number;
      range: number;
    })
  | (EventBase & { kind: 'rout'; squad: number; cause: RoutCause })
  | (EventBase & { kind: 'rally'; squad: number })
  | (EventBase & { kind: 'destroyed'; squad: number; reason: 'wiped' | 'fled' | 'edge' })
  | (EventBase & { kind: 'commanderKilled'; team: TeamId })
  | (EventBase & { kind: 'flag'; state: FlagState; progress: number })
  | (EventBase & { kind: 'phase'; phase: GamePhase })
  | (EventBase & { kind: 'battleEnd'; result: BattleResult });

export type SimEventKind = SimEvent['kind'];
