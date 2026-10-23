import type { SimEvent } from './api';
import { SQUAD } from './data/simConfig';

const THROTTLE_KINDS = ['chargeFailed', 'attacked', 'highGround', 'outOfRange'] as const;
type ThrottledKind = (typeof THROTTLE_KINDS)[number];
/** 같은 kind 안의 세부 원인(측면/후방, 돌격 실패 이유 등) 최대 개수 */
const MAX_SUB = 8;

/**
 * 틱마다 채우는 이벤트 버퍼. World.step 시작에 비우고, 틱이 끝나면 세션이 구독자에게 넘긴다.
 * 로그성 이벤트는 같은 부대·같은 원인을 SQUAD.logThrottle 초에 한 번만 받는다(GDD §6.5).
 */
export class EventBuffer {
  readonly list: SimEvent[] = [];
  private readonly lastLogTime: Float64Array;

  constructor(maxSquads: number) {
    this.lastLogTime = new Float64Array(maxSquads * THROTTLE_KINDS.length * MAX_SUB).fill(-1e9);
  }

  clear(): void {
    this.list.length = 0;
  }

  push(e: SimEvent): void {
    this.list.push(e);
  }

  /** 로그성 이벤트. sub = 세부 원인 번호(0~7). 억제 시간 안이면 버리고 false. */
  pushThrottled(e: SimEvent & { kind: ThrottledKind; squad: number }, sub = 0): boolean {
    const k = THROTTLE_KINDS.indexOf(e.kind);
    const idx = (e.squad * THROTTLE_KINDS.length + k) * MAX_SUB + sub;
    if (e.time - this.lastLogTime[idx] < SQUAD.logThrottle) return false;
    this.lastLogTime[idx] = e.time;
    this.list.push(e);
    return true;
  }
}
