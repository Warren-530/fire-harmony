import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import './styles/ui.css';
import './styles/theme.css';
import { App } from './App.tsx';
import { initTheme } from './lib/theme';
import { getDb } from './lib/db';
import { prefetchFirstView } from './lib/web';

initTheme();

// The Explorer's first view (the series of the place and the level 3 map) comes from small JSON files and needs no
// database: start reading them now, before the Explorer's code has arrived.
const hash = window.location.hash;
const onExplorer = !hash || hash === '#/' || hash.startsWith('#/?');
if (onExplorer) prefetchFirstView(hash);

// The data engine (an 8 MB download, then a few hundred ms of set up) is for drawn areas, a clicked hexagon's series,
// place names under the pointer, the zoomed in map and the hotspot download: start it once the first view is under
// way, when the browser is idle.
const startEngine = () => { void getDb().catch(() => undefined); };
if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(startEngine, { timeout: onExplorer ? 2500 : 8000 });
else setTimeout(startEngine, onExplorer ? 1500 : 3000);   // Safari before 18 has no requestIdleCallback

const root = document.getElementById('root');
if (!root) throw new Error('Fire Harmony: the #root element is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
