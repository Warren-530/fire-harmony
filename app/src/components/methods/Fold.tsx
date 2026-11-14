// A section of the Methods page that folds on phones (below 768 px): its title, its lead text and its first card stay,
// and the rest (the subsections of text, the other charts and tables) opens with "Show the detail". The Dashboard's
// fold (components/dashboard/DbSection.tsx), with the subsections of text as parts that fold too.
import type { ReactNode } from 'react';
import { DbSection, openSection } from '../dashboard/DbSection';

const UNITS = '.ui-card, .ui-stat, .ui-callout, .fh-doc-sub, .fh-ck-card';

/** "4 more charts and 2 tables" → "Show the detail (4 charts and 2 tables)". */
const label = (what: string): string => `Show the detail (${what.replace(/^(\d+) more /, '$1 ')})`;

export function FoldSection({ id, title, subtitle, children, keep = 1 }: { id: string; title: string; subtitle?: ReactNode; children: ReactNode; keep?: number }) {
  return <DbSection id={id} title={title} subtitle={subtitle} units={UNITS} foldLabel={label} keep={keep} alwaysFold=".fh-doc-sub">{children}</DbSection>;
}

/** Opens the folded section that holds an element (before a jump to a chart inside it). */
export function openSectionOf(el: Element | null): void {
  const s = el?.closest('section[id]');
  if (s) openSection(s.id.replace(/^db-/, ''));
}
