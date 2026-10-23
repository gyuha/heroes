import { describe, expect, it } from 'vitest';
import { slopeSpeedFactor } from './rules';
import { Rng } from './rng';
import { heightsInto, Terrain } from './terrain';
import {
  directionalSlopeDeg,
  moveFactor,
  moveFactorInto,
  moveFactorsInto,
  typeSpeedFactor,
} from './terrainRules';
import { generateTerrain } from './terrainGen';

/*
 * T-020: 지형 질의를 인라인되기 쉬운 평평한 함수로 바꾼 뒤에도 결과가 비트 단위로 같아야 한다(결정론).
 * 아래 ref* 는 바꾸기 전 구현(locate + vertexHeight + clamp)을 그대로 옮긴 기준이다.
 */
function refClamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
function refVertex(t: Terrain, ix: number, iz: number): number {
  const cx = ix < 0 ? 0 : ix > t.cellsX ? t.cellsX : ix;
  const cz = iz < 0 ? 0 : iz > t.cellsZ ? t.cellsZ : iz;
  return t.heights[cz * (t.cellsX + 1) + cx];
}
function refLocate(t: Terrain, x: number, z: number) {
  const gx = refClamp(x / t.cellSize, 0, t.cellsX);
  const gz = refClamp(z / t.cellSize, 0, t.cellsZ);
  const ix = Math.min(Math.floor(gx), t.cellsX - 1);
  const iz = Math.min(Math.floor(gz), t.cellsZ - 1);
  return {
    fx: gx - ix,
    fz: gz - iz,
    h00: refVertex(t, ix, iz),
    h10: refVertex(t, ix + 1, iz),
    h01: refVertex(t, ix, iz + 1),
    h11: refVertex(t, ix + 1, iz + 1),
  };
}
function refHeight(t: Terrain, x: number, z: number): number {
  const { h00, h10, h01, h11, fx, fz } = refLocate(t, x, z);
  if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}
function refGradient(t: Terrain, x: number, z: number, out: Float32Array): void {
  const { h00, h10, h01, h11, fx, fz } = refLocate(t, x, z);
  const inv = 1 / t.cellSize;
  if (fx + fz <= 1) {
    out[0] = (h10 - h00) * inv;
    out[1] = (h01 - h00) * inv;
  } else {
    out[0] = (h11 - h01) * inv;
    out[1] = (h11 - h10) * inv;
  }
}
function refType(t: Terrain, x: number, z: number): number {
  const ix = refClamp(Math.floor(x / t.cellSize), 0, t.cellsX - 1);
  const iz = refClamp(Math.floor(z / t.cellSize), 0, t.cellsZ - 1);
  return t.types[iz * t.cellsX + ix];
}
function refPassable(t: Terrain, x: number, z: number): boolean {
  if (!(x >= 0 && x <= t.width && z >= 0 && z <= t.depth)) return false;
  const ix = Math.min(Math.floor(x / t.cellSize), t.cellsX - 1);
  const iz = Math.min(Math.floor(z / t.cellSize), t.cellsZ - 1);
  return t.cellPassable(ix, iz);
}
const refG = new Float32Array(2);
const RAD_TO_DEG = 180 / Math.PI;
function refDirSlope(t: Terrain, x: number, z: number, dx: number, dz: number): number {
  // D-017: 진행 방향 길이를 Math.hypot 에서 Math.sqrt(x² + z²)로 바꿨다(할당 제거, 마지막 비트 차이 허용 결정).
  // 그 밖의 계산은 바꾸기 전 구현 그대로다.
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len === 0) return 0;
  refGradient(t, x, z, refG);
  return Math.atan((refG[0] * dx + refG[1] * dz) / len) * RAD_TO_DEG;
}
function refMove(t: Terrain, x: number, z: number, dx: number, dz: number, m: boolean): number {
  if (!refPassable(t, x, z)) return 0;
  return typeSpeedFactor(refType(t, x, z), m) * slopeSpeedFactor(refDirSlope(t, x, z, dx, dz));
}

/** 무작위 점 + 칸 경계·맵 끝·맵 밖·NaN 같은 경계값. */
function samplePoints(t: Terrain, n: number): [number, number][] {
  const rng = new Rng(20);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++)
    pts.push([rng.range(-20, t.width + 20), rng.range(-20, t.depth + 20)]);
  const edges = [
    -0,
    0,
    1e-9,
    t.cellSize,
    t.cellSize * 3.5,
    t.width - 1e-9,
    t.width,
    t.width + 5,
    -5,
    NaN,
  ];
  for (const a of edges) for (const b of edges) pts.push([a, b]);
  return pts;
}

