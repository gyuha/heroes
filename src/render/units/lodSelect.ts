/**
 * 병사 LOD 고르기(D-017 결정 2). 카메라에서 약 150m 밖의 부대는 LOD1(원거리 저폴리 모델)로 그린다.
 * 병사 단위가 아니라 부대 단위로 바꿔 한 부대가 섞인 모습이 되지 않게 하고, 들어가는 거리와 나오는 거리를
 * 다르게 둬(히스테리시스) 경계에서 깜빡이지 않게 한다.
 */
export const LOD = {
  /** 이보다 멀어지면 LOD1로(m) */
  farEnter: 160,
  /** 이보다 가까워지면 LOD0으로 돌아온다(m) */
  nearReturn: 140,
  /** 부대 중심의 시점 높이(지면 위 m) */
  eyeHeight: 1,
};

export interface LodSquad {
  readonly x: number;
  readonly z: number;
  readonly groundY: number;
}

/**
 * mask[s] = 1(LOD1) / 0(LOD0)을 카메라 위치에 맞춰 갱신한다. 지난 프레임 값을 입력으로 써서 히스테리시스를 둔다.
 * @returns 바뀐 부대 수
 */
export function updateLodMask(
  mask: Uint8Array,
  squads: readonly LodSquad[],
  camX: number,
  camY: number,
  camZ: number,
): number {
  const enter2 = LOD.farEnter * LOD.farEnter;
  const return2 = LOD.nearReturn * LOD.nearReturn;
  let changed = 0;
  for (let s = 0; s < squads.length; s++) {
    const sq = squads[s];
    const dx = sq.x - camX;
    const dy = sq.groundY + LOD.eyeHeight - camY;
    const dz = sq.z - camZ;
    const d2 = dx * dx + dy * dy + dz * dz;
    const prev = mask[s];
    const next = prev === 1 ? (d2 < return2 ? 0 : 1) : d2 > enter2 ? 1 : 0;
    if (next !== prev) {
      mask[s] = next;
      changed++;
    }
  }
  return changed;
}
