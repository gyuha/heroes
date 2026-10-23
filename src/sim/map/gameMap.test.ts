import { describe, expect, it } from 'vitest';
import { Terrain, TerrainType } from '../terrain';
import { encodeMap, GameMap, MAP_FORMAT, type MapMeta, parseMap } from './gameMap';

function meta(overrides: Partial<MapMeta> = {}): MapMeta {
  return {
    format: MAP_FORMAT,
    id: 'test',
    name: '테스트',
    cellSize: 2,
    cellsX: 2,
    cellsZ: 2,
    heightMin: 0,
    heightMax: 64,
    waterLevel: 7,
    boundaryMargin: 1,
    propSeed: 1,
    bridges: [],
    fords: [],
    objectives: [{ type: 'flag', x: 2, z: 2, radius: 1 }],
    deployZones: { defender: [0, 0, 4, 1], attacker: [0, 3, 4, 4] },
    ...overrides,
  };
}

/** 3×3 정점(LE u16)과 2×2 칸 바이트를 파일 순서(첫 행 = 북쪽)로 만든다. */
function files(heightRows: number[][], typeRows: number[][]): [ArrayBuffer, ArrayBuffer] {
  const h = new DataView(new ArrayBuffer(9 * 2));
  heightRows.flat().forEach((v, i) => h.setUint16(i * 2, v, true));
  return [h.buffer, new Uint8Array(typeRows.flat()).buffer];
}

describe('parseMap', () => {
  it('파일 첫 행 첫 값은 모서리 (x = 0, z = depth)의 높이다(D-012로 x = 0은 동쪽 끝)', () => {
    const [h, t] = files(
      [
        [65535, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      [
        [TerrainType.Forest, 0],
        [0, TerrainType.Water],
      ],
    );
    const map = parseMap(meta(), h, t);
    expect(map.terrain.heightAt(0, 4)).toBeCloseTo(64);
    expect(map.terrain.heightAt(0, 0)).toBe(0);
    // 종류도 첫 행 = 북쪽: (x 작음, z 큼) 칸이 숲, (x 큼, z 작음) 칸이 물
    expect(map.terrain.typeAt(1, 3)).toBe(TerrainType.Forest);
    expect(map.terrain.typeAt(3, 1)).toBe(TerrainType.Water);
    expect(map.terrain.typeAt(1, 1)).toBe(TerrainType.Grass);
  });

  it('heightMin/Max 로 u16 값을 높이로 바꾼다', () => {
    const [h, t] = files(
      [
        [0, 32768, 65535],
        [0, 0, 0],
        [0, 0, 0],
      ],
      [
        [0, 0],
        [0, 0],
      ],
    );
    const map = parseMap(meta({ heightMin: -10, heightMax: 30 }), h, t);
    expect(map.terrain.heightAt(0, 4)).toBeCloseTo(-10, 4);
    expect(map.terrain.heightAt(2, 4)).toBeCloseTo(-10 + (40 * 32768) / 65535, 4);
    expect(map.terrain.heightAt(4, 4)).toBeCloseTo(30, 4);
  });

  it('길이가 맞지 않으면 파일 이름과 기대 길이를 담은 오류', () => {
    const [h, t] = files(
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      [
        [0, 0],
        [0, 0],
      ],
    );
    expect(() => parseMap(meta(), h.slice(2), t)).toThrow(/height\.u16.*16바이트.*기대 18바이트/);
    expect(() => parseMap(meta(), h, t.slice(1))).toThrow(/types\.u8.*3바이트.*기대 4바이트/);
  });

  it('모르는 형식 버전과 없는 지형 ID는 오류', () => {
    const [h, t] = files(
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      [
        [0, 0],
        [0, 9],
      ],
    );
    expect(() => parseMap(meta({ format: 2 }), h, t)).toThrow(/format 2/);
    expect(() => parseMap(meta(), h, t)).toThrow(/지형 종류 9/);
  });

  it('encodeMap → parseMap 왕복은 높이(1mm 이내)와 종류를 보존한다', () => {
    const heights = new Float32Array([0, 1.5, 3, 10, 20.25, 30, 40, 50, 63.9]);
    const types = new Uint8Array([0, 1, 5, 6]);
    const original = new GameMap(meta(), new Terrain(2, 2, 2, heights, types));
    const enc = encodeMap(original);
    const back = parseMap(
      JSON.parse(JSON.stringify(enc.meta)),
      enc.height.slice().buffer,
      enc.types.slice().buffer,
    );
    for (let i = 0; i < heights.length; i++) {
      expect(Math.abs(back.terrain.heights[i] - heights[i])).toBeLessThan(0.001);
    }
    expect(Array.from(back.terrain.types)).toEqual(Array.from(types));
  });
});

describe('GameMap', () => {
  it('경계 안쪽, 배치 구역, 깃발', () => {
    const map = new GameMap(meta(), new Terrain(2, 2, 2, new Float32Array(9), new Uint8Array(4)));
    expect(map.inPlayArea(2, 2)).toBe(true);
    expect(map.inPlayArea(0.5, 2)).toBe(false);
    expect(map.inPlayArea(2, 3.5)).toBe(false);
    expect(map.deploymentZone(1)).toEqual({ minX: 0, minZ: 3, maxX: 4, maxZ: 4 });
    expect(map.flag()).toEqual({ type: 'flag', x: 2, z: 2, radius: 1 });
  });
});
