import { MathUtils, type PerspectiveCamera } from 'three';

const PAN_SPEED_PER_DISTANCE = 1.0; // 초당 이동 거리 = 카메라 거리 × 이 값
const PAN_DISTANCE_CAP = 700; // 아주 멀리서 팬이 너무 빨라지지 않게 거리 상한
const ROTATE_SPEED_KEY = 1.6; // rad/s
const ROTATE_SPEED_MOUSE = 0.005; // rad/px
const ZOOM_FACTOR = 1.0015; // 휠 deltaY 1당 거리 배율
const ZOOM_SMOOTHING = 14; // 1/s. 목표 거리로 따라가는 속도
export const MIN_DISTANCE = 12;
/** 1,024m 맵 전체가 4:3 화면에서도 보이는 거리(세로 화각 50°, 수직에 가까운 시점). */
export const MAX_DISTANCE = 1250;
const MIN_PITCH = MathUtils.degToRad(20);
const MAX_PITCH = MathUtils.degToRad(85);
const MIN_CLEARANCE = 2; // 카메라와 지면 사이 최소 높이(m)

/** 이 거리 이상이면 전술 지도(병사 대신 부대 아이콘). 내려올 때는 OFF 거리에서 꺼진다(깜빡임 방지). */
export const TACTICAL_ON_DISTANCE = 650;
export const TACTICAL_OFF_DISTANCE = 560;
/** 멀어질수록 수직 시점으로 넘어간다(레퍼런스의 연속 줌 → 전술 지도). */
const TOP_DOWN_START = 450;
const TOP_DOWN_END = 1000;
const TOP_DOWN_PITCH = MathUtils.degToRad(89);
const FOCUS_SECONDS = 0.35;

/** 전술 지도 켜짐 판정(히스테리시스). */
export function nextTacticalView(current: boolean, distance: number): boolean {
  return current ? distance >= TACTICAL_OFF_DISTANCE : distance >= TACTICAL_ON_DISTANCE;
}

/**
 * RTS 카메라. 지면 위 주시점을 중심으로 방위각(yaw)·내려다보는 각(pitch)·거리로 위치를 정한다.
 * - WASD / 방향키: 이동, Q/E: 회전, 휠: 확대·축소, 가운데 버튼 드래그: 회전과 기울기
 * - 오른쪽 버튼은 명령 입력(UI) 전용이라 쓰지 않는다.
 * - 멀리 축소하면 tacticalView 가 켜진다. 렌더러는 이때 병사를 숨기고 UI가 부대 아이콘을 그린다.
 */
export class RtsCamera {
  targetX: number;
  targetZ: number;
  yaw = 0;
  pitch = MathUtils.degToRad(50);
  /** 현재 거리(m). 휠은 목표 거리를 바꾸고 이 값이 부드럽게 따라간다. */
  distance = 120;
  /** 축소 거리에 따른 전술 지도 상태(히스테리시스 적용). */
  tacticalView = false;
  /** 키보드 입력을 받을지. UI가 모달 화면을 띄울 때 끈다. */
  keyboardEnabled = true;

