import type { SquadView, UnitTypeId } from '../../sim/api';
import { UNIT_TYPES } from '../../sim/data/balance';
import { type IconId, iconSvg, squadIconId } from '../icons';
import { h, setNum, setText, setWidthPct, toggleClass } from './dom';

const ORDER: Record<UnitTypeId, number> = { infantry: 1, spearman: 2, archer: 3, cavalry: 4 };

/** 카드에 쓰는 짧은 상태 이름(GDD §4.5 하위 상태). */
export function activityLabel(s: SquadView): string {
  if (s.state === 'destroyed') return '괴멸';
  if (s.state === 'routing') return '패주';
  if (s.moraleBand === 'wavering') return '동요';
  if (s.type === 'archer' && s.targetId >= 0 && s.activity === 'idle') return '사격';
  switch (s.activity) {
    case 'idle':
      return s.order === 'hold' ? '고수' : '대기';
    case 'moving':
      return s.order === 'advance' ? '전진' : s.order === 'attack' ? '접근' : '이동';
    case 'engaged':
      return '교전';
    case 'charging':
      return '돌격';
    case 'holding':
      return '고수';
    case 'braced':
      return 'Brace';
    case 'disengaging':
      return '이탈';
    case 'pursuing':
      return '추격';
  }
}

export const FORMATION_LABEL = { line: '횡대', column: '종대', loose: '산개' } as const;

interface CardEls {
  root: HTMLElement;
  group: HTMLElement;
  count: HTMLElement;
  state: HTMLElement;
  flags: HTMLElement;
  flagBits: number;
  lastGroup: number | null | undefined;
  lastBonus: number;
  morale: HTMLElement;
  charge: HTMLElement | null;
}

export interface CardCallbacks {
  select(id: number, additive: boolean): void;
  focus(id: number): void;
  hover(id: number | null, el: HTMLElement | null): void;
}

/**
 * 하단 부대 카드 바(GDD §9.2). 병종 아이콘, 그룹 번호, 병력, 사기 막대와 상태, 돌격 준비 게이지,
 * 방패벽·Brace·은폐·종대 아이콘, 고지 보너스. 클릭 = 선택(Shift 추가), 두 번 클릭 = 카메라 이동.
 * 카드 순서는 병종 → 번호로 고정해 위치를 외울 수 있게 한다.
 */
export class UnitCards {
  readonly root: HTMLElement;
  private readonly cards = new Map<number, CardEls>();
  private order: readonly SquadView[] = [];
  private inOrder = new Set<number>();

  constructor(
    parent: HTMLElement,
    private readonly cb: CardCallbacks,
  ) {
    this.root = h('div', { class: 'hud-cards empty' });
    parent.appendChild(this.root);
  }

  update(
    own: readonly SquadView[],
    isSelected: (id: number) => boolean,
    groupOf: (id: number) => number | null,
  ): void {
    // 부대 구성이 바뀔 때만 다시 정렬한다(진영 변경·재시작). 평소에는 할당 없이 채우기만.
    let same = own.length === this.order.length;
    for (let i = 0; same && i < own.length; i++) same = this.inOrder.has(own[i].id);
    if (!same) {
      this.order = [...own].sort(
        (a, b) =>
          Number(b.isCommander) - Number(a.isCommander) ||
          ORDER[a.type] - ORDER[b.type] ||
          a.id - b.id,
      );
      this.inOrder = new Set(this.order.map((s) => s.id));
      // 옛 진영 카드는 버린다(아키텍트 2차 리뷰: 진영 변경 후 옛 카드 보유).
      for (const id of [...this.cards.keys()]) if (!this.inOrder.has(id)) this.cards.delete(id);
      for (const s of this.order) if (!this.cards.has(s.id)) this.cards.set(s.id, this.create(s));
      // wrap-reverse 로 아래 줄부터 채우므로 순서를 그대로 둔다.
      this.root.replaceChildren(...this.order.map((s) => this.cards.get(s.id)!.root));
      toggleClass(this.root, 'empty', this.order.length === 0);
    }
    for (const s of own) this.fill(this.cards.get(s.id)!, s, isSelected(s.id), groupOf(s.id));
  }

