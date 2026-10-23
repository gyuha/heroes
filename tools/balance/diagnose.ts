/**
 * MVP 균형 진단(T-015). 실제 src/sim 코드로 "갈대 여울" AI 대 AI를 돌리며 교전 강도 지표를 1초마다 모은다.
 * src/는 읽고 실행만 한다(수정 없음). headless.ts와 같은 방식으로 전투를 만든다.
 *
 * 실행(프로젝트 루트):
 *   node --experimental-transform-types --no-warnings --import ./tools/map/register.mjs \
 *     tools/balance/diagnose.ts --plan A --games 20 --seed 1 --out /tmp/diag_A.json
 *   node tools/balance/diagnose-report.ts /tmp/diag_A.json /tmp/diag_B.json /tmp/diag_C.json
 *
 * 수집 지표(판마다):
 *  - 공격 부대별: 역할(stance)·경로, 첫 교전 시각, 교전 초, 준비 상태 초, 도하 시각·지점, 깃발 최소 거리, 손실률, 패주 여부
 *  - 궁수: 사격 초, 명령 표적이 사거리 밖인 초, 이동 초
 *  - 진영: 깃발 150m·40m 첫 진입, 깃발 점령 진행도 최대, 도하 지점별 병력, 돌격 충격·실패, 측후방 공격 로그
 */
import type { AttackPlanId } from '../../src/sim/ai/aiPlans';
import { createBattle } from '../../src/sim/battleSetup';
import { TICK_DT } from '../../src/sim/constants';
import { createReedFord } from '../../src/sim/map/reedFord';
import { Pathfinder } from '../../src/sim/map/pathfinder';
import { rangeWithHeight } from '../../src/sim/rules';
import { REED_FORD } from '../../src/sim/scenarios/reedFord';
import { UNIT_TYPE_ORDER } from '../../src/sim/units';

/** 강 중심선 z(대략 570~610). 이보다 남쪽(z 작음)으로 오면 도하로 본다. */
const CROSSED_Z = 570;
/** 도하 지점 구분 x 경계(+x = 서쪽): 동쪽 다리 x 240, 여울 x 520, 서쪽 다리 x 800 */
function crossingOf(x: number): 'eastBridge' | 'ford' | 'westBridge' {
  return x < 380 ? 'eastBridge' : x < 660 ? 'ford' : 'westBridge';
}

export interface SquadDiag {
  id: number;
  type: string;
  role: string;
  stance: string;
  lane: string;
  start: number;
  end: number;
  routed: boolean;
  firstEngage: number;
  engagedSec: number;
  readySec: number;
  crossedAt: number;
  crossing: string;
  crossCount: number;
  minFlagDist: number;
  // 궁수
  firingSec: number;
  outOfRangeSec: number;
  movingSec: number;
}

export interface GameDiag {
  seed: number;
  plan: string;
  winner: number;
  reason: string;
  time: number;
  firstContact: number;
  reserveCommitAt: number;
  t150: number;
  t40: number;
  maxProgress: number;
  defStart: number;
  defLost: number;
  defRouting: number;
  attStart: number;
  attLost: number;
  attRouting: number;
  attEffective: number;
  attEngagedSoldierSec: number;
  attSoldierSec: number;
  defEngagedSoldierSec: number;
  chargeImpacts: number;
  chargeKills: number;
  chargeBySide: Record<string, number>;
  chargeZeroKill: number;
  chargeFailed: Record<string, number>;
  attackedLogs: { def: Record<string, number>; att: Record<string, number> };
  routsDef: number;
  routsAtt: number;
  squads: SquadDiag[];
}

type MemoView = { memo: { stance: string; lane: string }[] };

const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv;
function arg(name: string): string | undefined {
  const k = argv.indexOf(`--${name}`);
  return k >= 0 ? argv[k + 1] : undefined;
}

const games = Number(arg('games') ?? 5);
const firstSeed = Number(arg('seed') ?? 1);
const plan = arg('plan') as AttackPlanId | undefined;
const out = arg('out');
/**
 * 반사실 실험: 매 틱 끝에 준비 상태 부대의 병사를 자기 대형 자리로 옮긴다(완벽한 대형 결속).
 * 병사 이동 구현이 결과를 얼마나 바꾸는지 보기 위한 것이며 게임 규칙이 아니다.
 */
