/**
 * 맵 파일(docs/ARCHITECTURE.md §11.1)과 GameMap. 바이트 ↔ Terrain 변환만 하는 순수 코드다.
 * fetch 는 app 계층이 하고 결과 바이트를 parseMap 에 넘긴다.
 */
import type { TeamId } from '../api';
import { Terrain, TerrainType } from '../terrain';

export const MAP_FORMAT = 1;
const U16_MAX = 65535;
const MAX_TYPE_ID = TerrainType.Bridge;

/** [minX, minZ, maxX, maxZ] (m) */
export type MapRectTuple = [number, number, number, number];

export interface MapRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** 다리·여울 배치. heading(라디안, 0 = +Z)은 건너는 방향, length 는 그 방향 길이, width 는 폭(m). */
export interface MapCrossing {
  x: number;
  z: number;
  heading: number;
  length: number;
  width: number;
}

export interface MapObjective {
  type: 'flag';
  x: number;
  z: number;
  radius: number;
}

/** public/maps/<id>/map.json 의 내용. */
export interface MapMeta {
  format: number;
  id: string;
  /** 표시 이름 */
  name: string;
  cellSize: number;
  cellsX: number;
  cellsZ: number;
  /** height.u16 값 0, 65535 가 뜻하는 높이(m) */
  heightMin: number;
  heightMax: number;
  /** 강 수면 높이(m). 렌더 전용 */
  waterLevel: number;
  /** 맵 가장자리 통과 불가 폭(m) */
  boundaryMargin: number;
  /** 나무·바위 배치 시드. 렌더 전용 */
  propSeed: number;
  bridges: MapCrossing[];
  fords: MapCrossing[];
  objectives: MapObjective[];
  deployZones: { defender: MapRectTuple; attacker: MapRectTuple };
}

/** 지형과 맵 메타데이터. 시뮬레이션·렌더·UI가 같은 객체를 읽는다. */
export class GameMap {
  constructor(
    readonly meta: MapMeta,
    readonly terrain: Terrain,
  ) {}

  /** 가장자리 경계(boundaryMargin) 안쪽인가. 경계는 패주 부대만 들어갈 수 있다(GDD §10.1). */
  inPlayArea(x: number, z: number): boolean {
    const m = this.meta.boundaryMargin;
    return x >= m && z >= m && x <= this.terrain.width - m && z <= this.terrain.depth - m;
  }

  /** 배치 구역. team 0 = 방어(청람), 1 = 공격(황토). */
  deploymentZone(team: TeamId): MapRect {
    const r = team === 0 ? this.meta.deployZones.defender : this.meta.deployZones.attacker;
    return { minX: r[0], minZ: r[1], maxX: r[2], maxZ: r[3] };
  }

  /** 깃발 목표. 없으면 null. */
  flag(): MapObjective | null {
    return this.meta.objectives.find((o) => o.type === 'flag') ?? null;
  }
}

/**
 * map.json + height.u16 + types.u8 → GameMap. 두 파일은 첫 행이 북쪽(z 최대)이므로 행을 뒤집어 넣는다.
 * 형식이 맞지 않으면 파일 이름과 기대 값을 담은 Error 를 던진다.
 */
