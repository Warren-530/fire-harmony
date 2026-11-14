// Data the area panel needs besides the area's own series: how a place's trend did when all the places of its kind
// were tested together (web/places.json for countries and states, the trend map's file for a hexagon), with the trend
// as those files publish it, so the panel gives the verdict of Rankings, the Dashboard and the trend map; and the
// series of the places pinned to compare (named places and hexagons, at most three).
import { useEffect, useMemo, useState } from 'react';
import { getResolution, isValidCell } from 'h3-js';
import { areaSeries, worldArea } from '../../lib/data';
import { areaName, formatCoord, formatNumber, selectionLabel, useI18n } from '../../lib/i18n';
import { hexCentre } from '../../lib/geo';
import { cityNear, useSearchIndex } from '../../lib/search';
import { circleKey, type CompareKey, type FamilyTest, type PublishedTrend } from '../../lib/stats';
import type { AreaSelection, MonthlyPoint, NamedArea, Trend } from '../../lib/types';
import { webJson } from '../../lib/web';
import { trendClassOf, type PlaceRow, type PlacesFile } from '../rankings/model';
import { hexSeries } from './hexSeries';
import { loadTrend, type Level } from './mapData';
import { NOT_IN_FILE, NOT_TESTED, trendClass, type TrendFile } from './trend';

/** How many countries and how many states were tested together (trend_tested in web/places.json). */
export type TestedCounts = Record<'country' | 'state', number>;

export function testedCounts(rows: readonly Pick<PlaceRow, 'kind' | 'trend_tested'>[]): TestedCounts {
  const n = { country: 0, state: 0 };
  for (const r of rows) if ((r.kind === 'country' || r.kind === 'state') && r.trend_tested) n[r.kind] += 1;
  return n;
}

/** A named place's test and its published trend, from its row of web/places.json (the class by the rule of Rankings,
 *  rankings/model.ts trendClassOf, so the panel says the same word). */
export function placeFamily(row: PlaceRow, tested: TestedCounts): FamilyTest {
  const { cls, why } = trendClassOf(row);
  const inFamily = row.kind === 'country' || row.kind === 'state';
  const published: PublishedTrend = {
    cls, why, direction: (row.trend ?? 'not enough data') as Trend['direction'],
    pct: row.trend_pct_per_decade, p: row.trend_p, mean: row.mean_per_year,
  };
  return {
    kind: row.kind, tested: inFamily && row.trend_tested, q: inFamily ? row.trend_q : null, barrenPct: row.barren_pct,
    of: inFamily ? tested[row.kind as 'country' | 'state'] : 0, published,
  };
}

/** A hexagon's test and its published trend, from its row `i` of the trend map's file (-1: not in the file, no fire
 *  to test); the class by the trend map's own rule (explorer/trend.ts trendClass), so the panel and the map agree. */
export function hexFamily(file: Pick<TrendFile, 'pct' | 'p' | 'q' | 'mean'>, i: number, tested: number): FamilyTest {
  const q = i >= 0 ? file.q[i] : null;
  const pct = i >= 0 ? file.pct[i] : null, p = i >= 0 ? file.p[i] : null;
  const k = i >= 0 ? trendClass(pct, q) : NOT_IN_FILE;
  const cls: PublishedTrend['cls'] = k === NOT_TESTED || k === NOT_IN_FILE ? 'little' : k === 0 ? 'unclear' : k > 0 ? 'rising' : 'falling';
  const direction: Trend['direction'] = p === null || pct === null ? 'not enough data'
    : p < 0.05 && pct !== 0 ? (pct > 0 ? 'increasing' : 'decreasing') : 'no trend';
  return {
    kind: 'hexagon', tested: q !== null, q, barrenPct: null, of: tested,
    // (not in the file: its hotspots a year come from its own series)
    published: { cls, why: null, direction, pct, p, mean: i >= 0 ? file.mean[i] : null },
  };
}

/** The test before (or without) a file: the world and the continents are tested on their own, with no file; a country,
 *  a state or a hexagon waits for its file; a drawn area or a circle has no family. */
