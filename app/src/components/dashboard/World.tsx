// 2. Fire in the place in view: the totals of each year (or season) with the 90% band of the modelled years and the
// trend, and the normal year. For the whole world on the published scale the numbers are dashboard.json's; for any
// other scope they come from the place's series (scope.ts). The two charts are linked: hovering a year in the first
// draws that year's months in the second (and marks it on the trend line above); hovering a month in the second marks
// it in the month letters of the tables below.
import { useEffect, useMemo, useState } from 'react';
import * as Plot from '@observablehq/plot';
import type { DashboardData } from '../../lib/dashboard-types';
import { formatCompact } from '../../lib/i18n';
import { Card, Grid } from '../ui';
import { hgrid, palette, svgEl, tipLook } from './chart';
import { count, int, millions, monthName, monthShort, monthYear, MONTH_LETTERS, pct } from './format';
import { keepNames, Keys, type KeyItem } from './parts';
import { DbSection } from './DbSection';
import { Figure, scaleAt, svgOf, type PlotChart } from './Figure';
import { isWorld, seasonLabel, seasonMonths, seasonYearLabel, wraps, yearsLabel, type Scope, type SensorKey } from './scope';
import { setFocus, useFocus, type ScopeData } from './useScope';
import { SCALE_WORDS } from './ScopeBar';
import { viewVerdict } from './verdict';

const SOURCE = 'Source: Fire Harmony v1.0, from NASA FIRMS hotspots (MODIS and VIIRS).';

type Year = DashboardData['world']['yearly'][number];

/** The top of a y axis: the next multiple of `step` above the highest value. */
const ceilTo = (v: number, step: number): number => Math.max(step, Math.ceil(v / step) * step);

const SENSORS: { key: SensorKey; name: string; colour: 'modis' | 'snpp' | 'noaa20' | 'noaa21'; opacity: number }[] = [
  { key: 't', name: 'Terra', colour: 'modis', opacity: 0.55 }, { key: 'a', name: 'Aqua', colour: 'modis', opacity: 1 },
  { key: 's', name: 'Suomi NPP', colour: 'snpp', opacity: 1 }, { key: 'n', name: 'NOAA-20', colour: 'noaa20', opacity: 1 },
  { key: 'j', name: 'NOAA-21', colour: 'noaa21', opacity: 1 },
];

/** A year marked from another chart: a rule across the yearly chart with the year on top. */
function useYearMark(chart: PlotChart | null, yr: number | null, label: (yr: number) => string | null) {
  useEffect(() => {
    const svg = svgOf(chart);
    if (!svg) return;
    svg.querySelector('g.db-overlay-y')?.remove();
    if (yr === null) return;
    const x = scaleAt(chart, 'x', yr);
    const yr0 = (chart?.scale('y') as { range?: [number, number] } | undefined)?.range;
    if (x === null || !yr0) return;
    const text = label(yr);
    if (text === null) return;
    const g = svgEl('g', { class: 'db-overlay db-overlay-y', 'aria-hidden': 'true' });
    g.append(svgEl('line', { x1: x, x2: x, y1: yr0[0], y2: yr0[1], class: 'db-overlay-rule' }));
    const tx = svgEl('text', { x, y: yr0[1] - 4, 'text-anchor': 'middle', class: 'db-overlay-text' });
    tx.textContent = text;
    g.append(tx);
    svg.append(g);
  }, [chart, yr, label]);
}

