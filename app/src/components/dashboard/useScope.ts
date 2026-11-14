// The dashboard's scope as React state: read from the link and written back to it (a new place is a new history
// entry, so Back returns to the place before; years, months and scale replace the entry), the place's monthly series
// and its parts (the continents of the world, the countries of a continent, the states of a country), and the year or
// month under the pointer, shared by every chart (hovering 2019 in one chart marks 2019 in the others).
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { areaSeries, loadMeta } from '../../lib/data';
import { webJson } from '../../lib/web';
import { cityNear, useSearchIndex } from '../../lib/search';
import type { AreaSelection, Meta, MonthlyPoint, NamedArea } from '../../lib/types';
import type { PlaceRow, PlacesFile } from '../rankings/model';
import {
  isDefaultScope, isWorld, partStats, placeKey, scopeFromHash, scopeQuery, scopeView, WORLD_PLACE,
  type PartStats, type Scope, type ScopePlace, type ScopeView,
} from './scope';

// ------------------------------------------------------------------------------------------------ state in the link

/** The section part of the link ("s=seam"), kept when the scope changes. */
const sectionOf = (hash: string): string | null => new URLSearchParams(hash.split('?')[1] ?? '').get('s');

export function useScopeState(lastYear: number): [Scope, (next: Scope) => void] {
  const [scope, setScope] = useState<Scope>(() => scopeFromHash(window.location.hash, lastYear));
  const last = useRef(lastYear);
  // the last year arrives with the data: read the link again with it
  useEffect(() => {
    if (last.current === lastYear) return;
    last.current = lastYear;
    setScope(scopeFromHash(window.location.hash, lastYear));
  }, [lastYear]);
  // Back, Forward, or a link to another view of the dashboard
  useEffect(() => {
    const on = () => {
      if (!window.location.hash.startsWith('#/dashboard')) return;
      const next = scopeFromHash(window.location.hash, last.current);
      setScope((cur) => (scopeQuery(cur, last.current) === scopeQuery(next, last.current) ? cur : next));
    };
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on); };
  }, []);
  const update = useCallback((next: Scope) => {
    setScope((cur) => {
      const q = scopeQuery(next, last.current, sectionOf(window.location.hash));
      const hash = q ? `#/dashboard?${q}` : '#/dashboard';
      if (hash !== window.location.hash) {
        if (placeKey(cur.place) !== placeKey(next.place)) window.history.pushState({ fhDashboard: 1 }, '', hash);
        else window.history.replaceState(window.history.state, '', hash);
      }
      return next;
    });
  }, []);
  return [scope, update];
}

/** The dashboard link of the section in view, with the scope ("#/dashboard?area=country:IDN&s=seam"). */
export function sectionHash(section: string | null): string {
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  if (section) q.set('s', section); else q.delete('s');
  const s = q.toString().replace(/%3A/gi, ':').replace(/%2C/gi, ',');
  return s ? `#/dashboard?${s}` : '#/dashboard';
}

// ------------------------------------------------------------------------------------------------ the place's data

const KIND_NAME = { world: 'World', continent: 'Continent', country: 'Country', state: 'State' } as const;

function stubArea(p: Extract<ScopePlace, { type: 'named' }>, name: string): NamedArea {
  return { kind: p.kind, id: p.id, name, country_iso3: null, lat: 0, lon: 0, cells: 0, area_km2: 0 };
}

function selectionOf(p: ScopePlace, name: string): AreaSelection {
  return p.type === 'named' ? { type: 'named', area: stubArea(p, name) } : { type: 'circle', lat: p.lat, lon: p.lon, radiusKm: p.km };
}

/** A part of the place (a continent of the world, a state of a country) with its numbers in the scope. */
export interface Part { row: PlaceRow; stats: PartStats; own: string }

