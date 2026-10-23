import type {
  FormationId,
  MoraleBand,
  OrderKind,
  SquadActivity,
  SquadState,
  SquadView,
  TeamId,
  UnitTypeId,
} from './api';
import type { Squad } from './squad';
import { UNIT_TYPE_ORDER } from './units';

/**
 * Squad를 UI용 읽기 전용 SquadView로 보여 주는 얇은 껍데기. 값을 복사하지 않고 getter로 읽으므로
 * 매 프레임 호출해도 할당이 없다. 부대마다 한 번 만든다.
 */
export class SquadViewAdapter implements SquadView {
  constructor(private readonly s: Squad) {}
  get id(): number {
    return this.s.id;
  }
  get team(): TeamId {
    return this.s.team;
  }
  get type(): UnitTypeId {
    return UNIT_TYPE_ORDER[this.s.typeIndex];
  }
  get isCommander(): boolean {
    return this.s.isCommander;
  }
  get name(): string {
    return this.s.name;
  }
  get state(): SquadState {
    return this.s.state;
  }
  get activity(): SquadActivity {
    return this.s.activity;
  }
  get order(): OrderKind {
    return this.s.order.kind;
  }
  get targetId(): number {
    return this.s.order.kind === 'attack' ? this.s.order.target : -1;
  }
  /** 이동 명령의 목적지(없으면 NaN). UI 목적지 표시용 */
  get destX(): number {
    return this.s.order.kind === 'move' ? this.s.order.x : NaN;
  }
  get destZ(): number {
    return this.s.order.kind === 'move' ? this.s.order.z : NaN;
  }
  get formation(): FormationId {
    return this.s.formation;
  }
  get files(): number {
    return this.s.curFiles;
  }
  get x(): number {
    return this.s.x;
  }
  get z(): number {
    return this.s.z;
  }
  get facing(): number {
    return this.s.facing;
  }
  get width(): number {
    return this.s.width;
  }
  get depth(): number {
    return this.s.depth;
  }
  get startCount(): number {
    return this.s.startCount;
  }
  get count(): number {
    return this.s.n;
  }
  get morale(): number {
    return Math.max(0, this.s.morale);
  }
  get moraleBand(): MoraleBand {
    return this.s.moraleBand;
  }
  get chargeCooldown(): number {
    return Math.max(0, this.s.chargeCooldown);
  }
  get canCharge(): boolean {
    return !!(this.s.stats.charge || this.s.stats.footCharge);
  }
  get shieldWall(): boolean {
    return this.s.shieldWall;
  }
  get braced(): boolean {
    return this.s.braced;
  }
  get concealed(): boolean {
    return this.s.concealed;
  }
  get autoNarrowed(): boolean {
    return this.s.autoFiles > 0 && this.s.autoFiles < this.s.files;
  }
  get heightBonusPct(): number {
    return this.s.engaged ? this.s.heightBonusPct : 0;
  }
  get kills(): number {
    return this.s.kills;
  }
}
