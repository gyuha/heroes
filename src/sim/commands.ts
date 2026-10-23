/**
 * 명령 검증·적용과 드래그 선분 분할(docs/INTERFACES.md §2, ARCHITECTURE §11.2, D-011).
 * UI 미리보기, 플레이어 명령(GameSession.issue), AI가 모두 이 순수 함수들을 쓴다.
 * 검증은 두 번 한다: issue 때 안내용으로 한 번, 큐에서 꺼내 적용할 때 최종 판정으로 한 번.
 */
import type { Command, CommandResult, DeployCheck, FormationId, MoveSlot, TeamId } from './api';
import { COMBAT, FORMATIONS } from './data/balance';
import { passable } from './terrainRules';
import type { Squad } from './squad';
import { placeSquadSoldiers } from './systems/formation';
import type { World } from './world';

/** 열 수를 GDD §4.3 범위(8~80)로 자른다. */
export function clampFiles(files: number): number {
  return Math.max(FORMATIONS.minFiles, Math.min(FORMATIONS.maxFiles, Math.round(files)));
}

/**
 * 중심 (cx, cz), 정면 facing, 전체 폭 width(m)인 선분 위에 부대들을 나란히 세울 자리를 계산한다.
 * 선분을 부대 수로 똑같이 나누고, 각 부대는 구간 폭 ÷ 좌우 간격만큼의 열 수(8~80)로 선다.
 * 부대 순서는 지금 위치를 선분 방향으로 투영한 순서라 이동 중 서로 엇갈리지 않는다.
 */
export function planLineMove(
  world: World,
  squadIds: readonly number[],
  cx: number,
  cz: number,
  facing: number,
  width: number,
): MoveSlot[] {
  const rx = Math.cos(facing);
  const rz = -Math.sin(facing);
  const list = squadIds
    .map((id) => world.squads[id])
    .filter((s): s is Squad => !!s)
    .sort((a, b) => a.x * rx + a.z * rz - (b.x * rx + b.z * rz) || a.id - b.id);
  const n = list.length;
  const seg = width / Math.max(1, n);
  return list.map((sq, k) => {
    const offset = (k - (n - 1) / 2) * seg;
    return {
      squadId: sq.id,
      x: cx + rx * offset,
      z: cz + rz * offset,
      facing,
      files: clampFiles(seg / sq.fileSpacing),
    };
  });
}

/**
 * 폭 없는 이동(우클릭 지면): 한 부대면 그 지점으로, 여러 부대면 지금의 상대 배치를 유지한 채
 * 무리 중심을 (x, z)로 옮긴다. facing이 없으면 각 부대의 이동 방향을 정면으로 선다(NaN).
 */
export function planGroupMove(
  world: World,
  squadIds: readonly number[],
  x: number,
  z: number,
  facing: number,
): MoveSlot[] {
  const list = squadIds.map((id) => world.squads[id]).filter((s): s is Squad => !!s);
  let mx = 0;
  let mz = 0;
  for (const s of list) {
    mx += s.x;
    mz += s.z;
  }
  mx /= Math.max(1, list.length);
  mz /= Math.max(1, list.length);
  return list.map((s) => ({
    squadId: s.id,
    x: x + (s.x - mx),
    z: z + (s.z - mz),
    facing,
    files: s.files,
  }));
}

/** 배치 가능 여부(GDD §2 배치): 대형 네 모서리와 중심이 자기 배치 구역 안이고 통과 가능해야 한다. */
export function canDeploy(
  world: World,
  team: TeamId,
  squadId: number,
  x: number,
  z: number,
  facing: number,
  files?: number,
  formation?: FormationId,
): DeployCheck {
  if (world.phase !== 'deployment') return { ok: false, reason: 'wrongPhase' };
  const sq = world.squads[squadId];
  if (!sq || sq.team !== team) return { ok: false, reason: 'notYourSquad' };
  const zone = world.deploymentZone(team);
  const spacing = sq.stats.fileSpacing * (formation === 'loose' ? FORMATIONS.loose.spacingMult : 1);
  const rankSpacing =
    sq.stats.rankSpacing * (formation === 'loose' ? FORMATIONS.loose.spacingMult : 1);
  const f = Math.max(1, Math.min(files ?? sq.files, sq.n));
  const hw = (f * spacing) / 2;
  const hd = (Math.ceil(sq.n / f) * rankSpacing) / 2;
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  for (const [lx, lz] of CORNERS) {
    const px = x + c * lx * hw + s * lz * hd;
    const pz = z - s * lx * hw + c * lz * hd;
    if (px < zone.minX || px > zone.maxX || pz < zone.minZ || pz > zone.maxZ) {
      return { ok: false, reason: 'outsideZone' };
    }
    if (!passable(world.terrain, px, pz)) return { ok: false, reason: 'impassable' };
  }
  return { ok: true };
}
const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

