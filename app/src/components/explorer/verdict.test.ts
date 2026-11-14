// One trend verdict on every page: the Explorer's (lib/stats.ts trendVerdict, worded by Kpis.tsx trendWords, with the
// family test of panelData.ts) against the Dashboard and Rankings (dashboard/verdict.ts rowVerdict) for every place of
// web/places.json, worked out from each place's own published series as the panel does; and against the trend map
// (explorer/trend.ts trendClass) for every hexagon of web/trend_l3.json and trend_l4.json. Both also against the rule
// written out here from the files' own fields, and the yearly chart's title (trendWords.ts chartTitle) against the
// card: it never says more than the card's word.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DICTS } from '../../lib/i18n';
import { fireBrief, trendVerdict, type FamilyTest } from '../../lib/stats';
import type { MonthlyPoint, Source } from '../../lib/types';
import { webKey } from '../../lib/web';
import { chartTitle, trendWords } from './trendWords';
import { rowVerdict } from '../dashboard/verdict';
import type { PlaceRow, PlacesFile } from '../rankings/model';
import { hexFamily, initialFamily, loadingFamily, placeFamily, testedCounts } from './panelData';
import { NOT_TESTED, trendClass, type TrendFile } from './trend';

const t = DICTS.en;

/** A monthly series from November 2000 to October 2026 whose yearly totals are `yearly(yr)`. */
function series(yearly: (yr: number) => number): MonthlyPoint[] {
  const out: MonthlyPoint[] = [];
  for (let ym = 200011; ym <= 202610; ym = ym % 100 === 12 ? ym + 89 : ym + 1) {
    const yr = Math.floor(ym / 100), mo = ym % 100;
    const h = yearly(yr) / 12;
    out.push({ yr, mo, h, modis: h, t: 0, a: 0, s: 0, n: 0, j: 0, src: (yr < 2012 ? 1 : 0) as Source });
  }
  return out;
}

const row = (o: Partial<PlaceRow>): PlaceRow => ({
  kind: 'country', id: 'XXX', name: 'Somewhere', iso3: 'XXX', continent: 'Africa', area_km2: 1, mean_per_year: 5000, cv: null, record_year: null,
  record_total: null, trend_pct_per_decade: -20, trend_p: 0.02, trend: 'decreasing', latest_ym: null, latest: null, latest_normal: null,
  latest_ratio: null, latest_rank: null, latest_years: null, ytd: null, ytd_normal: null, ytd_ratio: null, peak_month: null, critical_months: null,
  share_pct: null, outlook_p: null, outlook_p_clim: null, outlook_target: null, outlook_bss: null, drivers_r2: null, trend_tested: true,
  trend_q: 0.06, barren_pct: 0, ...o,
});

const explorer = (points: readonly MonthlyPoint[], family: FamilyTest | null) => {
  const v = trendVerdict(points, 'harmonized', family);
  return { v, w: trendWords(v, t, 'en', family), title: chartTitle(v, 'X', '10%', t, family) };
};

/** The class by the report's rule, written out here from the row's own fields (not with trendClassOf), so the test
 *  checks the rule itself: too few years; the world and the continents on their own test (p < 0.05) from 1,000
 *  hotspots a year; countries and states tested together (q at most 0.05), unless under 1,000 a year or mostly on bare
 *  land (50% or more). */
function ruleClass(r: PlaceRow): string {
  if (r.trend_pct_per_decade === null || r.trend === null || r.trend === 'not enough data') return 'none';
  const dir = r.trend_pct_per_decade > 0 ? 'rising' : 'falling';
  if ((r.mean_per_year ?? 0) < 1000) return 'untested';
  if (r.kind === 'world' || r.kind === 'continent') return r.trend_p !== null && r.trend_p < 0.05 ? dir : 'unclear';
  if ((r.barren_pct ?? 0) >= 50) return 'untested';
  return r.trend_q !== null && r.trend_q <= 0.05 ? dir : 'unclear';
}

/** The chart's title never says more than the card: "is rising" or "is falling" only for a rise or a fall the card
 *  gives, "may be" only for a rise or a fall that is not clear (or read with a caution), "not tested" for a place that
 *  is not tested. */
