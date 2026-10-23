/**
 * 병사 데이터 저장소. 구조체 배열(SoA): 속성마다 TypedArray 하나, 병사 i의 값은 각 배열의 i번째.
 *
 * - 수천 명을 매 틱 순회하므로 객체 배열 대신 연속 메모리를 쓴다(GC 없음, 캐시 친화적).
 * - 모든 배열은 생성 시 capacity 만큼 한 번만 할당한다.
 * - prev* 는 직전 틱 값이다. 렌더러가 prev 와 현재 값을 보간해 틱 사이 프레임을 그린다.
 * - 죽은 병사는 지우지 않고 alive = 0 으로 남긴다(인덱스가 바뀌지 않아 부대·렌더가 병사를 계속
 *   같은 번호로 가리킬 수 있다). 한 판의 병사 수는 시작 때 정해지고 늘지 않으므로 빈자리 재사용이 필요 없다.
 * - 배열이 평범한 TypedArray 라서 나중에 SharedArrayBuffer 기반으로 바꾸면 Web Worker와 공유할 수 있다.
 */

/** 병종 번호. UnitStore.type 과 렌더러의 병종별 InstancedMesh 순서가 이 값을 쓴다. */
export const UNIT_TYPE_ORDER = ['infantry', 'spearman', 'archer', 'cavalry'] as const;

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
  /** 이동 목표 지점(부대 대형 안 자기 자리). */
  readonly targetX: Float32Array;
  readonly targetZ: Float32Array;
  readonly team: Uint8Array;
  /** UNIT_TYPE_ORDER 의 인덱스 */
  readonly type: Uint8Array;
  /** 소속 부대 ID, 없으면 -1 */
  readonly squad: Int16Array;
  /** 1 = 살아 있음, 0 = 죽었거나 전장을 떠남 */
  readonly alive: Uint8Array;
  /** 1 = 화면에서 지움(시체 표시 시간이 지났거나 괴멸로 전장을 떠남) */
  readonly removed: Uint8Array;
  readonly hp: Float32Array;
  /** 다음 근접 공격까지 남은 초 */
  readonly cooldown: Float32Array;
  /**
   * 규칙 사실을 일어난 틱 번호로 기록한다(-1 = 없음). 애니메이션 클립과 재생 시간은 렌더가 이 값과
   * 위치 변화(속도)로 정한다(ARCHITECTURE §11.3, §11.5). sim에는 애니메이션 상태를 두지 않는다.
   */
  readonly deathTick: Int32Array;
  readonly lastHitTick: Int32Array;
  readonly lastAttackTick: Int32Array;

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
    this.type = new Uint8Array(capacity);
    this.squad = new Int16Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.removed = new Uint8Array(capacity);
    this.hp = new Float32Array(capacity);
    this.cooldown = new Float32Array(capacity);
    this.deathTick = new Int32Array(capacity);
    this.lastHitTick = new Int32Array(capacity);
    this.lastAttackTick = new Int32Array(capacity);
  }

  /** 병사를 추가하고 인덱스를 돌려준다. 목표 지점은 현재 위치로 둔다. */
  add(team: number, x: number, y: number, z: number, heading: number, type = 0, hp = 1): number {
    if (this.count >= this.capacity) {
      throw new Error(`UnitStore 용량 초과: capacity=${this.capacity}`);
    }
    const i = this.count++;
    this.team[i] = team;
    this.type[i] = type;
    this.squad[i] = -1;
    this.alive[i] = 1;
    this.removed[i] = 0;
    this.hp[i] = hp;
    this.cooldown[i] = 0;
    this.deathTick[i] = -1;
    this.lastHitTick[i] = -1;
    this.lastAttackTick[i] = -1;
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
