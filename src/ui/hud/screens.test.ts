import { describe, expect, it } from 'vitest';
import { scaleNote } from './screens';

describe('scaleNote (ARCHITECTURE §9.3)', () => {
  it('배율을 소수 둘째 자리까지, 밸런스용이 아님을 함께 적는다', () => {
    expect(scaleNote(0.5)).toBe('측정용 병력 ×0.5 — 밸런스 결과로 쓰지 않음');
    expect(scaleNote(0.333333)).toBe('측정용 병력 ×0.33 — 밸런스 결과로 쓰지 않음');
    expect(scaleNote(2)).toBe('측정용 병력 ×2 — 밸런스 결과로 쓰지 않음');
  });
});
