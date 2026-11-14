// The fire map: a MapLibre base map (dark or light with the theme) with deck.gl hexagons drawn inside it.
// The hexagons of a level never change (see explorer/mapData.ts), so going from month to month only changes their
// colours and heights, which glide; so does a change of colours (fire count, against normal, the trend of 2001 to
// 2025). Also here: the selected area (a soft glowing outline, the hexagons outside it dimmed), the drawing tools
// (rectangle: press and drag, or click or tap two corners; polygon: click points, then double click, Enter or Finish;
// Escape cancels; a shape that crosses itself is refused), a glass tooltip that keeps clear of the panels, 3D columns,
// the zoom buttons, the camera moves, and a little motion with meaning: a pulse where a hexagon is picked, a target
// frame where the camera lands, and the hexagons spreading out from the centre on the first load. Reduced motion turns
// all of it off. This module exports only its component (and types), so an edit here keeps React Fast Refresh and the
// Explorer stays mounted: the shapes and constants are in explorer/areaShape.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre finds its worker next to its own module. Vite pre-bundles that module elsewhere, so we hand it the
// worker file ourselves (a static asset: served as is in development, copied with a hash in the build).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { cellToLatLng, latLngToCell } from 'h3-js';
import { BASEMAP_STYLES } from '../lib/config';
import { blankStyle, exposeTransform, hexBeforeId, tuneStyle } from './explorer/basemap';
import { formatNumber, useI18n } from '../lib/i18n';
import { countClass, hexHeight, ratioClass, ringsBounds } from '../lib/stats';
import { useTheme } from '../lib/theme';
import type { MapMode, Scale } from '../lib/types';
import {
  MAP_COUNT_SCALES, MAP_HEIGHT, MAP_RATIO_LIMIT, loadFrame, loadTrend, loadUniverse, peekFrame, peekTrend, peekUniverse,
  prefetchAfter, type ExtraHex, type Frame, type Level, type TrendLayer, type Universe,
} from './explorer/mapData';
import { NOT_IN_FILE, NOT_TESTED, trendRampIndex } from './explorer/trend';
import { cellsAtLevel, crossesItself, ringCells } from './explorer/mapGeom';
import { justDismissed } from './explorer/MapControls';
import { MapTip, type MapTipHandle } from './explorer/MapTip';
import { afterPanelResize, panelResizing } from './explorer/panelSize';
import { ANOMALY_VARS, EMBER_VARS, cssRgb } from './Legend';
import { Tooltip } from './Tooltip';
import { IconActivity, IconMinus, IconPlus, IconTarget } from './icons';
import { emitCommand } from '../lib/commands';
import { hotspotDots, type GeoBox, type HotspotDot } from '../lib/hotspots';

maplibregl.setWorkerUrl(workerUrl);

import {
  DETAIL_ZOOM, WORLD_BOUNDS, cellsOfOutline, type Bounds, type DrawMode, type LonLat, type Padding, type ViewMode,
} from './explorer/areaShape';

// (the shapes and constants live in explorer/areaShape.ts: a module that exports only its component keeps Fast Refresh)
export type { AreaShape, Bounds, DrawMode, LonLat, Padding, ViewMode } from './explorer/areaShape';

// ------------------------------------------------------------------------------------------------------- map

export interface MapViewProps {
  ym: number | null;               // the month on the map (yyyymm)
  scale: Scale;
  mode: MapMode;
  view: ViewMode;
  outline: readonly LonLat[][] | null;
  focus: { key: string; bounds: Bounds } | null;   // the camera flies to these bounds whenever the key changes
  padding: Padding;                // room taken by the floating panels, kept clear when the camera moves
  drawMode: DrawMode;
  playing: boolean;
  stepMs: number;                  // time per month while playing (sets how long colours glide)
  previewing?: boolean;            // ym is a month the pointer rests on elsewhere (its colours show at once, no glide)
  lastYm: number | null;           // the latest known month (the player does not prefetch past it)
  onDrawComplete(ring: LonLat[]): void;
  onDrawCancel(): void;
  onHexClick?(h3: string, level: Level): void;
  onLevelChange?(level: Level): void;
  onCamera?(camera: { lat: number; lon: number; zoom: number }): void;   // where the map is, after each move
  onDots?(shown: boolean): void;                                         // the hotspots are drawn as dots (city zoom)
  // set by the map: slides the view by half of dx px, as a panel over its left side grows by dx (a drag of its edge)
  shiftRef?: { current: ((dx: number) => void) | null };
  label: string;
  children?: ReactNode;            // overlays, such as the map controls
}

interface Draft { points: LonLat[]; cursor: LonLat | null; placed: boolean }
const NO_DRAFT: Draft = { points: [], cursor: null, placed: false };
interface Shown { u: Universe; f: Frame }
interface Box { x: number; y: number; w: number; h: number }
/** The object under the pointer, drawn highlighted: its layer and its index in that layer. */
interface Hi { id: string; index: number }
type Status = 'loading' | 'detail' | 'trend' | 'idle' | 'error';
type RGB = [number, number, number];
type RGBA = [number, number, number, number];
const CLEAR: RGBA = [0, 0, 0, 0];

const rect = (a: LonLat, b: LonLat): LonLat[] => [a, [b[0], a[1]], b, [a[0], b[1]], a];
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const still = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = () => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
const levelOf = (zoom: number): Level => (zoom < DETAIL_ZOOM ? 3 : 4);
const FLIGHT_MS = 1500;
const REVEAL_MS = 900;
const FADE_MS = 220;
/** A hexagon's index in a universe, and in a month's extra hexagons (made once each, for picking on the CPU). */
const universeIndex = new WeakMap<Universe, Map<string, number>>();
function indexInUniverse(u: Universe): Map<string, number> {
  let m = universeIndex.get(u);
  if (!m) { m = new Map(u.h3.map((h, i) => [h, i])); universeIndex.set(u, m); }
  return m;
}
const extrasIndex = new WeakMap<Frame, Map<string, number>>();
function indexInExtras(f: Frame): Map<string, number> {
  let m = extrasIndex.get(f);
  if (!m) { m = new Map(f.extras.map((d, i) => [d.h3, i])); extrasIndex.set(f, m); }
  return m;
}
/** The object under the pointer, found on the CPU: its layer and index, its hexagon, and its place in the data. */
interface CpuHit { layer: string; index: number; h3: string; i: number | null; extra: ExtraHex | null }
/** The layers that answer the pointer (their object under it is highlighted). */
const HOVERABLE = /^(hex-[34]|hex-extra-[34]|hotspot-dots)$/;
/** 0..n-1 for a universe (the layer's data), made once per universe. */
const indexLists = new WeakMap<Universe, number[]>();
function indicesOf(u: Universe): number[] {
  let a = indexLists.get(u);
  if (!a) { a = Array.from({ length: u.h3.length }, (_, i) => i); indexLists.set(u, a); }
  return a;
}
const mixRgb = (a: RGB, b: RGB, k: number): RGB => [0, 1, 2].map((j) => Math.round(a[j] + (b[j] - a[j]) * k)) as RGB;

/** Distance between opposite edges of an average hexagon, in km (H3 edge lengths: 68.98 km at level 3, 26.07 at 4). */
const HEX_ACROSS_KM: Record<Level, number> = { 3: 68.98 * Math.sqrt(3), 4: 26.07 * Math.sqrt(3) };
/** How much of its cell a hexagon fills, so the gaps between them stay about 1.4 px on screen at any zoom (thin at
 *  the fine level, nearly none at world view, where a hexagon is a few pixels across). */
function coverageAt(level: Level, zoom: number, lat: number): number {
  const kmPerPx = (40075.016 * Math.cos((Math.max(-80, Math.min(80, lat)) * Math.PI) / 180)) / (512 * 2 ** zoom);
  const across = HEX_ACROSS_KM[level] / Math.max(kmPerPx, 1e-6);
  return Math.max(0.94, Math.min(0.997, 1 - 1.4 / across));
}

/** The padding when the map has room for it; shrunk to leave 40% of each side when it has not (a window resizing, the
 *  phone sheet gliding); null while the map has no size (the Explorer hidden), where a fit would only warn. */
function roomFor(map: maplibregl.Map, p: Padding): Padding | null {
  // (the canvas has the size the map works with: it follows the box a moment late while the window resizes)
  const c = map.getContainer(), cv = map.getCanvas();
  const W = Math.min(c.clientWidth, cv.clientWidth || c.clientWidth), H = Math.min(c.clientHeight, cv.clientHeight || c.clientHeight);
  if (!(W > 0 && H > 0)) return null;
  const kx = Math.min(1, (W * 0.6) / Math.max(1, p.left + p.right)), ky = Math.min(1, (H * 0.6) / Math.max(1, p.top + p.bottom));
  if (p.left + p.right < W - 2 && p.top + p.bottom < H - 2) return p;
  return { top: p.top * ky, right: p.right * kx, bottom: p.bottom * ky, left: p.left * kx };
}

