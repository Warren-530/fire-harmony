// Methods: how the record is made and how we tested it, as a documentation page. Every number comes from
// dashboard.json, meta.json (the burned area test) and web/eda.json (the raw record and the trend tests), so the page
// always matches the published data and the report. Charts are drawn live in the theme where the files hold the
// data (the calendars and the drivers of one province from the Explorer's own files, components/methods/PlaceFigures);
// the one report figure no file holds (the model's own predictions in the VIIRS years) stays a picture on a light card
// that opens larger.
// The English text lives here and in components/methods/.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as Plot from '@observablehq/plot';
import {
  Badge, Card, DataTable, Grid, Note, Page, PageHeader, PlotFigure, Section, Skeleton, StatGrid, StatTile, cssVar,
  type Column, type FigureTable,
} from '../components/ui';
import { IconCheck, IconChevronRight, IconDashboard, IconDatabase, IconReport, IconWind } from '../components/icons';
import { PROJECT_LINKS } from '../lib/config';
import { DocLayout, Lede, MarginNote, N, Sub, type DocSection } from '../components/pages/DocLayout';
import { FigureCard, FigureGallery, type FigureItem } from '../components/pages/Figures';
import { AreaLink, CellLabel, Problem, SourceBar } from '../components/pages/parts';
import { recordPeriods } from '../components/pages/record';
import { addMonths, int, millions, monthName, num, pct, share, yearOf } from '../components/pages/format';
import { ChecksGrid } from '../components/methods/Checks';
import { FoldSection } from '../components/methods/Fold';
import { LadderFigure, MaskFigure, OutlookFigures, SeamFigure, scaleName } from '../components/methods/LiveFigures';
import { RawRecordSection } from '../components/methods/RawRecord';
import { TrendsSection } from '../components/methods/Trends';
import { DriversFigures, HazeCalendars } from '../components/methods/PlaceFigures';
import { loadEda, type Eda } from '../components/methods/eda';
import { firstShift } from '../components/methods/RawRecord';
import { leadOf, outlookSkill } from '../components/methods/skill';
import { loadDashboard, loadMeta } from '../lib/data';
import type { DashboardData } from '../lib/dashboard-types';
import type { Meta } from '../lib/types';
import '../styles/pages.css';
import '../styles/methods.css';

type Dash = DashboardData;

const SECTIONS: DocSection[] = [
  { id: 'key-numbers', label: 'Key numbers' },
  { id: 'why', label: 'Why harmonize' },
  { id: 'raw-record', label: 'The raw record' },
  { id: 'one-scale', label: 'One record, one scale' },
  { id: 'static-heat', label: 'Heat that is not fire' },
  { id: 'tests', label: 'How we know it works' },
  { id: 'trends', label: 'How we test trends' },
  { id: 'unusual-months', label: 'Unusual months, outlook' },
  { id: 'haze', label: 'The haze link' },
  { id: 'limits', label: 'Limits' },
];

// The report figure that no published file can draw (the model's own predictions in the VIIRS years, fig09): a
// picture on a light card. The calendars and the drivers of fig10, fig12 and fig14 are drawn live (PlaceFigures).
const FIGURES: FigureItem[] = [
  {
    id: 'model', file: 'figures/fig09_model_vs_viirs.png', w: 1643, h: 990,
    title: 'From MODIS alone, the model tracks VIIRS until the MODIS orbits drift',
    caption: 'World hotspots per year on the NOAA‑20 VIIRS scale, in the months VIIRS observed. The model sees only MODIS, yet follows VIIRS closely from 2012 to 2019. From 2020, the first year it never saw, it reads a few percent low, and from 2021 the MODIS orbits drift as well.',
    alt: 'Line chart of world hotspots per year, 2012 to 2025, in millions. The green VIIRS line and the black model line overlap from 2012 to 2019, between about 15.3 and 17.5 million. From 2020 the model line runs a little below the VIIRS line, for example about 17.9 against 18.5 million in 2024.',
  },
];

const place = (name: string) => name.replace(/, (Indonesia|Malaysia)$/, '');

// ------------------------------------------------------------------------------------------------ the page

export function Methods() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [eda, setEda] = useState<Eda | null | 'failed'>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadDashboard().then((d) => { if (alive) setDash(d); }, () => { if (alive) setFailed(true); });
    loadMeta().then((m) => { if (alive) setMeta(m); }, () => undefined);   // only for the burned area test
    // the raw record and the trend tests (web/eda.json, 68 kB): a release without it shows a soft error there
    loadEda().then((e) => { if (alive) setEda(e ?? 'failed'); }, () => { if (alive) setEda('failed'); });
    return () => { alive = false; };
  }, [attempt]);
  const retry = () => { setFailed(false); setEda(null); setAttempt((a) => a + 1); };

  return (
    <Page>
      <div className="fh-pg">
      <PageHeader eyebrow="Methods" title="How Fire Harmony works"
        lead="Fire Harmony turns NASA fire hotspots from two kinds of satellite into one consistent record, from November 2000 to today. Here is how we built it, how we tested it, and where its limits are."
        actions={<>
          <a className="ui-btn ui-btn-primary" href={PROJECT_LINKS.report.href} target="_blank" rel="noopener"
            aria-label="Read the full report (PDF, opens in a new tab)"><IconReport size={16} />Read the full report (PDF)</a>
          <a className="ui-btn" href="#/dashboard"><IconDashboard size={16} />Every number</a>
          <a className="ui-btn ui-btn-ghost" href="#/data"><IconDatabase size={16} />Data and files</a>
        </>} />
      <FigureGallery figures={FIGURES}>
        <DocLayout page="methods" sections={SECTIONS} ready={dash !== null}>
          {dash ? <Body d={dash} meta={meta} eda={eda} onRetry={retry} />
            : failed ? <Card><Problem text="The numbers of this page could not be loaded." onRetry={retry} /></Card>
              : <BodySkeleton />}
        </DocLayout>
      </FigureGallery>
      </div>
    </Page>
  );
}

function BodySkeleton() {
  return (
    <>
      <div className="fh-keys-skeleton" aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} height={132} />)}
      </div>
      <Skeleton height={28} />
      <Skeleton height={220} />
      <Skeleton height={420} />
    </>
  );
}

