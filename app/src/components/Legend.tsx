// Colour bars for the map and the burning calendar, and the colour helpers they share. The bar is SVG, so the
// picture downloads keep it. Colours come from tokens.css: ember for fire amount, the anomaly scale against normal.
import { useId } from 'react';
import { classEdges, type LogScale } from '../lib/stats';
import { formatCompact, formatNumber, formatTimes, useI18n, type Lang } from '../lib/i18n';
import type { MapMode, Scale } from '../lib/types';
import { MAP_COUNT_SCALES, MAP_RATIO_LIMIT, type Level } from './explorer/mapData';
import { TREND_EDGES, type TrendCounts } from './explorer/trend';

export const EMBER_VARS = ['--ember-100', '--ember-200', '--ember-300', '--ember-400', '--ember-500', '--ember-600',
  '--ember-700', '--ember-800', '--ember-900'] as const;
export const ANOMALY_VARS = ['--anom-b4', '--anom-b3', '--anom-b2', '--anom-b1', '--anom-0', '--anom-r1', '--anom-r2',
  '--anom-r3', '--anom-r4'] as const;

/** Fill of a month or a hexagon without fire. */
export const ZERO_FILL = 'var(--anom-0)';
/** The hatching of a modelled month MODIS saw no fire in: stripes of the text colour over the colour of the month. */
export const MODELLED_FILL = 'var(--ember-300)';
export const MODELLED_STRIPE = 'color-mix(in srgb, var(--text) 55%, transparent)';
export const EMBER_FILLS = EMBER_VARS.map((v) => `var(${v})`);
export const ANOMALY_FILLS = ANOMALY_VARS.map((v) => `var(${v})`);

/** Read a CSS variable (a hex colour) as [r, g, b]. */
export function cssRgb(name: string): [number, number, number] {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v.slice(1) : '898781';
  const n = parseInt(hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Index 0..8 on the ember ramp for a count, on a log scale from 1 to `max` (kept for other pages). */
export function countStep(value: number, max: number): number {
  if (!(value > 0)) return 0;
  const top = Math.log10(Math.max(max, 10));
  return Math.max(0, Math.min(8, Math.round((Math.log10(Math.max(value, 1)) / top) * 8)));
}

/** Index 0..8 on the diverging ramp for value / normal, on log2 clipped to plus or minus 2 (kept for other pages). */
export function anomalyStep(value: number, normal: number | null): number | null {
  if (normal === null || !(normal > 0)) return value > 0 ? 8 : null;
  const r = Math.log2(Math.max(value, normal / 16) / normal);
  return Math.max(0, Math.min(8, Math.round(r * 2) + 4));
}

export function formatCount(v: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: v >= 10000 ? 'compact' : 'standard', maximumFractionDigits: v < 10 ? 1 : 0 }).format(v);
}

export interface BarTick { at: number; label: string }     // at: 0 (left end) to 1 (right end)
/** A swatch beside the bar: a colour, the hatching of months without data ('hatch'), the hatching of modelled months
 *  MODIS saw none of ('modelled'), or an outline (the critical period, 'outline'). */
export interface BarExtra { label: string; fill: string | 'hatch' | 'modelled' | 'outline' }

/** Ticks of a log count scale: both ends and the middle, in short numbers. */
export function countTicks(scale: LogScale, lang: Lang): BarTick[] {
  const edges = classEdges(scale);
  return [
    { at: 0, label: formatCompact(scale.lo, lang) },
    { at: 0.5, label: formatCompact(Math.sqrt(edges[0] * edges[edges.length - 1]), lang) },
    { at: 1, label: formatCompact(scale.hi, lang) },
  ];
}

/** The ticks of a log count scale: both ends and up to three round values between them (powers of ten when two or more
 *  fall inside, else 1, 2 and 5 times them), each at its place on the bar and none too close to another, so a legend
 *  reads "20, 100, 1,000, 10K, 60K" rather than "20, 150, 1,100, 8,100, 60K". */
