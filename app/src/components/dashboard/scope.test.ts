import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { periodStats } from '../../lib/period';
import { trend, yearToMonth } from '../../lib/stats';
import type { Meta, MonthlyPoint, Source } from '../../lib/types';
import {
  defaultScope, isDefaultScope, partStats, scopeFromHash, scopeHash, scopeView, seasonLabel, seasonMonths, seasonYearOf, seasonYearLabel,
  type Scope,
} from './scope';

describe('the scope in a link', () => {
  it('round trips a place, years, a season and the scale', () => {
    const s: Scope = { place: { type: 'named', kind: 'state', id: 'IDN-492' }, years: [2005, 2020], months: [8, 10], scale: 'modis' };
    const h = scopeHash(s, 2026, 'world');
    expect(h).toBe('#/dashboard?area=state:IDN-492&years=2005-2020&months=8-10&scale=modis&s=world');
    expect(scopeFromHash(h, 2026)).toEqual(s);
  });
  it('round trips a circle and a season across the new year', () => {
    const s: Scope = { place: { type: 'circle', lat: -2.21, lon: 113.92, km: 50 }, years: [2001, 2026], months: [11, 2], scale: 'harmonized' };
    expect(scopeFromHash(scopeHash(s, 2026), 2026)).toEqual(s);
  });
  it('keeps the default for what it cannot read, and writes nothing for the default', () => {
    expect(scopeFromHash('#/dashboard?area=planet:X&years=1990-x&months=13', 2026)).toEqual(defaultScope(2026));
    expect(scopeHash(defaultScope(2026), 2026)).toBe('#/dashboard');
    expect(isDefaultScope(scopeFromHash('#/dashboard?s=seam', 2026), 2026)).toBe(true);
    expect(scopeFromHash('#/dashboard?months=1-12', 2026).months).toBeNull();
    expect(scopeFromHash('#/dashboard?months=9', 2026).months).toEqual([9, 9]);
    expect(scopeFromHash('#/dashboard?years=2030-1990', 2026).years).toEqual([2001, 2026]);
  });
});

describe('seasons', () => {
  it('lists, names and dates the months of a season', () => {
    expect(seasonMonths([8, 10])).toEqual([8, 9, 10]);
    expect(seasonMonths([11, 2])).toEqual([11, 12, 1, 2]);
    expect(seasonMonths(null)).toHaveLength(12);
    expect(seasonLabel([8, 10])).toBe('August to October');
    expect(seasonLabel([9, 9], true)).toBe('Sep');
    expect(seasonYearOf(2020, 1, [11, 2])).toBe(2019);
    expect(seasonYearOf(2019, 12, [11, 2])).toBe(2019);
    expect(seasonYearOf(2019, 6, [11, 2])).toBeNull();
    expect(seasonYearLabel(2019, [11, 2])).toBe('2019/20');
  });
});

// ------------------------------------------------------------------------------------------- on the published files

const DATA = process.env.FIRE_DATA_DIR ?? path.join(os.homedir(), 'nasa_work/data/products/v1.0');
const have = fs.existsSync(path.join(DATA, 'web/series/world/WORLD.json')) && fs.existsSync(path.join(DATA, 'meta.json'));

interface SeriesFile { ym: number[]; h: (number | null)[]; modis: (number | null)[]; t: number[]; a: number[]; s: number[]; n: number[]; j: number[]; src: number[] }

