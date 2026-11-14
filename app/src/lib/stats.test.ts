import { describe, expect, it } from 'vitest';
import reference from './__fixtures__/python_reference.json';
import { latLngToCell } from 'h3-js';
import { BASE_YEARS } from './config';
import { approxBounds, hexAreaKm2, hexCentre, hexRing, isHexagon, ringBoundsOf } from './geo';
import { calendarTitle, fillMonths, type HexRow } from '../components/explorer/months';
import { DICTS } from './i18n';
import {
  addMonths, annualTotals, anomalies, classEdges, climatology, comparedWithNormal, countClass, countScale, criticalMonths,
  criticalThreshold, explorerLink, fireBrief, fireYearStart, hexHeight, intervalFor, isExplorerHash, knownRange,
  latestCompleteMonth, mannKendallHamedRao, monthCode, monthlyCsv, monthRuns, monthsBetween, niceNumber, normalCdf,
  normalQuantile, onScale, parseExplorerLink, parseLinkMonth, ratioClass, ratioDirection, ratioLimit, rawTotal, ringAreaKm2,
  ringsBounds, season, sensSlope, stepMonth, trend, unwrapRing, valueOf, yearToDate, yearToMonth, ymOf,
  COMPARE_MAX, TREND_FLOOR_PER_YEAR, formatQ, linkProblems, meanPerYear, parseCompare, shortAgainstNormal, trendVerdict,
  breaksTrend, circleKey, countText, hotspotsText, littleFire, modelledWithoutModis, observedMean, plural, ratioText, trendText,
  LITTLE_FIRE_NORMAL,
} from './stats';
import type { IntervalTable, Meta, MonthlyPoint, Source } from './types';

// ---------------------------------------------------------------------------------------------------------------
// The Python reference (fireharmony.analytics + pymannkendall)

interface RefPoint { yr: number; mo: number; value: number | null }
interface RefArea {
  name: string;
  series: RefPoint[];
  expected: {
    climatology: { mo: number; median: number; q25: number; q75: number }[];
    anomalies_last_24: { yr: number; mo: number; ratio: number | null; percentile: number | null; rank: number | null }[];
    critical_months: number[];
    critical_threshold: number;
    fire_year_start: number;
    trend: { years: number; trend: string; p: number; sen_slope_per_year: number; pct_per_decade: number };
  };
}
interface RefMannKendall {
  y: number[]; trend: string; p: number; z: number; s: number; var_s: number; slope: number; intercept: number;
}
interface Reference { base_years: number[]; areas: RefArea[]; mann_kendall_hamed_rao: RefMannKendall[] }

const ref: Reference = reference;

/** Fixture series as app points: a null value is an unknown month (src 3). */
const toPoints = (series: readonly RefPoint[]): MonthlyPoint[] =>
  series.map(({ yr, mo, value }) => ({
    yr, mo, h: value, modis: value, t: 0, a: 0, s: 0, n: 0, j: 0, src: value === null ? 3 : 0,
  }));

/** |actual - expected| ≤ abs + rel × |expected|; nulls must match exactly. */
function expectClose(actual: number | null, expected: number | null, abs: number, rel: number, what: string): void {
  if (actual === null || expected === null) {
    expect(actual, what).toBe(expected);
    return;
  }
  expect(Math.abs(actual - expected), `${what}: got ${actual}, expected ${expected}`)
    .toBeLessThanOrEqual(abs + rel * Math.abs(expected));
}

// Tolerances. The fixture inputs are rounded to 4 decimals; Python computed the expected values from the stored
// float32 data and rounded them: climatology and threshold to 4 decimals, ratio to 6, p to 8. Yearly totals of
// float32 values move Sen's slope by about 1e-6 relative.
const TOL_4_DECIMALS = 1e-4;
const TOL_RATIO = 1e-6;
const TOL_P = 1e-8;
const TOL_SLOPE_REL = 1e-5;

describe('fixture', () => {
  it('uses the same base years as the app', () => {
    expect(ref.base_years).toEqual([...BASE_YEARS]);
    expect(ref.areas.length).toBeGreaterThan(0);
    expect(ref.mann_kendall_hamed_rao.length).toBeGreaterThan(0);
  });
});

describe.each(ref.areas.map((area) => [area.name, area] as const))('Python reference for %s', (_name, area) => {
  const points = toPoints(area.series);
  const want = area.expected;

  it('climatology: median and linear quantiles of each calendar month', () => {
    const got = climatology(points, 'harmonized');
    expect(got.map((c) => c.mo)).toEqual(want.climatology.map((c) => c.mo));
    want.climatology.forEach((w, i) => {
      expectClose(got[i].median, w.median, TOL_4_DECIMALS, 0, `median of month ${w.mo}`);
      expectClose(got[i].q25, w.q25, TOL_4_DECIMALS, 0, `q25 of month ${w.mo}`);
      expectClose(got[i].q75, w.q75, TOL_4_DECIMALS, 0, `q75 of month ${w.mo}`);
    });
  });

  it('anomalies of the last 24 months: ratio, percentile and rank', () => {
    const all = anomalies(points, 'harmonized');
    expect(all).toHaveLength(points.length);
    const last = all.slice(-want.anomalies_last_24.length);
    want.anomalies_last_24.forEach((w, i) => {
      const got = last[i];
      const at = `${w.yr}-${w.mo}`;
      expect([got.yr, got.mo], at).toEqual([w.yr, w.mo]);
      expectClose(got.ratio, w.ratio, TOL_RATIO, TOL_RATIO, `ratio ${at}`);
      expect(got.percentile, `percentile ${at}`).toBe(w.percentile);
      expect(got.rank, `rank ${at}`).toBe(w.rank);
    });
  });

  it('critical months and their threshold', () => {
    expect(criticalMonths(points, 'harmonized')).toEqual(want.critical_months);
    expectClose(criticalThreshold(points, 'harmonized'), want.critical_threshold, TOL_4_DECIMALS, 0, 'threshold');
  });

  it('fire year start', () => {
    expect(fireYearStart(points, 'harmonized')).toBe(want.fire_year_start);
  });

  it('trend of yearly totals', () => {
    const got = trend(points, 'harmonized');
    expect(got.years).toBe(want.trend.years);
    expect(got.direction).toBe(want.trend.trend);
    expectClose(got.p, want.trend.p, TOL_P, 0, 'p');
    expectClose(got.sen_slope_per_year, want.trend.sen_slope_per_year, 0, TOL_SLOPE_REL, 'slope');
    expectClose(got.pct_per_decade, want.trend.pct_per_decade, 0, TOL_SLOPE_REL, 'pct per decade');
  });
});

describe('Mann-Kendall with the Hamed and Rao correction (pymannkendall vectors)', () => {
  // s, var_s, z and p within 1e-6 relative (the contract). The vectors are given with 6 decimals while the slope
  // was computed before rounding, so each pairwise slope, and hence their median, can move by up to 1e-6.
  it.each(ref.mann_kendall_hamed_rao.map((c, i) => [i + 1, c] as const))('vector %i', (_i, c) => {
    const got = mannKendallHamedRao(c.y);
    expect(got.trend).toBe(c.trend);
    expectClose(got.s, c.s, 0, 1e-6, 's');
    expectClose(got.var_s, c.var_s, 0, 1e-6, 'var_s');
    expectClose(got.z, c.z, 0, 1e-6, 'z');
    expectClose(got.p, c.p, 0, 1e-6, 'p');
    expectClose(got.slope, c.slope, 1e-6, 0, 'slope');
    expectClose(got.intercept, c.intercept, 2e-5, 0, 'intercept');
    expect(got.h).toBe(c.trend !== 'no trend');
  });

  it('corrects the variance for ties (values from pymannkendall)', () => {
    const got = mannKendallHamedRao([1, 2, 2, 3, 5, 4, 6, 8, 7, 9]);
    expect(got.s).toBe(40);                       // 42 pairs up, 2 down, 1 tie
    expect(got.var_s).toBe(124);                  // (10 × 9 × 25 - 2 × 1 × 9) / 18, no significant lag
    expectClose(got.z, 3.502303389522111, 0, 1e-12, 'z');
    expectClose(got.p, 0.0004612540671704579, 0, 1e-12, 'p');
    expect(got.trend).toBe('increasing');
    expectClose(got.slope, 0.8888888888888888, 0, 1e-15, 'slope');
    expectClose(got.intercept, 0.5, 1e-15, 0, 'intercept');
    expect(sensSlope([1, 3, 5, 7])).toEqual({ slope: 2, intercept: 1 });
  });

  it('needs at least 3 values', () => {
    expect(() => mannKendallHamedRao([1, 2])).toThrow(RangeError);
  });
});

