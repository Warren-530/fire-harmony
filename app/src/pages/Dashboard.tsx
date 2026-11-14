// The analytics dashboard (#/dashboard): every statistic of Fire Harmony on one page. A scope bar sets what the page
// shows (a place, the years, the months of each year and the scale) and every chart that can follow a place does; the
// sections about the satellites and the model always show the world and say so. The link keeps the scope and the
// section ("#/dashboard?area=country:IDN&months=8-10&s=world"). A sticky strip of section chips follows the reading
// position. On phones each section shows its first part, with the rest one tap away.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { areaSeries, loadDashboard } from '../lib/data';
import type { DashboardData } from '../lib/dashboard-types';
import { FIRST_YEAR } from '../lib/config';
import { valueOf } from '../lib/stats';
import { saveFile, fileSlug } from '../lib/download';
import { citation } from '../lib/i18n';
import { Badge, Note, Page, PageHeader, Tooltip } from '../components/ui';
import { IconBook, IconDownload, IconFilter } from '../components/icons';
import { useToast } from '../components/Toast';
import { useCopy } from '../components/pages/clipboard';
import { useCommand } from '../lib/commands';
import { Glance } from '../components/dashboard/Glance';
import { World } from '../components/dashboard/World';
import { HotNow, Places } from '../components/dashboard/Places';
import { Seam } from '../components/dashboard/Seam';
import { Model } from '../components/dashboard/Model';
import { Mask, Physics } from '../components/dashboard/Physics';
import { Drivers } from '../components/dashboard/Drivers';
import { OutlookSection } from '../components/dashboard/Outlook';
import { outlookSkill } from '../components/methods/skill';
import { HazeSummary } from '../components/dashboard/HazeSummary';
import { DashboardError, DashboardSkeleton, PageLink } from '../components/dashboard/parts';
import { SectionNav, scrollToSection, sectionFromHash, useReveal, type NavItem } from '../components/dashboard/Navigation';
import { openSection, SectionScopeContext } from '../components/dashboard/DbSection';
import { ScopeBar, ScopeSheet, scopeChanges, scopeWords, SCALE_WORDS } from '../components/dashboard/ScopeBar';
import { allTime, defaultScope, isDefaultScope, isWorld, scopeFromHash, seasonLabel, WORLD_PLACE, yearsLabel, type Scope } from '../components/dashboard/scope';
import { sectionHash, useScopeData, useScopeState, type ScopeData } from '../components/dashboard/useScope';
import { monthYear } from '../components/dashboard/format';
import '../styles/dashboard.css';

type State = { status: 'loading' } | { status: 'ready'; data: DashboardData } | { status: 'error'; message: string };

interface Ctx { d: DashboardData; scope: Scope; data: ScopeData; worldMonthly: Map<number, number> | null }

interface SectionDef extends NavItem {
  render: (c: Ctx) => ReactNode;
  has?: (d: DashboardData) => boolean;
  /** The section is about the satellites or the model: it always shows the world, every month. */
  world?: boolean;
}

const SECTIONS: SectionDef[] = [
  { id: 'glance', label: 'At a glance', render: (c) => <Glance d={c.d} scope={c.scope} data={c.data} /> },
  { id: 'world', label: 'Trend', render: (c) => <World d={c.d} scope={c.scope} data={c.data} worldMonthly={c.worldMonthly} /> },
  { id: 'where', label: 'Places', render: (c) => <Places d={c.d} scope={c.scope} data={c.data} /> },
  { id: 'now', label: 'Right now', render: (c) => <HotNow d={c.d} scope={c.scope} data={c.data} />, has: (d) => d.hot_now.length > 0 },
  { id: 'seam', label: 'Seam test', render: (c) => <Seam d={c.d} />, world: true },
  { id: 'model', label: 'Model', render: (c) => <Model d={c.d} />, world: true },
  { id: 'physics', label: 'Detection', render: (c) => <Physics d={c.d} />, has: (d) => d.physics !== null, world: true },
  { id: 'mask', label: 'Heat mask', render: (c) => <Mask d={c.d} />, world: true },
  { id: 'drivers', label: 'Drivers', render: (c) => <Drivers d={c.d} note={<PlaceNote c={c} kind="drivers" />} />, has: (d) => d.drivers !== null, world: true },
  { id: 'outlook', label: 'Outlook', render: (c) => <OutlookSection d={c.d} note={<PlaceNote c={c} kind="outlook" />} />, has: (d) => d.outlook !== null, world: true },
  { id: 'haze', label: 'Haze', render: (c) => <HazeSummary d={c.d} />, has: (d) => d.haze !== null, world: true },
];

