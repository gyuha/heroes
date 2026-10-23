import { describe, expect, it } from 'vitest';
import { Terrain } from '../../sim/terrain';
import { DrapedLines } from './drapedLines';

function bumpyTerrain(): Terrain {
  const cells = 16;
  const heights = new Float32Array((cells + 1) * (cells + 1));
  for (let iz = 0; iz <= cells; iz++) {
    for (let ix = 0; ix <= cells; ix++) {
      heights[iz * (cells + 1) + ix] = 10 + 6 * Math.sin(ix * 0.9) * Math.cos(iz * 0.7) + ix * 0.3;
    }
  }
  return new Terrain(cells, cells, 2, heights, new Uint8Array(cells * cells));
}

describe('DrapedLines', () => {
  it('정점 높이는 Terrain.heightAt + lift와 같다(같은 칸 분할, 범위 밖 고정 포함)', () => {
    const t = bumpyTerrain();
    const lines = new DrapedLines(t, 2000);
    lines.lift = 0.5;
    lines.begin();
    lines.polyline([-3, 1, 7.3, 9.9, 31.7, 4.2, 40, 40], 1.2, '#ffffff', 1);
    lines.end();
    const n = (lines as unknown as { vertices: number }).vertices;
    expect(n).toBeGreaterThan(20);
    for (let v = 0; v < n; v++) {
      const [x, y, z] = lines.vertexAt(v);
      expect(y).toBeCloseTo(t.heightAt(x, z) + 0.5, 4);
    }
  });

  it('직전 프레임과 같으면 GPU에 올리지 않고, 바뀌면 쓴 범위만 올린다', () => {
    const t = bumpyTerrain();
    const lines = new DrapedLines(t, 2000);
    const draw = (x: number) => {
      lines.begin();
      lines.line(x, 2, x + 10, 12, 1, '#ff0000', 0.8);
      lines.end();
    };
    draw(2);
    const first = lines.lastUploadBytes;
    expect(first).toBeGreaterThan(0);
    draw(2);
    expect(lines.lastUploadBytes).toBe(0);
    draw(3);
    expect(lines.lastUploadBytes).toBe(first);
  });

  it('높이를 재사용해도 lift가 바뀌면 다시 계산한다', () => {
    const t = bumpyTerrain();
    const lines = new DrapedLines(t, 2000);
    const draw = (lift: number) => {
      lines.lift = lift;
      lines.begin();
      lines.line(4, 4, 20, 9, 1, '#00ff00', 1);
      lines.end();
    };
    draw(0.5);
    draw(2);
    const [x, y, z] = lines.vertexAt(3);
    expect(y).toBeCloseTo(t.heightAt(x, z) + 2, 4);
    expect(lines.lastUploadBytes).toBeGreaterThan(0);
  });
});
