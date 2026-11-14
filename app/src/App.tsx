import {
  Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type ErrorInfo, type MouseEvent, type PointerEvent, type ReactNode, type RefObject,
} from 'react';
import { DICTS, FIRMS_ACKNOWLEDGEMENT, I18nContext, type I18n } from './lib/i18n.ts';
import { ToastProvider, useToast } from './components/Toast.tsx';
import { Shortcuts } from './components/Shortcuts.tsx';
import { AskButton, Assistant, setAskOpen } from './components/Assistant.tsx';
import { assistantOn } from './lib/assistant.ts';
import { Tooltip } from './components/Tooltip.tsx';
import { MOD_KEY } from './components/platform.ts';
import {
  IconBook, IconCheck, IconChevronRight, IconClose, IconCode, IconDashboard, IconDatabase, IconExternal, IconInfo, IconMap, IconMenu, IconMoon,
  IconPoster, IconRanking, IconReport, IconSearch, IconSparkle, IconSun, IconWind,
} from './components/icons.tsx';
import { PALETTE_EVENT, panelSearchBox, useCommand } from './lib/commands.ts';
import { PROJECT_LINKS, PROJECT_ORDER, type ProjectLinkKey } from './lib/config.ts';
import { toggleTheme, useTheme } from './lib/theme.ts';
import { RESIZE_FROM, clampPanel, savedPanelWidth } from './components/explorer/panelSize.ts';

// The loading outline uses the classes of the shared building blocks (ui.css) directly: importing ui.tsx here would
// pull Observable Plot into the first download.
function Page({ children }: { children: ReactNode }) {
  return <div className="ui-page">{children}</div>;
}
function Skeleton({ height }: { height: number }) {
  return <div className="ui-skeleton" style={{ height }} aria-hidden="true" />;
}

// Pages load on demand: the explorer brings the map, the charts and the database; the text pages are small.
const Explorer = lazy(() => import('./pages/Explorer.tsx').then((m) => ({ default: m.Explorer })));
const Methods = lazy(() => import('./pages/Methods.tsx').then((m) => ({ default: m.Methods })));
const DataPage = lazy(() => import('./pages/Data.tsx').then((m) => ({ default: m.DataPage })));
const Haze = lazy(() => import('./pages/Haze.tsx').then((m) => ({ default: m.Haze })));
const Dashboard = lazy(() => import('./pages/Dashboard.tsx').then((m) => ({ default: m.Dashboard })));
const Rankings = lazy(() => import('./pages/Rankings.tsx').then((m) => ({ default: m.Rankings })));
// The command palette brings the place list (and the data code), so it loads the first time it is opened.
const CommandPalette = lazy(() => import('./components/CommandPalette.tsx').then((m) => ({ default: m.CommandPalette })));

type Route = 'explorer' | 'dashboard' | 'rankings' | 'haze' | 'methods' | 'data';

const ROUTES: readonly Route[] = ['explorer', 'dashboard', 'rankings', 'haze', 'methods', 'data'];
const HREF: Record<Route, string> = { explorer: '#/', dashboard: '#/dashboard', rankings: '#/rankings', haze: '#/haze', methods: '#/methods', data: '#/data' };

