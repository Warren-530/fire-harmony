// The monthly series of one map hexagon (level 3 or 4), from the cell_l3 or cell_l4 file of its level 1 region.
// The month grid is filled as in data.ts: zero where the hexagon had no row, unknown (null) where the world source
// of that month is 3. So the series always agrees with the map.
import { loadMeta, worldSources } from '../../lib/data';
import { cellToParent } from 'h3-js';
import { query, registerData, sqlText } from '../../lib/db';
import { webIndex } from '../../lib/web';
import type { MonthlyPoint } from '../../lib/types';
import type { Level } from './mapData';
import { fillMonths, type HexRow } from './months';

export async function hexSeries(h3: string, level: Level): Promise<MonthlyPoint[]> {
  const [meta, world, index] = await Promise.all([loadMeta(), worldSources(), webIndex()]);
  // the hexagon's level 1 region file (web/cell_l3/<region>.parquet, tens of KB) instead of the whole level
  const region = cellToParent(h3, 1);
  if (!(level === 3 ? index.cell_l3 : index.cell_l4).has(region)) return fillMonths([], meta, world);
  const file = `web/cell_l${level}/${region}.parquet`;
  await registerData(file);
  const rows = await query<HexRow>(`SELECT yr::INTEGER AS yr, mo::INTEGER AS mo, h, modis, t, a, s, n, j, src::INTEGER AS src
    FROM '${file}' WHERE h3 = ${sqlText(h3)} ORDER BY yr, mo`);
  return fillMonths(rows, meta, world);
}