/** One year's months drawn over the normal year (the year under the pointer in the yearly chart). */
function useMonthsLine(chart: PlotChart | null, yr: number | null, monthly: Map<number, number> | null, months: number[], tag: (yr: number) => string) {
  useEffect(() => {
    const svg = svgOf(chart);
    if (!svg) return;
    svg.querySelector('g.db-overlay-l')?.remove();
    if (yr === null || !monthly) return;
    const dom = (chart?.scale('y') as { domain?: [number, number] } | undefined)?.domain;
    if (!dom) return;
    const top = dom[1];
    // the months of the season year in calendar order (a season across the new year runs into the next year)
    const pts: { mo: number; v: number; clipped: boolean }[] = [];
    for (let mo = 1; mo <= 12; mo++) {
      const yy = wrapsMonths(months) && mo <= months[months.length - 1] ? yr + 1 : yr;
      const v = monthly.get(yy * 100 + mo);
      if (v === undefined) continue;
      pts.push({ mo, v: Math.min(v, top), clipped: v > top });
    }
    if (pts.length < 2) return;
    const xy = pts.map((p) => [scaleAt(chart, 'x', p.mo), scaleAt(chart, 'y', p.v)] as const).filter((p): p is [number, number] => p[0] !== null && p[1] !== null);
    if (xy.length < 2) return;
    const g = svgEl('g', { class: 'db-overlay db-overlay-l', 'aria-hidden': 'true' });
    g.append(svgEl('path', { d: `M${xy.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L')}`, class: 'db-overlay-line' }));
    for (const [x, y] of xy) g.append(svgEl('circle', { cx: x, cy: y, r: 2.6, class: 'db-overlay-dot' }));
    const peak = pts.reduce((a, b) => (b.v > a.v || b.clipped ? b : a), pts[0]);
    const last = xy[xy.length - 1];
    const tx = svgEl('text', { x: Math.min(last[0], (scaleAt(chart, 'x', 12) ?? last[0])) - 2, y: Math.max(12, Math.min(...xy.map((p) => p[1])) - 6), 'text-anchor': 'end', class: 'db-overlay-text' });
    tx.textContent = `${tag(yr)}${pts.some((p) => p.clipped) ? `, up to ${count(monthly.get((wrapsMonths(months) && peak.mo <= months[months.length - 1] ? yr + 1 : yr) * 100 + peak.mo) ?? 0)} in ${monthShort(peak.mo)}` : ''}`;
    g.append(tx);
    svg.append(g);
  }, [chart, yr, monthly, months, tag]);
}

/** A month marked from the normal year: that month of every year in view, as dots on the yearly chart. */
function useMonthDots(chart: PlotChart | null, mo: number | null, monthly: Map<number, number> | null, years: readonly number[], months: number[]) {
  useEffect(() => {
    const svg = svgOf(chart);
    if (!svg) return;
    svg.querySelector('g.db-overlay-m')?.remove();
    if (mo === null || !monthly || !months.includes(mo)) return;
    const g = svgEl('g', { class: 'db-overlay db-overlay-m', 'aria-hidden': 'true' });
    let n = 0;
    for (const yr of years) {
      const yy = wrapsMonths(months) && mo <= months[months.length - 1] ? yr + 1 : yr;
      const v = monthly.get(yy * 100 + mo);
      const x = scaleAt(chart, 'x', yr), y = v === undefined ? null : scaleAt(chart, 'y', v);
      if (x === null || y === null) continue;
      g.append(svgEl('circle', { cx: x, cy: y, r: 3, class: 'db-overlay-dot' }));
      n += 1;
    }
    if (!n) return;
    const yr0 = (chart?.scale('y') as { range?: [number, number] } | undefined)?.range;
    const x0 = scaleAt(chart, 'x', years[0]);
    if (yr0 && x0 !== null) {
      const tx = svgEl('text', { x: x0, y: yr0[1] - 4, 'text-anchor': 'start', class: 'db-overlay-text' });
      tx.textContent = `${monthName(mo)} of each year`;
      g.append(tx);
    }
    svg.append(g);
  }, [chart, mo, monthly, years, months]);
}

const wrapsMonths = (months: number[]): boolean => months.length < 12 && months[months.length - 1] < months[0];

/** Select or hover a year: every chart marks it (the pointer of Plot). */
const yearPointer = (value: unknown) => {
  const yr = (value as { yr?: number } | null)?.yr;
  setFocus({ yr: typeof yr === 'number' ? yr : null, mo: null, from: 'yearly' });
};
const monthPointer = (value: unknown) => {
  const mo = (value as { mo?: number } | null)?.mo;
  setFocus({ yr: null, mo: typeof mo === 'number' ? mo : null, from: 'season' });
};

// ---------------------------------------------------------------------------------------------- the published world

