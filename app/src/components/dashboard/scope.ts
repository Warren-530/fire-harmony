// The dashboard's scope: one place (the world, a continent, a country, a state, or a circle of 50 km around a city),
// a range of years, the months of each year (every month, one month, or a season such as August to October, which may
// cross the new year) and the scale. Every chart that can follow a place reads this; the link keeps it
// ("#/dashboard?area=country:IDN&years=2005-2025&months=8-10&scale=modis").
//
// The numbers come from the place's monthly series with the same functions as the Explorer (lib/stats.ts and
// lib/period.ts), so a place reads the same on both pages: the latest month against normal is anomalies(), the year
// so far is yearToMonth(), a season is periodStats(), the trend is trend() on the totals of the chosen months.
// Pure functions, tested in scope.test.ts.
import { BASE_YEARS, FIRST_YEAR } from '../../lib/config';
import { periodStats } from '../../lib/period';
import {
  addMonths, anomalies, climatology, criticalMonths, intervalFor, knownRange, monthRuns, onScale, parseExplorerLink, trend, valueOf,
  yearToMonth, ymOf,
} from '../../lib/stats';
import type { Meta, MonthlyPoint, Scale, Source } from '../../lib/types';

// ------------------------------------------------------------------------------------------------ the scope

export type PlaceKind = 'world' | 'continent' | 'country' | 'state';
export type ScopePlace =
  | { type: 'named'; kind: PlaceKind; id: string }
  | { type: 'circle'; lat: number; lon: number; km: number };

export interface Scope {
  place: ScopePlace;
  years: [number, number];          // season years, both included
  months: [number, number] | null;  // first and last calendar month of the season (may wrap: [11, 2]); null = every month
  scale: Scale;
}

export const WORLD_PLACE: ScopePlace = { type: 'named', kind: 'world', id: 'WORLD' };

export const defaultScope = (lastYear: number): Scope => ({ place: WORLD_PLACE, years: [FIRST_YEAR, lastYear], months: null, scale: 'harmonized' });

export const isWorld = (p: ScopePlace): boolean => p.type === 'named' && p.kind === 'world';
export const samePlace = (a: ScopePlace, b: ScopePlace): boolean => placeKey(a) === placeKey(b);
const linkNumber = (v: number): string => String(Math.round(v * 1e4) / 1e4);

/** "country:IDN", "circle:-2.2,113.92,50": the key of a place, as in the Explorer's links. */
export function placeKey(p: ScopePlace): string {
  return p.type === 'named' ? (p.kind === 'world' ? 'world:WORLD' : `${p.kind}:${p.id}`) : `circle:${linkNumber(p.lat)},${linkNumber(p.lon)},${linkNumber(p.km)}`;
}

/** True when the scope is the whole record of the world on the harmonized scale (the page as published). */
export function isDefaultScope(s: Scope, lastYear: number): boolean {
  return isWorld(s.place) && s.months === null && s.scale === 'harmonized' && s.years[0] === FIRST_YEAR && s.years[1] === lastYear;
}

/** Only the years and months are filtered (any place, any scale). */
export const allTime = (s: Scope, lastYear: number): boolean => s.months === null && s.years[0] === FIRST_YEAR && s.years[1] === lastYear;

/** The scope in a dashboard link (only what differs from the default), with the section when given. */
export function scopeQuery(s: Scope, lastYear: number, section?: string | null): string {
  const q = new URLSearchParams();
  if (!isWorld(s.place)) q.set('area', placeKey(s.place));
  if (s.years[0] !== FIRST_YEAR || s.years[1] !== lastYear) q.set('years', `${s.years[0]}-${s.years[1]}`);
  if (s.months) q.set('months', s.months[0] === s.months[1] ? String(s.months[0]) : `${s.months[0]}-${s.months[1]}`);
  if (s.scale !== 'harmonized') q.set('scale', s.scale);
  if (section) q.set('s', section);
  return q.toString().replace(/%3A/gi, ':').replace(/%2C/gi, ',');
}

