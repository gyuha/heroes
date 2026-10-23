import { describe, expect, it } from 'vitest';
import * as original from '../../tools/balance/rules';
import * as rules from './rules';

describe('공식 사본', () => {
  it('tools/balance/rules.ts 와 같은 값을 낸다', () => {
    for (let d = -35; d <= 35; d += 0.5) {
      expect(rules.slopeSpeedFactor(d)).toBe(original.slopeSpeedFactor(d));
      expect(rules.slopeMeleeMult(d)).toBe(original.slopeMeleeMult(d));
    }
    for (let dh = -50; dh <= 50; dh += 1) {
      expect(rules.rangeWithHeight(160, dh)).toBe(original.rangeWithHeight(160, dh));
    }
    expect(rules.attackRanks(3.5, 1.6)).toBe(2);
    expect(rules.attackRanks(1.5, 1.6)).toBe(1);
    expect(rules.chargeImpactMult(0.59, 0.6)).toBe(0);
    expect(rules.chargeImpactMult(1, 0.6)).toBe(1);
  });
});
