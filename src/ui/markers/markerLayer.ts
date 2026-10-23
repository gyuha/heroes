import type { MoraleBand, SquadState, TeamId } from '../../sim/api';
import { type IconId, iconPath2D } from '../icons';
import { COLOR, MORALE_COLOR, TEAM_FILL, TEAM_INK, TEAM_RIM } from '../theme';

/** 한 프레임에 그릴 마커 하나. 화면 좌표는 CSS px. */
export interface MarkerItem {
  id: number;
  team: TeamId;
  icon: IconId;
  sx: number;
  sy: number;
  count: number;
  morale: number;
  moraleBand: MoraleBand;
  state: SquadState;
  own: boolean;
  selected: boolean;
  hovered: boolean;
  /** 마지막으로 본 위치의 잔상(GDD §6.4) */
  ghost: boolean;
  group: number | null;
  concealed: boolean;
  /** 1 = 기본 크기 */
  size: number;
  showCount: boolean;
}

export interface FeatureItem {
  kind: 'bridge' | 'ford';
  sx: number;
  sy: number;
}

export interface SelectionBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const BASE_RADIUS = 13;
/** 병력 수 → 문자열 캐시(매 프레임 마커마다 문자열을 만들지 않게). */
const countLabels: string[] = [];
function countLabel(n: number): string {
  return countLabels[n] ?? (countLabels[n] = String(n));
}
/** 모션 줄이기 설정이면 패주 마커를 깜빡이지 않는다. */
const REDUCE_MOTION =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 전장 위 부대 마커(2D 캔버스 한 장). 진영은 색만이 아니라 모양(청람 = 원, 황토 = 마름모)과
 * 명도 극성(청람 = 어두운 바탕·밝은 테두리, 황토 = 밝은 바탕·어두운 테두리)으로도 구분해
 * 회색조·색각 이상에서도 읽히게 한다(ART_STYLE_GUIDE 접근성 요구).
 * 선택 표시는 진영 색을 덮지 않는 별도 형태(모서리 괄호)로 그린다.
 */
