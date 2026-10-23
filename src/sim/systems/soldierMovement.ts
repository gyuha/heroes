/**
 * 병사 이동: 각자 대형 자리(slot)로 걷고, 아군·적 병사와 몸이 겹치지 않게 밀어낸다.
 * 속도는 부대 속도 × 자기 칸의 지형 계수(+ 뒤처졌을 때 따라잡기), 발은 지면 높이에 붙인다.
 *
 * 병사마다 매 틱 도는 루프라 비용과 가비지를 줄인다(ARCHITECTURE §11.6-4, §11.6-11):
 * - 대형 자리 계산의 sin·cos는 부대마다 한 번, 지형 계수는 병사마다 FACTOR_PERIOD 틱에 한 번(틱에 나눠)
 *   계산해 저장하고, 통과 검사는 칸이 바뀐 병사만 한다.
 * - 병사 루프는 부대 단위의 작은 함수로 나눈다. 틱마다 한 번 불리는 큰 함수에 긴 루프를 두면 V8이 루프 중간
 *   최적화(OSR)와 해제를 되풀이하고, 그동안 실수 값이 힙 객체가 되어 가비지가 생긴다.
 * - 병사 루프 안에서는 실수를 주고받는 함수·메서드를 부르지 않는다. 인라인되지 않은 호출의 실수 인자·반환값은
 *   호출마다 힙 객체로 감싸진다. 클래스 메서드 호출은 프로토타입 체인에 의존해, 체인이 바뀔 때 최적화 코드가
 *   통째로 버려진다. 그래서 지형 조회는 필요한 병사만 모아 A의 배열형 함수(moveFactorsInto, heightsInto)로
 *   부대마다 한 번 부른다.
 */
import { SOLDIER } from '../data/simConfig';
import type { Squad } from '../squad';
import { heightsInto } from '../terrain';
import { moveFactorsInto } from '../terrainRules';
import type { World } from '../world';
import { gridQueryPrepared } from '../spatialGrid';

const MAX_NEIGHBORS = 32;
const neighbors = new Int32Array(MAX_NEIGHBORS);
const MAX_BODY = Math.max(...SOLDIER.bodyRadius);
/** 두 병사가 이 비율 × (반지름 합)보다 가까우면 밀어낸다. 1보다 작아 기병 대형 간격(2.2m)과 다투지 않는다 */
const SEPARATION_FACTOR = 0.9;
/** 지형 계수가 0인 칸(밀려 들어간 물가 등)에서 빠져나올 때 쓰는 최소 계수 */
const ESCAPE_FACTOR = 0.3;
/** 최근 공격한 병사는 이 틱 동안 표적 쪽을 본다 */
const FACE_TARGET_TICKS = 20;
const FACE_MOVE_SPEED2 = 0.3 * 0.3;
/** 부대가 이보다 느리고 병사가 자리에서 이 거리 안이면 '자리 잡음'으로 보고 밀어내기를 건너뛴다 */
const SETTLED_SQUAD_SPEED = 0.05;
const SETTLED_DIST = 0.05;
/** 병사 지형 계수를 다시 계산하는 주기(틱) */
const FACTOR_PERIOD = 4;
const MIN_MOVE_SPEED2 = 1e-8;
/** 자리까지 이 거리 이하면 움직이지 않는다(m) */
const AT_SLOT = 1e-3;
const TWO_PI = Math.PI * 2;
const BODY_RADIUS = SOLDIER.bodyRadius;
const SEPARATION_SPEED = SOLDIER.separationSpeed;

/**
 * World별 작업 배열. 병사 수만큼 한 번 할당해 틱마다 재사용한다. 실수는 Float64로 둬 계산 결과를 반올림하지 않는다.
 */
interface Scratch {
  /** 병사별 지형 계수(FACTOR_PERIOD 틱마다 갱신) */
  factors: Float32Array;
  /** 이번 틱 자리까지의 거리와 단위 방향 */
  dist: Float64Array;
  dirX: Float64Array;
  dirZ: Float64Array;
  /** 이번 틱 새 위치(통과 검사·높이 계산 전) */
  nextX: Float64Array;
  nextZ: Float64Array;
  /** 칸이 바뀌어 통과 검사가 필요한 병사, 높이를 다시 잴 병사 */
  crossed: Int32Array;
  moved: Int32Array;
  movedCount: number;
  /** 지형 계수를 갱신할 병사 목록과 결과(병사 인덱스로 쓴다) */
  refresh: Int32Array;
  factorOut: Float64Array;
}
const scratchByWorld = new WeakMap<World, Scratch>();

