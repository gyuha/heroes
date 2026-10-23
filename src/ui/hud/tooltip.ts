import { h } from './dom';

/** 커서·요소 근처에 뜨는 정보 상자. 내용은 매번 새로 채운다. */
export class Tooltip {
  readonly root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = h('div', { class: 'hud-tooltip', attrs: { role: 'tooltip' } });
    parent.appendChild(this.root);
  }

  /** (x, y) 화면 좌표 근처에 띄운다. 화면 밖으로 나가지 않게 뒤집는다. */
  showAt(x: number, y: number, content: Node[]): void {
    this.root.replaceChildren(...content);
    this.root.classList.add('show');
    const w = this.root.offsetWidth;
    const hgt = this.root.offsetHeight;
    const pad = 14;
    let left = x + pad;
    let top = y + pad;
    if (left + w > window.innerWidth - 4) left = x - w - pad;
    if (top + hgt > window.innerHeight - 4) top = y - hgt - pad;
    this.root.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, top)}px)`;
  }

  /** 요소 위쪽에 띄운다(카드·버튼). */
  showAbove(el: HTMLElement, content: Node[]): void {
    const r = el.getBoundingClientRect();
    this.root.replaceChildren(...content);
    this.root.classList.add('show');
    const w = this.root.offsetWidth;
    const hgt = this.root.offsetHeight;
    const left = Math.min(window.innerWidth - w - 4, Math.max(4, r.left + r.width / 2 - w / 2));
    this.root.style.transform = `translate(${left}px, ${Math.max(4, r.top - hgt - 8)}px)`;
  }

  hide(): void {
    this.root.classList.remove('show');
  }
}

/** 화면 가운데 아래 짧은 안내(D-009 "부대를 선택하세요" 등). */
export class Toast {
  readonly root: HTMLElement;
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.root = h('div', { class: 'hud-toast', attrs: { role: 'status', 'aria-live': 'polite' } });
    parent.appendChild(this.root);
  }

  show(text: string, ms = 1600): void {
    this.root.textContent = text;
    this.root.classList.add('show');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.root.classList.remove('show'), ms);
  }
}

export function tipTitle(text: string, lead?: Node): HTMLElement {
  return h('div', { class: 'tip-title' }, [lead ?? null, text]);
}

export function tipRow(label: string, value: string): HTMLElement {
  return h('div', { class: 'tip-row' }, [`${label} `, h('b', { text: value })]);
}

export function tipEffect(text: string, bad = false): HTMLElement {
  return h('div', { class: `tip-effect${bad ? ' bad' : ''}`, text });
}
