/**
 * MVP 맵 "갈대 여울"(GDD §10) 생성기. 같은 입력이면 항상 같은 지형을 만든다.
 * tools/map/generate.ts 가 이 결과를 public/maps/reed_ford/ 에 파일로 쓰고, 테스트는 메모리에서 바로 쓴다.
 *
 * 좌표: +x = 서쪽, +z = 북쪽(D-012). 높이는 정점마다, 종류는 칸 중심마다 정한다.
 */
import { Terrain, TerrainType } from '../terrain';
import { fbm, smoothstep } from '../terrainGen';
import { GameMap, MAP_FORMAT, type MapCrossing, type MapMeta } from './gameMap';

const DEG = Math.PI / 180;

const CELL_SIZE = 2;
const CELLS = 512;
const SIZE = CELLS * CELL_SIZE;
const NOISE_SEED = 1013;

// 높이 (GDD §10.1)
const PLAIN_HEIGHT = 10;
/** 평지의 장식용 기복 진폭(m). 규칙에 영향이 없을 만큼 작게 둔다. */
const PLAIN_NOISE_AMP = 0.8;
const PLAIN_NOISE_SCALE = 160;
const WATER_LEVEL = 7;
const RIVER_BED = 4;
const HEIGHT_MIN = 0;
const HEIGHT_MAX = 64;

// 갈대강 (GDD §10.2)
const RIVER_CENTERLINE: readonly (readonly [number, number])[] = [
  [0, 610],
  [300, 590],
  [520, 600],
  [760, 585],
  [1024, 600],
];
const RIVER_HALF_WIDTH = 15;
/** 강 중심에서 이 거리까지는 바닥이 평평하다(m). */
const RIVER_BED_HALF_WIDTH = 9;
/** 수면 경계에서 평지 높이까지 둑 폭(m). */
const RIVER_BANK_WIDTH = 11;

// 중앙 여울: 강을 따라 40m, 강 폭 전체
const FORD_X = 520;
const FORD_HALF_LENGTH = 20;
/** 여울 바닥 높이. 수면보다 조금 높여 수면 없이 바닥 틴트로 그린다(아트 제안, INTERFACES 요청 표). */
const FORD_BED = WATER_LEVEL + 0.2;
/** 여울 양옆(강 방향)에서 깊은 강바닥으로 바뀌는 폭(m). */
const FORD_EDGE_BLEND = 10;
/** 여울 쪽 둑은 길게 깎아 완만하게 오른다(m). */
const FORD_BANK_WIDTH = 22;

// 다리: 남북 방향, 폭 10m, 길이 40m, 둑 높이로 평평
/** 동쪽 다리(x 241), 서쪽 다리(x 801). GDD (240, 592), (800, 588). 10m 폭이 2m 칸 5개에 맞도록 x를 홀수로 둔다 */
const BRIDGE_XS = [241, 801];
const BRIDGE_HALF_WIDTH = 5;
const BRIDGE_HALF_LENGTH = 20;
const BRIDGE_DECK = PLAIN_HEIGHT;
/** 다리 끝에서 지형이 다리 높이로 맞춰지는 거리(m). */
const BRIDGE_APPROACH = 14;
/** 강 수면 경계 바깥 이만큼까지 다리 칸으로 둔다(m). 그 너머 다리 길이 안쪽은 흙길이다. */
const BRIDGE_TYPE_OVERHANG = 2;

// 매봉 능선
const RIDGE_CREST_START = [180, 420] as const;
const RIDGE_CREST_END = [660, 430] as const;
const RIDGE_RISE = 25;
const RIDGE_FRONT_SLOPE_DEG = 12;
const RIDGE_BACK_SLOPE_DEG = 6;
const RIDGE_FRONT_EASE = 20;
const RIDGE_BACK_EASE = 30;
/** 서쪽 끝(x 큰 쪽)에서 능선이 평지로 낮아지는 구간(x, m). 서쪽 측면은 열려 있어야 한다. */
const RIDGE_WEST_TAPER: readonly [number, number] = [600, 700];