export interface ScopeData {
  ready: boolean;              // the numbers of this scope are in
  loading: boolean;            // a new scope is loading (the old numbers stay on screen)
  error: string | null;
  name: string;                // "World", "Indonesia", "Riau, Indonesia", "50 km around Palangka Raya, Indonesia"
  short: string;               // "Riau", "Palangka Raya"
  kindWord: string;            // "Country", "State", "City circle"
  row: PlaceRow | null;        // the place in web/places.json
  rows: PlaceRow[] | null;     // every place
  view: ScopeView | null;      // null for the published default (the page then reads dashboard.json)
  world: ScopeView | null;     // the world in the same scope (for shares)
  points: MonthlyPoint[] | null;
  parts: Part[] | null;        // the parts in the scope, most fire first
  partsOf: string;             // "continents", "countries of Africa", "states of Indonesia"
  meta: Meta | null;
}

const PART_LIMIT = 25;

function partsOf(place: ScopePlace, rows: readonly PlaceRow[]): { list: PlaceRow[]; words: string; parentIso?: string } {
  const byFire = (a: PlaceRow, b: PlaceRow) => (b.mean_per_year ?? 0) - (a.mean_per_year ?? 0);
  if (place.type === 'circle') return { list: [], words: '' };
  if (place.kind === 'world') {
    const conts = rows.filter((r) => r.kind === 'continent' && (r.mean_per_year ?? 0) > 1000).sort(byFire);
    return { list: [...conts, ...rows.filter((r) => r.kind === 'country').sort(byFire).slice(0, PART_LIMIT)], words: 'continents and countries' };
  }
  if (place.kind === 'continent') return { list: rows.filter((r) => r.kind === 'country' && r.continent === place.id).sort(byFire).slice(0, PART_LIMIT), words: `countries of ${place.id}` };
  const me = rows.find((r) => r.kind === place.kind && r.id === place.id);
  const iso = place.kind === 'country' ? place.id : me?.iso3 ?? place.id.split('-')[0];
  const country = rows.find((r) => r.kind === 'country' && r.iso3 === iso);
  const states = rows.filter((r) => r.kind === 'state' && r.iso3 === iso).sort(byFire);
  const list = states.slice(0, PART_LIMIT);
  if (place.kind === 'state' && me && !list.includes(me)) list.push(me);
  return { list, words: `states of ${country?.name ?? iso}`, parentIso: iso };
}

const ownName = (r: PlaceRow): string => (r.kind === 'state' && r.name.includes(', ') ? r.name.slice(0, r.name.lastIndexOf(', ')) : r.name);

