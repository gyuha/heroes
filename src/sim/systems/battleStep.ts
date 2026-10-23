/**
 * 전투 한 틱의 시스템 실행 순서. 순서를 바꾸면 결과가 바뀌므로 여기 한 곳에서만 정한다.
 *
 * 직전 상태 저장 → 격자 → 접촉·돌격 충격 → 근접 → 원거리 → 사기·패주 → 부대 이동 → 병사 이동 → 시야 → 승패
 */
import type { VisionSquad } from '../visibility';
import type { World } from '../world';
import { updateRules } from './battleRules';
import { updateContacts } from './contacts';
import { updateMelee } from './melee';
import { updateMorale } from './morale';
import { updateRanged } from './ranged';
import { updateSoldiers } from './soldierMovement';
import { updateSquads } from './squadMovement';

const visionSquads = new WeakMap<World, VisionSquad[]>();

export function stepBattle(world: World, dt: number): void {
  const u = world.units;
  const probe = world.probe;
  u.savePrevious();
  world.grid.build(u.x, u.z, u.count, u.alive);
  probe?.(0);
  updateContacts(world);
  probe?.(1);
  updateMelee(world, dt);
  probe?.(2);
  updateRanged(world, dt);
  probe?.(3);
  updateMorale(world, dt);
  probe?.(4);
  updateSquads(world, dt);
  probe?.(5);
  updateSoldiers(world, dt);
  probe?.(6);
  updateVision(world);
  probe?.(7);
  updateRules(world, dt);
  probe?.(8);
}

/** World.probe 단계 번호의 이름(성능 측정용). */
export const STEP_PHASES = [
  'grid',
  'contacts',
  'melee',
  'ranged',
  'morale',
  'squads',
  'soldiers',
  'vision',
  'rules',
] as const;

/** A의 VisibilitySystem에 부대 정보를 넘긴다. 시스템이 부대를 10틱에 나눠 판정한다(§1.6). */
function updateVision(world: World): void {
  const vision = world.vision;
  if (!vision) return;
  let list = visionSquads.get(world);
  if (!list) {
    list = world.squads.map((sq) => ({
      team: sq.team,
      alive: true,
      x: 0,
      z: 0,
      facing: 0,
      width: 0,
      depth: 0,
      mounted: sq.mounted,
    }));
    visionSquads.set(world, list);
  }
  for (let k = 0; k < world.squads.length; k++) {
    const sq = world.squads[k];
    const v = list[k];
    v.alive = sq.alive;
    v.x = sq.x;
    v.z = sq.z;
    v.facing = sq.facing;
    v.width = sq.width;
    v.depth = sq.depth;
  }
  vision.update(world.time, list);
}
