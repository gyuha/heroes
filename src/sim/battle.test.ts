import { describe, expect, it } from 'vitest';
import type { SimEvent, TeamId, UnitTypeId } from './api';
import { planLineMove, validateCommand } from './commands';
import { TICK_DT } from './constants';
import { COMBAT, MORALE } from './data/balance';
import type { SquadSpec as Spec, SquadSpec } from './scenario';
import { damageSoldier, meleeMult, sideOf } from './systems/combat';
import { TerrainType } from './terrain';
import { SIM_TEST_TIMEOUT, flatTerrain, testScenario } from './testing';
import { World } from './world';

const NORTH = 0;
const SOUTH = Math.PI;

function makeWorld(
  south: Spec[],
  north: Spec[],
  opts: {
    type?: (x: number, z: number) => number;
    seed?: number;
    breakRatio?: number;
    timeLimit?: number;
  } = {},
): World {
  const w = new World({
    terrain: flatTerrain(512, () => 10, opts.type),
    scenario: testScenario(south, north, {
      breakRatio: opts.breakRatio ?? 0,
      timeLimit: opts.timeLimit,
    }),
    seed: opts.seed ?? 1,
  });
  w.startBattle();
  return w;
}

/** until가 참이 되거나 maxSeconds가 지날 때까지 돌리고 그동안의 이벤트를 모은다. */
function run(w: World, maxSeconds: number, until: (w: World) => boolean = () => false): SimEvent[] {
  const events: SimEvent[] = [];
  while (w.phase === 'battle' && w.time < maxSeconds) {
    w.step(TICK_DT);
    events.push(...w.drainEvents());
    if (until(w)) break;
  }
  return events;
}

function attack(w: World, team: TeamId, squad: number, target: number, charge = false): void {
  w.enqueue({ kind: charge ? 'charge' : 'attack', team, squads: [squad], target });
}
function hold(w: World, team: TeamId, squad: number): void {
  w.enqueue({ kind: 'hold', team, squads: [squad] });
}
const lossPct = (w: World, id: number) => 1 - w.squads[id].n / w.squads[id].startCount;

describe('방향 판정과 배율 (GDD §5.2)', () => {
  const w = makeWorld(
    [{ type: 'infantry', x: 256, z: 200, facing: NORTH }],
    [{ type: 'infantry', x: 256, z: 400, facing: SOUTH }],
  );
  const def = w.squads[0];
  const att = w.squads[1];

  it('정면·측면·후방을 부대 사각형 기준으로 가른다', () => {
    expect(sideOf(def, def.x, def.z + 30)).toBe('front');
    expect(sideOf(def, def.x + 60, def.z)).toBe('flank');
    expect(sideOf(def, def.x, def.z - 30)).toBe('rear');
    // 넓은 횡대는 앞쪽 넓은 범위가 정면이다
    expect(sideOf(def, def.x + 25, def.z + 12)).toBe('front');
  });

  it('근접 배율: 정면 ×1.0, 측면 ×1.3, 후방 ×1.6 (평지)', () => {
    expect(meleeMult(att, def, 'front', false)).toBeCloseTo(COMBAT.dirMult.front);
    expect(meleeMult(att, def, 'flank', false)).toBeCloseTo(COMBAT.dirMult.flank);
    expect(meleeMult(att, def, 'rear', false)).toBeCloseTo(COMBAT.dirMult.rear);
  });

  it('이탈 중인 부대는 정면에서 맞아도 후방 판정이다 (GDD §5.6)', () => {
    def.disengageTime = 1;
    expect(sideOf(def, def.x, def.z + 30)).toBe('rear');
    def.disengageTime = 0;
  });
});

