// Command palette: press Ctrl+K (Cmd+K on a Mac, or "/") anywhere to jump to a place, a city, a page or an action.
// It works like Raycast or Linear: one search box, results in groups (Recent, Places, Actions, Pages) with the matched
// letters in bold, the active row always in view, and the same place search as the Explorer's panel (lib/search.ts).
// It also reads coordinates ("-2.2, 113.9": a circle there) and months ("sep 2019": that month on the map).
// Keyboard: type to filter, up and down (Page Up, Page Down, Home, End) to move, Enter to run, Escape to close.
// Touch screens get a close button and no key hints.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react';
import {
  markedParts, matchLabel, matchRank, parseCoords, parseMonth, pointHit, recentPlaces, rememberPlace, searchAreas,
  useFittingPlaceholder, useRecentVersion, useSearchIndex, type HitKind, type MatchKind, type RecentPlace, type SearchHit,
} from '../lib/search';
import { EXPLORER_ACTIONS, onExplorerPage, openArea, openLink, PALETTE_EVENT, panelSearchBox, runCommand, type Command } from '../lib/commands';
import {
  IconActivity, IconBook, IconCalendar, IconChart, IconCircle, IconClose, IconCode, IconCube, IconDashboard, IconDatabase, IconDownload,
  IconExternal, IconFlame, IconGlobe, IconInfo, IconKeyboard, IconLayers, IconMap, IconPlay, IconPolygon, IconPoster, IconReport, IconSearch,
  IconSquare, IconStepBack, IconStepForward, IconSun, IconTarget, IconWind, IconRanking,
} from './icons';
import { MOD_KEY } from './platform';
import { PROJECT_LINKS, type ProjectLinkKey } from '../lib/config';
import '../styles/palette.css';

type GroupKey = 'recent' | 'try' | 'places' | 'actions' | 'pages' | 'project';
const GROUP_TITLE: Record<GroupKey, string> = { recent: 'Recent', try: 'Try', places: 'Places', actions: 'Actions', pages: 'Pages', project: 'Project' };
/** Searches to try in an empty palette (a pick types them in): what the search understands besides place names. */
const TRY: { q: string; hint: string }[] = [
  { q: 'Borneo', hint: 'An island: every province on it' },
  { q: 'Palangka Raya', hint: 'A city: the 50 km around it' },
  { q: 'Sep 2015', hint: 'A month: the map of September 2015' },
];
const PLACE_LIMIT = 8;
const CLOSE_MS = 100;

interface Item {
  id: string;
  group: GroupKey;
  label: string;
  marks: [number, number][];
  hint: string;
  icon: ReactElement;
  keys?: string[];
  rank: number;
  run: () => void;
  keepOpen?: boolean;   // a suggestion types its text in, and the palette stays open
  explorer?: boolean;   // an action on the map (on another page it opens the Explorer first)
}

interface PageDef { label: string; hint: string; href: string; icon: ReactElement; words: string[] }
const PAGES: PageDef[] = [
  { label: 'Explorer', hint: 'The map, the burning calendar, any area', href: '#/', icon: <IconMap />, words: ['map', 'home'] },
  { label: 'Dashboard', hint: 'Every statistic of the record', href: '#/dashboard', icon: <IconDashboard />, words: ['statistics', 'numbers', 'analytics'] },
  { label: 'Rankings', hint: 'Every place, sorted and filtered', href: '#/rankings', icon: <IconRanking />, words: ['rank', 'top', 'list', 'compare', 'screener', 'table'] },
  { label: 'Haze', hint: 'Smoke in Malaysian and nearby cities', href: '#/haze', icon: <IconWind />, words: ['smoke', 'pm2.5', 'air'] },
  { label: 'Methods', hint: 'How the record is made and tested', href: '#/methods', icon: <IconBook />, words: ['how', 'model', 'science'] },
  { label: 'Data', hint: 'Sources, files and how to cite', href: '#/data', icon: <IconDatabase />, words: ['download', 'files', 'cite', 'sources'] },
];

