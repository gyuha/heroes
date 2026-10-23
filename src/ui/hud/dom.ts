/** 작은 DOM 생성 도우미. 속성은 class·텍스트·임의 속성만 다룬다. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; text?: string; attrs?: Record<string, string> } = {},
  children: (Node | string | null)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  for (const c of children) if (c !== null) el.append(c);
  return el;
}

// 마지막으로 쓴 값. DOM을 읽어 비교하면(textContent, style.width) 문자열이 새로 생기므로 따로 기억한다.
const lastText = new WeakMap<Element, string>();
const lastNum = new WeakMap<Element, number>();

/** 값이 바뀔 때만 textContent를 쓴다(매 프레임 갱신 비용 절감). */
export function setText(el: HTMLElement, text: string): void {
  if (lastText.get(el) === text) return;
  lastText.set(el, text);
  el.textContent = text;
}

/** 숫자가 바뀔 때만 천 단위 구분 문자열을 만들어 쓴다. */
export function setNum(el: HTMLElement, value: number): void {
  if (lastNum.get(el) === value) return;
  lastNum.set(el, value);
  setText(el, NUM.format(value));
}

/** 폭(%)이 0.1% 넘게 바뀔 때만 스타일을 쓴다. */
export function setWidthPct(el: HTMLElement, ratio: number): void {
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 1000) / 10;
  if (lastNum.get(el) === pct) return;
  lastNum.set(el, pct);
  el.style.width = `${pct}%`;
}

export function toggleClass(el: Element, name: string, on: boolean): void {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
}

export function teamGlyph(team: 0 | 1): HTMLElement {
  return h('i', { class: `ui-team t${team}`, attrs: { 'aria-hidden': 'true' } });
}

export const NUM = new Intl.NumberFormat('ko-KR');
