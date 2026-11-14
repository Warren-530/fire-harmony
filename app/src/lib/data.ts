// Data access for the app: the meta file, named places, the monthly series of any area, and the map of one month.
// Everything is answered from the pre-built files by DuckDB in the browser (see CONTRACT.md for the layouts).
import { cellToParent } from 'h3-js';
import { query, registerData, registerJson, sqlText } from './db';
import { dataUrl } from './config';
import { coverCells } from './geo';
import type { DashboardData } from './dashboard-types';
import { driversFile, rowsOf, seriesFile, takeData, webIndex, webJson } from './web';
import { englishNames, withEnglishName } from './names';
import type {
  AreaSelection, DriverModel, DriverMonth, HazeModels, HazeMonth, Meta, MonthlyPoint, NamedArea, OutlookRow, Source,
} from './types';

type Row = { yr: number; mo: number; h: number | null; modis: number | null; t: number; a: number; s: number; n: number;
  j: number; src: number };

const WORLD: NamedArea = { kind: 'world', id: 'WORLD', name: 'World', country_iso3: null, lat: 0, lon: 0, cells: 0, area_km2: 0 };

let metaPromise: Promise<Meta> | null = null;
let areasPromise: Promise<NamedArea[]> | null = null;
let worldPromise: Promise<Map<number, Source>> | null = null;

