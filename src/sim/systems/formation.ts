import type { Squad } from '../squad';
import type { World } from '../world';

const local = { lateral: 0, forward: 0 };

/**
 * slot의 월드 좌표를 out[0], out[1]에 쓴다. 정면 = (sin f, cos f), 오른쪽 = (cos f, −sin f).
 */
export function slotWorld(sq: Squad, slot: number, out: Float64Array | number[]): void {
  sq.slotLocal(slot, local);
  const s = Math.sin(sq.facing);
  const c = Math.cos(sq.facing);
  out[0] = sq.x + c * local.lateral + s * local.forward;
  out[1] = sq.z - s * local.lateral + c * local.forward;
}

const pos = new Float64Array(2);

/** 부대 병사를 대형 자리에 바로 세운다(생성·배치 단계). */
export function placeSquadSoldiers(world: World, sq: Squad): void {
  const { units, terrain } = world;
  sq.groundY = terrain.heightAt(sq.x, sq.z);
  for (let k = 0; k < sq.n; k++) {
    const i = sq.members[k];
    slotWorld(sq, k, pos);
    units.x[i] = units.prevX[i] = units.targetX[i] = pos[0];
    units.z[i] = units.prevZ[i] = units.targetZ[i] = pos[1];
    units.y[i] = units.prevY[i] = terrain.heightAt(pos[0], pos[1]);
    units.heading[i] = units.prevHeading[i] = sq.facing;
  }
}

/**
 * 뒤로 돌기: 정면을 반대로 바꾸면서 slot 순서를 뒤집는다. 병사들은 제자리에서 돌아서기만 하고
 * (뒤 행이 새 앞 행이 된다), 넓은 횡대가 180° 회전하며 끝 병사가 수십 m를 달리는 일이 없다.
 */
export function aboutFace(sq: Squad, newFacing: number): void {
  const m = sq.members;
  for (let a = 0, b = sq.n - 1; a < b; a++, b--) {
    const t = m[a];
    m[a] = m[b];
    m[b] = t;
  }
  sq.facing = newFacing;
}
