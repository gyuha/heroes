import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import type { Terrain } from '../../sim/terrain';

export type HeightFn = (x: number, z: number) => number;

/** 이보다 긴 선분은 나눠서 지형을 따라가게 한다(m). */
const DRAPE_STEP = 3;
const parse = new Color();
/** 색 문자열 → 선형 RGB. 매 프레임 같은 몇 가지 색만 쓰므로 한 번만 해석한다. */
const colorCache = new Map<string, Float32Array>();
function rgbOf(color: string): Float32Array {
  let c = colorCache.get(color);
  if (!c) {
    parse.set(color);
    c = new Float32Array([parse.r, parse.g, parse.b]);
    colorCache.set(color, c);
  }
  return c;
}
/** rectCorners·circle 결과를 담는 재사용 버퍼(단일 스레드 전제). */
const corners = new Float32Array(8);
const lineBuf = new Float64Array(4);
let ring = new Float32Array(128);

/**
 * 지면에 붙여 그리는 굵은 선·삼각형 묶음. 매 프레임 begin() → add*() → end()로 다시 채운다.
 * WebGL 선은 굵기가 1px로 고정이라 화면 해상도와 상관없이 보이도록 얇은 띠(삼각형)로 그린다.
 *
 * 성능 규칙(아키텍트 2차 리뷰, D-016):
 * - 버퍼는 최대 용량으로 한 번만 할당한다.
 * - GPU에는 직전 프레임과 달라진 프레임에만, 쓴 정점 범위만 올린다.
 * - 정점마다 함수를 부르지 않는다. V8은 인라인되지 않은 호출의 실수 인자·반환값을 힙 객체로 감싸므로
 *   정점 쓰기는 각 메서드 안에 펼치고, 높이는 end()에서 지형 격자를 직접 보간한다(heightAt과 같은 식,
 *   drapedLines.test.ts가 일치를 검사한다).
 */
export class DrapedLines {
  readonly mesh: Mesh;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  /** 직전에 GPU로 올린 내용(변경 감지용) */
  private readonly sentPositions: Float32Array;
  private readonly sentColors: Float32Array;
  private readonly geometry = new BufferGeometry();
  private vertices = 0;
  private sentVertices = 0;
  private sentLift = Number.NaN;
  private r = 1;
  private g = 1;
  private b = 1;
  private overflowWarned = false;
  /** 지면 위로 띄우는 높이(m). 카메라 거리에 맞춰 호출하는 쪽이 바꾼다. */
  lift = 0.6;
  /** 마지막 end()에서 GPU로 올린 바이트(측정용) */
  lastUploadBytes = 0;