export function countTickValues(lo: number, hi: number): { at: number; value: number }[] {
  const span = Math.log(hi / lo);
  if (!(span > 0)) return [{ at: 0, value: lo }];
  const pos = (v: number) => Math.log(v / lo) / span;
  const GAP = 0.12;
  const inside = (vals: number[]) => vals.filter((v) => pos(v) >= GAP && pos(v) <= 1 - GAP);
  const powers: number[] = [], steps: number[] = [];
  for (let k = Math.floor(Math.log10(lo)) - 1; k <= Math.ceil(Math.log10(hi)) + 1; k++) {
    const p = 10 ** k;
    powers.push(p);
    steps.push(p, 2 * p, 5 * p);
  }
  let mid = inside(powers);
  if (mid.length < 2) mid = inside(steps);
  const apart: number[] = [];
  for (const v of mid) if (!apart.length || pos(v) - pos(apart[apart.length - 1]) >= GAP) apart.push(v);
  // at most three between the ends, spread over the bar
  const kept = apart.length <= 3 ? apart : [0, 1, 2].map((i) => apart[Math.round((i * (apart.length - 1)) / 2)]);
  return [{ at: 0, value: lo }, ...kept.map((v) => ({ at: pos(v), value: v })), { at: 1, value: hi }];
}

/** Four or five ticks of a log count scale (countTickValues), in short numbers; a label that would repeat its
 *  neighbour (a narrow scale) is left out. */
export function countTicks5(scale: LogScale, lang: Lang): BarTick[] {
  const ticks = countTickValues(scale.lo, scale.hi).map(({ at, value }) => ({ at, label: formatCompact(value, lang) }));
  return ticks.filter((t, i) => i === 0 || t.label !== ticks[i - 1].label);
}

/** Five ticks of a ratio scale: 1 / limit, its square root, normal, the root of the limit, the limit. */
export function ratioTicks5(limit: number, normalLabel: string, lang: Lang): BarTick[] {
  const r = Math.sqrt(limit);
  return [
    { at: 0, label: formatTimes(1 / limit, lang) }, { at: 0.25, label: formatTimes(1 / r, lang) },
    { at: 0.5, label: normalLabel },
    { at: 0.75, label: formatTimes(r, lang) }, { at: 1, label: formatTimes(limit, lang) },
  ];
}

/** Ticks of a ratio scale: 1 / limit, normal, limit. */
export function ratioTicks(limit: number, normalLabel: string, lang: Lang): BarTick[] {
  return [
    { at: 0, label: formatTimes(1 / limit, lang) },
    { at: 0.5, label: normalLabel },
    { at: 1, label: formatTimes(limit, lang) },
  ];
}

const EXTRA_GAP = 18, SWATCH_W = 14, SWATCH_H = 10;
const charWidth = (text: string) => text.length * 6.1;   // Inter at 11 px, about

export interface ColourBarProps {
  title: string;                  // what the colours mean, with the units
  colours: readonly string[];     // low to high
  ticks: readonly BarTick[];
  extras?: readonly BarExtra[];   // swatches for no fire, no data yet...
  width?: number;
  exportName?: string;            // data-export name, for the picture downloads
}

