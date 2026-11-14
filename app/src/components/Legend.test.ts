// The ticks of the count legends (the full burning calendar and its picture): both ends and round values between.
import { describe, expect, it } from 'vitest';
import { countTicks5, countTickValues } from './Legend';

describe('countTickValues', () => {
  it('puts powers of ten between the ends when two or more fall inside', () => {
    expect(countTickValues(20, 60_000).map((t) => t.value)).toEqual([20, 100, 1000, 10_000, 60_000]);
    expect(countTickValues(1, 2000).map((t) => t.value)).toEqual([1, 10, 100, 2000]);
  });
  it('falls back to 1, 2 and 5 on a narrow scale', () => {
    expect(countTickValues(1, 10).map((t) => t.value)).toEqual([1, 2, 5, 10]);
    expect(countTickValues(1, 20).map((t) => t.value)).toEqual([1, 2, 5, 10, 20]);
  });
  it('keeps at most three between the ends, spread over the bar, each at its place on the log scale', () => {
    const ticks = countTickValues(1, 1e6);
    expect(ticks.map((t) => t.value)).toEqual([1, 10, 1000, 100_000, 1e6]);
    expect(ticks[2].at).toBeCloseTo(0.5, 9);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].at - ticks[i - 1].at).toBeGreaterThanOrEqual(0.12 - 1e-9);
  });
  it('labels them in short numbers, four or five of them', () => {
    expect(countTicks5({ lo: 20, hi: 60_000 }, 'en').map((t) => t.label)).toEqual(['20', '100', '1,000', '10K', '60K']);
    expect(countTicks5({ lo: 5, hi: 5 }, 'en')).toHaveLength(1);
  });
});
