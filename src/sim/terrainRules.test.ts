import { describe, expect, it } from 'vitest';
import { rangeWithHeight, slopeSpeedFactor } from './rules';
import { Terrain, TerrainType } from './terrain';
import {
  FOREST_LOS_CLEARANCE,
  fireLine,
  lineOfSight,
  moveFactor,
  typeSpeedFactor,
} from './terrainRules';

const DEG = Math.PI / 180;

/** x 방향으로 경사 slopeDeg 인 cells×cells 지형(칸 2m). */
function rampTerrain(slopeDeg: number, cells = 8, type: number = TerrainType.Grass): Terrain {
  const n = cells + 1;
  const heights = new Float32Array(n * n);
  const tan = Math.tan(slopeDeg * DEG);
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) heights[iz * n + ix] = ix * 2 * tan;
  return new Terrain(cells, cells, 2, heights, new Uint8Array(cells * cells).fill(type));
}

/** 평지(높이 10m) cellsX × 4 칸 띠, 칸 2m. edit 로 높이·종류를 고친다. */
function flatStrip(cellsX: number, edit?: (t: Terrain) => void): Terrain {
  const heights = new Float32Array((cellsX + 1) * 5).fill(10);
  const t = new Terrain(cellsX, 4, 2, heights, new Uint8Array(cellsX * 4));
  edit?.(t);
  return t;
}

function setColumnType(t: Terrain, x0: number, x1: number, type: number): void {
  for (let iz = 0; iz < t.cellsZ; iz++)
    for (let ix = Math.floor(x0 / 2); ix < Math.ceil(x1 / 2); ix++)
      t.types[iz * t.cellsX + ix] = type;
}

describe('경사 이동 계수 (GDD §6.2 표)', () => {
  const table: [number, number, number][] = [
    // 경사, 오르막, 내리막. GDD 표는 % 반올림(88·63·38%)이라 공식의 정확한 값으로 비교한다.
    [5, 0.875, 1.05],
    [10, 0.75, 1.1],
    [15, 0.625, 1.0],
    [20, 0.5, 0.8],
    [25, 0.375, 0.6],
  ];
  for (const [deg, up, down] of table) {
    it(`${deg}°: 오르막 ${up * 100}%, 내리막 ${down * 100}%`, () => {
      const t = rampTerrain(deg);
      expect(moveFactor(t, 7, 7, 1, 0, false)).toBeCloseTo(up, 2);
      expect(moveFactor(t, 7, 7, -1, 0, false)).toBeCloseTo(down, 2);
      // 등고선을 따라가면 경사 영향이 없다
      expect(moveFactor(t, 7, 7, 0, 1, false)).toBeCloseTo(1, 5);
    });
  }

  it('30°는 오르막 35%, 내리막 40%, 30° 초과는 통과 불가', () => {
    expect(slopeSpeedFactor(30)).toBeCloseTo(0.35, 5);
    expect(slopeSpeedFactor(-30)).toBeCloseTo(0.4, 5);
    const steep = rampTerrain(31);
    expect(steep.passableAt(7, 7)).toBe(false);
    expect(moveFactor(steep, 7, 7, 0, 1, false)).toBe(0); // 등고선 방향이어도 칸이 막힘
    expect(rampTerrain(29.5).passableAt(7, 7)).toBe(true);
  });
});

