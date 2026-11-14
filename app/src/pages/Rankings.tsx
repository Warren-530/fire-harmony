// Rankings (#/rankings): every place of the record in one table you can filter and sort, like a stock screener. The
// world, the continents, every country and every state, with fire a year, its share, the trend (and whether it holds
// when all places are tested together), the latest month and the year so far against normal, the record year, the
// usual peak and next month's outlook. Quick screens set a few filters at once; the link keeps the view; the CSV saves
// it. Only the rows on screen are drawn, so 4,330 places scroll smoothly on a phone. A row opens the place in the
// Explorer; the second button opens it in the dashboard.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { webJson } from '../lib/web';
import { citation } from '../lib/i18n';
import { openArea, useCommand } from '../lib/commands';
import { saveFile } from '../lib/download';
import { Badge, Page, PageHeader, Tooltip } from '../components/ui';
import { ScrollFade } from '../components/ScrollFade';
import { useToast } from '../components/Toast';
import { useCopy } from '../components/pages/clipboard';
import {
  IconChevronDown, IconChevronRight, IconChevronUp, IconClose, IconCopy, IconDashboard, IconDownload, IconFilter, IconGlobe, IconSearch,
} from '../components/icons';
import { COLUMNS, type ColumnContext } from '../components/rankings/Columns';
import { useWindowRows } from '../components/rankings/useWindowRows';
import {
  DEFAULT_FILTERS, FILTER_WORDS, FIRST_DIR, filtersFromHash, hashOf, monthYear, passes, plural, queryWords, rankingsCsv, rankRows,
  screenOf, SCREENS, sortWords, viewOf, type Filters, type Kind, type PlacesFile, type Ranked, type SortKey, type TrendClass,
} from '../components/rankings/model';
import { count, explorerHref, int } from '../components/dashboard/format';
import '../styles/rankings.css';

const T = {
  eyebrow: 'Rankings',
  title: 'Every place, ranked',
  lead: 'The world, its continents, every country and every state in one table. Sort by any column, filter by place or trend, '
    + 'or start from a quick screen. Select a row to open the place on the map.',
  copy: 'Copy a link to this view',
  csv: 'Download CSV',
  screens: 'Quick screens',
  find: 'Find a place',
  findLong: 'Find a place, a country or a code',
  clear: 'Clear the search',
  kind: 'Kind of place',
  continent: 'Continent',
  country: 'Country',
  anyContinent: 'Every continent',
  anyCountry: 'Every country',
  trend: 'Trend',
  min: 'Fire a year',
  farAbove: 'Far above normal now',
  reset: 'Reset',
  filters: 'Filters',
  sort: 'Sort',
  place: 'Place',
  placeHelp: 'A country, a state or province, a continent or the world. Select a row to open the place on the map.',
  openMap: (n: string) => `Open ${n} on the map`,
  openDashboard: (n: string) => `Open ${n} in the dashboard`,
  loading: 'Loading every place…',
  error: 'The list of places could not be loaded. Check your connection and try again.',
  retry: 'Try again',
  none: 'No place matches these filters.',
  showAll: 'Clear the filters',
  backToFilters: 'Back to the filters',
} as const;

const KIND_CHOICES: readonly (Kind | 'all')[] = ['country', 'state', 'continent', 'world', 'all'];
const TREND_CHOICES: readonly (TrendClass | 'all')[] = ['all', 'rising', 'falling', 'unclear', 'untested', 'none'];
const MIN_CHOICES = [0, 100, 1000, 10000] as const;
/** The phone's sort menu (short words, so the chosen one fits the pinned bar of a 320 px phone). */
const SORT_CHOICES: readonly { value: string; label: string }[] = [
  { value: 'mean-desc', label: 'Most fire' }, { value: 'mean-asc', label: 'Least fire' },
  { value: 'trend-desc', label: 'Rising fastest' }, { value: 'trend-asc', label: 'Falling fastest' },
  { value: 'latest-desc', label: 'Above normal' }, { value: 'latest-asc', label: 'Below normal' },
  { value: 'ytd-desc', label: 'Busiest year' }, { value: 'outlook-desc', label: 'Next month risk' },
  { value: 'record-desc', label: 'Latest record' }, { value: 'peak-asc', label: 'Peak month' },
  { value: 'name-asc', label: 'Name, A to Z' }, { value: 'share-desc', label: 'Largest share' },
];

