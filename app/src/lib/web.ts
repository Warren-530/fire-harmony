// The browser's copy of the published files, cut into small pieces (data/web/, built by fireharmony/webfiles.py).
// GitHub Pages compresses .parquet and .json on the fly and then answers byte ranges on the compressed bytes, so a
// browser cannot read part of a file there: every read is a whole file. Small files keep that cheap, and named
// places need no database at all (one JSON file each).
import { dataUrl } from './config';
import { englishNames, withEnglishName } from './names';

/** File name of a place id: the same rule as key() in fireharmony/webfiles.py. */
export const webKey = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '_');

const cache = new Map<string, Promise<unknown>>();

type PlaceRows = { rows?: { kind: string; id: string; name: string | null }[] };

/** Files with place names, put in English once as they load (lib/names.ts): every reader sees the same names. */
const IN_ENGLISH: Record<string, (data: unknown) => unknown> = {
  'places.json': (d) => {
    const f = d as PlaceRows;
    if (Array.isArray(f?.rows)) f.rows = f.rows.map(withEnglishName);
    return f;
  },
  'eda.json': englishNames,
};

async function fetchWeb<T>(path: string): Promise<T | null> {
  const r = await fetch(dataUrl(`web/${path}`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`web/${path}: HTTP ${r.status}`);
  const data = (await r.json()) as unknown;
  const fix = IN_ENGLISH[path];
  return (fix ? fix(data) : data) as T;
}

/** A JSON file under web/, kept for the session. A missing file (HTTP 404) gives null: for example a place without fire. */
export function webJson<T>(path: string): Promise<T | null> {
  let p = cache.get(path) as Promise<T | null> | undefined;
  if (!p) {
    p = fetchWeb<T>(path);
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

const early = new Map<string, Promise<unknown>>();

/** Start reading a JSON file under web/ now, for one later webTake: the big files of the first view, at boot. */
export function webPrefetch(path: string): void {
  if (early.has(path)) return;
  const p = fetchWeb(path);
  p.catch(() => early.delete(path));
  early.set(path, p);
}

/** A JSON file under web/ that is not kept (big files read once): the copy webPrefetch started, else a fresh read. */
export function webTake<T>(path: string): Promise<T | null> {
  const p = early.get(path) as Promise<T | null> | undefined;
  if (p) { early.delete(path); return p; }
  return fetchWeb<T>(path);
}

const earlyData = new Map<string, Promise<unknown>>();

/** Start reading a top level JSON file (meta.json, areas.json) at boot, for one later takeData. */
export function prefetchData(path: string): void {
  if (earlyData.has(path)) return;
  const p = fetch(dataUrl(path)).then(async (r) => {
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json() as Promise<unknown>;
  });
  p.catch(() => earlyData.delete(path));
  earlyData.set(path, p);
}

/** The read prefetchData started for this file (handed over once), or null. */
export function takeData<T>(path: string): Promise<T> | null {
  const p = earlyData.get(path) as Promise<T> | undefined;
  if (!p) return null;
  earlyData.delete(path);
  return p;
}

/** The first view's files, started at boot before the Explorer's code has arrived: the place in the link (or the
 * world) with its drivers and, for a country or a state, the trend test of all places (its verdict); the map's
 * hexagons; the trend map when the link opens on it (mode=trend) or on a hexagon (its verdict); and the year of the
 * month shown (or the latest year). */
export function prefetchFirstView(hash: string): void {
  const q = new URLSearchParams(hash.split('?')[1] ?? '');
  prefetchData('meta.json');
  prefetchData('areas.json');
  const area = q.get('area') ?? 'world:WORLD';
  const at = area.indexOf(':');
  const kind = (at < 0 ? area : area.slice(0, at)).trim().toLowerCase();
  const raw = at < 0 ? '' : area.slice(at + 1).trim();
  const id = kind === 'country' ? raw.toUpperCase() : raw;     // as the link is read (lib/stats.ts parseLinkArea)
  if (['world', 'continent', 'country', 'state'].includes(kind) && id) {
    void seriesFile(kind, id).catch(() => undefined);
    void driversFile(kind, id).catch(() => undefined);
    if (kind === 'country' || kind === 'state') void webJson('places.json').catch(() => undefined);
  }
  // the trend map of a level (read once by explorer/mapData.ts loadTrend): level 3 for the trend view, the level of
  // a hexagon in the link (its second digit is its resolution) for that hexagon's verdict
  const levels = new Set<number>();
  if (q.get('mode') === 'trend') levels.add(3);
  if (kind === 'hex' && /^8[0-9a-f]{14}$/i.test(raw)) {
    const res = parseInt(raw[1], 16);
    if (res === 3 || res === 4) levels.add(res);
  }
  for (const level of levels) webPrefetch(`trend_l${level}.json`);
  void webJson('universe_l3.json').catch(() => undefined);
  const month = Number(q.get('month'));
  void webJson<WebIndex>('index.json').then((ix) => {
    if (!ix) return;
    const yr = month > 190000 ? String(Math.floor(month / 100)) : [...ix.map_l3].sort().pop();
    if (yr && ix.map_l3.includes(yr)) webPrefetch(`map_l3/${yr}.json`);
  }).catch(() => undefined);
}

/** Which pieces exist: the years and quarters of the maps, and the level 1 regions of the hexagon files. */
export interface WebIndex {
  version: number;
  map_l3: string[];      // '2000' ... '2026'
  map_l4: string[];      // '2000q4' ... '2026q4'
  cell_l3: string[];     // level 1 regions (H3 index text)
  cell_l4: string[];
  cells: string[];
  drivers?: string[];    // places with a drivers file, as 'kind/key' (layout version 3)
}

type IndexSets = Record<Exclude<keyof WebIndex, 'version'> | 'hasDriverList', Set<string>>;
let indexSets: Promise<IndexSets> | null = null;

/** The index as sets, loaded once. */
export function webIndex(): Promise<IndexSets> {
  if (!indexSets) {
    indexSets = webJson<WebIndex>('index.json').then((ix) => {
      if (!ix) throw new Error('web/index.json is missing');
      return { map_l3: new Set(ix.map_l3), map_l4: new Set(ix.map_l4), cell_l3: new Set(ix.cell_l3), cell_l4: new Set(ix.cell_l4), cells: new Set(ix.cells),
        drivers: new Set(ix.drivers ?? []), hasDriverList: new Set(ix.drivers ? ['yes'] : []) };
    });
    indexSets.catch(() => { indexSets = null; });
  }
  return indexSets;
}

/** One named place: its monthly rows as columns, and its outlook rows. */
export interface SeriesFile {
  kind: string; id: string;
  ym: number[]; h: (number | null)[]; modis: (number | null)[];
  t: number[]; a: number[]; s: number[]; n: number[]; j: number[]; src: number[];
  outlook: Record<string, number | null>[];
}

/** The drivers of one named place: the model and its months as columns. */
export interface DriversFile {
  model: Record<string, number | string | boolean | null>;
  months: Record<string, (number | boolean | null)[]>;
}

/** The outline hexagons of one named place (at most 2,500, level 5 or coarser) and its level 1 regions. */
export interface OutlineFile { cells: string[]; regions: string[] }

export const seriesFile = (kind: string, id: string) => webJson<SeriesFile>(`series/${kind}/${webKey(id)}.json`);
/** The drivers of a place, or null when it has none (too little fire for a model). The index lists the places that
 * have a file, so places without one cost no request (and no 404 in the console). */
export async function driversFile(kind: string, id: string): Promise<DriversFile | null> {
  const ix = await webIndex().catch(() => null);
  if (ix && ix.hasDriverList.size && !ix.drivers.has(`${kind}/${webKey(id)}`)) return null;
  return webJson<DriversFile>(`drivers/${kind}/${webKey(id)}.json`);
}
export const outlineFile = (kind: string, id: string) => webJson<OutlineFile>(`outline/${kind}/${webKey(id)}.json`);

/** Rows from a file of columns: { a: [1, 2], b: [3, 4] } gives [{ a: 1, b: 3 }, { a: 2, b: 4 }]. */
export function rowsOf<T>(cols: Record<string, readonly unknown[]>, names: readonly string[] = Object.keys(cols)): T[] {
  const n = names.length ? (cols[names[0]]?.length ?? 0) : 0;
  const out: T[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o: Record<string, unknown> = {};
    for (const k of names) o[k] = cols[k]?.[i] ?? null;
    out[i] = o as T;
  }
  return out;
}
