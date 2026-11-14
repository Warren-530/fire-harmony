// Shared building blocks of every page (see DESIGN.md). Styles in styles/ui.css.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import * as Plot from '@observablehq/plot';
import { useTheme } from '../lib/theme';
import { Tooltip } from './Tooltip';
import { afterPanelResize, panelResizing } from './explorer/panelSize';

export { Tooltip } from './Tooltip';
export { ScrollFade, useScrollEnds } from './ScrollFade';

export function Page({ children }: { children: ReactNode }) {
  return <div className="ui-page">{children}</div>;
}

/** The lead of a page: on a phone it shows two lines, with "More" for the rest, so a number is on the first screen. */
function Lead({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => { if (!open) setLong(el.scrollHeight > el.clientHeight + 2); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, children]);
  return (
    <div className="ui-lead-box">
      <p ref={ref} className="ui-lead" data-open={open ? '' : undefined}>{children}</p>
      {long || open ? (
        <button type="button" className="ui-lead-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Less' : 'More'}</button>
      ) : null}
    </div>
  );
}

export function PageHeader({ eyebrow, title, lead, actions, under }: {
  eyebrow?: string; title: string; lead?: ReactNode; actions?: ReactNode;
  under?: ReactNode;   // right under the title, before the lead (the Dashboard's scope on a phone)
}) {
  return (
    <header className="ui-page-header">
      {eyebrow ? <p className="ui-eyebrow">{eyebrow}</p> : null}
      {/* title and lead together, actions beside them: on a phone the actions wrap below the lead, not between */}
      <div className="ui-page-header-row">
        <div className="ui-page-header-text">
          <h1 className="ui-page-title">{title}</h1>
          {under ?? null}
          {lead ? <Lead>{lead}</Lead> : null}
        </div>
        {actions ? <div className="ui-actions">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Section({ id, title, subtitle, children }: { id?: string; title: string; subtitle?: ReactNode; children: ReactNode }) {
  const hid = useId();
  return (
    <section className="ui-section" id={id} aria-labelledby={hid}>
      <div className="ui-section-head">
        <h2 className="ui-section-title" id={hid}>{title}</h2>
        {subtitle ? <p className="ui-section-subtitle">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Grid({ cols = 2, wide = false, children }: { cols?: 2 | 3 | 4; wide?: boolean; children: ReactNode }) {
  return <div className={`ui-grid ${wide ? 'ui-grid-wide' : `ui-grid-${cols}`}`}>{children}</div>;
}

export function Stack({ gap = 12, children }: { gap?: number; children: ReactNode }) {
  return <div className="ui-stack" style={{ gap }}>{children}</div>;
}

export function Card({ title, subtitle, footer, tone, actions, children, className }: {
  title?: ReactNode; subtitle?: ReactNode; footer?: ReactNode; tone?: 'accent'; actions?: ReactNode; children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ui-card${tone === 'accent' ? ' ui-card-accent' : ''}${className ? ` ${className}` : ''}`}>
      {title || actions ? (
        <div className="ui-card-head">
          <div className="ui-card-titles">
            {title ? <h3 className="ui-card-title">{title}</h3> : null}
            {subtitle ? <p className="ui-card-subtitle">{subtitle}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children !== undefined ? <div className="ui-card-body">{children}</div> : null}
      {footer ? <div className="ui-card-footer">{footer}</div> : null}
    </div>
  );
}

export type DeltaDir = 'up' | 'down' | 'flat';

function Arrow({ dir }: { dir: DeltaDir }) {
  if (dir === 'flat') return <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5h8" stroke="currentColor" strokeWidth="2" /></svg>;
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <path d={dir === 'up' ? 'M5 1 9 8H1z' : 'M5 9 1 2h8z'} fill="currentColor" />
    </svg>
  );
}

export function Delta({ dir, text }: { dir: DeltaDir; text: string }) {
  return <span className={`ui-delta ui-delta-${dir}`}><Arrow dir={dir} />{text}</span>;
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="ui-stat-grid">{children}</div>;
}

export function StatTile({ label, value, unit, context, delta }: {
  label: string; value: ReactNode; unit?: string; context?: ReactNode; delta?: { dir: DeltaDir; text: string };
}) {
  return (
    <div className="ui-stat">
      <p className="ui-stat-label">{label}</p>
      <p className="ui-stat-value">{value}{unit ? <span className="ui-stat-unit">{unit}</span> : null}</p>
      {delta ? <Delta dir={delta.dir} text={delta.text} /> : null}
      {context ? <p className="ui-stat-context">{context}</p> : null}
    </div>
  );
}

export interface Column<R> {
  key: string;
  label: string;
  num?: boolean;                       // right aligned, tabular figures
  render?: (row: R) => ReactNode;      // default: String(row[key])
}

export function DataTable<R extends object>({ columns, rows, caption, rowKey }: {
  columns: Column<R>[]; rows: R[]; caption?: string; rowKey?: (row: R, i: number) => string;
}) {
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">
        {caption ? <caption>{caption}</caption> : null}
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={c.num ? 'ui-num' : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : i}>
              {columns.map((c, j) => {
                const v = c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '');
                return j === 0
                  ? <th key={c.key} scope="row" className={c.num ? 'ui-num' : undefined}>{v}</th>
                  : <td key={c.key} className={c.num ? 'ui-num' : undefined}>{v}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Segmented<V extends string>({ label, options, value, onChange, hideLabel }: {
  label: string; options: { value: V; label: string; title?: string }[]; value: V; onChange: (v: V) => void; hideLabel?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = options.findIndex((o) => o.value === value);
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const n = (i + step + options.length) % options.length;
    onChange(options[n].value);
    refs.current[n]?.focus();
  };
  return (
    <div className="ui-segmented">
      {hideLabel ? null : <span className="ui-segmented-label">{label}</span>}
      <div className="ui-segmented-options" role="radiogroup" aria-label={label} onKeyDown={onKey}>
        {options.map((o, i) => {
          const button = (
            <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={o.value === value}
              tabIndex={o.value === value ? 0 : -1} className="ui-segmented-option" onClick={() => onChange(o.value)}>
              {o.label}
            </button>
          );
          return o.title ? <Tooltip key={o.value} content={o.title}>{button}</Tooltip> : button;
        })}
      </div>
    </div>
  );
}

export type BadgeTone = 'neutral' | 'ember' | 'good' | 'warning' | 'serious' | 'critical';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="ui-note">{children}</p>;
}

export function Callout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ui-callout" role="note">
      <p className="ui-callout-title">{title}</p>
      <div className="ui-callout-body">{children}</div>
    </div>
  );
}

export function Skeleton({ height = 160 }: { height?: number }) {
  return <div className="ui-skeleton" style={{ height }} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------------------------- charts

/** Value of a CSS variable on the page (Plot needs real colours, not var(...)). */
export function cssVar(name: string, fallback = '#52514e'): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** The house look for Observable Plot: Inter, ink-2 text, hairline grid, no frame. */
export function plotTheme(width: number, height: number, options: Plot.PlotOptions): Plot.PlotOptions {
  return {
    width, height,
    marginTop: 12, marginRight: 24, marginBottom: 32, marginLeft: 48,
    ...options,
    style: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: '12px', color: cssVar('--ink-2'), background: 'transparent',
      overflow: 'visible', ...(typeof options.style === 'object' ? options.style : {}) },
  };
}

export interface FigureTable { columns: string[]; rows: (string | number)[][] }

/**
 * The scroller of a chart's table view. The table scrolls inside the card (down, and sideways when it is wide) with the
 * column names stuck on top; the bottom or right edge fades while there is more to see there. The card gives it its
 * width, never the table (styles/ui.css), so opening it never widens the card or the chart.
 */
export function TableScroll({ children, label = 'The numbers of the chart' }: { children: ReactNode; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let raf = 0;
    const update = () => {
      raf = 0;
      const down = el.scrollHeight - el.clientHeight - el.scrollTop > 1;
      const side = el.scrollWidth - el.clientWidth - Math.abs(el.scrollLeft) > 1;
      const more = `${down ? 'down' : ''}${down && side ? ' ' : ''}${side ? 'side' : ''}`;
      if ((el.dataset.more ?? '') !== more) el.dataset.more = more;
    };
    const onChange = () => { if (!raf) raf = requestAnimationFrame(update); };
    // (opened: once laid out, a frame later)
    const details = el.closest('details');
    const onToggle = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { raf = requestAnimationFrame(update); }); };
    el.addEventListener('scroll', onChange, { passive: true });
    details?.addEventListener('toggle', onToggle);
    const ro = new ResizeObserver(onChange);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    onChange();
    return () => { cancelAnimationFrame(raf); el.removeEventListener('scroll', onChange); details?.removeEventListener('toggle', onToggle); ro.disconnect(); };
  }, []);
  // (a box that scrolls takes the keyboard focus, so it can be scrolled without a mouse; a group, not a landmark: a
  // page has many of them)
  return <div ref={ref} className="ui-table-wrap ui-table-scroll" tabIndex={0} role="group" aria-label={label}>{children}</div>;
}

/** "Show the numbers": the table view under a chart. Open, it takes a row of its own under the source line. */
export function FigureTableView({ table }: { table: FigureTable }) {
  return (
    <details className="ui-figure-table">
      <summary>Show the numbers</summary>
      <TableScroll>
        <table className="ui-table">
          <thead><tr>{table.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
          <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => (j === 0
            ? <th key={j} scope="row">{v}</th> : <td key={j} className="ui-num">{v}</td>))}</tr>)}</tbody>
        </table>
      </TableScroll>
    </details>
  );
}

/**
 * A chart in the house style. `build(width)` returns Plot options (marks, scales, height...). The figure has a title
 * that states the finding, a subtitle with what is plotted, a source line and a "Show the numbers" table view.
 */
export function PlotFigure({ title, subtitle, source, build, table, height = 280, deps = [] }: {
  title: ReactNode; subtitle?: ReactNode; source?: string; build: (width: number) => Plot.PlotOptions;
  table?: FigureTable; height?: number; deps?: unknown[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const theme = useTheme();
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // the first width at once (no blank chart), later changes after the layout settles (a scroll bar appearing
    // on load used to redraw every chart a moment after the first draw)
    let timer = 0;
    let current = 0;
    // (a drag of the Explorer panel's edge: the chart is drawn once, when it ends)
    const settle = (w: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (!panelResizing() && Math.abs(current - w) > 4) { current = w; setWidth(w); } }, 150);
    };
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      window.clearTimeout(timer);
      if (current === 0) { current = w; setWidth(w); return; }
      settle(w);
    });
    ro.observe(el);
    const off = afterPanelResize(() => settle(Math.round(el.getBoundingClientRect().width)));
    return () => { window.clearTimeout(timer); ro.disconnect(); off(); };
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el || width < 50) return;
    const opts = build(width);
    const chart = Plot.plot(plotTheme(width, opts.height ?? height, opts));
    el.replaceChildren(chart);
    return () => chart.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, theme, ...deps]);
  return (
    <figure className="ui-figure">
      <figcaption className="ui-figure-head">
        <p className="ui-figure-title">{title}</p>
        {subtitle ? <p className="ui-figure-subtitle">{subtitle}</p> : null}
      </figcaption>
      <div ref={box} className="ui-figure-plot" style={{ minHeight: height }} />
      {source || table ? (
        <div className="ui-figure-foot">
          {source ? <p className="ui-figure-source">{source}</p> : <span />}
          {table ? <FigureTableView table={table} /> : null}
        </div>
      ) : null}
    </figure>
  );
}
