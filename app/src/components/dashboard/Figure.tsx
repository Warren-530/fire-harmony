// A chart of the dashboard (the same look and table view, FigureTableView, as PlotFigure in ui.tsx) that also
// - cross fades from the old chart to the new one when its numbers change (a new place, years or months), so the
//   change reads as a change and the layout stays where it is (instant under reduced motion);
// - tells its parent the drawn chart (onChart), so a linked mark can be added on top without drawing it again
//   (the year under the pointer in another chart), and what is under the pointer (onPoint).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Plot from '@observablehq/plot';
import { useTheme } from '../../lib/theme';
import { FigureTableView, plotTheme, type FigureTable } from '../ui';

const reduceMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export type PlotChart = (SVGSVGElement | HTMLElement) & Plot.Plot;

export function Figure({ title, subtitle, source, build, table, height = 280, deps = [], onChart, onPoint, busy = false, badge }: {
  title: ReactNode; subtitle?: ReactNode; source?: string; build: (width: number) => Plot.PlotOptions; table?: FigureTable;
  height?: number; deps?: unknown[]; onChart?: (chart: PlotChart | null) => void; onPoint?: (value: unknown) => void;
  busy?: boolean; badge?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const theme = useTheme();
  const first = useRef(true);
  const point = useRef(onPoint);
  point.current = onPoint;
  const chartCb = useRef(onChart);
  chartCb.current = onChart;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let timer = 0;
    let current = 0;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      window.clearTimeout(timer);
      if (current === 0) { current = w; setWidth(w); return; }
      timer = window.setTimeout(() => { if (Math.abs(current - w) > 4) { current = w; setWidth(w); } }, 150);
    });
    ro.observe(el);
    return () => { window.clearTimeout(timer); ro.disconnect(); };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el || width < 50) return;
    const opts = build(width);
    const chart = Plot.plot(plotTheme(width, opts.height ?? height, opts)) as PlotChart;
    const onInput = () => point.current?.((chart as unknown as { value?: unknown }).value ?? null);
    chart.addEventListener('input', onInput);
    const old = Array.from(el.children) as HTMLElement[];
    if (!first.current && old.length && !reduceMotion()) {
      for (const o of old) { o.classList.add('db-fig-out'); window.setTimeout(() => o.remove(), 260); }
      chart.classList.add('db-fig-in');
      el.append(chart);
    } else {
      el.replaceChildren(chart);
    }
    first.current = false;
    chartCb.current?.(chart);
    return () => {
      chart.removeEventListener('input', onInput);
      chartCb.current?.(null);
      if (!el.contains(chart)) return;
      // the next chart fades in over this one; a chart that goes away for good leaves at once
      window.setTimeout(() => { if (!chart.classList.contains('db-fig-out')) chart.remove(); }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, theme, ...deps]);

  return (
    <figure className={busy ? 'ui-figure db-figure is-busy' : 'ui-figure db-figure'} aria-busy={busy || undefined}>
      <figcaption className="ui-figure-head">
        <p className="ui-figure-title">{title}{badge}</p>
        {subtitle ? <p className="ui-figure-subtitle">{subtitle}</p> : null}
      </figcaption>
      <div ref={box} className="ui-figure-plot db-figure-plot" style={{ minHeight: height }} />
      {source || table ? (
        <div className="ui-figure-foot">
          {source ? <p className="ui-figure-source">{source}</p> : <span />}
          {table ? <FigureTableView table={table} /> : null}
        </div>
      ) : null}
    </figure>
  );
}

/** The SVG of a drawn chart (Plot gives a figure element when the chart has a legend). */
export const svgOf = (chart: PlotChart | null): SVGSVGElement | null =>
  !chart ? null : chart instanceof SVGSVGElement ? chart : chart.querySelector('svg');

/** A position on a scale of a drawn chart, or null outside it. */
export function scaleAt(chart: PlotChart | null, name: 'x' | 'y', v: number): number | null {
  if (!chart) return null;
  try {
    const s = chart.scale(name) as { apply?: (v: number) => number } | undefined;
    const r = s?.apply?.(v);
    return typeof r === 'number' && Number.isFinite(r) ? r : null;
  } catch { return null; }
}
