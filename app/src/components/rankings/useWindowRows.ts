// A long list that renders only the rows near the screen (windowing), so thousands of rows scroll as smoothly as
// twenty. The page itself scrolls (no inner scroll box, so the header can hide on phones as on every page); the list
// is one tall box, and each row sits at index × row height. The row height comes from the CSS variable --rk-row-h on
// the list, so the layout (table rows on a laptop, cards on a phone) decides it; it is read again only when the list
// changes size, not on every frame of a scroll.
import { useLayoutEffect, useState, type RefObject } from 'react';

export interface WindowRows { rowH: number; start: number; end: number }

const STEP = 6;

export function useWindowRows(count: number, list: RefObject<HTMLElement | null>, overscan = 4): WindowRows {
  const [state, setState] = useState<WindowRows>({ rowH: 64, start: 0, end: Math.min(count, 24) });
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    let raf = 0;
    let rowH = 64;
    const readRowH = () => { rowH = parseFloat(getComputedStyle(el).getPropertyValue('--rk-row-h')) || 64; };
    const measure = () => {
      raf = 0;
      const top = el.getBoundingClientRect().top;
      const vh = window.innerHeight;
      // the window moves in steps of STEP rows, so a slow scroll draws again every few rows, not every row
      const first = Math.floor(Math.floor(-top / rowH) / STEP) * STEP;
      const last = Math.ceil(Math.ceil((vh - top) / rowH) / STEP) * STEP;
      const start = Math.max(0, Math.min(count, first - overscan));
      const end = Math.max(start, Math.min(count, last + overscan));
      setState((s) => (s.rowH === rowH && s.start === start && s.end === end ? s : { rowH, start, end }));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    const onResize = () => { readRowH(); onScroll(); };
    readRowH();
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, [count, list, overscan]);
  return state;
}
