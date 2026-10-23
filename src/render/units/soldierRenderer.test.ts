import { describe, expect, it } from 'vitest';
import { UnitStore } from '../../sim/units';
import { AnimClip } from './clipTable';
import { SoldierRenderer, createPlaceholderAsset } from './soldierRenderer';

function makeRenderer(capacity = [4, 4, 4, 4]) {
  const assets = [0, 1, 2, 3].map(() => createPlaceholderAsset());
  return new SoldierRenderer(assets, capacity);
}

/** 병종 t 메시의 slot 번 인스턴스 (x, z, 클립, 클립 시간, 팀) */
function instance(r: SoldierRenderer, t: number, slot: number) {
  const mesh = r.object.children[t] as import('three').InstancedMesh;
  const m = mesh.instanceMatrix.array;
  const a = mesh.geometry.getAttribute('aAnim').array;
  return {
    x: m[slot * 16 + 12],
    z: m[slot * 16 + 14],
    clip: a[slot * 3],
    time: a[slot * 3 + 1],
    team: a[slot * 3 + 2],
  };
}

describe('SoldierRenderer.sync', () => {
  it('병종별로 앞쪽 칸에 모아 쓰고 removed·숨긴 부대는 뺀다', () => {
    const units = new UnitStore(8);
    units.add(0, 1, 0, 0, 0, 0); // 0: 보병
    units.add(1, 2, 0, 0, 0, 3); // 1: 기병
    units.add(0, 3, 0, 0, 0, 0); // 2: 보병, removed
    units.add(1, 4, 0, 0, 0, 0); // 3: 보병, 부대 5 (숨김)
    units.add(1, 5, 0, 0, 0, 0); // 4: 보병
    units.removed[2] = 1;
    units.squad[3] = 5;
    const hidden = new Uint8Array(8);
    hidden[5] = 1;

    const r = makeRenderer();
    r.sync(units, 1, 10, hidden);
    expect([0, 1, 2, 3].map((t) => r.visibleCount(t))).toEqual([2, 0, 0, 1]);
    expect(instance(r, 0, 0).x).toBe(1);
    expect(instance(r, 0, 1)).toMatchObject({ x: 5, team: 1 });
    expect(instance(r, 3, 0)).toMatchObject({ x: 2, team: 1 });
  });

  it('위치는 prev 와 현재 사이를 alpha 로 보간한다', () => {
    const units = new UnitStore(1);
    units.add(0, 0, 0, 0, 0, 0);
    units.x[0] = 0.2; // 한 틱에 0.2m = 4m/s
    const r = makeRenderer();
    r.sync(units, 0.5, 10);
    expect(instance(r, 0, 0).x).toBeCloseTo(0.1, 6);
  });

  it('용량을 넘는 병사는 그리지 않는다', () => {
    const units = new UnitStore(3);
    for (let i = 0; i < 3; i++) units.add(0, i, 0, 0, 0, 1);
    const r = makeRenderer([4, 2, 4, 4]);
    r.sync(units, 1, 10);
    expect(r.visibleCount(1)).toBe(2);
  });

  it('죽은(removed 아닌) 병사는 die 클립으로 계속 그린다', () => {
    const units = new UnitStore(1);
    units.add(0, 0, 0, 0, 0, 0);
    units.alive[0] = 0;
    units.deathTick[0] = 8;
    const r = makeRenderer();
    r.sync(units, 0.5, 10);
    expect(r.visibleCount(0)).toBe(1);
    expect(instance(r, 0, 0).clip).toBe(AnimClip.Die);
    expect(instance(r, 0, 0).time).toBeCloseTo(2.5 / 20, 6);
  });

  it('반복 클립 위상은 화면 시각이 흐른 만큼 진행하고 병사마다 다르다', () => {
    const units = new UnitStore(2);
    units.add(0, 0, 0, 0, 0, 0);
    units.add(0, 1, 0, 0, 0, 0);
    const r = makeRenderer();
    r.sync(units, 0, 10);
    const a0 = instance(r, 0, 0).time;
    const b0 = instance(r, 0, 1).time;
    expect(a0).not.toBeCloseTo(b0, 3);
    r.sync(units, 0, 12); // 2틱 = 0.1초, 서 있으므로 재생 속도 1
    expect(instance(r, 0, 0).clip).toBe(AnimClip.Idle);
    expect(instance(r, 0, 0).time - a0).toBeCloseTo(0.1, 5);
    r.sync(units, 0, 12); // 일시정지: 진행 없음
    expect(instance(r, 0, 0).time - a0).toBeCloseTo(0.1, 5);
  });

  it('숨긴 동안 sync 는 아무것도 쓰지 않는다', () => {
    const units = new UnitStore(1);
    units.add(0, 7, 0, 0, 0, 0);
    const r = makeRenderer();
    r.setVisible(false);
    r.sync(units, 1, 10);
    expect(r.visibleCount(0)).toBe(0);
    r.setVisible(true);
    r.sync(units, 1, 10);
    expect(r.visibleCount(0)).toBe(1);
  });

  it('틱·보간·안개가 그대로면(일시정지) 버퍼를 다시 쓰거나 올리지 않고, 바뀌면 다시 쓴다', () => {
    const units = new UnitStore(1);
    units.add(0, 1, 0, 0, 0, 0);
    const r = makeRenderer();
    const mesh = r.object.children[0] as import('three').InstancedMesh;
    r.sync(units, 0.5, 10);
    const version = mesh.instanceMatrix.version;
    r.sync(units, 0.5, 10);
    expect(mesh.instanceMatrix.version).toBe(version);
    r.sync(units, 0.6, 10);
    expect(mesh.instanceMatrix.version).toBeGreaterThan(version);
    // 숨겼다 다시 보이면 같은 시각이라도 다시 쓴다(숨긴 동안 상태가 바뀌었을 수 있다)
    const v2 = mesh.instanceMatrix.version;
    r.setVisible(false);
    r.setVisible(true);
    r.sync(units, 0.6, 10);
    expect(mesh.instanceMatrix.version).toBeGreaterThan(v2);
  });

  it('LOD 마스크가 1인 부대의 병사는 LOD1 메시로, 나머지는 LOD0로 그린다', () => {
    const units = new UnitStore(4);
    for (let i = 0; i < 4; i++) units.add(0, i, 0, 0, 0, 0);
    units.squad[0] = 0;
    units.squad[1] = 0;
    units.squad[2] = 1;
    units.squad[3] = 1;
    const lod1 = [0, 1, 2, 3].map(() => createPlaceholderAsset());
    const r = new SoldierRenderer(
      [0, 1, 2, 3].map(() => createPlaceholderAsset()),
      [4, 4, 4, 4],
      lod1,
    );
    const far = new Uint8Array([0, 1]);
    r.sync(units, 1, 10, undefined, far);
    expect(r.visibleCountLod(0, 0)).toBe(2);
    expect(r.visibleCountLod(0, 1)).toBe(2);
    expect(r.visibleCount(0)).toBe(4);
    // 마스크만 바뀌어도(카메라 이동) 다시 쓴다
    r.sync(units, 1, 10, undefined, new Uint8Array([1, 1]));
    expect(r.visibleCountLod(0, 1)).toBe(4);
  });

  it('LOD1 리소스가 없는 병종은 마스크와 관계없이 LOD0로 그린다', () => {
    const units = new UnitStore(2);
    units.add(0, 0, 0, 0, 0, 0);
    units.add(0, 1, 0, 0, 0, 0);
    units.squad[0] = 0;
    units.squad[1] = 0;
    const r = makeRenderer();
    expect(r.hasLod1(0)).toBe(false);
    r.sync(units, 1, 10, undefined, new Uint8Array([1]));
    expect(r.visibleCountLod(0, 0)).toBe(2);
  });
});
