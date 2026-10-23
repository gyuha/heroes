import { IMPASSABLE_SLOPE_RAD, Terrain, TerrainType } from './terrain';

export interface TerrainGenOptions {
  cellsX: number;
  cellsZ: number;
  cellSize: number;
  seed: number;
  /** 최고 높이(m). */
  maxHeight: number;
}

const WATER_LEVEL_RATIO = 0.08;
const SAND_LEVEL_RATIO = 0.12;
const FOREST_NOISE_THRESHOLD = 0.62;

/**
 * 절차 생성 지형. 개발·테스트용이다(실제 맵은 map/ 의 로더로 읽는다).
 * 가운데는 완만한 평지, 가장자리로 갈수록 언덕이 높아진다.
 */
export function generateTerrain(opts: TerrainGenOptions): Terrain {
  const { cellsX, cellsZ, cellSize, seed, maxHeight } = opts;
  const vx = cellsX + 1;
  const vz = cellsZ + 1;
  const heights = new Float32Array(vx * vz);

  for (let iz = 0; iz < vz; iz++) {
    for (let ix = 0; ix < vx; ix++) {
      const u = ix / cellsX;
      const v = iz / cellsZ;
      const n = fbm(u * 6, v * 6, seed, 5);
      // 중앙 평지: 중심에서 멀수록 언덕 비중을 키운다.
      const d = Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2);
      const hill = smoothstep(0.25, 1, d);
      heights[iz * vx + ix] = maxHeight * (0.1 + n * (0.15 + 0.85 * hill));
    }
  }

  const terrain = new Terrain(cellsX, cellsZ, cellSize, heights, new Uint8Array(cellsX * cellsZ));
  const types = terrain.types;
  for (let iz = 0; iz < cellsZ; iz++) {
    for (let ix = 0; ix < cellsX; ix++) {
      const cx = (ix + 0.5) * cellSize;
      const cz = (iz + 0.5) * cellSize;
      const h = terrain.heightAt(cx, cz);
      let type: number = TerrainType.Grass;
      if (h < maxHeight * WATER_LEVEL_RATIO) type = TerrainType.Water;
      else if (h < maxHeight * SAND_LEVEL_RATIO) type = TerrainType.Sand;
      else if (terrain.slopeAt(cx, cz) > IMPASSABLE_SLOPE_RAD) type = TerrainType.Rock;
      else if (fbm((ix / cellsX) * 10, (iz / cellsZ) * 10, seed + 7, 3) > FOREST_NOISE_THRESHOLD)
        type = TerrainType.Forest;
      types[iz * cellsX + ix] = type;
    }
  }
  return terrain;
}

/** 프랙탈 값 노이즈. 결과는 대략 [0, 1]. */
export function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x, y, seed + o * 101) * amp;
    norm += amp;
    x *= 2;
    y *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(0, 1, x - x0);
  const ty = smoothstep(0, 1, y - y0);
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
