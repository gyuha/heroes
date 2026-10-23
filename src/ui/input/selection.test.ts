import { describe, expect, it } from 'vitest';
import { DOUBLE_PRESS_MS, SelectionModel, idsInScreenRect } from './selection';

describe('SelectionModel', () => {
  it('클릭은 하나만 선택하고, 빈 곳 클릭은 선택을 지운다', () => {
    const s = new SelectionModel();
    s.click(1, false);
    s.click(2, false);
    expect(s.ids).toEqual([2]);
    s.click(null, false);
    expect(s.size).toBe(0);
  });

  it('Shift 클릭은 추가·해제하고, 빈 곳 Shift 클릭은 선택을 유지한다', () => {
    const s = new SelectionModel();
    s.click(1, false);
    s.click(2, true);
    expect([...s.ids].sort()).toEqual([1, 2]);
    s.click(1, true);
    expect(s.ids).toEqual([2]);
    s.click(null, true);
    expect(s.ids).toEqual([2]);
  });

  it('상자 선택은 교체, Shift 상자는 추가', () => {
    const s = new SelectionModel();
    s.click(9, false);
    s.box([1, 2], false);
    expect([...s.ids].sort()).toEqual([1, 2]);
    s.box([3], true);
    expect([...s.ids].sort()).toEqual([1, 2, 3]);
  });

  it('그룹 저장·호출, 두 번 누르면 카메라 이동', () => {
    const s = new SelectionModel();
    s.box([4, 5], false);
    s.saveGroup(3);
    s.clear();
    expect(s.recallGroup(3, false, 1000)).toEqual({ found: true, focus: false });
    expect([...s.ids].sort()).toEqual([4, 5]);
    expect(s.recallGroup(3, false, 1000 + DOUBLE_PRESS_MS - 1).focus).toBe(true);
    expect(s.recallGroup(3, false, 5000).focus).toBe(false);
  });

  it('다른 그룹을 누른 뒤에는 두 번 누름으로 보지 않는다', () => {
    const s = new SelectionModel();
    s.set([1]);
    s.saveGroup(1);
    s.set([2]);
    s.saveGroup(2);
    s.recallGroup(1, false, 0);
    s.recallGroup(2, false, 100);
    expect(s.recallGroup(1, false, 200).focus).toBe(false);
  });

  it('Shift+숫자는 그룹을 현재 선택에 더한다', () => {
    const s = new SelectionModel();
    s.set([1]);
    s.saveGroup(1);
    s.set([7]);
    s.recallGroup(1, true, 0);
    expect([...s.ids].sort()).toEqual([1, 7]);
  });

  it('빈 선택으로 저장하면 그룹을 지우고, 없는 그룹은 found=false', () => {
    const s = new SelectionModel();
    s.set([1]);
    s.saveGroup(2);
    s.clear();
    s.saveGroup(2);
    expect(s.recallGroup(2, false, 0)).toEqual({ found: false, focus: false });
    expect(s.ids).toEqual([]);
  });

  it('괴멸한 부대는 선택과 그룹에서 빠진다', () => {
    const s = new SelectionModel();
    s.set([1, 2]);
    s.saveGroup(1);
    s.prune((id) => id !== 2);
    expect(s.ids).toEqual([1]);
    expect(s.group(1)).toEqual([1]);
    s.prune(() => false);
    expect(s.group(1)).toEqual([]);
    expect(s.groupOf(1)).toBeNull();
  });

  it('groupOf는 가장 작은 그룹 번호', () => {
    const s = new SelectionModel();
    s.set([1]);
    s.saveGroup(5);
    s.saveGroup(2);
    expect(s.groupOf(1)).toBe(2);
  });
});

describe('ids 캐시', () => {
  it('선택이 그대로면 같은 배열, 바뀌면 새 배열', () => {
    const s = new SelectionModel();
    s.set([1, 2]);
    const a = s.ids;
    expect(s.ids).toBe(a);
    s.click(3, true);
    expect(s.ids).not.toBe(a);
    expect([...s.ids].sort()).toEqual([1, 2, 3]);
  });
});

describe('idsInScreenRect', () => {
  const pts = [
    { id: 1, sx: 10, sy: 10 },
    { id: 2, sx: 50, sy: 50 },
    { id: 3, sx: 100, sy: 20 },
  ];
  it('꼭짓점 순서와 관계없이 중심이 안에 든 부대', () => {
    expect(idsInScreenRect(pts, { x0: 0, y0: 0, x1: 60, y1: 60 })).toEqual([1, 2]);
    expect(idsInScreenRect(pts, { x0: 120, y0: 60, x1: 40, y1: 0 })).toEqual([2, 3]);
  });
});
