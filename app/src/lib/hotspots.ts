// Every FIRMS hotspot of a search: an area (named or drawn) and a range of months, read straight from the published
// per region files (products/v<version>/hotspots/l1=<hex>.parquet, sorted by date in small row groups). DuckDB in the
// browser fetches only the files of the regions the area touches and, inside them, only the row groups of the months
// asked for. Named areas are filtered inside the database (with cells.parquet), drawn shapes by their hexagons.
import { cellToChildren, cellToParent, latLngToCell } from 'h3-js';
import { dataUrl } from './config';
import { exportCsv, query, registerData, registerJson, sqlText } from './db';
import { coverCells } from './geo';
import { outlineFile } from './web';
import type { AreaSelection } from './types';

interface HotspotIndex { region_level: number; rows: number; regions: Record<string, { file: string; rows: number; mb: number }> }

/** At most this many hotspots in one CSV (about 75 MB): bigger searches should pick a smaller area or fewer months. */
export const HOTSPOT_LIMIT = 1_000_000;

let indexPromise: Promise<HotspotIndex> | null = null;
let seq = 0;

export function loadHotspotIndex(): Promise<HotspotIndex> {
  if (!indexPromise) {
    indexPromise = fetch(dataUrl('hotspots/index.json')).then((r) => {
      if (!r.ok) throw new Error(`hotspots/index.json: HTTP ${r.status}`);
      return r.json() as Promise<HotspotIndex>;
    });
    indexPromise.catch(() => { indexPromise = null; });
  }
  return indexPromise;
}

const ymDate = (ym: number) => `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, '0')}-01`;
function ymEnd(ym: number): string {
  const y = Math.floor(ym / 100), m = ym % 100;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

interface Plan { files: string[]; where: string }

/** The local solar date of a hotspot, as the record uses it (fireharmony/clean.py: acq_utc + round(lon * 240) seconds). */
const SOLAR_DATE = 'CAST(date + make_time(time // 100, time % 100, 0) + to_seconds(CAST(round(lon * 240) AS BIGINT)) AS DATE)';

/** Which files to read and how to keep only the area's hexagons. */
async function plan(sel: AreaSelection, fromYm: number, toYm: number, countedOnly: boolean): Promise<Plan | null> {
  const idx = await loadHotspotIndex();
  let regions: string[];
  let areaFilter = '';
  if (sel.type === 'named' && sel.area.kind === 'world') {
    regions = Object.keys(idx.regions);
  } else if (sel.type === 'named') {
    // the place's level 1 regions (its outline file), then its level 5 hexagons from those regions' cells files
    const outline = await outlineFile(sel.area.kind, sel.area.id);
    regions = outline?.regions ?? [];
    if (!regions.length) return null;
    const cellFiles = regions.map((r) => `web/cells/${r}.parquet`);
    await Promise.all(cellFiles.map(registerData));
    const col = sel.area.kind === 'country' ? 'iso3' : sel.area.kind === 'state' ? 'state_code' : 'continent';
    areaFilter = `AND h3_5 IN (SELECT h3 FROM read_parquet([${cellFiles.map(sqlText).join(', ')}]) WHERE ${col} = ${sqlText(sel.area.id)})`;
  } else {
    const cover = coverCells(sel);
    const cells = [...cover.l5];
    for (const c of [...cover.l3, ...cover.l4]) cells.push(...cellToChildren(c, 5));
    if (!cells.length) return null;
    regions = [...new Set(cells.map((c) => cellToParent(c, idx.region_level)))];
    const tag = `hs_${++seq}`;
    await registerJson(`${tag}.json`, cells.map((h3) => ({ h3 })));
    areaFilter = `AND h3_5 IN (SELECT h3 FROM read_json_auto('${tag}.json'))`;
  }
  const files = regions.map((r) => idx.regions[r]?.file).filter((f): f is string => Boolean(f));
  if (!files.length) return null;
  await Promise.all(files.map(registerData));
  // the record dates each hotspot by local solar time (UTC plus 4 minutes per degree of longitude), so the search does
  // too: one more UTC day at each end lets the files skip every other row group by their date statistics
  const where = `date BETWEEN DATE '${ymDate(fromYm)}' - 1 AND DATE '${ymEnd(toYm)}' + 1
    AND ${SOLAR_DATE} BETWEEN DATE '${ymDate(fromYm)}' AND DATE '${ymEnd(toYm)}' ${areaFilter}${countedOnly ? ' AND counted' : ''}`;
  return { files, where };
}

const fromList = (files: string[]) => `read_parquet([${files.map(sqlText).join(', ')}])`;

/** How many hotspots the search finds (fast: the database only reads what it needs to count). */
export async function countHotspots(sel: AreaSelection, fromYm: number, toYm: number, countedOnly = false): Promise<number> {
  const p = await plan(sel, fromYm, toYm, countedOnly);
  if (!p) return 0;
  const r = await query<{ n: number }>(`SELECT count(*) AS n FROM ${fromList(p.files)} WHERE ${p.where}`);
  return r[0]?.n ?? 0;
}

/** What a hotspot export holds: the area, the months and whether only the record's hotspots are kept. */
export interface HotspotSearch { sel: AreaSelection; fromYm: number; toYm: number; countedOnly: boolean }

/** The comment lines at the top of a hotspot CSV: what it is, what the columns mean, and how to cite. */
export function hotspotsCsvHeader(name: string, periodText: string, countedOnly: boolean, citation: string, acknowledgement: string): string {
  return [
    `# Fire Harmony hotspots: ${name.replace(/[\r\n]+/g, ' ')}, ${periodText}${countedOnly ? ' (only hotspots counted in the harmonized record)' : ''}`,
    '# One row per NASA FIRMS hotspot: a pixel a satellite marked as unusually hot. latitude and longitude are the pixel centre.',
    '# date_utc and time_utc (HHMM) are the time of the satellite pass in UTC, as FIRMS gives them. solar_date is the local solar date the record uses',
    '# (UTC plus 4 minutes per degree of longitude) and picks the months: a night pass over Asia can fall on the next day.',
    '# frp_mw = fire radiative power in megawatts. confidence: low, nominal or high. quality: sp = science quality, nrt = near real time.',
    '# type (science quality only): 0 vegetation fire, 1 volcano, 2 other static land source, 3 offshore.',
    '# counted = true when the hotspot is in the harmonized record: a vegetation fire, not in open water, not low confidence.',
    `# ${citation}`,
    `# ${acknowledgement}`,
  ].join('\n') + '\n';
}

/**
 * The hotspots of a search as CSV bytes, oldest first (DuckDB writes the file, see exportCsv). At most `limit` rows:
 * check the size first with countHotspots. Null when the search touches no file.
 */
export async function exportHotspots(q: HotspotSearch, limit = HOTSPOT_LIMIT): Promise<{ bytes: Uint8Array<ArrayBuffer>; rows: number } | null> {
  const p = await plan(q.sel, q.fromYm, q.toYm, q.countedOnly);
  if (!p) return null;
  return exportCsv(`SELECT strftime(date, '%Y-%m-%d') AS date_utc, lpad(CAST(time AS VARCHAR), 4, '0') AS time_utc,
      strftime(${SOLAR_DATE}, '%Y-%m-%d') AS solar_date, round(CAST(lat AS DOUBLE), 4) AS latitude, round(CAST(lon AS DOUBLE), 4) AS longitude, satellite, daynight,
      round(CAST(frp AS DOUBLE), 1) AS frp_mw, confidence, type, quality, counted
    FROM ${fromList(p.files)} WHERE ${p.where} ORDER BY date, time LIMIT ${limit}`);
}

// ---------------------------------------------------------------------------------------------------------------
// The hotspots of one month as dots on the map (at city zoom): the counted hotspots of the record, raw (one dot per
// satellite pixel, not harmonized), in a box around the view.

/** One hotspot on the map. */
export interface HotspotDot { lat: number; lon: number; frp: number; satellite: string; date: string; time: number }

/** A box on the map, in degrees. */
export interface GeoBox { west: number; south: number; east: number; north: number }

/** The level 1 regions a box touches (a grid of points over it: a region is far bigger than a city's view). */
export function regionsOfBox(b: GeoBox, level: number): string[] {
  const out = new Set<string>();
  const n = 6;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const lat = b.south + ((b.north - b.south) * i) / n, lon = b.west + ((b.east - b.west) * j) / n;
      out.add(latLngToCell(Math.max(-89.9, Math.min(89.9, lat)), ((lon + 540) % 360) - 180, level));
    }
  }
  return [...out];
}

