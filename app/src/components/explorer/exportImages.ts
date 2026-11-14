// Pictures for a report, made from the data (not from the screen), so they work whichever tab is open:
// the burning calendar (drawn on a canvas, same colours as the panel) and the yearly chart (Observable Plot to SVG,
// then to a canvas). Both carry a title, a subtitle and the source line, in the colours of the current theme.
import * as Plot from '@observablehq/plot';
import { FIRST_YEAR } from '../../lib/config';
import { formatTimes, type Dict, type Lang } from '../../lib/i18n';
import { climatology, countClass, countScale, criticalMonths, modelledWithoutModis, monthRuns, ratioClass, ratioLimit, valueOf, STEPS } from '../../lib/stats';
import type { ColourMode, MonthlyPoint } from '../../lib/types';
import { ANOMALY_VARS, EMBER_VARS, countTicks5 } from '../Legend';
import { cssVar, plotTheme } from '../ui';
import type { YearlyChart } from '../SeriesChart';

/** File name part of a place name: "Kalimantan Tengah, Indonesia" → "kalimantan_tengah_indonesia". */
export function slug(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'area';
}

/** Save a blob as a file (a link click; the URL is released a little later). */
export function saveBlob(blob: Blob, file: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const SCALE = 2;   // pixels per CSS pixel in the pictures
const FONT = 'Inter, system-ui, sans-serif';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = Math.round(w * SCALE);
  c.height = Math.round(h * SCALE);
  const g = c.getContext('2d');
  if (!g) throw new Error('no canvas');
  g.scale(SCALE, SCALE);
  return { c, g };
}

function toPng(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('png'))), 'image/png'));
}

function heading(g: CanvasRenderingContext2D, title: string, subtitle: string, pad: number, width: number): number {
  g.fillStyle = cssVar('--text', '#0b0b0b');
  g.font = `600 17px ${FONT}`;
  g.fillText(title, pad, pad + 14, width - 2 * pad);
  g.fillStyle = cssVar('--text-2', '#52514e');
  g.font = `13px ${FONT}`;
  g.fillText(subtitle, pad, pad + 36, width - 2 * pad);
  return pad + 56;
}

export interface CalendarPicture {
  points: readonly MonthlyPoint[];   // on the chosen scale (h holds the value)
  mode: ColourMode;
  title: string;
  subtitle: string;
  legendTitle: string;
  source: string;
  t: Dict;
  lang: Lang;
}

