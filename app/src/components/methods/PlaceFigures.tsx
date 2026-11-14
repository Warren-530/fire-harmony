// The report's place figures, drawn live in the theme from the files the Explorer reads (they used to be light PNGs
// with small text): the burning calendars of Malaysia (fig10) and Central Kalimantan (fig12), from
// web/series/<kind>/<id>.json, and the drivers of Central Kalimantan (fig14), from web/drivers/state/IDN-1931.json.
// The calendar colours follow the Explorer's rule (countScale: log steps between the area's own low and high months,
// in the ember scale), so a calendar here and in the Explorer read alike.
import { useEffect, useState, type ReactNode } from 'react';
import * as Plot from '@observablehq/plot';
import { Card, Grid, PlotFigure, Skeleton, type FigureTable } from '../ui';
import { countClass, countScale } from '../../lib/stats';
import { driversFile, seriesFile, type DriversFile, type SeriesFile } from '../../lib/web';
import { AreaLink, Problem } from '../pages/parts';
import { gridX, gridY, pal, tip } from './charts';
import { fix, int } from './eda';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const SHORT = MONTHS.map((m) => m.slice(0, 3));
const FIRST_YEAR = 2001;   // the calendars start with the first full year, as in the report and the Explorer

/** Loads one file once; null while loading, 'failed' when it could not be read. */
function useFile<T>(load: () => Promise<T | null>, key: string, attempt: number): T | null | 'failed' {
  const [v, setV] = useState<{ key: string; value: T | 'failed' } | null>(null);
  useEffect(() => {
    let alive = true;
    load().then((x) => { if (alive) setV({ key, value: x ?? 'failed' }); }, () => { if (alive) setV({ key, value: 'failed' }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  return v && v.key === key ? v.value : null;
}

function Loading({ state, what, onRetry, height }: { state: null | 'failed'; what: string; onRetry: () => void; height: number }) {
  return <Card>{state === 'failed' ? <Problem text={`The ${what} could not be loaded.`} onRetry={onRetry} /> : <Skeleton height={height} />}</Card>;
}

// ------------------------------------------------------------------------------------------------ burning calendars

interface CalCell { yr: number; mo: number; h: number | null; cls: number | null; total: number | null; partialYear: boolean }
interface YearTotal { yr: number; h: number; partial: boolean; months: number }

/** The months of a place from 2001, each with its colour class (-1 no fire, null not known yet), and the year totals. */
export function calendarOf(f: SeriesFile): { cells: CalCell[]; years: number[]; totals: YearTotal[] } {
  const known = new Map<number, number>();
  f.ym.forEach((ym, i) => { const h = f.h[i]; if (f.src[i] !== 3 && h !== null && h !== undefined) known.set(ym, h); });
  const lastYm = Math.max(...known.keys());
  const lastYear = Math.floor(lastYm / 100);
  const years: number[] = [];
  for (let y = FIRST_YEAR; y <= lastYear; y++) years.push(y);
  const scale = countScale([...known.entries()].filter(([ym]) => ym >= FIRST_YEAR * 100).map(([, h]) => h));
  const totals: YearTotal[] = years.map((yr) => {
    let h = 0, months = 0;
    for (let mo = 1; mo <= 12; mo++) { const v = known.get(yr * 100 + mo); if (v !== undefined) { h += v; months += 1; } }
    return { yr, h, partial: months < 12, months };
  });
  const totalOf = new Map(totals.map((t) => [t.yr, t]));
  const cells: CalCell[] = years.flatMap((yr) => Array.from({ length: 12 }, (_, i) => {
    const mo = i + 1, h = known.get(yr * 100 + mo) ?? null;
    const t = totalOf.get(yr);
    return { yr, mo, h, cls: h === null ? null : scale ? countClass(h, scale) : -1, total: t?.h ?? null, partialYear: t?.partial ?? false };
  }));
  return { cells, years, totals };
}

const EMBER_STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

function buildCalendar(width: number, cal: ReturnType<typeof calendarOf>, marks: { yr: number }[]): Plot.PlotOptions {
  const p = pal();
  const narrow = width < 440;
  const rowH = narrow ? 12 : 15;
  const ember = EMBER_STEPS.map((s) => p.ember(s));
  const zero = p.anom('0');
  const BAR0 = 12.5, BARW = narrow ? 3 : 3.6;            // the year totals, right of December, in month units
  const max = Math.max(...cal.totals.map((t) => t.h), 1);
  const fill = (c: CalCell) => (c.cls === null ? 'none' : c.cls < 0 ? zero : ember[c.cls] ?? ember[ember.length - 1]);
  const header = LETTERS.map((l, i) => ({ x: i + 0.5, t: narrow ? l : SHORT[i] }));
  // every year when the rows are tall enough; else the first, the last and every fifth year not crowding them
  const first = cal.years[0], last = cal.years[cal.years.length - 1];
  const shown = (y: number) => rowH >= 15 || y === first || y === last || (y % 5 === 0 && y - first > 2 && last - y > 2);
  return {
    height: 26 + cal.years.length * rowH + 4, marginLeft: 38, marginRight: 8, marginTop: 26, marginBottom: 4,
    x: { domain: [0, BAR0 + BARW + 0.4], axis: null },
    y: { domain: cal.years, label: null, tickSize: 0, tickPadding: 6, padding: 0.14,
      tickFormat: (y: number) => (shown(y) ? String(y) : '') },
    marks: [
      Plot.text(header, { x: 'x', text: 't', frameAnchor: 'top', dy: -18, fill: p.ink2, fontSize: 11, fontWeight: 600 }),
      Plot.text(['Year'], { x: BAR0, text: (t: string) => t, frameAnchor: 'top', dy: -18, textAnchor: 'start', fill: p.ink2, fontSize: 11, fontWeight: 600 }),
      Plot.barX(cal.cells, { x1: (c: CalCell) => c.mo - 1, x2: (c: CalCell) => c.mo, y: 'yr', fill, insetLeft: 1, insetRight: 1, rx: 2,
        stroke: (c: CalCell) => (c.cls === null ? p.border : 'none'), strokeDasharray: '2 2' }),
      Plot.barX(cal.totals, { x1: BAR0, x2: (t: YearTotal) => BAR0 + (BARW * t.h) / max, y: 'yr', fill: p.ink2,
        fillOpacity: (t: YearTotal) => (t.partial ? 0.45 : 0.85), rx: 2 }),
      marks.length ? Plot.dot(marks, { x: () => BAR0 - 0.22, y: 'yr', r: 2.6, symbol: 'diamond2', fill: p.modis, stroke: p.surface, strokeWidth: 1 }) : null,
      Plot.tip(cal.cells, Plot.pointer({ x: (c: CalCell) => c.mo - 0.5, y: 'yr', ...tip(p),
        title: (c: CalCell) => `${MONTHS[c.mo - 1]} ${c.yr}\n${c.h === null ? 'No data yet' : `${int(c.h)} hotspots`}${c.total !== null ? `\nThe year${c.partialYear ? ' so far' : ''}: ${int(c.total)}` : ''}` })),
    ],
  };
}

function calendarTable(cal: ReturnType<typeof calendarOf>): FigureTable {
  return {
    columns: ['Year', ...SHORT, 'Year total'],
    rows: cal.years.map((yr) => {
      const row = cal.cells.filter((c) => c.yr === yr);
      const t = cal.totals.find((x) => x.yr === yr);
      return [String(yr), ...row.map((c) => (c.h === null ? '–' : int(c.h))), t ? `${int(t.h)}${t.partial ? ' (so far)' : ''}` : '–'];
    }),
  };
}

/** The ember key: fewer to more hotspots, and the empty and not yet known months. */
function CalendarKey({ nino }: { nino?: boolean }) {
  return (
    <span className="fh-pg-legend">
      <span className="fh-pg-key fh-mx-key-wrap"><span className="fh-mx-ramp" aria-hidden="true">{EMBER_STEPS.map((s) => <i key={s} style={{ background: `var(--ember-${s})` }} />)}</span>Fewer to more hotspots, log scale</span>
      <span className="fh-pg-key"><span className="fh-pg-swatch fh-mx-cal-empty" aria-hidden="true" />No data yet</span>
      {nino ? <span className="fh-pg-key fh-mx-key-wrap"><span className="fh-mx-diamond" aria-hidden="true" />El Niño in September (ONI 0.5 or more)</span> : null}
    </span>
  );
}

function CalendarCard({ kind, areaId, name, title, subtitle, file, nino }: {
  kind: string; areaId: string; name: string; title: string; subtitle: ReactNode; file: SeriesFile; nino?: number[];
}) {
  const cal = calendarOf(file);
  const marks = (nino ?? []).filter((y) => cal.years.includes(y)).map((yr) => ({ yr }));
  return (
    <div id={`cal-${areaId}`} className="fh-mx-jump-target fh-mx-cal">
      <Card>
        <PlotFigure title={title} subtitle={<>{subtitle}<CalendarKey nino={nino !== undefined} /></>}
          source={`Source: NASA FIRMS${nino ? ', NOAA ONI' : ''}; analysis: Fire Harmony`} height={26 + cal.years.length * 12 + 4}
          build={(w) => buildCalendar(w, cal, marks)} deps={[file, nino]} table={calendarTable(cal)} />
        <div className="fh-mx-cal-foot">
          <AreaLink kind={kind} id={areaId} className="ui-btn ui-btn-ghost fh-mx-cal-open">Open {name} in the Explorer</AreaLink>
        </div>
      </Card>
    </div>
  );
}

/** The months of a year after the last known one: "November and December". */
const missingMonths = (known: number) => (known >= 11 ? 'December' : known === 10 ? 'November and December' : `${MONTHS[known]} to December`);

/** Years whose September El Niño index (ONI, in the drivers file) was at least 0.5. */
function ninoYears(d: DriversFile): number[] {
  const yr = d.months.yr as number[], mo = d.months.mo as number[], oni = d.months.oni as (number | null)[];
  return yr.flatMap((y, i) => (mo[i] === 9 && (oni[i] ?? -9) >= 0.5 ? [y] : []));
}
function oniAt(d: DriversFile, y: number, m: number): number | null {
  const yr = d.months.yr as number[], mo = d.months.mo as number[], oni = d.months.oni as (number | null)[];
  const i = yr.findIndex((v, k) => v === y && mo[k] === m);
  return i < 0 ? null : oni[i] ?? null;
}

/** The two burning calendars of the haze section: Central Kalimantan (with El Niño) and Malaysia. */
export function HazeCalendars() {
  const [attempt, setAttempt] = useState(0);
  const ck = useFile(() => seriesFile('state', 'IDN-1931'), 'ck', attempt);
  const my = useFile(() => seriesFile('country', 'MYS'), 'my', attempt);
  const dr = useFile(() => driversFile('state', 'IDN-1931'), 'ck-drivers', attempt);
  const retry = () => setAttempt((a) => a + 1);
  const ckCard = ck && ck !== 'failed' && dr !== null ? (() => {
    const cal = calendarOf(ck);
    const worst = [...cal.totals].sort((a, b) => b.h - a.h).slice(0, 3).map((t) => t.yr);
    const drivers = dr !== 'failed' ? dr : null;
    const sep = drivers ? oniAt(drivers, cal.years[cal.years.length - 1], 9) : null;
    const last = cal.totals[cal.totals.length - 1];
    return (
      <CalendarCard kind="state" areaId="IDN-1931" name="Central Kalimantan" file={ck} nino={drivers ? ninoYears(drivers) : undefined}
        title={`Central Kalimantan burns hardest in El Niño years, as in ${last.yr}`}
        subtitle={<>Harmonized hotspots per month on the NOAA‑20 VIIRS scale, one row per year from {FIRST_YEAR}. The worst seasons came in {worst.join(', ').replace(/, ([^,]+)$/, ' and $1')}{sep !== null ? <>; in September {last.yr} the El Niño index reached {fix(sep, 1)}</> : null}.{last.partial ? <> {missingMonths(last.months)} {last.yr} have no data yet.</> : null}</>} />
    );
  })() : <Loading state={ck === 'failed' || dr === 'failed' ? 'failed' : null} what="burning calendar of Central Kalimantan" onRetry={retry} height={420} />;
  const myCard = my && my !== 'failed' ? (() => {
    const cal = calendarOf(my);
    const first = cal.totals[0], full = cal.totals.filter((t) => !t.partial), lastFull = full[full.length - 1];
    return (
      <CalendarCard kind="country" areaId="MYS" name="Malaysia" file={my}
        title="Fire in Malaysia has fallen by more than half since the early 2000s"
        subtitle={<>Harmonized hotspots per month on the NOAA‑20 VIIRS scale, one row per year from {FIRST_YEAR}: from {int(first.h)} hotspots in {first.yr} to {int(lastFull.h)} in {lastFull.yr}.</>} />
    );
  })() : <Loading state={my === 'failed' ? 'failed' : null} what="burning calendar of Malaysia" onRetry={retry} height={420} />;
  return <Grid cols={2}>{ckCard}{myCard}</Grid>;
}

// ------------------------------------------------------------------------------------------------ the drivers

interface DrPt { yr: number; mo: number; t: number; z: number | null; ratio: number | null; rain: number | null; season: boolean }

function driverPoints(d: DriversFile): DrPt[] {
  const m = d.months;
  const n = (m.yr as number[]).length;
  return Array.from({ length: n }, (_, i) => {
    const yr = m.yr[i] as number, mo = m.mo[i] as number;
    return { yr, mo, t: yr + (mo - 0.5) / 12, z: (m.rain3_z[i] as number | null) ?? null, ratio: (m.ratio[i] as number | null) ?? null,
      rain: (m.f_drivers[i] as number | null) ?? null, season: m.in_season[i] === true };
  });
}

const RATIO_LO = 0.01;
const logTicks = [0.01, 0.1, 1, 10];
const times = (v: number) => (v >= 1 ? `${fix(v, 0)}×` : `${v}×`);

function buildDriversScatter(width: number, pts: DrPt[], beta: number): Plot.PlotOptions {
  const p = pal();
  const fit = pts.filter((x) => x.yr >= 2002 && x.yr <= 2025 && x.z !== null && x.ratio !== null);
  const hi = Math.max(60, ...fit.map((x) => x.ratio ?? 0));
  const line = Array.from({ length: 61 }, (_, i) => { const z = -3 + i * 0.1; return { z, v: Math.exp(beta * z) }; }).filter((x) => x.v >= RATIO_LO && x.v <= hi);
  return {
    height: 300, marginLeft: 44, marginRight: 12, marginTop: 12, marginBottom: 40,
    x: { domain: [-3.3, 3.3], ticks: width < 420 ? [-3, 0, 3] : [-3, -2, -1, 0, 1, 2, 3], tickFormat: (v: number) => (v > 0 ? `+${v}` : String(v).replace('-', '−')),
      label: width < 420 ? 'Rain over 3 months (0 is normal)' : 'Rain over 3 months, standardised (0 is normal)', labelAnchor: 'center', labelArrow: 'none', labelOffset: 34, tickSize: 0 },
    y: { type: 'log', domain: [RATIO_LO, hi], ticks: logTicks, tickFormat: times, label: null, tickSize: 0 },
    marks: [
      gridX(p, { ticks: [-3, -2, -1, 0, 1, 2, 3] }), gridY(p, { ticks: logTicks }),
      Plot.ruleY([1], { stroke: p.baseline }), Plot.ruleX([0], { stroke: p.baseline }),
      Plot.dot(fit, { x: 'z', y: (x: DrPt) => Math.max(RATIO_LO, x.ratio ?? RATIO_LO), r: (x: DrPt) => (x.season ? 4.5 : 2.4),
        fill: p.accent, fillOpacity: (x: DrPt) => (x.season ? 0.7 : 0.4), stroke: p.surface, strokeWidth: 0.6 }),
      Plot.line(line, { x: 'z', y: 'v', stroke: p.ink, strokeWidth: 2.2 }),
      Plot.tip(fit, Plot.pointer({ x: 'z', y: (x: DrPt) => Math.max(RATIO_LO, x.ratio ?? RATIO_LO), ...tip(p),
        title: (x: DrPt) => `${MONTHS[x.mo - 1]} ${x.yr}${x.season ? ', fire season' : ''}\nRain over 3 months: ${fix(x.z ?? 0, 1)}\nFire: ${fix(x.ratio ?? 0, (x.ratio ?? 0) < 1 ? 2 : 1)} times normal` })),
    ],
  };
}

function buildDriversSeries(width: number, pts: DrPt[]): Plot.PlotOptions {
  const p = pal();
  const span = pts.filter((x) => x.yr >= 2014 && x.ratio !== null);
  const rain = pts.filter((x) => x.yr >= 2014 && x.rain !== null && x.season);
  const hi = Math.max(60, ...span.map((x) => x.ratio ?? 0), ...rain.map((x) => x.rain ?? 0));
  const last = span[span.length - 1];
  return {
    height: 300, marginLeft: 44, marginRight: 14, marginTop: 12, marginBottom: 40,
    x: { domain: [2014, (last?.yr ?? 2026) + 1], ticks: width < 420 ? [2014, 2020, 2026] : [2014, 2016, 2018, 2020, 2022, 2024, 2026], tickFormat: (v: number) => String(v), label: null, tickSize: 0 },
    y: { type: 'log', domain: [RATIO_LO, hi], ticks: logTicks, tickFormat: times, label: null, tickSize: 0 },
    marks: [
      gridY(p, { ticks: logTicks }),
      Plot.ruleY([1], { stroke: p.baseline }),
      Plot.lineY(span, { x: 't', y: (x: DrPt) => Math.max(RATIO_LO, x.ratio ?? RATIO_LO), stroke: p.accent, strokeWidth: 2 }),
      // what the rain alone points to, one run per fire season
      Plot.line(rain, { x: 't', y: 'rain', z: 'yr', stroke: p.ink, strokeWidth: 1 }),
      Plot.dot(rain, { x: 't', y: 'rain', r: 2.6, fill: p.ink, stroke: p.surface, strokeWidth: 0.8 }),
      Plot.tip(span, Plot.pointerX({ x: 't', y: (x: DrPt) => Math.max(RATIO_LO, x.ratio ?? RATIO_LO), ...tip(p),
        title: (x: DrPt) => `${MONTHS[x.mo - 1]} ${x.yr}\nFire: ${fix(x.ratio ?? 0, (x.ratio ?? 0) < 1 ? 2 : 1)} times normal${x.rain !== null && x.season ? `\nThe rain alone: ${fix(x.rain, x.rain < 1 ? 2 : 1)} times normal` : ''}` })),
    ],
  };
}

/** Central Kalimantan: fire against normal and the rain of the last three months (fig14 of the report), live. */
export function DriversFigures() {
  const [attempt, setAttempt] = useState(0);
  const dr = useFile(() => driversFile('state', 'IDN-1931'), 'ck-drivers', attempt);
  if (!dr || dr === 'failed') {
    return <Grid cols={2}><Loading state={dr === 'failed' ? 'failed' : null} what="drivers of Central Kalimantan" onRetry={() => setAttempt((a) => a + 1)} height={360} /><Card><Skeleton height={360} /></Card></Grid>;
  }
  const pts = driverPoints(dr);
  const beta = Number(dr.model.beta_rain ?? 0);
  const r2 = Number(dr.model.r2_cv ?? 0);
  const fitYears = pts.filter((x) => x.yr >= 2002 && x.yr <= 2025 && x.z !== null && x.ratio !== null);
  return (
    <div id="fig-drivers" className="fh-mx-jump-target ui-grid ui-grid-2">
      <Card>
        <PlotFigure title="In Central Kalimantan, drier months burn more"
          subtitle={<>Each dot is one month of 2002 to 2025: fire against the normal of that month (log scale), and the rain of that month and the two before. Big dots: months of the fire season. The line is the model; on years left out it explains {fix(100 * r2, 0)}% of the ups and downs.</>}
          source="Source: NASA FIRMS, GPM IMERG; analysis: Fire Harmony" height={300}
          build={(w) => buildDriversScatter(w, pts, beta)} deps={[dr]}
          table={{ columns: ['Month', 'Rain over 3 months', 'Fire, times normal', 'Fire season'],
            rows: fitYears.map((x) => [`${SHORT[x.mo - 1]} ${x.yr}`, fix(x.z ?? 0, 2), fix(x.ratio ?? 0, 2), x.season ? 'yes' : '']) }} />
      </Card>
      <Card>
        <PlotFigure title="Fire seasons follow drought"
          subtitle={<>Fire against normal from 2014 (line, log scale), and what the rain alone points to in the fire season (dots).
            <span className="fh-pg-legend">
              <span className="fh-pg-key"><span className="fh-pg-swatch fh-pg-swatch-line fh-mx-key-naive" aria-hidden="true" />Fire, times normal</span>
              <span className="fh-pg-key"><span className="fh-mx-dot-key" aria-hidden="true" />The rain alone</span>
            </span></>}
          source="Source: NASA FIRMS, GPM IMERG; analysis: Fire Harmony" height={300}
          build={(w) => buildDriversSeries(w, pts)} deps={[dr]}
          table={{ columns: ['Month', 'Fire, times normal', 'The rain alone'],
            rows: pts.filter((x) => x.yr >= 2014 && x.ratio !== null).map((x) => [`${SHORT[x.mo - 1]} ${x.yr}`, fix(x.ratio ?? 0, 2), x.rain !== null && x.season ? fix(x.rain, 2) : '–']) }} />
      </Card>
    </div>
  );
}
