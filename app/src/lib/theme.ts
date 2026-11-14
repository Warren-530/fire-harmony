// Light or dark. Light is the default (the owner's choice, 10 Nov); a visitor's choice is remembered. Components that draw with real colours (the map,
// the charts) re-draw when the theme changes: use useTheme() and put the theme in the effect's dependencies.
import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'fh_theme';
const EVENT = 'fh:theme';

export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
  window.dispatchEvent(new Event(EVENT));
}

export function toggleTheme(): void {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

/** Call once before the first render (main.tsx), so the page never flashes the wrong theme. */
export function initTheme(): void {
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
  document.documentElement.dataset.theme = saved === 'dark' ? 'dark' : 'light';
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme, () => 'light');
}
