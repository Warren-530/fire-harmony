// Map data for the Explorer, built for playing the months smoothly.
//
// Each level (3: about 12,400 km², 4: about 1,800 km²) has a fixed list of hexagons, the "universe": every
// hexagon with a normal in clim_l<level> (fire in some month of 2001 to 2025), in H3 order. A month is a "frame":
// three arrays aligned with the universe (harmonized, MODIS scale, raw detections; 0 = no fire) plus the few
// hexagons outside the universe that burned that month. Because the list of hexagons never changes, the map only
// updates colours and heights from month to month, and deck.gl can animate them.
//
// Level 3 (the first view) needs no database: its universe and its years come as JSON files built for it
// (web/universe_l3.json, web/map_l3/<yyyy>.json, see fireharmony/webfiles.py), so the world map shows before the
// 8 MB DuckDB engine has even loaded. Level 4 frames are read with one DuckDB query per quarter, straight from the
// Arrow columns (no row objects). Frames are kept in a small cache per level.
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { cellToChildren, cellToParent } from 'h3-js';
import { getDb, registerData, sqlText } from '../../lib/db';
import { webIndex, webJson, webTake } from '../../lib/web';
import { englishCountry, englishName } from '../../lib/names';
import { addMonths } from '../../lib/stats';
import type { LogScale } from '../../lib/stats';
import type { Scale } from '../../lib/types';
import { alignRows, alignedClasses, trendCounts, type TrendCounts, type TrendFile } from './trend';

export type Level = 3 | 4;

export interface Universe {
  level: Level;
  h3: string[];                   // index -> hexagon
  normals: Float32Array[];        // 12 arrays (January first): normal (median of 2001 to 2025) of each hexagon, 0 if none
}

export interface ExtraHex { h3: string; h: number; modis: number; raw: number }

export interface Frame {
  level: Level;
  ym: number;                     // yyyymm
  h: Float32Array; modis: Float32Array; raw: Float32Array;   // aligned with the universe
  extras: ExtraHex[];             // hexagons outside the universe with fire this month
}

/**
 * Fixed colour scales of the map, so months compare with each other while the player runs: log steps from about
 * the 2nd to the 98th percentile of all hexagon months with fire (data version 1.0), in round numbers.
 */
export const MAP_COUNT_SCALES: Record<Level, Record<Scale, LogScale>> = {
  3: { harmonized: { lo: 1, hi: 2000 }, modis: { lo: 1, hi: 400 }, raw: { lo: 1, hi: 3000 } },
  4: { harmonized: { lo: 1, hi: 400 }, modis: { lo: 1, hi: 100 }, raw: { lo: 1, hi: 800 } },
};
/** Values at which the 3D hexagons reach their full height (about the 99.5th percentile), and that height in metres. */
export const MAP_HEIGHT: Record<Level, { cap: Record<Scale, number>; metres: number }> = {
  3: { cap: { harmonized: 5000, modis: 1000, raw: 10000 }, metres: 650_000 },
  4: { cap: { harmonized: 1000, modis: 200, raw: 2000 }, metres: 200_000 },
};
/** The map against normal: log ratio clipped at 4 times and a quarter of normal. */
export const MAP_RATIO_LIMIT = 4;

const MAX_FRAMES: Record<Level, number> = { 3: 120, 4: 20 };

let connPromise: Promise<AsyncDuckDBConnection> | null = null;
/** A connection of our own: the universe tables are temporary tables, which live in one connection. */
function conn(): Promise<AsyncDuckDBConnection> {
  if (!connPromise) {
    connPromise = getDb().then((db) => db.connect());
    connPromise.catch(() => { connPromise = null; });
  }
  return connPromise;
}

// Queries on our connection run one after the other, so a prefetch never races the table it needs.
let chain: Promise<unknown> = Promise.resolve();
function run<T>(job: (c: AsyncDuckDBConnection) => Promise<T>): Promise<T> {
  const next = chain.then(async () => job(await conn()));
  chain = next.catch(() => undefined);
  return next;
}

interface Column { length: number; get(i: number): unknown; toArray(): ArrayLike<unknown> }
interface ArrowTable { numRows: number; getChild(name: string): Column | null }

function floats(t: ArrowTable, name: string): Float32Array {
  const col = t.getChild(name);
  if (!col) throw new Error(`column ${name} is missing`);
  const a = col.toArray();
  return a instanceof Float32Array ? a : Float32Array.from(a as ArrayLike<number>);
}
function ints(t: ArrowTable, name: string): Int32Array {
  const col = t.getChild(name);
  if (!col) throw new Error(`column ${name} is missing`);
  const a = col.toArray();
  return a instanceof Int32Array ? a : Int32Array.from(a as ArrayLike<number>);
}

