import { type PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { intersectTerrain } from '../../render/terrain/terrainView';
import type { Terrain } from '../../sim/terrain';

const raycaster = new Raycaster();
const ndc = new Vector2();
const hit = new Vector3();
const projected = new Vector3();

export interface GroundHit {
  x: number;
  z: number;
}

/**
 * 화면 좌표(px, 캔버스 기준) → 지면 좌표. A의 intersectTerrain(높이맵 광선 진행, 다리 통행면 포함)을 쓴다.
 * 지면에 닿지 않거나 맵 밖이면 null.
 */
export function pickGround(
  camera: PerspectiveCamera,
  terrain: Terrain,
  sx: number,
  sy: number,
  width: number,
  height: number,
): GroundHit | null {
  ndc.set((sx / width) * 2 - 1, -(sy / height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return intersectTerrain(terrain, raycaster.ray, hit) ? { x: hit.x, z: hit.z } : null;
}

/** 월드 좌표 → 화면 px. 카메라 뒤면 visible = false. 결과 객체를 재사용한다. */
export function projectToScreen(
  camera: PerspectiveCamera,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  out: { sx: number; sy: number; visible: boolean },
): void {
  projected.set(x, y, z).project(camera);
  out.sx = (projected.x * 0.5 + 0.5) * width;
  out.sy = (-projected.y * 0.5 + 0.5) * height;
  out.visible = projected.z > -1 && projected.z < 1;
}
