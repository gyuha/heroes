import { BufferAttribute, BufferGeometry, Color, Mesh, MeshLambertMaterial } from 'three';
import { type Terrain, TerrainType } from '../sim/terrain';

// 임시 지형 색. 아트 디렉터의 지형 텍스처(public/assets/terrain/)가 오면 텍스처 스플래팅으로 바꾼다.
const TYPE_COLORS: Record<number, Color> = {
  [TerrainType.Grass]: new Color(0x6f8f3e),
  [TerrainType.Forest]: new Color(0x3d5e2a),
  [TerrainType.Rock]: new Color(0x857d72),
  [TerrainType.Sand]: new Color(0xc2b07a),
  [TerrainType.Water]: new Color(0x3f6f8f),
};

/**
 * 시뮬레이션 지형 데이터로 메시를 만든다. 칸을 나누는 대각선 방향은 Terrain.heightAt 과 같아야
 * 병사 발이 화면의 지면과 맞는다: 삼각형 (v00, v01, v10), (v10, v01, v11).
 */
export function createTerrainMesh(terrain: Terrain): Mesh {
  const { cellsX, cellsZ, cellSize } = terrain;
  const vx = cellsX + 1;
  const vz = cellsZ + 1;
  const positions = new Float32Array(vx * vz * 3);
  const colors = new Float32Array(vx * vz * 3);

  for (let iz = 0; iz < vz; iz++) {
    for (let ix = 0; ix < vx; ix++) {
      const v = iz * vx + ix;
      positions[v * 3] = ix * cellSize;
      positions[v * 3 + 1] = terrain.vertexHeight(ix, iz);
      positions[v * 3 + 2] = iz * cellSize;
      const color = TYPE_COLORS[terrain.typeAt(ix * cellSize, iz * cellSize)];
      colors[v * 3] = color.r;
      colors[v * 3 + 1] = color.g;
      colors[v * 3 + 2] = color.b;
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
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true }));
}
