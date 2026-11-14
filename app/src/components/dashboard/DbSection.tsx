// A section of the dashboard (the same markup as Section in ui.tsx) that
// - wears a small badge when it cannot follow the scope ("World": the seam test is about the satellites, not a place);
// - on phones shows only its first block, with "Show 3 more charts" for the rest (progressive disclosure, as Stripe
//   and Linear do on mobile). The choice is kept for the session, and a link to the section opens it.
import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Tooltip } from '../Tooltip';
import { IconChevronDown } from '../icons';

export interface SectionScope { badge: string | null; badgeHelp: string }
export const SectionScopeContext = createContext<SectionScope>({ badge: null, badgeHelp: '' });

const KEY = 'fh_db_open';
function openSet(): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
function remember(id: string, open: boolean): void {
  try {
    const s = openSet();
    if (open) s.add(id); else s.delete(id);
    sessionStorage.setItem(KEY, JSON.stringify([...s]));
  } catch { /* private mode */ }
}

/** Opens a section that the phone layout folded (a link to it, or a jump from the section chips). */
export function openSection(id: string): void {
  window.dispatchEvent(new CustomEvent('db:open-section', { detail: id }));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "4 more charts, 3 numbers and 1 table". */
function foldWords(c: { charts: number; tables: number; numbers: number; notes: number; rows: number }): string {
  const parts = [
    c.charts ? plural(c.charts, 'chart', 'charts') : '', c.tables ? plural(c.tables, 'table', 'tables') : '',
    c.numbers ? plural(c.numbers, 'number', 'numbers') : '', c.notes ? plural(c.notes, 'note', 'notes') : '',
    c.rows ? plural(c.rows, 'row', 'rows') : '',
  ].filter(Boolean);
  if (!parts.length) return '';
  parts[0] = parts[0].replace(/^(\d+) /, '$1 more ');
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The parts of a section a phone can fold: cards, tiles and notes, not nested in one another. */
const UNIT = '.ui-card, .ui-stat, .ui-callout';

export function DbSection({ id, title, subtitle, children, extra, keep = 1, lead, units = UNIT, foldLabel, alwaysFold }: {
  id: string; title: ReactNode; subtitle?: ReactNode; children: ReactNode;
  extra?: ReactNode;   // something beside the title (a status, a button)
  lead?: ReactNode;    // a line under the subtitle (what the section says about the place in view)
  keep?: number;       // how many cards or tiles a phone shows before "Show more"
  units?: string;      // what folds (the Methods page folds its subsections of text too)
  foldLabel?: (what: string) => string;   // the button's words while folded ("Show the detail (4 charts and 2 tables)")
  alwaysFold?: string; // parts that fold even before `keep` cards have shown (the Methods page's subsections of text)
}) {
  const hid = useId();
  const { badge, badgeHelp } = useContext(SectionScopeContext);
  const short = id.replace(/^db-/, '');
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return true;   // (rendered on a server, as the tests do: everything shows)
    const s = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('s');
    return s === short || openSet().has(short);
  });
  const root = useRef<HTMLElement>(null);
  const [hidden, setHidden] = useState({ charts: 0, tables: 0, numbers: 0, notes: 0, rows: 0 });

  // what the fold hides on a phone: every card, tile or note after the first `keep` (marked data-fold), and the rows
  // of a ranked list after the fifth; counted as charts and other parts for the button
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const all = Array.from(el.querySelectorAll<HTMLElement>(units)).filter((u) => !u.parentElement?.closest(units));
    const c = { charts: 0, tables: 0, numbers: 0, notes: 0, rows: 0 };
    let kept = 0;
    all.forEach((u) => {
      const fold = kept >= keep || (!!alwaysFold && u.matches(alwaysFold));
      if (!fold) kept += 1;
      if (fold !== u.hasAttribute('data-fold')) u.toggleAttribute('data-fold', fold);
      if (!fold) return;
      const n = u.querySelectorAll('.ui-figure').length;
      const tables = u.querySelectorAll('.db-sort-wrap, .db-rank, .ui-table-wrap').length;
      if (n) { c.charts += n; if (u.matches('.fh-doc-sub')) c.tables += tables; }
      else if (tables) c.tables += u.matches('.fh-doc-sub') ? tables : 1;
      else if (u.matches('.ui-stat')) c.numbers += 1;
      else c.notes += 1;
    });
    for (const u of all.slice(0, keep)) c.rows += Math.max(0, u.querySelectorAll('.db-rank > li').length - 5);
    setHidden((h) => (JSON.stringify(h) === JSON.stringify(c) ? h : c));
  });

  useLayoutEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === short) setOpen(true); };
    window.addEventListener('db:open-section', on);
    return () => window.removeEventListener('db:open-section', on);
  }, [short]);

  const n = hidden.charts + hidden.tables + hidden.numbers + hidden.notes + hidden.rows;
  const what = foldWords(hidden);
  const toggle = () => {
    const btn = root.current?.querySelector('.db-fold');
    const before = btn?.getBoundingClientRect().top ?? 0;
    const next = !open;
    setOpen(next);
    remember(short, next);
    // folding keeps the button under the finger
    if (!next) requestAnimationFrame(() => {
      const after = root.current?.querySelector('.db-fold')?.getBoundingClientRect().top ?? before;
      window.scrollBy({ top: after - before, behavior: 'instant' });
    });
  };

  return (
    <section ref={root} className="ui-section db-section" id={id} aria-labelledby={hid} data-folded={open ? undefined : ''}>
      <div className="ui-section-head">
        <div className="db-section-title-row">
          <h2 className="ui-section-title" id={hid}>{title}</h2>
          {badge ? (
            <Tooltip content={badgeHelp}>
              <span className="ui-badge ui-badge-neutral db-scope-badge" tabIndex={0} aria-label={`${badge}: ${badgeHelp}`}>{badge}</span>
            </Tooltip>
          ) : null}
          {extra}
        </div>
        {subtitle ? <p className="ui-section-subtitle">{subtitle}</p> : null}
        {lead ?? null}
      </div>
      {children}
      {n > 0 ? (
        <button type="button" className="ui-btn db-fold" aria-expanded={open} onClick={toggle}>
          {open ? 'Show less' : foldLabel ? foldLabel(what) : `Show ${what}`}
          <IconChevronDown size={16} className="db-fold-chev" />
        </button>
      ) : null}
    </section>
  );
}
