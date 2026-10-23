/**
 * 부대 중심(대형 기준점)의 이동과 명령 수행(GDD §4.5, §5.4, §5.6, §7.2).
 * 병사는 soldierMovement가 대형 자리로 따라온다.
 */
import { MORALE } from '../data/balance';
import { SQUAD } from '../data/simConfig';
import { moveFactor } from '../terrainRules';
import { len2, wrapAngle } from '../math';
import { rangeWithHeight } from '../rules';
import type { Squad } from '../squad';
import { TerrainType } from '../terrain';
import type { World } from '../world';
import { squadGap } from './combat';
import { aboutFace } from './formation';

/** 정면을 이보다 크게 바꿔야 하면 회전 대신 뒤로 돈다(rad). */
const ABOUT_FACE_ANGLE = (2 * Math.PI) / 3;
/** 경유점 도착 판정(m) */
const WAYPOINT_DIST = 2;
/** 중간 경유점·표적 쪽 앞을 보는 거리(m) */
const ADVANCE_STEP = 20;
/** 이 거리 안의 적 부대만 이동 막힘 검사(m) */
const BLOCK_CHECK_DIST = 150;
/** 패주 경로가 막혔을 때 시도하는 방향 회전(rad) */
const FLEE_TRIES = [
  0,
  Math.PI / 4,
  -Math.PI / 4,
  Math.PI / 2,
  -Math.PI / 2,
  (3 * Math.PI) / 4,
  (-3 * Math.PI) / 4,
];
/** 기병은 표적과 이보다 멀면 달려서 접근(m, 시뮬레이터와 같음) */
const MOUNTED_RUN_GAP = 60;
/** 보병 돌격: 달리기 속도의 이 비율 이상이어야 돌격 거리로 센다(GDD §5.4) */
const FOOT_CHARGE_SPEED_RATIO = 0.7;
const THINK_SLOTS = Math.round(SQUAD.thinkInterval * 20);

export function updateSquads(world: World, dt: number): void {
  for (const sq of world.squads) {
    if (!sq.alive) continue;
    tickTimers(sq, dt);
    sq.groundY = world.terrain.heightAt(sq.x, sq.z);
    const x0 = sq.x;
    const z0 = sq.z;
    if (sq.state === 'routing') flee(world, sq, dt);
    else {
      if ((sq.id + world.tick) % THINK_SLOTS === 0) think(world, sq);
      act(world, sq, dt);
    }
    const moved = len2(sq.x - x0, sq.z - z0);
    // 자동 폭 조정은 움직이는 동안, 또는 줄여 둔 열 수를 되돌릴 수 있는지 볼 때만 잰다
    if (sq.state === 'ready' && (moved > STILL_EPS || sq.autoFiles > 0))
      updateCorridor(world, sq, dt);
    sq.speed = moved / dt;
    if (moved > STILL_EPS) sq.stillTime = 0;
    else {
      sq.stillTime += dt;
      sq.baseSpeed = 0;
      sq.travelSpeed = 0;
    }
    sq.onFord = world.terrain.typeAt(sq.x, sq.z) === TerrainType.Ford;
    if (world.vision) sq.concealed = world.vision.isConcealed(sq.id);
  }
}
const STILL_EPS = 0.01;

function tickTimers(sq: Squad, dt: number): void {
  if (sq.chargeCooldown > 0) sq.chargeCooldown -= dt;
  if (sq.chargeBonusTime > 0) sq.chargeBonusTime -= dt;
  if (sq.disengageTime > 0) sq.disengageTime -= dt;
  if (sq.flankTimer > 0) sq.flankTimer -= dt;
  if (sq.rearTimer > 0) sq.rearTimer -= dt;
}

// ------------------------------------------------------------------ 판단(0.5초마다)

