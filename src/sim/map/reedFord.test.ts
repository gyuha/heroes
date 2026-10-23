import { beforeAll, describe, expect, it } from 'vitest';
import { TerrainType } from '../terrain';
import type { GameMap } from './gameMap';
import { createReedFord } from './reedFord';

const DEG = 180 / Math.PI;

let map: GameMap;
beforeAll(() => {
  map = createReedFord();
});

/** (x, z)에서 북쪽(+z) 방향 경사각(도). */
function northSlopeDeg(x: number, z: number): number {
  const g = [0, 0];
  map.terrain.gradientAt(x, z, g);
  return Math.atan(g[1]) * DEG;
}

describe('갈대 여울 배치 (GDD §10.2)', () => {
  it('크기 1,024m, 513×513 정점, 칸 2m', () => {
    const t = map.terrain;
    expect(t.width).toBe(1024);
    expect(t.depth).toBe(1024);
    expect(t.heights.length).toBe(513 * 513);
  });

  it('평지 10m 안팎, 강은 깊은 물이고 바닥이 수면보다 낮다', () => {
    expect(map.terrain.heightAt(940, 250)).toBeCloseTo(10, 0);
    expect(map.terrain.heightAt(300, 860)).toBeCloseTo(10, 0);
    for (const [x, z] of [
      [100, 603],
      [380, 593],
      [680, 590],
      [950, 595],
    ]) {
      expect(map.terrain.typeAt(x, z)).toBe(TerrainType.Water);
      expect(map.terrain.passableAt(x, z)).toBe(false);
    }
    expect(map.terrain.heightAt(380, 593)).toBeLessThan(map.meta.waterLevel);
  });

  it('다리 2개는 둑 높이(10m)로 평평한 다리 칸이고, 여울은 강을 가로지른다', () => {
    expect(map.meta.bridges.map((b) => b.x)).toEqual([241, 801]);
    for (const b of map.meta.bridges) {
      // 다리는 강 중심선(GDD 제어점을 지나는 곡선)에 맞춰 놓으므로 GDD 좌표(z 588~592)와 몇 m 다를 수 있다
      expect(Math.abs(b.z - 592)).toBeLessThanOrEqual(8);
      expect(map.terrain.typeAt(b.x, b.z)).toBe(TerrainType.Bridge);
      expect(map.terrain.heightAt(b.x, b.z)).toBeCloseTo(10, 2);
      expect(map.terrain.passableAt(b.x, b.z)).toBe(true);
      // 다리 폭 10m: 가장자리 바로 바깥은 물
      expect(map.terrain.typeAt(b.x + 6, b.z)).toBe(TerrainType.Water);
      expect(map.terrain.typeAt(b.x - 6, b.z)).toBe(TerrainType.Water);
    }
    for (const z of [588, 600, 612]) {
      expect(map.terrain.typeAt(520, z)).toBe(TerrainType.Ford);
      expect(map.terrain.passableAt(520, z)).toBe(true);
    }
    expect(map.terrain.typeAt(470, 598)).toBe(TerrainType.Water);
  });

  it('매봉 능선: 마루 35m, 북쪽 앞 경사 약 12°, 남쪽 뒤 경사 약 6°', () => {
    expect(map.terrain.heightAt(420, 425)).toBeGreaterThan(33);
    expect(map.terrain.heightAt(420, 425)).toBeLessThan(37);
    expect(-northSlopeDeg(420, 490)).toBeCloseTo(12, 0);
    expect(northSlopeDeg(420, 310)).toBeCloseTo(6, 0);
    // 깃발은 마루 근처에 있다
    const flag = map.flag()!;
    expect(map.terrain.heightAt(flag.x, flag.z)).toBeGreaterThan(32);
  });

  it('동쪽 벼랑(D-012)은 경계부터 능선 끝까지 막아 능선을 돌아갈 길이 없다', () => {
    const t = map.terrain;
    for (const [x, z] of [
      [60, 470],
      [120, 420],
      [130, 520],
    ]) {
      expect(t.typeAt(x, z)).toBe(TerrainType.Rock);
    }
    // 벼랑 북쪽(z 565~590)에서 출발해 x < 150 띠 안에서만 움직이면 능선 뒤(z ≤ 370)로 갈 수 없어야 한다.
    const maxIx = Math.floor(150 / t.cellSize);
    const minIx = Math.ceil(40 / t.cellSize);
    const seen = new Uint8Array(t.cellsX * t.cellsZ);
    const queue: number[] = [];
    for (let iz = Math.floor(565 / 2); iz <= Math.floor(590 / 2); iz++) {
      for (let ix = minIx; ix < maxIx; ix++) {
        if (t.cellPassable(ix, iz)) {
          seen[iz * t.cellsX + ix] = 1;
          queue.push(iz * t.cellsX + ix);
        }
      }
    }
    let reachedRear = false;
    while (queue.length > 0 && !reachedRear) {
      const c = queue.pop()!;
      const iz = Math.floor(c / t.cellsX);
      const ix = c - iz * t.cellsX;
      if (iz * t.cellSize <= 370) reachedRear = true;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = ix + dx;
        const nz = iz + dz;
        if (nx < minIx || nx >= maxIx || nz < 0 || nz >= t.cellsZ) continue;
        const n = nz * t.cellsX + nx;
        if (!seen[n] && t.cellPassable(nx, nz)) {
          seen[n] = 1;
          queue.push(n);
        }
      }
    }
    expect(reachedRear).toBe(false);
  });

  it('숲과 벼랑 외곽선은 직선이 아니다(±15~25m 굴곡)', () => {
    const t = map.terrain;
    /** 행 z에서 x0 부터 dir 방향으로 처음 type 이 끝나는 x */
    const edgeX = (z: number, x0: number, dir: number, type: number) => {
      let x = x0;
      while (t.typeAt(x, z) === type) x += dir * 2;
      return x;
    };
    const forestWest: number[] = [];
    const cliffEdge: number[] = [];
    // 둥근 모서리(반경 45m)를 피해 변의 곧은 구간만 잰다.
    for (let z = 376; z <= 474; z += 6) forestWest.push(edgeX(z, 780, 1, TerrainType.Forest));
    for (let z = 426; z <= 514; z += 6) cliffEdge.push(edgeX(z, 100, 1, TerrainType.Rock));
    const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(span(forestWest)).toBeGreaterThan(12);
    expect(span(cliffEdge)).toBeGreaterThan(12);
    for (const x of forestWest) expect(Math.abs(x - 880)).toBeLessThanOrEqual(26);
    for (const x of cliffEdge) expect(Math.abs(x - 180)).toBeLessThanOrEqual(26);
  });

  it('검은숲(D-012: 서쪽)은 가운데가 숲으로 이어지고 지면 10~14m, 북쪽 둔덕은 22m, 서쪽 들판은 평지', () => {
    for (let x = 710; x <= 850; x += 20) {
      for (let z = 360; z <= 490; z += 20) {
        expect(map.terrain.typeAt(x, z)).toBe(TerrainType.Forest);
        const h = map.terrain.heightAt(x, z);
        expect(h).toBeGreaterThan(9);
        expect(h).toBeLessThan(15);
      }
    }
    expect(map.terrain.heightAt(520, 760)).toBeCloseTo(22, 0);
    expect(map.terrain.typeAt(940, 380)).toBe(TerrainType.Grass);
  });

  it('흙길이 도하 지점으로 이어진다', () => {
    expect(map.terrain.typeAt(241, 640)).toBe(TerrainType.Sand);
    expect(map.terrain.typeAt(801, 640)).toBe(TerrainType.Sand);
    expect(map.terrain.typeAt(512, 628)).toBe(TerrainType.Sand);
  });

  it('배치 구역과 경계 40m', () => {
    expect(map.deploymentZone(0)).toEqual({ minX: 150, minZ: 150, maxX: 900, maxZ: 560 });
    expect(map.inPlayArea(20, 500)).toBe(false);
    expect(map.inPlayArea(500, 500)).toBe(true);
  });
});
