/**
 * 밸런스 시뮬레이션 실행기.
 *   node tools/balance/run.ts            # 전체, 결과를 tools/balance/results.md 에 저장
 *   node tools/balance/run.ts s1 s4      # 일부 시나리오만(저장 안 함)
 *   RUNS=200 node tools/balance/run.ts   # 반복 횟수 변경(기본: 교전 100, 군대 40)
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  rangeTable,
  s1Matrix,
  s2Flank,
  s3Charge,
  s4Slope,
  s5Approach,
  s6Army,
  s6Mirror,
  s7Bridge,
  slopeTable,
} from './scenarios.ts';

const runs = Number(process.env.RUNS ?? 0);
const duelRuns = runs || 100;
const armyRuns = runs || 40;

const all: Array<[string, string, () => string]> = [
  ['f', '공식 표: 경사 이동 계수 / 고도차 사거리', () => `${slopeTable()}\n\n${rangeTable()}`],
  ['s1', `S1. 1:1 교전 매트릭스 (평지, 200m에서 공격, 각 ${duelRuns}회)`, () => s1Matrix(duelRuns)],
  ['s2', `S2. 정면 고정 + 측면·후방 타격 (각 ${duelRuns}회)`, () => s2Flank(duelRuns)],
  ['s3', `S3. 기병 돌격 대상별 결과 (각 ${duelRuns}회)`, () => s3Charge(duelRuns)],
  ['s4', `S4. 경사 위 고수 보병 vs 오르막 공격 보병 (각 ${duelRuns}회)`, () => s4Slope(duelRuns)],
  ['s5', `S5. 보병 1+궁수 2 진지로 접근 (각 ${duelRuns}회)`, () => s5Approach(duelRuns)],
  [
    's6',
    `S6. 군대 전투: 방어 고수 vs 공격, 병력비 (각 ${armyRuns}회)`,
    () => `${s6Army(armyRuns)}\n\n${s6Mirror(armyRuns)}`,
  ],
  ['s7', `S7. 도하 지점별 공격 (각 ${duelRuns}회)`, () => s7Bridge(duelRuns)],
];

const pick = process.argv.slice(2);
const chosen = pick.length ? all.filter(([k]) => pick.includes(k)) : all;
const out: string[] = [
  `<!-- node tools/balance/run.ts 로 생성. 직접 고치지 않는다. -->`,
  `# 밸런스 시뮬레이션 결과`,
  '',
];
for (const [, title, fn] of chosen) {
  const t0 = performance.now();
  const body = fn();
  const ms = performance.now() - t0;
  const block = `## ${title}\n\n${body}\n\n_실행 시간 ${(ms / 1000).toFixed(1)}s_\n`;
  console.log(block);
  out.push(block);
}
if (!pick.length) {
  const file = join(dirname(fileURLToPath(import.meta.url)), 'results.md');
  writeFileSync(file, out.join('\n'));
  console.log(`저장: ${file}`);
}