describe('근접 교전', { timeout: SIM_TEST_TIMEOUT }, () => {
  /** 고수 중인 보병 300을 보병 300이 dir 방향에서 공격, 30초 동안의 방어 손실률 */
  function hitFrom(dir: 'front' | 'flank' | 'rear'): number {
    const start: Record<typeof dir, [number, number, number]> = {
      front: [256, 260, SOUTH],
      flank: [330, 200, -Math.PI / 2],
      rear: [256, 140, NORTH],
    };
    const [x, z, f] = start[dir];
    const w = makeWorld(
      [{ type: 'infantry', x: 256, z: 200, facing: NORTH }],
      [{ type: 'infantry', x, z, facing: f }],
    );
    hold(w, 0, 0);
    attack(w, 1, 1, 0);
    let contact = -1;
    run(w, 200, (ww) => {
      if (contact < 0 && ww.squads[1].engaged) contact = ww.time;
      return contact >= 0 && ww.time - contact >= 30;
    });
    return lossPct(w, 0);
  }

  it('같은 시간 동안 측면·후방 공격이 정면보다 많이 죽인다', () => {
    const front = hitFrom('front');
    const flank = hitFrom('flank');
    const rear = hitFrom('rear');
    expect(front).toBeGreaterThan(0);
    expect(flank).toBeGreaterThan(front);
    expect(rear).toBeGreaterThan(flank);
  });

  it('죽은 병사 자리를 뒤 행이 채워 살아 있는 병사가 앞 slot을 빈틈없이 차지한다', () => {
    const w = makeWorld(
      [{ type: 'infantry', x: 256, z: 200, facing: NORTH }],
      [{ type: 'infantry', x: 256, z: 260, facing: SOUTH }],
    );
    hold(w, 0, 0);
    attack(w, 1, 1, 0);
    run(w, 200, (ww) => lossPct(ww, 0) > 0.1);
    const sq = w.squads[0];
    for (let k = 0; k < sq.n; k++) expect(w.units.alive[sq.members[k]]).toBe(1);
    for (let k = sq.n; k < sq.startCount; k++) expect(sq.members[k]).toBe(-1);
  });
});

describe('돌격 (GDD §5.4)', { timeout: SIM_TEST_TIMEOUT }, () => {
  function cavalryCharge(
    targetType: UnitTypeId,
    type?: (x: number, z: number) => number,
    brace = false,
  ) {
    const w = makeWorld(
      [{ type: targetType, x: 256, z: 200, facing: NORTH }],
      [{ type: 'cavalry', x: 256, z: 330, facing: SOUTH }],
      { type },
    );
    if (brace) {
      hold(w, 0, 0);
      run(w, 4); // 창병 Brace 정착 3초
    }
    attack(w, 1, 1, 0);
    const events = run(w, 120, (ww) => ww.squads[1].engaged);
    const impact = events.find((e) => e.kind === 'chargeImpact');
    const failed = events.find((e) => e.kind === 'chargeFailed');
    return { w, impact, failed };
  }

  it('평지에서는 최고 속도로 충돌해 충격 피해를 준다', () => {
    const { impact } = cavalryCharge('infantry');
    expect(impact?.kind).toBe('chargeImpact');
    if (impact?.kind !== 'chargeImpact') return;
    expect(impact.speedRatio).toBeGreaterThanOrEqual(0.9);
    expect(impact.kills).toBeGreaterThan(0);
    expect(impact.side).toBe('front');
  });

  it('숲에서는 속도가 모자라 돌격이 실패하고 원인을 남긴다', () => {
    const forest = (_x: number, z: number) => (z < 300 ? TerrainType.Forest : TerrainType.Grass);
    const { impact, failed } = cavalryCharge('infantry', forest);
    expect(impact).toBeUndefined();
    expect(failed?.kind === 'chargeFailed' && failed.reason).toBe('forest');
  });

  it('여울에서도 속도가 모자라 돌격이 실패한다', () => {
    const ford = (_x: number, z: number) => (z < 300 ? TerrainType.Ford : TerrainType.Grass);
    const { impact, failed } = cavalryCharge('infantry', ford);
    expect(impact).toBeUndefined();
    expect(failed?.kind === 'chargeFailed' && failed.reason).toBe('ford');
  });

  it('Brace 창병 정면: 충격이 줄고 기병이 반격으로 죽으며 속도가 0이 된다', () => {
    const braced = cavalryCharge('spearman', undefined, true);
    const open = cavalryCharge('spearman', undefined, false);
    expect(braced.impact?.kind === 'chargeImpact' && braced.impact.braced).toBe(true);
    expect(open.impact?.kind === 'chargeImpact' && open.impact.braced).toBe(false);
    const bracedKills = braced.impact?.kind === 'chargeImpact' ? braced.impact.kills : -1;
    const openKills = open.impact?.kind === 'chargeImpact' ? open.impact.kills : -1;
    expect(bracedKills).toBeLessThan(openKills);
    expect(lossPct(braced.w, 1)).toBeGreaterThan(0);
    expect(lossPct(open.w, 1)).toBe(0);
    expect(braced.w.squads[1].baseSpeed).toBe(0);
  });

  it('보병 돌격(Z)은 고수 중인 적 정면에는 효과가 없다', () => {
    const w = makeWorld(
      [{ type: 'infantry', x: 256, z: 200, facing: NORTH }],
      [{ type: 'infantry', x: 256, z: 290, facing: SOUTH }],
    );
    hold(w, 0, 0);
    run(w, 2);
    attack(w, 1, 1, 0, true);
    const events = run(w, 120, (ww) => ww.squads[1].engaged);
    const failed = events.find((e) => e.kind === 'chargeFailed');
    expect(failed?.kind === 'chargeFailed' && failed.reason).toBe('bracedFront');
    expect(w.squads[1].chargeBonusTime).toBe(0);
  });
});

