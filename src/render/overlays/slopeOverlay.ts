import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Mesh,
  LinearFilter,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
} from 'three';
import type { HeightFn } from './drapedLines';

/** 오버레이 해상도(m). 지형 칸(2m)의 두 배로 낮춰 계산·정점 비용을 1/4로 줄인다. */
const CELL = 4;
const LIFT = 0.9;
/** 텍스처 R 채널에 계수를 담는 최대값 */
const FACTOR_SCALE = 1.25;

/**
 * 이동 계수 오버레이(GDD §6.5 ①). 칸마다 계수를 텍스처에 한 번 구워 두고, 셰이더가 구간 색과
 * 통과 불가 빗금을 그린다. 병종(계수 함수)이 바뀔 때만 bake()를 다시 부른다(아키텍트 성능 요청).
 * 구간 색: 100% 이상 초록, 70~99% 노랑, 35~69% 주황, 통과 불가 빨간 빗금.
 */
export class SlopeOverlay {
  readonly mesh: Mesh;
  private readonly data: Uint8Array;
  private readonly texture: DataTexture;
  private readonly nx: number;
  private readonly nz: number;
  private bakedKey: string | null = null;

  constructor(
    private readonly width: number,
    private readonly depth: number,
    height: HeightFn,
  ) {
    this.nx = Math.ceil(width / CELL);
    this.nz = Math.ceil(depth / CELL);
    this.data = new Uint8Array(this.nx * this.nz * 4);
    this.texture = new DataTexture(this.data, this.nx, this.nz, RGBAFormat, UnsignedByteType);
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.needsUpdate = true;

    const vx = this.nx + 1;
    const vz = this.nz + 1;
    const pos = new Float32Array(vx * vz * 3);
    for (let iz = 0; iz < vz; iz++) {
      for (let ix = 0; ix < vx; ix++) {
        const x = Math.min(ix * CELL, width);
        const z = Math.min(iz * CELL, depth);
        const v = (iz * vx + ix) * 3;
        pos[v] = x;
        pos[v + 1] = height(x, z) + LIFT;
        pos[v + 2] = z;
      }
    }
    const index = new Uint32Array(this.nx * this.nz * 6);
    let k = 0;
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const a = iz * vx + ix;
        index[k++] = a;
        index[k++] = a + vx;
        index[k++] = a + 1;
        index[k++] = a + 1;
        index[k++] = a + vx;
        index[k++] = a + vx + 1;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setIndex(new BufferAttribute(index, 1));

    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
      uniforms: {
        factors: { value: this.texture },
        mapSize: { value: [width, depth] },
        opacity: { value: 0.42 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vWorld;
        void main() {
          vWorld = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D factors;
        uniform vec2 mapSize;
        uniform float opacity;
        varying vec2 vWorld;
        // 색은 선형 공간 값(sRGB #4FA36B, #E9CF5C, #E07B39, #C43C3C)
        const vec3 GREEN = vec3(0.078, 0.366, 0.147);
        const vec3 YELLOW = vec3(0.815, 0.624, 0.107);
        const vec3 ORANGE = vec3(0.745, 0.198, 0.041);
        const vec3 RED = vec3(0.552, 0.045, 0.045);
        void main() {
          vec4 t = texture2D(factors, vWorld / mapSize);
          float f = t.r * ${FACTOR_SCALE.toFixed(2)};
          vec3 c;
          float a = opacity;
          if (t.a < 0.5) {
            // 통과 불가: 대각선 빗금 (6m 주기)
            float stripe = step(0.5, fract((vWorld.x + vWorld.y) / 6.0));
            c = RED;
            a = mix(0.25, 0.8, stripe);
          } else if (f >= 0.945) {
            c = GREEN;
          } else if (f >= 0.695) {
            c = YELLOW;
          } else {
            c = ORANGE;
          }
          gl_FragColor = vec4(c, a);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  /**
   * factorAt(x, z, dirX, dirZ) 로 칸마다 가장 느린 방향(오르막) 계수를 구워 둔다.
   * key가 직전과 같으면 아무것도 하지 않는다.
   */
  bake(
    key: string,
    gradientAt: (x: number, z: number, out: Float32Array) => void,
    factorAt: (x: number, z: number, dirX: number, dirZ: number) => number,
  ): void {
    if (key === this.bakedKey) return;
    this.bakedKey = key;
    const g = new Float32Array(2);
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const x = Math.min((ix + 0.5) * CELL, this.width);
        const z = Math.min((iz + 0.5) * CELL, this.depth);
        gradientAt(x, z, g);
        const len = Math.hypot(g[0], g[1]);
        const f = len > 1e-5 ? factorAt(x, z, g[0], g[1]) : factorAt(x, z, 0, 1);
        const i = (iz * this.nx + ix) * 4;
        this.data[i] = Math.min(255, Math.round((Math.max(0, f) / FACTOR_SCALE) * 255));
        this.data[i + 3] = f > 0 ? 255 : 0;
      }
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
    this.texture.dispose();
  }
}