/** The rest of the project (lib/config.ts PROJECT_LINKS): the report, the poster, the code, the dataset, the hub. */
interface ProjectDef { label: string; link: ProjectLinkKey; icon: ReactElement; words: string[] }
const PROJECT: ProjectDef[] = [
  { label: 'Open the report', link: 'report', icon: <IconReport />, words: ['pdf', 'paper', 'methods', 'read', 'document'] },
  { label: 'Open the poster', link: 'poster', icon: <IconPoster />, words: ['pdf', 'summary', 'one page'] },
  { label: 'Open the code', link: 'code', icon: <IconCode />, words: ['github', 'source', 'repository', 'python'] },
  { label: 'Open the dataset', link: 'dataset', icon: <IconDatabase />, words: ['hugging face', 'files', 'download', 'parquet'] },
  { label: 'About the project', link: 'hub', icon: <IconInfo />, words: ['hub', 'team', 'home', 'video', 'overview'] },
];
const openProject = (k: ProjectLinkKey) => {
  const l = PROJECT_LINKS[k];
  if (l.external) window.open(l.href, '_blank', 'noopener'); else window.location.href = l.href;
};

interface ActionDef { label: string; keys?: string[]; cmd: Command | 'world'; icon: ReactElement; words: string[]; fine?: boolean }
const ACTIONS: ActionDef[] = [
  { label: 'Play the months', keys: ['Space'], cmd: { action: 'play-toggle' }, icon: <IconPlay />, words: ['pause', 'animate', 'timelapse'] },
  { label: 'Switch 2D or 3D hexagons', keys: ['D'], cmd: { action: 'toggle-3d' }, icon: <IconCube />, words: ['3d', '2d', 'tilt', 'columns'] },
  { label: 'Colour by fire count', keys: ['C'], cmd: { action: 'colour', mode: 'count' }, icon: <IconFlame />, words: ['color', 'hotspots'] },
  { label: 'Colour against normal', keys: ['A'], cmd: { action: 'colour', mode: 'anomaly' }, icon: <IconLayers />, words: ['anomaly', 'unusual', 'color'] },
  { label: 'Colour by trend, 2001 to 2025', keys: ['R'], cmd: { action: 'colour', mode: 'trend' }, icon: <IconActivity />, words: ['trend', 'rising', 'falling', 'decade', 'change', 'color'] },
  { label: 'Show the harmonized record', cmd: { action: 'scale', scale: 'harmonized' }, icon: <IconChart />, words: ['scale', 'noaa-20', 'viirs'] },
  { label: 'Show the MODIS scale', cmd: { action: 'scale', scale: 'modis' }, icon: <IconChart />, words: ['scale', 'terra', 'aqua'] },
  { label: 'Show the raw detections', cmd: { action: 'scale', scale: 'raw' }, icon: <IconChart />, words: ['scale', 'sensors', 'satellites'] },
  { label: 'Previous month', keys: ['←'], cmd: { action: 'step-month', by: -1 }, icon: <IconStepBack />, words: ['back', 'earlier'] },
  { label: 'Next month', keys: ['→'], cmd: { action: 'step-month', by: 1 }, icon: <IconStepForward />, words: ['forward', 'later'] },
  { label: 'Draw a rectangle on the map', cmd: { action: 'draw', mode: 'rectangle' }, icon: <IconSquare />, words: ['box', 'area', 'select'] },
  { label: 'Draw a polygon on the map', cmd: { action: 'draw', mode: 'polygon' }, icon: <IconPolygon />, words: ['shape', 'area', 'select'] },
  { label: 'Show the whole world', cmd: 'world', icon: <IconGlobe />, words: ['global', 'earth', 'reset'] },
  { label: 'Download this area as CSV', cmd: { action: 'download-csv' }, icon: <IconDownload />, words: ['export', 'save', 'spreadsheet'] },
  { label: 'Pin this place to compare', cmd: { action: 'compare-pin' }, icon: <IconLayers />, words: ['compare', 'pin', 'together', 'versus'] },
  { label: 'Clear the places pinned to compare', cmd: { action: 'compare-clear' }, icon: <IconLayers />, words: ['compare', 'unpin', 'remove'], fine: true },
  { label: 'Copy a link to this view', cmd: { action: 'copy-link' }, icon: <IconExternal />, words: ['share', 'url'] },
  { label: 'Switch light or dark', keys: ['T'], cmd: { action: 'toggle-theme' }, icon: <IconSun />, words: ['theme', 'mode', 'night'] },
  { label: 'Keyboard shortcuts', keys: ['?'], cmd: { action: 'show-shortcuts' }, icon: <IconKeyboard />, words: ['keys', 'help'], fine: true },
];

