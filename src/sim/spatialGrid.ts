/**
 * 균일 격자 공간 분할. 매 틱 전체를 다시 만든다(계수 정렬, O(N), 할당 없음).
 * 병사는 계속 움직이므로 증분 갱신보다 통째 재구성이 단순하고 충분히 빠르다.
 */
export class SpatialGrid {
  readonly cols: number;
  readonly rows: number;
  /** 칸 c 에 속한 병사는 items[cellStart[c] .. cellStart[c + 1]) */
  readonly cellStart: Int32Array;
  private readonly cellOf: Int32Array;
  readonly items: Int32Array;

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

  /** include 가 있으면 include[i] = 1 인 병사만 넣는다(죽은 병사 제외). */
  build(xs: Float32Array, zs: Float32Array, count: number, include?: Uint8Array): void {
    const { cellStart, cellOf, items } = this;
    cellStart.fill(0);
    for (let i = 0; i < count; i++) {
      if (include && !include[i]) {
        cellOf[i] = -1;
        continue;
      }
      const c = this.cellIndex(xs[i], zs[i]);
      cellOf[i] = c;
      cellStart[c + 1]++;
    }
    for (let c = 1; c < cellStart.length; c++) cellStart[c] += cellStart[c - 1];
    // cellStart[c] 를 채우기 커서로 쓴 뒤 되돌린다.
    for (let i = 0; i < count; i++) if (cellOf[i] >= 0) items[cellStart[cellOf[i]]++] = i;
    for (let c = cellStart.length - 1; c > 0; c--) cellStart[c] = cellStart[c - 1];
    cellStart[0] = 0;
  }

  /**
   * 질의 중심과 반지름. queryPrepared 가 인자 대신 이 필드를 읽는다. 병사 루프처럼 매 틱 수천 번 부르는 곳에서
   * 실수 인자를 넘기면 V8이 호출마다 힙 객체로 감싸 가비지가 생기므로(ARCHITECTURE §11.6-11), 필드에 써서 넘긴다.
   */
  qx = 0;
  qz = 0;
  qr = 0;

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
    this.qx = x;
    this.qz = z;
    this.qr = radius;
    return this.queryPrepared(xs, zs, out);
  }

  /** query 와 같고, 중심·반지름을 qx·qz·qr 필드에서 읽는다. */
  queryPrepared(xs: Float32Array, zs: Float32Array, out: Int32Array): number {
    return gridQueryPrepared(this, xs, zs, out);
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

/**
 * SpatialGrid.queryPrepared 의 본문. 메서드가 아닌 함수로 둬 병사 루프가 프로토타입 체인에 기대지 않게 한다
 * (체인이 바뀌면 그 체인에 기댄 최적화 코드가 버려진다).
 */
export function gridQueryPrepared(
  g: SpatialGrid,
  xs: Float32Array,
  zs: Float32Array,
  out: Int32Array,
): number {
  const x = g.qx;
  const z = g.qz;
  const radius = g.qr;
  const r2 = radius * radius;
  const cellSize = g.cellSize;
  const cols = g.cols;
  const rows = g.rows;
  let c0 = Math.floor((x - radius) / cellSize);
  let c1 = Math.floor((x + radius) / cellSize);
  let r0 = Math.floor((z - radius) / cellSize);
  let r1 = Math.floor((z + radius) / cellSize);
  c0 = c0 < 0 ? 0 : c0 >= cols ? cols - 1 : c0;
  c1 = c1 < 0 ? 0 : c1 >= cols ? cols - 1 : c1;
  r0 = r0 < 0 ? 0 : r0 >= rows ? rows - 1 : r0;
  r1 = r1 < 0 ? 0 : r1 >= rows ? rows - 1 : r1;
  const cellStart = g.cellStart;
  const items = g.items;
  let n = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = r * cols + c;
      const end = cellStart[cell + 1];
      for (let k = cellStart[cell]; k < end; k++) {
        const j = items[k];
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