/**
 * 명령 검증(안내용·최종 판정 공용). 부대 목록 중 일부가 패주·괴멸이어도 'ok'다 — 그 부대만 적용할 때
 * 건너뛴다(GDD §7.2). 'ok'가 아닌 결과는 명령 전체를 버린다.
 */
export function validateCommand(world: World, cmd: Command): CommandResult {
  if (world.phase === 'result') return 'wrongPhase';
  if (cmd.kind === 'deploy') {
    if (world.phase !== 'deployment') return 'wrongPhase';
    const check = canDeploy(
      world,
      cmd.team,
      cmd.squad,
      cmd.x,
      cmd.z,
      cmd.facing,
      cmd.files,
      cmd.formation,
    );
    if (check.ok) return 'ok';
    return check.reason === 'notYourSquad' ? 'notYourSquad' : 'invalidPlacement';
  }
  if (cmd.squads.length === 0) return 'noSelection';
  for (const id of cmd.squads) {
    const sq = world.squads[id];
    if (!sq || sq.team !== cmd.team) return 'notYourSquad';
  }
  if (world.phase === 'deployment' && cmd.kind !== 'formation') return 'wrongPhase';
  if (cmd.kind === 'attack' || (cmd.kind === 'charge' && cmd.target !== undefined)) {
    const t = world.squads[cmd.target!];
    if (!t || t.team === cmd.team || !t.alive || !world.isVisible(t.id, cmd.team)) {
      return 'invalidTarget';
    }
  }
  return 'ok';
}

/** 큐에서 꺼낸 명령을 적용한다(World.step 맨 앞). 적용 시점에 다시 판정한다. */
export function applyCommand(world: World, cmd: Command): CommandResult {
  const r = validateCommand(world, cmd);
  if (r !== 'ok') return r;
  switch (cmd.kind) {
    case 'deploy': {
      const sq = world.squads[cmd.squad];
      sq.x = cmd.x;
      sq.z = cmd.z;
      sq.facing = cmd.facing;
      if (cmd.formation) sq.formation = cmd.formation;
      if (cmd.files) sq.files = clampFiles(cmd.files);
      placeSquadSoldiers(world, sq);
      return 'ok';
    }
    case 'move': {
      const facing = cmd.facing ?? NaN;
      const plan =
        cmd.width !== undefined && !Number.isNaN(facing)
          ? planLineMove(world, cmd.squads, cmd.x, cmd.z, facing, cmd.width)
          : planGroupMove(world, cmd.squads, cmd.x, cmd.z, facing);
      for (const p of plan) {
        const sq = world.squads[p.squadId];
        if (!sq.ready) continue;
        if (cmd.width !== undefined) sq.files = p.files;
        setOrder(sq, 'move', p.x, p.z, p.facing, -1, false);
      }
      return 'ok';
    }
    case 'attack':
    case 'charge': {
      for (const id of cmd.squads) {
        const sq = world.squads[id];
        if (!sq.ready) continue;
        const target = cmd.target ?? (sq.order.kind === 'attack' ? sq.order.target : -1);
        if (target < 0) continue;
        setOrder(sq, 'attack', 0, 0, NaN, target, cmd.kind === 'charge');
      }
      return 'ok';
    }
    case 'advance':
    case 'hold':
      for (const id of cmd.squads) {
        const sq = world.squads[id];
        if (sq.ready) setOrder(sq, cmd.kind, sq.x, sq.z, NaN, -1, false);
      }
      return 'ok';
    case 'formation':
      for (const id of cmd.squads) {
        const sq = world.squads[id];
        if (sq.state === 'destroyed') continue;
        sq.formation = cmd.formation;
        sq.files =
          cmd.files !== undefined
            ? clampFiles(cmd.files)
            : cmd.formation === 'column'
              ? FORMATIONS.column.files
              : sq.stats.files;
        if (world.phase === 'deployment') placeSquadSoldiers(world, sq);
      }
      return 'ok';
  }
}

/**
 * 부대 명령을 바꾼다. 근접 교전 중 이동 명령이면 이탈(3초 후방 판정, GDD §5.6)이 시작된다.
 * AI 전술층도 이 경로(명령 큐 → applyCommand)로만 부대를 움직인다.
 */
function setOrder(
  sq: Squad,
  kind: 'move' | 'attack' | 'advance' | 'hold',
  x: number,
  z: number,
  facing: number,
  target: number,
  charge: boolean,
): void {
  const o = sq.order;
  if (kind === 'move' && sq.engaged) sq.disengageTime = COMBAT.disengageRearTime;
  o.kind = kind;
  o.x = x;
  o.z = z;
  o.facing = facing;
  o.target = target;
  o.charge = charge;
  sq.path.length = 0;
  sq.pathIndex = 0;
  sq.repathTimer = 0;
  sq.pursueTime = 0;
  sq.reactOriginX = NaN;
  if (kind !== 'hold') sq.stillTime = 0;
  // 기병 돌격(Z)은 거리와 관계없이 바로 가속한다(GDD §5.4).
  if (charge && sq.stats.charge && sq.chargeCooldown <= 0) sq.chargeRequested = true;
}