export function initialFamily(kind: FamilyTest['kind'] | null): FamilyTest | null {
  if (kind === 'world' || kind === 'continent') return { kind, tested: false, q: null, barrenPct: null, of: 0 };
  if (kind === 'country' || kind === 'state' || kind === 'hexagon') return { kind, tested: false, q: null, barrenPct: null, of: 0, pending: true };
  return null;
}

/** The test while the place's own series loads: pending for every kind (a drawn area or a circle too, as kind 'area'),
 *  so no verdict is worked out from the series of the place shown before. */
export function loadingFamily(kind: FamilyTest['kind'] | null): FamilyTest {
  return { kind: kind ?? 'area', tested: false, q: null, barrenPct: null, of: 0, pending: true };
}

interface PlaceTests { byKey: Map<string, PlaceRow>; tested: TestedCounts }
let placeTests: Promise<PlaceTests> | null = null;

/** The trend test of every country and state (web/places.json, read once). */
function loadPlaceTests(): Promise<PlaceTests> {
  if (!placeTests) {
    placeTests = webJson<PlacesFile>('places.json').then((f) => {
      const byKey = new Map<string, PlaceRow>();
      const rows = f?.rows ?? [];
      for (const r of rows) if (r.kind === 'country' || r.kind === 'state') byKey.set(`${r.kind}:${r.id}`, r);
      return { byKey, tested: testedCounts(rows) };
    });
    placeTests.catch(() => { placeTests = null; });
  }
  return placeTests;
}

let warmed = false;
/** Read web/places.json once the first view has settled, so the first country or state opened has its test at once. */
function warmPlaceTests(): void {
  if (warmed || typeof window === 'undefined') return;
  warmed = true;
  const go = () => { void loadPlaceTests().catch(() => undefined); };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) window.setTimeout(() => idle(go, { timeout: 4000 }), 2500);
  else window.setTimeout(go, 4000);
}

/** How the selected place did among all the places of its kind, with its published trend. The world and the continents
 *  are tested on their own (no file needed); a country, a state or a hexagon is `pending` while its file loads; null
 *  for drawn areas and city circles. While `loading` (the place's own series is not in yet: the panel still holds the
 *  series of the place before) every kind is `pending`. */
