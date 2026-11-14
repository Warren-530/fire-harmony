// web/eda.json (fireharmony/eda.py, version 1): the exploratory analysis of the raw record and the trend rigour checks,
// as the Methods page reads it. Only the fields the page shows are typed; the full layout is in the docstring of eda.py.
// Shares are percentages, FRP is in MW, trends in % per decade, local solar time in hours (10.5 = 10:30).
// The numbers keep 2 to 4 decimals, so each is rounded once, here, half up on its decimal digits: the same rule the
// report uses, so every number on the page reads as it does in report/report.qmd (eda.test.ts checks that).
import { webJson } from '../../lib/web';

export interface Quantiles { p10: number; p25: number; p50: number; p75: number; p90: number; p99: number }
export type SensorId = 'terra' | 'aqua' | 'snpp' | 'noaa20' | 'noaa21';

export interface EdaSensor {
  id: SensorId; label: string; family: 'MODIS' | 'VIIRS'; years: [number, number];
  hotspots: number; hotspots_per_year: number; counted_pct: number;
  frp_q_day: Quantiles; frp_q_night: Quantiles;
  below_10mw_pct: number; below_modis_limit_pct: number; day_pct: number; night_pct: number; counted_night_pct: number;
  confidence_pct: { low: number; nominal: number; high: number };
  static_labels_pct: number; near_real_time_pct: number; frp_per_hotspot_mw: number;
}

export interface OverlapPart { hotspots_per_year: number; below_10mw_pct: number; below_modis_limit_pct: number; frp_p50: number }
export interface OverlapSensor {
  id: SensorId; label: string; hotspots_per_year: number; frp_gw_per_year: number; day: OverlapPart; night: OverlapPart;
  below_10mw_pct: number; below_modis_limit_pct: number; night_pct: number;
}

export interface FdrCounts { rising: number; falling: number; flat: number; rising_pct: number; falling_pct: number }
export interface FdrLevel {
  hexagons: number; raw_005: FdrCounts; bh_005: FdrCounts; bh_010: FdrCounts; by_005: FdrCounts;
  p_cut_005: number; p_cut_010: number; expected_false_raw: number; p_rounded_to: number;
  fall_per_rise_bh_005: number; fall_per_rise_by_005: number;
}
export interface FloorRow { floor_per_year: number; tested: number; share_of_fire_pct: number; bh_005: FdrCounts; fall_per_rise: number }
export interface HexClass {
  min_per_year: number; max_per_year: number | null; hexagons: number; share_of_fire_pct: number; falling: number; rising: number;
  h_per_modis_model_years: number; h_per_modis_viirs_years: number; with_modis_only_trend: number; same_sign_as_modis_only_pct: number;
}
export interface YearBand { from: number; to: number; below_pct: number; above_pct: number }

export interface PlaceTrend { years: [number, number]; pct_per_decade: number; p: number; trend: string }
export interface SensitivityPlace {
  kind: string; id: string; name: string; trends: PlaceTrend[]; modis_only: PlaceTrend[];
  mean_per_year: Record<string, number>; top_years: number[];
}
export interface AgreementRow { iso3: string; name: string; continent: string; h_pct: number; h_p: number; modis_pct: number; modis_p: number }
export interface Agreement {
  years: [number, number]; countries: number; same_sign_pct: number; spearman: number; median_difference_pct_points: number;
  h_significant: number; h_significant_same_sign_pct: number; both_significant: number; both_significant_opposite: number;
  world: { h: { pct_per_decade: number; p: number }; modis: { pct_per_decade: number; p: number } };
}
export interface RankedPlace { kind: string; id: string; name: string; iso3: string; mean_per_year: number; pct_per_decade: number; p: number; q: number }
export interface PlaceGroup {
  with_trend: number; tested: number; share_of_world_fire_pct: number; left_out_barren: { id: string; name: string; barren_pct: number }[];
  raw_005: FdrCounts; bh_005: FdrCounts; bh_010: FdrCounts; rising: RankedPlace[]; falling: RankedPlace[];
  floors: { floor_per_year: number; tested: number; share_of_world_fire_pct: number; bh_005: FdrCounts }[];
}