  private create(s: SquadView): CardEls {
    const group = h('span', { class: 'card-group' });
    const count = h('span', { class: 'card-count' });
    const state = h('span', { class: 'card-state' });
    const flags = h('span', { class: 'card-flags' });
    const morale = h('span');
    const hasCharge = UNIT_TYPES[s.type].charge !== undefined;
    const charge = hasCharge ? h('span') : null;
    const bars = h('div', { class: 'card-bars' }, [
      h('div', { class: 'bar morale', attrs: { title: '사기' } }, [morale]),
      charge ? h('div', { class: 'bar charge', attrs: { title: '돌격 준비' } }, [charge]) : null,
    ]);
    const root = h(
      'div',
      { class: 'card', attrs: { role: 'button', tabindex: '-1', 'aria-label': s.name } },
      [group, flags, iconSvg(squadIconId(s.type, s.isCommander)), count, state, bars],
    );
    root.addEventListener('click', (e) => {
      if (this.isDead(s.id)) return;
      this.cb.select(s.id, e.shiftKey);
    });
    root.addEventListener('dblclick', () => {
      if (!this.isDead(s.id)) this.cb.focus(s.id);
    });
    root.addEventListener('pointerenter', () => this.cb.hover(s.id, root));
    root.addEventListener('pointerleave', () => this.cb.hover(null, null));
    return {
      root,
      group,
      count,
      state,
      flags,
      flagBits: 0,
      lastGroup: undefined,
      lastBonus: -1,
      morale,
      charge,
    };
  }

  private isDead(id: number): boolean {
    return this.cards.get(id)?.root.classList.contains('destroyed') ?? true;
  }

  private fill(el: CardEls, s: SquadView, selected: boolean, group: number | null): void {
    if (el.lastGroup !== group) {
      el.lastGroup = group;
      setText(el.group, group === null ? '' : String(group));
    }
    setNum(el.count, s.count);
    // 고지 보너스는 상태 줄을 대신한다(GDD §6.5 ④ "고지 +N%").
    const high = s.state === 'ready' && s.heightBonusPct > 0;
    const bonus = high ? Math.round(s.heightBonusPct) : 0;
    if (high) {
      if (el.lastBonus !== bonus) setText(el.state, `고지+${bonus}%`);
    } else {
      setText(el.state, activityLabel(s));
    }
    el.lastBonus = bonus;
    toggleClass(el.state, 'high', high);
    setWidthPct(el.morale, s.morale / 100);
    if (el.charge) {
      const cooldown = UNIT_TYPES[s.type].charge?.cooldown ?? 1;
      setWidthPct(el.charge, 1 - s.chargeCooldown / cooldown);
    }
    const flagBits =
      (s.shieldWall ? 1 : 0) |
      (s.braced ? 2 : 0) |
      (s.concealed ? 4 : 0) |
      (s.autoNarrowed ? 8 : 0);
    if (flagBits !== el.flagBits) {
      el.flagBits = flagBits;
      const flags: IconId[] = [];
      if (s.shieldWall) flags.push('shieldWall');
      if (s.braced) flags.push('brace');
      if (s.concealed) flags.push('concealed');
      if (s.autoNarrowed) flags.push('narrow');
      el.flags.replaceChildren(...flags.map((f) => iconSvg(f)));
    }
    toggleClass(el.root, 'is-selected', selected);
    toggleClass(el.root, 'wavering', s.state === 'ready' && s.moraleBand === 'wavering');
    toggleClass(el.root, 'routing', s.state === 'routing');
    toggleClass(el.root, 'destroyed', s.state === 'destroyed');
  }
}
