import { describe, expect, it } from 'vitest';
import * as original from '../../../tools/balance/config';
import * as copy from './balance';

describe('밸런스 수치 사본', () => {
  it('tools/balance/config.ts(디자이너 원본)와 같다', () => {
    expect(copy.UNIT_TYPES).toEqual(original.UNIT_TYPES);
    expect(copy.COMBAT).toEqual(original.COMBAT);
    expect(copy.FORMATIONS).toEqual(original.FORMATIONS);
    expect(copy.COMMANDER).toEqual(original.COMMANDER);
    expect(copy.MORALE).toEqual(original.MORALE);
    expect(copy.TERRAIN).toEqual(original.TERRAIN);
  });
});