export function scopeHash(s: Scope, lastYear: number, section?: string | null): string {
  const q = scopeQuery(s, lastYear, section);
  return q ? `#/dashboard?${q}` : '#/dashboard';
}

/** The scope of a dashboard link; anything it cannot read keeps the default. */
export function scopeFromHash(hash: string, lastYear: number): Scope {
  const s = defaultScope(lastYear);
  const q = new URLSearchParams(hash.split('?')[1] ?? '');
  // "place=" is read as "area=" (the name people guess for it)
  if (!q.has('area') && q.has('place')) q.set('area', q.get('place') ?? '');
  const link = parseExplorerLink(`#/?${q.toString()}`);
  const a = link.area;
  if (a?.type === 'named') s.place = { type: 'named', kind: a.kind, id: a.id };
  else if (a?.type === 'circle') s.place = { type: 'circle', lat: a.lat, lon: a.lon, km: a.radiusKm };
  if (link.scale) s.scale = link.scale;
  const years = /^(\d{4})-(\d{4})$/.exec(q.get('years') ?? '');
  if (years) {
    const y0 = Math.max(FIRST_YEAR, Math.min(lastYear, Number(years[1]))), y1 = Math.max(FIRST_YEAR, Math.min(lastYear, Number(years[2])));
    s.years = y0 <= y1 ? [y0, y1] : [y1, y0];
  }
  const months = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(q.get('months') ?? '');
  if (months) {
    const m0 = Number(months[1]), m1 = Number(months[2] ?? months[1]);
    if (m0 >= 1 && m0 <= 12 && m1 >= 1 && m1 <= 12) s.months = seasonMonths([m0, m1]).length === 12 ? null : [m0, m1];
  }
  return s;
}

// ------------------------------------------------------------------------------------------------ months of a season

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

/** The calendar months of a season in order: [8, 9, 10]; [11, 12, 1, 2]; every month for null. */
export function seasonMonths(m: [number, number] | null): number[] {
  if (!m) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const out: number[] = [];
  for (let k = m[0]; ; k = (k % 12) + 1) { out.push(k); if (k === m[1] || out.length === 12) break; }
  return out;
}

export const wraps = (m: [number, number] | null): boolean => m !== null && m[1] < m[0];

/** "Every month", "September", "August to October", "November to February". */
export function seasonLabel(m: [number, number] | null, short = false): string {
  const n = short ? SHORT : MONTH_NAMES;
  if (!m) return short ? 'All months' : 'Every month';
  return m[0] === m[1] ? n[m[0] - 1] : `${n[m[0] - 1]} to ${n[m[1] - 1]}`;
}

/** The season year a month belongs to: its calendar year, or the year before for the months after the new year of a
 *  season that crosses it (November 2019 to February 2020 is the season of 2019). Null when the month is outside. */
export function seasonYearOf(yr: number, mo: number, m: [number, number] | null): number | null {
  if (!m) return yr;
  if (!seasonMonths(m).includes(mo)) return null;
  return wraps(m) && mo <= m[1] ? yr - 1 : yr;
}

/** "2019", or "2019/20" for a season that crosses the new year. */
export const seasonYearLabel = (y: number, m: [number, number] | null): string =>
  wraps(m) ? `${y}/${String((y + 1) % 100).padStart(2, '0')}` : String(y);

/** First and last month (yyyymm) of the season of year y. */
export function seasonSpanOf(y: number, m: [number, number] | null): { from: number; to: number } {
  if (!m) return { from: ymOf(y, 1), to: ymOf(y, 12) };
  return { from: ymOf(y, m[0]), to: ymOf(wraps(m) ? y + 1 : y, m[1]) };
}

/** "years 2005 to 2020", "2019", for subtitles. */
export const yearsLabel = (y: [number, number]): string => (y[0] === y[1] ? String(y[0]) : `${y[0]} to ${y[1]}`);

