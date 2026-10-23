/**
 * 아이콘 경로(24×24 보기 상자, 선 굵기 2.2, 둥근 끝). 카드·버튼(SVG)과 전장 마커(캔버스 Path2D)가
 * 같은 경로를 쓴다. 병종 아이콘은 모델 실루엣의 특징(ART_STYLE_GUIDE 병종 실루엣)을 따른다.
 */
import type { UnitTypeId } from '../sim/api';

export type IconId =
  | UnitTypeId
  | 'commander'
  | 'move'
  | 'attack'
  | 'charge'
  | 'advance'
  | 'hold'
  | 'line'
  | 'column'
  | 'loose'
  | 'pause'
  | 'play'
  | 'shieldWall'
  | 'brace'
  | 'concealed'
  | 'narrow'
  | 'highGround'
  | 'bridge'
  | 'ford'
  | 'flag'
  | 'slope'
  | 'range'
  | 'map'
  | 'warn';

export const ICON_PATHS: Record<IconId, string> = {
  // 보병: 넓고 각진 방패 + 검
  infantry: 'M6 4h9v9c0 3.5-4.5 6-4.5 6S6 16.5 6 13zM18.5 3v12M16.5 13h4',
  // 창병: 길게 솟는 창 + 좁은 방패
  spearman: 'M12 2l2.4 5h-4.8zM12 7v15M7 11h3v6l-1.5 2L7 17z',
  // 궁수: 열린 활 곡선 + 시위 + 화살
  archer: 'M8 3c7 3 7 15 0 18M8 3v18M4 12h14M15 9l3 3-3 3',
  // 기병: 말머리 실루엣
  cavalry: 'M6 21l1.5-7L5 11l4-7 3 2 5 1 2 4-2 1.5-3-1.5-1 3 1 7',
  // 지휘관: 깃발
  commander: 'M7 21V3M7 4h11l-3 4 3 4H7',
  move: 'M5 19L19 5M19 5h-7M19 5v7',
  attack: 'M5 5l14 14M5 19L19 5M4 15l5 5M15 4l5 5',
  charge: 'M3 12h12M11 6l6 6-6 6M17 6l4 6-4 6',
  advance: 'M12 20V5M6 11l6-6 6 6M6 20h12',
  hold: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM9 12h6',
  line: 'M3 10h18M3 14h18',
  column: 'M10 3v18M14 3v18',
  loose: 'M5 6h.01M12 6h.01M19 6h.01M8.5 12h.01M15.5 12h.01M5 18h.01M12 18h.01M19 18h.01',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4l13 8-13 8z',
  shieldWall: 'M4 6h16M4 6v8l8 6 8-6V6M12 6v14',
  brace: 'M4 20L18 6M14 6h4v4M8 20L20 8',
  concealed: 'M12 3l6 9h-3l4 6H5l4-6H6zM12 18v3',
  narrow: 'M8 3v18M16 3v18M11 8l1-1 1 1M11 16l1 1 1-1',
  highGround: 'M3 20l6-9 4 5 3-4 5 8zM12 4v5M10 6l2-2 2 2',
  bridge: 'M3 9h18M3 15h18M6 9v6M12 9v6M18 9v6',
  ford: 'M3 9c3-2 6 2 9 0s6-2 9 0M3 15c3-2 6 2 9 0s6-2 9 0',
  flag: 'M6 21V3M6 4h12l-3 4 3 4H6',
  slope: 'M3 19L21 7M3 19h18M15 19v-8',
  range: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 12h.01M12 4v3',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG 아이콘 요소. 색은 currentColor. */
export function iconSvg(id: IconId, className = 'ui-icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATHS[id]);
  svg.appendChild(path);
  return svg;
}

const path2dCache = new Map<IconId, Path2D>();

/** 캔버스용 Path2D(24×24 좌표). */
export function iconPath2D(id: IconId): Path2D {
  let p = path2dCache.get(id);
  if (!p) {
    p = new Path2D(ICON_PATHS[id]);
    path2dCache.set(id, p);
  }
  return p;
}

export function squadIconId(type: UnitTypeId, isCommander: boolean): IconId {
  return isCommander ? 'commander' : type;
}
