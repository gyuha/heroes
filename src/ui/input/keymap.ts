import type { FormationId, GameSpeed } from '../../sim/api';

/**
 * 키 배치 최종안(docs/UI_UX_GUIDE.md §4). 카메라 키(WASD·방향키·Q·E)는 RtsCamera가 직접 읽으므로
 * 여기서는 다루지 않는다. KeyboardEvent.code(물리 키 위치)를 써서 한글 입력 상태와 자판 배열에 영향받지 않는다.
 */
export type KeyAction =
  | { readonly kind: 'selectAll' }
  | { readonly kind: 'saveGroup'; readonly group: number }
  | { readonly kind: 'recallGroup'; readonly group: number; readonly additive: boolean }
  | { readonly kind: 'charge' }
  | { readonly kind: 'advance' }
  | { readonly kind: 'hold' }
  | { readonly kind: 'formation'; readonly formation: FormationId }
  | { readonly kind: 'togglePause' }
  | { readonly kind: 'speedUp' }
  | { readonly kind: 'speedDown' }
  | { readonly kind: 'toggleSlopeOverlay' }
  | { readonly kind: 'toggleRangeOverlay' }
  | { readonly kind: 'toggleTacticalMap' }
  | { readonly kind: 'cancel' };

export interface KeyInput {
  readonly code: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

const FORMATION_KEYS: Record<string, FormationId> = {
  KeyF: 'line',
  KeyG: 'column',
  KeyH: 'loose',
};

const SIMPLE_KEYS: Record<string, KeyAction> = {
  Backquote: { kind: 'selectAll' },
  KeyZ: { kind: 'charge' },
  KeyC: { kind: 'advance' },
  KeyX: { kind: 'hold' },
  Space: { kind: 'togglePause' },
  Equal: { kind: 'speedUp' },
  NumpadAdd: { kind: 'speedUp' },
  Minus: { kind: 'speedDown' },
  NumpadSubtract: { kind: 'speedDown' },
  KeyT: { kind: 'toggleSlopeOverlay' },
  KeyR: { kind: 'toggleRangeOverlay' },
  Tab: { kind: 'toggleTacticalMap' },
  Escape: { kind: 'cancel' },
};

function digitOf(code: string): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return m ? Number(m[1]) : null;
}

/** 키 입력 → 동작. 해당 없으면 null. Cmd(meta) 조합은 브라우저 단축키로 남겨 둔다. */
export function mapKey(e: KeyInput): KeyAction | null {
  if (e.metaKey) return null;
  const digit = digitOf(e.code);
  if (digit !== null) {
    // Ctrl+숫자는 Windows Chrome에서 탭 전환으로 먹힐 수 있어 Alt+숫자도 받는다.
    if (e.ctrlKey || e.altKey) return { kind: 'saveGroup', group: digit };
    return { kind: 'recallGroup', group: digit, additive: e.shiftKey };
  }
  if (e.ctrlKey || e.altKey) return null;
  const formation = FORMATION_KEYS[e.code];
  if (formation) return { kind: 'formation', formation };
  return SIMPLE_KEYS[e.code] ?? null;
}

/** 버튼·도움말에 보여 줄 키 이름. */
export const KEY_LABELS = {
  charge: 'Z',
  advance: 'C',
  hold: 'X',
  line: 'F',
  column: 'G',
  loose: 'H',
  pause: 'Space',
  slope: 'T',
  range: 'R',
  tactical: 'Tab',
} as const;

const SPEEDS = [1, 2, 4] as const;

/** 배속 한 단계 올리기(+1)·내리기(−1). 끝에서는 그대로. */
export function stepSpeed(speed: GameSpeed, dir: 1 | -1): GameSpeed {
  const i = SPEEDS.indexOf(speed);
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + dir))];
}