async function fetchJson<T>(path: string): Promise<T> {
  const early = takeData<T>(path);    // started at boot (main.tsx, prefetchFirstView)
  if (early) return early;
  const r = await fetch(dataUrl(path));
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** meta.json (cached). */
export function loadMeta(): Promise<Meta> {
  if (!metaPromise) {
    metaPromise = fetchJson<Meta>('meta.json');
    metaPromise.catch(() => { metaPromise = null; });
  }
  return metaPromise;
}

/** Named places, with the world first (cached), in English (lib/names.ts; a state keeps its local name). */
export function loadAreas(): Promise<NamedArea[]> {
  if (!areasPromise) {
    areasPromise = fetchJson<NamedArea[]>('areas.json').then((a) => [WORLD, ...a.map(withEnglishName)]);
    areasPromise.catch(() => { areasPromise = null; });
  }
  return areasPromise;
}

export const worldArea = (): NamedArea => WORLD;

const ym = (yr: number, mo: number): number => yr * 100 + mo;

/** Every month from first to last (yyyymm), inclusive. */
export function monthRange(first: number, last: number): [number, number][] {
  const out: [number, number][] = [];
  let yr = Math.floor(first / 100), mo = first % 100;
  while (ym(yr, mo) <= last) {
    out.push([yr, mo]);
    mo += 1;
    if (mo > 12) { mo = 1; yr += 1; }
  }
  return out;
}

/** The source class of every month, from the world series (cached). A month with src 3 is unknown everywhere. */
export function worldSources(): Promise<Map<number, Source>> {
  if (!worldPromise) {
    worldPromise = seriesFile('world', 'WORLD').then((f) => {
      if (!f) throw new Error('the world series is missing (web/series/world/WORLD.json)');
      return new Map(f.ym.map((v, i) => [v, f.src[i] as Source]));
    });
    worldPromise.catch(() => { worldPromise = null; });
  }
  return worldPromise;
}

/** The rows of a named place's series file (none for a place without fire: no file). */
async function namedRows(kind: string, id: string): Promise<Row[]> {
  const f = await seriesFile(kind, id);
  if (!f) return [];
  return f.ym.map((v, i) => ({ yr: Math.floor(v / 100), mo: v % 100, h: f.h[i], modis: f.modis[i], t: f.t[i], a: f.a[i],
    s: f.s[i], n: f.n[i], j: f.j[i], src: f.src[i] }));
}

/** Fill the full month grid: zero where an area had no row, null values where the month is unknown. */
function fill(rows: Row[], meta: Meta, world: Map<number, Source>): MonthlyPoint[] {
  const byMonth = new Map(rows.map((r) => [ym(r.yr, r.mo), r]));
  return monthRange(meta.first_month, meta.last_month).map(([yr, mo]) => {
    const key = ym(yr, mo);
    const r = byMonth.get(key);
    const worldSrc = world.get(key) ?? 3;
    const src = (worldSrc === 3 ? 3 : r ? Math.min(r.src, 3) : worldSrc) as Source;
    const unknown = src === 3;
    return {
      yr, mo,
      h: unknown ? null : (r?.h ?? 0),
      modis: unknown ? null : (r?.modis ?? 0),
      t: r?.t ?? 0, a: r?.a ?? 0, s: r?.s ?? 0, n: r?.n ?? 0, j: r?.j ?? 0,
      src,
    };
  });
}

const SUMS = `sum(h) AS h, sum(modis) AS modis, sum(t)::BIGINT AS t, sum(a)::BIGINT AS a, sum(s)::BIGINT AS s,
  sum(n)::BIGINT AS n, sum(j)::BIGINT AS j, min(src) AS src`;

let selectionSeq = 0;

/** Monthly series of any selection: a named place, a drawn polygon, or a circle. */
export async function areaSeries(sel: AreaSelection): Promise<MonthlyPoint[]> {
  const [meta, world] = await Promise.all([loadMeta(), worldSources()]);
  if (sel.type === 'named') return fill(await namedRows(sel.area.kind, sel.area.id), meta, world);
  const cover = coverCells(sel);
  const parts: string[] = [];
  const tag = `sel${++selectionSeq}`;
  if (cover.l5.length) {
    const regions = [...new Set(cover.l5.map((c) => cellToParent(c, 1)))];
    const files = regions.map((r) => meta.files.l5.index[r]).filter((f): f is string => Boolean(f));
    if (files.length) {
      await Promise.all(files.map(registerData));
      await registerJson(`${tag}_l5.json`, cover.l5.map((h3) => ({ h3 })));
      parts.push(`SELECT yr, mo, h, modis, t, a, s, n, j, src FROM read_parquet([${files.map(sqlText).join(', ')}])
        WHERE h3 IN (SELECT h3 FROM read_json_auto('${tag}_l5.json'))`);
    }
  }
  const index = await webIndex();
  for (const level of [3, 4] as const) {
    const cells = level === 3 ? cover.l3 : cover.l4;
    if (!cells.length) continue;
    // only the level 1 regions the shape touches (web/cell_l3/<region>.parquet, a few tens of KB each)
    const have = level === 3 ? index.cell_l3 : index.cell_l4;
    const files = [...new Set(cells.map((c) => cellToParent(c, 1)))].filter((r) => have.has(r)).map((r) => `web/cell_l${level}/${r}.parquet`);
    if (!files.length) continue;
    await Promise.all(files.map(registerData));
    await registerJson(`${tag}_l${level}.json`, cells.map((h3) => ({ h3 })));
    parts.push(`SELECT yr, mo, h, modis, t, a, s, n, j, src FROM read_parquet([${files.map(sqlText).join(', ')}])
      WHERE h3 IN (SELECT h3 FROM read_json_auto('${tag}_l${level}.json'))`);
  }
  if (!parts.length) return fill([], meta, world);   // over the sea, or no fire ever: all zero
  const rows = await query<Row>(`SELECT yr, mo, ${SUMS} FROM (${parts.join(' UNION ALL ')}) GROUP BY yr, mo ORDER BY yr, mo`);
  return fill(rows, meta, world);
}

// ------------------------------------------------------------------------------------------ drivers, outlook, haze
export interface AreaDrivers { model: DriverModel | null; months: DriverMonth[] }

/** Drivers of every month of a named area, and how well they explain its fire. Empty when the area has no model
 *  (too little fire), and for drawn areas. */
export async function areaDrivers(area: NamedArea): Promise<AreaDrivers> {
  const f = await driversFile(area.kind, area.id);
  if (!f) return { model: null, months: [] };
  return { model: f.model as unknown as DriverModel, months: rowsOf<DriverMonth>(f.months) };
}

/** The outlook of a named area for the next 1 to 3 months (empty when the area has none). */
export async function areaOutlook(area: NamedArea): Promise<OutlookRow[]> {
  const f = await seriesFile(area.kind, area.id);
  return (f?.outlook ?? []) as unknown as OutlookRow[];
}

let hazePromise: Promise<HazeModels> | null = null;

/** haze.json: the haze model of every city (cached). */
export function hazeModels(): Promise<HazeModels> {
  if (!hazePromise) {
    hazePromise = fetchJson<HazeModels>('haze.json');
    hazePromise.catch(() => { hazePromise = null; });
  }
  return hazePromise;
}

/** Monthly haze at one city, every month with data (web/haze_months.json, one file for all cities). */
export async function hazeCity(city: string): Promise<HazeMonth[]> {
  const all = await webJson<Record<string, Record<string, unknown[]>>>('haze_months.json');
  const cols = all?.[city];
  if (!cols) return [];
  return rowsOf<Omit<HazeMonth, 'city'>>(cols).map((r) => ({ city, ...r }));
}

let dashboardPromise: Promise<DashboardData> | null = null;

/** dashboard.json: every headline statistic of the analytics dashboard (cached), with the places in English. */
export function loadDashboard(): Promise<DashboardData> {
  if (!dashboardPromise) {
    dashboardPromise = fetchJson<DashboardData>('dashboard.json').then(englishNames);
    dashboardPromise.catch(() => { dashboardPromise = null; });
  }
  return dashboardPromise;
}
