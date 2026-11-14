import { describe, expect, it } from 'vitest';
import { cellToChildren, cellToParent, latLngToCell } from 'h3-js';
import { hexRing } from '../../lib/geo';
import { cellsAtLevel, crossesItself, ringCells } from './mapGeom';

describe('shapes that cross themselves', () => {
  it('finds a bow tie, open or closed', () => {
    expect(crossesItself([[100, 0], [102, 2], [100, 2], [102, 0]])).toBe(true);
    expect(crossesItself([[100, 0], [102, 2], [100, 2], [102, 0], [100, 0]])).toBe(true);
  });
  it('accepts plain shapes', () => {
    expect(crossesItself([[100, 0], [102, 0], [102, 2], [100, 2]])).toBe(false);
    expect(crossesItself([[100, 0], [102, 0], [102, 2], [100, 2], [100, 0]])).toBe(false);
    expect(crossesItself([[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]])).toBe(false);   // concave
    expect(crossesItself([[0, 0], [1, 0], [0, 1]])).toBe(false);                   // a triangle
  });
  it('finds a shape that folds back onto one of its own edges', () => {
    expect(crossesItself([[0, 0], [4, 0], [4, 4], [0, 4], [2, -1]])).toBe(true);
  });
});

describe('the map hexagons of an area', () => {
  it('turns cells of any level into map hexagons', () => {
    const c5 = latLngToCell(-2, 113, 5);
    expect([...cellsAtLevel([c5], 3)]).toEqual([cellToParent(c5, 3)]);
    const c2 = cellToParent(c5, 2);
    expect(cellsAtLevel([c2], 3).size).toBe(cellToChildren(c2, 3).length);
  });
  it('a selected hexagon lights itself, not its neighbours', () => {
    const h4 = latLngToCell(-2, 113, 4);
    expect([...ringCells(hexRing(h4), 4)]).toEqual([h4]);
    expect([...ringCells(hexRing(h4), 3)]).toEqual([cellToParent(h4, 3)]);
  });
  it('a small drawn shape lights the hexagon it sits in', () => {
    const ring: [number, number][] = [[113, -2], [113.05, -2], [113.05, -1.95], [113, -1.95], [113, -2]];
    expect(ringCells(ring, 3).has(latLngToCell(-1.975, 113.025, 3))).toBe(true);
  });
});
