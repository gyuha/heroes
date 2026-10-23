import { describe, expect, it } from 'vitest';
import {
  AnimClip,
  CLIP_COUNT,
  CLIP_ENTRY_SIZE,
  bindPoseClipTable,
  buildClipTable,
  clipFrameCount,
  sampleClip,
} from './clipTable';

// 납품된 클립 길이(docs/ANIMATION_GUIDE.md): idle 1.2, walk 1.0, run 0.8, attack 0.8, hit 0.3, die 1.0
const DURATIONS = [1.2, 1.0, 0.8, 0.8, 0.3, 1.0];

function entry(table: Float32Array, clip: number) {
  const o = clip * CLIP_ENTRY_SIZE;
  return { start: table[o], frames: table[o + 1], duration: table[o + 2], loop: table[o + 3] };
}

describe('clipFrameCount', () => {
  it('처음과 끝 프레임을 모두 넣는다(30fps)', () => {
    expect(clipFrameCount(1.0)).toBe(31);
    expect(clipFrameCount(1.2)).toBe(37);
    expect(clipFrameCount(0.8)).toBe(25);
    expect(clipFrameCount(0.3)).toBe(10);
  });
  it('길이 0 이하는 1장', () => {
    expect(clipFrameCount(0)).toBe(1);
    expect(clipFrameCount(-1)).toBe(1);
  });
});

describe('buildClipTable', () => {
  it('0번 줄은 바인드 자세, 클립은 1번 줄부터 이어 붙인다', () => {
    const { entries, rows } = buildClipTable(DURATIONS);
    // 1 + 37 + 31 + 25 + 25 + 10 + 31
    expect(rows).toBe(160);
    expect(entry(entries, AnimClip.Idle)).toEqual({
      start: 1,
      frames: 37,
      duration: expect.closeTo(1.2, 5),
      loop: 1,
    });
    expect(entry(entries, AnimClip.Walk).start).toBe(38);
    expect(entry(entries, AnimClip.Die)).toEqual({ start: 129, frames: 31, duration: 1, loop: 0 });
  });
  it('반복은 idle·walk·run 만', () => {
    const { entries } = buildClipTable(DURATIONS);
    const loops = Array.from({ length: CLIP_COUNT }, (_, c) => entry(entries, c).loop);
    expect(loops).toEqual([1, 1, 1, 0, 0, 0]);
  });
  it('없는 클립은 바인드 자세 줄을 가리키고 줄을 차지하지 않는다', () => {
    const { entries, rows } = buildClipTable([1.0, null, 0.8]);
    expect(entry(entries, AnimClip.Walk)).toEqual({ start: 0, frames: 1, duration: 0, loop: 0 });
    expect(entry(entries, AnimClip.Run).start).toBe(32);
    expect(entry(entries, AnimClip.Die)).toEqual({ start: 0, frames: 1, duration: 0, loop: 0 });
    expect(rows).toBe(1 + 31 + 25);
  });
});

describe('sampleClip', () => {
  const { entries } = buildClipTable(DURATIONS);
  const out = new Float32Array(3);

  it('반복 클립은 길이로 나눈 나머지 위치를 재생한다', () => {
    const walk = entry(entries, AnimClip.Walk);
    sampleClip(entries, AnimClip.Walk, 2.5, out); // 0.5초 = 15번 프레임
    expect(out[0]).toBe(walk.start + 15);
    expect(out[1]).toBe(walk.start + 16);
    expect(out[2]).toBeCloseTo(0, 4);
  });
  it('반복 클립 끝 직전은 마지막(첫 프레임과 같은) 줄과 섞는다', () => {
    const walk = entry(entries, AnimClip.Walk);
    sampleClip(entries, AnimClip.Walk, 0.99, out);
    expect(out[0]).toBe(walk.start + 29);
    expect(out[1]).toBe(walk.start + 30);
    expect(out[2]).toBeCloseTo(0.7, 3);
  });
  it('음수 시각도 반복 구간 안으로 접는다', () => {
    const walk = entry(entries, AnimClip.Walk);
    sampleClip(entries, AnimClip.Walk, -0.25, out); // 0.75초 위치
    expect(out[0] + out[2]).toBeCloseTo(walk.start + 22.5, 3);
  });
  it('한 번 재생 클립은 끝에서 마지막 프레임을 유지한다(die = 쓰러진 자세)', () => {
    const die = entry(entries, AnimClip.Die);
    sampleClip(entries, AnimClip.Die, 10, out);
    expect(out[0]).toBe(die.start + 30);
    expect(out[1]).toBe(die.start + 30);
    expect(out[2]).toBe(0);
  });
  it('한 번 재생 클립은 시작 전 시각을 0으로 묶는다', () => {
    const hit = entry(entries, AnimClip.Hit);
    sampleClip(entries, AnimClip.Hit, -1, out);
    expect(out[0]).toBe(hit.start);
    expect(out[2]).toBe(0);
  });
  it('바인드 자세 표는 언제나 0번 줄', () => {
    const bind = bindPoseClipTable().entries;
    for (let c = 0; c < CLIP_COUNT; c++) {
      sampleClip(bind, c, 3.3, out);
      expect([out[0], out[1], out[2]]).toEqual([0, 0, 0]);
    }
  });
});
