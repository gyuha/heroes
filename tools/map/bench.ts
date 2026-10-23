/**
 * 지형·경로·시야 비용 측정(T-006 보고용).
 *   node --experimental-transform-types --import ./tools/map/register.mjs tools/map/bench.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMap } from '../../src/sim/map/gameMap';
import { Pathfinder } from '../../src/sim/map/pathfinder';
import { Rng } from '../../src/sim/rng';
import { lineOfSight } from '../../src/sim/terrainRules';
import { VISION_BUCKETS, type VisionSquad, VisibilitySystem } from '../../src/sim/visibility';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', 'public', 'maps', 'reed_ford');

function time<T>(fn: () => T): [T, number] {
  const s = performance.now();
  const r = fn();
  return [r, performance.now() - s];
}

function bytes(path: string): ArrayBuffer {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

function main(): void {
  const meta = JSON.parse(String.fromCharCode(...readFileSync(join(dir, 'map.json'))));
  const h = bytes(join(dir, 'height.u16'));
  const t = bytes(join(dir, 'types.u8'));
  const parseTimes: number[] = [];
  let map = parseMap(meta, h, t);
  for (let i = 0; i < 5; i++) {
    const [m, ms] = time(() => parseMap(meta, h, t));
    map = m;
    parseTimes.push(ms);
  }
  const [, passMs] = time(() => map.terrain.passableAt(500, 500)); // 통과 표 생성(첫 조회)
  const [pf, pfMs] = time(() => new Pathfinder(map));
  console.log(
    `parseMap ${median(parseTimes).toFixed(1)}ms, 통과 표 ${passMs.toFixed(1)}ms, Pathfinder 생성 ${pfMs.toFixed(1)}ms`,
  );

  // 경로: 공격 배치 구역 → 방어 구역 깊숙이(강을 건넘), 부대 42개분
  const rng = new Rng(7);
  const routes: [number, number, number, number, boolean][] = [];
  for (let i = 0; i < 42; i++) {
    routes.push([
      rng.range(80, 940),
      rng.range(810, 970),
      rng.range(160, 880),
      rng.range(160, 540),
      i % 7 === 0,
    ]);
  }
  for (const r of routes.slice(0, 5)) pf.findPath(r[0], r[1], r[2], r[3], { mounted: r[4] }); // 예열
  const pathTimes: number[] = [];
  let total = 0;
  for (const r of routes) {
    const [, ms] = time(() => pf.findPath(r[0], r[1], r[2], r[3], { mounted: r[4] }));
    pathTimes.push(ms);
    total += ms;
  }
  console.log(
    `findPath 42회(강 건너기): 합계 ${total.toFixed(1)}ms, 중앙값 ${median(pathTimes).toFixed(2)}ms, 최대 ${Math.max(...pathTimes).toFixed(2)}ms`,
  );
  const short: number[] = [];
  for (let i = 0; i < 42; i++) {
    const x = rng.range(200, 800);
    const z = rng.range(200, 500);
    const [, ms] = time(() =>
      pf.findPath(x, z, x + rng.range(-80, 80), z + rng.range(-80, 80), { mounted: false }),
    );
    short.push(ms);
  }
  console.log(
    `findPath 42회(같은 강변, 100m 안팎): 중앙값 ${median(short).toFixed(2)}ms, 최대 ${Math.max(...short).toFixed(2)}ms`,
  );

  // LOS 1회: 북쪽 둔덕 아래 평지에서 동서로 340m(끝까지 열린 선 = 표본 전부 검사)
  const tr = map.terrain;
  const ay = tr.heightAt(250, 880) + 1.7;
  const by = tr.heightAt(590, 880) + 1.7;
  if (!lineOfSight(tr, 250, ay, 880, 590, by, 880)) throw new Error('LOS 측정 선이 막혀 있다');
  const [, loopMs] = time(() => {
    for (let k = 0; k < 10000; k++) lineOfSight(tr, 250, ay, 880, 590, by, 880);
  });
  console.log(
    `lineOfSight 340m(열린 선, 표본 170개) 1회: ${((loopMs / 10000) * 1000).toFixed(1)}µs`,
  );

  // 시야: 방어 16 + 공격 26 부대. 두 군대가 능선과 강을 사이에 두고 200~400m 떨어진 배치(최악에 가까움)
  const squads: VisionSquad[] = [];
  for (let i = 0; i < 16; i++)
    squads.push({
      team: 0,
      alive: true,
      x: 160 + i * 45,
      z: rng.range(380, 540),
      facing: 0,
      width: 56,
      depth: 10,
      mounted: i >= 13,
    });
  for (let i = 0; i < 26; i++)
    squads.push({
      team: 1,
      alive: true,
      x: 80 + i * 34,
      z: rng.range(640, 820),
      facing: Math.PI,
      width: 56,
      depth: 10,
      mounted: i >= 20,
    });
  const vis = new VisibilitySystem(map.terrain, squads.length);
  let simTime = 0;
  for (let i = 0; i < 40; i++) vis.update((simTime += 0.05), squads); // 예열
  const tickTimes: number[] = [];
  for (let i = 0; i < 200; i++) {
    const [, ms] = time(() => vis.update((simTime += 0.05), squads));
    tickTimes.push(ms);
  }
  const cycleMs = tickTimes.slice(0, VISION_BUCKETS).reduce((a, b) => a + b, 0);
  let visible = 0;
  for (let j = 16; j < 42; j++) if (vis.isVisible(j, 0)) visible++;
  console.log(
    `시야 update(42부대) 틱당: 중앙값 ${median(tickTimes).toFixed(3)}ms, 최대 ${Math.max(...tickTimes).toFixed(3)}ms, 0.5초 주기 합 ${cycleMs.toFixed(2)}ms (방어가 보는 공격 부대 ${visible}/26)`,
  );
}

main();