export function parseMap(meta: unknown, height: ArrayBuffer, types: ArrayBuffer): GameMap {
  const m = validateMeta(meta);
  const vx = m.cellsX + 1;
  const vz = m.cellsZ + 1;
  const expectHeight = vx * vz * 2;
  if (height.byteLength !== expectHeight) {
    throw new Error(
      `${m.id}/height.u16: 길이 ${height.byteLength}바이트, 기대 ${expectHeight}바이트 ((cellsX+1)×(cellsZ+1)×2)`,
    );
  }
  const expectTypes = m.cellsX * m.cellsZ;
  if (types.byteLength !== expectTypes) {
    throw new Error(
      `${m.id}/types.u8: 길이 ${types.byteLength}바이트, 기대 ${expectTypes}바이트 (cellsX×cellsZ)`,
    );
  }

  const heights = new Float32Array(vx * vz);
  const view = new DataView(height);
  const scale = (m.heightMax - m.heightMin) / U16_MAX;
  for (let r = 0; r < vz; r++) {
    const iz = m.cellsZ - r;
    for (let c = 0; c < vx; c++) {
      heights[iz * vx + c] = m.heightMin + view.getUint16((r * vx + c) * 2, true) * scale;
    }
  }

  const src = new Uint8Array(types);
  const cells = new Uint8Array(expectTypes);
  for (let r = 0; r < m.cellsZ; r++) {
    const iz = m.cellsZ - 1 - r;
    for (let c = 0; c < m.cellsX; c++) {
      const t = src[r * m.cellsX + c];
      if (t > MAX_TYPE_ID) {
        throw new Error(
          `${m.id}/types.u8: 행 ${r} 열 ${c}의 지형 종류 ${t}는 없는 ID다(0~${MAX_TYPE_ID})`,
        );
      }
      cells[iz * m.cellsX + c] = t;
    }
  }

  return new GameMap(m, new Terrain(m.cellsX, m.cellsZ, m.cellSize, heights, cells));
}

/** GameMap → 파일 바이트(parseMap 의 역). 생성 도구(tools/map)가 쓴다. */
export function encodeMap(map: GameMap): { meta: MapMeta; height: Uint8Array; types: Uint8Array } {
  const { meta, terrain } = map;
  const vx = meta.cellsX + 1;
  const vz = meta.cellsZ + 1;
  const height = new Uint8Array(vx * vz * 2);
  const view = new DataView(height.buffer);
  const range = meta.heightMax - meta.heightMin;
  for (let r = 0; r < vz; r++) {
    const iz = meta.cellsZ - r;
    for (let c = 0; c < vx; c++) {
      const h = terrain.heights[iz * vx + c];
      const v = Math.round(((h - meta.heightMin) / range) * U16_MAX);
      view.setUint16((r * vx + c) * 2, v < 0 ? 0 : v > U16_MAX ? U16_MAX : v, true);
    }
  }
  const types = new Uint8Array(meta.cellsX * meta.cellsZ);
  for (let r = 0; r < meta.cellsZ; r++) {
    const iz = meta.cellsZ - 1 - r;
    types.set(terrain.types.subarray(iz * meta.cellsX, (iz + 1) * meta.cellsX), r * meta.cellsX);
  }
  return { meta, height, types };
}

function validateMeta(raw: unknown): MapMeta {
  if (typeof raw !== 'object' || raw === null) throw new Error('map.json: 객체가 아니다');
  const m = raw as Partial<MapMeta>;
  const id = typeof m.id === 'string' ? m.id : '(id 없음)';
  if (m.format !== MAP_FORMAT) {
    throw new Error(
      `${id}/map.json: format ${String(m.format)}는 지원하지 않는다(기대 ${MAP_FORMAT})`,
    );
  }
  for (const key of [
    'cellSize',
    'cellsX',
    'cellsZ',
    'heightMin',
    'heightMax',
    'waterLevel',
    'boundaryMargin',
  ] as const) {
    if (typeof m[key] !== 'number' || !Number.isFinite(m[key])) {
      throw new Error(`${id}/map.json: ${key}가 숫자가 아니다`);
    }
  }
  if (!(m.heightMax! > m.heightMin!)) throw new Error(`${id}/map.json: heightMax ≤ heightMin`);
  if (!m.deployZones) throw new Error(`${id}/map.json: deployZones 가 없다`);
  return {
    ...(m as MapMeta),
    name: m.name ?? id,
    propSeed: m.propSeed ?? 1,
    bridges: m.bridges ?? [],
    fords: m.fords ?? [],
    objectives: m.objectives ?? [],
  };
}
