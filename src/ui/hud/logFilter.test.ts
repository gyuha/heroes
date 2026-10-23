import { describe, expect, it } from 'vitest';
import type { SimEvent, TeamId } from '../../sim/api';
import { type LogVisibility, shouldLog } from './logFilter';

// 부대 0·1 = 청람(플레이어), 2·3 = 황토. 3은 보이지 않는다. 9 = 황토 지휘관(보임), 8 = 청람 지휘관.
const teams: Record<number, TeamId> = { 0: 0, 1: 0, 8: 0, 2: 1, 3: 1, 9: 1 };
const visible = new Set([0, 1, 2, 8, 9]);
const v: LogVisibility = {
  team: (id) => teams[id],
  seen: (id) => visible.has(id),
  commanderOf: (t) => (t === 0 ? 8 : 9),
};
const b = { time: 1, x: 0, z: 0 };
const log = (e: SimEvent, player: TeamId | null = 0) => shouldLog(e, player, v);

describe('shouldLog (D-013)', () => {
  it('아군 이벤트는 종류와 관계없이 모두 남긴다', () => {
    const own: SimEvent[] = [
      { ...b, kind: 'outOfRange', squad: 0, target: 2, heightDiff: -20, range: 96 },
      { ...b, kind: 'chargeFailed', squad: 1, target: 2, reason: 'forest' },
      { ...b, kind: 'highGround', squad: 0, bonusPct: 18 },
      { ...b, kind: 'attacked', squad: 1, side: 'flank' },
      { ...b, kind: 'rally', squad: 0 },
      { ...b, kind: 'rout', squad: 0, cause: 'rear' },
    ];
    for (const e of own) expect(log(e)).toBe(true);
  });

  it('보이는 적의 큰 사건만 남긴다', () => {
    expect(log({ ...b, kind: 'rout', squad: 2, cause: 'flank' })).toBe(true);
    expect(log({ ...b, kind: 'destroyed', squad: 2, reason: 'wiped' })).toBe(true);
    expect(
      log({
        ...b,
        kind: 'chargeImpact',
        squad: 2,
        target: 0,
        side: 'rear',
        speedRatio: 1,
        braced: false,
        kills: 9,
      }),
    ).toBe(true);
  });

  it('적의 내부 판정 로그는 숨긴다', () => {
    const hidden: SimEvent[] = [
      { ...b, kind: 'outOfRange', squad: 2, target: 0, heightDiff: -20, range: 96 },
      { ...b, kind: 'chargeFailed', squad: 2, target: 0, reason: 'forest' },
      { ...b, kind: 'highGround', squad: 2, bonusPct: 18 },
      { ...b, kind: 'attacked', squad: 2, side: 'rear' },
      { ...b, kind: 'rally', squad: 2 },
    ];
    for (const e of hidden) expect(log(e)).toBe(false);
  });

  it('적끼리의 사건(아군이 아닌 대상)은 숨긴다', () => {
    expect(
      log({
        ...b,
        kind: 'chargeImpact',
        squad: 2,
        target: 3,
        side: 'front',
        speedRatio: 1,
        braced: false,
        kills: 1,
      }),
    ).toBe(false);
    expect(log({ ...b, kind: 'engage', squad: 2, enemy: 3, side: 'front' })).toBe(false);
  });

  it('적이 아군과 교전을 시작한 것은 아군 부대의 사건이라 남긴다', () => {
    expect(log({ ...b, kind: 'engage', squad: 2, enemy: 0, side: 'flank' })).toBe(true);
  });

  it('보이지 않는 적의 사건은 큰 사건이라도 숨긴다', () => {
    expect(log({ ...b, kind: 'rout', squad: 3, cause: 'losses' })).toBe(false);
    expect(log({ ...b, kind: 'destroyed', squad: 3, reason: 'fled' })).toBe(false);
    expect(
      log({
        ...b,
        kind: 'chargeImpact',
        squad: 3,
        target: 0,
        side: 'front',
        speedRatio: 1,
        braced: false,
        kills: 3,
      }),
    ).toBe(false);
  });

  it('지휘관 전사: 아군은 항상, 적은 그 지휘관이 보였을 때만', () => {
    expect(log({ ...b, kind: 'commanderKilled', team: 0 })).toBe(true);
    expect(log({ ...b, kind: 'commanderKilled', team: 1 })).toBe(true);
    visible.delete(9);
    expect(log({ ...b, kind: 'commanderKilled', team: 1 })).toBe(false);
    visible.add(9);
  });

  it('깃발 상태 변화와 단계 전환은 항상 남긴다', () => {
    expect(log({ ...b, kind: 'flag', state: 'capturing', progress: 3 })).toBe(true);
    expect(log({ ...b, kind: 'phase', phase: 'battle' })).toBe(true);
  });

  it('관전 모드는 필터가 없다', () => {
    expect(
      log({ ...b, kind: 'outOfRange', squad: 3, target: 2, heightDiff: 0, range: 160 }, null),
    ).toBe(true);
  });
});
