/**
 * 지형이 이동·시야·사격에 주는 효과(GDD §6). 순수 함수이고 할당하지 않는다.
 * 수치 원본은 data/balance.ts 의 TERRAIN(BALANCE §5)이고, 경사 곡선·고도차 사거리 공식은 rules.ts 를 쓴다.
 */
import { TERRAIN } from './data/balance';
import { slopeSpeedFactor } from './rules';
import { type Terrain, TerrainType } from './terrain';

const RAD_TO_DEG = 180 / Math.PI;

/** LOS 표본 간격(m). 칸 크기와 같다(GDD §5.5, ARCHITECTURE §11.6-2). */
export const LOS_SAMPLE_STEP = 2;
/** 숲 칸이 직사 LOS를 막는 장애물 높이(m). */
export const FOREST_LOS_HEIGHT = TERRAIN.forestLosHeight;
/**
 * 양 끝점에서 이 거리 안의 숲 칸은 LOS 장애물에서 뺀다. 숲 가장자리 안쪽의 부대가 밖을 보고 쏠 수 있게 하는 값으로,
 * 숲 은폐 거리(40m)와 같게 두었다. 게임 디자이너 확인 대기(docs/INTERFACES.md 요청 표).
 */
export const FOREST_LOS_CLEARANCE = TERRAIN.forestHideDist;
/** 사수 눈높이(지면 위 m). */
export const SHOOTER_EYE_HEIGHT = TERRAIN.eyeHeight;
/** 사격 판정에서 표적 높이(지면 위 m, GDD §5.5). */
export const FIRE_TARGET_HEIGHT = 1;
/** 곡사 판정 탄도 배율. 1 = 45° 탄도 근사(정점 높이 = 거리 / 4, GDD §5.5). */
const ARC_FACTOR = 1;

/** 지형 종류 ID(0~255) × [보병류, 기병] 이동 계수. 표에 없는 종류(통과 불가)는 0. */
const TYPE_SPEED = new Float32Array(256 * 2);
setTypeSpeed(TerrainType.Grass, TERRAIN.typeSpeed.grass);
setTypeSpeed(TerrainType.Forest, TERRAIN.typeSpeed.forest);
setTypeSpeed(TerrainType.Sand, TERRAIN.typeSpeed.sand);
setTypeSpeed(TerrainType.Ford, TERRAIN.typeSpeed.ford);
setTypeSpeed(TerrainType.Bridge, TERRAIN.typeSpeed.bridge);

function setTypeSpeed(type: number, factors: readonly number[]): void {
  TYPE_SPEED[type * 2] = factors[0];
  TYPE_SPEED[type * 2 + 1] = factors[1];
}

/** 지형 종류의 이동 계수(GDD §6.1). mounted = 기병. 강·절벽 등 통과 불가는 0. */
export function typeSpeedFactor(type: number, mounted: boolean): number {
  return TYPE_SPEED[(type & 0xff) * 2 + (mounted ? 1 : 0)];
}

/**
 * 진행 방향 경사각(도, 오르막 +): atan(∇h · 진행 방향 단위벡터) (GDD §6.2).
 * dir 은 정규화하지 않아도 된다. 길이가 0이면 0.
 */
export function directionalSlopeDeg(
  terrain: Terrain,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
): number {
  const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
  if (len === 0) return 0;
  terrain.gradientAt(x, z, gradient);
  return Math.atan((gradient[0] * dirX + gradient[1] * dirZ) / len) * RAD_TO_DEG;
}

/**
 * (x, z)에서 (dirX, dirZ) 방향으로 움직일 때의 이동 속도 계수 = 종류 × 진행 방향 경사(GDD §6.1, §6.2).
 * 그 칸이 통과 불가(강·절벽·30° 초과·맵 밖)면 0.
 */
export function moveFactor(
  terrain: Terrain,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  mounted: boolean,
): number {
  // 병사마다 매 틱 부르는 함수다. 본문은 반환값이 없는 moveFactorInto 에 두고 여기서는 읽기만 해서 작게 유지한다.
  // 인라인되지 않은 호출의 숫자 반환값은 V8이 힙 객체로 감싸기 때문이다(T-020).
  moveFactorInto(terrain, x, z, dirX, dirZ, mounted, factorScratch, 0);
  return factorScratch[0];
}

/** moveFactor 와 같은 값을 out[index] 에 쓴다. 반환값을 받지 않는 빠른 경로. */
export function moveFactorInto(
  terrain: Terrain,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  mounted: boolean,
  out: Float64Array,
  index: number,
): void {
  // typeSpeedFactor·directionalSlopeDeg 를 펼쳐 숫자를 돌려주는 하위 호출을 줄였다. 계산 순서는 두 함수와 같다.
  if (!terrain.passableAt(x, z)) {
    out[index] = 0;
    return;
  }
  const typeFactor = TYPE_SPEED[(terrain.typeAt(x, z) & 0xff) * 2 + (mounted ? 1 : 0)];
  const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
  if (len === 0) {
    out[index] = typeFactor * slopeSpeedFactor(0);
    return;
  }
  terrain.gradientAt(x, z, gradient);
  out[index] =
    typeFactor *
    slopeSpeedFactor(Math.atan((gradient[0] * dirX + gradient[1] * dirZ) / len) * RAD_TO_DEG);
}

