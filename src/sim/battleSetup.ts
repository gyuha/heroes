import type { TeamId } from './api';
import { AiController } from './ai/aiController';
import type { AttackPlanId } from './ai/aiPlans';
import type { GameMap } from './map/gameMap';
import type { Pathfinder } from './map/pathfinder';
import type { Scenario } from './scenario';
import { VisibilitySystem } from './visibility';
import { World } from './world';

export interface BattleSetup {
  map: GameMap;
  /** 맵마다 한 번 만들어 재사용한다(생성 비용이 크다). */
  pathfinder: Pathfinder;
  scenario: Scenario;
  seed: number;
  /** AI가 지휘할 진영 */
  aiTeams: readonly TeamId[];
  /** 공격 AI 계획을 고정한다(검증용). 없으면 시드로 무작위(GDD §8.3) */
  attackPlan?: AttackPlanId;
}

/**
 * 한 판의 World를 만든다: 맵 지형 + 시나리오 편성 + 경로 탐색 + 시야 + AI.
 * 브라우저 세션과 헤드리스 AI 대 AI 러너가 같은 함수를 써서 같은 시드면 같은 결과가 나온다.
 */
export function createBattle(setup: BattleSetup): World {
  const { map, scenario, seed } = setup;
  const squadCount = scenario.teams[0].length + scenario.teams[1].length;
  const world = new World({
    terrain: map.terrain,
    scenario,
    seed,
    map,
    pathfinder: setup.pathfinder,
    vision: new VisibilitySystem(map.terrain, squadCount),
  });
  for (const team of setup.aiTeams)
    world.controllers.push(new AiController(world, team, seed, setup.attackPlan));
  return world;
}