// The text of the shell (English only).
const T = {
  appName: 'Fire Harmony',
  appTitle: 'Fire Harmony: one fire record from MODIS and VIIRS',
  skip: 'Skip to content',
  navLabel: 'Main',
  nav: { explorer: 'Explorer', dashboard: 'Dashboard', rankings: 'Rankings', haze: 'Haze', methods: 'Methods', data: 'Data' } satisfies Record<Route, string>,
  dataTo: 'Data to',
  dataTitle: (first: string, last: string, now: string | null) =>
    `Full months from ${first} to ${last}.${now ? ` ${now} is still filling in.` : ''} Open the Data page for the sources and files.`,
  dataYears: (first: number, last: number) => `Data ${first} to ${last}`,
  menu: {
    open: 'Open the page menu',
    close: 'Close the menu',
    title: 'Pages',
    notes: {
      explorer: 'The map: fire in any place and month',
      dashboard: 'Every statistic in one place',
      rankings: 'Every place, sorted and filtered',
      haze: 'Where the smoke in Malaysia comes from',
      methods: 'How the record is made and tested',
      data: 'Sources, files and how to cite',
    } satisfies Record<Route, string>,
    version: (v: string) => `Data version ${v}`,
  },
  tagline: 'One consistent fire record from MODIS and VIIRS, from November 2000 to today.',
  made: 'Made for the NASA Space Apps Challenge 2026.',
  creditTitle: 'Data',
  credit: 'Fire hotspots from NASA FIRMS (MODIS Collection 6.1 and VIIRS 375 m). Rain from NASA GPM IMERG, weather and PM2.5 from NASA MERRA-2, fire weather from NASA GISS GFWED. Burned area from ESA Fire_cci, El Niño and Indian Ocean Dipole indices from NOAA. Base map from OpenFreeMap, © OpenStreetMap contributors.',
  linksTitle: 'Learn more',
  projectTitle: 'Project',
  newTab: 'opens in a new tab',
  search: {
    // on the Explorer the panel has its own place search: the header's box goes to pages and actions first
    explorerText: 'Go to…',
    explorerTip: 'Go to a page, an action or a place',
    explorerLabel: (mod: string) => `Go to a page, an action or a place (${mod} K)`,
    text: 'Search places',
    tip: 'Search places, pages and actions',
    label: (mod: string) => `Search places, pages and actions (${mod} K)`,
  },
  links: [
    { href: HREF.methods, label: 'Methods', note: 'How the record is made and tested' },
    { href: HREF.data, label: 'Data', note: 'Sources, files and how to cite' },
    { href: HREF.dashboard, label: 'Dashboard', note: 'Every statistic in one place' },
  ],
  version: (v: string, built: string) => `Data version ${v}, built ${built}.`,
  loading: 'Loading the page…',
  errorTitle: 'This page could not be shown',
  errorText: 'Something went wrong while loading it. Check your internet connection, then reload. The other pages still work.',
  details: 'Technical details',
  reload: 'Reload the page',
  toExplorer: 'Open the Explorer',
} as const;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLong = (ym: number) => `${MONTHS[(ym % 100) - 1] ?? ''} ${Math.floor(ym / 100)}`;
const monthShort = (ym: number) => `${(MONTHS[(ym % 100) - 1] ?? '').slice(0, 3)} ${Math.floor(ym / 100)}`;
/** yyyymm plus n months. */
function addMonths(ym: number, n: number): number {
  const t = Math.floor(ym / 100) * 12 + (ym % 100) - 1 + n;
  return Math.floor(t / 12) * 100 + (t % 12) + 1;
}

/** '#/methods' -> 'methods'; anything unknown (or empty) is the explorer. */
function routeOf(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return path === 'methods' || path === 'data' || path === 'haze' || path === 'dashboard' || path === 'rankings' ? path : 'explorer';
}

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function readHash(): string {
  return window.location.hash;
}

export function App() {
  const route = routeOf(useSyncExternalStore(subscribeHash, readHash));
  const i18n = useMemo<I18n>(() => ({ lang: 'en', t: DICTS.en, setLang: () => undefined }), []);
  const shell = useShellData();

  // Once opened, the explorer stays mounted (hidden on other pages) so the map and the choices survive.
  const [explorerOpened, setExplorerOpened] = useState(route === 'explorer');
  if (route === 'explorer' && !explorerOpened) setExplorerOpened(true);

  const mainRef = useRef<HTMLElement>(null);
  usePageEffects(route, mainRef);

  const skipToMain = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault(); // a plain '#main' link would change the route
    mainRef.current?.focus();
  };

  return (
    <I18nContext value={i18n}>
      <ToastProvider>
      <GlobalKeys />
      <PaletteHost />
      <Shortcuts />
      <div className="fh-app">
        <a className="fh-skip" href="#main" onClick={skipToMain}>{T.skip}</a>
        <Header route={route} shell={shell} />
        {assistantOn() ? <Assistant /> : null}
        <main id="main" ref={mainRef} className="fh-main" tabIndex={-1}>
          {/* .fh-route: each page fades in and rises 6 px when it opens (theme.css); the explorer replays it when it is
              shown again, since an element shown after display: none starts its animation anew */}
          {explorerOpened ? (
            <div className="fh-route" hidden={route !== 'explorer'}>
              <PageBoundary>
                <Suspense fallback={<ExplorerLoading />}>
                  <Explorer />
                </Suspense>
              </PageBoundary>
            </div>
          ) : null}
          {route !== 'explorer' ? (
            <div className="fh-route" key={route}>
              {route === 'dashboard' ? (
                <PageBoundary key="dashboard">
                  <Suspense fallback={<PageLoading />}>
                    <Dashboard />
                  </Suspense>
                </PageBoundary>
              ) : null}
              {route === 'rankings' ? (
                <PageBoundary key="rankings">
                  <Suspense fallback={<PageLoading />}>
                    <Rankings />
                  </Suspense>
                </PageBoundary>
              ) : null}
              {route === 'haze' ? (
                <PageBoundary key="haze">
                  <Suspense fallback={<PageLoading />}>
                    <Haze />
                  </Suspense>
                </PageBoundary>
              ) : null}
              {route === 'methods' ? (
                <PageBoundary key="methods">
                  <Suspense fallback={<PageLoading />}>
                    <Methods />
                  </Suspense>
                </PageBoundary>
              ) : null}
              {route === 'data' ? (
                <PageBoundary key="data">
                  <Suspense fallback={<PageLoading />}>
                    <DataPage />
                  </Suspense>
                </PageBoundary>
              ) : null}
            </div>
          ) : null}
        </main>
        <Footer shell={shell} />
      </div>
      </ToastProvider>
    </I18nContext>
  );
}

