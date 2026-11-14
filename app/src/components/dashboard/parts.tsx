// Small pieces of the analytics dashboard that the shared building blocks do not cover: links into the Explorer,
// ranked lists with inline bars, the months of the fire season as letters, the "against normal" chip, legend keys,
// a sortable table, and the loading and error states. Styles in styles/dashboard.css (classes start with db-).
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { openArea } from '../../lib/commands';
import { Skeleton } from '../ui';
import { Tooltip } from '../Tooltip';
import { useFocus } from './useScope';
import { IconArrowDown, IconArrowUp, IconChevronDown, IconChevronRight, IconChevronUp, IconInfo, IconMinus } from '../icons';
import { anomalyVar, explorerHref, MONTH_LETTERS, monthName, ratioNum, type Tone } from './format';

// ---------------------------------------------------------------------------------------------- links
/** A click on a link into the Explorer: new tab and new window clicks stay native, a plain click uses openArea. */
export function followArea(e: MouseEvent<HTMLAnchorElement>, kind: string, id: string): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  openArea(kind, id);
}

/** A place name that opens the place in the Explorer. With `stretch`, the whole row around it is the link. */
export function AreaLink({ kind, id, children, stretch = false, label }: {
  kind: string; id: string; children: ReactNode; stretch?: boolean; label?: string;
}) {
  return (
    <a className={stretch ? 'db-link db-stretch' : 'db-link'} href={explorerHref(kind, id)} onClick={(e) => followArea(e, kind, id)}
      aria-label={label}>
      <span className="db-link-text">{children}</span>
      <IconChevronRight className="db-link-icon" size={14} />
    </a>
  );
}

export function PageLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="db-link db-link-page" href={href}><span className="db-link-text">{children}</span><IconChevronRight className="db-link-icon" size={14} /></a>;
}

/** Text in which official names with a hyphen (NOAA-20, MERRA-2) never break across two lines. */
export function keepNames(text: string): ReactNode {
  const parts = text.split(/(NOAA-2[01]|MERRA-2)/);
  return parts.length === 1 ? text : parts.map((x, i) => (i % 2 ? <span key={i} className="db-nowrap">{x}</span> : x));
}

// ---------------------------------------------------------------------------------------------- ranked list
export interface RankItem {
  key: string;
  kind?: string; id?: string;   // when set, the whole row opens the area in the Explorer
  name: string;
  detail?: ReactNode;
  value: ReactNode;
  frac: number;                 // bar length, 0 to 1
  tick?: number | null;         // a reference mark on the bar, 0 to 1 (for example the normal chance)
  colour?: string;              // a CSS variable name for this bar (default: the list colour)
  linkLabel?: string;           // what a screen reader hears for the row link
}