function scratchFor(world: World): Scratch {
  let s = scratchByWorld.get(world);
  if (!s) {
    const n = world.units.capacity;
    s = {
      factors: new Float32Array(n).fill(1),
      dist: new Float64Array(n),
      dirX: new Float64Array(n),
      dirZ: new Float64Array(n),
      nextX: new Float64Array(n),
      nextZ: new Float64Array(n),
      crossed: new Int32Array(n),
      moved: new Int32Array(n),
      movedCount: 0,
      refresh: new Int32Array(n),
      factorOut: new Float64Array(n),
    };
    scratchByWorld.set(world, s);
  }
  return s;
}

export function updateSoldiers(world: World, dt: number): void {
  const s = scratchFor(world);
  const phase = world.tick % FACTOR_PERIOD;
  const squads = world.squads;
  // 1) 원하는 속도(자리로 가기 + 밀어내기). 2) 위치·높이·방향 갱신.
  // 속도 계산과 위치 갱신을 나눠, 같은 틱 안에서 순회 순서가 결과에 영향을 주지 않게 한다.
  for (let k = 0; k < squads.length; k++) {
    const sq = squads[k];
    if (sq.n === 0) continue;
    aimAtSlots(world, sq, s);
    refreshFactors(world, sq, s, phase);
    steerSquad(world, sq, s, dt);
  }
  const maxTurn = SOLDIER.turnRate * dt;
  for (let k = 0; k < squads.length; k++) {
    const sq = squads[k];
    if (sq.n === 0) continue;
    const crossed = moveSquad(world, sq, s, dt);
    if (crossed > 0) resolveBlocked(world, s, crossed);
    commitPositions(world, s);
    turnSquad(world, sq, maxTurn);
  }
  removeCorpses(world, Math.round(SOLDIER.corpseTime / dt));
}

/** 병사마다 대형 자리를 계산하고, 자리까지의 거리·방향을 작업 배열에 적는다. */
function aimAtSlots(world: World, sq: Squad, s: Scratch): void {
  const u = world.units;
  const xs = u.x;
  const zs = u.z;
  const tx = u.targetX;
  const tz = u.targetZ;
  const dist = s.dist;
  const dirX = s.dirX;
  const dirZ = s.dirZ;
  const n = sq.n;
  const members = sq.members;
  const sin = Math.sin(sq.facing);
  const cos = Math.cos(sq.facing);
  const ax = sq.x;
  const az = sq.z;
  const F = sq.curFiles;
  const R = sq.ranks;
  const spread = sq.state === 'routing' ? SOLDIER.routSpreadMult : 1;
  const fs = sq.fileSpacing * spread;
  const rs = sq.rankSpacing * spread;
  const lastInRank = n - (R - 1) * F;
  for (let k = 0; k < n; k++) {
    const i = members[k];
    const rank = Math.floor(k / F);
    const file = k - rank * F;
    const inRank = rank === R - 1 ? lastInRank : F;
    const lateral = (file - (inRank - 1) / 2) * fs;
    const forward = ((R - 1) / 2 - rank) * rs;
    const sx = ax + cos * lateral + sin * forward;
    const sz = az - sin * lateral + cos * forward;
    tx[i] = sx;
    tz[i] = sz;
    const ddx = sx - xs[i];
    const ddz = sz - zs[i];
    const d = Math.sqrt(ddx * ddx + ddz * ddz);
    dist[i] = d;
    if (d > AT_SLOT) {
      dirX[i] = ddx / d;
      dirZ[i] = ddz / d;
    }
  }
}

/**
 * 이번 틱 차례인 병사(인덱스 mod FACTOR_PERIOD)의 지형 계수를 갱신한다. 대상 병사를 모아 A의
 * moveFactorsInto를 부대마다 한 번 부른다(병사마다 부르면 실수 인자가 호출마다 힙 객체가 된다).
 */
