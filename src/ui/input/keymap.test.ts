import { describe, expect, it } from 'vitest';
import { mapKey, stepSpeed, type KeyInput } from './keymap';

const key = (code: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  code,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe('mapKey', () => {
  it('명령 키', () => {
    expect(mapKey(key('KeyZ'))).toEqual({ kind: 'charge' });
    expect(mapKey(key('KeyC'))).toEqual({ kind: 'advance' });
    expect(mapKey(key('KeyX'))).toEqual({ kind: 'hold' });
    expect(mapKey(key('KeyF'))).toEqual({ kind: 'formation', formation: 'line' });
    expect(mapKey(key('KeyG'))).toEqual({ kind: 'formation', formation: 'column' });
    expect(mapKey(key('KeyH'))).toEqual({ kind: 'formation', formation: 'loose' });
    expect(mapKey(key('Backquote'))).toEqual({ kind: 'selectAll' });
    expect(mapKey(key('Space'))).toEqual({ kind: 'togglePause' });
  });

  it('숫자: 호출, Shift 추가, Ctrl·Alt 저장, 숫자패드 포함', () => {
    expect(mapKey(key('Digit3'))).toEqual({ kind: 'recallGroup', group: 3, additive: false });
    expect(mapKey(key('Digit3', { shiftKey: true }))).toEqual({
      kind: 'recallGroup',
      group: 3,
      additive: true,
    });
    expect(mapKey(key('Digit9', { ctrlKey: true }))).toEqual({ kind: 'saveGroup', group: 9 });
    expect(mapKey(key('Digit9', { altKey: true }))).toEqual({ kind: 'saveGroup', group: 9 });
    expect(mapKey(key('Numpad2'))).toEqual({ kind: 'recallGroup', group: 2, additive: false });
    expect(mapKey(key('Digit0'))).toBeNull();
  });

  it('카메라 키(WASD·Q·E)와 Cmd 조합은 처리하지 않는다', () => {
    for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'])
      expect(mapKey(key(c))).toBeNull();
    expect(mapKey(key('KeyZ', { metaKey: true }))).toBeNull();
    expect(mapKey(key('Digit1', { metaKey: true }))).toBeNull();
    expect(mapKey(key('KeyZ', { ctrlKey: true }))).toBeNull();
  });
});

describe('stepSpeed', () => {
  it('1 → 2 → 4, 끝에서 멈춤', () => {
    expect(stepSpeed(1, 1)).toBe(2);
    expect(stepSpeed(2, 1)).toBe(4);
    expect(stepSpeed(4, 1)).toBe(4);
    expect(stepSpeed(4, -1)).toBe(2);
    expect(stepSpeed(1, -1)).toBe(1);
  });
});