// 동쪽 벼랑(D-011: 경계부터 x 180까지 막아 능선 우회로를 없앤다). 맵 밖(x < 0)까지 이어진 바위 고원이다.
const CLIFF_RECT = { minX: -200, maxX: 180, minZ: 380, maxZ: 560 };
/** 벼랑 가장자리 높이와, 안쪽으로 CLIFF_RISE_DEPTH 만큼 들어갈 때 더 오르는 높이(m). 판판한 고원이 되지 않게 한다. */
const CLIFF_EDGE_HEIGHT = 40;
const CLIFF_INNER_RISE = 14;
const CLIFF_RISE_DEPTH = 100;
/** 고원 윗면 기복: 큰 바위 등성이(능형 노이즈)와 잔 기복(m). */
const CLIFF_RIDGED_AMP = 9;
const CLIFF_ROUGH_AMP = 2.5;
/** 벼랑면 폭(m): 경계 바깥 FACE_OUT 부터 안쪽 FACE_IN 까지 가파르게 오른다. */
const CLIFF_FACE_OUT = 4;
const CLIFF_FACE_IN = 16;

// 북쪽 둔덕
const MOUND_CENTER = [520, 760] as const;
const MOUND_RISE = 12;
const MOUND_SLOPE_DEG = 6;
const MOUND_EASE = 20;

// 검은숲(D-012: 서쪽): 지면 10~14m의 완만한 기복
const FOREST_RECT = { minX: 680, maxX: 880, minZ: 330, maxZ: 520 };

// 숲·벼랑 외곽선(D-012): 모서리를 둥글게 깎고, 큰 굴곡 + 잔 굴곡으로 보통 ±15~20m 흔든 뒤 ±24m 안으로 부드럽게 누른다.
// 상한을 두는 이유: 벼랑의 능선 쪽 면이 x 156보다 물러나지 않아야 능선 측면 봉쇄가 유지된다.
const EDGE_CORNER_RADIUS = 45;
const EDGE_WOBBLE_LARGE = { amp: 100, scale: 70 };
const EDGE_WOBBLE_SMALL = { amp: 24, scale: 22 };
const EDGE_WOBBLE_MAX = 24;
/** 외곽선 노이즈가 남긴 이보다 작은 숲·바위 조각(칸 수)은 평지로 되돌린다. 나무 한 그루짜리 은폐 칸 같은 것을 없앤다. */
const MIN_PATCH_CELLS = 40;
const FOREST_RISE = 4;
const FOREST_RISE_EDGE = 25;

// 흙길: 폭 8m
const ROAD_HALF_WIDTH = 4;
const ROADS: readonly (readonly [number, number])[][] = [
  // 북쪽 배치 구역 → 동쪽 다리(x 241), 중앙 여울, 서쪽 다리(x 801)
  [
    [300, 975],
    [262, 800],
    [241, 660],
    [241, 614],
  ],
  [
    [470, 975],
    [430, 830],
    [448, 690],
    [505, 638],
    [520, 618],
  ],
  [
    [760, 975],
    [792, 800],
    [801, 660],
    [801, 604],
  ],
  // 남쪽 배치 구역 → 능선 뒤(깃발)
  [
    [400, 165],
    [418, 300],
    [420, 395],
  ],
  [
    [720, 165],
    [640, 300],
    [540, 400],
  ],
];

const DEPLOY_DEFENDER: [number, number, number, number] = [150, 150, 900, 560];
const DEPLOY_ATTACKER: [number, number, number, number] = [60, 800, 960, 980];
const FLAG = { x: 420, z: 432, radius: 40 };
const BOUNDARY_MARGIN = 40;
const PROP_SEED = 1;

/** 갈대 여울을 만든다(약 0.3초). */
export function createReedFord(): GameMap {
  const bridges: MapCrossing[] = BRIDGE_XS.map((x) => ({
    x,
    z: evenRound(riverCenterZ(x)),
    heading: 0,
    length: BRIDGE_HALF_LENGTH * 2,
    width: BRIDGE_HALF_WIDTH * 2,
  }));
  const fords: MapCrossing[] = [
    {
      x: FORD_X,
      z: Math.round(riverCenterZ(FORD_X)),
      heading: 0,
      length: RIVER_HALF_WIDTH * 2,
      width: FORD_HALF_LENGTH * 2,
    },
  ];

  const vx = CELLS + 1;
  const heights = new Float32Array(vx * vx);
  for (let iz = 0; iz <= CELLS; iz++) {
    for (let ix = 0; ix <= CELLS; ix++) {
      heights[iz * vx + ix] = vertexHeight(ix * CELL_SIZE, iz * CELL_SIZE, bridges);
    }
  }

  const types = new Uint8Array(CELLS * CELLS);
  for (let iz = 0; iz < CELLS; iz++) {
    for (let ix = 0; ix < CELLS; ix++) {
      types[iz * CELLS + ix] = cellType((ix + 0.5) * CELL_SIZE, (iz + 0.5) * CELL_SIZE, bridges);
    }
  }
  removeSmallPatches(types, TerrainType.Forest);
  removeSmallPatches(types, TerrainType.Rock);

  const meta: MapMeta = {
    format: MAP_FORMAT,
    id: 'reed_ford',
    name: '갈대 여울',
    cellSize: CELL_SIZE,
    cellsX: CELLS,
    cellsZ: CELLS,
    heightMin: HEIGHT_MIN,
    heightMax: HEIGHT_MAX,
    waterLevel: WATER_LEVEL,
    boundaryMargin: BOUNDARY_MARGIN,
    propSeed: PROP_SEED,
    bridges,
    fords,
    objectives: [{ type: 'flag', ...FLAG }],
    deployZones: { defender: DEPLOY_DEFENDER, attacker: DEPLOY_ATTACKER },
  };
  return new GameMap(meta, new Terrain(CELLS, CELLS, CELL_SIZE, heights, types));
}

