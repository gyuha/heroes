import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  LinearFilter,
  Mesh,
  MeshLambertMaterial,
  RGBAFormat,
  type Texture,
  UnsignedByteType,
} from 'three';
import type { GameMap } from '../../sim/map/gameMap';
import { TerrainType } from '../../sim/terrain';

/** 표면 텍스처 한 장이 덮는 길이(m). 병사(1.8m) 기준으로 결이 보이는 크기. */
const TEXTURE_TILE_M = 16;
/** 경사 바위 섞기: 이 각도(°)부터 바위 질감이 섞이기 시작해 통과 불가(30°)를 조금 넘으면 바위가 된다. */
const ROCK_BLEND_DEG: readonly [number, number] = [24, 31];
/** 종류 경계를 흔드는 폭(m). 2m 칸 계단이 보이지 않게 한다. */
const BOUNDARY_JITTER_M = 2.2;
/** 맵 가장자리 통과 불가 경계 안쪽을 어둡게 하는 배율. */
const BORDER_DIM = 0.72;
/*
 * 고저 읽기 보조(D-004, D-012: 능선 마루선·앞 경사·둔덕이 전술 지도와 전투 카메라에서 읽혀야 한다).
 * 장면 조명과 별개로 지형 색에 세 가지를 더한다. 높이는 과장하지 않는다(sim 과 화면이 같아야 한다).
 * 1) 지도식 음영: 북서쪽(D-012: +x = 서쪽 → (+x, +z)), 고도 약 35°의 고정 광원. 평지에서 1이 되게 맞춘다.
 * 2) 높이 색: 평지(10m)에서 마루(35m)로 갈수록 밝고 따뜻하게.
 * 3) 등고선: 평지 기준 5m 간격(15, 20, 25, 30, 35m…). 평지의 ±0.8m 기복은 선이 되지 않는다.
 *    화면에서 선 간격이 몇 픽셀로 좁아지면(먼 급경사) 흐려져 사라진다.
 */
const RELIEF_LIGHT_DIR: readonly [number, number, number] = [0.55, 0.55, 0.63];
const RELIEF_STRENGTH = 1.1;
const ELEVATION_RANGE: readonly [number, number] = [10, 36];
const ELEVATION_LIFT = 0.2;
/** 높은 곳 색 배율(따뜻한 황토 쪽으로). */
const ELEVATION_TINT: readonly [number, number, number] = [1.08, 1.03, 0.86];
const CONTOUR_BASE = 10;
const CONTOUR_INTERVAL = 5;
/**
 * 등고선 반폭: 화면 픽셀 기준과 지면 수평 거리(m) 기준 중 큰 값. 가까이서도 실선으로 보인다.
 * 수평 거리 기준이라 평평한 마루 위에서 선이 넓게 번지지 않는다. 바위(벼랑) 위에는 긋지 않는다.
 */
const CONTOUR_HALF_WIDTH_PX = 0.7;
const CONTOUR_HALF_WIDTH_M = 0.25;
/** 10m마다(20, 30m…) 굵은 계곡선. 높이를 세기 쉽게 한다. */
const CONTOUR_INDEX_WIDTH = 1.7;
/** 선 사이 간격이 이 픽셀 수보다 좁으면 흐려지기 시작해 절반 이하에서 사라진다. */
const CONTOUR_FADE_SPACING_PX = 7;
const CONTOUR_DARKEN = 0.6;
const CONTOUR_COLOR: readonly [number, number, number] = [0.22, 0.16, 0.08];
/** 렌더에서 다리 밑 지형을 내리는 높이: 수면에서 이만큼 아래(m). 다리 칸 지형과 다리 판재가 겹치지 않는다. */
const BRIDGE_UNDERSIDE_DEPTH = 2.5;

export interface SurfaceTextures {
  grass: Texture;
  forest: Texture;
  rock: Texture;
  sand: Texture;
  water: Texture;
  ford: Texture;
}

/**
 * 지형 메시. 칸 분할은 Terrain.heightAt 과 같다: 삼각형 (v00, v01, v10), (v10, v01, v11).
 * 다리·강 칸에만 닿는 정점은 강바닥 쪽으로 내려 강이 다리 밑으로 이어지게 그린다(시뮬레이션 높이는 그대로).
 */
export function createTerrainSurface(map: GameMap, textures: SurfaceTextures): Mesh {
  const geometry = buildGeometry(map);
  const material = createSplatMaterial(map, textures);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'terrain';
  return mesh;
}

