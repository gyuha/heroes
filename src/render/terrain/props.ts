import {
  BoxGeometry,
  type BufferGeometry,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';
import type { GameMap } from '../../sim/map/gameMap';
import { Rng } from '../../sim/rng';
import { TerrainType } from '../../sim/terrain';

/** 숲 칸 하나(2m × 2m)에 나무가 설 확률. 1그루 / 약 45㎡ */
const TREE_CHANCE_PER_CELL = 0.09;
/** 나무 높이(m). 검은숲 시야 장애물 12m(GDD §6.1)와 비슷하게 보이게 한다. */
const TREE_HEIGHT_RANGE: readonly [number, number] = [10, 14];
const CONIFER_SHARE = 0.55;
/** 바위 칸에 바위 소품이 놓일 확률과 크기 배율. */
const BOULDER_CHANCE_PER_CELL = 0.025;
const BOULDER_SCALE_RANGE: readonly [number, number] = [2, 5];
/** 소품 밑동을 지면 아래로 묻는 깊이(m). 경사에서 뜨지 않게 한다. */
const PROP_SINK = 0.3;
/** 다리 모델이 없을 때 쓰는 임시 상자의 두께(m). 통행면이 맨 위(Y=0)다. */
const PLACEHOLDER_DECK_THICKNESS = 1.2;
const PLACEHOLDER_COLOR = 0x8a6a4a;

export interface PropModel {
  geometry: BufferGeometry;
  material: Material;
  /** 모델 높이(m). 원하는 높이로 크기를 맞출 때 쓴다. */
  height: number;
}

export interface PropModels {
  conifer: PropModel | null;
  broadleaf: PropModel | null;
  boulder: PropModel | null;
  /** 다리 모델(통행면 로컬 Y=0, +Z 길이 방향). null 이면 임시 상자 */
  bridge: Object3D | null;
}

/** 숲 칸에 나무, 바위 칸에 바위를 인스턴싱으로 흩뿌리고 다리를 놓는다. 같은 propSeed 면 같은 배치다. */
export function createProps(map: GameMap, models: PropModels): Group {
  const group = new Group();
  group.name = 'terrain_props';
  const t = map.terrain;
  const rng = new Rng(map.meta.propSeed);

  const conifers: number[] = [];
  const broadleaves: number[] = [];
  const boulders: number[] = [];
  for (let iz = 0; iz < t.cellsZ; iz++) {
    for (let ix = 0; ix < t.cellsX; ix++) {
      const type = t.types[iz * t.cellsX + ix];
      if (type === TerrainType.Forest) {
        if (rng.next() >= TREE_CHANCE_PER_CELL) continue;
        const x = (ix + rng.next()) * t.cellSize;
        const z = (iz + rng.next()) * t.cellSize;
        const list = rng.next() < CONIFER_SHARE ? conifers : broadleaves;
        list.push(
          x,
          z,
          rng.range(TREE_HEIGHT_RANGE[0], TREE_HEIGHT_RANGE[1]),
          rng.range(0, Math.PI * 2),
        );
      } else if (type === TerrainType.Rock) {
        if (rng.next() >= BOULDER_CHANCE_PER_CELL) continue;
        const x = (ix + rng.next()) * t.cellSize;
        const z = (iz + rng.next()) * t.cellSize;
        boulders.push(
          x,
          z,
          rng.range(BOULDER_SCALE_RANGE[0], BOULDER_SCALE_RANGE[1]),
          rng.range(0, Math.PI * 2),
        );
      }
    }
  }

  const add = (model: PropModel | null, data: number[], name: string, sizeIsHeight: boolean) => {
    if (!model || data.length === 0) return;
    const count = data.length / 4;
    const mesh = new InstancedMesh(model.geometry, model.material, count);
    mesh.name = name;
    const m = new Matrix4();
    const q = new Quaternion();
    const pos = new Vector3();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const x = data[i * 4];
      const z = data[i * 4 + 1];
      const size = data[i * 4 + 2];
      const s = sizeIsHeight ? size / model.height : size;
      pos.set(x, t.heightAt(x, z) - PROP_SINK, z);
      q.setFromAxisAngle(up, data[i * 4 + 3]);
      scale.set(s, s, s);
      mesh.setMatrixAt(i, m.compose(pos, q, scale));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };
  add(models.conifer, conifers, 'conifers', true);
  add(models.broadleaf, broadleaves, 'broadleaves', true);
  add(models.boulder, boulders, 'boulders', false);

  for (const b of map.meta.bridges) {
    const bridge = models.bridge ? models.bridge.clone() : bridgePlaceholder(b.width, b.length);
    bridge.position.set(b.x, t.heightAt(b.x, b.z), b.z);
    bridge.rotation.y = b.heading;
    group.add(bridge);
  }
  return group;
}

/** 다리 모델을 읽지 못했을 때의 임시 상자. 통행면이 로컬 Y=0이다. */
function bridgePlaceholder(width: number, length: number): Mesh {
  const geometry = new BoxGeometry(width, PLACEHOLDER_DECK_THICKNESS, length);
  geometry.translate(0, -PLACEHOLDER_DECK_THICKNESS / 2, 0);
  const mesh = new Mesh(geometry, new MeshLambertMaterial({ color: PLACEHOLDER_COLOR }));
  mesh.name = 'bridge_placeholder';
  return mesh;
}
