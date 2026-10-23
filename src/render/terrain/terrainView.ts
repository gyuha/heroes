import {
  Group,
  Mesh,
  type Object3D,
  type Ray,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  type Vector3,
} from 'three';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GameMap } from '../../sim/map/gameMap';
import type { Terrain } from '../../sim/terrain';
import { createProps, type PropModel, type PropModels } from './props';
import { createTerrainSurface, type SurfaceTextures } from './terrainSurface';
import { createWaterSurface } from './water';

const TERRAIN_TEXTURE_DIR = 'assets/terrain/';
const PROP_DIR = 'assets/props/';
const TEXTURE_ANISOTROPY = 8;
/** 지면 레이 교차: 진행 간격(m)과 최대 거리(m). */
const PICK_STEP = 2;
const PICK_MAX_DISTANCE = 4000;
const PICK_REFINE_STEPS = 12;

export interface TerrainView {
  /** 지형 + 강 수면 + 나무·바위 + 다리. scene.add(view.group) */
  readonly group: Group;
  /** 지형 메시. 다리 밑 정점은 강바닥 쪽으로 내려 그렸으므로 정확한 지면 좌표는 intersectTerrain 을 쓴다. */
  readonly terrainMesh: Mesh;
  dispose(): void;
}

/**
 * 맵 하나의 지형 장면을 만든다. 텍스처와 소품 GLB를 모두 읽은 뒤 끝난다.
 * 텍스처가 하나라도 없으면 reject(경로와 원인). 소품·다리 모델이 없으면 그것만 빼거나 임시 상자로 바꾸고 경고한다.
 */
export async function createTerrainView(map: GameMap): Promise<TerrainView> {
  const base = import.meta.env.BASE_URL;
  const [textures, models] = await Promise.all([
    loadSurfaceTextures(base + TERRAIN_TEXTURE_DIR),
    loadPropModels(base + PROP_DIR),
  ]);

  const group = new Group();
  group.name = `terrain_${map.meta.id}`;
  const terrainMesh = createTerrainSurface(map, textures);
  group.add(terrainMesh);
  const water = createWaterSurface(map);
  if (water) group.add(water);
  group.add(createProps(map, models));

  return {
    group,
    terrainMesh,
    dispose() {
      group.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.geometry.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of materials) m.dispose();
      });
      for (const tex of Object.values(textures)) tex.dispose();
    },
  };
}

/**
 * 시뮬레이션 지면(Terrain.heightAt)과 광선의 교점. 다리 위에서도 통행면 높이를 돌려준다.
 * 2m 간격으로 진행해 지면 아래로 들어간 구간을 이분법으로 좁힌다. 교점이 없으면 false.
 */
export function intersectTerrain(terrain: Terrain, ray: Ray, out: Vector3): boolean {
  const o = ray.origin;
  const d = ray.direction;
  let prevT = 0;
  let prevAbove = o.y - terrain.heightAt(o.x, o.z);
  if (prevAbove < 0) return false;
  for (let t = PICK_STEP; t <= PICK_MAX_DISTANCE; t += PICK_STEP) {
    const x = o.x + d.x * t;
    const z = o.z + d.z * t;
    const above = o.y + d.y * t - terrain.heightAt(x, z);
    if (above <= 0) {
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < PICK_REFINE_STEPS; i++) {
        const mid = (lo + hi) / 2;
        const m = o.y + d.y * mid - terrain.heightAt(o.x + d.x * mid, o.z + d.z * mid);
        if (m > 0) lo = mid;
        else hi = mid;
      }
      out.set(o.x + d.x * hi, 0, o.z + d.z * hi);
      out.y = terrain.heightAt(out.x, out.z);
      return terrain.contains(out.x, out.z);
    }
    if (d.y >= 0 && above > prevAbove) return false; // 위로 멀어지는 중
    prevT = t;
    prevAbove = above;
  }
  return false;
}

async function loadSurfaceTextures(dir: string): Promise<SurfaceTextures> {
  const loader = new TextureLoader();
  const load = async (name: string): Promise<Texture> => {
    const url = `${dir}${name}_albedo.png`;
    try {
      const tex = await loader.loadAsync(url);
      tex.colorSpace = SRGBColorSpace;
      tex.wrapS = RepeatWrapping;
      tex.wrapT = RepeatWrapping;
      tex.anisotropy = TEXTURE_ANISOTROPY;
      return tex;
    } catch (err) {
      throw new Error(`지형 텍스처를 읽지 못했다: ${url} (${String(err)})`);
    }
  };
  const [grass, forest, rock, sand, water, ford] = await Promise.all(
    ['grass', 'forest', 'rock', 'sand', 'water', 'ford'].map(load),
  );
  return { grass, forest, rock, sand, water, ford };
}

async function loadPropModels(dir: string): Promise<PropModels> {
  const loader = new GLTFLoader();
  const load = async (name: string): Promise<GLTF | null> => {
    const url = `${dir}${name}.glb`;
    try {
      return await loader.loadAsync(url);
    } catch (err) {
      console.warn(`[terrain] 소품을 읽지 못해 뺀다: ${url}`, err);
      return null;
    }
  };
  const [conifer, broadleaf, boulder, bridge] = await Promise.all(
    ['conifer', 'broadleaf', 'boulder', 'bridge'].map(load),
  );
  if (!bridge) console.warn('[terrain] bridge.glb 대신 임시 상자(bridge_placeholder)를 쓴다');
  return {
    conifer: toPropModel(conifer),
    broadleaf: toPropModel(broadleaf),
    boulder: toPropModel(boulder),
    bridge: bridge ? bridge.scene : null,
  };
}

/** 단일 메시 GLB(ARCHITECTURE §7.3) → 인스턴싱용 지오메트리·머티리얼. */
function toPropModel(gltf: GLTF | null): PropModel | null {
  if (!gltf) return null;
  let mesh: Mesh | null = null;
  gltf.scene.traverse((o: Object3D) => {
    if (!mesh && o instanceof Mesh) mesh = o;
  });
  if (!mesh) return null;
  const { geometry, material } = mesh as Mesh;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  return {
    geometry,
    material: Array.isArray(material) ? material[0] : material,
    height: box.max.y - Math.min(0, box.min.y),
  };
}
