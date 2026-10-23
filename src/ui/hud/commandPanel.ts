import type { FormationId } from '../../sim/api';
import { COMBAT, FORMATIONS } from '../../sim/data/balance';
import { SQUAD } from '../../sim/data/simConfig';
import { type IconId, iconSvg } from '../icons';
import { KEY_LABELS } from '../input/keymap';
import { h, toggleClass } from './dom';

export type CommandButtonId =
  'move' | 'attack' | 'charge' | 'advance' | 'hold' | 'line' | 'column' | 'loose';

const BUTTONS: { id: CommandButtonId; icon: IconId; label: string; key: string; tip: string }[] = [
  {
    id: 'move',
    icon: 'move',
    label: '이동',
    key: '',
    tip: '이동 — 지면 우클릭(드래그하면 정면·폭)',
  },
  { id: 'attack', icon: 'attack', label: '공격', key: '', tip: '공격 — 적 부대 우클릭' },
  {
    id: 'charge',
    icon: 'charge',
    label: '돌격',
    key: KEY_LABELS.charge,
    tip: '돌격 — 커서 아래 적 또는 현재 표적',
  },
  {
    id: 'advance',
    icon: 'advance',
    label: '전진',
    key: KEY_LABELS.advance,
    tip: `전진 — 정면으로 걷다 ${SQUAD.advanceEngageDist}m 안의 적을 공격`,
  },
  {
    id: 'hold',
    icon: 'hold',
    label: '고수',
    key: KEY_LABELS.hold,
    tip: '고수 — 자리 지킴, 보병 방패벽·창병 Brace',
  },
  { id: 'line', icon: 'line', label: '횡대', key: KEY_LABELS.line, tip: '횡대 — 기본 전열' },
  {
    id: 'column',
    icon: 'column',
    label: '종대',
    key: KEY_LABELS.column,
    tip: `종대 — ${FORMATIONS.column.files}열, 다리·숲길 통과`,
  },
  {
    id: 'loose',
    icon: 'loose',
    label: '산개',
    key: KEY_LABELS.loose,
    tip: `산개 — 간격 ${FORMATIONS.loose.spacingMult}배, 받는 화살 명중 ×${COMBAT.looseHitMult}`,
  },
];

const FORMATION_BUTTON: Record<FormationId, CommandButtonId> = {
  line: 'line',
  column: 'column',
  loose: 'loose',
};

/**
 * 명령 버튼(GDD §9.2). 선택이 없으면 흐리게 두지만 누를 수는 있다 → "부대를 선택하세요" 안내(D-009).
 * 이동·공격 버튼은 "다음 클릭 대상 지정" 모드로 들어간다(Esc 취소).
 */
export class CommandPanel {
  readonly root: HTMLElement;
  private readonly buttons = new Map<CommandButtonId, HTMLButtonElement>();

  constructor(
    parent: HTMLElement,
    onPress: (id: CommandButtonId) => void,
    onHover: (tip: string | null, el: HTMLElement | null) => void,
  ) {
    this.root = h('div', { class: 'hud-commands ui-panel' });
    for (const b of BUTTONS) {
      const btn = h(
        'button',
        { class: 'ui-btn cmd', attrs: { type: 'button', 'aria-label': b.tip } },
        [
          iconSvg(b.icon),
          h('span', { text: b.label }),
          b.key ? h('span', { class: 'ui-key', text: b.key }) : null,
        ],
      );
      btn.addEventListener('click', () => onPress(b.id));
      btn.addEventListener('pointerenter', () => onHover(b.tip, btn));
      btn.addEventListener('pointerleave', () => onHover(null, null));
      this.buttons.set(b.id, btn);
      this.root.appendChild(btn);
    }
    parent.appendChild(this.root);
  }

  update(state: {
    hasSelection: boolean;
    canCommand: boolean;
    formation: FormationId | null;
    pending: 'move' | 'attack' | null;
    canCharge: boolean;
  }): void {
    for (const [id, btn] of this.buttons) {
      let enabled = state.hasSelection && state.canCommand;
      if (id === 'line' || id === 'column' || id === 'loose') enabled = state.hasSelection;
      if (id === 'charge') enabled &&= state.canCharge;
      toggleClass(btn, 'is-disabled', !enabled);
      btn.setAttribute('aria-disabled', String(!enabled));
      const on =
        (state.formation !== null && FORMATION_BUTTON[state.formation] === id) ||
        state.pending === id;
      toggleClass(btn, 'is-on', on && state.hasSelection);
    }
  }
}
