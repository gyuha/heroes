import { clamp } from './math';

/**
 * 지형 종류 ID. 값은 지형 종류 맵(8bit PNG)의 픽셀 값과 같다(docs/ARCHITECTURE.md 7.6).
 * 각 종류의 게임 효과는 GDD가 정한다.
 */
export const TerrainType = {
  Grass: 0,
  Forest: 1,
  Rock: 2,
  Sand: 3,
  Water: 4,
} as const;
export type TerrainTypeId = (typeof TerrainType)[keyof typeof TerrainType];

/**
 * 높이맵 지형. 월드 좌표 (x, z)는 [0, width] × [0, depth] 범위이고 y가 높이다.
 *
 * - heights: (cellsX + 1) × (cellsZ + 1) 개 격자점 높이(m). 인덱스 = iz * (cellsX + 1) + ix
 * - types: cellsX × cellsZ 개 칸의 지형 종류 ID. 인덱스 = iz * cellsX + ix
 *
 * 한 칸은 (1,0)-(0,1) 대각선으로 삼각형 두 개로 나뉜다. 렌더링 메시도 같은 분할을 써야
 * heightAt 결과가 화면의 지면과 정확히 일치한다(render/terrainMesh.ts).
 */
export class Terrain {
  readonly width: number;
  readonly depth: number;

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
    this.locate(x, z);
    const { h00, h10, h01, h11, fx, fz } = scratch;
    if (fx + fz <= 1) {
      return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    }
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /**
   * (x, z) 지점 지표면의 기울기 벡터(높이 변화량/m). out[0] = dh/dx, out[1] = dh/dz.
   * 오르막 방향과 가파름을 함께 알려 준다.
   */
  gradientAt(x: number, z: number, out: Float32Array | number[]): void {
    this.locate(x, z);
    const { h00, h10, h01, h11, fx, fz } = scratch;
    const inv = 1 / this.cellSize;
    if (fx + fz <= 1) {
      out[0] = (h10 - h00) * inv;
      out[1] = (h01 - h00) * inv;
    } else {
      out[0] = (h11 - h01) * inv;
      out[1] = (h11 - h10) * inv;
    }
  }

  /** (x, z) 지점의 경사각(라디안, 0 = 평지). */
  slopeAt(x: number, z: number): number {
    this.gradientAt(x, z, gradScratch);
    return Math.atan(Math.hypot(gradScratch[0], gradScratch[1]));
  }

  /** (x, z) 지점이 속한 칸의 지형 종류. 범위 밖은 가장자리 칸. */
  typeAt(x: number, z: number): TerrainTypeId {
    const ix = clamp(Math.floor(x / this.cellSize), 0, this.cellsX - 1);
    const iz = clamp(Math.floor(z / this.cellSize), 0, this.cellsZ - 1);
    return this.types[iz * this.cellsX + ix] as TerrainTypeId;
  }

  private locate(x: number, z: number): void {
    const gx = clamp(x / this.cellSize, 0, this.cellsX);
    const gz = clamp(z / this.cellSize, 0, this.cellsZ);
    // 오른쪽·아래 끝 경계에서도 마지막 칸 안으로 들어가게 한다.
    const ix = Math.min(Math.floor(gx), this.cellsX - 1);
    const iz = Math.min(Math.floor(gz), this.cellsZ - 1);
    scratch.fx = gx - ix;
    scratch.fz = gz - iz;
    scratch.h00 = this.vertexHeight(ix, iz);
    scratch.h10 = this.vertexHeight(ix + 1, iz);
    scratch.h01 = this.vertexHeight(ix, iz + 1);
    scratch.h11 = this.vertexHeight(ix + 1, iz + 1);
  }
}

// 조회 함수가 매 호출마다 객체를 만들지 않도록 재사용한다(단일 스레드 전제).
const scratch = { h00: 0, h10: 0, h01: 0, h11: 0, fx: 0, fz: 0 };
const gradScratch = new Float32Array(2);
