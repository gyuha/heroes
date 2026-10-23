import type { TeamId } from '../../sim/api';
import { type Terrain, TerrainType } from '../../sim/terrain';
import type { MapFeatureView } from '../gameView';
import { iconPath2D } from '../icons';
import { COLOR, TEAM_FILL, TEAM_RIM } from '../theme';
import { h } from './dom';

const BG_RES = 256;

/** 지형 종류별 미니맵 색(ART_STYLE_GUIDE 지형 팔레트 기본색). */
const TYPE_RGB: Record<number, [number, number, number]> = {
  [TerrainType.Grass]: [0x78, 0x86, 0x6a],
  [TerrainType.Forest]: [0x3f, 0x5c, 0x4e],
  [TerrainType.Rock]: [0x78, 0x80, 0x87],
  [TerrainType.Sand]: [0xa2, 0x83, 0x62],
  [TerrainType.Water]: [0x42, 0x6f, 0x83],
  [TerrainType.Ford]: [0x78, 0x9a, 0x91],
  [TerrainType.Bridge]: [0x8a, 0x6a, 0x4a],
};

export interface MinimapSquad {
  team: TeamId;
  x: number;
  z: number;
  selected: boolean;
  ghost: boolean;
}

/**
 * 우측 하단 미니맵(GDD §9.2). 북쪽(+z)이 위, 동쪽(−x)이 오른쪽(D-012: +x = 서쪽). 3D 화면을 위에서 본
 * 모양과 같다. 지형은 시작할 때 한 번 그리고(음영 포함), 매 갱신마다
 * 부대(아군 전부, 적은 시야 안만), 깃발, 다리·여울, 카메라 시야 사다리꼴을 덧그린다.
 * 누르거나 끌면 카메라가 그 지점으로 간다.
 */
export class Minimap {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly background: HTMLCanvasElement;
  private dragging = false;

  constructor(
    parent: HTMLElement,
    private readonly terrain: Terrain,
    private readonly onJump: (x: number, z: number) => void,
  ) {
    this.canvas = h('canvas', { attrs: { 'aria-label': '미니맵' } });
    this.root = h('div', { class: 'hud-minimap ui-panel' }, [this.canvas]);
    parent.appendChild(this.root);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다');
    this.ctx = ctx;
    this.background = this.bakeBackground();

    const jump = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width;
      const v = (e.clientY - r.top) / r.height;
      this.onJump((1 - u) * terrain.width, (1 - v) * terrain.depth);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      jump(e);
    });
    this.canvas.addEventListener('pointermove', (e) => this.dragging && jump(e));
    this.canvas.addEventListener('pointerup', () => (this.dragging = false));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  draw(
    squads: readonly MinimapSquad[],
    flag: { x: number; z: number; radius: number },
    features: readonly MapFeatureView[],
    frustum: readonly { x: number; z: number }[],
  ): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    if (this.canvas.width !== size) {
      this.canvas.width = size;
      this.canvas.height = size;
    }
    const ctx = this.ctx;
    const k = size / this.terrain.width;
    const X = (x: number) => size - x * k;
    const Y = (z: number) => size - z * k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.background, 0, 0, size, size);

    // 깃발 구역
    ctx.beginPath();
    ctx.arc(X(flag.x), Y(flag.z), Math.max(3, flag.radius * k), 0, Math.PI * 2);
    ctx.strokeStyle = COLOR.select;
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();

    // 병목 아이콘
    const iconPx = 11 * dpr;
    for (const f of features) {
      ctx.save();
      ctx.translate(X(f.x) - iconPx / 2, Y(f.z) - iconPx / 2);
      ctx.fillStyle = 'rgba(16,21,26,0.8)';
      ctx.fillRect(-1 * dpr, -1 * dpr, iconPx + 2 * dpr, iconPx + 2 * dpr);
      ctx.scale(iconPx / 24, iconPx / 24);
      ctx.strokeStyle = COLOR.text;
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.stroke(iconPath2D(f.kind));
      ctx.restore();
    }

    // 부대: 진영 모양 유지(원/마름모)
    const r = 3.2 * dpr;
    for (const s of squads) {
      const x = X(s.x);
      const y = Y(s.z);
      ctx.beginPath();
      if (s.team === 0) ctx.arc(x, y, r, 0, Math.PI * 2);
      else {
        ctx.moveTo(x, y - r * 1.25);
        ctx.lineTo(x + r * 1.25, y);
        ctx.lineTo(x, y + r * 1.25);
        ctx.lineTo(x - r * 1.25, y);
        ctx.closePath();
      }
      ctx.globalAlpha = s.ghost ? 0.45 : 1;
      ctx.fillStyle = TEAM_FILL[s.team];
      ctx.fill();
      ctx.lineWidth = (s.selected ? 2 : 1) * dpr;
      ctx.strokeStyle = s.selected ? COLOR.select : TEAM_RIM[s.team];
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 북쪽 표시
    ctx.font = `700 ${Math.round(10 * dpr)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = 'rgba(16,21,26,0.85)';
    ctx.strokeText('북 ▲', size / 2, 3 * dpr);
    ctx.fillStyle = COLOR.text;
    ctx.fillText('북 ▲', size / 2, 3 * dpr);

    // 카메라 시야
    if (frustum.length >= 3) {
      ctx.beginPath();
      frustum.forEach((p, i) =>
        i === 0 ? ctx.moveTo(X(p.x), Y(p.z)) : ctx.lineTo(X(p.x), Y(p.z)),
      );
      ctx.closePath();
      ctx.strokeStyle = 'rgba(244,239,226,0.9)';
      ctx.lineWidth = 1.2 * dpr;
      ctx.stroke();
    }
  }

  private bakeBackground(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = BG_RES;
    c.height = BG_RES;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(BG_RES, BG_RES);
    const t = this.terrain;
    const step = t.width / BG_RES;
    for (let py = 0; py < BG_RES; py++) {
      for (let px = 0; px < BG_RES; px++) {
        const x = t.width - (px + 0.5) * step;
        const z = t.depth - (py + 0.5) * step;
        const rgb = TYPE_RGB[t.typeAt(x, z)] ?? [128, 128, 128];
        // 화면 왼쪽 위에서 오는 빛 음영 + 높이 밝기
        const shade =
          (t.heightAt(x + step, z + step) - t.heightAt(x - step, z - step)) / (2 * step);
        const light = Math.max(
          0.55,
          Math.min(1.35, 1 + shade * 1.6 + (t.heightAt(x, z) - 10) * 0.006),
        );
        const i = (py * BG_RES + px) * 4;
        img.data[i] = Math.min(255, rgb[0] * light);
        img.data[i + 1] = Math.min(255, rgb[1] * light);
        img.data[i + 2] = Math.min(255, rgb[2] * light);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
}
