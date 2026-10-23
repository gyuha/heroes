/**
 * 지형 종류 ID. 값은 지형 종류 맵(types.u8)의 값과 같다(docs/ARCHITECTURE.md 7.6, D-009).
 * 각 종류의 게임 효과는 GDD §6.1이 정한다(terrainRules.ts).
 */
export const TerrainType = {
  Grass: 0,
  Forest: 1,
  /** 절벽·바위. 통과 불가 */
  Rock: 2,
  /** 흙길 */
  Sand: 3,
  /** 깊은 물(강). 통과 불가 */
  Water: 4,
  /** 여울 */
  Ford: 5,
  /** 다리. 높이맵에서는 둑 높이로 평평하다 */
  Bridge: 6,
} as const;
export type TerrainTypeId = (typeof TerrainType)[keyof typeof TerrainType];

/** 종류와 관계없이 이보다 가파른 칸은 통과 불가(GDD §6.1, 30°). */
export const IMPASSABLE_SLOPE_RAD = (30 * Math.PI) / 180;

/** 통과 불가 종류인가. */
export function isBlockingType(type: number): boolean {
  return type === TerrainType.Rock || type === TerrainType.Water;
}

/**
 * 높이맵 지형. 월드 좌표 (x, z)는 [0, width] × [0, depth] 범위이고 y가 높이다.
 *
 * - heights: (cellsX + 1) × (cellsZ + 1) 개 격자점 높이(m). 인덱스 = iz * (cellsX + 1) + ix
 * - types: cellsX × cellsZ 개 칸의 지형 종류 ID. 인덱스 = iz * cellsX + ix
 *
 * 한 칸은 (1,0)-(0,1) 대각선으로 삼각형 두 개로 나뉜다. 렌더링 메시도 같은 분할을 써야
 * heightAt 결과가 화면의 지면과 정확히 일치한다(render/terrain/terrainSurface.ts).
 *
 * 병사 루프에서 매 틱 부르는 질의(heightAt, gradientAt, typeAt, passableAt)는 다른 함수를 부르지 않는
 * 평평한 함수로 둔다. V8이 호출한 곳에 인라인하지 못하면 숫자 반환값을 매번 힙 객체로 감싸기 때문이다(T-020).
 * 계산 순서는 바꾸지 않는다(결과가 비트 단위로 같아야 한다: terrainFastPath.test.ts).
 */
export class Terrain {
  readonly width: number;
  readonly depth: number;

  /** 칸별 통과 가능 여부(1 = 가능). 처음 조회할 때 만든다. */
  private passMask: Uint8Array | null = null;

  constructor(
    readonly cellsX: number,
    readonly cellsZ: number,
    readonly cellSize: number,
    readonly heights: Float32Array,
    readonly types: Uint8Array,
  ) {
    if (heights.length !== (cellsX + 1) * (cellsZ + 1)) {
      throw new Error(`heights 길이 ${heights.length} != ${(cellsX + 1) * (cellsZ + 1)}`);
    }
    if (types.length !== cellsX * cellsZ) {
      throw new Error(`types 길이 ${types.length} != ${cellsX * cellsZ}`);
    }
    this.width = cellsX * cellSize;
    this.depth = cellsZ * cellSize;
  }

  contains(x: number, z: number): boolean {
    return x >= 0 && x <= this.width && z >= 0 && z <= this.depth;
  }

  /** 격자점 높이. 범위 밖 인덱스는 가장자리로 고정한다. */
  vertexHeight(ix: number, iz: number): number {
    const cx = ix < 0 ? 0 : ix > this.cellsX ? this.cellsX : ix;
    const cz = iz < 0 ? 0 : iz > this.cellsZ ? this.cellsZ : iz;
    return this.heights[cz * (this.cellsX + 1) + cx];
  }

