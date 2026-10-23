const REFRESH_MS = 500;

/**
 * 개발용 성능 표시. 0.5초마다 평균 FPS, 프레임 시간, 틱당 시뮬레이션 시간을 갱신한다.
 * 마지막 측정값은 window.__stats 로도 읽을 수 있다(자동 측정용).
 */
export class StatsOverlay {
  private readonly el: HTMLDivElement;
  private frames = 0;
  private frameMsSum = 0;
  private simMsSum = 0;
  private cpuMsSum = 0;
  private ticks = 0;
  private windowStart = performance.now();

  constructor(
    parent: HTMLElement,
    private readonly staticInfo: () => string,
  ) {
    this.el = document.createElement('div');
    // 오른쪽 위 배속·토글 버튼 아래에 둔다. 왼쪽 위는 UI 상단 띠(청람 병력)와 이벤트 로그 자리다.
    this.el.style.cssText =
      'position:fixed;top:176px;right:8px;padding:6px 8px;background:rgba(0,0,0,.6);color:#0f0;' +
      'font:12px/1.4 monospace;white-space:pre;pointer-events:none;z-index:10';
    parent.appendChild(this.el);
  }

  /**
   * 프레임마다 호출한다. frameMs: 이전 프레임과의 간격, simMs: 이번 프레임에 실행한 틱들의 총 시간,
   * cpuMs: 이번 프레임의 메인 스레드 작업 시간(시뮬레이션 + 렌더 명령 제출). FPS 가 모니터 주사율에
   * 묶여 있을 때는 cpuMs 로 여유를 판단한다.
   */
  record(frameMs: number, simMs: number, ticks: number, cpuMs: number): void {
    this.frames++;
    this.frameMsSum += frameMs;
    this.simMsSum += simMs;
    this.cpuMsSum += cpuMs;
    this.ticks += ticks;
    const now = performance.now();
    const elapsed = now - this.windowStart;
    if (elapsed < REFRESH_MS) return;

    const stats = {
      fps: (this.frames * 1000) / elapsed,
      frameMs: this.frameMsSum / this.frames,
      cpuMs: this.cpuMsSum / this.frames,
      simMsPerTick: this.ticks > 0 ? this.simMsSum / this.ticks : 0,
    };
    (window as unknown as { __stats: typeof stats }).__stats = stats;
    this.el.textContent =
      `FPS ${stats.fps.toFixed(1)}  frame ${stats.frameMs.toFixed(2)}ms  cpu ${stats.cpuMs.toFixed(2)}ms\n` +
      `sim ${stats.simMsPerTick.toFixed(2)}ms/tick\n` +
      this.staticInfo();
    this.frames = 0;
    this.frameMsSum = 0;
    this.simMsSum = 0;
    this.cpuMsSum = 0;
    this.ticks = 0;
    this.windowStart = now;
  }
}