function WorldCharts({ d, monthly }: { d: DashboardData; monthly: Map<number, number> | null }) {
  const w = d.world;
  const full = w.yearly.filter((y) => y.complete);
  const partial = w.yearly.filter((y) => !y.complete);
  const band = full.filter((y): y is Year & { lo: number; hi: number } => y.lo !== null && y.hi !== null);
  const tr = w.trend;
  const first = full[0]?.yr ?? 2001, last = full[full.length - 1]?.yr ?? 2025;
  const yearlyTitle = tr.direction === 'no trend'
    ? `World fire shows no clear trend from ${first} to ${last}`
    : `World fire ${tr.direction === 'decreasing' ? 'fell' : 'rose'} by ${pct(Math.abs(tr.pct_per_decade))} per decade from ${first} to ${last}`;
  const ytdTo = monthName(w.ytd.months);
  const modelled = band.length ? `${band[0].yr} to ${band[band.length - 1].yr}` : '';
  const f = useFocus();
  const [yc, setYc] = useState<PlotChart | null>(null);
  const [sc, setSc] = useState<PlotChart | null>(null);
  useYearMark(yc, f.from !== 'yearly' ? f.yr : null, (yr) => (w.yearly.some((y) => y.yr === yr) ? String(yr) : null));
  const allMonths = useMemo(() => seasonMonths(null), []);
  const yearsShown = useMemo(() => full.map((y) => y.yr), [full]);
  useMonthsLine(sc, f.yr, monthly, allMonths, String);
  useMonthDots(yc, f.from === 'season' ? f.mo : null, monthly, yearsShown, allMonths);

  const season = w.seasonality;
  const top = [...season].sort((a, b) => b.median - a.median);
  const peak = top.length > 1 && Math.abs(top[0].mo - top[1].mo) === 1
    ? `${monthName(Math.min(top[0].mo, top[1].mo))} and ${monthName(Math.max(top[0].mo, top[1].mo))}`
    : monthName(top[0]?.mo ?? 8);
  const latest = { mo: w.latest.mo, h: w.latest.h };
  // the trend line: Sen's slope of log(1 + yearly total) (fireharmony/analytics.py), through the median intercept
  const b = Math.log(1 + tr.pct_per_decade / 100) / 10;
  const ints = full.map((y) => Math.log(1 + y.harmonized) - b * y.yr).sort((p1, p2) => p1 - p2);
  const a = ints.length ? (ints.length % 2 ? ints[(ints.length - 1) / 2] : (ints[ints.length / 2 - 1] + ints[ints.length / 2]) / 2) : 0;
  const trendLine = full.length > 1 ? [first, last].map((yr) => ({ yr, v: Math.exp(a + b * yr) - 1 })) : [];
  const latestName = monthYear(w.latest.yr * 100 + w.latest.mo);

  return (
    <Grid wide>
      <Card>
        <Figure
          title={yearlyTitle}
          subtitle={(
            <>
              Hotspots per year, millions. Before 2012 the record is modelled from MODIS, so it has a 90% range.
              <Keys items={[
                { label: 'Harmonized record', colour: 'var(--harmonized)', shape: 'line' },
                { label: `90% range (${modelled})`, colour: 'var(--band)', shape: 'band' },
                ...(trendLine.length ? [{ label: 'Trend', colour: 'var(--accent)', shape: 'line' as const }] : []),
                ...(partial.length ? [{ label: `${partial[0].yr} so far (to ${ytdTo})`, colour: 'var(--harmonized)', shape: 'dot' as const, open: true }] : []),
              ]} />
            </>
          )}
          source={SOURCE}
          height={300}
          deps={[d]}
          onChart={setYc}
          onPoint={yearPointer}
          build={(width) => {
            const p = palette();
            const yMax = ceilTo(Math.max(...w.yearly.map((y) => y.hi ?? y.harmonized)), 5e6);
            return {
              height: 300, marginLeft: 30, marginRight: 14, marginTop: 16,
              x: { domain: [2000.5, (partial[0]?.yr ?? last) + 0.5], tickFormat: 'd', tickSize: 0, label: null,
                ticks: width < 480 ? [2005, 2015, 2025] : [2001, 2005, 2010, 2015, 2020, 2025] },
              y: { domain: [0, yMax], ticks: yMax / 5e6 + 1, tickFormat: (v: number) => millions(v, 0), tickSize: 0, label: null },
              marks: [
                hgrid(p, { ticks: yMax / 5e6 + 1 }),
                Plot.areaY(band, { x: 'yr', y1: 'lo', y2: 'hi', fill: p.band }),
                Plot.ruleY([0], { stroke: p.baseline }),
                Plot.lineY(trendLine, { x: 'yr', y: 'v', stroke: p.accent, strokeWidth: 1.5, strokeOpacity: 0.9 }),
                Plot.lineY(full, { x: 'yr', y: 'harmonized', stroke: p.harmonized, strokeWidth: 2.6, strokeLinejoin: 'round', strokeLinecap: 'round' }),
                Plot.dot(partial, { x: 'yr', y: 'harmonized', r: 4.5, fill: p.surface, stroke: p.harmonized, strokeWidth: 2 }),
                Plot.text(partial, { x: 'yr', y: 'harmonized', text: () => 'so far', dy: 17, fill: p.ink2, textAnchor: 'end', dx: 4 }),
                Plot.ruleX(w.yearly, Plot.pointerX({ x: 'yr', stroke: p.baseline, strokeWidth: 1 })),
                Plot.tip(w.yearly, Plot.pointerX({
                  x: 'yr', y: 'harmonized', ...tipLook(p),
                  title: (y: Year) => [
                    y.complete ? String(y.yr) : `${y.yr}, January to ${ytdTo}`,
                    `${count(y.harmonized)} hotspots`,
                    y.lo !== null && y.hi !== null ? `90% range ${count(y.lo)} to ${count(y.hi)}` : 'Observed by VIIRS',
                    ...(y.complete && trendLine.length ? [`Trend ${count(Math.exp(a + b * y.yr) - 1)}`] : []),
                  ].join('\n'),
                })),
              ],
            };
          }}
          table={{
            columns: ['Year', 'Hotspots', '90% range', 'How we know'],
            rows: w.yearly.map((y) => [
              y.complete ? String(y.yr) : `${y.yr} (to ${ytdTo})`,
              int(y.harmonized),
              y.lo !== null && y.hi !== null ? `${int(y.lo)} to ${int(y.hi)}` : '',
              y.lo !== null ? 'Modelled from MODIS' : 'Observed by VIIRS',
            ]),
          }}
        />
      </Card>
      <Card>
        <Figure
          title={`World fire peaks in ${peak}`}
          subtitle={(
            <>
              Hotspots per month in a normal year, millions, 2001 to 2025. Point at a year on the left to draw its months here.
              <Keys items={[
                { label: 'Median', colour: 'var(--harmonized)', shape: 'line' },
                { label: 'Middle half of years', colour: 'var(--band)', shape: 'band' },
                { label: latestName, colour: 'var(--ember-600)', shape: 'dot' },
              ]} />
            </>
          )}
          source={SOURCE}
          height={300}
          deps={[d]}
          onChart={setSc}
          onPoint={monthPointer}
          build={(width) => {
            const p = palette();
            const yMax = ceilTo(Math.max(...season.map((m) => m.q75), latest.h), 1e6);
            const letters = width < 420;
            return {
              height: 300, marginLeft: 30, marginRight: 10, marginTop: 16,
              x: { domain: [0.6, 12.4], ticks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tickSize: 0, label: null,
                tickFormat: (m: number) => (letters ? MONTH_LETTERS[m - 1] : monthShort(m)) },
              y: { domain: [0, yMax], ticks: yMax / 1e6 + 1, tickFormat: (v: number) => millions(v, 0), tickSize: 0, label: null },
              marks: [
                hgrid(p, { ticks: yMax / 1e6 + 1 }),
                Plot.areaY(season, { x: 'mo', y1: 'q25', y2: 'q75', fill: p.band }),
                Plot.ruleY([0], { stroke: p.baseline }),
                Plot.lineY(season, { x: 'mo', y: 'median', stroke: p.harmonized, strokeWidth: 2.6, strokeLinejoin: 'round', strokeLinecap: 'round' }),
                Plot.dot([latest], { x: 'mo', y: 'h', r: 5, fill: p.ember(600), stroke: p.surface, strokeWidth: 2 }),
                Plot.ruleX(season, Plot.pointerX({ x: 'mo', stroke: p.baseline, strokeWidth: 1 })),
                Plot.tip(season, Plot.pointerX({
                  x: 'mo', y: 'median', ...tipLook(p),
                  title: (m: (typeof season)[number]) => [
                    monthName(m.mo),
                    `Median ${count(m.median)}`,
                    `Middle half ${count(m.q25)} to ${count(m.q75)}`,
                    ...(m.mo === latest.mo ? [`${latestName}: ${count(latest.h)}`] : []),
                  ].join('\n'),
                })),
              ],
            };
          }}
          table={{
            columns: ['Month', 'Median', 'Middle half of years', latestName],
            rows: season.map((m) => [monthName(m.mo), int(m.median), `${int(m.q25)} to ${int(m.q75)}`,
              m.mo === latest.mo ? int(latest.h) : '']),
          }}
        />
      </Card>
    </Grid>
  );
}

