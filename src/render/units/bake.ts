import {
  AnimationClip,
  Matrix4,
  Object3D,
  PropertyBinding,
  SkinnedMesh,
  type Interpolant,
} from 'three';
import {
  ANIM_CLIP_NAMES,
  BAKE_FPS,
  CLIP_COUNT,
  CLIP_ENTRY_SIZE,
  buildClipTable,
  type ClipTable,
} from './clipTable';

/** 행렬 하나 = RGBA 텍셀 4개(열 4개), 텍셀당 float 4개 */
const FLOATS_PER_MATRIX = 16;

export interface BakedAnimation {
  /** RGBA32F 텍스처 데이터. 너비 = 본 수 × 4 텍셀, 높이 = table.rows */
  readonly data: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly table: ClipTable;
  /** 이름이 맞는 노드를 못 찾아 버린 트랙(경고용, "클립:트랙") */
  readonly droppedTracks: string[];
}

interface TrackBinding {
  target: Object3D;
  property: 'quaternion' | 'position' | 'scale';
  interpolant: Interpolant;
}

/**
 * 스키닝 메시의 골격에 클립들을 본 이름으로 연결하고 30fps 로 샘플링해 본 행렬 텍스처 데이터를 만든다.
 *
 * - clips 는 ANIM_CLIP_NAMES 순서(없는 클립은 null). 클립은 다른 파일(animations.glb)에서 와도 된다.
 *   트랙 "노드이름.속성"의 노드를 메시가 속한 장면 트리에서 이름으로 찾는다.
 * - 각 칸에는 three.js 스키닝 셰이더와 같은 식의 행렬을 메시 원점 기준으로 미리 곱해 둔다:
 *   mesh.matrixWorld × bindMatrixInverse × bone.matrixWorld × boneInverse × bindMatrix.
 *   셰이더는 정점에 이 행렬(가중합)만 곱하면 모델 공간 위치가 나온다.
 * - 굽는 동안 본 자세를 바꾸고, 끝나면 원래(정지) 자세로 되돌린다.
 */
export function bakeSkinnedAnimations(
  mesh: SkinnedMesh,
  clips: readonly (AnimationClip | null)[],
): BakedAnimation {
  const { skeleton } = mesh;
  const bones = skeleton.bones;
  let top: Object3D = mesh;
  while (top.parent) top = top.parent;

  // 모든 노드의 정지 자세를 저장해 클립마다 그 자세에서 시작한다(트랙이 없는 속성은 정지 값 유지).
  const nodes: Object3D[] = [];
  top.traverse((o) => nodes.push(o));
  const rest = nodes.map((o) => ({
    p: o.position.clone(),
    q: o.quaternion.clone(),
    s: o.scale.clone(),
  }));
  const restore = () => {
    for (let k = 0; k < nodes.length; k++) {
      nodes[k].position.copy(rest[k].p);
      nodes[k].quaternion.copy(rest[k].q);
      nodes[k].scale.copy(rest[k].s);
    }
  };

  const durations = clips.slice(0, CLIP_COUNT).map((c) => (c ? c.duration : null));
  const table = buildClipTable(durations);
  const width = bones.length * 4;
  const data = new Float32Array(width * 4 * table.rows);
  const droppedTracks: string[] = [];

  const pre = new Matrix4();
  const m = new Matrix4();
  const writeRow = (row: number) => {
    top.updateMatrixWorld(true);
    pre.copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse);
    for (let b = 0; b < bones.length; b++) {
      m.multiplyMatrices(bones[b].matrixWorld, skeleton.boneInverses[b])
        .multiply(mesh.bindMatrix)
        .premultiply(pre);
      m.toArray(data, (row * bones.length + b) * FLOATS_PER_MATRIX);
    }
  };

  restore();
  writeRow(0);

  for (let c = 0; c < CLIP_COUNT; c++) {
    const clip = clips[c];
    if (!clip) continue;
    const o = c * CLIP_ENTRY_SIZE;
    const startRow = table.entries[o];
    const frames = table.entries[o + 1];
    const duration = table.entries[o + 2];
    if (frames <= 1 && startRow === 0) continue;

    const bindings: TrackBinding[] = [];
    for (const track of clip.tracks) {
      const parsed = PropertyBinding.parseTrackName(track.name);
      const property = parsed.propertyName;
      const target = top.getObjectByName(parsed.nodeName);
      if (
        !target ||
        (property !== 'quaternion' && property !== 'position' && property !== 'scale')
      ) {
        droppedTracks.push(`${ANIM_CLIP_NAMES[c]}:${track.name}`);
        continue;
      }
      // createInterpolant 는 setInterpolation 이 런타임에 붙이는 메서드라 타입 선언에 없다.
      // QuaternionKeyframeTrack 은 구면 보간(slerp) 보간기를 돌려준다.
      const interpolant = (
        track as unknown as { createInterpolant(): Interpolant }
      ).createInterpolant();
      bindings.push({ target, property, interpolant });
    }

    restore();
    for (let f = 0; f < frames; f++) {
      const t = Math.min(f / BAKE_FPS, duration);
      for (const bnd of bindings) {
        const v = bnd.interpolant.evaluate(t);
        if (bnd.property === 'quaternion') {
          bnd.target.quaternion.fromArray(v).normalize();
        } else {
          bnd.target[bnd.property].fromArray(v);
        }
      }
      writeRow(startRow + f);
    }
  }

  restore();
  top.updateMatrixWorld(true);
  return { data, width, height: table.rows, table, droppedTracks };
}
