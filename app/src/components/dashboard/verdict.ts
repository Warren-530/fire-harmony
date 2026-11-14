// What a trend may be called, the same on the Dashboard and in Rankings.
//
// - A country or a state over the whole record (every month, 2001 to 2025, harmonized) gets the verdict of Rankings
//   (web/places.json, fireharmony/trendflags.py): a rise or a fall holds when it stays clear with all the countries (or
//   all the states) that have enough fire tested together (Benjamini and Hochberg, q <= 0.05); a place with under
//   1,000 hotspots a year, or with most of its heat on bare ground, is not tested.
// - The world and the continents are tested on their own (p < 0.05), as in Rankings.
// - Any other view (a season, a range of years, the MODIS scale, a city circle) has only its own test (p < 0.05),
//   with the Explorer's rule that under 100 hotspots a year no trend is read (lib/stats.ts trendVerdict).
// - On the raw sensors no verdict is given: the number of satellites grows over the years, so raw totals do not
//   compare from one year to the next.
import { BASE_YEARS } from '../../lib/config';
import { TREND_FLOOR_PER_YEAR, TREND_TESTED_PER_YEAR } from '../../lib/stats';
import { BARREN_MAX, TEST_FLOOR, trendClassOf, type PlaceRow } from '../rankings/model';
import { count, dec, pText, type Tone } from './format';
import type { Scope } from './scope';

export type VerdictClass = 'rising' | 'falling' | 'unclear' | 'untested' | 'none' | 'little' | 'raw';

export interface Verdict {
  cls: VerdictClass;
  tone: Tone;        // an arrow only for a rise or a fall that the verdict supports
  word: string;      // "Rising", "Falling", "Not clear", "Not tested", "Too little fire", "Too few years", "Raw, not comparable"
  note: string;      // one or two sentences on the test
  family: boolean;   // the verdict of the test among all places (as in Rankings)
}

const KIND_PLURAL = { country: 'countries', state: 'states' } as const;

/** "q = 0.012", "q < 0.001" (with no-break spaces, as pText). */
export function qText(q: number): string {
  if (q < 0.001) return 'q\u00a0<\u00a00.001';
  return `q\u00a0=\u00a0${dec(q, q < 0.01 ? 3 : 2)}`;
}

/** How many countries (or states) were tested together, from the rows of web/places.json. */
const familyCache = new WeakMap<readonly PlaceRow[], Record<'country' | 'state', number>>();
function familySize(rows: readonly PlaceRow[] | null, kind: 'country' | 'state'): number | null {
  if (!rows) return null;
  let c = familyCache.get(rows);
  if (!c) {
    c = { country: 0, state: 0 };
    for (const r of rows) if ((r.kind === 'country' || r.kind === 'state') && r.trend_tested) c[r.kind] += 1;
    familyCache.set(rows, c);
  }
  return c[kind];
}

