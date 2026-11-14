// Geometry for the map: whether a drawn shape crosses itself (refused: its area would be meaningless), and which map
// hexagons belong to the selected area (they stay bright, the others dim).
import { cellToBoundary, cellToChildren, cellToParent, getResolution, latLngToCell } from 'h3-js';
import { cellsForRing } from '../../lib/geo';
import { ringAreaKm2 } from '../../lib/stats';

type Pt = readonly [number, number];

/** Sign of the turn a → b → c (1 left, -1 right, 0 straight). */
function turn(a: Pt, b: Pt, c: Pt): number {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(v) < 1e-12 ? 0 : v > 0 ? 1 : -1;
}
const within = (a: Pt, b: Pt, c: Pt) => Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0])
  && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);

/** True when segments ab and cd meet (touching counts). */
function meet(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = turn(a, b, c), d2 = turn(a, b, d), d3 = turn(c, d, a), d4 = turn(c, d, b);
  if (d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0) return true;
  return (d1 === 0 && within(a, b, c)) || (d2 === 0 && within(a, b, d)) || (d3 === 0 && within(c, d, a)) || (d4 === 0 && within(c, d, b));
}

/**
 * True when a ring of [lon, lat] points crosses or touches itself (a bow tie). Closed or open rings both work;
 * neighbouring edges share a corner, which does not count. O(n²), fine for drawn shapes (at most a few hundred points).
 */
export function crossesItself(ring: readonly Pt[]): boolean {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1) : ring.slice();
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;   // neighbours share a corner
      if (meet(a, b, pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** The map hexagons (level 3 or 4) of a set of H3 cells of any level: their parents, or their children. */
export function cellsAtLevel(cells: Iterable<string>, level: number): Set<string> {
  const out = new Set<string>();
  for (const c of cells) {
    const r = getResolution(c);
    if (r === level) out.add(c);
    else if (r > level) out.add(cellToParent(c, level));
    else for (const k of cellToChildren(c, level)) out.add(k);
  }
  return out;
}

/** The H3 cell (level 3 to 5) whose outline a ring is, or null: a selected hexagon comes to the map as its ring. */
export function hexOfRing(ring: readonly Pt[]): string | null {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  if (pts.length < 5 || pts.length > 7) return null;
  const lon = pts.reduce((sum, p) => sum + p[0], 0) / pts.length, lat = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  for (const res of [3, 4, 5]) {
    const cell = latLngToCell(lat, wrapped, res);
    const edge = cellToBoundary(cell, true);
    if (edge.length !== pts.length) continue;
    const near = (a: number, b: number) => Math.abs((((a - b + 540) % 360) + 360) % 360 - 180) < 1e-6;
    if (pts.every((p) => edge.some((q) => near(p[0], q[0]) && Math.abs(p[1] - q[1]) < 1e-6))) return cell;
  }
  return null;
}

/**
 * The map hexagons of a drawn ring: the parents of the level 5 hexagons whose centres lie inside it, as the area's
 * numbers are counted (a shape smaller than one of them gives the ones it overlaps, see geo.ts cellsForRing). Large
 * shapes use level 4 centres. A selected hexagon's ring gives that hexagon (with its parent or children at the other
 * level), as its numbers are read from that hexagon alone.
 */
export function ringCells(ring: readonly Pt[], level: number): Set<string> {
  const hex = hexOfRing(ring);
  if (hex) return cellsAtLevel([hex], level);
  const pts = ring.map((p) => [p[0], p[1]] as [number, number]);
  // about 252 km² per level 5 hexagon: past 200,000 of them, level 4 centres give the same map hexagons sooner
  const res = ringAreaKm2(pts) / 252 > 200_000 ? 4 : 5;
  let cells: string[] = [];
  try { cells = cellsForRing(pts, res); } catch { cells = []; }
  return cellsAtLevel(cells, level);
}
