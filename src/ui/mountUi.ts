import './styles.css';
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { CommandResult, GameSpeed, SquadView, TeamId, UnitTypeId } from '../sim/api';
import { COMBAT, TERRAIN, UNIT_TYPES } from '../sim/data/balance';
import { DrapedLines } from '../render/overlays/drapedLines';
import { RangeOverlay, type RangeProfileData, rangeOutline } from '../render/overlays/rangeOverlay';
import { SlopeOverlay } from '../render/overlays/slopeOverlay';
import { RtsCamera } from '../render/rtsCamera';
import type { MoveSlot, PathPreviewView, UiSession } from './gameView';
import { CommandPanel, type CommandButtonId } from './hud/commandPanel';
import { h } from './hud/dom';
import { EventLog } from './hud/eventLog';
import { formatEvent } from './hud/eventText';
import { type LogVisibility, shouldLog } from './hud/logFilter';
import { Minimap, type MinimapSquad } from './hud/minimap';
import {
  Banner,
  Controls,
  Modal,
  briefingSheet,
  button,
  helpSheet,
  pauseMenuSheet,
  resultSheet,
} from './hud/screens';
import { Toast, Tooltip, tipEffect, tipRow, tipTitle } from './hud/tooltip';
import { TopBar } from './hud/topBar';
import { FORMATION_LABEL, UnitCards, activityLabel } from './hud/unitCards';
import { squadIconId } from './icons';
import {
  buildDeployCommands,
  buildMoveCommand,
  buildSquadCommand,
  lineFormation,
  type DragLine,
} from './input/commandPlanner';
import { InputController } from './input/inputController';
import { type KeyAction, stepSpeed } from './input/keymap';
import { pickGround, projectToScreen } from './input/picking';
import { SelectionModel, idsInScreenRect } from './input/selection';
import { type FeatureItem, MarkerLayer, type MarkerItem } from './markers/markerLayer';
import { COLOR, TEAM_FILL, TEAM_RIM, factorColor, uiScale } from './theme';

export interface MountUiOptions {
  container: HTMLElement;
  session: UiSession;
  view: { camera: PerspectiveCamera; scene: Scene; renderer: WebGLRenderer };
}

export interface UiHandle {
  /** 렌더 직전에 매 프레임 부른다. 카메라 → 오버레이 → 마커 → HUD 순으로 갱신한다. */
  update(frameSeconds: number): void;
  /** 카메라(전술 지도 플래그 tacticalView 포함). */
  readonly camera: RtsCamera;
  dispose(): void;
}

const ROOT_FONT_PX = 13;
const PATH_MIN_MOVE_M = 4;
const PATH_MIN_INTERVAL_MS = 100;
const PATH_MAX_SQUADS = 8;
const SLOT_MIN_MOVE_M = 2;
const RANGE_MOVE_M = 5;
const TOOLTIP_DELAY_MS = 350;
const HUD_INTERVAL_MS = 100;
const SMOOTHING = 12;
const MARKER_HEIGHT = 6;
/** 사거리 바깥선 굵기 = 선택 윤곽 굵기 × 이 값(보조 정보라 얇게) */
const RANGE_LINE_RATIO = 0.45;
/** 도착 자리(planMoveSlots) 최소 갱신 간격(ms) */
const SLOT_MIN_INTERVAL_MS = 50;

const EMPTY_MARKER: MarkerItem = {
  id: -1,
  team: 0,
  icon: 'infantry',
  sx: 0,
  sy: 0,
  count: 0,
  morale: 0,
  moraleBand: 'steady',
  state: 'ready',
  own: false,
  selected: false,
  hovered: false,
  ghost: false,
  group: null,
  concealed: false,
  size: 1,
  showCount: false,
};

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const RESULT_TEXT: Record<Exclude<CommandResult, 'ok'>, string> = {
  noSelection: '부대를 선택하세요',
  notYourSquad: '명령할 수 있는 부대가 없습니다',
  wrongPhase: '지금 단계에서는 내릴 수 없는 명령입니다',
  invalidTarget: '공격할 수 없는 대상입니다',
  invalidPlacement: '배치할 수 없는 위치입니다 — 배치 구역 밖이거나 통과 불가',
};

/**
 * UI 진입 함수(docs/INTERFACES.md §3.1). HUD·마커·오버레이·입력을 만들고 카메라를 소유한다.
 * B가 src/main.ts에서 부르고, 매 프레임 렌더 직전에 update()를 부른다.
 */
export function mountUi(options: MountUiOptions): UiHandle {
  const ui = new GameUi(options);
  document.getElementById('boot')?.remove();
  return ui;
}

interface RightDrag {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  dragged: boolean;
}

class GameUi implements UiHandle {
  readonly camera: RtsCamera;
  private readonly session: UiSession;
  private readonly cam: PerspectiveCamera;
  private readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly root: HTMLElement;
  private readonly selection = new SelectionModel();
  private readonly input: InputController;
  private readonly markers: MarkerLayer;
  private readonly lines: DrapedLines;
  private readonly range: RangeOverlay;
  private readonly slope: SlopeOverlay;
  private readonly topBar: TopBar;
  private readonly cards: UnitCards;
  private readonly commands: CommandPanel;
  private readonly log: EventLog;
  private readonly minimap: Minimap;
  private readonly controls: Controls;
  private readonly banner: Banner;
  private readonly modal: Modal;
  private readonly tooltip: Tooltip;
  private readonly toast: Toast;
  private readonly label: HTMLElement;
  private readonly labelText: Text;
  private readonly labelWarnings: HTMLElement[] = [];
  private labelKey = '';
  private readonly warnings: string[] = [];
  private readonly deployButtons: HTMLElement[];
  private readonly pauseButtons: HTMLElement[];
  private lastPathAt = 0;
  private lastSlotsAt = 0;
  private readonly rangeIds: number[] = [];
  private rangeProfiles: RangeProfileData[] = [];
  private readonly unsubscribe: () => void;
  private readonly resizeObserver: ResizeObserver;

  private width = 1;
  private height = 1;
  private scale = 1;
  private display = new Map<number, { x: number; z: number }>();
  private screen = new Map<number, { sx: number; sy: number; visible: boolean }>();
  private pending: 'move' | 'attack' | null = null;
  private hoverSquad: number | null = null;
  private hoverScreen: { sx: number; sy: number; since: number } | null = null;
  private tooltipSource: 'world' | 'hud' | null = null;
  private box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private drag: RightDrag | null = null;
  private slots: readonly MoveSlot[] = [];
  private slotsAt = { x: Infinity, z: Infinity, w: 0 };
  private paths = new Map<number, { x: number; z: number; time: number; path: PathPreviewView }>();
  private rangeCache = new Map<
    number,
    { x: number; z: number; profile: RangeProfileData; outline: Float32Array }
  >();
  private rangeKey: number[] = [];
  private readonly scratchScreen = { sx: 0, sy: 0, visible: false };
  private readonly markerItems: MarkerItem[] = [];
  private readonly markerPool: MarkerItem[] = [];
  private readonly featureItems: FeatureItem[] = [];
  private readonly miniSquads: MinimapSquad[] = [];
  private frustumKey = '';
  private frustumCache: readonly { x: number; z: number }[] = [];
  private slopeOn = false;
  private rangeOn = false;
  private lastHud = 0;
  private lastPhase: string | null = null;
  private resumeAfterMenu = false;
  private time = 0;