/** The verdict of a place over the whole record (its row in web/places.json), worded as in Rankings. */
export function rowVerdict(row: PlaceRow, rows: readonly PlaceRow[] | null): Verdict {
  const { cls, why } = trendClassOf(row);
  const p = row.trend_p;
  const own = row.kind === 'world' || row.kind === 'continent';
  if (cls === 'none') return { cls, tone: 'flat', word: 'Too few years', note: 'Too few full years for a trend: 8 are needed.', family: false };
  if (own && cls === 'untested') {
    return { cls, tone: 'flat', word: 'Not tested', note: `Too little fire to test: under ${count(TEST_FLOOR)} hotspots a year.`, family: false };
  }
  if (own) {
    const clear = cls === 'rising' || cls === 'falling';
    return {
      cls, tone: cls === 'rising' ? 'up' : cls === 'falling' ? 'down' : 'flat', word: clear ? (cls === 'rising' ? 'Rising' : 'Falling') : 'Not clear',
      note: p === null ? '' : `${clear ? 'Clear' : 'Not clear'} on its own test: ${pText(p)}.`, family: false,
    };
  }
  const kind = row.kind as 'country' | 'state';
  const n = familySize(rows, kind);
  const all = n ? `all ${count(n)} ${KIND_PLURAL[kind]} with enough fire` : `all the ${KIND_PLURAL[kind]} with enough fire`;
  if (cls === 'untested') {
    return {
      cls, tone: 'flat', word: 'Not tested', family: true,
      note: why === 'barren'
        ? `Most of the heat here is from bare ground (over ${BARREN_MAX}%), so it is not tested with the other ${KIND_PLURAL[kind]}.`
        : `Too little fire to test: under ${count(TEST_FLOOR)} hotspots a year.`,
    };
  }
  const q = row.trend_q;
  if (cls === 'rising' || cls === 'falling') {
    return {
      cls, tone: cls === 'rising' ? 'up' : 'down', word: cls === 'rising' ? 'Rising' : 'Falling', family: true,
      note: `It holds when ${all} are tested together${q !== null ? ` (${qText(q)})` : ''}.`,
    };
  }
  return {
    cls, tone: 'flat', word: 'Not clear', family: true,
    note: p !== null && p < 0.05
      ? `Clear on its own (${pText(p)}), but not when ${all} are tested together${q !== null ? ` (${qText(q)})` : ''}.`
      : `Not clear on its own test${p !== null ? ` (${pText(p)})` : ''}.`,
  };
}

/** True when a view's trend is the whole record's: every month of 2001 to 2025 on the harmonized scale. */
export const wholeRecordTrend = (s: Scope, from: number, to: number): boolean =>
  s.months === null && s.scale === 'harmonized' && from === BASE_YEARS[0] && to === BASE_YEARS[1];

/**
 * The verdict of a trend in a view. `row` is the place's row when it is a named place (null for a city circle),
 * `mean` the hotspots a year (or a season) in the trend's years.
 */
export function viewVerdict(t: { pct: number | null; p: number | null; direction: string; from: number; to: number }, s: Scope,
  row: PlaceRow | null, rows: readonly PlaceRow[] | null, mean: number | null): Verdict {
  if (s.scale === 'raw') {
    return {
      cls: 'raw', tone: 'flat', word: 'Raw, not comparable', family: false,
      note: 'Raw counts add up two to five satellites, and more of them fly in later years, so a raw trend is not a change in fire. Read trends on the harmonized scale.',
    };
  }
  if (t.pct === null || t.direction === 'not enough data' || t.from > t.to) {
    return { cls: 'none', tone: 'flat', word: 'Too few years', note: '', family: false };
  }
  if (row && wholeRecordTrend(s, t.from, t.to)) return rowVerdict(row, rows);
  if (mean !== null && mean < TREND_FLOOR_PER_YEAR) {
    return {
      cls: 'little', tone: 'flat', word: 'Too little fire', family: false,
      note: `Under ${count(TREND_FLOOR_PER_YEAR)} hotspots a year (here about ${count(mean)}), the small values before 2012 make falls that are not real, so no trend is read.`,
    };
  }
  const clear = t.p !== null && t.p < 0.05 && (t.direction === 'increasing' || t.direction === 'decreasing');
  const cls: VerdictClass = clear ? (t.direction === 'increasing' ? 'rising' : 'falling') : 'unclear';
  const named = row !== null && (row.kind === 'country' || row.kind === 'state');
  const parts = [
    t.p !== null ? `${clear ? 'Clear' : 'Not clear'} on its own test: ${pText(t.p)}.` : '',
    mean !== null && mean < TREND_TESTED_PER_YEAR ? `Little fire (about ${count(mean)} hotspots a year): read this trend with care.` : '',
    named ? 'Rankings tests the whole record of every place together; a season or a range of years is tested on its own.' : '',
  ];
  return {
    cls, tone: cls === 'rising' ? 'up' : cls === 'falling' ? 'down' : 'flat', word: clear ? (cls === 'rising' ? 'Rising' : 'Falling') : 'Not clear',
    note: parts.filter(Boolean).join(' '), family: false,
  };
}
