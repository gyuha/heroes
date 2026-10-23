/**
 * 부대 단위 시야(전장의 안개, GDD §6.4). 플레이어와 AI가 같은 결과를 쓴다.
 * 매 틱 update 를 부르면 부대 ID % 10 == 호출 순번 % 10 인 부대만 다시 판정한다(부대마다 0.5초 주기,
 * ARCHITECTURE §11.6-1). 350m 밖은 직선 검사 전에 버리고, 한 아군이라도 보면 그 부대는 바로 끝낸다.
 */
import type { TeamId } from './api';
import { TERRAIN } from './data/balance';
import { TICK_DT } from './constants';
import { type Terrain, TerrainType } from './terrain';
import { lineOfSight } from './terrainRules';

/** 판정 주기(초). */
export const VISION_INTERVAL = 0.5;
/** 판정 주기를 나누는 틱 수(0.5초 = 10틱). */
export const VISION_BUCKETS = Math.round(VISION_INTERVAL / TICK_DT);
export const VISION_RANGE = TERRAIN.visionRange;
/** 숲 안 부대는 이 거리 안의 적에게만 보인다(m). */
export const FOREST_HIDE_DIST = TERRAIN.forestHideDist;
/** 사격·근접 교전 후 숲 은폐가 풀리는 시간(초). */
export const EXPOSE_TIME = TERRAIN.revealTime;
/** 보이지 않게 된 적의 마지막 위치를 남기는 시간(초). */
export const LAST_SEEN_TIME = 10;
/** 관찰 눈높이와 표적 높이(지면 위 m). 기병 표적은 더 높다. */
export const EYE_HEIGHT = TERRAIN.eyeHeight;
export const MOUNTED_TARGET_HEIGHT = 2.4;

/** B가 부대마다 채워 넘기는 최소 정보. 배열 인덱스 = 부대 ID. */
export interface VisionSquad {
  team: TeamId;
  alive: boolean;
  x: number;
  z: number;
  /** 정면 방향(라디안, 0 = +Z) */
  facing: number;
  /** 대형 폭·깊이(m) */
  width: number;
  depth: number;
  mounted: boolean;
}

export interface LastSeen {
  x: number;
  z: number;
  time: number;
}

const TEAMS = 2;

export class VisibilitySystem {
  /** [team * maxSquads + squad] = 1 이면 team 이 squad 를 본다. */
  private readonly visible: Uint8Array;
  private readonly seenX: Float32Array;
  private readonly seenZ: Float32Array;
  /** 마지막으로 보인 시각. -Infinity = 본 적 없음 */
  private readonly seenTime: Float64Array;
  private readonly exposedUntil: Float64Array;
  private readonly concealed: Uint8Array;
  private readonly groundY: Float32Array;
  private bucket = 0;
  private now = 0;

  constructor(
    private readonly terrain: Terrain,
    readonly maxSquads: number,
  ) {
    this.visible = new Uint8Array(TEAMS * maxSquads);
    this.seenX = new Float32Array(TEAMS * maxSquads);
    this.seenZ = new Float32Array(TEAMS * maxSquads);
    this.seenTime = new Float64Array(TEAMS * maxSquads).fill(-Infinity);
    this.exposedUntil = new Float64Array(maxSquads).fill(-Infinity);
    this.concealed = new Uint8Array(maxSquads);
    this.groundY = new Float32Array(maxSquads);
  }