/** Narrower than this, the map is a phone's: the world is framed on Africa and South America above the sheet. */
const PHONE_MAP_W = 768;
/** The box a phone's world view frames: South America and Africa, Lima to the Horn, Tunis to Cape Town. */
const PHONE_WORLD = { west: -82, east: 52, north: 37, south: -35 } as const;
const mercY = (lat: number) => maplibregl.MercatorCoordinate.fromLngLat([0, lat]).y;
/** The world on a phone: Africa and South America in the room the sheet and the top bar leave. As wide as the screen
 *  allows, and zoomed in just enough that the map still covers the whole screen with the box raised above the sheet
 *  (MapLibre keeps the poles off screen, so a smaller world would slide down under the sheet). */
function phoneWorld(map: maplibregl.Map, p: Padding): { center: maplibregl.LngLat; zoom: number } | null {
  const c = map.getContainer();
  const W = c.clientWidth, H = c.clientHeight;
  if (!(W > 0 && H > 0)) return null;
  const b = PHONE_WORLD;
  const yN = mercY(b.north), yS = mercY(b.south), yC = (yN + yS) / 2;
  const top = p.top, bottom = Math.max(top + 120, H - p.bottom);
  const at = (top + bottom) / 2;                                    // where the box's middle goes on screen
  const zW = Math.log2((W * 360) / (512 * (b.east - b.west)));       // the box's width fits the screen
  const zH = Math.log2(Math.max(60, bottom - top - 16) / (512 * (yS - yN)));   // its height fits the room
  const zCover = Math.log2(Math.max(at / yC, (H - at) / (1 - yC)) / 512);      // the world covers the screen
  // (the margins round the room may give a little, so the world can cover the screen)
  const zoom = Math.max(-1, Math.min(zH + 0.25, Math.max(zW, zCover)));
  const worldPx = 512 * 2 ** zoom;
  const lonC = (b.west + b.east) / 2;
  const x = maplibregl.MercatorCoordinate.fromLngLat([lonC, 0]).x;
  const centre = new maplibregl.MercatorCoordinate(x, Math.min(0.98, Math.max(0.02, yC - (at - H / 2) / worldPx))).toLngLat();
  return { center: centre, zoom };
}
const phoneMap = (map: maplibregl.Map) => map.getContainer().clientWidth < PHONE_MAP_W;

/** From this zoom the month's hotspots are drawn as dots, read for the box around the view. */
const DOTS_ZOOM = 8;
const DOTS_MAX = 50_000;
/** The colour step of a hotspot's fire radiative power on the upper six steps of the ember ramp (3..8, so even a weak
 *  fire stands out on the map), on a log scale from 1 to 300 MW. */
const frpStep = (frp: number) => 3 + Math.max(0, Math.min(5, Math.floor((Math.log10(Math.max(1, frp)) / Math.log10(300)) * 6)));
/** The box around the view the dots are read for: the view and half of it again on each side, rounded. */
function dotsBox(b: maplibregl.LngLatBounds): GeoBox {
  const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
  const dx = (e - w) / 2, dy = (n - s) / 2, r = (v: number) => Math.round(v * 20) / 20;
  return { west: r(w - dx), east: r(e + dx), south: r(Math.max(-85, s - dy)), north: r(Math.min(85, n + dy)) };
}
const boxInside = (a: GeoBox, b: GeoBox) => a.west >= b.west && a.east <= b.east && a.south >= b.south && a.north <= b.north;

/**
 * The layers with the object under the pointer highlighted. deck.gl's own highlight (autoHighlight) asks for a new
 * frame on every pick, and in interleaved mode a frame of deck.gl is a frame of the whole base map, so the map was
 * drawn again on every move of the pointer. Here a layer is copied with its highlight only when the object under the
 * pointer changes, and the map draws once for that.
 */
function withHighlight(layers: readonly Layer[], hi: Hi | null): Layer[] {
  return layers.map((l) => {
    if (!HOVERABLE.test(l.id)) return l;
    const want = hi && hi.id === l.id ? hi.index : -1;
    return (l.props.highlightedObjectIndex ?? -1) === want ? l : l.clone({ highlightedObjectIndex: want });
  });
}

