// Shared contract for every module of the Fire Harmony app. Change it only on purpose: all modules depend on it.

/** One month of fire for one area. Values are hotspots per month. */
export interface MonthlyPoint {
  yr: number;              // 2000..2026
  mo: number;              // 1..12
  h: number | null;        // harmonized hotspots, NOAA-20 VIIRS scale; null = unknown month (src 3, e.g. current month after a few days)
  modis: number | null;    // the same on the MODIS scale (per satellite average of Terra and Aqua)
  t: number; a: number; s: number; n: number; j: number;   // raw detections: Terra, Aqua, Suomi NPP, NOAA-20, NOAA-21
  src: Source;             // best source in the area that month
}

/** 0 VIIRS observed, 1 model from MODIS Terra + Aqua, 2 model from MODIS Terra only, 3 no data yet */
export type Source = 0 | 1 | 2 | 3;

export type Scale = 'harmonized' | 'modis' | 'raw';
export type ColourMode = 'count' | 'anomaly';
/** The colours of the Explorer's map: a month (fire count or against normal) or the trend of 2001 to 2025. */
export type MapMode = ColourMode | 'trend';

/** A named place from areas.json */
export interface NamedArea {
  kind: 'world' | 'continent' | 'country' | 'state';
  id: string;              // 'WORLD', continent name, ISO3 code, or Natural Earth adm1_code
  name: string;            // e.g. 'Riau, Indonesia' (in English: lib/names.ts, applied where areas.json loads)
  local_name?: string | null;   // the state's local name where the English one replaced it ('Kalimantan Tengah')
  country_iso3: string | null;
  lat: number; lon: number;
  cells: number;           // number of level 5 hexagons
  area_km2: number;
}

/** What the user selected. Polygons are rings of [lon, lat] (GeoJSON order), closed or open. */
export type AreaSelection =
  | { type: 'named'; area: NamedArea }
  | { type: 'polygon'; ring: [number, number][]; label?: string }
  | { type: 'circle'; lat: number; lon: number; radiusKm: number };

/** A hexagon value for the map */
export interface HexValue {
  h3: string;              // H3 index as hex text, level 3 or 4
  h: number;               // harmonized hotspots that month
  median: number | null;   // normal for that calendar month (2001..2025), null if unknown
}

/** One band of the area interval table (meta.json -> intervals[key].bands). mu_max null means no upper limit. */
export interface IntervalBand { mu_min: number; mu_max: number | null; q_lo: number; q_hi: number; units: number }
export interface IntervalTable { method: string; level: number; bands: IntervalBand[]; calibration_units: number;
  coverage_by_scale: Record<string, number> }
export type IntervalKey = 'terra_aqua_month' | 'terra_aqua_year' | 'terra_only_month' | 'terra_only_year';

export interface Meta {
  version: string;
  built_utc: string;
  first_month: number;     // yyyymm, e.g. 200010
  last_month: number;      // yyyymm, e.g. 202611 (may be partial: see src)
  min_h_kept: number;
  scale: string;
  sources: Record<string, string>;
  satellites: { satellite: string; first: number; last: number }[];
  intervals: Record<IntervalKey, IntervalTable>;
  validation: unknown;
  files: { l5: { files: number; rows: number; mb: number; index: Record<string, string> } } & Record<string, unknown>;
}

/** 90% range of a total (null where the value is observed, not modelled) */
export interface Range { lo: number; hi: number }

/** Comparison of one month with its normal */
export interface Anomaly {
  yr: number; mo: number;
  value: number | null;
  median: number | null;   // normal for that calendar month over the base years
  ratio: number | null;    // value / median
  percentile: number | null; // share of base years with a value <= this one, 0..100
  rank: number | null;     // 1 = most fire for that calendar month since 2001
  years: number;           // number of years ranked
}

export interface Trend {
  years: number;
  direction: 'increasing' | 'decreasing' | 'no trend' | 'not enough data';
  p: number | null;
  sen_slope_per_year: number | null;
  pct_per_decade: number | null;
}

export interface Season { fireYearStartMonth: number; criticalMonths: number[]; peakMonth: number | null }

/** Drivers of one month for one area (drivers.parquet). Factors are "times normal fire". */
export interface DriverMonth {
  yr: number; mo: number;
  ratio: number | null;          // fire / normal for that calendar month
  rain3_pct: number | null;      // rain of this month and the 2 before, % from normal
  rain3_z: number | null;        // the same, standardised
  t2m_anom: number | null;       // air temperature, degrees C from normal
  fwi_ratio: number | null;      // fire weather index / normal (GFWED, to April 2026)
  oni: number | null;            // El Nino index of the 3 month season centred on this month
  in_season: boolean;            // the month's normal fire is at least half of an average month
  f_rain: number | null;         // the fire the rain alone would give
  f_heat: number | null;         // the fire the heat alone would give (1 where heat is not a driver here)
  heat_known: boolean;
  f_drivers: number | null;      // rain and heat together
  oni_lagged: number | null;     // ONI at this area's El Nino lag
  rain_z_from_enso: number | null; // rain anomaly (standard deviations) that El Nino alone would bring
}

/** How well the drivers explain an area's fire (drivers_models.parquet) */
export interface DriverModel {
  r2_cv: number;                 // share of fire anomalies explained, on years left out (can be below 0)
  n_months: number;
  beta_rain: number; beta_heat: number; uses_heat: boolean;
  enso_lag: number | null;       // months between El Nino and the rain it brings here
  enso_r: number | null;         // correlation of El Nino with the 3 month rain (negative: El Nino brings drought)
  enso_slope: number | null;
  fire_per_year: number;
}

/** Outlook for one area and lead (outlook.parquet) */
export interface OutlookRow {
  lead: number; issue_yr: number; issue_mo: number; target_yr: number; target_mo: number;
  p: number;                     // chance of above normal fire
  p_clim: number;                // the normal chance for that area and month
  bss: number | null;            // Brier skill score on held out years (above 0: better than the normal chance)
  n_tested: number | null;
}

/** Haze at one city in one month (haze.parquet). PM2.5 in micrograms per cubic metre. */
export interface HazeMonth {
  city: string; yr: number; mo: number;
  pm25_cnn: number | null;       // MERRA-2 CNN bias corrected (July to November, 2002 to 2025)
  pm25_merra2: number | null;    // MERRA-2 (every month)
  pm25_model: number | null;     // normal level + smoke from the model
  smoke_model: number | null;    // smoke from fires in Sumatra and Borneo
  smoke_excess: number | null;   // smoke from fire above normal
  days_over_who: number | null; days_over_50: number | null;
  fire_sumatra_k: number; fire_borneo_k: number;   // thousand harmonized hotspots in each source region
  rain_mm: number | null;
}

export interface HazeCityModel {
  n_months: number; r2_fit: number; r2_cv: number; rmse_cv: number; resid_sd: number;
  normal_by_month: Record<string, number>;
  ug_per_1000_hotspots: { sumatra: number; borneo: number };
  lat: number; lon: number; country: string;
}
export interface HazeModels {
  season_months: [number, number]; fit_years: [number, number]; who_daily_guideline: number;
  cities: Record<string, HazeCityModel>;
}
