import { describe, expect, it } from 'vitest';
import { chooseClip, type ClipRules } from './clipSelect';
import { AnimClip } from './clipTable';

const DT = 1 / 20;
// 보병: 걷기 2, 달리기 4, 근접 1.5초, attack 0.8초(접촉 0.4초), hit 0.3초
const MELEE: ClipRules = {
  walkThreshold: 0.1,
  runThreshold: 3,
  attackInterval: 1.5,
  attackWindow: 1.65,
  attackDuration: 0.8,
  hitTime: 0.4,
  hitDuration: 0.3,
  walkRefSpeed: 2,
  runRefSpeed: 4,
};
// 궁수: 4초마다 발사, 1초 동안만 attack(방출 0.533초)
const ARCHER: ClipRules = { ...MELEE, attackInterval: 4, attackWindow: 1, hitTime: 16 / 30 };

const out = new Float64Array(2);
const pick = (
  rules: ClipRules,
  now: number,
  death: number,
  hit: number,
  attack: number,
  speed = 0,
) => chooseClip(rules, now, DT, death, hit, attack, speed, out);

describe('chooseClip 우선순위', () => {
  it('die > hit > attack > 이동', () => {
    expect(pick(MELEE, 100, 99, 99, 99, 5)).toBe(AnimClip.Die);
    expect(pick(MELEE, 100, -1, 99, 99, 5)).toBe(AnimClip.Hit);
    expect(pick(MELEE, 100, -1, -1, 99, 5)).toBe(AnimClip.Attack);
    expect(pick(MELEE, 100, -1, -1, -1, 5)).toBe(AnimClip.Run);
  });
});

describe('die', () => {
  it('사망 틱부터 경과 시간을 재고 음수가 되지 않는다', () => {
    expect(pick(MELEE, 110.5, 100, -1, -1)).toBe(AnimClip.Die);
    expect(out[0]).toBeCloseTo(0.525, 6);
    pick(MELEE, 99.5, 100, -1, -1);
    expect(out[0]).toBe(0);
  });
  it('오래 지나도 die 를 유지한다(셰이더가 마지막 자세에서 멈춤)', () => {
    expect(pick(MELEE, 10000, 100, -1, -1)).toBe(AnimClip.Die);
    expect(out[0]).toBeGreaterThan(400);
  });
});

describe('hit', () => {
  it('hit 클립 길이 안에서만 hit', () => {
    expect(pick(MELEE, 105, -1, 100, -1)).toBe(AnimClip.Hit); // 0.25초
    expect(out[0]).toBeCloseTo(0.25, 6);
    expect(pick(MELEE, 106, -1, 100, -1)).toBe(AnimClip.Idle); // 0.3초 = 끝
  });
  it('hit 클립이 없으면(길이 0) 고르지 않는다', () => {
    expect(pick({ ...MELEE, hitDuration: 0 }, 101, -1, 100, -1)).toBe(AnimClip.Idle);
  });
});

describe('attack', () => {
  it('타격 틱에 클립의 접촉 프레임(hitTime)이 온다', () => {
    expect(pick(MELEE, 100, -1, -1, 100)).toBe(AnimClip.Attack);
    expect(out[0]).toBeCloseTo(0.4, 6);
    pick(MELEE, 104, -1, -1, 100); // 0.2초 뒤
    expect(out[0]).toBeCloseTo(0.6, 6);
  });
  it('후속 동작이 끝나면 다음 타격 준비 전까지 이동 클립으로 돌아간다', () => {
    // 0.4초 뒤: 0.4 + 0.4 = 0.8 = 클립 끝
    expect(pick(MELEE, 108, -1, -1, 100)).toBe(AnimClip.Idle);
    expect(pick(MELEE, 120, -1, -1, 100)).toBe(AnimClip.Idle); // 1.0초
  });
  it('다음 타격 예상 시각에 hitTime 이 오도록 미리 휘두른다', () => {
    // 다음 타격 예상 = 1.5초 뒤, 준비 시작 = 1.5 - 0.4 = 1.1초
    expect(pick(MELEE, 122, -1, -1, 100)).toBe(AnimClip.Attack); // 1.1초
    expect(out[0]).toBeCloseTo(0, 6);
    pick(MELEE, 130, -1, -1, 100); // 1.5초 = 예상 타격
    expect(out[0]).toBeCloseTo(0.4, 6);
  });
  it('교전 창이 지나면 attack 을 그만둔다', () => {
    expect(pick(MELEE, 134, -1, -1, 100)).toBe(AnimClip.Idle); // 1.7초 > 1.65
  });
  it('궁수는 발사 후 1초만 attack, 4초 간격 사이는 idle', () => {
    expect(pick(ARCHER, 100, -1, -1, 100)).toBe(AnimClip.Attack);
    expect(out[0]).toBeCloseTo(16 / 30, 6);
    expect(pick(ARCHER, 110, -1, -1, 100)).toBe(AnimClip.Idle); // 0.5초: 0.5 + 0.533 > 0.8
    expect(pick(ARCHER, 170, -1, -1, 100)).toBe(AnimClip.Idle); // 3.5초: 준비 동작 없음
  });
});

describe('이동', () => {
  it('속도 기준으로 idle / walk / run 을 고르고 재생 속도 = 실제 속도 ÷ 기준 속도', () => {
    expect(pick(MELEE, 100, -1, -1, -1, 0.05)).toBe(AnimClip.Idle);
    expect(out[1]).toBe(1);
    expect(pick(MELEE, 100, -1, -1, -1, 1)).toBe(AnimClip.Walk);
    expect(out[1]).toBeCloseTo(0.5, 6);
    expect(pick(MELEE, 100, -1, -1, -1, 4.4)).toBe(AnimClip.Run);
    expect(out[1]).toBeCloseTo(1.1, 6);
  });
  it('기준 속도를 모르면(0) 재생 속도 1', () => {
    expect(pick({ ...MELEE, walkRefSpeed: 0 }, 100, -1, -1, -1, 1)).toBe(AnimClip.Walk);
    expect(out[1]).toBe(1);
  });
});
