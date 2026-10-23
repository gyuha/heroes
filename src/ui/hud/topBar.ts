import type { FlagView, TeamId, TeamStrength } from '../../sim/api';
import { iconSvg } from '../icons';
import { NUM, h, setNum, setText, setWidthPct, teamGlyph, toggleClass } from './dom';
import { TEAM_NAMES, formatClock } from './eventText';

interface ForceEls {
  root: HTMLElement;
  num: HTMLElement;
  sub: HTMLElement;
  eff: HTMLElement;
  rout: HTMLElement;
  lastRouting: number;
  lastLost: number;
}

/**
 * 상단 띠(GDD §9.2): 양군 병력 막대(실질 / 패주 중 / 손실), 전투 시간·제한 시간, 깃발 목표 띠.
 * 플레이어 진영을 왼쪽에 둔다. 막대 길이는 시작 병력이 많은 쪽 기준으로 같은 축척이다.
 */
export class TopBar {
  readonly root: HTMLElement;
  private readonly forces: [ForceEls, ForceEls];
  private readonly time: HTMLElement;
  private readonly limit: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly objText: HTMLElement;
  private readonly objFill: HTMLElement;
  private leftTeam: TeamId = 0;
  private textKey = '';
  private lastScale = 1;
  private readonly scaleTag: HTMLElement;

  constructor(parent: HTMLElement) {
    this.forces = [this.force(0), this.force(1)];
    this.time = h('span', { class: 'clock-time', text: '0:00' });
    this.limit = h('span', { class: 'clock-limit', text: '/ 15:00' });
    this.objFill = h('span');
    this.objText = h('span', { text: '깃발: 방어 중' });
    this.objective = h('div', { class: 'objective' }, [
      iconSvg('flag'),
      this.objText,
      h('div', { class: 'objective-bar' }, [this.objFill]),
    ]);
    this.scaleTag = h('span', { class: 'scale-tag', attrs: { hidden: '' } });
    const clock = h('div', { class: 'clock' }, [
      h('div', {}, [this.time, ' ', this.limit]),
      this.objective,
      this.scaleTag,
    ]);
    this.root = h('div', { class: 'hud-top ui-panel' }, [
      this.forces[0].root,
      clock,
      this.forces[1].root,
    ]);
    parent.appendChild(this.root);
  }

  update(
    player: TeamId,
    strength: (t: TeamId) => TeamStrength,
    flag: FlagView,
    battleTime: number,
    timeLimit: number,
    troopScale = 1,
  ): void {
    if (player !== this.leftTeam) {
      this.leftTeam = player;
      // 플레이어 진영이 왼쪽
      const [a, b] =
        player === 0 ? [this.forces[0], this.forces[1]] : [this.forces[1], this.forces[0]];
      this.root.replaceChildren(a.root, this.root.children[1], b.root);
      toggleClass(a.root, 'right', false);
      toggleClass(b.root, 'right', true);
    }
    const s0 = strength(0);
    const s1 = strength(1);
    const barMax = Math.max(s0.start, s1.start, 1);
    this.fill(this.forces[0], s0, barMax);
    this.fill(this.forces[1], s1, barMax);

    // 문자열은 표시 값(초 단위)이 바뀔 때만 만든다.
    const sec = Math.floor(battleTime);
    const progress = Math.floor(flag.progress);
    const key = `${sec}|${flag.overtime ? 1 : 0}|${flag.state}|${progress}`;
    if (key !== this.textKey) {
      this.textKey = key;
      setText(this.time, formatClock(battleTime));
      setText(this.limit, flag.overtime ? '연장전' : `/ ${formatClock(timeLimit)}`);
      const text =
        flag.state === 'capturing'
          ? `깃발 점령 중 ${progress}/${flag.captureTime}초`
          : flag.state === 'empty'
            ? flag.progress > 0
              ? `깃발 비어 있음 ${progress}/${flag.captureTime}초`
              : '깃발 비어 있음'
            : '깃발 방어 중';
      setText(this.objText, text);
    }
    setWidthPct(this.objFill, flag.progress / flag.captureTime);
    toggleClass(this.objective, 'capturing', flag.state === 'capturing');
    toggleClass(this.root, 'overtime', flag.overtime);
    if (troopScale !== this.lastScale) {
      this.lastScale = troopScale;
      this.scaleTag.hidden = troopScale === 1;
      setText(this.scaleTag, `측정용 병력 ×${Number(troopScale.toFixed(2))}`);
    }
  }

  private force(team: TeamId): ForceEls {
    const num = h('span', { class: 'force-num', text: '0' });
    const sub = h('span', { class: 'force-sub' });
    const eff = h('span', { class: `eff t${team}` });
    const rout = h('span', { class: 'rout' });
    const root = h('div', { class: `force${team === 1 ? ' right' : ''}` }, [
      h('div', { class: 'force-head' }, [
        teamGlyph(team),
        h('span', { class: 'force-name', text: TEAM_NAMES[team] }),
        num,
        sub,
      ]),
      h(
        'div',
        { class: 'force-bar', attrs: { role: 'img', 'aria-label': `${TEAM_NAMES[team]} 병력` } },
        [eff, rout],
      ),
    ]);
    return { root, num, sub, eff, rout, lastRouting: -1, lastLost: -1 };
  }

  private fill(el: ForceEls, s: TeamStrength, scale: number): void {
    setNum(el.num, s.effective);
    if (el.lastRouting !== s.routing || el.lastLost !== s.lost) {
      el.lastRouting = s.routing;
      el.lastLost = s.lost;
      setText(el.sub, `패주 ${NUM.format(s.routing)} · 손실 ${NUM.format(s.lost)}`);
    }
    setWidthPct(el.eff, s.effective / scale);
    setWidthPct(el.rout, s.routing / scale);
  }
}