function vertexHeight(x: number, z: number, bridges: readonly MapCrossing[]): number {
  let h = PLAIN_HEIGHT + PLAIN_NOISE_AMP * (2 * noise(x, z, PLAIN_NOISE_SCALE, 0) - 1);
  h += ridgeHeight(x, z);
  h +=
    MOUND_RISE *
    (1 - smoothRamp(Math.hypot(x - MOUND_CENTER[0], z - MOUND_CENTER[1]), moundRun(), MOUND_EASE));
  h += forestRise(x, z);
  const cliffDepth = -cliffSignedDistance(x, z);
  const cliff = smoothstep(-CLIFF_FACE_OUT, CLIFF_FACE_IN, cliffDepth);
  if (cliff > 0) h += (cliffTopHeight(x, z, cliffDepth) - h) * cliff;

  // 강을 깎는다. 여울 구간은 바닥을 수면 높이로 올리고 둑을 길게 깎는다.
  const d = riverDistance(x, z);
  const ford =
    1 - smoothstep(FORD_HALF_LENGTH, FORD_HALF_LENGTH + FORD_EDGE_BLEND, Math.abs(x - FORD_X));
  if (d <= RIVER_HALF_WIDTH) {
    const deep =
      RIVER_BED + (WATER_LEVEL - RIVER_BED) * smoothstep(RIVER_BED_HALF_WIDTH, RIVER_HALF_WIDTH, d);
    h = deep + (FORD_BED - deep) * ford;
  } else {
    const bankWidth = RIVER_BANK_WIDTH + (FORD_BANK_WIDTH - RIVER_BANK_WIDTH) * ford;
    const bankStart = WATER_LEVEL + (FORD_BED - WATER_LEVEL) * ford;
    const t = smoothstep(RIVER_HALF_WIDTH, RIVER_HALF_WIDTH + bankWidth, d);
    h = bankStart + (h - bankStart) * t;
  }

  // 다리: 다리 사각형은 둑 높이로 평평하게, 양 끝 땅은 다리 높이로 이어지게 맞춘다.
  for (const b of bridges) {
    const ox = Math.abs(x - b.x) - BRIDGE_HALF_WIDTH;
    const oz = Math.abs(z - b.z) - BRIDGE_HALF_LENGTH;
    if (ox <= 0 && oz <= 0) return BRIDGE_DECK;
    const outside = Math.hypot(Math.max(ox, 0), Math.max(oz, 0));
    if (outside < BRIDGE_APPROACH) {
      // 물 위(다리 옆)는 올리지 않는다. 둑에서 서서히 올린다.
      const land = smoothstep(RIVER_HALF_WIDTH, RIVER_HALF_WIDTH + 6, d);
      const w = (1 - smoothstep(0, BRIDGE_APPROACH, outside)) * land;
      h += (BRIDGE_DECK - h) * w;
    }
  }
  return h;
}