export function useFamilyTest(sel: AreaSelection, hex: { h3: string; level: Level } | null, loading = false): FamilyTest | null {
  const [test, setTest] = useState<{ key: string; value: FamilyTest | null } | null>(null);
  const key = hex ? `hex:${hex.h3}` : sel.type === 'named' ? `${sel.area.kind}:${sel.area.id}` : '';
  const kind = hex ? 'hexagon' : sel.type === 'named' ? sel.area.kind : null;
  useEffect(() => {
    let alive = true;
    if (hex) {
      loadTrend(hex.level).then((layer) => {
        if (alive) setTest({ key, value: hexFamily(layer.file, layer.file.h3.indexOf(hex.h3), layer.counts.tested) });
      }, () => { if (alive) setTest({ key, value: null }); });
    } else if (sel.type === 'named' && (sel.area.kind === 'country' || sel.area.kind === 'state')) {
      loadPlaceTests().then((all) => {
        const r = all.byKey.get(key);
        if (alive) setTest({ key, value: r ? placeFamily(r, all.tested) : null });
      }, () => { if (alive) setTest({ key, value: null }); });
    } else {
      warmPlaceTests();
    }
    return () => { alive = false; };
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  // one object per place, so the panel's numbers are not worked out again on every render
  const own = useMemo(() => initialFamily(kind), [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const wait = useMemo(() => loadingFamily(kind), [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return wait;
  return test && test.key === key ? test.value : own;
}

/** A pinned place with its series (null while it loads). */
export interface PinnedSeries { key: CompareKey; name: string; points: MonthlyPoint[] | null; failed: boolean }

/** The key of a selection, when it can be pinned: "country:BRA", "hex:836581fffffffff", "circle:-2.2096,113.91,50";
 *  null for drawn shapes. */
export function pinKey(sel: AreaSelection, hex: { h3: string } | null): CompareKey | null {
  if (hex) return `hex:${hex.h3}`;
  if (sel.type === 'named') return `${sel.area.kind}:${sel.area.id}`;
  if (sel.type === 'circle') return circleKey(sel.lat, sel.lon, sel.radiusKm);
  return null;
}

/** The circle of a key "circle:lat,lon,km", or null. */
export function circleOfKey(key: CompareKey): { type: 'circle'; lat: number; lon: number; radiusKm: number } | null {
  if (!key.startsWith('circle:')) return null;
  const [lat, lon, radiusKm] = key.slice(7).split(',').map(Number);
  return [lat, lon, radiusKm].every(Number.isFinite) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && radiusKm > 0
    ? { type: 'circle', lat, lon, radiusKm } : null;
}

const seriesCache = new Map<CompareKey, Promise<MonthlyPoint[]>>();

function pinSeries(key: CompareKey, area: NamedArea | null): Promise<MonthlyPoint[]> {
  let p = seriesCache.get(key);
  if (!p) {
    const circle = circleOfKey(key);
    if (key.startsWith('hex:')) {
      const h3 = key.slice(4);
      const res = getResolution(h3);
      p = hexSeries(h3, res === 4 ? 4 : 3);
    } else if (circle) {
      p = areaSeries(circle);
    } else if (area) {
      p = areaSeries({ type: 'named', area });
    } else {
      p = Promise.reject(new Error(`unknown place ${key}`));
    }
    p.catch(() => seriesCache.delete(key));
    seriesCache.set(key, p);
  }
  return p;
}

/** Can this key be pinned at all (a named place in the list, or a level 3 or 4 hexagon)? */
export function pinnable(key: CompareKey, areas: readonly NamedArea[] | null): boolean {
  if (key.startsWith('hex:')) {
    const h3 = key.slice(4);
    return isValidCell(h3) && [3, 4].includes(getResolution(h3));
  }
  if (key.startsWith('circle:')) return circleOfKey(key) !== null;
  return findPlace(key, areas) !== null;
}

function findPlace(key: CompareKey, areas: readonly NamedArea[] | null): NamedArea | null {
  const at = key.indexOf(':');
  const kind = key.slice(0, at), id = key.slice(at + 1);
  if (kind === 'world') return worldArea();
  return areas?.find((a) => a.kind === kind && (a.id === id || (kind === 'country' && a.id === id.toUpperCase()))) ?? null;
}

/** The series of the pinned places, in the order they were pinned. */
export function usePinnedSeries(keys: readonly CompareKey[], areas: readonly NamedArea[] | null): PinnedSeries[] {
  const { t, lang } = useI18n();
  const [got, setGot] = useState<Map<CompareKey, MonthlyPoint[] | 'failed'>>(() => new Map());
  // (a pinned circle is named after its city once the cities have loaded)
  const index = useSearchIndex(keys.some((k) => k.startsWith('circle:')));
  useEffect(() => {
    let alive = true;
    for (const key of keys) {
      if (got.has(key)) continue;
      const own = key.startsWith('hex:') || key.startsWith('circle:');
      const area = own ? null : findPlace(key, areas);
      if (!own && !area && areas === null) continue;   // wait for the list of places
      pinSeries(key, area).then((points) => { if (alive) setGot((m) => new Map(m).set(key, points)); },
        () => { if (alive) setGot((m) => new Map(m).set(key, 'failed')); });
    }
    return () => { alive = false; };
  }, [keys, areas]);   // eslint-disable-line react-hooks/exhaustive-deps
  return keys.map((key) => {
    const v = got.get(key);
    let name = key;
    const circle = circleOfKey(key);
    if (key.startsWith('hex:')) {
      const [lat, lon] = hexCentre(key.slice(4));
      name = t.ex.hexNear(formatCoord(lat, lon, lang));
    } else if (circle) {
      const city = cityNear(circle.lat, circle.lon, 1, index)?.name ?? null;
      name = city ? t.common.circle(formatNumber(circle.radiusKm, lang, 1), city) : selectionLabel(circle, lang);
    } else {
      const area = findPlace(key, areas);
      if (area) name = areaName(area, lang);
    }
    return { key, name, points: v && v !== 'failed' ? v : null, failed: v === 'failed' };
  });
}