export interface Eda {
  version: number;
  record: { first_month: number; last_month: number; hotspots: number };
  sensors: EdaSensor[];
  overlap: {
    years: [number, number]; modis_limit_mw: { day: number; night: number }; sensors: OverlapSensor[];
    snpp_per_aqua: { hotspots: number; frp: number; day_hotspots: number; night_hotspots: number };
    harmonized_where_modis_saw_none: { model_years: [number, number]; model_pct: number; viirs_years: [number, number]; viirs_pct: number };
  };
  frp_hist: { years: [number, number]; bin_edges_mw: number[]; sensors: Partial<Record<SensorId, { day: number[]; night: number[] }>> };
  overpass: {
    sensors: Partial<Record<SensorId, { day_median_local: number; night_median_local: number; years_for_median: [number, number];
      by_year: { yr: number; day_median_local: number; night_median_local: number }[] }>>;
    hour_share_2013_2019: Partial<Record<SensorId, number[]>>;
  };
  exchange_rate_l3: {
    years: [number, number]; min_aqua_per_year: number; hexagons: number; world: number; q05: number; q25: number; median: number;
    q75: number; q95: number; share_of_aqua_fire_covered_pct: number;
    parts: {
      rate: Record<'q05' | 'q25' | 'q50' | 'q75' | 'q95', number>; rate_day: Record<'q05' | 'q25' | 'q50' | 'q75' | 'q95', number>;
      spearman_rate_snpp_night: number; spearman_rate_snpp_weak_day: number; spearman_rate_day_snpp_weak_day: number;
      countries: { iso3: string; rate: number; rate_day: number; snpp_night: number; aqua_night: number; snpp_weak_day: number; aqua_per_year: number }[];
    };
  };
  fdr: {
    floor_per_year: number; floor_year_band: YearBand; below_floor_year_band: YearBand;
    l3: FdrLevel; l4: FdrLevel; l3_all: FdrLevel; l4_all: FdrLevel; floors_l3: FloorRow[]; floors_l4: FloorRow[]; classes_l3: HexClass[];
    modis_check_l3: { tested: { years: [number, number]; hexagons: number; same_sign_pct: number; harmonized_significant_same_sign_pct: number;
      both_significant: number; both_significant_opposite: number }; all: { both_significant_opposite: number } };
    spatial_l3: { moran_i: number; moran_p: number; permutations: number; significant_with_same_sign_neighbour_pct: number };
    l3_vs_l4: { same_sign_pct: number; both_significant_same_sign_pct: number; l3_significant_pct: number; l4_significant_pct: number };
    l3_by_continent: Record<string, { hexagons: number; falling_pct: number; rising_pct: number }>;
    l3_by_country: { iso3: string; name: string; hexagons: number; rising: number; falling: number; rising_pct: number; falling_pct: number }[];
  };
  places: { floor_per_year: number; floor_year_band: YearBand; below_floor_year_band: YearBand; countries: PlaceGroup; states: PlaceGroup };
  sensitivity: {
    base_periods: [number, number][];
    places: SensitivityPlace[];
    harmonized_vs_modis: Agreement & { rows: AgreementRow[] };
    harmonized_vs_modis_2003_2025: Agreement;
    world_h_per_modis_by_year: Record<string, number>;
    world_h_per_modis_mean: Record<string, number>;
    world_h_per_modis_change_2012_2021_pct: number;
  };
}

/** web/eda.json, kept for the session (null when the release has none). */
export const loadEda = (): Promise<Eda | null> => webJson<Eda>('eda.json');

// ------------------------------------------------------------------------------------------------ numbers

const LOCALE = 'en-GB';
const formats = new Map<string, Intl.NumberFormat>();
function nf(digits: number): Intl.NumberFormat {
  const k = String(digits);
  let f = formats.get(k);
  if (!f) { f = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }); formats.set(k, f); }
  return f;
}

