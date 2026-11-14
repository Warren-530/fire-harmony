import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rankRows, trendVerdict, type PlaceRow, type PlacesFile } from '../rankings/model';
import { defaultScope, type Scope } from './scope';
import { qText, rowVerdict, viewVerdict } from './verdict';

const row = (o: Partial<PlaceRow>): PlaceRow => ({
  kind: 'country', id: 'XXX', name: 'Somewhere', iso3: 'XXX', continent: 'Africa', area_km2: 1, mean_per_year: 5000, cv: null, record_year: null,
  record_total: null, trend_pct_per_decade: -20, trend_p: 0.02, trend: 'decreasing', latest_ym: null, latest: null, latest_normal: null,
  latest_ratio: null, latest_rank: null, latest_years: null, ytd: null, ytd_normal: null, ytd_ratio: null, peak_month: null, critical_months: null,
  share_pct: null, outlook_p: null, outlook_p_clim: null, outlook_target: null, outlook_bss: null, drivers_r2: null, trend_tested: true,
  trend_q: 0.06, barren_pct: 0, ...o,
});
const trendOf = (o: Partial<{ pct: number | null; p: number | null; direction: string; from: number; to: number }> = {}) =>
  ({ pct: -20, p: 0.02, direction: 'decreasing', from: 2001, to: 2025, ...o });
const whole: Scope = { ...defaultScope(2026), place: { type: 'named', kind: 'country', id: 'XXX' } };

describe('one verdict for a trend on every page', () => {
  it('a country over the whole record reads as in Rankings: clear alone, not clear among all', () => {
    const v = viewVerdict(trendOf(), whole, row({}), null, 5000);
    expect(v.cls).toBe('unclear');
    expect(v.word).toBe('Not clear');
    expect(v.family).toBe(true);
    expect(v.note.replace(/\u00a0/g, ' ')).toMatch(/Clear on its own \(p = 0\.02\), but not when all the countries with enough fire are tested together \(q = 0\.06\)/);
  });
  it('holds, is not tested, or is mostly bare ground', () => {
    expect(rowVerdict(row({ trend_q: 0.01 }), null)).toMatchObject({ cls: 'falling', word: 'Falling', tone: 'down' });
    expect(rowVerdict(row({ trend_tested: false, mean_per_year: 400 }), null)).toMatchObject({ cls: 'untested', word: 'Not tested' });
    expect(rowVerdict(row({ trend_tested: false, barren_pct: 80 }), null).note).toMatch(/bare ground/);
  });
  it('the world and the continents are tested on their own', () => {
    expect(rowVerdict(row({ kind: 'continent', trend_q: null, trend_tested: false }), null)).toMatchObject({ cls: 'falling', family: false });
  });
  it('a season, a range of years or the MODIS scale has only its own test; little fire reads no trend; raw gives no verdict', () => {
    expect(viewVerdict(trendOf(), { ...whole, months: [8, 10] }, row({}), null, 5000)).toMatchObject({ cls: 'falling', word: 'Falling', family: false });
    expect(viewVerdict(trendOf({ from: 2005 }), { ...whole, years: [2005, 2026] }, row({}), null, 5000).cls).toBe('falling');
    expect(viewVerdict(trendOf(), { ...whole, scale: 'modis' }, row({}), null, 5000).cls).toBe('falling');
    expect(viewVerdict(trendOf(), { ...whole, months: [8, 10] }, row({}), null, 60).cls).toBe('little');
    expect(viewVerdict(trendOf(), { ...whole, scale: 'raw' }, row({}), null, 5000)).toMatchObject({ cls: 'raw', tone: 'flat' });
    expect(viewVerdict(trendOf({ from: 2026, to: 2025 }), whole, row({}), null, 5000).cls).toBe('none');
  });
  it('words q like p', () => {
    const q = (v: number) => qText(v).replace(/\u00a0/g, ' ');
    expect(q(0.0571)).toBe('q = 0.06');
    expect(q(0.0025)).toBe('q = 0.003');
    expect(q(0.0001)).toBe('q < 0.001');
  });
});

const DATA = process.env.FIRE_DATA_DIR ?? path.join(os.homedir(), 'nasa_work/data/products/v1.0');
const file = path.join(DATA, 'web/places.json');

describe.skipIf(!fs.existsSync(file))('on the published places', () => {
  // read only when the file is there: the describe body runs even when the suite is skipped (CI has no data)
  const rows = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as PlacesFile).rows : [];
  it('every place gets the same class on the Dashboard as in Rankings', () => {
    const word = { rising: 'Rising', falling: 'Falling', unclear: 'Not clear', untested: 'Not tested', none: 'Too few years' } as const;
    for (const r of rankRows(rows)) expect(rowVerdict(r, rows).word, r.key).toBe(word[r.trendClass]);
  });
  it('Brazil is not clear when all countries are tested, Indonesia holds', () => {
    const bra = rows.find((r) => r.kind === 'country' && r.id === 'BRA')!;
    const idn = rows.find((r) => r.kind === 'country' && r.id === 'IDN')!;
    expect(rowVerdict(bra, rows).note).toMatch(/all 129 countries with enough fire/);
    expect(rowVerdict(bra, rows).word).toBe('Not clear');
    expect(trendVerdict(rankRows([bra])[0])).toBe('Not clear when all places are tested');
    expect(rowVerdict(idn, rows)).toMatchObject({ word: 'Falling', family: true });
  });
});
