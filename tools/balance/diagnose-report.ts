/**
 * diagnose.ts 결과(JSON 여러 개)를 계획별 마크다운 표로 묶는다.
 *   node tools/balance/diagnose-report.ts /tmp/t015/diag_*.json > /tmp/t015/report.md
 */
import { readFileSync } from 'node:fs';
import type { GameDiag, SquadDiag } from './diagnose.ts';

const files = process.argv.slice(2);
const games: GameDiag[] = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as GameDiag[]);
// 초기 버전 diagnose.ts는 역할 변화를 1초마다 덧붙였다. "처음>마지막"으로 정리한다.
for (const g of games)
  for (const s of g.squads) {
    const parts = s.stance.split('>');
    s.stance =
      parts.length > 1 && parts[0] !== parts[parts.length - 1]
        ? `${parts[0]}>${parts[parts.length - 1]}`
        : parts[0];
  }
const plans = [...new Set(games.map((g) => g.plan))].sort();

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '-');
const n0 = (v: number) => (Number.isFinite(v) ? `${Math.round(v)}` : '-');
const mmss = (v: number) =>
  Number.isFinite(v) && v >= 0
    ? `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}`
    : '-';
function table(head: string[], rows: string[][]): string {
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

const ATT_TEAM_TYPES = (g: GameDiag) => g.squads.filter((s) => s.stance !== 'defend');
const melee = (s: SquadDiag) => s.type !== 'archer' && s.stance !== 'commander';
const DEF = 0;

const out: string[] = [];
const by = (p: string) => games.filter((g) => g.plan === p);

// 1. 결과와 교전 강도
out.push('### 결과와 교전 강도\n');
out.push(
  table(
    [
      '계획',
      '판',
      '방어 승',
      '종료 사유',
      '첫 접촉',
      '깃발 150m 진입(판 비율, 평균 시각)',
      '깃발 40m 진입',
      '점령 진행도 최대(평균)',
      '공격 손실',
      '방어 손실',
      '손실 교환비(공/방)',
      '공격 교전 병사·초 비율',
    ],
    plans.map((p) => {
      const gs = by(p);
      const reasons = [...new Set(gs.map((g) => g.reason))]
        .map((r) => `${r} ${gs.filter((g) => g.reason === r).length}`)
        .join(', ');
      const t150 = gs.filter((g) => g.t150 >= 0);
      const t40 = gs.filter((g) => g.t40 >= 0);
      const attL = mean(gs.map((g) => g.attLost / g.attStart));
      const defL = mean(gs.map((g) => g.defLost / g.defStart));
      return [
        p,
        `${gs.length}`,
        pct(gs.filter((g) => g.winner === DEF).length / gs.length),
        reasons,
        mmss(mean(gs.map((g) => g.firstContact))),
        `${pct(t150.length / gs.length)}, ${mmss(mean(t150.map((g) => g.t150)))}`,
        `${pct(t40.length / gs.length)}, ${mmss(mean(t40.map((g) => g.t40)))}`,
        n0(mean(gs.map((g) => g.maxProgress))),
        pct(attL),
        pct(defL),
        (mean(gs.map((g) => g.attLost)) / Math.max(1, mean(gs.map((g) => g.defLost)))).toFixed(1),
        pct(mean(gs.map((g) => g.attEngagedSoldierSec / Math.max(1, g.attSoldierSec)))),
      ];
    }),
  ),
);

// 2. 공격 근접 부대: 역할별
out.push('\n\n### 공격 근접 부대(궁수·지휘관 제외) 역할별\n');
const rows2: string[][] = [];
for (const p of plans) {
  const gs = by(p);
  const all = gs.flatMap((g) => ATT_TEAM_TYPES(g).filter(melee));
  const stances = [...new Set(all.map((s) => s.stance))].sort();
  for (const st of stances) {
    const ss = all.filter((s) => s.stance === st);
    rows2.push([
      p,
      st,
      (ss.length / gs.length).toFixed(1),
      pct(ss.filter((s) => s.firstEngage < 0).length / ss.length),
      mmss(median(ss.filter((s) => s.firstEngage >= 0).map((s) => s.firstEngage))),
      pct(mean(ss.map((s) => s.engagedSec / Math.max(1, s.readySec)))),
      pct(ss.filter((s) => s.crossedAt >= 0).length / ss.length),
      n0(median(ss.map((s) => s.minFlagDist))),
      pct(mean(ss.map((s) => 1 - s.end / s.start))),
      pct(ss.filter((s) => s.routed).length / ss.length),
    ]);
  }
}
out.push(
  table(
    [
      '계획',
      '역할(최종)',
      '판당 부대 수',
      '한 번도 교전 안 함',
      '첫 교전(중앙값)',
      '교전 시간/준비 시간',
      '도하함',
      '깃발 최소 거리(중앙값, m)',
      '손실률',
      '패주 경험',
    ],
    rows2,
  ),
);

// 3. 도하 흐름
out.push('\n\n### 도하 지점별 병력 흐름(판당 평균, 근접 부대)\n');
out.push(
  table(
    [
      '계획',
      '동쪽 다리 병력',
      '여울 병력',
      '서쪽 다리 병력',
      '첫 도하 시각',
      '도하 안 한 근접 병력',
      '예비대 투입 시각',
    ],
    plans.map((p) => {
      const gs = by(p);
      const lane = (l: string) =>
        mean(
          gs.map((g) =>
            ATT_TEAM_TYPES(g)
              .filter((s) => melee(s) && s.crossing === l)
              .reduce((a, s) => a + s.crossCount, 0),
          ),
        );
      return [
        p,
        n0(lane('eastBridge')),
        n0(lane('ford')),
        n0(lane('westBridge')),
        mmss(
          mean(
            gs.map((g) =>
              Math.min(
                ...ATT_TEAM_TYPES(g)
                  .filter((s) => s.crossedAt >= 0)
                  .map((s) => s.crossedAt),
              ),
            ),
          ),
        ),
        n0(
          mean(
            gs.map((g) =>
              ATT_TEAM_TYPES(g)
                .filter((s) => melee(s) && s.crossedAt < 0)
                .reduce((a, s) => a + s.start, 0),
            ),
          ),
        ),
        mmss(mean(gs.filter((g) => g.reserveCommitAt >= 0).map((g) => g.reserveCommitAt))),
      ];
    }),
  ),
);

// 4. 궁수
out.push('\n\n### 공격 궁수(준비 상태 시간 대비)\n');
out.push(
  table(
    ['계획', '사격 중', '명령 표적이 사거리 밖', '이동 중', '도하함', '손실률'],
    plans.map((p) => {
      const ar = by(p).flatMap((g) => ATT_TEAM_TYPES(g).filter((s) => s.type === 'archer'));
      const r = (f: (s: SquadDiag) => number) =>
        pct(mean(ar.map((s) => f(s) / Math.max(1, s.readySec))));
      return [
        p,
        r((s) => s.firingSec),
        r((s) => s.outOfRangeSec),
        r((s) => s.movingSec),
        pct(ar.filter((s) => s.crossedAt >= 0).length / ar.length),
        pct(mean(ar.map((s) => 1 - s.end / s.start))),
      ];
    }),
  ),
);

// 5. 돌격·측후방
out.push('\n\n### 공격 측 돌격과 측후방 공격(판당)\n');
out.push(
  table(
    [
      '계획',
      '돌격 충격',
      '0명 처치 비율',
      '충격당 처치',
      '방향별 충격',
      '돌격 실패(원인)',
      '방어 측 피격 로그(측면/후방)',
      '공격 측 피격 로그(측면/후방)',
      '패주 방/공',
    ],
    plans.map((p) => {
      const gs = by(p);
      const imp = gs.reduce((a, g) => a + g.chargeImpacts, 0);
      const sum = (pick: (g: GameDiag) => Record<string, number>) => {
        const acc: Record<string, number> = {};
        for (const g of gs)
          for (const [k, v] of Object.entries(pick(g))) acc[k] = (acc[k] ?? 0) + v;
        return (
          Object.entries(acc)
            .map(([k, v]) => `${k} ${(v / gs.length).toFixed(1)}`)
            .join(', ') || '-'
        );
      };
      return [
        p,
        (imp / gs.length).toFixed(1),
        pct(gs.reduce((a, g) => a + g.chargeZeroKill, 0) / Math.max(1, imp)),
        (gs.reduce((a, g) => a + g.chargeKills, 0) / Math.max(1, imp)).toFixed(1),
        sum((g) => g.chargeBySide),
        sum((g) => g.chargeFailed),
        sum((g) => g.attackedLogs.def),
        sum((g) => g.attackedLogs.att),
        `${mean(gs.map((g) => g.routsDef)).toFixed(1)} / ${mean(gs.map((g) => g.routsAtt)).toFixed(1)}`,
      ];
    }),
  ),
);

// 6. 방어 부대 역할별 교전
out.push('\n\n### 방어 부대 역할별\n');
const rows6: string[][] = [];
for (const p of plans) {
  const gs = by(p);
  const all = gs.flatMap((g) => g.squads.filter((s) => s.stance === 'defend'));
  for (const role of [...new Set(all.map((s) => s.role))]) {
    const ss = all.filter((s) => s.role === role);
    rows6.push([
      p,
      role,
      pct(ss.filter((s) => s.firstEngage < 0).length / ss.length),
      pct(mean(ss.map((s) => s.engagedSec / Math.max(1, s.readySec)))),
      pct(mean(ss.map((s) => 1 - s.end / s.start))),
      pct(ss.filter((s) => s.routed).length / ss.length),
    ]);
  }
}
out.push(
  table(
    ['계획', '역할', '한 번도 교전 안 함', '교전 시간/준비 시간', '손실률', '패주 경험'],
    rows6,
  ),
);

console.log(out.join('\n'));
