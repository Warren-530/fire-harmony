// The Explorer: a command centre over the fire map. The map fills the window under the header and glass panels float
// on it: the area panel (left: pick or draw an area, its numbers, the brief and the details in tabs), the map settings
// (top right) and the timeline with the player (bottom). Everything is linked: a month hovered in the timeline or the
// calendar previews on the map and in the numbers, a click commits it. The hash holds the view, so every view can
// be shared, and the command palette and the keyboard drive it too. On phones (768 px and less) the map fills the
// screen and the panel is a bottom sheet over it (explorer/Sheet.tsx) that holds the timeline too.
//
// The panel (package explorer-panel): the area's name with its tools (Download menu, Compare, link, keys), a strip of
// three numbers, then the tabs. Places pinned to compare are drawn together in the Overview chart (the hash keeps them:
// &compare=country:BRA,state:IDN-1931).
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PeriodPanel } from '../components/period/PeriodPanel';
import '../styles/explorer.css';
import { AreaPicker } from '../components/AreaPicker';
import { Calendar } from '../components/Calendar';
import { DownloadMenu, saveCsv } from '../components/Downloads';
import { DriversPanel } from '../components/DriversPanel';
import { FireBrief } from '../components/FireBrief';
import { KpiDetails, KpiLine, Kpis, type KpiTarget } from '../components/Kpis';
import { Tooltip } from '../components/Tooltip';
import { useSheet } from '../components/explorer/Sheet';
import { pinKey, pinnable, useFamilyTest, usePinnedSeries } from '../components/explorer/panelData';
import { MapView } from '../components/MapView';
import { WORLD_BOUNDS, namedShape, type Bounds, type DrawMode, type LonLat, type ViewMode } from '../components/explorer/areaShape';
import { useMapPadding } from '../components/explorer/mapLayout';
import { crossesItself } from '../components/explorer/mapGeom';
import { OutlookCard } from '../components/OutlookCard';
import { CalendarDialog, IconExpand } from '../components/explorer/CalendarDialog';
import { coarsePointer } from '../components/explorer/pointer';
import { Welcome, welcomeSeen } from '../components/explorer/Welcome';
import { CompareChart, SeriesChart, type CompareMode } from '../components/SeriesChart';
import { MapControls } from '../components/explorer/MapControls';
import { Tabs, TabPanel, type TabItem } from '../components/explorer/Tabs';
import { STEP_MS, Timeline, type Speed } from '../components/explorer/Timeline';
import { hexSeries } from '../components/explorer/hexSeries';
import { calendarTitle } from '../components/explorer/months';
import { hoveredMonth, onHoveredMonth, previewMonth } from '../components/explorer/hover';
import { PanelHandle } from '../components/explorer/PanelHandle';
import { RESIZE_FROM, clampPanel, panelDefault, savePanelWidth, savedPanelWidth } from '../components/explorer/panelSize';
import { loadFrame, type Level } from '../components/explorer/mapData';
import { Segmented, Skeleton } from '../components/ui';
import { useToast } from '../components/Toast';
import {
  IconChevronLeft, IconChevronRight, IconClose, IconCopy, IconKeyboard, IconLayers, IconPause, IconPlay, IconSearch,
} from '../components/icons';
import { FIRST_YEAR } from '../lib/config';
import { firmsUrl } from '../lib/hotspots';
import { emitCommand, onExplorerCommand, setExplorerLive, takeExplorerCommands, useCommand, type Command } from '../lib/commands';
import { cityNear, normalise as fold, useCircleCity, useSearchIndex, type CitiesFile } from '../lib/search';
import { webJson } from '../lib/web';
import { areaDrivers, areaOutlook, areaSeries, loadAreas, loadMeta, worldArea, worldSources, type AreaDrivers } from '../lib/data';
import { approxBounds, hexAreaKm2, hexCentre, hexRing, isHexagon, ringBoundsOf, selectionRing } from '../lib/geo';
import { areaName, formatArea, formatCoord, formatMonth, formatNumber, selectionLabel, useI18n, type Dict, type Lang } from '../lib/i18n';
import {
  COMPARE_MAX, explorerLink, isExplorerHash, linkProblems, onScale, parseCompare, parseExplorerLink, ringAreaKm2, stepMonth, ymOf,
  type CompareKey, type ExplorerLink, type LinkTab,
} from '../lib/stats';
import type { AreaSelection, ColourMode, MapMode, Meta, MonthlyPoint, NamedArea, OutlookRow, Scale } from '../lib/types';
import { getResolution } from 'h3-js';

type TabKey = 'overview' | 'calendar' | 'period' | 'why' | 'outlook';
const TAB_KEYS: readonly TabKey[] = ['overview', 'calendar', 'period', 'why', 'outlook'];
/** The phone sheet: half ends under the tabs; the month's line shows only in the small sheet. */
const SHEET_LAYOUT = { halfEnd: '.fh-ex-tabbar', peekOnly: '.fh-ex-kpi-line' } as const;

/** The selected area. A map hexagon is also kept as its own cell, so its series is read from the hexagon files. */
interface Picked {
  sel: AreaSelection;
  hex: { h3: string; level: Level } | null;
  key: string;
  fly: boolean;          // move the camera to it (search, links, commands; not after drawing or clicking)
  seq: number;
}

function keyOf(sel: AreaSelection, hex: Picked['hex']): string {
  if (hex) return `hex:${hex.h3}`;
  if (sel.type === 'named') return `${sel.area.kind}:${sel.area.id}`;
  if (sel.type === 'circle') return `circle:${sel.lat},${sel.lon},${sel.radiusKm}`;
  return `polygon:${sel.ring.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(';')}`;
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
/** The history state of the entries the Explorer writes: such a link holds the whole view, so a link of one without an
 *  area is the world (a plain "#/", from a menu link or a command, keeps the area in view). */
const VIEW_STATE = { fhView: 1 } as const;
const viewEntry = () => (window.history.state as { fhView?: number } | null)?.fhView === 1;
/** A camera flight (1.5 s in MapView) and a margin: leaving the page sooner than this after a flight began cuts it short. */
const FLIGHT_GUARD_MS = 2500;
/** The link in the hash; on an entry the Explorer wrote, no area means the world. */
function readLink(hash: string): ExplorerLink {
  const link = parseExplorerLink(hash);
  if (!link.area && viewEntry()) link.area = { type: 'named', kind: 'world', id: 'WORLD' };
  return link;
}
/** The area of an Explorer hash ("state:IDN-492"), or '' for the world. */
const areaParam = (hash: string) => {
  const a = new URLSearchParams(hash.split('?')[1] ?? '').get('area') ?? '';
  return a.startsWith('world') ? '' : a;
};

/** Name (title), name in a sentence, and the kind line of a selection. A circle around a city is named after it
 *  (`city`: "Palangkaraya, Indonesia", from the city list of lib/search.ts). */
function describe(p: Picked, t: Dict, lang: Lang, city: string | null = null): { name: string; sentence: string; kindLine: string } {
  const s = p.sel;
  if (p.hex) {
    const [lat, lon] = hexCentre(p.hex.h3);
    const name = t.ex.hexNear(formatCoord(lat, lon, lang));
    return { name, sentence: lowerFirst(name), kindLine: t.ex.kindLine(t.ex.hexagon, t.ex.about(formatArea(hexAreaKm2(p.hex.h3), lang))) };
  }
  if (s.type === 'named') {
    if (s.area.kind === 'world') return { name: t.common.world, sentence: t.ex.worldSentence, kindLine: t.ex.wholeWorld };
    const name = areaName(s.area, lang);
    return { name, sentence: name, kindLine: t.ex.kindLine(t.common.kinds[s.area.kind], s.area.area_km2 > 0 ? formatArea(s.area.area_km2, lang) : '') };
  }
  const name = s.type === 'circle' && city ? t.common.circle(formatNumber(s.radiusKm, lang, 1), city) : selectionLabel(s, lang);
  if (s.type === 'circle') {
    return { name, sentence: lowerFirst(name), kindLine: t.ex.kindLine(t.ex.circleKind, t.ex.radiusOf(formatNumber(s.radiusKm, lang, 1))) };
  }
  return { name, sentence: lowerFirst(name), kindLine: t.ex.kindLine(t.ex.drawnArea, t.ex.about(formatArea(ringAreaKm2(s.ring), lang))) };
}

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement
  && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
/** Elements that use the arrow keys themselves (and the map, which pans with them). */
const ARROW_OWNERS = '[role="slider"], [role="grid"], [role="radiogroup"], [role="tablist"], [role="listbox"], [role="application"], .maplibregl-map';
const SPACE_OWNERS = 'button, a, summary, [role="tab"], [role="radio"], [role="option"], [role="checkbox"]';

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const f = () => setOn(mq.matches);
    f();
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [query]);
  return on;
}