/** The usual fire season of a place as one run of months (the longest run of its critical months). */
export function fireSeasonOf(points: readonly MonthlyPoint[]): [number, number] | null {
  const runs = monthRuns(criticalMonths(points, 'harmonized'));
  if (!runs.length) return null;
  const len = (r: [number, number]) => ((r[1] - r[0] + 12) % 12) + 1;
  const best = runs.reduce((a, b) => (len(b) > len(a) ? b : a), runs[0]);
  return len(best) >= 12 ? null : best;
}

// ------------------------------------------------------------------------------------------------ the numbers

export type SensorKey = 't' | 'a' | 's' | 'n' | 'j';

export interface SeasonYear {
  yr: number;            // season year
  label: string;         // "2019" or "2019/20"
  value: number;         // the known months added up
  months: number;        // known months
  complete: boolean;     // every month of the season is known
  src: Source;           // the worst source among its months
  lo: number | null;     // 90% range where months are modelled (harmonized only)
  hi: number | null;
  sensors: Record<SensorKey, number>;   // raw detections of each satellite in the known months
}

export interface ScopeView {
  key: string;                       // what was computed (place, years, months, scale)
  years: SeasonYear[];               // season years in the range, complete ones and the latest partial one
  allYears: SeasonYear[];            // every season year of the record (for the years picker)
  trend: { pct: number | null; p: number | null; direction: string; from: number; to: number; n: number; line: { yr: number; v: number }[] };
  latest: { ym: number; value: number; normal: number | null; ratio: number | null; rank: number | null; years: number } | null;
  period: {
    label: string; from: number; to: number; months: number; total: number; normal: number | null; ratio: number | null;
    rank: number | null; ranked: number; soFar: boolean; ytd: boolean; range: { lo: number; hi: number } | null;
  } | null;
  season: { mo: number; median: number | null; q25: number | null; q75: number | null }[];
  seasonYears: [number, number];     // the years the normal year is taken from
  monthly: Map<number, number>;      // yyyymm -> value on the scale (known months)
  total: number;                     // every known month in view, added up
  monthsCounted: number;
  modelledMonths: number;            // of those, months modelled from MODIS
  firstYm: number | null; lastYm: number | null;   // first and last month in view
  record: SeasonYear | null;         // the season year with the most fire
  critical: number[];                // the usual critical months
  fireSeason: [number, number] | null;
  latestKnown: number | null;        // the latest known month of the record (yyyymm)
}

const sum = (xs: readonly number[]): number => {
  let s = 0, c = 0;
  for (const x of xs) { const y = x - c; const t = s + y; c = (t - s) - y; s = t; }
  return s;
};

/** Every season year of the record, from the place's monthly series (already on the scale). */
function seasonYears(sp: readonly MonthlyPoint[], raw: readonly MonthlyPoint[], m: [number, number] | null, meta: Pick<Meta, 'intervals'>,
  harmonized: boolean): SeasonYear[] {
  const months = seasonMonths(m);
  const by = new Map<number, { obs: number[]; mod: number[]; known: number; worst: Source; sensors: Record<SensorKey, number>; seen: number }>();
  sp.forEach((p, i) => {
    const y = seasonYearOf(p.yr, p.mo, m);
    if (y === null) return;
    const e = by.get(y) ?? { obs: [], mod: [], known: 0, worst: 0 as Source, sensors: { t: 0, a: 0, s: 0, n: 0, j: 0 }, seen: 0 };
    by.set(y, e);
    e.seen += 1;
    const v = valueOf(p, 'harmonized');
    if (v === null) return;
    e.known += 1;
    (p.src === 0 ? e.obs : e.mod).push(v);
    if (p.src > e.worst) e.worst = p.src;
    const r = raw[i];
    e.sensors.t += r.t; e.sensors.a += r.a; e.sensors.s += r.s; e.sensors.n += r.n; e.sensors.j += r.j;
  });
  const out: SeasonYear[] = [];
  for (const [yr, e] of [...by].sort((a, b) => a[0] - b[0])) {
    if (!e.known) continue;
    const value = sum([...e.obs, ...e.mod]);
    let lo: number | null = null, hi: number | null = null;
    if (harmonized && e.mod.length) {
      const r = intervalFor(sum(e.mod), e.worst, e.mod.length >= 12 ? 'year' : 'month', meta);
      if (r) { const o = sum(e.obs); lo = o + r.lo; hi = o + r.hi; }
    }
    out.push({ yr, label: seasonYearLabel(yr, m), value, months: e.known, complete: e.known === months.length, src: e.worst, lo, hi, sensors: e.sensors });
  }
  return out;
}