function buildGeometry(map: GameMap): BufferGeometry {
  const t = map.terrain;
  const { cellsX, cellsZ, cellSize } = t;
  const vx = cellsX + 1;
  const vz = cellsZ + 1;
  const underside = map.meta.waterLevel - BRIDGE_UNDERSIDE_DEPTH;
  const positions = new Float32Array(vx * vz * 3);
  for (let iz = 0; iz < vz; iz++) {
    for (let ix = 0; ix < vx; ix++) {
      const v = iz * vx + ix;
      let h = t.vertexHeight(ix, iz);
      if (touchesOnlyRiver(map, ix, iz)) h = Math.min(h, underside);
      positions[v * 3] = ix * cellSize;
      positions[v * 3 + 1] = h;
      positions[v * 3 + 2] = iz * cellSize;
    }
  }
  const index = new Uint32Array(cellsX * cellsZ * 6);
  let k = 0;
  for (let iz = 0; iz < cellsZ; iz++) {
    for (let ix = 0; ix < cellsX; ix++) {
      const v00 = iz * vx + ix;
      const v10 = v00 + 1;
      const v01 = v00 + vx;
      const v11 = v01 + 1;
      index[k++] = v00;
      index[k++] = v01;
      index[k++] = v10;
      index[k++] = v10;
      index[k++] = v01;
      index[k++] = v11;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/** 정점 (ix, iz)를 둘러싼 칸이 모두 다리 또는 깊은 물이고, 그중 다리가 하나 이상인가. */
function touchesOnlyRiver(map: GameMap, ix: number, iz: number): boolean {
  const t = map.terrain;
  let bridge = false;
  for (let dz = -1; dz <= 0; dz++) {
    for (let dx = -1; dx <= 0; dx++) {
      const cx = ix + dx;
      const cz = iz + dz;
      if (cx < 0 || cz < 0 || cx >= t.cellsX || cz >= t.cellsZ) return false;
      const type = t.types[cz * t.cellsX + cx];
      if (type === TerrainType.Bridge) bridge = true;
      else if (type !== TerrainType.Water) return false;
    }
  }
  return bridge;
}

/**
 * 종류 맵 → 섞기 가중치 텍스처 두 장(칸 1개 = 텍셀 1개, 선형 보간).
 * A = (평지, 숲, 바위, 흙길), B = (강바닥: 물·다리, 여울, -, -).
 */
function weightTextures(map: GameMap): [DataTexture, DataTexture] {
  const t = map.terrain;
  const n = t.cellsX * t.cellsZ;
  const a = new Uint8Array(n * 4);
  const b = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    switch (t.types[i]) {
      case TerrainType.Grass:
        a[i * 4] = 255;
        break;
      case TerrainType.Forest:
        a[i * 4 + 1] = 255;
        break;
      case TerrainType.Rock:
        a[i * 4 + 2] = 255;
        break;
      case TerrainType.Sand:
        a[i * 4 + 3] = 255;
        break;
      case TerrainType.Water:
      case TerrainType.Bridge:
        b[i * 4] = 255;
        break;
      case TerrainType.Ford:
        b[i * 4 + 1] = 255;
        break;
    }
  }
  const make = (data: Uint8Array) => {
    const tex = new DataTexture(data, t.cellsX, t.cellsZ, RGBAFormat, UnsignedByteType);
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.needsUpdate = true;
    return tex;
  };
  return [make(a), make(b)];
}

function createSplatMaterial(map: GameMap, tex: SurfaceTextures): MeshLambertMaterial {
  const [weightsA, weightsB] = weightTextures(map);
  const material = new MeshLambertMaterial();
  const uniforms = {
    tWeightsA: { value: weightsA },
    tWeightsB: { value: weightsB },
    tGrass: { value: tex.grass },
    tForest: { value: tex.forest },
    tRock: { value: tex.rock },
    tSand: { value: tex.sand },
    tWater: { value: tex.water },
    tFord: { value: tex.ford },
    uMapSize: { value: [map.terrain.width, map.terrain.depth] },
    uTile: { value: TEXTURE_TILE_M },
    uJitter: { value: BOUNDARY_JITTER_M },
    uRockCos: {
      value: [
        Math.cos((ROCK_BLEND_DEG[0] * Math.PI) / 180),
        Math.cos((ROCK_BLEND_DEG[1] * Math.PI) / 180),
      ],
    },
    uBorder: { value: map.meta.boundaryMargin },
    uBorderDim: { value: BORDER_DIM },
    uReliefDir: { value: normalize3(RELIEF_LIGHT_DIR) },
    uRelief: { value: RELIEF_STRENGTH },
    uElevation: { value: [ELEVATION_RANGE[0], ELEVATION_RANGE[1], ELEVATION_LIFT] },
    uElevationTint: { value: ELEVATION_TINT },
    uContour: {
      value: [CONTOUR_BASE, CONTOUR_INTERVAL, CONTOUR_HALF_WIDTH_PX, CONTOUR_HALF_WIDTH_M],
    },
    uContourFade: { value: [1 / CONTOUR_FADE_SPACING_PX, 2 / CONTOUR_FADE_SPACING_PX] },
    uContourColor: { value: CONTOUR_COLOR },
    uContourDarken: { value: CONTOUR_DARKEN },
    uContourIndex: { value: CONTOUR_INDEX_WIDTH },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vNormalW;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vNormalW = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SPLAT_DECLARATIONS}`)
      .replace('#include <map_fragment>', SPLAT_FRAGMENT);
  };
  // 같은 셰이더를 쓰는 머티리얼끼리 프로그램을 공유하도록 이름을 고정한다.
  material.customProgramCacheKey = () => 'terrain-splat-v1';
  return material;
}

const SPLAT_DECLARATIONS = /* glsl */ `
uniform sampler2D tWeightsA;
uniform sampler2D tWeightsB;
uniform sampler2D tGrass;
uniform sampler2D tForest;
uniform sampler2D tRock;
uniform sampler2D tSand;
uniform sampler2D tWater;
uniform sampler2D tFord;
uniform vec2 uMapSize;
uniform float uTile;
uniform float uJitter;
uniform vec2 uRockCos;
uniform float uBorder;
uniform float uBorderDim;
uniform vec3 uReliefDir;
uniform float uRelief;
uniform vec3 uElevation;
uniform vec3 uElevationTint;
uniform vec4 uContour;
uniform vec2 uContourFade;
uniform vec3 uContourColor;
uniform float uContourDarken;
uniform float uContourIndex;
varying vec3 vWorldPos;
varying vec3 vNormalW;

float splatHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float splatNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(splatHash(i), splatHash(i + vec2(1.0, 0.0)), u.x),
             mix(splatHash(i + vec2(0.0, 1.0)), splatHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

const SPLAT_FRAGMENT = /* glsl */ `
{
  vec2 vWorldXZ = vWorldPos.xz;
  vec3 nW = normalize(vNormalW);
  vec2 jitter = vec2(splatNoise(vWorldXZ * 0.35), splatNoise(vWorldXZ * 0.35 + 17.0)) - 0.5;
  jitter += 0.5 * (vec2(splatNoise(vWorldXZ * 1.1 + 5.0), splatNoise(vWorldXZ * 1.1 + 31.0)) - 0.5);
  vec2 uvW = (vWorldXZ + jitter * uJitter) / uMapSize;
  vec4 wA = texture2D(tWeightsA, uvW);
  vec4 wB = texture2D(tWeightsB, uvW);
  // 경계를 조금 또렷하게: 가중치를 제곱해 섞이는 띠를 좁힌다.
  wA *= wA;
  wB *= wB;
  float steep = 1.0 - smoothstep(uRockCos.y, uRockCos.x, nW.y);
  wA.z = max(wA.z, steep);
  vec2 tuv = vWorldXZ / uTile;
  vec3 col = texture2D(tGrass, tuv).rgb * wA.x
    + texture2D(tForest, tuv).rgb * wA.y
    + texture2D(tRock, tuv * 0.75).rgb * wA.z
    + texture2D(tSand, tuv).rgb * wA.w
    + texture2D(tWater, tuv).rgb * wB.x
    + texture2D(tFord, tuv).rgb * wB.y;
  col /= max(wA.x + wA.y + wA.z + wA.w + wB.x + wB.y, 1e-3);
  // 넓은 면의 반복 무늬를 줄이는 큰 명암 변화
  col *= 0.9 + 0.2 * splatNoise(vWorldXZ * 0.012);
  // 지도식 음영: 평지(법선 위쪽)에서 1이 되도록 맞춘다.
  float relief = dot(nW, uReliefDir) - uReliefDir.y;
  col *= 1.0 + uRelief * relief;
  float elev = smoothstep(uElevation.x, uElevation.y, vWorldPos.y);
  col *= (1.0 + uElevation.z * elev) * mix(vec3(1.0), uElevationTint, elev);
  // 등고선: f 의 정수 = 등고선. 기준 높이 + 반 간격 아래(평지·강)에는 긋지 않는다.
  float f = (vWorldPos.y - uContour.x) / uContour.y;
  float fw = max(fwidth(f), 1e-5);
  float dist = abs(fract(f + 0.5) - 0.5);
  // 수평 1m 당 f 변화 = tan(경사) / 간격
  float slopeTan = sqrt(max(1.0 - nW.y * nW.y, 0.0)) / max(nW.y, 0.05);
  float halfW = max(uContour.z * fw, uContour.w * slopeTan / uContour.y);
  halfW *= mod(floor(f + 0.5), 2.0) < 0.5 ? uContourIndex : 1.0;
  float line = 1.0 - smoothstep(halfW, halfW + fw, dist);
  line *= 1.0 - smoothstep(uContourFade.x, uContourFade.y, fw);
  line *= step(0.5, f) * (1.0 - clamp(wA.z, 0.0, 1.0));
  // 선 색 = 바탕색을 어둡게 하고 갈색 쪽으로 기울인 색(바탕 질감이 선 안에서도 이어진다)
  vec3 contourTint = uContourColor / dot(uContourColor, vec3(1.0 / 3.0));
  col = mix(col, col * uContourDarken * contourTint, line);
  float edge = min(min(vWorldXZ.x, uMapSize.x - vWorldXZ.x), min(vWorldXZ.y, uMapSize.y - vWorldXZ.y));
  col *= mix(uBorderDim, 1.0, smoothstep(uBorder - 1.5, uBorder + 1.5, edge));
  diffuseColor.rgb *= col;
}
`;

function normalize3(v: readonly [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}
