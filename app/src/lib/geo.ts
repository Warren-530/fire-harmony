// Geometry of drawn areas: the outline of a selection and the H3 hexagons inside it.
// Rings are [lon, lat] (GeoJSON order). Longitudes are taken as given (a ring drawn across the date line on a
// continuous map may run past 180) and are brought back into [-180, 180] only for H3.
import {
  POLYGON_TO_CELLS_FLAGS, UNITS, cellArea, cellToBoundary, cellToChildren, cellToLatLng, cellToParent, compactCells,
  getHexagonAreaAvg, getHexagonEdgeLengthAvg, getResolution, gridDisk, isValidCell, latLngToCell, polygonToCells,
  polygonToCellsExperimental,
} from 'h3-js';
import { MAX_L5_CELLS } from './config';
import { ringsBounds, unwrapRing } from './stats';
import type { AreaSelection } from './types';

export type LonLat = [number, number];
export type Ring = LonLat[];

/** The hexagons of a drawn area: whole level 3 and level 4 parents, and level 5 hexagons (all of them for small areas). */
export interface CellCover { l3: string[]; l4: string[]; l5: string[] }

/** Mean earth radius used by H3, in km. */
const EARTH_RADIUS_KM = 6371.007180918475;
const CIRCLE_POINTS = 64;
/** H3 cannot fill a polygon wider than this in longitude: wider ones are cut into 90 degree strips. */
const MAX_LON_SPAN = 180;
/** Guard against absurd polygons (about three quarters of the globe at level 5). */
const MAX_CELLS = 1_500_000;
/** Largest circle radius accepted, in km. */
export const MAX_RADIUS_KM = 5000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;
const clampLat = (lat: number): number => Math.max(-90, Math.min(90, lat));
/** Longitude in [-180, 180). */
const wrapLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Outline of a selection as a closed ring, or null for a named place (no outline is kept for those). */
export function selectionRing(sel: AreaSelection): Ring | null {
  switch (sel.type) {
    case 'named':
      return null;
    case 'polygon': {
      const ring = cleanRing(sel.ring);
      return ring.length >= 3 ? closeRing(ring) : null;
    }
    case 'circle':
      return circleRing(sel.lat, sel.lon, sel.radiusKm);
  }
}

/** A circle as a closed ring of `points` points plus the closing point (counterclockwise, longitudes continuous). */
export function circleRing(lat: number, lon: number, radiusKm: number, points = CIRCLE_POINTS): Ring {
  const d = Math.max(0, radiusKm) / EARTH_RADIUS_KM;
  const phi1 = toRad(clampLat(lat));
  const lambda1 = toRad(lon);
  const ring: Ring = [];
  for (let i = 0; i < points; i++) {
    const bearing = (-2 * Math.PI * i) / points;
    const phi2 = Math.asin(Math.sin(phi1) * Math.cos(d) + Math.cos(phi1) * Math.sin(d) * Math.cos(bearing));
    const lambda2 = lambda1 + Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(phi1),
      Math.cos(d) - Math.sin(phi1) * Math.sin(phi2),
    );
    ring.push([toDeg(lambda2), toDeg(phi2)]);
  }
  return closeRing(ring);
}

/**
 * H3 cells of resolution `res` whose centres fall inside the ring (h3-js v4 polygonToCells, GeoJSON order).
 * An area smaller than one hexagon gives the hexagons it overlaps instead of nothing.
 */
export function cellsForRing(ring: readonly LonLat[], res: number): string[] {
  checkResolution(res);
  const points = cleanRing(ring);
  if (points.length < 3) return [];
  if (ringAreaKm2(points) / getHexagonAreaAvg(res, UNITS.km2) > MAX_CELLS) throw new RangeError('This area is too large');
  const pieces = h3Pieces(points);
  const centre = fill(pieces, (piece) => polygonToCells(piece, res, true));
  if (centre.length > 0) return centre;
  return fill(pieces, (piece) => polygonToCellsExperimental(piece, res, POLYGON_TO_CELLS_FLAGS.containmentOverlapping, true));
}

