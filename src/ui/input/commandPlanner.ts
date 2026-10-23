import type { Command, FormationId, TeamId } from '../../sim/api';
import type { MoveSlot } from '../gameView';

/** 이 길이(m)보다 짧은 우클릭 드래그는 클릭으로 본다. */
export const MIN_DRAG_LINE_M = 8;

export interface DragLine {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

/**
 * 드래그 방향(시작 → 끝)이 부대의 오른쪽이 되는 정면 각도(0 = +Z, 정면 벡터 = (sin a, cos a)).
 * 부대 오른쪽 벡터 = 정면 × 위 = (−cos a, sin a). 화면에서 왼쪽 → 오른쪽으로 끌면 부대는 카메라 반대쪽을 본다.
 */
export function facingFromDragLine(dx: number, dz: number): number {
  return Math.atan2(dz, -dx);
}

export function dragLength(line: DragLine): number {
  return Math.hypot(line.x1 - line.x0, line.z1 - line.z0);
}

/** 드래그 선분이 명령으로 쓸 만큼 길면 { 중점, 정면, 폭 }, 아니면 null(클릭). */
export function lineFormation(
  line: DragLine | null,
): { x: number; z: number; facing: number; width: number } | null {
  if (!line) return null;
  const width = dragLength(line);
  if (width < MIN_DRAG_LINE_M) return null;
  return {
    x: (line.x0 + line.x1) / 2,
    z: (line.z0 + line.z1) / 2,
    facing: facingFromDragLine(line.x1 - line.x0, line.z1 - line.z0),
    width,
  };
}

/** 전투 중 이동 명령. 드래그 선분이 있으면 중점·정면·폭(선분 길이)을 보낸다(§2.3). 분할은 sim이 한다. */
export function buildMoveCommand(
  team: TeamId,
  squadIds: readonly number[],
  target: { x: number; z: number },
  line: DragLine | null,
): Command {
  const f = lineFormation(line);
  if (f) return { kind: 'move', team, squads: squadIds, ...f };
  return { kind: 'move', team, squads: squadIds, x: target.x, z: target.z };
}

/**
 * 배치 단계 명령. sim이 계산한 자리(planMoveSlots)마다 deploy 하나.
 * 클릭 배치(선분 없음)는 열 수를 바꾸지 않는다.
 */
export function buildDeployCommands(
  team: TeamId,
  slots: readonly MoveSlot[],
  withFiles: boolean,
): Command[] {
  return slots.map((slot) => ({
    kind: 'deploy',
    team,
    squad: slot.squadId,
    x: slot.x,
    z: slot.z,
    facing: slot.facing,
    ...(withFiles ? { files: slot.files } : {}),
  }));
}

/** Z/C/X/F/G/H 등 선택 부대 전체에 같은 명령. */
export function buildSquadCommand(
  team: TeamId,
  squadIds: readonly number[],
  action:
    | { kind: 'attack'; target: number }
    | { kind: 'charge'; target: number | null }
    | { kind: 'advance' }
    | { kind: 'hold' }
    | { kind: 'formation'; formation: FormationId },
): Command {
  switch (action.kind) {
    case 'attack':
      return { kind: 'attack', team, squads: squadIds, target: action.target };
    case 'charge':
      return action.target === null
        ? { kind: 'charge', team, squads: squadIds }
        : { kind: 'charge', team, squads: squadIds, target: action.target };
    case 'advance':
      return { kind: 'advance', team, squads: squadIds };
    case 'hold':
      return { kind: 'hold', team, squads: squadIds };
    case 'formation':
      return { kind: 'formation', team, squads: squadIds, formation: action.formation };
  }
}
