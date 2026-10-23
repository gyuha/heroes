import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../sim/api';
import type { EndReason, TeamId } from '../../sim/api';
import { formatClock, formatEvent, resultReasonText, type NameLookup } from './eventText';

const names: NameLookup = {
  name: (id) => ['청람 궁수 2대', '황토 기병 1대', '황토 창병 3대'][id],
  team: (id) => (id === 0 ? 0 : 1),
};
const base = { time: 12, x: 100, z: 200 };

describe('formatEvent', () => {
  it('GDD §6.5 예시 문장', () => {
    const cases: [SimEvent, string][] = [
      [
        { ...base, kind: 'chargeFailed', squad: 1, target: 0, reason: 'forest' },
        '황토 기병 1대: 돌격 실패 — 숲에서 속도 부족',
      ],
      [
        { ...base, kind: 'outOfRange', squad: 0, target: 2, heightDiff: -20, range: 96 },
        '청람 궁수 2대: 사거리 밖 — 표적이 20m 높음(사거리 96m)',
      ],
      [
        { ...base, kind: 'attacked', squad: 2, side: 'flank' },
        '황토 창병 3대: 측면 공격받음 — 사기 하락',
      ],
      [
        { ...base, kind: 'highGround', squad: 0, bonusPct: 18.2 },
        '청람 궁수 2대: 고지에서 싸우는 중 — 피해 +18%',
      ],
    ];
    for (const [e, text] of cases) expect(formatEvent(e, names)?.text).toBe(text);
  });

  it('주어 진영·위치·중요도를 함께 돌려준다', () => {
    const line = formatEvent({ ...base, kind: 'rout', squad: 2, cause: 'rear' }, names)!;
    expect(line).toMatchObject({
      team: 1,
      squad: 2,
      severity: 'critical',
      x: 100,
      z: 200,
      time: 12,
    });
    expect(line.text).toBe('황토 창병 3대: 패주 — 후방 공격');
  });

  it('지휘관 전사는 진영만, 결과·배치 단계 이벤트는 로그에 남기지 않는다', () => {
    expect(formatEvent({ ...base, kind: 'commanderKilled', team: 0 }, names)).toMatchObject({
      team: 0,
      squad: -1,
      severity: 'critical',
    });
    expect(formatEvent({ ...base, kind: 'phase', phase: 'result' }, names)).toBeNull();
    expect(formatEvent({ ...base, kind: 'phase', phase: 'battle' }, names)?.text).toBe('전투 시작');
  });
});

describe('formatClock', () => {
  it('m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65.9)).toBe('1:05');
    expect(formatClock(900)).toBe('15:00');
    expect(formatClock(-3)).toBe('0:00');
  });
});

describe('resultReasonText (QA-001)', () => {
  // 공격 = 황토(1), 방어 = 청람(0). 깃발 점령·붕괴는 어느 쪽이든 이길 수 있고, 시간 방어는 방어 승리.
  const player: [EndReason, TeamId, TeamId, string][] = [
    // 사유, 승자, 플레이어, 기대 문장
    ['flagCaptured', 1, 1, '깃발을 60초 동안 점령했다'],
    ['flagCaptured', 1, 0, '상대가 깃발을 60초 동안 점령했다'],
    ['timeHeld', 0, 0, '제한 시간까지 깃발을 지켰다'],
    ['timeHeld', 0, 1, '제한 시간 안에 깃발을 빼앗지 못했다'],
    ['collapse', 0, 0, '상대 군이 붕괴했다'],
    ['collapse', 0, 1, '아군이 붕괴했다'],
    ['collapse', 1, 1, '상대 군이 붕괴했다'],
    ['collapse', 1, 0, '아군이 붕괴했다'],
    ['surrender', 1, 0, '지휘를 포기했다'],
  ];
  it.each(player)('플레이어 관점: %s, 승자 %i, 플레이어 %i → %s', (reason, winner, team, text) => {
    expect(resultReasonText(reason, winner, team)).toBe(text);
  });

  const neutral: [EndReason, TeamId, string][] = [
    ['flagCaptured', 1, '황토가 깃발을 60초 동안 점령했다'],
    ['timeHeld', 0, '청람이 제한 시간까지 깃발을 지켰다'],
    ['collapse', 0, '황토가 붕괴했다'],
    ['collapse', 1, '청람이 붕괴했다'],
  ];
  it.each(neutral)('관전 관점: %s, 승자 %i → %s', (reason, winner, text) => {
    expect(resultReasonText(reason, winner, null)).toBe(text);
  });

  it('무승부는 관점과 관계없이 같다', () => {
    for (const p of [0, 1, null] as const) {
      expect(resultReasonText('draw', -1, p)).toBe('양군이 같은 때에 무너졌다');
    }
  });
});
