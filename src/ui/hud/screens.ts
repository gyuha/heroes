import type { BattleResult, GameSpeed, SquadView, TeamId, UnitTypeId } from '../../sim/api';
import { iconSvg } from '../icons';
import { FACTOR_BANDS } from '../theme';
import { NUM, h, setText, teamGlyph, toggleClass } from './dom';
import { ROUT_CAUSE_TEXT, TEAM_NAMES, formatClock, resultReasonText } from './eventText';

/** 성능 측정용 병력 배율 표시(ARCHITECTURE §9.3). 밸런스 판정에 쓰지 말라는 뜻을 함께 적는다. */
export function scaleNote(scale: number): string {
  return `측정용 병력 ×${Number(scale.toFixed(2))} — 밸런스 결과로 쓰지 않음`;
}

// ------------------------------------------------------------------ 우측 상단 제어

export interface ControlCallbacks {
  togglePause(): void;
  setSpeed(s: GameSpeed): void;
  toggleSlope(): void;
  toggleRange(): void;
  toggleTactical(): void;
  openMenu(): void;
  hover(tip: string | null, el: HTMLElement | null): void;
}

/** 일시정지·배속(GDD §9.2), 오버레이 토글, 메뉴. 지형 오버레이 범례도 여기 아래에 붙는다. */
export class Controls {
  readonly root: HTMLElement;
  readonly legend: HTMLElement;
  private readonly pause: HTMLButtonElement;
  private readonly speeds: Map<GameSpeed, HTMLButtonElement> = new Map();
  private readonly slope: HTMLButtonElement;
  private readonly range: HTMLButtonElement;
  private readonly tactical: HTMLButtonElement;
  private readonly legendTitle: HTMLElement;
  /** 버튼별 현재 툴팁(배속 제한 이유처럼 바뀔 수 있다) */
  private readonly tips = new Map<HTMLElement, string>();

  constructor(parent: HTMLElement, cb: ControlCallbacks) {
    const btn = (content: (Node | string)[], tip: string, onClick: () => void) => {
      const b = h(
        'button',
        { class: 'ui-btn', attrs: { type: 'button', 'aria-label': tip } },
        content,
      );
      this.tips.set(b, tip);
      b.addEventListener('click', onClick);
      b.addEventListener('pointerenter', () => cb.hover(this.tips.get(b) ?? tip, b));
      b.addEventListener('pointerleave', () => cb.hover(null, null));
      return b;
    };
    this.pause = btn([iconSvg('pause')], '일시정지 / 재개 (Space)', cb.togglePause);
    const speedRow: HTMLElement[] = [];
    for (const s of [1, 2, 4] as GameSpeed[]) {
      const b = btn([`${s}×`], `배속 ${s}× (+ / −)`, () => cb.setSpeed(s));
      this.speeds.set(s, b);
      speedRow.push(b);
    }
    const menu = btn(['메뉴'], '메뉴 · 조작법 · 포기 (Esc)', cb.openMenu);
    this.slope = btn(
      [iconSvg('slope'), h('span', { class: 'ui-key', text: 'T' })],
      '지형 이동 계수 오버레이 (T)',
      cb.toggleSlope,
    );
    this.range = btn(
      [iconSvg('range'), h('span', { class: 'ui-key', text: 'R' })],
      '궁수 사거리 상시 표시 (R)',
      cb.toggleRange,
    );
    this.tactical = btn(
      [iconSvg('map'), h('span', { class: 'ui-key', text: 'Tab' })],
      '전술 지도 (Tab / 최대 축소)',
      cb.toggleTactical,
    );

    this.legendTitle = h('b', { text: '이동 계수' });
    this.legend = h('div', { class: 'hud-legend ui-panel', attrs: { hidden: '' } }, [
      this.legendTitle,
      ...FACTOR_BANDS.map((b, i) =>
        h('div', { class: 'legend-row' }, [
          h('i', { class: i === 3 ? 'hatch' : '', attrs: { style: `background:${b.color}` } }),
          b.label,
        ]),
      ),
      h('div', { class: 'legend-row tip-row', text: '오르막(가장 느린 방향) 기준' }),
    ]);
    this.root = h('div', { class: 'hud-controls' }, [
      h('div', { class: 'ctrl-row ui-panel' }, [
        this.pause,
        h('span', { class: 'sep' }),
        ...speedRow,
        h('span', { class: 'sep' }),
        menu,
      ]),
      h('div', { class: 'ctrl-row ui-panel' }, [this.slope, this.range, this.tactical]),
      this.legend,
    ]);
    parent.appendChild(this.root);
  }