/** The burning calendar as a PNG: years down, months across, the colour bar and the source line. */
export async function calendarPng(o: CalendarPicture & { critical?: boolean }): Promise<Blob> {
  const own = o.points.filter((p) => p.yr >= FIRST_YEAR);
  const years = [...new Set(own.map((p) => p.yr))].sort((a, b) => a - b);
  const byKey = new Map(own.map((p) => [p.yr * 100 + p.mo, p]));
  const normals = climatology(o.points, 'harmonized').map((n) => n.median);
  const cScale = countScale(own.map((p) => valueOf(p, 'harmonized')));
  const limit = ratioLimit(own.map((p) => [valueOf(p, 'harmonized'), normals[p.mo - 1] ?? null] as const));
  const ember = EMBER_VARS.map((v) => cssVar(v)), anom = ANOMALY_VARS.map((v) => cssVar(v));
  const zero = cssVar('--anom-0'), text2 = cssVar('--text-2'), text3 = cssVar('--text-3'), bg = cssVar('--surface', '#ffffff');
  const W = 860, pad = 28, left = 52, cellH = 16, gap = 2;
  const cellW = Math.floor((W - 2 * pad - left) / 12);
  const top0 = pad + 56;
  const gridTop = top0 + 18;
  const barTop = gridTop + years.length * cellH + 26;
  const H = barTop + 62 + pad;
  const { c, g } = canvas(W, H);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  heading(g, o.title, o.subtitle, pad, W);

  // hatching for months without data yet
  const tile = document.createElement('canvas');
  tile.width = 6 * SCALE; tile.height = 6 * SCALE;
  const tg = tile.getContext('2d');
  if (tg) {
    tg.scale(SCALE, SCALE);
    tg.fillStyle = bg; tg.fillRect(0, 0, 6, 6);
    tg.strokeStyle = text3; tg.lineWidth = 1;
    tg.beginPath(); tg.moveTo(0, 6); tg.lineTo(6, 0); tg.stroke();
  }
  const hatch = tg ? g.createPattern(tile, 'repeat') : null;
  hatch?.setTransform(new DOMMatrix().scale(1 / SCALE));
  // stripes over a modelled month MODIS saw no fire in
  const stripe = document.createElement('canvas');
  stripe.width = 6 * SCALE; stripe.height = 6 * SCALE;
  const sg = stripe.getContext('2d');
  if (sg) {
    sg.scale(SCALE, SCALE);
    sg.strokeStyle = cssVar('--text', '#0b0b0b'); sg.globalAlpha = 0.55; sg.lineWidth = 1.4;
    sg.beginPath(); sg.moveTo(0, 0); sg.lineTo(6, 6); sg.stroke();
  }
  const stripes = sg ? g.createPattern(stripe, 'repeat') : null;
  stripes?.setTransform(new DOMMatrix().scale(1 / SCALE));
  let anyModelled = false;

  g.font = `11px ${FONT}`;
  g.fillStyle = text2;
  g.textAlign = 'center';
  o.t.common.monthsShort.forEach((m, i) => g.fillText(m, pad + left + i * cellW + cellW / 2, top0 + 10));
  g.textAlign = 'right';
  years.forEach((yr, r) => {
    const y = gridTop + r * cellH;
    g.fillStyle = text2;
    g.fillText(String(yr), pad + left - 8, y + cellH - 4);
    for (let mo = 1; mo <= 12; mo++) {
      const p = byKey.get(yr * 100 + mo);
      if (!p) continue;
      const v = valueOf(p, 'harmonized');
      let fill: string | CanvasPattern = zero;
      if (v === null) fill = hatch ?? text3;
      else if (o.mode === 'count') {
        const k = cScale ? countClass(v, cScale) : -1;
        fill = k < 0 ? zero : ember[k];
      } else {
        const k = ratioClass(v, normals[mo - 1] ?? null, limit);
        fill = k === null ? zero : anom[k];
      }
      g.fillStyle = fill;
      g.beginPath();
      g.roundRect(pad + left + (mo - 1) * cellW + gap / 2, y + gap / 2, cellW - gap, cellH - gap, 2);
      g.fill();
      if (stripes && modelledWithoutModis(p)) { anyModelled = true; g.fillStyle = stripes; g.fill(); }
    }
  });
  // the critical period (the months above the 75th percentile in at least half of the years): an outline per run
  const runs = o.critical === false ? [] : monthRuns(criticalMonths(o.points, 'harmonized'));
  if (runs.length && years.length) {
    g.strokeStyle = cssVar('--text', '#0b0b0b');
    g.lineWidth = 1.6;
    const spans = runs.flatMap(([a, b]) => (a <= b ? [[a, b]] : [[a, 12], [1, b]]));
    for (const [a, b] of spans) {
      g.beginPath();
      g.roundRect(pad + left + (a - 1) * cellW - 1, gridTop - 1, (b - a + 1) * cellW + 2, years.length * cellH + 2, 4);
      g.stroke();
    }
  }

  // colour bar
  const barW = 320, barX = pad + left;
  g.textAlign = 'left';
  g.fillStyle = text2;
  g.font = `600 12px ${FONT}`;
  g.fillText(o.legendTitle, barX, barTop);
  const colours = o.mode === 'count' ? ember : anom;
  const step = barW / STEPS;
  colours.forEach((col, i) => { g.fillStyle = col; g.fillRect(barX + i * step, barTop + 8, step + 0.5, 10); });
  g.font = `11px ${FONT}`;
  g.fillStyle = text2;
  // four or five ticks: both ends and round values between them (as the full calendar's legend), or the ratios
  const root = Math.sqrt(limit);
  const ticks = o.mode === 'count'
    ? countTicks5(cScale ?? { lo: 1, hi: 10 }, o.lang)
    : [{ at: 0, label: formatTimes(1 / limit, o.lang) }, { at: 0.25, label: formatTimes(1 / root, o.lang) },
      { at: 0.5, label: o.t.explorer.normalLabel }, { at: 0.75, label: formatTimes(root, o.lang) }, { at: 1, label: formatTimes(limit, o.lang) }];
  for (const tk of ticks) {
    g.textAlign = tk.at <= 0 ? 'left' : tk.at >= 1 ? 'right' : 'center';
    g.fillText(tk.label, barX + tk.at * barW, barTop + 32);
    g.fillRect(barX + tk.at * barW - (tk.at >= 1 ? 1 : tk.at <= 0 ? 0 : 0.5), barTop + 18, 1, 3);
  }
  g.textAlign = 'left';
  // the keys beside the bar: no data yet, modelled with no MODIS fire, the critical period
  let sw = barX + barW + 28;
  const key = (draw: () => void, label: string) => {
    draw();
    g.fillStyle = text2;
    g.fillText(label, sw + 20, barTop + 17);
    sw += 20 + g.measureText(label).width + 22;
  };
  if (hatch) key(() => { g.fillStyle = hatch; g.fillRect(sw, barTop + 8, 14, 10); }, o.t.explorer.noDataYet);
  if (anyModelled && stripes) {
    key(() => { g.fillStyle = ember[2]; g.fillRect(sw, barTop + 8, 14, 10); g.fillStyle = stripes; g.fillRect(sw, barTop + 8, 14, 10); },
      o.t.calendar.modelledNone);
  }
  if (runs.length) {
    key(() => { g.strokeStyle = cssVar('--text', '#0b0b0b'); g.lineWidth = 1.4; g.strokeRect(sw + 0.7, barTop + 8.7, 12.6, 8.6); },
      o.t.calendar.full.critical);
  }
  g.fillStyle = cssVar('--text-3', '#7d7c76');
  g.fillText(o.source, pad, H - pad + 8);
  return toPng(c);
}