/** Loads the command palette: at idle time after the first view (so the first Ctrl+K opens at once), or the first time
 *  someone asks for it (Ctrl or Cmd+K, "/", the search button: PALETTE_EVENT). Keys typed while its code still loads
 *  go into its search box (Escape cancels the opening), never to the page's shortcuts. */
function PaletteHost() {
  const [loaded, setLoaded] = useState(false);
  const typed = useRef<string | null>(null);   // what was typed while the code loads; null: no opening waits
  const handed = useRef(false);                // the palette has shown up and taken over its keys
  useEffect(() => {
    const load = () => { void import('./components/CommandPalette.tsx').catch(() => undefined); };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(load, { timeout: 8000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(load, 5000);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    if (loaded) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      const modK = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey) && !e.altKey;
      const slash = e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !document.querySelector('[aria-modal="true"], dialog[open]');
      if (slash && panelSearchBox()) { e.preventDefault(); panelSearchBox()?.focus(); return; }   // the Explorer's own search
      if (modK || slash) { e.preventDefault(); typed.current = ''; setLoaded(true); }
    };
    const onOpen = (e: Event) => { typed.current = (e as CustomEvent<{ query?: string } | null>).detail?.query ?? ''; setLoaded(true); };
    window.addEventListener('keydown', onKey);
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(PALETTE_EVENT, onOpen); };
  }, [loaded]);
  useEffect(() => {
    if (!loaded) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (handed.current || e.isComposing) return;
      const modK = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey) && !e.altKey;
      if (typed.current === null) {
        if (!modK) return;
        typed.current = '';                       // opened again while the code still loads
      } else if (modK || e.key === 'Escape') typed.current = null;
      else if (e.key === 'Backspace') typed.current = typed.current.slice(0, -1);
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typed.current += e.key;
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [loaded]);
  const take = useCallback(() => { const t = typed.current; typed.current = null; handed.current = true; return t; }, []);
  if (!loaded) return null;
  return <Suspense fallback={null}><CommandPalette initialOpen takeTyped={take} /></Suspense>;
}

/** Shortcuts that work on every page: T switches the theme (not while a dialog is open). The theme command also comes
 *  from the palette. */
