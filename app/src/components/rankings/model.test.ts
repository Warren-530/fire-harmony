import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS, filtersFromHash, hashOf, plural, rankingsCsv, rankRows, screenOf, SCREENS, trendVerdict, viewOf,
  type Filters, type PlaceRow,
} from './model';

const base: PlaceRow = {
  kind: 'country', id: 'X', name: 'X', iso3: 'X', continent: 'Asia', area_km2: 1, mean_per_year: 0, cv: null, record_year: 2015,
  record_total: 0, trend_pct_per_decade: 0, trend_p: 0.5, trend: 'no trend', latest_ym: 202610, latest: 0, latest_normal: 0,
  latest_ratio: null, latest_rank: null, latest_years: 26, ytd: 0, ytd_normal: 0, ytd_ratio: null, peak_month: 9,
  critical_months: [8, 9], share_pct: 0, outlook_p: null, outlook_p_clim: null, outlook_target: null, outlook_bss: null,
  drivers_r2: null, trend_tested: false, trend_q: null, barren_pct: 0,
};
const row = (o: Partial<PlaceRow>): PlaceRow => ({ ...base, ...o });

const ROWS = rankRows([
  row({ kind: 'world', id: 'WORLD', name: 'World', iso3: null, continent: null, mean_per_year: 17e6, share_pct: 100, trend_pct_per_decade: -6.3, trend_p: 0.0001, trend: 'decreasing' }),
  row({ kind: 'continent', id: 'Asia', name: 'Asia', iso3: null, continent: null, mean_per_year: 3e6, trend_pct_per_decade: -7.9, trend_p: 0.08 }),
  row({ id: 'IDN', name: 'Indonesia', iso3: 'IDN', mean_per_year: 271567, share_pct: 1.59, trend_pct_per_decade: -51.9, trend_p: 0.0035, trend: 'decreasing',
    trend_tested: true, trend_q: 0.012, latest_ratio: 5.97, latest_normal: 33418, ytd_ratio: 2.44, ytd_normal: 231182, outlook_p: 0.84, outlook_p_clim: 0.46 }),
  row({ id: 'BRA', name: 'Brazil', iso3: 'BRA', continent: 'South America', mean_per_year: 1475093, share_pct: 8.6, trend_pct_per_decade: -21.8,
    trend_p: 0.023, trend: 'decreasing', trend_tested: true, trend_q: 0.057, latest_ratio: 0.69, latest_normal: 262218, outlook_p: 0.36 }),
  row({ kind: 'state', id: 'IDN-492', name: 'Riau, Indonesia', iso3: 'IDN', mean_per_year: 36266, trend_pct_per_decade: -74.3, trend_p: 0.0006,
    trend: 'decreasing', trend_tested: true, trend_q: 0.0025, latest_ratio: 0.12, latest_normal: 739 }),
  row({ kind: 'state', id: 'IDN-1', name: 'Tiny, Indonesia', iso3: 'IDN', mean_per_year: 12, trend_pct_per_decade: 40, trend_p: 0.01, trend: 'increasing',
    latest_ratio: 30, latest_normal: 0.5 }),
  row({ kind: 'state', id: 'DZA-1', name: 'Flares, Algeria', iso3: 'DZA', continent: 'Africa', mean_per_year: 5000, barren_pct: 80, trend_pct_per_decade: 12 }),
  row({ id: 'DZA', name: 'Algeria', iso3: 'DZA', continent: 'Africa', mean_per_year: 9000 }),
]);
const byKey = (k: string) => ROWS.find((r) => r.key === k)!;
const f = (o: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...o });

describe('rows', () => {
  it('names a state by its own name and its country', () => {
    const riau = byKey('state:IDN-492');
    expect(riau.own).toBe('Riau');
    expect(riau.where).toBe('State in Indonesia');
    expect(byKey('country:IDN').where).toBe('Country in Asia');
    expect(byKey('world:WORLD').where).toBe('Whole world');
  });
  it('reads trends with the rule of all places tested together', () => {
    expect(byKey('country:IDN').trendClass).toBe('falling');
    expect(byKey('country:BRA').trendClass).toBe('unclear');          // p 0.023 but q 0.057
    expect(byKey('state:IDN-1').trendClass).toBe('untested');
    expect(trendVerdict(byKey('state:IDN-1'))).toBe('Too little fire to test');
    expect(trendVerdict(byKey('state:DZA-1'))).toMatch(/bare ground/);
    expect(byKey('world:WORLD').trendClass).toBe('falling');          // the world is tested on its own
    expect(byKey('continent:Asia').trendClass).toBe('unclear');
  });
  it('marks far above normal only where a normal month has enough fire', () => {
    expect(byKey('country:IDN').farAbove).toBe(true);
    expect(byKey('state:IDN-1').farAbove).toBe(false);
  });
});

