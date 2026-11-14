import { describe, expect, it } from 'vitest';
import {
  clampPeriod, csvForPeriod, monthKey, monthState, periodLabel, periodLength, periodMonths, periodStats, pickEnd, presetPeriod, seasonSpan,
  yearLabel,
} from './period';
import type { IntervalTable, Meta, MonthlyPoint, Source } from './types';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A record like the app's: Nov 2000 to Nov 2026, the last month unknown; Terra only, then Terra + Aqua, then VIIRS. */
function series(high: number[], factor: (yr: number) => number = () => 1, last = 202610): MonthlyPoint[] {
  const out: MonthlyPoint[] = [];
  for (let yr = 2000; yr <= 2026; yr++) {
    for (let mo = 1; mo <= 12; mo++) {
      const ym = yr * 100 + mo;
      if (ym < 200011 || ym > 202611) continue;
      const unknown = ym > last;
      const src: Source = unknown ? 3 : yr >= 2012 ? 0 : ym >= 200207 ? 1 : 2;
      const v = (high.includes(mo) ? 100 : 10) * factor(yr);
      out.push({ yr, mo, h: unknown ? null : v, modis: unknown ? null : v / 4, t: 1, a: 2, s: 3, n: 4, j: 5, src });
    }
  }
  return out;
}

const table = (lo: number, hi: number): IntervalTable => ({
  method: 'test', level: 0.9, bands: [{ mu_min: 0, mu_max: null, q_lo: lo, q_hi: hi, units: 100 }], calibration_units: 100,
  coverage_by_scale: {},
});
const META: Pick<Meta, 'intervals'> = {
  intervals: {
    terra_aqua_month: table(-0.2, 0.25), terra_only_month: table(-0.3, 0.4),
    terra_aqua_year: table(-0.1, 0.12), terra_only_year: table(-0.15, 0.2),
  },
};

describe('period basics', () => {
  it('counts, lists, clamps and names months', () => {
    expect(periodLength({ from: 201911, to: 202002 })).toBe(4);
    expect(periodMonths({ from: 201911, to: 202002 })).toEqual([201911, 201912, 202001, 202002]);
    expect(clampPeriod({ from: 199001, to: 203001 }, 200011, 202610)).toEqual({ from: 200011, to: 202610 });
    expect(clampPeriod({ from: 202005, to: 201905 }, 200011, 202610)).toEqual({ from: 201905, to: 202005 });
    expect(periodLabel({ from: 201908, to: 201908 }, SHORT)).toBe('Aug 2019');
    expect(periodLabel({ from: 201908, to: 201910 }, SHORT)).toBe('Aug to Oct 2019');
    expect(periodLabel({ from: 201901, to: 201912 }, SHORT)).toBe('2019');
    expect(periodLabel({ from: 201501, to: 201912 }, SHORT)).toBe('2015 to 2019');
    expect(periodLabel({ from: 201911, to: 202002 }, SHORT)).toBe('Nov 2019 to Feb 2020');
    expect(yearLabel({ from: 201911, to: 202002 })).toBe('2019/20');
    expect(yearLabel({ from: 200912, to: 201001 })).toBe('2009/10');
  });
});

describe('presets', () => {
  const pts = series([8, 9, 10]);
  it('end at the latest known month', () => {
    expect(presetPeriod('last12', pts)).toEqual({ from: 202511, to: 202610 });
    expect(presetPeriod('ytd', pts)).toEqual({ from: 202601, to: 202610 });
    expect(presetPeriod('lastYear', pts)).toEqual({ from: 202501, to: 202512 });
    expect(presetPeriod('all', pts)).toEqual({ from: 200011, to: 202610 });
  });
  it('find the fire season, also across the end of the year', () => {
    expect(seasonSpan(pts)).toEqual({ start: 8, months: 3 });
    expect(presetPeriod('season', pts)).toEqual({ from: 202608, to: 202610 });
    const wet = series([12, 1, 2]);
    expect(seasonSpan(wet)).toEqual({ start: 12, months: 3 });
    expect(presetPeriod('season', wet)).toEqual({ from: 202512, to: 202602 });
  });
  it('give nothing without a known month', () => {
    expect(presetPeriod('last12', series([8], () => 1, 199901))).toBeNull();
  });
});