  /** 매 틱 부른다. time 은 전투 시간(초). */
  update(time: number, squads: readonly VisionSquad[]): void {
    if (squads.length > this.maxSquads) {
      throw new Error(`VisibilitySystem: 부대 ${squads.length}개 > maxSquads ${this.maxSquads}`);
    }
    this.now = time;
    const n = squads.length;
    for (let i = 0; i < n; i++) {
      const s = squads[i];
      this.groundY[i] = this.terrain.heightAt(s.x, s.z);
      this.concealed[i] =
        s.alive &&
        time >= this.exposedUntil[i] &&
        this.terrain.typeAt(s.x, s.z) === TerrainType.Forest
          ? 1
          : 0;
    }

    const bucket = this.bucket;
    this.bucket = (this.bucket + 1) % VISION_BUCKETS;
    for (let j = bucket; j < n; j += VISION_BUCKETS) {
      const target = squads[j];
      for (let team = 0; team < TEAMS; team++) {
        const k = team * this.maxSquads + j;
        let seen: boolean;
        if (!target.alive) {
          seen = false;
          this.seenTime[k] = -Infinity;
        } else if (target.team === team) {
          seen = true;
        } else {
          seen = this.seenByTeam(team, j, squads);
        }
        this.visible[k] = seen ? 1 : 0;
        if (seen) {
          this.seenX[k] = target.x;
          this.seenZ[k] = target.z;
          this.seenTime[k] = time;
        }
      }
    }
  }

  /** 사격하거나 근접 교전한 부대. 10초 동안 숲 은폐가 풀린다. */
  markExposed(squad: number, time: number): void {
    this.exposedUntil[squad] = time + EXPOSE_TIME;
    this.concealed[squad] = 0;
  }

  /** toTeam 이 squad 를 보는가. 자기 진영 부대는 항상 true(판정 전에는 false). */
  isVisible(squad: number, toTeam: TeamId): boolean {
    return this.visible[toTeam * this.maxSquads + squad] === 1;
  }

  /** 중심이 숲 칸이고 노출 중이 아니다(SquadView.concealed). */
  isConcealed(squad: number): boolean {
    return this.concealed[squad] === 1;
  }

  /** byTeam 이 지금은 못 보지만 10초 안에 본 적 있는 squad 의 마지막 위치. 그 밖에는 null. */
  lastSeen(squad: number, byTeam: TeamId): LastSeen | null {
    const k = byTeam * this.maxSquads + squad;
    if (this.visible[k] === 1) return null;
    const t = this.seenTime[k];
    if (this.now - t > LAST_SEEN_TIME) return null;
    return { x: this.seenX[k], z: this.seenZ[k], time: t };
  }

  private seenByTeam(team: number, j: number, squads: readonly VisionSquad[]): boolean {
    const target = squads[j];
    const hidden = this.concealed[j] === 1;
    const targetH = target.mounted ? MOUNTED_TARGET_HEIGHT : EYE_HEIGHT;
    const fx = Math.sin(target.facing);
    const fz = Math.cos(target.facing);
    // 정면 (sin, cos)의 오른쪽은 (cos, −sin)
    const halfW = target.width / 2;
    const halfD = target.depth / 2;
    const frontX = target.x + fx * halfD;
    const frontZ = target.z + fz * halfD;
    const leftX = frontX - fz * halfW;
    const leftZ = frontZ + fx * halfW;
    const rightX = frontX + fz * halfW;
    const rightZ = frontZ - fx * halfW;
    const t = this.terrain;
    let cornersReady = false;
    let leftY = 0;
    let rightY = 0;
    const centerY = this.groundY[j] + targetH;

    for (let i = 0; i < squads.length; i++) {
      const o = squads[i];
      if (o.team !== team || !o.alive) continue;
      const ddx = o.x - target.x;
      const ddz = o.z - target.z;
      const d = Math.sqrt(ddx * ddx + ddz * ddz);
      if (d > VISION_RANGE) continue;
      if (hidden) {
        if (d <= FOREST_HIDE_DIST) return true;
        continue;
      }
      const eye = this.groundY[i] + EYE_HEIGHT;
      if (lineOfSight(t, o.x, eye, o.z, target.x, centerY, target.z)) return true;
      if (!cornersReady) {
        leftY = t.heightAt(leftX, leftZ) + targetH;
        rightY = t.heightAt(rightX, rightZ) + targetH;
        cornersReady = true;
      }
      if (lineOfSight(t, o.x, eye, o.z, leftX, leftY, leftZ)) return true;
      if (lineOfSight(t, o.x, eye, o.z, rightX, rightY, rightZ)) return true;
    }
    return false;
  }
}