describe.skipIf(!have)('on the published files', () => {
  const read = <T,>(f: string): T => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')) as T;
  // read only when the files are there: the describe body runs even when the suite is skipped (CI has no data)
  const meta = have ? read<Meta>('meta.json') : ({ first_month: 200011, last_month: 200011 } as Meta);
  const worldFile = have ? read<SeriesFile>('web/series/world/WORLD.json') : ({ ym: [], src: [] } as unknown as SeriesFile);
  const world = new Map(worldFile.ym.map((v, i) => [v, worldFile.src[i] as Source]));
  // the same filling as areaSeries in lib/data.ts
  const points = (kind: string, id: string): MonthlyPoint[] => {
    const f = read<SeriesFile>(`web/series/${kind}/${id.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
    const by = new Map(f.ym.map((v, i) => [v, i]));
    const out: MonthlyPoint[] = [];
    for (let yr = Math.floor(meta.first_month / 100), mo = meta.first_month % 100; yr * 100 + mo <= meta.last_month; mo === 12 ? (yr++, mo = 1) : mo++) {
      const k = yr * 100 + mo, i = by.get(k), ws = world.get(k) ?? 3;
      const src = (ws === 3 ? 3 : i !== undefined ? Math.min(f.src[i], 3) : ws) as Source;
      const unknown = src === 3;
      out.push({ yr, mo, h: unknown ? null : (i !== undefined ? f.h[i] : 0), modis: unknown ? null : (i !== undefined ? f.modis[i] : 0),
        t: i !== undefined ? f.t[i] : 0, a: i !== undefined ? f.a[i] : 0, s: i !== undefined ? f.s[i] : 0, n: i !== undefined ? f.n[i] : 0,
        j: i !== undefined ? f.j[i] : 0, src });
    }
    return out;
  };
  const places = have ? read<{ rows: Record<string, unknown>[] }>('web/places.json').rows : [];
  const place = (kind: string, id: string) => places.find((r) => r.kind === kind && r.id === id) as Record<string, number>;
  type DashFile = { world: { latest: Record<string, number>; ytd: Record<string, number>; trend: { pct_per_decade: number }; yearly: { yr: number; harmonized: number; lo: number | null; hi: number | null }[] } };
  const dash = have ? read<DashFile>('dashboard.json') : ({} as DashFile);
  const last = Math.floor(meta.last_month / 100);

  it('gives the dashboard numbers of the world for the default scope', () => {
    const v = scopeView(points('world', 'WORLD'), defaultScope(last), meta);
    const w = dash.world;
    expect(v.latest?.ym).toBe(w.latest.yr * 100 + w.latest.mo);
    expect(v.latest?.value).toBeCloseTo(w.latest.h, -1);
    expect(v.latest?.ratio).toBeCloseTo(w.latest.ratio, 3);
    expect(v.latest?.rank).toBe(w.latest.rank);
    expect(v.period?.total).toBeCloseTo(w.ytd.total, -1);
    expect(v.period?.ratio).toBeCloseTo(w.ytd.ratio, 3);
    expect(v.trend.pct).toBeCloseTo(w.trend.pct_per_decade, 2);
    for (const y of w.yearly) {
      const mine = v.years.find((x) => x.yr === y.yr);
      expect(mine?.value).toBeCloseTo(y.harmonized, -1);
      if (y.lo !== null) expect(mine?.lo).toBeCloseTo(y.lo, -1);
    }
  });

  it('gives the numbers of web/places.json for Indonesia, Riau and Brazil', () => {
    for (const [kind, id] of [['country', 'IDN'], ['state', 'IDN-492'], ['country', 'BRA']]) {
      const pts = points(kind, id);
      const v = scopeView(pts, defaultScope(last), meta);
      const p = place(kind, id);
      expect(v.latest?.ratio).toBeCloseTo(p.latest_ratio, 2);
      expect(v.latest?.rank).toBe(p.latest_rank);
      expect(v.period?.ratio).toBeCloseTo(p.ytd_ratio, 2);
      expect(v.trend.pct).toBeCloseTo(p.trend_pct_per_decade, 1);
      expect(partStats(pts, defaultScope(last), meta).perYear).toBeCloseTo(p.mean_per_year, -1);
      // the Explorer's own functions
      const ytd = yearToMonth(pts, 'harmonized', 2026, 10);
      expect(v.period?.total).toBe(ytd?.total);
      expect(v.trend.pct).toBe(trend(pts, 'harmonized').pct_per_decade);
    }
  });

  it('gives the Explorer period numbers for a season, and trends of the season totals', () => {
    const pts = points('country', 'IDN');
    const s: Scope = { ...defaultScope(last), place: { type: 'named', kind: 'country', id: 'IDN' }, months: [8, 10] };
    const v = scopeView(pts, s, meta);
    const ps = periodStats(pts, { from: 202608, to: 202610 }, meta);
    expect(v.period?.label).toBe('Aug to Oct 2026');
    expect(v.period?.total).toBe(ps.total);
    expect(v.period?.normal).toBe(ps.normal);
    expect(v.period?.rank).toBe(ps.rank);
    expect(v.latest?.ym).toBe(202610);
    const y2015 = v.years.find((y) => y.yr === 2015)!;
    const p2015 = periodStats(pts, { from: 201508, to: 201510 }, meta);
    expect(y2015.value).toBeCloseTo(p2015.total ?? 0, 6);
    expect(y2015.lo).toBeCloseTo(p2015.range?.lo ?? 0, 6);
    expect(v.trend.n).toBe(25);
    // a season across the new year: the latest complete one is November 2025 to February 2026
    const w = scopeView(pts, { ...s, months: [11, 2] }, meta);
    expect(w.period?.from).toBe(202511);
    expect(w.period?.to).toBe(202602);
    expect(w.period?.total).toBe(periodStats(pts, { from: 202511, to: 202602 }, meta).total);
  });

  it('follows the years and the scale', () => {
    const pts = points('country', 'BRA');
    const s: Scope = { ...defaultScope(last), place: { type: 'named', kind: 'country', id: 'BRA' }, years: [2012, 2019], scale: 'modis' };
    const v = scopeView(pts, s, meta);
    expect(v.years.map((y) => y.yr)).toEqual([2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019]);
    expect(v.years.every((y) => y.lo === null)).toBe(true);
    expect(v.period?.label).toBe('2019');
    expect(v.latest?.ym).toBe(201912);
    expect(v.trend.from).toBe(2012);
    expect(v.trend.to).toBe(2019);
    expect(v.years[0].value).toBeCloseTo(pts.filter((p) => p.yr === 2012).reduce((a, p) => a + (p.modis ?? 0), 0), 3);
  });
});