  constructor(
    private readonly terrain: Terrain,
    private readonly maxVertices = 60000,
  ) {
    this.positions = new Float32Array(maxVertices * 3);
    this.colors = new Float32Array(maxVertices * 4);
    this.sentPositions = new Float32Array(maxVertices * 3);
    this.sentColors = new Float32Array(maxVertices * 4);
    const pos = new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage);
    const col = new BufferAttribute(this.colors, 4).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', pos);
    this.geometry.setAttribute('color', col);
    this.geometry.setDrawRange(0, 0);
    const material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8,
    });
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  begin(): void {
    this.vertices = 0;
  }

  /** 높이를 채우고, 직전 프레임과 같으면 아무것도 올리지 않는다. 바뀌었으면 쓴 정점 범위만 올린다. */
  end(): void {
    const n = this.vertices;
    this.fillHeights(n);
    this.lastUploadBytes = 0;
    if (n === this.sentVertices && this.sameAsSent(n)) return;
    this.sentVertices = n;
    this.sentLift = this.lift;
    this.sentPositions.set(this.positions.subarray(0, n * 3));
    this.sentColors.set(this.colors.subarray(0, n * 4));
    this.geometry.setDrawRange(0, n);
    if (n === 0) return;
    const pos = this.geometry.attributes.position as BufferAttribute;
    const col = this.geometry.attributes.color as BufferAttribute;
    pos.clearUpdateRanges();
    pos.addUpdateRange(0, n * 3);
    pos.needsUpdate = true;
    col.clearUpdateRanges();
    col.addUpdateRange(0, n * 4);
    col.needsUpdate = true;
    this.lastUploadBytes = n * 7 * 4;
  }

  /** 지면 위 삼각형 하나. */
  triangle(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
    color: string,
    alpha: number,
  ): void {
    if (!this.reserve(3)) return;
    this.setColor(color);
    const p = this.positions;
    const c = this.colors;
    const v = this.vertices;
    this.vertices += 3;
    const o = v * 3;
    p[o] = ax;
    p[o + 2] = az;
    p[o + 3] = bx;
    p[o + 5] = bz;
    p[o + 6] = cx;
    p[o + 8] = cz;
    const q = v * 4;
    for (let k = 0; k < 12; k += 4) {
      c[q + k] = this.r;
      c[q + k + 1] = this.g;
      c[q + k + 2] = this.b;
      c[q + k + 3] = alpha;
    }
  }

  /** 꺾은선(points = x, z 쌍)을 폭 width(m)의 띠로. dash > 0 이면 dash m 그리고 같은 길이만큼 띄운다. */
  polyline(
    points: ArrayLike<number>,
    width: number,
    color: string,
    alpha: number,
    closed = false,
    dash = 0,
  ): void {
    const n = points.length / 2;
    if (n < 2) return;
    const segs = closed ? n : n - 1;
    let along = 0;
    // 좌표 실수를 인자로 넘기면 호출마다 힙 객체로 감싸지므로, 배열과 정수 인덱스를 넘긴다.
    for (let i = 0; i < segs; i++) {
      along = this.segment(points, i, (i + 1) % n, width, color, alpha, dash, along);
    }
  }

  /** 선분 하나(배열 없이). */
  line(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    width: number,
    color: string,
    alpha: number,
    dash = 0,
  ): void {
    lineBuf[0] = ax;
    lineBuf[1] = az;
    lineBuf[2] = bx;
    lineBuf[3] = bz;
    this.segment(lineBuf, 0, 1, width, color, alpha, dash, 0);
  }

  /** 중심·정면·폭·깊이로 정한 사각형 윤곽. */
  rect(
    cx: number,
    cz: number,
    facing: number,
    width: number,
    depth: number,
    lineWidth: number,
    color: string,
    alpha: number,
    dash = 0,
  ): void {
    this.polyline(rectCorners(cx, cz, facing, width, depth), lineWidth, color, alpha, true, dash);
  }

  /** 채운 사각형(전술 지도 부대 덩어리). */
  fillRect(
    cx: number,
    cz: number,
    facing: number,
    width: number,
    depth: number,
    color: string,
    alpha: number,
  ): void {
    const c = rectCorners(cx, cz, facing, width, depth);
    this.triangle(c[0], c[1], c[2], c[3], c[4], c[5], color, alpha);
    this.triangle(c[0], c[1], c[4], c[5], c[6], c[7], color, alpha);
  }

  /** 정면 방향 화살촉(cx, cz에서 facing 방향, 길이 size). */
  arrowHead(cx: number, cz: number, facing: number, size: number, color: string, alpha: number) {
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    const rx = -fz;
    const rz = fx;
    this.triangle(
      cx + fx * size,
      cz + fz * size,
      cx + rx * size * 0.6,
      cz + rz * size * 0.6,
      cx - rx * size * 0.6,
      cz - rz * size * 0.6,
      color,
      alpha,
    );
  }

  /** 원(링). */
  circle(
    cx: number,
    cz: number,
    radius: number,
    width: number,
    color: string,
    alpha: number,
    dash = 0,
  ) {
    const n = Math.max(24, Math.round(radius / 2));
    if (ring.length < n * 2) ring = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ring[i * 2] = cx + Math.sin(a) * radius;
      ring[i * 2 + 1] = cz + Math.cos(a) * radius;
    }
    this.polyline(ring.subarray(0, n * 2), width, color, alpha, true, dash);
  }

  /** 테스트용: 정점 v의 (x, y, z) */
  vertexAt(v: number): [number, number, number] {
    const o = v * 3;
    return [this.positions[o], this.positions[o + 1], this.positions[o + 2]];
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }

  /** 선분을 DRAPE_STEP 간격 사각형(삼각형 2개) 띠로. x, z, 색만 쓰고 높이는 end()에서 채운다. */
  private segment(
    pts: ArrayLike<number>,
    ia: number,
    ib: number,
    width: number,
    color: string,
    alpha: number,
    dash: number,
    along: number,
  ): number {
    const ax = pts[ia * 2];
    const az = pts[ia * 2 + 1];
    const dx = pts[ib * 2] - ax;
    const dz = pts[ib * 2 + 1] - az;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-4) return along;
    const nx = (-dz / len) * (width / 2);
    const nz = (dx / len) * (width / 2);
    const steps = Math.max(1, Math.ceil(len / DRAPE_STEP));
    this.setColor(color);
    const p = this.positions;
    const c = this.colors;
    const r = this.r;
    const g = this.g;
    const b = this.b;
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      if (dash > 0) {
        const mid = along + ((t0 + t1) / 2) * len;
        if (Math.floor(mid / dash) % 2 === 1) continue;
      }
      if (!this.reserve(6)) return along + len;
      const x0 = ax + dx * t0;
      const z0 = az + dz * t0;
      const x1 = ax + dx * t1;
      const z1 = az + dz * t1;
      const v = this.vertices;
      this.vertices += 6;
      const o = v * 3;
      // 삼각형 (x0+n, x0−n, x1+n), (x1+n, x0−n, x1−n)
      p[o] = x0 + nx;
      p[o + 2] = z0 + nz;
      p[o + 3] = x0 - nx;
      p[o + 5] = z0 - nz;
      p[o + 6] = x1 + nx;
      p[o + 8] = z1 + nz;
      p[o + 9] = x1 + nx;
      p[o + 11] = z1 + nz;
      p[o + 12] = x0 - nx;
      p[o + 14] = z0 - nz;
      p[o + 15] = x1 - nx;
      p[o + 17] = z1 - nz;
      const q = v * 4;
      for (let k = 0; k < 24; k += 4) {
        c[q + k] = r;
        c[q + k + 1] = g;
        c[q + k + 2] = b;
        c[q + k + 3] = alpha;
      }
    }
    return along + len;
  }

  /**
   * 쓴 정점의 y = 지형 높이 + lift. Terrain.heightAt과 같은 칸 분할·보간을 한 루프에 펼친다.
   * x·z·lift가 직전에 올린 값과 같은 정점은 계산하지 않고 그 높이를 다시 쓴다(정지 화면에서는 계산 0).
   */
  private fillHeights(n: number): void {
    const t = this.terrain;
    const h = t.heights;
    const cellsX = t.cellsX;
    const cellsZ = t.cellsZ;
    const inv = 1 / t.cellSize;
    const row = cellsX + 1;
    const lift = this.lift;
    const p = this.positions;
    const sp = this.sentPositions;
    const reuse = lift === this.sentLift ? Math.min(n, this.sentVertices) : 0;
    for (let v = 0; v < n; v++) {
      const o = v * 3;
      if (v < reuse && p[o] === sp[o] && p[o + 2] === sp[o + 2]) {
        p[o + 1] = sp[o + 1];
        continue;
      }
      let gx = p[o] * inv;
      gx = gx < 0 ? 0 : gx > cellsX ? cellsX : gx;
      let gz = p[o + 2] * inv;
      gz = gz < 0 ? 0 : gz > cellsZ ? cellsZ : gz;
      // gx, gz ≥ 0 이므로 | 0 이 floor와 같다. 인덱스를 정수로 유지해야 최적화가 풀리지 않는다.
      let ix = gx | 0;
      if (ix > cellsX - 1) ix = cellsX - 1;
      let iz = gz | 0;
      if (iz > cellsZ - 1) iz = cellsZ - 1;
      const fx = gx - ix;
      const fz = gz - iz;
      const i = (iz * row + ix) | 0;
      let y: number;
      if (fx + fz <= 1) {
        const h00 = h[i];
        y = h00 + (h[i + 1] - h00) * fx + (h[i + row] - h00) * fz;
      } else {
        const h11 = h[i + row + 1];
        y = h11 + (h[i + row] - h11) * (1 - fx) + (h[i + 1] - h11) * (1 - fz);
      }
      p[o + 1] = y + lift;
    }
  }

  private sameAsSent(n: number): boolean {
    const p = this.positions;
    const sp = this.sentPositions;
    for (let i = 0, m = n * 3; i < m; i++) if (p[i] !== sp[i]) return false;
    const c = this.colors;
    const sc = this.sentColors;
    for (let i = 0, m = n * 4; i < m; i++) if (c[i] !== sc[i]) return false;
    return true;
  }

  private setColor(color: string): void {
    const rgb = rgbOf(color);
    this.r = rgb[0];
    this.g = rgb[1];
    this.b = rgb[2];
  }

  private reserve(n: number): boolean {
    if (this.vertices + n <= this.maxVertices) return true;
    if (!this.overflowWarned) {
      console.warn(`[DrapedLines] 정점 용량 ${this.maxVertices} 초과, 일부 표시 생략`);
      this.overflowWarned = true;
    }
    return false;
  }
}

/**
 * 사각형 네 꼭짓점(x, z 쌍): 앞왼쪽 → 앞오른쪽 → 뒤오른쪽 → 뒤왼쪽. 오른쪽 = (−cos, sin).
 * 재사용 버퍼를 돌려주므로 다음 호출 전에 다 써야 한다.
 */
function rectCorners(cx: number, cz: number, facing: number, width: number, depth: number) {
  const fx = Math.sin(facing) * (depth / 2);
  const fz = Math.cos(facing) * (depth / 2);
  const rx = -Math.cos(facing) * (width / 2);
  const rz = Math.sin(facing) * (width / 2);
  corners[0] = cx + fx - rx;
  corners[1] = cz + fz - rz;
  corners[2] = cx + fx + rx;
  corners[3] = cz + fz + rz;
  corners[4] = cx - fx + rx;
  corners[5] = cz - fz + rz;
  corners[6] = cx - fx - rx;
  corners[7] = cz - fz - rz;
  return corners;
}