  constructor(opts: MountUiOptions) {
    this.session = opts.session;
    this.cam = opts.view.camera;
    this.scene = opts.view.scene;
    this.canvas = opts.view.renderer.domElement;
    const terrain = this.session.terrain;
    const height = (x: number, z: number) => terrain.heightAt(x, z);

    this.camera = new RtsCamera(this.cam, this.canvas, terrain, height);
    this.camera.targetX = 420;
    this.camera.targetZ = 520;
    this.camera.distance = 420;
    this.camera.setDistance(420);
    this.camera.yaw = Math.PI;

    this.lines = new DrapedLines(terrain);
    this.range = new RangeOverlay(height);
    this.slope = new SlopeOverlay(terrain.width, terrain.depth, height);
    this.scene.add(this.slope.mesh, this.range.mesh, this.lines.mesh);

    this.root = h('div', { class: 'ui-root' });
    opts.container.appendChild(this.root);
    this.markers = new MarkerLayer(this.root);
    this.labelText = document.createTextNode('');
    this.label = h('div', { class: 'world-label', attrs: { hidden: '' } }, [this.labelText]);
    this.root.appendChild(this.label);
    this.topBar = new TopBar(this.root);
    this.log = new EventLog(this.root, (x, z) => this.camera.focusOn(x, z));
    this.controls = new Controls(this.root, {
      togglePause: () => this.togglePause(),
      setSpeed: (speed) => this.setSpeed(speed),
      toggleSlope: () => (this.slopeOn = !this.slopeOn),
      toggleRange: () => (this.rangeOn = !this.rangeOn),
      toggleTactical: () => this.camera.toggleTacticalMap(),
      openMenu: () => this.openMenu(),
      hover: (tip, el) => this.hudTip(tip, el),
    });
    const bottom = h('div', { class: 'hud-bottom' });
    this.root.appendChild(bottom);
    this.commands = new CommandPanel(
      bottom,
      (id) => this.pressCommand(id),
      (tip, el) => this.hudTip(tip, el),
    );
    this.cards = new UnitCards(bottom, {
      select: (id, add) => this.selection.click(id, add),
      focus: (id) => this.focusSquads([id]),
      hover: (id, el) => this.cardTip(id, el),
    });
    this.minimap = new Minimap(bottom, terrain, (x, z) => {
      this.camera.targetX = x;
      this.camera.targetZ = z;
      this.camera.focusOn(x, z);
    });
    this.banner = new Banner(this.root);
    // 안내 띠 버튼은 한 번만 만든다(매 프레임 DOM 생성 금지).
    this.deployButtons = [
      button('브리핑으로', () => this.session.backToBriefing()),
      button('전투 시작', () => this.session.startBattle(), 'primary'),
    ];
    this.pauseButtons = [button('재개', () => this.session.setPaused(false), 'primary')];
    this.toast = new Toast(this.root);
    this.tooltip = new Tooltip(this.root);
    this.modal = new Modal(this.root);
    // HUD 버튼이 포커스를 가져가 Space가 버튼을 누르지 않게 한다.
    this.root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button, .card')) e.preventDefault();
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());

    this.input = new InputController(this.canvas, {
      leftClick: (x, y, shift) => this.leftClick(x, y, shift),
      boxPreview: (b) => (this.box = b),
      boxSelect: (b, shift) => this.boxSelect(b, shift),
      rightPress: (x, y) => this.rightPress(x, y),
      rightDrag: (x, y) => this.rightDrag(x, y),
      rightRelease: (x, y, dragged) => this.rightRelease(x, y, dragged),
      hover: (x, y) => {
        this.hoverScreen = { sx: x, sy: y, since: performance.now() };
        this.hideWorldTip();
      },
      leave: () => {
        this.hoverScreen = null;
        this.hoverSquad = null;
        this.hideWorldTip();
      },
      key: (action, e) => this.key(action, e),
    });

    this.unsubscribe = this.session.onEvent((e) => {
      const s = this.session;
      const player = s.playerTeam;
      // D-013: 아군 이벤트는 모두, 적은 보일 때 큰 사건만(관전이면 모두).
      const visibility: LogVisibility = {
        team: (id) => s.squad(id).team,
        seen: (id) => player === null || s.isVisible(id, player) || s.lastSeen(id, player) !== null,
        commanderOf: (team) => s.squads().find((q) => q.team === team && q.isCommander)?.id ?? -1,
      };
      if (!shouldLog(e, player, visibility)) return;
      const line = formatEvent(e, {
        name: (id) => s.squad(id).name,
        team: (id) => s.squad(id).team,
      });
      if (line) this.log.push(line);
    });

