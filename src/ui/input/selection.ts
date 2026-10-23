/** 그룹 번호를 두 번 누른 것으로 보는 간격(ms). */
export const DOUBLE_PRESS_MS = 400;

export interface ScreenPoint {
  readonly id: number;
  readonly sx: number;
  readonly sy: number;
}

export interface ScreenRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** 화면 사각형(두 꼭짓점 순서 무관) 안에 중심이 들어온 부대 id. */
export function idsInScreenRect(points: readonly ScreenPoint[], rect: ScreenRect): number[] {
  const minX = Math.min(rect.x0, rect.x1);
  const maxX = Math.max(rect.x0, rect.x1);
  const minY = Math.min(rect.y0, rect.y1);
  const maxY = Math.max(rect.y0, rect.y1);
  const out: number[] = [];
  for (const p of points) {
    if (p.sx >= minX && p.sx <= maxX && p.sy >= minY && p.sy <= maxY) out.push(p.id);
  }
  return out;
}

/**
 * 플레이어 부대 선택 상태와 그룹(1~9). 화면·DOM과 무관한 순수 상태라 단위 테스트한다.
 * 선택할 수 있는 부대(아군, 괴멸 아님)인지는 호출하는 쪽이 걸러서 넘긴다.
 */
export class SelectionModel {
  private readonly selected = new Set<number>();
  private readonly groups = new Map<number, number[]>();
  private lastRecall = { group: -1, time: -Infinity };
  /** 선택이 바뀔 때마다 증가. 화면 갱신 여부 판단용. */
  version = 0;

  private cachedIds: number[] = [];
  private cachedVersion = -1;

  /** 선택된 부대 id. 선택이 바뀔 때만 새 배열을 만든다(매 프레임 여러 번 읽어도 할당 없음). 고치지 말 것. */
  get ids(): readonly number[] {
    if (this.cachedVersion !== this.version) {
      this.cachedVersion = this.version;
      this.cachedIds = [...this.selected];
    }
    return this.cachedIds;
  }

  get size(): number {
    return this.selected.size;
  }

  has(id: number): boolean {
    return this.selected.has(id);
  }

  /** 좌클릭. id가 null이면 빈 곳 클릭. Shift면 추가·해제(빈 곳 Shift 클릭은 유지). */
  click(id: number | null, additive: boolean): void {
    if (additive) {
      if (id === null) return;
      if (this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
    } else {
      this.selected.clear();
      if (id !== null) this.selected.add(id);
    }
    this.version++;
  }

  /** 상자 선택. Shift면 기존 선택에 더한다. */
  box(ids: readonly number[], additive: boolean): void {
    if (!additive) this.selected.clear();
    for (const id of ids) this.selected.add(id);
    this.version++;
  }

  /** 목록 그대로 선택(백틱 전군 선택 등). */
  set(ids: readonly number[]): void {
    this.selected.clear();
    for (const id of ids) this.selected.add(id);
    this.version++;
  }

  clear(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.version++;
  }

  /** 현재 선택을 그룹 n(1~9)에 저장. 선택이 비어 있으면 그룹을 지운다. */
  saveGroup(n: number): void {
    if (this.selected.size === 0) this.groups.delete(n);
    else this.groups.set(n, [...this.selected]);
  }

  group(n: number): readonly number[] {
    return this.groups.get(n) ?? [];
  }

  /**
   * 그룹 n 선택. additive면 기존 선택에 더한다.
   * 같은 그룹을 DOUBLE_PRESS_MS 안에 다시 누르면 focus = true(카메라 이동).
   */
  recallGroup(n: number, additive: boolean, nowMs: number): { found: boolean; focus: boolean } {
    const members = this.groups.get(n);
    if (!members || members.length === 0) return { found: false, focus: false };
    const focus = this.lastRecall.group === n && nowMs - this.lastRecall.time <= DOUBLE_PRESS_MS;
    this.lastRecall = { group: n, time: nowMs };
    if (additive) this.box(members, true);
    else this.set(members);
    return { found: true, focus };
  }

  /** 더 이상 선택할 수 없는 부대(괴멸 등)를 선택과 그룹에서 뺀다. */
  prune(isSelectable: (id: number) => boolean): void {
    let changed = false;
    for (const id of this.selected) {
      if (!isSelectable(id)) {
        this.selected.delete(id);
        changed = true;
      }
    }
    for (const [n, members] of this.groups) {
      // 매 프레임 불리므로 바뀐 그룹만 새 배열을 만든다.
      if (members.every(isSelectable)) continue;
      const kept = members.filter(isSelectable);
      if (kept.length !== members.length) {
        if (kept.length === 0) this.groups.delete(n);
        else this.groups.set(n, kept);
      }
    }
    if (changed) this.version++;
  }

  /** 부대 id → 속한 그룹 번호(가장 작은 번호). 카드 배지용. */
  groupOf(id: number): number | null {
    let best: number | null = null;
    for (const [n, members] of this.groups) {
      if (members.includes(id) && (best === null || n < best)) best = n;
    }
    return best;
  }
}
