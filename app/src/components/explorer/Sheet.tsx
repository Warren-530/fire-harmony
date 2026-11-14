// The area panel on phones: a bottom sheet over the map with three heights, like the place cards of Apple Maps and
// Google Maps. Small (the place, the month and its number, play), half (adds the timeline, the numbers and the tabs)
// and full. Drag the handle or the top of the sheet; it snaps to the nearest height, or to the next one when flicked.
// The handle is also a button: a press cycles the heights, the up and down arrows step them, so keyboard and screen
// reader users can resize it too; a tap on the small sheet's place opens it to half. The map above stays usable;
// the sheet scrolls inside. Half fits what it should show (`halfEnd`: the numbers, the timeline and the tabs) as long
// as the map keeps at least 43% of the room.
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject,
} from 'react';

export type SheetSize = 'peek' | 'half' | 'full';
const ORDER: readonly SheetSize[] = ['peek', 'half', 'full'];
const FLICK = 0.45;      // px per ms: a faster release goes on to the next height
const SLOP = 6;          // px a press must move before it counts as a drag
const TOP_GAP = 24;      // px of map left above the full sheet
const HALF_MAX = 0.57;   // half never takes more than this share of the room (the map keeps 43%)
const PEEK_LINE = 28;    // px of the small sheet's own line (`peekOnly`) until it has been measured

export interface SheetHeights { peek: number; half: number; full: number }

/** The three heights in px, from the height of the Explorer and of the sheet's top part (handle and place), and the
 *  height half should have to show its content (`want`; null: half the room). */
export function sheetHeights(total: number, top: number, want: number | null = null): SheetHeights {
  const full = Math.max(top, total - TOP_GAP);
  const peek = Math.min(full, Math.max(96, top));
  const fit = want === null ? Math.round(total * 0.5) : Math.min(Math.ceil(want), Math.round(total * HALF_MAX));
  const half = Math.min(full, Math.max(peek + 160, fit));
  return { peek, half, full };
}

/** What the sheet measures: `halfEnd` selects the element half should end under (it may stick: its parent's top is
 *  used); `peekOnly` an element of the top part shown only in the small sheet. */
export interface SheetLayout { halfEnd?: string; peekOnly?: string }

const PAST = 0.3;        // a slow drag goes on to the next height once it has covered this share of the way there
const PAST_MAX = 96;     // or this many px

/** The height a drag ends on, from `from` (the height when the drag began) to `h`: the next one in the direction of
 *  a flick; after a slow drag that went a third of the way (or 96 px) to the next height, the nearest one from there
 *  on; else the nearest one (a short drag springs back). */
export function snapHeight(h: number, velocity: number, heights: SheetHeights, from: number | null = null): SheetSize {
  const list = ORDER.map((s) => ({ s, h: heights[s] }));
  const nearest = (xs: typeof list) => xs.reduce((best, x) => (Math.abs(x.h - h) < Math.abs(best.h - h) ? x : best)).s;
  if (Math.abs(velocity) >= FLICK) {
    // velocity > 0: the finger moves down, the sheet gets smaller
    const up = velocity < 0;
    const next = up ? list.find((x) => x.h > h + 1) : [...list].reverse().find((x) => x.h < h - 1);
    if (next) return next.s;
  }
  if (from !== null && Math.abs(h - from) > SLOP) {
    const up = h > from;
    const ahead = up ? list.filter((x) => x.h > from + 1) : list.filter((x) => x.h < from - 1).reverse();
    if (ahead.length && Math.abs(h - from) >= Math.min(PAST_MAX, Math.abs(ahead[0].h - from) * PAST)) return nearest(ahead);
  }
  return nearest(list);
}

