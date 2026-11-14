// The month grid of one map hexagon, filled as data.ts fills the area series: zero where the hexagon had no row, unknown
// (null) where the world source of that month is 3. So a hexagon's series always agrees with the map. And the title of
// a burning calendar, its finding. Pure, so tested.
import type { Dict } from '../../lib/i18n';
import { addMonths, littleFire, monthRuns, monthsBetween, season, LITTLE_FIRE_NORMAL } from '../../lib/stats';
import type { Meta, MonthlyPoint, Source } from '../../lib/types';

/** One row of cell_l3 or cell_l4 (one hexagon, one month). */
export interface HexRow { yr: number; mo: number; h: number | null; modis: number | null; t: number; a: number; s: number; n: number; j: number; src: number }

/** Every month of the record for one hexagon, from its rows (any order) and the world source of each month. */
export function fillMonths(
  rows: readonly HexRow[], meta: Pick<Meta, 'first_month' | 'last_month'>, world: ReadonlyMap<number, Source>,
): MonthlyPoint[] {
  const byMonth = new Map(rows.map((r) => [r.yr * 100 + r.mo, r]));
  const count = Math.max(0, monthsBetween(meta.first_month, meta.last_month) + 1);
  return Array.from({ length: count }, (_, i) => {
    const key = addMonths(meta.first_month, i);
    const r = byMonth.get(key);
    const worldSrc = world.get(key) ?? 3;
    const src = (worldSrc === 3 ? 3 : r ? Math.min(r.src, 3) : worldSrc) as Source;
    const unknown = src === 3;
    return {
      yr: Math.floor(key / 100), mo: key % 100,
      h: unknown ? null : (r?.h ?? 0),
      modis: unknown ? null : (r?.modis ?? 0),
      t: r?.t ?? 0, a: r?.a ?? 0, s: r?.s ?? 0, n: r?.n ?? 0, j: r?.j ?? 0,
      src,
    };
  });
}

/**
 * The title of a burning calendar, as its finding: the usual fire season (the critical months of the harmonized
 * record, as the critical period tile) and its peak month. "The fire season is August to October, peaking in September".
 */
export function calendarTitle(points: readonly MonthlyPoint[], t: Pick<Dict, 'common' | 'ex'>): string {
  // (a place with too little fire has no fire season to speak of: the modelled months before 2012 would make one up)
  if (littleFire(points)) return LITTLE_FIRE_NORMAL;
  const s = season(points, 'harmonized');
  const name = (mo: number) => t.common.months[mo - 1];
  const runs = monthRuns(s.criticalMonths).map(([a, b]) => [name(a), name(b)] as const);
  return t.ex.calendarFinding(runs, s.peakMonth === null ? null : name(s.peakMonth));
}