/** A numbered list with an inline bar per row. Every number is printed, so it needs no table view. */
export function RankList({ items, colour, label, start = 1, tickLabel, columns = 1 }: {
  items: RankItem[]; colour: string; label: string; start?: number; tickLabel?: string; columns?: 1 | 2;
}) {
  return (
    <ol className={columns === 2 ? 'db-rank db-rank-2col' : 'db-rank'} aria-label={label} start={start}
      style={{ '--db-bar': `var(${colour})`, '--db-rows': Math.ceil(items.length / columns) } as CSSProperties}>
      {items.map((it, i) => (
        <li key={it.key} className={it.kind && it.id ? 'db-rank-row is-link' : 'db-rank-row'}
          style={it.colour ? ({ '--db-bar': `var(${it.colour})` } as CSSProperties) : undefined}>
          <span className="db-rank-n ui-mono" aria-hidden="true">{String(start + i).padStart(2, '0')}</span>
          <span className="db-rank-main">
            <span className="db-rank-name">
              {it.kind && it.id
                ? <AreaLink kind={it.kind} id={it.id} stretch label={it.linkLabel}>{it.name}</AreaLink>
                : it.name}
            </span>
            {it.detail ? <span className="db-rank-detail">{it.detail}</span> : null}
          </span>
          <span className="db-rank-track" aria-hidden="true">
            <span className="db-rank-fill" style={{ '--db-frac': Math.max(0.004, Math.min(1, it.frac)) } as CSSProperties} />
            {it.tick !== undefined && it.tick !== null
              ? <span className="db-rank-tick" data-label={tickLabel} style={{ left: `calc(${Math.max(0, Math.min(1, it.tick)) * 100}% - 1px)` }} />
              : null}
          </span>
          <span className="db-rank-value ui-mono">{it.value}</span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------------------------- months and ratios
/** The 12 months as letters, the critical ones (the usual fire season peak) lit in ember. */
export function MonthLetters({ months }: { months: number[] }) {
  const label = months.length ? `Fire season peak: ${months.map(monthName).join(', ')}` : 'No month stands out';
  const f = useFocus();   // the month under the pointer in the normal year chart
  return (
    <span className="db-months" role="img" aria-label={label}>
      {MONTH_LETTERS.map((l, i) => (
        <span key={i} className={`${months.includes(i + 1) ? 'db-month db-month-on' : 'db-month'}${f.mo === i + 1 ? ' is-focus' : ''}`} aria-hidden="true">{l}</span>
      ))}
    </span>
  );
}

/** "0.93 times" with a chip in the anomaly colour of the ratio (the same bins as the Explorer map). */
export function AgainstNormal({ ratio, long = false }: { ratio: number | null; long?: boolean }) {
  if (ratio === null || !Number.isFinite(ratio)) return <span className="db-muted">No data</span>;
  return (
    <span className="db-anom">
      <span className="db-chip" style={{ background: `var(${anomalyVar(ratio)})` }} aria-hidden="true" />
      <span className="ui-mono">{ratioNum(ratio)}</span>{long ? ' times normal' : ' times'}
    </span>
  );
}

/** A trend as an arrow and a word ("Rising", "Falling", "No clear trend"). */
export function TrendMark({ tone, word, value, unit }: { tone: Tone; word: string; value?: string; unit?: string }) {
  const Icon = tone === 'up' ? IconArrowUp : tone === 'down' ? IconArrowDown : IconMinus;
  return (
    <span className={`db-trendmark db-trend-${tone}`}>
      <Icon size={14} />
      {value ? <span className="ui-mono db-trendmark-value">{value}</span> : null}
      {unit ? <span className="db-only-sm db-trendmark-unit">{unit}</span> : null}
      <span className="db-trendmark-word">{word}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------- legend keys
export interface KeyItem { label: string; colour: string; shape?: 'line' | 'dot' | 'box' | 'band'; opacity?: number; open?: boolean }

/** A legend above a chart. The key mirrors the mark: a line for lines, a dot for dots, a box for bars. */
export function Keys({ items }: { items: KeyItem[] }) {
  return (
    <span className="db-keys">
      {items.map((k) => (
        <span key={k.label} className="db-key">
          <span className={`db-key-mark db-key-${k.shape ?? 'line'}${k.open ? ' db-key-open' : ''}`}
            style={{ '--db-key': k.colour, opacity: k.opacity ?? 1 } as CSSProperties} aria-hidden="true" />
          {k.label}
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------- sortable table
export interface SortColumn<R> {
  key: string;
  label: string;
  num?: boolean;                         // right aligned, tabular figures
  sort?: (row: R) => number | string;    // sortable when given
  first?: 'asc' | 'desc';                // the first direction on click (numbers: high to low)
  render: (row: R) => ReactNode;
  hideBelow?: number;                    // hidden in the phone layout (rows become cards)
  className?: string;
  help?: string;                         // how to read the column, in the tooltip of its header
}

export type SortState = { key: string; dir: 'asc' | 'desc' };

/** A table whose column headers sort it (click, Enter or Space; aria-sort tells screen readers the order). On phones
 *  every row becomes a small card with the column names as labels. */
export function SortableTable<R>({ columns, rows, rowKey, caption, sort, onSort, empty, rowClass, onRowClick, className, rowHeader }: {
  columns: SortColumn<R>[]; rows: R[]; rowKey: (r: R) => string; caption?: string; sort: SortState;
  onSort: (s: SortState) => void; empty?: ReactNode; rowClass?: (r: R) => string | undefined;
  onRowClick?: (r: R) => void;   // a click anywhere on the row (the row's own link still works by keyboard)
  className?: string;
  rowHeader?: string;            // the key of the column that names the row (default: the first column)
}) {
  const headKey = rowHeader ?? columns[0]?.key;
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const f = col.sort;
    const k = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = f(a), vb = f(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * k;
      return String(va).localeCompare(String(vb)) * k;
    });
  }, [columns, rows, sort]);
  const click = (c: SortColumn<R>) => {
    if (!c.sort) return;
    if (sort.key === c.key) onSort({ key: c.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    else onSort({ key: c.key, dir: c.first ?? (c.num ? 'desc' : 'asc') });
  };
  return (
    <div className={className ? `ui-table-wrap db-sort-wrap ${className}` : 'ui-table-wrap db-sort-wrap'}>
      <table className="ui-table db-sort-table">
        {caption ? <caption className="db-sr">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort.key === c.key;
              const aria = !c.sort ? undefined : active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
              const cls = [c.num ? 'ui-num' : '', c.className ?? ''].filter(Boolean).join(' ') || undefined;
              return (
                <th key={c.key} scope="col" className={cls} aria-sort={aria}>
                  {c.sort ? (
                    <Tooltip content={c.help ? `${c.help} Press to sort.` : `Sort by ${c.label.toLowerCase()}`}>
                      <button type="button" className={active ? 'db-sort-btn is-active' : 'db-sort-btn'} onClick={() => click(c)}>
                        <span>{c.label}</span>
                        <span className="db-sort-icon" aria-hidden="true">
                          {active ? (sort.dir === 'asc' ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />) : <IconChevronDown size={13} />}
                        </span>
                      </button>
                    </Tooltip>
                  ) : <span className="db-th-plain">{c.label}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)} className={[rowClass?.(r), onRowClick ? 'is-link' : ''].filter(Boolean).join(' ') || undefined}
              onClick={onRowClick ? (e) => {
                if ((e.target as HTMLElement).closest('a, button, input, summary')) return;   // the link handles its own click
                if (window.getSelection()?.toString()) return;                                // selecting text is not a click
                onRowClick(r);
              } : undefined}>
              {columns.map((c) => {
                const cls = [c.num ? 'ui-num' : '', c.className ?? ''].filter(Boolean).join(' ') || undefined;
                return c.key === headKey
                  ? <th key={c.key} scope="row" className={cls} data-label={c.label}>{c.render(r)}</th>
                  : <td key={c.key} className={cls} data-label={c.label}>{c.render(r)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 && empty ? <div className="db-empty">{empty}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- small blocks
/** The width of an element, kept up to date (for pictures drawn in pixels, such as a sparkline). */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(Math.round(e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** A thin horizontal meter, 0 to 1, with an optional reference tick. */
export function Meter({ value, tick, colour = '--accent', label }: { value: number; tick?: number; colour?: string; label: string }) {
  return (
    <span className="db-meter" role="img" aria-label={label} style={{ '--db-bar': `var(${colour})` } as CSSProperties}>
      <span className="db-meter-fill" style={{ '--db-frac': Math.max(0, Math.min(1, value)) } as CSSProperties} />
      {tick !== undefined ? <span className="db-meter-tick" style={{ left: `calc(${Math.max(0, Math.min(1, tick)) * 100}% - 1px)` }} /> : null}
    </span>
  );
}

/** One line of help next to a number: an info icon with the text in a tooltip, also read by screen readers. */
export function Hint({ text }: { text: string }) {
  return (
    <Tooltip content={text}>
      <span className="db-hint" tabIndex={0} role="note" aria-label={text}>
        <IconInfo size={14} />
      </span>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------------------------- states
export function DashboardSkeleton() {
  return (
    <div className="db-skeleton" role="status" aria-live="polite">
      <span className="db-sr">Loading the dashboard…</span>
      <div className="db-skeleton-nav" aria-hidden="true"><Skeleton height={44} /></div>
      <div className="db-glance-grid" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={i === 0 || i === 5 ? 'db-g db-g-wide' : 'db-g'}>
            <div className="ui-stat">
              <Skeleton height={14} />
              <Skeleton height={34} />
              <Skeleton height={40} />
            </div>
          </div>
        ))}
      </div>
      <div className="db-row db-row-8-4" aria-hidden="true">
        <div className="ui-card"><Skeleton height={300} /></div>
        <div className="ui-card"><Skeleton height={300} /></div>
      </div>
    </div>
  );
}

export function DashboardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="db-error" role="alert">
      <span className="db-error-icon" aria-hidden="true"><IconInfo size={22} /></span>
      <div className="db-error-body">
        <p className="db-error-title">The numbers could not be loaded</p>
        <p>The dashboard reads one small file of statistics, and it did not arrive. Check your connection and try again.</p>
        <details>
          <summary>Details</summary>
          <code>{message}</code>
        </details>
        <button type="button" className="ui-btn ui-btn-primary" onClick={onRetry}>Try again</button>
      </div>
    </div>
  );
}