describe('지형 종류 이동 계수 (GDD §6.1 표)', () => {
  it('보병류 / 기병 계수', () => {
    expect(typeSpeedFactor(TerrainType.Grass, false)).toBe(1);
    expect(typeSpeedFactor(TerrainType.Forest, false)).toBeCloseTo(0.6);
    expect(typeSpeedFactor(TerrainType.Forest, true)).toBeCloseTo(0.4);
    expect(typeSpeedFactor(TerrainType.Sand, true)).toBeCloseTo(1.1);
    expect(typeSpeedFactor(TerrainType.Ford, false)).toBeCloseTo(0.5);
    expect(typeSpeedFactor(TerrainType.Ford, true)).toBeCloseTo(0.4);
    expect(typeSpeedFactor(TerrainType.Bridge, true)).toBe(1);
    expect(typeSpeedFactor(TerrainType.Water, false)).toBe(0);
    expect(typeSpeedFactor(TerrainType.Rock, true)).toBe(0);
  });

  it('강·절벽 칸은 통과 불가이고 이동 계수 0, 경사와 곱해진다', () => {
    expect(moveFactor(rampTerrain(0, 4, TerrainType.Water), 3, 3, 1, 0, false)).toBe(0);
    expect(moveFactor(rampTerrain(0, 4, TerrainType.Rock), 3, 3, 1, 0, true)).toBe(0);
    expect(moveFactor(rampTerrain(10, 8, TerrainType.Forest), 7, 7, 1, 0, true)).toBeCloseTo(
      0.4 * 0.75,
      2,
    );
  });
});

describe('고도차 사거리 (GDD §6.3 표)', () => {
  const table: [number, number][] = [
    [-30, 96],
    [-20, 96],
    [-10, 137],
    [0, 160],
    [10, 178],
    [20, 193],
    [30, 206],
    [40, 219],
  ];
  for (const [dh, range] of table) {
    it(`Δh ${dh}m → ${range}m`, () => {
      expect(Math.round(rangeWithHeight(160, dh))).toBe(range);
    });
  }
});

describe('직사 LOS', () => {
  it('평지는 열려 있다', () => {
    const t = flatStrip(200);
    expect(lineOfSight(t, 2, 11.7, 4, 398, 11.7, 4)).toBe(true);
  });

  it('사이의 언덕이 막는다', () => {
    const t = flatStrip(200, (t) => {
      // x = 200m 부근 격자점을 15m로 올린다(눈높이 11.7m보다 높음)
      for (let iz = 0; iz <= 4; iz++) t.heights[iz * 201 + 100] = 15;
    });
    expect(lineOfSight(t, 2, 11.7, 4, 398, 11.7, 4)).toBe(false);
    // 언덕보다 높은 곳에서 보면 열린다
    expect(lineOfSight(t, 2, 30, 4, 398, 30, 4)).toBe(true);
  });

  it('가운데 숲(12m 장애물)이 막고, 숲보다 높은 선은 지나간다', () => {
    const t = flatStrip(200, (t) => setColumnType(t, 180, 220, TerrainType.Forest));
    expect(lineOfSight(t, 2, 11.7, 4, 398, 11.7, 4)).toBe(false);
    expect(lineOfSight(t, 2, 23, 4, 398, 23, 4)).toBe(true);
  });

  it(`끝점에서 ${FOREST_LOS_CLEARANCE}m 안의 숲은 막지 않는다(숲 가장자리 부대가 밖을 본다)`, () => {
    const t = flatStrip(200, (t) => setColumnType(t, 0, 30, TerrainType.Forest));
    // 관찰자 x=10(숲 안, 가장자리까지 20m) → 숲 밖 표적
    expect(lineOfSight(t, 10, 11.7, 4, 300, 11.7, 4)).toBe(true);
    // 숲이 끝점에서 40m를 넘게 이어지면 막는다
    const deep = flatStrip(200, (t) => setColumnType(t, 0, 120, TerrainType.Forest));
    expect(lineOfSight(deep, 10, 11.7, 4, 300, 11.7, 4)).toBe(false);
  });
});

describe('사격 방식 (GDD §5.5)', () => {
  it('열리면 직사, 숲에 막히면 곡사, 높은 벽이면 불가', () => {
    expect(fireLine(flatStrip(100), 4, 4, 150, 4)).toBe('direct');
    const forest = flatStrip(100, (t) => setColumnType(t, 70, 90, TerrainType.Forest));
    expect(fireLine(forest, 4, 4, 150, 4)).toBe('arc');
    const wall = flatStrip(100, (t) => {
      for (let iz = 0; iz <= 4; iz++) t.heights[iz * 101 + 40] = 80;
    });
    expect(fireLine(wall, 4, 4, 150, 4)).toBe('blocked');
  });
});