export function MapView(props: MapViewProps) {
  const { t, lang } = useI18n();
  const theme = useTheme();
  const { ym, scale, mode, view, outline, drawMode, playing, stepMs, lastYm, previewing = false } = props;
  const box = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // the tooltip (its own component: the pointer moving re-renders nothing here), the highlighted object, and the
  // layers last given to deck.gl (copied with a new highlight when the object under the pointer changes)
  const tip = useRef<MapTipHandle>(null);
  const hi = useRef<Hi | null>(null);
  const layersRef = useRef<Layer[]>([]);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const pickClick = useRef<((info: PickingInfo) => void) | null>(null);   // what a click on the picked object does
  // on the flat map (no dots), the hexagon under the pointer is found on the CPU (its H3 cell), so moving the pointer
  // needs no picking pass on the graphics card and no read back from it; 3D columns and the hotspot dots keep deck.gl's
  // picking. cpuPick is set with the layers (null when deck.gl picks), cpuClick does what a click on a hexagon does.
  const cpuPick = useRef<((x: number, y: number) => CpuHit | null) | null>(null);
  const cpuClick = useRef<((hit: CpuHit, x: number, y: number) => void) | null>(null);
  const cpuHover = useRef(false);
  const cb = useRef(props);
  useLayoutEffect(() => { cb.current = props; });
  const [ready, setReady] = useState(false);
  const [level, setLevel] = useState<Level>(3);
  const [shown, setShown] = useState<Shown | null>(null);
  const [trend, setTrend] = useState<TrendLayer | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [draft, setDraft] = useState<Draft>(NO_DRAFT);
  const [drawError, setDrawError] = useState(false);
  // the hotspots as dots at city zoom: the view now (null when zoomed out), the dots loaded and the box they cover
  const [dotView, setDotView] = useState<GeoBox | null>(null);
  const [dots, setDots] = useState<{ ym: number; box: GeoBox; dots: HotspotDot[]; capped: boolean } | null>(null);
  const [dotsBusy, setDotsBusy] = useState(false);
  const [elev, setElev] = useState(view === '3d' ? 1 : 0);   // 0 flat .. 1 full height (animated)
  // how much of its cell each level's hexagons fill at the zoom on screen (in steps of 0.005, so a flight changes it a
  // few times, not every frame), and whether the map is zoomed in past the fine level's zoom
  const [camera, setCamera] = useState({ c3: 0.94, c4: 0.94, deep: false });
  const [pulse, setPulse] = useState<{ x: number; y: number; key: number } | null>(null);
  const [reticle, setReticle] = useState<(Box & { key: number }) | null>(null);
  const [reveal, setReveal] = useState<number | null>(null);  // 0..1 while the first hexagons spread out
  const [fade, setFade] = useState<{ from: Shown; k: number } | null>(null);   // the old level, fading out
  const [coarse] = useState(coarsePointer);
  // the map has the keyboard focus (from Tab): a ring around it and a hint of its keys
  const [keyFocus, setKeyFocus] = useState(false);
  const elevRef = useRef(elev);
  const shownLevel = useRef<Level | null>(null);
  const actions = useRef<{ finish(): void; undo(): void }>({ finish: () => undefined, undo: () => undefined });
  const themeAtStart = useRef(theme);
  const seq = useRef(0);
  const revealDelay = useRef<Float32Array | null>(null);
  const fillOf = useRef<((h3: string) => RGBA | null) | null>(null);   // for the test hook: the colour a hexagon has now
  const lastMonthMode = useRef<MapMode>(mode === 'trend' ? 'count' : mode);
  // the base map layer the hexagons go under (the first border or label layer of the current style)
  const [before, setBefore] = useState<string | undefined>(undefined);
  const styleTheme = useRef(theme);
  // the flight to a place under way (a switch to 3D or back keeps its destination); cleared when the user moves the map
  const flight = useRef<{ center: maplibregl.LngLatLike; zoom: number; until: number; bounds: Bounds } | null>(null);
  // the first view of the world, not yet moved by the user or a flight: on a phone it follows the sheet as it settles
  const untouched = useRef(true);

  // create the map once (StrictMode mounts twice: the cleanup removes the first map)
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    // a plain background first, then the base map with our colours (basemap.ts): clear borders and names on dark
    const map = new maplibregl.Map({
      container: el, style: blankStyle(themeAtStart.current), bounds: WORLD_BOUNDS, fitBoundsOptions: { padding: 8 },
      attributionControl: { compact: true, customAttribution: 'Hotspots: NASA FIRMS' },
      dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 60,
      // (the Explorer fills the screen and does not scroll, so one finger moves the map, as on any map app)
      cooperativeGestures: false, maxZoom: 9, renderWorldCopies: true,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.setStyle(BASEMAP_STYLES[themeAtStart.current], { transformStyle: (_prev, next) => tuneStyle(themeAtStart.current, next) });
    // interleaved: the hexagons are drawn inside the map, under its borders and names (hexBeforeId), not on top of them
    exposeTransform(map);
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    map.addControl(overlay);
    map.on('style.load', () => setBefore(hexBeforeId(map.getStyle())));
    // a click on a hexagon is picked here, on MapLibre's click (a press without a drag, however long it lasts), not on
    // deck.gl's own tap, which gives up when a press lasts over 250 ms: a slow picking pass on a weak GPU is enough.
    // A click that only closed a map card does not pick.
    map.on('click', (e) => {
      if (cb.current.drawMode !== 'none' || justDismissed()) return;
      const cpu = cpuPick.current;
      if (cpu) {
        const hit = cpu(e.point.x, e.point.y);
        if (hit) cpuClick.current?.(hit, e.point.x, e.point.y);
        return;
      }
      if (!pickClick.current) return;
      const info = overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 2 });
      if (info) pickClick.current(info);
    });
    // the pointer over the flat map: the hexagon under it once a frame, from its H3 cell (cpuPick); none while a
    // button is down (the map is being dragged)
    let hoverRaf = 0;
    let hoverAt: { x: number; y: number } | null = null;
    const hoverFrame = () => {
      hoverRaf = 0;
      const pick = cpuPick.current, at = hoverAt;
      if (!pick || !at) return;
      const hit = cb.current.drawMode === 'none' ? pick(at.x, at.y) : null;
      cpuHover.current = !!hit;
      if (hit) { tip.current?.hex(at.x, at.y, hit.h3, hit.i, hit.extra); setHiRef.current({ id: hit.layer, index: hit.index }); }
      else { tip.current?.clear(); setHiRef.current(null); }
    };
    map.on('mousemove', (e) => {
      if (!cpuPick.current) return;
      if (e.originalEvent.buttons) { hoverAt = null; return; }
      hoverAt = { x: e.point.x, y: e.point.y };
      if (!hoverRaf) hoverRaf = requestAnimationFrame(hoverFrame);
    });
    map.on('mouseout', () => { hoverAt = null; cpuHover.current = false; });
    // during a zoom only the coarse level follows (13,000 hexagons: cheap to reshape); the fine level (69,000) is
    // reshaped once the zoom ends, so a zoom never stutters
    const onCamera = (moving: boolean) => {
      const z = map.getZoom(), lat = map.getCenter().lat;
      const step = (c: number) => Math.round(c * 200) / 200;
      setCamera((prev) => {
        const next = { c3: step(coverageAt(3, z, lat)), c4: moving ? prev.c4 : step(coverageAt(4, z, lat)), deep: z >= DETAIL_ZOOM };
        return prev.c3 === next.c3 && prev.c4 === next.c4 && prev.deep === next.deep ? prev : next;
      });
    };
    const onMoved = () => {
      // (the map slides with a panel's edge being dragged: it tells where it is once, when the drag ends)
      if (panelResizing()) return;
      const next = levelOf(map.getZoom());
      setLevel((prev) => (prev === next ? prev : next));
      onCamera(false);
      // (the middle of the part of the map the panels leave free: what the reader looks at)
      const el2 = map.getContainer(), p = cb.current.padding, z = map.getZoom();
      const fx = (p.left + el2.clientWidth - p.right) / 2, fy = (p.top + el2.clientHeight - p.bottom) / 2;
      const c = fx > 0 && fy > 0 ? map.unproject([fx, fy]) : map.getCenter();
      cb.current.onCamera?.({ lat: c.lat, lon: c.lng, zoom: z });
      const view = z >= DOTS_ZOOM - 1e-6 ? map.getBounds() : null;
      setDotView(view ? { west: view.getWest(), east: view.getEast(), south: view.getSouth(), north: view.getNorth() } : null);
    };
    let camRaf = 0;
    map.on('zoom', () => { if (!camRaf) camRaf = requestAnimationFrame(() => { camRaf = 0; onCamera(true); }); });
    map.on('zoomend', onMoved);
    map.on('moveend', onMoved);
    map.on('movestart', (e: { originalEvent?: unknown }) => { if (e.originalEvent) { flight.current = null; setReticle(null); untouched.current = false; } });
    // the first view: the whole world in the room the panels leave (on a phone: Africa and South America above the
    // sheet); the attribution starts folded
    const first = roomFor(map, cb.current.padding);
    const phoneFirst = first && phoneMap(map) ? phoneWorld(map, first) : null;
    if (phoneFirst) map.jumpTo(phoneFirst);
    else if (first) map.fitBounds(WORLD_BOUNDS, { padding: first, duration: 0 });
    map.once('load', () => {
      el.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    });
    // the base map styles name a few icons they do not ship: give them an empty picture instead of a warning
    map.setMissingStyleImageResolver((id) => {
      if (!map.hasImage(id)) map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el);
    const canvasEl = map.getCanvas();
    const onFocus = () => setKeyFocus(canvasEl.matches(':focus-visible'));
    const onBlur = () => setKeyFocus(false);
    canvasEl.addEventListener('focus', onFocus);
    canvasEl.addEventListener('blur', onBlur);
    mapRef.current = map;
    overlayRef.current = overlay;
    const shift = cb.current.shiftRef;
    if (shift) shift.current = (dx: number) => { if (dx) map.panBy([-dx / 2, 0], { duration: 0 }); };
    const offResize = afterPanelResize(onMoved);
    onMoved();
    setReady(true);
    return () => {
      offResize();
      if (shift) shift.current = null;
      ro.disconnect();
      canvasEl.removeEventListener('focus', onFocus);
      canvasEl.removeEventListener('blur', onBlur);
      cancelAnimationFrame(camRaf);
      cancelAnimationFrame(hoverRaf);
      overlayRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => { cb.current.onLevelChange?.(level); }, [level]);

  // the base map follows the theme (the hexagons live on their own canvas, so they stay)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleTheme.current === theme) return;
    styleTheme.current = theme;
    map.setStyle(BASEMAP_STYLES[theme], { transformStyle: (_prev, next) => tuneStyle(theme, next) });
  }, [theme, ready]);

  // the month on the map (and, for the trend colours, the level's trend file): keep the last frame on screen until
  // the next one is loaded (no flicker)
  const wantTrend = mode === 'trend';
  useEffect(() => { shownLevel.current = shown?.u.level ?? null; }, [shown]);
  useEffect(() => {
    if (ym === null) return undefined;
    let alive = true;
    const u = peekUniverse(level), f = peekFrame(level, ym), tr = wantTrend ? peekTrend(level) : null;
    if (u && f && (!wantTrend || tr)) {
      setShown((prev) => (prev?.f === f ? prev : { u, f }));
      if (tr) setTrend(tr);
      setStatus('idle');
    } else {
      setStatus(shownLevel.current !== null && shownLevel.current !== level ? 'detail' : wantTrend && u && f ? 'trend' : 'loading');
      Promise.all([loadUniverse(level), loadFrame(level, ym, !playing), wantTrend ? loadTrend(level) : null]).then(([u2, f2, tr2]) => {
        if (!alive) return;
        setShown((prev) => (prev?.f === f2 ? prev : { u: u2, f: f2 }));
        if (tr2) setTrend(tr2);
        setStatus('idle');
      }, () => { if (alive) setStatus('error'); });
    }
    // what comes next: the following months while playing, the rest of the block otherwise
    const next = window.setTimeout(() => {
      if (playing && lastYm !== null) prefetchAfter(level, ym, lastYm, 3);
      else void loadFrame(level, ym).catch(() => undefined);
    }, playing ? 0 : 500);
    return () => { alive = false; window.clearTimeout(next); };
  }, [level, ym, playing, lastYm, wantTrend]);

  // the colours actually drawn: the trend only once its file for the level on screen is in (until then the month's
  // colours stay, so nothing flickers)
  const trendOn = wantTrend && !!shown && !!trend && trend.level === shown.u.level;
  if (mode !== 'trend') lastMonthMode.current = mode;
  const paint: MapMode = trendOn ? 'trend' : mode === 'trend' ? lastMonthMode.current : mode;

  // the old level fades out under the new one (a short cross fade instead of a swap)
  const prevShown = useRef<Shown | null>(null);
  useEffect(() => {
    const prev = prevShown.current;
    prevShown.current = shown;
    if (!prev || !shown || prev.u.level === shown.u.level || still()) return undefined;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - t0) / FADE_MS));
      setFade(k >= 1 ? null : { from: prev, k });
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    setFade({ from: prev, k: 0 });
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); setFade(null); };
  }, [shown]);

  // the first hexagons spread out from the centre of the view (once)
  const revealed = useRef(false);
  useEffect(() => {
    const map = mapRef.current, el = box.current;
    if (!shown || revealed.current || !map || !el) return undefined;
    revealed.current = true;
    const u = shown.u;
    if (still() || u.h3.length > 30_000) return undefined;
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2, far = Math.hypot(cx, cy) || 1;
    const d = new Float32Array(u.h3.length);
    for (let i = 0; i < u.h3.length; i++) {
      const [lat, lon] = cellToLatLng(u.h3[i]);
      const p = map.project([lon, lat]);
      d[i] = Math.min(1, Math.hypot(p.x - cx, p.y - cy) / far);
    }
    revealDelay.current = d;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - t0) / REVEAL_MS));
      setReveal(k >= 1 ? null : k);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    setReveal(0);
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); setReveal(null); };
  }, [shown]);

  // fly to the selected place, then frame it for a moment
  const focusKey = props.focus?.key ?? '';
  useEffect(() => {
    const map = mapRef.current;
    const f = cb.current.focus;
    if (!map || !f) return undefined;
    const room = roomFor(map, cb.current.padding);
    untouched.current = false;
    const world = room && f.bounds === WORLD_BOUNDS && phoneMap(map) ? phoneWorld(map, room) : null;
    const cam = world ?? (room ? map.cameraForBounds(f.bounds, { padding: room, maxZoom: 7 }) : undefined);
    if (!cam?.center) return undefined;
    const three = cb.current.view === '3d';
    const target = { center: cam.center, zoom: world ? world.zoom : Math.max(0.6, cam.zoom ?? 2), pitch: three ? 45 : 0, bearing: three ? -12 : 0 };
    setReticle(null);
    if (still()) { flight.current = null; map.jumpTo(target); return undefined; }
    const mine = { center: target.center, zoom: target.zoom, until: performance.now() + FLIGHT_MS, bounds: f.bounds };
    flight.current = mine;
    map.flyTo({ ...target, duration: FLIGHT_MS, curve: 1.3, essential: false });
    const landed = () => {
      if (flight.current !== mine || f.bounds === WORLD_BOUNDS) return;
      const el = box.current;
      const pts = [f.bounds[0], [f.bounds[1][0], f.bounds[0][1]], f.bounds[1], [f.bounds[0][0], f.bounds[1][1]]]
        .map((p) => map.project(p as LonLat));
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      let x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
      if (!el || w > el.clientWidth * 0.9 || h > el.clientHeight * 0.9) return;
      if (w < 56) { x -= (56 - w) / 2; w = 56; }
      if (h < 56) { y -= (56 - h) / 2; h = 56; }
      setReticle({ x: x - 10, y: y - 10, w: w + 20, h: h + 20, key: ++seq.current });
    };
    map.once('moveend', landed);
    return () => { map.off('moveend', landed); };
  }, [focusKey, ready]);
  useEffect(() => {
    if (!reticle) return undefined;
    const id = window.setTimeout(() => setReticle(null), 1700);
    return () => window.clearTimeout(id);
  }, [reticle]);
  useEffect(() => {
    if (!pulse) return undefined;
    const id = window.setTimeout(() => setPulse(null), 900);
    return () => window.clearTimeout(id);
  }, [pulse]);

  // when a panel or card takes more room (the map settings open, the timeline grows), keep the selected area clear of
  // it: if the area was in full view and the new margins cut into it, the camera eases to fit it again
  const pad = props.padding;
  const padKey = `${pad.top},${pad.right},${pad.bottom},${pad.left}`;
  const lastPad = useRef(pad);
  useEffect(() => {
    const map = mapRef.current, el = box.current;
    const old = lastPad.current;
    lastPad.current = cb.current.padding;
    // the first view of the world on a phone follows the sheet until the user moves the map
    if (map && untouched.current && !cb.current.outline && phoneMap(map) && !map.isMoving()) {
      const room = roomFor(map, cb.current.padding);
      const cam = room ? phoneWorld(map, room) : null;
      if (cam) map.jumpTo(cam);
      return;
    }
    const rings = cb.current.outline;
    if (!map || !el || !rings || !rings.length || map.isMoving() || cb.current.drawMode !== 'none') return;
    const b = ringsBounds(rings);
    if (!b) return;
    const pts = [b[0], [b[1][0], b[0][1]], b[1], [b[0][0], b[1][1]]].map((p) => map.project(p as LonLat));
    const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
    const W = el.clientWidth, H = el.clientHeight;
    // (the area counts as in view with some slack: the camera fits the main pieces, the outline may reach a bit further)
    const inside = (p: Padding, slack: number) => x0 >= p.left - slack && x1 <= W - p.right + slack && y0 >= p.top - slack && y1 <= H - p.bottom + slack;
    const now = cb.current.padding;
    if (!inside(old, 40) || inside(now, 1)) return;
    const room = roomFor(map, now);
    const cam = room ? map.cameraForBounds(b, { padding: room, maxZoom: Math.max(map.getZoom(), 2) }) : undefined;
    if (!cam?.center) return;
    map.easeTo({ center: cam.center, zoom: Math.min(map.getZoom(), cam.zoom ?? map.getZoom()), duration: still() ? 0 : 360 });
  }, [padKey]);

  // 2D or 3D: the camera tilts and the columns rise (or the other way round)
  useEffect(() => { elevRef.current = elev; }, [elev]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const three = view === '3d';
    if (three) { map.dragRotate.enable(); map.touchZoomRotate.enableRotation(); map.touchPitch.enable(); }
    else { map.dragRotate.disable(); map.touchZoomRotate.disableRotation(); map.touchPitch.disable(); }
    const ms = still() ? 0 : 1000;
    const pitch = three ? 45 : 0, bearing = three ? -12 : 0;
    const f = flight.current, now = performance.now();
    if (f && now < f.until && map.isMoving()) {
      // the camera is on its way to a place: keep going there, with the new tilt
      map.flyTo({ center: f.center, zoom: f.zoom, pitch, bearing, duration: Math.max(700, f.until - now), curve: 1.3, essential: false });
    } else if (Math.abs(map.getPitch() - pitch) > 0.5 || Math.abs(map.getBearing() - bearing) > 0.5) {
      map.easeTo({ pitch, bearing, duration: ms });
    }
    const from = elevRef.current, to = three ? 1 : 0;
    if (ms === 0 || from === to) { setElev(to); return undefined; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now2: number) => {
      const k = Math.min(1, Math.max(0, (now2 - t0) / ms));
      const e = 1 - Math.pow(1 - k, 3);
      setElev(from + (to - from) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [view, ready]);

  // drawing
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    let pts: LonLat[] = [];
    let cursor: LonLat | null = null;
    let state: 'idle' | 'down' | 'placed' | 'down2' = 'idle';
    let startPx: { x: number; y: number } | null = null;
    let lastDown = 0;
    setDraft(NO_DRAFT);
    setDrawError(false);
    if (drawMode === 'none') return undefined;
    tip.current?.clear();
    // a drawing tool picked below the map (phones stack the panel under it): bring the map into view first
    const el = wrap.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const head = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fh-header-h')) || 56;
      if (r.top < head - 1 || r.bottom > window.innerHeight + 1) {
        window.scrollBy({ top: r.top - head - 8, behavior: still() ? 'auto' : 'smooth' });
      }
    }
    const show = () => setDraft({ points: [...pts], cursor, placed: state === 'placed' });
    const reset = () => { state = 'idle'; pts = []; cursor = null; startPx = null; setDraft(NO_DRAFT); setDrawError(false); };
    const ll = (e: maplibregl.MapMouseEvent): LonLat => [e.lngLat.lng, e.lngLat.lat];
    const finishRect = (b: LonLat, bPx: { x: number; y: number }) => {
      const a = pts[0], aPx = startPx;
      reset();
      if (a && aPx && Math.abs(bPx.x - aPx.x) > 4 && Math.abs(bPx.y - aPx.y) > 4) cb.current.onDrawComplete(rect(a, b));
    };
    const finishPolygon = () => {
      const clean: LonLat[] = [];
      for (const p of pts) {
        const last = clean[clean.length - 1];
        if (!last || dist(map.project(last), map.project(p)) > 3) clean.push(p);   // the clicks of a double click
      }
      if (clean.length < 3) return;
      // a bow tie has no meaningful area (its halves cancel out): refuse it and say why
      if (crossesItself(clean)) { pts = clean; setDrawError(true); show(); return; }
      reset();
      cb.current.onDrawComplete([...clean, clean[0]]);
    };
    const undo = () => { pts.pop(); setDrawError(false); show(); };
    actions.current = { finish: finishPolygon, undo };

    map.doubleClickZoom.disable();
    if (drawMode === 'rectangle') map.dragPan.disable();

    // (a press that only closed a map card places no point)
    const onDown = (e: maplibregl.MapMouseEvent) => {
      if (e.originalEvent.button !== 0 || justDismissed()) return;
      lastDown = performance.now();
      if (drawMode !== 'rectangle') return;
      if (state === 'idle') { state = 'down'; pts = [ll(e)]; startPx = e.point; cursor = ll(e); show(); }
      else if (state === 'placed') state = 'down2';
    };
    const onMove = (e: maplibregl.MapMouseEvent) => {
      cursor = ll(e);
      if ((drawMode === 'rectangle' && state !== 'idle') || (drawMode === 'polygon' && pts.length)) show();
    };
    const onUp = (e: maplibregl.MapMouseEvent) => {
      if (drawMode !== 'rectangle') return;
      if (state === 'down') {
        if (startPx && dist(e.point, startPx) > 6) finishRect(ll(e), e.point);
        else { state = 'placed'; show(); }
      } else if (state === 'down2') finishRect(ll(e), e.point);
    };
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (justDismissed()) return;
      const viaMouse = performance.now() - lastDown < 700;   // a click after our own mousedown and mouseup
      if (drawMode === 'rectangle') {
        if (viaMouse) return;
        if (state === 'idle') { state = 'placed'; pts = [ll(e)]; startPx = e.point; cursor = ll(e); show(); }
        else if (state === 'placed') finishRect(ll(e), e.point);
        return;
      }
      if (pts.length >= 3 && dist(map.project(pts[0]), e.point) < 10) { finishPolygon(); return; }
      pts.push(ll(e));
      cursor = ll(e);
      setDrawError(false);
      show();
    };
    const onDbl = (e: maplibregl.MapMouseEvent) => {
      if (drawMode !== 'polygon') return;
      e.preventDefault();
      finishPolygon();
    };
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
      // (an Escape that closed a map card first only closes the card)
      if (e.key === 'Escape') { if (!e.defaultPrevented) { reset(); cb.current.onDrawCancel(); } return; }
      if (drawMode !== 'polygon' || typing) return;
      if (e.key === 'Backspace' && pts.length) { e.preventDefault(); undo(); }
      else if (e.key === 'Enter' && pts.length >= 3 && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); finishPolygon(); }
    };
    map.on('mousedown', onDown);
    map.on('mousemove', onMove);
    map.on('mouseup', onUp);
    map.on('click', onClick);
    map.on('dblclick', onDbl);
    window.addEventListener('keydown', onKey);
    return () => {
      map.off('mousedown', onDown);
      map.off('mousemove', onMove);
      map.off('mouseup', onUp);
      map.off('click', onClick);
      map.off('dblclick', onDbl);
      window.removeEventListener('keydown', onKey);
      map.dragPan.enable();
      map.doubleClickZoom.enable();
      actions.current = { finish: () => undefined, undo: () => undefined };
    };
  }, [drawMode, ready]);

  // colours from the theme (CSS variables), read again when the theme changes
  const palette = useMemo(() => {
    const alpha = 236;
    const dark = theme === 'dark';
    const zero = cssRgb('--anom-0'), quiet = cssRgb('--text-3');
    return {
      ember: EMBER_VARS.map((v): RGBA => [...cssRgb(v), alpha]),
      anom: ANOMALY_VARS.map((v): RGBA => [...cssRgb(v), alpha]),
      // the trend's ramp: the anomaly steps, with a brighter first step each way on the dark map, so a small clear
      // trend never reads as no trend (the same mixes as --ex-trend-b1 and --ex-trend-r1 in explorer.css)
      trend: ANOMALY_VARS.map((v, k): RGBA => {
        const c = cssRgb(v);
        if (dark && (k === 3 || k === 5)) return [...mixRgb(c, cssRgb(ANOMALY_VARS[k === 3 ? 2 : 6]), 0.6), alpha];
        return [...c, alpha];
      }),
      zero,
      // the trend's quiet classes: tested without a clear trend (a calm grey), and too little fire to test (a ghost)
      // (the same mixes as --ex-trend-flat and --ex-trend-ghost in explorer.css, for the legend)
      flat: [...mixRgb(zero, quiet, dark ? 0.24 : 0.45), 225] as RGBA,
      ghost: [...quiet, dark ? 44 : 33] as RGBA,
      dim: dark ? 0.35 : 0.45,          // alpha of the hexagons outside the selected area
      ink: cssRgb('--text'), bg: cssRgb('--bg'), accent: cssRgb('--accent'),
      highlight: (dark ? [255, 255, 255, 90] : [11, 11, 11, 70]) as RGBA,
      glow: dark ? [70, 130] : [60, 110],   // alpha of the selection's outer and inner glow
    };
  }, [theme]);

  const draftPath = useMemo((): LonLat[] | null => {
    if (drawMode === 'rectangle' && draft.points[0] && draft.cursor) return rect(draft.points[0], draft.cursor);
    if (drawMode === 'polygon' && draft.points.length) return draft.cursor ? [...draft.points, draft.cursor] : draft.points;
    return null;
  }, [drawMode, draft]);

  const universe = shown?.u ?? null;

  // the map hexagons of the selected area: they stay bright, the others dim (from the outline's own hexagons for a
  // named place, else from the drawn shape, as the area's numbers are counted)
  const insideSet = useMemo((): Set<string> | null => {
    if (!outline || !outline.length || !universe) return null;
    const lvl = universe.level;
    const cells = cellsOfOutline(outline);
    if (cells) return cellsAtLevel(cells, lvl);
    const out = new Set<string>();
    for (const ring of outline) for (const c of ringCells(ring, lvl)) out.add(c);
    return out;
  }, [outline, universe]);
  const insideFlags = useMemo(() => (universe && insideSet
    ? Uint8Array.from(universe.h3, (h) => (insideSet.has(h) ? 1 : 0)) : null), [universe, insideSet]);
  const trendHere = trendOn && trend && universe && trend.level === universe.level ? trend : null;

  // the month's hotspots as dots at city zoom (not while playing, nor on the trend map): read again when the view
  // leaves the box they were read for, or the month changes; nothing is read when zoomed out
  const dotsWanted = dotView !== null && ym !== null && !playing && mode !== 'trend' && drawMode === 'none';
  const dotsKey = useRef('');
  useEffect(() => {
    if (!dotsWanted || !dotView || ym === null) { dotsKey.current = ''; setDotsBusy(false); return undefined; }
    if (dots && dots.ym === ym && boxInside(dotView, dots.box)) return undefined;
    const map = mapRef.current;
    if (!map) return undefined;
    const box = dotsBox(map.getBounds());
    const key = `${ym}:${box.west},${box.south},${box.east},${box.north}`;
    if (dotsKey.current === key) return undefined;
    let alive = true;
    const id = window.setTimeout(() => {
      dotsKey.current = key;
      setDotsBusy(true);
      hotspotDots(box, ym, DOTS_MAX).then((r) => {
        if (!alive) return;
        setDots({ ym, box, dots: r.dots, capped: r.capped });
        setDotsBusy(false);
      }, () => { if (alive) { dotsKey.current = ''; setDotsBusy(false); } });
    }, 250);
    return () => { alive = false; window.clearTimeout(id); };
  }, [dotsWanted, dotView, ym, dots]);
  const dotsOn = dotsWanted && !!dots && dots.ym === ym;
  useEffect(() => { cb.current.onDots?.(dotsWanted); }, [dotsWanted]);
  useEffect(() => { if (!dotsOn) tip.current?.clear(); }, [dotsOn]);

  // the object under the pointer, highlighted: the layers are given again only when it changes (withHighlight)
  const setHi = (next: Hi | null) => {
    const cur = hi.current;
    if ((cur?.id ?? null) === (next?.id ?? null) && (cur?.index ?? -1) === (next?.index ?? -1)) return;
    hi.current = next;
    const overlay = overlayRef.current;
    if (!overlay || !layersRef.current.length) return;
    layersRef.current = withHighlight(layersRef.current, next);
    overlay.setProps({ layers: layersRef.current });
  };
  const setHiRef = useRef(setHi);
  setHiRef.current = setHi;
  const leaveMap = () => { tip.current?.clear(); setHi(null); };

  // the layers
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const layers: Layer[] = [];
    const drafting = drawMode !== 'none';
    const glide = playing ? Math.min(420, Math.round(stepMs * 0.7)) : 260;
    // colours glide on the flat map; in 3D only the heights glide (deck.gl's colour transition breaks on extruded layers).
    // A month previewed by the pointer (resting on a month of the timeline, a chart or the calendar) shows at once: a
    // glide reads the hexagons' colours back from the graphics card when it starts and draws the whole map for 260 ms
    const flat = view === '2d' && elev < 0.001;
    const transitions = still() || reveal !== null || previewing ? undefined
      : flat ? { getFillColor: { duration: glide } } : { getElevation: { duration: glide } };
    // (deck.gl picks once a frame: the tooltip moves by its transform and is drawn again only for a new hexagon)
    const onHoverHex = (info: PickingInfo, h3: string | null, i: number | null, extra: ExtraHex | null) => {
      if (!h3 || cb.current.drawMode !== 'none' || info.index < 0) { tip.current?.clear(); setHiRef.current(null); return; }
      tip.current?.hex(info.x, info.y, h3, i, extra);
      setHiRef.current(info.layer ? { id: info.layer.id, index: info.index } : null);
    };
    const clickHex = (h3: string, lvl: Level, x: number, y: number) => {
      if (cb.current.drawMode !== 'none') return;
      tip.current?.clear();
      if (!still()) setPulse({ x, y, key: ++seq.current });
      cb.current.onHexClick?.(h3, lvl);
    };
    pickClick.current = null;
    // the flat map without the hotspot dots: the pointer is answered on the CPU (cpuPick), deck.gl does not pick
    const cpuMode = flat && !dotsOn && !drafting;
    const deckPicks = !cpuMode && !drafting;
    const wasCpu = cpuPick.current !== null;
    cpuPick.current = null;
    cpuClick.current = null;
    if (wasCpu !== cpuMode) { cpuHover.current = false; tip.current?.clear(); hi.current = null; }
    const dimOf = (c: RGBA): RGBA => (c[3] === 0 ? c : [...mixRgb([c[0], c[1], c[2]], palette.zero, 0.5), Math.round(c[3] * palette.dim)] as RGBA);
    /** The colour of a hexagon from its values (any level), before the selection and the reveal. */
    const baseColour = (s: Shown, tr: TrendLayer | null, i: number | null, v: number, hv: number, normal: number): RGBA => {
      if (paint === 'trend') {
        if (!tr || i === null) return CLEAR;
        const c = tr.cls[i];
        if (c === NOT_IN_FILE) return CLEAR;
        if (c === NOT_TESTED) return palette.ghost;
        const k = trendRampIndex(c);
        return k === null ? palette.flat : palette.trend[k];
      }
      if (paint === 'count') {
        const k = countClass(v, MAP_COUNT_SCALES[s.u.level][scale]);
        return k < 0 ? CLEAR : palette.ember[k];
      }
      if (!(normal > 0) && !(hv > 0)) return CLEAR;
      const k = ratioClass(hv, normal, MAP_RATIO_LIMIT);
      return k === null ? CLEAR : palette.anom[k];
    };
    const extruded = elev > 0.001;
    const under = (before ? { beforeId: before } : {}) as object;   // deck.gl reads beforeId in interleaved mode
    const hexLayer = (s: Shown, tr: TrendLayer | null, id: string, opts: { live: boolean; opacity: number }) => {
      const { u, f } = s;
      const lvl = u.level;
      const hgt = MAP_HEIGHT[lvl];
      const cap = hgt.cap[scale];
      // the coarse level standing in while the fine one loads (zoomed in): columns as tall as the fine ones will be
      const metres = lvl === 3 && camera.deep ? MAP_HEIGHT[4].metres : hgt.metres;
      const vals = scale === 'modis' ? f.modis : scale === 'raw' ? f.raw : f.h;
      const normals = u.normals[(f.ym % 100) - 1];
      const flags = opts.live ? insideFlags : null;
      const delays = opts.live && reveal !== null ? revealDelay.current : null;
      const yearly = (i: number) => {
        const r = tr ? tr.rows[i] : -1;
        return r >= 0 ? (tr?.file.mean[r] ?? 0) : 0;
      };
      return new H3HexagonLayer<number>({
        id, data: indicesOf(u), getHexagon: (i) => u.h3[i], ...under,
        getFillColor: (i) => {
          let c = baseColour(s, tr, i, vals[i], f.h[i], normals[i]);
          if (flags && !flags[i]) c = dimOf(c);
          if (delays && reveal !== null && c[3] > 0) {
            const k = Math.max(0, Math.min(1, (reveal - delays[i] * 0.55) / 0.45));
            c = [c[0], c[1], c[2], Math.round(c[3] * k * k * (3 - 2 * k))];
          }
          return c;
        },
        getElevation: (i) => (paint === 'trend' ? hexHeight(yearly(i), cap * 6, metres) : hexHeight(vals[i], cap, metres)),
        updateTriggers: {
          getFillColor: [f.level, f.ym, paint, scale, theme, tr?.level ?? 0, flags, reveal],
          getElevation: [f.level, f.ym, scale, paint, metres],
        },
        onHover: opts.live ? (info: PickingInfo<number>) => onHoverHex(info, u.h3[info.index] ?? null, info.index, null) : undefined,
        transitions: opts.live ? transitions : undefined,
        extruded, elevationScale: Math.max(elev, 0.001), stroked: false, highPrecision: 'auto' as const,
        coverage: lvl === 3 ? camera.c3 : camera.c4, opacity: opts.opacity * (dotsOn ? 0.4 : 1),
        // (highlightedObjectIndex keeps the picking colours on the card while the CPU answers the pointer)
        pickable: opts.live && deckPicks, autoHighlight: false, highlightColor: palette.highlight, highlightedObjectIndex: -1,
        // soft light: the tops keep (about) the colours of the legend, the sides are darker so the columns read in 3D
        material: { ambient: 0.6, diffuse: 0.42, shininess: 0, specularColor: [0, 0, 0] as RGB },
      });
    };
    if (fade && fade.from.u.level !== shown?.u.level) {
      const old = fade.from;
      layers.push(hexLayer(old, paint === 'trend' ? peekTrend(old.u.level) : null, `hex-out-${old.u.level}`, { live: false, opacity: 1 }));
    }
    if (shown) {
      const { u, f } = shown;
      const lvl = u.level;
      // (one layer of extra hexagons for every month: a new layer each month built new shaders on every month shown)
      const mainId = `hex-${lvl}`, extraId = `hex-extra-${lvl}`;
      pickClick.current = (info) => {
        if (info.layer?.id === mainId && info.index >= 0) clickHex(u.h3[info.index], lvl, info.x, info.y);
        else if (info.layer?.id === extraId && info.object) clickHex((info.object as ExtraHex).h3, lvl, info.x, info.y);
      };
      const live = hexLayer(shown, trendHere, mainId, { live: true, opacity: fade ? fade.k : 1 });
      layers.push(live);
      const getFill = live.props.getFillColor as (i: number) => RGBA;
      fillOf.current = (h3) => { const i = u.h3.indexOf(h3); return i < 0 ? null : getFill(i); };
      const extrasOn = f.extras.length > 0 && paint !== 'trend';
      if (cpuMode) {
        const map = mapRef.current;
        cpuPick.current = (x, y) => {
          if (!map) return null;
          const ll = map.unproject([x, y]);
          const lng = ((((ll.lng + 180) % 360) + 360) % 360) - 180;
          const h3 = latLngToCell(Math.max(-89.9, Math.min(89.9, ll.lat)), lng, lvl);
          const i = indexInUniverse(u).get(h3);
          if (i !== undefined) return { layer: mainId, index: i, h3, i, extra: null };
          const j = extrasOn ? indexInExtras(f).get(h3) : undefined;
          return j !== undefined ? { layer: extraId, index: j, h3, i: null, extra: f.extras[j] } : null;
        };
        cpuClick.current = (hit, x, y) => clickHex(hit.h3, lvl, x, y);
      }
      if (extrasOn) {
        const hgt = MAP_HEIGHT[lvl];
        const valOf = (d: ExtraHex) => (scale === 'modis' ? d.modis : scale === 'raw' ? d.raw : d.h);
        layers.push(new H3HexagonLayer<ExtraHex>({
          id: extraId, data: f.extras, getHexagon: (d) => d.h3, ...under,
          getFillColor: (d) => {
            const c = baseColour(shown, null, null, valOf(d), d.h, 0);
            return insideSet && !insideSet.has(d.h3) ? dimOf(c) : c;
          },
          getElevation: (d) => hexHeight(valOf(d), hgt.cap[scale], hgt.metres),
          updateTriggers: { getFillColor: [f.ym, paint, scale, theme, insideSet], getElevation: [scale] },
          onHover: (info: PickingInfo<ExtraHex>) => onHoverHex(info, info.object?.h3 ?? null, null, info.object ?? null),
          extruded, elevationScale: Math.max(elev, 0.001), stroked: false, highPrecision: 'auto' as const,
          coverage: lvl === 3 ? camera.c3 : camera.c4, pickable: deckPicks, autoHighlight: false, highlightColor: palette.highlight,
          highlightedObjectIndex: -1, material: { ambient: 0.6, diffuse: 0.42, shininess: 0, specularColor: [0, 0, 0] as RGB },
        }));
      }
    }
    if (dotsOn && dots) {
      // one dot per counted hotspot, about 200 m across, coloured by its fire radiative power; under the borders and names
      layers.push(new ScatterplotLayer<HotspotDot>({
        id: 'hotspot-dots', data: dots.dots, getPosition: (d) => [d.lon, d.lat], getRadius: 200, radiusUnits: 'meters',
        radiusMinPixels: 2.2, radiusMaxPixels: 14, getFillColor: (d) => palette.ember[frpStep(d.frp)],
        stroked: true, getLineColor: [...palette.bg, 160] as RGBA, lineWidthUnits: 'pixels', getLineWidth: 0.6,
        pickable: !drafting, autoHighlight: false, highlightColor: palette.highlight, ...under,
        updateTriggers: { getFillColor: [theme], getLineColor: [theme] },
        onHover: (info: PickingInfo<HotspotDot>) => {
          if (info.object && cb.current.drawMode === 'none') {
            tip.current?.dot(info.x, info.y, info.object);
            setHiRef.current({ id: 'hotspot-dots', index: info.index });
          } else { tip.current?.clear(); setHiRef.current(null); }
        },
      }));
    }
    const path = (id: string, data: readonly LonLat[][], color: RGBA, width: number) =>
      new PathLayer<LonLat[]>({ id, data, getPath: (d) => d, getColor: color, getWidth: width, widthUnits: 'pixels',
        capRounded: true, jointRounded: true, parameters: { depthCompare: 'always' } });
    if (outline && outline.length) {
      // a soft glow in the accent, a casing in the page colour, and a thin line in ink
      layers.push(
        path('outline-glow', outline, [...palette.accent, palette.glow[0]] as RGBA, 12),
        path('outline-glow-in', outline, [...palette.accent, palette.glow[1]] as RGBA, 6),
        path('outline-casing', outline, [...palette.bg, 210], 4),
        path('outline', outline, [...palette.ink, 240], 1.6),
      );
    }
    if (draftPath && draftPath.length > 1) {
      const colour = drawError ? cssRgb('--critical') : palette.accent;
      layers.push(path('draft-casing', [draftPath], [...palette.bg, 220], 5.5), path('draft', [draftPath], [...colour, 255], 2));
    }
    if (drafting && draft.points.length) {
      layers.push(new ScatterplotLayer<LonLat>({
        id: 'draft-points', data: draft.points, getPosition: (d) => d, getRadius: 4.5, radiusUnits: 'pixels',
        getFillColor: [...palette.bg, 255], getLineColor: [...palette.accent, 255], stroked: true,
        lineWidthUnits: 'pixels', getLineWidth: 2, parameters: { depthCompare: 'always' } }));
    }
    // (a layer with nothing pickable any more drops its highlight)
    if (drafting) hi.current = null;
    layersRef.current = withHighlight(layers, hi.current);
    overlay.setProps({
      layers: layersRef.current,
      getCursor: ({ isHovering, isDragging }) => (cb.current.drawMode !== 'none' ? 'crosshair'
        : isDragging ? 'grabbing' : isHovering || cpuHover.current ? 'pointer' : 'grab'),
    });
  }, [ready, shown, paint, scale, view, elev, outline, draftPath, draft.points, drawMode, palette, theme, playing, stepMs,
    before, insideFlags, insideSet, trendHere, reveal, fade, camera, drawError, dotsOn, dots, previewing]);

  // test hook (development only): where on screen is a hexagon with fire, or of a trend class
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const w = window as unknown as Record<string, unknown>;
    /** The hexagons on screen that pass `pred`, nearest the centre first; `skip` of them are passed over. */
    const onScreen = (pred: (i: number) => boolean, skip = 0) => {
      const map = mapRef.current, s = shown, el = box.current;
      if (!map || !s || !el) return null;
      const w0 = el.clientWidth, h0 = el.clientHeight, cx = w0 / 2, cy = h0 / 2;
      const found: { x: number; y: number; h3: string; i: number; d: number }[] = [];
      for (let i = 0; i < s.u.h3.length; i++) {
        if (!pred(i)) continue;
        const [lat, lon] = cellToLatLng(s.u.h3[i]);
        const p = map.project([lon, lat]);
        if (p.x < 60 || p.y < 60 || p.x > w0 - 60 || p.y > h0 - 60) continue;
        found.push({ x: p.x, y: p.y, h3: s.u.h3[i], i, d: Math.hypot(p.x - cx, p.y - cy) });
      }
      found.sort((a, b) => a.d - b.d);
      return found[Math.min(skip, found.length - 1)] ?? null;
    };
    w.__fhMap = {
      map: () => mapRef.current,
      overlay: () => overlayRef.current,
      level: () => shown?.u.level ?? null,
      ym: () => shown?.f.ym ?? null,
      paint: () => paint,
      /** The gap between neighbouring hexagons on screen now, in px (at the map centre's latitude). */
      gapPx: () => {
        const map = mapRef.current, lvl = shown?.u.level;
        if (!map || !lvl) return null;
        const c = lvl === 3 ? camera.c3 : camera.c4;
        const kmPerPx = (40075.016 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
        return { level: lvl, coverage: c, gap: (1 - c) * (HEX_ACROSS_KM[lvl] / kmPerPx) };
      },
      insideCount: () => (insideFlags ? insideFlags.reduce((n, v) => n + v, 0) : null),
      /** A hotspot dot on screen (px from the map's top left corner), with its row. */
      dotOnScreen: () => {
        const map = mapRef.current, el = box.current;
        if (!map || !el || !dots) return null;
        for (const d of dots.dots) {
          const p = map.project([d.lon, d.lat]);
          if (p.x > el.clientWidth * 0.45 && p.x < el.clientWidth - 80 && p.y > 140 && p.y < el.clientHeight - 160) return { x: p.x, y: p.y, ...d };
        }
        return null;
      },
      isInside: (h3: string) => (insideSet ? insideSet.has(h3) : null),
      fillOf: (h3: string) => fillOf.current?.(h3) ?? null,
      /** The hexagon with fire nearest a point of the map (px from its top left corner). */
      hexNear: (x: number, y: number) => {
        const map = mapRef.current, s = shown;
        if (!map || !s) return null;
        let best: { x: number; y: number; h3: string; d: number } | null = null;
        for (let i = 0; i < s.u.h3.length; i++) {
          if (!(s.f.h[i] > 0)) continue;
          const [lat, lon] = cellToLatLng(s.u.h3[i]);
          const p = map.project([lon, lat]);
          const d = Math.hypot(p.x - x, p.y - y);
          if (!best || d < best.d) best = { x: p.x, y: p.y, h3: s.u.h3[i], d };
        }
        return best;
      },
      /** A hexagon of the universe on screen, inside the selected area or outside it. */
      hexWhere: (inside: boolean) => {
        const best = shown && insideSet ? onScreen((i) => insideSet.has(shown.u.h3[i]) === inside && shown.f.h[i] > 0) : null;
        return best ? { x: best.x, y: best.y, h3: best.h3 } : null;
      },
      firstHex: (minValue = 1) => {
        const best = shown ? onScreen((i) => shown.f.h[i] >= minValue) : null;
        return best && shown ? { x: best.x, y: best.y, h3: best.h3, v: shown.f.h[best.i] } : null;
      },
      /** A hexagon on screen of a trend class ('rising', 'falling', 'flat' or 'untested'), with its row of the file. */
      trendHex: (kind: string, skip = 0) => {
        const tr = trendHere;
        if (!tr) return null;
        const want = (c: number) => (kind === 'rising' ? c > 0 && c <= 4 : kind === 'falling' ? c < 0 : kind === 'flat' ? c === 0 : c === NOT_TESTED);
        const best = onScreen((i) => want(tr.cls[i]), skip);
        if (!best) return null;
        const r = tr.rows[best.i];
        return { x: best.x, y: best.y, h3: best.h3, pct: tr.file.pct[r], p: tr.file.p[r], q: tr.file.q[r], mean: tr.file.mean[r] };
      },
    };
    return () => { delete w.__fhMap; };
  }, [shown, paint, insideFlags, insideSet, trendHere, camera, dots]);

  const zoomBy = (d: number) => {
    const map = mapRef.current;
    if (!map) return;
    if (d > 0) map.zoomIn({ duration: still() ? 0 : 300 }); else map.zoomOut({ duration: still() ? 0 : 300 });
  };
  // + and - zoom the map from anywhere on the page (as the zoom buttons' tooltips say), not only with the map focused:
  // not while typing, in a dialog, on the timeline (its own zoom) or on the map itself (MapLibre's keys zoom there)
  const zoomKeys = useRef(zoomBy);
  zoomKeys.current = zoomBy;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const d = e.key === '+' || e.key === '=' ? 1 : e.key === '-' || e.key === '_' || e.key === '−' ? -1 : 0;
      if (!d || !wrap.current || wrap.current.getClientRects().length === 0) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el && (el.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="spinbutton"]') || box.current?.contains(el))) return;
      if ([...document.querySelectorAll('[aria-modal="true"], dialog[open]')].some((m) => !(m instanceof HTMLDialogElement) || m.open)) return;
      e.preventDefault();
      zoomKeys.current(d);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const resetView = () => {
    const map = mapRef.current;
    if (!map) return;
    const room = roomFor(map, cb.current.padding);
    const bounds = cb.current.focus?.bounds ?? WORLD_BOUNDS;
    const world = room && bounds === WORLD_BOUNDS && phoneMap(map) ? phoneWorld(map, room) : null;
    const cam = world ?? (room ? map.cameraForBounds(bounds, { padding: room, maxZoom: 7 }) : undefined);
    if (!cam?.center) return;
    const three = cb.current.view === '3d';
    map.easeTo({ center: cam.center, zoom: world ? world.zoom : Math.max(0.6, cam.zoom ?? 2), pitch: three ? 45 : 0, bearing: three ? -12 : 0,
      duration: still() ? 0 : 900 });
  };

  const placed = drawMode === 'rectangle' && draft.placed;
  const statusText = status === 'detail' ? t.exMap.status.detail : status === 'trend' ? t.exMap.status.trend : t.exMap.status.loading;
  const dm = t.exMap.draw;
  const drawText = drawMode === 'rectangle'
    ? (placed ? (coarse ? dm.firstCornerTouch : t.explorer.draw.firstCorner) : (coarse ? dm.rectangleTouch : t.picker.drawingRectangle))
    : (coarse ? dm.polygonTouch : t.picker.drawingPolygon);
  const compactDraw = !drawError && drawMode === 'polygon' && draft.points.length > 0;
  return (
    <div ref={wrap} className="fh-ex-map" data-ready={shown && (mode !== 'trend' || trendOn) ? 'true' : 'false'} data-level={shown?.u.level ?? ''}
      data-dots={dotsOn && dots ? String(dots.dots.length) : undefined}
      data-dots-box={dotsOn && dots ? `${dots.box.west},${dots.box.south},${dots.box.east},${dots.box.north}` : undefined}
      data-ym={shown?.f.ym ?? ''} data-status={status} data-mode={paint} data-selected={insideSet ? 'true' : 'false'}
      onMouseLeave={leaveMap}>
      <div ref={box} className={`fh-ex-map-canvas${drawMode !== 'none' ? ' fh-ex-drawing' : ''}`} role="application"
        aria-label={props.label} aria-roledescription="map" />
      {pulse ? <span key={pulse.key} className="fh-ex-pulse" style={{ left: pulse.x, top: pulse.y }} aria-hidden="true"><span /></span> : null}
      {reticle ? (
        <span key={reticle.key} className="fh-ex-reticle" style={{ left: reticle.x, top: reticle.y, width: reticle.w, height: reticle.h }} aria-hidden="true">
          <i /><i /><i /><i />
        </span>
      ) : null}
      <MapTip ref={tip} wrap={wrap} u={shown?.u ?? null} f={shown?.f ?? null} trend={paint === 'trend' ? trendHere : null} scale={scale} />
      {keyFocus ? <p className="fh-ex-map-keys ui-glass ui-glass-thin" role="status">{t.exMap.keysHint}</p> : null}
      <div className="fh-ex-zoom ui-glass ui-glass-thin" role="group" aria-label={t.ex.map.zoomGroup}>
        {/* (a finger pinches to zoom: the + and − buttons are for mice and keyboards) */}
        {coarse ? null : (
          <>
            <Tooltip content={t.ex.map.zoomIn} keys={['+']} describe={false}>
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon" data-zoom="in" aria-label={t.ex.map.zoomIn} onClick={() => zoomBy(1)}><IconPlus /></button>
            </Tooltip>
            <Tooltip content={t.ex.map.zoomOut} keys={['−']} describe={false}>
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon" data-zoom="out" aria-label={t.ex.map.zoomOut} onClick={() => zoomBy(-1)}><IconMinus /></button>
            </Tooltip>
          </>
        )}
        <Tooltip content={t.ex.map.reset} describe={false}>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon" aria-label={t.ex.map.reset} onClick={resetView}><IconTarget /></button>
        </Tooltip>
      </div>
      <div className="fh-ex-map-top">
        {status !== 'idle' ? (
          <p className={`fh-ex-map-status ui-glass ui-glass-thin${status === 'error' ? ' is-error' : ''}`} role={status === 'error' ? 'alert' : 'status'}>
            {status === 'error' ? t.ex.map.error : <><span className="fh-ex-spin" aria-hidden="true" />{statusText}</>}
          </p>
        ) : null}
        {dotsWanted && (dotsBusy || dotsOn) ? (
          <p className="fh-ex-dots-chip ui-glass ui-glass-thin" role="status">
            {dotsBusy && !dotsOn ? <><span className="fh-ex-spin" aria-hidden="true" />{t.exMap.dots.loading}</> : (
              <><span className="fh-ex-dots-swatch" aria-hidden="true" />{t.exMap.dots.legend}
                {dots?.capped ? <span className="fh-ex-dots-cap">{t.exMap.dots.capped(formatNumber(DOTS_MAX, lang))}</span> : null}</>
            )}
          </p>
        ) : null}
        {mode === 'trend' && drawMode === 'none' ? (
          // phones, with the sheet at its smallest: the timeline's note is out of sight, so the map says it
          <div className="fh-ex-trend-chip ui-glass ui-glass-thin" role="note">
            <IconActivity size={15} />
            <span>{t.exMap.trend.chip}</span>
            <button type="button" className="ui-btn ui-btn-ghost fh-ex-trend-back" onClick={() => emitCommand({ action: 'colour', mode: 'count' })}>
              {t.exMap.trend.showMonths}
            </button>
          </div>
        ) : null}
        {drawMode !== 'none' ? (
          // clicks go through the bar to the map (only its buttons take them), and once the shape has begun the help
          // text folds away, so the bar never hides the place being drawn around
          <div className="fh-ex-draw ui-glass" role="status" data-compact={compactDraw ? '' : undefined}>
            <p className={drawError ? 'is-error' : compactDraw ? 'sr-only' : undefined}>
              {drawError ? dm.crosses : drawText}
              {' '}<span className="fh-ex-draw-key">{coarse ? dm.cancelTouch : t.picker.escape}</span>
            </p>
            <div className="fh-ex-draw-actions">
              {drawMode === 'polygon' ? (
                <>
                  <button type="button" className="ui-btn" disabled={!draft.points.length} onClick={() => actions.current.undo()}>
                    {t.explorer.draw.undo}
                  </button>
                  <button type="button" className="ui-btn ui-btn-primary" disabled={draft.points.length < 3 || drawError}
                    onClick={() => actions.current.finish()}>{t.explorer.draw.finish}</button>
                </>
              ) : null}
              <button type="button" className="ui-btn" onClick={() => props.onDrawCancel()}>{t.explorer.draw.cancel}</button>
            </div>
          </div>
        ) : null}
      </div>
      {props.children}
    </div>
  );
}