// An SVG drawn as an image cannot see the page's web fonts, so the chart's own text (ticks, labels) would fall back to
// another sans. The picture carries Inter inside it instead, as data URLs (read once).
const EMBED_FONTS = [{ file: 'Inter-Regular.woff2', weight: 400 }, { file: 'Inter-SemiBold.woff2', weight: 600 }];
let embedded: Promise<string> | null = null;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The @font-face rules of Inter with the fonts inside (empty when they cannot be read: the picture still works). */
export function embeddedFontCss(): Promise<string> {
  if (!embedded) {
    const base = import.meta.env.BASE_URL ?? '/';
    embedded = Promise.all(EMBED_FONTS.map(async (f) => {
      const r = await fetch(`${base}fonts/${f.file}`);
      if (!r.ok) throw new Error(f.file);
      return `@font-face{font-family:"Inter";font-weight:${f.weight};src:url(data:font/woff2;base64,${toBase64(await r.arrayBuffer())}) format("woff2");}`;
    })).then((rules) => rules.join(''), () => { embedded = null; return ''; });
  }
  return embedded;
}

/** The yearly chart as a PNG (rendered off screen with the same options as the page, in Inter). */
export async function chartPng(chart: YearlyChart, width = 820): Promise<Blob> {
  const opts = chart.build(width);
  const height = opts.height ?? 290;
  const el = Plot.plot(plotTheme(width, height, opts));
  const svg = (el instanceof SVGSVGElement ? el : el.querySelector('svg')) as SVGSVGElement | null;
  if (!svg) throw new Error('no chart');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  const fonts = await embeddedFontCss();
  if (fonts) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `${fonts}svg,text{font-family:Inter,sans-serif}`;
    svg.insertBefore(style, svg.firstChild);
  }
  const text = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  await img.decode();
  const pad = 28;
  // under the subtitle: the line of the year so far, then the keys (the compare colours, the hollow dot of the year)
  const extra = (chart.note ? 20 : 0) + (chart.keys.length ? 24 : 0);
  const W = width + 2 * pad, H = height + pad + 56 + extra + 40;
  const { c, g } = canvas(W, H);
  g.fillStyle = cssVar('--surface', '#ffffff');
  g.fillRect(0, 0, W, H);
  let top = heading(g, chart.title, chart.subtitle, pad, W);
  if (chart.note) {
    g.fillStyle = cssVar('--text', '#0b0b0b');
    g.font = `600 13px ${FONT}`;
    g.fillText(chart.note, pad, top + 2, W - 2 * pad);
    top += 20;
  }
  if (chart.keys.length) {
    let x = pad;
    const y = top + 8;
    g.font = `12px ${FONT}`;
    for (const k of chart.keys) {
      const w = g.measureText(k.label).width;
      if (x + 26 + w > W - pad) break;
      g.globalAlpha = k.opacity;
      g.strokeStyle = k.colour;
      g.lineWidth = k.width;
      g.lineCap = 'round';
      if (k.shape === 'dot') {
        g.fillStyle = cssVar('--surface', '#ffffff');
        g.beginPath(); g.arc(x + 9, y, 4, 0, Math.PI * 2); g.fill(); g.stroke();
      } else {
        g.beginPath(); g.moveTo(x + (k.shape === 'tick' ? 4 : 1), y); g.lineTo(x + (k.shape === 'tick' ? 14 : 17), y); g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = cssVar('--text-2', '#52514e');
      g.fillText(k.label, x + 24, y + 4);
      x += 24 + w + 18;
    }
    top += 24;
  }
  g.drawImage(img, pad, top, width, height);
  g.fillStyle = cssVar('--text-3', '#7d7c76');
  g.font = `11px ${FONT}`;
  g.fillText(chart.source, pad, H - pad + 8);
  return toPng(c);
}
