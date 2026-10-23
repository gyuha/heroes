/**
 * 디자인 토큰(TS 쪽). 캔버스·three.js 오버레이가 쓰고, 같은 값을 styles.css 의 CSS 변수가 쓴다.
 * 근거와 사용 규칙은 docs/UI_UX_GUIDE.md §2.
 */
import type { TeamId } from '../sim/api';

/** 진영 색(ART_STYLE_GUIDE 진영 색). 진영을 표시하는 곳에만 쓴다. */
export const TEAM_FILL: Record<TeamId, string> = { 0: '#247DA8', 1: '#E4A33B' };
/** 진영 색 위에 올리는 글자·아이콘 색. 명도 대비를 반대로 둬 회색조에서도 구분된다. */
export const TEAM_INK: Record<TeamId, string> = { 0: '#E6DCC4', 1: '#28323D' };
/** 진영 마커 테두리. 청람 = 밝은 테두리, 황토 = 어두운 테두리. */
export const TEAM_RIM: Record<TeamId, string> = { 0: '#E6DCC4', 1: '#28323D' };

export const COLOR = {
  text: '#E6DCC4',
  textDim: '#A2A49D',
  ink: '#28323D',
  /** 선택·이동 명령 표시. 진영 색과 겹치지 않는 밝은 미색 */
  select: '#F4EFE2',
  /** 공격 표적 선 */
  attack: '#E5484D',
  ok: '#8DBA7A',
  warn: '#E8833A',
  danger: '#D94A3D',
} as const;

/**
 * 이동 계수 구간 색(GDD §6.5 경사 오버레이): 95% 이상 / 70~94 / 35~69 / 통과 불가(빗금).
 * GDD는 초록 경계를 100%로 적었지만, 평지의 1~2° 미세 기복까지 노랑이 되어 진짜 비탈이 묻히므로
 * 95%로 둔다(docs/UI_UX_GUIDE.md §5.3).
 */
export const FACTOR_BANDS = [
  { min: 0.95, color: '#4FA36B', label: '95% 이상 (평지와 비슷)' },
  { min: 0.7, color: '#E9CF5C', label: '70~94%' },
  { min: 0.001, color: '#E07B39', label: '35~69%' },
  { min: 0, color: '#C43C3C', label: '통과 불가' },
] as const;

export function factorColor(factor: number): string {
  for (const band of FACTOR_BANDS) if (factor >= band.min && band.min > 0) return band.color;
  return FACTOR_BANDS[3].color;
}

/** 사기 구간 색. 진영 색(청·황)과 겹치지 않게 녹·주황·적을 쓰고, 문자·아이콘을 함께 붙인다. */
export const MORALE_COLOR = {
  steady: COLOR.ok,
  wavering: COLOR.warn,
  routing: COLOR.danger,
} as const;

/** UI 배율: 1280×720 = 1, 2560×1440 = 1.75. 루트 글자 크기와 캔버스 마커 크기에 곱한다. */
export function uiScale(width: number, height: number): number {
  return Math.min(1.75, Math.max(1, Math.min(width / 1280, height / 720)));
}
