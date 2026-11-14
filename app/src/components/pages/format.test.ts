// The number helpers of the Methods, Data and Haze pages: numbers written for people (true minus signs, one more digit
// for a value already rounded on a half step), counts, months and file sizes.
import { describe, expect, it } from 'vitest';
import { addMonths, count, fileSize, int, monthName, monthsBetween, num, pct, share } from './format';
import { count as dashCount } from '../dashboard/format';

describe('num and pct', () => {
  it('rounds to the digits asked for', () => {
    expect(num(8.406, 1)).toBe('8.4');
    expect(pct(37.84)).toBe('37.8%');
    expect(share(0.44)).toBe('44%');
  });
  it('keeps a value that sits on a half step instead of rounding it twice', () => {
    expect(num(0.85, 1)).toBe('0.85');
    expect(num(-0.655, 2)).toBe('−0.655');
  });
  it('writes a true minus sign, and a plus sign only when asked', () => {
    expect(num(-3.2, 1)).toBe('−3.2');
    expect(pct(0.55, 2, true)).toBe('+0.55%');
    expect(num(0, 1, true)).toBe('0.0');
  });
});

describe('count and int', () => {
  it('writes big counts in words', () => {
    expect(count(443_200_000)).toBe('443 million');
    expect(count(1_334_000)).toBe('1.33 million');
    expect(count(6_480_000_000)).toBe('6.48 billion');
    expect(count(4333)).toBe('4,333');
    expect(count(13_000_000)).toBe('13 million');
    expect(count(12_965_138)).toBe('13 million');
    expect(dashCount(12_965_138)).toBe('13 million');
    expect(dashCount(1_300_000)).toBe('1.3 million');
    expect(dashCount(443_200_000)).toBe('443 million');
  });
  it('groups the thousands of a whole number', () => {
    expect(int(13_654_998)).toBe('13,654,998');
    expect(int(-1200)).toBe('−1,200');
  });
});

describe('months', () => {
  it('names a month', () => {
    expect(monthName(202610)).toBe('October 2026');
  });
  it('steps across a year end', () => {
    expect(addMonths(202611, 2)).toBe(202701);
    expect(addMonths(200101, -1)).toBe(200012);
  });
  it('counts the months of a period, both ends included', () => {
    expect(monthsBetween(200011, 202610)).toBe(312);
  });
});

describe('fileSize', () => {
  it('uses kB, MB and GB with plain rounding', () => {
    expect(fileSize(44_947)).toBe('45 kB');
    expect(fileSize(7_390_000)).toBe('7.4 MB');
    expect(fileSize(250_400_000)).toBe('250 MB');
    expect(fileSize(6_480_000_000)).toBe('6.5 GB');
    expect(fileSize(512)).toBe('512 bytes');
  });
  it('never writes "1,000 MB"', () => {
    expect(fileSize(999_400_000)).toBe('999 MB');
    expect(fileSize(999_600_000)).toBe('1.0 GB');
    expect(fileSize(123_400_000_000)).toBe('123 GB');
  });
});
