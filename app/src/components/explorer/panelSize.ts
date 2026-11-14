// The width of the Explorer's area panel. On screens 1024 px wide and more the reader can drag its right edge
// (PanelHandle.tsx) between 320 px and 720 px or half the window; the width is kept in localStorage (no width kept:
// the panel's own width from explorer.css, 384 px, or 340 px up to 1100 px). While a drag runs, the parts of the page
// that draw for their width (the charts, the calendar, the map's padding) wait, and draw once when it ends.

export const PANEL_MIN = 320;
export const PANEL_MAX = 720;
/** From this window width the panel can be resized (phones keep the sheet, tablets their layout). */
export const RESIZE_FROM = 1024;
const KEY = 'fh_panel_w';

const vw = () => (typeof window === 'undefined' ? 1440 : window.innerWidth);
/** The panel's width before anyone drags it (as in explorer.css). */
export const panelDefault = (w = vw()): number => (w <= 1100 ? 340 : 384);
/** The widest the panel may be: 720 px, and never more than half the window. */
export const panelMax = (w = vw()): number => Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.floor(w * 0.5)));
export const clampPanel = (px: number, w = vw()): number => Math.round(Math.max(PANEL_MIN, Math.min(panelMax(w), px)));

/** The width the reader chose (null: the default). */
export function savedPanelWidth(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}
export function savePanelWidth(px: number | null): void {
  try {
    if (px === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(Math.round(px)));
  } catch { /* private mode: kept for this visit only */ }
}

let resizing = false;
const ends = new Set<() => void>();
/** Is the panel's edge being dragged now? */
export const panelResizing = (): boolean => resizing;
export function setPanelResizing(on: boolean): void {
  if (resizing === on) return;
  resizing = on;
  if (!on) for (const f of [...ends]) f();
}
/** Calls `f` each time a drag of the panel's edge ends (to draw once for the new width). */
export function afterPanelResize(f: () => void): () => void {
  ends.add(f);
  return () => { ends.delete(f); };
}