    this.resizeObserver = new ResizeObserver(() => this.resize(opts.container));
    this.resizeObserver.observe(opts.container);
    this.resize(opts.container);
  }

  // ================================================================ 프레임

  update(frameSeconds: number): void {
    const dt = Math.min(frameSeconds, 0.1);
    this.time += dt;
    const s = this.session;
    this.camera.keyboardEnabled = !this.modal.isOpen;
    this.camera.update(dt);
    this.syncPhase();

    const squads = s.squads();
    const player = s.playerTeam;
    this.smoothPositions(squads, dt);
    this.selection.prune((id) => {
      const sq = squads[id];
      return sq !== undefined && sq.team === player && sq.state !== 'destroyed';
    });
    this.projectSquads(squads);
    this.updateHover();

    this.drawWorld(squads);
    this.drawMarkers(squads);

    const now = performance.now();
    if (now - this.lastHud >= HUD_INTERVAL_MS) {
      this.lastHud = now;
      this.updateHud(squads);
    }
    this.updateWorldTip(now);
  }

  dispose(): void {
    this.unsubscribe();
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.camera.dispose();
    this.scene.remove(this.slope.mesh, this.range.mesh, this.lines.mesh);
    this.slope.dispose();
    this.range.dispose();
    this.lines.dispose();
    this.markers.dispose();
    this.root.remove();
  }

  private resize(container: HTMLElement): void {
    this.width = Math.max(1, container.clientWidth);
    this.height = Math.max(1, container.clientHeight);
    this.scale = uiScale(this.width, this.height);
    document.documentElement.style.fontSize = `${ROOT_FONT_PX * this.scale}px`;
    this.markers.scale = this.scale;
    this.markers.resize(this.width, this.height, Math.min(2, window.devicePixelRatio || 1));
  }

  private syncPhase(): void {
    const s = this.session;
    const key = `${s.phase}`;
    if (key !== this.lastPhase) {
      this.lastPhase = key;
      this.root.dataset.phase = s.phase;
      this.cancelGesture();
      if (s.phase === 'briefing' || s.phase === 'deployment') {
        this.log.clear();
        this.selection.clear();
        this.rangeCache.clear();
      }
      if (s.phase === 'briefing') {
        this.modal.open(
          'briefing',
          briefingSheet(s.squads(), s.playerTeam ?? 0, (team) => {
            this.modal.close();
            s.chooseSide(team);
          }),
        );
        this.camera.focusOn(512, 560, 1000);
      } else if (this.modal.name === 'briefing') {
        this.modal.close();
      }
      if (s.phase === 'deployment' && s.playerTeam !== null) {
        const zone = s.deploymentZone(s.playerTeam);
        this.camera.focusOn((zone.minX + zone.maxX) / 2, (zone.minZ + zone.maxZ) / 2, 520);
        // 자기 진영 뒤에서 적 쪽을 본다(청람은 남쪽에서 북쪽으로).
        this.camera.yaw = s.playerTeam === 0 ? Math.PI : 0;
      }
      if (s.phase === 'result') {
        const result = s.result();
        if (result) {
          this.modal.open(
            'result',
            resultSheet(
              result,
              s.playerTeam,
              (id) => s.squad(id).name,
              (id) => s.squad(id).team,
              s.scale,
              {
                restart: () => {
                  this.modal.close();
                  s.restart();
                },
                briefing: () => {
                  this.modal.close();
                  s.backToBriefing();
                },
              },
            ),
          );
        }
      } else if (this.modal.name === 'result') {
        this.modal.close();
      }
    }
    this.input.enabled = !this.modal.isOpen;

    if (s.phase === 'deployment') {
      this.banner.show(
        'deploy',
        '배치 단계 — 적 배치는 보이지 않는다',
        '우클릭: 옮기기 · 우클릭 드래그: 정면·폭 · F/G/H: 대형 · 빨간 윤곽은 놓을 수 없는 자리',
        this.deployButtons,
      );
    } else if (s.phase === 'battle' && s.paused && !this.modal.isOpen) {
      this.banner.show(
        'pause',
        '일시정지',
        '명령은 계속 내릴 수 있다 · Space로 재개',
        this.pauseButtons,
        'pause',
      );
    } else {
      this.banner.hide();
    }
  }

  private smoothPositions(squads: readonly SquadView[], dt: number): void {
    const k = 1 - Math.exp(-SMOOTHING * dt);
    for (const sq of squads) {
      const d = this.display.get(sq.id);
      if (!d || Math.hypot(d.x - sq.x, d.z - sq.z) > 30) {
        this.display.set(sq.id, { x: sq.x, z: sq.z });
      } else {
        d.x += (sq.x - d.x) * k;
        d.z += (sq.z - d.z) * k;
        // 지수 수렴은 끝나지 않으므로 1mm 안이면 맞춘다(멈춘 화면에서 지면 선을 다시 올리지 않게).
        if (Math.abs(sq.x - d.x) < 0.001) d.x = sq.x;
        if (Math.abs(sq.z - d.z) < 0.001) d.z = sq.z;
      }
    }
  }

  private projectSquads(squads: readonly SquadView[]): void {
    const t = this.session.terrain;
    const lift = this.camera.tacticalView ? 0 : MARKER_HEIGHT;
    for (const sq of squads) {
      const p = this.posOf(sq);
      let out = this.screen.get(sq.id);
      if (!out) {
        out = { sx: 0, sy: 0, visible: false };
        this.screen.set(sq.id, out);
      }
      projectToScreen(
        this.cam,
        p.x,
        t.heightAt(p.x, p.z) + lift,
        p.z,
        this.width,
        this.height,
        out,
      );
    }
  }

  private posOf(sq: SquadView): { x: number; z: number } {
    return this.display.get(sq.id) ?? sq;
  }

  /** 플레이어가 지금 볼 수 있는 부대인가(관전이면 전부). */
  private seen(sq: SquadView): boolean {
    const p = this.session.playerTeam;
    if (sq.state === 'destroyed') return false;
    if (p === null || sq.team === p) return true;
    if (this.session.phase !== 'battle' && this.session.phase !== 'result') return false;
    return this.session.isVisible(sq.id, p);
  }

  // ================================================================ 전장 위 표시

  private drawWorld(squads: readonly SquadView[]): void {
    const s = this.session;
    const player = s.playerTeam;
    const dist = this.camera.distance;
    const lw = Math.min(8, Math.max(0.45, dist * 0.0042));
    const lines = this.lines;
    lines.lift = 0.35 + dist * 0.0022;
    lines.begin();

    // 사거리 바깥선을 가장 먼저(가장 아래에) 그린다. 굵기는 선택 윤곽의 45%, 불투명도 40%.
    this.updateRangeOverlay(squads);
    for (const id of this.rangeIds) {
      const c = this.rangeCache.get(id);
      if (c) lines.polyline(c.outline, lw * RANGE_LINE_RATIO, COLOR.select, 0.4, true);
    }

    // 깃발 구역
    const flag = s.flag();
    const flagColor = flag.state === 'capturing' ? COLOR.attack : COLOR.select;
    lines.circle(
      flag.x,
      flag.z,
      flag.radius,
      lw,
      flagColor,
      flag.state === 'capturing' ? 0.6 + 0.3 * Math.sin(this.time * 6) : 0.5,
      flag.state === 'empty' ? 6 : 0,
    );

    // 배치 구역
    if (s.phase === 'deployment' && player !== null) {
      for (const team of [0, 1] as TeamId[]) {
        const z = s.deploymentZone(team);
        const pts = [z.minX, z.minZ, z.maxX, z.minZ, z.maxX, z.maxZ, z.minX, z.maxZ];
        lines.polyline(pts, lw * 1.4, team === player ? COLOR.select : COLOR.danger, 0.8, true, 10);
      }
    }

    const tactical = this.camera.tacticalView;
    for (const sq of squads) {
      if (!this.seen(sq)) {
        const ghost =
          player !== null && sq.team !== player && s.phase === 'battle'
            ? s.lastSeen(sq.id, player)
            : null;
        if (ghost)
          lines.rect(
            ghost.x,
            ghost.z,
            sq.facing,
            sq.width,
            sq.depth,
            lw,
            TEAM_FILL[sq.team],
            0.6,
            4,
          );
        continue;
      }
      const p = this.posOf(sq);
      if (tactical) {
        lines.fillRect(
          p.x,
          p.z,
          sq.facing,
          Math.max(sq.width, 8),
          Math.max(sq.depth, 6),
          TEAM_FILL[sq.team],
          sq.state === 'routing' ? 0.45 : 0.9,
        );
        lines.rect(
          p.x,
          p.z,
          sq.facing,
          Math.max(sq.width, 8),
          Math.max(sq.depth, 6),
          lw * 0.8,
          TEAM_RIM[sq.team],
          0.9,
        );
      }
      const selected = this.selection.has(sq.id);
      if (selected || this.hoverSquad === sq.id) {
        lines.rect(
          p.x,
          p.z,
          sq.facing,
          sq.width + 2,
          sq.depth + 2,
          lw * (selected ? 1 : 0.7),
          COLOR.select,
          selected ? 0.95 : 0.5,
        );
      }
      if (selected) {
        // 정면 화살표
        const fx = Math.sin(sq.facing);
        const fz = Math.cos(sq.facing);
        const reach = sq.depth / 2 + 3 + lw * 2;
        lines.arrowHead(
          p.x + fx * reach,
          p.z + fz * reach,
          sq.facing,
          Math.max(3, lw * 4),
          COLOR.select,
          0.95,
        );
        // 공격 표적 선
        const target = sq.targetId >= 0 ? squads[sq.targetId] : undefined;
        if (target && this.seen(target)) {
          const tp = this.posOf(target);
          const dx = tp.x - p.x;
          const dz = tp.z - p.z;
          const d = Math.hypot(dx, dz) || 1;
          const end = Math.max(0, d - target.depth / 2 - 2);
          lines.polyline(
            [p.x, p.z, p.x + (dx / d) * end, p.z + (dz / d) * end],
            lw,
            COLOR.attack,
            0.9,
            false,
            5,
          );
          lines.arrowHead(
            p.x + (dx / d) * end,
            p.z + (dz / d) * end,
            Math.atan2(dx, dz),
            Math.max(3, lw * 4),
            COLOR.attack,
            0.95,
          );
        }
      }
    }

    this.drawMovePreview(squads, lw);
    lines.end();

    this.updateSlopeOverlay(squads);
  }

  private drawMovePreview(squads: readonly SquadView[], lw: number): void {
    const drag = this.drag;
    if (!drag) {
      this.label.hidden = true;
      return;
    }
    const s = this.session;
    const lines = this.lines;
    const ids = this.selection.ids;
    const line = drag.dragged ? lineFormation(this.dragLine(drag)) : null;
    const tx = line ? line.x : drag.x1;
    const tz = line ? line.z : drag.z1;
    // sim의 분할 함수(planMoveSlots)로 도착 자리를 받는다(D-011). 커서가 2m 넘게 움직일 때만.
    const w = line ? line.width : 0;
    const nowMs = performance.now();
    const firstSlots = this.slotsAt.x === Infinity;
    if (
      (firstSlots || nowMs - this.lastSlotsAt >= SLOT_MIN_INTERVAL_MS) &&
      (Math.hypot(this.slotsAt.x - tx, this.slotsAt.z - tz) > SLOT_MIN_MOVE_M ||
        Math.abs(this.slotsAt.w - w) > SLOT_MIN_MOVE_M)
    ) {
      this.lastSlotsAt = nowMs;
      this.slotsAt.x = tx;
      this.slotsAt.z = tz;
      this.slotsAt.w = w;
      this.slots = line
        ? s.planMoveSlots(ids, line.x, line.z, line.facing, line.width)
        : s.planMoveSlots(ids, tx, tz);
    }
    if (line) lines.line(drag.x0, drag.z0, drag.x1, drag.z1, lw * 0.8, COLOR.select, 0.55);

    const deploying = s.phase === 'deployment';
    let eta = 0;
    let unreachable = false;
    let invalid = false;
    const warnings = this.warnings;
    warnings.length = 0;
    let budget = PATH_MAX_SQUADS;
    // 경로 탐색은 선택 전체 기준 초당 최대 10회(아키텍트 §11.6-10). 100ms마다 하나씩, 경로가 없거나
    // 커서가 4m 넘게 움직인 부대 중 가장 오래된 것부터 다시 묻는다.
    let refresh = -1;
    if (!deploying && nowMs - this.lastPathAt >= PATH_MIN_INTERVAL_MS) {
      let oldest = Infinity;
      let count = 0;
      for (const slot of this.slots) {
        if (count++ >= PATH_MAX_SQUADS) break;
        const c = this.paths.get(slot.squadId);
        const age = !c ? -Infinity : c.time;
        const stale = !c || Math.hypot(c.x - slot.x, c.z - slot.z) > PATH_MIN_MOVE_M;
        if (stale && age < oldest) {
          oldest = age;
          refresh = slot.squadId;
        }
      }
    }
    for (const slot of this.slots) {
      const sq = squads[slot.squadId];
      if (!sq) continue;
      const bad = deploying && !s.canDeploy(sq.id, slot.x, slot.z, slot.facing, slot.files).ok;
      invalid ||= bad;
      const spacing = sq.files > 0 ? sq.width / sq.files : 1.4;
      const width = line ? slot.files * spacing : sq.width;
      const depth = line
        ? (Math.ceil(sq.count / slot.files) * sq.depth) /
          Math.max(1, Math.ceil(sq.count / Math.max(1, sq.files)))
        : sq.depth;
      const color = bad ? COLOR.danger : COLOR.select;
      lines.rect(slot.x, slot.z, slot.facing, width, depth, lw, color, 0.9, bad ? 0 : 4);
      lines.arrowHead(
        slot.x + Math.sin(slot.facing) * (depth / 2 + 3),
        slot.z + Math.cos(slot.facing) * (depth / 2 + 3),
        slot.facing,
        Math.max(3, lw * 4),
        color,
        0.9,
      );
      if (deploying || budget <= 0) continue;
      budget--;
      let cached = this.paths.get(sq.id);
      if (sq.id === refresh) {
        this.lastPathAt = nowMs;
        cached = { x: slot.x, z: slot.z, time: nowMs, path: s.previewPath(sq.id, slot.x, slot.z) };
        this.paths.set(sq.id, cached);
      }
      if (!cached) continue;
      const path = cached.path;
      const pts = path.points;
      for (let i = 0; i + 1 < pts.length / 2; i++) {
        const f = path.factors[i];
        lines.line(
          pts[i * 2],
          pts[i * 2 + 1],
          pts[i * 2 + 2],
          pts[i * 2 + 3],
          lw * 1.3,
          factorColor(f),
          0.9,
        );
      }
      eta = Math.max(eta, path.etaSeconds);
      unreachable ||= !path.reachable;
      for (const w of path.warnings) if (!warnings.includes(w)) warnings.push(w);
    }

    // 끝점 라벨: 예상 도착 시간 / 도달 불가 / 배치 불가
    const p = this.scratchScreen;
    projectToScreen(
      this.cam,
      drag.x1,
      s.terrain.heightAt(drag.x1, drag.z1),
      drag.z1,
      this.width,
      this.height,
      p,
    );
    const text = invalid
      ? '✕ 배치할 수 없음'
      : unreachable
        ? '✕ 도달 불가'
        : deploying
          ? '배치'
          : `도착 약 ${Math.round(eta)}초`;
    // 내용이 바뀔 때만 DOM을 고친다. 위치는 transform 한 줄만.
    const bad = invalid || unreachable;
    const key = `${bad ? 1 : 0}${text}|${warnings.join('|')}`;
    if (key !== this.labelKey) {
      this.labelKey = key;
      this.labelText.data = text;
      for (let i = 0; i < Math.max(warnings.length, this.labelWarnings.length); i++) {
        let el = this.labelWarnings[i];
        if (!el) {
          el = h('small');
          this.labelWarnings.push(el);
          this.label.appendChild(el);
        }
        el.hidden = i >= warnings.length;
        if (i < warnings.length) el.textContent = warnings[i];
      }
      this.label.className = `world-label${bad ? ' bad' : ''}`;
    }
    this.label.style.transform = `translate(${p.sx}px, ${p.sy}px) translate(-50%, -130%)`;
    this.label.hidden = !p.visible;
  }

  /** 사거리를 보일 궁수(rangeIds)와 프로필 캐시를 갱신한다. 바뀐 때만 메시를 다시 만든다. */
  private updateRangeOverlay(squads: readonly SquadView[]): void {
    const player = this.session.playerTeam;
    const ids = this.rangeIds;
    ids.length = 0;
    for (const sq of squads) {
      if (sq.team !== player || sq.state === 'destroyed' || sq.type !== 'archer') continue;
      if (this.rangeOn || this.selection.has(sq.id)) ids.push(sq.id);
    }
    let changed = false;
    for (const id of ids) {
      const sq = squads[id];
      const c = this.rangeCache.get(id);
      if (!c || Math.hypot(c.x - sq.x, c.z - sq.z) > RANGE_MOVE_M) {
        const profile = this.session.rangeProfile(id);
        if (profile) {
          this.rangeCache.set(id, { x: sq.x, z: sq.z, profile, outline: rangeOutline(profile) });
          changed = true;
        }
      }
    }
    if (!changed && sameIds(ids, this.rangeKey)) return;
    this.rangeKey = ids.slice();
    this.rangeProfiles = ids
      .map((id) => this.rangeCache.get(id)?.profile)
      .filter((p): p is RangeProfileData => !!p);
    this.range.set(this.rangeProfiles);
  }

  private primaryType(squads: readonly SquadView[]): UnitTypeId {
    const first = this.selection.ids.map((id) => squads[id]).find(Boolean);
    return first?.type ?? 'infantry';
  }

  private updateSlopeOverlay(squads: readonly SquadView[]): void {
    this.slope.mesh.visible = this.slopeOn;
    if (!this.slopeOn) return;
    const type = this.primaryType(squads);
    const mounted = UNIT_TYPES[type].mounted;
    const t = this.session.terrain;
    // 계수는 기병/보병류로만 갈리므로 그 둘로 캐시한다.
    this.slope.bake(
      mounted ? 'mounted' : 'foot',
      (x, z, out) => t.gradientAt(x, z, out),
      (x, z, dx, dz) => this.session.moveFactorAt(mounted ? 'cavalry' : 'infantry', x, z, dx, dz),
    );
  }

  private drawMarkers(squads: readonly SquadView[]): void {
    const s = this.session;
    const player = s.playerTeam;
    const tactical = this.camera.tacticalView;
    const showCount = tactical || this.camera.distance < 380;
    const items = this.markerItems;
    items.length = 0;
    let used = 0;
    for (const sq of squads) {
      const scr = this.screen.get(sq.id);
      if (!scr) continue;
      const seen = this.seen(sq);
      let sx = scr.sx;
      let sy = scr.sy;
      let ghost = false;
      if (!seen) {
        const last =
          player !== null && sq.team !== player && s.phase === 'battle'
            ? s.lastSeen(sq.id, player)
            : null;
        if (!last) continue;
        const g = this.scratchScreen;
        projectToScreen(
          this.cam,
          last.x,
          s.terrain.heightAt(last.x, last.z) + (tactical ? 0 : MARKER_HEIGHT),
          last.z,
          this.width,
          this.height,
          g,
        );
        if (!g.visible) continue;
        sx = g.sx;
        sy = g.sy;
        ghost = true;
      } else if (!scr.visible) continue;
      // 마커 객체는 풀에서 꺼내 다시 쓴다(매 프레임 할당 없음).
      let m = this.markerPool[used];
      if (!m) {
        m = { ...EMPTY_MARKER };
        this.markerPool.push(m);
      }
      used++;
      m.id = sq.id;
      m.team = sq.team;
      m.icon = squadIconId(sq.type, sq.isCommander);
      m.sx = sx;
      m.sy = sy;
      m.count = sq.count;
      m.morale = sq.morale;
      m.moraleBand = sq.moraleBand;
      m.state = sq.state;
      m.own = sq.team === player;
      m.selected = this.selection.has(sq.id);
      m.hovered = this.hoverSquad === sq.id;
      m.ghost = ghost;
      m.group = sq.team === player ? this.selection.groupOf(sq.id) : null;
      m.concealed = sq.concealed && sq.team === player;
      m.size = tactical ? 1.15 : 1;
      m.showCount = showCount;
      items.push(m);
    }
    const features = this.featureItems;
    let nf = 0;
    if (tactical) {
      for (const f of s.mapFeatures()) {
        const p = this.scratchScreen;
        projectToScreen(
          this.cam,
          f.x,
          s.terrain.heightAt(f.x, f.z),
          f.z,
          this.width,
          this.height,
          p,
        );
        if (!p.visible) continue;
        const item = features[nf] ?? (features[nf] = { kind: f.kind, sx: 0, sy: 0 });
        item.kind = f.kind;
        item.sx = p.sx;
        item.sy = p.sy;
        nf++;
      }
    }
    features.length = nf;
    this.markers.draw(items, this.box, this.time, features);
  }

  // ================================================================ HUD

  private updateHud(squads: readonly SquadView[]): void {
    const s = this.session;
    const player = s.playerTeam;
    const own = player === null ? [] : squads.filter((sq) => sq.team === player);
    this.topBar.update(
      player ?? 0,
      (t) => s.strength(t),
      s.flag(),
      s.battleTime,
      s.timeLimit,
      s.scale,
    );
    this.cards.update(
      own,
      (id) => this.selection.has(id),
      (id) => this.selection.groupOf(id),
    );
    const selected = this.selection.ids.map((id) => squads[id]).filter(Boolean);
    const formations = new Set(selected.map((sq) => sq.formation));
    this.commands.update({
      hasSelection: selected.length > 0,
      canCommand: s.phase === 'battle',
      formation: formations.size === 1 ? [...formations][0] : null,
      pending: this.pending,
      canCharge: selected.some(
        (sq) => UNIT_TYPES[sq.type].charge || UNIT_TYPES[sq.type].footCharge,
      ),
    });
    const mounted = UNIT_TYPES[this.primaryType(squads)].mounted;
    this.controls.update({
      paused: s.paused,
      speed: s.speed,
      maxSpeed: s.maxSpeed,
      speedLimitReason: s.speedLimitReason,
      slope: this.slopeOn,
      slopeUnit: mounted ? '기병' : '보병·창병·궁수',
      range: this.rangeOn,
      tactical: this.camera.tacticalView,
      battle: s.phase === 'battle',
    });
    this.log.age(s.battleTime);

    // 미니맵
    const mini = this.miniSquads;
    let nm = 0;
    for (const sq of squads) {
      if (!this.seen(sq)) continue;
      const p = this.posOf(sq);
      const m =
        mini[nm] ?? (mini[nm] = { team: sq.team, x: 0, z: 0, selected: false, ghost: false });
      m.team = sq.team;
      m.x = p.x;
      m.z = p.z;
      m.selected = this.selection.has(sq.id);
      nm++;
    }
    mini.length = nm;
    this.minimap.draw(mini, s.flag(), s.mapFeatures(), this.frustum());
    this.canvas.style.cursor = this.pending
      ? 'crosshair'
      : this.hoverSquad !== null
        ? 'pointer'
        : 'default';
  }

  /** 카메라 시야 사다리꼴(지면 좌표). 카메라가 움직였을 때만 다시 구한다. */
  private frustum(): readonly { x: number; z: number }[] {
    const c = this.camera;
    const key = `${c.targetX.toFixed(1)},${c.targetZ.toFixed(1)},${c.yaw.toFixed(3)},${c.effectivePitch.toFixed(3)},${c.distance.toFixed(1)},${this.width},${this.height}`;
    if (key === this.frustumKey) return this.frustumCache;
    this.frustumKey = key;
    const t = this.session.terrain;
    const out: { x: number; z: number }[] = [];
    for (const [fx, fy] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]) {
      let hit = null;
      for (
        let y = fy;
        hit === null && (fy === 0 ? y <= 0.6 : y >= 0.4);
        y += fy === 0 ? 0.15 : -0.15
      ) {
        hit = pickGround(this.cam, t, fx * this.width, y * this.height, this.width, this.height);
      }
      if (hit) out.push(hit);
    }
    this.frustumCache = out;
    return out;
  }

  // ================================================================ 툴팁

  private hudTip(tip: string | null, el: HTMLElement | null): void {
    if (!tip || !el) {
      if (this.tooltipSource === 'hud') this.tooltip.hide();
      this.tooltipSource = null;
      return;
    }
    this.tooltipSource = 'hud';
    this.tooltip.showAbove(el, [h('div', { text: tip })]);
  }

  private cardTip(id: number | null, el: HTMLElement | null): void {
    if (id === null || !el) return this.hudTip(null, null);
    this.tooltipSource = 'hud';
    this.tooltip.showAbove(el, this.squadTipContent(this.session.squad(id)));
  }

  private squadTipContent(sq: SquadView): Node[] {
    const band = { steady: '안정', wavering: '동요', routing: '패주' }[sq.moraleBand];
    const rows: Node[] = [
      tipTitle(sq.name, h('i', { class: `ui-team t${sq.team}` })),
      tipRow('병력', `${sq.count} / ${sq.startCount}`),
      tipRow('사기', `${Math.round(sq.morale)} (${band})`),
      tipRow('상태', `${activityLabel(sq)} · ${FORMATION_LABEL[sq.formation]} ${sq.files}열`),
    ];
    if (sq.canCharge)
      rows.push(
        tipRow('돌격', sq.chargeCooldown > 0 ? `${Math.ceil(sq.chargeCooldown)}초 뒤` : '준비'),
      );
    if (sq.heightBonusPct > 0)
      rows.push(tipEffect(`고지에서 싸우는 중 — 피해 +${Math.round(sq.heightBonusPct)}%`));
    if (sq.shieldWall) rows.push(tipEffect('방패벽 — 정면 피해 감소'));
    if (sq.braced) rows.push(tipEffect('Brace — 정면 돌격 충격 감소'));
    if (sq.concealed) {
      rows.push(tipEffect(`은폐 — ${TERRAIN.forestHideDist}m 밖의 적에게 보이지 않음`));
    }
    if (sq.autoNarrowed) rows.push(tipEffect('종대 통과 중 — 측면이 약하다', true));
    if (sq.moraleBand === 'wavering') {
      rows.push(tipEffect(`동요 — 피해 ×${COMBAT.waverDamageMult}, 돌격 불가`, true));
    }
    return rows;
  }

  private hideWorldTip(): void {
    if (this.tooltipSource === 'world') {
      this.tooltip.hide();
      this.tooltipSource = null;
    }
  }

  private updateWorldTip(now: number): void {
    const hs = this.hoverScreen;
    if (!hs || this.drag || this.box || this.modal.isOpen || this.tooltipSource === 'hud') return;
    if (now - hs.since < TOOLTIP_DELAY_MS || this.tooltipSource === 'world') return;
    const s = this.session;
    let content: Node[];
    if (this.hoverSquad !== null) {
      content = this.squadTipContent(s.squad(this.hoverSquad));
    } else {
      const g = pickGround(this.cam, s.terrain, hs.sx, hs.sy, this.width, this.height);
      if (!g) return;
      const squads = s.squads();
      const type = this.selection.size > 0 ? this.primaryType(squads) : null;
      const info = s.terrainInfo(g.x, g.z, type);
      content = [
        tipTitle(info.typeName),
        tipRow('높이', `${info.height.toFixed(0)}m · 경사 ${info.slopeDeg.toFixed(0)}°`),
      ];
      if (info.moveFactor !== null && type) {
        const unit = UNIT_TYPES[type].mounted ? '기병' : UNIT_TYPES[type].name;
        content.push(
          tipRow(
            `${unit} 이동`,
            info.moveFactor <= 0
              ? '통과 불가'
              : `${Math.round(info.moveFactor * 100)}% (오르막 기준)`,
          ),
        );
      }
      for (const e of info.effects)
        content.push(
          tipEffect(e.startsWith('통과 불가') ? `✕ ${e}` : e, e.startsWith('통과 불가')),
        );
    }
    this.tooltipSource = 'world';
    this.tooltip.showAt(hs.sx, hs.sy, content);
  }

  // ================================================================ 입력 → 명령

  private ownSelected(): SquadView[] {
    const squads = this.session.squads();
    return this.selection.ids.map((id) => squads[id]).filter(Boolean);
  }

  /** 선택이 없으면 안내하고 false(D-009). */
  private requireSelection(): boolean {
    if (this.session.playerTeam === null) return false;
    if (this.selection.size > 0) return true;
    this.toast.show('부대를 선택하세요');
    return false;
  }

  private issue(cmd: Parameters<UiSession['issue']>[0]): void {
    const r = this.session.issue(cmd);
    if (r !== 'ok') this.toast.show(RESULT_TEXT[r]);
  }

  /** 화면 좌표의 부대. prefer 쪽 진영을 먼저 본다. 마커 → 부대 사각형 순. */
  private pickSquad(sx: number, sy: number, prefer: 'own' | 'enemy'): number | null {
    const s = this.session;
    const player = s.playerTeam;
    const squads = s.squads();
    const radius = this.markers.radius(this.camera.tacticalView ? 1.15 : 1) + 4;
    let best: number | null = null;
    let bestScore = Infinity;
    for (const sq of squads) {
      if (!this.seen(sq)) continue;
      const p = this.screen.get(sq.id);
      if (!p?.visible) continue;
      const d = Math.hypot(p.sx - sx, p.sy - sy);
      if (d > radius) continue;
      const own = sq.team === player;
      const score = d + ((prefer === 'own') === own ? 0 : 1000);
      if (score < bestScore) {
        bestScore = score;
        best = sq.id;
      }
    }
    if (best !== null) return best;
    const g = pickGround(this.cam, s.terrain, sx, sy, this.width, this.height);
    if (!g) return null;
    for (const sq of squads) {
      if (!this.seen(sq)) continue;
      const p = this.posOf(sq);
      const dx = g.x - p.x;
      const dz = g.z - p.z;
      const f = dx * Math.sin(sq.facing) + dz * Math.cos(sq.facing);
      const r = dx * -Math.cos(sq.facing) + dz * Math.sin(sq.facing);
      if (Math.abs(f) <= sq.depth / 2 + 2 && Math.abs(r) <= sq.width / 2 + 2) {
        const own = sq.team === player;
        const score = Math.hypot(dx, dz) + ((prefer === 'own') === own ? 0 : 1000);
        if (score < bestScore) {
          bestScore = score;
          best = sq.id;
        }
      }
    }
    return best;
  }

  private updateHover(): void {
    const hs = this.hoverScreen;
    const prev = this.hoverSquad;
    this.hoverSquad =
      hs && !this.drag && !this.box
        ? this.pickSquad(hs.sx, hs.sy, this.selection.size > 0 ? 'enemy' : 'own')
        : null;
    if (prev !== this.hoverSquad) this.hideWorldTip();
  }

  private leftClick(sx: number, sy: number, shift: boolean): void {
    const s = this.session;
    const player = s.playerTeam;
    if (player === null) return;
    if (this.pending) {
      const mode = this.pending;
      this.pending = null;
      if (mode === 'attack') {
        const target = this.pickSquad(sx, sy, 'enemy');
        if (target === null || s.squad(target).team === player)
          return this.toast.show('공격할 적 부대를 누르세요');
        return this.issue(
          buildSquadCommand(player, this.selection.ids, { kind: 'attack', target }),
        );
      }
      const g = pickGround(this.cam, s.terrain, sx, sy, this.width, this.height);
      if (g) this.commandMove(g.x, g.z, null);
      return;
    }
    const id = this.pickSquad(sx, sy, 'own');
    const own = id !== null && s.squad(id).team === player;
    this.selection.click(own ? id : null, shift);
  }

  private boxSelect(b: { x0: number; y0: number; x1: number; y1: number }, shift: boolean): void {
    const s = this.session;
    const player = s.playerTeam;
    const pts = [];
    for (const sq of s.squads()) {
      if (sq.team !== player || sq.state === 'destroyed') continue;
      const p = this.screen.get(sq.id);
      if (p?.visible) pts.push({ id: sq.id, sx: p.sx, sy: p.sy });
    }
    this.selection.box(idsInScreenRect(pts, b), shift);
  }

  private rightPress(sx: number, sy: number): void {
    this.pending = null;
    if (!this.requireSelection()) {
      this.input.cancelDrags();
      return;
    }
    const g = pickGround(this.cam, this.session.terrain, sx, sy, this.width, this.height);
    if (!g) return;
    this.drag = { x0: g.x, z0: g.z, x1: g.x, z1: g.z, dragged: false };
    this.slotsAt = { x: Infinity, z: Infinity, w: 0 };
    this.lastPathAt = 0;
    this.paths.clear();
    this.hideWorldTip();
  }

  private rightDrag(sx: number, sy: number): void {
    if (!this.drag) return;
    const g = pickGround(this.cam, this.session.terrain, sx, sy, this.width, this.height);
    if (!g) return;
    this.drag.x1 = g.x;
    this.drag.z1 = g.z;
    this.drag.dragged = Math.hypot(g.x - this.drag.x0, g.z - this.drag.z0) > 0;
  }

  private rightRelease(sx: number, sy: number, dragged: boolean): void {
    const drag = this.drag;
    this.drag = null;
    this.label.hidden = true;
    if (!drag) return;
    const s = this.session;
    const player = s.playerTeam;
    if (player === null) return;
    if (!dragged && s.phase === 'battle') {
      const target = this.pickSquad(sx, sy, 'enemy');
      if (target !== null && s.squad(target).team !== player) {
        return this.issue(
          buildSquadCommand(player, this.selection.ids, { kind: 'attack', target }),
        );
      }
    }
    this.commandMove(drag.x1, drag.z1, dragged ? this.dragLine(drag) : null);
  }

  private dragLine(d: RightDrag): DragLine {
    return { x0: d.x0, z0: d.z0, x1: d.x1, z1: d.z1 };
  }

  private commandMove(x: number, z: number, line: DragLine | null): void {
    const s = this.session;
    const player = s.playerTeam;
    if (player === null || !this.requireSelection()) return;
    const ids = this.selection.ids;
    if (s.phase === 'deployment') {
      const f = lineFormation(line);
      const slots = f
        ? s.planMoveSlots(ids, f.x, f.z, f.facing, f.width)
        : s.planMoveSlots(ids, x, z);
      // 클릭 배치는 정면을 유지한다.
      const keep = f
        ? slots
        : slots.map((slot) => ({ ...slot, facing: s.squad(slot.squadId).facing }));
      let failed = 0;
      for (const cmd of buildDeployCommands(player, keep, f !== null)) {
        if (s.issue(cmd) !== 'ok') failed++;
      }
      if (failed > 0) this.toast.show(`${failed}개 부대는 ${RESULT_TEXT.invalidPlacement}`);
      return;
    }
    if (s.phase !== 'battle') return;
    this.issue(buildMoveCommand(player, ids, { x, z }, line));
  }

  private pressCommand(id: CommandButtonId): void {
    if (!this.requireSelection()) return;
    const s = this.session;
    const player = s.playerTeam!;
    const ids = this.selection.ids;
    switch (id) {
      case 'move':
      case 'attack':
        if (s.phase !== 'battle' && id === 'attack') return this.toast.show(RESULT_TEXT.wrongPhase);
        this.pending = this.pending === id ? null : id;
        if (this.pending)
          this.toast.show(
            id === 'move'
              ? '이동할 곳을 누르세요 (Esc 취소)'
              : '공격할 적 부대를 누르세요 (Esc 취소)',
          );
        return;
      case 'charge':
        return this.issue(buildSquadCommand(player, ids, { kind: 'charge', target: null }));
      case 'advance':
      case 'hold':
        return this.issue(buildSquadCommand(player, ids, { kind: id }));
      case 'line':
      case 'column':
      case 'loose':
        return this.setFormation(id);
    }
  }

  private setFormation(formation: 'line' | 'column' | 'loose'): void {
    const s = this.session;
    const player = s.playerTeam;
    if (player === null || !this.requireSelection()) return;
    if (s.phase === 'deployment') {
      for (const sq of this.ownSelected()) {
        s.issue({
          kind: 'deploy',
          team: player,
          squad: sq.id,
          x: sq.x,
          z: sq.z,
          facing: sq.facing,
          formation,
        });
      }
      return;
    }
    this.issue(buildSquadCommand(player, this.selection.ids, { kind: 'formation', formation }));
  }

  private focusSquads(ids: readonly number[]): void {
    const squads = this.session.squads();
    const list = ids.map((id) => squads[id]).filter(Boolean);
    if (list.length === 0) return;
    const x = list.reduce((n, s) => n + s.x, 0) / list.length;
    const z = list.reduce((n, s) => n + s.z, 0) / list.length;
    this.camera.focusOn(x, z, Math.min(this.camera.distance, 260));
  }

  /** 배속 변경. 막힌 배속이면 바꾸지 않고 이유를 띄운다(D-016). */
  private setSpeed(speed: GameSpeed): void {
    const s = this.session;
    if (s.phase !== 'battle') return;
    if (speed > s.maxSpeed) {
      this.toast.show(
        `${speed}배속 사용 불가 — ${s.speedLimitReason ?? '이 기기에서는 막혀 있습니다'}`,
      );
      return;
    }
    s.setSpeed(speed);
  }

  private togglePause(): void {
    const s = this.session;
    if (s.phase === 'battle') s.setPaused(!s.paused);
  }

  private openMenu(): void {
    const s = this.session;
    this.resumeAfterMenu = s.phase === 'battle' && !s.paused;
    if (s.phase === 'battle') s.setPaused(true);
    this.cancelGesture();
    const resume = () => {
      this.modal.close();
      if (this.resumeAfterMenu) s.setPaused(false);
    };
    this.modal.open(
      'menu',
      pauseMenuSheet({
        inBattle: s.phase === 'battle',
        resume,
        help: () =>
          this.modal.open(
            'help',
            helpSheet(() => this.openMenu()),
          ),
        surrender: () => {
          this.modal.close();
          s.surrender();
        },
        briefing: () => {
          this.modal.close();
          s.backToBriefing();
        },
      }),
    );
  }

  private cancelGesture(): void {
    this.pending = null;
    this.drag = null;
    this.box = null;
    this.label.hidden = true;
    this.input.cancelDrags();
  }

  private key(action: KeyAction, e: KeyboardEvent): boolean {
    const s = this.session;
    const player = s.playerTeam;
    if (action.kind === 'cancel') {
      if (this.modal.isOpen) {
        if (this.modal.name === 'menu') {
          this.modal.close();
          if (this.resumeAfterMenu) s.setPaused(false);
        } else if (this.modal.name === 'help') this.openMenu();
        return true;
      }
      if (this.pending || this.drag || this.box) {
        this.cancelGesture();
        return true;
      }
      if (s.phase === 'battle' || s.phase === 'deployment') this.openMenu();
      return true;
    }
    if (this.modal.isOpen) return false;
    switch (action.kind) {
      case 'togglePause':
        this.togglePause();
        return true;
      case 'speedUp':
      case 'speedDown':
        this.setSpeed(stepSpeed(s.speed, action.kind === 'speedUp' ? 1 : -1));
        return true;
      case 'toggleSlopeOverlay':
        this.slopeOn = !this.slopeOn;
        return true;
      case 'toggleRangeOverlay':
        this.rangeOn = !this.rangeOn;
        return true;
      case 'toggleTacticalMap':
        this.camera.toggleTacticalMap();
        return true;
    }
    if (player === null) return false;
    switch (action.kind) {
      case 'selectAll':
        this.selection.set(
          s
            .squads()
            .filter((sq) => sq.team === player && sq.state !== 'destroyed')
            .map((sq) => sq.id),
        );
        return true;
      case 'saveGroup':
        this.selection.saveGroup(action.group);
        this.toast.show(
          this.selection.size > 0
            ? `그룹 ${action.group} 저장 (${this.selection.size}개 부대)`
            : `그룹 ${action.group} 비움`,
        );
        return true;
      case 'recallGroup': {
        const r = this.selection.recallGroup(action.group, action.additive, e.timeStamp);
        if (!r.found)
          this.toast.show(
            `그룹 ${action.group}이 비어 있습니다 — Ctrl(또는 Alt)+${action.group}로 저장`,
          );
        else if (r.focus) this.focusSquads(this.selection.group(action.group));
        return true;
      }
      case 'charge': {
        if (!this.requireSelection()) return true;
        const hs = this.hoverScreen;
        const target = hs ? this.pickSquad(hs.sx, hs.sy, 'enemy') : null;
        const enemy = target !== null && s.squad(target).team !== player ? target : null;
        this.issue(
          buildSquadCommand(player, this.selection.ids, { kind: 'charge', target: enemy }),
        );
        return true;
      }
      case 'advance':
      case 'hold':
        if (this.requireSelection())
          this.issue(buildSquadCommand(player, this.selection.ids, { kind: action.kind }));
        return true;
      case 'formation':
        this.setFormation(action.formation);
        return true;
    }
    return false;
  }
}