/** Months with only the season's months kept (the rest count as zero), filed under their season year, so that
 *  trend() measures the trend of the season totals exactly as it does for whole years. */
function seasonPoints(sp: readonly MonthlyPoint[], m: [number, number] | null): MonthlyPoint[] {
  if (!m) return sp as MonthlyPoint[];
  const out: MonthlyPoint[] = [];
  const keep = new Set(seasonMonths(m));
  for (const p of sp) {
    const y = wraps(m) && p.mo <= m[1] ? p.yr - 1 : p.yr;
    out.push(keep.has(p.mo) ? { ...p, yr: y } : { ...p, yr: y, h: 0, modis: 0, src: 0 });
  }
  return out;
}

/**
 * Everything the dashboard shows for one scope, from the monthly series of the place (as areaSeries gives it).
 * `meta` gives the 90% ranges of modelled months.
 */
export function scopeView(points: readonly MonthlyPoint[], s: Scope, meta: Pick<Meta, 'intervals'>, key = ''): ScopeView {
  const sp = onScale(points, s.scale);
  const m = s.months;
  const [y0, y1] = s.years;
  const all = seasonYears(sp, points, m, meta, s.scale === 'harmonized');
  const range = knownRange(sp);
  const latestKnown = range?.last ?? null;
  const years = all.filter((y) => y.yr >= y0 && y.yr <= y1 && (y.complete || y.yr === all[all.length - 1]?.yr));

  // the trend of the season totals, over the base years in view (as the Explorer: 2001 to 2025)
  const from = Math.max(y0, BASE_YEARS[0]), to = Math.min(y1, BASE_YEARS[1]);
  const tr = trend(seasonPoints(sp, m), 'harmonized', [from, to]);
  const full = years.filter((y) => y.complete && y.yr >= from && y.yr <= to);
  let line: { yr: number; v: number }[] = [];
  if (tr.pct_per_decade !== null && full.length > 1) {
    // Sen's slope of log(1 + total), through the median intercept (as the world chart)
    const b = Math.log(1 + tr.pct_per_decade / 100) / 10;
    const ints = full.map((y) => Math.log1p(y.value) - b * y.yr).sort((p, q) => p - q);
    const a = ints.length % 2 ? ints[(ints.length - 1) / 2] : (ints[ints.length / 2 - 1] + ints[ints.length / 2]) / 2;
    line = [full[0].yr, full[full.length - 1].yr].map((yr) => ({ yr, v: Math.exp(a + b * yr) - 1 }));
  }

  // the latest month in view against its normal (anomalies(): the Explorer's month tile)
  const anoms = anomalies(sp, 'harmonized');
  let latest: ScopeView['latest'] = null;
  for (let i = sp.length - 1; i >= 0; i--) {
    const a = anoms[i];
    if (a.value === null) continue;
    const y = seasonYearOf(a.yr, a.mo, m);
    if (y === null || y < y0 || y > y1) continue;
    latest = { ym: ymOf(a.yr, a.mo), value: a.value, normal: a.median, ratio: a.ratio, rank: a.value > 0 ? a.rank : null, years: a.years };
    break;
  }

  // the latest season in view, so far (the year so far for every month: yearToMonth(), the Explorer's year tile)
  let period: ScopeView['period'] = null;
  if (range) {
    let yr = Math.min(y1, seasonYearOf(Math.floor(range.last / 100), range.last % 100, m) ?? Math.floor(range.last / 100));
    for (; yr >= y0; yr--) {
      const span = seasonSpanOf(yr, m);
      if (span.from > range.last) continue;
      const to = Math.min(span.to, range.last);
      const ps = periodStats(sp, { from: span.from, to }, meta);
      if (ps.total === null) continue;
      const soFar = to < span.to;
      let total = ps.total, normal = ps.normal, ratio = ps.ratio;
      const ytd = !m;
      if (ytd) {
        const y = yearToMonth(sp, 'harmonized', yr, to % 100);
        if (y) { total = y.total; normal = y.normal; ratio = y.ratio; }
      }
      const label = !m ? (soFar ? `${yr} so far` : String(yr))
        : `${seasonLabel(m, true)} ${seasonYearLabel(yr, m)}${soFar ? ' so far' : ''}`;
      period = { label, from: span.from, to, months: ps.months, total, normal, ratio, rank: ps.rank, ranked: ps.ranked, soFar, ytd, range: ps.range };
      break;
    }
  }

  // the normal year: the median of each month over the years in view (at least three), else 2001 to 2025
  const sy: [number, number] = to - from >= 2 ? [from, to] : [BASE_YEARS[0], BASE_YEARS[1]];
  const season = climatology(sp, 'harmonized', sy);

  const monthly = new Map<number, number>();
  let total = 0, monthsCounted = 0, modelledMonths = 0, firstYm: number | null = null, lastYm: number | null = null;
  const shown = new Set(years.map((y) => y.yr));
  const parts: number[] = [];
  for (const p of sp) {
    const v = valueOf(p, 'harmonized');
    if (v === null) continue;
    const ym = ymOf(p.yr, p.mo);
    monthly.set(ym, v);
    const y = seasonYearOf(p.yr, p.mo, m);
    if (y === null || !shown.has(y)) continue;
    parts.push(v);
    monthsCounted += 1;
    if (p.src !== 0) modelledMonths += 1;
    if (firstYm === null) firstYm = ym;
    lastYm = ym;
  }
  total = sum(parts);
  const complete = years.filter((y) => y.complete);
  const record = complete.length ? complete.reduce((a, b) => (b.value > a.value ? b : a), complete[0]) : null;
  const critical = criticalMonths(points, 'harmonized');

  return {
    key, years, allYears: all,
    trend: { pct: tr.pct_per_decade, p: tr.p, direction: tr.direction, from, to, n: tr.years, line },
    latest, period, season, seasonYears: sy, monthly, total, monthsCounted, modelledMonths, firstYm, lastYm, record, critical,
    fireSeason: fireSeasonOf(points), latestKnown,
  };
}

