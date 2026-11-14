// The map's shapes and constants, apart from MapView.tsx so that module exports only its component and editing it
// keeps React Fast Refresh (the Explorer stays mounted while the map is edited): the world's bounds, the zoom where
// finer hexagons start, and the outline of a named place (with the H3 cells behind it, for the map's dimming).
import { cellToParent, cellsToMultiPolygon } from 'h3-js';
import { ringAreaKm2, ringsBounds, unwrapRing } from '../../lib/stats';
import type { NamedArea } from '../../lib/types';
import { outlineFile } from '../../lib/web';

export type DrawMode = 'none' | 'rectangle' | 'polygon';
export type LonLat = [number, number];
/** [[west, south], [east, north]]; east may pass 180 when the area crosses the date line. */
export type Bounds = [LonLat, LonLat];
export type ViewMode = '2d' | '3d';
export interface Padding { top: number; right: number; bottom: number; left: number }

export const WORLD_BOUNDS: Bounds = [[-160, -48], [200, 70]];
/** Below this zoom the map shows level 3 hexagons (about 12,400 km²), from it level 4 (about 1,800 km²). */
export const DETAIL_ZOOM = 3.6;

// ----------------------------------------------------------------------------------------------- named outlines

export interface AreaShape { outline: LonLat[][]; bounds: Bounds | null }

const shapes = new Map<string, Promise<AreaShape>>();
/** The H3 cells behind an outline (named places), so the map knows which of its hexagons are in the place. */
const outlineCells = new WeakMap<readonly LonLat[][], string[]>();
/** The H3 cells behind an outline made by namedShape (undefined for any other outline). */
export const cellsOfOutline = (outline: readonly LonLat[][]): string[] | undefined => outlineCells.get(outline);
const MAX_OUTLINE_CELLS = 2500;   // larger places are outlined with their level 4 (or coarser) parents

/**
 * Outline and bounds of a named place, from its outline hexagons (web/outline/<kind>/<id>.json: level 5, or their
 * parents for large places, at most 2,500, chosen as before from cells.parquet). The bounds cover the largest pieces
 * that hold 85% of the area, so far islands do not shrink the view.
 */
export function namedShape(area: NamedArea): Promise<AreaShape> {
  if (area.kind === 'world') return Promise.resolve({ outline: [], bounds: WORLD_BOUNDS });
  const key = `${area.kind}:${area.id}`;
  let p = shapes.get(key);
  if (!p) {
    p = (async () => {
      let cells = (await outlineFile(area.kind, area.id))?.cells ?? [];
      for (let res = 4; cells.length > MAX_OUTLINE_CELLS && res >= 2; res--) {
        cells = [...new Set(cells.map((c) => cellToParent(c, res)))];
      }
      if (cells.length === 0) return { outline: [], bounds: null };
      const pieces = cellsToMultiPolygon(cells, true)
        .map((poly) => poly.map((ring) => unwrapRing(ring)))
        .map((rings) => ({ rings, size: ringAreaKm2(rings[0]) }))
        .sort((a, b) => b.size - a.size);
      const total = pieces.reduce((s, piece) => s + piece.size, 0);
      const main: LonLat[][] = [];
      let held = 0;
      for (const piece of pieces) {
        main.push(piece.rings[0]);
        held += piece.size;
        if (held >= 0.85 * total) break;
      }
      const outline = pieces.flatMap((piece) => piece.rings);
      outlineCells.set(outline, cells);
      return { outline, bounds: ringsBounds(main) };
    })();
    p.catch(() => shapes.delete(key));
    shapes.set(key, p);
  }
  return p;
}