/** 명령 없는 부대의 자동 반응, 전진 명령의 표적 찾기(GDD §7.2). */
function think(world: World, sq: Squad): void {
  const o = sq.order;
  if (!Number.isNaN(sq.reactOriginX)) {
    if (
      o.kind !== 'attack' ||
      len2(sq.x - sq.reactOriginX, sq.z - sq.reactOriginZ) > SQUAD.idleReactDist
    ) {
      o.kind = 'none';
      o.target = -1;
      sq.reactOriginX = NaN;
    }
    return;
  }
  if (sq.engaged) return;
  if (o.kind === 'none' && !sq.stats.ranged) {
    const e = nearestFrontEnemy(world, sq, SQUAD.idleReactDist);
    if (e) {
      o.kind = 'attack';
      o.target = e.id;
      o.charge = false;
      sq.reactOriginX = sq.x;
      sq.reactOriginZ = sq.z;
    }
  } else if (o.kind === 'advance') {
    const e = nearestFrontEnemy(world, sq, SQUAD.advanceEngageDist);
    if (e) {
      o.kind = 'attack';
      o.target = e.id;
      o.charge = false;
    }
  }
}

/** 정면 반쪽에 있는 보이는 적 중 대형 간격이 maxGap 이하인 가장 가까운 부대. */
function nearestFrontEnemy(world: World, sq: Squad, maxGap: number): Squad | null {
  const fx = Math.sin(sq.facing);
  const fz = Math.cos(sq.facing);
  let best: Squad | null = null;
  let bd = Infinity;
  for (const e of world.squads) {
    if (e.team === sq.team || !e.alive || !world.isVisible(e.id, sq.team)) continue;
    if ((e.x - sq.x) * fx + (e.z - sq.z) * fz <= 0) continue;
    const g = squadGap(sq, e);
    if (g <= maxGap && g < bd) {
      bd = g;
      best = e;
    }
  }
  return best;
}

// ------------------------------------------------------------------ 행동(매 틱)

function act(world: World, sq: Squad, dt: number): void {
  const o = sq.order;
  if (o.kind === 'move') {
    // 이탈 중이 아니면 접촉한 적과 그 자리에서 싸운다(GDD §7.2 "이동 중 적과 닿으면 싸운다").
    if (sq.engaged && sq.disengageTime <= 0) return;
    if (followPath(world, sq, o.x, o.z, sq.stats.walkSpeed, dt)) {
      o.kind = 'none';
      sq.wantFacing = o.facing;
    }
  } else if (o.kind === 'attack') {
    attack(world, sq, dt);
  } else if (o.kind === 'advance') {
    if (sq.engaged) return;
    const tx = sq.x + Math.sin(sq.facing) * ADVANCE_STEP;
    const tz = sq.z + Math.cos(sq.facing) * ADVANCE_STEP;
    moveAnchor(world, sq, tx, tz, sq.stats.walkSpeed, null, dt, false);
  } else {
    turnInPlace(sq, dt);
  }
}

function turnInPlace(sq: Squad, dt: number): void {
  if (Number.isNaN(sq.wantFacing) || sq.engaged) return;
  const diff = wrapAngle(sq.wantFacing - sq.facing);
  if (Math.abs(diff) > ABOUT_FACE_ANGLE) aboutFace(sq, sq.wantFacing);
  else sq.facing = wrapAngle(sq.facing + clampTurn(sq, diff, dt));
  if (Math.abs(wrapAngle(sq.wantFacing - sq.facing)) < 1e-3) sq.wantFacing = NaN;
}

