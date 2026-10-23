import { describe, expect, it } from 'vitest';
import { FixedStepClock } from './fixedStepClock';

describe('FixedStepClock', () => {
  it('누적 시간이 한 틱을 넘을 때마다 틱을 실행하고 나머지를 alpha 로 남긴다', () => {
    const clock = new FixedStepClock(50);
    expect(clock.advance(16)).toBe(0);
    expect(clock.advance(16)).toBe(0);
    expect(clock.advance(20)).toBe(1); // 52ms
    expect(clock.alpha).toBeCloseTo(2 / 50);
    expect(clock.advance(100)).toBe(2); // 102ms
    expect(clock.alpha).toBeCloseTo(2 / 50);
  });

  it('긴 정지 후에는 최대 틱 수만 실행하고 밀린 시간을 버린다', () => {
    const clock = new FixedStepClock(50, 5);
    expect(clock.advance(10_000)).toBe(5);
    expect(clock.alpha).toBe(0);
    expect(clock.advance(49)).toBe(0);
  });

  it('음수 경과 시간은 무시한다', () => {
    const clock = new FixedStepClock(50);
    expect(clock.advance(-100)).toBe(0);
    expect(clock.alpha).toBe(0);
  });
});