export function Explorer() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const idBase = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const phone = useMedia('(max-width: 768px)');

  // data that does not depend on the area
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState(false);
  const [areas, setAreas] = useState<NamedArea[] | null>(null);
  const [areasError, setAreasError] = useState<string | null>(null);
  const [range, setRange] = useState<{ first: number; last: number } | null>(null);

  // the view
  const [picked, setPicked] = useState<Picked>({ sel: { type: 'named', area: worldArea() }, hex: null, key: 'world:WORLD', fly: false, seq: 0 });
  const [scale, setScale] = useState<Scale>('harmonized');
  const [mode, setMode] = useState<MapMode>('count');
  const monthMode: ColourMode = mode === 'trend' ? 'count' : mode;   // the calendar and the pictures show months
  const [mapCard, setMapCard] = useState(0);                         // width of an open map card (settings, legend)
  const [view, setView] = useState<ViewMode>('2d');
  const [ym, setYm] = useState<number | null>(null);
  // the hovered month lives in a small store (explorer/hover.ts): the timeline shows it at once, without a render of
  // this page; the map and the numbers take it once the pointer rests on it (mapPreview)
  const [mapPreview, setMapPreview] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [drawMode, setDrawMode] = useState<DrawMode>('none');
  const [tab, setTab] = useState<TabKey>('overview');
  const [collapsed, setCollapsed] = useState(false);
  // the panel's width, when the reader dragged its edge (1024 px and wider; kept in localStorage, and while the panel
  // is folded away); null: its usual width
  const wide = useMedia(`(min-width: ${RESIZE_FROM}px)`);
  const [panelW, setPanelW] = useState<number | null>(() => savedPanelWidth());
  const [winW, setWinW] = useState(() => window.innerWidth);
  useEffect(() => {
    let raf = 0;
    const f = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setWinW(window.innerWidth)); };
    window.addEventListener('resize', f);
    return () => { window.removeEventListener('resize', f); cancelAnimationFrame(raf); };
  }, []);
  const resizable = wide && !phone;
  const panelPx = resizable && panelW !== null ? clampPanel(panelW, winW) : null;
  const setPanelWidth = useCallback((px: number | null) => { setPanelW(px); savePanelWidth(px); }, []);
  // (the map slides by half of each step of a drag, so the middle of the free area stays in the middle)
  const mapShift = useRef<((dx: number) => void) | null>(null);
  const [level, setLevel] = useState<Level>(3);
  // where the map is (the links to NASA FIRMS), and whether it draws the month's hotspots as dots
  const [mapCam, setMapCam] = useState<{ lat: number; lon: number; zoom: number } | null>(null);
  const [dotsShown, setDotsShown] = useState(false);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  // the panel: places pinned to compare, how the compare chart counts, the side the tab content slides in from, and
  // on phones whether the place search is open in the sheet
  const [pins, setPins] = useState<CompareKey[]>([]);
  const [compareMode, setCompareMode] = useState<CompareMode>('count');
  const [tabFrom, setTabFrom] = useState<'left' | 'right' | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // the months of the Period tab (kept for the link and for the next place), the burning calendar at full size, and a
  // search the link asked for ("&search=1": the place search opens with the focus in it)
  const [period, setPeriod] = useState<{ from: number; to: number } | null>(null);
  const [calFull, setCalFull] = useState(false);
  const [searchWanted, setSearchWanted] = useState(0);
  // a new try at the series of the selected area after it failed (the error's Try again)
  const [attempt, setAttempt] = useState(0);
  // the card of a first visit (while the world is shown, until it is closed)
  const [welcome, setWelcome] = useState(() => !welcomeSeen());

  // what the area brings
  const [series, setSeries] = useState<{ key: string; points: MonthlyPoint[] } | null>(null);
  const [seriesError, setSeriesError] = useState<{ key: string; text: string } | null>(null);
  const [drivers, setDrivers] = useState<{ key: string; data: AreaDrivers | 'error' } | null>(null);
  const [outlook, setOutlook] = useState<{ key: string; rows: OutlookRow[] | 'error' } | null>(null);
  const [outline, setOutline] = useState<LonLat[][] | null>(null);
  const [focus, setFocus] = useState<{ key: string; bounds: Bounds } | null>(null);

  // layout: the header height (the map fills the window under it) and the dock height (kept clear by the camera)
  const root = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement | null>(null);
  // the dock moves into the sheet on phones (a new element): observe whichever is on the page
  const [dockEl, setDockEl] = useState<HTMLDivElement | null>(null);
  const dockRef = useCallback((el: HTMLDivElement | null) => { dock.current = el; setDockEl(el); }, []);
  const [dockH, setDockH] = useState(104);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>('.fh-header');
    const el = root.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => {
      if (header) el.style.setProperty('--fh-ex-top', `${Math.round(header.getBoundingClientRect().height)}px`);
      if (dock.current) setDockH(Math.round(dock.current.getBoundingClientRect().height));
    });
    if (header) ro.observe(header);
    if (dockEl) ro.observe(dockEl);
    return () => ro.disconnect();
  }, [dockEl]);

  useEffect(() => {
    loadMeta().then(setMeta, () => setMetaError(true));
    loadAreas().then(setAreas, (e: unknown) => setAreasError(String(e)));
    worldSources().then((src) => {
      let first = Infinity, last = -Infinity;
      for (const [m, s] of src) if (s !== 3) { first = Math.min(first, m); last = Math.max(last, m); }
      if (Number.isFinite(first)) setRange({ first: Math.max(first, 200011), last });
    }, () => setMetaError(true));
  }, []);

  // ------------------------------------------------------------------------------------------- selecting an area

  const select = useCallback((sel: AreaSelection, opts: { hex?: Picked['hex']; fly?: boolean; force?: boolean } = {}) => {
    const hex = opts.hex ?? null;
    const key = keyOf(sel, hex);
    setDrawMode('none');
    setPicked((prev) => (prev.key === key && !opts.force ? prev : { sel, hex, key, fly: !!opts.fly, seq: prev.seq + 1 }));
  }, []);
  const selectHex = useCallback((h3: string, lvl: Level, fly = false) => {
    const [lat, lon] = hexCentre(h3);
    select({ type: 'polygon', ring: hexRing(h3), label: t.ex.hexNear(formatCoord(lat, lon, lang)) }, { hex: { h3, level: lvl }, fly });
  }, [select, t, lang]);
  const findArea = useCallback((kind: string, id: string): NamedArea | null => {
    if (kind === 'world') return worldArea();
    return areas?.find((a) => a.kind === kind && (a.id === id || (kind === 'country' && a.id === id.toUpperCase()))) ?? null;
  }, [areas]);

  // the series of the selected area (a newer request always wins; the old one stays on screen meanwhile)
  const seriesReq = useRef(0);
  useEffect(() => {
    const id = ++seriesReq.current;
    setSeriesError(null);
    const p = picked.hex ? hexSeries(picked.hex.h3, picked.hex.level) : areaSeries(picked.sel);
    p.then((points) => { if (id === seriesReq.current) setSeries({ key: picked.key, points }); },
      (e: unknown) => {
        if (id !== seriesReq.current) return;
        const tooLarge = e instanceof RangeError || /too large/i.test(String(e));
        setSeriesError({ key: picked.key, text: tooLarge ? t.ex.tooLarge : t.explorer.seriesError });
      });
  }, [picked, t, attempt]);

  // the state around a city circle (the city's state from the search's city list, its hint corrected there): the
  // circle shows that state's outlook
  const circleSel = picked.sel.type === 'circle' && !picked.hex ? picked.sel : null;
  const searchIndex = useSearchIndex(circleSel !== null);
  // (a city that is a state of its own, as Kuala Lumpur, takes the state around it from the city list: Selangor)
  const near = useMemo(() => (circleSel ? cityNear(circleSel.lat, circleSel.lon, 1, searchIndex) : null), [circleSel, searchIndex]);
  const [aroundState, setAroundState] = useState<{ key: string; id: string | null } | null>(null);
  const ownState = near?.city.state ? findArea('state', near.city.state) : null;
  const cityIsState = !!near && !!ownState && fold(areaName(ownState, lang).replace(/, [^,]+$/, '')) === fold(near.city.name);
  const nearKey = near ? `${near.city.lat},${near.city.lon}` : '';
  useEffect(() => {
    if (!cityIsState || !near) return undefined;
    let alive = true;
    webJson<CitiesFile>('cities.json').then((f) => {
      if (!alive || !f) return;
      const ix = (k: string) => f.columns.indexOf(k);
      const row = f.rows.find((r) => r[ix('name')] === near.city.name && Math.abs(Number(r[ix('lat')]) - near.city.lat) < 1e-4
        && Math.abs(Number(r[ix('lon')]) - near.city.lon) < 1e-4);
      const raw = row ? String(row[ix('state')] ?? '') : '';
      setAroundState({ key: nearKey, id: raw && raw !== near.city.state ? raw : null });
    }, () => undefined);
    return () => { alive = false; };
  }, [cityIsState, nearKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const circleState = useMemo(() => {
    if (!circleSel || !near) return null;
    const around = cityIsState && aroundState?.key === nearKey && aroundState.id ? findArea('state', aroundState.id) : null;
    const area = around ?? ownState;
    return area ? { area, city: near.city.name } : null;
  }, [circleSel, near, cityIsState, aroundState, nearKey, ownState]);
  // (still finding the circle's city or the state around it: the outlook waits)
  const circlePending = !!circleSel && (!searchIndex || !searchIndex.cities.length || (cityIsState && aroundState?.key !== nearKey));
  const [stateSeries, setStateSeries] = useState<{ key: string; points: MonthlyPoint[] } | null>(null);

  // drivers and the outlook of a named place (and the outlook of a city circle's state)
  const extraReq = useRef(0);
  useEffect(() => {
    const id = ++extraReq.current;
    const key = picked.key;
    if (circleState) {
      const area = circleState.area;
      areaOutlook(area).then((rows) => { if (id === extraReq.current) setOutlook({ key, rows }); },
        () => { if (id === extraReq.current) setOutlook({ key, rows: 'error' }); });
      areaSeries({ type: 'named', area }).then((points) => { if (id === extraReq.current) setStateSeries({ key, points }); }, () => undefined);
      return;
    }
    if (picked.sel.type !== 'named' || picked.hex) return;
    const area = picked.sel.area;
    areaDrivers(area).then((data) => { if (id === extraReq.current) setDrivers({ key, data }); },
      () => { if (id === extraReq.current) setDrivers({ key, data: 'error' }); });
    areaOutlook(area).then((rows) => { if (id === extraReq.current) setOutlook({ key, rows }); },
      () => { if (id === extraReq.current) setOutlook({ key, rows: 'error' }); });
  }, [picked, circleState]);

  // the outline on the map, and the camera flight
  useEffect(() => {
    let alive = true;
    const { sel, hex, key, fly, seq } = picked;
    const fkey = `${key}#${seq}`;
    if (hex) { setOutline([hexRing(hex.h3)]); if (fly) setFocus({ key: fkey, bounds: ringBoundsOf([hexRing(hex.h3)]) ?? WORLD_BOUNDS }); return undefined; }
    if (sel.type === 'named') {
      if (sel.area.kind === 'world') { setOutline(null); if (fly) setFocus({ key: fkey, bounds: WORLD_BOUNDS }); return undefined; }
      const approx = approxBounds(sel.area.lat, sel.area.lon, sel.area.area_km2);
      let flown = false;
      const timer = fly ? window.setTimeout(() => { flown = true; setFocus({ key: `${fkey}a`, bounds: approx }); }, 700) : 0;
      namedShape(sel.area).then((shape) => {
        if (!alive) return;
        setOutline(shape.outline.length ? shape.outline : null);
        if (fly && shape.bounds) { window.clearTimeout(timer); flown = true; setFocus({ key: `${fkey}s`, bounds: shape.bounds }); }
      }, () => {
        if (!alive) return;
        setOutline(null);
        if (fly && !flown) { window.clearTimeout(timer); setFocus({ key: `${fkey}a`, bounds: approx }); }
      });
      return () => { alive = false; window.clearTimeout(timer); };
    }
    const ring = selectionRing(sel);
    setOutline(ring ? [ring] : null);
    if (fly && ring) {
      const b = ringBoundsOf([ring]);
      if (b) setFocus({ key: fkey, bounds: b });
    }
    return undefined;
  }, [picked]);

  // ------------------------------------------------------------------------------------------- the hash (shareable view)

  const pending = useRef<ExplorerLink | null>(null);
  const pendingHash = useRef('');            // the hash of the pending link (its pinned places, what it got wrong)
  const firstLink = useRef(true);            // the link the page opened with (a reload brings its pinned places back)
  const [linkTick, setLinkTick] = useState(0);
  const [hashReady, setHashReady] = useState(false);
  // the Explorer stays mounted (hidden) on the other pages: is it the page in view?
  const [onPage, setOnPage] = useState(() => isExplorerHash(window.location.hash));
  useEffect(() => {
    if (isExplorerHash(window.location.hash)) { pending.current = parseExplorerLink(window.location.hash); pendingHash.current = window.location.hash; }
    setLinkTick((n) => n + 1);
    const onHash = () => {
      setOnPage(isExplorerHash(window.location.hash));
      if (!isExplorerHash(window.location.hash)) { setPlaying(false); return; }
      pendingHash.current = window.location.hash;
      pending.current = readLink(window.location.hash);
      setLinkTick((n) => n + 1);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const link = pending.current;
    if (!link) { if (range) setHashReady(true); return; }
    const a = link.area;
    const namedPins = parseCompare(pendingHash.current)?.keys.some((k) => !/^(hex|world|circle):/.test(k)) ?? false;
    if (((a?.type === 'named' && a.kind !== 'world') || namedPins) && areas === null && areasError === null) return;   // wait for the places
    if (!range) return;                                                                                // and the months
    pending.current = null;
    // what the link got wrong, each in its own words (a bad shape or month keeps the view, an unknown place shows the
    // world, a month outside the record shows the nearest month)
    const hash = pendingHash.current;
    const problems = new Set(linkProblems(hash));
    const notes: string[] = [];
    const L = t.exPanel.link;
    if (link.mode) setMode(link.mode);
    if (link.view) setView(link.view);
    if (link.scale) setScale(link.scale);
    // the tab (a link with a place and no tab opens the Overview), the months of the Period tab, the full calendar and
    // the search
    const tabOf: TabKey | null = link.tab ?? (link.cal === 'full' ? 'calendar' : link.area ? 'overview' : null);
    if (tabOf) { setTabFrom(null); setTab(tabOf); }
    if (link.period) setPeriod(link.period);
    setCalFull(link.cal === 'full');
    if (link.search) setSearchWanted((n) => n + 1);
    if (link.month) {
      const m = ymOf(link.month.yr, link.month.mo);
      if (m < range.first || m > range.last) {
        notes.push(L.month(formatMonth(Math.floor(range.first / 100), range.first % 100, lang), formatMonth(Math.floor(range.last / 100), range.last % 100, lang)));
      }
      setYm(Math.max(range.first, Math.min(range.last, m)));
    }
    if (problems.has('area')) notes.push(L.shape);
    if (a) {
      if (a.type === 'named') {
        const found = findArea(a.kind, a.id);
        if (found) select({ type: 'named', area: found }, { fly: true });
        else { notes.push(L.area); select({ type: 'named', area: worldArea() }, { fly: true }); }
      } else if (a.type === 'hex') {
        const res = isHexagon(a.h3) ? getResolution(a.h3) : -1;
        if (res === 3 || res === 4) selectHex(a.h3, res, true);
        else if (res >= 0) select({ type: 'polygon', ring: hexRing(a.h3) }, { fly: true });
        else notes.push(L.shape);
      } else if (a.type === 'circle') {
        select({ type: 'circle', lat: a.lat, lon: a.lon, radiusKm: a.radiusKm }, { fly: true });
      } else if (crossesItself(a.ring)) {
        // a shape that crosses itself has no meaningful area (the map refuses to draw one too): the world instead
        notes.push(L.crossing);
        select({ type: 'named', area: worldArea() }, { fly: true });
      } else {
        select({ type: 'polygon', ring: a.ring }, { fly: true });
      }
    }
    if (problems.has('month')) notes.push(L.monthBad);
    if (problems.has('view')) notes.push(L.view);
    // the pinned places are a tray that stays while you browse: Back and Forward (entries the Explorer wrote) keep
    // them; the link the page opened with (a reload, a shared link) and a new link from elsewhere bring their own
    const cmp = parseCompare(hash);
    const own = firstLink.current || !viewEntry();
    firstLink.current = false;
    if (cmp && own) {
      const ok = cmp.keys.filter((k) => pinnable(k, areas));
      if (cmp.invalid || ok.length < cmp.keys.length) notes.push(L.compare);
      if (cmp.tooMany) notes.push(L.compareMax);
      setPins(ok.slice(0, COMPARE_MAX));
    }
    setLinkNote(notes.length ? notes.join(' ') : null);
    setHashReady(true);
  }, [linkTick, areas, areasError, range, findArea, select, selectHex, t, lang]);

  // the latest full month by default
  useEffect(() => { if (ym === null && range && hashReady) setYm(range.last); }, [ym, range, hashReady]);

  const linkNow = useCallback(() => explorerLink(picked.sel, ym === null ? null : { yr: Math.floor(ym / 100), mo: ym % 100 },
    { mode, view, scale, hex: picked.hex?.h3 ?? null, compare: pins, tab: tab as LinkTab | 'overview', period, cal: calFull ? 'full' : null }),
  [picked, ym, mode, view, scale, pins, tab, period, calFull]);

  // write the view into the hash (not while playing: it is written when the player stops). An area the user picks
  // (search, World, drawing, a hexagon) adds a history entry, so Back returns to the area before; the month, the
  // colours and the view only update the entry.
  const userPick = useRef(false);
  const pick = useCallback((sel: AreaSelection, opts: Parameters<typeof select>[1] = {}) => {
    userPick.current = true;
    select(sel, opts);
  }, [select]);
  useEffect(() => {
    if (!hashReady || playing || ym === null || !isExplorerHash(window.location.hash)) return;
    const link = linkNow();
    const now = window.location.hash;
    const push = userPick.current && areaParam(link) !== areaParam(now);
    userPick.current = false;
    if (now === link) return;
    if (push) window.history.pushState(VIEW_STATE, '', link);
    else window.history.replaceState(VIEW_STATE, '', link);
  }, [hashReady, playing, ym, linkNow, linkTick]);

  // ------------------------------------------------------------------------------------------- months and the player

  const stepMs = STEP_MS / speed;
  const step = useCallback((by: number) => {
    setPlaying(false);
    previewMonth(null);
    setMapPreview(null);
    setYm((m) => (m === null || !range ? m : stepMonth(m, by, range.first, range.last)));
  }, [range]);
  const choose = useCallback((m: number) => {
    setPlaying(false);
    previewMonth(null);     // a chosen month ends any preview
    setMapPreview(null);
    if (range) setYm(Math.max(range.first, Math.min(range.last, m)));
  }, [range]);
  const togglePlay = useCallback(() => { previewMonth(null); setMapPreview(null); setPlaying((p) => !p); }, []);
  // the map's colours: the trend is one map for the whole record, so picking it stops the player, and playing goes
  // back to the fire count
  const pickMode = useCallback((m: MapMode) => { if (m === 'trend') setPlaying(false); setMode(m); }, []);
  useEffect(() => { if (playing && mode === 'trend') setMode('count'); }, [playing, mode]);

  useEffect(() => {
    if (!playing || ym === null || !range) return undefined;
    let alive = true;
    const next = stepMonth(ym, 1, range.first, range.last, true);
    const id = window.setTimeout(() => {
      loadFrame(level, next).catch(() => undefined).then(() => { if (alive) setYm(next); });
    }, stepMs);
    return () => { alive = false; window.clearTimeout(id); };
  }, [playing, ym, range, level, stepMs]);

  // a hovered month reaches the map and the numbers after a short pause, so a quick sweep stays smooth (and renders
  // nothing here: only the store's listeners, the timeline among them, follow every month of a sweep)
  const playingNow = useRef(playing);
  playingNow.current = playing;
  // (a rest is 140 ms and six frames: on a slow computer, where a frame takes long, a sweep never stops to redraw)
  useEffect(() => {
    let raf = 0;
    const off = onHoveredMonth(() => {
      cancelAnimationFrame(raf);
      const m = hoveredMonth().ym;
      if (m === null || playingNow.current) { setMapPreview(null); return; }
      const t0 = performance.now();
      let frames = 0;
      const wait = (now: number) => {
        frames += 1;
        if (frames >= 6 && now - t0 >= 140) setMapPreview(m);
        else raf = requestAnimationFrame(wait);
      };
      raf = requestAnimationFrame(wait);
    });
    return () => { off(); cancelAnimationFrame(raf); };
  }, []);
  const onPreview = useCallback((m: number | null) => previewMonth(m, 'timeline'), []);

  const shownYm = playing || mapPreview === null ? ym : mapPreview;

  // ------------------------------------------------------------------------------------------- actions

  const city = useCircleCity(picked.hex ? null : picked.sel);   // "50 km around Palangkaraya, Indonesia"
  const info = useMemo(() => describe(picked, t, lang, city), [picked, t, lang, city]);
  const points = series?.points ?? null;
  const stale = !series || series.key !== picked.key;
  // the selected area's series could not be loaded (its error, with Try again, takes the place of its numbers)
  const failed = !!seriesError && seriesError.key === picked.key;
  const named = picked.sel.type === 'named' && !picked.hex;

  const downloadCsv = useCallback(() => {
    if (!points || !meta || stale) { toast(t.ex.toasts.failed, 'info'); return; }
    try { saveCsv(info.name, points, meta, t); toast(t.ex.toasts.csv); } catch { toast(t.ex.toasts.failed, 'info'); }
  }, [points, meta, stale, info.name, t, toast]);

  const copyLink = useCallback(async () => {
    const link = linkNow();
    if (isExplorerHash(window.location.hash) && window.location.hash !== link) window.history.replaceState(VIEW_STATE, '', link);
    const url = new URL(link, window.location.href).toString();
    try {
      await navigator.clipboard.writeText(url);
      toast(t.ex.linkCopied);
    } catch {
      const area = document.createElement('textarea');
      area.value = url;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      area.remove();
      toast(ok ? t.ex.linkCopied : t.ex.linkFailed, ok ? 'success' : 'info');
    }
  }, [linkNow, t, toast]);

  // a CSV asked for before the area's numbers are in: saved as soon as they are
  const [csvWanted, setCsvWanted] = useState(false);
  useEffect(() => {
    if (!csvWanted) return;
    if (seriesError && seriesError.key === picked.key) { setCsvWanted(false); toast(t.ex.toasts.failed, 'info'); }
    else if (points && meta && !stale) { setCsvWanted(false); downloadCsv(); }
  }, [csvWanted, points, meta, stale, seriesError, picked.key, downloadCsv, toast, t]);

  // ------------------------------------------------------------------------------------------- the panel

  // the numbers keep the month they showed while a new area loads, so they never mix one area's series with another
  // area's month (they glide from the old area's numbers to the new ones once it is in)
  const kpiYmRef = useRef<number | null>(null);
  if (!stale) kpiYmRef.current = shownYm;
  const kpiYm = stale ? kpiYmRef.current : shownYm;
  // (pending while the new area's series loads: no trend word from the old area's series)
  const family = useFamilyTest(picked.sel, picked.hex, stale && seriesError?.key !== picked.key);

  // places pinned to compare (named places and map hexagons; the place in the panel is drawn with them)
  const ownKey = pinKey(picked.sel, picked.hex);
  const pinned = useMemo(() => pins.filter((k) => k !== ownKey), [pins, ownKey]);
  const pinnedSeries = usePinnedSeries(pinned, areas);
  const isPinned = ownKey !== null && pins.includes(ownKey);
  const togglePin = useCallback(() => {
    if (!ownKey) { toast(t.exPanel.tools.compareOnly, 'info'); return; }
    if (pins.includes(ownKey)) { setPins((p) => p.filter((k) => k !== ownKey)); toast(t.exPanel.compare.unpinned(info.name)); return; }
    if (pins.length >= COMPARE_MAX) { toast(t.exPanel.compare.full, 'info'); return; }
    setPins((p) => [...p, ownKey]);
    toast(t.exPanel.compare.pinned(info.name));
  }, [ownKey, pins, info.name, t, toast]);
  const unpin = useCallback((key: CompareKey) => setPins((p) => p.filter((k) => k !== key)), []);
  const compareSeries = useMemo(() => (pinned.length ? [
    { key: ownKey ?? picked.key, name: info.name, points: stale ? null : points, current: true },
    ...pinnedSeries.map((s) => ({ key: s.key, name: s.name, points: s.points, current: false })),
  ] : []), [pinned.length, ownKey, picked.key, info.name, stale, points, pinnedSeries]);

  // the tabs: the content slides in from the side of the tab picked, and a strip scrolled out of view comes back
  const scroller = useRef<HTMLDivElement>(null);
  const tabNow = useRef(tab);
  tabNow.current = tab;
  const stillMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const showTab = useCallback((next: TabKey) => {
    const cur = tabNow.current;
    if (cur !== next) setTabFrom(TAB_KEYS.indexOf(next) > TAB_KEYS.indexOf(cur) ? 'right' : 'left');
    setTab(next);
    requestAnimationFrame(() => {
      const box = scroller.current, bar = box?.querySelector('.fh-ex-tabbar'), panel = box?.querySelector('.fh-ex-tabpanel');
      if (!box || !bar || !panel) return;
      const s = box.getBoundingClientRect(), b = bar.getBoundingClientRect(), p = panel.getBoundingClientRect();
      // the new tab starts right under the tabs: back up when the old one was read under the stuck tabs, or bring
      // tabs that sit low in the panel up to where they stick
      // (a stuck bar sits at the scroller's content edge plus its own top, which is minus the scroller's padding)
      const stuck = s.top + box.clientTop + (parseFloat(getComputedStyle(box).paddingTop) || 0) + (parseFloat(getComputedStyle(bar).top) || 0);
      const dy = p.top < b.bottom - 1 ? p.top - b.bottom : b.top > s.top + s.height * 0.55 ? b.top - stuck : 0;
      if (dy) box.scrollTo({ top: Math.max(0, box.scrollTop + dy), behavior: stillMotion() ? 'auto' : 'smooth' });
    });
  }, []);
  // the hotspots of a period live in the Period tab: open it at its downloads
  const focusHotspots = useRef(false);
  const openHotspots = useCallback(() => { focusHotspots.current = true; showTab('period'); }, [showTab]);
  useEffect(() => {
    if (!focusHotspots.current || tab !== 'period' || stale) return undefined;
    let tries = 0;
    const id = window.setInterval(() => {
      const btn = document.querySelector<HTMLButtonElement>('.fh-ex-panel .pp-download-row .ui-btn-primary');
      if (btn || ++tries > 40) {
        window.clearInterval(id);
        focusHotspots.current = false;
        btn?.closest('.pp-downloads')?.scrollIntoView({ block: 'center', behavior: stillMotion() ? 'auto' : 'smooth' });
        btn?.focus({ preventScroll: true });
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [tab, stale]);
  // a hovered year of the yearly chart previews the same month of that year on the map
  const onHoverYear = useCallback((yr: number | null) => {
    const base = ym ?? range?.last ?? null;
    previewMonth(yr === null || base === null ? null : ymOf(yr, base % 100), 'chart');
  }, [ym, range]);
  // the month under the pointer in the calendar: a preview, and a faint mark on the timeline
  const onCalendarHover = useCallback((m: { yr: number; mo: number } | null) => previewMonth(m ? ymOf(m.yr, m.mo) : null, 'calendar'), []);
  // the phone sheet
  const sheetRef = useRef<HTMLElement>(null);
  const sheetTop = useRef<HTMLDivElement>(null);
  const sheet = useSheet(phone, root, sheetRef, sheetTop, SHEET_LAYOUT);
  const sheetSize = sheet.size;
  const setSheetSize = sheet.setSize;
  const onKpiOpen = useCallback((target: KpiTarget) => {
    showTab(target);
    if (phone && sheetSize === 'peek') setSheetSize('half');
  }, [showTab, phone, sheetSize, setSheetSize]);
  // drawing on a phone needs the map: the sheet goes down; a map card opening does the same
  useEffect(() => { if (phone && drawMode !== 'none') { setSheetSize('peek'); setSearchOpen(false); } }, [phone, drawMode, setSheetSize]);
  // the map settings change the map: the sheet goes down to show it; the legend is a popover above the sheet and leaves
  // it as it was (so the tabs answer at once when it closes)
  const [mapCardKind, setMapCardKind] = useState<'none' | 'settings' | 'legend'>('none');
  useEffect(() => { if (phone && mapCardKind === 'settings') setSheetSize('peek'); }, [phone, mapCardKind, setSheetSize]);
  // a link asked for the search ("&search=1", the hub's "Find the fire around your city"): on phones the sheet opens
  // full with the search, else the box in the panel takes the focus (once it is on the page)
  useEffect(() => {
    if (!searchWanted || !hashReady) return undefined;
    if (phone) { setSearchOpen(true); return undefined; }
    setCollapsed(false);
    let tries = 0;
    const id = window.setInterval(() => {
      const input = document.querySelector<HTMLInputElement>('.fh-ex-panel .fh-search-input');
      if (input || ++tries > 50) { window.clearInterval(id); input?.focus(); }
    }, 100);
    return () => window.clearInterval(id);
  }, [searchWanted, hashReady, phone]);
  // the search in the sheet: open it full height at its top (the box and the drawing tools lead the sheet) and focus
  // the box; a pick closes it
  useLayoutEffect(() => {
    if (!phone || !searchOpen) return;
    setSheetSize('full');
    if (scroller.current) scroller.current.scrollTop = 0;
    const input = sheetRef.current?.querySelector<HTMLInputElement>('.fh-search-input');
    input?.focus({ preventScroll: true });
  }, [phone, searchOpen, setSheetSize]);
  // (opened from the small sheet, whose body is inert until it grows: the box takes the focus once it can)
  useEffect(() => {
    if (!phone || !searchOpen || sheetSize === 'peek') return;
    const input = sheetRef.current?.querySelector<HTMLInputElement>('.fh-search-input');
    if (input && document.activeElement !== input) input.focus({ preventScroll: true });
  }, [phone, searchOpen, sheetSize]);

  // commands from the palette (and any page)
  const onCommand = useRef<(c: Command) => void>(() => undefined);
  onCommand.current = (c: Command) => {
    const show = () => { if (!isExplorerHash(window.location.hash)) window.location.hash = linkNow(); };
    switch (c.action) {
      case 'select-area': {
        const a = findArea(c.kind, c.id);
        if (a) select({ type: 'named', area: a }, { fly: true });
        break;
      }
      case 'play-toggle': show(); togglePlay(); break;
      case 'toggle-3d': show(); setView((v) => (v === '3d' ? '2d' : '3d')); break;
      case 'colour': show(); pickMode(c.mode); break;
      case 'scale': show(); setScale(c.scale); break;
      case 'draw': show(); setCollapsed(false); setDrawMode(c.mode); break;
      case 'set-month': show(); choose(c.ym); break;
      case 'download-csv': show(); if (points && meta && !stale) downloadCsv(); else setCsvWanted(true); break;
      // the link of the page in view: on another page that page copies its own
      case 'copy-link': if (isExplorerHash(window.location.hash)) void copyLink(); break;
      case 'step-month': show(); step(c.by); break;
      // compare (package explorer-panel): pin the place in view and show the chart of the pinned places
      case 'compare-pin':
        show();
        if (isPinned) toast(t.exPanel.compare.pinned(info.name)); else togglePin();
        showTab('overview');
        break;
      case 'compare-clear': show(); setPins([]); break;
      default: break;
    }
  };
  useCommand((c) => onCommand.current(c), []);

  // commands picked on another page (or before the Explorer was ready) run once it is shown and has read its link
  useEffect(() => {
    if (!hashReady) return undefined;
    setExplorerLive(true);
    return () => setExplorerLive(false);
  }, [hashReady]);
  useEffect(() => {
    if (!hashReady || !onPage) return undefined;
    const run = () => { for (const c of takeExplorerCommands()) onCommand.current(c); };
    run();
    return onExplorerCommand(run);
  }, [hashReady, onPage]);

  // keyboard shortcuts (not while typing, and only on this page)
  const onKey = useRef<(e: KeyboardEvent) => void>(() => undefined);
  onKey.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !isExplorerHash(window.location.hash)) return;
    // a modal is open (a closed <dialog> left in the page does not count)
    if (isTyping(e.target) || [...document.querySelectorAll('[aria-modal="true"], dialog[open]')]
      .some((d) => !(d instanceof HTMLDialogElement) || d.open)) return;
    const target = e.target instanceof Element ? e.target : null;
    switch (e.key) {
      case ' ':
        if (target?.closest(SPACE_OWNERS)) return;
        e.preventDefault();
        if (!e.repeat) togglePlay();   // a held key plays (or pauses) once
        break;
      case 'ArrowLeft': case 'ArrowRight':
        if (target?.closest(ARROW_OWNERS)) return;
        e.preventDefault();
        step((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 12 : 1));
        break;
      case 'd': case 'D': if (!e.repeat) setView((v) => (v === '3d' ? '2d' : '3d')); break;
      case 'c': case 'C': pickMode('count'); break;
      case 'a': case 'A': pickMode('anomaly'); break;
      case 'r': case 'R': pickMode('trend'); break;
      case 'Escape': if (drawMode !== 'none') setDrawMode('none'); break;
      default: break;
    }
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  const onDraw = useCallback((ring: LonLat[]) => { pick({ type: 'polygon', ring }); }, [pick]);

  // the camera: while the Explorer is hidden its map has no size, so a flight waits until it is shown again (two
  // frames, so the map has measured itself first). A flight cut short by leaving the page (Back during it) is flown
  // again when the page comes back (Forward), under a new key so the map flies even to the same place.
  const [mapFocus, setMapFocus] = useState(focus);
  const hiddenSince = useRef(!onPage);
  const flownAt = useRef(0);          // when the map was last sent to a place
  const cutShort = useRef(false);     // the page was left during that flight
  const reflown = useRef(0);
  useEffect(() => { if (mapFocus) flownAt.current = performance.now(); }, [mapFocus]);
  useEffect(() => {
    if (!onPage) {
      if (!hiddenSince.current && performance.now() - flownAt.current < FLIGHT_GUARD_MS) cutShort.current = true;
      hiddenSince.current = true;
      return undefined;
    }
    if (!hiddenSince.current) { setMapFocus(focus); return undefined; }
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        hiddenSince.current = false;
        const again = cutShort.current;
        cutShort.current = false;
        setMapFocus(again && focus ? { ...focus, key: `${focus.key}~${++reflown.current}` } : focus);
      });
    });
    return () => cancelAnimationFrame(id);
  }, [onPage, focus]);

  // ------------------------------------------------------------------------------------------- layout

  // the toasts ride above the timeline dock (the phone sheet) while the Explorer is the page in view
  useEffect(() => {
    const html = document.documentElement;
    if (!onPage) { html.style.removeProperty('--fh-toast-lift'); return undefined; }
    // (a full sheet: the toasts stay low, over it, rather than climb to the top)
    const lift = phone ? (sheet.size === 'full' ? 0 : Math.min(sheet.height, window.innerHeight * 0.5)) : dockH + 12;
    html.style.setProperty('--fh-toast-lift', `${Math.round(lift)}px`);
    return () => { html.style.removeProperty('--fh-toast-lift'); };
  }, [onPage, phone, dockH, sheet.height, sheet.size]);

  // the room the panels, the dock and the map's own controls take, measured (explorer/mapLayout.ts)
  const padding = useMapPadding(root, { phone, collapsed, card: mapCard, panel: panelPx });
  const tabs: TabItem<TabKey>[] = TAB_KEYS.map((key) => ({ key, label: t.ex.tabs[key] }));
  const shownMonth = shownYm === null ? null : { yr: Math.floor(shownYm / 100), mo: shownYm % 100 };
  const monthLabel = shownMonth ? `${t.common.months[shownMonth.mo - 1]} ${shownMonth.yr}` : '';
  const lastYear = range ? Math.floor(range.last / 100) : 2026;
  // (one array while the record stays the same: a new one on every render would draw the charts again)
  const yearSpan = useMemo(() => [FIRST_YEAR, lastYear] as const, [lastYear]);
  const scaled =useMemo(() => (points ? onScale(points, scale) : null), [points, scale]);
  const calTitle = useMemo(() => (points ? calendarTitle(points, t) : ''), [points, t]);
  // (ready only once the link is read: a link to a place never reads as ready on the world shown before it)
  const ready = hashReady && !!points && shownYm !== null;
  const P = t.exPanel;

  if (metaError) {
    return (
      <div className="fh-ex-fail" role="alert">
        <p className="fh-ex-fail-title">{t.explorer.metaError}</p>
        <p>{t.common.errorHint}</p>
        <button type="button" className="ui-btn" onClick={() => window.location.reload()}>{t.common.reload}</button>
      </div>
    );
  }

  const picker = (
    <AreaPicker areas={areas} areasError={areasError} selection={picked.sel} drawMode={drawMode}
      onSelect={(s) => { pick(s, { fly: true, force: true }); if (phone) { setSearchOpen(false); setSheetSize('half'); } }} onDrawMode={setDrawMode} />
  );
  const pinLabel = !ownKey ? P.tools.compareOnly : isPinned ? P.tools.unpin(info.name)
    : pins.length >= COMPARE_MAX ? P.tools.compareFull : P.tools.pin(info.name);
  // the actions of the place: download, pin to compare, copy the link
  const actions = (
    <div className="fh-ex-actions" role="group" aria-label={t.ex.panelLabel}>
      {meta ? (
        <DownloadMenu name={info.name} sentence={info.sentence} points={stale ? null : points} scale={scale} mode={monthMode} meta={meta}
          family={family} compare={compareSeries.length ? { series: compareSeries, mode: compareMode } : null} onHotspots={() => { openHotspots(); if (phone && sheetSize !== 'full') setSheetSize('full'); }} />
      ) : null}
      <Tooltip content={pinLabel}>
        <button type="button" className="ui-btn ui-btn-ghost fh-ex-tool" aria-pressed={isPinned} aria-disabled={!ownKey || undefined}
          aria-label={`${P.tools.compare}${pins.length ? ` (${pins.length})` : ''}`} onClick={togglePin}>
          <IconLayers size={17} /><span>{P.tools.compare}</span>
          {pins.length ? <span className="fh-ex-tool-count ui-mono" aria-hidden="true">{pins.length}</span> : null}
        </button>
      </Tooltip>
      <Tooltip content={t.ex.copyLink}>
        <button type="button" className="ui-btn ui-btn-ghost fh-ex-tool fh-ex-tool-icon" onClick={() => { void copyLink(); }} aria-label={t.ex.copyLink}>
          <IconCopy size={17} />
        </button>
      </Tooltip>
    </div>
  );
  const status = (
    <>
      {stale && !seriesError ? (
        <p className="fh-ex-loading" role="status"><span className="fh-ex-spin" aria-hidden="true" />
          {series ? t.ex.updating(info.name) : t.ex.starting}</p>
      ) : null}
      {failed && seriesError ? (
        <div className="ui-callout fh-ex-fail-box" role="alert">
          <p className="ui-callout-title">{seriesError.text}</p>
          <div className="ui-callout-body">
            <p>{t.common.errorHint}</p>
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => { setSeriesError(null); setAttempt((n) => n + 1); }}>
              {t.common.retry}
            </button>
          </div>
        </div>
      ) : null}
      {linkNote ? <p className="fh-ex-note" role="status">{linkNote}</p> : null}
    </>
  );
  // while the series shown is not the selected area's (it loads, or it failed), every sentence and every title built
  // from it waits: they would put one place's numbers under another's name
  const waiting = (lines: number[], label: string) => (
    <div className="fh-ex-wait" aria-busy="true" aria-label={label}>
      {lines.map((h, i) => <Skeleton key={i} height={h} />)}
    </div>
  );
  const waitLabel = t.ex.updating(info.name);
  const overview = (
    <>
      {points && meta && !stale ? <FireBrief name={info.sentence} points={points} meta={meta} ym={kpiYm} family={family} />
        : failed ? null : waiting([18, 18, 18, 18], waitLabel)}
      {pinned.length ? (
        <div className="fh-ex-compare">
          <div className="fh-ex-compare-head">
            <p className="fh-ex-compare-label">{P.compare.label}</p>
            <ul className="fh-ex-pins">
              {pinnedSeries.map((s) => (
                <li key={s.key} className="fh-ex-pin">
                  <span className="fh-ex-pin-name">{s.name}</span>
                  <Tooltip content={P.compare.remove(s.name)}>
                    <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon fh-ex-pin-x" aria-label={P.compare.remove(s.name)}
                      onClick={() => unpin(s.key)}><IconClose size={14} /></button>
                  </Tooltip>
                </li>
              ))}
            </ul>
            <button type="button" className="ui-btn ui-btn-ghost fh-ex-compare-clear" onClick={() => setPins([])}>{P.compare.clear}</button>
          </div>
          <Segmented<CompareMode> label={P.compare.switchLabel} hideLabel value={compareMode} onChange={setCompareMode}
            options={[{ value: 'count', label: P.compare.counts }, { value: 'share', label: P.compare.share }]} />
          {pinnedSeries.some((s) => s.failed) ? <p className="fh-ex-note">{pinnedSeries.filter((s) => s.failed).map((s) => P.compare.failed(s.name)).join(' ')}</p> : null}
          <CompareChart series={compareSeries} years={yearSpan} mode={compareMode} onHoverYear={onHoverYear} />
        </div>
      ) : null}
      {/* the place's own chart (with its 90% range) stays, under the compare chart when places are pinned */}
      {points && meta && !failed ? (
        <SeriesChart points={points} scale={scale} meta={meta} years={yearSpan} name={info.sentence} compact
          onHoverYear={onHoverYear} family={family} waiting={stale ? waitLabel : null} />
      ) : failed ? null : <Skeleton height={240} />}
      {points && !stale ? <KpiDetails points={points} ym={kpiYm} family={family} /> : null}
      {!pinned.length ? <p className="fh-ex-help fh-ex-compare-hint"><IconLayers size={14} />{P.compare.hint}</p> : null}
    </>
  );
  const bodyClass = `fh-ex-body${stale && series ? ' is-stale' : ''}`;
  const isWorld = picked.sel.type === 'named' && picked.sel.area.kind === 'world' && !picked.hex;
  const welcomeCard = welcome && isWorld ? <Welcome onClose={() => setWelcome(false)} /> : null;
  const strip = points && !failed ? <Kpis points={points} ym={kpiYm} family={family} onOpen={onKpiOpen} loading={stale ? waitLabel : null} /> : (
    <div className="fh-ex-kpis fh-ex-kpis-skeleton" aria-hidden="true">
      <p className="fh-ex-kpis-caption">{t.exPanel.strip.unit}</p>
      <Skeleton height={80} /><Skeleton height={80} /><Skeleton height={80} />
    </div>
  );
  const tabsBlock = (
    <>
      <Tabs<TabKey> label={t.ex.tabsLabel} items={tabs} value={tab} onChange={showTab} idBase={idBase} />
      <TabPanel idBase={idBase} tab={tab} from={tabFrom}>
        {tab === 'overview' ? overview : null}
        {tab === 'calendar' ? (
          failed ? null : scaled ? (
            <div className="fh-ex-cal-box">
              <div className="fh-ex-cal-titlebar">
                {stale ? waiting([22], waitLabel) : <h3 className="ui-figure-title">{calTitle}</h3>}
                <Tooltip content={t.calendar.full.expand}>
                  <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon fh-ex-cal-expand" aria-label={t.calendar.full.expand}
                    aria-haspopup="dialog" onClick={() => setCalFull(true)}>
                    <IconExpand size={17} />
                  </button>
                </Tooltip>
              </div>
              <p className="fh-ex-help">{coarsePointer() ? t.ex.calendarHelpTouch : t.ex.calendarHelp}</p>
              <Calendar points={scaled} scale={scale} mode={monthMode} years={yearSpan} selected={shownMonth} busy={stale}
                onSelect={(m) => choose(ymOf(m.yr, m.mo))}
                onHover={onCalendarHover}
                name={info.name} />
              <p className="ui-figure-source">{t.ex.sourceLine}</p>
            </div>
          ) : <Skeleton height={300} />
        ) : null}
        {tab === 'period' ? (
          // any range of months of this area, with its downloads (the challenge's date range); hidden while a new
          // area loads, so it never shows the numbers of one area under the name of another
          points && meta && !stale ? <PeriodPanel sel={picked.sel} name={info.name} points={points} meta={meta} initial={period}
            firmsHref={mapCam ? firmsUrl(mapCam.lat, mapCam.lon, mapCam.zoom) : null}
            onPeriodChange={(p) => setPeriod((old) => (old && old.from === p.from && old.to === p.to ? old : { from: p.from, to: p.to }))} />
            : failed ? null : waiting([40, 120, 160], waitLabel)
        ) : null}
        {tab === 'why' ? (
          <DriversPanel named={named} data={drivers && drivers.key === picked.key ? drivers.data : drivers?.data ?? null}
            month={shownMonth} monthLabel={monthLabel} busy={!!drivers && drivers.key !== picked.key}
            onShowMonth={(m) => choose(ymOf(m.yr, m.mo))} />
        ) : null}
        {tab === 'outlook' ? (
          <OutlookCard named={named || !!circleState || circlePending} rows={circlePending ? null : outlook ? outlook.rows : null}
            busy={!circlePending && !!outlook && outlook.key !== picked.key}
            points={circleState ? (stateSeries?.key === picked.key ? stateSeries.points : null) : stale ? null : points}
            lastYm={range?.last ?? null}
            forLabel={circleState ? t.outlook.forState(areaName(circleState.area, lang).replace(/, [^,]+$/, ''), circleState.city)
              : circleSel ? t.outlook.noState : null} />
        ) : null}
      </TabPanel>
    </>
  );
  const body = <div className={bodyClass} aria-busy={stale || undefined}>{strip}{tabsBlock}</div>;
  const timeline = (
    <div ref={dockRef} className="fh-ex-dock ui-glass">
      {range && ym !== null ? (
        <Timeline points={points} scale={scale} first={range.first} last={range.last} ym={ym} shownYm={ym}
          playing={playing} speed={speed} name={info.sentence} busy={stale}
          onPlay={togglePlay} onStep={step} onSpeed={setSpeed} onSelect={choose} onPreview={onPreview}
          trend={mode === 'trend'} onShowMonths={() => pickMode('count')} />
      ) : <div className="fh-ex-dock-skeleton"><Skeleton height={58} /></div>}
    </div>
  );
  const nameBlock = (
    <div className="fh-ex-area-text">
      <p className="fh-ex-kind">{info.kindLine}</p>
      <h2 className="fh-ex-name">{info.name}</h2>
    </div>
  );

  return (
    <div ref={root} className={`fh-ex${collapsed ? ' is-collapsed' : ''}${phone ? ' is-phone' : ''}`} data-series-ready={ready && !stale ? 'true' : 'false'}
      style={{ ['--fh-ex-dock-h' as string]: `${dockH}px`, ...(panelPx !== null ? { ['--panel-w' as string]: `${panelPx}px` } : {}) }}>
      <h1 className="sr-only">{t.ex.regionLabel}</h1>

      {phone ? (
        <aside ref={sheetRef} className={`fh-ex-panel fh-ex-sheet ui-glass${sheet.dragging ? ' is-dragging' : ''}`} aria-label={t.ex.panelLabel}
          data-size={sheet.size} style={{ height: sheet.height }}>
          <div ref={sheetTop} className="fh-ex-sheet-top" {...sheet.zone}>
            <div className="fh-ex-grip-row">
              <button type="button" className="fh-ex-grip" aria-label={P.sheet.handle(P.sheet.sizes[sheet.size])}
                aria-expanded={sheet.size !== 'peek'} aria-controls={`${idBase}-sheet`} onClick={sheet.cycle} onKeyDown={sheet.onHandleKey}>
                <span aria-hidden="true" />
              </button>
            </div>
            <header className="fh-ex-area">
              {nameBlock}
              <div className="fh-ex-area-tools">
                <Tooltip content={searchOpen ? P.tools.searchClose : P.tools.search}>
                  <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon" aria-expanded={searchOpen}
                    aria-label={searchOpen ? P.tools.searchClose : P.tools.search}
                    onClick={() => { if (searchOpen) { setSearchOpen(false); setSheetSize('half'); } else setSearchOpen(true); }}>
                    {searchOpen ? <IconClose size={18} /> : <IconSearch size={18} />}
                  </button>
                </Tooltip>
                <Tooltip content={playing ? P.sheet.pause : P.sheet.play} keys={['Space']}>
                  <button type="button" className="ui-btn ui-btn-primary ui-btn-icon fh-ex-sheet-play" aria-pressed={playing}
                    aria-label={playing ? P.sheet.pause : P.sheet.play} onClick={togglePlay} disabled={!range}>
                    {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
                  </button>
                </Tooltip>
              </div>
            </header>
            {/* the month's line of the small sheet (the strip of numbers takes over once the sheet is taller) */}
            {points && !stale ? <KpiLine points={points} ym={kpiYm} />
              : <p className="fh-ex-kpi-line fh-ex-kpi-line-wait" aria-busy="true">{failed ? seriesError?.text : waitLabel}</p>}
          </div>
          {/* half height shows the numbers and the timeline first, then the actions and the tabs (Sheet.tsx sizes it) */}
          <div id={`${idBase}-sheet`} ref={scroller} className="fh-ex-panel-scroll" inert={sheet.size === 'peek' || undefined}>
            {searchOpen ? <div className="fh-ex-panel-top">{picker}</div> : null}
            {searchOpen ? null : welcomeCard}
            <div className={`${bodyClass} fh-ex-strip-box`} aria-busy={stale || undefined}>{strip}</div>
            {status}
            {timeline}
            {actions}
            <div className={bodyClass} aria-busy={stale || undefined}>{tabsBlock}</div>
          </div>
        </aside>
      ) : (
        <aside id={`${idBase}-panel`} className="fh-ex-panel ui-glass" aria-label={t.ex.panelLabel} hidden={collapsed}>
          <div className="fh-ex-panel-top">{picker}</div>
          <div ref={scroller} className="fh-ex-panel-scroll">
            {welcomeCard}
            <header className="fh-ex-area">
              {nameBlock}
              <div className="fh-ex-area-tools">
                <Tooltip content={t.ex.shortcuts} keys={['?']}>
                  <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon fh-ex-keys-btn" onClick={() => emitCommand({ action: 'show-shortcuts' })}
                    aria-label={t.ex.shortcuts}><IconKeyboard size={17} /></button>
                </Tooltip>
                <Tooltip content={t.ex.collapse}>
                  <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon fh-ex-collapse" onClick={() => setCollapsed(true)}
                    aria-label={t.ex.collapse}><IconChevronLeft size={17} /></button>
                </Tooltip>
              </div>
            </header>
            {actions}
            {status}
            {body}
          </div>
        </aside>
      )}
      {resizable && !collapsed ? (
        <PanelHandle root={root} width={panelPx ?? panelDefault(winW)} controls={`${idBase}-panel`}
          onChange={setPanelWidth} onReset={() => setPanelWidth(null)} onLive={(dx) => mapShift.current?.(dx)} />
      ) : null}
      {collapsed && !phone ? (
        <Tooltip content={t.ex.expand}>
          <button type="button" className="fh-ex-expand ui-glass" onClick={() => setCollapsed(false)} aria-label={t.ex.expand}>
            <IconChevronRight size={18} />
            <span className="fh-ex-expand-name">{info.name}</span>
          </button>
        </Tooltip>
      ) : null}

      <section className="fh-ex-stage" aria-label={t.ex.map.label}>
        <MapView ym={shownYm} scale={scale} mode={mode} view={view} outline={outline} focus={mapFocus} padding={padding}
          drawMode={drawMode} playing={playing} stepMs={stepMs} lastYm={range?.last ?? null} previewing={!playing && mapPreview !== null}
          onDrawComplete={onDraw} onDrawCancel={() => setDrawMode('none')}
          onHexClick={(h3, lvl) => { userPick.current = true; selectHex(h3, lvl); }} onLevelChange={setLevel} label={t.ex.map.label}
          onCamera={setMapCam} onDots={setDotsShown} shiftRef={mapShift} />
        <MapControls mode={mode} scale={scale} view={view} level={level} drawMode={drawMode} onMode={pickMode} onScale={setScale}
          dots={dotsShown} camera={mapCam}
          onView={setView} onOpenChange={(w, kind) => { setMapCard(w); setMapCardKind(kind); }} />
      </section>

      {phone ? null : timeline}

      <CalendarDialog open={calFull && onPage} points={points} busy={stale} scale={scale} mode={monthMode}
        onClose={() => {
          setCalFull(false);
          // (opened from a link, nothing held the focus before it: the focus goes to the button that opens it again)
          requestAnimationFrame(() => {
            const at = document.activeElement;
            if (!at || at === document.body) document.querySelector<HTMLButtonElement>('.fh-ex-cal-expand')?.focus({ preventScroll: true });
          });
        }}
        selected={shownMonth} onSelect={(m) => choose(ymOf(m.yr, m.mo))} name={info.name} title={calTitle} />
    </div>
  );
}