/**
 * 병사 여러 명의 이동 계수를 한 번에 구한다: index[0..count) 의 병사 i마다 out[i] 에
 * moveFactor(terrain, xs[i], zs[i], dirX[i], dirZ[i], mounted) 와 같은 값을 쓴다(T-022).
 * 루프와 칸 계산이 모두 이 함수 안에 있어 실수가 함수 경계를 넘지 않는다.
 * moveFactor 와 같은 식(진행 방향 길이 Math.sqrt(x² + z²), D-017)이라 값이 정확히 같다.
 */
export function moveFactorsInto(
  terrain: Terrain,
  xs: Float32Array,
  zs: Float32Array,
  dirX: Float64Array,
  dirZ: Float64Array,
  mounted: boolean,
  index: Int32Array,
  count: number,
  out: Float64Array,
): void {
  const { cellSize, cellsX, cellsZ, width, depth, heights, types } = terrain;
  const row = cellsX + 1;
  const inv = 1 / cellSize;
  const speedOffset = mounted ? 1 : 0;
  for (let k = 0; k < count; k++) {
    const i = index[k];
    const x = xs[i];
    const z = zs[i];
    // passableAt 과 같다: 맵 밖이거나 통과 불가 칸이면 0
    if (!(x >= 0 && x <= width && z >= 0 && z <= depth)) {
      out[i] = 0;
      continue;
    }
    const gx = x / cellSize;
    const gz = z / cellSize;
    const ix = Math.min(Math.floor(gx), cellsX - 1);
    const iz = Math.min(Math.floor(gz), cellsZ - 1);
    if (!terrain.cellPassable(ix, iz)) {
      out[i] = 0;
      continue;
    }
    const typeFactor = TYPE_SPEED[(types[iz * cellsX + ix] & 0xff) * 2 + speedOffset];
    const dx = dirX[i];
    const dz = dirZ[i];
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len === 0) {
      out[i] = typeFactor * slopeSpeedFactor(0);
      continue;
    }
    // gradientAt 과 같다(결과를 Float32Array 에 담던 것과 같게 fround 로 자른다)
    const c = iz * row + ix;
    let g0: number;
    let g1: number;
    if (gx - ix + (gz - iz) <= 1) {
      const h00 = heights[c];
      g0 = Math.fround((heights[c + 1] - h00) * inv);
      g1 = Math.fround((heights[c + row] - h00) * inv);
    } else {
      const h11 = heights[c + row + 1];
      g0 = Math.fround((h11 - heights[c + row]) * inv);
      g1 = Math.fround((h11 - heights[c + 1]) * inv);
    }
    out[i] = typeFactor * slopeSpeedFactor(Math.atan((g0 * dx + g1 * dz) / len) * RAD_TO_DEG);
  }
}

/** (x, z)를 지날 수 있는가(종류·경사). 맵 가장자리 경계는 GameMap.inPlayArea 가 따로 본다. */
export function passable(terrain: Terrain, x: number, z: number): boolean {
  return terrain.passableAt(x, z);
}

/**
 * 직선 시야. 두 점의 y는 절대 높이(m)다. 2m 간격 표본에서 지형 높이, 또는 숲 칸이면 지형 + 12m가
 * 선보다 높으면 막힌다. 숲 장애물은 양 끝점에서 FOREST_LOS_CLEARANCE 안이면 무시한다.
 */
export function lineOfSight(
  terrain: Terrain,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  return rayClear(terrain, ax, ay, az, bx, by, bz, 0);
}

export type FireLine = 'direct' | 'arc' | 'blocked';

/**
 * 사수 (sx, sz)에서 표적 (tx, tz)로 쏠 수 있는 방식(GDD §5.5).
 * 사수 눈(지면 +1.7m) → 표적(지면 +1m) 직선이 열리면 직사, 막히면 45° 탄도로 다시 보고, 그것도 막히면 불가.
 */
export function fireLine(
  terrain: Terrain,
  sx: number,
  sz: number,
  tx: number,
  tz: number,
): FireLine {
  const sy = terrain.heightAt(sx, sz) + SHOOTER_EYE_HEIGHT;
  const ty = terrain.heightAt(tx, tz) + FIRE_TARGET_HEIGHT;
  if (rayClear(terrain, sx, sy, sz, tx, ty, tz, 0)) return 'direct';
  if (rayClear(terrain, sx, sy, sz, tx, ty, tz, ARC_FACTOR)) return 'arc';
  return 'blocked';
}

/** 직선(arc = 0) 또는 탄도(선 높이 += arc × 거리 × t × (1 − t))가 지형·숲에 막히지 않는가. */
function rayClear(
  terrain: Terrain,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  arc: number,
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const samples = Math.max(2, Math.ceil(dist / LOS_SAMPLE_STEP));
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const x = ax + dx * t;
    const z = az + dz * t;
    const lineY = ay + (by - ay) * t + arc * dist * t * (1 - t);
    const ground = terrain.heightAt(x, z);
    if (ground > lineY) return false;
    if (ground + FOREST_LOS_HEIGHT > lineY && terrain.typeAt(x, z) === TerrainType.Forest) {
      const along = dist * t;
      if (along > FOREST_LOS_CLEARANCE && dist - along > FOREST_LOS_CLEARANCE) return false;
    }
  }
  return true;
}

const gradient = new Float32Array(2);
const factorScratch = new Float64Array(1);
