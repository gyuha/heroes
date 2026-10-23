import { describe, expect, it } from 'vitest';
import { Terrain, TerrainType } from './terrain';
import {
  EXPOSE_TIME,
  LAST_SEEN_TIME,
  VISION_BUCKETS,
  type VisionSquad,
  VisibilitySystem,
} from './visibility';

/** 동서 800m × 남북 80m 평지(높이 10m), 칸 2m. */
function field(edit?: (t: Terrain) => void): Terrain {
  const cx = 400;
  const cz = 40;
  const t = new Terrain(
    cx,
    cz,
    2,
    new Float32Array((cx + 1) * (cz + 1)).fill(10),
    new Uint8Array(cx * cz),
  );
  edit?.(t);
  return t;
}

/** x0~x1 (m) 사이 모든 격자점을 height 로 올린다(남북으로 긴 벽). */
function wall(t: Terrain, x0: number, x1: number, height: number): void {
  for (let iz = 0; iz <= t.cellsZ; iz++)
    for (let ix = Math.ceil(x0 / 2); ix <= Math.floor(x1 / 2); ix++)
      t.heights[iz * (t.cellsX + 1) + ix] = height;
}

function forest(t: Terrain, x0: number, x1: number): void {
  for (let iz = 0; iz < t.cellsZ; iz++)
    for (let ix = Math.floor(x0 / 2); ix < Math.ceil(x1 / 2); ix++)
      t.types[iz * t.cellsX + ix] = TerrainType.Forest;
}

function squad(team: 0 | 1, x: number, z = 40, extra: Partial<VisionSquad> = {}): VisionSquad {
  return {
    team,
    alive: true,
    x,
    z,
    facing: team === 0 ? Math.PI / 2 : -Math.PI / 2,
    width: 40,
    depth: 8,
    mounted: false,
    ...extra,
  };
}

/** 모든 부대가 한 번씩 판정되도록 한 주기(10틱) 돌린다. */
function cycle(vis: VisibilitySystem, startTime: number, squads: VisionSquad[]): number {
  let time = startTime;
  for (let i = 0; i < VISION_BUCKETS; i++) {
    vis.update(time, squads);
    time += 0.05;
  }
  return time;
}

describe('VisibilitySystem (GDD §6.4)', () => {
  it('350m 안의 열린 평지는 보이고, 밖은 안 보인다. 자기 진영은 항상 보인다', () => {
    const squads = [squad(0, 20), squad(1, 360), squad(1, 390)];
    const vis = new VisibilitySystem(field(), 8);
    cycle(vis, 0, squads);
    expect(vis.isVisible(1, 0)).toBe(true); // 340m
    expect(vis.isVisible(2, 0)).toBe(false); // 370m
    expect(vis.isVisible(0, 0)).toBe(true);
    expect(vis.isVisible(1, 1)).toBe(true);
    expect(vis.isVisible(0, 1)).toBe(true); // 진영 1의 340m 부대가 본다
  });

  it('능선이 막으면 안 보이고, 정면 모서리가 능선 위로 나오면 보인다', () => {
    const t = field((t) => wall(t, 196, 204, 14));
    const vis = new VisibilitySystem(t, 4);
    cycle(vis, 0, [squad(0, 20), squad(1, 380)]);
    expect(vis.isVisible(1, 0)).toBe(false);
    // 같은 자리, 기병(표적 높이 2.4m) 은 벽 꼭대기보다 낮아 여전히 안 보인다
    cycle(vis, 1, [squad(0, 20), squad(1, 380, 40, { mounted: true })]);
    expect(vis.isVisible(1, 0)).toBe(false);
    // 높은 곳(지면 30m)의 관찰자는 넘겨 본다
    const hill = field((t) => {
      wall(t, 196, 204, 14);
      wall(t, 0, 30, 30);
    });
    const vis2 = new VisibilitySystem(hill, 4);
    cycle(vis2, 0, [squad(0, 10), squad(1, 300)]);
    expect(vis2.isVisible(1, 0)).toBe(true);
  });

  it('숲 은폐: 숲 안 부대는 40m 안의 적에게만 보이고, 사격·교전하면 10초 동안 드러난다', () => {
    const t = field((t) => forest(t, 300, 500));
    const vis = new VisibilitySystem(t, 4);
    const hiddenFar = [squad(0, 340), squad(1, 400)]; // 60m
    let time = cycle(vis, 0, hiddenFar);
    expect(vis.isConcealed(1)).toBe(true);
    expect(vis.isVisible(1, 0)).toBe(false);

    const hiddenNear = [squad(0, 365), squad(1, 400)]; // 35m
    time = cycle(vis, time, hiddenNear);
    expect(vis.isVisible(1, 0)).toBe(true);

    // 사격 → 10초 노출: 200m 밖 평지의 적에게도 보인다(숲 끝점 40m 예외로 LOS 열림)
    const exposed = [squad(0, 280), squad(1, 320)];
    vis.markExposed(1, time);
    time = cycle(vis, time, exposed);
    expect(vis.isConcealed(1)).toBe(false);
    expect(vis.isVisible(1, 0)).toBe(true);
    time = cycle(vis, time + EXPOSE_TIME, [squad(0, 200), squad(1, 320)]);
    expect(vis.isConcealed(1)).toBe(true);
    expect(vis.isVisible(1, 0)).toBe(false);
  });

  it('보이지 않게 된 적은 마지막 위치를 10초 동안 남긴다', () => {
    const t = field((t) => wall(t, 196, 204, 14));
    const vis = new VisibilitySystem(t, 4);
    let time = cycle(vis, 0, [squad(0, 20), squad(1, 150)]);
    expect(vis.isVisible(1, 0)).toBe(true);
    expect(vis.lastSeen(1, 0)).toBeNull(); // 보이는 동안은 없음
    time = cycle(vis, time, [squad(0, 20), squad(1, 300)]); // 벽 뒤로
    expect(vis.isVisible(1, 0)).toBe(false);
    const ghost = vis.lastSeen(1, 0);
    expect(ghost?.x).toBe(150);
    cycle(vis, time + LAST_SEEN_TIME, [squad(0, 20), squad(1, 300)]);
    expect(vis.lastSeen(1, 0)).toBeNull();
  });

  it('한 번의 update 는 부대 ID % 10 이 같은 부대만 판정한다(틱 분산)', () => {
    const squads = [squad(0, 20)];
    for (let i = 1; i < 12; i++) squads.push(squad(1, 100 + i));
    const vis = new VisibilitySystem(field(), 16);
    vis.update(0, squads); // 순번 0 → 부대 0, 10
    expect(vis.isVisible(10, 0)).toBe(true);
    expect(vis.isVisible(1, 0)).toBe(false);
    vis.update(0.05, squads); // 순번 1 → 부대 1, 11
    expect(vis.isVisible(1, 0)).toBe(true);
    expect(vis.isVisible(11, 0)).toBe(true);
    expect(vis.isVisible(2, 0)).toBe(false);
  });

  it('죽은 부대는 보이지 않고 잔상도 남지 않는다', () => {
    const vis = new VisibilitySystem(field(), 4);
    const time = cycle(vis, 0, [squad(0, 20), squad(1, 100)]);
    cycle(vis, time, [squad(0, 20), squad(1, 100, 40, { alive: false })]);
    expect(vis.isVisible(1, 0)).toBe(false);
    expect(vis.lastSeen(1, 0)).toBeNull();
  });
});
