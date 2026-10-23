/**
 * 밸런스 검증 시나리오. 각 함수는 마크다운 표 문자열을 돌려준다.
 */
import { UNIT_TYPES, type UnitTypeId } from './config.ts';
import {
  Battle,
  runBattle,
  type BattleResult,
  type BattleTerrain,
  type TerrainKind,
  type UnitSpec,
} from './engine.ts';
import { rangeWithHeight, slopeSpeedFactor } from './rules.ts';

const TYPES: UnitTypeId[] = ['infantry', 'spearman', 'archer', 'cavalry'];
const NAME = (t: UnitTypeId) => UNIT_TYPES[t].name;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const sec = (v: number) => (Number.isFinite(v) && v >= 0 ? `${Math.round(v)}s` : '-');
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function table(head: string[], rows: string[][]): string {
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

const FACE_N = 0; // +Z
const FACE_S = Math.PI; // -Z

/** 경사면: z < foot 평지(높이 0), foot~crest 경사 θ, 그 뒤 고원. */
export function ridge(
  deg: number,
  height: number,
  foot: number,
  extra?: (x: number, z: number) => TerrainKind,
): BattleTerrain {
  const tan = Math.tan((deg * Math.PI) / 180);
  const crest = deg > 0 ? foot + height / tan : foot;
  return {
    height: (_x, z) => (deg <= 0 ? 0 : z <= foot ? 0 : z >= crest ? height : (z - foot) * tan),
    kind: (x, z) => extra?.(x, z) ?? 'grass',
  };
}

interface DuelStats {
  aWin: number;
  bWin: number;
  draw: number;
  contactToEnd: number;
  aLoss: number;
  bLoss: number;
  time: number;
}

function summarize(results: Array<{ r: BattleResult; a: number; b: number }>): DuelStats {
  let aWin = 0;
  let bWin = 0;
  let draw = 0;
  const cte: number[] = [];
  const al: number[] = [];
  const bl: number[] = [];
  const tm: number[] = [];
  for (const { r, a, b } of results) {
    const A = r.units[a];
    const B = r.units[b];
    if (r.winner === 0) aWin++;
    else if (r.winner === 1) bWin++;
    else draw++;
    if (r.firstContact >= 0) cte.push(r.time - r.firstContact);
    al.push(1 - A.n / A.start);
    bl.push(1 - B.n / B.start);
    tm.push(r.time);
  }
  const n = results.length;
  return {
    aWin: aWin / n,
    bWin: bWin / n,
    draw: draw / n,
    contactToEnd: mean(cte),
    aLoss: mean(al),
    bLoss: mean(bl),
    time: mean(tm),
  };
}

// ------------------------------------------------------------------ S1 1:1 교전 매트릭스
/** 공격자 A(남쪽, 200m 거리)가 고수 중인 B를 공격한다. 평지. 한쪽이 패주하면 종료. */
export function s1Matrix(runs: number): string {
  const rows: string[][] = [];
  for (const a of TYPES) {
    for (const b of TYPES) {
      const res: Array<{ r: BattleResult; a: number; b: number }> = [];
      for (let s = 0; s < runs; s++) {
        const specs: UnitSpec[] = [
          { type: a, team: 0, x: 0, z: 0, facing: FACE_N, order: { kind: 'attack', target: 1 } },
          { type: b, team: 1, x: 0, z: 200, facing: FACE_S, order: { kind: 'hold' } },
        ];
        const r = runBattle(specs, { seed: 1000 + s, endMode: 'rout', timeLimit: 600 });
        res.push({ r, a: 0, b: 1 });
      }
      const st = summarize(res);
      rows.push([
        NAME(a),
        NAME(b),
        pct(st.aWin),
        pct(st.bWin),
        pct(st.draw),
        sec(st.time),
        sec(st.contactToEnd),
        pct(st.aLoss),
        pct(st.bLoss),
      ]);
    }
  }
  return table(
    [
      '공격(A)',
      '고수(B)',
      'A 승',
      'B 승',
      '무승부·시간 초과',
      '종료 시각',
      '접촉→종료',
      'A 손실',
      'B 손실',
    ],
    rows,
  );
}

// ------------------------------------------------------------------ S2 정면 vs 측면·후방
/** 보병 B(고수)를 보병 A1이 정면에서 붙잡고, 20초 뒤 A2가 측면/후방을 친다. */
export function s2Flank(runs: number): string {
  const cases: Array<{
    name: string;
    charge?: boolean;
    second?: { type: UnitTypeId; x: number; z: number };
  }> = [
    { name: '정면 1개 부대만' },
    { name: '정면 1개 부대, 돌격(Z) — 고수 정면엔 무효', charge: true },
    { name: '+ 보병 정면 합류', second: { type: 'infantry', x: 70, z: 100 } },
    { name: '+ 보병 측면', second: { type: 'infantry', x: 120, z: 200 } },
    { name: '+ 보병 후방', second: { type: 'infantry', x: 0, z: 300 } },
    { name: '+ 기병 측면 돌격', second: { type: 'cavalry', x: 200, z: 200 } },
    { name: '+ 기병 후방 돌격', second: { type: 'cavalry', x: 0, z: 330 } },
  ];
  const rows: string[][] = [];
  for (const c of cases) {
    const res: Array<{ r: BattleResult; a: number; b: number }> = [];
    for (let s = 0; s < runs; s++) {
      const specs: UnitSpec[] = [
        {
          type: 'infantry',
          team: 0,
          x: 0,
          z: 140,
          facing: FACE_N,
          order: { kind: 'attack', target: 1, charge: c.charge },
        },
        { type: 'infantry', team: 1, x: 0, z: 200, facing: FACE_S, order: { kind: 'hold' } },
      ];
      if (c.second) {
        specs.push({
          type: c.second.type,
          team: 0,
          x: c.second.x,
          z: c.second.z,
          facing: Math.atan2(0 - c.second.x, 200 - c.second.z),
          order: { kind: 'hold' },
        });
      }
      const r = runBattle(specs, {
        seed: 2000 + s,
        endMode: 'rout',
        timeLimit: 600,
        script: (b) => {
          if (c.second && b.time >= 20 && b.units[2].order.kind === 'hold')
            b.units[2].order = { kind: 'attack', target: 1 };
        },
      });
      res.push({ r, a: 0, b: 1 });
    }
    const st = summarize(res);
    rows.push([c.name, pct(st.aWin), sec(st.contactToEnd), pct(st.aLoss), pct(st.bLoss)]);
  }
  // 조우전: B도 A를 향해 걸어온다(고수 아님). A만 돌격하면 차이가 나야 한다.
  for (const charge of [false, true]) {
    const res: Array<{ r: BattleResult; a: number; b: number }> = [];
    for (let s = 0; s < runs; s++) {
      const specs: UnitSpec[] = [
        {
          type: 'infantry',
          team: 0,
          x: 0,
          z: 100,
          facing: FACE_N,
          order: { kind: 'attack', target: 1, charge },
        },
        {
          type: 'infantry',
          team: 1,
          x: 0,
          z: 200,
          facing: FACE_S,
          order: { kind: 'attack', target: 0 },
        },
      ];
      res.push({
        r: runBattle(specs, { seed: 2500 + s, endMode: 'rout', timeLimit: 600 }),
        a: 0,
        b: 1,
      });
    }
    const st = summarize(res);
    rows.push([
      charge ? '조우전(B도 전진): A만 돌격(Z)' : '조우전(B도 전진): 둘 다 걷기',
      pct(st.aWin),
      sec(st.contactToEnd),
      pct(st.aLoss),
      pct(st.bLoss),
    ]);
  }
  return table(
    ['A 구성 (B = 보병 300, 기본 고수)', 'A 승', '접촉→B 패주', 'A1 손실', 'B 손실'],
    rows,
  );
}

// ------------------------------------------------------------------ S3 기병 돌격
export function s3Charge(runs: number): string {
  const cases: Array<{
    name: string;
    def: UnitTypeId;
    facing: number;
    z: number;
    order: 'hold' | 'move';
    terrain?: BattleTerrain;
  }> = [
    { name: '창병 정면, 고수(Brace)', def: 'spearman', facing: FACE_S, z: 200, order: 'hold' },
    { name: '창병 정면, 이동 중', def: 'spearman', facing: FACE_S, z: 200, order: 'move' },
    { name: '창병 후방(Brace 무효)', def: 'spearman', facing: FACE_N, z: 200, order: 'hold' },
    { name: '보병 정면, 고수', def: 'infantry', facing: FACE_S, z: 200, order: 'hold' },
    { name: '보병 후방', def: 'infantry', facing: FACE_N, z: 200, order: 'hold' },
    { name: '궁수 정면', def: 'archer', facing: FACE_S, z: 200, order: 'hold' },
    {
      name: '보병 정면, 숲 안',
      def: 'infantry',
      facing: FACE_S,
      z: 200,
      order: 'hold',
      terrain: { height: () => 0, kind: (_x, z) => (z > 140 ? 'forest' : 'grass') },
    },
    {
      name: '궁수 정면, 숲 안',
      def: 'archer',
      facing: FACE_S,
      z: 200,
      order: 'hold',
      terrain: { height: () => 0, kind: (_x, z) => (z > 140 ? 'forest' : 'grass') },
    },
    {
      name: '보병 정면, 내리막 10° 돌격',
      def: 'infantry',
      facing: FACE_N,
      z: 0,
      order: 'hold',
      terrain: {
        height: (_x, z) => Math.max(0, z) * Math.tan((10 * Math.PI) / 180),
        kind: () => 'grass',
      },
    },
  ];
  const rows: string[][] = [];
  for (const c of cases) {
    const impactCav: number[] = [];
    const impactDef: number[] = [];
    const res: Array<{ r: BattleResult; a: number; b: number }> = [];
    for (let s = 0; s < runs; s++) {
      const downhill = c.z === 0;
      const cavZ = downhill ? 200 : 0;
      const specs: UnitSpec[] = [
        {
          type: 'cavalry',
          team: 0,
          x: 0,
          z: cavZ,
          facing: downhill ? FACE_S : FACE_N,
          order: { kind: 'attack', target: 1 },
        },
        {
          type: c.def,
          team: 1,
          x: 0,
          z: c.z,
          facing: c.facing,
          order:
            c.order === 'hold'
              ? { kind: 'hold' }
              : { kind: 'move', x: 0, z: downhill ? 400 : -400 },
        },
      ];
      const b = new Battle(specs, {
        seed: 3000 + s,
        endMode: 'rout',
        timeLimit: 300,
        terrain: c.terrain,
      });
      let recorded = false;
      let r: BattleResult | null = null;
      while (b.time < 300) {
        b.step();
        if (!recorded && b.units[0].contacts.length > 0) {
          // 충격 직후 1틱
          b.step();
          impactCav.push(1 - b.units[0].n / b.units[0].start);
          impactDef.push(1 - b.units[1].n / b.units[1].start);
          recorded = true;
        }
        if (b.units.some((u) => u.state !== 'ready')) break;
      }
      r = {
        winner: b.units[1].state !== 'ready' ? 0 : b.units[0].state !== 'ready' ? 1 : -1,
        time: b.time,
        units: b.units,
        firstContact: b.units[0].firstContactTime,
        teamStart: [b.units[0].start, b.units[1].start],
        teamAlive: [b.units[0].n, b.units[1].n],
        teamEffective: [0, 0],
      };
      res.push({ r, a: 0, b: 1 });
    }
    const st = summarize(res);
    rows.push([
      c.name,
      pct(mean(impactDef)),
      pct(mean(impactCav)),
      pct(st.aWin),
      sec(st.contactToEnd),
      pct(st.aLoss),
      pct(st.bLoss),
    ]);
  }
  return table(
    [
      '기병 120 돌격 대상',
      '충격 순간 대상 손실',
      '충격 순간 기병 손실',
      '기병 승',
      '접촉→종료',
      '기병 최종 손실',
      '대상 최종 손실',
    ],
    rows,
  );
}

// ------------------------------------------------------------------ S4 경사 위 방어
export function s4Slope(runs: number): string {
  const rows: string[][] = [];
  for (const deg of [0, 5, 10, 15, 20]) {
    const terrain = ridge(deg, 60, 100);
    const res: Array<{ r: BattleResult; a: number; b: number }> = [];
    for (let s = 0; s < runs; s++) {
      const specs: UnitSpec[] = [
        {
          type: 'infantry',
          team: 0,
          x: 0,
          z: 0,
          facing: FACE_N,
          order: { kind: 'attack', target: 1 },
        },
        { type: 'infantry', team: 1, x: 0, z: 160, facing: FACE_S, order: { kind: 'hold' } },
      ];
      res.push({
        r: runBattle(specs, { seed: 4000 + s, endMode: 'rout', timeLimit: 600, terrain }),
        a: 0,
        b: 1,
      });
    }
    const st = summarize(res);
    rows.push([
      `${deg}°`,
      pct(slopeSpeedFactor(deg)),
      pct(st.bWin),
      sec(st.contactToEnd),
      pct(st.aLoss),
      pct(st.bLoss),
      (st.aLoss / Math.max(st.bLoss, 1e-6)).toFixed(2),
    ]);
  }
  return table(
    [
      '경사',
      '오르막 속도 계수',
      '방어(위쪽) 승',
      '접촉→종료',
      '공격 손실',
      '방어 손실',
      '교환비(공/방)',
    ],
    rows,
  );
}

// ------------------------------------------------------------------ S5 화살 아래 접근
export function s5Approach(runs: number): string {
  const rows: string[][] = [];
  const cases = [
    { name: '평지', terrain: ridge(0, 0, 0) },
    { name: '고지 12°·높이 25m', terrain: ridge(12, 25, 120) },
  ];
  for (const c of cases) {
    for (const atk of ['infantry', 'spearman', 'cavalry'] as UnitTypeId[]) {
      const res: number[] = [];
      const preLoss: number[] = [];
      const approach: number[] = [];
      for (let s = 0; s < runs; s++) {
        const crestZ = 120 + 25 / Math.tan((12 * Math.PI) / 180);
        const dz = c.name === '평지' ? 300 : crestZ + 10;
        const specs: UnitSpec[] = [
          { type: atk, team: 0, x: 0, z: 0, facing: FACE_N, order: { kind: 'attack', target: 2 } },
          { type: 'archer', team: 1, x: -40, z: dz + 30, facing: FACE_S, order: { kind: 'hold' } },
          { type: 'infantry', team: 1, x: 0, z: dz, facing: FACE_S, order: { kind: 'hold' } },
          { type: 'archer', team: 1, x: 40, z: dz + 30, facing: FACE_S, order: { kind: 'hold' } },
        ];
        const b = new Battle(specs, {
          seed: 5000 + s,
          endMode: 'rout',
          timeLimit: 400,
          terrain: c.terrain,
        });
        while (b.time < 400 && b.units[0].contacts.length === 0 && b.units[0].state === 'ready')
          b.step();
        preLoss.push(1 - b.units[0].n / b.units[0].start);
        approach.push(b.units[0].state === 'ready' ? b.time : NaN);
        res.push(b.units[0].state === 'ready' ? 1 : 0);
      }
      const ok = approach.filter((v) => !Number.isNaN(v));
      rows.push([c.name, NAME(atk), sec(mean(ok)), pct(mean(preLoss)), pct(mean(res))]);
    }
  }
  return table(['지형', '접근 병종', '접촉까지 시간', '접촉 전 손실', '패주 없이 접촉'], rows);
}

// ------------------------------------------------------------------ S6 군대 전투
interface ArmyComp {
  infantry: number;
  spearman: number;
  archer: number;
  cavalry: number;
}

function soldiers(c: ArmyComp): number {
  return TYPES.reduce((s, t) => s + c[t] * UNIT_TYPES[t].size, 0);
}

/**
 * 방어(team 1) 근접은 능선 앞 경사(z=lineZ-20), 궁수는 능선 마루(z=lineZ+10)에서 남쪽을 보고 고수. 공격(team 0)은 lineZ-400에서 출발.
 * 공격 AI: 근접 부대는 x가 가장 가까운 방어 근접 부대를 공격, 남는 부대는 측면으로 돌아 공격.
 * 궁수는 사거리까지 전진 후 사격, 기병은 측면 우회 후 궁수·후방을 공격하고 재돌격.
 * 방어 AI: 근접 고수, 궁수 고수 사격, 기병은 예비대(반경 150m 아군 교전 시 반격).
 */
export function armySpecs(
  att: ArmyComp,
  def: ArmyComp,
  lineZ: number,
  defendBoth = false,
  anchored = false,
): UnitSpec[] {
  const specs: UnitSpec[] = [];
  const gap = 6;
  const meleeW = UNIT_TYPES.infantry.files * UNIT_TYPES.infantry.fileSpacing + gap;
  const lineup = (c: ArmyComp): UnitTypeId[] => {
    const out: UnitTypeId[] = [];
    let i = c.infantry;
    let s = c.spearman;
    while (i > 0 || s > 0) {
      if (i > 0) (out.push('infantry'), i--);
      if (s > 0) (out.push('spearman'), s--);
    }
    return out;
  };
  // 방어
  const dMelee = lineup(def);
  const dWidth = dMelee.length * meleeW;
  const defIdx: number[] = [];
  dMelee.forEach((t, k) => {
    defIdx.push(specs.length);
    specs.push({
      type: t,
      team: 1,
      x: -dWidth / 2 + meleeW * (k + 0.5),
      z: lineZ - 20,
      facing: FACE_S,
      order: { kind: 'hold' },
    });
  });
  for (let k = 0; k < def.archer; k++) {
    specs.push({
      type: 'archer',
      team: 1,
      x: -dWidth / 2 + (dWidth / def.archer) * (k + 0.5),
      z: lineZ + 10,
      facing: FACE_S,
      order: { kind: 'hold' },
    });
  }
  for (let k = 0; k < def.cavalry; k++) {
    const side = k % 2 === 0 ? -1 : 1;
    specs.push({
      type: 'cavalry',
      team: 1,
      x: side * (dWidth / 2 - 40),
      z: lineZ + 70,
      facing: FACE_S,
      order: { kind: 'hold' },
      reserveRadius: 200,
      cycleCharge: true,
    });
  }
  // 공격
  const aMelee = lineup(att);
  const startZ = lineZ - 400;
  const aWidth = Math.min(aMelee.length, dMelee.length) * meleeW;
  aMelee.forEach((t, k) => {
    if (k < dMelee.length) {
      const x = -aWidth / 2 + meleeW * (k + 0.5);
      specs.push({
        type: t,
        team: 0,
        x,
        z: startZ,
        facing: FACE_N,
        order: defendBoth ? { kind: 'hold' } : { kind: 'attack', target: defIdx[k] },
      });
    } else if (anchored) {
      // 측면이 막힌 지형: 남는 부대는 정면 끝 부대 뒤에서 대기하다 자리가 나면 들어간다
      const extra = k - dMelee.length;
      const side = extra % 2 === 0 ? -1 : 1;
      const lane = side < 0 ? Math.floor(extra / 2) : dMelee.length - 1 - Math.floor(extra / 2);
      const x = -aWidth / 2 + meleeW * (Math.max(0, Math.min(dMelee.length - 1, lane)) + 0.5);
      specs.push({
        type: t,
        team: 0,
        x,
        z: startZ - 60,
        facing: FACE_N,
        order: defendBoth ? { kind: 'hold' } : { kind: 'attack', target: defIdx[lane] },
      });
    } else {
      // 남는 부대: 좌우 교대로 측면 우회
      const extra = k - dMelee.length;
      const side = extra % 2 === 0 ? -1 : 1;
      const tgt = side < 0 ? defIdx[0] : defIdx[defIdx.length - 1];
      const ex = side * (dWidth / 2 + 60 + Math.floor(extra / 2) * meleeW);
      specs.push({
        type: t,
        team: 0,
        x: side * (aWidth / 2 + meleeW * (0.5 + Math.floor(extra / 2))),
        z: startZ - 30,
        facing: FACE_N,
        order: defendBoth ? { kind: 'hold' } : { kind: 'attack', target: tgt },
        waypoints: defendBoth
          ? []
          : [
              [ex, lineZ - 20],
              [ex, lineZ + 10],
            ],
      });
    }
  });
  for (let k = 0; k < att.archer; k++) {
    const x = -aWidth / 2 + (aWidth / att.archer) * (k + 0.5);
    const tgt =
      defIdx[Math.min(defIdx.length - 1, Math.floor(((k + 0.5) / att.archer) * defIdx.length))];
    specs.push({
      type: 'archer',
      team: 0,
      x,
      z: startZ - 40,
      facing: FACE_N,
      order: defendBoth ? { kind: 'hold' } : { kind: 'attack', target: tgt },
    });
  }
  const defArchers = specs
    .map((s, i) => (s.team === 1 && s.type === 'archer' ? i : -1))
    .filter((i) => i >= 0);
  for (let k = 0; k < att.cavalry; k++) {
    const side = k % 2 === 0 ? -1 : 1;
    if (anchored) {
      // 우회로가 없으면 기병은 예비대로 둔다
      specs.push({
        type: 'cavalry',
        team: 0,
        x: side * (aWidth / 2 - 40),
        z: startZ - 80,
        facing: FACE_N,
        order: { kind: 'hold' },
        reserveRadius: 150,
        cycleCharge: true,
      });
      continue;
    }
    const ex = side * (dWidth / 2 + 150);
    const tgt = side < 0 ? defArchers[0] : defArchers[defArchers.length - 1];
    specs.push({
      type: 'cavalry',
      team: 0,
      x: side * (aWidth / 2 + 80),
      z: startZ,
      facing: FACE_N,
      order: defendBoth ? { kind: 'hold' } : { kind: 'attack', target: tgt ?? defIdx[0] },
      waypoints: defendBoth
        ? []
        : [
            [ex, lineZ - 60],
            [ex, lineZ + 120],
          ],
      cycleCharge: true,
    });
  }
  return specs;
}

export const DEF_ARMY: ArmyComp = { infantry: 4, spearman: 3, archer: 3, cavalry: 2 };
export const ATT_ARMIES: Array<{ label: string; c: ArmyComp }> = [
  { label: '동일', c: { ...DEF_ARMY } },
  { label: '+보1 창1', c: { infantry: 5, spearman: 4, archer: 3, cavalry: 2 } },
  { label: '+보2 창1 궁1', c: { infantry: 6, spearman: 4, archer: 4, cavalry: 2 } },
  { label: '+보3 창2 궁1', c: { infantry: 7, spearman: 5, archer: 4, cavalry: 2 } },
  { label: '+보4 창2 궁1 기1', c: { infantry: 8, spearman: 5, archer: 4, cavalry: 3 } },
];

export function s6Army(runs: number): string {
  const rows: string[][] = [];
  const lineZ = 420;
  const foot = lineZ - 25 / Math.tan((12 * Math.PI) / 180);
  const terrains = [
    { name: '평지, 측면 개방', t: ridge(0, 0, 0), anchored: false },
    { name: '평지, 측면 고정', t: ridge(0, 0, 0), anchored: true },
    { name: '능선 12°·25m, 측면 개방', t: ridge(12, 25, foot), anchored: false },
    { name: '능선 12°·25m, 측면 고정', t: ridge(12, 25, foot), anchored: true },
  ];
  for (const ter of terrains) {
    for (const a of ATT_ARMIES) {
      let defWin = 0;
      let attWin = 0;
      const times: number[] = [];
      const contact: number[] = [];
      const dl: number[] = [];
      const al: number[] = [];
      for (let s = 0; s < runs; s++) {
        const specs = armySpecs(a.c, DEF_ARMY, lineZ, false, ter.anchored);
        const r = runBattle(specs, {
          seed: 6000 + s,
          endMode: 'army',
          timeLimit: 1200,
          terrain: ter.t,
          bounds: { minX: -900, maxX: 900, minZ: -400, maxZ: 1200 },
        });
        if (r.winner === 1) defWin++;
        else if (r.winner === 0) attWin++;
        times.push(r.time);
        if (r.firstContact >= 0) contact.push(r.firstContact);
        al.push(1 - r.teamAlive[0] / r.teamStart[0]);
        dl.push(1 - r.teamAlive[1] / r.teamStart[1]);
      }
      const ratio = soldiers(a.c) / soldiers(DEF_ARMY);
      rows.push([
        ter.name,
        a.label,
        `${soldiers(a.c)} : ${soldiers(DEF_ARMY)} (${ratio.toFixed(2)}×)`,
        pct(defWin / runs),
        pct(attWin / runs),
        pct(1 - (defWin + attWin) / runs),
        sec(mean(contact)),
        sec(mean(times)),
        pct(mean(al)),
        pct(mean(dl)),
      ]);
    }
  }
  return table(
    [
      '지형',
      '공격 추가',
      '병력 공:방',
      '방어 승',
      '공격 승',
      '무승부/시간',
      '첫 접촉',
      '종료',
      '공격 손실',
      '방어 손실',
    ],
    rows,
  );
}

/**
 * 대칭 조우전 검증: 공격 쪽 배치를 180° 회전해 북쪽 군대를 만들고, 양쪽 모두 공격한다.
 * 같은 규칙이면 승률이 50% 근처여야 한다(시뮬레이터 편향 검사).
 */
export function s6Mirror(runs: number): string {
  let w0 = 0;
  let w1 = 0;
  const times: number[] = [];
  for (let s = 0; s < runs; s++) {
    const south = armySpecs(DEF_ARMY, DEF_ARMY, 420).filter((sp) => sp.team === 0);
    const M = 220;
    const north: UnitSpec[] = south.map((sp) => ({
      ...sp,
      team: 1,
      x: -sp.x,
      z: 2 * M - sp.z,
      facing: sp.facing + Math.PI,
      waypoints: sp.waypoints?.map(([x, z]) => [-x, 2 * M - z] as [number, number]),
    }));
    const specs = [...south, ...north];
    // 표적 다시 지정: 근접·궁수는 x가 가장 가까운 적 근접 부대, 기병은 반대편 궁수
    specs.forEach((sp) => {
      const enemies = specs.map((e, i) => ({ e, i })).filter(({ e }) => e.team !== sp.team);
      const pool = enemies.filter(({ e }) =>
        sp.type === 'cavalry'
          ? e.type === 'archer'
          : e.type === 'infantry' || e.type === 'spearman',
      );
      const tx = sp.waypoints?.length ? sp.waypoints[0][0] : sp.x;
      pool.sort((p, q) => Math.abs(p.e.x - tx) - Math.abs(q.e.x - tx));
      sp.order = { kind: 'attack', target: pool[0].i };
    });
    const r = runBattle(specs, { seed: 6500 + s, endMode: 'army', timeLimit: 1200 });
    if (r.winner === 0) w0++;
    else if (r.winner === 1) w1++;
    times.push(r.time);
  }
  return table(
    ['조건', '남쪽 승', '북쪽 승', '무승부', '평균 종료'],
    [
      [
        '평지 대칭 조우전(양쪽 공격)',
        pct(w0 / runs),
        pct(w1 / runs),
        pct(1 - (w0 + w1) / runs),
        sec(mean(times)),
      ],
    ],
  );
}

// ------------------------------------------------------------------ S7 다리 병목
/**
 * 공격 보병 2개 부대 vs 방어 보병 1 + 궁수 1. (a) 개활지: 두 부대가 나란히 공격.
 * (b) 폭 10m 다리: 7열 종대로 한 부대씩 들어가고, 앞 부대가 무너져야 다음 부대가 진입.
 */
export function s7Bridge(runs: number): string {
  const rows: string[][] = [];
  for (const mode of ['개활지', '다리(폭 10m)', '여울(폭 40m, 속도 ×0.5)']) {
    let aWin = 0;
    const aLoss: number[] = [];
    const dLoss: number[] = [];
    const times: number[] = [];
    for (let s = 0; s < runs; s++) {
      const bridge = mode.startsWith('다리');
      const ford = mode.startsWith('여울');
      const files = bridge ? 7 : ford ? 28 : undefined;
      const terrain: BattleTerrain = {
        height: () => 0,
        kind: (_x, z) =>
          ford && z > 60 && z < 160 ? 'ford' : bridge && z > 60 && z < 160 ? 'bridge' : 'grass',
      };
      const specs: UnitSpec[] = [
        {
          type: 'infantry',
          team: 0,
          x: bridge || ford ? 0 : -30,
          z: 0,
          facing: FACE_N,
          files,
          order: { kind: 'attack', target: 2 },
        },
        {
          type: 'infantry',
          team: 0,
          x: bridge || ford ? 0 : 30,
          z: bridge || ford ? -80 : 0,
          facing: FACE_N,
          files,
          order: bridge || ford ? { kind: 'hold' } : { kind: 'attack', target: 2 },
        },
        { type: 'infantry', team: 1, x: 0, z: 180, facing: FACE_S, order: { kind: 'hold' } },
        { type: 'archer', team: 1, x: 0, z: 230, facing: FACE_S, order: { kind: 'hold' } },
      ];
      const r = runBattle(specs, {
        seed: 7000 + s,
        endMode: 'army',
        breakRatio: 0.01,
        timeLimit: 900,
        terrain,
        script: (b) => {
          const u2 = b.units[1];
          if (
            (bridge || ford) &&
            u2.order.kind === 'hold' &&
            u2.state === 'ready' &&
            b.units[0].state !== 'ready'
          ) {
            u2.order = {
              kind: 'attack',
              target: b.units[2].alive && b.units[2].state === 'ready' ? 2 : 3,
            };
          }
        },
      });
      if (r.winner === 0) aWin++;
      times.push(r.time);
      aLoss.push(1 - r.teamAlive[0] / r.teamStart[0]);
      dLoss.push(1 - r.teamAlive[1] / r.teamStart[1]);
    }
    rows.push([mode, pct(aWin / runs), sec(mean(times)), pct(mean(aLoss)), pct(mean(dLoss))]);
  }
  return table(
    ['도하 지점', '공격(보병 600) 승', '종료', '공격 손실', '방어(보병 300+궁수 200) 손실'],
    rows,
  );
}

// ------------------------------------------------------------------ 공식 표
export function rangeTable(): string {
  const rows: string[][] = [];
  for (const dh of [-30, -20, -10, 0, 10, 20, 30, 40]) {
    const r = rangeWithHeight(160, dh);
    rows.push([`${dh > 0 ? '+' : ''}${dh}m`, `${Math.round(r)}m`, pct(r / 160)]);
  }
  return table(['사수-표적 고도차', '궁수 최대 사거리', '평지 대비'], rows);
}

export function slopeTable(): string {
  const rows: string[][] = [];
  for (const d of [0, 5, 10, 12, 15, 20, 25, 30, 31]) {
    rows.push([
      `${d}°`,
      d > 30 ? '통과 불가' : pct(slopeSpeedFactor(d)),
      d > 30 ? '통과 불가' : pct(slopeSpeedFactor(-d)),
    ]);
  }
  return table(['경사각', '오르막 계수', '내리막 계수'], rows);
}