function GlobalKeys() {
  const toast = useToast();
  const flip = () => { toggleTheme(); toast(`Switched to ${document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'} mode`, 'info'); };
  useCommand((c) => { if (c.action === 'toggle-theme') flip(); });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (e.defaultPrevented || typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      if (e.key === 't' || e.key === 'T') flip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return null;
}

/** Page title, and focus on the new page after a route change (not on first load). */
function usePageEffects(route: Route, mainRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    document.title = route === 'explorer' ? T.appTitle : `${T.nav[route]} · ${T.appName}`;
  }, [route]);

  const shownRoute = useRef(route);
  useEffect(() => {
    if (shownRoute.current === route) return;
    shownRoute.current = route;
    window.scrollTo({ top: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }, [route, mainRef]);
}

// ------------------------------------------------------------------------------------------------ shell data

interface ShellData {
  firstFull: number | null;   // yyyymm of the first full month
  lastFull: number | null;    // yyyymm of the latest full month
  current: number | null;     // yyyymm of a month that is still filling in, if any
  firstYear: number | null; lastYear: number | null;
  version: string | null; built: string | null;
}

const EMPTY: ShellData = { firstFull: null, lastFull: null, current: null, firstYear: null, lastYear: null, version: null, built: null };

/** The months covered (dashboard.json, else meta.json) and the data version (meta.json), for the header and footer.
 *  data.ts is imported on demand so the database code stays out of the first download. */
function useShellData(): ShellData {
  const [data, setData] = useState<ShellData>(EMPTY);
  useEffect(() => {
    let alive = true;
    void import('./lib/data.ts').then(async ({ loadDashboard, loadMeta }) => {
      const [meta, dash] = await Promise.allSettled([loadMeta(), loadDashboard()]);
      if (!alive) return;
      const next: ShellData = { ...EMPTY };
      if (meta.status === 'fulfilled') {
        const m = meta.value;
        next.firstYear = Math.floor(m.first_month / 100);
        next.lastYear = Math.floor(m.last_month / 100);
        next.version = m.version;
        const built = new Date(m.built_utc);
        next.built = Number.isNaN(built.getTime()) ? null
          : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(built);
      }
      if (dash.status === 'fulfilled') {
        const r = dash.value.record;
        next.lastFull = r.latest_full_month;
        next.firstFull = addMonths(r.latest_full_month, -(r.months - 1));
        next.current = r.last_month > r.latest_full_month ? r.last_month : null;
        next.firstYear ??= Math.floor(r.first_month / 100);
        next.lastYear ??= Math.floor(r.last_month / 100);
      }
      setData(next);
    }).catch(() => undefined);   // the badge and the version line are extras: the pages report their own errors
    return () => { alive = false; };
  }, []);
  return data;
}

// ------------------------------------------------------------------------------------------------ header

function Header({ route, shell }: { route: Route; shell: ShellData }) {
  const header = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 2);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useHeaderAutoHide(header, menuOpen);
  const onMap = route === 'explorer';
  const searchLabel = onMap ? T.search.explorerLabel(MOD_KEY) : T.search.label(MOD_KEY);
  return (
    <header ref={header} className="fh-header" data-scrolled={scrolled ? '' : undefined}>
      <div className="fh-header-inner">
        {/* On phones and tablets the open page is named under the brand (the page's own title says it to screen
            readers, so this line is hidden from them; it is not part of the link, which opens the Explorer). */}
        <div className="fh-brand-wrap">
          <a className="fh-brand" href={HREF.explorer}>
            <BrandMark />
            <span className="fh-brand-name">{T.appName}</span>
          </a>
          <span key={route} className="fh-brand-page" aria-hidden="true">{T.nav[route]}</span>
        </div>
        <nav className="fh-nav" aria-label={T.navLabel}>
          <ul>
            {ROUTES.map((r) => (
              <li key={r}>
                <a href={HREF[r]} aria-current={r === route ? 'page' : undefined}>
                  <span className="fh-nav-icon">{NAV_ICON[r]}</span>
                  <span className="fh-nav-label" data-label={T.nav[r]}>{T.nav[r]}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="fh-header-tools">
          <Tooltip content={onMap ? T.search.explorerTip : T.search.tip} keys={[MOD_KEY, 'K']} describe={false}>
            <button type="button" className="fh-search-trigger ui-press" onClick={() => window.dispatchEvent(new Event('fh:open-palette'))}
              aria-label={searchLabel} aria-keyshortcuts="Control+K Meta+K">
              <IconSearch size={16} />
              <span className="fh-search-trigger-text">{onMap ? T.search.explorerText : T.search.text}</span>
              <span className="fh-search-trigger-keys" aria-hidden="true"><kbd className="ui-kbd">{MOD_KEY}</kbd><kbd className="ui-kbd">K</kbd></span>
            </button>
          </Tooltip>
          {assistantOn() ? <AskButton /> : null}
          <DataBadge shell={shell} />
          <ThemeButton />
          <Tooltip content={T.menu.open} describe={false}>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon fh-menu-btn" aria-label={T.menu.open} aria-haspopup="dialog"
              aria-expanded={menuOpen} aria-controls="fh-menu" onClick={() => setMenuOpen(true)}>
              <IconMenu size={20} />
            </button>
          </Tooltip>
        </div>
      </div>
      <PageMenu open={menuOpen} route={route} shell={shell} onClosed={() => setMenuOpen(false)} />
    </header>
  );
}

const NAV_ICON: Record<Route, ReactNode> = {
  explorer: <IconMap size={16} />, dashboard: <IconDashboard size={16} />, rankings: <IconRanking size={16} />, haze: <IconWind size={16} />,
  methods: <IconBook size={16} />, data: <IconDatabase size={16} />,
};
const MENU_ICON: Record<Route, ReactNode> = {
  explorer: <IconMap size={20} />, dashboard: <IconDashboard size={20} />, rankings: <IconRanking size={20} />, haze: <IconWind size={20} />,
  methods: <IconBook size={20} />, data: <IconDatabase size={20} />,
};

const PROJECT_ICON: Record<ProjectLinkKey, ReactNode> = {
  report: <IconReport size={20} />, poster: <IconPoster size={20} />, code: <IconCode size={20} />, dataset: <IconDatabase size={20} />, hub: <IconInfo size={20} />,
};

/** A link to the rest of the project: a file or a site of its own opens in a new tab (and says so). */
function ProjectLink({ k, className, style, onClick, children }: {
  k: ProjectLinkKey; className?: string; style?: CSSProperties; onClick?: () => void; children: ReactNode;
}) {
  const l = PROJECT_LINKS[k];
  return l.external
    ? <a className={className} style={style} href={l.href} target="_blank" rel="noopener" onClick={onClick} aria-label={`${l.label} (${T.newTab})`}>{children}</a>
    : <a className={className} style={style} href={l.href} onClick={onClick}>{children}</a>;
}

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']);

/** On phones and tablets the header slides away while you read down the page, and comes back as soon as you scroll
 *  up, reach the top, or move the keyboard focus into it. Never under reduced motion, or while the menu is open.
 *  Only the reader's own scrolling moves it (a finger, a wheel or the scroll keys): a scroll that the page starts
 *  itself, such as a jump to a section, leaves the header as it was, so the offset the page measured for the jump
 *  stays right and the section title never ends up under the bars.
 *  The state is html[data-header-hidden] (CSS moves the header; the sticky bars under it follow once stuck). */
function useHeaderAutoHide(header: RefObject<HTMLElement | null>, locked: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    const small = window.matchMedia('(max-width: 880px)');
    let hidden = root.dataset.headerHidden !== undefined;
    let last = window.scrollY, travel = 0, raf = 0, instant = 0;
    let byReader = 0;   // until this time, the scroll is the reader's (it is extended while the page keeps moving)
    const reader = () => { byReader = performance.now() + 500; };
    const notReader = () => { byReader = 0; };
    const set = (h: boolean) => {
      if (h === hidden) return;
      hidden = h;
      if (h) root.dataset.headerHidden = ''; else delete root.dataset.headerHidden;
    };
    const focusInside = () => !!header.current?.contains(document.activeElement);
    const update = () => {
      raf = 0;
      const y = Math.max(0, window.scrollY);
      const dy = y - last;
      last = y;
      if (!small.matches || reduceMotion() || locked || y < 64 || focusInside()) { travel = 0; set(false); return; }
      if (performance.now() >= byReader) { travel = 0; return; }   // the page scrolled itself: keep the header as it is
      // a few pixels of travel in one direction first, so a jittery finger does not make it flicker
      travel = Math.sign(dy) === Math.sign(travel) ? travel + dy : dy;
      if (travel > 12) set(true);
      else if (travel < -6) set(false);
    };
    const onScroll = () => {
      if (performance.now() < byReader) reader();   // the glide after the finger lifts is still the reader's
      if (!raf) raf = requestAnimationFrame(update);
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      const own = t?.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="listbox"], [role="grid"]')
        || (e.key === ' ' && t?.closest('button, a, summary, [role="button"], [role="tab"]'));
      if (SCROLL_KEYS.has(e.key) && !own && !e.altKey && !e.ctrlKey && !e.metaKey) reader(); else notReader();
    };
    // a new window width (a phone turned): show it at once, so the bars under it measure it in place. A new height
    // alone is the browser's own toolbar sliding away as the reader scrolls: that changes nothing here.
    let width = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      root.dataset.headerInstant = '';
      set(false);
      window.clearTimeout(instant);
      instant = window.setTimeout(() => { delete root.dataset.headerInstant; }, 300);
    };
    const onFocus = () => { if (hidden && focusInside()) set(false); };
    const opts = { passive: true, capture: true } as const;
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('wheel', reader, opts);
    window.addEventListener('touchmove', reader, opts);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', notReader, true);   // a tap or click starts no scroll of the reader's own
    document.addEventListener('focusin', onFocus);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(instant);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('wheel', reader, opts);
      window.removeEventListener('touchmove', reader, opts);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', notReader, true);
      document.removeEventListener('focusin', onFocus);
    };
  }, [header, locked]);
}