  /** (x, z) 지점의 지표면 높이(m). 범위 밖은 가장자리로 고정한다. */
  heightAt(x: number, z: number): number {
    const cellsX = this.cellsX;
    const cellsZ = this.cellsZ;
    // 정수 상수와 실수를 섞은 삼항식은 TurboFan이 값을 힙 객체로 감싸게 만들어 Math.min/max 로 자른다(T-022).
    const gx = Math.min(cellsX, Math.max(0, x / this.cellSize));
    const gz = Math.min(cellsZ, Math.max(0, z / this.cellSize));
    // 오른쪽·위 끝 경계에서도 마지막 칸 안으로 들어가게 한다.
    const ix = Math.min(Math.floor(gx), cellsX - 1);
    const iz = Math.min(Math.floor(gz), cellsZ - 1);
    const fx = gx - ix;
    const fz = gz - iz;
    const h = this.heights;
    const row = cellsX + 1;
    const i = iz * row + ix;
    if (fx + fz <= 1) {
      const h00 = h[i];
      return h00 + (h[i + 1] - h00) * fx + (h[i + row] - h00) * fz;
    }
    const h11 = h[i + row + 1];
    return h11 + (h[i + row] - h11) * (1 - fx) + (h[i + 1] - h11) * (1 - fz);
  }

  /**
   * (x, z) 지점 지표면의 기울기 벡터(높이 변화량/m). out[0] = dh/dx, out[1] = dh/dz.
   * 오르막 방향과 가파름을 함께 알려 준다.
   */
  gradientAt(x: number, z: number, out: Float32Array | number[]): void {
    const cellsX = this.cellsX;
    const cellsZ = this.cellsZ;
    // 정수 상수와 실수를 섞은 삼항식은 TurboFan이 값을 힙 객체로 감싸게 만들어 Math.min/max 로 자른다(T-022).
    const gx = Math.min(cellsX, Math.max(0, x / this.cellSize));
    const gz = Math.min(cellsZ, Math.max(0, z / this.cellSize));
    const ix = Math.min(Math.floor(gx), cellsX - 1);
    const iz = Math.min(Math.floor(gz), cellsZ - 1);
    const h = this.heights;
    const row = cellsX + 1;
    const i = iz * row + ix;
    const inv = 1 / this.cellSize;
    if (gx - ix + (gz - iz) <= 1) {
      const h00 = h[i];
      out[0] = (h[i + 1] - h00) * inv;
      out[1] = (h[i + row] - h00) * inv;
    } else {
      const h11 = h[i + row + 1];
      out[0] = (h11 - h[i + row]) * inv;
      out[1] = (h11 - h[i + 1]) * inv;
    }
  }

  /** (x, z) 지점의 경사각(라디안, 0 = 평지). */
  slopeAt(x: number, z: number): number {
    this.gradientAt(x, z, gradScratch);
    return Math.atan(Math.hypot(gradScratch[0], gradScratch[1]));
  }

  /** (x, z) 지점이 속한 칸의 지형 종류. 범위 밖은 가장자리 칸. */
  typeAt(x: number, z: number): TerrainTypeId {
    const cellsX = this.cellsX;
    let ix = Math.floor(x / this.cellSize);
    ix = ix < 0 ? 0 : ix > cellsX - 1 ? cellsX - 1 : ix;
    let iz = Math.floor(z / this.cellSize);
    iz = iz < 0 ? 0 : iz > this.cellsZ - 1 ? this.cellsZ - 1 : iz;
    return this.types[iz * cellsX + ix] as TerrainTypeId;
  }

  /**
   * 칸의 두 삼각형 중 더 가파른 쪽의 경사 tan 값(높이 변화/m).
   * 칸 분할은 heightAt 과 같다: (v00, v01, v10), (v10, v01, v11).
   */
  cellSlopeTan(ix: number, iz: number): number {
    const h00 = this.vertexHeight(ix, iz);
    const h10 = this.vertexHeight(ix + 1, iz);
    const h01 = this.vertexHeight(ix, iz + 1);
    const h11 = this.vertexHeight(ix + 1, iz + 1);
    const inv = 1 / this.cellSize;
    const a = Math.hypot(h10 - h00, h01 - h00) * inv;
    const b = Math.hypot(h11 - h01, h11 - h10) * inv;
    return a > b ? a : b;
  }