type Load = { status: 'loading' } | { status: 'ready'; file: PlacesFile; rows: Ranked[] } | { status: 'error' };

/** A click on a row link: new tab clicks stay native; a plain click opens the Explorer (one history entry). */
function follow(e: MouseEvent<HTMLAnchorElement>, r: Ranked): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  openArea(r.kind, r.id);
}

const dashboardHref = (r: Pick<Ranked, 'kind' | 'id'>): string => `#/dashboard?area=${r.kind}:${encodeURIComponent(r.id)}`;

export function Rankings() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [f, setF] = useState<Filters>(() => filtersFromHash(window.location.hash));
  const [moreOpen, setMoreOpen] = useState(false);
  const toast = useToast();
  const copy = useCopy();
  const toolbar = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const narrow = useNarrow();

  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading' });
    webJson<PlacesFile>('places.json').then((file) => {
      if (!live) return;
      if (!file) { setLoad({ status: 'error' }); return; }
      setLoad({ status: 'ready', file, rows: rankRows(file.rows) });
    }, () => { if (live) setLoad({ status: 'error' }); });
    return () => { live = false; };
  }, [attempt]);

  // the link keeps the view (replaced, not added: Back leaves the page rather than stepping through filters)
  useEffect(() => {
    const h = hashOf(f);
    if (window.location.hash !== h) window.history.replaceState(window.history.state, '', h);
  }, [f]);
  // a link to another view of this page (from the dashboard, the palette or Back) sets the filters again
  useEffect(() => {
    const on = () => {
      if (!window.location.hash.startsWith('#/rankings')) return;
      const next = filtersFromHash(window.location.hash);
      setF((cur) => (hashOf(cur) === hashOf(next) ? cur : next));
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const set = useCallback((o: Partial<Filters>) => setF((cur) => {
    const next = { ...cur, ...o };
    // the country filter only means something for countries and states
    if (o.kind && (o.kind === 'world' || o.kind === 'continent')) next.country = 'all';
    if (o.continent && o.continent !== cur.continent) next.country = 'all';
    return next;
  }), []);

  const rows = load.status === 'ready' ? load.rows : null;
  const view = useMemo(() => (rows ? viewOf(rows, f) : []), [rows, f]);
  const words = useMemo(() => queryWords(f.q), [f.q]);
  const ctx = useMemo<ColumnContext>(() => {
    const world = rows?.find((r) => r.kind === 'world');
    return { latestYm: world?.latest_ym ?? 202610, outlookYm: world?.outlook_target ?? null };
  }, [rows]);

  // counts beside the choices: what each choice would show with the other filters as they are
  const kindCounts = useMemo(() => countBy<string>(rows, (r) => r.kind, (r) => passes(r, f, words, 'kind')), [rows, f, words]);
  const continents = useMemo(() => {
    const m = countBy(rows, (r) => (r.kind === 'continent' ? r.id : r.continent ?? ''), (r) => r.kind !== 'world' && passes(r, f, words, 'continent'));
    return [...m.entries()].filter(([k]) => k && k !== 'Seven seas (open ocean)' && k !== 'Open ocean').sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, f, words]);
  const countries = useMemo(() => {
    if (!rows) return [];
    const names = new Map<string, string>();
    for (const r of rows) if (r.kind === 'country' && r.iso3 && (f.continent === 'all' || r.continent === f.continent)) names.set(r.iso3, r.own);
    const n = countBy(rows, (r) => r.iso3 ?? '', (r) => r.kind === 'state' && passes(r, f, words, 'country'));
    return [...names.entries()].filter(([iso]) => n.has(iso) || iso === f.country).sort((a, b) => a[1].localeCompare(b[1]))
      .map(([iso, name]) => ({ iso, name, n: n.get(iso) ?? 0 }));
  }, [rows, f, words]);
  const trendCounts = useMemo(() => countBy<string>(rows, (r) => r.trendClass, (r) => passes(r, f, words, 'trend')), [rows, f, words]);
  const farCount = useMemo(() => (rows ? rows.filter((r) => r.farAbove && passes(r, f, words, 'now')).length : 0), [rows, f, words]);

  const screen = screenOf(f);
  const changed = hashOf({ ...f, sort: DEFAULT_FILTERS.sort, dir: DEFAULT_FILTERS.dir }) !== hashOf({ ...DEFAULT_FILTERS });
  const extra = [f.continent !== 'all', f.country !== 'all', f.trend !== 'all', f.min > 0].filter(Boolean).length;

  const sortBy = (key: SortKey) => set(f.sort === key ? { dir: f.dir === 'asc' ? 'desc' : 'asc' } : { sort: key, dir: FIRST_DIR[key] });
  const link = () => `${window.location.origin}${window.location.pathname}${hashOf(f)}`;
  useCommand((c) => { if (c.action === 'copy-link') void copy(link(), 'Link copied'); }, [f]);

  const download = () => {
    if (load.status !== 'ready') return;
    const countryName = f.country !== 'all' ? rows?.find((r) => r.kind === 'country' && r.iso3 === f.country)?.own ?? null : null;
    const csv = rankingsCsv(view, f, { version: load.file.version === 1 ? '1.0' : String(load.file.version), latestMonth: ctx.latestYm, citation: citation('1.0'), link: link(), countryName });
    saveFile(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `fire-harmony-rankings-${f.kind === 'all' ? 'places' : FILTER_WORDS.kind[f.kind].toLowerCase()}.csv`);
    toast(`Saved ${int(view.length)} ${view.length === 1 ? 'place' : 'places'} as CSV`);
  };

  const total = rows?.length ?? 0;
  const kindWord = f.kind === 'all' ? 'places' : FILTER_WORDS.kind[f.kind].toLowerCase();
  // "55 of 246 countries", "246 countries", "4,330 places"
  const of = f.kind === 'all' ? total : rows ? rows.filter((r) => r.kind === f.kind).length : 0;
  const summary = rows
    ? `${int(view.length)}${view.length < of ? ` of ${int(of)}` : ''} ${view.length === 1 && view.length >= of ? kindWord.replace(/s$/, '').replace(/ie$/, 'y') : kindWord}`
    : '';

  return (
    <div className="rk-root">
      <Page>
        <PageHeader eyebrow={T.eyebrow} title={T.title} lead={T.lead}
          actions={rows ? (
            <>
              {/* only where the header's own "Data to" badge is hidden (phones) */}
              <span className="rk-page-badge"><Badge tone="ember">Data to {monthYear(ctx.latestYm)}</Badge></span>
              <Tooltip content={T.copy}>
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon" aria-label={T.copy} onClick={() => void copy(link(), 'Link copied')}>
                  <IconCopy size={16} />
                </button>
              </Tooltip>
              <button type="button" className="ui-btn" onClick={download}><IconDownload size={16} />{T.csv}</button>
            </>
          ) : null} />

        <div ref={toolbar} className="rk-tools">
          <ScrollFade className="rk-screens" role="group" aria-label={T.screens} arrows>
            {SCREENS.map((s) => (
              <Tooltip key={s.id} content={s.help}>
                <button type="button" className="ui-chip rk-screen" aria-pressed={screen === s.id} onClick={() => set(s.set)}>
                  {s.label}
                </button>
              </Tooltip>
            ))}
          </ScrollFade>

          <div className="rk-toolbar">
            <label className="rk-search">
              <IconSearch size={16} />
              <input ref={search} type="search" value={f.q} placeholder={narrow ? T.find : T.findLong} aria-label={T.find}
                onChange={(e) => set({ q: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Escape' && f.q) { e.stopPropagation(); set({ q: '' }); } }} />
              {f.q ? (
                <Tooltip content={T.clear}>
                  <button type="button" className="rk-search-clear ui-press" aria-label={T.clear} onClick={() => { set({ q: '' }); search.current?.focus(); }}>
                    <IconClose size={14} />
                  </button>
                </Tooltip>
              ) : null}
            </label>
            <ScrollFade className="rk-kinds" role="radiogroup" aria-label={T.kind}>
              {KIND_CHOICES.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={f.kind === k} className="ui-chip rk-kind"
                  onClick={() => set({ kind: k })}>
                  {FILTER_WORDS.kind[k]}
                  <span className="rk-n ui-mono">{int(k === 'all' ? sumCounts(kindCounts) : kindCounts.get(k) ?? 0)}</span>
                </button>
              ))}
            </ScrollFade>
            <button type="button" className="ui-btn rk-more-btn" aria-expanded={moreOpen} aria-controls="rk-more" onClick={() => setMoreOpen((o) => !o)}>
              <IconFilter size={16} />{T.filters}{extra ? <span className="rk-badge ui-mono">{extra}</span> : null}
              <IconChevronDown size={14} className="rk-more-chev" />
            </button>
            <div id="rk-more" className="rk-more" data-open={moreOpen ? '' : undefined}>
              <label className="rk-field">
                <span>{T.continent}</span>
                <select value={f.continent} onChange={(e) => set({ continent: e.target.value })}>
                  <option value="all">{T.anyContinent}</option>
                  {continents.map(([c, n]) => <option key={c} value={c}>{c} ({int(n)})</option>)}
                </select>
              </label>
              <label className="rk-field">
                <span>{T.country}</span>
                <select value={f.country} disabled={f.kind === 'world' || f.kind === 'continent'}
                  onChange={(e) => set({ country: e.target.value, ...(e.target.value !== 'all' && f.kind === 'country' ? { kind: 'state' as const } : {}) })}>
                  <option value="all">{T.anyCountry}</option>
                  {countries.map((c) => <option key={c.iso} value={c.iso}>{c.name} ({plural(c.n, 'state')})</option>)}
                </select>
              </label>
              <label className="rk-field">
                <span>{T.trend}</span>
                <select value={f.trend} onChange={(e) => set({ trend: e.target.value as Filters['trend'] })}>
                  {TREND_CHOICES.map((k) => <option key={k} value={k}>{FILTER_WORDS.trend[k]}{k === 'all' ? '' : ` (${int(trendCounts.get(k) ?? 0)})`}</option>)}
                </select>
              </label>
              <label className="rk-field">
                <span>{T.min}</span>
                <select value={f.min} onChange={(e) => set({ min: Number(e.target.value) as Filters['min'] })}>
                  {MIN_CHOICES.map((m) => <option key={m} value={m}>{FILTER_WORDS.min[m]}</option>)}
                </select>
              </label>
              <Tooltip content={SCREENS.find((s) => s.id === 'above')?.help ?? ''}>
                <button type="button" className="ui-chip rk-far" aria-pressed={f.now === 'above'} onClick={() => set({ now: f.now === 'above' ? 'all' : 'above' })}>
                  <span className="rk-far-dot" aria-hidden="true" />{T.farAbove}<span className="rk-n ui-mono">{int(farCount)}</span>
                </button>
              </Tooltip>
              {changed || f.sort !== DEFAULT_FILTERS.sort || f.dir !== DEFAULT_FILTERS.dir ? (
                <button type="button" className="ui-btn ui-btn-ghost rk-reset" onClick={() => setF({ ...DEFAULT_FILTERS })}>{T.reset}</button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rk-status">
          <p className="rk-summary" aria-live="polite">{summary}{rows ? <span className="rk-summary-sort">, {sortWords(f)}</span> : null}{rows ? '.' : ''}</p>
          <label className="rk-sortpick">
            <span>{T.sort}</span>
            <select value={`${f.sort}-${f.dir}`} onChange={(e) => { const [s, d] = e.target.value.split('-'); set({ sort: s as SortKey, dir: d as Filters['dir'] }); }}>
              {SORT_CHOICES.some((o) => o.value === `${f.sort}-${f.dir}`) ? null : <option value={`${f.sort}-${f.dir}`}>Custom order</option>}
              {SORT_CHOICES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <Tooltip content={T.backToFilters}>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon rk-up" aria-label={T.backToFilters}
              onClick={() => { toolbar.current?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }); search.current?.focus({ preventScroll: true }); }}>
              <IconChevronUp size={16} />
            </button>
          </Tooltip>
        </div>

        {load.status === 'error' ? (
          <div className="rk-error" role="alert">
            <p>{T.error}</p>
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setAttempt((n) => n + 1)}>{T.retry}</button>
          </div>
        ) : null}

        <div className="rk-table" role="table" aria-label={`Places ${sortWords(f)}`} aria-rowcount={view.length + 1} aria-busy={load.status === 'loading'}>
          <div className="rk-head" role="rowgroup">
            <div className="rk-row rk-row-head" role="row" aria-rowindex={1}>
              <div className="rk-c rk-c-place" role="columnheader" aria-sort={f.sort === 'name' ? (f.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <Tooltip content={T.placeHelp}>
                  <button type="button" className={f.sort === 'name' ? 'rk-sort is-on' : 'rk-sort'} onClick={() => sortBy('name')}>
                    <SortLabel text={T.place} on={f.sort === 'name'} dir={f.dir} />
                  </button>
                </Tooltip>
              </div>
              {COLUMNS.map((c) => (
                <div key={c.key} className={`rk-c rk-c-${c.key}${c.num ? ' rk-num' : ''}`} role="columnheader"
                  aria-sort={f.sort === c.key ? (f.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <Tooltip content={c.help(ctx)}>
                    <button type="button" className={f.sort === c.key ? 'rk-sort is-on' : 'rk-sort'} onClick={() => sortBy(c.key)}>
                      <SortLabel text={c.label(ctx)} on={f.sort === c.key} dir={f.dir} />
                    </button>
                  </Tooltip>
                </div>
              ))}
              <div className="rk-c rk-c-go" role="columnheader"><span className="rk-sr">Open</span></div>
            </div>
          </div>
          <RankBody view={view} ready={rows !== null} loading={load.status === 'loading'} sort={f.sort} ctx={ctx} />
          {rows && view.length === 0 ? (
            <div className="rk-empty">
              <span>{T.none}{f.q ? ` Nothing is called “${f.q.trim()}”.` : ''}</span>
              <button type="button" className="ui-btn" onClick={() => setF({ ...DEFAULT_FILTERS, sort: f.sort, dir: f.dir })}>{T.showAll}</button>
            </div>
          ) : null}
        </div>

        <aside className="rk-notes" aria-label="How to read the table">
          <p><b>How to read it.</b> Counts are harmonized hotspots on the NOAA-20 VIIRS scale, so places and years compare directly.
            Fire a year and the trend use the full years 2001 to 2025. A trend <b>holds</b> when it stays clear after every country
            (and, apart, every state) is tested together, with a false discovery rate of 5%; places with under {count(1000)} hotspots
            a year, or with most of their heat on bare ground, are not tested. “Times normal” compares a month with the median of the
            same month in 2001 to 2025.</p>
        </aside>
      </Page>
    </div>
  );
}

/** The rows: only those near the screen are drawn (useWindowRows). The window lives here, not in the page, so a step
 *  of the window while the list scrolls draws this list again, not the filters and the header above it. */
const RankBody = memo(function RankBody({ view, ready, loading, sort, ctx }: {
  view: readonly Ranked[]; ready: boolean; loading: boolean; sort: SortKey; ctx: ColumnContext;
}) {
  const list = useRef<HTMLDivElement>(null);
  const focusNext = useRef<number | null>(null);
  const win = useWindowRows(view.length, list);

  // focus moves row by row with the arrow keys (rows far away are drawn first, then focused)
  useEffect(() => {
    const i = focusNext.current;
    if (i === null || i < win.start || i >= win.end) return;
    focusNext.current = null;
    list.current?.querySelector<HTMLElement>(`[data-index="${i}"] .rk-name`)?.focus({ preventScroll: true });
  }, [win.start, win.end]);
  const onRowKey = (e: KeyboardEvent<HTMLElement>, i: number) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'Home' && e.ctrlKey ? -i : e.key === 'End' && e.ctrlKey ? view.length - 1 - i : 0;
    if (!step) return;
    const j = Math.max(0, Math.min(view.length - 1, i + step));
    if (j === i) return;
    e.preventDefault();
    const el = list.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY + j * win.rowH;
    const head = document.querySelector('.rk-head')?.getBoundingClientRect().bottom ?? 120;
    const y = window.scrollY;
    if (top < y + head + 8) window.scrollTo({ top: top - head - 8 });
    else if (top + win.rowH > y + window.innerHeight - 8) window.scrollTo({ top: top + win.rowH - window.innerHeight + 8 });
    focusNext.current = j;
    const target = el.querySelector<HTMLElement>(`[data-index="${j}"] .rk-name`);
    if (target) { focusNext.current = null; target.focus({ preventScroll: true }); }
  };
  const keyRef = useRef(onRowKey);
  keyRef.current = onRowKey;
  const rowKey = useCallback((e: KeyboardEvent<HTMLElement>, i: number) => keyRef.current(e, i), []);

  return (
    <div ref={list} className="rk-body" role="rowgroup" style={{ height: ready ? view.length * win.rowH : undefined }}>
      {ready ? view.slice(win.start, win.end).map((r, k) => (
        <RankRow key={r.key} r={r} i={win.start + k} rowH={win.rowH} sort={sort} ctx={ctx} onKey={rowKey} />
      )) : loading ? (
        <div className="rk-skeleton" role="status"><span className="rk-sr">{T.loading}</span>
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="ui-skeleton rk-skel-row" aria-hidden="true" />)}
        </div>
      ) : null}
    </div>
  );
});

const reduceMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** True on narrow phones, where the search field gets its short placeholder. */
function useNarrow(): boolean {
  const q = '(max-width: 420px)';
  const [on, setOn] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const f = () => setOn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return on;
}

/** One row (a card on a phone). Rows that stay on screen while the list scrolls are not drawn again. */
const RankRow = memo(function RankRow({ r, i, rowH, sort, ctx, onKey }: {
  r: Ranked; i: number; rowH: number; sort: SortKey; ctx: ColumnContext; onKey: (e: KeyboardEvent<HTMLElement>, i: number) => void;
}) {
  return (
    <div className={`rk-row rk-kind-${r.kind}`} role="row" aria-rowindex={i + 2} data-index={i}
      style={{ transform: `translateY(${i * rowH}px)` } as CSSProperties}>
      <div className="rk-c rk-c-place" role="cell">
        <span className="rk-rank ui-mono" aria-hidden="true">{i + 1}</span>
        <span className="rk-place">
          <a className="rk-name" href={explorerHref(r.kind, r.id)} onClick={(e) => follow(e, r)} onKeyDown={(e) => onKey(e, i)}
            aria-label={`${r.own}, ${r.where}. ${T.openMap(r.own)}`}>
            {r.kind === 'world' ? <IconGlobe size={14} className="rk-name-icon" /> : null}
            <span className="rk-name-text">{r.own}</span>
          </a>
          <span className="rk-where">{r.where}{r.local_name ? <span className="rk-local"> · {r.local_name}</span> : null}</span>
        </span>
      </div>
      {COLUMNS.map((c) => (
        <div key={c.key} className={`rk-c rk-c-${c.key}${c.num ? ' rk-num' : ''}${sort === c.key ? ' is-sorted' : ''}`} role="cell">
          <span className="rk-label" aria-hidden="true">{(c.short ?? c.label)(ctx)}</span>
          {c.render(r, ctx)}
        </div>
      ))}
      <div className="rk-c rk-c-go" role="cell">
        <Tooltip content={T.openDashboard(r.own)}>
          <a className="rk-go ui-press" href={dashboardHref(r)} aria-label={T.openDashboard(r.own)}><IconDashboard size={16} /></a>
        </Tooltip>
        <IconChevronRight size={16} className="rk-chev" />
      </div>
    </div>
  );
});

function SortIcon({ on, dir }: { on: boolean; dir: 'asc' | 'desc' }) {
  return <span className="rk-sort-icon" aria-hidden="true">{on && dir === 'asc' ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}</span>;
}

/** A header label with its arrow held to the last word, so the arrow sits next to its own label on any line. */
function SortLabel({ text, on, dir }: { text: string; on: boolean; dir: 'asc' | 'desc' }) {
  const cut = text.lastIndexOf(' ');
  return (
    <span className="rk-sort-label">
      {cut > 0 ? text.slice(0, cut + 1) : ''}
      <span className="rk-sort-tail">{cut > 0 ? text.slice(cut + 1) : text}<SortIcon on={on} dir={dir} /></span>
    </span>
  );
}

function countBy<K>(rows: readonly Ranked[] | null, key: (r: Ranked) => K, keep: (r: Ranked) => boolean): Map<K, number> {
  const m = new Map<K, number>();
  if (!rows) return m;
  for (const r of rows) if (keep(r)) { const k = key(r); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}

const sumCounts = (m: Map<unknown, number>): number => [...m.values()].reduce((s, n) => s + n, 0);
