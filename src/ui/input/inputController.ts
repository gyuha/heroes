import { type KeyAction, mapKey } from './keymap';

/** 왼쪽 버튼을 이만큼(px) 끌면 상자 선택 */
const BOX_THRESHOLD_PX = 6;
/** 오른쪽 버튼을 이만큼(px) 끌면 정면·폭 지정 */
const LINE_THRESHOLD_PX = 10;

export interface InputHandlers {
  leftClick(sx: number, sy: number, shift: boolean): void;
  boxPreview(box: { x0: number; y0: number; x1: number; y1: number } | null): void;
  boxSelect(box: { x0: number; y0: number; x1: number; y1: number }, shift: boolean): void;
  rightPress(sx: number, sy: number): void;
  rightDrag(sx: number, sy: number): void;
  rightRelease(sx: number, sy: number, dragged: boolean): void;
  hover(sx: number, sy: number): void;
  leave(): void;
  key(action: KeyAction, e: KeyboardEvent): boolean;
}

/**
 * 캔버스 포인터·창 키보드 → 의도(handlers). 판정(무엇을 선택·명령하는지)은 handlers 쪽이 한다.
 * 가운데 버튼은 RtsCamera가 쓰므로 여기서는 왼쪽(0)·오른쪽(2)만 본다.
 */
export class InputController {
  private left: { x: number; y: number; box: boolean } | null = null;
  private right: { x: number; y: number; dragged: boolean } | null = null;
  private readonly disposers: Array<() => void> = [];
  /** 모달이 열려 있으면 false */
  enabled = true;

  constructor(
    private readonly canvas: HTMLElement,
    private readonly handlers: InputHandlers,
  ) {
    this.on(canvas, 'pointerdown', (e) => this.down(e as PointerEvent));
    this.on(canvas, 'pointermove', (e) => this.move(e as PointerEvent));
    this.on(canvas, 'pointerup', (e) => this.up(e as PointerEvent));
    this.on(canvas, 'pointercancel', () => this.cancelDrags());
    this.on(canvas, 'pointerleave', () => {
      if (!this.left && !this.right) handlers.leave();
    });
    this.on(window, 'keydown', (e) => this.keydown(e as KeyboardEvent));
    this.on(window, 'blur', () => this.cancelDrags());
  }

  /** Esc 등으로 진행 중 드래그를 버린다. */
  cancelDrags(): void {
    if (this.left?.box) this.handlers.boxPreview(null);
    this.left = null;
    this.right = null;
  }

  get rightDragging(): boolean {
    return this.right !== null;
  }

  private local(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private down(e: PointerEvent): void {
    if (!this.enabled) return;
    const [x, y] = this.local(e);
    if (e.button === 0) {
      this.left = { x, y, box: false };
      capture(this.canvas, e.pointerId);
    } else if (e.button === 2) {
      this.right = { x, y, dragged: false };
      capture(this.canvas, e.pointerId);
      this.handlers.rightPress(x, y);
    }
  }

  private move(e: PointerEvent): void {
    const [x, y] = this.local(e);
    if (this.left) {
      if (!this.left.box && Math.hypot(x - this.left.x, y - this.left.y) > BOX_THRESHOLD_PX) {
        this.left.box = true;
      }
      if (this.left.box)
        this.handlers.boxPreview({ x0: this.left.x, y0: this.left.y, x1: x, y1: y });
    }
    if (this.right) {
      if (
        !this.right.dragged &&
        Math.hypot(x - this.right.x, y - this.right.y) > LINE_THRESHOLD_PX
      ) {
        this.right.dragged = true;
      }
      this.handlers.rightDrag(x, y);
    }
    if (!this.left && !this.right) this.handlers.hover(x, y);
  }

  private up(e: PointerEvent): void {
    const [x, y] = this.local(e);
    if (e.button === 0 && this.left) {
      const l = this.left;
      this.left = null;
      if (l.box) {
        this.handlers.boxPreview(null);
        this.handlers.boxSelect({ x0: l.x, y0: l.y, x1: x, y1: y }, e.shiftKey);
      } else {
        this.handlers.leftClick(x, y, e.shiftKey);
      }
    } else if (e.button === 2 && this.right) {
      const r = this.right;
      this.right = null;
      this.handlers.rightRelease(x, y, r.dragged);
    }
    if (!this.left && !this.right && this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
  }

  private keydown(e: KeyboardEvent): void {
    if (e.repeat && e.code !== 'Equal' && e.code !== 'Minus') return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const action = mapKey(e);
    if (!action) return;
    if (!this.enabled && action.kind !== 'cancel') return;
    if (this.handlers.key(action, e)) e.preventDefault();
  }

  private on(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.disposers.push(() => target.removeEventListener(type, fn));
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}

/** 포인터 캡처. 이미 끝난 포인터(합성 이벤트 등)면 조용히 넘어간다. */
function capture(el: HTMLElement, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // 캡처 없이도 동작한다(캔버스 밖에서 놓으면 pointerleave 후 다음 입력에서 정리).
  }
}