  /**
   * 칸 (ix, iz)를 지날 수 있는가: 종류가 통과 가능하고 경사가 30° 이하.
   * 맵 가장자리 경계(GDD §10.1)는 지형이 아니라 맵 규칙이라 여기서 보지 않는다(GameMap.inPlayArea).
   */
  cellPassable(ix: number, iz: number): boolean {
    if (ix < 0 || iz < 0 || ix >= this.cellsX || iz >= this.cellsZ) return false;
    return this.passMaskOrBuild()[iz * this.cellsX + ix] === 1;
  }

  /** (x, z)가 속한 칸을 지날 수 있는가. 맵 밖은 false. */
  passableAt(x: number, z: number): boolean {
    if (!(x >= 0 && x <= this.width && z >= 0 && z <= this.depth)) return false;
    let ix = Math.floor(x / this.cellSize);
    if (ix > this.cellsX - 1) ix = this.cellsX - 1;
    let iz = Math.floor(z / this.cellSize);
    if (iz > this.cellsZ - 1) iz = this.cellsZ - 1;
    const mask = this.passMask ?? this.passMaskOrBuild();
    return mask[iz * this.cellsX + ix] === 1;
  }

  private passMaskOrBuild(): Uint8Array {
    if (this.passMask) return this.passMask;
    const mask = new Uint8Array(this.cellsX * this.cellsZ);
    const maxTan = Math.tan(IMPASSABLE_SLOPE_RAD);
    for (let iz = 0; iz < this.cellsZ; iz++) {
      for (let ix = 0; ix < this.cellsX; ix++) {
        const i = iz * this.cellsX + ix;
        mask[i] = !isBlockingType(this.types[i]) && this.cellSlopeTan(ix, iz) <= maxTan ? 1 : 0;
      }
    }
    this.passMask = mask;
    return mask;
  }
}

// 조회 함수가 매 호출마다 객체를 만들지 않도록 재사용한다(단일 스레드 전제).
const gradScratch = new Float32Array(2);

/**
 * 병사 여러 명의 지면 높이를 한 번에 구한다: index[0..count) 의 병사 i마다 outY[i] = terrain.heightAt(xs[i], zs[i]).
 * 루프가 이 함수 안에 있어 실수가 함수 경계를 넘지 않는다(인라인되지 않은 호출의 실수 인자·반환값은 힙 객체가 된다, T-022).
 */
export function heightsInto(
  terrain: Terrain,
  xs: Float32Array,
  zs: Float32Array,
  index: Int32Array,
  count: number,
  outY: Float32Array,
): void {
  // heightAt 을 부르면 인라인되지 않아 인자·반환값이 힙 객체가 된다(측정). 같은 식을 펼쳐 쓴다(terrainFastPath.test.ts 가 같은 값인지 검사).
  const { cellSize, cellsX, cellsZ, heights } = terrain;
  const row = cellsX + 1;
  for (let k = 0; k < count; k++) {
    const i = index[k];
    const gx = Math.min(cellsX, Math.max(0, xs[i] / cellSize));
    const gz = Math.min(cellsZ, Math.max(0, zs[i] / cellSize));
    const ix = Math.min(Math.floor(gx), cellsX - 1);
    const iz = Math.min(Math.floor(gz), cellsZ - 1);
    const fx = gx - ix;
    const fz = gz - iz;
    const c = iz * row + ix;
    if (fx + fz <= 1) {
      const h00 = heights[c];
      outY[i] = h00 + (heights[c + 1] - h00) * fx + (heights[c + row] - h00) * fz;
    } else {
      const h11 = heights[c + row + 1];
      outY[i] = h11 + (heights[c + row] - h11) * (1 - fx) + (heights[c + 1] - h11) * (1 - fz);
    }
  }
}
