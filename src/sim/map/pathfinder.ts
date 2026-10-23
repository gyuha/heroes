/**
 * 부대 단위 경로 탐색(GDD §4.3, §6). 4m 탐색 격자 위 A* → 직선 펴기 → 통로 폭 측정.
 * 강·절벽·30° 초과·맵 경계는 지나지 않고, 비용은 구간 길이 ÷ 이동 계수(종류 × 진행 방향 경사)다.
 * 탐색용 배열은 생성 때 한 번 할당해 재사용한다(ARCHITECTURE §11.6-3).
 */
import { slopeSpeedFactor } from '../rules';
import { moveFactor, typeSpeedFactor } from '../terrainRules';
import type { GameMap } from './gameMap';

/** 탐색 격자 칸 크기(m). 지형 칸(2m) 2×2를 한 칸으로 묶는다. 다리(10m)는 4m 칸 2줄로 지나간다. */
export const NAV_CELL_SIZE = 4;
/**
 * A* 휴리스틱이 가정하는 이동 계수. 평지(1.0) 기준이라 흙길·완만한 내리막(최대 1.232)에서는 비용을 조금
 * 과대평가해 최적 경로보다 최대 약 20% 비싼 경로가 나올 수 있다. 대신 탐색 칸 수가 크게 준다.
 */
const HEURISTIC_MOVE_FACTOR = 1;
/** 직선 펴기에서 직선 구간 비용이 원래 경로보다 이만큼까지 비싸도 허용한다. */
const SMOOTH_COST_TOLERANCE = 1.02;
/** 직선 통과 검사 표본 간격(m). 지형 칸보다 촘촘해야 모서리를 놓치지 않는다. */
const WALK_SAMPLE_STEP = 1;
/** 비용 적분 표본 간격(m). */
const COST_SAMPLE_STEP = 2;
/** 통로 폭 측정: 경로 표본 간격, 한쪽 최대 측정 거리, 측정 걸음(m). */
const WIDTH_SAMPLE_STEP = 4;
const WIDTH_MAX_HALF = 60;
const WIDTH_RAY_STEP = 1;
const SQRT2 = Math.SQRT2;
const RAD_TO_DEG = 180 / Math.PI;
/** 팔방 이웃 (열, 행) 변화량 */
const DIR_DC = [1, 1, 0, -1, -1, -1, 0, 1];
const DIR_DR = [0, 1, 1, 1, 0, -1, -1, -1];
const DIRS = 8;

export interface PathOptions {
  /** 기병이면 true(숲·여울 계수가 다르다). */
  mounted: boolean;
  /** 맵 가장자리 경계를 지날 수 있는가. 패주 부대만 true. */
  allowBorder?: boolean;
}

export interface PathResult {
  /** false = 출발점에서 목적지 쪽으로 갈 수 있는 곳이 없다(points 는 비어 있다). */
  found: boolean;
  /** 목적지가 통과 불가이거나 닿을 수 없어 가장 가까운 도달 가능 지점으로 옮겼다. */
  snapped: boolean;
  /** 출발점 다음부터 도착점까지의 경유점. 직선으로 펴진 상태다. */
  points: { x: number; z: number }[];
  /** 경로 길이(m) */
  length: number;
  /** Σ 구간 길이 ÷ 이동 계수(m). 예상 시간(초) = effort ÷ 병종 기본 속도(m/s) */
  effort: number;
  /** 경로에서 가장 좁은 통로 폭(m, 최대 120). 부대 폭보다 작으면 자동 폭 조정 구간이 있다(GDD §4.3). */
  minWidth: number;
}

export class Pathfinder {
  readonly cols: number;
  readonly rows: number;
  private readonly map: GameMap;
  /** 탐색 칸 통과 가능(지형 칸 2×2 모두 통과 가능). */
  private readonly open: Uint8Array;
  /** 탐색 칸이 경계(boundaryMargin) 밖인가. */
  private readonly border: Uint8Array;
  /** 간선 비용 [((mounted ? n : 0) + node) * 8 + 방향] = 거리 ÷ 이동 계수(m). 갈 수 없으면 Infinity. */
  private readonly edgeCost: Float32Array;
  /** 연결 영역 번호(0 = 막힘). 경계 제외 / 경계 포함 두 벌. */
  private readonly regionInner: Int32Array;
  private readonly regionAll: Int32Array;