export function useSheet(enabled: boolean, root: RefObject<HTMLElement | null>, sheet: RefObject<HTMLElement | null>,
  top: RefObject<HTMLElement | null>, layout: SheetLayout = {}) {
  // (a short window, 700 px or less, opens it small, so the map keeps most of the room)
  const [size, setSize] = useState<SheetSize>(() => (typeof window !== 'undefined' && window.innerHeight <= 700 ? 'peek' : 'half'));
  const [heights, setHeights] = useState<SheetHeights>({ peek: 150, half: 400, full: 700 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; y0: number; h0: number; y: number; t: number; v: number; moved: boolean } | null>(null);
  const raf = useRef(0);
  const lineH = useRef(PEEK_LINE);
  const { halfEnd, peekOnly } = layout;

  // measure the room, the top part and where half should end
  const measure = useCallback(() => {
    const r = root.current, tp = top.current, sh = sheet.current;
    if (!enabled || !r || !tp) return;
    const topH = Math.ceil(tp.getBoundingClientRect().height);
    const line = peekOnly ? tp.querySelector<HTMLElement>(peekOnly) : null;
    const shown = !!line && line.offsetParent !== null;
    if (line && shown) lineH.current = Math.ceil(line.getBoundingClientRect().height + (parseFloat(getComputedStyle(tp).rowGap) || 0));
    const extra = line ? lineH.current : 0;
    const peekTop = shown ? topH : topH + extra;
    const halfTop = shown ? topH - extra : topH;
    let want: number | null = null;
    const box = tp.nextElementSibling instanceof HTMLElement ? tp.nextElementSibling : null;
    const end = halfEnd && sh ? sh.querySelector<HTMLElement>(halfEnd) : null;
    if (box && end) {
      const anchor = end.parentElement ?? end;
      // (+1 for the part of a pixel the layout rounds away)
      want = halfTop + anchor.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop + end.offsetHeight + 1;
    }
    const next = sheetHeights(r.clientHeight, peekTop, want);
    setHeights((h) => (h.peek === next.peek && h.half === next.half && h.full === next.full ? h : next));
  }, [enabled, root, top, sheet, halfEnd, peekOnly]);
  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const r = root.current, tp = top.current;
    if (!r || !tp) return undefined;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(r);
    ro.observe(tp);
    return () => ro.disconnect();
  }, [enabled, root, top, measure]);
  // what half shows grows as the place's numbers and the timeline come in: measured again after every render
  useLayoutEffect(() => { measure(); });

  const height = heights[size];
  // the Explorer knows how much of the map the sheet covers (the zoom rail and the attribution sit above it)
  useLayoutEffect(() => {
    const r = root.current;
    if (!r) return;
    if (!enabled) { r.style.removeProperty('--ex-sheet-h'); delete r.dataset.sheet; return; }
    r.style.setProperty('--ex-sheet-h', `${height}px`);
    r.dataset.sheet = size;
  }, [enabled, height, size, root]);

  const apply = (h: number) => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      if (sheet.current) sheet.current.style.height = `${h}px`;
      root.current?.style.setProperty('--ex-sheet-h', `${h}px`);
    });
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const target = e.target as HTMLElement;
    // a press on the sheet's top closes the place search's list (its box loses the focus)
    const typing = document.activeElement;
    if (typing instanceof HTMLInputElement && sheet.current?.contains(typing) && typing !== target) typing.blur();
    // controls in the top part keep their own clicks; the handle itself drags
    if (target.closest('button, a, input, select, textarea, [role="slider"]') && !target.closest('.fh-ex-grip')) return;
    drag.current = { id: e.pointerId, y0: e.clientY, h0: sheet.current?.getBoundingClientRect().height ?? height, y: e.clientY, t: e.timeStamp, v: 0, moved: false };
    // hold the pointer from the start, so a quick flick that leaves the top part at once still drags (a finger is held
    // anyway; a mouse is not). On the handle it is the handle that holds it, so a press without a drag still clicks it.
    const grab = target.closest<HTMLElement>('.fh-ex-grip') ?? e.currentTarget;
    try { grab.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
  }, [enabled, height, sheet]);

  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y0;
    if (!d.moved) {
      if (Math.abs(dy) < SLOP) return;
      d.moved = true;
      setDragging(true);
    }
    const dt = Math.max(1, e.timeStamp - d.t);
    d.v = 0.7 * ((e.clientY - d.y) / dt) + 0.3 * d.v;
    d.y = e.clientY; d.t = e.timeStamp;
    apply(Math.min(heights.full, Math.max(heights.peek * 0.85, d.h0 - dy)));
  }, [heights]);   // eslint-disable-line react-hooks/exhaustive-deps

  const end = useCallback((e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    const h = d.h0 - (e.clientY - d.y0);
    const next = snapHeight(h, d.v, heights, d.h0);
    cancelAnimationFrame(raf.current);
    // glide from where the finger left it to the height it snaps to (React may not touch a style it already wrote)
    const el = sheet.current;
    if (el) { el.classList.remove('is-dragging'); el.style.height = `${heights[next]}px`; }
    root.current?.style.setProperty('--ex-sheet-h', `${heights[next]}px`);
    setDragging(false);
    setSize(next);
    // a drag is not a click on whatever is under the finger
    const stop = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', stop, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
  }, [heights]);

  const cycle = useCallback(() => setSize((s) => ORDER[(ORDER.indexOf(s) + 1) % ORDER.length]), []);
  // a tap on the small sheet's place (not on one of its buttons) opens it to half, as a map app's place card does
  const onClick = useCallback((e: MouseEvent<HTMLElement>) => {
    if (size !== 'peek' || (e.target as Element).closest('button, a, input, select, textarea, [role="slider"]')) return;
    setSize('half');
  }, [size]);
  const onHandleKey = useCallback((e: KeyboardEvent<HTMLButtonElement>) => {
    const i = ORDER.indexOf(size);
    let n = -1;
    if (e.key === 'ArrowUp') n = Math.min(ORDER.length - 1, i + 1);
    else if (e.key === 'ArrowDown') n = Math.max(0, i - 1);
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = ORDER.length - 1;
    if (n < 0) return;
    e.preventDefault();
    setSize(ORDER[n]);
  }, [size]);

  return {
    size, setSize, height, heights, dragging, cycle, onHandleKey,
    zone: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onClick },
  };
}