  private goalDistance = this.distance;
  private readonly keys = new Set<string>();
  private dragging = false;
  private focus: { fromX: number; fromZ: number; toX: number; toZ: number; t: number } | null =
    null;
  private distanceBeforeTactical: number | null = null;
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly camera: PerspectiveCamera,
    element: HTMLElement,
    private readonly bounds: { width: number; depth: number },
    private readonly groundHeight: (x: number, z: number) => number,
  ) {
    this.targetX = bounds.width / 2;
    this.targetZ = bounds.depth / 2;
    this.listen(window, 'keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.ctrlKey || ke.metaKey || ke.altKey) return;
      this.keys.add(ke.code);
    });
    this.listen(window, 'keyup', (e) => this.keys.delete((e as KeyboardEvent).code));
    this.listen(window, 'blur', () => this.keys.clear());
    this.listen(element, 'contextmenu', (e) => e.preventDefault());
    this.listen(element, 'pointerdown', (e) => {
      const pe = e as PointerEvent;
      if (pe.button === 1) {
        pe.preventDefault(); // 가운데 버튼 자동 스크롤 방지
        this.dragging = true;
        element.setPointerCapture(pe.pointerId);
      }
    });
    const stopDrag = (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.button !== 1 && e.type === 'pointerup') return;
      this.dragging = false;
      if (element.hasPointerCapture(pe.pointerId)) element.releasePointerCapture(pe.pointerId);
    };
    this.listen(element, 'pointerup', stopDrag);
    this.listen(element, 'pointercancel', stopDrag);
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
        this.setDistance(this.goalDistance * Math.pow(ZOOM_FACTOR, (e as WheelEvent).deltaY));
        this.distanceBeforeTactical = null;
      },
      { passive: false },
    );
  }

  /** 목표 거리를 바꾼다(부드럽게 이동). */
  setDistance(distance: number): void {
    this.goalDistance = MathUtils.clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
  }

  /** 주시점을 (x, z)로 부드럽게 옮긴다. distance를 주면 그 거리까지 확대한다. */
  focusOn(x: number, z: number, distance?: number): void {
    this.focus = {
      fromX: this.targetX,
      fromZ: this.targetZ,
      toX: MathUtils.clamp(x, 0, this.bounds.width),
      toZ: MathUtils.clamp(z, 0, this.bounds.depth),
      t: 0,
    };
    if (distance !== undefined) this.setDistance(distance);
  }

  /** Tab: 전술 지도(최대 축소)와 직전 거리 사이를 오간다. */
  toggleTacticalMap(): void {
    if (this.distanceBeforeTactical !== null) {
      this.setDistance(this.distanceBeforeTactical);
      this.distanceBeforeTactical = null;
    } else {
      this.distanceBeforeTactical = this.goalDistance;
      this.setDistance(MAX_DISTANCE);
    }
  }

  /** 지금 화면에 쓰는 내려다보는 각. 멀수록 수직에 가깝다. */
  get effectivePitch(): number {
    const t = MathUtils.smoothstep(this.distance, TOP_DOWN_START, TOP_DOWN_END);
    return MathUtils.lerp(this.pitch, TOP_DOWN_PITCH, t);
  }

  update(dtSeconds: number): void {
    let fwd = 0;
    let right = 0;
    if (this.keyboardEnabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) right += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) right -= 1;
      if (this.keys.has('KeyQ')) this.yaw += ROTATE_SPEED_KEY * dtSeconds;
      if (this.keys.has('KeyE')) this.yaw -= ROTATE_SPEED_KEY * dtSeconds;
    }
    if (fwd !== 0 || right !== 0) this.focus = null;

    this.distance +=
      (this.goalDistance - this.distance) * (1 - Math.exp(-ZOOM_SMOOTHING * dtSeconds));
    if (Math.abs(this.goalDistance - this.distance) < 0.01) this.distance = this.goalDistance;
    this.tacticalView = nextTacticalView(this.tacticalView, this.distance);

    if (this.focus) {
      const f = this.focus;
      f.t = Math.min(1, f.t + dtSeconds / FOCUS_SECONDS);
      const k = MathUtils.smootherstep(f.t, 0, 1);
      this.targetX = MathUtils.lerp(f.fromX, f.toX, k);
      this.targetZ = MathUtils.lerp(f.fromZ, f.toZ, k);
      if (f.t >= 1) this.focus = null;
    }

    // 카메라가 바라보는 지면 방향 = 카메라 → 주시점 = -(sin yaw, cos yaw)
    const step = PAN_SPEED_PER_DISTANCE * Math.min(this.distance, PAN_DISTANCE_CAP) * dtSeconds;
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

    const pitch = this.effectivePitch;
    const targetY = this.groundHeight(this.targetX, this.targetZ);
    const horizontal = Math.cos(pitch) * this.distance;
    const camX = this.targetX + Math.sin(this.yaw) * horizontal;
    const camZ = this.targetZ + Math.cos(this.yaw) * horizontal;
    const camY = Math.max(
      targetY + Math.sin(pitch) * this.distance,
      this.groundHeight(camX, camZ) + MIN_CLEARANCE,
    );
    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.targetX, targetY, this.targetZ);
    // UI가 같은 프레임에 화면 좌표를 계산하므로 행렬을 바로 갱신한다.
    this.camera.updateMatrixWorld();
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
