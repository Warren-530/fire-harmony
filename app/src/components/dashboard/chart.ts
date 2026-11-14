// Shared pieces of the dashboard charts: the colours (read from theme.css when a chart is drawn, because Plot needs
// real colours; PlotFigure draws again when the theme changes), the hairline grid and the tooltip in the house look.
import * as Plot from '@observablehq/plot';
import { cssVar } from '../ui';
import { pct } from './format';

export interface Palette {
  ink: string; ink2: string; muted: string; grid: string; baseline: string; band: string; surface: string; surface2: string;
  border: string; accent: string;
  accentText: string; modisText: string;   // the same hues, dark enough (light theme) or bright enough (dark) for text
  harmonized: string; modis: string; modisNight: string; snpp: string; noaa20: string; noaa21: string;
  naive: string; sumatra: string; borneo: string;   // one colour per meaning on every page (theme.css)
  ember: (step: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900) => string;
  anom: (name: 'b4' | 'b3' | 'b2' | 'b1' | '0' | 'r1' | 'r2' | 'r3' | 'r4') => string;
}

export function palette(): Palette {
  return {
    ink: cssVar('--text', '#e9ebee'),
    ink2: cssVar('--text-2', '#a9b1bd'),
    muted: cssVar('--text-3', '#727b89'),
    grid: cssVar('--grid', 'rgba(255, 255, 255, 0.07)'),
    baseline: cssVar('--baseline', 'rgba(255, 255, 255, 0.18)'),
    band: cssVar('--band', 'rgba(242, 243, 245, 0.12)'),
    surface: cssVar('--surface', '#0d1118'),
    surface2: cssVar('--surface-2', '#121822'),
    border: cssVar('--border-strong', 'rgba(255, 255, 255, 0.16)'),
    accent: cssVar('--accent', '#ff7a3d'),
    accentText: cssVar('--accent-strong', '#ff9a5c'),
    modisText: cssVar('--anom-b4', '#73b4ff'),
    harmonized: cssVar('--harmonized', '#f2f3f5'),
    modis: cssVar('--sensor-modis', '#4a93ec'),
    naive: cssVar('--fh-naive', '#e0619c'), sumatra: cssVar('--fh-sumatra', '#f0622a'), borneo: cssVar('--fh-borneo', '#8b7cf6'),
    modisNight: cssVar('--anom-b4', '#73b4ff'),
    snpp: cssVar('--sensor-snpp', '#e8693a'),
    noaa20: cssVar('--sensor-noaa20', '#22b984'),
    noaa21: cssVar('--sensor-noaa21', '#e2a51a'),
    ember: (step) => cssVar(`--ember-${step}`, '#e75623'),
    anom: (name) => cssVar(`--anom-${name}`, '#262a31'),
  };
}

/** The hairline horizontal grid. */
export function hgrid(p: Palette, options: Plot.GridYOptions = {}): Plot.Markish {
  return Plot.gridY({ stroke: p.grid, strokeOpacity: 1, strokeWidth: 1, ...options });
}

/** The hairline vertical grid. */
export function vgrid(p: Palette, options: Plot.GridXOptions = {}): Plot.Markish {
  return Plot.gridX({ stroke: p.grid, strokeOpacity: 1, strokeWidth: 1, ...options });
}

/** Tooltip box options in the house look (raised surface, hairline border; the text colour comes from CSS). */
export function tipLook(p: Palette): { fill: string; stroke: string; textPadding: number; fontSize: number; lineHeight: number } {
  return { fill: p.surface2, stroke: p.border, textPadding: 9, fontSize: 12, lineHeight: 1.2 };
}

/** The value of a CSS variable, for marks in plain SVG or HTML (where var() works directly). */
export const cv = (name: string): string => `var(${name})`;

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** A new SVG element with attributes (for custom render marks). */
export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Ranked bars with the name above each bar, so long names never squeeze the bars (used for model inputs). A name
 *  wider than the chart ends in an ellipsis; the tooltip and the table view give it in full. */
export function importanceMarks(items: { name: string; pct: number }[], colour: string, p: Palette, width = 640): Plot.PlotOptions {
  const max = Math.max(...items.map((f) => f.pct));
  return {
    height: items.length * 33 + 8, marginLeft: 0, marginRight: 8, marginTop: 4, marginBottom: 4,
    x: { domain: [0, max * 1.14], axis: null },
    y: { domain: items.map((f) => f.name), axis: null, padding: 0 },
    marks: [
      Plot.barX(items, { x: 'pct', y: 'name', fill: colour, insetTop: 18, insetBottom: 5, rx2: 3 }),
      Plot.ruleX([0], { stroke: p.baseline, insetTop: 18 }),
      Plot.text(items, { x: 0, y: 'name', text: 'name', textAnchor: 'start', dy: -7, fill: p.ink, fontSize: 12,
        lineWidth: Math.max(8, (width - 8) / 12), textOverflow: 'ellipsis' }),
      Plot.text(items, { x: 'pct', y: 'name', text: (f: { pct: number }) => pct(f.pct, 1), textAnchor: 'start', dx: 6, dy: 7, fill: p.ink2, fontSize: 11 }),
      Plot.tip(items, Plot.pointerY({ x: 'pct', y: 'name', ...tipLook(p), title: (f: { name: string; pct: number }) => `${f.name}\n${pct(f.pct, 1)} of the gain` })),
    ],
  };
}