/** H3 cells of resolution `res` whose centres lie within `radiusKm` of the point (great circle distance). */
export function cellsForCircle(lat: number, lon: number, radiusKm: number, res: number): string[] {
  checkResolution(res);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !(radiusKm > 0)) return [];
  if (radiusKm > MAX_RADIUS_KM) throw new RangeError(`The radius must be at most ${MAX_RADIUS_KM} km`);
  const centre = latLngToCell(clampLat(lat), wrapLon(lon), res);
  // One ring of the hexagon grid adds about 1.5 edge lengths of distance; 0.7 leaves room for H3's size changes.
  const k = Math.ceil(radiusKm / (1.5 * 0.7 * getHexagonEdgeLengthAvg(res, UNITS.km))) + 1;
  const cells: string[] = [];
  for (const cell of gridDisk(centre, k)) {
    const [cellLat, cellLon] = cellToLatLng(cell);
    if (distanceKm(lat, lon, cellLat, cellLon) <= radiusKm) cells.push(cell);
  }
  // A circle smaller than one hexagon: use the hexagons it overlaps.
  return cells.length > 0 ? cells : cellsForRing(circleRing(lat, lon, radiusKm), res);
}

/**
 * The level 5 hexagons of a drawn area. Up to MAX_L5_CELLS they are all returned in `l5`. Above that the set is
 * compacted: whole level 3 parents (coarser cells are expanded to level 3) go to `l3`, whole level 4 parents to
 * `l4`, and the rest stays in `l5`. Named places have no cover (they are read from the area series).
 */
export function coverCells(sel: AreaSelection): CellCover {
  if (sel.type === 'named') return { l3: [], l4: [], l5: [] };
  const cells = sel.type === 'circle'
    ? cellsForCircle(sel.lat, sel.lon, sel.radiusKm, 5)
    : cellsForRing(sel.ring, 5);
  if (cells.length <= MAX_L5_CELLS) return { l3: [], l4: [], l5: cells };
  const cover: CellCover = { l3: [], l4: [], l5: [] };
  for (const cell of compactCells(cells)) {
    const res = getResolution(cell);
    if (res < 3) for (const child of cellToChildren(cell, 3)) cover.l3.push(child);
    else if (res === 3) cover.l3.push(cell);
    else if (res === 4) cover.l4.push(cell);
    else cover.l5.push(cell);
  }
  return cover;
}

/** The distinct parents of `cells` at resolution `res`. */
export function parentCells(cells: readonly string[], res: number): string[] {
  const parents = new Set<string>();
  for (const cell of cells) parents.add(cellToParent(cell, res));
  return [...parents];
}

/**
 * For each parent at resolution `res`, the first and last of its cells in `cells`, sorted. H3 hex text sorts like
 * the index, so the hexagons of one parent sit together in a file sorted by h3: these ranges let a reader skip
 * the rest of the file.
 */