/** web/universe_l3.json: the hexagons of the level in H3 order and their 12 normals (January first). */
interface UniverseFile { version: number; level: number; h3: string[]; normals: number[][] }
/** web/map_l3/<yyyy>.json: the hexagon months with fire as columns; i points into the universe, x holds the others. */
interface BlockFile {
  version: number; level: number; part: string;
  i: number[]; m: number[]; h: number[]; d: number[]; r: number[];
  x: { h3: string[]; m: number[]; h: number[]; d: number[]; r: number[] };
}

const universes = new Map<Level, Promise<Universe>>();
const readyUniverses = new Map<Level, Universe>();
const MONTH_COLS = Array.from({ length: 12 }, (_, i) => i + 1);

/** The hexagons of a level and their normals (loaded once). */
export function loadUniverse(level: Level): Promise<Universe> {
  let p = universes.get(level);
  if (!p && level === 3) {
    p = webJson<UniverseFile>('universe_l3.json').then((f) => {
      if (!f) throw new Error('web/universe_l3.json is missing');
      const u: Universe = { level, h3: f.h3, normals: f.normals.map((a) => Float32Array.from(a)) };
      readyUniverses.set(level, u);
      return u;
    });
    p.catch(() => universes.delete(level));
    universes.set(level, p);
  }
  if (!p) {
    p = (async () => {
      const file = `clim_l${level}.parquet`;
      await registerData(file);
      const months = MONTH_COLS.map((m) => `COALESCE(max(median) FILTER (WHERE mo = ${m}), 0)::FLOAT AS m${m}`).join(', ');
      const t = await run(async (c) => {
        await c.query(`CREATE OR REPLACE TEMP TABLE fh_u${level} AS
          SELECT (row_number() OVER (ORDER BY h3) - 1)::INTEGER AS i, h3, ${months}
          FROM '${file}' GROUP BY h3`);
        return c.query(`SELECT h3, ${MONTH_COLS.map((m) => `m${m}`).join(', ')} FROM fh_u${level} ORDER BY i`) as unknown as Promise<ArrowTable>;
      });
      const col = t.getChild('h3');
      if (!col) throw new Error('h3 is missing');
      const h3: string[] = new Array<string>(t.numRows);
      for (let i = 0; i < t.numRows; i++) h3[i] = String(col.get(i));
      const u: Universe = { level, h3, normals: MONTH_COLS.map((m) => floats(t, `m${m}`)) };
      readyUniverses.set(level, u);
      return u;
    })();
    p.catch(() => universes.delete(level));
    universes.set(level, p);
  }
  return p;
}

/** The universe if it is already loaded (no waiting). */
export function peekUniverse(level: Level): Universe | null {
  return readyUniverses.get(level) ?? null;
}

// ------------------------------------------------------------------------------------------------ the trend map

/** The trend file of a level lined up with its universe: for each map hexagon its row in the file (or -1) and class. */
export interface TrendLayer {
  level: Level;
  file: TrendFile;
  rows: Int32Array;               // universe index -> row in the file, -1 when the file has none
  cls: Int8Array;                 // universe index -> class (trend.ts: NOT_TESTED, 0, -4..-1, 1..4, NOT_IN_FILE)
  counts: TrendCounts;            // the counts of the file
}

const trends = new Map<Level, Promise<TrendLayer>>();
const readyTrends = new Map<Level, TrendLayer>();

/** The trend map of a level (web/trend_l3.json, 0.5 MB, or trend_l4.json, 2.9 MB), loaded once. */
export function loadTrend(level: Level): Promise<TrendLayer> {
  let p = trends.get(level);
  if (!p) {
    p = Promise.all([loadUniverse(level), webTake<TrendFile>(`trend_l${level}.json`)]).then(([u, file]) => {
      if (!file) throw new Error(`web/trend_l${level}.json is missing`);
      const rows = alignRows(u.h3, file.h3);
      const layer: TrendLayer = { level, file, rows, cls: alignedClasses(rows, file), counts: trendCounts(file) };
      readyTrends.set(level, layer);
      return layer;
    });
    p.catch(() => trends.delete(level));
    trends.set(level, p);
  }
  return p;
}

/** The trend map if it is already loaded (no waiting). */
export function peekTrend(level: Level): TrendLayer | null {
  return readyTrends.get(level) ?? null;
}

const frames = new Map<string, Promise<Frame>>();
const ready = new Map<string, Frame>();
const fkey = (level: Level, ym: number) => `${level}:${ym}`;

function remember(key: string, level: Level): void {
  // least recently used first: re-insert on use, drop the oldest beyond the limit
  const p = frames.get(key);
  if (p) { frames.delete(key); frames.set(key, p); }
  const keys = [...frames.keys()].filter((k) => k.startsWith(`${level}:`));
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_FRAMES[level]))) { frames.delete(k); ready.delete(k); }
}