/** What a world section says about the place in view, where the place has its own number (web/places.json). */
function PlaceNote({ c, kind }: { c: Ctx; kind: 'drivers' | 'outlook' }) {
  const r = c.data.row;
  if (!r || isWorld(c.scope.place)) return null;
  const name = c.data.short;
  let text: ReactNode = null;
  if (kind === 'drivers') {
    text = r.drivers_r2 === null ? <>{name} has too little fire for a model of its drivers.</>
      : r.drivers_r2 <= 0 ? <>In {name} the weather explains no more of the ups and downs of fire than a normal month would.</>
        : <>In {name}, rain deficits and heat explain <b className="ui-mono">{Math.round(r.drivers_r2 * 100)}%</b> of the ups and downs of monthly fire, on years the model never saw.</>;
  } else {
    // a release that scores against a fixed 50% chance writes that score for each place too (outlook.parquet)
    const ref = c.d.outlook && outlookSkill(c.d.outlook).fair ? 'a fixed 50% chance' : 'the normal chance';
    text = r.outlook_p === null || r.outlook_target === null ? <>{name} has no outlook: the model covers places with enough fire in their fire season.</>
      : <>{name}: a <b className="ui-mono">{Math.round(r.outlook_p * 100)}%</b> chance of above normal fire in {monthYear(r.outlook_target)}, against a normal chance of {Math.round((r.outlook_p_clim ?? 0) * 100)}%.{r.outlook_bss !== null ? ` On years it never saw, the outlook here is ${Math.round(r.outlook_bss * 100)}% better than ${ref}.` : ''}</>;
  }
  return <p className="db-place-note"><span className="db-place-note-tag">{c.data.kindWord}</span>{text}</p>;
}

const LEAD = 'Every statistic of the project in one place: the record and its trend, where fire burns, what is unusual '
  + 'now, the seam test, the models, the outlook and the haze. Choose a place, years and months above the charts, '
  + 'and every chart that can follow them does.';

const WORLD_HELP = 'This part is about the satellites and the model, so it always shows the whole world and every month.';

/** The world's months (for the year drawn over the normal year), read once. */
function useWorldMonthly(): Map<number, number> | null {
  const [m, setM] = useState<Map<number, number> | null>(null);
  useEffect(() => {
    let live = true;
    areaSeries({ type: 'named', area: { kind: 'world', id: 'WORLD', name: 'World', country_iso3: null, lat: 0, lon: 0, cells: 0, area_km2: 0 } })
      .then((pts) => {
        if (!live) return;
        const out = new Map<number, number>();
        for (const p of pts) { const v = valueOf(p, 'harmonized'); if (v !== null) out.set(p.yr * 100 + p.mo, v); }
        setM(out);
      }, () => undefined);
    return () => { live = false; };
  }, []);
  return m;
}

