/**
 * 테스트·헤드리스 실행용 도우미: 평지·경사 지형과 작은 시나리오를 만든다. 게임 실행 코드는 쓰지 않는다.
 */
import type { TeamId } from './api';
import type { Scenario, SquadSpec } from './scenario';
import { Terrain, TerrainType } from './terrain';

/** size m × size m, 칸 2m 평지(높이 heightAt = 10m). types로 칸별 종류를 바꿀 수 있다. */
export function flatTerrain(
  size = 512,
  height: (x: number, z: number) => number = () => 10,
  type: (x: number, z: number) => number = () => TerrainType.Grass,
): Terrain {
  const cell = 2;
  const cells = Math.round(size / cell);
  const heights = new Float32Array((cells + 1) * (cells + 1));
  for (let iz = 0; iz <= cells; iz++) {
    for (let ix = 0; ix <= cells; ix++)
      heights[iz * (cells + 1) + ix] = height(ix * cell, iz * cell);
  }
  const types = new Uint8Array(cells * cells);
  for (let iz = 0; iz < cells; iz++) {
    for (let ix = 0; ix < cells; ix++)
      types[iz * cells + ix] = type((ix + 0.5) * cell, (iz + 0.5) * cell);
  }
  return new Terrain(cells, cells, cell, heights, types);
}

/** 맵 전체를 배치 구역으로 둔 시나리오. 깃발은 맵 밖에 둬서 승패에 끼지 않게 한다. */
export function testScenario(
  south: SquadSpec[],
  north: SquadSpec[],
  opts: { size?: number; timeLimit?: number; breakRatio?: number } = {},
): Scenario {
  const size = opts.size ?? 512;
  const all = { minX: 0, minZ: 0, maxX: size, maxZ: size };
  return {
    id: 'test',
    name: 'test',
    defender: 0 as TeamId,
    attacker: 1 as TeamId,
    rules: {
      timeLimit: opts.timeLimit ?? 900,
      overtimeMax: 60,
      breakRatio: opts.breakRatio ?? 0.25,
      flag: { x: -1000, z: -1000, radius: 1 },
      captureTime: 60,
      captureRate: 1,
      decayRate: 2,
    },
    zones: [all, all],
    teams: [south, north],
  };
}

/**
 * 시뮬레이션을 수십 초 이상 돌리는 테스트의 시간 제한(ms). 기본 5초는 다른 작업이 많이 도는 기기에서
 * 넘을 수 있다(코드 오류가 아닌 부하로 실패하지 않게).
 */
export const SIM_TEST_TIMEOUT = 120_000;

/**
 * 느린 검사 묶음도 돌릴지: `pnpm test:slow`(= `vitest run --mode slow`) 또는 HEROES_SLOW_TESTS=1.
 * sim 타입 검사에는 Vite·Node 타입이 없어 필요한 값만 좁게 꺼낸다.
 */
export const SLOW_TESTS =
  (import.meta as { env?: { MODE?: string } }).env?.MODE === 'slow' ||
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.HEROES_SLOW_TESTS === '1';
