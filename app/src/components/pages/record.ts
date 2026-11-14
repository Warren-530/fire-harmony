// Where each month of the harmonized record comes from (the src column of the data files), from meta.json facts.
import { addMonths, monthsBetween } from './format';

export type PeriodKey = 'terra' | 'terra_aqua' | 'viirs' | 'pending';
export interface Period { key: PeriodKey; label: string; note: string; from: number; to: number; months: number }

/**
 * Where each month of the harmonized record comes from (the src column): the Terra only model until Aqua joined, the
 * Terra + Aqua model until VIIRS, then VIIRS observed. Suomi NPP data starts on 20 January 2012, so that first, partial
 * month is still modelled and VIIRS is observed from the month after (as in area_monthly.parquet).
 */
export function recordPeriods(satellites: { satellite: string; first: number; last: number }[], firstFull: number,
  latestFull: number, lastMonth: number): Period[] {
  const first = (name: string) => satellites.find((s) => s.satellite.replace(/[\s-]/g, '').toLowerCase() === name)?.first;
  const aqua = first('aqua'), snpp = first('suominpp');
  if (!aqua || !snpp) return [];
  const viirs = addMonths(snpp, 1);
  const out: Period[] = [
    { key: 'terra', label: 'Model from MODIS Terra', note: 'Terra flew alone', from: firstFull, to: addMonths(aqua, -1), months: 0 },
    { key: 'terra_aqua', label: 'Model from MODIS Terra + Aqua', note: 'Before VIIRS', from: aqua, to: addMonths(viirs, -1), months: 0 },
    { key: 'viirs', label: 'VIIRS observed', note: 'Scaled to NOAA‑20', from: viirs, to: latestFull, months: 0 },
  ];
  if (lastMonth > latestFull) {
    out.push({ key: 'pending', label: 'No data yet', note: 'Still filling in', from: addMonths(latestFull, 1), to: lastMonth, months: 0 });
  }
  return out.map((p) => ({ ...p, months: monthsBetween(p.from, p.to) }));
}