function Body({ d, meta, eda, onRetry }: { d: Dash; meta: Meta | null; eda: Eda | null | 'failed'; onRetry: () => void }) {
  const edaPart = (id: string, title: string, draw: (e: Eda) => ReactNode) => (eda && eda !== 'failed' ? draw(eda) : (
    <Section id={id} title={title}>
      {eda === 'failed' ? <Card><Problem text="The analysis of the raw record could not be loaded." onRetry={onRetry} /></Card> : <Skeleton height={420} />}
    </Section>
  ));
  return (
    <>
      <ShortVersion d={d} eda={eda && eda !== 'failed' ? eda : null} />
      <KeyNumbers d={d} />
      <WhySection d={d} />
      {edaPart('raw-record', 'A first look at the raw record', (e) => <RawRecordSection e={e} d={d} />)}
      <ScaleSection d={d} />
      <MaskSection d={d} />
      <TestsSection d={d} meta={meta} />
      {edaPart('trends', 'How we test trends', (e) => <TrendsSection e={e} d={d} />)}
      <DriversSection d={d} />
      <HazeSection d={d} />
      <LimitsSection eda={eda && eda !== 'failed' ? eda : null} />
    </>
  );
}

// ------------------------------------------------------------------------------------------------ the short version

/** Goes to a section of this page (the contents follow the hash: components/pages/DocLayout.tsx). */
function SectionLink({ id, children }: { id: string; children: ReactNode }) {
  return <a className="fh-mx-short-link" href={`#/methods?section=${id}`}>{children}<IconChevronRight size={14} /></a>;
}

