/**
 * 갈대 여울 맵 파일 생성기. src/sim/map/reedFord.ts 의 결과를 ARCHITECTURE §11.1 형식으로 쓴다.
 *
 *   node --experimental-transform-types --import ./tools/map/register.mjs tools/map/generate.ts
 *
 * 출력: public/maps/reed_ford/{map.json, height.u16, types.u8}, tools/map/reed_ford_preview.png(확인용, 북쪽 위·서쪽 왼쪽)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { encodeMap, type GameMap } from '../../src/sim/map/gameMap';
import { createReedFord } from '../../src/sim/map/reedFord';
import { TerrainType } from '../../src/sim/terrain';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

function main(): void {
  const start = performance.now();
  const map = createReedFord();
  const genMs = performance.now() - start;

  const { meta, height, types } = encodeMap(map);
  const outDir = join(root, 'public', 'maps', meta.id);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'map.json'), JSON.stringify(meta, null, 2) + '\n');
  writeFileSync(join(outDir, 'height.u16'), height);
  writeFileSync(join(outDir, 'types.u8'), types);
  writeFileSync(join(here, `${meta.id}_preview.png`), previewPng(map));

  console.log(`${meta.id}: 생성 ${genMs.toFixed(0)}ms → ${outDir}`);
  console.log(`  height.u16 ${height.length}B, types.u8 ${types.length}B`);
  console.log(`  지형 종류 칸 수: ${typeHistogram(map)}`);
}

function typeHistogram(m: GameMap): string {
  const names = ['grass', 'forest', 'rock', 'sand', 'water', 'ford', 'bridge'];
  const count = new Array<number>(names.length).fill(0);
  for (const t of m.terrain.types) count[t]++;
  return names.map((n, i) => `${n} ${count[i]}`).join(', ');
}

// ------------------------------------------------------------------ 미리보기 PNG (북쪽이 위)

const TYPE_RGB: Record<number, [number, number, number]> = {
  [TerrainType.Grass]: [111, 143, 62],
  [TerrainType.Forest]: [50, 80, 55],
  [TerrainType.Rock]: [120, 128, 135],
  [TerrainType.Sand]: [194, 176, 122],
  [TerrainType.Water]: [49, 88, 105],
  [TerrainType.Ford]: [120, 154, 145],
  [TerrainType.Bridge]: [140, 100, 60],
};
const IMPASSABLE_SLOPE_TINT: [number, number, number] = [200, 60, 50];

function previewPng(m: GameMap): Uint8Array {
  const t = m.terrain;
  const w = t.cellsX;
  const h = t.cellsZ;
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let r = 0; r < h; r++) {
    const iz = h - 1 - r;
    raw[r * (1 + w * 3)] = 0; // PNG 필터 없음
    for (let col = 0; col < w; col++) {
      // D-012: +x = 서쪽. 그림의 왼쪽이 서쪽이 되도록 x 큰 쪽부터 그린다.
      const ix = w - 1 - col;
      const x = (ix + 0.5) * t.cellSize;
      const z = (iz + 0.5) * t.cellSize;
      let [cr, cg, cb] = TYPE_RGB[t.types[iz * w + ix]];
      if (!t.cellPassable(ix, iz) && t.types[iz * w + ix] !== TerrainType.Water) {
        [cr, cg, cb] = mix([cr, cg, cb], IMPASSABLE_SLOPE_TINT, 0.35);
      }
      // 북서쪽(+x, +z) 광원 음영 + 높이 밝기
      const shade = 0.75 + 0.6 * (t.heightAt(x + 2, z + 2) - t.heightAt(x - 2, z - 2)) * 0.25;
      const lift = 0.85 + (t.heightAt(x, z) / m.meta.heightMax) * 0.5;
      const k = Math.max(0.3, Math.min(1.5, shade * lift));
      const o = r * (1 + w * 3) + 1 + col * 3;
      raw[o] = Math.min(255, cr * k);
      raw[o + 1] = Math.min(255, cg * k);
      raw[o + 2] = Math.min(255, cb * k);
    }
  }
  return encodePng(w, h, raw);
}

function mix(a: number[], b: number[], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function encodePng(w: number, h: number, raw: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8bit RGB
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

main();
