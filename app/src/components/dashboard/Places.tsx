// 3. Where the fire is: the continents, and the 25 countries with the most fire as a table you can sort, filter by
// continent and search. 4. Unusual right now: the areas most above their normal in the latest full month.
// Every place opens in the Explorer (openArea).
import { TREND_LOG_NOTE } from '../pages/format';
import { useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { AreaStat, DashboardData } from '../../lib/dashboard-types';
import { openArea } from '../../lib/commands';
import { Callout, Card } from '../ui';
import { Tooltip } from '../Tooltip';
import { DICTS } from '../../lib/i18n';
import { Sparkline } from '../Sparkline';
import { IconChevronRight, IconClose, IconSearch } from '../icons';
import {
  andList, CONTINENTS, continentsOf, count, int, monthName, monthShort, monthYear, pct, ratioNum, timesNormal, trendTone, trendWord,
  type Continent,
} from './format';
import { AgainstNormal, AreaLink, MonthLetters, RankList, SortableTable, TrendMark, type SortColumn, type SortState } from './parts';
import { DbSection } from './DbSection';
import { isWorld, seasonLabel, yearsLabel, type Scope } from './scope';
import { useFocus, type Part, type ScopeData } from './useScope';
import { rowVerdict, viewVerdict } from './verdict';
import type { PlaceRow } from '../rankings/model';

const t = DICTS.en;
const latestLabel = (a: { latest_yr: number; latest_mo: number }): string => monthYear(a.latest_yr * 100 + a.latest_mo);
const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The trend of a place over the whole record, with the verdict of Rankings (verdict.ts) once web/places.json is in. */
function Trend({ a, rows, byKey }: { a: AreaStat; rows: PlaceRow[] | null; byKey: Map<string, PlaceRow> | null }) {
  if (a.trend_pct_per_decade === null) return <span className="db-muted">Not enough years<span className="db-only-sm"> for a trend</span></span>;
  const row = byKey?.get(`${a.kind}:${a.id}`);
  if (row) {
    const v = rowVerdict(row, rows);
    return <TrendMark tone={v.tone} word={v.word} value={pct(a.trend_pct_per_decade, 1, true)} unit="a decade" />;
  }
  // a continent is tested on its own (dashboard.json says how); a country waits for its verdict among all countries
  if (a.kind !== 'continent') return <TrendMark tone="flat" word="" value={pct(a.trend_pct_per_decade, 1, true)} unit="a decade" />;
  return <TrendMark tone={trendTone(a.trend)} word={trendWord(a.trend)} value={pct(a.trend_pct_per_decade, 1, true)} unit="a decade" />;
}

/** The rows of web/places.json by "kind:id". */
function useByKey(rows: PlaceRow[] | null): Map<string, PlaceRow> | null {
  return useMemo(() => (rows ? new Map(rows.map((r) => [`${r.kind}:${r.id}`, r])) : null), [rows]);
}

/** The latest month against normal. On phones, where the column names are hidden, it also says which month. */
function Latest({ ratio, when }: { ratio: number | null; when: string }) {
  const ok = ratio !== null && Number.isFinite(ratio);
  return (
    <span className="db-latest">
      <AgainstNormal ratio={ratio} />
      {when ? <span className="db-only-sm db-cap">{ok ? `normal in ${when}` : `for ${when}`}</span> : null}
    </span>
  );
}

/** "Oct 2026", the latest month of a place in short. */
const latestShortOf = (a: { latest_yr: number; latest_mo: number } | undefined): string => (a ? `${monthShort(a.latest_mo)} ${a.latest_yr}` : '');

function ShareBar({ value, max }: { value: number; max: number }) {
  return (
    <span className="db-share">
      <span className="db-share-track" aria-hidden="true"><span className="db-share-fill" style={{ '--db-frac': value / max } as CSSProperties} /></span>
      <span className="ui-mono db-share-num">{pct(value, value < 10 ? 1 : 0)}</span>
    </span>
  );
}

function YearsSpark({ a }: { a: AreaStat }) {
  const f = useFocus();
  if (a.yearly.length < 2) return null;
  const top = a.yearly.reduce((m, y) => (y.h > m.h ? y : m), a.yearly[0]);
  const at = f.yr !== null ? a.yearly.findIndex((y) => y.yr === f.yr) : -1;
  return (
    <Sparkline values={a.yearly.map((y) => y.h)} width={104} height={26} color="var(--ember-700)" highlight={at >= 0 ? at : undefined}
      label={`Hotspots per year, ${a.yearly[0].yr} to ${a.yearly[a.yearly.length - 1].yr}, highest in ${top.yr}`} />
  );
}

/** The season totals of a part in view, as a line (the year under the pointer in any chart gets the dot). */
function PartSpark({ p }: { p: Part }) {
  const f = useFocus();
  const { values, yearsShown } = p.stats;
  if (values.length < 2) return null;
  const at = f.yr !== null ? yearsShown.indexOf(f.yr) : -1;
  return (
    <Sparkline values={values} width={104} height={26} color="var(--ember-700)" highlight={at >= 0 ? at : undefined}
      label={`Hotspots in each year in view, ${yearsShown[0]} to ${yearsShown[yearsShown.length - 1]}`} />
  );
}

// ---------------------------------------------------------------------------------------------- continents
function Continents({ d, rows }: { d: DashboardData; rows: PlaceRow[] | null }) {
  const conts = d.continents;
  const byKey = useByKey(rows);
  const latestName = conts[0] ? latestLabel(conts[0]) : monthYear(d.record.latest_full_month);
  const latestShort = latestShortOf(conts[0]);
  const max = Math.max(...conts.map((c) => c.share_pct));
  const [sort, setSort] = useState<SortState>({ key: 'share', dir: 'desc' });
  const top = [...conts].sort((a, b) => b.share_pct - a.share_pct)[0];
  const title = top
    ? top.share_pct >= 45 && top.share_pct <= 55 ? `${top.name} has half of the world’s fire` : `${top.name} has ${pct(top.share_pct, 0)} of the world’s fire`
    : 'Fire by continent';
  const columns: SortColumn<AreaStat>[] = [
    { key: 'name', label: 'Continent', sort: (a) => a.name, render: (a) => <AreaLink kind={a.kind} id={a.id}>{a.name}</AreaLink>, className: 'db-c-name' },
    { key: 'share', label: 'Share of world fire', num: true, sort: (a) => a.share_pct, render: (a) => <ShareBar value={a.share_pct} max={max} />, className: 'db-col-share db-c-share' },
    { key: 'mean', label: 'Hotspots a year', num: true, sort: (a) => a.mean_per_year, className: 'db-c-mean',
      render: (a) => <span><span className="ui-mono">{count(a.mean_per_year)}</span><span className="db-only-sm db-unit"> hotspots a year</span></span> },
    { key: 'spark', label: '2001 to 2025', render: (a) => <YearsSpark a={a} />, className: 'db-col-spark' },
    { key: 'trend', label: 'Trend per decade, 2001 to 2025', help: TREND_LOG_NOTE, sort: (a) => a.trend_pct_per_decade ?? 0, first: 'desc', render: (a) => <Trend a={a} rows={rows} byKey={byKey} />, className: 'db-c-trend' },
    { key: 'season', label: 'Fire season peak', render: (a) => <MonthLetters months={a.critical_months} />, className: 'db-col-season' },
    { key: 'latest', label: `${latestName} against normal`, num: true, sort: (a) => a.latest_ratio ?? 0, className: 'db-c-latest',
      render: (a) => <Latest ratio={a.latest_ratio} when={latestShort} /> },
  ];
  return (
    <Card title={title}
      subtitle={`Means of 2001 to 2025. A trend counts as clear when chance alone would give it less than one time in 20. The fire season peak is the months that are among the busiest in most years. Select a column to sort, a row to open the continent in the Explorer.`}>
      <SortableTable columns={columns} rows={conts} rowKey={(a) => a.id} sort={sort} onSort={setSort}
        caption="Continents: share of world fire, hotspots a year, trend, fire season and the latest month"
        onRowClick={(a) => openArea(a.kind, a.id)} className="db-table-continents" />
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------- countries
type Country = AreaStat & { rank: number; continents: Continent[] };

/** On phones the country table shows this many rows until "Show all" is pressed (the parts of a place, fewer). */
const PHONE_ROWS = 10;
const PART_ROWS = 5;

const SORTS: { value: string; label: string; s: SortState }[] = [
  { value: 'mean:desc', label: 'Most fire first', s: { key: 'mean', dir: 'desc' } },
  { value: 'mean:asc', label: 'Least fire first', s: { key: 'mean', dir: 'asc' } },
  { value: 'trend:desc', label: 'Fastest rising first', s: { key: 'trend', dir: 'desc' } },
  { value: 'trend:asc', label: 'Fastest falling first', s: { key: 'trend', dir: 'asc' } },
  { value: 'latest:desc', label: 'Most above normal first', s: { key: 'latest', dir: 'desc' } },
  { value: 'latest:asc', label: 'Most below normal first', s: { key: 'latest', dir: 'asc' } },
  { value: 'name:asc', label: 'Name, A to Z', s: { key: 'name', dir: 'asc' } },
];

function Countries({ d, rows: places }: { d: DashboardData; rows: PlaceRow[] | null }) {
  const all = useMemo<Country[]>(() => d.countries.map((c, i) => ({ ...c, rank: i + 1, continents: continentsOf(c.id) })), [d]);
  const byKey = useByKey(places);
  const [sort, setSort] = useState<SortState>({ key: 'mean', dir: 'desc' });
  const [cont, setCont] = useState<Continent | 'all'>('all');
  const [q, setQ] = useState('');
  const latestName = all[0] ? latestLabel(all[0]) : monthYear(d.record.latest_full_month);
  const latestShort = latestShortOf(all[0]);
  const [showAll, setShowAll] = useState(false);
  // "Show the first 10" keeps the button under the finger: the page scrolls by as much as the list got shorter
  const toggleAll = (e: MouseEvent<HTMLButtonElement>) => {
    const btn = e.currentTarget, before = btn.getBoundingClientRect().top, collapsing = showAll;
    flushSync(() => setShowAll(!collapsing));
    if (collapsing) window.scrollBy({ top: btn.getBoundingClientRect().top - before, behavior: 'instant' });
  };
  const counts = new Map<Continent, number>();
  for (const c of all) for (const k of c.continents) counts.set(k, (counts.get(k) ?? 0) + 1);
  const chips = CONTINENTS.filter((k) => counts.has(k));
  const nq = norm(q.trim());
  const rows = all.filter((c) => (cont === 'all' || c.continents.includes(cont))
    && (!nq || norm(c.name).includes(nq) || c.id.toLowerCase() === nq));
  const share = all.reduce((s, c) => s + c.share_pct, 0);
  const shown = rows.reduce((s, c) => s + c.share_pct, 0);
  const columns: SortColumn<Country>[] = [
    { key: 'rank', label: 'Rank', num: true, sort: (c) => c.rank, first: 'asc', render: (c) => <span className="db-rankcell ui-mono">{c.rank}</span>, className: 'db-col-rank' },
    { key: 'name', label: 'Country', sort: (c) => c.name, className: 'db-c-name', render: (c) => (
      <span className="db-place">
        <AreaLink kind={c.kind} id={c.id}>{c.name}</AreaLink>
        <span className="db-place-sub">{c.continents.length ? andList(c.continents) : c.id}</span>
      </span>
    ) },
    { key: 'spark', label: '2001 to 2025', render: (c) => <YearsSpark a={c} />, className: 'db-col-spark' },
    { key: 'mean', label: 'Hotspots a year', num: true, sort: (c) => c.mean_per_year, className: 'db-c-mean', render: (c) => (
      <span className="db-stack-num">
        <span><span className="ui-mono">{count(c.mean_per_year)}</span><span className="db-only-sm db-unit"> hotspots a year</span></span>
        <span className="db-num-sub ui-mono">{pct(c.share_pct, 1)} of world</span>
      </span>
    ) },
    { key: 'trend', label: 'Trend per decade, 2001 to 2025', help: TREND_LOG_NOTE, sort: (c) => c.trend_pct_per_decade ?? 0, first: 'desc', render: (c) => <Trend a={c} rows={places} byKey={byKey} />, className: 'db-c-trend' },
    { key: 'season', label: 'Fire season peak', render: (c) => <MonthLetters months={c.critical_months} />, className: 'db-col-season' },
    { key: 'latest', label: `${latestName} against normal`, num: true, sort: (c) => c.latest_ratio ?? 0, className: 'db-c-latest',
      render: (c) => <Latest ratio={c.latest_ratio} when={latestShort} /> },
  ];
  const sortValue = `${sort.key}:${sort.dir}`;

  return (
    <Card title={`The ${all.length} countries with the most fire`}
      subtitle={`Together they have ${pct(share, 0)} of the world’s hotspots (2001 to 2025). The line is every year from 2001 to 2025. A trend holds when it stays clear with every country that has enough fire tested together, as in the rankings. Select a column to sort, a row to open the country in the Explorer.`}>
      <div className="db-toolbar">
        <label className="db-search">
          <IconSearch size={16} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a country" aria-label="Find a country"
            onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } }} />
          {q ? (
            <Tooltip content="Clear the search" keys={['Esc']}>
              <button type="button" className="db-search-clear ui-press" aria-label="Clear the search" onClick={() => setQ('')}><IconClose size={14} /></button>
            </Tooltip>
          ) : null}
        </label>
        <div className="ui-chips ui-scroll-fade" role="group" aria-label="Show the countries of a continent">
          <button type="button" className="ui-chip" aria-pressed={cont === 'all'} onClick={() => setCont('all')}>
            All <span className="db-chip-n ui-mono">{all.length}</span>
          </button>
          {chips.map((k) => {
            const chip = (
              <button key={k} type="button" className="ui-chip" aria-pressed={cont === k} onClick={() => setCont(cont === k ? 'all' : k)}>
                {k} <span className="db-chip-n ui-mono">{counts.get(k)}</span>
              </button>
            );
            return k === 'Europe' || k === 'Asia' ? <Tooltip key={k} content="Russia spans Europe and Asia, so it is in both">{chip}</Tooltip> : chip;
          })}
        </div>
        <label className="db-sortpick">
          <span>Sort</span>
          <select value={SORTS.some((o) => o.value === sortValue) ? sortValue : ''} onChange={(e) => {
            const o = SORTS.find((x) => x.value === e.target.value);
            if (o) setSort(o.s);
          }}>
            {SORTS.some((o) => o.value === sortValue) ? null : <option value="">Custom order</option>}
            {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>
      <p className="db-result" aria-live="polite">
        {rows.length === all.length
          ? `All ${all.length} countries.`
          : `${rows.length} of ${all.length} countries, with ${pct(shown, 0)} of the world’s fire.`}
      </p>
      <SortableTable columns={columns} rows={rows} rowKey={(c) => c.id} sort={sort} onSort={setSort}
        caption={`The ${all.length} countries with the most fire, ${sort.dir === 'asc' ? 'lowest' : 'highest'} first by ${columns.find((c) => c.key === sort.key)?.label.toLowerCase() ?? 'hotspots'}`}
        onRowClick={(c) => openArea(c.kind, c.id)} rowHeader="name"
        className={showAll || rows.length <= PHONE_ROWS ? 'db-table-countries' : 'db-table-countries db-limit'}
        empty={(
          <>
            <span>No country matches {q ? `“${q.trim()}”` : 'this filter'}{cont !== 'all' ? ` in ${cont}` : ''}.</span>
            <button type="button" className="ui-btn ui-btn-ghost" onClick={() => { setQ(''); setCont('all'); }}>Show all countries</button>
          </>
        )} />
      {rows.length > PHONE_ROWS ? (
        <button type="button" className="ui-btn db-only-sm db-more" aria-expanded={showAll} onClick={toggleAll}>
          {showAll ? `Show the first ${PHONE_ROWS}` : `Show all ${rows.length} countries`}
        </button>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------- the parts of a place
type PartRow = Part & { rank: number; share: number | null; self: boolean };

/** A part's trend in view: over the whole record the verdict of Rankings, else the part's own test (verdict.ts). */
function PartTrend({ c, scope, rows }: { c: Part; scope: Scope; rows: PlaceRow[] | null }) {
  const st = c.stats;
  const v = viewVerdict({ pct: st.trendPct, p: st.trendP, direction: st.direction, from: st.trendFrom, to: st.trendTo }, scope, c.row, rows, st.perYear);
  return <TrendMark tone={v.tone} word={v.word} value={pct(st.trendPct ?? 0, 1, true)} unit="a decade" />;
}

/** The parts of the place in view (the countries of a continent, the states of a country) with their numbers in the
 *  scope: fire a year, its share, the trend and the latest month, all from each part's own series. */
function PartsTable({ parts, kind, scope, data, title, note }: {
  parts: Part[]; kind: 'continent' | 'country' | 'state'; scope: Scope; data: ScopeData; title: string; note: string;
}) {
  const [sort, setSort] = useState<SortState>({ key: 'mean', dir: 'desc' });
  const parent = data.view?.total ?? 0;
  const self = scope.place.type === 'named' && scope.place.kind === 'state' ? scope.place.id : null;
  const list = parts.filter((x) => x.row.kind === kind);
  const sum = list.reduce((a, x) => a + x.stats.total, 0);
  const base = kind === 'continent' || (self && kind === 'state') ? sum : parent;
  const rows: PartRow[] = list.map((x, i) => ({ ...x, rank: i + 1, share: base > 0 ? (100 * x.stats.total) / base : null, self: x.row.id === self }));
  const latestYm = rows.find((r) => r.stats.latestYm)?.stats.latestYm ?? null;
  const latestName = latestYm ? monthYear(latestYm) : 'Latest month';
  const latestShort = latestYm ? `${monthShort(latestYm % 100)} ${Math.floor(latestYm / 100)}` : '';
  const shareOf = kind === 'continent' ? 'world' : self ? 'these states' : data.short;
  const [showAll, setShowAll] = useState(false);
  const countryOf = (iso: string | null) => data.rows?.find((r) => r.kind === 'country' && r.iso3 === iso)?.name ?? iso ?? '';
  // the line draws the full years (or seasons) in view, so its column says which
  const shownYears = rows.find((r) => r.stats.yearsShown.length > 1)?.stats.yearsShown ?? [];
  const sparkYears = shownYears.length > 1 ? yearsLabel([shownYears[0], shownYears[shownYears.length - 1]]) : yearsLabel(scope.years);
  // the trend of the years in view (2001 to 2025 by default, the same label as the other tables and Rankings)
  const tr = rows.find((r) => r.stats.trendPct !== null)?.stats;
  const trendYears = tr ? yearsLabel([tr.trendFrom, tr.trendTo]) : yearsLabel(scope.years);
  const columns: SortColumn<PartRow>[] = [
    { key: 'rank', label: 'Rank', num: true, sort: (c) => c.rank, first: 'asc', render: (c) => <span className="db-rankcell ui-mono">{c.rank}</span>, className: 'db-col-rank' },
    { key: 'name', label: kind === 'continent' ? 'Continent' : kind === 'country' ? 'Country' : 'State', sort: (c) => c.own, className: 'db-c-name', render: (c) => (
      <span className="db-place">
        <AreaLink kind={c.row.kind} id={c.row.id}>{c.own}</AreaLink>
        <span className="db-place-sub">{c.self ? 'The place in view' : c.row.kind === 'country' ? c.row.continent ?? c.row.id : c.row.kind === 'state' ? `State in ${countryOf(c.row.iso3)}` : 'Continent'}</span>
      </span>
    ) },
    { key: 'spark', label: sparkYears, render: (c) => <PartSpark p={c} />, className: 'db-col-spark' },
    { key: 'mean', label: scope.months ? `${seasonLabel(scope.months, true)} hotspots a year` : 'Hotspots a year', num: true, sort: (c) => c.stats.perYear ?? -1, className: 'db-c-mean', render: (c) => (
      <span className="db-stack-num">
        <span><span className="ui-mono">{c.stats.perYear === null ? '–' : count(c.stats.perYear)}</span><span className="db-only-sm db-unit"> hotspots a year</span></span>
        {c.share !== null ? <span className="db-num-sub ui-mono">{pct(c.share, c.share < 10 ? 1 : 0)} of {shareOf}</span> : null}
      </span>
    ) },
    { key: 'trend', label: `Trend per decade, ${trendYears}`, help: TREND_LOG_NOTE, sort: (c) => c.stats.trendPct ?? 0, first: 'desc', className: 'db-c-trend', render: (c) => (
      c.stats.trendPct === null ? <span className="db-muted">Not enough years<span className="db-only-sm"> for a trend</span></span>
        : <PartTrend c={c} scope={scope} rows={data.rows} />
    ) },
    { key: 'season', label: 'Fire season peak', render: (c) => <MonthLetters months={c.stats.critical} />, className: 'db-col-season' },
    { key: 'latest', label: `${latestName} against normal`, num: true, sort: (c) => c.stats.latestRatio ?? 0, className: 'db-c-latest',
      render: (c) => <Latest ratio={c.stats.latestRatio} when={latestShort} /> },
  ];
  const rankings = kind === 'continent' ? '#/rankings?kind=continent'
    : kind === 'country' ? (scope.place.type === 'named' && scope.place.kind === 'continent' ? `#/rankings?kind=country&continent=${encodeURIComponent(scope.place.id)}` : '#/rankings?kind=country')
      : `#/rankings?kind=state&country=${encodeURIComponent(list[0]?.row.iso3 ?? '')}`;
  return (
    <Card title={title} subtitle={note}>
      <SortableTable columns={columns} rows={rows} rowKey={(c) => c.row.id} sort={sort} onSort={setSort} rowHeader="name"
        caption={title} onRowClick={(c) => openArea(c.row.kind, c.row.id)} rowClass={(c) => (c.self ? 'is-self' : undefined)}
        className={showAll || rows.length <= PART_ROWS ? 'db-table-countries db-table-parts' : 'db-table-countries db-table-parts db-limit-5'} />
      <div className="db-parts-foot">
        {rows.length > PART_ROWS ? (
          <button type="button" className="ui-btn db-only-sm db-more" aria-expanded={showAll} onClick={() => setShowAll((o) => !o)}>
            {showAll ? `Show the first ${PART_ROWS}` : `Show all ${rows.length}`}
          </button>
        ) : null}
        <PageLinkTo href={rankings}>Every {kind === 'continent' ? 'continent' : kind === 'country' ? 'country' : 'state'} in the rankings</PageLinkTo>
      </div>
    </Card>
  );
}

function PageLinkTo({ href, children }: { href: string; children: ReactNode }) {
  return <a className="db-link db-link-page" href={href}><span className="db-link-text">{children}</span><IconChevronRight className="db-link-icon" size={14} /></a>;
}

function ScopedPlaces({ scope, data }: { scope: Scope; data: ScopeData }) {
  const parts = data.parts;
  const p = scope.place;
  const inView = `${scope.months ? `${seasonLabel(scope.months)} of each year` : 'Every month'}, ${yearsLabel(scope.years)}${scope.scale === 'harmonized' ? '' : `, ${scope.scale === 'modis' ? 'on the MODIS scale' : 'raw detections'}`}`;
  if (p.type === 'circle') {
    return (
      <Callout title="A circle has no parts">
        <p className="db-callout-p">{data.name} is a circle drawn around the city, so it has no states or countries of its own. Open the
          {' '}<a className="db-link" href="#/rankings?kind=state"><span className="db-link-text">rankings</span></a> to compare it with the states around it,
          or pick its province in the scope bar.</p>
      </Callout>
    );
  }
  if (!parts) return <div className="db-parts-wait" role="status"><span className="db-spin" aria-hidden="true" />Adding up the parts of {data.short}…</div>;
  const world = isWorld(p);
  const whole = scope.months === null && scope.scale === 'harmonized' && scope.years[0] <= 2001 && scope.years[1] >= 2025;
  const trendNote = whole ? 'A trend holds when it stays clear with all places tested together, as in the rankings.'
    : 'With a season, a range of years or another scale, each trend is tested on its own.';
  const kinds: ('continent' | 'country' | 'state')[] = world ? ['continent', 'country'] : p.kind === 'continent' ? ['country'] : ['state'];
  return (
    <div className="db-block-stack">
      {kinds.map((k) => {
        const n = parts.filter((x) => x.row.kind === k).length;
        const title = k === 'continent' ? 'Fire by continent'
          : k === 'country' ? `The ${n} countries ${world ? '' : `of ${data.short} `}with the most fire`
            : p.kind === 'state' ? `${data.short} among the states of ${data.row?.iso3 ? (data.rows?.find((r) => r.kind === 'country' && r.iso3 === data.row?.iso3)?.name ?? '') : ''}`
              : `The ${n} states of ${data.short} with the most fire`;
        return (
          <PartsTable key={k} parts={parts} kind={k} scope={scope} data={data} title={title.replace(/\s+/g, ' ')}
            note={`${inView}. Each number comes from the place’s own monthly record. ${trendNote} Select a column to sort, a row to open the place in the Explorer.`} />
        );
      })}
    </div>
  );
}

export function Places({ d, scope, data }: { d: DashboardData; scope: Scope; data: ScopeData }) {
  const scoped = data.view !== null;
  const p = scope.place;
  const title = !scoped || isWorld(p) ? 'Where the fire is' : p.type === 'circle' ? 'Where the fire is' : `Where the fire is in ${data.short}`;
  return (
    <DbSection id="db-where" title={title}
      subtitle={scoped ? `The parts of ${isWorld(p) ? 'the world' : data.name} in view: fire a year, its share, the trend and the latest month.`
        : 'Share of world fire, trends and the usual fire season, by continent and for the 25 countries with the most fire.'}>
      {scoped ? <ScopedPlaces scope={scope} data={data} /> : (
        <div className="db-block-stack">
          <Continents d={d} rows={data.rows} />
          <Countries d={d} rows={data.rows} />
        </div>
      )}
    </DbSection>
  );
}

// ---------------------------------------------------------------------------------------------- right now
/** The parts of a place most above normal in the latest month (web/places.json): the states of a country, the
 *  countries of a continent, the other states of a state's country. */
function HotNowScoped({ scope, data }: { scope: Scope; data: ScopeData }) {
  const rows = data.rows;
  const p = scope.place;
  if (!rows || p.type !== 'named') return null;
  const iso = p.kind === 'country' ? p.id : p.kind === 'state' ? data.row?.iso3 ?? null : null;
  const kind = p.kind === 'continent' ? 'country' : 'state';
  const floor = kind === 'country' ? 200 : 50;
  const list = rows.filter((r) => r.kind === kind && (p.kind === 'continent' ? r.continent === p.id : r.iso3 === iso)
    && r.latest_ratio !== null && (r.latest_normal ?? 0) >= floor)
    .sort((a, b) => (b.latest_ratio ?? 0) - (a.latest_ratio ?? 0)).slice(0, 12);
  const when = data.row?.latest_ym ? monthYear(data.row.latest_ym) : 'the latest month';
  const mo = data.row?.latest_ym ? monthName(data.row.latest_ym % 100) : 'month';
  const max = Math.max(1, ...list.map((r) => r.latest_ratio ?? 0));
  const own = (n: string) => (kind === 'state' && n.includes(', ') ? n.slice(0, n.lastIndexOf(', ')) : n);
  const parent = p.kind === 'state' ? rows.find((r) => r.kind === 'country' && r.iso3 === iso)?.name ?? '' : data.short;
  const me = data.row;
  return (
    <DbSection id="db-now" title="Unusual right now"
      subtitle={`The ${kind === 'country' ? 'countries' : 'states'} of ${parent} with the most fire against their normal in ${when}. Normal is the median ${mo} of 2001 to 2025. Only places with at least ${floor} hotspots in a normal ${mo} are listed. The latest month does not change with the months and years in view.`}>
      <div className="db-row db-row-8-4">
        <Card title={`Most above normal in ${when}`} subtitle={`${kind === 'country' ? 'Countries' : 'States'} by fire against a normal ${mo}. Select a row to open it in the Explorer.`}>
          {list.length ? (
            <RankList label={`Places most above normal in ${when}`} colour="--anom-r3"
              items={list.map((r) => ({
                key: r.id, kind: r.kind, id: r.id, name: own(r.name),
                linkLabel: `${own(r.name)}: ${timesNormal(r.latest_ratio ?? 0)}. Open in the Explorer`,
                detail: <><span className="ui-mono">{int(r.latest ?? 0)}</span> hotspots, normal <span className="ui-mono">{int(r.latest_normal ?? 0)}</span></>,
                value: <>{ratioNum(r.latest_ratio ?? 0)}<span className="db-unit"> times</span></>,
                frac: (r.latest_ratio ?? 0) / max,
              }))} />
          ) : <p className="db-card-note">No {kind === 'country' ? 'country' : 'state'} here has enough fire in a normal {mo} to compare.</p>}
        </Card>
        <div className="db-col">
          {me && me.latest_ratio !== null ? (
            <Callout title={`${data.short} as a whole`}>
              <p className="db-callout-p">
                {data.short} had <b className="ui-mono">{ratioNum(me.latest_ratio)}</b> times its normal {mo} fire in {when}
                {me.latest_rank && me.latest_years ? `, the ${t.panels.rank(me.latest_rank, me.latest_years, mo)}` : ''}.
                {me.ytd_ratio !== null ? ` So far this year it has ${ratioNum(me.ytd_ratio)} times a normal year to date.` : ''}
              </p>
            </Callout>
          ) : null}
        </div>
      </div>
    </DbSection>
  );
}

export function HotNow({ d, scope, data }: { d: DashboardData; scope: Scope; data: ScopeData }) {
  if (!isWorld(scope.place) && scope.place.type === 'named') return <HotNowScoped scope={scope} data={data} />;
  return <HotNowWorld d={d} />;
}

function HotNowWorld({ d }: { d: DashboardData }) {
  const hot = d.hot_now;
  if (!hot.length) return null;
  const when = monthYear(hot[0].yr * 100 + hot[0].mo);
  const mo = monthName(hot[0].mo);
  const max = Math.max(...hot.map((h) => h.ratio));
  // which countries the list falls in (a state name ends with its country)
  const byCountry = new Map<string, { name: string; n: number }>();
  for (const h of hot) {
    const name = h.kind === 'country' ? h.name : h.name.split(', ').slice(-1)[0];
    const v = byCountry.get(name) ?? { name, n: 0 };
    v.n += 1;
    byCountry.set(name, v);
  }
  const groups = [...byCountry.values()].sort((a, b) => b.n - a.n);
  const lead = groups.slice(0, 2).filter((g) => g.n >= 2);
  const leadN = lead.reduce((s, g) => s + g.n, 0);
  const leadCountry = lead[0] ? d.countries.find((c) => c.name === lead[0].name) : undefined;
  const bigAbove = d.countries.filter((c) => c.latest_ratio !== null && c.latest_ratio >= 1.25)
    .sort((a, b) => (b.latest_ratio ?? 0) - (a.latest_ratio ?? 0));
  const bigMax = Math.max(...bigAbove.map((c) => c.latest_ratio ?? 0), 1);
  // the other side of the same month: big fire countries with less fire than normal, most fire first
  const bigBelow = d.countries.filter((c) => c.latest_ratio !== null && c.latest_ratio < 1)
    .sort((a, b) => b.mean_per_year - a.mean_per_year);

  return (
    <DbSection id="db-now" title="Unusual right now"
      subtitle={`The areas with the most fire against their normal in ${when}. Normal is the median ${mo} of 2001 to 2025. Only areas with at least 200 hotspots in a normal ${mo} are listed, so a few fires in a quiet place do not top the list.`}>
      <div className="db-row db-row-8-4">
        <Card title={`Most above normal in ${when}`} subtitle={`Countries and states, by fire against a normal ${mo}. Select a row to open it in the Explorer.`}>
          <RankList label={`Areas most above normal in ${when}`} colour="--anom-r3"
            items={hot.map((h) => ({
              key: `${h.kind}:${h.id}`, kind: h.kind, id: h.id,
              name: h.name,
              linkLabel: `${h.name}: ${timesNormal(h.ratio)}, ${int(h.h)} hotspots against a normal ${int(h.normal)}. Open in the Explorer`,
              detail: <><span className="ui-mono">{int(h.h)}</span> hotspots, normal <span className="ui-mono">{int(h.normal)}</span></>,
              value: <>{ratioNum(h.ratio)}<span className="db-unit"> times</span></>,
              frac: h.ratio / max,
            }))} />
        </Card>
        <div className="db-col">
          {lead.length ? (
            <Callout title="What this shows">
              <p className="db-callout-p">
                {leadN} of the {hot.length} areas are in {andList(lead.map((g) => g.name))}.
                {leadCountry && leadCountry.latest_ratio !== null
                  ? ` ${leadCountry.name} as a whole had ${ratioNum(leadCountry.latest_ratio)} times its normal ${mo} fire.` : ''}
              </p>
            </Callout>
          ) : null}
          {bigAbove.length ? (
            <Card title="Big fire countries above normal" subtitle={`Of the ${d.countries.length} countries with the most fire, these had at least 1.25 times their normal ${mo}.`}>
              <RankList label={`Big fire countries above normal in ${when}`} colour="--anom-r2"
                items={bigAbove.map((c) => ({
                  key: c.id, kind: c.kind, id: c.id,
                  name: c.name,
                  linkLabel: `${c.name}: ${timesNormal(c.latest_ratio ?? 0)}. Open in the Explorer`,
                  value: <>{ratioNum(c.latest_ratio ?? 0)}<span className="db-unit"> times</span></>,
                  frac: (c.latest_ratio ?? 0) / bigMax,
                }))} />
              {bigBelow.length ? (
                <p className="db-card-note db-card-foot">
                  {bigBelow.length} of the {d.countries.length} had less fire than in a normal {mo}, among
                  them {andList(bigBelow.slice(0, 3).map((c) => c.name))}.
                </p>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>
    </DbSection>
  );
}
