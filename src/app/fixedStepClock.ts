/**
 * 고정 틱 누적기. 매 렌더 프레임의 경과 시간을 받아 이번 프레임에 실행할 시뮬레이션 틱 수와
 * 보간 비율(alpha)을 계산한다. DOM·three.js에 의존하지 않아 단독으로 테스트할 수 있다.
 */
export class FixedStepClock {
  private accumulatorMs = 0;

  /**
   * @param stepMs 한 틱의 길이(ms)
   * @param maxStepsPerFrame 한 프레임에 따라잡을 최대 틱 수. 넘는 시간은 버린다
   *   (탭 전환·디버거 정지 후 수백 틱을 몰아 실행하며 멈추는 현상 방지).
   */
  constructor(
    readonly stepMs: number,
    readonly maxStepsPerFrame = 5,
  ) {}

  /** 프레임 경과 시간을 더하고 실행할 틱 수를 돌려준다. */
  advance(frameMs: number): number {
    this.accumulatorMs += Math.max(0, frameMs);
    let steps = Math.floor(this.accumulatorMs / this.stepMs);
    if (steps > this.maxStepsPerFrame) {
      steps = this.maxStepsPerFrame;
      this.accumulatorMs = 0;
    } else {
      this.accumulatorMs -= steps * this.stepMs;
    }
    return steps;
  }

  /** 직전 틱과 다음 틱 사이 위치(0~1). 렌더러가 prev/현재 상태 보간에 쓴다. */
  get alpha(): number {
    return this.accumulatorMs / this.stepMs;
  }
}