function refreshFactors(world: World, sq: Squad, s: Scratch, phase: number): void {
  const members = sq.members;
  const dist = s.dist;
  const index = s.refresh;
  let count = 0;
  for (let k = 0; k < sq.n; k++) {
    const i = members[k];
    if ((i & (FACTOR_PERIOD - 1)) === phase && dist[i] > AT_SLOT) index[count++] = i;
  }
  if (count === 0) return;
  const out = s.factorOut;
  moveFactorsInto(
    world.terrain,
    world.units.x,
    world.units.z,
    s.dirX,
    s.dirZ,
    sq.mounted,
    index,
    count,
    out,
  );
  const factors = s.factors;
  for (let k = 0; k < count; k++) {
    const i = index[k];
    const f = out[i];
    factors[i] = f > 0 ? f : ESCAPE_FACTOR;
  }
}

/** 자리로 가는 속도에 이웃과의 밀어내기를 더해 병사 속도(vx, vz)를 정한다. */
function steerSquad(world: World, sq: Squad, s: Scratch, dt: number): void {
  const u = world.units;
  const xs = u.x;
  const zs = u.z;
  const vxs = u.vx;
  const vzs = u.vz;
  const types = u.type;
  const grid = world.grid;
  const dist = s.dist;
  const dirX = s.dirX;
  const dirZ = s.dirZ;
  const factors = s.factors;
  const members = sq.members;
  const base = Math.max(sq.baseSpeed, sq.stats.walkSpeed);
  const ri = BODY_RADIUS[sq.typeIndex];
  const queryRadius = (ri + MAX_BODY) * SEPARATION_FACTOR;
  const settled = sq.speed < SETTLED_SQUAD_SPEED && !sq.engaged && sq.state === 'ready';
  const slack = SOLDIER.speedSlack;
  const catchUpDist = SOLDIER.catchUpDist;
  const catchUpSpeed = SOLDIER.catchUpSpeed;
  for (let k = 0; k < sq.n; k++) {
    const i = members[k];
    const d = dist[i];
    let vx = 0;
    let vz = 0;
    if (d > AT_SLOT) {
      const f = factors[i];
      let cap = base * f * slack;
      if (d > catchUpDist) cap += catchUpSpeed * f;
      const sp = Math.min(cap, d / dt);
      vx = dirX[i] * sp;
      vz = dirZ[i] * sp;
    }
    // 멈춘 부대에서 자기 자리에 선 병사는 밀어내기를 건너뛴다(겹친 이웃 쪽이 스스로 비켜난다).
    if (settled && d < SETTLED_DIST) {
      vxs[i] = 0;
      vzs[i] = 0;
      continue;
    }
    const px = xs[i];
    const pz = zs[i];
    grid.qx = px;
    grid.qz = pz;
    grid.qr = queryRadius;
    const cnt = gridQueryPrepared(grid, xs, zs, neighbors);
    for (let c = 0; c < cnt; c++) {
      const j = neighbors[c];
      if (j === i) continue;
      const minD = (ri + BODY_RADIUS[types[j]]) * SEPARATION_FACTOR;
      const ox = px - xs[j];
      const oz = pz - zs[j];
      const d2 = ox * ox + oz * oz;
      if (d2 >= minD * minD) continue;
      const od = Math.sqrt(d2);
      const push = (SEPARATION_SPEED * (minD - od)) / minD;
      if (od < 1e-4) vx += i < j ? push : -push;
      else {
        vx += (ox / od) * push;
        vz += (oz / od) * push;
      }
    }
    vxs[i] = vx;
    vzs[i] = vz;
  }
}

/**
 * 속도만큼 새 위치를 계산해 작업 배열에 둔다(아직 병사 배열에는 쓰지 않는다). 칸이 바뀐 병사는 통과 검사 목록에
 * 넣는다. @returns 통과 검사가 필요한 병사 수
 */
