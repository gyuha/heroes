import { describe, expect, it } from 'vitest';
import {
  MIN_DRAG_LINE_M,
  buildDeployCommands,
  buildMoveCommand,
  buildSquadCommand,
  facingFromDragLine,
  lineFormation,
} from './commandPlanner';

describe('facingFromDragLine', () => {
  it('드래그 방향이 부대 오른쪽(−cos a, sin a)이 된다', () => {
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
      [-3, 4],
    ]) {
      const a = facingFromDragLine(dx, dz);
      const len = Math.hypot(dx, dz);
      expect(-Math.cos(a)).toBeCloseTo(dx / len);
      expect(Math.sin(a)).toBeCloseTo(dz / len);
    }
  });

  it('정면은 드래그 선분에 수직', () => {
    const a = facingFromDragLine(10, 0);
    // 정면 (sin a, cos a)는 선분 방향 (1, 0)과 수직
    expect(Math.sin(a) * 1 + Math.cos(a) * 0).toBeCloseTo(0);
  });
});

describe('lineFormation', () => {
  it('짧은 선분·없는 선분은 null', () => {
    expect(lineFormation(null)).toBeNull();
    expect(lineFormation({ x0: 0, z0: 0, x1: MIN_DRAG_LINE_M - 0.1, z1: 0 })).toBeNull();
  });

  it('중점·폭·정면', () => {
    const f = lineFormation({ x0: 10, z0: 0, x1: 10, z1: 40 })!;
    expect(f).toMatchObject({ x: 10, z: 20, width: 40 });
    expect(f.facing).toBeCloseTo(facingFromDragLine(0, 40));
  });
});

describe('명령 만들기', () => {
  it('클릭 이동은 facing·width 없이 목표점만', () => {
    expect(buildMoveCommand(0, [1, 2], { x: 5, z: 6 }, null)).toEqual({
      kind: 'move',
      team: 0,
      squads: [1, 2],
      x: 5,
      z: 6,
    });
  });

  it('드래그 이동은 선분 중점·정면·폭', () => {
    const cmd = buildMoveCommand(1, [3], { x: 0, z: 0 }, { x0: 0, z0: 0, x1: 0, z1: 40 });
    expect(cmd).toMatchObject({ kind: 'move', team: 1, squads: [3], x: 0, z: 20, width: 40 });
  });

  it('짧은 드래그는 클릭 이동으로 바뀐다', () => {
    const cmd = buildMoveCommand(0, [1], { x: 7, z: 8 }, { x0: 0, z0: 0, x1: 2, z1: 0 });
    expect(cmd).toEqual({ kind: 'move', team: 0, squads: [1], x: 7, z: 8 });
  });

  it('배치 명령은 자리마다 하나, 클릭 배치는 열 수를 보내지 않는다', () => {
    const slots = [
      { squadId: 1, x: 10, z: 20, facing: 1.5, files: 30 },
      { squadId: 2, x: 30, z: 20, facing: 1.5, files: 30 },
    ];
    expect(buildDeployCommands(0, slots, false)).toEqual([
      { kind: 'deploy', team: 0, squad: 1, x: 10, z: 20, facing: 1.5 },
      { kind: 'deploy', team: 0, squad: 2, x: 30, z: 20, facing: 1.5 },
    ]);
    expect(buildDeployCommands(0, slots, true)[0]).toMatchObject({ files: 30 });
  });

  it('돌격 표적이 없으면 target 필드를 넣지 않는다', () => {
    expect(buildSquadCommand(0, [1], { kind: 'charge', target: null })).toEqual({
      kind: 'charge',
      team: 0,
      squads: [1],
    });
    expect(buildSquadCommand(0, [1], { kind: 'charge', target: 9 })).toMatchObject({ target: 9 });
    expect(buildSquadCommand(1, [2], { kind: 'attack', target: 4 })).toEqual({
      kind: 'attack',
      team: 1,
      squads: [2],
      target: 4,
    });
    expect(buildSquadCommand(0, [1], { kind: 'formation', formation: 'loose' })).toEqual({
      kind: 'formation',
      team: 0,
      squads: [1],
      formation: 'loose',
    });
  });
});
