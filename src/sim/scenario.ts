import type { FormationId, TeamId, UnitTypeId } from './api';
import { COMMANDER, UNIT_TYPES } from './data/balance';

export interface Rect {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/** 시나리오 안 부대 하나의 편성과 기본 배치. */
export interface SquadSpec {
  readonly type: UnitTypeId;
  /** 기본값 = 병종 size(BALANCE §2). 지휘관 부대는 COMMANDER.size */
  readonly size?: number;
  readonly commander?: boolean;
  readonly x: number;
  readonly z: number;
  /** 라디안, 0 = +Z */
  readonly facing: number;
  readonly files?: number;
  readonly formation?: FormationId;
  /** AI 계획이 부대를 가리키는 역할 이름(예: 'westBridge'). 표시에는 쓰지 않는다 */
  readonly role?: string;
}

/** 승리 조건 수치(GDD §3.2). */
export interface ScenarioRules {
  readonly timeLimit: number;
  readonly overtimeMax: number;
  /** 붕괴: 실질 병력 < 시작 병력 × breakRatio */
  readonly breakRatio: number;
  readonly flag: { readonly x: number; readonly z: number; readonly radius: number };
  readonly captureTime: number;
  readonly captureRate: number;
  readonly decayRate: number;
}

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly rules: ScenarioRules;
  readonly defender: TeamId;
  readonly attacker: TeamId;
  readonly zones: readonly [Rect, Rect];
  readonly teams: readonly [readonly SquadSpec[], readonly SquadSpec[]];
}

/** 측정용 병력 배율 범위(ARCHITECTURE §9.3) */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2;

/**
 * 성능 측정용 병력 배율(ARCHITECTURE §9.3): 부대 수와 배치는 그대로 두고 부대마다 병사 수를
 * round(기본 병사 수 × k)로 바꾼 시나리오를 돌려준다. 밸런스용이 아니다. k = 1이면 원본 그대로.
 */
export function scaleScenario(scenario: Scenario, k: number): Scenario {
  if (k === 1) return scenario;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, k));
  const resize = (s: SquadSpec): SquadSpec => {
    const base = s.size ?? (s.commander ? COMMANDER.size : UNIT_TYPES[s.type].size);
    return { ...s, size: Math.max(1, Math.round(base * scale)) };
  };
  return {
    ...scenario,
    id: `${scenario.id}@x${scale}`,
    teams: [scenario.teams[0].map(resize), scenario.teams[1].map(resize)],
  };
}
