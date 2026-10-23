import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../constants';
import { Rng } from '../rng';
import { flatTerrain, testScenario } from '../testing';
import { World } from '../world';

describe('병사 이동', () => {
  it('움직인 병사의 발 높이가 Terrain.heightAt과 같다(commitPositions → heightsInto)', () => {
    // 기복이 있는 지형에서 부대를 걷게 해, 움직인 병사 모두의 y가 heightAt과 비트 단위로 같은지 본다
    const rng = new Rng(5);
    const bumps = Array.from({ length: 8 }, () => [
      rng.range(0, 512),
      rng.range(0, 512),
      rng.range(2, 9),
    ]);
    const height = (x: number, z: number) =>
      10 +
      bumps.reduce(
        (h, [bx, bz, a]) => h + a * Math.exp(-((x - bx) ** 2 + (z - bz) ** 2) / 2000),
        0,
      );
    const w = new World({
      terrain: flatTerrain(512, height),
      scenario: testScenario(
        [{ type: 'infantry', x: 200, z: 200, facing: 0 }],
        [{ type: 'cavalry', x: 300, z: 400, facing: Math.PI }],
      ),
      seed: 1,
    });
    w.startBattle();
    w.enqueue({ kind: 'move', team: 0, squads: [0], x: 330, z: 260 });
    w.enqueue({ kind: 'move', team: 1, squads: [1], x: 150, z: 330 });
    for (let t = 0; t < 30 / TICK_DT; t++) w.step(TICK_DT);
    const u = w.units;
    let checked = 0;
    for (let i = 0; i < u.count; i++) {
      if (u.x[i] === u.prevX[i] && u.z[i] === u.prevZ[i]) continue;
      // 저장된(Float32) 위치로 잰 높이를 Float32로 저장하므로 같은 반올림을 거친 값과 정확히 같아야 한다
      expect(u.y[i]).toBe(Math.fround(w.terrain.heightAt(u.x[i], u.z[i])));
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });
});