// ---------------------------------------------------------------------------------------------- any other scope

/** Ticks of a count axis for people: 0, 20K, 40K… with a nice top. */
function niceTop(v: number): { top: number; step: number } {
  const raw = Math.max(1, v) / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? 10 * p;
  return { top: Math.ceil(v / step) * step || step, step };
}
const axis = (v: number): string => formatCompact(v, 'en');

function ScopedCharts({ scope, data }: { scope: Scope; data: ScopeData }) {
  const v = data.view!;
  const s = scope;
  const raw = s.scale === 'raw';
  const harm = s.scale === 'harmonized';
  const world = isWorld(s.place);
  const name = data.short;
  const subject = world ? 'World fire' : s.place.type === 'circle' ? `Fire within ${s.place.km} km of ${name}` : `Fire in ${name}`;
  const seasonWords = s.months ? `${seasonLabel(s.months)} fire` : '';
  const months = useMemo(() => seasonMonths(s.months), [s.months]);
  const full = v.years.filter((y) => y.complete);
  const partial = v.years.filter((y) => !y.complete);
  const band = full.filter((y) => y.lo !== null && y.hi !== null);
  const tr = v.trend;
  const first = full[0]?.yr ?? s.years[0], last = full[full.length - 1]?.yr ?? s.years[1];
  const who = seasonWords ? `${seasonWords} ${world ? 'in the world' : s.place.type === 'circle' ? `within ${s.place.km} km of ${name}` : `in ${name}`}` : subject;
  // the title says what the trend's verdict allows (verdict.ts: the same words as the tiles and Rankings)
  const inTrend = full.filter((y) => y.yr >= tr.from && y.yr <= tr.to);
  const ver = viewVerdict(tr, s, data.row, data.rows, inTrend.length ? inTrend.reduce((a, y) => a + y.value, 0) / inTrend.length : null);
  const title = raw ? `${who}: the raw detections of each satellite, and the harmonized record`
    : tr.pct === null || ver.cls === 'none' || ver.cls === 'little' || ver.cls === 'untested' ? `${who}, ${yearsLabel(s.years)}`
      : ver.cls === 'unclear' ? `${who} shows no clear trend from ${tr.from} to ${tr.to}`
        : `${who} ${ver.cls === 'falling' ? 'fell' : 'rose'} by ${pct(Math.abs(tr.pct))} per decade from ${tr.from} to ${tr.to}`;
  const unitWords = s.months ? `Hotspots in ${seasonLabel(s.months)} of each ${wraps(s.months) ? 'season' : 'year'}` : 'Hotspots per year';
  const scaleWords = harm ? '' : ` On the ${SCALE_WORDS[s.scale].label.toLowerCase()}.`;
  const f = useFocus();
  const [yc, setYc] = useState<PlotChart | null>(null);
  const [sc, setSc] = useState<PlotChart | null>(null);
  const yearLabel = useMemo(() => (yr: number) => seasonYearLabel(yr, s.months), [s.months]);
  useYearMark(yc, f.from !== 'yearly' ? f.yr : null, (yr) => (v.years.some((y) => y.yr === yr) ? yearLabel(yr) : null));
  useMonthsLine(sc, f.yr, v.monthly, months, yearLabel);
  const yearsShown = useMemo(() => v.years.filter((y) => y.complete).map((y) => y.yr), [v.years]);
  useMonthDots(yc, f.from === 'season' ? f.mo : null, v.monthly, yearsShown, months);
  const keys: KeyItem[] = raw ? [
    { label: 'Harmonized record', colour: 'var(--harmonized)', shape: 'line' },
    ...SENSORS.map((x) => ({ label: x.name, colour: `var(--sensor-${x.colour})`, shape: 'line' as const, opacity: x.opacity })),
  ] : [
    { label: harm ? 'Harmonized record' : 'MODIS scale', colour: 'var(--harmonized)', shape: 'line' },
    ...(band.length ? [{ label: `90% range (${band[0].yr} to ${band[band.length - 1].yr})`, colour: 'var(--band)', shape: 'band' as const }] : []),
    ...(tr.line.length ? [{ label: 'Trend', colour: 'var(--accent)', shape: 'line' as const }] : []),
    ...(partial.length ? [{ label: `${partial[0].label} so far`, colour: 'var(--harmonized)', shape: 'dot' as const, open: true }] : []),
  ];
  const sensorRows = raw ? SENSORS.flatMap((x) => full.map((y) => ({ yr: y.yr, key: x.key, v: y.sensors[x.key] })).filter((r) => r.v > 0)) : [];
  const harmRows = raw ? full.map((y) => ({ yr: y.yr, v: y.sensors.t + y.sensors.a + y.sensors.s + y.sensors.n + y.sensors.j })) : [];
  const deps = [v.key, s.scale];

  const sea = v.season;
  const medians = sea.map((m) => m.median ?? 0);
  const peakMo = medians.indexOf(Math.max(...medians)) + 1;
  const peakTitle = Math.max(...medians) > 0 ? `${subject} peaks in ${monthName(peakMo)}` : `${subject}: no month stands out`;
  const latest = v.latest;
  const spans: { x1: number; x2: number }[] = [];
  if (s.months) {
    if (wraps(s.months)) spans.push({ x1: s.months[0] - 0.5, x2: 12.5 }, { x1: 0.5, x2: s.months[1] + 0.5 });
    else spans.push({ x1: s.months[0] - 0.5, x2: s.months[1] + 0.5 });
  }
  return (
    <Grid wide>
      <Card>
        <Figure
          busy={data.loading}
          title={title}
          subtitle={<>{unitWords}, {yearsLabel(s.years)}.{scaleWords}{harm && band.length ? ' Modelled years have a 90% range.' : ''}<Keys items={keys} /></>}
          source={SOURCE}
          height={300}
          deps={deps}
          onChart={setYc}
          onPoint={yearPointer}
          build={(width) => {
            const p = palette();
            const rowsAll = [...full, ...partial];
            const hi = Math.max(1, ...rowsAll.map((y) => y.hi ?? y.value), ...sensorRows.map((r) => r.v), ...harmRows.map((r) => r.v));
            const { top, step } = niceTop(hi);
            const x0 = Math.min(first, partial[0]?.yr ?? first), x1 = Math.max(last, partial[0]?.yr ?? last);
            const spanYrs = x1 - x0;
            const every = spanYrs > 16 ? (width < 480 ? 10 : 5) : spanYrs > 7 ? (width < 480 ? 4 : 2) : 1;
            const ticks = rowsAll.map((y) => y.yr).filter((yr) => yr % every === 0 || (spanYrs <= 7));
            const colour = (k: string) => (k === 'modis' ? p.modis : k === 'snpp' ? p.snpp : k === 'noaa20' ? p.noaa20 : p.noaa21);
            return {
              height: 300, marginLeft: 44, marginRight: 14, marginTop: 16,
              x: { domain: [x0 - 0.5, x1 + 0.5], ticks, tickFormat: (yr: number) => (wraps(s.months) ? seasonYearLabel(yr, s.months) : String(yr)), tickSize: 0, label: null },
              y: { domain: [0, top], ticks: Math.round(top / step) + 1, tickFormat: axis, tickSize: 0, label: null },
              marks: [
                hgrid(p, { ticks: Math.round(top / step) + 1 }),
                ...(band.length ? [Plot.areaY(band, { x: 'yr', y1: 'lo', y2: 'hi', fill: p.band })] : []),
                Plot.ruleY([0], { stroke: p.baseline }),
                ...(raw ? SENSORS.map((x) => Plot.lineY(sensorRows.filter((r) => r.key === x.key), { x: 'yr', y: 'v', stroke: colour(x.colour), strokeOpacity: x.opacity, strokeWidth: 2, strokeLinejoin: 'round' })) : []),
                ...(!raw && tr.line.length ? [Plot.lineY(tr.line, { x: 'yr', y: 'v', stroke: p.accent, strokeWidth: 1.5, strokeOpacity: 0.9 })] : []),
                Plot.lineY(full, { x: 'yr', y: 'value', stroke: p.harmonized, strokeWidth: 2.6, strokeLinejoin: 'round', strokeLinecap: 'round' }),
                Plot.dot(partial, { x: 'yr', y: 'value', r: 4.5, fill: p.surface, stroke: p.harmonized, strokeWidth: 2 }),
                Plot.text(partial, { x: 'yr', y: 'value', text: () => 'so far', dy: 17, fill: p.ink2, textAnchor: 'end', dx: 4 }),
                Plot.ruleX(rowsAll, Plot.pointerX({ x: 'yr', stroke: p.baseline, strokeWidth: 1 })),
                Plot.tip(rowsAll, Plot.pointerX({
                  x: 'yr', y: 'value', ...tipLook(p),
                  title: (y: (typeof rowsAll)[number]) => [
                    y.complete ? y.label : `${y.label} so far`,
                    `${count(y.value)} hotspots`,
                    ...(y.lo !== null && y.hi !== null ? [`90% range ${count(y.lo)} to ${count(y.hi)}`] : harm ? ['Observed by VIIRS'] : []),
                    ...(raw ? SENSORS.filter((x) => y.sensors[x.key] > 0).map((x) => `${x.name}: ${count(y.sensors[x.key])}`) : []),
                  ].join('\n'),
                })),
              ],
            };
          }}
          table={raw ? {
            columns: ['Year', 'Harmonized', ...SENSORS.map((x) => x.name)],
            rows: v.years.map((y) => [y.complete ? y.label : `${y.label} so far`, int(y.value), ...SENSORS.map((x) => (y.sensors[x.key] ? int(y.sensors[x.key]) : ''))]),
          } : {
            columns: ['Year', 'Hotspots', '90% range', 'How we know'],
            rows: v.years.map((y) => [
              y.complete ? y.label : `${y.label} so far`, int(y.value),
              y.lo !== null && y.hi !== null ? `${int(y.lo)} to ${int(y.hi)}` : '',
              y.src === 0 ? 'Observed by VIIRS' : 'Modelled from MODIS',
            ]),
          }}
        />
      </Card>
      <Card>
        <Figure
          busy={data.loading}
          title={peakTitle}
          subtitle={(
            <>
              Hotspots per month in a normal year (the median of {v.seasonYears[0]} to {v.seasonYears[1]}).{s.months ? ` The months in view are lit.` : ''} Point at a year on the left to draw its months here.
              <Keys items={[
                { label: 'Median', colour: 'var(--harmonized)', shape: 'line' },
                { label: 'Middle half of years', colour: 'var(--band)', shape: 'band' },
                ...(s.months ? [{ label: seasonLabel(s.months), colour: 'var(--accent-soft)', shape: 'box' as const }] : []),
                ...(latest ? [{ label: monthYear(latest.ym), colour: 'var(--ember-600)', shape: 'dot' as const }] : []),
              ]} />
            </>
          )}
          source={SOURCE}
          height={300}
          deps={deps}
          onChart={setSc}
          onPoint={monthPointer}
          build={(width) => {
            const p = palette();
            const hi = Math.max(1, ...sea.map((m) => m.q75 ?? 0), latest ? latest.value : 0);
            const { top, step } = niceTop(hi);
            const letters = width < 420;
            const dot = latest ? [{ mo: latest.ym % 100, h: latest.value }] : [];
            return {
              height: 300, marginLeft: 44, marginRight: 10, marginTop: 16,
              x: { domain: [0.5, 12.5], ticks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], tickSize: 0, label: null,
                tickFormat: (m: number) => (letters ? MONTH_LETTERS[m - 1] : monthShort(m)) },
              y: { domain: [0, top], ticks: Math.round(top / step) + 1, tickFormat: axis, tickSize: 0, label: null },
              marks: [
                ...(spans.length ? [Plot.rectX(spans, { x1: 'x1', x2: 'x2', y1: 0, y2: top, fill: p.accent, fillOpacity: 0.09 })] : []),
                hgrid(p, { ticks: Math.round(top / step) + 1 }),
                Plot.areaY(sea, { x: 'mo', y1: 'q25', y2: 'q75', fill: p.band }),
                Plot.ruleY([0], { stroke: p.baseline }),
                Plot.lineY(sea, { x: 'mo', y: 'median', stroke: p.harmonized, strokeWidth: 2.6, strokeLinejoin: 'round', strokeLinecap: 'round' }),
                Plot.dot(dot, { x: 'mo', y: 'h', r: 5, fill: p.ember(600), stroke: p.surface, strokeWidth: 2 }),
                Plot.ruleX(sea, Plot.pointerX({ x: 'mo', stroke: p.baseline, strokeWidth: 1 })),
                Plot.tip(sea, Plot.pointerX({
                  x: 'mo', y: 'median', ...tipLook(p),
                  title: (m: (typeof sea)[number]) => [
                    monthName(m.mo),
                    `Median ${count(m.median ?? 0)}`,
                    `Middle half ${count(m.q25 ?? 0)} to ${count(m.q75 ?? 0)}`,
                    ...(latest && m.mo === latest.ym % 100 ? [`${monthYear(latest.ym)}: ${count(latest.value)}`] : []),
                  ].join('\n'),
                })),
              ],
            };
          }}
          table={{
            columns: ['Month', 'Median', 'Middle half of years', ...(latest ? [monthYear(latest.ym)] : [])],
            rows: sea.map((m) => [monthName(m.mo), int(m.median ?? 0), `${int(m.q25 ?? 0)} to ${int(m.q75 ?? 0)}`,
              ...(latest ? [m.mo === latest.ym % 100 ? int(latest.value) : ''] : [])]),
          }}
        />
      </Card>
    </Grid>
  );
}

export function World({ d, scope, data, worldMonthly }: { d: DashboardData; scope: Scope; data: ScopeData; worldMonthly: Map<number, number> | null }) {
  const v = data.view;
  const world = isWorld(scope.place);
  const title = world ? 'Fire across the world' : scope.place.type === 'circle' ? `Fire within ${scope.place.km} km of ${data.short}` : `Fire in ${data.short}`;
  const subtitle = !v ? 'World hotspots in each year, and in a normal year, on the NOAA-20 VIIRS scale.'
    : `${world ? 'World hotspots' : `Hotspots in ${data.name}`} in ${scope.months ? `${seasonLabel(scope.months)} of` : ''} each year, ${yearsLabel(scope.years)}, and in a normal year, ${scope.scale === 'harmonized' ? 'on the NOAA-20 VIIRS scale' : `on the ${SCALE_WORDS[scope.scale].label.toLowerCase()}`}.`.replace(' in  each', ' in each');
  return (
    <DbSection id="db-world" title={title} subtitle={keepNames(subtitle)}>
      {v ? <ScopedCharts scope={scope} data={data} /> : <WorldCharts d={d} monthly={worldMonthly} />}
    </DbSection>
  );
}
