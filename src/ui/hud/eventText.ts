import type { ChargeFailReason, EndReason, RoutCause, Side, SimEvent, TeamId } from '../../sim/api';

export type LogSeverity = 'info' | 'warn' | 'critical';

export interface LogLine {
  readonly text: string;
  readonly severity: LogSeverity;
  /** 문장의 주어 진영. 진영 마커 모양을 앞에 붙인다. */
  readonly team: TeamId | null;
  /** 주어 부대(-1 = 없음). 안개 필터에 쓴다. */
  readonly squad: number;
  readonly time: number;
  readonly x: number;
  readonly z: number;
}

export interface NameLookup {
  name(squad: number): string;
  team(squad: number): TeamId;
}

export const TEAM_NAMES: Record<TeamId, string> = { 0: '청람', 1: '황토' };

const SIDE_TEXT: Record<Side, string> = { front: '정면', flank: '측면', rear: '후방' };

const CHARGE_FAIL_TEXT: Record<ChargeFailReason, string> = {
  forest: '숲에서 속도 부족',
  ford: '여울에서 속도 부족',
  uphill: '오르막에서 속도 부족',
  shortRunUp: '도움닫기 거리 부족',
  bracedFront: '창병 정면에 막힘',
};

export const ROUT_CAUSE_TEXT: Record<RoutCause, string> = {
  losses: '병력 손실',
  melee: '긴 근접전',
  flank: '측면 공격',
  rear: '후방 공격',
  charge: '돌격 충격',
  nearbyRout: '옆 부대 패주',
  commanderDeath: '지휘관 전사',
  arrows: '화살 세례',
};

/** 진영 이름 + 주격 조사(청람이 / 황토가). */
function teamSubject(team: TeamId): string {
  return team === 0 ? '청람이' : '황토가';
}

/**
 * 결과 화면 사유 문장(QA-001). 플레이어 진영 관점으로 쓰고, 관전(player = null)이면 중립 관점으로
 * 진영 이름을 넣는다. winner = -1 은 무승부.
 */
export function resultReasonText(
  reason: EndReason,
  winner: TeamId | -1,
  player: TeamId | null,
): string {
  if (reason === 'draw' || winner === -1) return '양군이 같은 때에 무너졌다';
  const loser: TeamId = winner === 0 ? 1 : 0;
  if (player === null) {
    switch (reason) {
      case 'flagCaptured':
        return `${teamSubject(winner)} 깃발을 60초 동안 점령했다`;
      case 'timeHeld':
        return `${teamSubject(winner)} 제한 시간까지 깃발을 지켰다`;
      case 'collapse':
        return `${teamSubject(loser)} 붕괴했다`;
      case 'surrender':
        return `${teamSubject(loser)} 지휘를 포기했다`;
    }
  }
  const won = winner === player;
  switch (reason) {
    case 'flagCaptured':
      return won ? '깃발을 60초 동안 점령했다' : '상대가 깃발을 60초 동안 점령했다';
    case 'timeHeld':
      return won ? '제한 시간까지 깃발을 지켰다' : '제한 시간 안에 깃발을 빼앗지 못했다';
    case 'collapse':
      return won ? '상대 군이 붕괴했다' : '아군이 붕괴했다';
    case 'surrender':
      return won ? '상대가 지휘를 포기했다' : '지휘를 포기했다';
  }
}

/**
 * sim 이벤트 → 로그 문장(GDD §6.5 예시 형식 "부대: 결과 — 원인"). 로그에 남기지 않는 이벤트는 null.
 * 같은 원인 10초 제한은 sim이 이미 적용한다(§2.4).
 */
export function formatEvent(e: SimEvent, names: NameLookup): LogLine | null {
  const line = (squad: number, text: string, severity: LogSeverity): LogLine => ({
    text,
    severity,
    team: squad >= 0 ? names.team(squad) : null,
    squad,
    time: e.time,
    x: e.x,
    z: e.z,
  });

  switch (e.kind) {
    case 'engage':
      return line(e.squad, `${names.name(e.squad)}: ${names.name(e.enemy)}와 교전`, 'info');
    case 'chargeImpact':
      return line(
        e.squad,
        `${names.name(e.squad)}: 돌격 — ${names.name(e.target)} ${SIDE_TEXT[e.side]}` +
          (e.braced ? ', 창벽에 막힘' : `, ${e.kills}명`),
        e.side === 'front' ? 'info' : 'warn',
      );
    case 'chargeFailed':
      return line(
        e.squad,
        `${names.name(e.squad)}: 돌격 실패 — ${CHARGE_FAIL_TEXT[e.reason]}`,
        'warn',
      );
    case 'attacked':
      return line(
        e.squad,
        `${names.name(e.squad)}: ${SIDE_TEXT[e.side]} 공격받음 — 사기 하락`,
        'warn',
      );
    case 'highGround':
      return line(
        e.squad,
        `${names.name(e.squad)}: 고지에서 싸우는 중 — 피해 +${Math.round(e.bonusPct)}%`,
        'info',
      );
    case 'outOfRange': {
      // heightDiff = 사수 지면 − 표적 지면(A의 archerRange와 같은 부호). 음수면 표적이 높다.
      const dh = Math.round(e.heightDiff);
      const where = dh < 0 ? `표적이 ${-dh}m 높음` : dh > 0 ? `표적이 ${dh}m 낮음` : '같은 높이';
      return line(
        e.squad,
        `${names.name(e.squad)}: 사거리 밖 — ${where}(사거리 ${Math.round(e.range)}m)`,
        'warn',
      );
    }
    case 'rout':
      return line(
        e.squad,
        `${names.name(e.squad)}: 패주 — ${ROUT_CAUSE_TEXT[e.cause]}`,
        'critical',
      );
    case 'rally':
      return line(e.squad, `${names.name(e.squad)}: 재집결`, 'info');
    case 'destroyed': {
      const why = { wiped: '전멸', fled: '전장 이탈', edge: '전장 밖으로 도주' }[e.reason];
      return line(e.squad, `${names.name(e.squad)}: 괴멸 — ${why}`, 'critical');
    }
    case 'commanderKilled':
      return {
        ...line(-1, `${TEAM_NAMES[e.team]} 지휘관 전사 — 주변 부대 사기 급락`, 'critical'),
        team: e.team,
      };
    case 'flag': {
      const text =
        e.state === 'capturing'
          ? '깃발: 점령 진행 중'
          : e.state === 'defended'
            ? '깃발: 방어 중'
            : '깃발: 구역이 비었다';
      return line(-1, text, e.state === 'capturing' ? 'critical' : 'info');
    }
    case 'phase':
      return e.phase === 'battle' ? line(-1, '전투 시작', 'info') : null;
    case 'battleEnd':
      return null;
  }
}

/** 초 → "m:ss" */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