describe('filters and order', () => {
  it('defaults to countries, most fire first', () => {
    expect(viewOf(ROWS, DEFAULT_FILTERS).map((r) => r.id)).toEqual(['BRA', 'IDN', 'DZA']);
  });
  it('lists the states of one country', () => {
    expect(viewOf(ROWS, f({ kind: 'state', country: 'IDN' })).map((r) => r.id)).toEqual(['IDN-492', 'IDN-1']);
  });
  it('filters by continent, trend, text and the least fire', () => {
    expect(viewOf(ROWS, f({ kind: 'all', continent: 'Asia' })).map((r) => r.id)).toEqual(['Asia', 'IDN', 'IDN-492', 'IDN-1']);
    expect(viewOf(ROWS, f({ kind: 'all', trend: 'falling' })).map((r) => r.id)).toEqual(['WORLD', 'IDN', 'IDN-492']);
    expect(viewOf(ROWS, f({ kind: 'all', q: 'riau' })).map((r) => r.id)).toEqual(['IDN-492']);
    expect(viewOf(ROWS, f({ kind: 'all', q: 'indon' })).map((r) => r.id)).toEqual(['IDN', 'IDN-492', 'IDN-1']);
    expect(viewOf(ROWS, f({ kind: 'state', min: 1000 })).map((r) => r.id)).toEqual(['IDN-492', 'DZA-1']);
  });
  it('sorts ratios from small normals after the others, and no value last, both ways', () => {
    const desc = viewOf(ROWS, f({ kind: 'all', sort: 'latest', dir: 'desc' })).map((r) => r.id);
    expect(desc.slice(0, 3)).toEqual(['IDN', 'BRA', 'IDN-492']);
    expect(desc[3]).toBe('IDN-1');
    const asc = viewOf(ROWS, f({ kind: 'all', sort: 'latest', dir: 'asc' })).map((r) => r.id);
    expect(asc.slice(0, 4)).toEqual(['IDN-492', 'BRA', 'IDN', 'IDN-1']);
  });
  it('sorts names A to Z', () => {
    expect(viewOf(ROWS, f({ sort: 'name', dir: 'asc' })).map((r) => r.own)).toEqual(['Algeria', 'Brazil', 'Indonesia']);
  });
});

describe('links', () => {
  it('round trips the filters and the order', () => {
    const v = f({ kind: 'state', continent: 'Asia', country: 'IDN', trend: 'falling', now: 'above', min: 100, q: 'kalimantan', sort: 'trend', dir: 'asc' });
    const h = hashOf(v);
    expect(h).toBe('#/rankings?kind=state&continent=Asia&country=IDN&trend=falling&now=above&min=100&q=kalimantan&sort=trend-asc');
    expect(filtersFromHash(h)).toEqual(v);
    expect(hashOf(DEFAULT_FILTERS)).toBe('#/rankings');
  });
  it('ignores what it cannot read', () => {
    expect(filtersFromHash('#/rankings?kind=planet&sort=size-up&min=7&trend=sideways')).toEqual(DEFAULT_FILTERS);
  });
  it('knows the quick screens', () => {
    for (const s of SCREENS) expect(screenOf(f(s.set))).toBe(s.id);
  });
});

describe('CSV', () => {
  it('has the comment lines, the header and one line per row', () => {
    const rows = viewOf(ROWS, DEFAULT_FILTERS);
    const csv = rankingsCsv(rows, DEFAULT_FILTERS, { version: '1.0', latestMonth: 202610, citation: 'Fire Harmony (2026).', link: 'x' }).trim().split('\n');
    // a country filter is named in words, not by its code
    const inBrazil = rankingsCsv(rows, { ...DEFAULT_FILTERS, kind: 'state', country: 'BRA' }, { version: '1.0', latestMonth: 202610, citation: 'c', link: 'x', countryName: 'Brazil' });
    expect(inBrazil).toContain('in Brazil');
    expect(inBrazil).not.toContain('in BRA');
    expect(plural(1, 'state')).toBe('1 state');
    expect(plural(4075, 'state')).toBe('4,075 states');
    expect(csv[0]).toMatch(/^# Fire Harmony rankings, data version 1.0: 3 places \(Countries\), most fire first\.$/);
    const header = csv.find((l) => l.startsWith('kind,'))!.split(',');
    const first = csv[csv.indexOf(header.join(',')) + 1].split(',');
    expect(first[header.indexOf('id')]).toBe('BRA');
    expect(Number(first[header.indexOf('hotspots_per_year_2001_2025')])).toBe(1475093);
    expect(csv.length).toBe(csv.indexOf(header.join(',')) + 1 + 3);
  });
});