/** The page menu of phones and tablets: a sheet from the bottom on a phone (drag it down, tap outside or press
 *  Escape to close), a panel under the menu button on a tablet. A native modal dialog, so focus stays inside. */
function PageMenu({ open, route, shell, onClosed }: { open: boolean; route: Route; shell: ShellData; onClosed: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number; id: number } | null>(null);

  const close = useCallback(() => {
    const d = dlg.current;
    if (!d?.open || d.dataset.closing !== undefined) return;
    if (reduceMotion()) { d.close(); return; }
    d.dataset.closing = '';
    window.setTimeout(() => { delete d.dataset.closing; d.close(); if (sheet.current) sheet.current.style.transform = ''; }, 150);
  }, []);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>('a[aria-current="page"]')?.focus();
    } else if (!open && d.open) close();
  }, [open, close]);

  // a wider window has the page links in the header: the menu closes
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 881px)');
    const onChange = () => { if (wide.matches) close(); };
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, [close]);

  // drag the sheet down by its top bar to close it (phones)
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!window.matchMedia('(max-width: 560px)').matches || (e.target as HTMLElement).closest('button')) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current, s = sheet.current;
    if (!d || !s || e.pointerId !== d.id) return;
    d.dy = Math.max(0, e.clientY - d.y);
    s.style.transition = 'none';
    s.style.transform = `translateY(${d.dy}px)`;
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current, s = sheet.current;
    drag.current = null;
    if (!d || !s || e.pointerId !== d.id) return;
    const speed = d.dy / Math.max(1, performance.now() - d.t);
    if (d.dy > 72 || (d.dy > 16 && speed > 0.5)) { close(); return; }
    s.style.transition = 'transform var(--t-med) var(--ease-out)';
    s.style.transform = '';
  };

  return (
    <dialog ref={dlg} id="fh-menu" className="fh-menu" aria-labelledby="fh-menu-title" onClose={onClosed}
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={sheet} className="fh-menu-sheet">
        <div className="fh-menu-drag" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <span className="fh-menu-grip" aria-hidden="true" />
          <div className="fh-menu-head">
            <p className="fh-menu-title" id="fh-menu-title">{T.menu.title}</p>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon" aria-label={T.menu.close} onClick={close}>
              <IconClose size={20} />
            </button>
          </div>
        </div>
        <nav aria-label={T.navLabel}>
          <ul className="fh-menu-list">
            {ROUTES.map((r, i) => (
              <li key={r}>
                <a href={HREF[r]} aria-current={r === route ? 'page' : undefined} onClick={close} style={{ '--i': i } as CSSProperties}>
                  <span className="fh-menu-icon" aria-hidden="true">{MENU_ICON[r]}</span>
                  <span className="fh-menu-text">
                    <span className="fh-menu-name">{T.nav[r]}</span>
                    <span className="fh-menu-note">{T.menu.notes[r]}</span>
                  </span>
                  <span className="fh-menu-end" aria-hidden="true">{r === route ? <IconCheck size={18} /> : <IconChevronRight size={18} />}</span>
                </a>
              </li>
            ))}
            {assistantOn() ? (
              <li className="fh-menu-ask">
                <a href="#ask" role="button" onClick={(e) => { e.preventDefault(); close(); setAskOpen(true); }} style={{ '--i': ROUTES.length } as CSSProperties}>
                  <span className="fh-menu-icon" aria-hidden="true"><IconSparkle size={18} /></span>
                  <span className="fh-menu-text">
                    <span className="fh-menu-name">Ask Fire Harmony</span>
                    <span className="fh-menu-note">Questions about any place, answered from the data (AI)</span>
                  </span>
                  <span className="fh-menu-end" aria-hidden="true"><IconChevronRight size={18} /></span>
                </a>
              </li>
            ) : null}
          </ul>
        </nav>
        <nav aria-labelledby="fh-menu-project">
          <p className="fh-menu-group" id="fh-menu-project">{T.projectTitle}</p>
          <ul className="fh-menu-list fh-menu-project">
            {PROJECT_ORDER.map((k, i) => (
              <li key={k}>
                <ProjectLink k={k} onClick={close} style={{ '--i': ROUTES.length + i } as CSSProperties}>
                  <span className="fh-menu-icon" aria-hidden="true">{PROJECT_ICON[k]}</span>
                  <span className="fh-menu-text">
                    <span className="fh-menu-name">{PROJECT_LINKS[k].label}</span>
                    <span className="fh-menu-note">{PROJECT_LINKS[k].note}</span>
                  </span>
                  <span className="fh-menu-end" aria-hidden="true">{PROJECT_LINKS[k].external ? <IconExternal size={16} /> : <IconChevronRight size={18} />}</span>
                </ProjectLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="fh-menu-foot">
          <DataBadge shell={shell} tip={false} />
          {shell.version ? <span>{T.menu.version(shell.version)}</span> : null}
        </div>
      </div>
    </dialog>
  );
}

function ThemeButton() {
  const theme = useTheme();
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <Tooltip content={label} keys={['T']}>
      <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon fh-theme-btn" aria-label={label} aria-keyshortcuts="T" onClick={() => toggleTheme()}>
        {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
      </button>
    </Tooltip>
  );
}

function DataBadge({ shell, tip = true }: { shell: ShellData; tip?: boolean }) {
  const { firstFull, lastFull, current, firstYear, lastYear } = shell;
  if (lastFull !== null && firstFull !== null) {
    const badge = (
      <a className="fh-data-badge" href={HREF.data}>
        <CalendarIcon />
        <span>{T.dataTo} <time dateTime={`${Math.floor(lastFull / 100)}-${String(lastFull % 100).padStart(2, '0')}`}>{monthShort(lastFull)}</time></span>
      </a>
    );
    return tip ? <Tooltip content={T.dataTitle(monthLong(firstFull), monthLong(lastFull), current ? monthLong(current) : null)}>{badge}</Tooltip> : badge;
  }
  if (firstYear !== null && lastYear !== null) {
    return <a className="fh-data-badge" href={HREF.data}><CalendarIcon /><span>{T.dataYears(firstYear, lastYear)}</span></a>;
  }
  return <span className="fh-data-badge fh-data-badge-empty" aria-hidden="true" />;
}

function CalendarIcon() {
  return (
    <svg className="fh-data-badge-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
      <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2" />
      <path d="M2.5 6.75h11M5.5 1.75v3M10.5 1.75v3" strokeLinecap="round" />
    </svg>
  );
}

function BrandMark() {
  return (
    <svg className="fh-brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path className="fh-mark-hex" d="M16 1.5 28.6 8.75v14.5L16 30.5 3.4 23.25V8.75z" />
      <path
        className="fh-mark-flame"
        d="M16 7c1.5 3.5 5.5 5.8 5.5 10.6a5.5 5.5 0 0 1-11 0c0-2.4 1.2-4 2.5-5.2.1 1.7.9 2.9 2.1 3.4C14.6 12.8 15 9.8 16 7z"
      />
    </svg>
  );
}

// ------------------------------------------------------------------------------------------------ footer

function Footer({ shell }: { shell: ShellData }) {
  return (
    <footer className="fh-footer">
      <div className="fh-footer-inner">
        <div className="fh-footer-brand">
          <a className="fh-brand" href={HREF.explorer}>
            <BrandMark />
            <span className="fh-brand-name">{T.appName}</span>
          </a>
          <p>{T.tagline}</p>
          <p>{T.made}</p>
        </div>
        <div className="fh-footer-col">
          <p className="fh-footer-title">{T.creditTitle}</p>
          <p>{T.credit}</p>
        </div>
        <nav className="fh-footer-col" aria-label={T.linksTitle}>
          <p className="fh-footer-title">{T.linksTitle}</p>
          <ul className="fh-footer-links">
            {T.links.map((l) => (
              <li key={l.href}><a href={l.href}>{l.label}</a><span>{l.note}</span></li>
            ))}
          </ul>
        </nav>
        <nav className="fh-footer-col" aria-label={T.projectTitle}>
          <p className="fh-footer-title">{T.projectTitle}</p>
          <ul className="fh-footer-links fh-footer-project">
            {PROJECT_ORDER.map((k) => (
              <li key={k}>
                <ProjectLink k={k}>{PROJECT_LINKS[k].label}{PROJECT_LINKS[k].external ? <IconExternal size={13} className="fh-footer-ext" /> : null}</ProjectLink>
                <span>{PROJECT_LINKS[k].note}</span>
              </li>
            ))}
          </ul>
        </nav>
        <div className="fh-footer-base">
          <p>{FIRMS_ACKNOWLEDGEMENT}</p>
          {shell.version && shell.built ? <p>{T.version(shell.version, shell.built)}</p> : null}
        </div>
      </div>
    </footer>
  );
}

// ------------------------------------------------------------------------------------------------ loading and errors

/** A quiet outline of a page while its code loads (same layout as the pages, so nothing jumps). */
function PageLoading() {
  return (
    <Page>
      <div className="fh-page-loading" role="status">
        <span className="sr-only">{T.loading}</span>
        <div className="fh-page-loading-head" aria-hidden="true">
          <div style={{ width: 96 }}><Skeleton height={12} /></div>
          <div style={{ width: 'min(520px, 80%)' }}><Skeleton height={30} /></div>
          <div style={{ width: 'min(720px, 100%)' }}><Skeleton height={16} /></div>
        </div>
        <div className="fh-page-loading-grid" aria-hidden="true">
          <Skeleton height={112} /><Skeleton height={112} /><Skeleton height={112} />
        </div>
        <div aria-hidden="true"><Skeleton height={300} /></div>
      </div>
    </Page>
  );
}

/** The Explorer's outline while its code loads, in its own layout (styles in app.css, since explorer.css comes with that
 *  code): the map's ground, the area panel at its inset and width with the parts it will show, and the timeline dock
 *  at the bottom; on a phone the bottom sheet at its half height. No site footer meanwhile (the map is the page). */
function ExplorerLoading() {
  // (the width the reader gave the panel, explorer/panelSize.ts: the outline has it too, so nothing jumps on load)
  const saved = window.innerWidth >= RESIZE_FROM ? savedPanelWidth() : null;
  const style = saved === null ? undefined : ({ ['--panel-w' as string]: `${clampPanel(saved)}px` } as CSSProperties);
  return (
    <div className="fh-ex-boot" role="status" aria-busy="true" style={style}>
      <span className="sr-only">{T.loading}</span>
      <div className="fh-ex-boot-panel" aria-hidden="true">
        <div className="fh-ex-boot-row"><Skeleton height={44} /><div style={{ width: 86 }}><Skeleton height={44} /></div></div>
        <div className="fh-ex-boot-chips"><Skeleton height={32} /><Skeleton height={32} /><Skeleton height={32} /></div>
        <div className="fh-ex-boot-line" />
        <div style={{ width: 120 }}><Skeleton height={12} /></div>
        <div style={{ width: '70%' }}><Skeleton height={24} /></div>
        <Skeleton height={74} />
        <div className="fh-ex-boot-chips"><Skeleton height={28} /><Skeleton height={28} /><Skeleton height={28} /><Skeleton height={28} /></div>
        <Skeleton height={190} />
      </div>
      <div className="fh-ex-boot-dock" aria-hidden="true"><div style={{ width: 44 }}><Skeleton height={44} /></div><Skeleton height={44} /></div>
    </div>
  );
}

function PageError({ message }: { message: string }) {
  return (
    <Page>
      <div className="fh-error fh-page-error" role="alert">
        <svg className="fh-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9.5" />
          <path d="M12 7v6M12 16.5v.5" />
        </svg>
        <div className="fh-error-body">
          <p className="fh-error-title">{T.errorTitle}</p>
          <p>{T.errorText}</p>
          <details>
            <summary>{T.details}</summary>
            <code>{message}</code>
          </details>
          <div className="fh-page-error-actions">
            <button type="button" className="fh-btn" onClick={() => window.location.reload()}>{T.reload}</button>
            <a className="fh-btn fh-btn-quiet" href={HREF.explorer}>{T.toExplorer}</a>
          </div>
        </div>
      </div>
    </Page>
  );
}

interface BoundaryProps { children: ReactNode }
interface BoundaryState { message: string | null }

/** Keeps the header and the other pages alive if a page fails to load or render. */
class PageBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Fire Harmony: a page failed', error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.message === null ? this.props.children : <PageError message={this.state.message} />;
  }
}
