/**
 * 균일 격자 공간 분할. 매 틱 전체를 다시 만든다(계수 정렬, O(N), 할당 없음).
 * 병사는 계속 움직이므로 증분 갱신보다 통째 재구성이 단순하고 충분히 빠르다.
 */
export class SpatialGrid {
  readonly cols: number;
  readonly rows: number;
  /** 칸 c 에 속한 병사는 items[cellStart[c] .. cellStart[c + 1]) */
  private readonly cellStart: Int32Array;
  private readonly cellOf: Int32Array;
  private readonly items: Int32Array;

  constructor(
    readonly width: number,
    readonly depth: number,
    readonly cellSize: number,
    capacity: number,
  ) {
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(depth / cellSize);
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
    this.cellOf = new Int32Array(capacity);
    this.items = new Int32Array(capacity);
  }

  build(xs: Float32Array, zs: Float32Array, count: number): void {
    const { cellStart, cellOf, items } = this;
    cellStart.fill(0);
    for (let i = 0; i < count; i++) {
      const c = this.cellIndex(xs[i], zs[i]);
      cellOf[i] = c;
      cellStart[c + 1]++;
    }
    for (let c = 1; c < cellStart.length; c++) cellStart[c] += cellStart[c - 1];
    // cellStart[c] 를 채우기 커서로 쓴 뒤 되돌린다.
    for (let i = 0; i < count; i++) items[cellStart[cellOf[i]]++] = i;
    for (let c = cellStart.length - 1; c > 0; c--) cellStart[c] = cellStart[c - 1];
    cellStart[0] = 0;
  }

  /**
   * (x, z) 에서 radius 안에 있는 병사 인덱스를 out 에 채우고 개수를 돌려준다.
   * out 이 가득 차면 거기서 멈춘다(호출자가 상한을 정한다).
   */
  query(
    xs: Float32Array,
    zs: Float32Array,
    x: number,
    z: number,
    radius: number,
    out: Int32Array,
  ): number {
    const r2 = radius * radius;
    const c0 = this.clampCol(Math.floor((x - radius) / this.cellSize));
    const c1 = this.clampCol(Math.floor((x + radius) / this.cellSize));
    const r0 = this.clampRow(Math.floor((z - radius) / this.cellSize));
    const r1 = this.clampRow(Math.floor((z + radius) / this.cellSize));
    let n = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = r * this.cols + c;
        const end = this.cellStart[cell + 1];
        for (let k = this.cellStart[cell]; k < end; k++) {
          const j = this.items[k];
          const dx = xs[j] - x;
          const dz = zs[j] - z;
          if (dx * dx + dz * dz <= r2) {
            if (n === out.length) return n;
            out[n++] = j;
          }
        }
      }
    }
    return n;
  }

  private cellIndex(x: number, z: number): number {
    return (
      this.clampRow(Math.floor(z / this.cellSize)) * this.cols +
      this.clampCol(Math.floor(x / this.cellSize))
    );
  }

  private clampCol(c: number): number {
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private clampRow(r: number): number {
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }
}