describe('periodStats', () => {
  const pts = series([8, 9, 10], (yr) => (yr === 2019 ? 2 : 1));

  it('compares a season with the same months of every year', () => {
    const s = periodStats(pts, { from: 201908, to: 201910 }, META);
    expect(s.months).toBe(3);
    expect(s.known).toBe(3);
    expect(s.total).toBe(600);
    expect(s.normal).toBe(300);          // median of 2001 to 2025
    expect(s.ratio).toBe(2);
    expect(s.rank).toBe(1);
    expect(s.ranked).toBe(26);           // 2001 to 2026 (Aug to Oct 2000 is before the record)
    expect(s.range).toBeNull();          // VIIRS observed
    expect(s.observedShare).toBe(1);
    expect(s.peak).toEqual({ yr: 2019, mo: 8, value: 200 });
    expect(s.raw).toEqual({ t: 3, a: 6, s: 9, n: 12, j: 15 });
    expect(s.years.filter((y) => y.selected).map((y) => y.label)).toEqual(['2019']);
    expect(s.years[0].label).toBe('2001');
  });

  it('gives the 90% range of modelled months only', () => {
    const m = periodStats(pts, { from: 200508, to: 200510 }, META);
    expect(m.sources[1]).toBe(3);
    expect(m.range?.lo).toBeCloseTo(240);
    expect(m.range?.hi).toBeCloseTo(375);
    const mixed = periodStats(pts, { from: 201111, to: 201202 }, META);   // 2 modelled months, then 2 observed
    expect(mixed.total).toBe(40);
    expect(mixed.range?.lo).toBeCloseTo(20 + 16);
    expect(mixed.range?.hi).toBeCloseTo(20 + 25);
    expect(mixed.observedShare).toBeCloseTo(0.5);
    const year = periodStats(pts, { from: 200301, to: 200312 }, META);   // 12 modelled months use the yearly table
    expect(year.range?.lo).toBeCloseTo(390 * 0.9);
    expect(year.range?.hi).toBeCloseTo(390 * 1.12);
  });

  it('labels months that cross the end of a year', () => {
    const s = periodStats(pts, { from: 201912, to: 202002 }, META);
    expect(s.total).toBe(40);            // Dec 2019 is doubled in this record
    expect(s.years.find((y) => y.selected)?.label).toBe('2019/20');
    expect(s.years.some((y) => y.label === '2000/01')).toBe(true);   // Dec 2000 to Feb 2001 is known
  });

  it('compares a long period per year', () => {
    const s = periodStats(pts, { from: 201501, to: 201912 }, META);
    expect(s.months).toBe(60);
    expect(s.total).toBe(4 * 390 + 780);
    expect(s.perYear).toBeCloseTo((4 * 390 + 780) / 5);
    expect(s.normal).toBe(390);
    expect(s.ratio).toBeCloseTo((4 * 390 + 780) / 5 / 390);
    expect(s.rank).toBeNull();
    expect(s.years).toEqual([]);
  });

  it('does not rank a period with unknown months', () => {
    const s = periodStats(pts, { from: 202610, to: 202611 }, META);
    expect(s.known).toBe(1);
    expect(s.sources[3]).toBe(1);
    expect(s.total).toBe(100);
    expect(s.rank).toBeNull();
  });
});

describe('an area without fire', () => {
  it('has no rank and no normal', () => {
    const none = series([8], () => 0);
    const s = periodStats(none, { from: 201908, to: 201910 }, META);
    expect(s.total).toBe(0);
    expect(s.rank).toBeNull();
    expect(s.normal).toBe(0);
    expect(s.ratio).toBeNull();
    expect(s.peak).toBeNull();
  });
});

describe('csvForPeriod', () => {
  it('keeps the comments, the header and the rows of the period', () => {
    const csv = '# a\n# b\nyear,month,harmonized\n2019,7,1\n2019,8,2\n2019,10,3\n2019,11,4\n';
    expect(csvForPeriod(csv, { from: 201908, to: 201910 })).toBe('# a\n# b\nyear,month,harmonized\n2019,8,2\n2019,10,3\n');
  });
});

describe('the month picker', () => {
  const p = { from: 201908, to: 201910 };
  it('picks an end: a first month after the last moves the last too, a last month before the first swaps', () => {
    expect(pickEnd(p, 'from', 201902)).toEqual({ from: 201902, to: 201910 });
    expect(pickEnd(p, 'from', 202003)).toEqual({ from: 202003, to: 202003 });
    expect(pickEnd(p, 'to', 202001)).toEqual({ from: 201908, to: 202001 });
    expect(pickEnd(p, 'to', 201905)).toEqual({ from: 201905, to: 201908 });
  });
  it('shades the range and its ends, and greys months outside the record', () => {
    expect(monthState(201908, p, 200011, 202610)).toBe('end');
    expect(monthState(201909, p, 200011, 202610)).toBe('in');
    expect(monthState(201911, p, 200011, 202610)).toBe('none');
    expect(monthState(200010, p, 200011, 202610)).toBe('out');
    expect(monthState(202611, p, 200011, 202610)).toBe('out');
  });
  it('moves with the keys inside the record', () => {
    expect(monthKey(201912, 'ArrowRight', 200011, 202610)).toBe(202001);
    expect(monthKey(201901, 'ArrowLeft', 200011, 202610)).toBe(201812);
    // up and down move by a row of the 4 by 3 grid: May to September, November to March of the next year
    expect(monthKey(201905, 'ArrowDown', 200011, 202610)).toBe(201909);
    expect(monthKey(202511, 'ArrowDown', 200011, 202610)).toBe(202603);
    expect(monthKey(201909, 'ArrowUp', 200011, 202610)).toBe(201905);
    expect(monthKey(201905, 'PageUp', 200011, 202610)).toBe(201805);
    expect(monthKey(201905, 'Home', 200011, 202610)).toBe(201901);
    expect(monthKey(202609, 'PageDown', 200011, 202610)).toBe(202610);
    expect(monthKey(200012, 'ArrowUp', 200011, 202610)).toBe(200011);
    expect(monthKey(201905, 'Enter', 200011, 202610)).toBeNull();
  });
});
