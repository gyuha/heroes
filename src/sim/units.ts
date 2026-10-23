/**
 * 병사 데이터 저장소. 구조체 배열(SoA): 속성마다 TypedArray 하나, 병사 i의 값은 각 배열의 i번째.
 *
 * - 수천 명을 매 틱 순회하므로 객체 배열 대신 연속 메모리를 쓴다(GC 없음, 캐시 친화적).
 * - 모든 배열은 생성 시 capacity 만큼 한 번만 할당한다.
 * - prev* 는 직전 틱 값이다. 렌더러가 prev 와 현재 값을 보간해 틱 사이 프레임을 그린다.
 * - 배열이 평범한 TypedArray 라서 나중에 SharedArrayBuffer 기반으로 바꾸면 Web Worker와 공유할 수 있다.
 */
export class UnitStore {
  count = 0;

  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** 진행 방향(라디안). 0 = +Z, 정면 벡터 = (sin, cos). */
  readonly heading: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly prevZ: Float32Array;
  readonly prevHeading: Float32Array;
  readonly vx: Float32Array;
  readonly vz: Float32Array;
  /** 이동 목표 지점. */
  readonly targetX: Float32Array;
  readonly targetZ: Float32Array;
  readonly team: Uint8Array;

  constructor(readonly capacity: number) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.heading = new Float32Array(capacity);
    this.prevX = new Float32Array(capacity);
    this.prevY = new Float32Array(capacity);
    this.prevZ = new Float32Array(capacity);
    this.prevHeading = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.targetX = new Float32Array(capacity);
    this.targetZ = new Float32Array(capacity);
    this.team = new Uint8Array(capacity);
  }

  /** 병사를 추가하고 인덱스를 돌려준다. 목표 지점은 현재 위치로 둔다. */
  add(team: number, x: number, y: number, z: number, heading: number): number {
    if (this.count >= this.capacity) {
      throw new Error(`UnitStore 용량 초과: capacity=${this.capacity}`);
    }
    const i = this.count++;
    this.team[i] = team;
    this.x[i] = this.prevX[i] = this.targetX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.z[i] = this.prevZ[i] = this.targetZ[i] = z;
    this.heading[i] = this.prevHeading[i] = heading;
    this.vx[i] = 0;
    this.vz[i] = 0;
    return i;
  }

  /** 틱 시작 시 현재 상태를 prev 로 복사한다. */
  savePrevious(): void {
    const n = this.count;
    this.prevX.set(this.x.subarray(0, n));
    this.prevY.set(this.y.subarray(0, n));
    this.prevZ.set(this.z.subarray(0, n));
    this.prevHeading.set(this.heading.subarray(0, n));
  }
}
