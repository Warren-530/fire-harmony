// The timeline dock: play or pause, step a month, the month in mono capitals, the speed, and a slim chart of the
// selected area's fire each month (November 2000 to the latest month) with a scrubber. Hovering the chart shows that
// month's value and previews it on the map; clicking or dragging sets the month. With the keyboard the chart is a
// slider: arrows move a month, Page Up and Page Down a year, Home and End go to the ends.
//
// The chart zooms into a range of years, like a video editor's timeline: the wheel (or a trackpad pinch) zooms around
// the pointer, two fingers pinch on a touch screen, and the thin strip under the years is a brush: drag across it to
// pick the years, drag the lit window to move it, tap it to centre there. Ticks follow the zoom (years, then months),
// zoomed in the months show as bars, and the y scale fits the years in view. Double click, the range chip or 0 zooms
// out; + and - zoom with the keyboard. The window follows the month while the player runs.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatYyyymm, useI18n } from '../../lib/i18n';
import { addMonths, countText, monthCode, monthsBetween, rawTotal, valueOf } from '../../lib/stats';
import type { MonthlyPoint, Scale } from '../../lib/types';
import { Segmented } from '../ui';
import { Tooltip } from '../Tooltip';
import { IconActivity, IconClose, IconPause, IconPlay, IconStepBack, IconStepForward } from '../icons';
import { inFrame, useHoveredMonth } from './hover';

export type Speed = 1 | 2 | 4;
export const SPEEDS: readonly Speed[] = [1, 2, 4];
/** Time on each month while playing, at 1x. */
export const STEP_MS = 900;

export interface TimelineProps {
  points: readonly MonthlyPoint[] | null;   // the selected area's months (null while the first series loads)
  scale: Scale;
  first: number;                            // first and last month of the timeline (yyyymm)
  last: number;
  ym: number;                               // the chosen month
  // the month the playhead shows: a month hovered anywhere in the Explorer (explorer/hover.ts) when not playing, else
  // this one; a month hovered in the calendar is also drawn as a faint mark (the timeline reads both from the store)
  shownYm: number;
  playing: boolean;
  speed: Speed;
  name: string;                             // the area, as in a sentence
  busy: boolean;                            // a new area is loading: the old line stays, dimmed
  trend?: boolean;                          // the map shows the trend of 2001 to 2025 (one map for the whole record)
  onPlay(): void;
  onStep(by: number): void;
  onSpeed(speed: Speed): void;
  onSelect(ym: number): void;
  onPreview(ym: number | null): void;
  onShowMonths?(): void;                    // back from the trend map to the months
}

const PAD_X = 10, TOP = 8, BASE = 42;
/** Months of room after the last month when the window reaches it, so the latest spike shows beside the playhead. */
const END_PAD = 3;
/** The chart's rows: the plot (TOP to BASE), the year labels, and the brush strip. On touch screens the chart is taller
 *  and the brush takes the labels' row too, so the strip's zone is 44 px tall (a tap on it never picks a month). */
const FINE = { H: 72, LABEL_Y: 56, STRIP_Y: 62, STRIP_H: 8, ZONE_Y: 56 } as const;
const COARSE = { H: 88, LABEL_Y: 58, STRIP_Y: 70, STRIP_H: 10, ZONE_Y: 44 } as const;
const coarsePointer = () => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
const MIN_SPAN = 6;          // months: the deepest zoom
const ZOOM_MS = 220;
const TREND_YEARS = [2001, 2025] as const;
const still = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Win { a: number; b: number }     // the months in view, as indexes from `first` (fractions allowed)
/** The room drawn after the window: END_PAD months when it reaches the last month, else none. */
const endPadOf = (w: Win, full: number): number => (w.b > full - 1 ? END_PAD : 0);
type Gesture =
  | { kind: 'scrub' }
  | { kind: 'pan'; grab: number; win: Win; x0: number }
  | { kind: 'brush'; from: number; x0: number; moved: boolean }
  | { kind: 'pinch'; d0: number; win: Win; anchor: number };

