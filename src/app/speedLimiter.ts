import type { GameSpeed } from '../sim/api';

/**
 * 4배속 자동 제한(D-016, ARCHITECTURE §9.4). 최근 틱 시간의 평균이 LIMIT_MS를 넘는 기기에서는 4배속(초당 80틱)을
 * 유지할 수 없으므로 최고 배속을 2로 낮춘다. 평균이 RELEASE_MS 아래로 내려오면 다시 연다(경계에서 깜빡이지 않게).
 * 틱 시간은 시뮬레이션이 아니라 세션이 잰다(sim은 시계를 읽지 않는다).
 */
export const SPEED_LIMIT = {
  /** 최근 이만큼의 틱으로 평균을 낸다(1배속 10초) */
  window: 200,
  /** 표본이 이보다 적으면 판단하지 않는다 */
  minSamples: 100,
  limitMs: 4,
  releaseMs: 3,
  limitedMax: 2 as GameSpeed,
};

const REASON = '이 기기에서는 시뮬레이션이 느려 4배속을 막았습니다';

export class SpeedLimiter {
  maxSpeed: GameSpeed = 4;
  reason: string | null = null;
  /** 최근 틱 평균(ms), 표본이 부족하면 NaN */
  averageMs = NaN;
  private readonly samples = new Float64Array(SPEED_LIMIT.window);
  private count = 0;
  private next = 0;
  private sum = 0;

  record(tickMs: number): void {
    if (this.count === SPEED_LIMIT.window) this.sum -= this.samples[this.next];
    else this.count++;
    this.samples[this.next] = tickMs;
    this.sum += tickMs;
    this.next = (this.next + 1) % SPEED_LIMIT.window;
    if (this.count < SPEED_LIMIT.minSamples) return;
    this.averageMs = this.sum / this.count;
    if (this.maxSpeed === 4 && this.averageMs > SPEED_LIMIT.limitMs) {
      this.maxSpeed = SPEED_LIMIT.limitedMax;
      this.reason = REASON;
    } else if (this.maxSpeed !== 4 && this.averageMs < SPEED_LIMIT.releaseMs) {
      this.maxSpeed = 4;
      this.reason = null;
    }
  }
}