function attack(world: World, sq: Squad, dt: number): void {
  const o = sq.order;
  const t = world.squads[o.target];
  if (!t || !t.alive) {
    clearAttack(sq);
    return;
  }
  if (t.state === 'routing') {
    sq.pursueTime += dt;
    const limit = sq.mounted ? MORALE.pursuitTimeMounted : MORALE.pursuitTimeFoot;
    // 추격 시간이 지나면 표적을 놓고 대기로 돌아간다. 새 표적은 자동 반응(30m)이나 AI가 정한다.
    if (sq.pursueTime > limit) {
      clearAttack(sq);
      return;
    }
  } else sq.pursueTime = 0;

  let tx = t.x;
  let tz = t.z;
  if (!world.isVisible(t.id, sq.team)) {
    const seen = world.vision?.lastSeen(t.id, sq.team);
    if (!seen) {
      clearAttack(sq);
      return;
    }
    tx = seen.x;
    tz = seen.z;
  }
  if (sq.engaged) {
    sq.charging = false;
    return;
  }
  const r = sq.stats.ranged;
  const d = len2(tx - sq.x, tz - sq.z);
  if (r) {
    const R = rangeWithHeight(r.range, sq.groundY - t.groundY);
    if (d <= R * SQUAD.archerStandRatio) {
      sq.wantFacing = Math.atan2(tx - sq.x, tz - sq.z);
      turnInPlace(sq, dt);
      return;
    }
  }
  const gap = squadGap(sq, t);
  let speed = sq.stats.walkSpeed;
  const ch = sq.stats.charge;
  const steady = sq.morale >= MORALE.waver || sq.isCommander;
  if (ch && steady && sq.chargeCooldown <= 0 && (sq.chargeRequested || gap < ch.startGap)) {
    sq.charging = true;
  }
  if (sq.charging && ch) {
    // 걷기 → 돌격 속도까지 runUp(30m) 동안 일정하게 가속(GDD §5.4, 가속도 1.15m/s²)
    const accel = (ch.speed * ch.speed - sq.stats.walkSpeed * sq.stats.walkSpeed) / (2 * ch.runUp);
    speed = Math.min(ch.speed, Math.max(sq.baseSpeed, sq.stats.walkSpeed) + accel * dt);
  } else if (sq.mounted) {
    speed = gap > MOUNTED_RUN_GAP ? sq.stats.runSpeed : sq.stats.walkSpeed;
  } else if (t.state === 'routing') {
    speed = sq.stats.runSpeed;
  }
  const fc = sq.stats.footCharge;
  const footCharging = !!fc && o.charge && sq.chargeCooldown <= 0 && steady && gap < fc.startGap;
  if (footCharging) speed = sq.stats.runSpeed;

  let moved: number;
  if (d > SQUAD.directApproachDist && world.pathfinder) {
    sq.repathTimer -= dt;
    if (sq.repathTimer <= 0 || sq.path.length === 0) {
      setPath(world, sq, tx, tz);
      sq.repathTimer = SQUAD.repathInterval;
    }
    const x0 = sq.x;
    const z0 = sq.z;
    followPath(world, sq, tx, tz, speed, dt);
    moved = len2(sq.x - x0, sq.z - z0);
  } else {
    moved = moveAnchor(world, sq, tx, tz, speed, t, dt, true);
  }
  if (footCharging && sq.speed >= sq.stats.runSpeed * FOOT_CHARGE_SPEED_RATIO) sq.runDist += moved;
  else if (!footCharging) sq.runDist = 0;
}

function clearAttack(sq: Squad): void {
  sq.order.kind = 'none';
  sq.order.target = -1;
  sq.order.charge = false;
  sq.charging = false;
  sq.chargeRequested = false;
  sq.pursueTime = 0;
  sq.reactOriginX = NaN;
}

function setPath(world: World, sq: Squad, tx: number, tz: number): void {
  sq.path.length = 0;
  sq.pathIndex = 0;
  const pf = world.pathfinder;
  if (pf) {
    const res = pf.findPath(sq.x, sq.z, tx, tz, { mounted: sq.mounted });
    if (res.found) for (const p of res.points) sq.path.push(p.x, p.z);
  }
  if (sq.path.length === 0) sq.path.push(tx, tz);
}

