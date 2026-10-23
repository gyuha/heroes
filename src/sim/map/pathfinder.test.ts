import { beforeAll, describe, expect, it } from 'vitest';
import { TerrainType } from '../terrain';
import type { GameMap } from './gameMap';
import { Pathfinder, type PathResult } from './pathfinder';
import { createReedFord } from './reedFord';

let map: GameMap;
let pf: Pathfinder;
beforeAll(() => {
  map = createReedFord();
  pf = new Pathfinder(map);
});

/** 경로를 1m 간격으로 훑어 지난 지형 종류와 통과 불가 여부를 모은다. */
function walk(fromX: number, fromZ: number, path: PathResult) {
  const types = new Set<number>();
  let blocked = 0;
  let outside = 0;
  const crossings: number[] = []; // 강 중심(z ≈ 600) 부근을 지난 x
  let px = fromX;
  let pz = fromZ;
  for (const p of path.points) {
    const n = Math.max(1, Math.ceil(Math.hypot(p.x - px, p.z - pz)));
    for (let i = 1; i <= n; i++) {
      const x = px + ((p.x - px) * i) / n;
      const z = pz + ((p.z - pz) * i) / n;
      const type = map.terrain.typeAt(x, z);
      types.add(type);
      if (!map.terrain.passableAt(x, z)) blocked++;
      if (!map.inPlayArea(x, z)) outside++;
      if (type === TerrainType.Bridge || type === TerrainType.Ford) crossings.push(x);
    }
    px = p.x;
    pz = p.z;
  }
  return { types, blocked, outside, crossings };
}

describe('Pathfinder (갈대 여울)', () => {
  it('강 건너편으로 가는 경로는 강·절벽을 지나지 않고 다리나 여울로 건넌다', () => {
    const cases: [number, number, number, number][] = [
      [380, 800, 380, 480], // 북쪽 → 능선 앞: 동쪽 다리(x 241) 또는 여울
      [150, 700, 300, 300], // 동북 → 동남(D-012): 동쪽 벼랑을 돌아야 한다
      [900, 850, 600, 250], // 서북 → 남쪽 깊숙이
      [520, 300, 520, 900], // 남 → 북: 여울 정면
    ];
    for (const [fx, fz, tx, tz] of cases) {
      const path = pf.findPath(fx, fz, tx, tz, { mounted: false });
      expect(path.found, `${fx},${fz}→${tx},${tz}`).toBe(true);
      expect(path.snapped).toBe(false);
      const w = walk(fx, fz, path);
      expect(w.blocked, '통과 불가 칸을 지남').toBe(0);
      expect(w.outside, '맵 경계를 지남').toBe(0);
      expect(w.types.has(TerrainType.Water)).toBe(false);
      expect(w.types.has(TerrainType.Rock)).toBe(false);
      expect(w.crossings.length, '다리·여울을 지나지 않음').toBeGreaterThan(0);
      const last = path.points[path.points.length - 1];
      expect(Math.hypot(last.x - tx, last.z - tz)).toBeLessThan(0.01);
    }
  });

  it('다리는 폭 10m 병목으로 측정된다', () => {
    const path = pf.findPath(241, 680, 241, 520, { mounted: false });
    expect(path.found).toBe(true);
    const w = walk(241, 680, path);
    expect(w.types.has(TerrainType.Bridge)).toBe(true);
    expect(path.minWidth).toBeGreaterThanOrEqual(8);
    expect(path.minWidth).toBeLessThanOrEqual(12);
    expect(pf.corridorWidth(241, 597, 0, 1)).toBeCloseTo(10, 0);
    // 평지는 넓다
    expect(pf.corridorWidth(500, 250, 0, 1)).toBeGreaterThan(100);
  });

  it('목적지가 강·절벽이면 가장 가까운 도달 가능 지점으로 옮기고 snapped 를 알린다', () => {
    const intoRiver = pf.findPath(380, 800, 380, 593, { mounted: false });
    expect(intoRiver.found).toBe(true);
    expect(intoRiver.snapped).toBe(true);
    const end = intoRiver.points[intoRiver.points.length - 1];
    expect(map.terrain.passableAt(end.x, end.z)).toBe(true);
    expect(Math.hypot(end.x - 380, end.z - 593)).toBeLessThan(30);

    const ontoCliff = pf.findPath(300, 300, 100, 470, { mounted: false });
    expect(ontoCliff.snapped).toBe(true);
    expect(pf.isReachable(300, 300, 100, 470)).toBe(false);
    expect(pf.isReachable(380, 800, 380, 480)).toBe(true);
  });

  it('맵 경계(40m)는 패주 부대(allowBorder)만 지난다', () => {
    const normal = pf.findPath(500, 300, 500, 15, { mounted: false });
    expect(normal.snapped).toBe(true);
    const routing = pf.findPath(500, 300, 500, 15, { mounted: false, allowBorder: true });
    expect(routing.snapped).toBe(false);
    expect(routing.points[routing.points.length - 1].z).toBeCloseTo(15);
  });

  it('기병은 숲(0.4)을 피해 돌아가고, 비용은 숲을 가로지르는 직선보다 싸다', () => {
    const mounted = pf.findPath(640, 425, 920, 425, { mounted: true });
    const foot = pf.findPath(640, 425, 920, 425, { mounted: false });
    expect(mounted.found && foot.found).toBe(true);
    // 숲을 가로지르는 직선 280m 의 기병 비용은 280 / 0.4 = 700 정도다
    expect(mounted.effort).toBeLessThan(600);
    expect(mounted.length).toBeGreaterThan(290);
    expect(foot.effort).toBeLessThanOrEqual(280 / 0.6 + 10);
  });
});