function cellType(x: number, z: number, bridges: readonly MapCrossing[]): number {
  const d = riverDistance(x, z);
  for (const b of bridges) {
    if (Math.abs(x - b.x) < BRIDGE_HALF_WIDTH && Math.abs(z - b.z) < BRIDGE_HALF_LENGTH) {
      return d <= RIVER_HALF_WIDTH + BRIDGE_TYPE_OVERHANG ? TerrainType.Bridge : TerrainType.Sand;
    }
  }
  if (d <= RIVER_HALF_WIDTH) {
    return Math.abs(x - FORD_X) < FORD_HALF_LENGTH ? TerrainType.Ford : TerrainType.Water;
  }
  if (cliffSignedDistance(x, z) <= 0) return TerrainType.Rock;
  if (forestSignedDistance(x, z) < 0) return TerrainType.Forest;
  if (roadDistance(x, z) <= ROAD_HALF_WIDTH) return TerrainType.Sand;
  return TerrainType.Grass;
}

/** type 칸이 상하좌우로 이어진 조각 중 MIN_PATCH_CELLS 보다 작은 것을 평지로 바꾼다. */
function removeSmallPatches(types: Uint8Array, type: number): void {
  const seen = new Uint8Array(types.length);
  const patch: number[] = [];
  for (let start = 0; start < types.length; start++) {
    if (seen[start] || types[start] !== type) continue;
    patch.length = 0;
    patch.push(start);
    seen[start] = 1;
    for (let k = 0; k < patch.length; k++) {
      const c = patch[k];
      const iz = Math.floor(c / CELLS);
      const ix = c - iz * CELLS;
      const neighbors = [
        ix > 0 ? c - 1 : -1,
        ix < CELLS - 1 ? c + 1 : -1,
        iz > 0 ? c - CELLS : -1,
        iz < CELLS - 1 ? c + CELLS : -1,
      ];
      for (const n of neighbors) {
        if (n < 0 || seen[n] || types[n] !== type) continue;
        seen[n] = 1;
        patch.push(n);
      }
    }
    if (patch.length < MIN_PATCH_CELLS) for (const c of patch) types[c] = TerrainType.Grass;
  }
}

// ------------------------------------------------------------------ 요소별 모양

/** 능선: 마루선에서 북쪽은 12°, 남쪽은 6° 경사. 서쪽 끝(x 큰 쪽)은 평지로 낮아진다. */
function ridgeHeight(x: number, z: number): number {
  const [x0, z0] = RIDGE_CREST_START;
  const [x1, z1] = RIDGE_CREST_END;
  const crestZ = z0 + ((z1 - z0) * (x - x0)) / (x1 - x0);
  const dz = z - crestZ;
  const frac =
    dz >= 0
      ? smoothRamp(dz, RIDGE_RISE / Math.tan(RIDGE_FRONT_SLOPE_DEG * DEG), RIDGE_FRONT_EASE)
      : smoothRamp(-dz, RIDGE_RISE / Math.tan(RIDGE_BACK_SLOPE_DEG * DEG), RIDGE_BACK_EASE);
  const taper = 1 - smoothstep(RIDGE_WEST_TAPER[0], RIDGE_WEST_TAPER[1], x);
  return RIDGE_RISE * (1 - frac) * taper;
}

function moundRun(): number {
  return MOUND_RISE / Math.tan(MOUND_SLOPE_DEG * DEG);
}

/** 동쪽 벼랑 경계까지의 부호 있는 거리(안쪽 음수). 외곽선은 노이즈로 흔든다. */
function cliffSignedDistance(x: number, z: number): number {
  return rectSignedDistance(x, z, CLIFF_RECT) + edgeWobble(x, z, 3);
}

/** 벼랑 고원 윗면 높이: 안쪽으로 갈수록 오르고, 능형 노이즈로 바위 등성이와 골을 만든다. */
function cliffTopHeight(x: number, z: number, depth: number): number {
  const ridged = 1 - Math.abs(2 * noise(x, z, 70, 5) - 1);
  return (
    CLIFF_EDGE_HEIGHT +
    CLIFF_INNER_RISE * smoothstep(0, CLIFF_RISE_DEPTH, depth) +
    CLIFF_RIDGED_AMP * (ridged - 0.5) * 2 +
    CLIFF_ROUGH_AMP * (2 * noise(x, z, 12, 9) - 1)
  );
}

/** 숲 경계까지의 부호 있는 거리(안쪽 음수). 외곽선은 노이즈로 흔든다. */
function forestSignedDistance(x: number, z: number): number {
  return rectSignedDistance(x, z, FOREST_RECT) + edgeWobble(x, z, 7);
}

