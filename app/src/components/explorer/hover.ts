// The month under the pointer in the Explorer (the timeline, the yearly charts, the calendar), kept outside React so a
// sweep of the pointer re-renders only the parts that show it, and at most once a frame:
// - pointer handlers hand their work to `inFrame` (the latest job of each key runs in the next animation frame), and
//   the month to `previewMonth`;
// - in that frame every job, the new month and every part that listens (useHoveredMonth) update in one React commit
//   (flushSync), before the frame is painted.
// The page itself does not listen: the map and the numbers follow a hovered month only once the pointer rests on it
// (Explorer.tsx), so a sweep never re-renders the page or rebuilds a chart.
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

export type HoverFrom = 'timeline' | 'chart' | 'calendar';
export interface HoveredMonth { ym: number | null; from: HoverFrom | null }

let state: HoveredMonth = { ym: null, from: null };
let next: HoveredMonth | null = null;
const listeners = new Set<() => void>();
const jobs = new Map<string, () => void>();
let frame = 0;
let flushing = false;

const raf = (f: () => void): number => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : setTimeout(f, 16) as unknown as number);

function run(): void {
  frame = 0;
  const todo = [...jobs.values()];
  jobs.clear();
  const go = () => {
    flushing = true;
    try {
      for (const job of todo) job();
      if (next && (next.ym !== state.ym || next.from !== state.from)) {
        state = next;
        for (const f of listeners) f();
      }
      next = null;
    } finally { flushing = false; }
  };
  // (one commit for all of it; without a DOM, as in unit tests, plain calls)
  if (typeof document === 'undefined') go(); else flushSync(go);
}

const schedule = () => { if (!frame && !flushing) frame = raf(run); };

/** Runs `job` in the next animation frame; a newer job of the same key replaces an older one that has not run yet. */
export function inFrame(key: string, job: () => void): void {
  if (flushing) { job(); return; }
  jobs.set(key, job);
  schedule();
}

/** The month under the pointer (null when the pointer leaves), shown everywhere from the next frame. */
export function previewMonth(ym: number | null, from: HoverFrom | null = null): void {
  next = { ym, from: ym === null ? null : from };
  schedule();
}

/** The hovered month now (for code outside React). */
export const hoveredMonth = (): HoveredMonth => next ?? state;

/** Calls `f` after each change of the hovered month. */
export function onHoveredMonth(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** A part of the page that shows the hovered month: it re-renders when `select` of it changes, in the frame's commit. */
export function useHoveredMonth<T>(select: (h: HoveredMonth) => T): T {
  const [value, setValue] = useState(() => select(state));
  useEffect(() => {
    const update = () => setValue(() => select(state));
    update();
    return onHoveredMonth(update);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return value;
}
