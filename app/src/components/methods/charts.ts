// Shared pieces of the Methods charts: the colours of the theme (read when a chart is drawn; PlotFigure draws again
// when the theme changes), the house tooltip, and the axis helpers. The dashboard's palette is the base, so a chart
// here and on the Dashboard look the same.
import * as Plot from '@observablehq/plot';
import { cssVar } from '../ui';
import { palette, tipLook, type Palette } from '../dashboard/chart';
import type { SensorId } from './eda';

export interface MethodsPalette extends Palette { terra: string; sensor: (id: SensorId) => string; textSize: number }

export function pal(): MethodsPalette {
  const p = palette();
  const terra = cssVar('--fh-terra', p.modisNight);
  const map: Record<SensorId, string> = { terra, aqua: p.modis, snpp: p.snpp, noaa20: p.noaa20, noaa21: p.noaa21 };
  return { ...p, terra, sensor: (id) => map[id], textSize: 12 };
}

/** The house tooltip box, with the title lines given. */
export const tip = (p: MethodsPalette) => tipLook(p);

/** Text marks keep a halo of the card colour, so a label never sits on a line unreadably. */
export const halo = (p: MethodsPalette) => ({ stroke: p.surface, strokeWidth: 3, paintOrder: 'stroke' as const });

/** Log axis ticks for MW: 0.1, 1, 10, 100, 1,000. */
export function mwTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let v = 10 ** Math.ceil(Math.log10(lo)); v <= hi * 1.0001; v *= 10) out.push(Number(v.toPrecision(3)));
  return out;
}
export const mwFormat = (v: number): string => (v >= 1000 ? `${(v / 1000).toLocaleString('en-GB')},000` : String(v));

/** The widest of some labels, in px, in the chart font (a canvas measure, so a margin fits its labels exactly). */
let measure: CanvasRenderingContext2D | null = null;
export function textWidth(texts: string[], font = '600 12px Inter, system-ui, sans-serif'): number {
  measure ??= typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!measure) return Math.max(0, ...texts.map((t) => t.length * 7));
  measure.font = font;
  return Math.ceil(Math.max(0, ...texts.map((t) => measure!.measureText(t).width)));
}

/** Grid lines in the hairline style (Plot's own grid is too strong on dark). */
export const gridY = (p: MethodsPalette, o: Plot.GridYOptions = {}) => Plot.gridY({ stroke: p.grid, strokeOpacity: 1, ...o });
export const gridX = (p: MethodsPalette, o: Plot.GridXOptions = {}) => Plot.gridX({ stroke: p.grid, strokeOpacity: 1, ...o });
