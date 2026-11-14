// The trend map: each hexagon's trend of 2001 to 2025 from web/trend_l3.json and trend_l4.json (made by the
// report's rules, fireharmony/trendflags.py). A hexagon is tested only when it has at least `floor_per_year` (100)
// hotspots a year: below that, the model's small values before 2012 make falls that are not real. Many hexagons are
// tested at once, so a trend counts as clear only when its false discovery rate q (Benjamini and Hochberg, among the
// tested hexagons) is at most 0.05. Pure, so tested.

/** web/trend_l<level>.json: one entry per hexagon, in H3 order. */
export interface TrendFile {
  version: number;
  years: [number, number];
  h3: string[];
  pct: (number | null)[];      // % per decade (Sen's slope over the median yearly total)
  p: (number | null)[];        // Mann Kendall p value
  mean: (number | null)[];     // hotspots a year, 2001 to 2025
  q: (number | null)[];        // false discovery rate among the tested hexagons; null when not tested
  floor_per_year: number;
}

/** A trend is clear when q is at most this. */
export const TREND_Q = 0.05;
/** Edges of the colour classes, in % per decade (either way): under 15, 15 to 30, 30 to 60, 60 or more. */
export const TREND_EDGES = [15, 30, 60] as const;

/** Class of one hexagon: NOT_TESTED (too little fire), 0 tested without a clear trend, -4..-1 falling, 1..4 rising. */
export const NOT_TESTED = 100;
export const NOT_IN_FILE = 127;

export function trendClass(pct: number | null, q: number | null): number {
  if (q === null || !Number.isFinite(q)) return NOT_TESTED;
  if (q > TREND_Q || pct === null || !Number.isFinite(pct) || pct === 0) return 0;
  const a = Math.abs(pct);
  const k = 1 + TREND_EDGES.filter((e) => a >= e).length;
  return pct > 0 ? k : -k;
}

/** Index 0..8 on the diverging ramp (ANOMALY_VARS, blue to red) of a clear trend's class; null for the others. */
export function trendRampIndex(cls: number): number | null {
  if (cls === 0 || cls === NOT_TESTED || cls === NOT_IN_FILE || cls < -4 || cls > 4) return null;
  return 4 + cls;
}

export interface TrendCounts { hexagons: number; tested: number; rising: number; falling: number; flat: number; untested: number }

/** The counts of the file, as the report states them: tested, and rising or falling at q of 0.05 or less. */
export function trendCounts(f: Pick<TrendFile, 'h3' | 'pct' | 'q'>): TrendCounts {
  const c: TrendCounts = { hexagons: f.h3.length, tested: 0, rising: 0, falling: 0, flat: 0, untested: 0 };
  for (let i = 0; i < f.h3.length; i++) {
    const k = trendClass(f.pct[i], f.q[i]);
    if (k === NOT_TESTED) { c.untested++; continue; }
    c.tested++;
    if (k > 0) c.rising++; else if (k < 0) c.falling++; else c.flat++;
  }
  return c;
}

/** For each hexagon of a list (the map's universe), its row in the file, or -1. */
export function alignRows(universe: readonly string[], fileH3: readonly string[]): Int32Array {
  const at = new Map<string, number>();
  fileH3.forEach((h, i) => at.set(h, i));
  const out = new Int32Array(universe.length);
  for (let i = 0; i < universe.length; i++) out[i] = at.get(universe[i]) ?? -1;
  return out;
}

/** The class of each hexagon of the universe (NOT_IN_FILE where the file has no row). */
export function alignedClasses(rows: Int32Array, f: Pick<TrendFile, 'pct' | 'q'>): Int8Array {
  const out = new Int8Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    out[i] = r < 0 ? NOT_IN_FILE : trendClass(f.pct[r], f.q[r]);
  }
  return out;
}

/** A p or q value as the file has it (up to 5 decimals), without trailing zeros: 0.0036, 0.01234, 1. */
export function plainDecimal(v: number, digits = 5): string {
  if (!Number.isFinite(v)) return '';
  return String(Number(v.toFixed(digits)));
}

/** "+23.4%" or "−11.5%" (a real minus sign), one decimal as in the file. */
export function signedPct(v: number): string {
  const s = Math.abs(v).toFixed(1).replace(/\.0$/, '');
  return v > 0 ? `+${s}%` : v < 0 ? `−${s}%` : '0%';
}
