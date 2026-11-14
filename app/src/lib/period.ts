// A period of one area: a range of whole months picked by the user (the challenge's "date range"). We give its
// harmonized total, compared with the same months of every other year (the normal and the rank), the 90% range where
// months are modelled, the busiest month, and the raw detections of each satellite. Pure functions, tested in
// period.test.ts.
import { BASE_YEARS } from './config';
import { addMonths, intervalFor, knownRange, latestCompleteMonth, monthsBetween, season, valueOf, ymOf } from './stats';
import type { Meta, MonthlyPoint, Range, Source } from './types';

/** A range of whole months as yyyymm, both ends included. */
export interface Period { from: number; to: number }

export type PeriodPreset = 'last12' | 'ytd' | 'lastYear' | 'season' | 'all';

/** Months in the period (1 for a single month). */
export const periodLength = (p: Period): number => monthsBetween(p.from, p.to) + 1;

/** Every month of the period, oldest first, as yyyymm. */
export function periodMonths(p: Period): number[] {
  const n = periodLength(p);
  return n > 0 ? Array.from({ length: n }, (_, i) => addMonths(p.from, i)) : [];
}

/** The period moved inside first..last (the ends are swapped when from is after to). */
export function clampPeriod(p: Period, first: number, last: number): Period {
  const clamp = (v: number) => Math.min(Math.max(v, first), last);
  const a = clamp(p.from), b = clamp(p.to);
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/** "Mar 2019", "Mar 2019 to Feb 2020", "2019" for a calendar year, "Mar to May 2019" within one year. */
export function periodLabel(p: Period, shortNames: readonly string[]): string {
  const m = (ym: number) => shortNames[(ym % 100) - 1] ?? '';
  const y = (ym: number) => Math.floor(ym / 100);
  if (p.from === p.to) return `${m(p.from)} ${y(p.from)}`;
  if (y(p.from) === y(p.to)) {
    if (p.from % 100 === 1 && p.to % 100 === 12) return String(y(p.from));
    return `${m(p.from)} to ${m(p.to)} ${y(p.to)}`;
  }
  if (p.from % 100 === 1 && p.to % 100 === 12) return `${y(p.from)} to ${y(p.to)}`;
  return `${m(p.from)} ${y(p.from)} to ${m(p.to)} ${y(p.to)}`;
}

/** Short label of the same months in one year: "2019", or "2019/20" when they cross the end of a year. */
export function yearLabel(p: Period): string {
  const a = Math.floor(p.from / 100), b = Math.floor(p.to / 100);
  return a === b ? String(a) : `${a}/${String(b % 100).padStart(2, '0')}`;
}

/** The fire season of an area as one run of months in fire year order: start month and length (null without fire). */
export function seasonSpan(points: readonly MonthlyPoint[]): { start: number; months: number } | null {
  const s = season(points, 'harmonized');
  if (!s.criticalMonths.length) return null;
  const pos = (mo: number) => (mo - s.fireYearStartMonth + 12) % 12;      // 0 = first month of the fire year
  const ps = s.criticalMonths.map(pos);
  const lo = Math.min(...ps), hi = Math.max(...ps);
  return { start: ((s.fireYearStartMonth - 1 + lo) % 12) + 1, months: hi - lo + 1 };
}

/** The latest period of `months` months starting in calendar month `start` whose months are all known. */
function latestRun(points: readonly MonthlyPoint[], start: number, months: number): Period | null {
  const known = knownMonthSet(points);
  const range = knownRange(points);
  if (!range) return null;
  for (let yr = Math.floor(range.last / 100); yr >= Math.floor(range.first / 100); yr--) {
    const p = { from: ymOf(yr, start), to: addMonths(ymOf(yr, start), months - 1) };
    if (periodMonths(p).every((m) => known.has(m))) return p;
  }
  return null;
}

function knownMonthSet(points: readonly MonthlyPoint[]): Set<number> {
  const s = new Set<number>();
  for (const p of points) if (valueOf(p, 'harmonized') !== null) s.add(ymOf(p.yr, p.mo));
  return s;
}

/** The period a preset stands for, for this area (null when the area has no known month, or no fire season). */
export function presetPeriod(preset: PeriodPreset, points: readonly MonthlyPoint[]): Period | null {
  const latest = latestCompleteMonth(points, 'harmonized');
  const range = knownRange(points);
  if (!latest || !range) return null;
  const last = ymOf(latest.yr, latest.mo);
  switch (preset) {
    case 'last12': return clampPeriod({ from: addMonths(last, -11), to: last }, range.first, last);
    case 'ytd': return { from: ymOf(latest.yr, 1), to: last };
    case 'lastYear': {
      const yr = latest.mo === 12 ? latest.yr : latest.yr - 1;
      return clampPeriod({ from: ymOf(yr, 1), to: ymOf(yr, 12) }, range.first, last);
    }
    case 'season': {
      const s = seasonSpan(points);
      return s ? latestRun(points, s.start, s.months) : null;
    }
    case 'all': return { from: range.first, to: last };
  }
}

/** The same months in one year: the period shifted by whole years. */
export interface PeriodYear {
  from: number; to: number;
  label: string;
  value: number | null;   // harmonized total, null unless every month is known
  selected: boolean;
}

export interface PeriodStats {
  period: Period;
  months: number;           // length of the period in months
  known: number;            // months with a known value
  total: number | null;     // harmonized hotspots in the known months (null when none is known)
  range: Range | null;      // 90% range of the total where some months are modelled (null where all are observed)
  observedShare: number;    // share of the total from months observed by VIIRS
  sources: Record<Source, number>;   // months of each source
  normal: number | null;    // the usual total for these months (see periodStats)
  ratio: number | null;     // total / normal
  rank: number | null;      // 1 = the most fire of every year with the same months known
  ranked: number;           // how many years were ranked
  perYear: number | null;   // periods longer than a year: hotspots per 12 months
  years: PeriodYear[];      // the same months in each year (periods of up to 12 months)
  peak: { yr: number; mo: number; value: number } | null;
  raw: { t: number; a: number; s: number; n: number; j: number };  // raw detections of each satellite
}

const sum = (xs: readonly number[]): number => {
  let s = 0, c = 0;                         // Kahan sum, as the rest of the app
  for (const x of xs) { const y = x - c; const t = s + y; c = (t - s) - y; s = t; }
  return s;
};

function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Statistics of one period of an area. Periods of up to 12 months are compared with the same months of every other
 * year: the normal is the median of those totals over the base years (2001 to 2025), as the app does for "this year so
 * far", and the rank is among every year whose months are all known (ties share the best rank). A longer period is
 * compared per year: hotspots per 12 months against the median total of a full base year.
 */
export function periodStats(points: readonly MonthlyPoint[], period: Period, meta: Pick<Meta, 'intervals'>): PeriodStats {
  const byYm = new Map(points.map((p) => [ymOf(p.yr, p.mo), p]));
  const months = periodMonths(period);
  const sources: Record<Source, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const raw = { t: 0, a: 0, s: 0, n: 0, j: 0 };
  const observed: number[] = [], modelled: number[] = [];
  let worst: Source = 0, peak: PeriodStats['peak'] = null;
  for (const ym of months) {
    const p = byYm.get(ym);
    if (!p) { sources[3] += 1; continue; }
    sources[p.src] += 1;
    raw.t += p.t; raw.a += p.a; raw.s += p.s; raw.n += p.n; raw.j += p.j;
    const v = valueOf(p, 'harmonized');
    if (v === null) continue;
    (p.src === 0 ? observed : modelled).push(v);
    if (p.src > worst) worst = p.src;
    if (v > 0 && (!peak || v > peak.value)) peak = { yr: p.yr, mo: p.mo, value: v };   // no busiest month without fire
  }
  const known = observed.length + modelled.length;
  const total = known ? sum([...observed, ...modelled]) : null;
  const obs = sum(observed), mod = sum(modelled);
  let range: Range | null = null;
  if (modelled.length) {
    // the yearly table for a year or more of modelled months; the wider monthly table below that (on the safe side)
    const r = intervalFor(mod, worst, modelled.length >= 12 ? 'year' : 'month', meta);
    if (r) range = { lo: obs + r.lo, hi: obs + r.hi };
  }
  const n = months.length;
  const out: PeriodStats = {
    period, months: n, known, total, range, observedShare: total ? obs / total : 0, sources,
    normal: null, ratio: null, rank: null, ranked: 0, perYear: null, years: [], peak, raw,
  };
  if (total === null) return out;

  if (n > 12) {
    const complete = new Map<number, number[]>();
    for (const p of points) {
      const v = valueOf(p, 'harmonized');
      if (v === null || p.yr < BASE_YEARS[0] || p.yr > BASE_YEARS[1]) continue;
      complete.set(p.yr, [...(complete.get(p.yr) ?? []), v]);
    }
    const normal = median([...complete.values()].filter((v) => v.length === 12).map(sum));
    out.perYear = (total * 12) / known;
    out.normal = normal;
    out.ratio = normal && normal > 0 ? out.perYear / normal : null;
    return out;
  }

  const known12 = knownMonthSet(points);
  const range0 = knownRange(points);
  if (!range0) return out;
  const firstYr = Math.floor(range0.first / 100) - 1, lastYr = Math.floor(range0.last / 100);
  const startYr = Math.floor(period.from / 100);
  for (let yr = firstYr; yr <= lastYr; yr++) {
    const shift = (yr - startYr) * 12;
    const p = { from: addMonths(period.from, shift), to: addMonths(period.to, shift) };
    const ms = periodMonths(p);
    if (!ms.some((m) => known12.has(m))) continue;
    const all = ms.every((m) => known12.has(m));
    const value = all ? sum(ms.map((m) => valueOf(byYm.get(m)!, 'harmonized') as number)) : null;
    out.years.push({ ...p, label: yearLabel(p), value, selected: shift === 0 });
  }
  const own = out.years.find((y) => y.selected);
  const inBase = (y: PeriodYear) => Math.floor(y.from / 100) >= BASE_YEARS[0] && Math.floor(y.to / 100) <= BASE_YEARS[1];
  out.normal = median(out.years.filter((y) => y.value !== null && inBase(y)).map((y) => y.value as number));
  out.ratio = out.normal && out.normal > 0 ? total / out.normal : null;
  const values = out.years.flatMap((y) => (y.value === null ? [] : [y.value]));
  out.ranked = values.length;
  // no rank when no year had any fire in these months (an area over the sea, for example): all would tie at first
  if (own && own.value !== null && values.some((v) => v > 0)) out.rank = 1 + values.filter((v) => v > (own.value as number)).length;
  return out;
}

/** Only the rows of a monthly CSV (from monthlyCsv) inside the period; the comment and header lines are kept. */
export function csvForPeriod(csv: string, period: Period): string {
  const keep = csv.split('\n').filter((line) => {
    if (!line || line.startsWith('#') || line.startsWith('year,')) return Boolean(line);
    const [y, m] = line.split(',', 2).map(Number);
    const ym = ymOf(y, m);
    return ym >= period.from && ym <= period.to;
  });
  return `${keep.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------
// The month picker of the Period tab: two buttons (From, To), each opening a year of twelve months

/** The period after one end is picked: a first month after the last moves the last with it; a last month before the
 *  first becomes the first (the old first becomes the last). */
export function pickEnd(p: Period, end: 'from' | 'to', ym: number): Period {
  if (end === 'from') return { from: ym, to: Math.max(ym, p.to) };
  return ym < p.from ? { from: ym, to: p.from } : { from: p.from, to: ym };
}

/** How a month looks in the picker: outside the record, an end of the period, inside it, or neither. */
export function monthState(ym: number, p: Period, min: number, max: number): 'out' | 'end' | 'in' | 'none' {
  if (ym < min || ym > max) return 'out';
  if (ym === p.from || ym === p.to) return 'end';
  return ym > p.from && ym < p.to ? 'in' : 'none';
}

/** The month a key moves to in the picker (arrows by one month or one row of four, as the grid shows them; Page keys
 *  by a year, Home and End to the ends of the year), kept inside min..max; null for other keys. */
export const PICKER_COLUMNS = 4;
export function monthKey(ym: number, key: string, min: number, max: number): number | null {
  const by: Record<string, number> = {
    ArrowLeft: -1, ArrowRight: 1, ArrowUp: -PICKER_COLUMNS, ArrowDown: PICKER_COLUMNS, PageUp: -12, PageDown: 12,
  };
  let next: number | null = null;
  if (key in by) next = addMonths(ym, by[key]);
  else if (key === 'Home') next = Math.floor(ym / 100) * 100 + 1;
  else if (key === 'End') next = Math.floor(ym / 100) * 100 + 12;
  if (next === null) return null;
  return Math.min(Math.max(next, min), max);
}