/** Load the months first..last (yyyymm, same year) of one level in one query. */
function loadBlock(level: Level, first: number, last: number): void {
  const want: number[] = [];
  for (let ym = first; ym <= last; ym = addMonths(ym, 1)) if (!frames.has(fkey(level, ym))) want.push(ym);
  if (!want.length) return;
  const lo = want[0], hi = want[want.length - 1];
  const yr = Math.floor(lo / 100);
  const block = (async (): Promise<Map<number, Frame>> => {
    const u = await loadUniverse(level);
    // one small file per block: a year at level 3, a quarter at level 4 (web/map_l3/2026.parquet, web/map_l4/2026q4.parquet)
    const part = level === 3 ? String(yr) : `${yr}q${Math.floor(((lo % 100) - 1) / 3) + 1}`;
    if (!(await webIndex())[level === 3 ? 'map_l3' : 'map_l4'].has(part)) {
      const empty = new Map<number, Frame>();
      for (const ym of want) empty.set(ym, { level, ym, h: new Float32Array(u.h3.length), modis: new Float32Array(u.h3.length), raw: new Float32Array(u.h3.length), extras: [] });
      return empty;
    }
    if (level === 3) return frameMap(level, want, u.h3.length, await webTake<BlockFile>(`map_l3/${part}.json`));
    const file = `web/map_l${level}/${part}.parquet`;
    await registerData(file);
    const t = await run((c) => c.query(`SELECT COALESCE(u.i, -1)::INTEGER AS i, (m.yr::INTEGER * 100 + m.mo::INTEGER)::INTEGER AS ym,
        COALESCE(m.h, 0)::FLOAT AS h, COALESCE(m.modis, 0)::FLOAT AS modis,
        (COALESCE(m.t, 0) + COALESCE(m.a, 0) + COALESCE(m.s, 0) + COALESCE(m.n, 0) + COALESCE(m.j, 0))::FLOAT AS raw,
        CASE WHEN u.i IS NULL THEN m.h3 END AS extra
      FROM '${file}' m LEFT JOIN fh_u${level} u ON u.h3 = m.h3
      WHERE m.yr = ${yr} AND m.mo BETWEEN ${lo % 100} AND ${hi % 100}`) as unknown as Promise<ArrowTable>);
    const n = u.h3.length;
    const out = new Map<number, Frame>();
    for (const ym of want) {
      out.set(ym, { level, ym, h: new Float32Array(n), modis: new Float32Array(n), raw: new Float32Array(n), extras: [] });
    }
    const idx = ints(t, 'i'), yms = ints(t, 'ym'), h = floats(t, 'h'), modis = floats(t, 'modis'), raw = floats(t, 'raw');
    const extra = t.getChild('extra');
    for (let r = 0; r < t.numRows; r++) {
      const f = out.get(yms[r]);
      if (!f) continue;
      const i = idx[r];
      if (i >= 0) { f.h[i] = h[r]; f.modis[i] = modis[r]; f.raw[i] = raw[r]; }
      else if (h[r] > 0 || raw[r] > 0) f.extras.push({ h3: String(extra?.get(r) ?? ''), h: h[r], modis: modis[r], raw: raw[r] });
    }
    return out;
  })();
  for (const ym of want) {
    const key = fkey(level, ym);
    const p = block.then((m) => {
      const f = m.get(ym);
      if (!f) throw new Error(`no frame for ${ym}`);
      ready.set(key, f);
      return f;
    });
    p.catch(() => { frames.delete(key); ready.delete(key); });
    frames.set(key, p);
  }
  remember(fkey(level, hi), level);
}

/** The frames of the months `want` from a JSON block (a missing file gives empty frames). */
function frameMap(level: Level, want: number[], n: number, f: BlockFile | null): Map<number, Frame> {
  const out = new Map<number, Frame>();
  const byMonth = new Map<number, Frame>();
  for (const ym of want) {
    const fr: Frame = { level, ym, h: new Float32Array(n), modis: new Float32Array(n), raw: new Float32Array(n), extras: [] };
    out.set(ym, fr);
    byMonth.set(ym % 100, fr);
  }
  if (!f) return out;
  for (let k = 0; k < f.i.length; k++) {
    const fr = byMonth.get(f.m[k]);
    if (!fr) continue;
    const i = f.i[k];
    fr.h[i] = f.h[k]; fr.modis[i] = f.d[k]; fr.raw[i] = f.r[k];
  }
  const x = f.x;
  for (let k = 0; k < x.h3.length; k++) {
    const fr = byMonth.get(x.m[k]);
    if (fr && (x.h[k] > 0 || x.r[k] > 0)) fr.extras.push({ h3: x.h3[k], h: x.h[k], modis: x.d[k], raw: x.r[k] });
  }
  return out;
}

