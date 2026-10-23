import { SpatialGrid } from './spatialGrid';
import type { Terrain } from './terrain';
import { UnitStore } from './units';
import { moveUnits } from './systems/movement';

/** 격자 칸 크기(m). 가장 자주 쓰는 근접 탐색 반경(병사 간 간격)의 두 배 정도로 둔다. */
const GRID_CELL_SIZE = 2;

/**
 * 시뮬레이션 전체 상태와 틱 진행. three.js·DOM에 의존하지 않는다.
 * 시스템 실행 순서는 step() 한 곳에서만 정한다.
 */
export class World {
  tick = 0;
  readonly units: UnitStore;
  readonly grid: SpatialGrid;

  constructor(
    readonly terrain: Terrain,
    unitCapacity: number,
  ) {
    this.units = new UnitStore(unitCapacity);
    this.grid = new SpatialGrid(terrain.width, terrain.depth, GRID_CELL_SIZE, unitCapacity);
  }

  /** 고정 시간 dt(초) 만큼 진행한다. */
  step(dt: number): void {
    this.units.savePrevious();
    this.grid.build(this.units.x, this.units.z, this.units.count);
    moveUnits(this, dt);
    this.tick++;
  }
}
