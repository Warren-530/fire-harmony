// A tiny command channel between the command palette (or keyboard shortcuts) and the pages.
// Any part of the app can emit a command; the page that can carry it out listens with useCommand.
// Commands that only the Explorer can carry out (play, 3D, colours, scales, drawing, a month, the CSV) go through
// runCommand: on another page it opens the Explorer and the command waits until the Explorer is ready, then runs once.
import { useEffect } from 'react';

export type Command =
  | { action: 'select-area'; kind: string; id: string }
  | { action: 'play-toggle' }
  | { action: 'toggle-3d' }
  | { action: 'colour'; mode: 'count' | 'anomaly' | 'trend' }
  | { action: 'scale'; scale: 'harmonized' | 'modis' | 'raw' }
  | { action: 'draw'; mode: 'rectangle' | 'polygon' }
  | { action: 'set-month'; ym: number }
  | { action: 'download-csv' }
  | { action: 'copy-link' }
  | { action: 'toggle-theme' }
  | { action: 'show-shortcuts' }
  | { action: 'step-month'; by: number }
  | { action: 'compare-pin' }      // pin the Explorer's place to compare (package explorer-panel)
  | { action: 'compare-clear' };

const EVENT = 'fh:command';
const QUEUED = 'fh:explorer-queue';
/** The event that opens the command palette (detail: { query?: string }). */
export const PALETTE_EVENT = 'fh:open-palette';

/** Commands only the Explorer can carry out. */
export const EXPLORER_ACTIONS: ReadonlySet<Command['action']> = new Set<Command['action']>([
  'play-toggle', 'toggle-3d', 'colour', 'scale', 'draw', 'set-month', 'download-csv', 'step-month', 'compare-pin', 'compare-clear',
]);

/** True when the hash is the Explorer's ("#/", "#/?area=…"); the same rule as isExplorerHash in stats.ts. */
export const onExplorerPage = (hash: string = window.location.hash): boolean =>
  (hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '') === '';

export function emitCommand(cmd: Command): void {
  window.dispatchEvent(new CustomEvent<Command>(EVENT, { detail: cmd }));
}

/** Calls `handler` for every command (keep the handler stable or pass deps). */
export function useCommand(handler: (cmd: Command) => void, deps: unknown[] = []): void {
  useEffect(() => {
    const fn = (e: Event) => handler((e as CustomEvent<Command>).detail);
    window.addEventListener(EVENT, fn);
    return () => window.removeEventListener(EVENT, fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ------------------------------------------------------------------------------------------- Explorer commands

let explorerLive = false;
const waiting: Command[] = [];

/** The Explorer says when it can take commands (mounted, and its link read). */
export function setExplorerLive(live: boolean): void { explorerLive = live; }

/** Runs a command: an Explorer command on another page (or before the Explorer is ready) opens the Explorer and runs
 *  there once it is ready; every other command goes out at once. */
export function runCommand(cmd: Command): void {
  if (!EXPLORER_ACTIONS.has(cmd.action) || (explorerLive && onExplorerPage())) { emitCommand(cmd); return; }
  // one of each kind is enough (a second "play" would undo the first)
  const same = waiting.findIndex((c) => c.action === cmd.action);
  if (same >= 0) waiting.splice(same, 1);
  waiting.push(cmd);
  if (!onExplorerPage()) window.location.hash = '#/';
  window.dispatchEvent(new Event(QUEUED));
}

/** The Explorer takes the commands that wait for it (each runs once). */
export function takeExplorerCommands(): Command[] {
  return waiting.splice(0, waiting.length);
}

/** Calls `fn` whenever a command starts waiting for the Explorer. */
export function onExplorerCommand(fn: () => void): () => void {
  window.addEventListener(QUEUED, fn);
  return () => window.removeEventListener(QUEUED, fn);
}

// ------------------------------------------------------------------------------------------- opening places

/** Opens an Explorer link ("#/?area=…") from any page, as a new history entry (Back returns to where you were). */
export function openLink(hash: string): void {
  if (window.location.hash !== hash) window.location.hash = hash;
}

/** Open a named area in the Explorer (works from any page; the Explorer also listens for select-area). */
export function openArea(kind: string, id: string): void {
  const target = `#/?area=${encodeURIComponent(kind)}:${encodeURIComponent(id)}`;
  if (window.location.hash !== target) window.location.hash = target;
  emitCommand({ action: 'select-area', kind, id });
}

/** On the Explorer, "/" goes to the panel's own place search (as on a map site) rather than to the palette: the
 *  visible search box of the area panel (or of the phone sheet); null on other pages. */
export function panelSearchBox(): HTMLInputElement | null {
  if (!onExplorerPage()) return null;
  const boxes = [...document.querySelectorAll<HTMLInputElement>('.fh-ex .fh-search-input')];
  return boxes.find((el) => el.getClientRects().length > 0 && !el.disabled) ?? null;
}

/** Opens the command palette, optionally with a query typed in. */
export function openPalette(query?: string): void {
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT, { detail: { query } }));
}
