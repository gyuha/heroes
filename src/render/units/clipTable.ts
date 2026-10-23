/**
 * 본 행렬 텍스처의 클립 표와 재생 프레임 계산. three.js 없이 쓰는 순수 함수만 둔다(테스트용).
 *
 * 텍스처 한 줄 = 한 프레임의 모든 본 행렬. 0번 줄은 늘 바인드(정지) 자세이고, 클립은 1번 줄부터
 * ANIM_CLIP_NAMES 순서로 이어 붙인다. 클립 파일이 없거나 클립 하나가 빠지면 그 클립은 0번 줄을 가리킨다.
 *
 * sampleClip 은 정점 셰이더(soldierMaterial.ts)의 프레임 계산과 같은 식이다. 한쪽을 바꾸면 다른 쪽도 바꾼다.
 */

/**
 * 애니메이션 클립 번호. 시뮬레이션은 애니메이션 상태를 갖지 않고(ARCHITECTURE §11.5), 렌더가 틱 기록과
 * 속도로 클립을 고른다. 번호 = ANIM_CLIP_NAMES 순서 = 텍스처의 클립 순서.
 */
export const AnimClip = {
  Idle: 0,
  Walk: 1,
  Run: 2,
  Attack: 3,
  Hit: 4,
  Die: 5,
} as const;
export type AnimClipId = (typeof AnimClip)[keyof typeof AnimClip];
/** glTF 애니메이션 이름(ARCHITECTURE §7.5) */
export const ANIM_CLIP_NAMES = ['idle', 'walk', 'run', 'attack', 'hit', 'die'] as const;

/** 굽기·재생 프레임 속도(ARCHITECTURE §7.5). */
export const BAKE_FPS = 30;
export const CLIP_COUNT = ANIM_CLIP_NAMES.length;
/** 클립 표 한 칸의 float 수: [시작 줄, 프레임 수, 길이(초), 반복 1/0] */
export const CLIP_ENTRY_SIZE = 4;

/** idle·walk·run 은 반복, attack·hit·die 는 한 번 재생 후 마지막 프레임에서 멈춘다(die 는 쓰러진 자세 유지). */
export const LOOPING_CLIPS: readonly boolean[] = ANIM_CLIP_NAMES.map(
  (name) => name === 'idle' || name === 'walk' || name === 'run',
);

/** 길이(초)를 30fps 로 샘플링할 때의 프레임 수. 처음과 끝 프레임을 모두 넣는다. 길이 0 이하는 1장. */
export function clipFrameCount(duration: number): number {
  if (!(duration > 0)) return 1;
  // 1.0초 × 30 = 30.000001 같은 부동소수 오차로 한 장이 더 생기지 않게 깎는다.
  return Math.ceil(duration * BAKE_FPS - 1e-4) + 1;
}

export interface ClipTable {
  /** 클립마다 CLIP_ENTRY_SIZE 개 float. 셰이더 uniform vec4 배열로 그대로 올린다. */
  readonly entries: Float32Array;
  /** 0번 줄(바인드 자세)을 포함한 텍스처 전체 줄 수 */
  readonly rows: number;
}

/** durations[c] = 클립 c(ANIM_CLIP_NAMES 순서)의 길이(초). 없는 클립은 null. */
export function buildClipTable(durations: readonly (number | null)[]): ClipTable {
  const entries = new Float32Array(CLIP_COUNT * CLIP_ENTRY_SIZE);
  let row = 1;
  for (let c = 0; c < CLIP_COUNT; c++) {
    const d = durations[c];
    const o = c * CLIP_ENTRY_SIZE;
    if (d == null || !(d > 0)) {
      // 바인드 자세 1장에서 멈춘다.
      entries[o] = 0;
      entries[o + 1] = 1;
      entries[o + 2] = 0;
      entries[o + 3] = 0;
      continue;
    }
    const frames = clipFrameCount(d);
    entries[o] = row;
    entries[o + 1] = frames;
    entries[o + 2] = d;
    entries[o + 3] = LOOPING_CLIPS[c] ? 1 : 0;
    row += frames;
  }
  return { entries, rows: row };
}

/** 모든 클립이 바인드 자세(0번 줄)를 가리키는 표. 클립 파일이 없거나 임시 캡슐일 때 쓴다. */
export function bindPoseClipTable(): ClipTable {
  return buildClipTable([]);
}

/**
 * 클립 시작 후 localTime 초의 재생 위치를 out = [줄0, 줄1, 섞는 비율] 에 쓴다.
 * 반복 클립은 길이로 나눈 나머지, 한 번 재생 클립은 [0, 길이] 로 묶는다(끝나면 마지막 프레임 유지).
 */
export function sampleClip(
  entries: Float32Array,
  clip: number,
  localTime: number,
  out: Float32Array,
): void {
  const o = clip * CLIP_ENTRY_SIZE;
  const start = entries[o];
  const frames = entries[o + 1];
  const duration = entries[o + 2];
  let t = localTime;
  if (entries[o + 3] > 0.5) {
    // GLSL mod(x, y) = x - y * floor(x / y): 음수 시각도 [0, y) 로 접는다.
    t = t - duration * Math.floor(t / duration);
  } else {
    t = t < 0 ? 0 : t > duration ? duration : t;
  }
  const pos = Math.min(t * BAKE_FPS, frames - 1);
  const f0 = Math.floor(pos);
  out[0] = start + f0;
  out[1] = start + Math.min(f0 + 1, frames - 1);
  out[2] = pos - f0;
}