/** 경로를 따라 (tx, tz)로 간다. 도착하면 true. */
function followPath(
  world: World,
  sq: Squad,
  tx: number,
  tz: number,
  speed: number,
  dt: number,
): boolean {
  if (sq.path.length === 0) setPath(world, sq, tx, tz);
  const last = sq.pathIndex >= sq.path.length - 2;
  const wx = sq.path[sq.pathIndex];
  const wz = sq.path[sq.pathIndex + 1];
  const d = len2(wx - sq.x, wz - sq.z);
  if (last && d <= SQUAD.arriveDist) return true;
  if (!last && d <= WAYPOINT_DIST) {
    sq.pathIndex += 2;
    return false;
  }
  moveAnchor(world, sq, wx, wz, speed, null, dt, !last);
  return false;
}

/**
 * 부대 중심을 (tx, tz) 쪽으로 한 틱 옮긴다. 실제 속도 = speed × 지형 계수(GDD §6).
 * stopAt이 있으면 그 부대와의 대형 간격이 SQUAD.stopGap이 될 때 멈춘다. 다른 적 부대 사각형을
 * 뚫고 들어가지 않으며, 맵 가장자리 띠에는 들어가지 않는다. @returns 이동 거리(m)
 */
function moveAnchor(
  world: World,
  sq: Squad,
  tx: number,
  tz: number,
  speed: number,
  stopAt: Squad | null,
  dt: number,
  passThrough: boolean,
): number {
  const dx = tx - sq.x;
  const dz = tz - sq.z;
  const dist = len2(dx, dz);
  if (dist < 1e-4) return 0;
  const ux = dx / dist;
  const uz = dz / dist;
  const want = Math.atan2(ux, uz);
  const diff = wrapAngle(want - sq.facing);
  if (Math.abs(diff) > ABOUT_FACE_ANGLE) aboutFace(sq, want);
  else sq.facing = wrapAngle(sq.facing + clampTurn(sq, diff, dt));
  sq.wantFacing = NaN;
  sq.baseSpeed = speed;
  const factor = moveFactor(world.terrain, sq.x, sq.z, ux, uz, sq.mounted);
  sq.travelSpeed = speed * factor;
  let step = Math.min(speed * factor * dt, passThrough ? speed * factor * dt : dist);
  if (stopAt) step = Math.min(step, Math.max(0, squadGap(sq, stopAt) - SQUAD.stopGap));
  if (step <= 0) return 0;
  const nx = sq.x + ux * step;
  const nz = sq.z + uz * step;
  if (!world.inPlayArea(nx, nz)) return 0;
  if (blockedByEnemy(world, sq, nx, nz)) return 0;
  if (blockedByFriend(world, sq, nx, nz)) {
    sq.friendBlockedTime += dt;
    return 0;
  }
  sq.friendBlockedTime = Math.max(0, sq.friendBlockedTime - dt);
  sq.x = nx;
  sq.z = nz;
  return step;
}

function clampTurn(sq: Squad, diff: number, dt: number): number {
  const rate = (sq.mounted ? SQUAD.turnRateMounted : SQUAD.turnRateFoot) * dt;
  return Math.max(-rate, Math.min(rate, diff));
}

/** (nx, nz)로 옮기면 적 부대 사각형과 stopGap보다 가까워지는가(멀어지는 이동은 허용). */
function blockedByEnemy(world: World, sq: Squad, nx: number, nz: number): boolean {
  for (const e of world.squads) {
    if (e.team === sq.team || !e.alive) continue;
    if (Math.abs(e.x - nx) > BLOCK_CHECK_DIST || Math.abs(e.z - nz) > BLOCK_CHECK_DIST) continue;
    const after = squadGap(sq, e, nx, nz);
    if (after >= SQUAD.stopGap) continue;
    if (after < squadGap(sq, e)) return true;
  }
  return false;
}