function moveSquad(world: World, sq: Squad, s: Scratch, dt: number): number {
  const u = world.units;
  const xs = u.x;
  const zs = u.z;
  const vxs = u.vx;
  const vzs = u.vz;
  const terrain = world.terrain;
  const cell = terrain.cellSize;
  const width = terrain.width;
  const depth = terrain.depth;
  const nextX = s.nextX;
  const nextZ = s.nextZ;
  const crossed = s.crossed;
  const moved = s.moved;
  const members = sq.members;
  let nCrossed = 0;
  let nMoved = 0;
  for (let k = 0; k < sq.n; k++) {
    const i = members[k];
    const vx = vxs[i];
    const vz = vzs[i];
    if (vx * vx + vz * vz < MIN_MOVE_SPEED2) continue;
    const ox = xs[i];
    const oz = zs[i];
    // 맵 안으로 자른다. 정수 상수와 실수를 섞는 삼항식은 V8이 값을 힙 객체로 감싸게 만들어 Math.min/max를 쓴다.
    const nx = Math.min(width, Math.max(0, ox + vx * dt));
    const nz = Math.min(depth, Math.max(0, oz + vz * dt));
    nextX[i] = nx;
    nextZ[i] = nz;
    moved[nMoved++] = i;
    if (
      Math.floor(nx / cell) !== Math.floor(ox / cell) ||
      Math.floor(nz / cell) !== Math.floor(oz / cell)
    ) {
      crossed[nCrossed++] = i;
    }
  }
  s.movedCount = nMoved;
  return nCrossed;
}

/** 칸이 바뀐 병사 중 막힌 칸으로 들어가려는 병사는 벽을 따라 미끄러지게 한다. */
function resolveBlocked(world: World, s: Scratch, count: number): void {
  const terrain = world.terrain;
  const xs = world.units.x;
  const zs = world.units.z;
  const nextX = s.nextX;
  const nextZ = s.nextZ;
  const crossed = s.crossed;
  for (let k = 0; k < count; k++) {
    const i = crossed[k];
    const nx = nextX[i];
    const nz = nextZ[i];
    const ox = xs[i];
    const oz = zs[i];
    if (terrain.passableAt(nx, nz) || !terrain.passableAt(ox, oz)) continue;
    if (terrain.passableAt(nx, oz)) nextZ[i] = oz;
    else if (terrain.passableAt(ox, nz)) nextX[i] = ox;
    else {
      nextX[i] = ox;
      nextZ[i] = oz;
    }
  }
}

/** 새 위치를 병사 배열에 쓰고 발 높이를 지면에 붙인다(A의 heightsInto, 부대마다 한 번). */
function commitPositions(world: World, s: Scratch): void {
  const u = world.units;
  const xs = u.x;
  const zs = u.z;
  const nextX = s.nextX;
  const nextZ = s.nextZ;
  const moved = s.moved;
  const count = s.movedCount;
  for (let k = 0; k < count; k++) {
    const i = moved[k];
    xs[i] = nextX[i];
    zs[i] = nextZ[i];
  }
  if (count > 0) heightsInto(world.terrain, xs, zs, moved, count, u.y);
}

/** 병사 방향: 최근 공격한 병사는 표적 쪽 그대로, 움직이면 진행 방향, 서 있으면 부대 정면으로 돌아선다. */
function turnSquad(world: World, sq: Squad, maxTurn: number): void {
  const u = world.units;
  const vxs = u.vx;
  const vzs = u.vz;
  const heading = u.heading;
  const lastAttack = u.lastAttackTick;
  const tick = world.tick;
  const facing = sq.facing;
  const members = sq.members;
  for (let k = 0; k < sq.n; k++) {
    const i = members[k];
    if (tick - lastAttack[i] < FACE_TARGET_TICKS) continue;
    const vx = vxs[i];
    const vz = vzs[i];
    const want = vx * vx + vz * vz > FACE_MOVE_SPEED2 ? Math.atan2(vx, vz) : facing;
    // math.ts wrapAngle 과 같은 계산을 펼쳐 쓴다
    let diff = (want - heading[i] + Math.PI) % TWO_PI;
    if (diff < 0) diff += TWO_PI;
    diff -= Math.PI;
    if (diff === 0) continue;
    const turn = diff < -maxTurn ? -maxTurn : diff > maxTurn ? maxTurn : diff;
    let a = (heading[i] + turn + Math.PI) % TWO_PI;
    if (a < 0) a += TWO_PI;
    heading[i] = a - Math.PI;
  }
}

/** 죽고 시체 표시 시간이 지난 병사를 화면에서 지운다(정수 비교만 한다). */
function removeCorpses(world: World, corpseTicks: number): void {
  const u = world.units;
  const count = u.count;
  const alive = u.alive;
  const removed = u.removed;
  const deathTick = u.deathTick;
  const tick = world.tick;
  for (let i = 0; i < count; i++) {
    if (alive[i] || removed[i]) continue;
    if (deathTick[i] >= 0 && tick - deathTick[i] > corpseTicks) removed[i] = 1;
  }
}