/** Rounds half up (away from zero) on the decimal digits as published: 6.85 -> 6.9, 0.555 -> 0.56. */
export function round(v: number, digits = 0): number {
  const p = 10 ** digits;
  return Math.sign(v) * Math.round(Math.abs(v) * p + 1e-7) / p;
}

/** A number with fixed decimals and thousands separators, true minus sign: fix(6.85, 1) -> "6.9", fix(-6.29, 1) -> "−6.3". */
export function fix(v: number, digits = 0): string {
  const r = round(v, digits);
  return nf(digits).format(r === 0 ? 0 : r).replace(/-/g, '−');
}

/** With a sign: signed(109.35, 1) -> "+109.4". */
export const signed = (v: number, digits = 1): string => (round(v, digits) > 0 ? `+${fix(v, digits)}` : fix(v, digits));

/** A value already in percent: per(87.678, 1) -> "87.7%". */
export const per = (v: number, digits = 1): string => `${fix(v, digits)}%`;

/** A share below 1% reads "under 1%" when rounded to whole percent. */
export const perWhole = (v: number): string => (v < 0.5 ? 'under 1%' : `${fix(v, 0)}%`);

/** Millions with two decimals: 20124176 -> "20.12". */
export const mil2 = (v: number): string => fix(v / 1e6, 2);

/** Local solar time in hours to "10:39" (to the nearest minute). */
export function clock(hours: number): string {
  const m = Math.round((((hours % 24) + 24) % 24) * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** A p or q value as the report writes it (fireharmony/eda.py _p): "below 0.0001", four decimals under 0.01, else three
 *  ("0.0010", "0.010", "0.023"). Rounded to the nearest like Python's format, on the value as stored, so each table cell
 *  reads as it does in the report (eda.test.ts compares the cells). */
export function pText(p: number): string {
  if (p < 0.0001) return 'below 0.0001';
  return p.toFixed(p < 0.01 ? 4 : 3);
}

/** "2,272" */
export const int = (v: number): string => fix(v, 0);

// ------------------------------------------------------------------------------------------------ derived series

export interface FrpPoint { sensor: SensorId; part: 'day' | 'night'; mw: number; lo: number; hi: number; share: number }

/** Each satellite's hotspots over FRP bins, as shares that sum to 100% (per satellite and part of the day). */
export function frpShares(e: Eda, ids: SensorId[] = ['terra', 'aqua', 'snpp']): FrpPoint[] {
  const edges = e.frp_hist.bin_edges_mw;
  const out: FrpPoint[] = [];
  for (const id of ids) {
    const s = e.frp_hist.sensors[id];
    if (!s) continue;
    for (const part of ['day', 'night'] as const) {
      const v = s[part];
      const total = v.reduce((a, x) => a + x, 0);
      if (!total) continue;
      v.forEach((n, i) => {
        const lo = edges[i], hi = edges[i + 1];
        if (lo === undefined || hi === undefined) return;
        out.push({ sensor: id, part, mw: Math.sqrt(lo * hi), lo, hi, share: (100 * n) / total });
      });
    }
  }
  return out;
}

/** Benjamini and Hochberg adjusted p values (q), in the order given. */
export function bhAdjust(ps: number[]): number[] {
  const n = ps.length;
  const order = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const q = new Array<number>(n).fill(1);
  let prev = 1;
  for (let k = n - 1; k >= 0; k--) {
    const [p, i] = order[k];
    prev = Math.min(prev, (p * n) / (k + 1));
    q[i] = prev;
  }
  return q;
}

export const SENSOR_NAME: Record<SensorId, string> = {
  terra: 'Terra', aqua: 'Aqua', snpp: 'Suomi NPP', noaa20: 'NOAA‑20', noaa21: 'NOAA‑21',
};
export const SENSOR_TOKEN: Record<SensorId, string> = {
  terra: '--fh-terra', aqua: '--sensor-modis', snpp: '--sensor-snpp', noaa20: '--sensor-noaa20', noaa21: '--sensor-noaa21',
};
