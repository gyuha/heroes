import { h, teamGlyph, toggleClass } from './dom';
import { type LogLine, formatClock } from './eventText';

const MAX_VISIBLE = 7;
/** 이 시간(게임 초)이 지난 항목은 흐리게 */
const FRESH_SECONDS = 30;

/**
 * 이벤트 로그(GDD §6.5, §9.2). 최근 항목이 위. 항목을 누르면 그 위치로 카메라가 간다.
 * 문장 앞에 진영 모양 글리프를 붙여 색 없이도 주어 진영을 읽게 한다.
 */
export class EventLog {
  readonly root: HTMLElement;
  private readonly lines: { line: LogLine; el: HTMLElement }[] = [];
  private readonly empty: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly onJump: (x: number, z: number) => void,
  ) {
    this.empty = h('div', { class: 'log-empty', text: '전투 기록이 원인과 함께 여기에 남습니다' });
    this.root = h('div', { class: 'hud-log', attrs: { 'aria-live': 'polite' } }, [this.empty]);
    parent.appendChild(this.root);
  }

  push(line: LogLine): void {
    const el = h(
      'div',
      { class: `log-entry ${line.severity}`, attrs: { title: '눌러서 위치로 이동' } },
      [
        h('time', { text: formatClock(line.time) }),
        line.team !== null ? teamGlyph(line.team) : null,
        h('span', { text: line.text }),
      ],
    );
    el.addEventListener('click', () => this.onJump(line.x, line.z));
    this.lines.unshift({ line, el });
    if (this.lines.length > MAX_VISIBLE) this.lines.pop()!.el.remove();
    this.root.replaceChildren(...this.lines.map((l) => l.el));
  }

  clear(): void {
    this.lines.length = 0;
    this.root.replaceChildren(this.empty);
  }

  /** 오래된 항목을 흐리게(초당 몇 번만 불러도 된다). */
  age(now: number): void {
    for (const { line, el } of this.lines) toggleClass(el, 'old', now - line.time > FRESH_SECONDS);
  }
}
