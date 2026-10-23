import { describe, expect, it } from 'vitest';
import { Terrain, TerrainType } from './terrain';
import { generateTerrain } from './terrainGen';

/** 2×1 칸, 칸 크기 10m. 격자점 높이: 아래 줄 0, 10, 20 / 위 줄 0, 10, 20 (x 방향 경사 1). */
function ramp(): Terrain {
  const heights = new Float32Array([0, 10, 20, 0, 10, 20]);
  const types = new Uint8Array([TerrainType.Grass, TerrainType.Rock]);
  return new Terrain(2, 1, 10, heights, types);
}

describe('Terrain', () => {
  it('격자점에서는 격자점 높이를, 사이에서는 선형 보간 높이를 돌려준다', () => {
    const t = ramp();
    expect(t.heightAt(0, 0)).toBe(0);
    expect(t.heightAt(10, 0)).toBe(10);
    expect(t.heightAt(20, 10)).toBe(20);
    expect(t.heightAt(5, 2)).toBeCloseTo(5);
    expect(t.heightAt(15, 8)).toBeCloseTo(15);
  });

  it('범위 밖 좌표는 가장자리 높이로 고정한다', () => {
    const t = ramp();
    expect(t.heightAt(-5, 5)).toBe(0);
    expect(t.heightAt(100, 5)).toBe(20);
  });

  it('경사각과 기울기 벡터를 계산한다', () => {
    const t = ramp();
    expect(t.slopeAt(5, 5)).toBeCloseTo(Math.PI / 4); // 1m 진행에 1m 상승 = 45°
    const g = [0, 0];
    t.gradientAt(12, 7, g);
    expect(g[0]).toBeCloseTo(1);
    expect(g[1]).toBeCloseTo(0);
  });

  it('두 삼각형 중 어느 쪽이든 칸 경계에서 높이가 이어진다', () => {
    // 한 칸 안에서 대각선 양쪽 높이가 다른 경우: h00=0, h10=0, h01=0, h11=8
    const t = new Terrain(1, 1, 2, new Float32Array([0, 0, 0, 8]), new Uint8Array(1));
    expect(t.heightAt(1, 1)).toBeCloseTo(0); // 대각선 위
    expect(t.heightAt(1.0001, 1.0001)).toBeCloseTo(0, 2);
    expect(t.heightAt(2, 2)).toBe(8);
    expect(t.heightAt(2, 1)).toBeCloseTo(4); // 오른쪽 변의 중점
  });

  it('지형 종류를 칸 단위로 조회한다', () => {
    const t = ramp();
    expect(t.typeAt(3, 3)).toBe(TerrainType.Grass);
    expect(t.typeAt(13, 3)).toBe(TerrainType.Rock);
    expect(t.typeAt(20, 10)).toBe(TerrainType.Rock); // 끝 경계는 마지막 칸
  });
});

describe('generateTerrain', () => {
  it('같은 시드면 같은 지형을 만든다', () => {
    const opts = { cellsX: 32, cellsZ: 32, cellSize: 2, seed: 42, maxHeight: 30 };
    const a = generateTerrain(opts);
    const b = generateTerrain(opts);
    expect(a.heights).toEqual(b.heights);
    expect(a.types).toEqual(b.types);
    for (const h of a.heights) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(30);
    }
  });
});
