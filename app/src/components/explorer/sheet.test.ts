import { describe, expect, it } from 'vitest';
import { sheetHeights, snapHeight } from './Sheet';

describe('the phone sheet', () => {
  const H = sheetHeights(788, 128);   // 390x844 under a 56 px header, a top part of 128 px
  it('has three heights: the top part, half the screen, and all but a strip of map', () => {
    expect(H).toEqual({ peek: 128, half: 394, full: 764 });
    // a short screen keeps half at least 160 px above small
    expect(sheetHeights(400, 150)).toEqual({ peek: 150, half: 310, full: 376 });
  });
  it('fits half to its content, leaving the map at least 43% of the room', () => {
    expect(sheetHeights(788, 128, 430.2).half).toBe(431);
    expect(sheetHeights(788, 128, 600).half).toBe(449);     // 57% of 788
    expect(sheetHeights(788, 128, 200).half).toBe(288);     // never less than 160 px above small
  });
  it('goes on with a flick, whatever the distance', () => {
    expect(snapHeight(140, -0.8, H, 128)).toBe('half');
    expect(snapHeight(700, 0.8, H, 764)).toBe('half');
    expect(snapHeight(380, 0.9, H, 394)).toBe('peek');
  });
  it('after a slow drag: on once it went a third of the way (or 96 px), else back', () => {
    expect(snapHeight(248, -0.05, H, 128)).toBe('half');   // 120 px up from small
    expect(snapHeight(180, -0.05, H, 128)).toBe('peek');   // 52 px: springs back
    expect(snapHeight(714, -0.05, H, 394)).toBe('full');
    expect(snapHeight(204, 0.1, H, 764)).toBe('peek');     // from full down past half: the nearest
    expect(snapHeight(600, 0.1, H, 764)).toBe('half');
  });
});