describe('사기와 패주 (GDD §4.4, §4.5)', { timeout: SIM_TEST_TIMEOUT }, () => {
  it('병력 1% 손실마다 사기가 1.2 떨어진다', () => {
    const w = makeWorld(
      [{ type: 'infantry', x: 256, z: 200, facing: NORTH }],
      [{ type: 'infantry', x: 256, z: 400, facing: SOUTH }],
    );
    const [sq, by] = w.squads;
    run(w, TICK_DT);
    const before = sq.morale;
    for (let k = 0; k < 30; k++) damageSoldier(w, sq.members[0], 1e6, by, false); // 10%
    run(w, w.time + TICK_DT);
    expect(before - sq.morale).toBeCloseTo(MORALE.perLossPct * 10, 5);
  });

  it('정면 교전에서 지는 부대는 사기가 20 이하가 되면 패주하고 이벤트를 낸다', () => {
    const w = makeWorld(
      [{ type: 'infantry', x: 256, z: 200, facing: NORTH }],
      [{ type: 'spearman', x: 256, z: 260, facing: SOUTH }],
    );
    hold(w, 0, 0);
    attack(w, 1, 1, 0);
    const events = run(w, 400, (ww) => ww.squads.some((s) => s.state === 'routing'));
    const rout = events.find((e) => e.kind === 'rout');
    expect(rout?.kind === 'rout' && rout.squad).toBe(1);
    expect(w.squads[1].morale).toBeLessThanOrEqual(MORALE.rout);
    // 패주 부대는 명령을 받지 않는다
    expect(w.squads[1].order.kind).toBe('none');
  });

  it('후방 공격은 사기를 초당 −3 깎아 정면보다 빨리 패주시킨다', () => {
    function timeToRout(fromRear: boolean): number {
      const w = makeWorld(
        [{ type: 'infantry', x: 256, z: 200, facing: NORTH }],
        [
          { type: 'infantry', x: 256, z: 260, facing: SOUTH },
          { type: 'infantry', x: 256, z: fromRear ? 130 : 330, facing: fromRear ? NORTH : SOUTH },
        ],
      );
      hold(w, 0, 0);
      attack(w, 1, 1, 0);
      attack(w, 1, 2, 0);
      run(w, 600, (ww) => ww.squads[0].state !== 'ready');
      return w.time;
    }
    expect(timeToRout(true)).toBeLessThan(timeToRout(false) * 0.75);
  });
});

