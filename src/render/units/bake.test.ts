import {
  AnimationClip,
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { bakeSkinnedAnimations } from './bake';
import { AnimClip, CLIP_ENTRY_SIZE } from './clipTable';

/** root(원점) → arm(높이 1) 두 본. 정점 (0, 2, 0) 은 arm 에 묶인다. */
function makeRig() {
  const root = new Bone();
  root.name = 'root';
  const arm = new Bone();
  arm.name = 'arm';
  arm.position.set(0, 1, 0);
  root.add(arm);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 2, 0], 3));
  geometry.setAttribute('skinIndex', new Float32BufferAttribute([1, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0], 4));
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  const scene = new Group();
  scene.add(mesh, root);
  scene.updateMatrixWorld(true);
  mesh.bind(new Skeleton([root, arm]));
  return { mesh, arm };
}

/** 굽힌 행렬로 정점 하나를 변환한다(셰이더의 transformed = skinMat * position 과 같음). */
function skinVertex(data: Float32Array, bones: number, row: number, bone: number, v: Vector3) {
  const m = new Matrix4().fromArray(data, (row * bones + bone) * 16);
  return v.clone().applyMatrix4(m);
}

describe('bakeSkinnedAnimations', () => {
  it('0번 줄(바인드 자세)은 정점을 움직이지 않는다', () => {
    const { mesh } = makeRig();
    const baked = bakeSkinnedAnimations(mesh, []);
    expect(baked.width).toBe(8);
    expect(baked.height).toBe(1);
    const p = skinVertex(baked.data, 2, 0, 1, new Vector3(0, 2, 0));
    expect(p.distanceTo(new Vector3(0, 2, 0))).toBeLessThan(1e-6);
  });

  it('본 이름으로 다른 파일의 트랙을 연결해 30fps 로 굽는다', () => {
    const { mesh, arm } = makeRig();
    // arm 을 1초 동안 Z축으로 0 → 90° 회전. 정점 (0,2,0) 은 끝에서 (-1,1,0).
    const q90 = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    const track = new QuaternionKeyframeTrack(
      'arm.quaternion',
      [0, 1],
      [0, 0, 0, 1, ...q90.toArray()],
    );
    const die = new AnimationClip('die', 1, [track]);
    const baked = bakeSkinnedAnimations(mesh, [null, null, null, null, null, die]);
    const o = AnimClip.Die * CLIP_ENTRY_SIZE;
    const start = baked.table.entries[o];
    expect(start).toBe(1);
    expect(baked.table.entries[o + 1]).toBe(31);
    expect(baked.height).toBe(32);

    const v = new Vector3(0, 2, 0);
    expect(skinVertex(baked.data, 2, start, 1, v).distanceTo(v)).toBeLessThan(1e-6);
    const end = skinVertex(baked.data, 2, start + 30, 1, v);
    expect(end.distanceTo(new Vector3(-1, 1, 0))).toBeLessThan(1e-5);
    // 굽기가 끝나면 정지 자세로 되돌린다.
    expect(arm.quaternion.equals(new Quaternion())).toBe(true);
    expect(baked.droppedTracks).toEqual([]);
  });

  it('이름이 맞지 않거나 지원하지 않는 속성의 트랙은 버리고 기록한다', () => {
    const { mesh } = makeRig();
    const bad = new QuaternionKeyframeTrack('elbow.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
    const morph = new NumberKeyframeTrack('arm.morphTargetInfluences', [0, 1], [0, 1]);
    const idle = new AnimationClip('idle', 1, [bad, morph]);
    const baked = bakeSkinnedAnimations(mesh, [idle]);
    expect(baked.droppedTracks).toEqual([
      'idle:elbow.quaternion',
      'idle:arm.morphTargetInfluences',
    ]);
  });
});
