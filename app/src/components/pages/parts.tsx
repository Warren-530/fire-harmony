// Small parts shared by the Methods, Data and Haze pages: links into the Explorer, a soft error with a retry,
// cell labels for stacked tables, lists of facts, and the bar of the record's months by source.
import type { MouseEvent, ReactNode } from 'react';
import { openArea } from '../../lib/commands';
import { addMonths, monthName, yearOf } from './format';
import type { Period } from './record';

/** A link that opens a named area in the Explorer ("#/?area=state:IDN-1931"). */
export function AreaLink({ kind, id, className = 'fh-pg-link', children }: {
  kind: string; id: string; className?: string; children: ReactNode;
}) {
  const href = `#/?area=${encodeURIComponent(kind)}:${encodeURIComponent(id)}`;
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // a new tab keeps working
    e.preventDefault();
    openArea(kind, id);
  };
  return <a className={className} href={href} onClick={onClick}>{children}</a>;
}

/** The data could not be loaded: say so plainly and offer to try again. */
export function Problem({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="fh-pg-problem" role="alert">
      <p><strong>{text}</strong> Check your internet connection, then try again.</p>
      <button type="button" className="ui-btn" onClick={onRetry}>Try again</button>
    </div>
  );
}

/** A cell's column name, shown only when a phone stacks its table into cards (fh-pg-stack). Screen readers hear the
 *  column header already, so they skip it. */
export function CellLabel({ children }: { children: ReactNode }) {
  return <span className="fh-pg-label" aria-hidden="true">{children}</span>;
}

/** A short list of facts: a label on the left, the value (in the number font) on the right. */
export function Facts({ rows, label }: { rows: [ReactNode, ReactNode][]; label?: string }) {
  return (
    <dl className="fh-facts" aria-label={label}>
      {rows.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

// ------------------------------------------------------------------------------------------------ the record's months

const span = (p: Period) => (p.from === p.to ? monthName(p.from) : `${monthName(p.from)} to ${monthName(p.to)}`);

/** A bar of every month of the record, coloured by where it comes from, with a legend that gives every number. */
export function SourceBar({ periods }: { periods: Period[] }) {
  if (!periods.length) return null;
  const start = yearOf(periods[0].from), end = yearOf(addMonths(periods[periods.length - 1].to, 1));
  const ticks: number[] = [];
  for (let y = Math.ceil(start / 5) * 5; y <= end; y += 5) ticks.push(y);
  const total = periods.reduce((a, p) => a + p.months, 0);
  return (
    <div className="fh-src">
      <div className="fh-src-track" aria-hidden="true">
        <div className="fh-src-bar">
          {periods.map((p, i) => {
            // A tooltip near an end of the bar opens towards the middle, so it never leaves the page.
            const before = periods.slice(0, i).reduce((a, x) => a + x.months, 0);
            const mid = (before + p.months / 2) / total;
            return (
              <span key={p.key} className="fh-src-seg ui-tip" data-k={p.key} style={{ flexGrow: p.months }}
                data-align={mid < 0.3 ? 'start' : mid > 0.7 ? 'end' : undefined}
                data-tip={`${p.label}: ${span(p)}, ${p.months} ${p.months === 1 ? 'month' : 'months'}`} />
            );
          })}
        </div>
        <div className="fh-src-axis">
          {ticks.map((y) => (
            <span key={y} className="ui-mono" style={{ left: `${(100 * (y - start)) / (end - start)}%` }}>{y}</span>
          ))}
        </div>
      </div>
      <ul className="fh-src-legend">
        {periods.map((p) => (
          <li key={p.key}>
            <span className="fh-src-swatch" data-k={p.key} aria-hidden="true" />
            <span className="fh-src-name">{p.label}</span>
            <span className="fh-src-when">{span(p)}</span>
            <span className="fh-src-months ui-mono">{p.months} {p.months === 1 ? 'month' : 'months'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