function titleProblem(cls: string, title: string): string | null {
  const definite = / is (rising|falling), by about/.test(title), maybe = / may be (rising|falling)/.test(title);
  if (cls === 'rising' || cls === 'falling') return definite || maybe ? null : 'no trend in the title';
  if (definite) return 'a definite trend in the title';
  if (cls === 'untested' && !/too little to test|not tested/.test(title)) return 'not "not tested"';
  if ((cls === 'none' || cls === 'little' || cls === 'pending') && maybe) return 'a trend in the title';
  return null;
}

describe('the Explorer gives the verdict of the Dashboard and Rankings', () => {
  const falling = series((yr) => 6000 * 0.97 ** (yr - 2001));
  const tested = { country: 129, state: 1048 };
  it('a fall that is clear on its own but not among all countries reads "Not clear", without an arrow or a caution', () => {
    const r = row({});
    const { v, w } = explorer(falling, placeFamily(r, tested));
    expect(v.cls).toBe('unclear');
    expect(w.word).toBe(rowVerdict(r, null).word);
    expect(w.dir).toBe('flat');
    expect(w.caution).toBe(false);
    expect(w.notes.join(' ')).toMatch(/Clear on its own test .*Not clear once all 129 countries with enough fire are tested together \(q = 0\.06\)/);
  });
  it('holds, is not tested (little fire or bare land), or has too few years', () => {
    for (const r of [row({ trend_q: 0.01 }), row({ trend_tested: false, mean_per_year: 400, trend_q: null }),
      row({ trend_tested: false, barren_pct: 80, trend_q: null }), row({ trend: 'not enough data', trend_pct_per_decade: null, trend_p: null })]) {
      const { v, w } = explorer(falling, placeFamily(r, tested));
      expect(w.word, JSON.stringify(r)).toBe(rowVerdict(r, null).word);
      expect(v.cls).toBe(rowVerdict(r, null).cls);
    }
  });
  it('waits for the test of a place rather than show a word that may change', () => {
    const { v, w, title } = explorer(falling, initialFamily('country'));
    expect(v.cls).toBe('pending');
    expect(w.dir).toBeNull();
    expect(title).toBe(t.chart.title.few('X'));
  });
  it('waits while the series of the new place loads, for every kind (no word from the series of the place before)', () => {
    for (const kind of ['world', 'continent', 'country', 'state', 'hexagon', null] as const) {
      const fam = loadingFamily(kind);
      expect(fam.pending).toBe(true);
      expect(explorer(falling, fam).v.cls, String(kind)).toBe('pending');
      expect(fireBrief('X', falling, 'harmonized', { intervals: {} } as never, null, fam)).not.toMatch(/fell|rose|trend/);
    }
    // a drawn area's own test once its series is in
    expect(explorer(falling, null).v.cls).toBe('falling');
  });
  it('a place not tested has a title that says so, not a rise or a fall (Kuwait: most of its fire on bare land)', () => {
    const rising = series((yr) => 6000 * 1.03 ** (yr - 2001));
    const barren = row({ trend_tested: false, barren_pct: 80, trend_q: null, trend: 'increasing', trend_pct_per_decade: 15, trend_p: 0.01 });
    const a = explorer(rising, placeFamily(barren, tested));
    expect(a.v.cls).toBe('untested');
    expect(a.title).toBe(t.exPanel.trend.chartBarren('X'));
    const little = row({ trend_tested: false, mean_per_year: 640, trend_q: null, trend: 'increasing', trend_pct_per_decade: 29, trend_p: 0.01 });
    expect(explorer(rising, placeFamily(little, tested)).title).toBe(t.exPanel.trend.chartUntested('X'));
    expect(explorer(falling, placeFamily(row({}), tested)).title).toBe(t.exPanel.trend.chartDownUnsure('X', '10%', 'countries'));
    expect(explorer(falling, placeFamily(row({ trend_q: 0.01 }), tested)).title).toBe(t.chart.title.down('X', '10%'));
  });
  it('another span or a drawn area has only its own test (with the caution under 1,000 hotspots a year)', () => {
    const v = trendVerdict(falling, 'harmonized', placeFamily(row({}), tested), [2005, 2025]);
    expect(v.published).toBe(false);
    const little = explorer(series((yr) => 800 * 0.95 ** (yr - 2001)), null);
    expect(little.v.cls).toBe('falling');
    expect(little.w.caution).toBe(true);
    expect(little.title).toBe(t.exPanel.trend.chartDown('X', '10%'));
  });
  it('a hexagon tested with all the hexagons of its size reads as the trend map: no caution under 1,000 a year', () => {
    const points = series((yr) => 731 * 1.04 ** (yr - 2001));
    const file = { pct: [41], p: [0.0001], q: [0.00135], mean: [731] };
    const { v, w, title } = explorer(points, hexFamily(file, 0, 12000));
    expect(v.cls).toBe('rising');
    expect(w.caution).toBe(false);
    expect(w.notes.join(' ')).not.toMatch(/with care/);
    expect(w.notes.join(' ')).toMatch(/Still clear when all 12,000 hexagons of this size/);
    expect(title).toBe(t.chart.title.up('X', '10%'));
  });
  it('a hexagon under the floor: its own hotspots a year, never "about 100" or "about 0", and no "too few years"', () => {
    const points = series(() => 30);
    const out = explorer(points, hexFamily({ pct: [], p: [], q: [], mean: [] }, -1, 1));
    expect(out.v.cls).toBe('little');
    expect(out.w.notes[0]).toMatch(/here about 30\)/);
    const brief = fireBrief('X', points, 'harmonized', { intervals: {} } as never, null, hexFamily({ pct: [], p: [], q: [], mean: [] }, -1, 1));
    expect(brief).toMatch(/too little fire here \(under 100 hotspots a year\)/);
    expect(brief).not.toMatch(/too few full years/);
    expect(explorer(series(() => 0.01), hexFamily({ pct: [], p: [], q: [], mean: [] }, -1, 1)).w.notes[0]).toMatch(/here almost none\)/);
    // the file rounds 99.96 to 100.0: just under the floor
    const edge = explorer(series(() => 99.96), hexFamily({ pct: [-30.5], p: [0.0014], q: [null], mean: [100] }, 0, 1));
    expect(edge.v.cls).toBe('little');
    expect(edge.w.notes[0]).toMatch(/here just under 100\)/);
  });
});

