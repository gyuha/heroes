/**
 * UI가 묻는 지형 질의(docs/INTERFACES.md §3.3): 마우스 오버 정보, 경로 미리보기, 궁수 사거리, 병목 아이콘.
 * A의 지형 API(terrainRules, Pathfinder, GameMap)와 공식(rules.ts)을 그대로 쓰고 규칙을 새로 만들지 않는다.
 * 계산 방식은 UI·UX 담당의 개발용 목업(src/ui/dev/session_mock.ts)과 같다.
 */
import type { UnitTypeId } from '../sim/api';
import { TERRAIN, UNIT_TYPES } from '../sim/data/balance';
import type { GameMap } from '../sim/map/gameMap';
import type { Pathfinder } from '../sim/map/pathfinder';
import { rangeWithHeight } from '../sim/rules';
import type { Squad } from '../sim/squad';
import { TerrainType } from '../sim/terrain';
import { fireLine, moveFactor, typeSpeedFactor } from '../sim/terrainRules';
import type {
  MapFeatureView,
  PathPreviewView,
  RangeProfileView,
  TerrainInfoView,
} from '../ui/gameView';

/** 경로 미리보기에서 숲·다리를 찾는 표본 간격(m) */
const PATH_STEP = 4;
/** 궁수 사거리 투영 방향 수와 걸음(m) */
const RANGE_DIRECTIONS = 64;
const RANGE_STEP = 4;

const TYPE_NAMES: Record<number, string> = {
  [TerrainType.Grass]: '평지',
  [TerrainType.Forest]: '숲',
  [TerrainType.Rock]: '절벽',
  [TerrainType.Sand]: '흙길',
  [TerrainType.Water]: '강',
  [TerrainType.Ford]: '여울',
  [TerrainType.Bridge]: '다리',
};

const grad = new Float32Array(2);

export function terrainInfo(
  map: GameMap,
  x: number,
  z: number,
  type: UnitTypeId | null,
): TerrainInfoView {
  const t = map.terrain;
  const id = t.typeAt(x, z);
  const passable = t.passableAt(x, z);
  const pct = (f: number) => `${Math.round(f * 100)}%`;
  const foot = typeSpeedFactor(id, false);
  const horse = typeSpeedFactor(id, true);
  const effects: string[] = [];
  if (!passable) {
    effects.push(
      id === TerrainType.Water || id === TerrainType.Rock
        ? '통과 불가'
        : '통과 불가 — 경사 30° 초과',
    );
  } else {
    if (id !== TerrainType.Grass) {
      effects.push(foot === horse ? `이동 ${pct(foot)}` : `이동 ${pct(foot)} · 기병 ${pct(horse)}`);
    }
    if (id === TerrainType.Forest)
      effects.push('은폐 — 40m 밖에서 안 보임', '돌격 불가', '안의 표적 화살 명중 ×0.5');
    if (id === TerrainType.Ford)
      effects.push('돌격 불가', `공격 ×${TERRAIN.fordDamageMult}`, 'Brace 불가');
    if (id === TerrainType.Bridge) effects.push('좁은 통로 — 종대로 통과');
  }
  let factor: number | null = null;
  if (type) {
    // 가장 느린 방향 = 오르막(기울기 방향)
    t.gradientAt(x, z, grad);
    const flat = Math.hypot(grad[0], grad[1]) < 1e-6;
    factor = moveFactor(t, x, z, flat ? 0 : grad[0], flat ? 1 : grad[1], UNIT_TYPES[type].mounted);
  }
  return {
    typeName: TYPE_NAMES[id] ?? `종류 ${id}`,
    height: t.heightAt(x, z),
    slopeDeg: (t.slopeAt(x, z) * 180) / Math.PI,
    passable,
    moveFactor: factor,
    effects,
  };
}

export function previewPath(
  map: GameMap,
  pathfinder: Pathfinder,
  s: Squad,
  toX: number,
  toZ: number,
): PathPreviewView {
  const t = map.terrain;
  const mounted = s.mounted;
  const r = pathfinder.findPath(s.x, s.z, toX, toZ, { mounted });
  const pts = [{ x: s.x, z: s.z }, ...r.points];
  const points = new Float32Array(pts.length * 2);
  const factors = new Float32Array(pts.length);
  let throughForest = false;
  let throughBridge = false;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const next = pts[Math.min(i + 1, pts.length - 1)];
    points[i * 2] = p.x;
    points[i * 2 + 1] = p.z;
    factors[i] = moveFactor(
      t,
      (p.x + next.x) / 2,
      (p.z + next.z) / 2,
      next.x - p.x,
      next.z - p.z,
      mounted,
    );
    if (i + 1 >= pts.length) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(next.x - p.x, next.z - p.z) / PATH_STEP));
    for (let k = 0; k <= n; k++) {
      const type = t.typeAt(p.x + ((next.x - p.x) * k) / n, p.z + ((next.z - p.z) * k) / n);
      if (type === TerrainType.Forest) throughForest = true;
      if (type === TerrainType.Bridge) throughBridge = true;
    }
  }
  const warnings: string[] = [];
  if (throughForest && (s.stats.charge || s.stats.footCharge)) warnings.push('돌격 불가 — 숲 통과');
  if (throughBridge || r.minWidth < s.width) warnings.push('종대 통과 — 좁은 길');
  return {
    points,
    factors,
    reachable: r.found && !r.snapped,
    etaSeconds: r.effort / s.stats.walkSpeed,
    warnings,
  };
}

/** 궁수 실제 사거리(GDD §6.3)와 직사 가능 거리(§5.5)를 방향마다 잰다. */
export function rangeProfile(map: GameMap, s: Squad): RangeProfileView | null {
  const ranged = s.stats.ranged;
  if (!ranged) return null;
  const t = map.terrain;
  const h0 = t.heightAt(s.x, s.z);
  const radii = new Float32Array(RANGE_DIRECTIONS);
  const directUntil = new Float32Array(RANGE_DIRECTIONS);
  const maxR = ranged.range * TERRAIN.rangeMaxMult;
  for (let i = 0; i < RANGE_DIRECTIONS; i++) {
    const a = (i / RANGE_DIRECTIONS) * Math.PI * 2;
    const ux = Math.sin(a);
    const uz = Math.cos(a);
    let r = 0;
    let direct = 0;
    let directOpen = true;
    for (let d = RANGE_STEP; d <= maxR; d += RANGE_STEP) {
      const px = s.x + ux * d;
      const pz = s.z + uz * d;
      if (!t.contains(px, pz)) break;
      if (d > rangeWithHeight(ranged.range, h0 - t.heightAt(px, pz))) break;
      r = d;
      if (directOpen && fireLine(t, s.x, s.z, px, pz) === 'direct') direct = d;
      else directOpen = false;
    }
    radii[i] = r;
    directUntil[i] = direct;
  }
  return { x: s.x, z: s.z, radii, directUntil };
}

export function mapFeatures(map: GameMap): MapFeatureView[] {
  return [
    ...map.meta.bridges.map((b) => ({ kind: 'bridge' as const, x: b.x, z: b.z })),
    ...map.meta.fords.map((f) => ({ kind: 'ford' as const, x: f.x, z: f.z })),
  ];
}