/** The five claims of the page, each with its number and a link to its evidence (every number from the files). */
function ShortVersion({ d, eda }: { d: Dash; eda: Eda | null }) {
  const s = d.seam, ba = s.burned_area;
  const l3 = d.models.cv.find((r) => r.scale === 'region L3 x month');
  const fdr = eda?.fdr.l3, hv = eda?.sensitivity.harmonized_vs_modis;
  const claims: { text: ReactNode; to: string; label: string }[] = [
    { text: <>Joined naively, world fire jumps <N>{num(s.naive_jump_2011_2012, 1)} times</N> in 2012. Fire Harmony steps by <N>{pct(s.steps['2012_harmonized_1y'], 2, true)}</N> there, inside the spread of steps at dates when nothing changed (<N>{pct(s.placebo['2012'].sd, 2)}</N>).</>, to: 'tests', label: 'The seam tests' },
    ...(l3 ? [{ text: <>From MODIS alone, the model puts a large region’s month within a median <N>{pct(l3.gbm_err, 1)}</N> of what VIIRS saw, on years and regions it never saw.</>, to: 'one-scale', label: 'The model' }] : []),
    { text: <>Every modelled month has a 90% range, and on held out data the ranges held for <N>{monthlyCoverage(d)}</N> of monthly totals.</>, to: 'tests', label: 'The ranges' },
    ...(ba ? [{ text: <>Burned area, a different measurement, agrees at the 2012 switch: the record steps by <N>{pct(ba.step_1y, 2, true)}</N> against it, inside the normal spread of <N>{pct(ba.placebo_sd, 2)}</N>.</>, to: 'tests', label: 'The burned area witness' }] : []),
    ...(fdr && hv ? [{ text: <>Where there is enough fire to test, fire fell in <N>{num(fdr.fall_per_rise_bh_005, 1)} times</N> as many places as it rose from 2001 to 2025, after false discovery control. A record from MODIS alone gives the same sign for <N>{pct(hv.h_significant_same_sign_pct, 0)}</N> of the countries with a significant trend.</>, to: 'trends', label: 'The trend tests' }] : []),
  ];
  return (
    <section className="fh-mx-short" aria-labelledby="fh-mx-short-title">
      <h2 className="fh-mx-short-title" id="fh-mx-short-title">Short version</h2>
      <ol className="fh-mx-short-list">
        {claims.map((c, i) => (
          <li key={i}>
            <span className="fh-mx-short-n ui-mono" aria-hidden="true">{i + 1}</span>
            <p>{c.text} <SectionLink id={c.to}>{c.label}</SectionLink></p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ key numbers

/** The range of the 90% coverage over the monthly scales, both models, as "92 to 96%". */
function monthlyCoverage(d: Dash): string {
  const v = d.models.coverage.filter((c) => c.scale.endsWith('month'))
    .flatMap((c) => [c.terra_aqua, c.terra_only]).filter((x): x is number => x !== null);
  if (!v.length) return '–';
  return `${num(100 * Math.min(...v), 0)} to ${num(100 * Math.max(...v), 0)}%`;
}

function KeyNumbers({ d }: { d: Dash }) {
  const s = d.seam;
  const l3 = d.models.cv.find((r) => r.scale === 'region L3 x month');
  const ph = d.physics;
  return (
    <FoldSection id="key-numbers" keep={4} title="Key numbers" subtitle="The results this page explains, and the tests behind them.">
      <div className="fh-keys">
        <StatGrid>
          <StatTile label="Joined naively, 2011 to 2012" value={num(s.naive_jump_2011_2012, 1)} unit="times"
            context={<>
              World fire seems to jump when MODIS and VIIRS are simply joined. Nothing changed on the ground.
              <JumpSpark yearly={d.world.yearly} />
            </>} />
          <StatTile label="Step at the 2012 switch" value={pct(s.steps['2012_harmonized_1y'], 2, true)}
            context={`Harmonized record against MODIS, which flew on both sides. Steps at dates when nothing changed vary by ${pct(s.placebo['2012'].sd, 2)}.`} />
          <StatTile label="Step at the 2002 switch" value={pct(s.steps['2002_harmonized'], 2, true)}
            context={`Against Terra, when Aqua joined in July 2002. Steps at other dates vary by ${pct(s.placebo['2002'].sd, 2)}.`} />
          {l3 ? (
            <StatTile label="Median error, large regions" value={pct(l3.gbm_err, 1)}
              context={`One region in one month, on held out years and regions. One exchange rate per region gives ${pct(l3.ratio_err, 1)}.`} />
          ) : null}
          <StatTile label="The 90% range held, monthly totals" value={monthlyCoverage(d)}
            context="Share of held out monthly totals inside their range, from one hexagon to the world. The aim is 90%." />
          <StatTile label="Static heat caught by the mask" value={share(d.mask.viirs.recall, 1)}
            context={`Of static VIIRS detections, on years the mask never saw. It removes ${share(d.mask.viirs.fire_loss, 2)} of real fires.`} />
          {ph ? (
            <StatTile label="Fires MODIS sees too" value={share(ph.seen.aqua_day)}
              context={`Of the fires Suomi NPP VIIRS saw by day, the share Aqua MODIS saw at the same hour, on ${ph.tiles.length} test tiles in 2019.`} />
          ) : null}
        </StatGrid>
      </div>
    </FoldSection>
  );
}

/** World fire per year, joined naively and harmonized, on one scale: the jump of 2012 at a glance. */
function JumpSpark({ yearly }: { yearly: Dash['world']['yearly'] }) {
  const ys = yearly.filter((y) => y.complete);
  if (ys.length < 3) return null;
  const max = Math.max(...ys.flatMap((y) => [y.naive, y.harmonized]));
  const W = 240, H = 44, pad = 3;
  const x = (i: number) => pad + (i / (ys.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const path = (k: 'naive' | 'harmonized') => ys.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v[k]).toFixed(1)}`).join('');
  return (
    <span className="fh-jump" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path d={path('naive')} className="fh-jump-naive" vectorEffect="non-scaling-stroke" />
        <path d={path('harmonized')} className="fh-jump-harm" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="fh-jump-keys">
        <span><i className="fh-jump-key fh-jump-key-naive" />Joined naively</span>
        <span><i className="fh-jump-key fh-jump-key-harm" />Harmonized</span>
        <span className="ui-mono">{ys[0].yr} to {ys[ys.length - 1].yr}</span>
      </span>
    </span>
  );
}

// ------------------------------------------------------------------------------------------------ why

function WhySection({ d }: { d: Dash }) {
  const s = d.seam;
  const years = d.world.yearly.filter((y) => y.yr >= 2010 && y.yr <= 2013);
  const columns: Column<(typeof years)[number]>[] = [
    { key: 'yr', label: 'Year', render: (r) => <span className="ui-mono">{r.yr}</span> },
    { key: 'naive', label: 'Joined naively', num: true, render: (r) => millions(r.naive) },
    { key: 'harmonized', label: 'Harmonized', num: true, render: (r) => millions(r.harmonized) },
  ];
  return (
    <FoldSection id="why" title="Why the record needs harmonizing" subtitle="Two kinds of camera, and a jump in fire that never happened.">
      <Lede aside={(
        <MarginNote label="Joined naively, 2011 to 2012" value={`${num(s.naive_jump_2011_2012, 1)}×`} unit="world fire">
          A jump that never happened on the ground. Only the camera changed.
        </MarginNote>
      )}>
        <p>A hotspot is one pixel that a satellite marked as unusually hot. Most hotspots are fires. NASA FIRMS holds hotspots from MODIS since November 2000 and from VIIRS since January 2012.</p>
        <p>VIIRS has a sharper camera: its pixels are 375 m across, against 1 km for MODIS. So it sees many more small fires.</p>
        <p>Joined as they are, the two records make world fire jump <N>{num(s.naive_jump_2011_2012, 1)} times</N> from 2011 to 2012. Nothing changed on the ground. Only the camera changed, so years before and after 2012 cannot be compared.</p>
        <p>Fire Harmony puts every month on one scale, so they can.</p>
      </Lede>
      <Grid wide>
        <SeamFigure d={d} />
        <Card title="Before and after the switch" subtitle="World hotspots per year, in millions">
          <DataTable columns={columns} rows={years} rowKey={(r) => String(r.yr)}
            caption="World hotspots per year around 2012, in millions, joined naively and harmonized" />
          <Note>Joined naively, the years before 2012 count MODIS hotspots and the years after count VIIRS hotspots. The harmonized record counts every year on the NOAA‑20 VIIRS scale.</Note>
        </Card>
      </Grid>
    </FoldSection>
  );
}

// ------------------------------------------------------------------------------------------------ one scale

interface SatRow { name: string; sensor: 'MODIS' | 'VIIRS'; token: string; x1: number; x2: number; first: number; last: number; role: string; short: string }

function satelliteRows(d: Dash): SatRow[] {
  const b = d.models.bridges;
  const info: Record<string, { name: string; sensor: 'MODIS' | 'VIIRS'; token: string; role: string; short: string }> = {
    terra: { name: 'Terra', sensor: 'MODIS', token: '--sensor-modis', role: 'Read by the model for every month before VIIRS; alone until June 2002.', short: '' },
    aqua: { name: 'Aqua', sensor: 'MODIS', token: '--sensor-modis', role: 'Read by the model, with Terra, from July 2002 until VIIRS.', short: '' },
    suominpp: { name: 'Suomi NPP', sensor: 'VIIRS', token: '--sensor-snpp', role: `Observed, scaled to NOAA‑20 by × ${num(b.snpp_to_noaa20, 2)} on average.`, short: `× ${num(b.snpp_to_noaa20, 2)}` },
    noaa20: { name: 'NOAA‑20', sensor: 'VIIRS', token: '--sensor-noaa20', role: 'Observed. The scale of the whole record.', short: 'the scale' },
    noaa21: { name: 'NOAA‑21', sensor: 'VIIRS', token: '--sensor-noaa21', role: `Observed, scaled to NOAA‑20 by × ${num(b.noaa21_to_noaa20, 3)} on average.`, short: `× ${num(b.noaa21_to_noaa20, 3)}` },
  };
  return d.record.satellites.flatMap((s) => {
    const i = info[s.satellite.replace(/[\s-]/g, '').toLowerCase()];
    if (!i) return [];
    return [{ name: i.name, sensor: i.sensor, token: i.token, x1: yearOf(s.first), x2: yearOf(addMonths(s.last, 1)),
      first: s.first, last: s.last, role: i.role, short: i.short }];
  });
}

function buildSatellites(width: number, rows: SatRow[]): Plot.PlotOptions {
  const narrow = width < 560;
  const colours = new Map(rows.map((r) => [r.token, cssVar(r.token)]));   // read at draw time: follows the theme
  const colourOf = (token: string) => colours.get(token) ?? cssVar(token);
  const c = { text2: cssVar('--text-2'), rule: cssVar('--border-strong'), surface: cssVar('--surface'), grid: cssVar('--border') };
  const seams = [
    { x: 2002.5, label: narrow ? 'Aqua joins' : 'Aqua joins, July 2002' },
    { x: 2012, label: narrow ? 'VIIRS starts' : 'VIIRS starts, 2012' },
  ];
  const start = Math.floor(Math.min(...rows.map((r) => r.x1)));
  const end = Math.ceil(Math.max(...rows.map((r) => r.x2)));
  const ticks: number[] = [];
  for (let y = Math.ceil((start + 1) / 5) * 5; y <= end; y += narrow ? 10 : 5) ticks.push(y);
  const label = (r: SatRow) => (narrow || r.name === 'NOAA‑20' ? r.short : `${r.short} to NOAA‑20`);
  return {
    height: 44 + rows.length * 38,
    marginLeft: narrow ? 74 : 86, marginRight: 12, marginTop: 30, marginBottom: 26,
    x: { domain: [start, end], ticks, tickFormat: (v: number) => String(v), label: null, tickSize: 0, tickPadding: 8, grid: true },
    y: { domain: rows.map((r) => r.name), label: null, tickSize: 0, tickPadding: 10, padding: 0.36 },
    marks: [
      Plot.ruleX(seams, { x: 'x', stroke: c.rule, strokeWidth: 1 }),
      Plot.text(seams, { x: 'x', text: 'label', frameAnchor: 'top', dy: -20, dx: 6, textAnchor: 'start', fill: c.text2, fontSize: 11, fontWeight: 600 }),
      Plot.barX(rows, { x1: 'x1', x2: 'x2', y: 'name', fill: (r: SatRow) => colourOf(r.token), rx: 4 }),
      Plot.text(rows.filter((r) => r.short), {
        x: 'x1', y: 'name', text: label, textAnchor: 'end', dx: -8, fill: c.text2, fontSize: 11, fontWeight: 600,
        stroke: c.surface, strokeWidth: 3, paintOrder: 'stroke',
      }),
      Plot.tip(rows, Plot.pointerY({
        x: (r: SatRow) => (r.x1 + r.x2) / 2, y: 'name', fill: c.surface, stroke: c.grid, fontSize: 12,
        title: (r: SatRow) => `${r.name} (${r.sensor})\n${monthName(r.first)} to ${monthName(r.last)}\n${r.role}`,
      })),
    ],
  };
}

function ScaleSection({ d }: { d: Dash }) {
  const b = d.models.bridges;
  const rows = useMemo(() => satelliteRows(d), [d]);
  const r = d.record;
  const firstFull = addMonths(r.latest_full_month, -(r.months - 1));
  const periods = recordPeriods(r.satellites, firstFull, r.latest_full_month, r.last_month);
  const viirsFrom = periods.find((p) => p.key === 'viirs')?.from;
  const satTable: FigureTable = {
    columns: ['Satellite', 'Camera', 'First month', 'Last month', 'Into the record'],
    rows: rows.map((x) => [x.name, x.sensor, monthName(x.first), monthName(x.last), x.sensor === 'MODIS' ? 'Read by the model' : x.short === 'the scale' ? 'The scale' : x.short]),
  };
  const l3 = d.models.cv.find((x) => x.scale === 'region L3 x month');
  return (
    <FoldSection id="one-scale" title="One record on one scale" subtitle="Five satellites, two cameras, and the bridges between them.">
      <Lede aside={l3 ? (
        <MarginNote label="Median error, large region, one month" value={pct(l3.gbm_err, 1)} unit="held out">
          On years and regions the model never saw. One exchange rate per region gives <N>{pct(l3.ratio_err, 1)}</N>.
        </MarginNote>
      ) : undefined}>
        <p>We count hotspots in hexagons of about 250 km², every month. Then we put the whole record on one scale: what one NOAA‑20 VIIRS satellite would record. We call it the harmonized record.</p>
        <p>From {viirsFrom ? monthName(viirsFrom) : '2012'}, VIIRS sees the fires directly. Suomi NPP reads a little more than NOAA‑20 and NOAA‑21 a little less, so we scale each one to NOAA‑20, region by region (on average <N>× {num(b.snpp_to_noaa20, 2)}</N> and <N>× {num(b.noaa21_to_noaa20, 3)}</N>), and take the average. More satellites never means more fire.</p>
        <p>Before that, only MODIS flew. For those months a gradient boosting model predicts what NOAA‑20 would have seen. It learned from 2012 to 2019, when both kinds of satellite flew, from what Terra and Aqua saw each month (hotspots by day and night, weak and strong, fire power, burning days), plus land cover, peat and the season.</p>
        <p>Terra flew alone until June 2002, so a second model works from Terra only. In its first three years next to Aqua it read a little lower than the main model, so we bridge it to the main model region by region (on average <N>× {num(b.terra_only_to_terra_aqua, 3)}</N>), as we do for the VIIRS satellites.</p>
        {l3 ? <p>Against one exchange rate per region and month, the model cuts the median error for a large region in one month from <N>{pct(l3.ratio_err, 1)}</N> to <N>{pct(l3.gbm_err, 1)}</N>. For whole continents and the world, the two are close. One hexagon in one month is too small to score this way: most such hexagon months have no fire at all.</p> : null}
        <p>Every modelled value has a 90% range. The true value should fall inside it 9 times out of 10.</p>
      </Lede>
      <Card>
        <PlotFigure
          title="Since 2012 VIIRS observes the fires. Before that, a model turns MODIS into the NOAA‑20 scale"
          subtitle="The years each satellite flew. Hover a bar for its months and its place in the record."
          source="Source: NASA FIRMS; analysis: Fire Harmony" height={44 + rows.length * 38}
          build={(w) => buildSatellites(w, rows)} deps={[rows]} table={satTable} />
        <div className="fh-pg-divider" />
        <div className="fh-pg-sub">
          <p className="fh-pg-sub-title">Where each month of the record comes from</p>
          <SourceBar periods={periods} />
        </div>
      </Card>
      {/* side by side only when each card keeps room for the ladder's names beside its bars and a readable picture */}
      <div className="fh-mx-pair">
        <Grid cols={2}>
          <LadderFigure d={d} />
          <FigureCard id="model" />
        </Grid>
      </div>
    </FoldSection>
  );
}

// ------------------------------------------------------------------------------------------------ static heat

function MaskSection({ d }: { d: Dash }) {
  const m = d.mask;
  type R = { what: string; viirs: string; modis: string };
  const rows: R[] = [
    { what: 'Static heat caught', viirs: share(m.viirs.recall, 1), modis: share(m.modis.recall, 1) },
    { what: 'Real fires removed', viirs: share(m.viirs.fire_loss, 2), modis: share(m.modis.fire_loss, 2) },
    { what: 'Static, of what it removes', viirs: share(m.viirs.precision, 1), modis: share(m.modis.precision, 1) },
  ];
  const columns: Column<R>[] = [
    { key: 'what', label: 'Test', render: (r) => r.what },
    { key: 'viirs', label: 'VIIRS', num: true, render: (r) => r.viirs },
    { key: 'modis', label: 'MODIS', num: true, render: (r) => r.modis },
  ];
  return (
    <FoldSection id="static-heat" title="Removing heat that is not fire" subtitle="Factories, gas flares and volcanoes are hot every day.">
      <Lede aside={(
        <MarginNote label="Static heat caught, VIIRS" value={share(m.viirs.recall, 1)} unit="on unseen years">
          It removes only <N>{share(m.viirs.fire_loss, 2)}</N> of real fires by mistake.
        </MarginNote>
      )}>
        <p>Satellites mark every hot pixel, so they mark factories, gas flares and volcanoes too. NASA labels most of them in the archive, but the newest data has no label yet.</p>
        <p>For those months we use a mask built from the GIHS list of industrial heat sources and from places that are hot all year round.</p>
        <p>We built the mask from data up to 2022 and tested it on 2024 and 2025, years it never saw. It catches <N>{share(m.viirs.recall, 1)}</N> of static VIIRS detections and removes only <N>{share(m.viirs.fire_loss, 2)}</N> of real fires.</p>
      </Lede>
      <Grid wide>
        <MaskFigure d={d} />
        <Card title="Tested on 2024 and 2025" subtitle="Years the mask never saw">
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.what} caption="How the static heat mask did on years it never saw" />
          <Note>Real fires removed: the share of vegetation fires that the mask would remove by mistake.</Note>
        </Card>
      </Grid>
    </FoldSection>
  );
}

// ------------------------------------------------------------------------------------------------ tests

interface PlaceboRow { key: string; label: string; real: number; mean: number; sd: number; steps: { yr: number; step: number }[] }
interface PlaceboPt { row: string; yr: number | null; step: number; sd: number }

/** The burned area placebo steps live in meta.json (validation), which has no type: read it with care. */
function burnedPlacebo(meta: Meta | null): Record<string, number> | null {
  const v = meta?.validation as { burned_area_witness?: { '1y'?: { placebo_steps?: Record<string, unknown> } } } | undefined;
  const steps = v?.burned_area_witness?.['1y']?.placebo_steps;
  if (!steps) return null;
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(steps)) if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
  return Object.keys(out).length ? out : null;
}

function placeboRows(d: Dash, meta: Meta | null): PlaceboRow[] {
  const s = d.seam;
  const toSteps = (o: Record<string, number>) => Object.entries(o).map(([yr, step]) => ({ yr: Number(yr), step })).sort((a, b) => a.yr - b.yr);
  const rows: PlaceboRow[] = [
    { key: '2002', label: '2002, against Terra', real: s.placebo['2002'].real, mean: s.placebo['2002'].mean, sd: s.placebo['2002'].sd, steps: toSteps(s.placebo['2002'].steps) },
    { key: '2012', label: '2012, against MODIS', real: s.placebo['2012'].real, mean: s.placebo['2012'].mean, sd: s.placebo['2012'].sd, steps: toSteps(s.placebo['2012'].steps) },
  ];
  const ba = s.burned_area, baSteps = burnedPlacebo(meta);
  if (ba && baSteps) {
    const st = toSteps(baSteps);
    const mean = st.reduce((a, x) => a + x.step, 0) / st.length;
    rows.push({ key: 'ba', label: '2012, against ESA burned area', real: ba.step_1y, mean, sd: ba.placebo_sd, steps: st });
  }
  return rows;
}

function buildPlacebo(width: number, rows: PlaceboRow[]): Plot.PlotOptions {
  const c = { text: cssVar('--text'), text2: cssVar('--text-2'), dot: cssVar('--text-3'), accent: cssVar('--accent'),
    surface: cssVar('--surface'), band: cssVar('--band'), base: cssVar('--border-strong'), grid: cssVar('--border') };
  const lim = Math.max(10, Math.ceil(Math.max(...rows.flatMap((r) => [Math.abs(r.real), ...r.steps.map((s) => Math.abs(s.step))])) / 5) * 5);
  const pts: PlaceboPt[] = rows.flatMap((r) => r.steps.map((s) => ({ row: r.label, yr: s.yr, step: s.step, sd: r.sd })));
  const real: PlaceboPt[] = rows.map((r) => ({ row: r.label, yr: null, step: r.real, sd: r.sd }));
  const signed = (v: number) => pct(v, 2, true);
  return {
    height: 34 + rows.length * 70, marginLeft: 12, marginRight: 16, marginTop: 6, marginBottom: 30,
    x: { domain: [-lim, lim], ticks: width < 480 ? [-lim, 0, lim] : [-lim, -lim / 2, 0, lim / 2, lim], label: null, grid: true, tickSize: 0, tickPadding: 8,
      tickFormat: (v: number) => (v === 0 ? '0' : pct(v, 0, true)) },
    y: { domain: rows.map((r) => r.label), axis: null, padding: 0.55 },
    marks: [
      Plot.barX(rows, { x1: (r: PlaceboRow) => Math.max(-lim, r.mean - 2 * r.sd), x2: (r: PlaceboRow) => Math.min(lim, r.mean + 2 * r.sd),
        y: 'label', fill: c.band, rx: 4 }),
      Plot.ruleX([0], { stroke: c.base }),
      Plot.text(rows, { x: -lim, y: 'label', text: 'label', textAnchor: 'start', dy: -27, fill: c.text2, fontSize: 12, fontWeight: 600 }),
      Plot.dot(pts, { x: 'step', y: 'row', r: 4.5, fill: c.dot, stroke: c.surface, strokeWidth: 2 }),
      Plot.dot(real, { x: 'step', y: 'row', r: 7, symbol: 'diamond2', fill: c.accent, stroke: c.surface, strokeWidth: 2 }),
      Plot.text(real, { x: 'step', y: 'row', text: (p: PlaceboPt) => `real ${signed(p.step)}`, dy: -15, fill: c.text, fontSize: 12, fontWeight: 600,
        stroke: c.surface, strokeWidth: 3, paintOrder: 'stroke' }),
      Plot.tip([...pts, ...real], Plot.pointer({
        x: 'step', y: 'row', fill: c.surface, stroke: c.grid, fontSize: 12,
        title: (p: PlaceboPt) => (p.yr === null
          ? `${p.row}\nThe real switch: ${signed(p.step)}\nSteps at other dates vary by ${pct(p.sd, 2)}`
          : `${p.row}\nA pretend switch in ${p.yr}: ${signed(p.step)}`),
      })),
    ],
  };
}

function TestsSection({ d, meta }: { d: Dash; meta: Meta | null }) {
  const s = d.seam;
  const placebo = useMemo(() => placeboRows(d, meta), [d, meta]);
  const ba = s.burned_area;
  const perKm2 = ba ? Object.values(ba.hotspots_per_km2) : [];
  const perKm2Years = ba ? Object.keys(ba.hotspots_per_km2).map(Number) : [];
  type StepRow = { test: string; real: number; other: number; digits: number; note: string; spread: number; z: number };
  const steps: StepRow[] = [
    { test: '2012, against MODIS', real: s.steps['2012_harmonized_1y'], other: s.steps['2012_naive_1y'], digits: 0, note: 'joined naively', spread: s.placebo['2012'].sd, z: s.placebo['2012'].z },
    ...(ba ? [{ test: '2012, against ESA burned area', real: ba.step_1y, other: ba.naive_step_1y, digits: 0, note: 'joined naively', spread: ba.placebo_sd, z: ba.z }] : []),
    { test: '2002, against Terra', real: s.steps['2002_harmonized'], other: s.steps['2002_without_bridge'], digits: 2, note: 'without the bridge', spread: s.placebo['2002'].sd, z: s.placebo['2002'].z },
  ];
  const stepColumns: Column<StepRow>[] = [
    { key: 'test', label: 'Switch and witness', render: (r) => r.test },
    { key: 'real', label: 'Harmonized', num: true, render: (r) => <><CellLabel>Harmonized</CellLabel>{pct(r.real, 2, true)}</> },
    { key: 'other', label: 'For comparison', num: true, render: (r) => (<>
      <CellLabel>For comparison</CellLabel>
      <span className="fh-pg-two"><span>{pct(r.other, r.digits, true)}</span><span className="fh-pg-two-note">{r.note}</span></span>
    </>) },
    { key: 'spread', label: 'Other dates vary by', num: true, render: (r) => <><CellLabel>Other dates vary by</CellLabel>{pct(r.spread, 2)}</> },
    { key: 'z', label: 'Verdict', render: (r) => (<>
      <CellLabel>Verdict</CellLabel>
      {Math.abs(r.z) <= 2 ? <Badge tone="good"><IconCheck size={12} />A normal step</Badge> : <Badge tone="warning">Unusual</Badge>}
    </>) },
  ];
  const cv = d.models.cv;
  const cvColumns: Column<(typeof cv)[number]>[] = [
    { key: 'scale', label: 'Area and period', render: (x) => scaleName(x.scale) },
    { key: 'ratio', label: 'One exchange rate', num: true, render: (x) => <><CellLabel>One exchange rate</CellLabel>{pct(x.ratio_err, 1)}</> },
    { key: 'gbm', label: 'Gradient boosting', num: true, render: (x) => <><CellLabel>Gradient boosting</CellLabel><strong className={x.gbm_err < x.ratio_err ? 'fh-better' : undefined}>{pct(x.gbm_err, 1)}</strong></> },
  ];
  const cov = d.models.coverage;
  const covColumns: Column<(typeof cov)[number]>[] = [
    { key: 'scale', label: 'Area and period', render: (x) => scaleName(x.scale) },
    { key: 'ta', label: 'Terra + Aqua years', num: true, render: (x) => <><CellLabel>Terra + Aqua years</CellLabel>{x.terra_aqua === null ? '–' : share(x.terra_aqua, 1)}</> },
    { key: 'to', label: 'Terra only years', num: true, render: (x) => <><CellLabel>Terra only years</CellLabel>{x.terra_only === null ? '–' : share(x.terra_only, 1)}</> },
  ];
  const pelt = s.pelt_near_seams['2012-01-01']?.naive_join ?? [];
  const peltMonths = pelt.map((x) => monthName(Number(x.slice(0, 4)) * 100 + Number(x.slice(5, 7))));
  const harmonizedBreaks = Object.values(s.pelt_near_seams).reduce((a, v) => a + (v.harmonized?.length ?? 0), 0);
  const pt = s.pettitt;
  const placeboTable: FigureTable = {
    columns: ['Switch and witness', 'Switch', 'Year', 'Step'],
    rows: placebo.flatMap((r) => [
      [r.label, 'Real', r.key === '2002' ? '2002' : '2012', pct(r.real, 2, true)],
      ...r.steps.map((x) => [r.label, 'Pretend', String(x.yr), pct(x.step, 2, true)]),
    ]),
  };
  return (
    <FoldSection id="tests" title="How we know it works" subtitle="Each check asks one question and says by a fixed rule how it came out.">
      <Lede aside={(
        <MarginNote label="The step at the 2012 switch" value={pct(s.steps['2012_harmonized_1y'], 2, true)} unit="against MODIS">
          Steps at dates when nothing changed vary by <N>{pct(s.placebo['2012'].sd, 2)}</N>. Joined naively, the step is <N>{pct(s.steps['2012_naive_1y'], 0, true)}</N>.
        </MarginNote>
      )}>
        <p>Two kinds of test check the record. Some score the model on held out years and held out regions: data it never saw while it learned. Others test the full record: against a witness that flew across a satellite switch, against burned area, or for a sudden break. Every check below asks one question, answers it with the published numbers, and says by a fixed rule whether the record passed.</p>
      </Lede>
      <ChecksGrid d={d} meta={meta} />
      <Sub title="The seam tests in detail">
        <Lede aside={(
          <MarginNote label="Breaks near a switch, harmonized" value={String(harmonizedBreaks)} unit="PELT test">
            {peltMonths.length ? <>Joined naively, the test finds breaks in {peltMonths.join(' and ')}.</> : 'Within 12 months of either switch.'}
          </MarginNote>
        )}>
          <p>A satellite that flew on both sides of a switch is a fair witness. MODIS flew across 2012: against it, the harmonized record steps by only <N>{pct(s.steps['2012_harmonized_1y'], 2, true)}</N> from 2011 to 2012, where the naive join steps by <N>{pct(s.steps['2012_naive_1y'], 0, true)}</N>. Terra flew across July 2002, when Aqua joined: against it, the record steps by <N>{pct(s.steps['2002_harmonized'], 2, true)}</N>. Without the Terra only bridge it would step by <N>{pct(s.steps['2002_without_bridge'], 2, true)}</N>.</p>
          <p>How big is a normal step? We ran the same test at dates when no satellite changed. There the steps vary by <N>{pct(s.placebo['2012'].sd, 2)}</N> against MODIS and <N>{pct(s.placebo['2002'].sd, 2)}</N> against Terra, so both real steps are normal.</p>
          {ba ? <p>Burned area is a different measurement: ESA Fire_cci maps the burn scars, from {Math.min(...perKm2Years)} to {Math.max(...perKm2Years)}. It uses MODIS hotspots to find where to look, but it does not change with the switch to VIIRS in 2012. Against it, the record steps by <N>{pct(ba.step_1y, 2, true)}</N> at the 2012 switch, inside the normal spread of <N>{pct(ba.placebo_sd, 2)}</N>. It starts in {Math.min(...perKm2Years)}, so it cannot test the 2002 switch. From {Math.min(...perKm2Years)} to {Math.max(...perKm2Years)} it holds <N>{num(Math.min(...perKm2), 1)} to {num(Math.max(...perKm2), 1)}</N> hotspots for every km² burned, and the yearly totals move together (r&nbsp;=&nbsp;<N>{num(ba.yearly_correlation, 2)}</N>).</p> : null}
          <p>Tests for sudden breaks agree. The PELT test finds {harmonizedBreaks === 0 ? 'no break' : `${harmonizedBreaks} breaks`} within 12 months of either switch in the harmonized record{peltMonths.length ? <>; in the naive join it finds breaks in {peltMonths.join(' and ')}</> : null}.{pt.naive_join && pt.harmonized ? <> On yearly totals, the Pettitt test puts the naive join’s break at {pt.naive_join.year}. For the harmonized record it points to {pt.harmonized.year}{pt.modis_scale ? <>, as MODIS alone points to {pt.modis_scale.year}</> : null}: world fire has slowly declined, by <N>{pct(Math.abs(d.world.trend.pct_per_decade), 1)}</N> a decade, and the test picks up that decline.</> : null}</p>
          <p>The 90% ranges held for <N>{monthlyCoverage(d)}</N> of held out monthly totals, from one hexagon to the whole world.</p>
        </Lede>
      <Card title="Steps at the satellite switches" subtitle="Change of the record against a witness that flew on both sides, one year before and after">
        <div className="fh-pg-stack fh-pg-stack-pairs">
          <DataTable columns={stepColumns} rows={steps} rowKey={(r) => r.test}
            caption="Step of the harmonized record at each switch, what it would be without harmonizing, and how much steps vary at dates when nothing changed" />
        </div>
      </Card>
      <div id="fig-placebo" className="fh-mx-jump-target">
      <Card>
        <PlotFigure
          title="The real steps are as small as steps at dates when nothing changed"
          subtitle={<>
            Step of the harmonized record against each witness, in %. Grey dots: pretend switches in other years. Diamonds: the real switch. Shaded: the normal range, twice the usual spread either side.
            {' '}Joined naively, the steps at 2012 are {pct(s.steps['2012_naive_1y'], 0, true)}{ba ? ` and ${pct(ba.naive_step_1y, 0, true)}` : ''}, far off this scale.
          </>}
          source="Source: NASA FIRMS, ESA Fire_cci; analysis: Fire Harmony" height={34 + placebo.length * 70}
          build={(w) => buildPlacebo(w, placebo)} deps={[placebo]} table={placeboTable} />
      </Card>
      </div>
      <Grid cols={2}>
        <Card title="Median error on held out data" subtitle="Lower is better. Years of MODIS Terra + Aqua.">
          <div className="fh-pg-keep-names fh-pg-stack fh-pg-stack-pairs">
            <DataTable columns={cvColumns} rows={cv} rowKey={(x) => x.scale}
              caption="Median error of one exchange rate per region and month, and of gradient boosting, on held out years and regions" />
          </div>
        </Card>
        <div id="tbl-coverage" className="fh-mx-jump-target">
          <Card title="How often the 90% range held" subtitle="Share of held out totals inside their 90% range. The aim is 90%.">
            <div className="fh-pg-keep-names fh-pg-stack fh-pg-stack-pairs">
              <DataTable columns={covColumns} rows={cov} rowKey={(x) => x.scale}
                caption="Share of held out totals inside their 90% range, for the Terra + Aqua and the Terra only models" />
            </div>
          </Card>
        </div>
      </Grid>
      </Sub>
    </FoldSection>
  );
}

// ------------------------------------------------------------------------------------------------ drivers and outlook

function DriversSection({ d }: { d: Dash }) {
  const dr = d.drivers, o = d.outlook;
  const top = dr?.top.slice(0, 2) ?? [];
  const idn = dr?.enso.find((e) => e.id === 'IDN');
  const skill = o ? outlookSkill(o) : null;
  const cal = o?.calibration.filter((c) => c.n >= 1000).reduce<{ p: number; o: number; n: number } | null>(
    (a, c) => (a === null || Math.abs(c.p - 0.75) < Math.abs(a.p - 0.75) ? c : a), null) ?? null;
  const s1 = skill ? leadOf(skill, 1) : null, s3 = skill ? leadOf(skill, 3) : null;
  const l1 = s1?.bss ?? null, l3 = s3?.bss ?? null;
  const range = (x: { lo: number | null; hi: number | null } | null) => (x && x.lo !== null && x.hi !== null
    ? <> (95% interval <N>{share(x.lo, 1)} to {share(x.hi, 1)}</N>)</> : null);
  const withSkill = skill?.share?.['1'] ?? null;
  return (
    <FoldSection id="unusual-months" title="Why months are unusual, and the outlook" subtitle="Rain, heat and El Niño, and the chance of above normal fire in the months ahead.">
      <Lede aside={l1 !== null ? (
        <MarginNote label="Outlook, one month ahead" value={share(l1, 1)} unit="better">
          Than {skill?.reference ?? 'the share of past years above normal'}, on blocks of years it never saw (Brier skill score).
        </MarginNote>
      ) : undefined}>
        <p>Why is a month unusual? For every country and state with enough fire, we bring NASA rain (GPM IMERG), weather (MERRA‑2) and fire weather (GFWED) onto the fire hexagons, and measure how strongly fire follows a lack of rain and heat.</p>
        {dr ? <p>On years left out, rain and heat explain more than 20% of the ups and downs of fire in <N>{share(dr.share_r2_above_0_2)}</N> of the {int(dr.areas)} areas{top.length ? <>, and up to <N>{share(top[0].r2_cv)}</N> in Indonesian provinces such as {top.map((t, i) => (
          <span key={t.id}>{i ? ' and ' : ''}<AreaLink kind={t.kind} id={t.id}>{place(t.name)}</AreaLink></span>))}</> : null}.{idn ? <> El Niño acts through the rain: in Indonesia, El Niño and the rain of the last three months move against each other (r&nbsp;=&nbsp;<N>{num(idn.enso_r, 2)}</N>).</> : null}</p> : null}
        {o ? <p>The outlook gives the chance of above normal fire one to three months ahead, from recent fire, rain, temperature, El Niño and the Indian Ocean Dipole, for the months of the fire season in {int(o.areas)} areas.</p> : null}
        {o && skill && l1 !== null && l3 !== null ? <p>We score it with the Brier skill score, {skill.against} for the month: <N>0</N> is no better, <N>100%</N> is perfect. On blocks of years it never saw, it scores <N>{share(l1, 1)}</N>{range(s1)} one month ahead and <N>{share(l3, 1)}</N>{range(s3)} three months ahead{skill.fair ? <>: the skill fades by three months</> : null}.{withSkill !== null ? <> One month ahead it has skill in <N>{share(withSkill, 1)}</N> of the areas</> : null}{cal ? <>{withSkill !== null ? ', and its' : ' Its'} chances can be trusted: when it gave a <N>{share(cal.p)}</N> chance, fire came out above normal <N>{share(cal.o)}</N> of the time</> : null}{withSkill !== null || cal ? '.' : null}</p> : null}
      </Lede>
      <OutlookFigures d={d} />
      <DriversFigures />
      <Card title="Open the drivers of any place" subtitle="The Explorer shows why each month was unusual"
        actions={top[0] ? <AreaLink kind={top[0].kind} id={top[0].id} className="ui-btn">Open {place(top[0].name)} in the Explorer</AreaLink> : undefined}>
        <p className="fh-mx-card-text">Pick a place in the Explorer and open its Drivers tab: the rain, heat and fire weather of every month next to its fire, with the share of the ups and downs they explain on years left out.</p>
      </Card>
    </FoldSection>
  );
}

// ------------------------------------------------------------------------------------------------ haze

/** The haze cities listed before "Show all" (the haze link has more cities than the eight of its first release). */
const HAZE_ROWS = 8;

function HazeSection({ d }: { d: Dash }) {
  const h = d.haze;
  const cities = h ? [...h.cities].sort((a, b) => b.r2_cv - a.r2_cv) : [];
  const [allCities, setAllCities] = useState(false);
  const lo = cities[cities.length - 1], hi = cities[0];
  const columns: Column<(typeof cities)[number]>[] = [
    { key: 'name', label: 'City', render: (c) => <a className="fh-pg-link" href={`#/haze?city=${encodeURIComponent(c.name)}`}>{c.name}</a> },
    { key: 'r2', label: 'Year to year changes explained, with the month of year', num: true, render: (c) => <><CellLabel>Year to year changes explained, with the month of year</CellLabel>{share(c.r2_cv)}</> },
    { key: 'sumatra', label: 'Smoke from Sumatra', num: true, render: (c) => <><CellLabel>Smoke from Sumatra</CellLabel>{share(c.share_sumatra)}</> },
    { key: 'borneo', label: 'Smoke from Borneo', num: true, render: (c) => <><CellLabel>Smoke from Borneo</CellLabel>{share(c.share_borneo)}</> },
  ];
  return (
    <FoldSection id="haze" title="The haze link" subtitle="How much of the haze in the cities near Sumatra and Borneo is smoke from the fires there.">
      <Lede aside={lo && hi ? (
        <MarginNote label="Changes explained, with the month of year" value={`${num(100 * lo.r2_cv, 0)} to ${share(hi.r2_cv)}`} unit="of PM2.5">
          Of the ups and downs of monthly PM2.5 in the fire season, from {lo.name} to {hi.name}.
        </MarginNote>
      ) : undefined}>
        <p>From July to November, smoke from fires in Sumatra and Borneo drifts over Malaysia and its neighbours.</p>
        <p>For each city, the monthly PM2.5 (fine particles) is a normal level for the month plus an amount for every 1,000 hotspots in Sumatra and in Borneo. We fit it on the fire seasons of 2002 to 2025, with bias corrected PM2.5 from NASA MERRA‑2, and test it on years left out. A city is shown only when the test on those years holds.</p>
        {lo && hi ? <p>On those years it explains <N>{num(100 * lo.r2_cv, 0)} to {share(hi.r2_cv)}</N> of the ups and downs of monthly PM2.5, from {lo.name} to {hi.name}. Central Kalimantan, in Borneo, burns hardest in El Niño years. Fires in Malaysia itself are small, and they have fallen by more than half since the early 2000s.</p> : null}
      </Lede>
      {cities.length ? (
        <Card title={`${cities.length === 8 ? 'Eight' : cities.length} cities, tested on years left out`} subtitle="Share of the ups and downs of monthly PM2.5 that the fires explain, and where the smoke comes from"
          actions={<a className="ui-btn" href="#/haze"><IconWind size={16} />Open the Haze page</a>}>
          <div className="fh-pg-wrap-names fh-pg-stack fh-pg-stack-pairs">
            <DataTable columns={columns} rows={allCities ? cities : cities.slice(0, HAZE_ROWS)} rowKey={(c) => c.name}
              caption="The haze model of each city: share of the ups and downs of monthly PM2.5 explained on years left out, and the shares of the smoke from Sumatra and Borneo, 2002 to 2025" />
          </div>
          {/* (the best explained cities first; the others on request, so a phone's page stays short) */}
          {cities.length > HAZE_ROWS ? (
            <button type="button" className="ui-btn ui-btn-ghost fh-mx-more" aria-expanded={allCities} onClick={() => setAllCities((v) => !v)}>
              {allCities ? 'Show fewer cities' : `Show all ${cities.length} cities`}
            </button>
          ) : null}
        </Card>
      ) : null}
      <HazeCalendars />
    </FoldSection>
  );
}

// ------------------------------------------------------------------------------------------------ limits

/** The first limit: the MODIS orbits drift (the years from web/eda.json, as in "A first look at the raw record"). */
function driftLimit(e: Eda | null): string {
  const night = e ? firstShift(e, 'night') : null, day = e ? firstShift(e, 'day') : null;
  const when = night !== null && day !== null ? `, from ${night} at night and from ${day} by day` : '';
  return `The MODIS orbits drift${when}, and from then the model reads a few percent low. The record uses observed VIIRS in those years, so it is not affected. The model also reads a little low in 2020, the first year it never saw while it learned, before any drift.`;
}

const LIMITS = [
  'One hexagon in one month is uncertain. Larger areas and whole years are much more certain.',
  'Hotspots count hot pixels. They do not measure burned area or smoke.',
  'The 90% ranges cover the model’s error: how far it can be from what NOAA‑20 would have recorded. Fires that no satellite could see, under thick cloud or smoke, are missing from every record.',
  'The newest months have no NASA label for static heat yet, so the mask removes it. It can miss a little.',
  'The latest month is still filling in. It shows as no data yet until it is complete.',
  'The outlook gives chances, not certainties, and only for months of the fire season.',
  'The haze model works with monthly means, which hide the worst days.',
];

function LimitsSection({ eda }: { eda: Eda | null }) {
  return (
    <Section id="limits" title="Limits" subtitle="What the record cannot tell you.">
      <Card>
        <div className="fh-doc-limits-box">
          <ul className="fh-pg-list fh-doc-limits">{[driftLimit(eda), ...LIMITS].map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </Card>
      <Note>Sources: NASA FIRMS (MODIS C6.1, VIIRS 375 m) for the fires; NASA MERRA‑2, GPM IMERG and GISS GFWED for weather, rain, PM2.5 and fire weather; ESA Fire_cci for burned area; NOAA for El Niño and the Indian Ocean Dipole. Analysis: Fire Harmony.</Note>
    </Section>
  );
}
