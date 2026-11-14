/**
 * Statistics of the burning calendar for the monthly series of one area. Pure functions, no DOM.
 *
 * They reproduce the Python pipeline, so the app and the published numbers agree:
 *  - fireharmony/analytics.py (pandas 3.1): climatology, anomalies, critical months, fire year start, trend;
 *  - pymannkendall 1.4.3: hamed_rao_modification_test and sens_slope, step by step;
 *  - scipy's normal distribution (the Cephes ndtr and ndtri routines), so p values match to the last digits.
 * __fixtures__/python_reference.json holds the Python results and stats.test.ts checks every case.
 */
import { BASE_YEARS } from './config';
import type {
  Anomaly, AreaSelection, IntervalKey, IntervalTable, MapMode, Meta, MonthlyPoint, Range, Scale, Season, Source, Trend,
} from './types';

/** A span of years, both ends included, e.g. BASE_YEARS. */
export type YearSpan = readonly [number, number];
export type Period = 'month' | 'year';
export type Lang = 'en';

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const isMonth = (mo: number): boolean => Number.isInteger(mo) && mo >= 1 && mo <= 12;
const inSpan = (yr: number, span: YearSpan): boolean => yr >= span[0] && yr <= span[1];

// ---------------------------------------------------------------------------------------------------------------
// Values

/**
 * The value of one month on the chosen scale: harmonized → h, modis → modis, raw → h (charts draw the raw
 * sensors on their own). An unknown month (src 3, or no value) gives null.
 */