  update(s: {
    paused: boolean;
    speed: GameSpeed;
    maxSpeed: GameSpeed;
    speedLimitReason: string | null;
    slope: boolean;
    slopeUnit: string;
    range: boolean;
    tactical: boolean;
    battle: boolean;
  }): void {
    const icon = s.paused ? 'play' : 'pause';
    if (this.pause.dataset.icon !== icon) {
      this.pause.dataset.icon = icon;
      this.pause.replaceChildren(iconSvg(icon));
    }
    toggleClass(this.pause, 'is-on', s.paused);
    toggleClass(this.pause, 'is-disabled', !s.battle);
    for (const [v, b] of this.speeds) {
      const limited = v > s.maxSpeed;
      toggleClass(b, 'is-on', v === s.speed);
      toggleClass(b, 'is-disabled', !s.battle || limited);
      const tip = limited
        ? `배속 ${v}× 사용 불가 — ${s.speedLimitReason ?? '이 기기에서는 막혀 있습니다'}`
        : `배속 ${v}× (+ / −)`;
      if (this.tips.get(b) !== tip) {
        this.tips.set(b, tip);
        b.setAttribute('aria-label', tip);
      }
    }
    toggleClass(this.slope, 'is-on', s.slope);
    toggleClass(this.range, 'is-on', s.range);
    toggleClass(this.tactical, 'is-on', s.tactical);
    this.legend.hidden = !s.slope;
    setText(this.legendTitle, `이동 계수 — ${s.slopeUnit}`);
  }
}

// ------------------------------------------------------------------ 상단 안내 띠

export class Banner {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly actions: HTMLElement;
  private key = '';

  constructor(parent: HTMLElement) {
    this.title = h('b');
    this.detail = h('span');
    this.actions = h('div', { class: 'actions-inline' });
    this.root = h('div', { class: 'hud-banner ui-panel', attrs: { hidden: '' } }, [
      h('div', { class: 'msg' }, [this.title, this.detail]),
      this.actions,
    ]);
    parent.appendChild(this.root);
  }

  show(key: string, title: string, detail: string, buttons: HTMLElement[], variant = ''): void {
    if (key === this.key) return;
    this.key = key;
    this.root.hidden = false;
    this.root.className = `hud-banner ui-panel ${variant}`;
    setText(this.title, title);
    setText(this.detail, detail);
    this.actions.replaceChildren(...buttons);
  }

  hide(): void {
    if (this.key === '') return;
    this.key = '';
    this.root.hidden = true;
  }
}

export function button(label: string, onClick: () => void, variant = ''): HTMLButtonElement {
  const b = h('button', { class: `ui-btn ${variant}`, text: label, attrs: { type: 'button' } });
  b.addEventListener('click', onClick);
  return b;
}

// ------------------------------------------------------------------ 모달

/** 화면 전체를 덮는 모달 하나. 내용은 열 때마다 새로 만든다. */
export class Modal {
  readonly root: HTMLElement;
  name: string | null = null;

  constructor(parent: HTMLElement) {
    this.root = h('div', {
      class: 'screen',
      attrs: { hidden: '', role: 'dialog', 'aria-modal': 'true' },
    });
    parent.appendChild(this.root);
  }

  open(name: string, sheet: HTMLElement): void {
    this.name = name;
    this.root.replaceChildren(sheet);
    this.root.hidden = false;
    sheet.querySelector<HTMLElement>('.ui-btn.primary, .ui-btn')?.focus({ preventScroll: true });
  }

