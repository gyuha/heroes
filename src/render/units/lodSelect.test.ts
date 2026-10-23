import { describe, expect, it } from 'vitest';
import { LOD, updateLodMask } from './lodSelect';

describe('병사 LOD (부대 단위, 히스테리시스)', () => {
  const at = (x: number) => [{ x, z: 0, groundY: -LOD.eyeHeight }];

  it('들어가는 거리(160m) 밖에서 LOD1, 나오는 거리(140m) 안에서 LOD0', () => {
    const mask = new Uint8Array(1);
    updateLodMask(mask, at(150), 0, 0, 0);
    expect(mask[0]).toBe(0); // 150m: 아직 LOD0
    updateLodMask(mask, at(170), 0, 0, 0);
    expect(mask[0]).toBe(1);
    updateLodMask(mask, at(150), 0, 0, 0);
    expect(mask[0]).toBe(1); // 경계 사이에서는 그대로(깜빡임 없음)
    updateLodMask(mask, at(130), 0, 0, 0);
    expect(mask[0]).toBe(0);
  });

  it('카메라 높이도 거리에 들어간다(높이 올려 내려다보면 멀어진다)', () => {
    const mask = new Uint8Array(1);
    updateLodMask(mask, at(100), 0, 150, 0);
    expect(mask[0]).toBe(1); // 수평 100m, 높이 150m → 약 180m
  });
});
