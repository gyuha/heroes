import type { SimEvent, TeamId } from '../../sim/api';

export interface LogVisibility {
  team(squad: number): TeamId;
  /** 지금 플레이어에게 보이거나, 사라진 지 10초 안이라 잔상이 남아 있는가(괴멸 직후 판정용). */
  seen(squad: number): boolean;
  /** 진영의 지휘관 부대 id. 없으면 -1. */
  commanderOf(team: TeamId): number;
}

/**
 * 플레이어 이벤트 로그에 남길지(D-013).
 * - 아군 부대의 이벤트는 모두 남긴다.
 * - 적 부대의 이벤트는 그 부대가 보일 때 큰 사건만: 패주, 괴멸, 지휘관 전사, 아군에 대한 돌격 명중.
 *   적이 아군 부대와 교전을 시작한 것도 아군 부대의 사건이라 남긴다.
 * - 깃발 상태 변화와 단계 전환은 진영과 관계없이 남긴다.
 * - 관전(player = null)이면 모두 남긴다.
 */
export function shouldLog(e: SimEvent, player: TeamId | null, v: LogVisibility): boolean {
  if (player === null) return true;
  switch (e.kind) {
    case 'flag':
    case 'phase':
    case 'battleEnd':
      return true;
    case 'commanderKilled': {
      if (e.team === player) return true;
      const id = v.commanderOf(e.team);
      return id >= 0 && v.seen(id);
    }
    default:
      break;
  }
  if (v.team(e.squad) === player) return true;
  if (!v.seen(e.squad)) return false;
  switch (e.kind) {
    case 'rout':
    case 'destroyed':
      return true;
    case 'chargeImpact':
      return v.team(e.target) === player;
    case 'engage':
      return v.team(e.enemy) === player;
    default:
      // 사거리 밖, 돌격 실패, 고지 교전, 측면·후방 피격, 재집결: 적의 내부 판정이라 숨긴다.
      return false;
  }
}