describe('normal distribution (scipy values)', () => {
  it('cumulative distribution', () => {
    const cases: [number, number][] = [
      [0, 0.5], [0.5, 0.6914624612740131], [1, 0.8413447460685429], [-2, 0.022750131948179195],
      [3, 0.9986501019683699], [-5.535127492988429, 1.55501022749524e-8], [6.766934475760837, 0.999999999993423],
    ];
    for (const [z, want] of cases) expectClose(normalCdf(z), want, 0, 1e-15, `cdf(${z})`);
  });

  it('quantiles, with the exact 97.5% point used by the trend test', () => {
    expect(normalQuantile(0.975)).toBe(1.959963984540054);
    const cases: [number, number][] = [
      [0.95, 1.6448536269514722], [0.5, 0], [0.025, -1.9599639845400545], [1e-10, -6.361340902404056],
    ];
    for (const [q, want] of cases) expectClose(normalQuantile(q), want, 0, 1e-15, `ppf(${q})`);
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
    expect(normalQuantile(1.5)).toBeNaN();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Rules of the contract on small hand made series

const point = (yr: number, mo: number, h: number | null, src: Source = 0, modis: number | null = h): MonthlyPoint =>
  ({ yr, mo, h, modis, t: 1, a: 2, s: 3, n: 4, j: 5, src });

/** One point per month of the given years; value(yr, mo) gives h. */
function years(from: number, to: number, value: (yr: number, mo: number) => number | null, src: Source = 0): MonthlyPoint[] {
  const out: MonthlyPoint[] = [];
  for (let yr = from; yr <= to; yr++) {
    for (let mo = 1; mo <= 12; mo++) {
      const v = value(yr, mo);
      out.push(point(yr, mo, v, v === null ? 3 : src));
    }
  }
  return out;
}

describe('the year up to a month (the year tile follows the map month)', () => {
  // h = month number up to 2013 and 10 × month from 2014, so January to March is 6, then 60; 2026 stops in October
  const pts = [
    ...years(2001, 2025, (yr, mo) => (yr <= 2013 ? mo : 10 * mo)),
    ...years(2026, 2026, (_yr, mo) => (mo <= 10 ? 20 * mo : null)),
  ];

  it('sums January to the month and compares it with the median of the same months in the base years', () => {
    expect(yearToMonth(pts, 'harmonized', 2026, 3)).toEqual({ yr: 2026, lastMonth: 3, total: 120, normal: 6, ratio: 20 });
    expect(yearToMonth(pts, 'harmonized', 2020, 12)).toEqual({ yr: 2020, lastMonth: 12, total: 780, normal: 78, ratio: 10 });
    expect(yearToMonth(pts, 'harmonized', 2026, 10)?.total).toBe(20 * 55);
  });

  it('leaves out the base years that miss one of these months', () => {
    const gap = pts.map((p) => (p.yr <= 2013 && p.mo === 2 ? point(p.yr, p.mo, null, 3) : p));
    expect(yearToMonth(gap, 'harmonized', 2026, 3)?.normal).toBe(60);   // only 2014 to 2025 know February
    expect(yearToMonth(gap, 'harmonized', 2026, 1)?.normal).toBe(1);    // January: all 25 years, 13 of them at 1
  });

  it('uses the chosen scale', () => {
    const modis = pts.map((p) => point(p.yr, p.mo, p.h, p.src, p.h === null ? null : p.h / 2));
    expect(yearToMonth(modis, 'modis', 2026, 3)).toEqual({ yr: 2026, lastMonth: 3, total: 60, normal: 3, ratio: 20 });
  });

  it('has no answer for a year that does not know every month up to the month', () => {
    expect(yearToMonth(pts, 'harmonized', 2026, 11)).toBeNull();                 // November 2026 is not known
    const record = [...years(2000, 2000, (_yr, mo) => (mo >= 11 ? 5 : null)), ...pts];
    expect(yearToMonth(record, 'harmonized', 2000, 11)).toBeNull();              // the record starts in November 2000
    expect(yearToMonth(record, 'harmonized', 2001, 11)?.total).toBe(66);
    expect(yearToMonth(pts, 'harmonized', 2027, 1)).toBeNull();
    expect(yearToMonth(pts, 'harmonized', 2026, 0)).toBeNull();
    expect(yearToMonth(pts, 'harmonized', 2026, 13)).toBeNull();
    expect(yearToMonth([], 'harmonized', 2026, 1)).toBeNull();
  });

  it('gives no ratio when the normal is zero', () => {
    const none = years(2001, 2026, () => 0);
    expect(yearToMonth(none, 'harmonized', 2026, 5)).toEqual({ yr: 2026, lastMonth: 5, total: 0, normal: 0, ratio: null });
  });
});

describe('valueOf', () => {
  it('picks the scale and treats src 3 as unknown', () => {
    const p = point(2020, 5, 10, 0, 4);
    expect(valueOf(p, 'harmonized')).toBe(10);
    expect(valueOf(p, 'modis')).toBe(4);
    expect(valueOf(p, 'raw')).toBe(10);
    expect(valueOf(point(2020, 5, null, 3), 'harmonized')).toBeNull();
    expect(valueOf({ ...p, src: 3 }, 'harmonized')).toBeNull();
  });
});

describe('climatology and anomalies', () => {
  it('interpolates quantiles like pandas and skips unknown months', () => {
    const pts = [point(2001, 1, 1), point(2002, 1, 2), point(2003, 1, 3), point(2004, 1, 4), point(2005, 1, null, 3)];
    const jan = climatology(pts, 'harmonized', [2001, 2005])[0];
    expect(jan).toEqual({ mo: 1, median: 2.5, q25: 1.75, q75: 3.25 });
    expect(climatology(pts, 'harmonized', [2001, 2005])[1]).toEqual({ mo: 2, median: null, q25: null, q75: null });
  });

  it('ranks every year, shares ties, and gives null fields for unknown months', () => {
    const pts = [point(2000, 12, 9), point(2001, 12, 5), point(2002, 12, 5), point(2003, 12, 1), point(2004, 12, null, 3)];
    const got = anomalies(pts, 'harmonized', [2001, 2003]);
    expect(got.map((a) => a.rank)).toEqual([1, 2, 2, 4, null]);
    expect(got.map((a) => a.years)).toEqual([4, 4, 4, 4, 4]);
    expect(got[1]).toMatchObject({ value: 5, median: 5, ratio: 1 });
    expect(got[1].percentile).toBeCloseTo((100 * 3) / 3);   // 1, 5, 5 are all ≤ 5
    expect(got[3].percentile).toBeCloseTo(100 / 3);
    expect(got[4]).toEqual({ yr: 2004, mo: 12, value: null, median: 5, ratio: null, percentile: null, rank: null, years: 4 });
  });

  it('has no ratio when the normal is zero', () => {
    const pts = [point(2001, 3, 0), point(2002, 3, 0), point(2003, 3, 2)];
    expect(anomalies(pts, 'harmonized', [2001, 2003])[2]).toMatchObject({ median: 0, ratio: null, rank: 1 });
  });
});

describe('season', () => {
  // A season that peaks in August and is quiet in February
  const shape = [5, 1, 5, 10, 20, 60, 200, 400, 150, 40, 10, 6];
  const pts = years(2001, 2025, (yr, mo) => shape[mo - 1] * (1 + ((yr * 7 + mo) % 5) / 50));

  it('finds the critical months, the fire year start and the peak', () => {
    expect(criticalMonths(pts, 'harmonized')).toEqual([7, 8, 9]);
    expect(fireYearStart(pts, 'harmonized')).toBe(3);
    expect(season(pts, 'harmonized')).toEqual({ fireYearStartMonth: 3, criticalMonths: [7, 8, 9], peakMonth: 8 });
  });

  it('wraps the fire year start after December', () => {
    const quietDecember = years(2001, 2005, (_yr, mo) => (mo === 12 ? 1 : 10));
    expect(fireYearStart(quietDecember, 'harmonized')).toBe(1);
  });

  it('has no peak and no critical months without fire', () => {
    const none = years(2001, 2025, () => 0);
    expect(season(none, 'harmonized')).toEqual({ fireYearStartMonth: 2, criticalMonths: [], peakMonth: null });
  });
});

describe('yearly totals and trend', () => {
  it('sums each year and keeps the worst source of the known months', () => {
    const pts = [
      point(2000, 11, 3, 2), point(2000, 12, 4, 2),
      ...years(2002, 2002, (_yr, mo) => mo).map((p) => ({ ...p, src: (p.mo <= 6 ? 2 : 1) as Source })),
      point(2026, 1, 7, 0), point(2026, 2, null, 3),
    ];
    expect(annualTotals(pts, 'harmonized')).toEqual([
      { yr: 2000, total: 7, months: 2, complete: false, src: 2 },
      { yr: 2002, total: 78, months: 12, complete: true, src: 2 },
      { yr: 2026, total: 7, months: 1, complete: false, src: 0 },
    ]);
  });

  it('needs 8 full years and skips years with an unknown month', () => {
    const grow = (yr: number): number => 100 + 10 * (yr - 2001);
    const seven = years(2001, 2007, (yr) => grow(yr));
    expect(trend(seven, 'harmonized').direction).toBe('not enough data');
    const withHole = years(2001, 2008, (yr, mo) => (yr === 2004 && mo === 6 ? null : grow(yr)));
    expect(trend(withHole, 'harmonized')).toEqual({
      years: 7, direction: 'not enough data', p: null, sen_slope_per_year: null, pct_per_decade: null,
    });
    const rising = trend(years(2001, 2012, (yr, mo) => grow(yr) + ((yr * 13 + mo * 7) % 11)), 'harmonized');
    expect(rising.years).toBe(12);
    expect(rising.direction).toBe('increasing');
    expect(rising.p).toBeLessThan(0.05);
    expect(rising.sen_slope_per_year).toBeGreaterThan(0);
  });

  it('says not enough data when there is no fire at all', () => {
    expect(trend(years(2001, 2025, () => 0), 'harmonized').direction).toBe('not enough data');
  });
});

describe('intervalFor', () => {
  const table = (bands: IntervalTable['bands']): IntervalTable =>
    ({ method: 'test', level: 0.9, bands, calibration_units: 1, coverage_by_scale: {} });
  const meta: Pick<Meta, 'intervals'> = {
    intervals: {
      terra_aqua_month: table([
        { mu_min: 0, mu_max: 10, q_lo: -1, q_hi: 2, units: 1 },
        { mu_min: 10, mu_max: null, q_lo: -0.1, q_hi: 0.2, units: 1 },
      ]),
      terra_aqua_year: table([{ mu_min: 0, mu_max: null, q_lo: -0.05, q_hi: 0.05, units: 1 }]),
      terra_only_month: table([{ mu_min: 0, mu_max: null, q_lo: -0.3, q_hi: 0.4, units: 1 }]),
      terra_only_year: table([{ mu_min: 1000, mu_max: null, q_lo: 0.01, q_hi: 0.03, units: 1 }]),
    },
  };

  it('has no range for observed or unknown months', () => {
    expect(intervalFor(50, 0, 'month', meta)).toBeNull();
    expect(intervalFor(50, 3, 'month', meta)).toBeNull();
    expect(intervalFor(null, 1, 'month', meta)).toBeNull();
  });

  it('uses the band of the total, with no upper limit when mu_max is null', () => {
    expect(intervalFor(5, 1, 'month', meta)).toEqual({ lo: 0, hi: 15 });            // lower end clipped at 0
    expect(intervalFor(10, 1, 'month', meta)).toEqual({ lo: 9, hi: 12 });           // mu_min ≤ total < mu_max
    expect(intervalFor(1e9, 1, 'month', meta)).toEqual({ lo: 9e8, hi: 1.2e9 });
    expect(intervalFor(100, 1, 'year', meta)).toEqual({ lo: 95, hi: 105 });
    expect(intervalFor(100, 2, 'month', meta)).toEqual({ lo: 70, hi: 140 });
    expect(intervalFor(2000, 2, 'year', meta)).toEqual({ lo: 2020, hi: 2060 });
    expect(intervalFor(500, 2, 'year', meta)).toBeNull();                            // below every band
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The world series of the fixture, as the app sees it

describe('latest month, year to date and fire brief (world fixture)', () => {
  const world = ref.areas.find((a) => a.name === 'world:WORLD') ?? ref.areas[0];
  const points = toPoints(world.series);
  const meta: Pick<Meta, 'intervals'> = {
    intervals: {
      terra_aqua_month: { method: '', level: 0.9, bands: [], calibration_units: 0, coverage_by_scale: {} },
      terra_aqua_year: { method: '', level: 0.9, bands: [], calibration_units: 0, coverage_by_scale: {} },
      terra_only_month: { method: '', level: 0.9, bands: [], calibration_units: 0, coverage_by_scale: {} },
      terra_only_year: { method: '', level: 0.9, bands: [], calibration_units: 0, coverage_by_scale: {} },
    },
  };

  it('skips the unknown last month', () => {
    expect(points[points.length - 1].h).toBeNull();
    expect(latestCompleteMonth(points)).toBe(points[points.length - 2]);
    expect(latestCompleteMonth([])).toBeNull();
  });

  it('compares the year so far with the same months of the base years', () => {
    const ytd = yearToDate(points, 'harmonized');
    const latest = latestCompleteMonth(points);
    expect(ytd).not.toBeNull();
    if (ytd === null || latest === null) return;
    expect([ytd.yr, ytd.lastMonth]).toEqual([latest.yr, latest.mo]);
    const sum = points.filter((p) => p.yr === latest.yr && p.mo <= latest.mo).reduce((s, p) => s + (p.h ?? 0), 0);
    expect(ytd.total).toBeCloseTo(sum, 3);
    expect(ytd.normal).toBeGreaterThan(0);
    expect(ytd.ratio).toBeCloseTo(ytd.total / (ytd.normal ?? 1), 12);
    expect(yearToMonth(points, 'harmonized', ytd.yr, ytd.lastMonth)).toEqual(ytd);
  });

  it('writes 2 to 4 plain sentences', () => {
    const text = fireBrief('World', points, 'harmonized', meta);
    const sentences = text.split(/(?<=\.)\s+/);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(4);
    expect(text).not.toMatch(/\w-\w/);                       // no hyphenated words
    expect(text).not.toMatch(/NaN|undefined|null|Infinity/);
    expect(text).toContain('October 2026');
    expect(text).toContain('the world');
    expect(text).toContain('clearly fell');
  });

  it('describes the latest month, its rank, the year so far and the trend', () => {
    expect(fireBrief('World', points, 'harmonized', meta)).toBe(
      'In October 2026, the world had 1.33 million hotspots, 6% below normal for October. ' +
      'It was the 19th highest October in 26 years. ' +
      'From January to October 2026, there were 13 million hotspots, 12% below normal for this time of year. ' +
      'From 2001 to 2025, yearly fire clearly fell, by about 6.3% every ten years.',
    );
  });

  it('describes the month on the map when it has a value, else the latest month', () => {
    const latest = fireBrief('World', points, 'harmonized', meta);
    const last = points[points.length - 1];
    expect(fireBrief('World', points, 'harmonized', meta, 202610)).toBe(latest);
    expect(fireBrief('World', points, 'harmonized', meta, last.yr * 100 + last.mo)).toBe(latest); // unknown month
    expect(fireBrief('World', points, 'harmonized', meta, 199901)).toBe(latest);                  // before the record
    const past = fireBrief('World', points, 'harmonized', meta, 201509);
    const sentences = past.split(/(?<=\.)\s+/);
    expect(sentences).toHaveLength(4);
    expect(sentences[0]).toMatch(/^In September 2015, the world had [\d.,]+( million)? hotspots, /);
    expect(sentences[1]).toMatch(/^It was the (\d+(st|nd|rd|th) )?(highest|lowest) September in 26 years\.$/);
    const ytd = yearToMonth(points, 'harmonized', 2015, 9);
    expect(ytd).not.toBeNull();
    expect(sentences[2]).toMatch(/^From January to September 2015, there were [\d.,]+( million)? hotspots, /);
    expect(sentences[3]).toBe('From 2001 to 2025, yearly fire clearly fell, by about 6.3% every ten years.');
    expect(fireBrief('World', points, 'harmonized', meta, 201612)).toContain(' In 2016 as a whole, there were ');
    // the first month of the record: no "January to November" from a single month
    expect(fireBrief('World', points, 'harmonized', meta, 200011)).not.toContain('From January');
  });

  it('gives the 90% range of a modelled month', () => {
    const modelled = [...years(2001, 2010, (_yr, mo) => 100 + mo, 1)];
    const withBands: Pick<Meta, 'intervals'> = {
      intervals: { ...meta.intervals, terra_aqua_month: { ...meta.intervals.terra_aqua_month, bands: [
        { mu_min: 0, mu_max: null, q_lo: -0.1, q_hi: 0.2, units: 1 },
      ] } },
    };
    const text = fireBrief('Riau', modelled, 'harmonized', withBands);
    expect(text).toContain('In December 2010, Riau had 112 hotspots (likely 101 to 134), close to normal for December.');
  });

  it('handles an area without data', () => {
    expect(fireBrief('Nowhere', [], 'harmonized', meta)).toBe('There is no data for Nowhere yet.');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Explorer helpers: colour classes, scales, the critical period, links and the CSV

describe('round numbers', () => {
  it('rounds down and up to 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a power of ten', () => {
    expect(niceNumber(818_439, 'down')).toBe(800_000);
    expect(niceNumber(2_645_799, 'up')).toBe(3_000_000);
    expect(niceNumber(21.8, 'down')).toBe(20);
    expect(niceNumber(59_652, 'up')).toBe(60_000);
    expect(niceNumber(0.3, 'down')).toBe(0.3);
    expect(niceNumber(0.31, 'up')).toBe(0.4);
    expect(niceNumber(1000, 'up')).toBe(1000);
    expect(niceNumber(1001, 'up')).toBe(1200);
    expect(niceNumber(9.5, 'up')).toBe(10);
  });
});

describe('count colour scale', () => {
  it('spans the 2% and 98% quantiles of the months with fire, in round numbers', () => {
    const values = Array.from({ length: 101 }, (_, i) => 10 * (i + 1));    // 10 .. 1010
    expect(countScale(values)).toEqual({ lo: 30, hi: 1000 });
  });

  it('ignores months without fire and unknown months', () => {
    expect(countScale([0, null, 0])).toBeNull();
    expect(countScale([0, null, 5, 5, 5])).toEqual({ lo: 2.5, hi: 10 });   // widened to at least 3 times
  });

  it('shows the season of the world as well as of a small state', () => {
    const world = Array.from({ length: 300 }, (_, i) => 800_000 + 6000 * i);       // 0.8 to 2.6 million
    const s = countScale(world);
    expect(s).not.toBeNull();
    if (!s) return;
    const classes = new Set(world.map((v) => countClass(v, s)));
    expect(classes.size).toBeGreaterThanOrEqual(6);
  });

  it('puts values in 9 log classes, with -1 for no fire', () => {
    const s = { lo: 1, hi: 1e9 };
    expect(countClass(0, s)).toBe(-1);
    expect(countClass(0.5, s)).toBe(0);
    expect(countClass(1, s)).toBe(0);
    expect(countClass(10, s)).toBe(1);
    expect(countClass(1e5, s)).toBe(5);
    expect(countClass(1e9, s)).toBe(8);
    expect(countClass(1e12, s)).toBe(8);
    const edges = classEdges(s);
    expect(edges).toHaveLength(10);
    expect(edges[0]).toBeCloseTo(1, 9);
    expect(edges[3]).toBeCloseTo(1000, 6);
    expect(edges[9]).toBeCloseTo(1e9, 0);
  });
});

describe('against normal colour scale', () => {
  it('picks the smallest round limit that covers 90% of the months', () => {
    const steady: [number, number][] = Array.from({ length: 100 }, (_, i) => [100 * (1 + 0.002 * i), 100]);   // up to 1.2 times
    expect(ratioLimit(steady)).toBe(1.25);
    const wild: [number, number][] = Array.from({ length: 100 }, (_, i) => [i % 2 ? 300 : 30, 100]);
    expect(ratioLimit(wild)).toBe(4);
    expect(ratioLimit([[0, 10], [0, 10], [5, 10]])).toBe(16);        // no fire where fire is normal: very far
    expect(ratioLimit([[5, 0], [null, 10]])).toBe(4);                 // nothing to compare
  });

  it('centres normal on class 4, with the limit at the ends', () => {
    expect(ratioClass(100, 100, 4)).toBe(4);
    expect(ratioClass(400, 100, 4)).toBe(8);
    expect(ratioClass(25, 100, 4)).toBe(0);
    expect(ratioClass(200, 100, 4)).toBe(6);
    expect(ratioClass(1000, 100, 4)).toBe(8);
    expect(ratioClass(0, 100, 4)).toBe(0);
    expect(ratioClass(5, 0, 4)).toBe(8);       // fire where none is normal
    expect(ratioClass(0, 0, 4)).toBe(4);       // no fire, as usual
    expect(ratioClass(null, 100, 4)).toBeNull();
    expect(ratioClass(10, null, 4)).toBeNull();
    expect(ratioClass(112, 100, 1.25)).toBe(6);
  });
});

describe('scales and wording', () => {
  it('reads the MODIS scale and the raw detections as harmonized points', () => {
    const p = point(2020, 5, 10, 0, 4);
    expect(onScale([p], 'harmonized')[0]).toBe(p);
    expect(onScale([p], 'modis')[0].h).toBe(4);
    expect(onScale([p], 'raw')[0].h).toBe(15);
    expect(rawTotal(p)).toBe(15);
    expect(onScale([point(2026, 11, null, 3)], 'raw')[0].h).toBeNull();
  });

  it('words a month against normal like the brief', () => {
    expect(comparedWithNormal(0.94)).toBe('6% below normal');
    expect(comparedWithNormal(1.02)).toBe('close to normal');
    expect(comparedWithNormal(2.4)).toBe('2.4 times normal');
    expect(ratioDirection(0.94)).toBe('down');
    expect(ratioDirection(1.04)).toBe('flat');
    expect(ratioDirection(1.5)).toBe('up');
  });

  it('groups the critical months into runs, across the new year', () => {
    expect(monthRuns([8, 9, 10])).toEqual([[8, 10]]);
    expect(monthRuns([1, 2, 12])).toEqual([[12, 2]]);
    expect(monthRuns([1, 2, 3, 8, 9])).toEqual([[1, 3], [8, 9]]);
    expect(monthRuns([5])).toEqual([[5, 5]]);
    expect(monthRuns([])).toEqual([]);
    expect(monthRuns([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toEqual([[1, 12]]);
  });

  it('measures a drawn area', () => {
    const square: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    expect(ringAreaKm2(square)).toBeGreaterThan(12_300);
    expect(ringAreaKm2(square)).toBeLessThan(12_400);
  });
});

describe('links to the Explorer', () => {
  const idn = { kind: 'country', id: 'IDN', name: 'Indonesia', country_iso3: 'IDN', lat: -2.6, lon: 116.5, cells: 1, area_km2: 1 } as const;

  it('tells the Explorer hashes from the other pages', () => {
    for (const h of ['', '#', '#/', '#/?area=country:IDN', '#?area=state:IDN-1931']) expect(isExplorerHash(h)).toBe(true);
    for (const h of ['#/haze', '#/dashboard', '#/methods', '#/data?x=1']) expect(isExplorerHash(h)).toBe(false);
  });

  const none = { mode: null, view: null, scale: null, tab: null, period: null, cal: null, search: false };

  it('reads named places, drawn areas and the month', () => {
    expect(parseExplorerLink('#/?area=country:IDN')).toEqual({
      area: { type: 'named', kind: 'country', id: 'IDN' }, month: null, ...none, invalid: false });
    expect(parseExplorerLink('#/?area=state:IDN-1931').area).toEqual({ type: 'named', kind: 'state', id: 'IDN-1931' });
    expect(parseExplorerLink('#/?area=continent:North%20America').area)
      .toEqual({ type: 'named', kind: 'continent', id: 'North America' });
    expect(parseExplorerLink('#/?area=continent:Africa&month=2015-09')).toEqual({
      area: { type: 'named', kind: 'continent', id: 'Africa' }, month: { yr: 2015, mo: 9 }, ...none, invalid: false });
    expect(parseExplorerLink('#/?area=world:WORLD').area).toEqual({ type: 'named', kind: 'world', id: 'WORLD' });
    expect(parseExplorerLink('#/?area=circle:3.14,101.69,50').area)
      .toEqual({ type: 'circle', lat: 3.14, lon: 101.69, radiusKm: 50 });
    expect(parseExplorerLink('#/?area=polygon:100,2;102,2;102,4').area)
      .toEqual({ type: 'polygon', ring: [[100, 2], [102, 2], [102, 4]] });
    expect(parseExplorerLink('#/?area=hex:8365A3FFFFFFFFF').area).toEqual({ type: 'hex', h3: '8365a3fffffffff' });
    expect(parseExplorerLink('#/')).toEqual({ area: null, month: null, ...none, invalid: false });
  });

  it('reads the month as yyyymm and the view (the deep link contract)', () => {
    expect(parseExplorerLink('#/?area=state:IDN-1931&month=202610')).toEqual({
      area: { type: 'named', kind: 'state', id: 'IDN-1931' }, month: { yr: 2026, mo: 10 }, ...none, invalid: false });
    expect(parseExplorerLink('#/?area=country:IDN&month=201509&mode=anomaly&view=3d&scale=modis')).toEqual({
      area: { type: 'named', kind: 'country', id: 'IDN' }, month: { yr: 2015, mo: 9 },
      mode: 'anomaly', view: '3d', scale: 'modis', tab: null, period: null, cal: null, search: false, invalid: false });
    expect(parseExplorerLink('#/?view=3D&scale=raw&mode=count')).toMatchObject({ view: '3d', scale: 'raw', mode: 'count', invalid: false });
    expect(parseLinkMonth('202610')).toEqual({ yr: 2026, mo: 10 });
    expect(parseLinkMonth('2026-1')).toEqual({ yr: 2026, mo: 1 });
    expect(parseLinkMonth('20261')).toBeNull();
    expect(parseLinkMonth('202613')).toBeNull();
    // a readable month outside the record is read (the Explorer shows the nearest month and says so)
    expect(parseLinkMonth('199901')).toEqual({ yr: 1999, mo: 1 });
    expect(parseLinkMonth('189912')).toBeNull();
  });

  it('flags links it cannot read', () => {
    expect(parseExplorerLink('#/?area=planet:Mars').invalid).toBe(true);
    expect(parseExplorerLink('#/?area=country:').invalid).toBe(true);
    expect(parseExplorerLink('#/?area=circle:95,10,50').invalid).toBe(true);
    expect(parseExplorerLink('#/?area=polygon:1,2;3,4').invalid).toBe(true);
    expect(parseExplorerLink('#/?area=hex:12345').invalid).toBe(true);
    expect(parseExplorerLink('#/?area=country:IDN&month=2015-13')).toEqual({
      area: { type: 'named', kind: 'country', id: 'IDN' }, month: null, ...none, invalid: true });
    expect(parseExplorerLink('#/?mode=hot').invalid).toBe(true);
    expect(parseExplorerLink('#/?view=4d').invalid).toBe(true);
    expect(parseExplorerLink('#/?scale=terra').invalid).toBe(true);
  });

  it('writes links that read back the same', () => {
    expect(explorerLink({ type: 'named', area: { ...idn } })).toBe('#/?area=country:IDN');
    expect(explorerLink({ type: 'named', area: { ...idn, kind: 'world', id: 'WORLD' } })).toBe('#/');
    expect(explorerLink({ type: 'named', area: { ...idn, kind: 'world', id: 'WORLD' } }, { yr: 2015, mo: 9 })).toBe('#/?month=201509');
    const cont = explorerLink({ type: 'named', area: { ...idn, kind: 'continent', id: 'North America' } }, { yr: 2019, mo: 3 });
    expect(cont).toBe('#/?area=continent:North%20America&month=201903');
    expect(parseExplorerLink(cont)).toEqual({
      area: { type: 'named', kind: 'continent', id: 'North America' }, month: { yr: 2019, mo: 3 }, ...none, invalid: false });
    const circle = explorerLink({ type: 'circle', lat: 3.123456, lon: 101.654321, radiusKm: 50 });
    expect(circle).toBe('#/?area=circle:3.1235,101.6543,50');
    const ring: [number, number][] = [[100, 2], [102, 2], [102, 4], [100, 2]];
    const poly = explorerLink({ type: 'polygon', ring });
    expect(poly).toBe('#/?area=polygon:100,2;102,2;102,4');
    expect(parseExplorerLink(poly).area).toEqual({ type: 'polygon', ring: ring.slice(0, 3) });
  });

  it('writes the view only where it differs from the defaults, and hexagons by their index', () => {
    const sel = { type: 'named', area: { ...idn } } as const;
    expect(explorerLink(sel, { yr: 2026, mo: 10 }, { mode: 'count', view: '2d', scale: 'harmonized' }))
      .toBe('#/?area=country:IDN&month=202610');
    const all = explorerLink(sel, { yr: 2026, mo: 10 }, { mode: 'anomaly', view: '3d', scale: 'raw' });
    expect(all).toBe('#/?area=country:IDN&month=202610&mode=anomaly&view=3d&scale=raw');
    expect(parseExplorerLink(all)).toMatchObject({ mode: 'anomaly', view: '3d', scale: 'raw', invalid: false });
    const hex = explorerLink({ type: 'polygon', ring: [[100, 2], [102, 2], [102, 4]] }, null, { hex: '8365a3fffffffff' });
    expect(hex).toBe('#/?area=hex:8365a3fffffffff');
    expect(parseExplorerLink(hex).area).toEqual({ type: 'hex', h3: '8365a3fffffffff' });
  });
});

describe('months as yyyymm', () => {
  it('adds and counts months across years', () => {
    expect(ymOf(2026, 10)).toBe(202610);
    expect(addMonths(202610, 1)).toBe(202611);
    expect(addMonths(202612, 1)).toBe(202701);
    expect(addMonths(202601, -1)).toBe(202512);
    expect(addMonths(200011, -23)).toBe(199812);
    expect(addMonths(201509, 12)).toBe(201609);
    expect(monthsBetween(200011, 202610)).toBe(311);
    expect(monthsBetween(202610, 200011)).toBe(-311);
    expect(monthsBetween(201509, 201509)).toBe(0);
  });

  it('steps within the record, or wraps for the player', () => {
    expect(stepMonth(202610, 1, 200011, 202610)).toBe(202610);
    expect(stepMonth(202610, -12, 200011, 202610)).toBe(202510);
    expect(stepMonth(200011, -1, 200011, 202610)).toBe(200011);
    expect(stepMonth(202610, 1, 200011, 202610, true)).toBe(200011);
    expect(stepMonth(200011, -1, 200011, 202610, true)).toBe(202610);
    expect(stepMonth(200111, 12, 200011, 202610, true)).toBe(200211);
  });

  it('finds the known months and writes short month codes', () => {
    const pts: MonthlyPoint[] = [
      { yr: 2000, mo: 10, h: null, modis: null, t: 0, a: 0, s: 0, n: 0, j: 0, src: 3 },
      { yr: 2000, mo: 11, h: 5, modis: 1, t: 0, a: 0, s: 0, n: 0, j: 0, src: 2 },
      { yr: 2026, mo: 10, h: 7, modis: 1, t: 0, a: 0, s: 0, n: 0, j: 0, src: 0 },
      { yr: 2026, mo: 11, h: null, modis: null, t: 0, a: 0, s: 0, n: 0, j: 0, src: 3 },
    ];
    expect(knownRange(pts)).toEqual({ first: 200011, last: 202610 });
    expect(knownRange([pts[0]])).toBeNull();
    expect(monthCode(202610, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])).toBe('OCT 2026');
  });

  it('gives 3D hexagons a height that grows with the square root of fire, capped', () => {
    expect(hexHeight(0, 100, 1000)).toBe(0);
    expect(hexHeight(-1, 100, 1000)).toBe(0);
    expect(hexHeight(25, 100, 1000)).toBeCloseTo(500, 9);
    expect(hexHeight(100, 100, 1000)).toBe(1000);
    expect(hexHeight(1e6, 100, 1000)).toBe(1000);
    expect(hexHeight(10, 0, 1000)).toBe(0);
  });
});

describe('hexagons as areas, and where the camera goes (geo helpers of the Explorer)', () => {
  const amapa = '83804cfffffffff';   // a level 3 hexagon at the mouth of the Amazon (the browser test clicks it)

  it('knows a hexagon index', () => {
    expect(isHexagon(amapa)).toBe(true);
    expect(isHexagon('8365a3fffffffff')).toBe(true);
    expect(isHexagon('not a hexagon')).toBe(false);
    expect(isHexagon('')).toBe(false);
  });

  it('outlines a hexagon around its centre, with its area', () => {
    const ring = hexRing(amapa);
    expect(ring.length).toBeGreaterThanOrEqual(6);
    const [lat, lon] = hexCentre(amapa);
    const b = ringBoundsOf([ring]);
    expect(b).not.toBeNull();
    if (!b) return;
    expect(lon).toBeGreaterThan(b[0][0]);
    expect(lon).toBeLessThan(b[1][0]);
    expect(lat).toBeGreaterThan(b[0][1]);
    expect(lat).toBeLessThan(b[1][1]);
    expect(hexAreaKm2(amapa)).toBeGreaterThan(9_000);     // level 3: about 12,400 km² on average
    expect(hexAreaKm2(amapa)).toBeLessThan(16_000);
  });

  it('keeps the outline of a hexagon on the date line in one piece', () => {
    const ring = hexRing(latLngToCell(-16.5, 179.99, 3));   // Fiji
    const jumps = ring.slice(1).map((p, i) => Math.abs(p[0] - ring[i][0]));
    expect(Math.max(...jumps)).toBeLessThan(10);
    const b = ringBoundsOf([ring]);
    expect(b).not.toBeNull();
    if (!b) return;
    const width = b[1][0] - b[0][0];
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThan(10);                           // not the long way round the globe
  });

  it('gives rough camera bounds from a centre and an area', () => {
    const small = approxBounds(0, 100, 100);                  // a tiny place: still 170 km across
    expect(small[1][0] - small[0][0]).toBeCloseTo(170 / 111.2, 9);
    expect(small[1][1] - small[0][1]).toBeCloseTo(170 / 111.2, 9);
    expect((small[0][0] + small[1][0]) / 2).toBeCloseTo(100, 9);
    const north = approxBounds(60, 10, 1e6);                  // 1,000 km square, 1.3 times: twice as wide at 60°
    expect(north[1][1] - north[0][1]).toBeCloseTo(1300 / 111.2, 9);
    expect(north[1][0] - north[0][0]).toBeCloseTo(1300 / 111.2 / 0.5, 6);
    const pole = approxBounds(88, 0, 4e6);                    // stays on the globe
    expect(pole[1][1]).toBe(90);
    expect(pole[1][0] - pole[0][0]).toBeLessThanOrEqual(360);
  });
});

describe('the month grid of one map hexagon', () => {
  const row = (yr: number, mo: number, h: number, src = 0): HexRow => ({ yr, mo, h, modis: h / 2, t: 1, a: 2, s: 3, n: 4, j: 5, src });
  const meta = { first_month: 200010, last_month: 200103 };
  // October 2000 and March 2001 are unknown everywhere (world source 3); the rest is known
  const world = new Map<number, Source>([[200010, 3], [200011, 2], [200012, 2], [200101, 1], [200102, 1], [200103, 3]]);

  it('gives every month of the record, in order', () => {
    const pts = fillMonths([], meta, world);
    expect(pts.map((p) => p.yr * 100 + p.mo)).toEqual([200010, 200011, 200012, 200101, 200102, 200103]);
  });

  it('has zero fire where the hexagon has no row, and unknown where the world is unknown', () => {
    const pts = fillMonths([row(2001, 2, 7), row(2000, 12, 3, 1)], meta, world);
    expect(pts.map((p) => p.h)).toEqual([null, 0, 3, 0, 7, null]);
    expect(pts.map((p) => p.modis)).toEqual([null, 0, 1.5, 0, 3.5, null]);
    expect(pts.map((p) => p.src)).toEqual([3, 2, 1, 1, 0, 3]);
    expect(pts[4]).toMatchObject({ t: 1, a: 2, s: 3, n: 4, j: 5 });
    expect(pts[1]).toMatchObject({ t: 0, a: 0, s: 0, n: 0, j: 0 });
  });

  it('keeps a row of an unknown month unknown, and copes with an empty range', () => {
    expect(fillMonths([row(2001, 3, 9)], meta, world)[5].h).toBeNull();
    expect(fillMonths([], { first_month: 202611, last_month: 202610 }, world)).toEqual([]);
  });
});

describe('the title of a burning calendar (its finding)', () => {
  const t = DICTS.en;
  const title = (value: (yr: number, mo: number) => number) => calendarTitle(years(2001, 2025, value), t);

  it('names the fire season and its peak', () => {
    expect(title((_yr, mo) => ({ 8: 100, 9: 120, 10: 110 })[mo] ?? 1)).toBe('The fire season is August to October, peaking in September');
  });

  it('keeps a season across the new year in one piece', () => {
    expect(title((_yr, mo) => (mo === 12 || mo === 1 ? 100 : 1))).toBe('The fire season is December to January, peaking in January');
  });

  it('joins two seasons, and says a season of one month once', () => {
    expect(title((_yr, mo) => ({ 2: 90, 3: 95, 8: 100 })[mo] ?? 1)).toBe('The fire season is February to March and August, peaking in August');
    expect(title((_yr, mo) => (mo === 9 ? 100 : 1))).toBe('The fire season is September');
  });

  it('copes with an area without fire', () => {
    expect(title(() => 0)).toBe('In most years there is little or no fire here');
  });

  it('agrees with the critical period of the world fixture', () => {
    const world = ref.areas.find((a) => a.name === 'world:WORLD') ?? ref.areas[0];
    const text = calendarTitle(toPoints(world.series), t);
    expect(text).toMatch(/^(The fire season is [A-Z][a-z]+( to [A-Z][a-z]+)?( and [A-Z][a-z]+( to [A-Z][a-z]+)?)*(, peaking in [A-Z][a-z]+)?|Fire usually peaks in [A-Z][a-z]+)$/);
    expect(text).not.toMatch(/\w-\w/);
  });
});

describe('monthly CSV', () => {
  const meta: Pick<Meta, 'intervals'> = {
    intervals: {
      terra_aqua_month: { method: '', level: 0.9, bands: [{ mu_min: 0, mu_max: null, q_lo: -0.1, q_hi: 0.2, units: 1 }],
        calibration_units: 0, coverage_by_scale: {} },
      terra_aqua_year: { method: '', level: 0.9, bands: [], calibration_units: 0, coverage_by_scale: {} },
      terra_only_month: { method: '', level: 0.9, bands: [], calibration_units: 0, coverage_by_scale: {} },
      terra_only_year: { method: '', level: 0.9, bands: [], calibration_units: 0, coverage_by_scale: {} },
    },
  };
  const pts = [...years(2001, 2025, (_yr, mo) => (mo === 9 ? 200 : 100), 1), point(2026, 1, null, 3)];
  const csv = monthlyCsv('Riau, Indonesia', pts, meta, { citation: 'Cite me.', sourceLabel: (s) => `src ${s}` });
  const lines = csv.trimEnd().split('\n');

  it('starts with comment lines and the header', () => {
    expect(lines[0]).toBe('# Fire Harmony monthly record: Riau, Indonesia');
    expect(lines.filter((l) => l.startsWith('#'))).toHaveLength(5);
    expect(lines[5]).toBe('year,month,harmonized,range_low,range_high,normal,times_normal,source,modis_scale,terra,aqua,suomi_npp,noaa20,noaa21');
    expect(lines).toHaveLength(6 + pts.length);
  });

  it('gives the range, the normal and the month against it', () => {
    expect(lines[6]).toBe('2001,1,100,90,120,100,1,"src 1",100,1,2,3,4,5');
    expect(lines[6 + 8]).toBe('2001,9,200,180,240,200,1,"src 1",200,1,2,3,4,5');
    expect(lines[lines.length - 1]).toBe('2026,1,,,,100,,"src 3",,,,,,');
  });

  it('keeps only the chosen years', () => {
    const some = monthlyCsv('X', pts, meta, { citation: '', sourceLabel: String, years: [2010, 2011] });
    expect(some.trimEnd().split('\n').filter((l) => !l.startsWith('#'))).toHaveLength(1 + 24);
  });
});

describe('outlines across the date line', () => {
  it('keeps longitudes continuous', () => {
    expect(unwrapRing([[179, 0], [-179, 1], [-178, 0], [179, 0]])).toEqual([[179, 0], [181, 1], [182, 0], [179, 0]]);
    expect(unwrapRing([[10, 0], [11, 1], [12, 0]])).toEqual([[10, 0], [11, 1], [12, 0]]);
  });

  it('bounds rings the short way round', () => {
    expect(ringsBounds([[[100, -5], [120, -5], [120, 5], [100, 5]]])).toEqual([[100, -5], [120, 5]]);
    // islands on both sides of the date line (as Fiji or Russia)
    expect(ringsBounds([[[177, -18], [179, -17]], [[-179.5, -16], [-178, -15]]])).toEqual([[177, -18], [182, -15]]);
    // an unwrapped ring past 180
    expect(ringsBounds([[[170, 60], [190, 70]]])).toEqual([[170, 60], [190, 70]]);
    // two far apart pieces on one side: the gap across the date line is left out
    expect(ringsBounds([[[-120, 30], [-70, 45]], [[-10, 40], [5, 50]]])).toEqual([[-120, 30], [5, 50]]);
    expect(ringsBounds([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// What the trend card may say (package explorer-panel)

/** 2001 to 2025 full, 2026 to October: yearly totals that fall steadily from `start` by `step` a year. */
function falling(start: number, step: number): MonthlyPoint[] {
  const out: MonthlyPoint[] = [];
  for (let yr = 2001; yr <= 2026; yr++) {
    for (let mo = 1; mo <= 12; mo++) {
      const known = yr < 2026 || mo <= 10;
      const v = Math.max(0, (start - step * (yr - 2001)) / 12);
      out.push({ yr, mo, h: known ? v : null, modis: known ? v : null, t: 0, a: 0, s: 0, n: 0, j: 0, src: known ? 0 : 3 });
    }
  }
  return out;
}

describe('trendVerdict: the trend card says only what the data supports', () => {
  it('gives the mean of the full years 2001 to 2025', () => {
    expect(meanPerYear(falling(1200, 10), 'harmonized')).toBeCloseTo(1080, 6);
    expect(meanPerYear([], 'harmonized')).toBeNull();
  });

  it('reads no trend under 100 hotspots a year, even a clear one', () => {
    const v = trendVerdict(falling(140, 4), 'harmonized');   // mean 92: under 100
    expect(v.mean).toBeLessThan(TREND_FLOOR_PER_YEAR);
    expect(v.trend.direction).toBe('decreasing');
    expect(v.reading).toBe('little');
    expect(v.clear).toBe(false);
    expect(v.family).toBeNull();
  });

  it('shows a trend from 100 to 1,000 a year with a caution, and in full above', () => {
    const caution = trendVerdict(falling(900, 20), 'harmonized');
    expect(caution.reading).toBe('caution');
    expect(caution.clear).toBe(true);
    const full = trendVerdict(falling(90_000, 2_000), 'harmonized');
    expect(full.reading).toBe('full');
    expect(full.clear).toBe(true);
  });

  it('says whether a tested place still holds among all places', () => {
    const pts = falling(90_000, 2_000);
    const holds = trendVerdict(pts, 'harmonized', { kind: 'state', tested: true, q: 0.01, barrenPct: 1.7, of: 1048 });
    expect(holds.family).toBe('holds');
    const fails = trendVerdict(pts, 'harmonized', { kind: 'country', tested: true, q: 0.057, barrenPct: 0.3, of: 129 });
    expect(fails.family).toBe('fails');
    const barren = trendVerdict(pts, 'harmonized', { kind: 'country', tested: false, q: null, barrenPct: 94, of: 129 });
    expect(barren.family).toBe('barren');
    // a place with too little fire is never in the family; nor is a trend that is not clear
    expect(trendVerdict(falling(140, 4), 'harmonized', { kind: 'state', tested: false, q: null, barrenPct: 0, of: 1048 }).family).toBeNull();
    const flat = falling(5000, 0);
    expect(trendVerdict(flat, 'harmonized', { kind: 'state', tested: true, q: 0.9, barrenPct: 0, of: 1048 }).family).toBeNull();
  });

  it('words the brief by the same rule', () => {
    const none = { method: '', level: 0.9, bands: [], calibration_units: 0, coverage_by_scale: {} };
    const meta: Pick<Meta, 'intervals'> = { intervals: { terra_aqua_month: none, terra_aqua_year: none, terra_only_month: none, terra_only_year: none } };
    expect(fireBrief('Aargau', falling(140, 4), 'harmonized', meta)).toContain('too little fire here (under 100 hotspots a year) for a reliable trend');
    expect(fireBrief('Abra', falling(900, 20), 'harmonized', meta)).toContain('but with this little fire the trend is less certain');
    // a fall that does not hold among all the countries tested together is not called clear (Brazil)
    const pts = falling(90_000, 2_000);
    expect(fireBrief('Brazil', pts, 'harmonized', meta)).toContain('yearly fire clearly fell');
    const fails = fireBrief('Brazil', pts, 'harmonized', meta, null, { kind: 'country', tested: true, q: 0.057, barrenPct: 0.3, of: 129 });
    expect(fails).not.toContain('clearly');
    expect(fails).toContain('but once all 129 countries with enough fire are tested together this fall is not clear.');
    const holds = fireBrief('Riau', pts, 'harmonized', meta, null, { kind: 'state', tested: true, q: 0.01, barrenPct: 1, of: 1048 });
    expect(holds).toContain('yearly fire clearly fell');
  });

  it('never rounds a q value across the 0.05 threshold', () => {
    expect(formatQ(0.0523)).toBe('= 0.052');
    expect(formatQ(0.0572)).toBe('= 0.06');
    expect(formatQ(0.05)).toBe('= 0.05');
    expect(formatQ(0.0504)).toBe('= 0.0504');
    expect(formatQ(0.0496)).toBe('= 0.05');
    expect(formatQ(0.012)).toBe('= 0.01');
    expect(formatQ(0.004)).toBe('= 0.004');
    expect(formatQ(0.0002)).toBe('< 0.001');
  });
});

describe('pinned places and link notes', () => {
  it('reads and writes the places to compare', () => {
    expect(parseCompare('#/?area=state:IDN-1931')).toBeNull();
    expect(parseCompare('#/?compare=country:BRA,state:IDN-1931')).toEqual({ keys: ['country:BRA', 'state:IDN-1931'], invalid: false });
    expect(parseCompare('#/?compare=country:bra,hex:8365A3FFFFFFFFF,country:BRA')).toEqual({ keys: ['country:BRA', 'hex:8365a3fffffffff'], invalid: false });
    // drawn shapes cannot be pinned, nor more than three places (a city circle can)
    expect(parseCompare('#/?compare=polygon:1,2;3,4;5,6')).toEqual({ keys: [], invalid: true });
    expect(parseCompare('#/?compare=country:A,country:B,country:C,country:D')).toEqual({
      keys: ['country:A', 'country:B', 'country:C'], invalid: false, tooMany: true });
    expect(COMPARE_MAX).toBe(3);
    const sel = { type: 'named' as const, area: { kind: 'state' as const, id: 'IDN-1931', name: 'x', country_iso3: 'IDN', lat: 0, lon: 0, cells: 1, area_km2: 1 } };
    const link = explorerLink(sel, null, { compare: ['country:BRA', 'continent:North America'] });
    expect(link).toBe('#/?area=state:IDN-1931&compare=country:BRA,continent:North%20America');
    expect(parseCompare(link)?.keys).toEqual(['country:BRA', 'continent:North America']);
    expect(explorerLink(sel, null, { compare: [] })).toBe('#/?area=state:IDN-1931');
  });

  it('tells which part of a link could not be read', () => {
    expect(linkProblems('#/?area=polygon:1,1;2,2')).toEqual(['area']);
    expect(linkProblems('#/?area=circle:0,0,0')).toEqual(['area']);
    expect(linkProblems('#/?area=state:IDN-1931&month=201513')).toEqual(['month']);
    expect(linkProblems('#/?area=state:IDN-1931&mode=blue')).toEqual(['view']);
    expect(linkProblems('#/?area=state:IDN-1931&month=201509')).toEqual([]);
  });

  it('pins city circles to compare, and their keys survive a link', () => {
    expect(circleKey(-2.209612, 113.910004, 50)).toBe('circle:-2.2096,113.91,50');
    expect(parseCompare('#/?compare=circle:1,2,50')).toEqual({ keys: ['circle:1,2,50'], invalid: false });
    const keys = ['circle:-2.2096,113.91,50', 'state:IDN-1931', 'circle:3.1478,101.6953,25.5'];
    const sel = { type: 'circle' as const, lat: 3.14, lon: 101.69, radiusKm: 50 };
    const link = explorerLink(sel, { yr: 2026, mo: 10 }, { compare: keys });
    expect(link).toBe('#/?area=circle:3.14,101.69,50&month=202610&compare=circle:-2.2096,113.91,50,state:IDN-1931,circle:3.1478,101.6953,25.5');
    expect(parseCompare(link)).toEqual({ keys, invalid: false });
    // the same circle twice is one pin; a circle that cannot be read is left out
    expect(parseCompare('#/?compare=circle:1,2,50,circle:1.00001,2,50')).toEqual({ keys: ['circle:1,2,50'], invalid: false });
    expect(parseCompare('#/?compare=circle:95,2,50,country:BRA')).toEqual({ keys: ['country:BRA'], invalid: true });
    expect(parseCompare('#/?compare=circle:1,2')).toEqual({ keys: [], invalid: true });
  });

  it('shortens a ratio for a pill', () => {
    expect(shortAgainstNormal(6.5)).toBe('6.5×');
    expect(shortAgainstNormal(12.3)).toBe('12.3×');
    expect(shortAgainstNormal(13.84)).toBe('13.8×');
    expect(shortAgainstNormal(25.4)).toBe('25×');
    expect(shortAgainstNormal(1.35)).toBe('+35%');
    expect(shortAgainstNormal(0.4)).toBe('−60%');
    expect(shortAgainstNormal(1.02)).toBe('normal');
  });
});

describe('links keep the tab, the period, the full calendar and the search', () => {
  const sel = { type: 'named' as const, area: { kind: 'state' as const, id: 'IDN-1931', name: 'x', country_iso3: 'IDN', lat: 0, lon: 0, cells: 1, area_km2: 1 } };

  it('writes and reads every tab (the Overview is left out)', () => {
    for (const tab of ['calendar', 'period', 'why', 'outlook'] as const) {
      const link = explorerLink(sel, { yr: 2026, mo: 10 }, { tab });
      expect(link).toBe(`#/?area=state:IDN-1931&month=202610&tab=${tab}`);
      expect(parseExplorerLink(link)).toMatchObject({ tab, invalid: false });
    }
    expect(explorerLink(sel, null, { tab: 'overview' })).toBe('#/?area=state:IDN-1931');
    expect(parseExplorerLink('#/?tab=overview')).toMatchObject({ tab: null, invalid: false });
    expect(parseExplorerLink('#/?tab=CALENDAR').tab).toBe('calendar');
  });

  it('writes the months of the Period tab only with that tab, and reads them back', () => {
    const period = { from: 201507, to: 201511 };
    const link = explorerLink(sel, { yr: 2015, mo: 9 }, { tab: 'period', period });
    expect(link).toBe('#/?area=state:IDN-1931&month=201509&tab=period&from=201507&to=201511');
    expect(parseExplorerLink(link)).toMatchObject({ tab: 'period', period, invalid: false });
    expect(explorerLink(sel, null, { tab: 'calendar', period })).toBe('#/?area=state:IDN-1931&tab=calendar');
    const circle = '#/?area=circle:-2.2096,113.91,50&month=202610&tab=period&from=202610&to=202610';
    expect(parseExplorerLink(circle)).toMatchObject({
      area: { type: 'circle', lat: -2.2096, lon: 113.91, radiusKm: 50 }, month: { yr: 2026, mo: 10 }, tab: 'period',
      period: { from: 202610, to: 202610 }, invalid: false });
    expect(parseExplorerLink('#/?from=2015-07&to=2015-11').period).toEqual(period);
  });

  it('writes and reads the full calendar and the search', () => {
    const link = explorerLink(sel, null, { tab: 'calendar', cal: 'full' });
    expect(link).toBe('#/?area=state:IDN-1931&tab=calendar&cal=full');
    expect(parseExplorerLink(link)).toMatchObject({ tab: 'calendar', cal: 'full', invalid: false });
    expect(parseExplorerLink('#/?search=1')).toMatchObject({ search: true, invalid: false });
    expect(parseExplorerLink('#/?area=state:IDN-1931')).toMatchObject({ search: false, cal: null, tab: null, period: null });
  });

  it('flags values it cannot read, as the view part of the link', () => {
    for (const bad of ['#/?tab=charts', '#/?from=201507', '#/?to=201507', '#/?from=201511&to=201507', '#/?from=2015&to=201507', '#/?cal=big']) {
      expect(parseExplorerLink(bad).invalid, bad).toBe(true);
      expect(linkProblems(bad), bad).toEqual(['view']);
    }
    expect(parseExplorerLink('#/?search=yes').invalid).toBe(true);
    expect(linkProblems('#/?area=state:IDN-1931&tab=period&from=201507&to=201511&cal=full')).toEqual([]);
  });
});

describe('one number style', () => {
  it('writes counts compact in the strip and exact in the details', () => {
    expect(countText(65_657, 'compact')).toBe('65,700');
    expect(countText(65_657, 'exact')).toBe('65,657');
    expect(countText(1_326_011, 'compact')).toBe('1.33 million');
    expect(countText(1_326_011, 'exact')).toBe('1,326,011');
    expect(countText(812.4)).toBe('812');
    expect(countText(2.4)).toBe('about 2');
    expect(countText(2.4, 'exact')).toBe('about 2');
    expect(countText(0.3)).toBe('less than 1');
    expect(countText(3)).toBe('3');
    expect(countText(0)).toBe('0');
    expect(hotspotsText(1)).toBe('1 hotspot');
    expect(hotspotsText(2.4)).toBe('about 2 hotspots');
    expect(hotspotsText(0.3)).toBe('less than 1 hotspot');
    expect(hotspotsText(1.2)).toBe('about 1 hotspot');
  });

  it('gives a ratio one decimal below 20, and a trend whole in the strip and one decimal in the details', () => {
    expect(ratioText(13.84)).toBe('13.8');
    expect(ratioText(5.3)).toBe('5.3');
    expect(ratioText(19.9)).toBe('19.9');
    expect(ratioText(25.4)).toBe('25');
    expect(comparedWithNormal(13.84)).toBe('13.8 times normal');
    expect(comparedWithNormal(0.94)).toBe('6% below normal');
    expect(trendText(-75.84, 'strip')).toBe('−76%');
    expect(trendText(-75.84, 'detail')).toBe('−75.8%');
    expect(trendText(6.3, 'detail')).toBe('+6.3%');
    expect(trendText(-0.01, 'strip')).toBe('0%');
  });

  it('writes a count with its noun', () => {
    expect(plural(1, 'row')).toBe('1 row');
    expect(plural(12, 'row')).toBe('12 rows');
    expect(plural(1, 'month')).toBe('1 month');
  });
});

describe('places with little fire', () => {
  /** A series of 2001 to 2025: modelled before 2012 (src 1) with `modelled` a month and MODIS none, then `observed`. */
  const place = (modelled: number, observed: number): MonthlyPoint[] => {
    const out: MonthlyPoint[] = [];
    for (let yr = 2001; yr <= 2025; yr++) {
      for (let mo = 1; mo <= 12; mo++) {
        const viirs = yr >= 2012;
        out.push({ yr, mo, h: viirs ? observed : modelled, modis: viirs ? 0 : 0, t: 0, a: 0, s: 0, n: 0, j: 0, src: viirs ? 0 : 1 });
      }
    }
    return out;
  };
  const meta: Pick<Meta, 'intervals'> = { intervals: {
    terra_aqua_month: { method: '', level: 0.9, bands: [], calibration_units: 0, coverage_by_scale: {} },
    terra_aqua_year: { method: '', level: 0.9, bands: [], calibration_units: 0, coverage_by_scale: {} },
    terra_only_month: { method: '', level: 0.9, bands: [], calibration_units: 0, coverage_by_scale: {} },
    terra_only_year: { method: '', level: 0.9, bands: [], calibration_units: 0, coverage_by_scale: {} },
  } };

  it('is read from the years VIIRS observed, not from the modelled years', () => {
    const svalbard = place(62, 0.1);       // about 750 a year modelled, about 1 a year observed
    expect(meanPerYear(svalbard, 'harmonized')).toBeGreaterThan(300);
    expect(observedMean(svalbard)).toBeCloseTo(1.2, 6);
    expect(littleFire(svalbard)).toBe(true);
    expect(littleFire(place(100, 100))).toBe(false);
    expect(observedMean(place(1, 1).filter((p) => p.yr < 2012))).toBeNull();
    expect(littleFire([])).toBe(false);
    expect(littleFire(place(0, 0))).toBe(false);          // no fire at all: nothing to warn about
  });

  it('marks the modelled months where MODIS saw none', () => {
    const p = place(62, 0.1);
    expect(modelledWithoutModis(p[0])).toBe(true);
    expect(modelledWithoutModis({ ...p[0], modis: 3 })).toBe(false);
    expect(modelledWithoutModis({ ...p[0], h: 0 })).toBe(false);
    expect(modelledWithoutModis(p[p.length - 1])).toBe(false);   // VIIRS observed
  });

  it('writes no rank and no normal for such a place, and whole numbers', () => {
    const text = fireBrief('Svalbard', place(62, 0.1), 'harmonized', meta);
    expect(text).toContain(LITTLE_FIRE_NORMAL);
    expect(text).not.toMatch(/highest|lowest|usually has none|normal for/);
    expect(text).toContain('less than 1 hotspot');
    expect(text).not.toMatch(/\d\.\d hotspots/);
  });

  it('says when a year after the trend breaks with it', () => {
    const ytd = (ratio: number | null, yr = 2026) => ({ yr, lastMonth: 10, total: 1, normal: 1, ratio });
    expect(breaksTrend(ytd(5.3), { cls: 'falling' })).toBe(true);
    expect(breaksTrend(ytd(1.5), { cls: 'falling' })).toBe(false);
    expect(breaksTrend(ytd(0.4), { cls: 'rising' })).toBe(true);
    expect(breaksTrend(ytd(5.3), { cls: 'unclear' })).toBe(false);
    expect(breaksTrend(ytd(5.3, 2015), { cls: 'falling' })).toBe(false);
    expect(breaksTrend(ytd(null), { cls: 'falling' })).toBe(false);
    expect(breaksTrend(null, { cls: 'falling' })).toBe(false);
  });
});