export function valueOf(p: MonthlyPoint, scale: Scale): number | null {
  if (p.src === 3) return null;
  const v = scale === 'modis' ? p.modis : p.h;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Known values of each calendar month (index 0 = January), sorted ascending. Only years in `span` if given. */
function sortedByMonth(points: readonly MonthlyPoint[], scale: Scale, span?: YearSpan): Float64Array[] {
  const groups: number[][] = MONTHS.map(() => []);
  for (const p of points) {
    const v = valueOf(p, scale);
    if (v !== null && isMonth(p.mo) && (span === undefined || inSpan(p.yr, span))) groups[p.mo - 1].push(v);
  }
  return groups.map((g) => Float64Array.from(g).sort());
}

// ---------------------------------------------------------------------------------------------------------------
// Order statistics and sums, computed the way numpy and pandas do

/** Median as numpy and pandas: the middle value, or the mean of the two middle values. Null when empty. */
function medianOfSorted(s: ArrayLike<number>): number | null {
  const n = s.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function median(values: readonly number[]): number | null {
  return medianOfSorted(Float64Array.from(values).sort());
}

/**
 * Linear quantile as pandas (q from 0 to 1): the value at position q × (n - 1), interpolated between its two
 * neighbours. This is the pandas groupby formula; Series.quantile (numpy) gives the same result whenever the
 * fractional position is below 0.5, which covers the default cases here.
 */
function quantileOfSorted(s: ArrayLike<number>, q: number): number | null {
  const n = s.length;
  if (n === 0) return null;
  const pos = q * (n - 1);
  const lo = Math.floor(pos);
  const frac = pos - lo;
  if (frac === 0 || lo + 1 >= n) return s[Math.min(lo, n - 1)];
  return s[lo] + (s[lo + 1] - s[lo]) * frac;
}

/** How many sorted values are ≤ v (numpy searchsorted with side "right"). */
function countAtMost(s: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (s[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Sum in the given order with Kahan compensation, exactly as pandas groupby sum. */
function kahanSum(values: Iterable<number>): number {
  let sum = 0;
  let compensation = 0;
  for (const v of values) {
    const y = v - compensation;
    const t = sum + y;
    compensation = t - sum - y;
    if (Number.isNaN(compensation)) compensation = 0; // an infinite value: keep it instead of NaN
    sum = t;
  }
  return sum;
}

// ---------------------------------------------------------------------------------------------------------------
// The normal season and how each month compares with it

/** The normal of one calendar month over the base years (null when the base years have no value). */
export interface MonthNormal {
  mo: number;
  median: number | null;
  q25: number | null;
  q75: number | null;
}

/** Median and middle half (25% and 75% linear quantiles) of each calendar month over the base years. */
export function climatology(points: readonly MonthlyPoint[], scale: Scale, base: YearSpan = BASE_YEARS): MonthNormal[] {
  return sortedByMonth(points, scale, base).map((s, i) => ({
    mo: i + 1,
    median: medianOfSorted(s),
    q25: quantileOfSorted(s, 0.25),
    q75: quantileOfSorted(s, 0.75),
  }));
}

/**
 * Every point against the same calendar month: ratio to the base median (null when that median is 0),
 * percentile among the base years, and rank among all years with a value for that calendar month (1 = most
 * fire, ties share the best rank). `years` is how many values were ranked. An unknown month keeps the normal
 * (`median`) but has null ratio, percentile and rank.
 */
export function anomalies(points: readonly MonthlyPoint[], scale: Scale, base: YearSpan = BASE_YEARS): Anomaly[] {
  const baseValues = sortedByMonth(points, scale, base);
  const allValues = sortedByMonth(points, scale);
  const medians = baseValues.map(medianOfSorted);
  return points.map((p): Anomaly => {
    const empty = { yr: p.yr, mo: p.mo, value: null, ratio: null, percentile: null, rank: null };
    if (!isMonth(p.mo)) return { ...empty, median: null, years: 0 };
    const median = medians[p.mo - 1];
    const ranked = allValues[p.mo - 1];
    const value = valueOf(p, scale);
    if (value === null) return { ...empty, median, years: ranked.length };
    const inBase = baseValues[p.mo - 1];
    return {
      yr: p.yr,
      mo: p.mo,
      value,
      median,
      ratio: median !== null && median > 0 ? value / median : null,
      percentile: inBase.length > 0 ? (100 * countAtMost(inBase, value)) / inBase.length : null,
      rank: 1 + ranked.length - countAtMost(ranked, value),
      years: ranked.length,
    };
  });
}

/** The q quantile (linear) of all base months; months above it are critical. Null without base data. */
export function criticalThreshold(
  points: readonly MonthlyPoint[], scale: Scale, base: YearSpan = BASE_YEARS, q = 0.75,
): number | null {
  if (!(q >= 0 && q <= 1)) throw new RangeError(`quantile must be between 0 and 1, got ${q}`);
  const values: number[] = [];
  for (const p of points) {
    const v = valueOf(p, scale);
    if (v !== null && isMonth(p.mo) && inSpan(p.yr, base)) values.push(v);
  }
  return quantileOfSorted(Float64Array.from(values).sort(), q);
}

/**
 * The usual critical period (as CONAE): the calendar months whose value is above `criticalThreshold` in at
 * least `share` of the base years, in calendar order.
 */
export function criticalMonths(
  points: readonly MonthlyPoint[], scale: Scale, base: YearSpan = BASE_YEARS, q = 0.75, share = 0.5,
): number[] {
  const threshold = criticalThreshold(points, scale, base, q);
  if (threshold === null) return [];
  return sortedByMonth(points, scale, base).flatMap((s, i) => {
    const above = s.length - countAtMost(s, threshold);
    return s.length > 0 && above / s.length >= share ? [i + 1] : [];
  });
}

/** The fire year starts the month after the quietest calendar month (lowest median; the first one on ties). */
export function fireYearStart(points: readonly MonthlyPoint[], scale: Scale, base: YearSpan = BASE_YEARS): number {
  const medians = climatology(points, scale, base).map((c) => c.median ?? 0);
  let quietest = 0;
  medians.forEach((m, i) => {
    if (m < medians[quietest]) quietest = i;
  });
  return ((quietest + 1) % 12) + 1;
}

/** Fire year start, critical months, and the peak month (highest median; null when the normal is no fire). */
export function season(points: readonly MonthlyPoint[], scale: Scale, base: YearSpan = BASE_YEARS): Season {
  const medians = climatology(points, scale, base).map((c) => c.median ?? 0);
  let peak = 0;
  medians.forEach((m, i) => {
    if (m > medians[peak]) peak = i;
  });
  return {
    fireYearStartMonth: fireYearStart(points, scale, base),
    criticalMonths: criticalMonths(points, scale, base),
    peakMonth: medians[peak] > 0 ? peak + 1 : null,
  };
}

/** The latest month with a known value (the latest complete month), or null when there is none. */
export function latestCompleteMonth(points: readonly MonthlyPoint[], scale: Scale = 'harmonized'): MonthlyPoint | null {
  let latest: MonthlyPoint | null = null;
  for (const p of points) {
    if (valueOf(p, scale) === null) continue;
    if (latest === null || p.yr * 100 + p.mo > latest.yr * 100 + latest.mo) latest = p;
  }
  return latest;
}

// ---------------------------------------------------------------------------------------------------------------
// Yearly totals

export interface AnnualTotal {
  yr: number;
  total: number | null; // sum of the known months; null when no month is known
  months: number;       // how many months have a known value
  complete: boolean;    // all 12 months are known
  src: Source;          // worst (largest) source among the known months, for intervalFor; 3 when none is known
}

interface KnownMonth { mo: number; v: number; src: Source }

/** Known months of each year, in month order. Years without any known month are kept with an empty list. */
function knownMonthsByYear(points: readonly MonthlyPoint[], scale: Scale): Map<number, KnownMonth[]> {
  const years = new Map<number, KnownMonth[]>();
  for (const p of points) {
    if (!isMonth(p.mo)) continue;
    const known = years.get(p.yr) ?? [];
    years.set(p.yr, known);
    const v = valueOf(p, scale);
    if (v !== null) known.push({ mo: p.mo, v, src: p.src });
  }
  for (const known of years.values()) known.sort((a, b) => a.mo - b.mo);
  return years;
}

/** Total of each year (sorted by year), summed in month order as pandas does. */
export function annualTotals(points: readonly MonthlyPoint[], scale: Scale): AnnualTotal[] {
  return [...knownMonthsByYear(points, scale)]
    .sort(([a], [b]) => a - b)
    .map(([yr, known]) => ({
      yr,
      total: known.length > 0 ? kahanSum(known.map((k) => k.v)) : null,
      months: known.length,
      complete: known.length === 12,
      src: known.reduce<Source>((worst, k) => (k.src > worst ? k.src : worst), known.length > 0 ? 0 : 3),
    }));
}

export interface YearToDate {
  yr: number;
  lastMonth: number;     // January to this month are counted
  total: number;
  normal: number | null; // median over the base years of the total of the same months
  ratio: number | null;  // total / normal (null when the normal is 0 or unknown)
}

/** The year of the latest complete month, from January to that month, against the same months of the base years. */
export function yearToDate(points: readonly MonthlyPoint[], scale: Scale, base: YearSpan = BASE_YEARS): YearToDate | null {
  const latest = latestCompleteMonth(points, scale);
  if (latest === null) return null;
  return yearToMonth(points, scale, latest.yr, latest.mo, base);
}

/**
 * January to `mo` of year `yr`, against the same months of the base years (the normal is the median of those
 * totals over the base years that know all of these months). Null when that year does not know every month from
 * January to `mo` (the first year of the record starts in November: a sum of two months is not "January to November").
 */
export function yearToMonth(
  points: readonly MonthlyPoint[], scale: Scale, yr: number, mo: number, base: YearSpan = BASE_YEARS,
): YearToDate | null {
  if (!isMonth(mo)) return null;
  const totals = new Map<number, { total: number; months: number }>();
  for (const [y, known] of knownMonthsByYear(points, scale)) {
    const upTo = known.filter((k) => k.mo <= mo);
    totals.set(y, { total: kahanSum(upTo.map((k) => k.v)), months: upTo.length });
  }
  const own = totals.get(yr);
  if (own === undefined || own.months < mo) return null;
  const normals = [...totals].flatMap(([y, t]) => (inSpan(y, base) && t.months === mo ? [t.total] : []));
  const normal = median(normals);
  return { yr, lastMonth: mo, total: own.total, normal, ratio: normal !== null && normal > 0 ? own.total / normal : null };
}

// ---------------------------------------------------------------------------------------------------------------
// Trend: Mann-Kendall with the Hamed and Rao (1998) correction, a step by step port of pymannkendall 1.4.3

export type TrendLabel = 'increasing' | 'decreasing' | 'no trend';

export interface MannKendall {
  trend: TrendLabel;
  h: boolean;        // the trend is significant at level alpha
  p: number;         // two sided p value
  z: number;         // normalized test statistic
  tau: number;       // Kendall's tau
  s: number;         // Mann-Kendall score
  var_s: number;     // variance of s, after the correction for autocorrelation
  slope: number;     // Sen's slope, per step
  intercept: number; // intercept of the Kendall-Theil line
}

/** Theil and Sen slope (median of all pairwise slopes) and the Conover intercept, as pymannkendall.sens_slope. */
export function sensSlope(x: readonly number[]): { slope: number; intercept: number } {
  const slopes: number[] = [];
  for (let i = 0; i < x.length - 1; i++) {
    for (let j = i + 1; j < x.length; j++) {
      const d = (x[j] - x[i]) / (j - i);
      if (!Number.isNaN(d)) slopes.push(d);
    }
  }
  const slope = median(slopes) ?? NaN;
  const knownAt = x.flatMap((v, i) => (Number.isNaN(v) ? [] : [i]));
  const middle = median(x.filter((v) => !Number.isNaN(v))) ?? NaN;
  return { slope, intercept: middle - (median(knownAt) ?? NaN) * slope };
}

/** Mann-Kendall score: pairs going up minus pairs going down. */
function mkScore(x: readonly number[]): number {
  let s = 0;
  for (let k = 0; k < x.length - 1; k++) {
    for (let j = k + 1; j < x.length; j++) {
      if (x[j] > x[k]) s += 1;
      else if (x[j] < x[k]) s -= 1;
    }
  }
  return s;
}

/** Variance of the score with the correction for tied values. */
function varianceS(x: readonly number[]): number {
  const n = x.length;
  const counts = new Map<number, number>();
  for (const v of x) counts.set(v, (counts.get(v) ?? 0) + 1);
  let ties = 0;
  for (const tp of counts.values()) ties += tp * (tp - 1) * (2 * tp + 5);
  return (n * (n - 1) * (2 * n + 5) - ties) / 18;
}

/** Ranks from 1; tied values share the mean of their ranks (scipy rankdata, method "average"). */
function rankAverage(x: readonly number[]): number[] {
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const ranks = new Array<number>(x.length);
  for (let start = 0; start < order.length;) {
    let end = start + 1;
    while (end < order.length && x[order[end]] === x[order[start]]) end++;
    for (let k = start; k < end; k++) ranks[order[k]] = 0.5 * (start + end + 1);
    start = end;
  }
  return ranks;
}

/**
 * Autocorrelation at lags 0..nlags (autocovariance divided by n), as pymannkendall's __acf. Used on ranks only:
 * their deviations from the mean are multiples of 0.5, so every sum is exact and matches numpy to the last bit.
 */
function autocorrelation(x: readonly number[], nlags: number): number[] {
  const n = x.length;
  const mean = x.reduce((a, b) => a + b, 0) / n;
  const y = x.map((v) => v - mean);
  const acov: number[] = [];
  for (let k = 0; k <= nlags; k++) {
    let sum = 0;
    for (let t = 0; t + k < n; t++) sum += y[t] * y[t + k];
    acov.push(sum / n);
  }
  return acov.map((c) => c / acov[0]);
}

/**
 * Modified Mann-Kendall trend test of Hamed and Rao (1998), exactly as pymannkendall.hamed_rao_modification_test
 * with lag = None: missing values (NaN) are skipped, the series is detrended with Sen's slope, ranked, and every
 * lag whose autocorrelation is outside the 1 - alpha band widens the variance of the score.
 */
export function mannKendallHamedRao(series: readonly number[], alpha = 0.05): MannKendall {
  const x = series.filter((v) => !Number.isNaN(v));
  const n = x.length;
  if (n < 3) throw new RangeError(`the Mann-Kendall test needs at least 3 values, got ${n}`);
  const s = mkScore(x);
  const tau = s / (0.5 * n * (n - 1));
  // pymannkendall estimates the slope on the series as given, then detrends the series without missing values
  const { slope, intercept } = sensSlope(series);
  const acf = autocorrelation(rankAverage(x.map((v, i) => v - (i + 1) * slope)), n - 1);
  const zCritical = normalQuantile(1 - alpha / 2);
  const bound = zCritical / Math.sqrt(n);
  let sni = 0;
  for (let i = 1; i < n; i++) {
    if (!(acf[i] <= bound && acf[i] >= -bound)) sni += (n - i) * (n - i - 1) * (n - i - 2) * acf[i];
  }
  const varS = varianceS(x) * (1 + (2 / (n * (n - 1) * (n - 2))) * sni);
  const z = s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  const h = Math.abs(z) > zCritical;
  const label: TrendLabel = z < 0 && h ? 'decreasing' : z > 0 && h ? 'increasing' : 'no trend';
  return { trend: label, h, p, z, tau, s, var_s: varS, slope, intercept };
}

/** The original Mann-Kendall test (no autocorrelation correction), as pymannkendall.original_test. */
export function mannKendallOriginal(series: readonly number[], alpha = 0.05): MannKendall {
  const x = series.filter((v) => !Number.isNaN(v));
  const n = x.length;
  if (n < 3) throw new RangeError(`the Mann-Kendall test needs at least 3 values, got ${n}`);
  const s = mkScore(x);
  const tau = s / (0.5 * n * (n - 1));
  const { slope, intercept } = sensSlope(series);
  const varS = varianceS(x);
  const z = s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  const zCritical = normalQuantile(1 - alpha / 2);
  const h = Math.abs(z) > zCritical;
  const label: TrendLabel = z < 0 && h ? 'decreasing' : z > 0 && h ? 'increasing' : 'no trend';
  return { trend: label, h, p, z, tau, s, var_s: varS, slope, intercept };
}

const MIN_TREND_YEARS = 8;

/**
 * Trend of the yearly totals over `years` (full years only: a year with an unknown month is skipped):
 * Mann-Kendall with the Hamed and Rao correction (alpha 0.05), falling back to the original test when the
 * correction gives an impossible variance, and Sen's slope. pct_per_decade is the relative change per decade from
 * Sen's slope of log(1 + yearly total), so it can never fall below -100% (same as the Python pipeline).
 * Fewer than 8 full years, or no fire at all, gives 'not enough data'.
 */
export function trend(points: readonly MonthlyPoint[], scale: Scale, years: YearSpan = BASE_YEARS): Trend {
  const totals = annualTotals(points, scale).flatMap((t) =>
    t.complete && t.total !== null && inSpan(t.yr, years) ? [t.total] : []);
  const n = totals.length;
  if (n < MIN_TREND_YEARS || totals.every((v) => v === 0)) {
    return { years: n, direction: 'not enough data', p: null, sen_slope_per_year: null, pct_per_decade: null };
  }
  let mk = mannKendallHamedRao(totals);
  if (!(mk.var_s > 0) || !Number.isFinite(mk.p)) mk = mannKendallOriginal(totals);
  const slope = Number.isFinite(mk.slope) ? mk.slope : null;
  const logSlope = sensSlope(totals.map((v) => Math.log1p(v))).slope;
  return {
    years: n,
    direction: mk.trend,
    p: Number.isFinite(mk.p) ? mk.p : null,
    sen_slope_per_year: slope,
    pct_per_decade: Number.isFinite(logSlope) ? 100 * (Math.exp(10 * logSlope) - 1) : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// What a trend can say: the report's rules (fireharmony/trendflags.py) for any place, drawn area or hexagon

/** Under this many hotspots a year (the mean of the full years 2001 to 2025) no trend is read: the model's small
 *  values before 2012 make falls that are not real. The same floor keeps hexagons out of the trend map's test. */
export const TREND_FLOOR_PER_YEAR = 100;
/** From this many hotspots a year a named place is tested with all the others (web/places.json, trend_tested);
 *  between the two floors a trend is shown with a caution. */
export const TREND_TESTED_PER_YEAR = 1000;
/** A trend found among many places tested together counts as clear when its false discovery rate q is at most this. */
export const TREND_FAMILY_Q = 0.05;
/** A place with at least this share of its fire on barren land (%, web/places.json barren_pct) is not tested. */
export const TREND_BARREN_MAX_PCT = 50;

/** Hotspots a year: the mean of the full yearly totals in `years` (2001 to 2025). Null without a full year. */
export function meanPerYear(points: readonly MonthlyPoint[], scale: Scale, years: YearSpan = BASE_YEARS): number | null {
  const totals = annualTotals(points, scale).flatMap((t) => (t.complete && t.total !== null && inSpan(t.yr, years) ? [t.total] : []));
  return totals.length ? kahanSum(totals) / totals.length : null;
}

/** How a place did when tested together with all the places of its kind (Benjamini and Hochberg). The world and the
 *  continents are not in a family: each is tested on its own. Kind 'area' (a drawn area or a city circle, which has
 *  only its own test) appears only `pending`, while its series loads. */
export interface FamilyTest {
  kind: 'world' | 'continent' | 'country' | 'state' | 'hexagon' | 'area';
  tested: boolean;            // false: too little fire, or mostly fire on bare land (always false for the world and continents)
  q: number | null;           // false discovery rate; null when not tested
  barrenPct: number | null;   // % of the fire on barren land (named places)
  of: number;                 // how many were tested together
  /** The trend of 2001 to 2025 as the published file has it (web/places.json for a named place, web/trend_l3.json or
   *  trend_l4.json for a hexagon), with its class by the rule of Rankings (rankings/model.ts trendClassOf) or of the
   *  trend map (explorer/trend.ts trendClass). Over the whole record the Explorer then says what those pages say. */
  published?: PublishedTrend | null;
  /** The test, or the series of the place, is still loading: no verdict yet (the trend card waits, rather than show a
   *  word that may change, or one worked out from the series of the place shown before). */
  pending?: boolean;
}

/** The class of a trend verdict, with the names of the Dashboard (components/dashboard/verdict.ts):
 *  rising or falling (it passes the rules), not clear, not tested (a named place under the floor of its kind or with
 *  most of its fire on bare land), too little fire for any trend (under 100 hotspots a year), too few years, and
 *  pending while the test of a place loads. */
export type VerdictClass = 'rising' | 'falling' | 'unclear' | 'untested' | 'little' | 'none' | 'pending';

/** A published trend: the class it has on the other pages and the numbers they show. */
export interface PublishedTrend {
  cls: Exclude<VerdictClass, 'pending'>;
  why: 'little' | 'barren' | null;               // why a named place is not tested
  direction: Trend['direction'];                 // Mann Kendall on its own (p < 0.05)
  pct: number | null;                            // % per decade
  p: number | null;
  mean: number | null;                           // hotspots a year, 2001 to 2025
}

/** What the trend card may say: nothing (too few years), no trend (too little fire), a trend with a caution, or
 *  a trend in full; and for a tested place, whether the rise or fall still holds among all the places tested. */
export type TrendReading = 'none' | 'little' | 'caution' | 'full';

export interface TrendVerdict {
  trend: Trend;                                  // the published numbers over the whole record, else the series' own
  mean: number | null;                           // hotspots a year, 2001 to 2025
  reading: TrendReading;
  clear: boolean;                                // its own test finds a rise or a fall, and there is enough fire to read it
  family: 'holds' | 'fails' | 'barren' | null;   // only for a place in a family whose own test is clear (or bare land)
  cls: VerdictClass;                             // the one verdict: the same word on every page
  why: 'little' | 'barren' | null;               // why a place is not tested (cls 'untested')
  published: boolean;                            // the class and numbers come from the published file
}

/** True when the full years of `points` in `years` are exactly the base period (2001 to 2025), the span of every
 *  published trend. */
function wholeRecord(points: readonly MonthlyPoint[], scale: Scale, years: YearSpan): boolean {
  const full = annualTotals(points, scale).filter((t) => t.complete && t.total !== null && inSpan(t.yr, years)).map((t) => t.yr);
  return full.length > 0 && full[0] === BASE_YEARS[0] && full[full.length - 1] === BASE_YEARS[1];
}

const readingOf = (direction: Trend['direction'], mean: number | null): TrendReading =>
  (direction === 'not enough data' || mean === null ? 'none'
    : mean < TREND_FLOOR_PER_YEAR ? 'little' : mean < TREND_TESTED_PER_YEAR ? 'caution' : 'full');

const moving = (d: Trend['direction']): boolean => d === 'increasing' || d === 'decreasing';

/**
 * The trend of yearly fire with the rules of what it can support (see the constants above), as one verdict.
 *
 * Over the whole record on the harmonized scale, a named place or a hexagon with a published trend (`family.published`)
 * takes the class and the numbers of that file, so the Explorer, the trend map, the Dashboard and Rankings say the same
 * word. A hexagon of the trend file passed the test of all the hexagons of its size, so its rise or fall is read in
 * full, as the trend map reads it (no caution under 1,000 hotspots a year). Any other area (a drawn area, a city
 * circle), and any other span, has only its own test: under 100 hotspots a year no trend is read, from 100 to 1,000 a
 * rise or a fall is shown with a caution. The world and the continents are tested on their own, and need 1,000
 * hotspots a year as any named place. While `family` is pending (its file, or the place's own series, loads) the
 * verdict is 'pending'.
 */
export function trendVerdict(points: readonly MonthlyPoint[], scale: Scale, given: FamilyTest | null = null,
  years: YearSpan = BASE_YEARS): TrendVerdict {
  const own = trend(points, scale, years);
  const ownMean = meanPerYear(points, scale, years);
  const whole = scale === 'harmonized' && wholeRecord(points, scale, years);
  if (given?.pending && whole) {
    return { trend: own, mean: ownMean, reading: 'none', clear: false, family: null, cls: 'pending', why: null, published: false };
  }
  const family = given?.kind === 'area' ? null : given;     // a drawn area or a circle: its own test only
  const pub = whole ? family?.published ?? null : null;
  if (pub) {
    const tr: Trend = pub.cls === 'none' ? { ...own, direction: 'not enough data', p: null, pct_per_decade: null }
      : { ...own, direction: pub.direction, p: pub.p ?? own.p, pct_per_decade: pub.pct ?? own.pct_per_decade };
    const mean = pub.mean ?? ownMean;
    // (a hexagon tested with all the hexagons of its size: read in full, as on the trend map)
    const hexTested = family?.kind === 'hexagon' && family.tested && tr.direction !== 'not enough data';
    const reading: TrendReading = pub.cls === 'none' ? 'none' : pub.cls === 'little' ? 'little'
      : hexTested ? 'full' : readingOf(tr.direction, mean);
    const clear = (reading === 'caution' || reading === 'full') && moving(tr.direction);
    const inFamily = family !== null && family.kind !== 'world' && family.kind !== 'continent';
    const fam: TrendVerdict['family'] = !inFamily ? null
      : pub.cls === 'untested' && pub.why === 'barren' ? 'barren'
        : !clear || !family.tested ? null
          : pub.cls === 'rising' || pub.cls === 'falling' ? 'holds' : pub.cls === 'unclear' ? 'fails' : null;
    return { trend: tr, mean, reading, clear, family: fam, cls: pub.cls, why: pub.why, published: true };
  }
  // only its own test (and, for a place in a family, the family's result as the caller gives it)
  const reading = readingOf(own.direction, ownMean);
  const clear = (reading === 'caution' || reading === 'full') && moving(own.direction);
  const dir: VerdictClass = own.direction === 'increasing' ? 'rising' : 'falling';
  if (family && whole && (family.kind === 'world' || family.kind === 'continent')) {
    // tested on its own, with the floor of every named place (Rankings, rankings/model.ts trendClassOf)
    const little = reading !== 'none' && (ownMean ?? 0) < TREND_TESTED_PER_YEAR;
    const cls: VerdictClass = reading === 'none' ? 'none' : little ? 'untested' : clear ? dir : 'unclear';
    return { trend: own, mean: ownMean, reading, clear, family: null, cls, why: little ? 'little' : null, published: false };
  }
  let fam: TrendVerdict['family'] = null;
  if (family && whole && family.kind !== 'world' && family.kind !== 'continent') {
    if (clear && family.tested) fam = family.q !== null && family.q <= TREND_FAMILY_Q ? 'holds' : 'fails';
    else if (clear && family.kind !== 'hexagon' && (family.barrenPct ?? 0) >= TREND_BARREN_MAX_PCT) fam = 'barren';
  }
  const cls: VerdictClass = reading === 'none' ? 'none' : reading === 'little' ? 'little'
    : fam === 'barren' ? 'untested' : fam === 'fails' ? 'unclear' : clear ? dir : 'unclear';
  return { trend: own, mean: ownMean, reading, clear, family: fam, cls, why: fam === 'barren' ? 'barren' : null, published: false };
}

// ---------------------------------------------------------------------------------------------------------------
// Normal distribution: ports of the Cephes routines behind scipy.special (ndtr, erf, erfc, ndtri), so that
// p = 2 (1 - Φ(|z|)) rounds exactly like scipy even far in the tail.

const polevl = (x: number, c: readonly number[]): number => c.reduce((acc, ci) => acc * x + ci);
const p1evl = (x: number, c: readonly number[]): number => c.reduce((acc, ci) => acc * x + ci, 1);

const ERFC_P = [2.46196981473530512524e-10, 5.64189564831068821977e-1, 7.46321056442269912687e0,
  4.86371970985681366614e1, 1.96520832956077098242e2, 5.26445194995477358631e2, 9.34528527171957607540e2,
  1.02755188689515710272e3, 5.57535335369399327526e2];
const ERFC_Q = [1.32281951154744992508e1, 8.67072140885989742329e1, 3.54937778887819891062e2,
  9.75708501743205489753e2, 1.82390916687909736289e3, 2.24633760818710981792e3, 1.65666309194161350182e3,
  5.57535340817727675546e2];
const ERFC_R = [5.64189583547755073984e-1, 1.27536670759978104416e0, 5.01905042251180477414e0,
  6.16021097993053585195e0, 7.40974269950448939160e0, 2.97886665372100240670e0];
const ERFC_S = [2.26052863220117276590e0, 9.39603524938001434673e0, 1.20489539808096656605e1,
  1.70814450747565897222e1, 9.60896809063285878198e0, 3.36907645100081516050e0];
const ERF_T = [9.60497373987051638749e0, 9.00260197203842689217e1, 2.23200534594684319226e3,
  7.00332514112805075473e3, 5.55923013010394962768e4];
const ERF_U = [3.35617141647503099647e1, 5.21357949780152679795e2, 4.59432382970980127987e3,
  2.26290000613890934246e4, 4.92673942608635921086e4];
const MAXLOG = 7.09782712893383996843e2;

function erf(x: number): number {
  if (Math.abs(x) > 1) return 1 - erfc(x);
  const z = x * x;
  return (x * polevl(z, ERF_T)) / p1evl(z, ERF_U);
}

function erfc(a: number): number {
  const x = Math.abs(a);
  if (x < 1) return 1 - erf(a);
  const z = -a * a;
  if (z < -MAXLOG) return a < 0 ? 2 : 0;
  const y = (Math.exp(z) * (x < 8 ? polevl(x, ERFC_P) : polevl(x, ERFC_R))) / (x < 8 ? p1evl(x, ERFC_Q) : p1evl(x, ERFC_S));
  if (y === 0) return a < 0 ? 2 : 0;
  return a < 0 ? 2 - y : y;
}

/** Standard normal cumulative distribution Φ(a), as scipy.stats.norm.cdf (Cephes ndtr). */
export function normalCdf(a: number): number {
  if (Number.isNaN(a)) return NaN;
  const x = a * Math.SQRT1_2;
  const z = Math.abs(x);
  if (z < Math.SQRT1_2) return 0.5 + 0.5 * erf(x);
  const y = 0.5 * erfc(z);
  return x > 0 ? 1 - y : y;
}

const NDTRI_P0 = [-5.99633501014107895267e1, 9.80010754185999661536e1, -5.66762857469070293439e1,
  1.39312609387279679503e1, -1.23916583867381258016e0];
const NDTRI_Q0 = [1.95448858338141759834e0, 4.67627912898881538453e0, 8.63602421390890590575e1,
  -2.25462687854119370527e2, 2.00260212380060660359e2, -8.20372256168333339912e1, 1.59056225126211695515e1,
  -1.18331621121330003142e0];
const NDTRI_P1 = [4.05544892305962419923e0, 3.15251094599893866154e1, 5.71628192246421288162e1,
  4.40805073893200834700e1, 1.46849561928858024014e1, 2.18663306850790267539e0, -1.40256079171354495875e-1,
  -3.50424626827848203418e-2, -8.57456785154685413611e-4];
const NDTRI_Q1 = [1.57799883256466749731e1, 4.53907635128879210584e1, 4.13172038254672030440e1,
  1.50425385692907503408e1, 2.50464946208309415979e0, -1.42182922854787788574e-1, -3.80806407691578277194e-2,
  -9.33259480895457427372e-4];
const NDTRI_P2 = [3.23774891776946035970e0, 6.91522889068984211695e0, 3.93881025292474443415e0,
  1.33303460815807542389e0, 2.01485389549179081538e-1, 1.23716634817820021358e-2, 3.01581553508235416007e-4,
  2.65806974686737550832e-6, 6.23974539184983293730e-9];
const NDTRI_Q2 = [6.02427039364742014255e0, 3.67983563856160859403e0, 1.37702099489081330271e0,
  2.16236993594496635890e-1, 1.34204006088543189037e-2, 3.28014464682127739104e-4, 2.89247864745380683936e-6,
  6.79019408009981274425e-9];
const SQRT_2PI = 2.50662827463100050242e0;
const EXP_MINUS_2 = 0.13533528323661269189;

/** Quantile of the standard normal distribution, as scipy.stats.norm.ppf (Cephes ndtri). */
export function normalQuantile(q: number): number {
  if (q === 0) return -Infinity;
  if (q === 1) return Infinity;
  if (!(q > 0 && q < 1)) return NaN;
  const upper = q > 1 - EXP_MINUS_2;
  const y = upper ? 1 - q : q;
  if (y > EXP_MINUS_2) {
    const d = y - 0.5;
    const d2 = d * d;
    return (d + d * ((d2 * polevl(d2, NDTRI_P0)) / p1evl(d2, NDTRI_Q0))) * SQRT_2PI;
  }
  const x = Math.sqrt(-2 * Math.log(y));
  const x0 = x - Math.log(x) / x;
  const z = 1 / x;
  const x1 = x < 8 ? (z * polevl(z, NDTRI_P1)) / p1evl(z, NDTRI_Q1) : (z * polevl(z, NDTRI_P2)) / p1evl(z, NDTRI_Q2);
  const r = x0 - x1;
  return upper ? r : -r;
}

// ---------------------------------------------------------------------------------------------------------------
// 90% range of a modelled total

const INTERVAL_KEYS: Record<1 | 2, Record<Period, IntervalKey>> = {
  1: { month: 'terra_aqua_month', year: 'terra_aqua_year' },
  2: { month: 'terra_only_month', year: 'terra_only_year' },
};

/**
 * 90% range of a harmonized total, from the interval table of its source: null where the value is observed
 * (src 0) or unknown (src 3). For a year that mixes sources pass the worst (largest) src (AnnualTotal.src).
 */
export function intervalFor(
  total: number | null, src: Source, period: Period, meta: Pick<Meta, 'intervals'>,
): Range | null {
  if (total === null || !Number.isFinite(total) || (src !== 1 && src !== 2)) return null;
  const table: IntervalTable | undefined = meta.intervals[INTERVAL_KEYS[src][period]]; // may be missing in old files
  const band = table?.bands.find((b) => b.mu_min <= total && (b.mu_max === null || total < b.mu_max));
  if (band === undefined) return null;
  return { lo: Math.max(0, total * (1 + band.q_lo)), hi: total * (1 + band.q_hi) };
}

// ---------------------------------------------------------------------------------------------------------------
// Fire brief: a few plain sentences about the area

const LOCALE = 'en-GB';
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'] as const;

const formatNumber = (v: number, options: Intl.NumberFormatOptions): string => new Intl.NumberFormat(LOCALE, options).format(v);

/** A modelled count with its range, which keeps its decimals: 3.4, 812, 15,200, 1.33 million. */
function formatCount(v: number): string {
  if (v >= 1e6) return `${formatNumber(v / 1e6, { maximumSignificantDigits: 3 })} million`;
  if (v >= 1e4) return formatNumber(v, { maximumSignificantDigits: 3 });
  return formatNumber(v, { maximumFractionDigits: v < 10 ? 1 : 0 });
}

// ---------------------------------------------------------------------------------------------------------------
// One number style for the Explorer. A count is 'compact' in the strip of numbers and the brief (3 significant
// figures: 65,700, 1.33 million) and 'exact' in the detail cards, the Period tab and the CSV files (whole numbers:
// 65,657). People read whole hotspots: a value under 10 that is not whole is "about 2", one under 0.5 "less than 1"
// (only a modelled value next to its range keeps its decimals). A ratio to normal has one decimal below 20 ("13.8
// times", "13.8×") and none above; a value below normal is a percentage ("6% below normal"). A trend is a whole percent
// in the strip ("−76%") and has one decimal in the details ("−75.8%").

export type CountStyle = 'compact' | 'exact';

const WHOLE = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** A count of hotspots for people, in the style of where it is shown (see above). */
export function countText(v: number, style: CountStyle = 'compact'): string {
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a < 10 && Math.abs(a - Math.round(a)) > 1e-6) return a < 0.5 ? 'less than 1' : `about ${WHOLE.format(a)}`;
  if (style === 'compact') {
    if (a >= 1e6) return `${formatNumber(v / 1e6, { maximumSignificantDigits: 3 })} million`;
    if (a >= 1e4) return formatNumber(v, { maximumSignificantDigits: 3 });
  }
  return WHOLE.format(v);
}

/** "1 hotspot", "65,700 hotspots", "about 2 hotspots". */
export function hotspotsText(v: number, style: CountStyle = 'compact'): string {
  const count = countText(v, style);
  return count === '1' || count === 'less than 1' || count === 'about 1' ? `${count} hotspot` : `${count} hotspots`;
}

/** A ratio to normal as a number: one decimal below 20 ("13.8", "0.4"), whole from 20 ("25"). */
export function ratioText(ratio: number): string {
  return formatNumber(ratio, { maximumFractionDigits: ratio < 19.95 ? 1 : 0 });
}

/** A trend in % per decade, signed: whole in the strip ("−76%"), one decimal in the details ("−75.8%"). */
export function trendText(pct: number, where: 'strip' | 'detail' = 'detail', signed = true): string {
  const digits = where === 'strip' ? 0 : 1;
  const body = formatNumber(Math.abs(pct), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const zero = Number(body.replace(/,/g, '')) === 0;
  return `${signed && !zero ? (pct > 0 ? '+' : '−') : ''}${body}%`;
}

/** "1 row", "12 rows": a noun with its count. */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${WHOLE.format(n)} ${n === 1 ? one : many}`;
}

const formatPercent = (pct: number): string => trendText(pct, 'detail', false);

function hotspots(v: number): string {
  return hotspotsText(v, 'compact');
}

/** "6% below normal for October", given the reference words ("normal for October"). */
function comparedWith(ratio: number, normalWords: string): string {
  const pct = Math.round(Math.abs(ratio - 1) * 100);
  if (ratio >= 1.95) return `${ratioText(ratio)} times ${normalWords}`;
  if (pct < 5) return `close to ${normalWords}`;
  return `${pct}% ${ratio > 1 ? 'above' : 'below'} ${normalWords}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Places with little fire. Before 2012 the record is modelled from MODIS, and the model puts a little fire in months
// MODIS saw none (Svalbard gets about 750 a year in 2003 to 2011, then 0 to 3 under VIIRS). Whether a place has little
// fire is read from the years VIIRS observed (2013 to 2025, every month source 0), never from the mean of 2001 to 2025,
// which those modelled months inflate.

/** Under this many hotspots a year in the observed VIIRS years, a place has too little fire to judge a normal month. */
export const LITTLE_FIRE_PER_YEAR = 10;
const OBSERVED_YEARS: YearSpan = [2013, 2025];

/** The mean of the yearly totals of 2013 to 2025 over the years VIIRS observed in full (null without such a year). */
export function observedMean(points: readonly MonthlyPoint[], scale: Scale = 'harmonized'): number | null {
  const totals = new Map<number, { v: number; n: number; ok: boolean }>();
  for (const p of points) {
    if (!inSpan(p.yr, OBSERVED_YEARS)) continue;
    const v = valueOf(p, scale);
    const t = totals.get(p.yr) ?? { v: 0, n: 0, ok: true };
    if (v === null || p.src !== 0) t.ok = false; else { t.v += v; t.n += 1; }
    totals.set(p.yr, t);
  }
  const full = [...totals.values()].filter((t) => t.ok && t.n === 12).map((t) => t.v);
  return full.length ? kahanSum(full) / full.length : null;
}

/** True for a place with too little fire to judge a normal month (under 10 hotspots a year while VIIRS observed). */
export function littleFire(points: readonly MonthlyPoint[], scale: Scale = 'harmonized'): boolean {
  const m = observedMean(points, scale);
  // (a place that never had any fire is not one: its months are simply none, as usual)
  return m !== null && m < LITTLE_FIRE_PER_YEAR && points.some((p) => (valueOf(p, scale) ?? 0) > 0);
}

/** A modelled month where MODIS saw no fire at all, yet the model gives some (hatched in the burning calendar). */
export function modelledWithoutModis(p: MonthlyPoint): boolean {
  return (p.src === 1 || p.src === 2) && p.modis === 0 && (p.h ?? 0) > 0;
}

/** The note under the brief and the calendar of a place with little fire. */
export const LITTLE_FIRE_NOTE = 'Little fire burns here. Before 2012 this record is modelled, and MODIS saw none in most months, so compare years with care.';
/** What replaces the rank, the fire season and "fire where none is normal" for such a place. */
export const LITTLE_FIRE_NORMAL = 'Too little fire here to judge a normal month.';

const ORDINAL_SUFFIX: Partial<Record<number, string>> = { 1: 'st', 2: 'nd', 3: 'rd' };

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st ... */
function englishOrdinal(n: number): string {
  const tens = n % 100;
  return `${n}${tens >= 11 && tens <= 13 ? 'th' : ORDINAL_SUFFIX[n % 10] ?? 'th'}`;
}

function monthSentence(name: string, a: Anomaly, range: Range | null, little = false): string {
  const month = MONTH_NAMES[a.mo - 1];
  const value = a.value ?? 0;
  const when = `In ${month} ${a.yr}, ${name}`;
  if (value === 0 && a.median === 0) return `${when} had no hotspots, as usual for ${month}.`;
  // (a modelled month keeps its decimals next to its range)
  let count = range !== null ? `${formatCount(value)} ${formatCount(value) === '1' ? 'hotspot' : 'hotspots'}` : hotspots(value);
  if (range !== null) count += ` (likely ${formatCount(range.lo)} to ${formatCount(range.hi)})`;
  const had = `${when} had ${count}`;
  if (a.median === null || little) return `${had}.`;
  if (a.ratio === null) return `${had}, while ${month} usually has none.`;
  return `${had}, ${comparedWith(a.ratio, `normal for ${month}`)}.`;
}

function rankSentence(a: Anomaly): string | null {
  if (a.rank === null || a.years < 2 || !a.value) return null;
  const month = MONTH_NAMES[a.mo - 1];
  const { rank, years } = a;
  if (rank === 1) return `It was the highest ${month} in ${years} years.`;
  if (rank === years) return `It was the lowest ${month} in ${years} years.`;
  return `It was the ${englishOrdinal(rank)} highest ${month} in ${years} years.`;
}

function yearSentence(y: YearToDate, little = false): string | null {
  if (y.lastMonth < 2) return null; // only one month: the month sentence already says it
  const whole = y.lastMonth === 12;
  const month = MONTH_NAMES[y.lastMonth - 1];
  const when = whole ? `In ${y.yr} as a whole, there were` : `From January to ${month} ${y.yr}, there were`;
  if (y.total === 0 && y.normal === 0) return `${when} no hotspots, as usual.`;
  const had = `${when} ${hotspots(y.total)}`;
  if (y.normal === null || little) return `${had}.`;
  if (y.ratio === null) return `${had}, while this time of year usually has none.`;
  return `${had}, ${comparedWith(y.ratio, `normal for ${whole ? 'a whole year' : 'this time of year'}`)}.`;
}

const FAMILY_WORDS: Record<FamilyTest['kind'], string> = {
  world: 'places', continent: 'continents', country: 'countries', state: 'states', hexagon: 'hexagons of this size',
  area: 'areas',
};

function trendSentence(t: Trend, years: YearSpan | null,
  verdict: Pick<TrendVerdict, 'reading' | 'family' | 'cls' | 'why'> = { reading: 'full', family: null, cls: 'unclear', why: null },
  family: FamilyTest | null = null): string | null {
  const reading = verdict.reading;
  if (verdict.cls === 'pending') return null;     // the test of the place is still loading: no sentence that may change
  // (a hexagon the trend file leaves out has too little fire, not too few years)
  const little = verdict.cls === 'little';
  if (years === null || (!little && t.direction === 'not enough data')) return 'There are too few full years to tell whether fire is rising or falling.';
  const kinds = family ? FAMILY_WORDS[family.kind] : 'places';
  if (verdict.cls === 'untested' && verdict.why === 'little' && family && family.kind !== 'hexagon') {
    // a named place under the floor of every named place: not tested, as in Rankings
    return `There is too little fire here (under ${new Intl.NumberFormat(LOCALE).format(TREND_TESTED_PER_YEAR)} hotspots a year) to test a trend${family.kind === 'country' || family.kind === 'state' ? ` with the other ${kinds}` : ''}.`;
  }
  if (little || reading === 'little') return `There is too little fire here (under ${TREND_FLOOR_PER_YEAR} hotspots a year) for a reliable trend.`;
  const span = `From ${years[0]} to ${years[1]}`;
  if (t.direction === 'no trend') return `${span}, yearly fire shows no clear rise or fall.`;
  // a rise or a fall that does not hold once all the places of its kind are tested together is not called clear
  const fails = verdict.family === 'fails' && family !== null;
  const barren = verdict.cls === 'untested' && verdict.why === 'barren';
  const moved = `${span}, yearly fire ${reading === 'caution' || fails || barren ? '' : 'clearly '}${t.direction === 'increasing' ? 'rose' : 'fell'}`;
  const by = t.pct_per_decade === null ? '' : `, by about ${formatPercent(Math.abs(t.pct_per_decade))} every ten years`;
  if (fails) {
    const all = `${new Intl.NumberFormat(LOCALE).format(family.of)} ${kinds}`;
    return `${moved}${by}, but once all ${all} with enough fire are tested together this ${t.direction === 'increasing' ? 'rise' : 'fall'} is not clear.`;
  }
  if (barren) return `${moved}${by}, but most of the fire here is on bare land, so the trend is not tested with the other ${kinds}.`;
  return reading === 'caution' ? `${moved}${by}, but with this little fire the trend is less certain.` : `${moved}${by}.`;
}

/** A false discovery rate as the panel writes it ("= 0.01", "< 0.001"), never rounded across the threshold of
 *  TREND_FAMILY_Q: q = 0.0523 reads "= 0.052", not "= 0.05". */
export function formatQ(q: number): string {
  if (q < 0.001) return '< 0.001';
  let digits = q < 0.01 ? 3 : 2;
  while (digits < 4 && (Number(q.toFixed(digits)) <= TREND_FAMILY_Q) !== (q <= TREND_FAMILY_Q)) digits += 1;
  return `= ${q.toFixed(digits)}`;
}

/**
 * Two to four short plain sentences about an area: one month against its normal and its rank, the year up to
 * that month, and the trend of yearly fire over the full years of the base period. The month is `ym` (yyyymm, the
 * month on the map) when it has a known value, else the latest complete month. A modelled month (src 1 or 2) also
 * gets its 90% range from `meta`.
 */
export function fireBrief(
  name: string, points: readonly MonthlyPoint[], scale: Scale, meta: Pick<Meta, 'intervals'>, ym: number | null = null,
  family: FamilyTest | null = null,
): string {
  const area = name.trim().toLowerCase() === 'world' ? 'the world' : name;
  const latest = latestCompleteMonth(points, scale);
  if (latest === null) return `There is no data for ${area} yet.`;
  const all = anomalies(points, scale);
  const asked = ym === null ? -1 : points.findIndex((p) => p.yr * 100 + p.mo === ym);
  const at = asked >= 0 && all[asked].value !== null ? asked : points.indexOf(latest);
  const month = points[at], current = all[at];
  const range = scale === 'modis' ? null : intervalFor(current.value, month.src, 'month', meta);
  // a place with little fire: no rank and no "usually none" (the model's months before 2012 make them meaningless)
  const little = littleFire(points, scale);
  const sentences = [monthSentence(area, current, range, little), little ? LITTLE_FIRE_NORMAL : rankSentence(current)];
  const ytd = yearToMonth(points, scale, month.yr, month.mo);
  if (ytd !== null) sentences.push(yearSentence(ytd, little));
  const fullYears = annualTotals(points, scale).filter((t) => t.complete && inSpan(t.yr, BASE_YEARS)).map((t) => t.yr);
  const span: YearSpan | null = fullYears.length > 0 ? [fullYears[0], fullYears[fullYears.length - 1]] : null;
  const verdict = trendVerdict(points, scale, family);
  sentences.push(trendSentence(verdict.trend, span, verdict, family));
  // a year after the trend's years that runs far against it (Central Kalimantan in 2026: 5.3 times normal while
  // its fire fell by about 76% per decade)
  if (span !== null && breaksTrend(ytd, verdict, span[1])) sentences.push('This year breaks with the trend.');
  return sentences.filter((s): s is string => s !== null).join(' ');
}

/** True when the year so far (January to the month on the map, in a year after 2025) runs far against a clear trend:
 *  above 2 times normal while fire falls, or below half of normal while it rises (the brief then says so). */
export function breaksTrend(ytd: YearToDate | null, verdict: Pick<TrendVerdict, 'cls'>, lastTrendYear: number = BASE_YEARS[1]): boolean {
  if (!ytd || ytd.ratio === null || ytd.yr <= lastTrendYear) return false;
  return (verdict.cls === 'falling' && ytd.ratio > 2) || (verdict.cls === 'rising' && ytd.ratio < 0.5);
}

/** "6% below normal", "close to normal", "2.4 times normal": the wording of the brief, for any ratio. */
export function comparedWithNormal(ratio: number): string {
  return comparedWith(ratio, 'normal');
}

/** Direction of a ratio as the brief words it: 'flat' when it rounds to within 5% of normal. */
export function ratioDirection(ratio: number): 'up' | 'down' | 'flat' {
  if (ratio >= 1.95) return 'up';
  if (Math.round(Math.abs(ratio - 1) * 100) < 5) return 'flat';
  return ratio > 1 ? 'up' : 'down';
}

// ---------------------------------------------------------------------------------------------------------------
// The same months on another scale

/** Raw detections of every satellite added up (what a naive join of the sensors gives). */
export function rawTotal(p: MonthlyPoint): number {
  return p.t + p.a + p.s + p.n + p.j;
}

/**
 * The months of an area with `h` holding the value on the chosen scale, so every function above can read them
 * as 'harmonized': modis → the MODIS scale, raw → the raw detections of all satellites added up. Unknown months
 * (src 3) stay unknown.
 */
export function onScale(points: readonly MonthlyPoint[], scale: Scale): readonly MonthlyPoint[] {
  if (scale === 'harmonized') return points;
  return points.map((p) => ({ ...p, h: p.src === 3 ? null : scale === 'modis' ? p.modis : rawTotal(p) }));
}

// ---------------------------------------------------------------------------------------------------------------
// Colour classes of the burning calendar and the map: 9 steps of the ember scale (fire amount, log steps) or of the
// anomaly scale (against normal, log ratio centred on normal). See DESIGN.md.

export const STEPS = 9;

/** A log colour scale from lo to hi (both above 0). */
export interface LogScale { lo: number; hi: number }

const NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The nearest round number (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a power of ten) below or above v. */
export function niceNumber(v: number, dir: 'down' | 'up'): number {
  if (!(v > 0) || !Number.isFinite(v)) return v;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  const f = v / base;
  const pick = dir === 'down'
    ? [...NICE_STEPS].reverse().find((n) => n <= f * (1 + 1e-9)) ?? 1
    : NICE_STEPS.find((n) => n >= f * (1 - 1e-9)) ?? 10;
  return Number((pick * base).toPrecision(3));
}

/**
 * The colour scale of one area from its own months: log steps between the low and high quantiles (2% and 98%) of
 * the months with fire, rounded out to round numbers and at least `minFactor` wide, so the season and the bad
 * years show for the world, a country or a small state alike. Null when no month has fire.
 */
export function countScale(values: Iterable<number | null>, qLo = 0.02, qHi = 0.98, minFactor = 3): LogScale | null {
  const known: number[] = [];
  for (const v of values) if (v !== null && v > 0 && Number.isFinite(v)) known.push(v);
  if (known.length === 0) return null;
  const sorted = Float64Array.from(known).sort();
  let lo = quantileOfSorted(sorted, qLo) ?? sorted[0];
  let hi = quantileOfSorted(sorted, qHi) ?? sorted[sorted.length - 1];
  if (hi / lo < minFactor) {
    const middle = Math.sqrt(lo * hi);
    lo = middle / Math.sqrt(minFactor);
    hi = middle * Math.sqrt(minFactor);
  }
  return { lo: niceNumber(lo, 'down'), hi: niceNumber(hi, 'up') };
}

/** Class 0..8 of a count on a log scale (values outside lo..hi take the end classes); -1 for no fire. */
export function countClass(v: number, scale: LogScale): number {
  if (!(v > 0)) return -1;
  const t = Math.log(v / scale.lo) / Math.log(scale.hi / scale.lo);
  return Math.max(0, Math.min(STEPS - 1, Math.floor(t * STEPS)));
}

/** The STEPS + 1 values at the edges of the classes, from lo to hi. */
export function classEdges(scale: LogScale): number[] {
  return Array.from({ length: STEPS + 1 }, (_, k) => scale.lo * (scale.hi / scale.lo) ** (k / STEPS));
}

/** Round limits of the ratio scale: the top class starts near "limit times normal", the bottom near 1 / limit. */
export const RATIO_LIMITS = [1.25, 1.5, 2, 3, 4, 8, 16] as const;

/**
 * The ratio limit of one area from its own months: the smallest round limit that covers `q` (90%) of its months'
 * distance from normal on a log scale. Months without fire where fire is normal count as very far. Pairs are
 * [value, normal]; pairs without a normal above 0 are skipped. 4 when nothing can be compared.
 */
export function ratioLimit(pairs: Iterable<readonly [number | null, number | null]>, q = 0.9): number {
  const far: number[] = [];
  for (const [value, normal] of pairs) {
    if (value === null || normal === null || !(normal > 0) || !Number.isFinite(value)) continue;
    far.push(value > 0 ? Math.abs(Math.log2(value / normal)) : Infinity);
  }
  if (far.length === 0) return 4;
  far.sort((a, b) => a - b);
  const reach = far[Math.min(far.length - 1, Math.ceil(q * (far.length - 1)))];
  return RATIO_LIMITS.find((limit) => Math.log2(limit) >= reach - 1e-9) ?? RATIO_LIMITS[RATIO_LIMITS.length - 1];
}

/**
 * Class 0..8 of a month against its normal, on a log scale centred on normal (4): 0 at 1 / limit or less, 8 at
 * `limit` times normal or more. Fire where the normal is no fire is 8; no fire where none is normal is 4.
 * Null when the value or the normal is unknown.
 */
export function ratioClass(value: number | null, normal: number | null, limit: number): number | null {
  if (value === null || normal === null || !Number.isFinite(value) || !Number.isFinite(normal)) return null;
  const middle = (STEPS - 1) / 2;
  if (!(normal > 0)) return value > 0 ? STEPS - 1 : middle;
  if (!(value > 0)) return 0;
  const r = Math.log2(value / normal) / Math.log2(limit);
  return Math.max(0, Math.min(STEPS - 1, Math.round(middle + r * middle)));
}

// ---------------------------------------------------------------------------------------------------------------
// The critical period as runs of months

/** Calendar months grouped into runs, wrapping from December to January: [8, 9, 10] → [[8, 10]]; [1, 2, 12] → [[12, 2]]. */
export function monthRuns(months: readonly number[]): [number, number][] {
  const set = new Set(months.filter(isMonth));
  if (set.size === 0) return [];
  if (set.size === 12) return [[1, 12]];
  const next = (m: number) => (m === 12 ? 1 : m + 1);
  const runs: [number, number][] = [];
  for (const m of MONTHS) {
    if (!set.has(m) || set.has(m === 1 ? 12 : m - 1)) continue;
    let end = m;
    while (set.has(next(end))) end = next(end);
    runs.push([m, end]);
  }
  return runs;
}

// ---------------------------------------------------------------------------------------------------------------
// Links to the Explorer: "#/?area=<kind>:<id>" opens a named place (the contract shared by every page), for
// example "#/?area=country:IDN". The Explorer also writes drawn areas ("circle:lat,lon,km",
// "polygon:lon,lat;lon,lat;...", "hex:<H3 index>"), the month ("&month=202610"; "2026-10" is read too) and the
// view: "&mode=count|anomaly|trend&view=2d|3d&scale=harmonized|modis|raw". Defaults are left out of the links we write.

export type ViewKind = '2d' | '3d';

export type LinkArea =
  | { type: 'named'; kind: 'world' | 'continent' | 'country' | 'state'; id: string }
  | { type: 'circle'; lat: number; lon: number; radiusKm: number }
  | { type: 'polygon'; ring: [number, number][] }
  | { type: 'hex'; h3: string };

/** The panel's tabs a link can open (the Overview is the default and is left out). */
export type LinkTab = 'calendar' | 'period' | 'why' | 'outlook';
const LINK_TABS: readonly LinkTab[] = ['calendar', 'period', 'why', 'outlook'];

export interface ExplorerLink {
  area: LinkArea | null;               // null: no area in the link
  month: { yr: number; mo: number } | null;
  mode: MapMode | null;                // null: not in the link
  view: ViewKind | null;
  scale: Scale | null;
  tab: LinkTab | null;                 // "&tab=calendar"; null: the Overview
  period: { from: number; to: number } | null;   // "&from=201507&to=201511" (yyyymm): the months of the Period tab
  cal: 'full' | null;                  // "&cal=full": the burning calendar at full size
  search: boolean;                     // "&search=1": open the place search with the focus in it
  invalid: boolean;                    // the link had a part that could not be read
}

/** The view parts of a link we write; a hexagon selection is written as "hex:<index>". */
export interface LinkView {
  mode?: MapMode; view?: ViewKind; scale?: Scale; hex?: string | null; compare?: readonly string[];
  tab?: LinkTab | 'overview' | null; period?: { from: number; to: number } | null; cal?: 'full' | null;
}

/** True for the Explorer's own hashes ("", "#", "#/", "#/?area=..."), false for "#/haze" and the other pages. */
export function isExplorerHash(hash: string): boolean {
  return (hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '') === '';
}

const MAX_LINK_RADIUS_KM = 5000;
const H3_TEXT = /^[0-9a-f]{15}$/;

function parseLinkArea(text: string): LinkArea | null {
  const colon = text.indexOf(':');
  const kind = (colon < 0 ? text : text.slice(0, colon)).trim().toLowerCase();
  const rest = colon < 0 ? '' : text.slice(colon + 1).trim();
  if (kind === 'world') return { type: 'named', kind: 'world', id: 'WORLD' };
  if (kind === 'continent' || kind === 'country' || kind === 'state') {
    return rest === '' ? null : { type: 'named', kind, id: kind === 'country' ? rest.toUpperCase() : rest };
  }
  if (kind === 'hex') {
    const h3 = rest.toLowerCase();
    return H3_TEXT.test(h3) ? { type: 'hex', h3 } : null;
  }
  if (kind === 'circle') {
    const parts = rest.split(',').map((s) => Number(s.trim()));
    if (parts.length !== 3) return null;
    const [lat, lon, radiusKm] = parts;
    const ok = Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(radiusKm)
      && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && radiusKm > 0 && radiusKm <= MAX_LINK_RADIUS_KM;
    return ok ? { type: 'circle', lat, lon, radiusKm } : null;
  }
  if (kind === 'polygon') {
    const ring: [number, number][] = [];
    for (const pair of rest.split(';')) {
      const xy = pair.split(',').map((s) => Number(s.trim()));
      if (xy.length !== 2 || !xy.every(Number.isFinite) || Math.abs(xy[1]) > 90 || Math.abs(xy[0]) > 540) return null;
      ring.push([xy[0], xy[1]]);
    }
    return ring.length >= 3 && ring.length <= 500 ? { type: 'polygon', ring } : null;
  }
  return null;
}

/** "202610" or "2026-10" as { yr: 2026, mo: 10 }; null when it is not a month from 1900 to 2199 (a readable month
 *  outside the record is read, so the Explorer can show the nearest month and say so). */
export function parseLinkMonth(text: string): { yr: number; mo: number } | null {
  const m = /^(\d{4})-?(\d{1,2})$/.exec(text.trim());
  if (!m || (m[2].length === 1 && !text.includes('-'))) return null;
  const yr = Number(m[1]), mo = Number(m[2]);
  return yr >= 1900 && yr <= 2199 && isMonth(mo) ? { yr, mo } : null;
}

/** The months of the Period tab in a link: both ends, as yyyymm, the first not after the last; null when they are not
 *  in the link; 'bad' when they cannot be read. */
function parseLinkPeriod(params: URLSearchParams): { from: number; to: number } | null | 'bad' {
  const a = params.get('from'), b = params.get('to');
  if (a === null && b === null) return null;
  const from = a === null ? null : parseLinkMonth(a), to = b === null ? null : parseLinkMonth(b);
  if (!from || !to) return 'bad';
  const f = from.yr * 100 + from.mo, t = to.yr * 100 + to.mo;
  return f <= t ? { from: f, to: t } : 'bad';
}

/** Read an Explorer hash such as "#/?area=country:IDN&month=201509&mode=anomaly&view=3d&scale=modis&tab=calendar". */
export function parseExplorerLink(hash: string): ExplorerLink {
  const out: ExplorerLink = {
    area: null, month: null, mode: null, view: null, scale: null, tab: null, period: null, cal: null, search: false, invalid: false,
  };
  const q = hash.indexOf('?');
  if (q < 0) return out;
  const params = new URLSearchParams(hash.slice(q + 1));
  const area = params.get('area');
  if (area !== null) {
    out.area = parseLinkArea(area);
    if (out.area === null) out.invalid = true;
  }
  const month = params.get('month');
  if (month !== null) {
    out.month = parseLinkMonth(month);
    if (out.month === null) out.invalid = true;
  }
  const mode = params.get('mode');
  if (mode !== null) {
    if (mode === 'count' || mode === 'anomaly' || mode === 'trend') out.mode = mode;
    else out.invalid = true;
  }
  const view = params.get('view')?.toLowerCase() ?? null;
  if (view !== null) {
    if (view === '2d' || view === '3d') out.view = view;
    else out.invalid = true;
  }
  const scale = params.get('scale');
  if (scale !== null) {
    if (scale === 'harmonized' || scale === 'modis' || scale === 'raw') out.scale = scale;
    else out.invalid = true;
  }
  const tab = params.get('tab')?.toLowerCase() ?? null;
  if (tab !== null && tab !== 'overview') {
    if ((LINK_TABS as readonly string[]).includes(tab)) out.tab = tab as LinkTab;
    else out.invalid = true;
  }
  const period = parseLinkPeriod(params);
  if (period === 'bad') out.invalid = true; else out.period = period;
  const cal = params.get('cal');
  if (cal !== null) {
    if (cal.toLowerCase() === 'full') out.cal = 'full';
    else out.invalid = true;
  }
  const search = params.get('search');
  if (search !== null) {
    if (search === '1' || search === 'true' || search === '') out.search = true;
    else out.invalid = true;
  }
  return out;
}

const linkNumber = (v: number): string => String(Math.round(v * 1e4) / 1e4);

/**
 * The Explorer hash of a selection, a month and the view: "#/" for the world on its defaults. Only what differs
 * from the defaults (fire count, 2D, harmonized) is written.
 */
export function explorerLink(sel: AreaSelection, month: { yr: number; mo: number } | null = null, opts: LinkView = {}): string {
  const parts: string[] = [];
  if (opts.hex) {
    parts.push(`area=hex:${opts.hex}`);
  } else if (sel.type === 'named') {
    if (sel.area.kind !== 'world') parts.push(`area=${sel.area.kind}:${encodeURIComponent(sel.area.id)}`);
  } else if (sel.type === 'circle') {
    parts.push(`area=circle:${linkNumber(sel.lat)},${linkNumber(sel.lon)},${linkNumber(sel.radiusKm)}`);
  } else {
    const ring = sel.ring.length > 3 && sel.ring[0][0] === sel.ring[sel.ring.length - 1][0]
      && sel.ring[0][1] === sel.ring[sel.ring.length - 1][1] ? sel.ring.slice(0, -1) : sel.ring;
    parts.push(`area=polygon:${ring.map(([lon, lat]) => `${linkNumber(lon)},${linkNumber(lat)}`).join(';')}`);
  }
  if (month) parts.push(`month=${month.yr}${String(month.mo).padStart(2, '0')}`);
  if (opts.mode && opts.mode !== 'count') parts.push(`mode=${opts.mode}`);
  if (opts.view && opts.view !== '2d') parts.push(`view=${opts.view}`);
  if (opts.scale && opts.scale !== 'harmonized') parts.push(`scale=${opts.scale}`);
  if (opts.tab && opts.tab !== 'overview') parts.push(`tab=${opts.tab}`);
  if (opts.tab === 'period' && opts.period) parts.push(`from=${opts.period.from}`, `to=${opts.period.to}`);
  if (opts.cal === 'full') parts.push('cal=full');
  if (opts.compare?.length) parts.push(`compare=${opts.compare.map((k) => compareKeyText(k)).join(',')}`);
  return parts.length ? `#/?${parts.join('&')}` : '#/';
}

// ---------------------------------------------------------------------------------------------------------------
// Places pinned to compare: "&compare=country:BRA,state:IDN-1931" (named places and hexagons, at most three)

export const COMPARE_MAX = 3;

/** A pinned place as in the link: "country:BRA", "state:IDN-1931", "world:WORLD", "hex:8365a3fffffffff", or a city
 *  circle "circle:-2.2096,113.91,50" (latitude, longitude and radius in km, 4 decimals, as in "area=circle:"). */
export type CompareKey = string;

/** The compare key of a circle, rounded as links write it. */
export const circleKey = (lat: number, lon: number, radiusKm: number): CompareKey =>
  `circle:${linkNumber(lat)},${linkNumber(lon)},${linkNumber(radiusKm)}`;

const compareKeyText = (k: CompareKey): string => {
  const at = k.indexOf(':');
  if (at < 0 || k.startsWith('circle:')) return k;     // (a circle's commas are part of the key: see parseCompare)
  return `${k.slice(0, at)}:${encodeURIComponent(k.slice(at + 1))}`;
};

/** The parts of a compare list: split at each comma that starts a new key ("circle:-2.2,113.9,50,state:IDN-1931"), so
 *  the commas inside a circle key stay in it. */
const compareParts = (text: string): string[] => text.split(/,(?=\s*(?:world|continent|country|state|hex|circle|polygon)\s*:)/i);

/** The pinned places of a hash, in order, without repeats; null when the link has no "compare". A part that cannot
 *  be read (a drawn shape, an unknown kind, more than three places) makes `invalid` true and is left out. */
export function parseCompare(hash: string): { keys: CompareKey[]; invalid: boolean; tooMany?: boolean } | null {
  const q = hash.indexOf('?');
  if (q < 0) return null;
  const text = new URLSearchParams(hash.slice(q + 1)).get('compare');
  if (text === null) return null;
  const keys: CompareKey[] = [];
  let invalid = false, tooMany = false;
  for (const part of compareParts(text)) {
    if (!part.trim()) continue;
    const a = parseLinkArea(part);
    const key = a?.type === 'named' ? `${a.kind}:${a.id}` : a?.type === 'hex' ? `hex:${a.h3}`
      : a?.type === 'circle' ? circleKey(a.lat, a.lon, a.radiusKm) : null;
    if (key === null) { invalid = true; continue; }
    if (keys.includes(key)) continue;
    if (keys.length >= COMPARE_MAX) { tooMany = true; continue; }
    keys.push(key);
  }
  return tooMany ? { keys, invalid, tooMany } : { keys, invalid };
}

/** Which parts of an Explorer hash could not be read: the place, the month, or the view (colours, 2D or 3D, scale). */
export function linkProblems(hash: string): ('area' | 'month' | 'view')[] {
  const q = hash.indexOf('?');
  if (q < 0) return [];
  const params = new URLSearchParams(hash.slice(q + 1));
  const link = parseExplorerLink(hash);
  const out: ('area' | 'month' | 'view')[] = [];
  if (params.get('area') !== null && link.area === null) out.push('area');
  if (params.get('month') !== null && link.month === null) out.push('month');
  const tab = params.get('tab')?.toLowerCase();
  if ((params.get('mode') !== null && link.mode === null) || (params.get('view') !== null && link.view === null)
    || (params.get('scale') !== null && link.scale === null) || (tab !== undefined && tab !== 'overview' && link.tab === null)
    || ((params.get('from') !== null || params.get('to') !== null) && link.period === null)
    || (params.get('cal') !== null && link.cal === null)) out.push('view');
  return out;
}

/** "2.4×", "+35%", "−6%" or "normal": a value against its normal, short enough for a pill (the words of
 *  comparedWithNormal, in fewer letters). */
export function shortAgainstNormal(ratio: number): string {
  const pct = Math.round(Math.abs(ratio - 1) * 100);
  if (ratio >= 1.95) return `${ratioText(ratio)}×`;
  if (pct < 5) return 'normal';
  return `${ratio > 1 ? '+' : '−'}${pct}%`;
}

// ---------------------------------------------------------------------------------------------------------------
// Months as yyyymm numbers (the timeline, the player and the links)

/** yyyymm of a year and a month. */
export const ymOf = (yr: number, mo: number): number => yr * 100 + mo;

/** yyyymm plus n months (n may be negative). */
export function addMonths(ym: number, n: number): number {
  const t = Math.floor(ym / 100) * 12 + (ym % 100) - 1 + n;
  return Math.floor(t / 12) * 100 + (((t % 12) + 12) % 12) + 1;
}

/** Months from a to b (b - a): 0 for the same month, 12 for one year later. */
export function monthsBetween(a: number, b: number): number {
  return (Math.floor(b / 100) - Math.floor(a / 100)) * 12 + (b % 100) - (a % 100);
}

/** The first and the last month with a known value (src not 3), as yyyymm; null when no month is known. */
export function knownRange(points: readonly MonthlyPoint[]): { first: number; last: number } | null {
  let first: number | null = null, last: number | null = null;
  for (const p of points) {
    if (p.src === 3) continue;
    const ym = ymOf(p.yr, p.mo);
    if (first === null || ym < first) first = ym;
    if (last === null || ym > last) last = ym;
  }
  return first === null || last === null ? null : { first, last };
}

/**
 * The month `by` months from `ym`, kept within first..last. With `wrap`, a step past the last month starts again at
 * the first one (and the other way round), as the player does.
 */
export function stepMonth(ym: number, by: number, first: number, last: number, wrap = false): number {
  const span = monthsBetween(first, last) + 1;
  if (span <= 0) return ym;
  const at = monthsBetween(first, ym) + by;
  if (wrap) return addMonths(first, ((at % span) + span) % span);
  return addMonths(first, Math.max(0, Math.min(span - 1, at)));
}

/** "OCT 2026": the short month name in capitals, for the timeline. */
export function monthCode(ym: number, shortNames: readonly string[]): string {
  return `${(shortNames[(ym % 100) - 1] ?? '').toUpperCase()} ${Math.floor(ym / 100)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Heights of the 3D hexagons

/** Height of an extruded hexagon in metres: the square root of value / cap (capped at 1) times `maxMetres`, 0 without fire. */
export function hexHeight(value: number, cap: number, maxMetres: number): number {
  if (!(value > 0) || !(cap > 0)) return 0;
  return Math.sqrt(Math.min(1, value / cap)) * maxMetres;
}

// ---------------------------------------------------------------------------------------------------------------
// Size of a drawn area

/** Area of a ring of [lon, lat] points in km² (spherical, as in Chamberlain and Duquette 2007; same as geo.ts). */
export function ringAreaKm2(ring: readonly (readonly [number, number])[]): number {
  const R = 6371.007180918475;
  const rad = (d: number) => (d * Math.PI) / 180;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % ring.length];
    total += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((total * R * R) / 2);
}

// ---------------------------------------------------------------------------------------------------------------
// The monthly record as CSV

export interface CsvOptions {
  citation: string;                     // the citation line (kept in English)
  sourceLabel: (src: Source) => string; // e.g. "VIIRS observed"
  years?: YearSpan;                     // only these years (default: every month)
}

const csvNumber = (v: number | null, digits = 1): string => {
  if (v === null || !Number.isFinite(v)) return '';
  const f = 10 ** digits;
  return String(Math.round(v * f) / f);
};

const csvText = (s: string): string => `"${s.replaceAll('"', '""')}"`;

/**
 * The monthly record of an area as CSV: harmonized hotspots with the 90% range where modelled, the normal of that
 * calendar month (median of 2001 to 2025) and the month against it, the source, the MODIS scale and the raw
 * detections of each satellite. Comment lines start with #.
 */
export function monthlyCsv(name: string, points: readonly MonthlyPoint[], meta: Pick<Meta, 'intervals'>, opts: CsvOptions): string {
  const normals = climatology(points, 'harmonized');
  const span = opts.years;
  const rows = points.filter((p) => span === undefined || inSpan(p.yr, span));
  const head = [
    `# Fire Harmony monthly record: ${name.replace(/[\r\n]+/g, ' ')}`,
    '# harmonized = hotspots per month on the NOAA-20 VIIRS scale; range_low and range_high = 90% range where modelled (empty where observed)',
    `# normal = median of the same calendar month over ${BASE_YEARS[0]} to ${BASE_YEARS[1]}; times_normal = harmonized / normal`,
    '# modis_scale = the same record on the MODIS scale; terra to noaa21 = raw detections of each satellite; empty values = no data yet',
    `# ${opts.citation}`,
    'year,month,harmonized,range_low,range_high,normal,times_normal,source,modis_scale,terra,aqua,suomi_npp,noaa20,noaa21',
  ];
  const lines = rows.map((p) => {
    const v = valueOf(p, 'harmonized');
    const range = intervalFor(v, p.src, 'month', meta);
    const normal = normals[p.mo - 1]?.median ?? null;
    const ratio = v !== null && normal !== null && normal > 0 ? v / normal : null;
    const known = p.src !== 3;
    return [p.yr, p.mo, csvNumber(v), csvNumber(range?.lo ?? null), csvNumber(range?.hi ?? null), csvNumber(normal),
      csvNumber(ratio, 2), csvText(opts.sourceLabel(p.src)), csvNumber(valueOf(p, 'modis')),
      ...(known ? [p.t, p.a, p.s, p.n, p.j] : ['', '', '', '', ''])].join(',');
  });
  return `${[...head, ...lines].join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------
// Map helpers: outlines that cross the date line

type LonLatPair = [number, number];

/** A ring with continuous longitudes: a step of more than 180 degrees is taken the short way (past 180 or -180). */
export function unwrapRing(ring: readonly (readonly number[])[]): LonLatPair[] {
  const out: LonLatPair[] = [];
  let offset = 0;
  let prev: number | null = null;
  for (const [lon, lat] of ring) {
    if (prev !== null) {
      const d = lon + offset - prev;
      if (d > 180) offset -= 360;
      else if (d < -180) offset += 360;
    }
    const x = lon + offset;
    out.push([x, lat]);
    prev = x;
  }
  return out;
}

/**
 * Bounds [[west, south], [east, north]] of rings, the short way round the globe: rings on both sides of the date
 * line give a west near 170 and an east past 180. Null without points.
 */
export function ringsBounds(rings: readonly (readonly (readonly number[])[])[]): [LonLatPair, LonLatPair] | null {
  const arcs: LonLatPair[] = [];
  let south = 90, north = -90;
  for (const ring of rings) {
    let w = Infinity, e = -Infinity;
    for (const [lon, lat] of ring) {
      w = Math.min(w, lon); e = Math.max(e, lon);
      south = Math.min(south, lat); north = Math.max(north, lat);
    }
    if (!Number.isFinite(w)) continue;
    if (e - w >= 360) return [[-180, south], [180, north]];
    const shift = Math.floor((w + 180) / 360) * 360;   // west into [-180, 180)
    if (e - shift > 180) arcs.push([w - shift, 180], [-180, e - shift - 360]);
    else arcs.push([w - shift, e - shift]);
  }
  if (arcs.length === 0) return null;
  arcs.sort((a, b) => a[0] - b[0]);
  const merged: LonLatPair[] = [];
  for (const arc of arcs) {
    const last = merged[merged.length - 1];
    if (last && arc[0] <= last[1]) last[1] = Math.max(last[1], arc[1]);
    else merged.push([arc[0], arc[1]]);
  }
  // leave out the largest empty stretch of longitude (the one across the date line counts too)
  let west = merged[0][0], east = merged[merged.length - 1][1];
  let gap = merged[0][0] + 360 - merged[merged.length - 1][1];
  for (let i = 1; i < merged.length; i++) {
    const g = merged[i][0] - merged[i - 1][1];
    if (g > gap) { gap = g; west = merged[i][0]; east = merged[i - 1][1] + 360; }
  }
  return [[west, south], [east, north]];
}
