import { clamp, wrapAngle } from '../math';
import type { World } from '../world';

// 임시 이동 수치. GDD에서 병종별 이동 규칙이 나오면 병종 데이터로 옮긴다.
const MOVE_SPEED = 3; // m/s
const ARRIVE_RADIUS = 0.5; // m
const SEPARATION_RADIUS = 0.9; // m
const SEPARATION_SPEED = 2.5; // m/s, 완전히 겹쳤을 때 밀어내는 속도
const TURN_RATE = Math.PI * 2; // rad/s
const MAX_NEIGHBORS = 32;

const neighbors = new Int32Array(MAX_NEIGHBORS);

/**
 * 목표 지점으로 걷기 + 이웃과 겹치지 않게 밀어내기. 지형 높이에 발을 붙인다.
 * 게임 규칙(지형별 속도, 대형, 전투)은 아직 없다.
 */
export function moveUnits(world: World, dt: number): void {
  const { units, grid, terrain } = world;
  const { x, z, y, vx, vz, heading, targetX, targetZ } = units;
  const n = units.count;

  for (let i = 0; i < n; i++) {
    let dvx = 0;
    let dvz = 0;
    const tx = targetX[i] - x[i];
    const tz = targetZ[i] - z[i];
    const dist = Math.hypot(tx, tz);
    if (dist > ARRIVE_RADIUS) {
      const s = Math.min(MOVE_SPEED, dist / dt) / dist;
      dvx = tx * s;
      dvz = tz * s;
    }

    const count = grid.query(x, z, x[i], z[i], SEPARATION_RADIUS, neighbors);
    for (let k = 0; k < count; k++) {
      const j = neighbors[k];
      if (j === i) continue;
      const ox = x[i] - x[j];
      const oz = z[i] - z[j];
      const d = Math.hypot(ox, oz);
      const push =
        (SEPARATION_SPEED * (SEPARATION_RADIUS - Math.min(d, SEPARATION_RADIUS))) /
        SEPARATION_RADIUS;
      if (d < 1e-4) {
        // 같은 위치면 인덱스로 방향을 정해 결정적으로 떼어 놓는다.
        dvx += i < j ? push : -push;
      } else {
        dvx += (ox / d) * push;
        dvz += (oz / d) * push;
      }
    }
    vx[i] = dvx;
    vz[i] = dvz;
  }

  // 속도 계산과 위치 갱신을 나눠, 같은 틱 안에서 순회 순서가 결과에 영향을 주지 않게 한다.
  const maxTurn = TURN_RATE * dt;
  for (let i = 0; i < n; i++) {
    const nx = clamp(x[i] + vx[i] * dt, 0, terrain.width);
    const nz = clamp(z[i] + vz[i] * dt, 0, terrain.depth);
    x[i] = nx;
    z[i] = nz;
    y[i] = terrain.heightAt(nx, nz);
    if (vx[i] * vx[i] + vz[i] * vz[i] > 0.01) {
      const want = Math.atan2(vx[i], vz[i]);
      const diff = wrapAngle(want - heading[i]);
      heading[i] = wrapAngle(heading[i] + clamp(diff, -maxTurn, maxTurn));
    }
  }
}
