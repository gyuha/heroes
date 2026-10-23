import { FixedStepClock } from './app/fixedStepClock';
import { StatsOverlay } from './app/statsOverlay';
import { GameRenderer } from './render/gameRenderer';
import { TICK_DT } from './sim/constants';
import { spawnPlaceholderBattle } from './sim/placeholderBattle';
import { generateTerrain } from './sim/terrainGen';
import { World } from './sim/world';

// URL 파라미터로 병사 수와 시드를 바꿔 성능을 측정한다. 예: ?units=10000&seed=3
const params = new URLSearchParams(location.search);
const DEFAULT_UNITS = 4000;
const MAX_UNITS = 50_000;
const unitCount = Math.min(
  MAX_UNITS,
  Math.max(0, Number(params.get('units') ?? DEFAULT_UNITS) || 0),
);
const seed = Number(params.get('seed') ?? 1) || 1;

const container = document.getElementById('app');
if (!container) throw new Error('#app 요소가 없습니다');

const terrain = generateTerrain({ cellsX: 256, cellsZ: 256, cellSize: 2, seed, maxHeight: 40 });
const world = new World(terrain, unitCount);
spawnPlaceholderBattle(world, unitCount, seed);

const view = new GameRenderer(container, world);
window.addEventListener('resize', () => view.resize(container.clientWidth, container.clientHeight));

const clock = new FixedStepClock(TICK_DT * 1000);
const stats =
  import.meta.env.DEV || params.has('stats')
    ? new StatsOverlay(
        container,
        () =>
          `units ${world.units.count}  tick ${world.tick}\n` +
          `tris ${((world.units.count * view.units.trianglesPerUnit) / 1e6).toFixed(2)}M ` +
          `(${view.units.trianglesPerUnit}/unit)  draw calls ${view.renderer.info.render.calls}`,
      )
    : null;

let last = performance.now();
function frame(now: number): void {
  const frameMs = now - last;
  last = now;

  const steps = clock.advance(frameMs);
  const simStart = performance.now();
  for (let s = 0; s < steps; s++) world.step(TICK_DT);
  const simMs = performance.now() - simStart;

  view.render(Math.min(frameMs, 100) / 1000, clock.alpha);
  stats?.record(frameMs, simMs, steps, performance.now() - now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