/** The block of months that holds `ym`: the whole year at level 3, the quarter at level 4. */
function blockOf(level: Level, ym: number): [number, number] {
  const yr = Math.floor(ym / 100), mo = ym % 100;
  if (level === 3) return [yr * 100 + 1, yr * 100 + 12];
  const q0 = Math.floor((mo - 1) / 3) * 3 + 1;
  return [yr * 100 + q0, yr * 100 + q0 + 2];
}

/** One month of the map. With `single`, only that month is read (fast for a first view or a hover preview). */
export function loadFrame(level: Level, ym: number, single = false): Promise<Frame> {
  const key = fkey(level, ym);
  if (!frames.has(key)) {
    // a level 3 year is one small file: reading one month costs as much as the whole year, so take the year
    if (single && level === 4) loadBlock(level, ym, ym);
    else { const [a, b] = blockOf(level, ym); loadBlock(level, a, b); }
  }
  remember(key, level);
  return frames.get(key) as Promise<Frame>;
}

/** The month if it is already loaded (no waiting). */
export function peekFrame(level: Level, ym: number): Frame | null {
  return ready.get(fkey(level, ym)) ?? null;
}

/** Start loading the months after `ym` (for the player), within the known months. */
export function prefetchAfter(level: Level, ym: number, lastKnown: number, months = 3): void {
  for (let k = 1; k <= months; k++) {
    const next = addMonths(ym, k);
    if (next > lastKnown) break;
    if (!frames.has(fkey(level, next))) {
      const [a, b] = blockOf(level, next);
      loadBlock(level, a, Math.min(b, lastKnown));
    }
  }
}

// ------------------------------------------------------------------------------------------------ place names

const places = new Map<string, Promise<string | null>>();

/** "State, Country" from the two names, in English as everywhere else in the app (lib/names.ts: "Kalimantan Tengah,
 *  Indonesia" → "Central Kalimantan, Indonesia", "Dem. Rep. Congo" → "DR Congo"), without repeating a name (small
 *  countries have one state of the same name). */
function placeText(state: unknown, country: unknown, code: unknown): string | null {
  const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);
  const s = text(state), c = text(country), id = text(code);
  if (!s) return c ? englishCountry(c) : null;
  const full = id ? englishName('state', id, c ? `${s}, ${c}` : s) : c ? `${s}, ${englishCountry(c)}` : s;
  const at = full.lastIndexOf(', ');
  return at > 0 && full.slice(0, at) === full.slice(at + 2) ? full.slice(0, at) : full;
}

/**
 * The state and country that cover most of a map hexagon (level 3 or 4), from its level 5 children in the cells file
 * of its level 1 region (web/cells/<region>.parquet, about 11 KB). Null at sea. Cached.
 */
/** The cells file of the level 1 region of a hexagon, registered; null when the region has none (open sea). */
async function cellsFile(h3: string): Promise<string | null> {
  const region = cellToParent(h3, 1);
  if (!(await webIndex()).cells.has(region)) return null;
  const file = `web/cells/${region}.parquet`;
  await registerData(file);
  return file;
}

export function placeOfHex(h3: string): Promise<string | null> {
  const key = `hex:${h3}`;
  let p = places.get(key);
  if (!p) {
    p = (async () => {
      const kids = cellToChildren(h3, 5).sort();
      if (!kids.length) return null;
      const file = await cellsFile(h3);
      if (!file) return null;
      const t = await run((c) => c.query(`SELECT state, country, state_code, count(*)::INTEGER AS n FROM '${file}'
        WHERE h3 BETWEEN ${sqlText(kids[0])} AND ${sqlText(kids[kids.length - 1])}
        GROUP BY state, country, state_code ORDER BY n DESC LIMIT 1`) as unknown as Promise<ArrowTable>);
      if (!t.numRows) return null;
      return placeText(t.getChild('state')?.get(0), t.getChild('country')?.get(0), t.getChild('state_code')?.get(0));
    })();
    p.catch(() => places.delete(key));
    places.set(key, p);
  }
  return p;
}

/**
 * The state and country of a level 5 hexagon (from the cells file of its level 1 region), for the map tooltip. Null at
 * sea or when the hexagon is not in the file. Cached.
 */
export function placeOf(cell5: string): Promise<string | null> {
  let p = places.get(cell5);
  if (!p) {
    p = (async () => {
      const file = await cellsFile(cell5);
      if (!file) return null;
      const t = await run((c) => c.query(`SELECT state, country, state_code FROM '${file}' WHERE h3 = ${sqlText(cell5)} LIMIT 1`) as unknown as Promise<ArrowTable>);
      if (!t.numRows) return null;
      return placeText(t.getChild('state')?.get(0), t.getChild('country')?.get(0), t.getChild('state_code')?.get(0));
    })();
    p.catch(() => places.delete(cell5));
    places.set(cell5, p);
  }
  return p;
}
