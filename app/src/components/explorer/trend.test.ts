import { describe, expect, it } from 'vitest';
import { NOT_IN_FILE, NOT_TESTED, alignRows, alignedClasses, plainDecimal, signedPct, trendClass, trendCounts, trendRampIndex } from './trend';

describe('trend classes', () => {
  it('untested hexagons (no q) are not tested, whatever their trend', () => {
    expect(trendClass(-80, null)).toBe(NOT_TESTED);
    expect(trendClass(null, null)).toBe(NOT_TESTED);
  });
  it('only q of 0.05 or less is a clear trend', () => {
    expect(trendClass(-40, 0.0501)).toBe(0);
    expect(trendClass(-40, 0.05)).toBe(-3);
    expect(trendClass(12, 0.01)).toBe(1);
    expect(trendClass(15, 0.01)).toBe(2);
    expect(trendClass(30, 0.01)).toBe(3);
    expect(trendClass(250, 0.01)).toBe(4);
    expect(trendClass(-60, 0.01)).toBe(-4);
  });
  it('maps clear trends onto the diverging ramp, blue for falls and red for rises', () => {
    expect(trendRampIndex(-4)).toBe(0);
    expect(trendRampIndex(-1)).toBe(3);
    expect(trendRampIndex(1)).toBe(5);
    expect(trendRampIndex(4)).toBe(8);
    expect(trendRampIndex(0)).toBeNull();
    expect(trendRampIndex(NOT_TESTED)).toBeNull();
  });
  it('counts as the report does', () => {
    const f = { h3: ['a', 'b', 'c', 'd', 'e'], pct: [-50, 20, 5, -3, 40], q: [0.001, 0.04, 0.3, null, null] };
    expect(trendCounts(f)).toEqual({ hexagons: 5, tested: 3, rising: 1, falling: 1, flat: 1, untested: 2 });
  });
  it('lines the file up with the map hexagons', () => {
    const rows = alignRows(['x', 'b', 'a'], ['a', 'b']);
    expect([...rows]).toEqual([-1, 1, 0]);
    const cls = alignedClasses(rows, { pct: [-50, 20], q: [0.001, null] });
    expect([...cls]).toEqual([NOT_IN_FILE, NOT_TESTED, -3]);
  });
  it('shows numbers as the file has them', () => {
    expect(plainDecimal(0.0036, 4)).toBe('0.0036');
    expect(plainDecimal(0.00073, 5)).toBe('0.00073');
    expect(plainDecimal(Math.fround(0.0036), 4)).toBe('0.0036');
    expect(plainDecimal(1, 4)).toBe('1');
    expect(signedPct(-72.1)).toBe('−72.1%');
    expect(signedPct(23)).toBe('+23%');
    expect(signedPct(0)).toBe('0%');
  });
});