/** A colour bar: title, the steps of the scale with a few labels, and swatches for the special values. */
export function ColourBar({ title, colours, ticks, extras = [], width = 300, exportName }: ColourBarProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const top = 20, barH = 10, tickY = top + barH + 14;
  const extrasY = tickY + 12;
  const step = width / colours.length;
  // the swatches in rows: a swatch that would run past the bar starts a new row
  const placed = extras.reduce<(BarExtra & { at: number; row: number })[]>((out, e) => {
    const prev = out[out.length - 1];
    let at = prev ? prev.at + SWATCH_W + 6 + charWidth(prev.label) + EXTRA_GAP : 0;
    let row = prev?.row ?? 0;
    if (prev && at + SWATCH_W + 6 + charWidth(e.label) > width) { at = 0; row += 1; }
    return [...out, { ...e, at, row }];
  }, []);
  const rows = placed.length ? placed[placed.length - 1].row + 1 : 0;
  const height = rows ? extrasY + rows * (SWATCH_H + 8) - 6 : tickY + 4;
  const label = `${title}: ${ticks.map((t) => t.label).join(', ')}${extras.length ? `. ${extras.map((e) => e.label).join(', ')}` : ''}`;
  return (
    <svg className="fh-ex-legend" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={label} data-export={exportName}>
      <defs>
        <clipPath id={`${uid}c`}><rect x={0} y={top} width={width} height={barH} rx={3} /></clipPath>
        <pattern id={`${uid}h`} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={4} height={4} fill="var(--surface-1)" />
          <line x1={0} y1={0} x2={0} y2={4} stroke="var(--baseline)" strokeWidth={1.6} />
        </pattern>
        <pattern id={`${uid}m`} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <rect width={5} height={5} fill={MODELLED_FILL} />
          <line x1={0} y1={0} x2={0} y2={5} stroke={MODELLED_STRIPE} strokeWidth={2} />
        </pattern>
      </defs>
      <text className="fh-ex-legend-title" x={0} y={12}>{title}</text>
      <g clipPath={`url(#${uid}c)`}>
        {colours.map((c, i) => <rect key={i} x={i * step} y={top} width={step + 0.6} height={barH} fill={c} />)}
      </g>
      {ticks.map((t) => (
        <text key={t.label + t.at} className="fh-ex-legend-tick" x={t.at * width} y={tickY}
          textAnchor={t.at <= 0 ? 'start' : t.at >= 1 ? 'end' : 'middle'}>{t.label}</text>
      ))}
      {placed.map((e) => (
        <g key={e.label} transform={`translate(${e.at},${extrasY + e.row * (SWATCH_H + 8)})`}>
          <rect width={SWATCH_W} height={SWATCH_H} rx={2}
            fill={e.fill === 'hatch' ? `url(#${uid}h)` : e.fill === 'modelled' ? `url(#${uid}m)` : e.fill === 'outline' ? 'none' : e.fill}
            stroke={e.fill === 'outline' ? 'var(--text)' : 'var(--grid)'} strokeWidth={e.fill === 'outline' ? 1.6 : 1} />
          <text className="fh-ex-legend-tick" x={SWATCH_W + 6} y={SWATCH_H - 1}>{e.label}</text>
        </g>
      ))}
    </svg>
  );
}

/** The trend map's ramp: falling (blue) to rising (red), four classes each way; no middle step (no clear trend has its own
 *  swatch). The first step each way is a little brighter on the dark map (explorer.css --ex-trend-b1, --ex-trend-r1). */
export const TREND_FILLS = ['--anom-b4', '--anom-b3', '--anom-b2', '--ex-trend-b1', '--ex-trend-r1', '--anom-r2', '--anom-r3', '--anom-r4'].map((v) => `var(${v})`);
/** Fills of the two quiet trend classes (explorer.css; MapView mixes the same colours for the hexagons). */
export const TREND_FLAT_FILL = 'var(--ex-trend-flat)';
export const TREND_GHOST_FILL = 'var(--ex-trend-ghost)';

/** Ticks of the trend ramp, at the class edges: -60, -30, -15, 0, +15, +30, +60 (% per decade). */
export function trendTicks(): BarTick[] {
  const edges = [...TREND_EDGES].reverse();
  const minus = edges.map((e, k) => ({ at: (k + 1) / 8, label: `−${e}` }));
  const plus = [...TREND_EDGES].map((e, k) => ({ at: (5 + k) / 8, label: `+${e}` }));
  return [...minus, { at: 0.5, label: '0' }, ...plus];
}

/** Short words for the legend chip: what the colours mean in two or three words. */
export function legendShort(mode: MapMode, scale: Scale, t: ReturnType<typeof useI18n>['t']): string {
  if (mode === 'trend') return t.exMap.legendShort.trend;
  if (mode === 'anomaly') return t.exMap.legendShort.anomaly;
  return t.exMap.legendShort[scale];
}