  close(): void {
    this.name = null;
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  get isOpen(): boolean {
    return this.name !== null;
  }
}

const KIND: Record<UnitTypeId, string> = {
  infantry: '보병',
  spearman: '창병',
  archer: '궁수',
  cavalry: '기병',
};

function composition(squads: readonly SquadView[], team: TeamId): string {
  const n: Record<string, number> = {};
  let total = 0;
  for (const s of squads) {
    if (s.team !== team) continue;
    total += s.startCount;
    const k = s.isCommander ? '지휘관' : KIND[s.type];
    n[k] = (n[k] ?? 0) + 1;
  }
  const parts = ['보병', '창병', '궁수', '기병', '지휘관']
    .filter((k) => n[k])
    .map((k) => `${k} ${n[k]}`);
  return `${NUM.format(total)}명 · ${parts.join(' · ')}`;
}

/** 브리핑(GDD §2): 맵, 양군 구성, 승리 조건, 권장 진영, 진영 선택. */
export function briefingSheet(
  squads: readonly SquadView[],
  initial: TeamId,
  onStart: (team: TeamId) => void,
): HTMLElement {
  let picked: TeamId = initial;
  const sides = ([0, 1] as TeamId[]).map((team) => {
    const el = h(
      'button',
      { class: `side${team === picked ? ' is-on' : ''}`, attrs: { type: 'button' } },
      [
        h('div', { class: 'side-head' }, [
          teamGlyph(team),
          `${TEAM_NAMES[team]} ${team === 0 ? '변경군 — 방어' : '동맹군 — 공격'}`,
          team === 0 ? h('span', { class: 'tag', text: '권장' }) : null,
        ]),
        h('ul', {}, [
          h('li', { text: composition(squads, team) }),
          ...(team === 0
            ? [
                '15:00까지 깃발을 지키거나 공격군을 무너뜨리면 승리',
                '능선 앞 경사와 마루를 잡고 세 도하 지점을 막는다',
              ]
            : [
                '깃발 구역을 60초 연속 점령하거나 방어군을 무너뜨리면 승리',
                '서쪽 다리·중앙 여울·동쪽 다리 중 약한 곳을 찾는다',
              ]
          ).map((t) => h('li', { text: t })),
        ]),
      ],
    );
    el.addEventListener('click', () => {
      picked = team;
      sides.forEach((s, i) => toggleClass(s, 'is-on', i === team));
    });
    return el;
  });
  return h('div', { class: 'sheet' }, [
    h('h1', { text: '갈대 여울' }),
    h('p', {
      text: '에른 고원 국경. 갈대강을 건널 곳은 서쪽 다리, 중앙 여울, 동쪽 다리 셋뿐이다. 남쪽 매봉 능선의 깃발을 두고 싸운다.',
    }),
    h('h2', { text: '진영 선택' }),
    h('div', { class: 'side-pick' }, sides),
    h('div', { class: 'actions' }, [button('배치로', () => onStart(picked), 'primary')]),
  ]);
}

export const KEY_HELP: [string, string][] = [
  ['좌클릭 / 드래그', '부대 선택 / 상자 선택 (Shift: 추가·해제)'],
  ['` (백틱)', '전군 선택'],
  ['Ctrl·Alt + 1~9', '선택을 그룹으로 저장'],
  ['1~9 (두 번: 카메라)', '그룹 선택 (Shift: 추가)'],
  ['우클릭 지면', '이동 (여러 부대는 상대 배치 유지)'],
  ['우클릭 드래그', '이동 + 정면·폭 지정 (끄는 방향이 부대 오른쪽)'],
  ['우클릭 적', '공격'],
  ['Z / C / X', '돌격 / 전진 / 고수'],
  ['F / G / H', '횡대 / 종대 / 산개'],
  ['Space, + / −', '일시정지(명령 가능), 배속 1×·2×·4×'],
  ['W A S D, 방향키', '카메라 이동'],
  ['Q / E, 가운데 버튼 드래그', '카메라 회전·기울기'],
  ['휠, Tab', '확대·축소, 전술 지도'],
  ['T / R', '지형 이동 계수 오버레이 / 궁수 사거리 상시'],
  ['Esc', '취소 · 메뉴'],
];

export function helpSheet(onClose: () => void): HTMLElement {
  return h('div', { class: 'sheet' }, [
    h('h1', { text: '조작법' }),
    h(
      'dl',
      { class: 'keys' },
      KEY_HELP.flatMap(([k, v]) => [
        h('dt', {}, [h('span', { class: 'ui-key', text: k })]),
        h('dd', { text: v }),
      ]),
    ),
    h('div', { class: 'actions' }, [button('닫기', onClose, 'primary')]),
  ]);
}

export function pauseMenuSheet(cb: {
  resume(): void;
  help(): void;
  surrender(): void;
  briefing(): void;
  inBattle: boolean;
}): HTMLElement {
  return h('div', { class: 'sheet narrow' }, [
    h('h1', { text: '메뉴' }),
    h('p', { text: '메뉴를 여는 동안 전투가 멈춘다.' }),
    h('div', { class: 'actions stack' }, [
      button('재개', cb.resume, 'primary'),
      button('조작법', cb.help),
      cb.inBattle
        ? button('포기 (패배로 기록)', cb.surrender, 'danger')
        : button('브리핑으로', cb.briefing),
    ]),
  ]);
}

/** 결과 화면(GDD §2, §9.3): 승패·사유, 통계, 패주 원인 상위 3개, 지형 활용 지표. */
export function resultSheet(
  result: BattleResult,
  player: TeamId | null,
  nameOf: (id: number) => string,
  teamOf: (id: number) => TeamId,
  scale: number,
  cb: { restart(): void; briefing(): void },
): HTMLElement {
  const win = result.winner;
  const title =
    win === -1
      ? '무승부'
      : player === null
        ? `${TEAM_NAMES[win]} 승리`
        : win === player
          ? '승리'
          : '패배';
  const cls = win === -1 || player === null ? '' : win === player ? 'win' : 'lose';
  const [a, b] = result.teams;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const rows: [string, string, string][] = [
    ['시작 병력', NUM.format(a.start), NUM.format(b.start)],
    ['남은 실질 병력', NUM.format(a.effective), NUM.format(b.effective)],
    ['패주 중', NUM.format(a.routing), NUM.format(b.routing)],
    ['손실', NUM.format(a.lost), NUM.format(b.lost)],
    ['처치', NUM.format(a.kills), NUM.format(b.kills)],
    ['고지에서 싸운 비율', pct(a.highGroundShare), pct(b.highGroundShare)],
    ['측면 공격', NUM.format(a.flankAttacks), NUM.format(b.flankAttacks)],
    ['후방 공격', NUM.format(a.rearAttacks), NUM.format(b.rearAttacks)],
  ];
  const causes = result.routCauses.slice(0, 3);
  return h('div', { class: 'sheet' }, [
    h('h1', { class: `result-title ${cls}`, text: title }),
    h('p', {
      text: `${resultReasonText(result.reason, result.winner, player)} · 전투 시간 ${formatClock(result.time)}`,
    }),
    scale !== 1 ? h('p', { class: 'scale-note', text: scaleNote(scale) }) : null,
    h('table', { class: 'stats' }, [
      h('thead', {}, [
        h('tr', {}, [
          h('th'),
          h('th', {}, [teamGlyph(0), ` ${TEAM_NAMES[0]}`]),
          h('th', {}, [teamGlyph(1), ` ${TEAM_NAMES[1]}`]),
        ]),
      ]),
      h(
        'tbody',
        {},
        rows.map(([k, v0, v1]) =>
          h('tr', {}, [h('td', { text: k }), h('td', { text: v0 }), h('td', { text: v1 })]),
        ),
      ),
    ]),
    h('h2', { text: '패주 원인 상위 3' }),
    causes.length === 0
      ? h('p', { text: '패주한 부대가 없다.' })
      : h(
          'ol',
          { class: 'causes' },
          causes.map((c) =>
            h('li', {}, [
              teamGlyph(teamOf(c.squad)),
              ` ${nameOf(c.squad)}: ${ROUT_CAUSE_TEXT[c.cause]} — 사기 −${Math.round(c.moraleLost)} (${formatClock(c.time)})`,
            ]),
          ),
        ),
    h('div', { class: 'actions' }, [
      button('브리핑으로', cb.briefing),
      button('다시 하기', cb.restart, 'primary'),
    ]),
  ]);
}