const snap = argv.includes('--snap');
const HARD_STOP = REED_FORD.rules.timeLimit + REED_FORD.rules.overtimeMax + 5;
const SAMPLE_TICKS = Math.round(1 / TICK_DT);

const map = createReedFord();
const pathfinder = new Pathfinder(map);
const results: GameDiag[] = [];
const flag = REED_FORD.rules.flag;
const ATT = REED_FORD.attacker;
const DEF = REED_FORD.defender;

for (let g = 0; g < games; g++) {
  const seed = firstSeed + g;
  const world = createBattle({
    map,
    pathfinder,
    scenario: REED_FORD,
    seed,
    aiTeams: [0, 1],
    attackPlan: plan,
  });
  world.startBattle();
  const ai = world.controllers.find((c) => c.team === ATT) as unknown as MemoView & {
    plan: string;
  };
  const sqd: SquadDiag[] = world.squads.map((s) => ({
    id: s.id,
    type: UNIT_TYPE_ORDER[s.typeIndex],
    role: s.role,
    stance: s.team === ATT ? (s.isCommander ? 'commander' : ai.memo[s.id].stance) : 'defend',
    lane: s.team === ATT ? ai.memo[s.id].lane : '-',
    start: s.startCount,
    end: s.n,
    routed: false,
    firstEngage: -1,
    engagedSec: 0,
    readySec: 0,
    crossedAt: -1,
    crossing: '-',
    crossCount: 0,
    minFlagDist: Infinity,
    firingSec: 0,
    outOfRangeSec: 0,
    movingSec: 0,
  }));
  const d: GameDiag = {
    seed,
    plan: ai.plan,
    winner: -1,
    reason: 'timeout',
    time: 0,
    firstContact: -1,
    reserveCommitAt: -1,
    t150: -1,
    t40: -1,
    maxProgress: 0,
    defStart: world.teamStart[DEF],
    defLost: 0,
    defRouting: 0,
    attStart: world.teamStart[ATT],
    attLost: 0,
    attRouting: 0,
    attEffective: 0,
    attEngagedSoldierSec: 0,
    attSoldierSec: 0,
    defEngagedSoldierSec: 0,
    chargeImpacts: 0,
    chargeKills: 0,
    chargeBySide: {},
    chargeZeroKill: 0,
    chargeFailed: {},
    attackedLogs: { def: {}, att: {} },
    routsDef: 0,
    routsAtt: 0,
    squads: sqd,
  };
  while (world.phase === 'battle' && world.time < HARD_STOP) {
    world.step(TICK_DT);
    if (snap) snapToSlots(world);
    for (const e of world.drainEvents()) {
      if (e.kind === 'engage' && d.firstContact < 0) d.firstContact = e.time;
      if (e.kind === 'chargeImpact' && world.squads[e.squad].team === ATT) {
        d.chargeImpacts++;
        d.chargeKills += e.kills;
        if (e.kills === 0) d.chargeZeroKill++;
        const k = `${e.side}${e.braced ? '+brace' : ''}`;
        d.chargeBySide[k] = (d.chargeBySide[k] ?? 0) + 1;
      }
      if (e.kind === 'chargeFailed' && world.squads[e.squad].team === ATT)
        d.chargeFailed[e.reason] = (d.chargeFailed[e.reason] ?? 0) + 1;
      if (e.kind === 'attacked') {
        const bag = world.squads[e.squad].team === DEF ? d.attackedLogs.def : d.attackedLogs.att;
        bag[e.side] = (bag[e.side] ?? 0) + 1;
      }
      if (e.kind === 'rout') {
        sqd[e.squad].routed = true;
        if (world.squads[e.squad].team === DEF) d.routsDef++;
        else d.routsAtt++;
      }
    }
    if (world.tick % SAMPLE_TICKS !== 0) continue;
    if (world.flag.progress > d.maxProgress) d.maxProgress = world.flag.progress;
    for (const s of world.squads) {
      const x = sqd[s.id];
      if (
        s.team === ATT &&
        !s.isCommander &&
        x.stance !== ai.memo[s.id].stance &&
        ai.memo[s.id].stance === 'assault' &&
        d.reserveCommitAt < 0
      )
        d.reserveCommitAt = world.time;
      if (s.team === ATT && !s.isCommander) {
        // 역할 변화 기록: "처음>지금" (예: reserve>assault)
        const first = x.stance.split('>')[0];
        const now = ai.memo[s.id].stance;
        x.stance = now === first ? first : `${first}>${now}`;
      }
      if (!s.ready) continue;
      x.readySec++;
      if (s.engaged) {
        x.engagedSec++;
        if (x.firstEngage < 0) x.firstEngage = world.time;
      }
      if (s.team === ATT) {
        d.attSoldierSec += s.n;
        if (s.engaged) d.attEngagedSoldierSec += s.n;
        if (x.crossedAt < 0 && s.z < CROSSED_Z) {
          x.crossedAt = world.time;
          x.crossing = crossingOf(s.x);
          x.crossCount = s.n;
        }
        const fd = Math.hypot(s.x - flag.x, s.z - flag.z);
        if (fd < x.minFlagDist) x.minFlagDist = fd;
        if (!s.stats.ranged && !s.isCommander) {
          if (fd <= 150 && d.t150 < 0) d.t150 = world.time;
          if (fd <= flag.radius && d.t40 < 0) d.t40 = world.time;
        }
        if (s.stats.ranged) {
          if (s.fireTarget >= 0) x.firingSec++;
          if (s.speed > 0.1) x.movingSec++;
          if (s.order.kind === 'attack' && s.order.target >= 0) {
            const t = world.squads[s.order.target];
            const R = rangeWithHeight(s.stats.ranged.range, s.groundY - t.groundY);
            if (Math.hypot(t.x - s.x, t.z - s.z) > R) x.outOfRangeSec++;
          }
        }
      } else if (s.engaged) d.defEngagedSoldierSec += s.n;
    }
  }
  const r = world.result;
  d.winner = r?.winner ?? -1;
  d.reason = r?.reason ?? 'timeout';
  d.time = Math.round(world.time);
  for (const s of world.squads) sqd[s.id].end = s.n;
  const tDef = r?.teams[DEF];
  const tAtt = r?.teams[ATT];
  d.defLost = tDef?.lost ?? 0;
  d.defRouting = tDef?.routing ?? 0;
  d.attLost = tAtt?.lost ?? 0;
  d.attRouting = tAtt?.routing ?? 0;
  d.attEffective = tAtt?.effective ?? 0;
  results.push(d);
  const att = sqd.filter(
    (s) => world.squads[s.id].team === ATT && s.type !== 'archer' && s.stance !== 'commander',
  );
  const never = att.filter((s) => s.firstEngage < 0).length;
  console.log(
    `seed ${seed} plan ${d.plan} winner ${d.winner === DEF ? '방어' : d.winner === ATT ? '공격' : '무'} ${d.reason} ${d.time}s | ` +
      `첫접촉 ${Math.round(d.firstContact)} 150m ${Math.round(d.t150)} 40m ${Math.round(d.t40)} 진행도max ${d.maxProgress.toFixed(0)} | ` +
      `공격 근접 ${att.length}개 중 무교전 ${never} | 손실 방 ${d.defLost}/${d.defStart} 공 ${d.attLost}/${d.attStart} | 돌격 ${d.chargeImpacts}(0명 ${d.chargeZeroKill})`,
  );
}

function snapToSlots(world: ReturnType<typeof createBattle>): void {
  const u = world.units;
  const local = { lateral: 0, forward: 0 };
  for (const sq of world.squads) {
    if (!sq.ready) continue;
    const fx = Math.sin(sq.facing);
    const fz = Math.cos(sq.facing);
    for (let k = 0; k < sq.n; k++) {
      sq.slotLocal(k, local);
      const i = sq.members[k];
      u.x[i] = sq.x + fz * local.lateral + fx * local.forward;
      u.z[i] = sq.z - fx * local.lateral + fz * local.forward;
      u.y[i] = world.terrain.heightAt(u.x[i], u.z[i]);
    }
  }
}

if (out) {
  const fs = (await import('node:fs')) as { writeFileSync(p: string, s: string): void };
  fs.writeFileSync(out, JSON.stringify(results));
}