/** The range of the map's colours in a few characters, for the legend chip on phones: "1 to 2,000", "0.25 to 4×",
 *  "±60%". */
export function legendRange(mode: MapMode, scale: Scale, level: Level, t: ReturnType<typeof useI18n>['t']): string {
  const lang = 'en' as const;
  if (mode === 'trend') return `±${TREND_EDGES[TREND_EDGES.length - 1]}%`;
  if (mode === 'anomaly') return t.exMap.rangeShort(formatTimes(1 / MAP_RATIO_LIMIT, lang).replace('×', ''), formatTimes(MAP_RATIO_LIMIT, lang));
  const s = MAP_COUNT_SCALES[level][scale];
  return t.exMap.rangeShort(formatNumber(s.lo, lang), formatNumber(s.hi, lang));
}

/** The fills of a mode's ramp (low to high). */
export function rampFills(mode: MapMode): string[] {
  return mode === 'trend' ? TREND_FILLS : mode === 'anomaly' ? ANOMALY_FILLS : EMBER_FILLS;
}

/**
 * The legend of the map: the fixed scale of the hexagons (fixed so that months compare while the player runs), with
 * the units. Fire count: ember steps on a log scale; against normal: the diverging steps of the log ratio; trend: the
 * diverging classes of the change per decade.
 */
export function MapLegend({ mode, scale, level, width = 236 }: { mode: MapMode; scale: Scale; level: Level; width?: number }) {
  const { t, lang } = useI18n();
  if (mode === 'trend') {
    return <ColourBar width={width} exportName="map-legend" title={t.exMap.trend.legendTitle} colours={TREND_FILLS} ticks={trendTicks()} />;
  }
  const count = mode === 'count';
  return (
    <ColourBar width={width} exportName="map-legend"
      title={count ? t.explorer.legend[scale] : t.explorer.legend.anomaly}
      colours={count ? EMBER_FILLS : ANOMALY_FILLS}
      ticks={count ? countTicks(MAP_COUNT_SCALES[level][scale], lang) : ratioTicks(MAP_RATIO_LIMIT, t.explorer.normalLabel, lang)} />
  );
}

/** The four classes of the trend map with the counts of the file, and why only some trends are coloured. */
export function TrendKey({ counts, floor, level }: { counts: TrendCounts | null; floor: number; level: Level }) {
  const { t, lang } = useI18n();
  const k = t.exMap.trend;
  const n = (v: number | undefined) => (v === undefined ? '…' : formatNumber(v, lang));
  const rows: { key: string; fill: string; label: string; value: number | undefined; ghost?: boolean }[] = [
    { key: 'rising', fill: 'var(--anom-r3)', label: k.rising, value: counts?.rising },
    { key: 'falling', fill: 'var(--anom-b3)', label: k.falling, value: counts?.falling },
    { key: 'flat', fill: TREND_FLAT_FILL, label: k.flat, value: counts?.flat },
    { key: 'untested', fill: TREND_GHOST_FILL, label: k.untested(formatNumber(floor, lang)), value: counts?.untested, ghost: true },
  ];
  return (
    <div className="fh-ex-trend-key">
      <ul className="fh-ex-trend-classes" aria-label={k.classesLabel}>
        {rows.map((r) => (
          <li key={r.key} data-class={r.key}>
            <span className={`fh-ex-trend-swatch${r.ghost ? ' is-ghost' : ''}`} style={{ background: r.fill }} aria-hidden="true" />
            <span className="fh-ex-trend-label">{r.label}</span>
            <span className="fh-ex-trend-count ui-mono">{n(r.value)}</span>
          </li>
        ))}
      </ul>
      <p className="fh-ex-trend-why">{k.why}</p>
      <p className="fh-ex-trend-tested ui-mono">{counts ? k.tested(n(counts.tested), n(counts.hexagons), level) : '…'}</p>
    </div>
  );
}
