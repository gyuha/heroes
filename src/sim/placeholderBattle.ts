import { Rng } from './rng';
import type { World } from './world';

const FORMATION_SPACING = 1.4; // m
const ARMY_OFFSET = 80; // 맵 중앙에서 각 군대 중심까지 거리(m)
const POSITION_JITTER = 0.3; // m

/**
 * 임시 전투 배치: 두 군대를 맵 중앙 양쪽에 사각 대형으로 세우고 서로를 향해 걷게 한다.
 * 렌더링·루프 검증용이며 GDD의 배치 규칙이 나오면 대체한다.
 */
export function spawnPlaceholderBattle(world: World, totalUnits: number, seed: number): void {
  const { terrain, units } = world;
  const rng = new Rng(seed);
  const cx = terrain.width / 2;
  const cz = terrain.depth / 2;
  const perSide = [Math.ceil(totalUnits / 2), Math.floor(totalUnits / 2)];

  for (let team = 0; team < 2; team++) {
    const n = perSide[team];
    const cols = Math.ceil(Math.sqrt(n * 2));
    const rows = Math.ceil(n / cols);
    const dir = team === 0 ? 1 : -1; // 0팀은 +Z, 1팀은 -Z 쪽으로 전진
    const baseZ = cz - dir * ARMY_OFFSET;
    const heading = team === 0 ? 0 : Math.PI;
    for (let k = 0; k < n; k++) {
      const col = k % cols;
      const row = Math.floor(k / cols);
      const x =
        cx + (col - (cols - 1) / 2) * FORMATION_SPACING + rng.range(-1, 1) * POSITION_JITTER;
      const z = baseZ - dir * (row - (rows - 1) / 2) * FORMATION_SPACING;
      const i = units.add(team, x, terrain.heightAt(x, z), z, heading);
      units.targetZ[i] = z + dir * ARMY_OFFSET * 1.2;
    }
  }
}
