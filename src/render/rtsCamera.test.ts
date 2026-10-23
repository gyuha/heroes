import { describe, expect, it } from 'vitest';
import { TACTICAL_OFF_DISTANCE, TACTICAL_ON_DISTANCE, nextTacticalView } from './rtsCamera';

describe('nextTacticalView', () => {
  it('켜짐·꺼짐 거리가 달라 경계에서 깜빡이지 않는다', () => {
    const mid = (TACTICAL_ON_DISTANCE + TACTICAL_OFF_DISTANCE) / 2;
    expect(nextTacticalView(false, mid)).toBe(false);
    expect(nextTacticalView(true, mid)).toBe(true);
    expect(nextTacticalView(false, TACTICAL_ON_DISTANCE)).toBe(true);
    expect(nextTacticalView(true, TACTICAL_OFF_DISTANCE - 1)).toBe(false);
  });
});
