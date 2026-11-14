// Fire over the years: yearly totals of the area (full years) on the chosen scale, with the 90% range of the years
// modelled from MODIS. On "raw sensors" it draws every satellite as recorded next to the harmonized record, which
// shows the jumps that harmonizing removes. Built with PlotFigure (title, subtitle, source line, table view).
// yearlyChart() is also used to make the PNG picture of the chart (Downloads). The title says only what the trend can
// support (lib/stats.ts trendVerdict). The crosshair tells which year is under the pointer (onHoverYear), so the map
// can preview that year. CompareChart draws the yearly fire of the pinned places together, as counts or as each
// place's own percent of its mean (sizes differ by orders of magnitude).
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Plot from '@observablehq/plot';
import {
  annualTotals, comparedWithNormal, countText, intervalFor, meanPerYear, trendText, trendVerdict, yearToMonth, type FamilyTest, type YearSpan,
} from '../lib/stats';
import { formatCompact, formatCountWords, formatNumber, useI18n, type Dict, type Lang } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import type { Meta, MonthlyPoint, Scale, Source } from '../lib/types';
import { PlotFigure, cssVar, type FigureTable } from './ui';
import { chartTitle } from './explorer/trendWords';

type SensorKey = 't' | 'a' | 's' | 'n' | 'j';
const SENSORS: readonly { key: SensorKey; colour: string; opacity: number }[] = [
  { key: 't', colour: '--sensor-modis', opacity: 0.45 },
  { key: 'a', colour: '--sensor-modis', opacity: 1 },
  { key: 's', colour: '--sensor-snpp', opacity: 1 },
  { key: 'n', colour: '--sensor-noaa20', opacity: 1 },
  { key: 'j', colour: '--sensor-noaa21', opacity: 1 },
];

export interface ChartKey { label: string; colour: string; opacity: number; width: number; shape?: 'line' | 'dot' | 'tick' }

export interface SeriesChartProps {
  points: readonly MonthlyPoint[];   // the area's months as loaded (harmonized, MODIS scale and raw detections)
  scale: Scale;
  meta: Meta;
  years: YearSpan;
  name: string;                       // as in a sentence: "the world", "Indonesia"
  compact?: boolean;                  // narrow panel: fewer labels
  onHoverYear?: (yr: number | null) => void;   // the year under the crosshair (null when the pointer leaves)
  family?: FamilyTest | null;         // the place's trend test among all the places of its kind (Kpis, the brief)
  waiting?: string | null;            // the series is not the selected area's yet ("Loading Australia…"): no title or subtitle
}

interface YearRow { yr: number; total: number; src: Source; lo: number | null; hi: number | null }

export interface YearlyChart {
  title: string;
  subtitle: string;
  note?: string;                      // the year so far ("2026 to October: 157,000 hotspots, 5.3 times normal.")
  source: string;
  keys: ChartKey[];                   // the lines on "raw sensors" (direct labels would collide)
  table: FigureTable;
  build: (width: number) => Plot.PlotOptions;
}