/** The few numbers of a place in a table of places (its parts): fire a year in view, the total in view (for shares),
 *  the trend and the latest month in view against normal, and the season totals for a sparkline. */
export interface PartStats {
  perYear: number | null; total: number; trendPct: number | null; trendP: number | null; direction: string;
  trendFrom: number; trendTo: number;
  latestRatio: number | null; latestYm: number | null; values: (number | null)[]; yearsShown: number[]; critical: number[];
}

export function partStats(points: readonly MonthlyPoint[], s: Scope, meta: Pick<Meta, 'intervals'>): PartStats {
  const v = scopeView(points, s, meta);
  const full = v.years.filter((y) => y.complete && y.yr >= v.trend.from && y.yr <= v.trend.to);
  return {
    perYear: full.length ? sum(full.map((y) => y.value)) / full.length : null,
    total: v.total,
    trendPct: v.trend.pct, trendP: v.trend.p, direction: v.trend.direction, trendFrom: v.trend.from, trendTo: v.trend.to,
    latestRatio: v.latest?.ratio ?? null, latestYm: v.latest?.ym ?? null,
    values: v.years.filter((y) => y.complete).map((y) => y.value), yearsShown: v.years.filter((y) => y.complete).map((y) => y.yr),
    critical: v.critical,
  };
}

/** yyyymm plus n months (re-exported for the components). */
export { addMonths };