const DATA = process.env.FIRE_DATA_DIR ?? path.join(os.homedir(), 'nasa_work/data/products/v1.0');
const placesFile = path.join(DATA, 'web/places.json');
const read = <T>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8')) as T;

// (each test reads and checks every place or hexagon: on a busy machine that takes longer than the default 5 s)
describe.skipIf(!fs.existsSync(placesFile))('on the published places and hexagons', { timeout: 60_000 }, () => {
  it('every place of web/places.json: the Explorer says the word of rowVerdict', () => {
    const rows = read<PlacesFile>(placesFile).rows;
    const meta = read<{ first_month: number; last_month: number }>(path.join(DATA, 'meta.json'));
    const world = read<{ ym: number[]; src: number[] }>(path.join(DATA, 'web/series/world/WORLD.json'));
    const worldSrc = new Map(world.ym.map((v, i) => [v, world.src[i]]));
    const counts = testedCounts(rows);
    const bad: string[] = [];
    const seen = new Map<string, number>();
    for (const r of rows) {
      // the place's series as lib/data.ts builds it: the full month grid, zero where it had no row, unknown months null
      const f = path.join(DATA, `web/series/${r.kind}/${webKey(r.id)}.json`);
      const s = fs.existsSync(f) ? read<{ ym: number[]; h: (number | null)[]; src: number[] }>(f) : { ym: [], h: [], src: [] };
      const at = new Map(s.ym.map((v, i) => [v, i]));
      const points: MonthlyPoint[] = [];
      for (let ym = meta.first_month; ym <= meta.last_month; ym = ym % 100 === 12 ? ym + 89 : ym + 1) {
        const i = at.get(ym);
        const ws = worldSrc.get(ym) ?? 3;
        const src = (ws === 3 ? 3 : i !== undefined ? Math.min(s.src[i], 3) : ws) as Source;
        const h = src === 3 ? null : i !== undefined ? s.h[i] ?? 0 : 0;
        points.push({ yr: Math.floor(ym / 100), mo: ym % 100, h, modis: h, t: 0, a: 0, s: 0, n: 0, j: 0, src });
      }
      // the family test the panel has once its file is in (the world and the continents need none)
      const family = r.kind === 'world' || r.kind === 'continent' ? initialFamily(r.kind) : placeFamily(r, counts);
      const { v, w, title } = explorer(points, family);
      const want = rowVerdict(r, rows);
      if (v.cls !== want.cls || w.word !== want.word) bad.push(`${r.kind}:${r.id} Explorer ${v.cls} "${w.word}", Dashboard ${want.cls} "${want.word}"`);
      if (v.cls !== ruleClass(r)) bad.push(`${r.kind}:${r.id} Explorer ${v.cls}, the rule ${ruleClass(r)}`);
      const tp = titleProblem(v.cls, title);
      if (tp) bad.push(`${r.kind}:${r.id} ${v.cls}, chart title "${title}": ${tp}`);
      // an arrow only for a rise or a fall that holds, as the Dashboard's tone
      const tone = w.dir === 'up' ? 'up' : w.dir === 'down' ? 'down' : 'flat';
      if (tone !== want.tone) bad.push(`${r.kind}:${r.id} arrow ${w.dir}, Dashboard ${want.tone}`);
      seen.set(want.word, (seen.get(want.word) ?? 0) + 1);
    }
    expect(bad.slice(0, 20)).toEqual([]);
    expect(rows.length).toBe(4330);
    // every word is met (the test covers each branch)
    expect([...seen.keys()].sort()).toEqual(['Falling', 'Not clear', 'Not tested', 'Rising', 'Too few years']);
    const bra = rows.find((r) => r.kind === 'country' && r.id === 'BRA')!;
    expect(rowVerdict(bra, rows).word).toBe('Not clear');
  });

  it('every hexagon of the trend map: the panel gives its class (846890bffffffff, q = 0.052, is not clear)', () => {
    const points = series(() => 1000);
    for (const level of [3, 4]) {
      const file = read<TrendFile>(path.join(DATA, `web/trend_l${level}.json`));
      const tested = file.q.filter((q) => q !== null).length;
      const bad: string[] = [];
      const firstOf = new Map<string, number>();
      for (let i = 0; i < file.h3.length; i++) {
        const k = trendClass(file.pct[i], file.q[i]);
        const want = k === NOT_TESTED ? 'little' : k === 0 ? 'unclear' : k > 0 ? 'rising' : 'falling';
        // the rule written out (not with trendClass): untested without q, clear at q of 0.05 or less
        const q = file.q[i], pct = file.pct[i];
        const rule = q === null ? 'little' : q <= 0.05 && pct !== null && pct !== 0 ? (pct > 0 ? 'rising' : 'falling') : 'unclear';
        if (rule !== want) bad.push(`${file.h3[i]} map ${want}, the rule ${rule}`);
        const fam = hexFamily(file, i, tested);
        if (fam.published?.cls !== want) bad.push(`${file.h3[i]} panel ${fam.published?.cls}, map ${want}`);
        // the whole verdict (and its words) for every 40th hexagon and the first of each class
        if (i % 40 === 0 || !firstOf.has(want)) {
          firstOf.set(want, i);
          const { v, w, title } = explorer(points, fam);
          if (v.cls !== want) bad.push(`${file.h3[i]} verdict ${v.cls}, map ${want}`);
          // the same voice as the map: a clear trend there has no caution here, and the title says what the card says
          if (w.caution) bad.push(`${file.h3[i]} a caution on a trend the map calls clear`);
          const tp = titleProblem(v.cls, title);
          if (tp) bad.push(`${file.h3[i]} ${v.cls}, chart title "${title}": ${tp}`);
          if ((w.dir === 'up') !== (want === 'rising') || (w.dir === 'down') !== (want === 'falling')) bad.push(`${file.h3[i]} arrow ${w.dir}, map ${want}`);
        }
      }
      expect(bad.slice(0, 10)).toEqual([]);
      expect([...firstOf.keys()].sort()).toEqual(['falling', 'little', 'rising', 'unclear']);
      const at = file.h3.indexOf('846890bffffffff');
      if (at >= 0) {
        const fam = hexFamily(file, at, tested);
        const { v, w } = explorer(points, fam);
        expect(v.cls).toBe('unclear');
        expect(w.word).toBe('Not clear');
        expect(w.notes.join(' ')).toMatch(/hexagons of this size .*\(q = 0\.052\)/);
      }
    }
    // a hexagon not in the file has no fire to test, as the map says
    expect(explorer(points, hexFamily({ pct: [], p: [], q: [], mean: [] }, -1, 1)).v.cls).toBe('little');
  });
});