/** Everything the yearly chart shows, for the page and for the PNG picture. */
export function yearlyChart(points: readonly MonthlyPoint[], scale: Scale, meta: Meta, years: YearSpan, name: string,
  t: Dict, lang: Lang, compact = false, family: FamilyTest | null = null): YearlyChart {
  const c = t.chart;
  const base = scale === 'modis' ? 'modis' : 'harmonized';
  const raw = scale === 'raw';
  const from = Math.max(2001, years[0]), to = years[1];

  const rows: YearRow[] = annualTotals(points, base).flatMap((y) => {
    if (!y.complete || y.total === null || y.yr < from || y.yr > to) return [];
    const r = base === 'harmonized' && (y.src === 1 || y.src === 2) ? intervalFor(y.total, y.src, 'year', meta) : null;
    return [{ yr: y.yr, total: y.total, src: y.src, lo: r?.lo ?? null, hi: r?.hi ?? null }];
  });

  const sensors = new Map<number, Record<SensorKey, number>>();
  if (raw) {
    const byYear = new Map<number, Record<SensorKey, number> & { months: number }>();
    for (const p of points) {
      if (p.src === 3 || p.yr < from || p.yr > to) continue;
      const r = byYear.get(p.yr) ?? { t: 0, a: 0, s: 0, n: 0, j: 0, months: 0 };
      r.t += p.t; r.a += p.a; r.s += p.s; r.n += p.n; r.j += p.j; r.months += 1;
      byYear.set(p.yr, r);
    }
    for (const [yr, r] of byYear) if (r.months === 12) sensors.set(yr, r);
  }

  // the year so far (the record's last year, not yet complete): a hollow dot with a tick at the normal of the same
  // months, as on the Dashboard's trend chart, and a line under the subtitle with the same numbers as the strip
  const lastPart = annualTotals(points, base).filter((y) => !y.complete && y.months > 0 && y.yr >= from && y.yr <= to).pop();
  const knownMonths = lastPart ? points.filter((p) => p.yr === lastPart.yr && p.src !== 3 && (base === 'modis' ? p.modis : p.h) !== null).map((p) => p.mo) : [];
  const soFar = lastPart && !raw && knownMonths.length ? yearToMonth(points, base, lastPart.yr, Math.max(...knownMonths)) : null;
  const partial = soFar && rows.length && soFar.yr > rows[rows.length - 1].yr
    ? { yr: soFar.yr, total: soFar.total, normal: soFar.normal, ratio: soFar.ratio, month: t.common.months[soFar.lastMonth - 1], short: t.common.monthsShort[soFar.lastMonth - 1] }
    : null;
  const against = partial ? (partial.ratio !== null ? comparedWithNormal(partial.ratio) : partial.normal === 0 && partial.total > 0 ? t.kpi.fireUnusual : '') : '';
  const note = partial ? (against ? c.partialLine(partial.yr, partial.month, countText(partial.total, 'compact'), against)
    : `${partial.yr} to ${partial.month}: ${t.calendar.units.harmonized(countText(partial.total, 'compact'))}.`) : undefined;

  // the test among all the places of its kind is on the harmonized record of 2001 to 2025
  const verdict = trendVerdict(points, base, base === 'harmonized' ? family : null, [from, to]);
  const tr = verdict.trend;
  const pct = tr.pct_per_decade === null ? '' : trendText(tr.pct_per_decade, 'detail', false);
  // (worded from the card's verdict, so the title never says more than the card: explorer/trendWords.ts)
  const title = raw ? c.title.raw : chartTitle(verdict, name, pct, t, base === 'harmonized' ? family : null);

  const keys: ChartKey[] = raw ? [
    { label: t.panels.harmonizedLabel, colour: cssVar('--harmonized', '#0b0b0b'), opacity: 1, width: 2.6 },
    ...SENSORS.map((s) => ({ label: t.panels.sensors[s.key], colour: cssVar(s.colour), opacity: s.opacity, width: 2 })),
  ] : partial ? [
    { label: c.partialKey(partial.yr, partial.short), colour: cssVar('--harmonized', '#0b0b0b'), opacity: 1, width: 2, shape: 'dot' },
    ...(partial.normal !== null && partial.normal > 0
      ? [{ label: c.partialNormal, colour: cssVar('--text-2', '#52514e'), opacity: 1, width: 2, shape: 'tick' as const }] : []),
  ] : [];

  const table: FigureTable = raw ? {
    columns: [c.cols.year, c.cols.harmonized, ...SENSORS.map((s) => t.panels.sensors[s.key])],
    rows: rows.map((y) => {
      const s = sensors.get(y.yr);
      return [String(y.yr), countText(y.total, 'exact'), ...SENSORS.map((k) => (s ? countText(s[k.key], 'exact') : '–'))];
    }),
  } : {
    columns: base === 'harmonized' ? [c.cols.year, c.cols.hotspots, c.cols.low, c.cols.high, c.cols.source] : [c.cols.year, c.cols.hotspots],
    rows: [...rows.map((y) => (base === 'harmonized'
      ? [String(y.yr), countText(y.total, 'exact'), y.lo === null ? '–' : formatCountWords(y.lo, lang),
        y.hi === null ? '–' : formatCountWords(y.hi, lang), y.lo === null ? c.observed : c.modelled]
      : [String(y.yr), countText(y.total, 'exact')])),
    ...(partial ? [base === 'harmonized' ? [c.partialKey(partial.yr, partial.short), countText(partial.total, 'compact'), '–', '–', c.observed]
      : [c.partialKey(partial.yr, partial.short), countText(partial.total, 'compact')]] : [])],
  };

  const build = (width: number): Plot.PlotOptions => {
    const ink = cssVar('--harmonized', '#0b0b0b'), ink2 = cssVar('--ink-2'), muted = cssVar('--muted', '#898781');
    const narrow = compact || width < 520;
    const span = rows.length ? rows[rows.length - 1].yr - rows[0].yr : 0;
    const step = span > 16 ? (narrow ? 10 : 5) : span > 7 ? 2 : 1;
    const ticks = rows.map((y) => y.yr).filter((yr) => yr % step === 0);
    const band = rows.filter((y) => y.lo !== null && y.hi !== null);
    const last = rows[rows.length - 1];
    const sensorRows = SENSORS.flatMap((s) => [...sensors].flatMap(([yr, r]) => (r[s.key] > 0 ? [{ yr, key: s.key, v: r[s.key] }] : [])));
    const surface = cssVar('--surface-1', '#fcfcfb');
    const partRows = partial ? [partial] : [];
    const tipRows = rows.map((y) => ({ ...y, s: sensors.get(y.yr) }));
    const showEras = !raw && base === 'harmonized' && width >= 560 && band.length >= 3 && rows.some((y) => y.lo === null);
    const lastModelled = band.length ? band[band.length - 1].yr : null;
    const directLabel = !raw && last && !narrow;
    const tipText = (d: (typeof tipRows)[number]): string => {
      const lines = [`${d.yr}`, base === 'modis' ? t.calendar.units.modis(countText(d.total, 'compact'))
        : t.calendar.units.harmonized(countText(d.total, 'compact'))];
      if (d.lo !== null && d.hi !== null) lines.push(c.tipRange(formatCountWords(d.lo, lang), formatCountWords(d.hi, lang)));
      if (raw && d.s) for (const k of SENSORS) if (d.s[k.key] > 0) lines.push(`${t.panels.sensors[k.key]}: ${countText(d.s[k.key], 'compact')}`);
      return lines.join('\n');
    };
    return {
      height: narrow ? 220 : 290,
      marginTop: showEras ? 26 : 14,
      marginRight: directLabel ? 92 : 16,
      marginLeft: 46,
      x: { label: null, ticks, tickFormat: (v: number) => String(v), grid: false, nice: false,
        ...(partial && rows.length ? { domain: [rows[0].yr - 0.3, partial.yr + 0.45] } : {}) },
      y: { label: null, grid: true, zero: true, nice: true, tickFormat: (v: number) => formatCompact(v, lang), ticks: narrow ? 4 : 5 },
      marks: [
        Plot.ruleY([0], { stroke: cssVar('--baseline') }),
        ...(showEras && lastModelled !== null ? [
          Plot.ruleX([lastModelled + 0.5], { stroke: cssVar('--grid'), strokeWidth: 1 }),
          Plot.text([{ x: (rows[0].yr + lastModelled) / 2, label: c.modelled }, { x: (lastModelled + 1 + last.yr) / 2, label: c.observed }],
            { x: 'x', text: 'label', frameAnchor: 'top', dy: -16, fill: muted, fontSize: 11 }),
        ] : []),
        ...(band.length ? [Plot.areaY(band, { x: 'yr', y1: 'lo', y2: 'hi', fill: cssVar('--band', 'rgba(11,11,11,0.1)'), curve: 'linear' })] : []),
        ...SENSORS.map((s) => Plot.lineY(sensorRows.filter((r) => r.key === s.key),
          { x: 'yr', y: 'v', stroke: cssVar(s.colour), strokeOpacity: s.opacity, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' })),
        Plot.lineY(rows, { x: 'yr', y: 'total', stroke: ink, strokeWidth: 2.6, strokeLinejoin: 'round', strokeLinecap: 'round' }),
        ...(directLabel ? [Plot.text([last], { x: 'yr', y: 'total', text: () => (base === 'modis' ? t.panels.modisScale : t.panels.harmonizedLabel),
          dx: 8, textAnchor: 'start', fill: ink2, fontSize: 12, fontWeight: 600 })] : []),
        // the year so far: the normal of the same months as a short tick, the count as a hollow dot labelled "so far"
        ...(partial && partial.normal !== null && partial.normal > 0 ? [Plot.link(partRows, {
          x1: (d: typeof partial) => d.yr - 0.32, x2: (d: typeof partial) => d.yr + 0.32, y1: 'normal', y2: 'normal',
          stroke: ink2, strokeWidth: 2, strokeLinecap: 'round' })] : []),
        ...(partial ? [
          Plot.dot(partRows, { x: 'yr', y: 'total', r: 4.5, fill: surface, stroke: ink, strokeWidth: 2 }),
          // (its label above the dot, or under it when the dot sits below the last full year, clear of the line)
          Plot.text(partRows, { x: 'yr', y: 'total', text: () => c.soFarShort, dy: partial.total >= (last?.total ?? 0) ? -13 : 17,
            fill: ink2, fontSize: 11, textAnchor: 'end', dx: 4 }),
        ] : []),
        Plot.ruleX(tipRows, Plot.pointerX({ x: 'yr', stroke: cssVar('--baseline'), strokeWidth: 1 })),
        Plot.dot(tipRows, Plot.pointerX({ x: 'yr', y: 'total', r: 4, fill: ink, stroke: cssVar('--surface-1', '#fcfcfb'), strokeWidth: 2 })),
        Plot.tip(tipRows, Plot.pointerX({ x: 'yr', y: 'total', title: tipText, fontSize: 12 })),
      ],
    };
  };

  return { title, subtitle: c.subtitle[scale], note, source: c.source, keys, table, build };
}

/** Calls `onYear` with the year under a Plot chart's pointer (the datum of its pointer marks has `yr`). */
function useHoverYear(box: React.RefObject<HTMLDivElement | null>, onYear?: (yr: number | null) => void): void {
  const cb = useRef(onYear);
  cb.current = onYear;
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    let last: number | null = null;
    const onInput = (e: Event) => {
      const v = (e.target as { value?: { yr?: number } | null }).value;
      const yr = v && typeof v.yr === 'number' ? v.yr : null;
      if (yr !== last) { last = yr; cb.current?.(yr); }
    };
    const onLeave = () => { if (last !== null) { last = null; cb.current?.(null); } };
    el.addEventListener('input', onInput);
    el.addEventListener('pointerleave', onLeave);
    return () => { el.removeEventListener('input', onInput); el.removeEventListener('pointerleave', onLeave); onLeave(); };
  }, [box]);
}

export function SeriesChart({ points, scale, meta, years, name, compact = false, onHoverYear, family = null, waiting = null }: SeriesChartProps) {
  const { t, lang } = useI18n();
  const theme = useTheme();   // the colours of the keys come from the theme
  const box = useRef<HTMLDivElement>(null);
  useHoverYear(box, onHoverYear);
  const chart = useMemo(() => { void theme; return yearlyChart(points, scale, meta, years, name, t, lang, compact, family); },
    [points, scale, meta, years, name, t, lang, compact, theme, family]);
  return (
    <div ref={box} className="fh-ex-chart" data-export="chart">
      <PlotFigure
        title={waiting ? <span className="fh-ex-wait" aria-busy="true" aria-label={waiting}><span className="ui-skeleton" style={{ height: 18 }} /></span> : chart.title}
        subtitle={waiting ? <span className="fh-ex-wait" aria-hidden="true"><span className="ui-skeleton" style={{ height: 14 }} /></span> : (
          <>
            {chart.subtitle}
            {chart.note ? <span className="fh-ex-chart-note" data-partial="">{chart.note}</span> : null}
            {chart.keys.length ? (
              <span className="fh-ex-keys">
                {chart.keys.map((k) => (
                  <span key={k.label} className="fh-ex-key">
                    <svg width="18" height="10" aria-hidden="true">
                      {k.shape === 'dot' ? <circle cx="9" cy="5" r="3.6" fill="var(--surface-1)" stroke={k.colour} strokeWidth={1.8} />
                        : <line x1={k.shape === 'tick' ? 4 : 2} y1="5" x2={k.shape === 'tick' ? 14 : 16} y2="5" stroke={k.colour}
                          strokeOpacity={k.opacity} strokeWidth={k.width} strokeLinecap="round" />}
                    </svg>
                    {k.label}
                  </span>
                ))}
              </span>
            ) : null}
          </>
        )}
        source={chart.source}
        table={chart.table}
        build={chart.build}
        height={compact ? 220 : 290}
        deps={[chart]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Compare: the yearly fire of up to four places in one chart

export type CompareMode = 'count' | 'share';

export interface CompareSeries {
  key: string;
  name: string;
  points: readonly MonthlyPoint[] | null;   // null while loading
  current: boolean;                          // the place in the panel (drawn in ink)
}

/** The colour of each line: the place in the panel in ink, the pinned ones in the three compare colours. */
export function compareColour(i: number, current: boolean): string {
  return current ? cssVar('--harmonized', '#0b0b0b') : cssVar(`--ex-cmp-${(i % 3) + 1}`, '#3a75bf');
}

interface CompareRow { key: string; name: string; yr: number; total: number; share: number | null; colour: string; current: boolean }

/** The yearly totals of every place (full years, 2001 to the last year), with each place's percent of its own mean. */
export function compareRows(series: readonly CompareSeries[], years: YearSpan, colours: readonly string[]): CompareRow[] {
  return series.flatMap((s, i) => {
    if (!s.points) return [];
    const mean = meanPerYear(s.points, 'harmonized');
    return annualTotals(s.points, 'harmonized').flatMap((y) => (y.complete && y.total !== null && y.yr >= Math.max(2001, years[0]) && y.yr <= years[1]
      ? [{ key: s.key, name: s.name, yr: y.yr, total: y.total, share: mean ? (100 * y.total) / mean : null, colour: colours[i], current: s.current }]
      : []));
  });
}

/** The compare chart, for the panel and for the PNG picture: one line per place in the compare colours (the place in
 *  the panel in ink), as hotspots or as each place's percent of its own mean. `hidden`: places switched off. */
export function compareChart(series: readonly CompareSeries[], years: YearSpan, mode: CompareMode, colours: readonly string[],
  t: Dict, lang: Lang, hidden: ReadonlySet<string> = new Set()): YearlyChart & { rows: CompareRow[]; byYear: { yr: number; list: CompareRow[] }[] } {
  const c = t.exPanel.compare;
  const rows = compareRows(series, years, colours);
  const shown = rows.filter((r) => !hidden.has(r.key));
  const value = (r: CompareRow) => (mode === 'share' ? r.share : r.total);
  const m = new Map<number, CompareRow[]>();
  for (const r of shown) m.set(r.yr, [...(m.get(r.yr) ?? []), r]);
  const byYear = [...m].sort(([a], [b]) => a - b).map(([yr, list]) => ({ yr, list }));
  const pctText = (v: number) => `${formatNumber(v, lang, 0)}%`;
  const build = (width: number): Plot.PlotOptions => {
    const span = years[1] - Math.max(2001, years[0]);
    const step = span > 16 ? (width < 520 ? 10 : 5) : 2;
    const ticks: number[] = [];
    for (let y = Math.ceil(Math.max(2001, years[0]) / step) * step; y <= years[1]; y += step) ticks.push(y);
    const lines = series.filter((s) => !hidden.has(s.key)).map((s) => {
      const own = shown.filter((r) => r.key === s.key && value(r) !== null);
      const r0 = own[0];
      return Plot.lineY(own, { x: 'yr', y: (r: CompareRow) => value(r), stroke: r0?.colour ?? 'currentColor', strokeWidth: s.current ? 2.6 : 2,
        strokeLinejoin: 'round', strokeLinecap: 'round' });
    });
    const tip = (d: { yr: number; list: CompareRow[] }) => [String(d.yr), ...d.list.map((r) => (mode === 'share' && r.share !== null
      ? c.tipShare(r.name, pctText(r.share), countText(r.total, 'compact')) : c.tipCount(r.name, countText(r.total, 'compact'))))].join('\n');
    const dots = shown.filter((r) => value(r) !== null);
    return {
      height: 220, marginTop: 14, marginRight: 16, marginLeft: 46,
      x: { label: null, ticks, tickFormat: (v: number) => String(v), grid: false, nice: false },
      y: mode === 'share'
        ? { label: null, grid: true, zero: true, nice: true, ticks: 4, tickFormat: (v: number) => `${v}%` }
        : { label: null, grid: true, zero: true, nice: true, ticks: 4, tickFormat: (v: number) => formatCompact(v, lang) },
      marks: [
        Plot.ruleY([mode === 'share' ? 100 : 0], { stroke: cssVar('--baseline') }),
        ...lines,
        Plot.ruleX(byYear, Plot.pointerX({ x: 'yr', stroke: cssVar('--baseline'), strokeWidth: 1 })),
        Plot.dot(dots, Plot.pointerX({ x: 'yr', y: (r: CompareRow) => value(r), r: 3.5, fill: (r: CompareRow) => r.colour,
          stroke: cssVar('--surface-1', '#fcfcfb'), strokeWidth: 1.5 })),
        Plot.tip(byYear, Plot.pointerX({ x: 'yr', y: (d: { list: CompareRow[] }) => Math.max(...d.list.map((r) => value(r) ?? 0)), title: tip, fontSize: 12 })),
      ],
    };
  };
  const table: FigureTable = {
    columns: [c.year, ...series.map((s) => s.name)],
    rows: [...new Set(rows.map((r) => r.yr))].sort((a, b) => a - b).map((yr) => [String(yr), ...series.map((s) => {
      const r = rows.find((x) => x.key === s.key && x.yr === yr);
      if (!r) return '–';
      return mode === 'share' && r.share !== null ? pctText(r.share) : countText(r.total, 'exact');
    })]),
  };
  const keys: ChartKey[] = series.filter((s) => !hidden.has(s.key)).map((s) => ({
    label: s.name, colour: colours[series.indexOf(s)], opacity: 1, width: s.current ? 2.6 : 2,
  }));
  return {
    title: t.exPanel.exports.title(shortNames(series.filter((s) => !hidden.has(s.key)).map((s) => s.name))), subtitle: c.subtitle[mode],
    source: t.chart.source, keys, table, build, rows, byYear,
  };
}

/** Names for one title: places of one country lose the country but the last ("Mato Grosso, Amazonas and Pará, Brazil"). */
export function shortNames(names: readonly string[]): string[] {
  if (names.length < 2) return [...names];
  const tail = (n: string) => (n.includes(', ') ? n.slice(n.lastIndexOf(', ')) : null);
  const t0 = tail(names[0]);
  if (!t0 || !names.every((n) => tail(n) === t0)) return [...names];
  return names.map((n, i) => (i === names.length - 1 ? n : n.slice(0, n.length - t0.length)));
}

/** The colours of the compare lines, in the order of the series (the place in the panel in ink). */
export function compareColours(series: readonly CompareSeries[]): string[] {
  let pinned = 0;
  return series.map((s) => compareColour(s.current ? 0 : pinned++, s.current));
}

export function CompareChart({ series, years, mode, onHoverYear }: {
  series: readonly CompareSeries[]; years: YearSpan; mode: CompareMode; onHoverYear?: (yr: number | null) => void;
}) {
  const { t, lang } = useI18n();
  const c = t.exPanel.compare;
  const theme = useTheme();
  const box = useRef<HTMLDivElement>(null);
  useHoverYear(box, onHoverYear);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const colours = useMemo(() => { void theme; return compareColours(series); }, [series, theme]);
  const chart = useMemo(() => compareChart(series, years, mode, colours, t, lang, hidden), [series, years, mode, colours, t, lang, hidden]);
  const { rows, byYear, build, table } = chart;
  const toggle = (key: string) => setHidden((h) => {
    const n = new Set(h);
    if (n.has(key)) n.delete(key); else if (series.length - n.size > 1) n.add(key);
    return n;
  });
  return (
    <div ref={box} className="fh-ex-chart fh-ex-compare-chart" data-mode={mode}>
      <PlotFigure title={c.title(series.length)} subtitle={c.subtitle[mode]} source={t.chart.source} table={table} build={build}
        height={220} deps={[rows, hidden, mode, byYear]} />
      <ul className="fh-ex-cmp-keys" aria-label={c.label}>
        {series.map((s, i) => (
          <li key={s.key}>
            <button type="button" className="fh-ex-cmp-key ui-press" aria-pressed={!hidden.has(s.key)} onClick={() => toggle(s.key)}
              disabled={!s.points}>
              <svg width="18" height="8" aria-hidden="true">
                <line x1="2" y1="4" x2="16" y2="4" stroke={colours[i]} strokeWidth={s.current ? 2.6 : 2} strokeLinecap="round" />
              </svg>
              <span>{s.name}</span>
              {!s.points ? <span className="fh-ex-spin" aria-hidden="true" /> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
