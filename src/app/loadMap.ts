import { parseMap, type GameMap } from '../sim/map/gameMap';

/**
 * 맵 파일(public/maps/<id>/)을 내려받아 GameMap으로 만든다(docs/INTERFACES.md §1.4, A의 예시 그대로).
 * 바이트 해석은 sim의 순수 함수 parseMap(A)이 한다.
 */
export async function loadMap(id: string): Promise<GameMap> {
  const base = `${import.meta.env.BASE_URL}maps/${id}/`;
  const get = async (f: string) => {
    const r = await fetch(base + f);
    if (!r.ok) throw new Error(`${base}${f}: HTTP ${r.status}`);
    return r;
  };
  const [meta, h, t] = await Promise.all([
    get('map.json').then((r) => r.json()),
    get('height.u16').then((r) => r.arrayBuffer()),
    get('types.u8').then((r) => r.arrayBuffer()),
  ]);
  return parseMap(meta, h, t);
}
