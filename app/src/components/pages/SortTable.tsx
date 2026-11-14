// A table whose columns sort on a click (or Enter), in the look of the shared DataTable (ui-table). The sorted
// column carries aria-sort; a third click goes back to the first order. With `stack`, a phone shows one card per row:
// the header becomes a row of sort buttons and each cell names its column.
import { useMemo, useState, type ReactNode } from 'react';
import { IconChevronDown, IconChevronUp } from '../icons';
import { Tooltip } from '../Tooltip';

export interface SortColumn<R> {
  key: string;
  label: string;
  num?: boolean;                               // right aligned, tabular figures, sorts largest first
  render: (row: R) => ReactNode;
  sortValue?: (row: R) => number | string;     // no sortValue: the column does not sort
}

type Dir = 'ascending' | 'descending';

export function SortTable<R>({ columns, rows, caption, rowKey, stack = false }: {
  columns: SortColumn<R>[]; rows: R[]; caption: string; rowKey: (row: R) => string; stack?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(null);
  const sorted = useMemo(() => {
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    if (!sort || !col?.sortValue) return rows;
    const get = col.sortValue;
    const sign = sort.dir === 'ascending' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
    });
  }, [rows, columns, sort]);

  const toggle = (c: SortColumn<R>) => {
    const first: Dir = c.num ? 'descending' : 'ascending';
    setSort((s) => {
      if (!s || s.key !== c.key) return { key: c.key, dir: first };
      if (s.dir === first) return { key: c.key, dir: first === 'ascending' ? 'descending' : 'ascending' };
      return null;
    });
  };

  return (
    <div className="ui-table-wrap">
      <table className="ui-table fh-sort-table" data-stack={stack ? '' : undefined}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const dir = sort?.key === c.key ? sort.dir : undefined;
              return (
                <th key={c.key} scope="col" className={c.num ? 'ui-num' : undefined} aria-sort={dir}>
                  {c.sortValue ? (
                    <Tooltip content={dir === undefined ? `Sort by ${c.label.toLowerCase()}` : dir === 'ascending' ? 'Sorted, smallest first' : 'Sorted, largest first'}>
                      <button type="button" className="fh-sort" onClick={() => toggle(c)}>
                        <span>{c.label}</span>
                        <span className="fh-sort-icon" data-dir={dir ?? 'none'} aria-hidden="true">
                          {dir === 'ascending' ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
                        </span>
                      </button>
                    </Tooltip>
                  ) : c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c, j) => (j === 0
                ? <th key={c.key} scope="row" className={c.num ? 'ui-num' : undefined}>{c.render(r)}</th>
                : <td key={c.key} className={c.num ? 'ui-num' : undefined} data-label={c.label}>{c.render(r)}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