const PLACE_ICON: Record<HitKind, ReactElement> = {
  world: <IconGlobe />, continent: <IconGlobe />, country: <IconGlobe />, state: <IconPolygon />, city: <IconTarget />, point: <IconCircle />,
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const coarsePointer = () => window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false;
const routeOf = (hash: string) => (hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '');

function openPlace(p: Pick<SearchHit, 'key' | 'kind' | 'label' | 'hint' | 'link' | 'selection'>): void {
  rememberPlace(p);
  if (p.selection.type === 'named') openArea(p.selection.area.kind, p.selection.area.id);
  else openLink(p.link);
}

function Marked({ text, marks }: { text: string; marks: readonly [number, number][] }) {
  if (!marks.length) return <>{text}</>;
  return <>{markedParts(text, marks).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</>;
}

export interface CommandPaletteProps {
  /** Open at once (the first Ctrl+K loads this code). */
  initialOpen?: boolean;
  /** Text typed while this code was loading; null when the opening was cancelled (Escape) meanwhile. */
  takeTyped?: () => string | null;
}

export function CommandPalette({ initialOpen = false, takeTyped }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [hash, setHash] = useState(() => window.location.hash);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const before = useRef<HTMLElement | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const closeTimer = useRef(0);
  const listId = 'fh-palette-list';

  const show = (query = '') => {
    window.clearTimeout(closeTimer.current);
    if (!open || closing) before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setHash(window.location.hash);
    setClosing(false);
    setQ(query);
    setActive(0);
    setOpen(true);
  };
  /** Closes (with a short fade). Focus goes back where it was, unless an item ran (it moves the focus itself). */
  const close = (restore: boolean) => {
    if (!open || closing) return;
    const done = () => {
      setOpen(false);
      setClosing(false);
      if (restore && before.current?.isConnected) before.current.focus({ preventScroll: true });
    };
    if (reduceMotion()) { done(); return; }
    // while it fades out, keys go to the page again (and Ctrl+K opens it again at once)
    if (dialog.current?.contains(document.activeElement) && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setClosing(true);
    closeTimer.current = window.setTimeout(done, CLOSE_MS);
  };

  // the first opening: the text typed while the code loaded goes into the box
  useLayoutEffect(() => {
    if (!initialOpen) return;
    const typed = takeTyped ? takeTyped() : '';
    if (typed !== null) show(typed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // open from anywhere: Ctrl or Cmd+K, "/" outside a text box, or the search buttons (PALETTE_EVENT)
  const openRef = useRef(false);
  openRef.current = open && !closing;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        if (openRef.current) close(true); else show();
      } else if (e.key === '/' && !openRef.current && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey
        && !document.querySelector('[aria-modal="true"], dialog[open]')) {
        e.preventDefault();
        const box = panelSearchBox();
        if (box) box.focus(); else show();
      } else if (e.key === 'Escape' && openRef.current) {
        e.preventDefault();   // focus outside the palette (it never should be): Escape still closes it
        close(true);
      }
    };
    const onOpen = (e: Event) => { show((e as CustomEvent<{ query?: string } | null>).detail?.query ?? ''); };
    window.addEventListener('keydown', onKey);
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(PALETTE_EVENT, onOpen); };
  });

  // the box has the focus from the first frame, so every key typed after Ctrl+K lands in it
  useLayoutEffect(() => {
    if (open && !closing) input.current?.focus({ preventScroll: true });
  }, [open, closing]);

  const index = useSearchIndex(open);
  const ready = index !== null;
  const recentVersion = useRecentVersion();
  const recents = useMemo<RecentPlace[]>(() => (open ? recentPlaces(index) : []), [open, index, recentVersion]);
  // the results always belong to the text in the box (a few ms per key), so Enter never opens an older result
  const hits = useMemo(() => searchAreas(q, PLACE_LIMIT, index), [q, index]);
  const placeholder = useFittingPlaceholder(input, [
    'Search places, cities, pages and actions', 'Search places, cities and pages', 'Search places and pages', 'Search',
  ], open && !closing);

  const items = useMemo<Item[]>(() => {
    if (!open) return [];
    const here = routeOf(hash);
    const coarse = coarsePointer();
    const query = q.trim();
    const out: Item[] = [];
    const place = (h: SearchHit | RecentPlace, group: GroupKey, marks: [number, number][], rank: number): Item => ({
      id: `${group}-${h.key}`, group, label: h.label, marks, hint: h.hint, icon: PLACE_ICON[h.kind], rank, run: () => openPlace(h),
    });
    // an action on the map says once, on its group, that it opens the Explorer (see the group title below)
    const action = (a: ActionDef, marks: [number, number][], rank: number): Item => ({
      id: `action-${a.label}`, group: 'actions', label: a.label, marks, rank, icon: a.icon, keys: a.keys, hint: '',
      explorer: a.cmd === 'world' || EXPLORER_ACTIONS.has(a.cmd.action),
      run: () => { if (a.cmd === 'world') openArea('world', 'WORLD'); else runCommand(a.cmd); },
    });
    const page = (p: PageDef, marks: [number, number][], rank: number): Item => ({
      id: `page-${p.href}`, group: 'pages', label: p.label, marks, rank, icon: p.icon,
      hint: routeOf(p.href) === here ? 'This page' : p.hint,
      run: () => { window.location.hash = p.href; },
    });
    const actions = ACTIONS.filter((a) => !(a.fine && coarse));
    const project = (p: ProjectDef, marks: [number, number][], rank: number): Item => ({
      id: `project-${p.link}`, group: 'project', label: p.label, marks, rank, icon: p.icon,
      hint: `${PROJECT_LINKS[p.link].label}${PROJECT_LINKS[p.link].external ? ', in a new tab' : ''}`, run: () => openProject(p.link),
    });

    if (!query) {
      for (const r of recents) out.push(place(r, 'recent', [], 0));
      for (const t of TRY) {
        out.push({ id: `try-${t.q}`, group: 'try', label: t.q, marks: [], hint: t.hint, icon: <IconSearch />, rank: 0, keepOpen: true,
          run: () => { setQ(t.q); input.current?.focus(); } });
      }
      for (const p of PAGES) out.push(page(p, [], 0));
      for (const p of PROJECT) out.push(project(p, [], 0));
      for (const a of actions) out.push(action(a, [], 0));
      return out;
    }
    // places: typed coordinates first, then the place search
    const coords = parseCoords(query);
    if (coords) out.push(place(pointHit(coords.lat, coords.lon, 50, index), 'places', [], 0));
    // a city counts half a step less when the groups are ordered: "play" puts Play the months above the city Play Ku
    for (const h of hits) out.push(place(h, 'places', h.marks, matchRank(h.match) + (h.kind === 'city' ? 0.5 : 0)));
    // actions: a typed month, then the actions that match
    const ym = parseMonth(query);
    if (ym !== null) {
      out.push({
        id: `month-${ym}`, group: 'actions', label: `Show ${MONTHS[(ym % 100) - 1]} ${Math.floor(ym / 100)} on the map`, marks: [],
        hint: '', icon: <IconCalendar />, rank: 0, explorer: true,
        run: () => runCommand({ action: 'set-month', ym }),
      });
    }
    const scored = <T,>(list: T[], label: (x: T) => string, words: (x: T) => string[]) => list
      .map((x) => ({ x, m: matchLabel(label(x), query, words(x)) }))
      .filter((v): v is { x: T; m: { kind: MatchKind; marks: [number, number][] } } => v.m !== null)
      .sort((a, b) => matchRank(a.m.kind) - matchRank(b.m.kind));
    for (const { x, m } of scored(actions, (a) => a.label, (a) => a.words)) out.push(action(x, m.marks, matchRank(m.kind)));
    for (const { x, m } of scored(PAGES, (p) => p.label, (p) => [...p.words, p.hint])) out.push(page(x, m.marks, matchRank(m.kind)));
    for (const { x, m } of scored(PROJECT, (p) => p.label, (p) => [...p.words, PROJECT_LINKS[p.link].label])) out.push(project(x, m.marks, matchRank(m.kind)));
    // the group with the best match comes first (Places, Actions, Pages, Project on a tie)
    const order: GroupKey[] = ['places', 'actions', 'pages', 'project'];
    const best = (g: GroupKey) => Math.min(...out.filter((it) => it.group === g).map((it) => it.rank), 9);
    const groups = [...order].sort((a, b) => best(a) - best(b) || order.indexOf(a) - order.indexOf(b));
    return groups.flatMap((g) => out.filter((it) => it.group === g));
  }, [open, q, hits, recents, hash, index]);

  useEffect(() => { setActive(0); setEnterWhenReady(false); }, [q]);
  const activeIndex = Math.min(active, Math.max(0, items.length - 1));

  // Enter before the place list has loaded waits for it (so it opens the place, not a page that matched loosely)
  const [enterWhenReady, setEnterWhenReady] = useState(false);
  const runRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (enterWhenReady && ready) { setEnterWhenReady(false); runRef.current(); }
  }, [enterWhenReady, ready]);

  // the active row stays in view (under the sticky group title)
  useEffect(() => {
    if (!open) return;
    document.getElementById(`fh-pal-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, items]);

  if (!open) return null;

  const run = (it: Item | undefined) => {
    if (!it) return;
    if (!it.keepOpen) close(false);
    it.run();
  };
  runRef.current = () => run(items[activeIndex]);
  const pageSize = () => Math.max(1, Math.floor((document.getElementById(listId)?.clientHeight ?? 400) / 44) - 1);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // keys typed here never reach the page's own shortcuts (T, D, A, ?, Space, the arrows)
    e.stopPropagation();
    const n = items.length;
    const move = (to: number) => { e.preventDefault(); if (n) setActive(Math.max(0, Math.min(n - 1, to))); };
    switch (e.key) {
      case 'Escape': e.preventDefault(); close(true); break;
      case 'ArrowDown': move(activeIndex >= n - 1 ? 0 : activeIndex + 1); break;
      case 'ArrowUp': move(activeIndex <= 0 ? n - 1 : activeIndex - 1); break;
      case 'PageDown': move(activeIndex + pageSize()); break;
      case 'PageUp': move(activeIndex - pageSize()); break;
      case 'Home': if (!e.shiftKey) move(0); break;
      case 'End': if (!e.shiftKey) move(n - 1); break;
      case 'Enter':
        e.preventDefault();
        if (!ready && q.trim() && activeIndex === 0) setEnterWhenReady(true); else run(items[activeIndex]);
        break;
      case 'Tab': {
        // the focus stays in the palette
        const stops = [...(dialog.current?.querySelectorAll<HTMLElement>('input, button') ?? [])].filter((el) => el.offsetParent !== null);
        const i = stops.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
        break;
      }
      case 'k': case 'K':
        if (e.metaKey || e.ctrlKey) { e.preventDefault(); close(true); }
        break;
      default: break;
    }
  };

  const groups: { key: GroupKey; start: number; items: Item[] }[] = [];
  items.forEach((it, i) => {
    const last = groups[groups.length - 1];
    if (last && last.key === it.group) last.items.push(it);
    else groups.push({ key: it.group, start: i, items: [it] });
  });
  const query = q.trim();
  const awayFromMap = !onExplorerPage(hash);
  const status = !query ? '' : items.length === 0 ? (ready ? `No match for ${query}.` : 'Loading the place list…')
    : `${items.length} ${items.length === 1 ? 'result' : 'results'}.`;

  return (
    <div className="ui-palette-backdrop" data-closing={closing ? '' : undefined}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(true); }}>
      <div ref={dialog} className="ui-palette" role="dialog" aria-modal="true" aria-label="Search places, pages and actions" onKeyDown={onKeyDown}>
        <div className="ui-palette-search">
          <IconSearch size={18} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
            aria-label="Search places, cities, pages and actions" role="combobox" aria-expanded="true" aria-controls={listId}
            aria-activedescendant={items[activeIndex] ? `fh-pal-${activeIndex}` : undefined} aria-autocomplete="list"
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="go" />
          {q ? (
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon ui-palette-clear" aria-label="Clear the search"
              onMouseDown={(e) => e.preventDefault()} onClick={() => { setQ(''); input.current?.focus(); }}>
              <IconClose size={16} />
            </button>
          ) : null}
          <kbd className="ui-kbd ui-palette-esc" aria-hidden="true">Esc</kbd>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon ui-palette-close" aria-label="Close" onClick={() => close(true)}>
            <IconClose size={20} />
          </button>
        </div>
        <div className="ui-palette-list" id={listId} role="listbox" aria-label="Results" aria-busy={!ready && query ? true : undefined}>
          {!ready && query && items.length ? (
            <div className="ui-palette-loading" role="presentation"><span className="ui-palette-spin" aria-hidden="true" />Loading the place list…</div>
          ) : null}
          {groups.map((g) => (
            <div key={g.key} role="group" aria-labelledby={`fh-pal-g-${g.key}`} className="ui-palette-group"
              aria-describedby={g.key === 'actions' && awayFromMap && g.items.some((it) => it.explorer) ? 'fh-pal-g-note' : undefined}>
              <div className="ui-palette-group-title" role="presentation">
                <span id={`fh-pal-g-${g.key}`}>{GROUP_TITLE[g.key]}</span>
                {g.key === 'actions' && awayFromMap && g.items.some((it) => it.explorer)
                  ? <span className="ui-palette-group-note" id="fh-pal-g-note">Map actions open the Explorer</span> : null}
              </div>
              {g.items.map((it, j) => {
                const i = g.start + j;
                return (
                  <div key={it.id} id={`fh-pal-${i}`} role="option" aria-selected={i === activeIndex}
                    className={`ui-palette-item${i === activeIndex ? ' is-active' : ''}`}
                    onPointerMove={(e) => {
                      // only a real move picks a row (the list scrolling under a still pointer does not)
                      const p = pointer.current;
                      if (p && p.x === e.clientX && p.y === e.clientY) return;
                      pointer.current = { x: e.clientX, y: e.clientY };
                      if (i !== activeIndex) setActive(i);
                    }}
                    onMouseDown={(e) => e.preventDefault()} onClick={() => run(it)}>
                    <span className="ui-palette-icon" aria-hidden="true">{it.icon}</span>
                    <span className="ui-palette-text">
                      <span className="ui-palette-label"><Marked text={it.label} marks={it.marks} /></span>
                      {it.hint ? <span className="ui-palette-hint">{it.hint}</span> : null}
                    </span>
                    {it.keys ? (
                      <span className="ui-palette-keys" aria-hidden="true">{it.keys.map((k) => <kbd key={k} className="ui-kbd">{k}</kbd>)}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
          {query && items.length === 0 ? (
            <div className="ui-palette-empty">
              {ready ? (
                <>
                  <p className="ui-palette-empty-title">No match for “{query}”</p>
                  <p>Try a country, a state or a city, an island like Borneo, a month like sep 2019, or coordinates like -2.2, 113.9.</p>
                </>
              ) : <p><span className="ui-palette-spin" aria-hidden="true" />Loading the place list…</p>}
            </div>
          ) : null}
        </div>
        <span className="sr-only" aria-live="polite">{status}</span>
        <div className="ui-palette-foot" aria-hidden="true">
          <span><kbd className="ui-kbd">↑</kbd><kbd className="ui-kbd">↓</kbd> move</span>
          <span><kbd className="ui-kbd">Enter</kbd> open</span>
          <span><kbd className="ui-kbd">Esc</kbd> close</span>
          <span className="ui-palette-foot-end"><kbd className="ui-kbd">{MOD_KEY}</kbd><kbd className="ui-kbd">K</kbd> anywhere</span>
        </div>
      </div>
    </div>
  );
}
