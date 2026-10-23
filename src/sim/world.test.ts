import { describe, expect, it } from 'vitest';
import { TICK_DT } from './constants';
import { Terrain } from './terrain';
import { World } from './world';

/** 100m × 100m, x 방향으로 0m → 10m 오르막. */
function slopedWorld(capacity: number): World {
  const cells = 10;
  const heights = new Float32Array((cells + 1) * (cells + 1));
  for (let iz = 0; iz <= cells; iz++)
    for (let ix = 0; ix <= cells; ix++) heights[iz * 11 + ix] = ix;
  return new World(new Terrain(cells, cells, 10, heights, new Uint8Array(cells * cells)), capacity);
}

describe('World', () => {
  it('병사가 목표 지점까지 걸어가고 발 높이가 지형을 따른다', () => {
    const world = slopedWorld(1);
    const i = world.units.add(0, 10, 1, 50, 0);
    world.units.targetX[i] = 30;
    for (let t = 0; t < 10 * 20; t++) world.step(TICK_DT); // 10초

    expect(world.units.x[i]).toBeCloseTo(30, 0);
    expect(world.units.z[i]).toBeCloseTo(50, 0);
    expect(world.units.y[i]).toBeCloseTo(world.terrain.heightAt(world.units.x[i], 50));
    expect(world.units.heading[i]).toBeCloseTo(Math.PI / 2); // +X 방향
    expect(world.tick).toBe(200);
  });

  it('정확히 같은 자리에 겹친 두 병사를 분리 반경만큼 떼어 놓는다', () => {
    const world = slopedWorld(2);
    world.units.add(0, 50, 5, 50, 0);
    world.units.add(0, 50, 5, 50, 0);
    for (let t = 0; t < 40; t++) world.step(TICK_DT);

    const { x, z } = world.units;
    expect(Math.hypot(x[0] - x[1], z[0] - z[1])).toBeGreaterThan(0.8);
  });
});
