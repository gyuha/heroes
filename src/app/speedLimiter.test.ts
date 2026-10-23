import { describe, expect, it } from 'vitest';
import { SPEED_LIMIT, SpeedLimiter } from './speedLimiter';

describe('4배속 자동 제한 (D-016)', () => {
  it('표본이 모이기 전에는 막지 않는다', () => {
    const l = new SpeedLimiter();
    for (let k = 0; k < SPEED_LIMIT.minSamples - 1; k++) l.record(10);
    expect(l.maxSpeed).toBe(4);
  });

  it('평균 틱이 4ms를 넘으면 2배속까지로 막고, 3ms 아래로 내려오면 다시 연다', () => {
    const l = new SpeedLimiter();
    for (let k = 0; k < SPEED_LIMIT.window; k++) l.record(3.5);
    expect(l.maxSpeed).toBe(4);
    for (let k = 0; k < SPEED_LIMIT.window; k++) l.record(5);
    expect(l.maxSpeed).toBe(2);
    expect(l.reason).toBeTruthy();
    // 3.5ms(경계 사이)로는 풀리지 않는다
    for (let k = 0; k < SPEED_LIMIT.window; k++) l.record(3.5);
    expect(l.maxSpeed).toBe(2);
    for (let k = 0; k < SPEED_LIMIT.window; k++) l.record(2);
    expect(l.maxSpeed).toBe(4);
    expect(l.reason).toBeNull();
  });
});