export function useScopeData(scope: Scope, lastYear: number): ScopeData {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [rows, setRows] = useState<PlaceRow[] | null>(null);
  const [series, setSeries] = useState<{ key: string; points: MonthlyPoint[] } | null>(null);
  const [world, setWorld] = useState<MonthlyPoint[] | null>(null);
  const [partSeries, setPartSeries] = useState<{ key: string; list: { row: PlaceRow; points: MonthlyPoint[] }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const index = useSearchIndex(scope.place.type === 'circle');

  useEffect(() => {
    let live = true;
    loadMeta().then((m) => { if (live) setMeta(m); }, () => undefined);
    webJson<PlacesFile>('places.json').then((f) => { if (live && f) setRows(f.rows); }, () => undefined);
    return () => { live = false; };
  }, []);

  const deflt = isDefaultScope(scope, lastYear);
  const pkey = placeKey(scope.place);
  const row = useMemo(() => (rows && scope.place.type === 'named' ? rows.find((r) => r.kind === (scope.place as { kind: string }).kind && r.id === (scope.place as { id: string }).id) ?? null : null), [rows, scope.place]);

  // the name of the place
  const circle = scope.place.type === 'circle' ? scope.place : null;
  const city = useMemo(() => (circle ? cityNear(circle.lat, circle.lon, 1, index) : null), [circle, index]);
  let name = 'World', short = 'World', kindWord = 'World';
  if (scope.place.type === 'named' && !isWorld(scope.place)) {
    name = row?.name ?? scope.place.id;
    short = row ? ownName(row) : scope.place.id;
    kindWord = KIND_NAME[scope.place.kind];
  } else if (circle) {
    // a circle far from any city is named by its centre ("0.00°N, 30.00°W"), so "within 50 km of …" reads well
    const at = `${Math.abs(circle.lat).toFixed(2)}°${circle.lat >= 0 ? 'N' : 'S'}, ${Math.abs(circle.lon).toFixed(2)}°${circle.lon >= 0 ? 'E' : 'W'}`;
    name = `${circle.km} km around ${city ? city.name : at}`;
    short = city ? city.city.name : at;
    kindWord = city ? 'City circle' : 'Circle';
  }

  // the place's series (the world's too, for shares); none needed for the published default
  useEffect(() => {
    if (deflt && isWorld(scope.place)) return;
    let live = true;
    setError(null);
    areaSeries(selectionOf(scope.place, name)).then(
      (points) => { if (live) setSeries({ key: pkey, points }); },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { live = false; };
    // the name does not change what is read
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkey, deflt]);
  useEffect(() => {
    if (deflt) return;
    let live = true;
    areaSeries(selectionOf(WORLD_PLACE, 'World')).then((p) => { if (live) setWorld(p); }, () => undefined);
    return () => { live = false; };
  }, [deflt]);

  // the parts of the place
  const plan = useMemo(() => (rows && !deflt ? partsOf(scope.place, rows) : null), [rows, deflt, scope.place]);
  useEffect(() => {
    if (!plan || !plan.list.length) { setPartSeries(null); return; }
    let live = true;
    const key = pkey;
    Promise.all(plan.list.map(async (r) => ({ row: r, points: await areaSeries(selectionOf({ type: 'named', kind: r.kind, id: r.id }, r.name)) })))
      .then((list) => { if (live) setPartSeries({ key, list }); }, () => undefined);
    return () => { live = false; };
  }, [plan, pkey]);

  const points = series && series.key === pkey ? series.points : null;
  const vkey = `${pkey}|${scope.years.join('-')}|${scope.months?.join('-') ?? 'all'}|${scope.scale}`;
  const view = useMemo(() => (points && meta && !deflt ? scopeView(points, scope, meta, vkey) : null), [points, meta, deflt, scope, vkey]);
  const worldView = useMemo(() => (world && meta && !deflt ? scopeView(world, { ...scope, place: WORLD_PLACE }, meta) : null), [world, meta, deflt, scope]);
  const parts = useMemo(() => {
    if (!partSeries || partSeries.key !== pkey || !meta) return null;
    return partSeries.list.map(({ row: r, points: p }) => ({ row: r, own: ownName(r), stats: partStats(p, scope, meta) }))
      .sort((a, b) => (b.stats.perYear ?? 0) - (a.stats.perYear ?? 0));
  }, [partSeries, pkey, meta, scope]);

  // keep the last numbers on screen while a new scope loads (no flicker)
  const shown = useRef<ScopeView | null>(null);
  if (view) shown.current = view;
  if (deflt) shown.current = null;
  const ready = deflt || (view !== null && (isWorld(scope.place) || worldView !== null));
  return {
    ready, loading: !ready && !error, error, name, short, kindWord, row, rows,
    view: deflt ? null : view ?? shown.current, world: worldView, points, parts, partsOf: plan?.words ?? '', meta,
  };
}

// ------------------------------------------------------------------------------------------------ the shared pointer

export interface Focus { yr: number | null; mo: number | null; from: string }

let focus: Focus = { yr: null, mo: null, from: '' };
const listeners = new Set<() => void>();

/** Mark a year or a month (or nothing) in every chart. `from` names the chart that set it. */
export function setFocus(next: Focus): void {
  if (next.yr === focus.yr && next.mo === focus.mo && next.from === focus.from) return;
  focus = next;
  for (const f of listeners) f();
}

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

/** The year or month under the pointer in any chart. */
export function useFocus(): Focus {
  return useSyncExternalStore(subscribe, () => focus, () => focus);
}