export function cellRanges(cells: readonly string[], res: number): [string, string][] {
  const ranges = new Map<string, [string, string]>();
  for (const cell of cells) {
    const parent = cellToParent(cell, res);
    const range = ranges.get(parent);
    if (!range) ranges.set(parent, [cell, cell]);
    else if (cell < range[0]) range[0] = cell;
    else if (cell > range[1]) range[1] = cell;
  }
  return [...ranges.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Great circle distance in km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function checkResolution(res: number): void {
  if (!Number.isInteger(res) || res < 0 || res > 15) throw new RangeError(`Bad H3 resolution: ${res}`);
}

/** Finite points with latitudes clamped, without repeated points and without the closing point. */
function cleanRing(ring: readonly LonLat[]): Ring {
  const out: Ring = [];
  for (const point of ring) {
    const [lon, lat] = point;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const last = out[out.length - 1];
    const next: LonLat = [lon, clampLat(lat)];
    if (!last || last[0] !== next[0] || last[1] !== next[1]) out.push(next);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

function closeRing(ring: Ring): Ring {
  const first = ring[0];
  return first ? [...ring, [first[0], first[1]]] : ring;
}

/** Union of the cells that `cellsOf` gives for each piece (no duplicates). */
function fill(pieces: Ring[], cellsOf: (piece: Ring) => string[]): string[] {
  const [only] = pieces;
  if (pieces.length === 1 && only) return cellsOf(only);
  const cells = new Set<string>();
  for (const piece of pieces) for (const cell of cellsOf(piece)) cells.add(cell);
  return [...cells];
}

/**
 * Pieces of the ring that H3 can fill, with longitudes in [-180, 180]. A ring up to 180 degrees wide is one
 * piece: H3 handles one that crosses the date line. A wider ring is cut into strips 90 degrees wide, aligned so
 * that no strip crosses the date line.
 */
function h3Pieces(points: Ring): Ring[] {
  const lons = points.map((p) => p[0]);
  const west = Math.min(...lons);
  const east = Math.max(...lons);
  if (east - west <= MAX_LON_SPAN) return [points.map(([lon, lat]): LonLat => [wrapLon(lon), lat])];
  const pieces: Ring[] = [];
  for (let x0 = Math.floor(west / 90) * 90; x0 < east; x0 += 90) {
    const strip = clipToStrip(points, x0, x0 + 90);
    if (strip.length < 3) continue;
    const shift = -360 * Math.round((x0 + 45) / 360);
    pieces.push(strip.map(([lon, lat]): LonLat => [lon + shift, lat]));
  }
  return pieces;
}

/** Part of the ring with west <= lon <= east (Sutherland and Hodgman; edges are straight in lon, lat as in H3). */
function clipToStrip(points: Ring, west: number, east: number): Ring {
  const keepEast = clipHalf(points, (p) => p[0] >= west, west);
  return clipHalf(keepEast, (p) => p[0] <= east, east);
}

function clipHalf(points: Ring, inside: (p: LonLat) => boolean, edgeLon: number): Ring {
  const out: Ring = [];
  points.forEach((current, i) => {
    const previous = points[(i + points.length - 1) % points.length] ?? current;
    const currentIn = inside(current);
    if (currentIn !== inside(previous)) out.push(crossing(previous, current, edgeLon));
    if (currentIn) out.push(current);
  });
  return out;
}

function crossing(a: LonLat, b: LonLat, lon: number): LonLat {
  const t = (lon - a[0]) / (b[0] - a[0]);
  return [lon, a[1] + t * (b[1] - a[1])];
}

/** Approximate area of a ring in km² (spherical, as in Chamberlain and Duquette 2007). */
function ringAreaKm2(points: Ring): number {
  let total = 0;
  points.forEach(([lon1, lat1], i) => {
    const [lon2, lat2] = points[(i + 1) % points.length] ?? [lon1, lat1];
    total += toRad(lon2 - lon1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  });
  return Math.abs((total * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2);
}

// ---------------------------------------------------------------------------------------------------------------
// Hexagons as areas, and where to point the camera

/** [[west, south], [east, north]]; east may pass 180 when the area crosses the date line. */
export type Bounds = [LonLat, LonLat];

/** True for a valid H3 index (hex text). */
export function isHexagon(h3: string): boolean {
  try { return isValidCell(h3); } catch { return false; }
}

/** The outline of one hexagon as a closed ring of [lon, lat], with continuous longitudes across the date line. */
export function hexRing(h3: string): Ring {
  return unwrapRing(cellToBoundary(h3, true));
}

/** Centre of a hexagon as [lat, lon]. */
export function hexCentre(h3: string): [number, number] {
  return cellToLatLng(h3);
}

/** Area of one hexagon in km². */
export function hexAreaKm2(h3: string): number {
  return cellArea(h3, UNITS.km2);
}

/** Bounds of rings (the short way round the globe), or null without points. */
export function ringBoundsOf(rings: readonly (readonly LonLat[])[]): Bounds | null {
  return ringsBounds(rings);
}

/**
 * Rough bounds of a place from its centre and its size: a square of the same area, widened for latitude, at least
 * 1.5 degrees across. Good enough to fly the camera there before (or instead of) the exact outline.
 */
export function approxBounds(lat: number, lon: number, km2: number): Bounds {
  const sideKm = Math.max(Math.sqrt(Math.max(km2, 0)) * 1.3, 170);
  const dLat = Math.min(80, sideKm / 2 / 111.2);
  const cos = Math.max(0.2, Math.cos(toRad(clampLat(lat))));
  const dLon = Math.min(180, sideKm / 2 / (111.2 * cos));
  return [[lon - dLon, clampLat(lat - dLat)], [lon + dLon, clampLat(lat + dLat)]];
}

