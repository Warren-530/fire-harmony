import { describe, expect, it } from 'vitest';
import { glide } from './AnimatedNumber';

describe('glide (the stat tiles glide from the old number to the new one)', () => {
  it('never leaves the range between the two values, even with progress outside 0..1', () => {
    for (const [a, b] of [[2, 79000], [79000, 2], [-5, 5], [0.94, 1.2]]) {
      for (const k of [-0.5, -0.01, 0, 0.1, 0.5, 0.99, 1, 1.5]) {
        const v = glide(a, b, k);
        expect(v).toBeGreaterThanOrEqual(Math.min(a, b));
        expect(v).toBeLessThanOrEqual(Math.max(a, b));
      }
    }
  });
  it('starts at the old value and ends at the new one', () => {
    expect(glide(2, 79000, 0)).toBe(2);
    expect(glide(2, 79000, -1)).toBe(2);
    expect(glide(2, 79000, 1)).toBe(79000);
  });
  it('moves steadily towards the new value', () => {
    let last = glide(2, 79000, 0);
    for (let k = 0.05; k <= 1; k += 0.05) {
      const v = glide(2, 79000, k);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });
});
