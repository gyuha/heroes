/**
 * 병사 한 명의 애니메이션 클립을 시뮬레이션 사실(틱 기록, 속도)에서 고른다(ARCHITECTURE §11.5).
 * 순수 함수: three.js 없이 테스트한다. 렌더 루프에서 병사마다 부르므로 객체를 만들지 않고 out 배열에 쓴다.
 *
 * 틱 k 에 기록된 사건은 틱 k-1 → k 보간 구간이 시작할 때 일어난 것으로 본다.
 * 따라서 화면 시각을 틱 단위 nowTick = simTick + alpha 로 받고, 경과 = (nowTick - k) × tickDt 로 계산한다
 * (k = simTick 이고 alpha = 0 일 때 경과 0).
 */
import { AnimClip, type AnimClipId } from './clipTable';

/** 병종마다 한 번 만들어 두는 선택 기준. */
export interface ClipRules {
  /** 이 속도(m/s)를 넘으면 walk */
  walkThreshold: number;
  /** 이 속도(m/s)를 넘으면 run. (걷기 + 달리기 속도) / 2 */
  runThreshold: number;
  /** 다음 타격 예상 간격(초). 이 간격 - hitTime 부터 다음 휘두르기 준비 동작을 시작한다 */
  attackInterval: number;
  /** 마지막 타격 후 attack 을 유지하는 시간(초). 이 시간이 지나면 교전이 끝난 것으로 본다 */
  attackWindow: number;
  /** attack 클립 길이(초) */
  attackDuration: number;
  /** attack 클립 시작부터 타격 순간까지(초) */
  hitTime: number;
  /** hit 클립 길이(초). 0 이면 hit 을 고르지 않는다 */
  hitDuration: number;
  /** walk 클립 1배속의 이동 속도(m/s). 0 = 모름 → 재생 속도 1 */
  walkRefSpeed: number;
  /** run 클립 1배속의 이동 속도(m/s). 0 = 모름 → 재생 속도 1 */
  runRefSpeed: number;
}

/** 이 속도(m/s) 이하면 서 있는 것으로 본다(§11.5). */
export const WALK_THRESHOLD = 0.1;

/**
 * 클립을 고른다. 반환 = 클립 번호.
 * - 한 번 재생 클립(attack, hit, die): out[0] = 클립 시간(초). die 는 셰이더가 마지막 프레임에서 멈춘다.
 * - 반복 클립(idle, walk, run): out[1] = 재생 속도(1 = 원래 속도). 시간은 호출자가 위상을 누적해 정한다.
 *
 * 우선순위: die > hit > attack > run > walk > idle.
 */
export function chooseClip(
  rules: ClipRules,
  nowTick: number,
  tickDt: number,
  deathTick: number,
  lastHitTick: number,
  lastAttackTick: number,
  speed: number,
  out: Float32Array | Float64Array,
): AnimClipId {
  if (deathTick >= 0) {
    const e = (nowTick - deathTick) * tickDt;
    out[0] = e > 0 ? e : 0;
    return AnimClip.Die;
  }
  if (lastHitTick >= 0 && rules.hitDuration > 0) {
    const e = (nowTick - lastHitTick) * tickDt;
    if (e >= 0 && e < rules.hitDuration) {
      out[0] = e;
      return AnimClip.Hit;
    }
  }
  if (lastAttackTick >= 0) {
    const e = (nowTick - lastAttackTick) * tickDt;
    if (e >= 0 && e < rules.attackWindow) {
      // 방금 친 타격의 후속 동작: 클립의 hitTime 이 sim 타격 순간에 오도록 맞춘다.
      // 교전 첫 타격은 미리 알 수 없으므로 준비 동작 없이 hitTime 지점부터 재생된다.
      const follow = e + rules.hitTime;
      if (follow < rules.attackDuration) {
        out[0] = follow;
        return AnimClip.Attack;
      }
      // 다음 타격 예상 시각(lastAttack + 간격)에 hitTime 이 오도록 미리 휘두르기 시작한다.
      const lead = e - (rules.attackInterval - rules.hitTime);
      if (lead >= 0) {
        out[0] = lead;
        return AnimClip.Attack;
      }
    }
  }
  if (speed > rules.runThreshold) {
    out[1] = rules.runRefSpeed > 0 ? speed / rules.runRefSpeed : 1;
    return AnimClip.Run;
  }
  if (speed > rules.walkThreshold) {
    out[1] = rules.walkRefSpeed > 0 ? speed / rules.walkRefSpeed : 1;
    return AnimClip.Walk;
  }
  out[1] = 1;
  return AnimClip.Idle;
}
