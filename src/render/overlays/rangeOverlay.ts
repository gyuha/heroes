import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  ShaderMaterial,
} from 'three';
import type { HeightFn } from './drapedLines';

const RINGS = 16;
const MAX_DIRECTIONS = 128;
const MAX_PROFILES = 12;
const LIFT = 1.1;

export interface RangeProfileData {
  readonly x: number;
  readonly z: number;
  /** 방향별 최대 사거리(m), 방향 a = i/n × 2π, 벡터 (sin a, cos a) */
  readonly radii: ArrayLike<number>;
  /** 방향별 직사 가능 거리(m). 그 너머는 곡사만(빗금) */
  readonly directUntil: ArrayLike<number>;
}

/**
 * 궁수 실제 사거리 영역(GDD §6.5 ③). 방향마다 고도차로 잰 다각형을 지형에 붙여 그린다.
 * 직사 가능 구간은 옅게 채우고, 곡사만 가능한 구간은 빗금을 친다(숲 너머 등). 바깥선은 rangeOutline()을
 * DrapedLines로 그린다(카메라 거리와 관계없이 화면 굵기가 일정하다).
 * 프로필이 바뀔 때만 set()으로 정점을 다시 만든다.
 */
export class RangeOverlay {
  readonly mesh: Mesh;
  private readonly geometry = new BufferGeometry();
  private readonly positions: Float32Array;
  private readonly arc: Float32Array;

  constructor(
    private readonly height: HeightFn,
    color = '#F4EFE2',
  ) {
    const maxVerts = MAX_PROFILES * MAX_DIRECTIONS * RINGS * 6;
    this.positions = new Float32Array(maxVerts * 3);
    this.arc = new Float32Array(maxVerts);
    this.geometry.setAttribute(
      'position',
      new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'arcOnly',
      new BufferAttribute(this.arc, 1).setUsage(DynamicDrawUsage),
    );
    this.geometry.setDrawRange(0, 0);
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
      uniforms: { tint: { value: new Color(color) } },
      vertexShader: /* glsl */ `
        attribute float arcOnly;
        varying float vArc;
        varying vec2 vWorld;
        void main() {
          vArc = arcOnly;
          vWorld = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 tint;
        varying float vArc;
        varying vec2 vWorld;
        void main() {
          // 사거리는 보조 정보다. 부대 마커·선택 윤곽보다 옅게(UI_UX_GUIDE §3.4).
          // 바깥선은 화면 굵기가 일정한 지면 선(DrapedLines)으로 따로 그린다.
          float a = 0.05;
          if (vArc > 0.5) {
            float stripe = step(0.6, fract((vWorld.x - vWorld.y) / 5.0));
            a = mix(0.0, 0.12, stripe);
          }
          gl_FragColor = vec4(tint, a);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  set(profiles: readonly RangeProfileData[]): void {
    let v = 0;
    const push = (x: number, z: number, arcOnly: number) => {
      this.positions[v * 3] = x;
      this.positions[v * 3 + 1] = this.height(x, z) + LIFT;
      this.positions[v * 3 + 2] = z;
      this.arc[v] = arcOnly;
      v++;
    };
    for (const p of profiles.slice(0, MAX_PROFILES)) {
      const n = Math.min(MAX_DIRECTIONS, p.radii.length);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        for (let r = 0; r < RINGS; r++) {
          const t0 = r / RINGS;
          const t1 = (r + 1) / RINGS;
          const r00 = p.radii[i] * t0;
          const r01 = p.radii[i] * t1;
          const r10 = p.radii[j] * t0;
          const r11 = p.radii[j] * t1;
          const arc = (rad: number, dir: number) => (rad > p.directUntil[dir] + 0.01 ? 1 : 0);
          const P = (rad: number, a: number) => [p.x + Math.sin(a) * rad, p.z + Math.cos(a) * rad];
          const [x00, z00] = P(r00, a0);
          const [x01, z01] = P(r01, a0);
          const [x10, z10] = P(r10, a1);
          const [x11, z11] = P(r11, a1);
          push(x00, z00, arc(r00, i));
          push(x01, z01, arc(r01, i));
          push(x10, z10, arc(r10, j));
          push(x10, z10, arc(r10, j));
          push(x01, z01, arc(r01, i));
          push(x11, z11, arc(r11, j));
        }
      }
    }
    this.geometry.setDrawRange(0, v);
    for (const name of ['position', 'arcOnly']) {
      (this.geometry.attributes[name] as BufferAttribute).needsUpdate = true;
    }
    this.mesh.visible = v > 0;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}

/** 사거리 바깥선 꼭짓점(x, z 쌍, 닫힌 꺾은선). */
export function rangeOutline(p: RangeProfileData): Float32Array {
  const n = p.radii.length;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out[i * 2] = p.x + Math.sin(a) * p.radii[i];
    out[i * 2 + 1] = p.z + Math.cos(a) * p.radii[i];
  }
  return out;
}