/**
 * 멈춰 있거나 싸우는 아군 부대 사각형 안으로 FRIEND_OVERLAP 넘게 파고들지 않는다(부대가 한 자리에 겹쳐
 * 뭉치지 않게). 움직이는 아군끼리는 서로 지나간다. FRIEND_BLOCK_TIMEOUT 넘게 막히면 비집고 지나간다(교착 방지).
 */
function blockedByFriend(world: World, sq: Squad, nx: number, nz: number): boolean {
  if (sq.friendBlockedTime > FRIEND_BLOCK_TIMEOUT) return false;
  for (const f of world.squads) {
    if (f === sq || f.team !== sq.team || !f.alive) continue;
    if (!f.engaged && f.speed > FRIEND_MOVING_SPEED) continue;
    if (Math.abs(f.x - nx) > BLOCK_CHECK_DIST || Math.abs(f.z - nz) > BLOCK_CHECK_DIST) continue;
    const after = squadGap(sq, f, nx, nz);
    if (after >= -FRIEND_OVERLAP) continue;
    if (after < squadGap(sq, f)) return true;
  }
  return false;
}
const FRIEND_OVERLAP = 1;
const FRIEND_MOVING_SPEED = 0.3;
const FRIEND_BLOCK_TIMEOUT = 6;

/** 자동 폭 조정(GDD §4.3): 앞 통로가 대형보다 좁으면 열 수를 줄이고, 넓어지면 되돌린다. */
function updateCorridor(world: World, sq: Squad, dt: number): void {
  sq.corridorTimer -= dt;
  if (sq.corridorTimer > 0) return;
  sq.corridorTimer = SQUAD.corridorInterval;
  const full = sq.files * sq.fileSpacing;
  const ax = sq.x + Math.sin(sq.facing) * SQUAD.corridorLookAhead;
  const az = sq.z + Math.cos(sq.facing) * SQUAD.corridorLookAhead;
  const pf = world.pathfinder;
  if (!pf) return;
  const dx = Math.sin(sq.facing);
  const dz = Math.cos(sq.facing);
  const w = Math.min(pf.corridorWidth(sq.x, sq.z, dx, dz), pf.corridorWidth(ax, az, dx, dz));
  if (w + 1e-6 < full) sq.autoFiles = Math.max(SQUAD.minAutoFiles, Math.floor(w / sq.fileSpacing));
  else sq.autoFiles = 0;
}

// ------------------------------------------------------------------ 패주

/** 가장 가까운 적의 반대 방향으로 달리기 × 0.9(GDD §4.5). 막히면 방향을 틀어 본다. */
function flee(world: World, sq: Squad, dt: number): void {
  let best: Squad | null = null;
  let bd = Infinity;
  for (const e of world.squads) {
    if (e.team === sq.team || !e.alive) continue;
    const d = len2(e.x - sq.x, e.z - sq.z) + (e.state === 'ready' ? 0 : READY_PREFERENCE);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  if (!best) return;
  const away = Math.atan2(sq.x - best.x, sq.z - best.z);
  const speed = sq.stats.runSpeed * MORALE.routSpeedMult;
  for (const turn of FLEE_TRIES) {
    const a = away + turn;
    const ux = Math.sin(a);
    const uz = Math.cos(a);
    const f = moveFactor(world.terrain, sq.x, sq.z, ux, uz, sq.mounted);
    if (f <= 0) continue;
    const nx = sq.x + ux * speed * f * dt;
    const nz = sq.z + uz * speed * f * dt;
    if (moveFactor(world.terrain, nx, nz, ux, uz, sq.mounted) <= 0) continue;
    sq.facing = a;
    sq.x = nx;
    sq.z = nz;
    sq.baseSpeed = speed;
    return;
  }
}
/** 패주 방향을 정할 때 준비 상태 적을 우선한다: 패주 중인 적은 이만큼 멀리 있는 것으로 본다(m). */
const READY_PREFERENCE = 1000;
