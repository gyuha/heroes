import { BufferAttribute, BufferGeometry, Mesh, MeshPhongMaterial } from 'three';
import type { GameMap } from '../../sim/map/gameMap';
import { TerrainType } from '../../sim/terrain';

/** 깊은 강 수면 색(아트 제안, 불투명). */
const WATER_COLOR = 0x315869;
const WATER_SPECULAR = 0x2a3a40;
const WATER_SHININESS = 40;

/**
 * 강 수면. 깊은 물·다리 칸과 그 둘레 1칸에만 waterLevel 높이의 사각형을 깐다.
 * 여울 칸은 빼서 수면 없이 바닥 텍스처가 보이게 한다. 둑과 높이가 거의 같은 곳에서 깜빡이지 않도록
 * polygonOffset 으로 수면을 지형 뒤로 민다.
 */
export function createWaterSurface(map: GameMap): Mesh | null {
  const t = map.terrain;
  const { cellsX, cellsZ, cellSize } = t;
  const y = map.meta.waterLevel;
  const covered = new Uint8Array(cellsX * cellsZ);
  let count = 0;
  for (let iz = 0; iz < cellsZ; iz++) {
    for (let ix = 0; ix < cellsX; ix++) {
      if (!isRiver(t.types[iz * cellsX + ix])) continue;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = ix + dx;
          const cz = iz + dz;
          if (cx < 0 || cz < 0 || cx >= cellsX || cz >= cellsZ) continue;
          const i = cz * cellsX + cx;
          if (covered[i] || t.types[i] === TerrainType.Ford) continue;
          covered[i] = 1;
          count++;
        }
      }
    }
  }
  if (count === 0) return null;

  const positions = new Float32Array(count * 4 * 3);
  const index = new Uint32Array(count * 6);
  let q = 0;
  for (let iz = 0; iz < cellsZ; iz++) {
    for (let ix = 0; ix < cellsX; ix++) {
      if (!covered[iz * cellsX + ix]) continue;
      const x0 = ix * cellSize;
      const z0 = iz * cellSize;
      const p = q * 12;
      positions.set(
        [x0, y, z0, x0 + cellSize, y, z0, x0, y, z0 + cellSize, x0 + cellSize, y, z0 + cellSize],
        p,
      );
      const v = q * 4;
      index.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], q * 6);
      q++;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const normals = new Float32Array(count * 4 * 3);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingSphere();

  const material = new MeshPhongMaterial({
    color: WATER_COLOR,
    specular: WATER_SPECULAR,
    shininess: WATER_SHININESS,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 4,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'river_surface';
  return mesh;
}

function isRiver(type: number): boolean {
  return type === TerrainType.Water || type === TerrainType.Bridge;
}
