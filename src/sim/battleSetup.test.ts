import { describe, expect, it } from 'vitest';
import { createBattle } from './battleSetup';
import { TICK_DT } from './constants';
import { Pathfinder } from './map/pathfinder';
import { createReedFord } from './map/reedFord';
import { REED_FORD } from './scenarios/reedFord';
import { SIM_TEST_TIMEOUT, SLOW_TESTS } from './testing';
import type { World } from './world';

const map = createReedFord();
const pathfinder = new Pathfinder(map);

function battle(seed: number, aiTeams: (0 | 1)[] = []): World {
  const w = createBattle({ map, pathfinder, scenario: REED_FORD, seed, aiTeams });
  w.startBattle();
  return w;
}

describe('갈대 여울 조립', { timeout: SIM_TEST_TIMEOUT }, () => {
  it('편성이 GDD §10.3과 같다(방어 3,600 / 공격 5,960, 16 / 26개 부대)', () => {
    const w = battle(1);
    expect(w.teamStart).toEqual([3600, 5960]);
    expect(w.squads.filter((s) => s.team === 0)).toHaveLength(16);
    expect(w.squads.filter((s) => s.team === 1)).toHaveLength(26);
    // 기본 배치는 모두 자기 배치 구역 안의 통과 가능한 땅이다
    for (const s of w.squads) {
      const z = w.deploymentZone(s.team);
      expect(s.x >= z.minX && s.x <= z.maxX && s.z >= z.minZ && s.z <= z.maxZ).toBe(true);
      expect(map.terrain.passableAt(s.x, s.z)).toBe(true);
    }
  });

  it('다리를 건너면 열 수를 줄였다가(자동 폭 조정) 건넌 뒤 되돌린다', () => {
    const w = battle(1);
    const sq = w.squads.find((s) => s.team === 1 && s.stats.id === 'infantry')!;
    sq.x = 801;
    sq.z = 660;
    w.enqueue({ kind: 'move', team: 1, squads: [sq.id], x: 801, z: 530 });
    w.step(TICK_DT); // 명령은 다음 틱 시작에 적용된다
    let narrowed = 0;
    for (let t = 0; t < 200 / TICK_DT && sq.order.kind === 'move'; t++) {
      w.step(TICK_DT);
      w.drainEvents();
      if (sq.autoFiles > 0) narrowed = Math.max(narrowed, sq.files - sq.curFiles);
    }
    expect(sq.order.kind).toBe('none');
    expect(narrowed).toBeGreaterThan(20); // 다리 폭 10m → 40열이 한 자릿수 열로
    for (let t = 0; t < 2 / TICK_DT; t++) w.step(TICK_DT);
    expect(sq.curFiles).toBe(sq.files);
  });

  it('AI 대 AI: 같은 시드로 두 번 돌리면 같은 상태가 된다(60초)', () => {
    expect(aiVsAiSnapshot(3, 60)).toBe(aiVsAiSnapshot(3, 60));
  });
});

/**
 * 오래 걸리는 검사(첫 교전이 지나는 200초 AI 대 AI 결정론). 기본 `pnpm test`에서는 건너뛰고
 * HEROES_SLOW_TESTS=1 일 때만 돈다(기기 부하가 클 때 시간 초과로 흔들리지 않게, INTERFACES 요청 표).
 */
describe.runIf(SLOW_TESTS)('갈대 여울 조립(느린 검사)', { timeout: SIM_TEST_TIMEOUT * 5 }, () => {
  it('AI 대 AI: 교전이 시작된 뒤까지(200초) 같은 시드면 같은 상태', () => {
    expect(aiVsAiSnapshot(3, 200)).toBe(aiVsAiSnapshot(3, 200));
  });
});

function aiVsAiSnapshot(seed: number, seconds: number): string {
  const w = battle(seed, [0, 1]);
  for (let t = 0; t < seconds / TICK_DT; t++) w.step(TICK_DT);
  return w.squads
    .map((s) => `${s.n}/${s.state}/${s.x.toFixed(3)},${s.z.toFixed(3)}/${s.morale.toFixed(3)}`)
    .join(' ');
}