describe('지휘관 (GDD §4.6)', { timeout: SIM_TEST_TIMEOUT }, () => {
  const army = (): World =>
    makeWorld(
      [
        { type: 'cavalry', commander: true, x: 256, z: 200, facing: NORTH },
        { type: 'infantry', x: 256, z: 240, facing: NORTH },
        { type: 'infantry', x: 256, z: 40, facing: NORTH },
      ],
      [{ type: 'infantry', x: 256, z: 480, facing: SOUTH }],
    );

  it('60m 안의 아군은 사기 감소가 ×0.75다', () => {
    const w = army();
    const [, near, far] = w.squads;
    const by = w.squads[3];
    run(w, TICK_DT);
    for (let k = 0; k < 30; k++) {
      damageSoldier(w, near.members[0], 1e6, by, false);
      damageSoldier(w, far.members[0], 1e6, by, false);
    }
    run(w, w.time + TICK_DT);
    expect(100 - near.morale).toBeCloseTo(12 * MORALE.commanderAuraLossMult, 4);
    expect(100 - far.morale).toBeCloseTo(12, 4);
  });

  it('지휘관이 전사하면 150m 안 −25, 밖 −10, 진영 회복 상한 −10', () => {
    const w = army();
    const [cmd, near, far] = w.squads;
    const by = w.squads[3];
    run(w, TICK_DT);
    while (cmd.n > 0) damageSoldier(w, cmd.members[0], 1e6, by, false);
    const events = run(w, w.time + TICK_DT);
    expect(events.some((e) => e.kind === 'commanderKilled' && e.team === 0)).toBe(true);
    expect(cmd.state).toBe('destroyed');
    // 같은 틱 안에 회복(+1.5/초 × 1틱)이 붙으므로 그만큼 허용한다
    const oneTickRecovery = MORALE.recoverPerSec * TICK_DT;
    expect(Math.abs(100 - near.morale - MORALE.commanderDeathNear)).toBeLessThanOrEqual(
      oneTickRecovery + 1e-6,
    );
    expect(Math.abs(100 - far.morale - MORALE.commanderDeathFar)).toBeLessThanOrEqual(
      oneTickRecovery + 1e-6,
    );
    expect(w.teamStats[0].commanderDead).toBe(true);
    // 손실 없는 부대도 회복 상한이 90이다: 75까지 떨어진 부대는 90까지만 회복한다
    run(w, w.time + 30);
    expect(near.morale).toBeCloseTo(MORALE.start - MORALE.commanderDeathCapPenalty, 6);
  });

  it('지휘관 부대는 사기가 고정이라 패주하지 않는다', () => {
    const w = army();
    const [cmd] = w.squads;
    const by = w.squads[3];
    run(w, TICK_DT);
    for (let k = 0; k < 35; k++) damageSoldier(w, cmd.members[0], 1e6, by, false);
    run(w, w.time + 1);
    expect(cmd.state).toBe('ready');
    expect(cmd.morale).toBe(MORALE.start);
  });
});

describe('승패 조건 (GDD §3)', { timeout: SIM_TEST_TIMEOUT }, () => {
  const flagScenario = (south: Spec[], north: Spec[], timeLimit = 900) => {
    const sc = testScenario(south, north, { timeLimit, breakRatio: 0.25 });
    const scenario = { ...sc, rules: { ...sc.rules, flag: { x: 256, z: 256, radius: 40 } } };
    const w = new World({ terrain: flatTerrain(512), scenario, seed: 1 });
    w.startBattle();
    return w;
  };

  it('공격 부대만 깃발 구역에 60초 있으면 공격이 이긴다', () => {
    const w = flagScenario(
      [{ type: 'infantry', x: 256, z: 60, facing: NORTH }],
      [{ type: 'infantry', x: 256, z: 256, facing: SOUTH }],
    );
    const events = run(w, 120);
    expect(w.result?.winner).toBe(1);
    expect(w.result?.reason).toBe('flagCaptured');
    expect(w.result!.time).toBeGreaterThanOrEqual(60);
    expect(w.result!.time).toBeLessThan(62);
    expect(events.some((e) => e.kind === 'flag' && e.state === 'capturing')).toBe(true);
  });

  it('방어 부대가 구역에 있으면 점령되지 않고, 제한 시간이 지나면 방어가 이긴다', () => {
    const w = flagScenario(
      [{ type: 'infantry', x: 256, z: 240, facing: NORTH }],
      [{ type: 'infantry', x: 256, z: 270, facing: SOUTH }],
      90,
    );
    run(w, 200);
    expect(w.result?.winner).toBe(0);
    expect(w.result?.reason).toBe('timeHeld');
  });

  it('진행도가 남아 있으면 연장전에 들어가고, 최대 60초 뒤 방어가 이긴다', () => {
    const w = flagScenario(
      [{ type: 'infantry', x: 256, z: 60, facing: NORTH }],
      [{ type: 'infantry', x: 256, z: 256, facing: SOUTH }],
      30,
    );
    run(w, 35);
    expect(w.phase).toBe('battle');
    expect(w.flag.overtime).toBe(true);
    run(w, 200);
    // 공격 부대가 그대로 있으므로 연장전 중 진행도 60에 닿아 공격이 이긴다
    expect(w.result?.reason).toBe('flagCaptured');
  });

  it('실질 병력이 시작의 25% 미만이 되면 그 진영이 진다(붕괴)', () => {
    const w = flagScenario(
      [{ type: 'infantry', x: 100, z: 100, facing: NORTH }],
      [
        { type: 'infantry', x: 400, z: 400, facing: SOUTH },
        { type: 'infantry', x: 450, z: 450, facing: SOUTH },
      ],
    );
    // 재집결할 수 없는 패주 부대가 적과 250m 넘게 떨어져 있다 → 괴멸 → 실질 병력 0
    w.squads[0].state = 'routing';
    w.squads[0].morale = 0;
    w.squads[0].rallies = MORALE.maxRallies;
    run(w, 3);
    expect(w.result?.winner).toBe(1);
    expect(w.result?.reason).toBe('collapse');
  });
});

