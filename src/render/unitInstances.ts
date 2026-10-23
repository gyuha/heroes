import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshLambertMaterial,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { wrapAngle } from '../sim/math';
import type { UnitStore } from '../sim/units';

const TEAM_COLORS = [new Color(0x3a6fd8), new Color(0xd84a3a)];

/**
 * 임시 병사 메시: 캡슐 몸통 + 정면(+Z)을 알려 주는 방패 상자. 원점은 발 밑.
 * 삼각형 수를 보병 예산(300, ARCHITECTURE.md 7.3)에 가깝게 맞춰 성능 측정이 실제 부하를 반영하게 한다.
 */
function createPlaceholderSoldierGeometry() {
  const body = new CapsuleGeometry(0.28, 1.1, 4, 14, 1);
  body.translate(0, 0.83, 0);
  const shield = new BoxGeometry(0.5, 0.6, 0.08);
  shield.translate(0, 0.9, 0.32);
  const merged = mergeGeometries([body, shield]);
  body.dispose();
  shield.dispose();
  if (!merged) throw new Error('임시 병사 지오메트리 병합 실패');
  return merged;
}

/**
 * 모든 병사를 InstancedMesh 하나(그리기 호출 1회)로 그린다.
 * 매 프레임 시뮬레이션의 prev/현재 상태를 alpha 로 보간해 인스턴스 행렬을 직접 쓴다.
 */
export class UnitInstances {
  readonly mesh: InstancedMesh;
  readonly trianglesPerUnit: number;

  constructor(capacity: number) {
    const geometry = createPlaceholderSoldierGeometry();
    this.trianglesPerUnit = geometry.index!.count / 3;
    this.mesh = new InstancedMesh(geometry, new MeshLambertMaterial(), capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    // 병사가 계속 움직여 경계 구가 매 프레임 바뀐다. 전체 컬링 대신 그리기 1회로 처리한다.
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /** 팀 색은 병사가 추가될 때만 바뀌므로 매 프레임 쓰지 않는다. */
  syncColors(units: UnitStore): void {
    for (let i = 0; i < units.count; i++) {
      this.mesh.setColorAt(i, TEAM_COLORS[units.team[i]] ?? TEAM_COLORS[0]);
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  sync(units: UnitStore, alpha: number): void {
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const { x, y, z, heading, prevX, prevY, prevZ, prevHeading } = units;
    const n = units.count;
    for (let i = 0; i < n; i++) {
      const px = prevX[i] + (x[i] - prevX[i]) * alpha;
      const py = prevY[i] + (y[i] - prevY[i]) * alpha;
      const pz = prevZ[i] + (z[i] - prevZ[i]) * alpha;
      const h = prevHeading[i] + wrapAngle(heading[i] - prevHeading[i]) * alpha;
      const c = Math.cos(h);
      const s = Math.sin(h);
      // Y축 회전 + 이동 행렬(열 우선). 정면 +Z 가 (sin h, 0, cos h) 로 간다.
      const o = i * 16;
      m[o] = c;
      m[o + 1] = 0;
      m[o + 2] = -s;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = 1;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = s;
      m[o + 9] = 0;
      m[o + 10] = c;
      m[o + 11] = 0;
      m[o + 12] = px;
      m[o + 13] = py;
      m[o + 14] = pz;
      m[o + 15] = 1;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