export class MarkerLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private uiScale = 1;
  private countFont = '';
  private badgeFont = '';

  /** UI 배율(theme.uiScale). 글꼴 문자열도 여기서 한 번만 만든다. */
  get scale(): number {
    return this.uiScale;
  }
  set scale(v: number) {
    this.uiScale = v;
    this.countFont = `600 ${Math.round(10.5 * v)}px ${FONT}`;
    this.badgeFont = `700 ${Math.round(9 * v)}px ${FONT}`;
  }

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ui-markers';
    parent.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다');
    this.ctx = ctx;
    this.scale = 1;
  }

  resize(width: number, height: number, dpr: number): void {
    this.cssWidth = width;
    this.cssHeight = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  /** 마커 반지름(px). 입력 판정에도 쓴다. */
  radius(size = 1): number {
    return BASE_RADIUS * this.scale * size;
  }

  draw(
    items: readonly MarkerItem[],
    box: SelectionBox | null,
    timeSec: number,
    features: readonly FeatureItem[] = [],
  ): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    for (const f of features) this.drawFeature(f);
    // 잔상 → 적 → 아군 → 선택 순으로 위에 그린다.
    const order = (m: MarkerItem) => (m.ghost ? 0 : m.selected ? 3 : m.own ? 2 : 1);
    // 호출하는 쪽의 재사용 배열을 그대로 정렬한다(복사 없음).
    const sorted = items as MarkerItem[];
    sorted.sort((a, b) => order(a) - order(b) || a.sy - b.sy);
    this.labelCount = 0;
    this.labelOk.clear();
    // 위에 그려지는(중요한) 마커가 라벨 자리를 먼저 차지하도록 역순으로 자리를 잡는다.
    for (let i = sorted.length - 1; i >= 0; i--) this.reserveLabel(sorted[i]);
    for (const m of sorted) this.drawMarker(m, timeSec);
    if (box) this.drawBox(box);
  }

  private drawMarker(m: MarkerItem, timeSec: number): void {
    const ctx = this.ctx;
    const r = this.radius(m.size);
    ctx.save();
    ctx.translate(m.sx, m.sy);

    if (m.ghost) {
      ctx.globalAlpha = 0.55;
      this.shapePath(m.team, r);
      ctx.setLineDash([3 * this.scale, 3 * this.scale]);
      ctx.lineWidth = 2 * this.scale;
      ctx.strokeStyle = TEAM_FILL[m.team];
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }

    const routing = m.state === 'routing';
    if (routing)
      ctx.globalAlpha = REDUCE_MOTION ? 0.75 : 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(timeSec * 8));

    // 지면 대비용 어두운 외곽
    this.shapePath(m.team, r + 1.5 * this.scale);
    ctx.fillStyle = 'rgba(12,16,20,0.55)';
    ctx.fill();
    // 바탕
    this.shapePath(m.team, r);
    ctx.fillStyle = TEAM_FILL[m.team];
    ctx.fill();
    ctx.lineWidth = 2 * this.scale;
    ctx.strokeStyle = TEAM_RIM[m.team];
    ctx.stroke();
    // 병종 아이콘
    const iconSize = r * 1.15;
    ctx.save();
    ctx.translate(-iconSize / 2, -iconSize / 2);
    ctx.scale(iconSize / 24, iconSize / 24);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = TEAM_INK[m.team];
    ctx.stroke(iconPath2D(m.icon));
    ctx.restore();
    ctx.globalAlpha = 1;

    // 아군 사기 막대
    if (m.own) {
      const w = r * 2;
      const h = 3 * this.scale;
      const y = r + 3 * this.scale;
      ctx.fillStyle = 'rgba(12,16,20,0.75)';
      ctx.fillRect(-w / 2 - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = MORALE_COLOR[m.moraleBand];
      ctx.fillRect(-w / 2, y, (w * Math.max(0, Math.min(100, m.morale))) / 100, h);
    }
    // 병력 수
    if (m.showCount && this.labelOk.has(m.id)) {
      const y = r + (m.own ? 9 : 4) * this.scale;
      ctx.font = this.countFont;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3 * this.scale;
      ctx.strokeStyle = 'rgba(12,16,20,0.85)';
      ctx.strokeText(countLabel(m.count), 0, y);
      ctx.fillStyle = COLOR.text;
      ctx.fillText(countLabel(m.count), 0, y);
    }
    // 그룹 번호(왼쪽 위)
    if (m.group !== null) this.badge(-r * 0.95, -r * 0.95, String(m.group), COLOR.ink, COLOR.text);
    // 상태 배지(오른쪽 위): 패주 > 동요 > 은폐
    if (routing) this.badge(r * 0.95, -r * 0.95, '패', COLOR.danger, '#fff');
    else if (m.moraleBand === 'wavering')
      this.badge(r * 0.95, -r * 0.95, '!', COLOR.warn, COLOR.ink);
    else if (m.concealed) this.badge(r * 0.95, -r * 0.95, '숲', '#3F5C4E', COLOR.text);

    // 선택·마우스 오버: 진영 색을 덮지 않는 모서리 괄호
    if (m.selected || m.hovered) {
      const e = r + 5 * this.scale;
      const l = r * 0.7;
      ctx.lineWidth = (m.selected ? 2.5 : 1.5) * this.scale;
      ctx.strokeStyle = m.selected ? COLOR.select : 'rgba(244,239,226,0.7)';
      ctx.beginPath();
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        ctx.moveTo(sx * e, sy * (e - l));
        ctx.lineTo(sx * e, sy * e);
        ctx.lineTo(sx * (e - l), sy * e);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 진영별 모양: 청람 = 원, 황토 = 마름모(넓이를 비슷하게 맞춤). */
  /** 라벨·마커 자리 상자(x0, y0, x1, y1) 재사용 버퍼 */
  private labelBoxes = new Float32Array(4 * 256);
  private labelCount = 0;
  private readonly labelOk = new Set<number>();

  /** 병력 수 라벨이 다른 라벨·마커와 겹치면 그리지 않는다. */
  private reserveLabel(m: MarkerItem): void {
    if (!m.showCount || m.ghost) return;
    const r = this.radius(m.size);
    const w = 24 * this.scale;
    const y = m.sy + r + (m.own ? 9 : 4) * this.scale;
    const x0 = m.sx - w / 2;
    const x1 = m.sx + w / 2;
    const y1 = y + 12 * this.scale;
    const boxes = this.labelBoxes;
    for (let i = 0; i < this.labelCount; i++) {
      const o = i * 4;
      if (x0 < boxes[o + 2] && x1 > boxes[o] && y < boxes[o + 3] && y1 > boxes[o + 1]) return;
    }
    if ((this.labelCount + 2) * 4 > boxes.length) {
      const grown = new Float32Array(boxes.length * 2);
      grown.set(boxes);
      this.labelBoxes = grown;
    }
    this.pushBox(x0, y, x1, y1);
    this.pushBox(m.sx - r, m.sy - r, m.sx + r, m.sy + r);
    this.labelOk.add(m.id);
  }

  private pushBox(x0: number, y0: number, x1: number, y1: number): void {
    const o = this.labelCount++ * 4;
    this.labelBoxes[o] = x0;
    this.labelBoxes[o + 1] = y0;
    this.labelBoxes[o + 2] = x1;
    this.labelBoxes[o + 3] = y1;
  }

  private shapePath(team: TeamId, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    if (team === 0) {
      ctx.arc(0, 0, r, 0, Math.PI * 2);
    } else {
      const d = r * 1.22;
      ctx.moveTo(0, -d);
      ctx.lineTo(d, 0);
      ctx.lineTo(0, d);
      ctx.lineTo(-d, 0);
      ctx.closePath();
    }
  }

  /** 전술 지도의 병목 아이콘(다리·여울, GDD §6.5). 진영 마커와 헷갈리지 않게 각진 어두운 판에 그린다. */
  private drawFeature(f: FeatureItem): void {
    const ctx = this.ctx;
    const s = 22 * this.scale;
    ctx.save();
    ctx.translate(f.sx - s / 2, f.sy - s / 2);
    ctx.fillStyle = 'rgba(16,21,26,0.85)';
    ctx.strokeStyle = 'rgba(230,220,196,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0, 0, s, s, 3 * this.scale);
    ctx.fill();
    ctx.stroke();
    ctx.translate(s * 0.12, s * 0.12);
    ctx.scale((s * 0.76) / 24, (s * 0.76) / 24);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = COLOR.text;
    ctx.stroke(iconPath2D(f.kind));
    ctx.restore();
  }

  private badge(x: number, y: number, text: string, bg: string, fg: string): void {
    const ctx = this.ctx;
    const r = 6.5 * this.scale;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 1.2 * this.scale;
    ctx.strokeStyle = 'rgba(12,16,20,0.8)';
    ctx.stroke();
    ctx.font = this.badgeFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = fg;
    ctx.fillText(text, x, y + 0.5);
  }

  private drawBox(b: SelectionBox): void {
    const ctx = this.ctx;
    const x = Math.min(b.x0, b.x1);
    const y = Math.min(b.y0, b.y1);
    const w = Math.abs(b.x1 - b.x0);
    const h = Math.abs(b.y1 - b.y0);
    ctx.fillStyle = 'rgba(244,239,226,0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = COLOR.select;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]);
  }

  dispose(): void {
    this.canvas.remove();
  }
}

export const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif';