describe('지형 질의 빠른 경로 (T-020)', () => {
  const t = generateTerrain({ cellsX: 64, cellsZ: 48, cellSize: 2, seed: 9, maxHeight: 40 });
  const pts = samplePoints(t, 20000);
  const rng = new Rng(5);

  it('heightAt·gradientAt·slopeAt·typeAt·passableAt 가 바꾸기 전과 비트 단위로 같다', () => {
    const g = new Float32Array(2);
    const r = new Float32Array(2);
    for (const [x, z] of pts) {
      expect(Object.is(t.heightAt(x, z), refHeight(t, x, z)), `heightAt ${x},${z}`).toBe(true);
      t.gradientAt(x, z, g);
      refGradient(t, x, z, r);
      expect(Object.is(g[0], r[0]) && Object.is(g[1], r[1]), `gradientAt ${x},${z}`).toBe(true);
      expect(Object.is(t.slopeAt(x, z), Math.atan(Math.hypot(r[0], r[1])))).toBe(true);
      expect(t.typeAt(x, z)).toBe(refType(t, x, z));
      expect(t.passableAt(x, z)).toBe(refPassable(t, x, z));
    }
  });

  it('directionalSlopeDeg·moveFactor·moveFactorInto 가 바꾸기 전과 비트 단위로 같다', () => {
    const out = new Float64Array(2);
    for (const [x, z] of pts) {
      const dx = rng.range(-3, 3);
      const dz = rng.range(-3, 3);
      for (const [ax, az] of [
        [dx, dz],
        [0, 0],
      ]) {
        expect(Object.is(directionalSlopeDeg(t, x, z, ax, az), refDirSlope(t, x, z, ax, az))).toBe(
          true,
        );
        for (const m of [false, true]) {
          const ref = refMove(t, x, z, ax, az, m);
          expect(Object.is(moveFactor(t, x, z, ax, az, m), ref)).toBe(true);
          moveFactorInto(t, x, z, ax, az, m, out, 1);
          expect(Object.is(out[1], ref)).toBe(true);
        }
      }
    }
  });
});

describe('부대 단위 일괄 질의 (T-022)', () => {
  const t = generateTerrain({ cellsX: 64, cellsZ: 48, cellSize: 2, seed: 9, maxHeight: 40 });
  const n = 6000;
  const rng = new Rng(31);
  const xs = new Float32Array(n);
  const zs = new Float32Array(n);
  const dirX = new Float64Array(n);
  const dirZ = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // 맵 밖·경계 포함
    xs[i] = rng.range(-10, t.width + 10);
    zs[i] = rng.range(-10, t.depth + 10);
    if (i % 50 === 0) xs[i] = t.width;
    const a = rng.range(0, Math.PI * 2);
    const len = i % 17 === 0 ? 0 : rng.range(0.1, 3);
    dirX[i] = Math.sin(a) * len;
    dirZ[i] = Math.cos(a) * len;
  }
  // 절반만 고른다(index 에 없는 병사는 건드리지 않아야 한다)
  const index = new Int32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) if (i % 2 === 0) index[count++] = i;

  it('moveFactorsInto 는 고른 병사마다 moveFactor 와 정확히 같은 값을 쓰고 나머지는 그대로 둔다', () => {
    for (const mounted of [false, true]) {
      const out = new Float64Array(n).fill(-1);
      moveFactorsInto(t, xs, zs, dirX, dirZ, mounted, index, count, out);
      for (let i = 0; i < n; i++) {
        if (i % 2 === 1) {
          expect(out[i]).toBe(-1);
          continue;
        }
        const ref = moveFactor(t, xs[i], zs[i], dirX[i], dirZ[i], mounted);
        expect(Object.is(out[i], ref), `병사 ${i}`).toBe(true);
      }
    }
  });

  it('heightsInto 는 고른 병사마다 heightAt 과 같은 값을 쓴다', () => {
    const outY = new Float32Array(n).fill(-1);
    heightsInto(t, xs, zs, index, count, outY);
    for (let i = 0; i < n; i++) {
      expect(outY[i]).toBe(i % 2 === 1 ? -1 : Math.fround(t.heightAt(xs[i], zs[i])));
    }
  });
});
