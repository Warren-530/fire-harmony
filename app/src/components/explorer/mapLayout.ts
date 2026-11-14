// The room the floating parts take over the map, measured from the page, so the camera fits an area into what is
// left: the area panel (on the left, or a sheet along the bottom), the timeline dock, the folded panel's button, the
// map's own top bar (legend chip and settings pill), the zoom rail, and outside phones an open map card (beside the
// area when there is room, else above it).
import { useEffect, useState, type RefObject } from 'react';
import type { Padding } from '../MapView';
import { RESIZE_FROM, afterPanelResize, clampPanel, panelDefault, panelResizing, savedPanelWidth } from './panelSize';

const MARGIN = 24;      // kept free between a panel and the area
const LEAST = 24;       // the least padding on any side
const MIN_FREE = 240;   // the least width (or height) left for the area when an open card is kept clear

const same = (a: Padding, b: Padding) => a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;

/** The padding before anything can be measured: the usual sizes of the panel, the dock and the controls. */
export function guessPadding(phone: boolean): Padding {
  const w = typeof window === 'undefined' ? 1440 : window.innerWidth;
  if (phone) return { top: 78, right: 78, bottom: LEAST, left: LEAST };
  const saved = w >= RESIZE_FROM ? savedPanelWidth() : null;
  const panel = saved !== null ? clampPanel(saved, w) : panelDefault(w);
  return { top: 76, right: 84, bottom: w <= 1100 ? 160 : 128, left: Math.min(panel + 16 + MARGIN, Math.round(w * 0.45)) };
}

/** The padding of the map in the Explorer `root`; `card` is the width of an open map card (0 when none is open). */
export function measurePadding(root: HTMLElement, card: number, phone: boolean): Padding | null {
  const stage = root.querySelector('.fh-ex-stage');
  if (!stage) return null;
  const s = stage.getBoundingClientRect();
  if (!(s.width > 0 && s.height > 0)) return null;
  const pad: Padding = { top: LEAST, right: LEAST, bottom: LEAST, left: LEAST };
  const bar = root.querySelector('.fh-ex-controls-bar')?.getBoundingClientRect();
  if (bar && bar.height > 0) pad.top = Math.max(pad.top, Math.round(bar.bottom - s.top + MARGIN));
  const zoom = root.querySelector('.fh-ex-zoom')?.getBoundingClientRect();
  if (zoom && zoom.width > 0) pad.right = Math.max(pad.right, Math.round(s.right - zoom.left + MARGIN));
  for (const sel of ['.fh-ex-panel:not([hidden])', '.fh-ex-dock', '.fh-ex-expand']) {
    const r = root.querySelector(sel)?.getBoundingClientRect();
    if (!r || !(r.width > 0 && r.height > 0)) continue;
    const ix = Math.min(r.right, s.right) - Math.max(r.left, s.left);
    const iy = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
    if (ix <= 0 || iy <= 0) continue;                       // not over the map (phones stack the panel below it)
    if (iy >= s.height * 0.5 && ix < s.width * 0.6 && r.left - s.left < s.width * 0.4) {
      pad.left = Math.max(pad.left, Math.round(r.right - s.left + MARGIN));          // a side panel
    } else if (r.bottom >= s.bottom - 48) {
      pad.bottom = Math.max(pad.bottom, Math.round(s.bottom - r.top + MARGIN));       // along the bottom
    } else if (r.top <= s.top + 48) {
      pad.top = Math.max(pad.top, Math.round(r.bottom - s.top + MARGIN));             // along the top
    }
  }
  // the trend note floats over the top of the dock: the area stays above it too
  const note = root.querySelector('.fh-ex-trend-note')?.getBoundingClientRect();
  if (note && note.height > 0 && note.bottom <= s.bottom && note.top > s.top + s.height / 2) {
    pad.bottom = Math.max(pad.bottom, Math.round(s.bottom - note.top + MARGIN));
  }
  // an open card outside phones: the area moves clear of it, beside it when that leaves the area at least 240 px, else
  // under it (an iPad held upright) when that leaves 240 px of height (on phones a card covers the map for a moment)
  const withCard = card + 16 + MARGIN;
  const open = card > 0 && !phone ? root.querySelector<HTMLElement>('.fh-ex-card[data-open="true"]') : null;
  if (open && s.width - pad.left - withCard >= MIN_FREE) pad.right = Math.max(pad.right, withCard);
  else if (open && open.offsetParent) {
    // (from the layout box, not the transformed one: the card is still growing from the bar when this measures)
    const below = Math.round(open.offsetParent.getBoundingClientRect().top + open.offsetTop + open.offsetHeight - s.top + MARGIN);
    if (s.height - below - pad.bottom >= MIN_FREE) pad.top = Math.max(pad.top, below);
  }
  // never more than the map can give: at least a third of each side for the area, or 240 px when a card is kept clear
  const maxX = Math.max(s.width * 0.67, s.width - MIN_FREE), maxY = Math.max(s.height * 0.67, s.height - MIN_FREE);
  if (pad.left + pad.right > maxX) { const k = maxX / (pad.left + pad.right); pad.left = Math.round(pad.left * k); pad.right = Math.round(pad.right * k); }
  if (pad.top + pad.bottom > maxY) { const k = maxY / (pad.top + pad.bottom); pad.top = Math.round(pad.top * k); pad.bottom = Math.round(pad.bottom * k); }
  return pad;
}

/** The map padding, kept up to date as the panels move or change size. `panel` is the width the reader gave the panel
 *  (PanelHandle.tsx): while its edge is dragged the padding waits, and is measured once when the drag ends. */
export function useMapPadding(root: RefObject<HTMLElement | null>, opts: { phone: boolean; collapsed: boolean; card: number; panel?: number | null }): Padding {
  const { phone, collapsed, card, panel = null } = opts;
  // until the first measure: a close guess from the window (the map's first view is fitted before the panels exist)
  const [pad, setPad] = useState<Padding>(() => guessPadding(phone));
  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      if (panelResizing()) return;
      raf = requestAnimationFrame(() => {
        const next = measurePadding(el, card, phone);
        if (next) setPad((prev) => (same(prev, next) ? prev : next));
      });
    };
    const offResize = afterPanelResize(measure);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const sel of ['.fh-ex-stage', '.fh-ex-panel', '.fh-ex-dock', '.fh-ex-controls-bar', '.fh-ex-zoom', '.fh-ex-dock-inner']) {
      const node = el.querySelector(sel);
      if (node) ro.observe(node);
    }
    // an open card changes height with its content (the trend's legend is longer)
    el.querySelectorAll('.fh-ex-card').forEach((node) => ro.observe(node));
    // the trend note comes and goes inside the dock without changing its size: watched as a child of the timeline
    // (not the timeline's whole tree, whose marks change on every move of the pointer: each change read the layout of
    // the page and rendered the Explorer again)
    let inner: Element | null = null;
    const watchInner = () => {
      const next = el.querySelector('.fh-ex-dock-inner');
      if (next && next !== inner) { inner = next; mo.observe(next, { childList: true }); }
    };
    const mo = new MutationObserver(() => { watchInner(); measure(); });
    const dockEl = el.querySelector('.fh-ex-dock');
    if (dockEl) mo.observe(dockEl, { childList: true });
    watchInner();
    return () => { ro.disconnect(); mo.disconnect(); offResize(); cancelAnimationFrame(raf); };
  }, [root, phone, collapsed, card, panel]);
  return pad;
}