  // A* 작업 배열(재사용)
  private readonly g: Float32Array;
  private readonly parent: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closedStamp: Uint32Array;
  private generation = 0;
  private heapNode: Int32Array;
  private heapKey: Float32Array;
  private heapSize = 0;

  constructor(map: GameMap) {
    this.map = map;
    const t = map.terrain;
    this.cols = Math.floor(t.width / NAV_CELL_SIZE);
    this.rows = Math.floor(t.depth / NAV_CELL_SIZE);
    const n = this.cols * this.rows;
    this.open = new Uint8Array(n);
    this.border = new Uint8Array(n);
    const nodeHeight = new Float32Array(n);
    const nodeSpeed = new Float32Array(n * 2);
    const per = NAV_CELL_SIZE / t.cellSize;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        let ok = true;
        let foot = 0;
        let mounted = 0;
        for (let dz = 0; dz < per && ok; dz++) {
          for (let dx = 0; dx < per; dx++) {
            const ix = c * per + dx;
            const iz = r * per + dz;
            if (!t.cellPassable(ix, iz)) {
              ok = false;
              break;
            }
            const type = t.types[iz * t.cellsX + ix];
            foot += typeSpeedFactor(type, false);
            mounted += typeSpeedFactor(type, true);
          }
        }
        const x = (c + 0.5) * NAV_CELL_SIZE;
        const z = (r + 0.5) * NAV_CELL_SIZE;
        this.open[i] = ok ? 1 : 0;
        this.border[i] = map.inPlayArea(x, z) ? 0 : 1;
        nodeHeight[i] = t.heightAt(x, z);
        nodeSpeed[i * 2] = foot / (per * per);
        nodeSpeed[i * 2 + 1] = mounted / (per * per);
      }
    }
    this.edgeCost = this.buildEdgeCosts(nodeHeight, nodeSpeed);
    this.regionInner = this.labelRegions(false);
    this.regionAll = this.labelRegions(true);

    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closedStamp = new Uint32Array(n);
    this.heapNode = new Int32Array(n);
    this.heapKey = new Float32Array(n);
  }

  /** 두 지점이 같은 연결 영역인가(경계 제외). 한쪽이 통과 불가 칸이면 false. */
  isReachable(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
    const a = this.regionInner[this.nodeAt(fromX, fromZ)];
    return a !== 0 && a === this.regionInner[this.nodeAt(toX, toZ)];
  }

  /**
   * (x, z)에서 진행 방향 (dirX, dirZ)에 수직으로 잰 통로 폭(m, 최대 120).
   * 부대가 이동 중에 열 수를 줄이고 되돌릴 때 쓴다(GDD §4.3 자동 폭 조정).
   */
  corridorWidth(x: number, z: number, dirX: number, dirZ: number, allowBorder = false): number {
    const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (len === 0) return WIDTH_MAX_HALF * 2;
    const px = -dirZ / len;
    const pz = dirX / len;
    return this.rayFree(x, z, px, pz, allowBorder) + this.rayFree(x, z, -px, -pz, allowBorder);
  }

  findPath(fromX: number, fromZ: number, toX: number, toZ: number, opts: PathOptions): PathResult {
    const allowBorder = opts.allowBorder ?? false;
    const region = allowBorder ? this.regionAll : this.regionInner;
    const result: PathResult = {
      found: false,
      snapped: false,
      points: [],
      length: 0,
      effort: 0,
      minWidth: 0,
    };

    // 출발 칸이 막혀 있으면(밀려서 둑에 선 경우 등) 가장 가까운 열린 칸에서 출발한다.
    let start = this.nodeAt(fromX, fromZ);
    if (region[start] === 0) start = this.nearestNode(start, (i) => region[i] !== 0);
    if (start < 0) return result;
    const startRegion = region[start];

    let goal = this.nodeAt(toX, toZ);
    let goalX = toX;
    let goalZ = toZ;
    const goalPointOk =
      this.map.terrain.passableAt(toX, toZ) && (allowBorder || this.map.inPlayArea(toX, toZ));
    if (region[goal] !== startRegion || !goalPointOk) {
      goal = this.nearestNode(goal, (i) => region[i] === startRegion);
      if (goal < 0) return result;
      [goalX, goalZ] = this.center(goal);
      result.snapped = true;
    }

    if (!this.search(start, goal, opts.mounted, allowBorder)) return result;

    // 칸 경로 → 점 목록(출발점, 칸 중심들, 도착점)
    const nodes: number[] = [];
    for (let i = goal; i !== start; i = this.parent[i]) nodes.push(i);
    nodes.reverse();
    const raw: { x: number; z: number; g: number }[] = [{ x: fromX, z: fromZ, g: 0 }];
    for (let k = 0; k < nodes.length - 1; k++) {
      const [x, z] = this.center(nodes[k]);
      raw.push({ x, z, g: this.g[nodes[k]] });
    }
    raw.push({ x: goalX, z: goalZ, g: this.g[goal] });

    const pts = this.smooth(raw, opts.mounted, allowBorder);
    let length = 0;
    let effort = 0;
    let minWidth = WIDTH_MAX_HALF * 2;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1];
      const b = pts[k];
      const sx = b.x - a.x;
      const sz = b.z - a.z;
      length += Math.sqrt(sx * sx + sz * sz);
      effort += this.segmentEffort(a.x, a.z, b.x, b.z, opts.mounted);
      minWidth = Math.min(minWidth, this.segmentMinWidth(a.x, a.z, b.x, b.z, allowBorder));
    }
    result.found = true;
    result.points = pts.slice(1);
    result.length = length;
    result.effort = effort;
    result.minWidth = minWidth;
    return result;
  }

  // ------------------------------------------------------------------ A*

  private search(start: number, goal: number, mounted: boolean, allowBorder: boolean): boolean {
    const gen = ++this.generation;
    const { cols, rows, g, parent, stamp, closedStamp, edgeCost, border } = this;
    const costBase = mounted ? cols * rows * DIRS : 0;
    const gr = (goal / cols) | 0;
    const gc = goal - gr * cols;
    const hScale = NAV_CELL_SIZE / HEURISTIC_MOVE_FACTOR;
    this.heapSize = 0;
    g[start] = 0;
    parent[start] = start;
    stamp[start] = gen;
    this.push(start, octile(start, cols, gr, gc) * hScale);

    while (this.heapSize > 0) {
      const cur = this.pop();
      if (closedStamp[cur] === gen) continue;
      closedStamp[cur] = gen;
      if (cur === goal) return true;
      const cr = (cur / cols) | 0;
      const cc = cur - cr * cols;
      const gCur = g[cur];
      for (let d = 0; d < DIRS; d++) {
        const cost = edgeCost[costBase + cur * DIRS + d];
        if (cost === Infinity) continue;
        const nb = (cr + DIR_DR[d]) * cols + cc + DIR_DC[d];
        if (closedStamp[nb] === gen) continue;
        if (!allowBorder && border[nb] === 1) continue;
        // 대각선은 양옆 두 칸이 모두 열려 있어야 한다(모서리 자르기 금지). 열림은 간선 비용에 이미 반영됐다.
        if (!allowBorder && d % 2 === 1) {
          if (
            border[cr * cols + cc + DIR_DC[d]] === 1 ||
            border[(cr + DIR_DR[d]) * cols + cc] === 1
          )
            continue;
        }
        const ng = gCur + cost;
        if (stamp[nb] === gen && ng >= g[nb]) continue;
        stamp[nb] = gen;
        g[nb] = ng;
        parent[nb] = cur;
        this.push(nb, ng + octile(nb, cols, gr, gc) * hScale);
      }
    }
    return false;
  }

  /** 팔방 간선 비용 표(보병류, 기병). 진행 방향 경사는 두 칸 중심 높이 차로 구한다. */
  private buildEdgeCosts(nodeHeight: Float32Array, nodeSpeed: Float32Array): Float32Array {
    const { cols, rows, open } = this;
    const n = cols * rows;
    const cost = new Float32Array(n * DIRS * 2).fill(Infinity);
    for (let i = 0; i < n; i++) {
      if (open[i] === 0) continue;
      const r = (i / cols) | 0;
      const c = i - r * cols;
      for (let d = 0; d < DIRS; d++) {
        const nr = r + DIR_DR[d];
        const nc = c + DIR_DC[d];
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const nb = nr * cols + nc;
        if (open[nb] === 0) continue;
        if (d % 2 === 1 && (open[r * cols + nc] === 0 || open[nr * cols + c] === 0)) continue;
        const dist = (d % 2 === 1 ? SQRT2 : 1) * NAV_CELL_SIZE;
        const slope = slopeSpeedFactor(
          Math.atan((nodeHeight[nb] - nodeHeight[i]) / dist) * RAD_TO_DEG,
        );
        for (let m = 0; m < 2; m++) {
          const factor = 0.5 * (nodeSpeed[i * 2 + m] + nodeSpeed[nb * 2 + m]) * slope;
          if (factor > 0) cost[(m * n + i) * DIRS + d] = dist / factor;
        }
      }
    }
    return cost;
  }

  private walkable(i: number, allowBorder: boolean): boolean {
    return this.open[i] === 1 && (allowBorder || this.border[i] === 0);
  }

  private push(node: number, key: number): void {
    if (this.heapSize === this.heapNode.length) {
      const grownNode = new Int32Array(this.heapNode.length * 2);
      grownNode.set(this.heapNode);
      const grownKey = new Float32Array(this.heapKey.length * 2);
      grownKey.set(this.heapKey);
      this.heapNode = grownNode;
      this.heapKey = grownKey;
    }
    const nodes = this.heapNode;
    const keys = this.heapKey;
    let i = this.heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      nodes[i] = nodes[p];
      keys[i] = keys[p];
      i = p;
    }
    nodes[i] = node;
    keys[i] = key;
  }

  private pop(): number {
    const nodes = this.heapNode;
    const keys = this.heapKey;
    const top = nodes[0];
    const n = --this.heapSize;
    const lastNode = nodes[n];
    const lastKey = keys[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= lastKey) break;
      nodes[i] = nodes[c];
      keys[i] = keys[c];
      i = c;
    }
    nodes[i] = lastNode;
    keys[i] = lastKey;
    return top;
  }

  // ------------------------------------------------------------------ 직선 펴기·측정

  /**
   * 앞 점에서 갈 수 있는 가장 먼 점까지 직선으로 잇는다. 직선이 통과 불가 칸을 지나거나,
   * 직선 비용이 원래 경로 비용보다 비싸면(숲·여울을 가로지르는 지름길) 잇지 않는다.
   */
  private smooth(
    raw: { x: number; z: number; g: number }[],
    mounted: boolean,
    allowBorder: boolean,
  ): { x: number; z: number }[] {
    const out = [{ x: raw[0].x, z: raw[0].z }];
    let anchor = 0;
    while (anchor < raw.length - 1) {
      let best = anchor + 1;
      for (let j = anchor + 2; j < raw.length; j++) {
        const a = raw[anchor];
        const b = raw[j];
        if (!this.segmentWalkable(a.x, a.z, b.x, b.z, allowBorder)) break;
        const straight = this.segmentEffort(a.x, a.z, b.x, b.z, mounted);
        if (straight > (b.g - a.g) * SMOOTH_COST_TOLERANCE + COST_SAMPLE_STEP) continue;
        best = j;
      }
      out.push({ x: raw[best].x, z: raw[best].z });
      anchor = best;
    }
    return out;
  }

  private segmentWalkable(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    allowBorder: boolean,
  ): boolean {
    const t = this.map.terrain;
    const ddx = bx - ax;
    const ddz = bz - az;
    const dist = Math.sqrt(ddx * ddx + ddz * ddz);
    const n = Math.max(1, Math.ceil(dist / WALK_SAMPLE_STEP));
    for (let i = 1; i < n; i++) {
      const x = ax + ((bx - ax) * i) / n;
      const z = az + ((bz - az) * i) / n;
      if (!t.passableAt(x, z)) return false;
      if (!allowBorder && !this.map.inPlayArea(x, z)) return false;
    }
    return true;
  }

  /** 구간 길이 ÷ 이동 계수의 적분(m). 통과 불가 표본은 매우 비싸게 친다. */
  private segmentEffort(ax: number, az: number, bx: number, bz: number, mounted: boolean): number {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist === 0) return 0;
    const n = Math.max(1, Math.ceil(dist / COST_SAMPLE_STEP));
    const step = dist / n;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const f = moveFactor(this.map.terrain, ax + dx * t, az + dz * t, dx, dz, mounted);
      sum += step / Math.max(f, 0.01);
    }
    return sum;
  }

  private segmentMinWidth(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    allowBorder: boolean,
  ): number {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const n = Math.max(1, Math.ceil(dist / WIDTH_SAMPLE_STEP));
    let min = WIDTH_MAX_HALF * 2;
    for (let i = 0; i <= n; i++) {
      const w = this.corridorWidth(ax + (dx * i) / n, az + (dz * i) / n, dx, dz, allowBorder);
      if (w < min) min = w;
    }
    return min;
  }

  /** (x, z)에서 (dx, dz) 방향으로 막힐 때까지의 거리(m, 최대 WIDTH_MAX_HALF). */
  private rayFree(x: number, z: number, dx: number, dz: number, allowBorder: boolean): number {
    const t = this.map.terrain;
    for (let s = WIDTH_RAY_STEP; s <= WIDTH_MAX_HALF; s += WIDTH_RAY_STEP) {
      const px = x + dx * s;
      const pz = z + dz * s;
      if (!t.passableAt(px, pz) || (!allowBorder && !this.map.inPlayArea(px, pz))) {
        return s - WIDTH_RAY_STEP / 2;
      }
    }
    return WIDTH_MAX_HALF;
  }

  // ------------------------------------------------------------------ 격자 보조

  private nodeAt(x: number, z: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / NAV_CELL_SIZE)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(z / NAV_CELL_SIZE)));
    return r * this.cols + c;
  }

  private center(i: number): [number, number] {
    const r = (i / this.cols) | 0;
    const c = i - r * this.cols;
    return [(c + 0.5) * NAV_CELL_SIZE, (r + 0.5) * NAV_CELL_SIZE];
  }

  /** from 에서 가장 가까운(체비쇼프 고리 순, 고리 안에서는 유클리드) 조건을 만족하는 칸. 없으면 -1. */
  private nearestNode(from: number, accept: (i: number) => boolean): number {
    const fr = (from / this.cols) | 0;
    const fc = from - fr * this.cols;
    const maxRing = Math.max(this.cols, this.rows);
    for (let ring = 0; ring < maxRing; ring++) {
      let best = -1;
      let bestD = Infinity;
      for (let r = fr - ring; r <= fr + ring; r++) {
        if (r < 0 || r >= this.rows) continue;
        const edgeRow = r === fr - ring || r === fr + ring;
        for (let c = fc - ring; c <= fc + ring; c += edgeRow ? 1 : 2 * ring) {
          if (c < 0 || c >= this.cols) continue;
          const i = r * this.cols + c;
          if (!accept(i)) continue;
          const d = (r - fr) * (r - fr) + (c - fc) * (c - fc);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** 팔방 연결(모서리 자르기 금지)로 열린 칸에 영역 번호를 붙인다. */
  private labelRegions(allowBorder: boolean): Int32Array {
    const n = this.cols * this.rows;
    const label = new Int32Array(n);
    const queue = new Int32Array(n);
    let next = 0;
    for (let s = 0; s < n; s++) {
      if (label[s] !== 0 || !this.walkable(s, allowBorder)) continue;
      next++;
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      label[s] = next;
      while (head < tail) {
        const cur = queue[head++];
        const cr = (cur / this.cols) | 0;
        const cc = cur - cr * this.cols;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = cr + dr;
            const nc = cc + dc;
            if ((dr === 0 && dc === 0) || nr < 0 || nc < 0 || nr >= this.rows || nc >= this.cols)
              continue;
            const nb = nr * this.cols + nc;
            if (label[nb] !== 0 || !this.walkable(nb, allowBorder)) continue;
            if (
              dr !== 0 &&
              dc !== 0 &&
              (!this.walkable(cr * this.cols + nc, allowBorder) ||
                !this.walkable(nr * this.cols + cc, allowBorder))
            )
              continue;
            label[nb] = next;
            queue[tail++] = nb;
          }
        }
      }
    }
    return label;
  }
}

/** 팔방 이동 칸 수(대각선 √2). */
function octile(i: number, cols: number, gr: number, gc: number): number {
  const r = (i / cols) | 0;
  const dr = Math.abs(r - gr);
  const dc = Math.abs(i - r * cols - gc);
  return dr > dc ? dr + (SQRT2 - 1) * dc : dc + (SQRT2 - 1) * dr;
}