describe('명령 (GDD §7, D-011)', { timeout: SIM_TEST_TIMEOUT }, () => {
  const w = makeWorld(
    [
      { type: 'infantry', x: 200, z: 200, facing: NORTH },
      { type: 'spearman', x: 300, z: 200, facing: NORTH },
    ],
    [{ type: 'infantry', x: 256, z: 400, facing: SOUTH }],
  );

  it('선택이 없거나, 남의 부대이거나, 표적이 아군이면 거부한다', () => {
    expect(validateCommand(w, { kind: 'hold', team: 0, squads: [] })).toBe('noSelection');
    expect(validateCommand(w, { kind: 'hold', team: 0, squads: [2] })).toBe('notYourSquad');
    expect(validateCommand(w, { kind: 'attack', team: 0, squads: [0], target: 1 })).toBe(
      'invalidTarget',
    );
    expect(validateCommand(w, { kind: 'attack', team: 0, squads: [0], target: 2 })).toBe('ok');
  });

  it('드래그 선분을 부대 수로 나누고 열 수를 구간 폭에 맞춘다(8~80)', () => {
    const slots = planLineMove(w, [1, 0], 256, 300, 0, 120);
    expect(slots).toHaveLength(2);
    // 오른쪽 = (cos f, −sin f) = +x 이므로 x가 작은 0번 부대가 먼저
    expect(slots[0].squadId).toBe(0);
    expect(slots[1].x - slots[0].x).toBeCloseTo(60);
    expect(slots[0].files).toBe(Math.round(60 / 1.4));
    expect(planLineMove(w, [0], 256, 300, 0, 4)[0].files).toBe(8);
  });

  it('근접 교전 중 이동 명령을 받으면 3초 동안 이탈(후방 판정) 상태가 된다', () => {
    const ww = makeWorld(
      [{ type: 'infantry', x: 256, z: 200, facing: NORTH }],
      [{ type: 'infantry', x: 256, z: 260, facing: SOUTH }],
    );
    hold(ww, 0, 0);
    attack(ww, 1, 1, 0);
    run(ww, 200, (x) => x.squads[1].engaged);
    ww.enqueue({ kind: 'move', team: 1, squads: [1], x: 256, z: 450 });
    run(ww, ww.time + TICK_DT * 2);
    expect(ww.squads[1].disengageTime).toBeGreaterThan(2.8);
    expect(sideOf(ww.squads[1], ww.squads[0].x, ww.squads[0].z)).toBe('rear');
  });
});

describe('결정론', { timeout: SIM_TEST_TIMEOUT }, () => {
  function battle(seed: number): string {
    const south: SquadSpec[] = [
      { type: 'infantry', x: 200, z: 200, facing: NORTH },
      { type: 'archer', x: 260, z: 170, facing: NORTH },
      { type: 'spearman', x: 320, z: 200, facing: NORTH },
    ];
    const north: SquadSpec[] = [
      { type: 'infantry', x: 200, z: 320, facing: SOUTH },
      { type: 'cavalry', x: 330, z: 340, facing: SOUTH },
    ];
    const w = makeWorld(south, north, { seed });
    attack(w, 1, 3, 0);
    attack(w, 1, 4, 2);
    hold(w, 0, 0);
    run(w, 90);
    let h = 0;
    for (let i = 0; i < w.units.count; i++)
      h = (h * 31 + Math.round(w.units.x[i] * 100) + w.units.alive[i]) | 0;
    return `${h}:${w.squads.map((s) => `${s.n}/${s.state}/${s.morale.toFixed(4)}`).join(',')}`;
  }

  it('같은 시드면 같은 결과, 다른 시드면 다른 결과', () => {
    expect(battle(7)).toBe(battle(7));
    expect(battle(7)).not.toBe(battle(8));
  });
});