/** The window kept inside the record and at least MIN_SPAN long. */
function clampWin(w: Win, n: number): Win {
  const full = Math.max(1, n - 1);
  const span = Math.max(Math.min(MIN_SPAN, full), Math.min(full, w.b - w.a));
  let a = w.a;
  a = Math.max(0, Math.min(full - span, a));
  return { a, b: a + span };
}

export function Timeline(props: TimelineProps) {
  const { points, scale, first, last, ym, playing, speed, name, busy, trend = false } = props;
  // the month hovered anywhere in the Explorer (this re-renders the timeline alone, at most once a frame)
  const hovered = useHoveredMonth((h) => h.ym);
  const markYm = useHoveredMonth((h) => (h.from === 'calendar' ? h.ym : null));
  const shownYm = playing || hovered === null ? props.shownYm : hovered;
  const { t, lang } = useI18n();
  const tl = t.ex.timeline, zx = t.exMap.timeline, tx = t.exMap.trend;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverYm, setHoverYmState] = useState<number | null>(null);
  const hoverRef = useRef<number | null>(null);
  const setHoverYm = useCallback((m: number | null) => { hoverRef.current = m; setHoverYmState(m); }, []);
  const gesture = useRef<Gesture | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const cb = useRef(props);
  useEffect(() => { cb.current = props; });
  const [geo] = useState(() => (coarsePointer() ? COARSE : FINE));
  const { H, LABEL_Y, STRIP_Y, STRIP_H, ZONE_Y } = geo;
  // a double click zooms out and keeps the month chosen before it (its first click is a scrub)
  const lastDown = useRef(0);
  const beforeYm = useRef<number | null>(null);
  const skipFollow = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    setWidth(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      setWidth((prev) => (Math.abs(prev - w) >= 2 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = Math.max(1, monthsBetween(first, last) + 1);
  const full = Math.max(1, n - 1);
  const values = useMemo(() => {
    const out: (number | null)[] = new Array<number | null>(n).fill(null);
    if (!points) return out;
    for (const p of points) {
      const i = monthsBetween(first, p.yr * 100 + p.mo);
      if (i < 0 || i >= n || p.src === 3) continue;
      out[i] = scale === 'raw' ? rawTotal(p) : valueOf(p, scale);
    }
    return out;
  }, [points, scale, first, n]);
  const maxAll = useMemo(() => values.reduce<number>((m, v) => (v !== null && v > m ? v : m), 0), [values]);

  // ------------------------------------------------------------------------------------------- the zoom window
  const [win, setWinState] = useState<Win>({ a: 0, b: full });
  const winRef = useRef(win);
  const anim = useRef(0);
  const [moving, setMoving] = useState(false);      // a gesture is zooming: the playhead does not glide
  const movingTimer = useRef(0);
  const setWin = useCallback((next: Win, animate = false) => {
    const target = clampWin(next, n);
    cancelAnimationFrame(anim.current);
    const from = winRef.current;
    if (!animate || still() || (Math.abs(from.a - target.a) < 0.01 && Math.abs(from.b - target.b) < 0.01)) {
      winRef.current = target;
      setWinState(target);
      setMoving(true);
      window.clearTimeout(movingTimer.current);
      movingTimer.current = window.setTimeout(() => setMoving(false), 160);
      return;
    }
    const t0 = performance.now();
    setMoving(true);
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - t0) / ZOOM_MS));
      const e = 1 - Math.pow(1 - k, 3);
      const w = { a: from.a + (target.a - from.a) * e, b: from.b + (target.b - from.b) * e };
      winRef.current = w;
      setWinState(w);
      if (k < 1) anim.current = requestAnimationFrame(tick);
      else { setMoving(false); }
    };
    anim.current = requestAnimationFrame(tick);
  }, [n]);
  useEffect(() => () => { cancelAnimationFrame(anim.current); window.clearTimeout(movingTimer.current); }, []);
  // a new record length (first load): all of it
  useEffect(() => { winRef.current = { a: 0, b: full }; setWinState({ a: 0, b: full }); }, [full]);

  const span = Math.max(1e-6, win.b - win.a);
  const zoomed = span < full - 0.5;
  const w = Math.max(width, 120);
  const pw = w - 2 * PAD_X;
  // (the months drawn: the window, and a little room after the last month when the window reaches it)
  const drawn = span + endPadOf(win, full);
  const x = (i: number) => PAD_X + ((i - win.a) / drawn) * pw;
  const xo = (i: number) => PAD_X + (i / full) * pw;            // the brush strip: the whole record
  const pxMonth = pw / drawn;

  // the y scale fits the months in view
  const lo = Math.max(0, Math.floor(win.a) - 1), hi = Math.min(n - 1, Math.ceil(win.b) + 1);
  let max = 0;
  for (let i = lo; i <= hi; i++) { const v = values[i]; if (v !== null && v > max) max = v; }
  if (!zoomed) max = maxAll;
  const y = (v: number) => TOP + (BASE - TOP) * (1 - (max > 0 ? v / max : 0));

  const bars = pxMonth >= 6;
  const { line, area } = useMemo(() => {
    if (bars) return { line: '', area: '' };
    let l = '', a = '';
    let run: [number, number][] = [];
    const flush = () => {
      if (run.length) {
        l += run.map(([px, py], k) => `${k ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
        a += `M${run[0][0].toFixed(1)},${BASE}` + run.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join('')
          + `L${run[run.length - 1][0].toFixed(1)},${BASE}Z`;
      }
      run = [];
    };
    for (let i = lo; i <= hi; i++) {
      const v = values[i];
      if (v === null) { flush(); continue; }
      run.push([x(i), y(v)]);
    }
    flush();
    return { line: l, area: a };
    // x and y depend on the window, the width and max only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, w, win.a, win.b, max, bars]);

  // the brush strip: the whole record, small
  const strip = useMemo(() => {
    let a = `M${PAD_X},${STRIP_Y + STRIP_H}`;
    for (let i = 0; i < n; i++) {
      const v = values[i] ?? 0;
      a += `L${xo(i).toFixed(1)},${(STRIP_Y + STRIP_H - (maxAll > 0 ? Math.sqrt(v / maxAll) : 0) * STRIP_H).toFixed(1)}`;
    }
    return `${a}L${(w - PAD_X).toFixed(1)},${STRIP_Y + STRIP_H}Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, w, n, maxAll]);

  // ticks: years (every 1, 2, 5 or 10, as room allows), then months as the zoom deepens
  const ticks = useMemo(() => {
    const out: { i: number; label: string | null; major: boolean }[] = [];
    const perYear = pxMonth * 12;
    const every = [1, 2, 5, 10].find((k) => k * perYear >= 46) ?? 10;
    const y0 = Math.floor(first / 100), y1 = Math.floor(last / 100);
    for (let yr = y0; yr <= y1 + 1; yr++) {
      for (let mo = 1; mo <= 12; mo++) {
        const i = monthsBetween(first, yr * 100 + mo);
        if (i < 0 || i >= n || i < win.a - 0.5 || i > win.b + 0.5) continue;
        if (mo === 1) out.push({ i, label: yr % every === 0 ? String(yr) : null, major: true });
        else if (pxMonth >= 4) {
          const quarter = (mo - 1) % 3 === 0;
          const label = pxMonth >= 30 || (quarter && pxMonth >= 11) ? t.common.monthsShort[mo - 1] : null;
          if (pxMonth >= 7 || quarter) out.push({ i, label, major: false });
        }
      }
    }
    return out;
  }, [first, last, n, win.a, win.b, pxMonth, t]);
  // a label is drawn only where it fits whole; with no year label in view, the year sits at the left end
  const labelFits = (i: number) => { const px = x(i); return px >= PAD_X + 14 && px <= w - PAD_X - 14; };
  const hasYearLabel = ticks.some((k) => k.major && k.label && labelFits(k.i));
  const leftYear = Math.floor(addMonths(first, Math.max(0, Math.round(win.a))) / 100);

  // ------------------------------------------------------------------------------------------- pointer and keys
  const local = (clientX: number, clientY: number) => {
    const r = box.current?.getBoundingClientRect();
    return r ? { x: clientX - r.left, y: clientY - r.top, w: r.width } : { x: 0, y: 0, w: 1 };
  };
  /** The month index under a point of the chart (a fraction), and of the brush strip. */
  const fracAt = (px: number) => winRef.current.a + ((px - PAD_X) / Math.max(1, w - 2 * PAD_X))
    * (winRef.current.b - winRef.current.a + endPadOf(winRef.current, full));
  const stripAt = (px: number) => ((px - PAD_X) / Math.max(1, w - 2 * PAD_X)) * full;
  // (the side padding counts as the nearest month in view, never one past the ends of the window)
  const indexAt = (px: number) => {
    const at = Math.round(fracAt(Math.max(PAD_X, Math.min(w - PAD_X, px))));
    const cur = winRef.current;
    return Math.max(0, Math.min(n - 1, Math.max(Math.ceil(cur.a - 0.5), Math.min(Math.floor(cur.b + 0.5), at))));
  };
  const ymAt = (px: number) => addMonths(first, indexAt(px));
  const inStrip = (py: number) => py >= ZONE_Y;

  const zoomAround = useCallback((anchor: number, factor: number, animate = false) => {
    const cur = winRef.current;
    const s = cur.b - cur.a;
    const ns = Math.max(MIN_SPAN, Math.min(full, s * factor));
    const a = anchor - (anchor - cur.a) * (ns / s);
    setWin({ a, b: a + ns }, animate);
  }, [full, setWin]);
  const reset = useCallback(() => setWin({ a: 0, b: full }, true), [full, setWin]);

  // the wheel zooms (a trackpad pinch arrives as a wheel with Ctrl), a sideways swipe moves the window
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      const scaleBy = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * scaleBy, dy = e.deltaY * scaleBy;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const cur = winRef.current;
      const shown = cur.b - cur.a + endPadOf(cur, full);
      if (Math.abs(dx) > Math.abs(dy) && !e.ctrlKey) {
        const shift = (dx / Math.max(1, r.width - 2 * PAD_X)) * shown;
        setWin({ a: cur.a + shift, b: cur.b + shift });
        return;
      }
      const anchor = cur.a + ((px - PAD_X) / Math.max(1, r.width - 2 * PAD_X)) * shown;
      zoomAround(anchor, Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0022)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setWin, zoomAround]);

  // the window follows the month when it leaves the view (the step buttons, the keys, the calendar), and keeps a
  // little room ahead of the player; a month picked inside the view never moves it
  const followI = monthsBetween(first, playing ? shownYm : ym);
  useEffect(() => {
    if (skipFollow.current) { skipFollow.current = false; return; }   // the month a double click gives back
    const cur = winRef.current;
    const s = cur.b - cur.a;
    if (s >= full - 0.5 || followI < 0 || followI > full) return;
    const margin = playing ? Math.min(2, s * 0.08) : -0.5;
    if (followI < cur.a + margin) setWin({ a: followI - s * 0.15, b: followI - s * 0.15 + s }, !playing);
    else if (followI > cur.b - margin) setWin({ a: followI - s * 0.85, b: followI - s * 0.85 + s }, !playing);
  }, [followI, full, playing, setWin]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const p = local(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size >= 2) {
      const [t1, t2] = [...touches.current.values()];
      const mid = local((t1.x + t2.x) / 2, (t1.y + t2.y) / 2);
      gesture.current = { kind: 'pinch', d0: Math.max(10, Math.abs(t1.x - t2.x)), win: winRef.current, anchor: fracAt(mid.x) };
      setHoverYm(null);
      return;
    }
    if (inStrip(p.y)) {
      const at = stripAt(p.x);
      const cur = winRef.current;
      if (zoomed && at >= cur.a && at <= cur.b) gesture.current = { kind: 'pan', grab: at - cur.a, win: cur, x0: p.x };
      else gesture.current = { kind: 'brush', from: at, x0: p.x, moved: false };
      return;
    }
    gesture.current = { kind: 'scrub' };
    const now = performance.now();
    if (now - lastDown.current > 500) beforeYm.current = cb.current.ym;
    lastDown.current = now;
    const m = ymAt(p.x);
    setHoverYm(m);
    cb.current.onSelect(m);
  };
  // (the moves between two frames make one update: the latest runs in the next frame, with the hovered month, in one
  // commit; see hover.ts)
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const cx = e.clientX, cy = e.clientY;
    inFrame('timeline-move', () => moveTo(cx, cy));
  };
  const moveTo = (clientX: number, clientY: number) => {
    const p = local(clientX, clientY);
    const hoverYm = hoverRef.current;
    const g = gesture.current;
    if (g?.kind === 'pinch') {
      if (touches.current.size < 2) return;
      const [t1, t2] = [...touches.current.values()];
      const d = Math.max(10, Math.abs(t1.x - t2.x));
      const s0 = g.win.b - g.win.a;
      const ns = Math.max(MIN_SPAN, Math.min(full, s0 * (g.d0 / d)));
      const a = g.anchor - (g.anchor - g.win.a) * (ns / s0);
      setWin({ a, b: a + ns });
      return;
    }
    if (g?.kind === 'pan') {
      const at = stripAt(p.x);
      const s = g.win.b - g.win.a;
      setWin({ a: at - g.grab, b: at - g.grab + s });
      return;
    }
    if (g?.kind === 'brush') {
      if (Math.abs(p.x - g.x0) < 4 && !g.moved) return;
      g.moved = true;
      const at = stripAt(p.x);
      const a = Math.min(g.from, at), b = Math.max(g.from, at);
      setWin({ a, b: Math.max(b, a + MIN_SPAN) });
      return;
    }
    if (inStrip(p.y) && !g) { if (hoverYm !== null) { setHoverYm(null); cb.current.onPreview(null); } return; }
    const m = ymAt(p.x);
    if (m !== hoverYm) setHoverYm(m);
    if (g?.kind === 'scrub') { if (m !== cb.current.ym) cb.current.onSelect(m); }
    else cb.current.onPreview(m);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'brush' && !g.moved) {
      // a tap on the strip: centre the window there (three years when nothing is zoomed yet)
      const cur = winRef.current;
      const s = zoomed ? cur.b - cur.a : Math.min(full, 36);
      setWin({ a: g.from - s / 2, b: g.from + s / 2 }, true);
    }
    if (g?.kind === 'pinch' && touches.current.size === 1) { gesture.current = null; return; }
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onDoubleClick = (e: { clientX: number; clientY: number }) => {
    if (inStrip(local(e.clientX, e.clientY).y) || !zoomed) return;
    if (beforeYm.current !== null && beforeYm.current !== cb.current.ym) { skipFollow.current = true; cb.current.onSelect(beforeYm.current); }
    reset();
  };
  const onPointerLeave = () => {
    if (gesture.current) return;
    // (in the frame, in place of a move still waiting for it)
    inFrame('timeline-move', () => {
      if (gesture.current) return;
      setHoverYm(null);
      cb.current.onPreview(null);
    });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    const chosen = monthsBetween(first, ym);
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowDown': next = addMonths(ym, e.shiftKey ? -12 : -1); break;
      case 'ArrowRight': case 'ArrowUp': next = addMonths(ym, e.shiftKey ? 12 : 1); break;
      case 'PageDown': next = addMonths(ym, -12); break;
      case 'PageUp': next = addMonths(ym, 12); break;
      case 'Home': next = first; break;
      case 'End': next = last; break;
      case '+': case '=': e.preventDefault(); zoomAround(chosen, 0.5, true); return;
      case '-': case '_': e.preventDefault(); zoomAround(chosen, 2, true); return;
      case '0': e.preventDefault(); reset(); return;
      default: return;
    }
    e.preventDefault();
    cb.current.onSelect(Math.max(first, Math.min(last, next)));
  };

  const valueAt = (m: number): number | null => {
    const i = monthsBetween(first, m);
    return i >= 0 && i < n ? values[i] : null;
  };
  const say = (m: number) => {
    const v = valueAt(m);
    return v === null ? tl.noData : t.calendar.units[scale](countText(v, 'compact'));
  };
  const shownI = monthsBetween(first, shownYm);
  const chosenI = monthsBetween(first, ym);
  const hoverI = hoverYm === null ? null : monthsBetween(first, hoverYm);
  const markI = markYm === null ? null : monthsBetween(first, markYm);
  const shownV = valueAt(shownYm);
  const preview = shownYm !== ym;
  const hv = hoverYm === null ? null : valueAt(hoverYm);
  const hx = hoverI === null ? 0 : x(hoverI);
  const inView = (i: number) => i >= win.a - 0.5 && i <= win.b + 0.5;
  // the readout stays inside the chart and inside the window
  const readW = 150;
  const boxLeft = box.current?.getBoundingClientRect().left ?? 0;
  const vw = typeof document !== 'undefined' ? document.documentElement.clientWidth : 1e4;
  // (and clear of the map's attribution button, which sits just above the dock's right end)
  let rightEdge = vw - 8;
  if (hoverYm !== null && box.current) {
    const top = box.current.getBoundingClientRect().top;
    const attr = box.current.closest('.fh-ex')?.querySelector('.maplibregl-ctrl-attrib')?.getBoundingClientRect();
    if (attr && attr.width > 0 && attr.bottom > top - 50 && attr.top < top) rightEdge = Math.min(rightEdge, attr.left - 6);
  }
  const readoutLeft = Math.max(Math.max(4, 8 - boxLeft), Math.min(Math.min(w - readW - 4, rightEdge - boxLeft - readW), hx - readW / 2));
  const yearOf = (i: number) => Math.floor(addMonths(first, Math.max(0, Math.min(n - 1, Math.round(i)))) / 100);
  // the range chip: years, or months when less than two years are in view ("Jan 2019 to Jul 2019")
  const monthAt = (i: number) => addMonths(first, Math.max(0, Math.min(n - 1, Math.round(i))));
  const shortMonth = (m: number) => `${t.common.monthsShort[(m % 100) - 1]} ${Math.floor(m / 100)}`;
  const rangeText = span < 24 ? zx.range(shortMonth(monthAt(win.a)), shortMonth(monthAt(win.b)))
    : zx.range(String(yearOf(win.a)), String(yearOf(win.b)));
  const t0 = monthsBetween(first, TREND_YEARS[0] * 100 + 1), t1 = monthsBetween(first, TREND_YEARS[1] * 100 + 12);
  const bw = Math.max(1, pxMonth * 0.7);

  return (
    <div className={`fh-ex-dock-inner${busy ? ' is-busy' : ''}${trend ? ' is-trend' : ''}`}>
      {trend ? (
        <div className="fh-ex-trend-note ui-glass ui-glass-thin" role="note">
          <IconActivity size={16} />
          <p>{tx.note}</p>
          {props.onShowMonths ? (
            <button type="button" className="ui-btn ui-btn-ghost fh-ex-trend-back" onClick={() => props.onShowMonths?.()}>{tx.showMonths}</button>
          ) : null}
        </div>
      ) : null}
      <div className="fh-ex-player" role="group" aria-label={tl.label}>
        <Tooltip content={trend && !playing ? tx.playTip : playing ? tl.pause : tl.play} keys={['Space']} describe={false}>
          <button type="button" className="ui-btn ui-btn-primary ui-btn-icon fh-ex-play" onClick={() => props.onPlay()}
            aria-label={playing ? tl.pause : tl.play} aria-pressed={playing}>
            {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
          </button>
        </Tooltip>
        <Tooltip content={tl.back} keys={['←']} describe={false}>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon" onClick={() => props.onStep(-1)} aria-label={tl.back} disabled={ym <= first}>
            <IconStepBack size={18} />
          </button>
        </Tooltip>
        <Tooltip content={tl.forward} keys={['→']} describe={false}>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon" onClick={() => props.onStep(1)} aria-label={tl.forward} disabled={ym >= last}>
            <IconStepForward size={18} />
          </button>
        </Tooltip>
        <div className="fh-ex-month" aria-hidden="true">
          <span className="fh-ex-month-code ui-mono">{monthCode(shownYm, t.common.monthsShort)}</span>
          <span className="fh-ex-month-value ui-mono">
            {preview ? <span className="fh-ex-month-badge">{t.ex.previewBadge}</span> : null}
            {shownV === null ? tl.noData : countText(shownV, 'compact')}
          </span>
        </div>
        <div className="fh-ex-speed">
          <Segmented label={tl.speed} hideLabel value={String(speed) as `${Speed}`}
            options={SPEEDS.map((s) => ({ value: String(s) as `${Speed}`, label: tl.speedOption(s) }))}
            onChange={(v) => props.onSpeed(Number(v) as Speed)} />
        </div>
        {/* narrow docks: one button that steps through the speeds (the three options do not fit next to the month) */}
        <Tooltip content={tl.speedCycle(tl.speedOption(speed))} describe={false}>
          <button type="button" className="ui-btn ui-btn-ghost fh-ex-speed-cycle ui-mono" aria-label={tl.speedCycle(tl.speedOption(speed))}
            onClick={() => props.onSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}>
            {tl.speedOption(speed)}
          </button>
        </Tooltip>
      </div>

      <div className="fh-ex-scrub-wrap">
        {zoomed ? (
          <Tooltip content={zx.reset} keys={['0']} describe={false}>
            <button type="button" className="fh-ex-zoom-chip ui-press" aria-label={`${zx.zoomed(span < 24 ? shortMonth(monthAt(win.a)) : String(yearOf(win.a)), span < 24 ? shortMonth(monthAt(win.b)) : String(yearOf(win.b)))}. ${zx.reset}`} onClick={reset}>
              <span className="ui-mono">{rangeText}</span>
              <IconClose size={12} />
            </button>
          </Tooltip>
        ) : null}
        <div ref={box} className={`fh-ex-scrub${moving ? ' is-moving' : ''}`} role="slider" tabIndex={0} aria-label={tl.scrubber(name)}
          aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={Math.max(0, chosenI)} aria-keyshortcuts="+ - 0"
          aria-valuetext={tl.valueText(formatYyyymm(ym, lang), say(ym))} aria-describedby={`${uid}hint`}
          data-zoomed={zoomed ? 'true' : 'false'} data-win={`${win.a.toFixed(2)},${win.b.toFixed(2)}`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave} onKeyDown={onKey} onDoubleClick={onDoubleClick} style={{ height: H }}>
          {width > 0 ? (
            <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} aria-hidden="true" className="fh-ex-scrub-svg">
              <defs>
                <linearGradient id={`${uid}g`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.04" />
                </linearGradient>
                <clipPath id={`${uid}c`}><rect x={PAD_X - 1} y={0} width={pw + 2} height={LABEL_Y + 4} /></clipPath>
              </defs>
              <g clipPath={`url(#${uid}c)`}>
                {trend && t1 >= 0 ? (
                  <g className="fh-ex-scrub-band">
                    <rect x={x(t0 - 0.5)} y={TOP - 6} width={Math.max(0, x(t1 + 0.5) - x(t0 - 0.5))} height={BASE - TOP + 6} />
                    {inView(t0) || inView(t0 + 12) ? <text x={Math.max(PAD_X + 2, x(t0 - 0.5) + 4)} y={TOP + 4}>{tx.band}</text> : null}
                  </g>
                ) : null}
                <line x1={PAD_X} x2={w - PAD_X} y1={BASE} y2={BASE} className="fh-ex-scrub-base" />
                {ticks.map((k) => (
                  <g key={k.i}>
                    <line x1={x(k.i)} x2={x(k.i)} y1={BASE} y2={BASE + (k.major ? 4 : 2.5)} className={k.major ? 'fh-ex-scrub-tick' : 'fh-ex-scrub-tick is-minor'} />
                    {k.label && labelFits(k.i) ? (
                      <text x={x(k.i)} y={LABEL_Y} textAnchor="middle" className={k.major ? 'fh-ex-scrub-year' : 'fh-ex-scrub-mo'}>{k.label}</text>
                    ) : null}
                  </g>
                ))}
                {!hasYearLabel ? <text x={PAD_X} y={LABEL_Y} textAnchor="start" className="fh-ex-scrub-year">{leftYear}</text> : null}
                {/* the playhead's line goes behind the record's line (its dot goes on top, below) */}
                {shownI >= 0 && shownI < n && inView(shownI) ? (
                  <g className="fh-ex-scrub-head" style={{ transform: `translateX(${x(shownI).toFixed(1)}px)` }}>
                    <line x1={0} x2={0} y1={TOP - 6} y2={BASE} />
                  </g>
                ) : null}
                {bars ? (
                  values.slice(lo, hi + 1).map((v, k) => {
                    const i = lo + k;
                    if (v === null || !(v > 0)) return null;
                    const on = i === shownI || i === hoverI;
                    return <rect key={i} x={x(i) - bw / 2} y={y(v)} width={bw} height={Math.max(0.5, BASE - y(v))} rx={Math.min(2, bw / 3)}
                      className={on ? 'fh-ex-scrub-bar is-on' : 'fh-ex-scrub-bar'} />;
                  })
                ) : (
                  <>
                    <path d={area} fill={`url(#${uid}g)`} />
                    <path d={line} fill="none" className="fh-ex-scrub-line" />
                  </>
                )}
                {markI !== null && markI >= 0 && markI < n && inView(markI) ? <line x1={x(markI)} x2={x(markI)} y1={TOP - 4} y2={BASE} className="fh-ex-scrub-mark" /> : null}
                {preview && chosenI >= 0 && chosenI < n && inView(chosenI) ? (
                  <line x1={x(chosenI)} x2={x(chosenI)} y1={TOP - 4} y2={BASE} className="fh-ex-scrub-chosen" />
                ) : null}
                {shownI >= 0 && shownI < n && inView(shownI) ? (
                  <g className="fh-ex-scrub-head" style={{ transform: `translateX(${x(shownI).toFixed(1)}px)` }}>
                    <circle cx={0} cy={shownV === null ? BASE : y(shownV)} r={3.5} />
                  </g>
                ) : null}
                {hoverI !== null && hoverI !== shownI && inView(hoverI) ? <line x1={hx} x2={hx} y1={TOP - 4} y2={BASE} className="fh-ex-scrub-hover" /> : null}
              </g>
              <g className={`fh-ex-scrub-strip${zoomed ? ' is-zoomed' : ''}`}>
                <rect x={PAD_X} y={STRIP_Y} width={pw} height={STRIP_H} rx={3} className="fh-ex-strip-track" />
                <path d={strip} className="fh-ex-strip-fire" />
                <rect x={xo(win.a)} y={STRIP_Y - 1} width={Math.max(4, xo(win.b) - xo(win.a))} height={STRIP_H + 2} rx={3} className="fh-ex-strip-win" />
                {shownI >= 0 && shownI < n ? <line x1={xo(shownI)} x2={xo(shownI)} y1={STRIP_Y - 1} y2={STRIP_Y + STRIP_H + 1} className="fh-ex-strip-head" /> : null}
              </g>
            </svg>
          ) : null}
          {hoverYm !== null && width > 0 ? (
            <div className="fh-ex-scrub-readout ui-glass" style={{ left: readoutLeft, width: readW }} aria-hidden="true">
              <span className="ui-mono">{monthCode(hoverYm, t.common.monthsShort)}</span>
              <span className="ui-mono">{hv === null ? tl.noData : countText(hv, 'compact')}</span>
            </div>
          ) : null}
          <span id={`${uid}hint`} className="sr-only">{`${tl.hint} ${zx.hint}`}</span>
        </div>
      </div>
    </div>
  );
}
