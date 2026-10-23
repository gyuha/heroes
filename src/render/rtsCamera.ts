import { MathUtils, type PerspectiveCamera } from 'three';

const PAN_SPEED_PER_DISTANCE = 1.0; // 초당 이동 거리 = 카메라 거리 × 이 값
const ROTATE_SPEED_KEY = 1.6; // rad/s
const ROTATE_SPEED_MOUSE = 0.005; // rad/px
const ZOOM_FACTOR = 1.0015; // 휠 deltaY 1당 거리 배율
const MIN_DISTANCE = 12;
const MAX_DISTANCE = 450;
const MIN_PITCH = MathUtils.degToRad(20);
const MAX_PITCH = MathUtils.degToRad(85);
const MIN_CLEARANCE = 2; // 카메라와 지면 사이 최소 높이(m)

/**
 * RTS 카메라. 지면 위 주시점을 중심으로 방위각(yaw)·내려다보는 각(pitch)·거리로 위치를 정한다.
 * - WASD / 방향키: 이동, Q/E: 회전, 휠: 확대·축소, 가운데·오른쪽 버튼 드래그: 회전과 기울기
 */
export class RtsCamera {
  targetX: number;
  targetZ: number;
  yaw = 0;
  pitch = MathUtils.degToRad(50);
  distance = 120;

  private readonly keys = new Set<string>();
  private dragging = false;
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly camera: PerspectiveCamera,
    element: HTMLElement,
    private readonly bounds: { width: number; depth: number },
    private readonly groundHeight: (x: number, z: number) => number,
  ) {
    this.targetX = bounds.width / 2;
    this.targetZ = bounds.depth / 2;
    this.listen(window, 'keydown', (e) => this.keys.add((e as KeyboardEvent).code));
    this.listen(window, 'keyup', (e) => this.keys.delete((e as KeyboardEvent).code));
    this.listen(window, 'blur', () => this.keys.clear());
    this.listen(element, 'contextmenu', (e) => e.preventDefault());
    this.listen(element, 'pointerdown', (e) => {
      const pe = e as PointerEvent;
      if (pe.button === 1 || pe.button === 2) {
        this.dragging = true;
        element.setPointerCapture(pe.pointerId);
      }
    });
    this.listen(element, 'pointerup', () => (this.dragging = false));
    this.listen(element, 'pointermove', (e) => {
      if (!this.dragging) return;
      const pe = e as PointerEvent;
      this.yaw -= pe.movementX * ROTATE_SPEED_MOUSE;
      this.pitch = MathUtils.clamp(
        this.pitch + pe.movementY * ROTATE_SPEED_MOUSE,
        MIN_PITCH,
        MAX_PITCH,
      );
    });
    this.listen(
      element,
      'wheel',
      (e) => {
        e.preventDefault();
        this.distance = MathUtils.clamp(
          this.distance * Math.pow(ZOOM_FACTOR, (e as WheelEvent).deltaY),
          MIN_DISTANCE,
          MAX_DISTANCE,
        );
      },
      { passive: false },
    );
  }

  update(dtSeconds: number): void {
    let fwd = 0;
    let right = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) right += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) right -= 1;
    if (this.keys.has('KeyQ')) this.yaw += ROTATE_SPEED_KEY * dtSeconds;
    if (this.keys.has('KeyE')) this.yaw -= ROTATE_SPEED_KEY * dtSeconds;

    // 카메라가 바라보는 지면 방향 = 카메라 → 주시점 = -(sin yaw, cos yaw)
    const step = PAN_SPEED_PER_DISTANCE * this.distance * dtSeconds;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    this.targetX = MathUtils.clamp(
      this.targetX + (fx * fwd - fz * right) * step,
      0,
      this.bounds.width,
    );
    this.targetZ = MathUtils.clamp(
      this.targetZ + (fz * fwd + fx * right) * step,
      0,
      this.bounds.depth,
    );

    const targetY = this.groundHeight(this.targetX, this.targetZ);
    const horizontal = Math.cos(this.pitch) * this.distance;
    const camX = this.targetX + Math.sin(this.yaw) * horizontal;
    const camZ = this.targetZ + Math.cos(this.yaw) * horizontal;
    const camY = Math.max(
      targetY + Math.sin(this.pitch) * this.distance,
      this.groundHeight(camX, camZ) + MIN_CLEARANCE,
    );
    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.targetX, targetY, this.targetZ);
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }

  private listen(
    target: EventTarget,
    type: string,
    handler: (e: Event) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    this.disposers.push(() => target.removeEventListener(type, handler, options));
  }
}
