// The shape of dashboard.json (built by fireharmony/dashboard.py). Every number is already checked in the notebooks.
// Nulls mean "not available" (for example a 90% band in a year that VIIRS observed).

export interface DashboardData {
  version: string;
  built_utc: string;
  record: {
    first_month: number;            // yyyymm
    last_month: number;             // yyyymm (may be partial)
    latest_full_month: number;      // yyyymm
    months: number;                 // months with data
    hotspots_total: number;         // harmonized hotspots in the whole record
    satellites: { satellite: string; first: number; last: number }[];   // yyyymm
  };
  world: {
    yearly: { yr: number; harmonized: number; lo: number | null; hi: number | null; modis: number; naive: number; complete: boolean }[];
    trend: { pct_per_decade: number; p: number; direction: string };
    latest: { yr: number; mo: number; h: number; normal: number; ratio: number; rank: number | null; years: number };
    ytd: { yr: number; months: number; total: number; normal: number; ratio: number };
    seasonality: { mo: number; median: number; q25: number; q75: number }[];
  };
  continents: AreaStat[];
  countries: AreaStat[];            // the 25 countries with the most fire (2001 to 2025)
  hot_now: { kind: string; id: string; name: string; h: number; normal: number; ratio: number; yr: number; mo: number }[];
  seam: {
    naive_jump_2011_2012: number;   // times
    steps: {                        // % step of the record against its witness (MODIS for 2012, Terra for 2002)
      '2012_harmonized_1y': number; '2012_harmonized_3y': number; '2012_naive_1y': number;
      '2002_harmonized': number; '2002_without_bridge': number; '2002_modis_scale': number;
    };
    placebo: Record<'2002' | '2012', { mean: number; sd: number; z: number; real: number; steps: Record<string, number> }>;
    burned_area: {
      step_1y: number; modis_step_1y: number; naive_step_1y: number; placebo_sd: number; z: number;
      hotspots_per_km2: Record<string, number>; yearly_correlation: number;
    } | null;
    pettitt: Record<string, { year: number; p: number }>;
    pelt_near_seams: Record<string, Record<string, string[]>>;
  };
  models: {
    cv: { scale: string; ratio_err: number; gbm_err: number; ratio_ccc: number; gbm_ccc: number }[];   // median error in %
    bias_pct: { terra_aqua: number; terra_only: number };
    coverage: { scale: string; terra_aqua: number | null; terra_only: number | null }[];               // share inside the 90% range
    bridges: { snpp_to_noaa20: number; noaa21_to_noaa20: number; terra_only_to_terra_aqua: number };
    importance: { feature: string; pct: number }[];
  };
  physics: {
    points: number;
    seen: { aqua_day: number; aqua_night: number; terra_day: number; terra_night: number };
    curve: { frp: number; aqua_day: number | null; aqua_night: number | null; terra_day: number | null; terra_night: number | null }[];
    half_mw: { aqua_day: number | null; aqua_night: number | null };
    cloud_share: number;
    tiles: { tile: string; lat: number; lon: number; weak_share: number; viirs_per_aqua: number; points: number }[];
  } | null;
  mask: Record<'modis' | 'viirs', { recall: number; precision: number; fire_loss: number }>;
  drivers: {
    areas: number; share_r2_above_0_2: number; median_r2_state: number;
    hist: { lo: number; hi: number; n: number }[];
    top: { name: string; kind: string; id: string; r2_cv: number; beta_rain: number; enso_r: number | null }[];
    enso: { name: string; id: string; enso_r: number; enso_lag: number }[];
  } | null;
  outlook: {
    issued_from: string;            // 'yyyy-mm'
    areas: number;
    bss: { lead: number; bss: number }[];
    bss_recent: number;
    share_with_skill: Record<string, number>;
    calibration: { p: number; o: number; n: number }[];
    by_continent: { name: string; l1: number; l2: number; l3: number }[];
    top_now: { name: string; kind: string; id: string; target_yr: number; target_mo: number; p: number; p_clim: number; bss: number }[];
    importance: { feature: string; pct: number }[];
    // a newer release adds the score against a fixed 50% chance (components/methods/skill.ts picks it when present)
    bss_fair?: { lead: number; bss: number; lo?: number; hi?: number }[];
    bss_recent_fair?: number | null;
    share_with_skill_fair?: Record<string, number>;
    by_continent_fair?: { name: string; l1: number; l2: number; l3: number }[];
  } | null;
  haze: {
    season_months: [number, number];
    who_daily_guideline: number;
    cities: { name: string; country: string; r2_cv: number; share_sumatra: number; share_borneo: number; k_sumatra: number;
      k_borneo: number; smoke_2015: number | null; smoke_2019: number | null; smoke_2026: number | null; pm25_mean: number }[];
  } | null;
}

export interface AreaStat {
  kind: string; id: string; name: string;
  mean_per_year: number;            // harmonized hotspots per year, 2001 to 2025
  share_pct: number;                // share of world fire
  trend_pct_per_decade: number | null;
  trend_p: number | null;
  trend: string;                    // 'increasing' | 'decreasing' | 'no trend'
  critical_months: number[];
  latest_ratio: number | null;      // the latest full month against its normal
  latest_yr: number; latest_mo: number;
  yearly: { yr: number; h: number }[];
}
