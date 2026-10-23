import { describe, expect, it } from 'vitest';
import { Rng } from './rng';
import { SpatialGrid } from './spatialGrid';

describe('SpatialGrid', () => {
  it('반경 안의 병사를 전수 탐색과 똑같이 찾는다', () => {
    const n = 2000;
    const rng = new Rng(1);
    const xs = new Float32Array(n);
    const zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = rng.range(0, 100);
      zs[i] = rng.range(0, 100);
    }
    const grid = new SpatialGrid(100, 100, 2, n);
    grid.build(xs, zs, n);
    const out = new Int32Array(n);

    for (let q = 0; q < 50; q++) {
      const x = rng.range(0, 100);
      const z = rng.range(0, 100);
      const r = rng.range(0.5, 6);
      const found = Array.from(out.subarray(0, grid.query(xs, zs, x, z, r, out))).sort(
        (a, b) => a - b,
      );
      const expected: number[] = [];
      for (let i = 0; i < n; i++) {
        if ((xs[i] - x) ** 2 + (zs[i] - z) ** 2 <= r * r) expected.push(i);
      }
      expect(found).toEqual(expected);
    }
  });

  it('맵 경계 밖 좌표도 가장자리 칸에 넣는다', () => {
    const xs = new Float32Array([-5, 105]);
    const zs = new Float32Array([50, 50]);
    const grid = new SpatialGrid(100, 100, 2, 2);
    grid.build(xs, zs, 2);
    const out = new Int32Array(2);
    expect(grid.query(xs, zs, -5, 50, 1, out)).toBe(1);
    expect(out[0]).toBe(0);
  });
});