/** The counted hotspots of month `ym` (yyyymm, by the record's local solar date) inside `box`, at most `limit`;
 *  `capped` when there were more (then the dots are an even random share of them, in time and in space). */
export async function hotspotDots(box: GeoBox, ym: number, limit = 50_000): Promise<{ dots: HotspotDot[]; capped: boolean }> {
  const idx = await loadHotspotIndex();
  const files = regionsOfBox(box, idx.region_level).map((r) => idx.regions[r]?.file).filter((f): f is string => Boolean(f));
  if (!files.length) return { dots: [], capped: false };
  await Promise.all(files.map(registerData));
  const n = (v: number) => v.toFixed(4);
  const rows = await query<{ lat: number; lon: number; frp: number; satellite: string; d: string; time: number }>(
    `SELECT lat, lon, frp, satellite, strftime(date, '%Y-%m-%d') AS d, time FROM ${fromList(files)}
     WHERE date BETWEEN DATE '${ymDate(ym)}' - 1 AND DATE '${ymEnd(ym)}' + 1
       AND ${SOLAR_DATE} BETWEEN DATE '${ymDate(ym)}' AND DATE '${ymEnd(ym)}' AND counted
       AND lat BETWEEN ${n(box.south)} AND ${n(box.north)} AND lon BETWEEN ${n(box.west)} AND ${n(box.east)}
     ORDER BY hash(date, time, lat, lon) LIMIT ${limit + 1}`);
  const capped = rows.length > limit;
  return {
    dots: rows.slice(0, limit).map((r) => ({ lat: r.lat, lon: r.lon, frp: r.frp, satellite: r.satellite, date: r.d, time: r.time })),
    capped,
  };
}

/** NASA FIRMS's fire map at a place (its own zoom is one more than MapLibre's, for 256 px tiles), for the fires of the
 *  last days: this record ends with the last full month. */
export function firmsUrl(lat: number, lon: number, zoom: number): string {
  const z = Math.max(2, Math.min(14, Math.round((zoom + 1) * 10) / 10));
  return `https://firms.modaps.eosdis.nasa.gov/map/#d:7days;@${lon.toFixed(2)},${lat.toFixed(2)},${z.toFixed(1)}z`;
}
