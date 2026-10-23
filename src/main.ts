import { GameSession } from './app/gameSession';
import { loadMap } from './app/loadMap';
import { StatsOverlay } from './app/statsOverlay';
import { GameRenderer } from './render/gameRenderer';
import { Pathfinder } from './sim/map/pathfinder';
import { MAX_SCALE, MIN_SCALE, scaleScenario } from './sim/scenario';
import { REED_FORD } from './sim/scenarios/reedFord';
import { mountUi } from './ui/mountUi';

/**
 * 조립만 한다: 맵 로드 → 세션(World·AI) → 렌더러 → UI → 루프.
 * URL 파라미터(개발용): ?seed=3 시드, ?aivai AI 대 AI 관전, ?autostart 배치 생략(브리핑이면 청람 선택),
 * ?speed=4 배속, ?stats 성능 표시, ?lod=0 원거리 LOD 끄기, ?scale=0.5 부대마다 병사 수 × k(0.25~2, 성능 측정용, ARCHITECTURE §9.3)
 */
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 1) || 1;
const SPEEDS = [1, 2, 4] as const;
/** ?lod=0 이면 원거리 LOD 모델을 쓰지 않는다(비교 측정용, D-017) */
const lod = params.get('lod') !== '0';
const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(params.get('scale') ?? 1) || 1));

async function start(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('#app 요소가 없습니다');

  const map = await loadMap(REED_FORD.id);
  const pathfinder = new Pathfinder(map);
  const session = new GameSession({
    map,
    pathfinder,
    scenario: scaleScenario(REED_FORD, scale),
    seed,
    spectate: params.has('aivai'),
    scale,
  });
  const speed = Number(params.get('speed'));
  if ((SPEEDS as readonly number[]).includes(speed)) session.setSpeed(speed as 1 | 2 | 4);

  const view = await GameRenderer.create(container, map, session.world, { lod });
  const ui = mountUi({
    container,
    session,
    view: { camera: view.camera, scene: view.scene, renderer: view.renderer },
  });
  const onResize = (): void => view.resize(container.clientWidth, container.clientHeight);
  window.addEventListener('resize', onResize);
  if (params.has('autostart')) {
    // 브리핑이면 청람(방어, 권장 진영)으로 고른 뒤 바로 전투를 시작한다
    if (session.phase === 'briefing') session.chooseSide(0);
    session.startBattle();
  }
  // 개발·QA 자동화용 핸들(개발 서버 또는 ?stats 에서만)
  if (import.meta.env.DEV || params.has('stats')) {
    (window as unknown as { __game: unknown }).__game = { session, view, ui };
  }

  const stats =
    import.meta.env.DEV || params.has('stats')
      ? new StatsOverlay(container, () => {
          const w = session.world;
          const r = w.result;
          const info = view.renderer.info.render;
          return (
            `soldiers ${w.units.count}  alive ${countAlive(session)}  tick ${w.tick}  t ${w.time.toFixed(0)}s  ${session.phase}` +
            `${session.paused ? ' (paused)' : ''} ×${session.speed}` +
            `${session.scale !== 1 ? `  scale ${session.scale}` : ''}` +
            `${session.maxSpeed < 4 ? `  max ×${session.maxSpeed}` : ''}\n` +
            `soldier tris ${(view.soldierTriangles / 1e6).toFixed(2)}M  frame tris ${(info.triangles / 1e6).toFixed(2)}M` +
            `  draw calls ${info.calls}  lod ${lod ? `${view.lodSquadCount}/${w.squads.length} far` : 'off'}` +
            (r ? `\nresult: winner ${r.winner} (${r.reason}) at ${r.time.toFixed(0)}s` : '')
          );
        })
      : null;

  let last = performance.now();
  function frame(now: number): void {
    const frameMs = now - last;
    last = now;
    const simStart = performance.now();
    const steps = session.advance(frameMs);
    const simMs = performance.now() - simStart;
    ui.update(Math.min(frameMs, 100) / 1000);
    view.render(
      session.world,
      session.alpha,
      session.playerTeam,
      ui.camera.tacticalView,
      ui.camera.distance,
    );
    stats?.record(frameMs, simMs, steps, performance.now() - now);
    rafId = requestAnimationFrame(frame);
  }
  let rafId = requestAnimationFrame(frame);

  // 루프를 멈추고 자원을 푼다: 페이지를 떠날 때, 개발 서버가 이 모듈을 다시 불러올 때(HMR)
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', onResize);
    ui.dispose();
    view.dispose();
  };
  // 뒤로 가기 캐시에 들어가는 페이지(persisted)는 돌아올 수 있으므로 멈추지 않는다
  window.addEventListener('pagehide', (e) => {
    if (!e.persisted) stop();
  });
  import.meta.hot?.dispose(stop);
}

function countAlive(session: GameSession): number {
  const s = session.strength(0);
  const t = session.strength(1);
  return s.effective + s.routing + t.effective + t.routing;
}

// 실패하면 다시 던져 unhandledrejection 으로 index.html 로딩 화면에 오류를 띄운다
start().catch((err: unknown) => {
  console.error(err);
  throw err;
});