function rectSignedDistance(
  x: number,
  z: number,
  r: { minX: number; maxX: number; minZ: number; maxZ: number },
): number {
  // 모서리 반경만큼 줄인 사각형까지의 거리 − 반경 = 둥근 모서리 사각형
  const dx = Math.max(r.minX - x, x - r.maxX) + EDGE_CORNER_RADIUS;
  const dz = Math.max(r.minZ - z, z - r.maxZ) + EDGE_CORNER_RADIUS;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
  return (outside > 0 ? outside : Math.max(dx, dz)) - EDGE_CORNER_RADIUS;
}

/** 외곽선을 안팎으로 미는 거리(m). tanh 로 눌러 ±EDGE_WOBBLE_MAX 를 넘지 않고, 잘린 곳이 직선이 되지 않는다. */
function edgeWobble(x: number, z: number, seedOffset: number): number {
  const w =
    EDGE_WOBBLE_LARGE.amp * (noise(x, z, EDGE_WOBBLE_LARGE.scale, seedOffset) - 0.5) +
    EDGE_WOBBLE_SMALL.amp * (noise(x, z, EDGE_WOBBLE_SMALL.scale, seedOffset + 50) - 0.5);
  return EDGE_WOBBLE_MAX * Math.tanh(w / EDGE_WOBBLE_MAX);
}

function forestRise(x: number, z: number): number {
  const sd = forestSignedDistance(x, z);
  if (sd >= 0) return 0;
  return FOREST_RISE * noise(x, z, 60, 11) * smoothstep(0, FOREST_RISE_EDGE, -sd);
}

function roadDistance(x: number, z: number): number {
  let best = Infinity;
  for (const road of ROADS) {
    for (let i = 0; i + 1 < road.length; i++) {
      const d = segmentDistance(x, z, road[i][0], road[i][1], road[i + 1][0], road[i + 1][1]);
      if (d < best) best = d;
    }
  }
  return best;
}

// ------------------------------------------------------------------ 강 중심선

/** 강 중심선 z(x): 제어점을 지나는 3차 에르미트 곡선. */
function riverCenterZ(x: number): number {
  const i = riverSegment(x);
  const [x0, z0] = RIVER_CENTERLINE[i];
  const [x1, z1] = RIVER_CENTERLINE[i + 1];
  const h = x1 - x0;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * z0 +
    (t3 - 2 * t2 + t) * h * riverTangent(i) +
    (-2 * t3 + 3 * t2) * z1 +
    (t3 - t2) * h * riverTangent(i + 1)
  );
}

function riverCenterSlope(x: number): number {
  const e = 0.5;
  return (riverCenterZ(x + e) - riverCenterZ(x - e)) / (2 * e);
}

/** 강 중심선까지의 거리(m). 곡선이 완만해 수직 거리를 기울기로 보정해 쓴다. */
function riverDistance(x: number, z: number): number {
  const s = riverCenterSlope(x);
  return Math.abs(z - riverCenterZ(x)) / Math.sqrt(1 + s * s);
}

function riverSegment(x: number): number {
  const last = RIVER_CENTERLINE.length - 2;
  for (let i = 0; i < last; i++) if (x < RIVER_CENTERLINE[i + 1][0]) return i;
  return last;
}

function riverTangent(i: number): number {
  const p = RIVER_CENTERLINE;
  const a = p[Math.max(0, i - 1)];
  const b = p[Math.min(p.length - 1, i + 1)];
  return (b[1] - a[1]) / (b[0] - a[0]);
}

// ------------------------------------------------------------------ 보조 함수

/**
 * 0에서 시작해 len + ease 거리에서 1이 되는 비율. 가운데 구간의 기울기는 정확히 1/len 이고
 * 양 끝 ease 구간은 2차 곡선으로 둥글게 이어진다(능선 마루와 기슭이 칼날처럼 꺾이지 않게).
 */
function smoothRamp(d: number, len: number, ease: number): number {
  if (d <= 0) return 0;
  const m = 1 / len;
  const total = len + ease;
  if (d < ease) return (m * d * d) / (2 * ease);
  if (d <= len) return m * (d - ease / 2);
  if (d < total) return 1 - (m * (total - d) * (total - d)) / (2 * ease);
  return 1;
}

/** [0, 1] 값 노이즈. scale = 노이즈 한 주기의 길이(m). */
function noise(x: number, z: number, scale: number, seedOffset: number): number {
  return fbm(x / scale, z / scale, NOISE_SEED + seedOffset, 4);
}

function segmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function evenRound(v: number): number {
  return Math.round(v / 2) * 2;
}

/** 맵 한 변 길이(m). */
export const REED_FORD_SIZE = SIZE;