/** The numbers of a scope as CSV: each year (or season) in view, with a header that says what they are. */
function viewCsv(scope: Scope, data: ScopeData, version: string): string | null {
  const v = data.view;
  if (!v) return null;
  const lines = [
    `# Fire Harmony dashboard, data version ${version}: ${data.name}, ${seasonLabel(scope.months).toLowerCase()}, ${yearsLabel(scope.years)}, ${SCALE_WORDS[scope.scale].label.toLowerCase()}.`,
    '# Hotspots added up over the months in view of each year (a season that crosses the new year is filed under the year it starts).',
    '# lo and hi: the 90% range where months are modelled from MODIS (harmonized scale only).',
    `# Cite: ${citation(version)}`,
    'year,label,hotspots,lo,hi,months_known,complete,terra,aqua,suomi_npp,noaa20,noaa21',
    ...v.years.map((y) => [y.yr, y.label, Math.round(y.value * 10) / 10, y.lo === null ? '' : Math.round(y.lo), y.hi === null ? '' : Math.round(y.hi),
      y.months, y.complete ? 'yes' : 'no', y.sensors.t, y.sensors.a, y.sensors.s, y.sensors.n, y.sensors.j].join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

export function Dashboard() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    setSlow(false);
    const timer = window.setTimeout(() => { if (live) setSlow(true); }, 300);   // a skeleton only for slow loads
    loadDashboard().then(
      (data) => { if (live) setState({ status: 'ready', data }); },
      (e: unknown) => { if (live) setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }); },
    ).finally(() => window.clearTimeout(timer));
    return () => { live = false; window.clearTimeout(timer); };
  }, [attempt]);

  const d = state.status === 'ready' ? state.data : null;
  const lastYear = d ? Math.floor(d.record.latest_full_month / 100) : new Date().getFullYear();
  const [scope, setScope] = useScopeState(lastYear);
  const data = useScopeData(scope, lastYear);
  // A link to a place that is not in the list (#/dashboard?area=country:XXX): say so, and show the world
  const [badLink, setBadLink] = useState(() => {
    const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const asked = q.get('area') ?? q.get('place');
    return asked !== null && asked !== '' && isWorld(scopeFromHash(window.location.hash, lastYear).place) && !/^world(:|$)/i.test(asked);
  });
  useEffect(() => {
    const p = scope.place;
    if (!data.rows || p.type !== 'named' || p.kind === 'world') return;
    if (data.rows.some((r) => r.kind === p.kind && r.id === p.id)) return;
    setBadLink(true);
    setScope({ ...scope, place: WORLD_PLACE });
  }, [data.rows, scope, setScope]);
  const worldMonthly = useWorldMonthly();
  const deflt = isDefaultScope(scope, lastYear);
  const sections = useMemo(() => (d ? SECTIONS.filter((s) => !s.has || s.has(d)) : []), [d]);
  const items = useMemo<NavItem[]>(() => sections.map(({ id, label }) => ({ id, label })), [sections]);
  const [sheet, setSheet] = useState(false);
  const sheetBtn = useRef<HTMLButtonElement>(null);
  const flowBtn = useRef<HTMLButtonElement>(null);
  const [sheetFrom, setSheetFrom] = useState<'nav' | 'flow'>('nav');

  useReveal(body, d !== null);

  // "Copy a link to this view" from the command palette: the section in view, with the scope
  const copy = useCopy();
  useCommand((c) => {
    if (c.action !== 'copy-link') return;
    const s = document.querySelector<HTMLElement>('.db-nav-chip[aria-current="location"]')?.dataset.id ?? null;
    void copy(`${window.location.origin}${window.location.pathname}${sectionHash(s)}`, 'Link copied');
  }, []);

  // "#/dashboard?s=seam" opens the page at that section
  useEffect(() => {
    if (!d) return;
    const s = sectionFromHash(window.location.hash);
    if (!s) return;
    openSection(s);
    const id = requestAnimationFrame(() => scrollToSection(s, false));
    return () => cancelAnimationFrame(id);
  }, [d]);

  const download = () => {
    if (!d) return;
    const csv = deflt ? null : viewCsv(scope, data, d.version);
    if (csv) {
      saveFile(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `fire-harmony-${fileSlug(data.name)}-${scope.months ? fileSlug(seasonLabel(scope.months)) : 'year'}-${scope.years[0]}-${scope.years[1]}.csv`);
      toast(`The numbers of ${data.short} saved as CSV`);
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `fire-harmony-dashboard-v${d.version}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Dashboard numbers saved as JSON');
  };

  const latest = d ? monthYear(d.record.latest_full_month) : null;
  const normal = useMemo(() => (data.view ? data.view.season.map((m) => m.median) : d ? d.world.seasonality.map((m) => m.median) : []), [data.view, d]);
  const yearBars = useMemo(() => (data.view ? data.view.allYears.map((y) => ({ yr: y.yr, value: y.value, complete: y.complete }))
    : d ? d.world.yearly.map((y) => ({ yr: y.yr, value: y.harmonized, complete: y.complete })) : []), [data.view, d]);
  const reset = () => setScope(defaultScope(lastYear));
  const changes = scopeChanges(scope, lastYear);
  const words = scopeWords(scope, data.name, lastYear);
  const bar = d ? <ScopeBar scope={scope} lastYear={lastYear} data={data} normal={normal} years={yearBars} onChange={setScope} onReset={reset} isDefault={deflt} /> : null;
  const openSheet = (from: 'nav' | 'flow') => { setSheetFrom(from); setSheet(true); };
  const badgeOf = (s: SectionDef): string | null => {
    // a circle has no parts and no row of its own: what is unusual now is shown for the world
    if (s.id === 'now' && scope.place.type === 'circle') return 'World';
    if (!s.world) return null;
    return !isWorld(scope.place) ? 'World' : !allTime(scope, lastYear) || scope.scale !== 'harmonized' ? 'Whole record' : null;
  };

  // phones: the scope in words right under the title, so the first screen says what the numbers are of (the pinned
  // bar keeps a button for it)
  const flow = d ? (
    <div className="db-scope-flow">
      <button ref={flowBtn} type="button" className="db-scope-summary ui-press" onClick={() => openSheet('flow')} aria-haspopup="dialog"
        aria-expanded={sheet && sheetFrom === 'flow'} aria-label={`Change what the dashboard shows. Now: ${words}`}>
        <span className="db-scope-summary-icon" aria-hidden="true"><IconFilter size={18} /></span>
        <span className="db-scope-summary-text">
          <span className="db-scope-label">Showing</span>
          <span className="db-scope-summary-value">
            {data.short}<span className="db-scope-dot" aria-hidden="true"> · </span>{seasonLabel(scope.months, true)}
            <span className="db-scope-dot" aria-hidden="true"> · </span>
            {scope.years[0] === FIRST_YEAR && scope.years[1] === lastYear ? 'Whole record' : yearsLabel(scope.years)}
            {scope.scale !== 'harmonized' ? <><span className="db-scope-dot" aria-hidden="true"> · </span>{SCALE_WORDS[scope.scale].short}</> : null}
          </span>
        </span>
        <span className="db-scope-summary-go" aria-hidden="true">Change</span>
      </button>
    </div>
  ) : null;

  return (
    <div className="db-root">
      <Page>
        <PageHeader eyebrow="Analytics" lead={LEAD} under={flow}
          title={isWorld(scope.place) ? 'Fire across the world, in numbers' : scope.place.type === 'circle' ? `Fire around ${data.short}, in numbers` : `Fire in ${data.short}, in numbers`}
          actions={d ? (
            <>
              {/* only where the header's own "Data to" badge is hidden (phones) */}
              <span className="db-page-badge"><Badge tone="ember"><span className="db-live" aria-hidden="true" />Data to {latest}</Badge></span>
              <button type="button" className="ui-btn ui-btn-ghost" onClick={download}>
                <IconDownload size={16} />Download the numbers
              </button>
            </>
          ) : null} />

        {badLink ? <Note>The link points to a place we could not find, so we show the world.</Note> : null}
        {state.status === 'error' ? <DashboardError message={state.message} onRetry={() => setAttempt((n) => n + 1)} /> : null}
        {state.status === 'loading' ? (slow ? <DashboardSkeleton /> : <div className="db-wait" aria-hidden="true" />) : null}

        {d ? (
          <div ref={body} className="db-body" data-scoped={deflt ? undefined : ''}>
            <SectionNav items={items} scope={bar} tools={(
              <Tooltip content="Change the place, years, months and scale">
                <button ref={sheetBtn} type="button" className="ui-btn ui-btn-ghost ui-btn-icon db-nav-tool db-nav-scope" aria-haspopup="dialog"
                  aria-expanded={sheet && sheetFrom === 'nav'} aria-label={`Change what the dashboard shows. Now: ${words}`} onClick={() => openSheet('nav')}>
                  <IconFilter size={18} />
                  {changes ? <span className="db-nav-scope-n ui-mono" aria-hidden="true">{changes}</span> : null}
                </button>
              </Tooltip>
            )} />
            <ScopeSheet open={sheet} onClose={() => setSheet(false)} anchor={sheetFrom === 'nav' ? sheetBtn : flowBtn}
              scope={scope} lastYear={lastYear} data={data} normal={normal} years={yearBars} onChange={setScope} onReset={reset} isDefault={deflt} />
            {data.error ? (
              <p className="db-scope-error" role="alert">The numbers of {data.short} could not be loaded. The page shows the last place that loaded. Check the connection and pick the place again.</p>
            ) : null}
            {sections.map((s) => (
              <div key={s.id} className="db-reveal">
                <SectionScopeContext value={{ badge: badgeOf(s), badgeHelp: WORLD_HELP }}>
                  {s.render({ d, scope, data, worldMonthly })}
                </SectionScopeContext>
              </div>
            ))}
            <div className="db-reveal">
              <div className="db-block">
                <aside className="db-outro" aria-label="How these numbers are made">
                  <span className="db-outro-icon" aria-hidden="true"><IconBook size={20} /></span>
                  <div className="db-outro-text">
                    <p className="db-outro-title">How these numbers are made</p>
                    <p>
                      Every number here comes from the harmonized record, version {d.version}, built on{' '}
                      {new Date(d.built_utc).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.
                      The tests use years and regions the models never saw. The Methods page explains each step and its limits.
                    </p>
                  </div>
                  <div className="db-outro-links">
                    <PageLink href="#/rankings">Rank every place</PageLink>
                    <PageLink href="#/methods">Read the methods</PageLink>
                    <PageLink href="#/data">Get the data</PageLink>
                  </div>
                </aside>
              </div>
            </div>
          </div>
        ) : null}
      </Page>
    </div>
  );
}
