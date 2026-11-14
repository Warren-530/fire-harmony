"""Step 11: exploratory analysis of the raw FIRMS record, and how much the trends can be trusted.

The report's sections "A first look at the raw record", "How sure are the trends?" and "Do the trends survive other
choices?", and web/eda.json for the app, come from here. Every number the report text quotes from this analysis is
listed by text_numbers() and checked against report/report.qmd by tests/test_eda.py.
Run:  fireharmony eda              (scans of the hotspot files, cached; statistics; web/eda.json; eda/report_tables.md)
      fireharmony eda --figures    (also draws the report figures fig20 to fig24)
      fireharmony eda --rescan     (scan the hotspot files again, for a new release of the record)

1. The scans. Plain aggregates over each of the 781 hotspot region files (products/v1.0/hotspots/), one pass per
   question: no sort, DISTINCT, window or join on the full table (the only join is to a small lookup table of level 5
   hexagons from cells.parquet, as a hash join). Cached in eda/:
     scan_profile.parquet   n, frp_sum by continent, satellite, UTC year, day or night, confidence, NASA type (-1 when
                            there is none, in near real time data), quality, counted, s10 (FRP below 10 MW) and sdet
                            (FRP below the power at which MODIS sees half the fires: 10 MW by day, 2 MW by night)
     scan_frp.parquet       n by continent, satellite, year, day or night, counted and FRP bin (fb: the bin holds FRP
                            from 10^(0.02 fb) to 10^(0.02 (fb + 1)) MW; fb = -999 when FRP is missing), for the figure
     scan_overpass.parquet  n by satellite, year, day or night and local solar time (tb: 10 minute bins from midnight)
     scan_frp_exact.parquet counted hotspots by satellite, day or night and reported FRP in 0.01 MW (exact: FIRMS gives
                            MODIS FRP to 0.1 MW and VIIRS FRP to 0.01 MW), in full calendar years and in 2013 to 2019
     scan_hex.parquet       counted Aqua and Suomi NPP hotspots of 2013 to 2019 by level 3 hexagon, country, day or night
                            and sdet: what sets the exchange rate from place to place
   Continent "Other" holds hotspots outside the record's hexagons (open water, static sources far from any fire).

2. Statistics. Per sensor on its full calendar years (exact FRP quantiles, small fire shares, day and night shares,
   confidence and type classes), the like for like years 2013 to 2019 when Terra, Aqua and Suomi NPP all flew at their
   set times, overpass times and their drift, and the exchange rate of VIIRS to MODIS hotspots per level 3 hexagon,
   split exactly into a day rate and a night factor: R = R_day (1 - night share of Aqua) / (1 - night share of Suomi NPP).

3. Trend rigour. A map hexagon's trend is tested only when it has at least HEX_FLOOR (100) hotspots a year on average:
   before 2012 the model gives every hexagon month a small expected value, also where MODIS saw nothing, while VIIRS
   records 0 in an empty month, so nearly empty hexagons fall at 2012 although MODIS does not (hex_classes shows it).
   Benjamini and Hochberg false discovery rate control (q = 0.05 and 0.10) runs over the tested hexagons of
   web/trend_l3.json and trend_l4.json and over the places of web/places.json (at least 1,000 hotspots a year, less
   than half on barren land); Benjamini and Yekutieli as a check that holds under any dependence; Moran's I of the
   level 3 trends (neighbours that share an edge); the hexagon trends against the MODIS only record (2003 to 2025).

4. Sensitivity. The trend of the world and key places for three base periods; the harmonized record against the
   MODIS only record (the column modis of area_monthly.parquet) for every country, 2001 to 2025; level 3 against
   level 4; other floors.

5. Review checks (models/r1_checks.json, r1_checks()): the low fire seam by fire band (also in eda.json as seam_by_band),
   the trends from 2003 and of ESA burned area, case studies, and the uncertainty of the trends (intervals of Sen's slope,
   a permutation test of the whole map, a block bootstrap of its falls per rise, the error of hexagon months with fire).

Every trend uses analytics.trend or placestats.yearly_trend (Mann Kendall with the Hamed and Rao correction, Sen's slope
of log(1 + yearly total)), so the numbers agree with places.json and the app.

web/eda.json (version 1), for an analysis section in the app (eda/summary.json is the same, indented). Shares are
percentages, FRP is in MW, trends are in % per decade of the yearly total, local solar time is in hours (10.5 = 10:30).
Ratios keep 4 decimals and shares 3, so a number is rounded once, when it is shown. Place names are in English
(english_name), with the published form in local_name.
  version, built, record {first_month, last_month, hotspots}
  sensors        one card per satellite, on its full calendar years: {id, label, family, years [first, last], hotspots,
                 hotspots_per_year, counted_pct, frp_q / frp_q_day / frp_q_night {p10, p25, p50, p75, p90, p99} (counted
                 hotspots, exact), below_10mw_pct, below_modis_limit_pct, day_pct, night_pct, counted_night_pct,
                 confidence_pct {low, nominal, high}, type_pct {vegetation, volcano, static, offshore, unlabelled},
                 static_labels_pct, near_real_time_pct, frp_per_hotspot_mw}
  overlap        Terra, Aqua and Suomi NPP in 2013 to 2019: {years, modis_limit_mw {day, night}, sensors: [{id, label,
                 hotspots_per_year, frp_gw_per_year, day / night {hotspots_per_year, below_10mw_pct,
                 below_modis_limit_pct, frp_p50}, below_10mw_pct, below_modis_limit_pct, night_pct}],
                 snpp_per_aqua {hotspots, frp, day_hotspots, night_hotspots}, by_continent: [{continent, snpp_per_aqua,
                 snpp_per_aqua_day, snpp_per_aqua_night, snpp_frp_per_aqua_frp, snpp_below_modis_limit_pct,
                 aqua_below_modis_limit_pct, snpp_night_pct, aqua_night_pct}],
                 snpp_where_modis_saw_none {years, pct, by_year {year: pct}} (Suomi NPP hotspots in level 5 hexagon
                 months where neither MODIS satellite saw a fire), harmonized_where_modis_saw_none {model_years,
                 model_pct, viirs_years, viirs_pct, by_year} (the same share of the harmonized record)}
  frp_hist       {years, bin_edges_mw (47 edges, 0.1 log10 apart), sensors {terra, aqua, snpp: {day, night: [46 values,
                 hotspots per year per bin]}}}
  overpass       {sensors {<id>: {day_median_local, night_median_local, years_for_median, by_year: [{yr,
                 day_median_local, night_median_local}]}}, hour_share_2013_2019 {<id>: [48 shares of the hotspots, one
                 per half hour of local solar time]}}
  exchange_rate_l3  Suomi NPP hotspots per Aqua hotspot per level 3 hexagon, 2013 to 2019: {years, min_aqua_per_year,
                 hexagons, world, weighted_geometric_mean, q05, q25, median, q75, q95, share_of_aqua_fire_covered_pct,
                 parts {years, min_aqua_per_year, hexagons, rate / rate_day / snpp_night_pct {q05, q25, q50, q75, q95},
                 spearman_rate_snpp_night, spearman_rate_snpp_weak_day, spearman_rate_day_snpp_weak_day,
                 spearman_rate_day_snpp_night, identity_max_error, countries: [{iso3, rate, rate_day, rate_night,
                 snpp_night, aqua_night, snpp_weak_day (%), aqua_per_year}]}, physics_tiles: [{tile, hexagons, rate,
                 rate_day, snpp_night_pct}]}
  fdr            {floor_per_year, floor_year_band / below_floor_year_band {from, to, below_pct, above_pct} (the 90%
                 range of a modelled year at and just below the floor), why_floor,
                 l3, l4 (the tested hexagons), l3_all, l4_all (every hexagon, no floor): {hexagons, raw_005, bh_005,
                 bh_010, by_005: {rising, falling, flat, rising_pct, falling_pct}, p_cut_005, p_cut_010 (the largest p
                 that passes), expected_false_raw, p_rounded_to, fall_per_rise_bh_005, fall_per_rise_by_005,
                 mean_per_year_sum},
                 floors_l3, floors_l4: [{floor_per_year, tested, share_of_fire_pct, bh_005, fall_per_rise}],
                 classes_l3: [{min_per_year, max_per_year, hexagons, share_of_fire_pct, falling, rising (no floor),
                 h_per_modis_model_years, h_per_modis_viirs_years, h_per_modis_change_pct, with_modis_only_trend,
                 same_sign_as_modis_only_pct}],
                 modis_check_l3 {tested, all: {years, hexagons, harmonized {falling, rising}, modis_only {falling,
                 rising}, same_sign_pct, harmonized_significant_same_sign_pct, both_significant,
                 both_significant_opposite}},
                 spatial_l3 {moran_i, moran_p, permutations, variable, pairs, mean_neighbours,
                 significant_with_same_sign_neighbour_pct}, l3_vs_l4 {l4_with_parent_trend, l4_with_parent_trend_pct,
                 same_sign_pct, both_significant, both_significant_same_sign_pct, l3_significant_pct,
                 l3_raw_significant_pct, l4_significant_pct, l4_raw_significant_pct}, l3_by_country: [{iso3, name,
                 hexagons, rising, falling, rising_pct, falling_pct}], l3_by_continent {<continent>: {hexagons,
                 falling_pct, rising_pct}}} (spatial_l3 to l3_by_continent: tested hexagons only)
                 (raw_005: p below 0.05; bh: Benjamini and Hochberg at 5% and 10%; by: Benjamini and Yekutieli at 5%;
                 flat: significant with a Sen's slope of 0, counted as neither)
  places         {floor_per_year, max_barren_share, q, floor_year_band, below_floor_year_band, why_floor,
                 countries / states: {with_trend, tested, share_of_world_fire_pct, left_out_barren: [{id, name,
                 barren_pct}], raw_005, bh_005, bh_010, rising: [...], falling: [...], median_cv_pct, floors:
                 [{floor_per_year, tested, share_of_world_fire_pct, bh_005}]}}, ranked rows {kind, id, name, local_name,
                 iso3, continent, mean_per_year, pct_per_decade, p, q}: the 10 fastest of each sign among the places
                 with q <= 0.05
  sensitivity    {base_periods: [[2001, 2025], [2003, 2025], [2012, 2025]], places: [{kind, id, name, trends: [{years,
                 pct_per_decade, p, trend}] (one per base period), modis_only: [...] (2001 and 2003 to 2025),
                 mean_per_year {2001_2007, 2012_2025}, top_years}], harmonized_vs_modis {years, countries,
                 same_sign_pct, spearman, pearson_log, median_difference_pct_points, h_significant,
                 h_significant_same_sign_pct, both_significant, both_significant_opposite, world {h, modis: {pct_per_decade,
                 p}}, rows: [{iso3, name, continent, h_pct, h_p, modis_pct, modis_p}]}, harmonized_vs_modis_2003_2025
                 and _2003_2021 (the same without rows), world_h_per_modis_by_year {year: ratio},
                 world_h_per_modis_mean {2001_2002, 2003_2012, 2013_2019, 2025}, world_h_per_modis_change_2012_2021_pct,
                 snpp_below_modis_limit_pct_by_year {year: pct}}
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

from . import analytics as A
from . import config as C
from . import publish as PB

SATS = ["Terra", "Aqua", "Suomi-NPP", "NOAA-20", "NOAA-21"]
SAT_ID = {"Terra": "terra", "Aqua": "aqua", "Suomi-NPP": "snpp", "NOAA-20": "noaa20", "NOAA-21": "noaa21"}
SAT_LABEL = {"Terra": "MODIS Terra", "Aqua": "MODIS Aqua", "Suomi-NPP": "VIIRS Suomi NPP", "NOAA-20": "VIIRS NOAA-20",
             "NOAA-21": "VIIRS NOAA-21"}
FAMILY = {"Terra": "MODIS", "Aqua": "MODIS", "Suomi-NPP": "VIIRS", "NOAA-20": "VIIRS", "NOAA-21": "VIIRS"}
FB = 0.02                              # width of an FRP bin in log10(MW)
MODIS_LIMIT = {"D": 10.0, "N": 2.0}    # FRP where MODIS sees half of the fires VIIRS sees (physics.py, fig19)
OVERLAP = (2013, 2019)                 # Terra, Aqua and Suomi NPP all fly, both MODIS orbits at their set times
LAST_FULL = 2025
TYPE_NAME = {0: "vegetation", 1: "volcano", 2: "static", 3: "offshore", -1: "unlabelled"}
Q = (0.05, 0.10)
PLACE_FLOOR = 1000                     # mean hotspots per year (NOAA-20 scale) for a place to be ranked
FLOOR_CHECKS = (300, 1000, 3000)
HEX_FLOOR = 100                        # mean hotspots per year for a map hexagon's trend to be tested (see hex_classes)
HEX_FLOOR_CHECKS = (0, 10, 30, 100, 300)
HEX_CLASSES = (0, 10, 30, 100, 300, 1000)
ERAS = {"modis": (2003, 2011), "viirs": (2013, 2021)}   # Terra and Aqua model years, VIIRS years before the drift
BASE_PERIODS = [(2001, 2025), (2003, 2025), (2012, 2025)]
KEY_PLACES = [("world", "WORLD"), ("continent", "Africa"), ("continent", "Asia"), ("continent", "South America"),
              ("continent", "North America"), ("continent", "Europe"), ("continent", "Oceania"), ("country", "BRA"),
              ("country", "IND"), ("country", "IDN"), ("country", "CAN"), ("country", "AUS"), ("country", "USA"),
              ("country", "RUS"), ("country", "MYS"), ("state", "IDN-1931")]          # IDN-1931: Central Kalimantan


def out(*parts: str) -> Path:
    p = PB.products("eda", *parts)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _con():
    con = C.connect()
    con.execute("SET memory_limit = '1GB'")
    con.execute("SET threads = 2")
    con.execute("SET preserve_insertion_order = false")
    return con


# ------------------------------------------------------------------------------------------------- 1. the scan
GROUPS = {
    "profile": ["cont", "sat", "yr", "dn", "conf", "typ", "q", "cnt", "s10", "sdet"],
    "frp": ["cont", "sat", "yr", "dn", "cnt", "fb"],
    "overpass": ["sat", "yr", "dn", "tb"],
}
ALL_KEYS = ["cont", "sat", "yr", "dn", "conf", "typ", "q", "cnt", "fb", "tb", "s10", "sdet"]


def _scan_sql(path: str) -> str:
    sets = ", ".join("(" + ", ".join(k) + ")" for k in GROUPS.values())
    return f"""
    WITH x AS (
      SELECT coalesce(l.cont, 'Other') AS cont, h.satellite AS sat, year(h.date)::INT AS yr, h.daynight AS dn,
             h.confidence AS conf, coalesce(h.type, -1)::INT AS typ, h.quality AS q, h.counted AS cnt,
             CASE WHEN h.frp IS NULL OR h.frp <= 0 THEN -999 ELSE floor(log10(h.frp) / {FB})::INT END AS fb,
             ((((h.time // 100) * 60 + h.time % 100 + h.lon * 4 + 1440)::INT % 1440) // 10)::INT AS tb,
             h.frp < 10 AS s10,
             (h.daynight = 'D' AND h.frp < {MODIS_LIMIT['D']}) OR (h.daynight = 'N' AND h.frp < {MODIS_LIMIT['N']}) AS sdet,
             h.frp
      FROM read_parquet('{path}') h LEFT JOIN lut l ON l.h3_5 = h.h3_5)
    SELECT GROUPING({", ".join(ALL_KEYS)}) AS g, {", ".join(ALL_KEYS)}, count(*) AS n, sum(frp) AS frp_sum
    FROM x GROUP BY GROUPING SETS ({sets})"""


def _gid(keys: list[str]) -> int:
    """DuckDB's GROUPING() value of a grouping set: one bit per key of ALL_KEYS (first key = highest bit), 1 = not grouped."""
    return sum(1 << (len(ALL_KEYS) - 1 - i) for i, k in enumerate(ALL_KEYS) if k not in keys)


def scan(log=print, rescan: bool = False) -> dict:
    """The three groupings of every hotspot (see the module notes), cached in eda/scan_*.parquet."""
    files = {name: out(f"scan_{name}.parquet") for name in GROUPS}
    if not rescan and all(f.exists() for f in files.values()):
        return {name: str(f) for name, f in files.items()}
    C.require_free_space()
    con = _con()
    con.execute(f"""CREATE OR REPLACE TEMP TABLE lut AS
                    SELECT h3 AS h3_5, coalesce(continent, 'Other') AS cont FROM '{PB.products('cells.parquet')}'""")
    paths = sorted(PB.products("hotspots").glob("l1=*.parquet"))
    acc: dict[str, list[pd.DataFrame]] = {name: [] for name in GROUPS}
    gid = {name: _gid(keys) for name, keys in GROUPS.items()}
    t0, rows = time.time(), 0

    def compact():
        for name, keys in GROUPS.items():
            if len(acc[name]) > 1:
                d = pd.concat(acc[name], ignore_index=True)
                acc[name] = [d.groupby(keys, dropna=False, as_index=False)[["n", "frp_sum"]].sum()]

    for i, p in enumerate(paths):
        d = con.execute(_scan_sql(str(p))).df()
        for name, keys in GROUPS.items():
            acc[name].append(d.loc[d.g == gid[name], keys + ["n", "frp_sum"]])
        rows += int(d.loc[d.g == gid["overpass"], "n"].sum())
        if (i + 1) % 25 == 0:
            compact()
            log(f"eda scan: {i + 1}/{len(paths)} files, {rows:,} hotspots at {time.time() - t0:.0f} s")
    compact()
    for name, keys in GROUPS.items():
        d = acc[name][0]
        for k in ("yr", "typ", "fb", "tb"):
            if k in d:
                d[k] = d[k].astype("int32")
        with C.atomic(files[name]) as tmp:
            d.to_parquet(tmp, index=False)
    con.close()
    log(f"eda scan: {rows:,} hotspots in {time.time() - t0:.0f} s")
    return {name: str(f) for name, f in files.items()}


def load(name: str) -> pd.DataFrame:
    return pd.read_parquet(out(f"scan_{name}.parquet"))


def _frp_exact_sql(path: str) -> str:
    full = " ".join(f"WHEN '{s}' THEN year(date) BETWEEN {a} AND {b}" for s, (a, b) in FULL_YEARS.items())
    return f"""
    SELECT satellite AS sat, daynight AS dn, CAST(round(frp * 100) AS INTEGER) AS k,
           count(*) FILTER (WHERE CASE satellite {full} ELSE false END) AS n_full,
           count(*) FILTER (WHERE year(date) BETWEEN {OVERLAP[0]} AND {OVERLAP[1]}) AS n_overlap
    FROM read_parquet('{path}') WHERE counted AND frp > 0 GROUP BY ALL"""


def scan_frp_exact(log=print, rescan: bool = False) -> pd.DataFrame:
    """Counted hotspots per satellite, day or night and reported FRP (in 0.01 MW: FIRMS gives MODIS FRP to 0.1 MW and
    VIIRS FRP to 0.01 MW, so this histogram is exact), in each satellite's full calendar years and in 2013 to 2019. Its
    quantiles are exact, where the log bins of scan_frp (4.7% wide) need interpolation. A hash aggregate per region
    file, cached in eda/scan_frp_exact.parquet."""
    f = out("scan_frp_exact.parquet")
    if f.exists() and not rescan:
        return pd.read_parquet(f)
    C.require_free_space()
    con = _con()
    paths = sorted(PB.products("hotspots").glob("l1=*.parquet"))
    acc, t0 = [], time.time()
    for i, p in enumerate(paths):
        acc.append(con.execute(_frp_exact_sql(str(p))).df())
        if (i + 1) % 50 == 0:
            acc = [pd.concat(acc, ignore_index=True).groupby(["sat", "dn", "k"], as_index=False)[["n_full", "n_overlap"]].sum()]
        if (i + 1) % 100 == 0:
            log(f"eda FRP scan: {i + 1}/{len(paths)} files at {time.time() - t0:.0f} s")
    con.close()
    d = pd.concat(acc, ignore_index=True).groupby(["sat", "dn", "k"], as_index=False)[["n_full", "n_overlap"]].sum()
    d = d[(d.n_full > 0) | (d.n_overlap > 0)]
    with C.atomic(f) as tmp:
        d.to_parquet(tmp, index=False)
    log(f"eda FRP scan: {int(d.n_full.sum()):,} hotspots in full years, {time.time() - t0:.0f} s")
    return d


def exact_quantiles(d: pd.DataFrame, col: str) -> dict:
    """Quantiles of the reported FRP (MW) from the exact histogram: the smallest value with at least a share q of the
    hotspots at or below it."""
    h = d.groupby("k")[col].sum().sort_index()
    h = h[h > 0]
    c = h.cumsum().to_numpy() / h.sum()
    return {name: _r(h.index[int(np.searchsorted(c, q - 1e-12))] / 100, 2) for name, q in QS.items()}


def _hex_sql(path: str) -> str:
    a, b = OVERLAP
    return f"""
    SELECT h3_cell_to_parent(h.h3_5, 3) AS h3, l.iso3 AS iso3, h.satellite AS sat, h.daynight AS dn,
           (h.daynight = 'D' AND h.frp < {MODIS_LIMIT['D']}) OR (h.daynight = 'N' AND h.frp < {MODIS_LIMIT['N']}) AS sdet,
           count(*) AS n, sum(h.frp) AS frp_sum
    FROM read_parquet('{path}') h LEFT JOIN lut2 l ON l.h3_5 = h.h3_5
    WHERE h.counted AND h.satellite IN ('Aqua', 'Suomi-NPP') AND h.date BETWEEN DATE '{a}-01-01' AND DATE '{b}-12-31'
    GROUP BY ALL"""


def scan_hex(log=print, rescan: bool = False) -> pd.DataFrame:
    """Aqua and Suomi NPP hotspots that the record counts, 2013 to 2019, per level 3 hexagon and country, by day or
    night, and below the MODIS limit or not: what sets the exchange rate from place to place. One pass of plain
    aggregates per region file (the date filter skips most row groups), cached in eda/scan_hex.parquet."""
    f = out("scan_hex.parquet")
    if f.exists() and not rescan:
        return pd.read_parquet(f)
    C.require_free_space()
    con = _con()
    con.execute(f"CREATE OR REPLACE TEMP TABLE lut2 AS SELECT h3 AS h3_5, iso3 FROM '{PB.products('cells.parquet')}'")
    paths = sorted(PB.products("hotspots").glob("l1=*.parquet"))
    parts, t0 = [], time.time()
    for i, p in enumerate(paths):
        parts.append(con.execute(_hex_sql(str(p))).df())
        if (i + 1) % 100 == 0:
            log(f"eda hexagon scan: {i + 1}/{len(paths)} files at {time.time() - t0:.0f} s")
    con.close()
    keys = ["h3", "iso3", "sat", "dn", "sdet"]
    d = pd.concat(parts, ignore_index=True).groupby(keys, dropna=False, as_index=False)[["n", "frp_sum"]].sum()
    with C.atomic(f) as tmp:
        d.to_parquet(tmp, index=False)
    log(f"eda hexagon scan: {int(d.n.sum()):,} hotspots in {time.time() - t0:.0f} s")
    return d


# ------------------------------------------------------------------------------------------------- 2. the raw record
FULL_YEARS = {"Terra": (2001, 2025), "Aqua": (2003, 2025), "Suomi-NPP": (2013, 2025), "NOAA-20": (2019, 2025),
              "NOAA-21": (2024, 2025)}     # each satellite's full calendar years (NOAA-21 is near real time only)


def _r(v, d=2):
    if v is None:
        return None
    f = float(v)
    return None if not np.isfinite(f) else round(f, d)


def _pct(part, whole, d=3):
    return _r(100 * part / whole, d) if whole else None


def hist_quantiles(h: pd.Series, qs) -> dict:
    """Quantiles of FRP from a histogram (index fb, values n): log linear inside the bin."""
    h = h[h.index > -999].groupby(level=0).sum().sort_index()
    c = (h.cumsum() / h.sum()).to_numpy()
    fb = h.index.to_numpy()
    out = {}
    for q in qs:
        k = int(np.searchsorted(c, q))
        prev = c[k - 1] if k > 0 else 0.0
        out[q] = float(10 ** ((fb[k] + (q - prev) / (c[k] - prev)) * FB))
    return out


QS = {"p10": 0.10, "p25": 0.25, "p50": 0.50, "p75": 0.75, "p90": 0.90, "p99": 0.99}


def _small(d: pd.DataFrame) -> tuple:
    known = d[d.s10.notna()]
    return _pct(known[known.s10 == True].n.sum(), known.n.sum()), _pct(known[known.sdet == True].n.sum(), known.n.sum())


def sensors(profile: pd.DataFrame, fx: pd.DataFrame) -> list[dict]:
    """One card per satellite over its full calendar years. FRP statistics are of the hotspots the record counts, from
    the exact FRP histogram."""
    rows = []
    for s, (a, b) in FULL_YEARS.items():
        d = profile[(profile.sat == s) & profile.yr.between(a, b)]
        c = d[d.cnt == True]
        n = d.n.sum()
        s10, sdet = _small(c)
        f = fx[fx.sat == s]
        rows.append({
            "id": SAT_ID[s], "label": SAT_LABEL[s], "family": FAMILY[s], "years": [a, b], "hotspots": int(n),
            "hotspots_per_year": int(round(n / (b - a + 1))), "counted_pct": _pct(c.n.sum(), n),
            "frp_q": exact_quantiles(f, "n_full"), "frp_q_day": exact_quantiles(f[f.dn == "D"], "n_full"),
            "frp_q_night": exact_quantiles(f[f.dn == "N"], "n_full"),
            "below_10mw_pct": s10, "below_modis_limit_pct": sdet,
            "day_pct": _pct(d[d.dn == "D"].n.sum(), n), "night_pct": _pct(d[d.dn == "N"].n.sum(), n),
            "counted_night_pct": _pct(c[c.dn == "N"].n.sum(), c.n.sum()),
            "confidence_pct": {k: _pct(d[d.conf == k].n.sum(), n) for k in ("low", "nominal", "high")},
            "type_pct": {nm: _pct(d[d.typ == t].n.sum(), n) for t, nm in TYPE_NAME.items()},
            "static_labels_pct": _pct(d[d.typ.isin([1, 2, 3])].n.sum(), n),
            "near_real_time_pct": _pct(d[d.q == "nrt"].n.sum(), n),
            "frp_per_hotspot_mw": _r(c.frp_sum.sum() / c.n.sum(), 1)})
    return rows


def overlap(profile: pd.DataFrame, fx: pd.DataFrame) -> dict:
    """Terra, Aqua and Suomi NPP in the same years (2013 to 2019): the like for like comparison."""
    a, b = OVERLAP
    ny = b - a + 1
    p = profile[profile.yr.between(a, b) & (profile.cnt == True)]
    out = {"years": [a, b], "modis_limit_mw": {"day": MODIS_LIMIT["D"], "night": MODIS_LIMIT["N"]}, "sensors": []}
    tot = {}
    for s in ("Terra", "Aqua", "Suomi-NPP"):
        d = p[p.sat == s]
        tot[s] = (d.n.sum(), d.frp_sum.sum())
        row = {"id": SAT_ID[s], "label": SAT_LABEL[s], "hotspots_per_year": int(round(d.n.sum() / ny)),
               "frp_gw_per_year": _r(d.frp_sum.sum() / ny / 1e3, 1)}
        for dn, nm in (("D", "day"), ("N", "night")):
            x = d[d.dn == dn]
            s10, sdet = _small(x)
            row[nm] = {"hotspots_per_year": int(round(x.n.sum() / ny)), "below_10mw_pct": s10, "below_modis_limit_pct": sdet,
                       "frp_p50": exact_quantiles(fx[(fx.sat == s) & (fx.dn == dn)], "n_overlap")["p50"]}
        row["below_10mw_pct"], row["below_modis_limit_pct"] = _small(d)
        row["night_pct"] = _pct(d[d.dn == "N"].n.sum(), d.n.sum())
        out["sensors"].append(row)
    out["snpp_per_aqua"] = {"hotspots": _r(tot["Suomi-NPP"][0] / tot["Aqua"][0], 4),
                            "frp": _r(tot["Suomi-NPP"][1] / tot["Aqua"][1], 4),
                            "day_hotspots": _r(p[(p.sat == "Suomi-NPP") & (p.dn == "D")].n.sum() / p[(p.sat == "Aqua") & (p.dn == "D")].n.sum(), 4),
                            "night_hotspots": _r(p[(p.sat == "Suomi-NPP") & (p.dn == "N")].n.sum() / p[(p.sat == "Aqua") & (p.dn == "N")].n.sum(), 4)}
    conts = []
    for cont, g in p[~p.cont.isin(["Other", "Antarctica", "Seven seas (open ocean)"])].groupby("cont"):
        sn, aq = g[g.sat == "Suomi-NPP"], g[g.sat == "Aqua"]
        conts.append({"continent": cont, "snpp_per_aqua": _r(sn.n.sum() / aq.n.sum(), 4),
                      "snpp_per_aqua_day": _r(sn[sn.dn == "D"].n.sum() / aq[aq.dn == "D"].n.sum(), 4),
                      "snpp_per_aqua_night": _r(sn[sn.dn == "N"].n.sum() / aq[aq.dn == "N"].n.sum(), 4),
                      "snpp_frp_per_aqua_frp": _r(sn.frp_sum.sum() / aq.frp_sum.sum(), 4),
                      "snpp_below_modis_limit_pct": _small(sn)[1], "aqua_below_modis_limit_pct": _small(aq)[1],
                      "snpp_night_pct": _pct(sn[sn.dn == "N"].n.sum(), sn.n.sum()),
                      "aqua_night_pct": _pct(aq[aq.dn == "N"].n.sum(), aq.n.sum())})
    out["by_continent"] = sorted(conts, key=lambda r: -r["snpp_per_aqua"])
    return out


HIST_STEP = 5            # the app's histogram: 5 scan bins = 0.1 in log10 (FRP x 1.26 per bin)


def frp_hist(frp: pd.DataFrame) -> dict:
    """Hotspots per year in FRP bins of 0.1 log10, 2013 to 2019, counted hotspots, day and night (for the figure and app)."""
    a, b = OVERLAP
    f = frp[frp.yr.between(a, b) & (frp.cnt == True) & (frp.fb > -999)].copy()
    f["hb"] = f.fb // HIST_STEP
    lo, hi = -10, 36                                  # 0.1 MW to 4,000 MW
    f["hb"] = f.hb.clip(lo, hi - 1)
    edges = [_r(10 ** (k * HIST_STEP * FB), 3) for k in range(lo, hi + 1)]
    out = {"years": [a, b], "bin_edges_mw": edges, "sensors": {}}
    for s in ("Terra", "Aqua", "Suomi-NPP"):
        out["sensors"][SAT_ID[s]] = {nm: (f[(f.sat == s) & (f.dn == dn)].groupby("hb").n.sum().reindex(range(lo, hi), fill_value=0)
                                         / (b - a + 1)).round(1).tolist() for dn, nm in (("D", "day"), ("N", "night"))}
    return out


def _median_time(d: pd.DataFrame, night: bool) -> float | None:
    """Median local solar time (hours) of 10 minute bins; night bins are turned by 12 hours so they do not wrap."""
    if d.n.sum() == 0:
        return None
    tb = (d.tb + 72) % 144 if night else d.tb
    h = d.n.groupby(tb.to_numpy()).sum().sort_index()
    c = (h.cumsum() / h.sum()).to_numpy()
    k = int(np.searchsorted(c, 0.5))
    prev = c[k - 1] if k > 0 else 0.0
    t = (h.index[k] + (0.5 - prev) / (c[k] - prev)) / 6
    return float((t + 12) % 24 if night else t)


NOMINAL_UNTIL = 2020       # the last year both MODIS orbits kept their set hours


def overpass(ov: pd.DataFrame) -> dict:
    out = {"sensors": {}, "hour_share_2013_2019": {}}
    a, b = OVERLAP
    for s in SATS:
        d = ov[ov.sat == s]
        fy = FULL_YEARS[s]
        by_year = [{"yr": int(y), "day_median_local": _r(_median_time(g[g.dn == "D"], False), 3),
                    "night_median_local": _r(_median_time(g[g.dn == "N"], True), 3)} for y, g in d.groupby("yr")]
        last = min(fy[1], NOMINAL_UNTIL) if FAMILY[s] == "MODIS" else fy[1]      # before the MODIS orbits drift
        nominal = d[d.yr.between(fy[0], last)]
        out["sensors"][SAT_ID[s]] = {"day_median_local": _r(_median_time(nominal[nominal.dn == "D"], False), 3),
                                     "night_median_local": _r(_median_time(nominal[nominal.dn == "N"], True), 3),
                                     "years_for_median": [fy[0], last], "by_year": by_year}
        w = d[d.yr.between(a, b)]
        if w.n.sum():
            hs = w.groupby(w.tb // 3).n.sum().reindex(range(48), fill_value=0)    # 30 minute bins
            out["hour_share_2013_2019"][SAT_ID[s]] = (100 * hs / hs.sum()).round(3).tolist()
    return out


def ratio_l3(con) -> pd.DataFrame:
    """Suomi NPP and Aqua hotspots (counted) per level 3 hexagon, 2013 to 2019, from map_l3.parquet."""
    a, b = OVERLAP
    return con.execute(f"""SELECT h3, sum(s)::DOUBLE / {b - a + 1} AS snpp, sum(a)::DOUBLE / {b - a + 1} AS aqua
                           FROM '{PB.products('map_l3.parquet')}' WHERE yr BETWEEN {a} AND {b} GROUP BY h3""").df()


def snpp_where_modis_saw_none(con) -> dict:
    """Share of the Suomi NPP hotspots that fall in level 5 hexagon months where neither Terra nor Aqua saw a fire:
    fire that no exchange rate applied to MODIS can recover. Whole overlap and each year, from the l5 product."""
    a, b = OVERLAP
    d = con.execute(f"""SELECT yr, sum(s)::DOUBLE AS s, sum(CASE WHEN coalesce(t, 0) + coalesce(a, 0) = 0 THEN s ELSE 0 END)::DOUBLE AS lone
                        FROM read_parquet('{PB.products('l5')}/*/*.parquet') WHERE yr BETWEEN 2012 AND {LAST_FULL} AND s > 0
                        GROUP BY yr""").df().set_index("yr").sort_index()
    o = d.loc[a:b]
    return {"years": [a, b], "pct": _pct(o.lone.sum(), o.s.sum(), 1),
            "by_year": {int(y): _pct(r.lone, r.s, 1) for y, r in d.iterrows()}}


def harmonized_where_modis_saw_none(con) -> dict:
    """Share of the harmonized record that sits in level 5 hexagon months where neither MODIS satellite saw a fire: in
    the model years this fire is the model's estimate of what MODIS misses, in the VIIRS years it is observed. If the
    model is right on average, the two shares are close."""
    a, b = A.BASE_YEARS
    d = con.execute(f"""SELECT yr, sum(h)::DOUBLE AS h, sum(CASE WHEN coalesce(t, 0) + coalesce(a, 0) = 0 THEN h ELSE 0 END)::DOUBLE AS lone
                        FROM read_parquet('{PB.products('l5')}/*/*.parquet') WHERE yr BETWEEN {a} AND {b}
                        GROUP BY yr""").df().set_index("yr").sort_index()
    share = lambda x: _pct(x.lone.sum(), x.h.sum(), 2)
    return {"model_years": list(ERAS["modis"]), "model_pct": share(d.loc[slice(*ERAS["modis"])]),
            "viirs_years": list(ERAS["viirs"]), "viirs_pct": share(d.loc[slice(*ERAS["viirs"])]),
            "by_year": {int(y): _pct(r.lone, r.h, 2) for y, r in d.iterrows()}}


RATIO_MIN_AQUA = 20      # Aqua hotspots per year a hexagon needs for its ratio to be shown (about 3 in 10 noise at 7 years)


def ratio_summary(r: pd.DataFrame) -> dict:
    x = r[r.aqua >= RATIO_MIN_AQUA].copy()
    x["ratio"] = x.snpp / x.aqua
    w = np.average(np.log(x.ratio), weights=x.aqua)
    q = x.ratio.quantile([0.05, 0.25, 0.5, 0.75, 0.95])
    return {"years": list(OVERLAP), "min_aqua_per_year": RATIO_MIN_AQUA, "hexagons": int(len(x)),
            "world": _r(r.snpp.sum() / r.aqua.sum(), 4), "weighted_geometric_mean": _r(np.exp(w), 4),
            "q05": _r(q[0.05], 4), "q25": _r(q[0.25], 4), "median": _r(q[0.5], 4), "q75": _r(q[0.75], 4), "q95": _r(q[0.95], 4),
            "share_of_aqua_fire_covered_pct": _pct(x.aqua.sum(), r.aqua.sum())}


def _rate_columns(hx: pd.DataFrame, by: str) -> pd.DataFrame:
    """Per group: Aqua and Suomi NPP hotspots by day and night, and Suomi NPP hotspots below the MODIS limit by day."""
    g = hx.dropna(subset=[by])
    w = g.pivot_table(index=by, columns=["sat", "dn"], values="n", aggfunc="sum", fill_value=0)
    w.columns = [f"{'s' if s == 'Suomi-NPP' else 'a'}{dn}" for s, dn in w.columns]
    w = w.reindex(columns=["aD", "aN", "sD", "sN"], fill_value=0).astype(float)
    weak = g[(g.sat == "Suomi-NPP") & (g.dn == "D") & (g.sdet == True)].groupby(by).n.sum()
    w["sDw"] = weak.reindex(w.index, fill_value=0).astype(float)
    ny = OVERLAP[1] - OVERLAP[0] + 1
    w["aqua_per_year"] = (w.aD + w.aN) / ny
    w["rate"] = (w.sD + w.sN) / (w.aD + w.aN).where(w.aD + w.aN > 0)
    w["rate_day"] = w.sD / w.aD.where(w.aD > 0)
    w["rate_night"] = w.sN / w.aN.where(w.aN > 0)
    w["snpp_night"] = w.sN / (w.sD + w.sN).where(w.sD + w.sN > 0)
    w["aqua_night"] = w.aN / (w.aD + w.aN).where(w.aD + w.aN > 0)
    w["snpp_weak_day"] = w.sDw / w.sD.where(w.sD > 0)
    return w


RATE_PLACES = ["IND", "RUS", "CAN", "USA", "BRA", "COD", "AGO", "ZMB", "AUS", "IDN", "KAZ", "MEX"]


def rate_parts(hx: pd.DataFrame) -> dict:
    """What sets the exchange rate. The rate R of a place splits exactly into its day rate and a night factor,
    R = R_day (1 - night share of Aqua) / (1 - night share of Suomi NPP): Suomi NPP adds far more night hotspots than
    Aqua. Across the level 3 hexagons with at least RATIO_MIN_AQUA Aqua hotspots a year we compare the spread of R and
    of R_day, and the rank correlations of R with the night share and with the share of weak fires by day."""
    from scipy.stats import spearmanr
    h = _rate_columns(hx, "h3")
    h = h[h.aqua_per_year >= RATIO_MIN_AQUA]
    rho = lambda a, b: _r(spearmanr(h[a], h[b], nan_policy="omit").statistic, 3)
    qs = lambda c: {f"q{int(round(100 * q)):02d}": _r(h[c].quantile(q), 4) for q in (0.05, 0.25, 0.5, 0.75, 0.95)}
    ident = h.rate_day * (1 - h.aqua_night) / (1 - h.snpp_night)
    c = _rate_columns(hx, "iso3")
    rows = [{"iso3": iso, **{k: _r(c.loc[iso, k], 4) for k in ("rate", "rate_day", "rate_night")},
             **{k: _r(100 * c.loc[iso, k], 2) for k in ("snpp_night", "aqua_night", "snpp_weak_day")},
             "aqua_per_year": int(round(c.loc[iso, "aqua_per_year"]))} for iso in RATE_PLACES if iso in c.index]
    return {"years": list(OVERLAP), "min_aqua_per_year": RATIO_MIN_AQUA, "hexagons": int(len(h)),
            "rate": qs("rate"), "rate_day": qs("rate_day"), "snpp_night_pct": {k: _r(100 * v, 2) for k, v in qs("snpp_night").items()},
            "spearman_rate_snpp_night": rho("rate", "snpp_night"), "spearman_rate_snpp_weak_day": rho("rate", "snpp_weak_day"),
            "spearman_rate_day_snpp_weak_day": rho("rate_day", "snpp_weak_day"),
            "spearman_rate_day_snpp_night": rho("rate_day", "snpp_night"),
            "identity_max_error": _r(float((ident / h.rate - 1).abs().max()), 6), "countries": rows}


def tile_rates(con, hx: pd.DataFrame) -> list[dict]:
    """The exchange rate on the 10 MODIS tiles of the physics test (physics.TILES), from the FIRMS counts of the level 3
    hexagons whose centre lies in the tile (sinusoidal grid: 10 degrees of latitude, 10 degrees of longitude x cos(lat))."""
    from . import physics as PH
    h = _rate_columns(hx, "h3")
    con.register("_tc", pd.DataFrame({"h3": list(h.index)}))
    c = con.execute("SELECT h3, h3_cell_to_lat(h3) AS lat, h3_cell_to_lng(h3) AS lon FROM _tc").df().set_index("h3")
    con.unregister("_tc")
    h = h.join(c)
    x = h.lon * np.cos(np.radians(h.lat))
    rows = []
    for t in PH.TILES:
        hh, vv = int(t[1:3]), int(t[4:6])
        m = h[(h.lat < 90 - 10 * vv) & (h.lat >= 80 - 10 * vv) & (x >= -180 + 10 * hh) & (x < -170 + 10 * hh)]
        s, a = m.sD.sum() + m.sN.sum(), m.aD.sum() + m.aN.sum()
        rows.append({"tile": t, "hexagons": int(len(m)), "rate": _r(s / a, 4) if a else None,
                     "rate_day": _r(m.sD.sum() / m.aD.sum(), 4) if m.aD.sum() else None,
                     "snpp_night_pct": _pct(m.sN.sum(), s, 2) if s else None})
    return rows


# ------------------------------------------------------------------------------------------------- 3. trend rigour
def bh_adjust(p) -> np.ndarray:
    """Benjamini and Hochberg adjusted p values: a test is a discovery at false discovery rate q when its value is <= q
    (the same decisions as analytics.fdr)."""
    p = np.asarray(p, float)
    n = len(p)
    if n == 0:
        return p
    o = np.argsort(p, kind="mergesort")
    adj = p[o] * n / np.arange(1, n + 1)
    adj = np.minimum.accumulate(adj[::-1])[::-1]
    out = np.empty(n)
    out[o] = np.minimum(adj, 1.0)
    return out


def by_adjust(p) -> np.ndarray:
    """Benjamini and Yekutieli: the same, made valid under any dependence between the tests (costs a factor sum 1/i)."""
    n = len(p)
    return np.minimum(bh_adjust(p) * np.sum(1.0 / np.arange(1, n + 1)), 1.0) if n else np.asarray(p, float)


def hex_fire(con, level: int) -> pd.DataFrame:
    """Each map hexagon's mean harmonized hotspots a year (2001 to 2025), and its harmonized and MODIS only totals in
    the model years and the VIIRS years (ERAS), from map_l{level}.parquet (the file the trends were computed from)."""
    a, b = A.BASE_YEARS
    (a1, b1), (a2, b2) = ERAS["modis"], ERAS["viirs"]
    return con.execute(f"""SELECT h3, sum(h) FILTER (WHERE yr BETWEEN {a} AND {b}) / {b - a + 1} AS mean_h,
                                  sum(h) FILTER (WHERE yr BETWEEN {a1} AND {b1}) AS h_model_years,
                                  sum(modis) FILTER (WHERE yr BETWEEN {a1} AND {b1}) AS modis_model_years,
                                  sum(h) FILTER (WHERE yr BETWEEN {a2} AND {b2}) AS h_viirs_years,
                                  sum(modis) FILTER (WHERE yr BETWEEN {a2} AND {b2}) AS modis_viirs_years
                           FROM '{PB.products(f"map_l{level}.parquet")}' GROUP BY h3""").df()


def hex_trends(level: int, con=None) -> pd.DataFrame:
    """The published hexagon trends (web/trend_l{level}.json) with each hexagon's mean fire. A hexagon is tested when it
    has at least HEX_FLOOR hotspots a year; q_bh and q_by are adjusted among the tested hexagons only (independent
    filtering: the mean does not depend on the order of the years, so it says nothing about a Mann Kendall trend), and
    q_bh_all among all hexagons, as a map without a floor would do."""
    t = json.loads(PB.products("web", f"trend_l{level}.json").read_text())
    d = pd.DataFrame({"h3": t["h3"], "pct": t["pct"], "p": t["p"]})
    d["q_bh_all"] = bh_adjust(d.p)
    if con is not None:
        d = d.merge(hex_fire(con, level), on="h3", how="left")
        d["mean_h"] = d.mean_h.fillna(0.0)
    else:
        d["mean_h"] = np.inf
    d["tested"] = d.mean_h >= HEX_FLOOR
    d["q_bh"], d["q_by"] = np.nan, np.nan
    d.loc[d.tested, "q_bh"] = bh_adjust(d.p[d.tested])
    d.loc[d.tested, "q_by"] = by_adjust(d.p[d.tested])
    return d


def _counts(d: pd.DataFrame, sig: pd.Series) -> dict:
    n = len(d)
    up, down = int((sig & (d.pct > 0)).sum()), int((sig & (d.pct < 0)).sum())
    return {"rising": up, "falling": down, "flat": int((sig & (d.pct == 0)).sum()),
            "rising_pct": _pct(up, n, 1), "falling_pct": _pct(down, n, 1)}


def fdr_summary(d: pd.DataFrame) -> dict:
    """Rising and falling hexagons of `d` under each rule; the adjustment runs over the rows of `d` only. flat: a
    significant trend whose Sen's slope is 0 (counted as neither)."""
    q_bh, q_by = pd.Series(bh_adjust(d.p), index=d.index), pd.Series(by_adjust(d.p), index=d.index)
    out = {"hexagons": int(len(d)), "raw_005": _counts(d, d.p < 0.05)}
    for q in Q:
        out[f"bh_{int(q * 100):03d}"] = _counts(d, q_bh <= q)
        out[f"p_cut_{int(q * 100):03d}"] = _r(d.p[q_bh <= q].max(), 4)
    out["by_005"] = _counts(d, q_by <= 0.05)
    out["expected_false_raw"] = int(round(0.05 * len(d)))
    out["p_rounded_to"] = 0.0001
    out["fall_per_rise_bh_005"] = _r(out["bh_005"]["falling"] / max(out["bh_005"]["rising"], 1), 2)
    out["fall_per_rise_by_005"] = _r(out["by_005"]["falling"] / max(out["by_005"]["rising"], 1), 2)
    if "mean_h" in d and np.isfinite(d.mean_h).all():
        out["mean_per_year_sum"] = _r(d.mean_h.sum(), 0)
    return out


def map_total(con, level: int) -> float:
    """Mean harmonized hotspots a year of the whole map (every hexagon, 2001 to 2025): the world, for fire shares."""
    a, b = A.BASE_YEARS
    return float(con.execute(f"SELECT sum(h) / {b - a + 1} FROM '{PB.products(f'map_l{level}.parquet')}' "
                             f"WHERE yr BETWEEN {a} AND {b}").fetchone()[0])


def hex_floors(d: pd.DataFrame, tot: float) -> list[dict]:
    """The false discovery count with other floors on the mean fire of a hexagon (the adjustment runs over the hexagons
    each floor keeps). tot: the map's total, so shares are of the world's fire."""
    rows = []
    for floor in HEX_FLOOR_CHECKS:
        k = d[d.mean_h >= floor]
        c = _counts(k, pd.Series(bh_adjust(k.p), index=k.index) <= 0.05)
        rows.append({"floor_per_year": floor, "tested": int(len(k)), "share_of_fire_pct": _pct(k.mean_h.sum(), tot, 2),
                     "bh_005": c, "fall_per_rise": _r(c["falling"] / max(c["rising"], 1), 2)})
    return rows


MODIS_CHECK_YEARS = (2003, 2025)      # both MODIS satellites fly; 2001 and 2002 of the MODIS only record are Terra scaled


def hex_modis_check(con, d3: pd.DataFrame) -> pd.DataFrame:
    """The trend of every level 3 hexagon in the harmonized record and in the MODIS only record (the column modis of
    map_l3), both 2003 to 2025, with the rules of the published trends (placestats.yearly_trend, at least five years
    with fire)."""
    from . import placestats as PS
    a, b = MODIS_CHECK_YEARS
    y = con.execute(f"""SELECT h3, yr::INT AS yr, sum(h) AS h, sum(coalesce(modis, 0)) AS m FROM '{PB.products('map_l3.parquet')}'
                        WHERE yr BETWEEN {a} AND {b} GROUP BY h3, yr""").df()
    y = y[y.h3.isin(set(d3.h3))]
    years = np.arange(a, b + 1)
    rows = []
    for h3, g in y.groupby("h3", sort=False):
        g = g.set_index("yr")[["h", "m"]].reindex(years, fill_value=0.0)
        res = []
        for col in ("h", "m"):
            v = g[col].to_numpy(float)
            t = PS.yearly_trend(v) if (v > 0).sum() >= 5 else None
            res += list(t) if t else [np.nan, np.nan]
        rows.append((h3, *res))
    return pd.DataFrame(rows, columns=["h3", "h_pct_0325", "h_p_0325", "m_pct_0325", "m_p_0325"])


def modis_check_summary(d: pd.DataFrame) -> dict:
    """Harmonized against MODIS only trends of the hexagons of `d` that have both, 2003 to 2025 (each record adjusted
    on its own)."""
    x = d.dropna(subset=["h_p_0325", "m_p_0325"])
    qh, qm = bh_adjust(x.h_p_0325) <= 0.05, bh_adjust(x.m_p_0325) <= 0.05
    same = (np.sign(x.h_pct_0325) == np.sign(x.m_pct_0325)).to_numpy()
    cnt = lambda sig, col: {"falling": int((sig & (x[col] < 0)).sum()), "rising": int((sig & (x[col] > 0)).sum())}
    return {"years": list(MODIS_CHECK_YEARS), "hexagons": int(len(x)), "harmonized": cnt(qh, "h_pct_0325"),
            "modis_only": cnt(qm, "m_pct_0325"), "same_sign_pct": _pct(same.sum(), len(x), 1),
            "harmonized_significant_same_sign_pct": _pct((same & qh).sum(), qh.sum(), 1),
            "both_significant": int((qh & qm).sum()), "both_significant_opposite": int((qh & qm & ~same).sum())}


def hex_classes(d: pd.DataFrame, tot: float) -> list[dict]:
    """Where the falls come from: level 3 hexagons by mean fire, with the false discovery control run on all of them
    (no floor), the harmonized hotspots for every MODIS hotspot in the model years and in the VIIRS years, and the sign
    agreement with the MODIS only record. Before 2012 the model gives every hexagon month a small expected value, also
    where MODIS saw nothing; after 2012 VIIRS observes and an empty month is 0. Where a hexagon has almost no fire, that
    small value is most of its record before 2012, so the harmonized record falls at 2012 there while MODIS does not."""
    sig = d.q_bh_all <= 0.05
    edges = list(HEX_CLASSES) + [np.inf]
    rows = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        x = d[(d.mean_h >= lo) & (d.mean_h < hi)]
        s = sig[x.index]
        r1 = x.h_model_years.sum() / x.modis_model_years.sum()
        r2 = x.h_viirs_years.sum() / x.modis_viirs_years.sum()
        both = x.dropna(subset=["h_pct_0325", "m_pct_0325"])
        rows.append({"min_per_year": lo, "max_per_year": None if hi == np.inf else hi, "hexagons": int(len(x)),
                     "share_of_fire_pct": _pct(x.mean_h.sum(), tot, 2),
                     "falling": int((s & (x.pct < 0)).sum()), "rising": int((s & (x.pct > 0)).sum()),
                     "h_per_modis_model_years": _r(r1, 4), "h_per_modis_viirs_years": _r(r2, 4),
                     "h_per_modis_change_pct": _r(100 * (r2 / r1 - 1), 2),
                     "with_modis_only_trend": int(len(both)),
                     "same_sign_as_modis_only_pct": _pct((np.sign(both.h_pct_0325) == np.sign(both.m_pct_0325)).sum(), len(both), 1)})
    return rows


def signed_z(d: pd.DataFrame) -> np.ndarray:
    """The trend as a signed normal score: + for rising, - for falling, larger when p is smaller (p is two sided)."""
    from scipy.stats import norm
    return np.sign(d.pct.to_numpy()) * norm.isf(np.clip(d.p.to_numpy(), 5e-5, 1.0) / 2)


def neighbours(con, hexes) -> tuple[np.ndarray, np.ndarray]:
    """Pairs (i, j) of hexagons in the list that share an edge (both directions)."""
    con.register("_hx", pd.DataFrame({"h3": list(hexes), "i": np.arange(len(hexes))}))
    e = con.execute("""WITH k AS (SELECT i, unnest(h3_grid_disk(h3, 1)) AS nb FROM _hx)
                       SELECT k.i, x.i AS j FROM k JOIN _hx x ON x.h3 = k.nb WHERE x.i <> k.i""").fetchnumpy()
    con.unregister("_hx")
    return e["i"].astype(np.int64), e["j"].astype(np.int64)


def morans_i(z: np.ndarray, i: np.ndarray, j: np.ndarray, perms: int = 999, seed: int = 7) -> tuple[float, float]:
    """Moran's I with binary weights (1 for neighbours), and its one sided permutation p value."""
    zc = z - z.mean()
    s0, n, den = len(i), len(z), float((zc ** 2).sum())
    stat = lambda v: n / s0 * float((v[i] * v[j]).sum()) / den
    obs = stat(zc)
    rng = np.random.default_rng(seed)
    hits = sum(stat(rng.permutation(zc)) >= obs for _ in range(perms))
    return obs, (hits + 1) / (perms + 1)


def spatial(con, d3: pd.DataFrame) -> dict:
    """How strongly neighbouring level 3 trends agree (the reason the hexagon tests are not independent). d3: the tested
    hexagons, with q_bh adjusted among them."""
    d3 = d3.reset_index(drop=True)
    i, j = neighbours(con, d3.h3)
    z = signed_z(d3)
    mi, mp = morans_i(z, i, j)
    sig = (d3.q_bh <= 0.05).to_numpy()
    sgn = np.sign(d3.pct.to_numpy()) * sig
    has_nb = np.bincount(i, minlength=len(d3)) > 0
    same = np.zeros(len(d3), bool)
    np.logical_or.at(same, i, (sgn[i] != 0) & (sgn[i] == sgn[j]))
    return {"moran_i": _r(mi, 3), "moran_p": _r(mp, 4), "permutations": 999, "variable": "signed normal score of the trend",
            "pairs": int(len(i) // 2), "mean_neighbours": _r(len(i) / max(has_nb.sum(), 1), 2),
            "significant_with_same_sign_neighbour_pct": _pct((same & sig).sum(), sig.sum(), 1)}


def l3_by_country(con, d3: pd.DataFrame, min_hexagons: int = 40) -> list[dict]:
    """Rising and falling level 3 hexagons (false discovery rate 5%) per country (the country of most of its level 5
    hexagons), for countries with at least `min_hexagons` hexagons with a trend."""
    m = con.execute(f"""SELECT h3_cell_to_parent(h3, 3) AS h3, mode(iso3) AS iso3, mode(country) AS country
                        FROM '{PB.products('cells.parquet')}' GROUP BY 1""").df()
    d = d3.merge(m, on="h3", how="left")
    sig = d.q_bh <= 0.05
    d["up"], d["down"] = sig & (d.pct > 0), sig & (d.pct < 0)
    g = d.dropna(subset=["iso3"]).groupby(["iso3", "country"])[["up", "down"]].agg(["sum", "size"])
    rows = []
    for (iso, name), r in g.iterrows():
        n = int(r[("up", "size")])
        if n >= min_hexagons:
            rows.append({"iso3": iso, "name": english_name(iso, name), "hexagons": n, "rising": int(r[("up", "sum")]), "falling": int(r[("down", "sum")]),
                         "rising_pct": _pct(r[("up", "sum")], n, 1), "falling_pct": _pct(r[("down", "sum")], n, 1)})
    return sorted(rows, key=lambda r: -r["hexagons"])


def l3_vs_l4(con, d3: pd.DataFrame, d4: pd.DataFrame) -> dict:
    con.register("_l4", d4[["h3"]])
    par = con.execute("SELECT h3_cell_to_parent(h3, 3) AS p FROM _l4").fetchnumpy()["p"]
    con.unregister("_l4")
    m = d4.assign(parent=par).merge(d3.rename(columns={c: f"{c}_3" for c in d3.columns}), left_on="parent", right_on="h3_3", how="inner")
    both = m[(m.q_bh <= 0.05) & (m.q_bh_3 <= 0.05)]
    out = {"l4_with_parent_trend": int(len(m)), "l4_with_parent_trend_pct": _pct(len(m), len(d4), 1),
           "same_sign_pct": _pct((np.sign(m.pct) == np.sign(m.pct_3)).sum(), len(m), 1),
           "both_significant": int(len(both)),
           "both_significant_same_sign_pct": _pct((np.sign(both.pct) == np.sign(both.pct_3)).sum(), len(both), 1)}
    for lvl, d in ((3, d3), (4, d4)):
        out[f"l{lvl}_significant_pct"] = _pct((d.q_bh <= 0.05).sum(), len(d), 1)
        out[f"l{lvl}_raw_significant_pct"] = _pct((d.p < 0.05).sum(), len(d), 1)
    return out


def l3_by_continent(con, d3: pd.DataFrame) -> list[tuple]:
    m = con.execute(f"SELECT h3_cell_to_parent(h3, 3) AS h3, mode(continent) AS cont FROM '{PB.products('cells.parquet')}' GROUP BY 1").df()
    d = d3.merge(m, on="h3", how="inner")
    sig = d.q_bh <= 0.05
    return [(c, int(len(g)), int((sig[g.index] & (g.pct > 0)).sum()), int((sig[g.index] & (g.pct < 0)).sum()))
            for c, g in d.groupby("cont") if c in CONTINENTS]


CONTINENTS = ("Africa", "Asia", "Europe", "North America", "Oceania", "South America")
MAX_BARREN = 0.5          # as the drivers: places whose fire is mostly on barren land or water (lava, gas flares)


def barren_shares(con) -> pd.DataFrame:
    """Share of each country's and state's fire (2001 to 2025) on hexagons whose main land cover is barren or water.
    The level 5 file is summed per hexagon first (one pass), and only that small result is joined to the hexagon facts."""
    a, b = A.BASE_YEARS
    f = con.execute(f"""SELECT h3, sum(h) AS fire FROM read_parquet('{PB.products('l5')}/*/*.parquet')
                        WHERE yr BETWEEN {a} AND {b} GROUP BY h3""").df()
    cells = pd.read_parquet(PB.products("cells.parquet"), columns=["h3", "iso3", "state_code", "lc_main"])
    x = cells.merge(f, on="h3", how="left").fillna({"fire": 0.0})
    x["bare"] = x.lc_main.isin(["barren", "water"]) * x.fire
    rows = []
    for kind, col in (("country", "iso3"), ("state", "state_code")):
        g = x.dropna(subset=[col]).groupby(col)[["bare", "fire"]].sum()
        rows.append(pd.DataFrame({"kind": kind, "id": g.index, "barren": (g.bare / g.fire.where(g.fire > 0)).to_numpy()}))
    return pd.concat(rows, ignore_index=True)


# places.json names ARE-349 "Abu Dhabi, Iran"; the state is in the United Arab Emirates (reported to the app's owner)
NAME_FIXES = {"ARE-349": "Abu Dhabi, United Arab Emirates"}
# Natural Earth's short country names, written out for eda.json and the report
NE_SHORT = {"Antigua and Barb.": "Antigua and Barbuda", "Bosnia and Herz.": "Bosnia and Herzegovina",
            "Br. Indian Ocean Ter.": "British Indian Ocean Territory", "British Virgin Is.": "British Virgin Islands",
            "Cayman Is.": "Cayman Islands", "Central African Rep.": "Central African Republic", "Cook Is.": "Cook Islands",
            "Cyprus U.N. Buffer Zone": "Cyprus UN Buffer Zone", "Dem. Rep. Congo": "DR Congo", "Dominican Rep.": "Dominican Republic",
            "Eq. Guinea": "Equatorial Guinea", "Faeroe Is.": "Faroe Islands", "Falkland Is.": "Falkland Islands",
            "Fr. Polynesia": "French Polynesia", "Fr. S. Antarctic Lands": "French Southern Lands",
            "Heard I. and McDonald Is.": "Heard and McDonald Islands", "Marshall Is.": "Marshall Islands", "N. Cyprus": "Northern Cyprus",
            "N. Mariana Is.": "Northern Mariana Islands", "S. Geo. and the Is.": "South Georgia and the South Sandwich Islands",
            "S. Sudan": "South Sudan", "Solomon Is.": "Solomon Islands", "Spratly Is.": "Spratly Islands",
            "St. Kitts and Nevis": "Saint Kitts and Nevis", "St. Pierre and Miquelon": "Saint Pierre and Miquelon",
            "St. Vin. and Gren.": "Saint Vincent and the Grenadines", "Turks and Caicos Is.": "Turks and Caicos Islands",
            "U.S. Minor Outlying Is.": "US Minor Outlying Islands", "U.S. Virgin Is.": "US Virgin Islands",
            "United States of America": "United States", "W. Sahara": "Western Sahara", "Wallis and Futuna Is.": "Wallis and Futuna"}


def english_name(pid: str, name: str) -> str:
    """The name the report and eda.json use: English forms of a few local names, Natural Earth's short country names
    written out, and the fix of ARE-349."""
    if pid in PLACE_NAMES:
        return PLACE_NAMES[pid]
    name = NAME_FIXES.get(pid, name) or pid
    head, sep, tail = name.rpartition(", ")
    return f"{head}, {NE_SHORT.get(tail, tail)}" if sep else NE_SHORT.get(name, name)
PLACE_COLS = ["kind", "id", "name", "local_name", "iso3", "continent", "mean_per_year", "pct_per_decade", "p", "q"]


def places_fdr(con) -> tuple[dict, pd.DataFrame]:
    """Trends of countries and states with at least PLACE_FLOOR hotspots a year, after false discovery rate control.
    The floor uses the mean, a number that says nothing about the trend, so filtering first keeps the error rate honest
    (independent filtering) and gives the tests that remain more power."""
    rows = pd.DataFrame(json.loads(PB.products("web", "places.json").read_text())["rows"])
    rows = rows.merge(barren_shares(con), on=["kind", "id"], how="left")
    rows["local_name"] = rows.name
    rows["name"] = [english_name(i, n) for i, n in zip(rows.id, rows.name)]
    world = float(rows.loc[rows.kind == "world", "mean_per_year"].iloc[0])
    out = {"floor_per_year": PLACE_FLOOR, "max_barren_share": MAX_BARREN, "q": list(Q)}
    tables = []
    for kind in ("country", "state"):
        x = rows[(rows.kind == kind) & rows.trend_p.notna()].copy()
        big = x[x.mean_per_year >= PLACE_FLOOR]
        bare = big[big.barren >= MAX_BARREN]
        t = big[~(big.barren >= MAX_BARREN)].copy()
        t["q"] = bh_adjust(t.trend_p)
        t = t.rename(columns={"trend_pct_per_decade": "pct_per_decade", "trend_p": "p"})
        sig = t[t.q <= 0.05]
        fmt = lambda d: [{k: (_r(v, 6) if k in ("p", "q") else _r(v, 2) if isinstance(v, float) else v) for k, v in r.items()}
                         for r in d[PLACE_COLS].to_dict("records")]
        out["countries" if kind == "country" else "states"] = {
            "with_trend": int(len(x)), "tested": int(len(t)), "share_of_world_fire_pct": _pct(t.mean_per_year.sum(), world, 2),
            "left_out_barren": [{"id": r.id, "name": r["name"], "barren_pct": _r(100 * r.barren, 0)} for _, r in bare.iterrows()],
            "raw_005": _counts(t.rename(columns={"pct_per_decade": "pct"}), t.p < 0.05),
            "bh_005": _counts(t.rename(columns={"pct_per_decade": "pct"}), t.q <= 0.05),
            "bh_010": _counts(t.rename(columns={"pct_per_decade": "pct"}), t.q <= 0.10),
            "rising": fmt(sig[sig.pct_per_decade > 0].sort_values("pct_per_decade", ascending=False).head(10)),
            "falling": fmt(sig[sig.pct_per_decade < 0].sort_values("pct_per_decade").head(10))}
        key = "countries" if kind == "country" else "states"
        out[key]["median_cv_pct"] = _r(100 * t.cv.median(), 1)          # year to year swing of the tested places
        out[key]["floors"] = []                                         # the same count with other floors
        for floor in FLOOR_CHECKS:
            f = x[(x.mean_per_year >= floor) & ~(x.barren >= MAX_BARREN)]
            qf = bh_adjust(f.trend_p)
            out[key]["floors"].append({"floor_per_year": floor, "tested": int(len(f)),
                                       "share_of_world_fire_pct": _pct(f.mean_per_year.sum(), world, 2),
                                       "bh_005": _counts(f.rename(columns={"trend_pct_per_decade": "pct"}), pd.Series(qf <= 0.05, index=f.index))})
        tables.append(t[PLACE_COLS + ["barren"]])
    return out, pd.concat(tables, ignore_index=True)


# ------------------------------------------------------------------------------------------------- 4. sensitivity
def _monthly(con):
    """Every named place's monthly harmonized and MODIS only values, filled as places.json fills them."""
    from . import placestats as PS
    meta = json.loads(PB.products("meta.json").read_text())
    am = con.execute(f"SELECT kind, id, yr::INT AS yr, mo::INT AS mo, h, modis, src FROM '{PB.products('area_monthly.parquet')}'").df()
    w = am[am.kind == "world"]
    grid = PS._grid(meta, dict(zip(w.yr * 100 + w.mo, w.src)))
    return am, grid


def _series(rows: pd.DataFrame, grid: pd.DataFrame, col: str) -> pd.DataFrame:
    d = grid.merge(rows[["yr", "mo", col]], on=["yr", "mo"], how="left")
    return pd.DataFrame({"yr": d.yr, "mo": d.mo, "value": np.where(d.unknown, np.nan, d[col].fillna(0.0))})


def base_periods(am: pd.DataFrame, grid: pd.DataFrame, names: dict) -> list[dict]:
    out = []
    groups = {k: g for k, g in am.groupby(["kind", "id"])}
    for kind, pid in KEY_PLACES:
        s = _series(groups[(kind, pid)], grid, "h")
        trends = []
        for yrs in BASE_PERIODS:
            t = A.trend(s, years=yrs)
            trends.append({"years": list(yrs), "pct_per_decade": _r(t.get("pct_per_decade"), 1), "p": _r(t.get("p"), 5),
                           "trend": t.get("trend")})
        y = s[s.yr.between(*A.BASE_YEARS)].groupby("yr").value.sum()
        out.append({"kind": kind, "id": pid, "name": names.get((kind, pid), pid), "trends": trends,
                    "mean_per_year": {"2001_2007": _r(y.loc[2001:2007].mean(), 0), "2012_2025": _r(y.loc[2012:2025].mean(), 0)},
                    "top_years": [int(v) for v in y.sort_values(ascending=False).index[:3]]})
    return out


def harmonized_vs_modis(am: pd.DataFrame, grid: pd.DataFrame, tested: pd.DataFrame, years=(2001, 2025)) -> tuple[dict, pd.DataFrame]:
    """The trend of every tested country in the harmonized record against the MODIS only record. If the harmonization
    made trends, the two would disagree; the MODIS only record never touches VIIRS."""
    from scipy.stats import spearmanr
    groups = {k: g for k, g in am.groupby(["kind", "id"])}
    rows = []
    for _, r in tested[tested.kind == "country"].iterrows():
        g = groups[("country", r.id)]
        th, tm = A.trend(_series(g, grid, "h"), years=years), A.trend(_series(g, grid, "modis"), years=years)
        if "p" not in th or "p" not in tm:
            continue
        rows.append({"iso3": r.id, "name": r["name"], "continent": r.continent, "mean_per_year": r.mean_per_year,
                     "h_pct": th["pct_per_decade"], "h_p": th["p"], "modis_pct": tm["pct_per_decade"], "modis_p": tm["p"]})
    d = pd.DataFrame(rows)
    d["h_q"], d["modis_q"] = bh_adjust(d.h_p), bh_adjust(d.modis_p)
    same = np.sign(d.h_pct) == np.sign(d.modis_pct)
    hs, ms = d.h_q <= 0.05, d.modis_q <= 0.05
    wg = groups[("world", "WORLD")]
    tw = {c: A.trend(_series(wg, grid, c), years=years) for c in ("h", "modis")}
    lr = np.log1p(d[["h_pct", "modis_pct"]] / 100)
    out = {"years": list(years), "countries": int(len(d)), "same_sign_pct": _pct(same.sum(), len(d), 1),
           "spearman": _r(spearmanr(d.h_pct, d.modis_pct).statistic, 3),
           "pearson_log": _r(np.corrcoef(lr.h_pct, lr.modis_pct)[0, 1], 3),
           "median_difference_pct_points": _r(np.median(d.h_pct - d.modis_pct), 1),
           "h_significant": int(hs.sum()), "h_significant_same_sign_pct": _pct((hs & same).sum(), hs.sum(), 1),
           "both_significant": int((hs & ms).sum()), "both_significant_opposite": int((hs & ms & ~same).sum()),
           "world": {c: {"pct_per_decade": _r(t["pct_per_decade"], 2), "p": _r(t["p"], 5)} for c, t in tw.items()}}
    return out, d


# ------------------------------------------------------------------------------------------------- build
def _names() -> dict:
    rows = json.loads(PB.products("web", "places.json").read_text())["rows"]
    return {(r["kind"], r["id"]): english_name(r["id"], r["name"]) for r in rows}


def _modis_columns(am, grid, out_rows):
    """MODIS only trends of the key places, next to the harmonized ones (for the sensitivity table)."""
    groups = {k: g for k, g in am.groupby(["kind", "id"])}
    for r in out_rows:
        s = _series(groups[(r["kind"], r["id"])], grid, "modis")
        r["modis_only"] = []
        for yrs in ((2001, 2025), (2003, 2025)):
            t = A.trend(s, years=yrs)
            r["modis_only"].append({"years": list(yrs), "pct_per_decade": _r(t.get("pct_per_decade"), 1), "p": _r(t.get("p"), 5),
                                    "trend": t.get("trend")})
    return out_rows


def year_band(meta: dict, total: float) -> dict:
    """The 90% range of a modelled year (Terra and Aqua model) whose total is `total`, from the interval table."""
    for b in meta["intervals"]["terra_aqua_year"]["bands"]:
        if total >= b["mu_min"] and (b["mu_max"] is None or total < b["mu_max"]):
            return {"from": _r(b["mu_min"], 1), "to": _r(b["mu_max"], 1), "below_pct": _r(-100 * b["q_lo"], 1),
                    "above_pct": _r(100 * b["q_hi"], 1)}
    return {}


def build(log=print, figures: bool = False, rescan: bool = False) -> dict:
    import warnings
    t0 = time.time()
    scan(log, rescan)
    hx = scan_hex(log, rescan)
    fx = scan_frp_exact(log, rescan)
    profile, frp, ov = load("profile"), load("frp"), load("overpass")
    con = _con()
    meta = json.loads(PB.products("meta.json").read_text())
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)      # pymannkendall's square root of an impossible variance
        r3 = ratio_l3(con)
        d3, d4 = hex_trends(3, con), hex_trends(4, con)
        d3 = d3.merge(hex_modis_check(con, d3), on="h3", how="left")
        d3t, d4t = d3[d3.tested].copy(), d4[d4.tested].copy()
        tot3, tot4 = map_total(con, 3), map_total(con, 4)
        places, tested = places_fdr(con)
        am, grid = _monthly(con)
        names = _names()
        bp = _modis_columns(am, grid, base_periods(am, grid, names))
        hv, hv_rows = harmonized_vs_modis(am, grid, tested, (2001, 2025))
        hv03, _ = harmonized_vs_modis(am, grid, tested, (2003, 2025))
        hv21, _ = harmonized_vs_modis(am, grid, tested, (2003, 2021))
    w = am[am.kind == "world"].groupby("yr")[["h", "modis"]].sum()
    snpp = profile[(profile.sat == "Suomi-NPP") & (profile.cnt == True)]
    res = {
        "version": 1, "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "record": {"first_month": meta["first_month"], "last_month": meta["last_month"], "hotspots": int(profile.n.sum())},
        "sensors": sensors(profile, fx),
        "overlap": {**overlap(profile, fx), "snpp_where_modis_saw_none": snpp_where_modis_saw_none(con),
                    "harmonized_where_modis_saw_none": harmonized_where_modis_saw_none(con)},
        "frp_hist": frp_hist(frp),
        "overpass": overpass(ov),
        "exchange_rate_l3": {**ratio_summary(r3), "parts": rate_parts(hx), "physics_tiles": tile_rates(con, hx)},
        "fdr": {"floor_per_year": HEX_FLOOR, "floor_year_band": year_band(meta, HEX_FLOOR),
                "below_floor_year_band": year_band(meta, HEX_FLOOR * 0.99),
                "why_floor": (f"A map hexagon's trend is tested when it has at least {HEX_FLOOR} hotspots a year on average. "
                              "Before 2012 the model gives every hexagon month a small expected value, also where MODIS saw "
                              "nothing, while VIIRS records 0 in an empty month. In hexagons with little fire that small value "
                              "is much of the record, so the record falls at 2012 there although MODIS does not."),
                "l3": fdr_summary(d3t), "l4": fdr_summary(d4t), "l3_all": fdr_summary(d3), "l4_all": fdr_summary(d4),
                "floors_l3": hex_floors(d3, tot3), "floors_l4": hex_floors(d4, tot4), "classes_l3": hex_classes(d3, tot3),
                "modis_check_l3": {"tested": modis_check_summary(d3t), "all": modis_check_summary(d3)},
                "spatial_l3": spatial(con, d3t), "l3_vs_l4": l3_vs_l4(con, d3t, d4t),
                "l3_by_country": l3_by_country(con, d3t),
                "l3_by_continent": {c: {"hexagons": n, "falling_pct": _pct(dn, n, 1), "rising_pct": _pct(up, n, 1)}
                                    for c, n, up, dn in l3_by_continent(con, d3t)}},
        "places": {**places, "floor_year_band": year_band(meta, PLACE_FLOOR), "below_floor_year_band": year_band(meta, PLACE_FLOOR * 0.99),
                   "why_floor": (f"A place is ranked when it has at least {PLACE_FLOOR:,} hotspots a year on average. A modelled "
                                 "year of that size has a 90% range from {lo:.0f}% below to {hi:.0f}% above, and smaller years "
                                 "have wider ranges, as wide as the trends we test.").format(
                                     lo=year_band(meta, PLACE_FLOOR)["below_pct"], hi=year_band(meta, PLACE_FLOOR)["above_pct"])},
        "sensitivity": {"base_periods": [list(p) for p in BASE_PERIODS], "places": bp,
                        "harmonized_vs_modis": {**hv, "rows": [{k: (_r(v, 4) if isinstance(v, float) else v) for k, v in r.items()}
                                                               for r in hv_rows[["iso3", "name", "continent", "h_pct", "h_p", "modis_pct", "modis_p"]].to_dict("records")]},
                        "harmonized_vs_modis_2003_2025": hv03, "harmonized_vs_modis_2003_2021": hv21,
                        "world_h_per_modis_by_year": {int(y): _r(v, 3) for y, v in (w.h / w.modis).loc[2001:2025].items()},
                        "world_h_per_modis_mean": {k: _r((w.h / w.modis).loc[a:b].mean(), 2)
                                                   for k, (a, b) in {"2001_2002": (2001, 2002), "2003_2012": (2003, 2012),
                                                                     "2013_2019": (2013, 2019), "2025": (2025, 2025)}.items()},
                        "world_h_per_modis_change_2012_2021_pct": _r(100 * ((w.h / w.modis)[2021] / (w.h / w.modis)[2012] - 1), 1),
                        "snpp_below_modis_limit_pct_by_year": {int(y): _pct(g[g.sdet == True].n.sum(), g.n.sum(), 1)
                                                               for y, g in snpp[snpp.yr.between(2012, 2025)].groupby("yr")}},
    }
    # the low fire seam by fire band (the review's measurement; also in models/r1_checks.json)
    res["seam_by_band"] = seam_by_fire_band(con)
    con.close()
    for name, df in (("hex_fdr_l3", d3), ("hex_fdr_l4", d4), ("places_fdr", tested), ("harmonized_vs_modis", hv_rows),
                     ("exchange_rate_l3", r3)):
        with C.atomic(out(f"{name}.parquet")) as tmp:
            df.to_parquet(tmp, index=False)
    text = PB.strict_json(res, indent=1)
    with C.atomic(out("summary.json")) as tmp:
        tmp.write_text(text)
    web = PB.products("web", "eda.json")
    with C.atomic(web) as tmp:
        tmp.write_text(PB.strict_json(res, separators=(",", ":")))
    with C.atomic(out("report_tables.md")) as tmp:
        tmp.write_text(report_tables(res))
    rep = {"seconds": round(time.time() - t0), "eda_json_kb": round(web.stat().st_size / 1e3, 1)}
    if figures:
        rep["figures"] = draw_figures(log)
    return rep


def draw_figures(log=print) -> list[str]:
    """The report figures from the saved results (eda/summary.json and the eda/*.parquet tables)."""
    from .eda_figures import draw
    res = json.loads(out("summary.json").read_text())
    tabs = {n: pd.read_parquet(out(f"{n}.parquet")) for n in ("hex_fdr_l3", "harmonized_vs_modis", "exchange_rate_l3")}
    return draw(res, tabs["hex_fdr_l3"], tabs["harmonized_vs_modis"], tabs["exchange_rate_l3"], log)


# ------------------------------------------------------------------------------------------------- report tables
MINUS = "\u2212"


def _num(v, d=1, sign=False) -> str:
    """A number as the report writes it: thousands separators, a true minus sign, + for rises when asked. Halves round
    away from zero on the decimal text, so 109.35 and 109.3527 both read 109.4."""
    from decimal import ROUND_HALF_UP, Decimal
    if v is None:
        return "n/a"
    q = Decimal(str(abs(v))).quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP)
    t = f"{q:,.{d}f}"
    return (MINUS if v < 0 else "+" if sign and v > 0 else "") + t


def _p(v) -> str:
    return "below 0.0001" if v is not None and v < 0.0001 else f"{v:.4f}" if v < 0.01 else f"{v:.3f}"


def report_tables(res: dict) -> str:
    """The report's tables of this analysis, as Quarto Markdown, from the same results as web/eda.json (pasted into
    report/report.qmd; rebuilt by every `fireharmony eda`)."""
    out = []
    rows = ["| Satellite | Hotspots a year (million) | Counted | At night | Median FRP, day and night (MW) | Below 10 MW "
            "| High confidence | Static labels |", "|:---|---:|---:|---:|---:|---:|---:|---:|"]
    names = {"terra": "Terra", "aqua": "Aqua", "snpp": "Suomi NPP", "noaa20": "NOAA-20", "noaa21": "NOAA-21"}
    for x in res["sensors"]:
        a, b = x["years"]
        static = None if x["near_real_time_pct"] == 100 else x["static_labels_pct"]
        rows.append(f"| {names[x['id']]} ({FAMILY_OF[x['id']]}), {a} to {b} | {_num(x['hotspots_per_year'] / 1e6, 2)} | "
                    f"{_num(x['counted_pct'])}% | {_num(x['counted_night_pct'])}% | {_num(x['frp_q_day']['p50'])} and {_num(x['frp_q_night']['p50'])} | "
                    f"{_num(x['below_10mw_pct'])}% | {_num(x['confidence_pct']['high'])}% | "
                    f"{'no label' if static is None else _num(static) + '%'} |")
    out.append("<!-- tbl-sensors -->\n" + "\n".join(rows))
    f = res["fdr"]
    cell = lambda c, side: f"{c[side]:,} ({_num(c[side + '_pct'])}%)"
    rows = ["| Hexagons and rule | Level 3, rising | Level 3, falling | Level 4, rising | Level 4, falling |", "|:---|---:|---:|---:|---:|"]
    rows.append(f"| Every hexagon (no floor): false discovery rate 5% | {cell(f['l3_all']['bh_005'], 'rising')} | "
                f"{cell(f['l3_all']['bh_005'], 'falling')} | {cell(f['l4_all']['bh_005'], 'rising')} | {cell(f['l4_all']['bh_005'], 'falling')} |")
    floor = f"{f['floor_per_year']:,}"
    for key, label in (("raw_005", f"At least {floor} a year: p below 0.05"),
                       ("bh_005", f"At least {floor} a year: false discovery rate 5%"),
                       ("bh_010", f"At least {floor} a year: false discovery rate 10%"),
                       ("by_005", f"At least {floor} a year: rate 5%, any dependence")):
        rows.append(f"| {label} | {cell(f['l3'][key], 'rising')} | {cell(f['l3'][key], 'falling')} | "
                    f"{cell(f['l4'][key], 'rising')} | {cell(f['l4'][key], 'falling')} |")
    out.append("<!-- tbl-fdr -->\n" + "\n".join(rows))
    rows = ["| Hotspots a year | Hexagons | Share of fire | Falling | Rising | Per MODIS hotspot, 2003 to 2011 "
            "| Per MODIS hotspot, 2013 to 2021 | Same sign as MODIS alone |", "|:---|---:|---:|---:|---:|---:|---:|---:|"]
    for c in f["classes_l3"]:
        lo, hi = c["min_per_year"], c["max_per_year"]
        band = f"Under {hi:,}" if lo == 0 else f"{lo:,} or more" if hi is None else f"{lo:,} to {hi:,}"
        share = "under 0.1%" if c["share_of_fire_pct"] < 0.05 else f"{_num(c['share_of_fire_pct'], 1)}%"
        rows.append(f"| {band} | {c['hexagons']:,} | {share} | {c['falling']:,} | {c['rising']:,} | "
                    f"{_num(c['h_per_modis_model_years'], 1)} | {_num(c['h_per_modis_viirs_years'], 1)} | {_num(c['same_sign_as_modis_only_pct'], 0)}% |")
    out.append("<!-- tbl-floor -->\n" + "\n".join(rows))
    for key in ("countries", "states"):
        part = res["places"][key]
        rows = ["| Place | Hotspots a year | Change per decade | p | q |", "|:---|---:|---:|---:|---:|"]
        for side in ("rising", "falling"):
            for r in part[side]:
                rows.append(f"| {PLACE_NAMES.get(r['id'], r['name'])} | {_num(r['mean_per_year'], 0)} | {_num(r['pct_per_decade'], 1, True)}% | {_p(r['p'])} | {_p(r['q'])} |")
        out.append(f"<!-- tbl-places-{key} -->\n" + "\n".join(rows))
    rows = ["| Place | 2001 to 2025 | 2003 to 2025 | 2012 to 2025 | MODIS only, 2001 to 2025 | MODIS only, 2003 to 2025 |",
            "|:---|---:|---:|---:|---:|---:|"]
    star = lambda t: f"{_num(t['pct_per_decade'], 1, True)}%{'*' if t['p'] is not None and t['p'] < 0.05 else ''}"
    for r in res["sensitivity"]["places"]:
        name = SHORT_NAMES.get(r["id"], r["name"])
        rows.append(f"| {name} | " + " | ".join(star(t) for t in r["trends"] + r["modis_only"]) + " |")
    out.append("<!-- tbl-sensitivity -->\n" + "\n".join(rows))
    out.append("<!-- text numbers (each phrase appears in report/report.qmd; tests/test_eda.py checks it) -->\n"
               + "\n".join(f"- {k}: {v}" for k, v in text_numbers(res)))
    return "\n\n".join(out) + "\n"


def _hm(hours: float) -> str:
    m = int(Decimal_round(hours * 60))
    return f"{m // 60 % 24:02d}:{m % 60:02d}"


def Decimal_round(v: float) -> int:
    from decimal import ROUND_HALF_UP, Decimal
    return int(Decimal(str(v)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def text_numbers(res: dict) -> list[tuple[str, str]]:
    """The phrases of the report text that carry this analysis's numbers, formatted from eda/summary.json with the
    report's rounding (one rounding, half up). Each phrase must appear in report/report.qmd, so a rebuild that moves a
    number makes the test fail until the text follows."""
    o, x, f, pl, sv = res["overlap"], res["exchange_rate_l3"], res["fdr"], res["places"], res["sensitivity"]
    by = {s["id"]: s for s in o["sensors"]}
    r = o["snpp_per_aqua"]
    parts, tiles = x["parts"], [t["rate"] for t in x["physics_tiles"]]
    cn = {c["iso3"]: c for c in parts["countries"]}
    ov = res["overpass"]["sensors"]
    yr = lambda sid, y, k="day_median_local": next(v[k] for v in ov[sid]["by_year"] if v["yr"] == y)
    l3, l4, a3 = f["l3"], f["l4"], f["l3_all"]
    b3, b4 = l3["bh_005"], l4["bh_005"]
    fl = {c["floor_per_year"]: c for c in f["floors_l3"]}
    cls = f["classes_l3"]
    mc = f["modis_check_l3"]
    hv = sv["harmonized_vs_modis"]
    hv03 = sv["harmonized_vs_modis_2003_2025"]
    pct = lambda v, d=0: f"{_num(v, d)}%"
    ratio_range = [c["fall_per_rise"] for c in f["floors_l3"] if 10 <= c["floor_per_year"] <= 300]
    above = [c for c in cls if c["min_per_year"] >= f["floor_per_year"]]
    lo_band, band, below = pl["below_floor_year_band"], pl["floor_year_band"], f["floor_year_band"]
    return [
        ("hotspots per Aqua hotspot", f"Suomi NPP counts {_num(r['hotspots'], 1)} times as many hotspots as Aqua but records only {_num(r['frp'], 1)} times its FRP"),
        ("night and day gap", f"records {_num(r['night_hotspots'], 0)} times as many night hotspots as Aqua, against {_num(r['day_hotspots'], 0)} times by day"),
        ("night shares", f"{pct(by['snpp']['night_pct'])} of Suomi NPP's come at night and only {pct(by['aqua']['night_pct'], 1)} of Aqua's"),
        ("below the MODIS limit", f"Of Suomi NPP's hotspots, {pct(by['snpp']['day']['below_modis_limit_pct'])} by day and {pct(by['snpp']['night']['below_modis_limit_pct'])} by night"),
        ("overlap medians", f"the median Suomi NPP hotspot carries {_num(by['snpp']['day']['frp_p50'], 1)} MW and the median Aqua hotspot {_num(by['aqua']['day']['frp_p50'], 1)} MW. By night the medians are {_num(by['snpp']['night']['frp_p50'], 1)} MW and {_num(by['aqua']['night']['frp_p50'], 1)} MW"),
        ("world rate", f"the world answer is {_num(x['world'], 1)} Suomi NPP hotspots"),
        ("rate spread", f"Across the {x['hexagons']:,} level 3 hexagons with at least {x['min_aqua_per_year']} Aqua hotspots a year, the middle half of the rates runs from {_num(x['q25'], 1)} to {_num(x['q75'], 1)}"),
        ("rate tails", f"below {_num(x['q05'], 1)}, and one in twenty above {_num(x['q95'], 1)}"),
        ("rate and night share", f"(Spearman's rank correlation {_num(parts['spearman_rate_snpp_night'], 2)}) and hardly follows the share of weak fires by day ({_num(parts['spearman_rate_snpp_weak_day'], 2)})"),
        ("day rate", f"middle half from {_num(parts['rate_day']['q25'], 1)} to {_num(parts['rate_day']['q75'], 1)}"),
        ("day rate and weak fires", f"where more of the fires are weak ({_num(parts['spearman_rate_day_snpp_weak_day'], 2)})"),
        ("Congo and Angola", f"the rate is {_num(cn['COD']['rate'], 1)} and {_num(cn['AGO']['rate'], 1)}"),
        ("Russia", f"In Russia {pct(cn['RUS']['snpp_night'])} come at night, and the rate is {_num(cn['RUS']['rate'], 1)}"),
        ("Canada", f"the rate is {_num(cn['CAN']['rate'], 1)}"),
        ("India", f"There, {pct(cn['IND']['snpp_weak_day'])} of Suomi NPP's daytime hotspots are below 10 MW"),
        ("India day rate", f"day rate of {_num(cn['IND']['rate_day'], 1)} is second only to Canada's"),
        ("test areas", f"the rate ranged from {_num(min(tiles), 1)} to {_num(max(tiles), 1)}"),
        ("unseen by MODIS", f"{pct(o['snpp_where_modis_saw_none']['pct'], 1)} of Suomi NPP hotspots in 2013 to 2019 fall in level 5 hexagon months"),
        ("model unseen share", f"the model puts {pct(o['harmonized_where_modis_saw_none']['model_pct'], 1)} of the record"),
        ("VIIRS unseen share", f"VIIRS finds {pct(o['harmonized_where_modis_saw_none']['viirs_pct'], 1)} of its fire"),
        ("Terra and Aqua hours", f"the median Terra hotspot was seen at {_hm(ov['terra']['day_median_local'])} by day and {_hm(ov['terra']['night_median_local'])} by night, and the median Aqua hotspot at {_hm(ov['aqua']['day_median_local'])} and {_hm(ov['aqua']['night_median_local'])}"),
        ("VIIRS hours", f"{_hm(ov['snpp']['day_median_local'])} and {_hm(ov['snpp']['night_median_local'])}"),
        ("Terra drift", f"to {_hm(yr('terra', 2025))} in 2025 and {_hm(yr('terra', 2026))} in 2026"),
        ("Aqua drift", f"to {_hm(yr('aqua', 2025))} in 2025 and {_hm(yr('aqua', 2026))} in 2026"),
        ("low fire class", f"The {cls[0]['hexagons']:,} level 3 hexagons with fewer than {cls[0]['max_per_year']} hotspots a year"),
        ("low fire ratio", f"holds {_num(cls[0]['h_per_modis_model_years'], 1)} hotspots for every MODIS hotspot in 2003 to 2011 but only {_num(cls[0]['h_per_modis_viirs_years'], 1)} in 2013 to 2021"),
        ("low fire trends", f"{cls[0]['falling']:,} of them fall and {cls[0]['rising']} rise, and only {pct(cls[0]['same_sign_as_modis_only_pct'])} share"),
        ("above the floor", f"the ratio moves by only {pct(min(c['h_per_modis_change_pct'] for c in above))} to {pct(max(c['h_per_modis_change_pct'] for c in above))}"),
        ("above the floor, sign", f"There, {pct(min(c['same_sign_as_modis_only_pct'] for c in above))} to {pct(max(c['same_sign_as_modis_only_pct'] for c in above))} of the hexagons share the sign"),
        ("tested", f"The {l3['hexagons']:,} level 3 hexagons that pass hold {pct(fl[f['floor_per_year']]['share_of_fire_pct'], 1)} of the world's fire"),
        ("floor range", f"A modelled year of {_num(below['from'], 0)} to {_num(below['to'], 0)} hotspots has a range from {pct(below['below_pct'])} below to {pct(below['above_pct'])} above"),
        ("raw", f"Of the {l3['hexagons']:,} tested hexagons, {l3['raw_005']['rising'] + l3['raw_005']['falling']:,} have a trend with p below 0.05. If fire had no trend anywhere, about {l3['expected_false_raw']:,} would"),
        ("BH kept", f"False discovery control at 5% keeps {b3['rising'] + b3['falling']:,}"),
        ("falls and rises", f"Fire fell in {b3['falling']:,} hexagons ({pct(b3['falling_pct'])}) and rose in {b3['rising']:,} ({pct(b3['rising_pct'])}), so it fell in {_num(l3['fall_per_rise_bh_005'], 1)} times as many places"),
        ("no floor", f"Without the floor the ratio would be {_num(a3['fall_per_rise_bh_005'], 1)}"),
        ("floor range of ratios", f"it stays between {_num(min(ratio_range), 1)} and {_num(max(ratio_range), 1)}"),
        ("p cut", f"Only hexagons with p up to {l3['p_cut_005']}"),
        ("Moran", f"of the tested hexagons is {_num(f['spatial_l3']['moran_i'], 2)}"),
        ("same sign neighbours", f"Of the significant hexagons, {pct(f['spatial_l3']['significant_with_same_sign_neighbour_pct'])} touch"),
        ("BY", f"keeps {l3['by_005']['rising'] + l3['by_005']['falling']:,} hexagons, and fire still falls in {_num(l3['fall_per_rise_by_005'], 1)} times as many"),
        ("level 4", f"At level 4 the same floor keeps {l4['hexagons']:,} hexagons with {pct(f['floors_l4'][[c['floor_per_year'] for c in f['floors_l4']].index(f['floor_per_year'])]['share_of_fire_pct'])} of the world's fire"),
        ("level 4 shares", f"{pct(f['l3_vs_l4']['l4_significant_pct'])} have a trend that survives the control, against {pct(f['l3_vs_l4']['l3_significant_pct'])} at level 3, and fire falls in {_num(l4['fall_per_rise_bh_005'], 1)} times"),
        ("level 3 and 4", f"{pct(f['l3_vs_l4']['same_sign_pct'])} share the sign of the trend of their level 3 parent. Where both are significant, {pct(f['l3_vs_l4']['both_significant_same_sign_pct'])} agree"),
        ("place floor", f"from {pct(band['below_pct'])} below to {pct(band['above_pct'])} above. Smaller years have wider ranges, from {pct(lo_band['below_pct'])} below to {pct(lo_band['above_pct'])} above"),
        ("places tested", f"{pl['countries']['tested']} countries with {pct(pl['countries']['share_of_world_fire_pct'], 1)} of the world's fire, and {pl['states']['tested']:,} states with {pct(pl['states']['share_of_world_fire_pct'])}"),
        ("hexagon check", f"Of the {mc['tested']['hexagons']:,} tested level 3 hexagons with a trend in both records from 2003 to 2025, {pct(mc['tested']['same_sign_pct'])} share the sign"),
        ("hexagon check, significant", f"{pct(mc['tested']['harmonized_significant_same_sign_pct'])} have the same sign in MODIS alone, and only {mc['tested']['both_significant_opposite']} hexagons"),
        ("hexagon check, no floor", f"Without the floor, {mc['all']['both_significant_opposite']} would, {mc['all']['both_significant_opposite'] - mc['tested']['both_significant_opposite']} of them below it"),
        ("country agreement", f"same sign of trend in {pct(hv['same_sign_pct'])} of the {hv['countries']} countries, with a rank correlation of {_num(hv['spearman'], 2)}"),
        ("country gap", f"a median of {_num(hv['median_difference_pct_points'], 1)} points per decade"),
        ("world gap", f"For the world the gap is {_num(hv['world']['h']['pct_per_decade'] - hv['world']['modis']['pct_per_decade'], 1)} points from 2001 and {_num(hv03['world']['h']['pct_per_decade'] - hv03['world']['modis']['pct_per_decade'], 1)} points from 2003"),
        ("world trends", f"the world trend is {_num(hv['world']['h']['pct_per_decade'], 1)}% per decade in our record and {_num(hv['world']['modis']['pct_per_decade'], 1)}% in MODIS alone, or {_num(hv03['world']['modis']['pct_per_decade'], 1)}% from 2003"),
        ("ratio means", f"{_num(sv['world_h_per_modis_mean']['2003_2012'], 1)} hotspots for every MODIS hotspot in 2003 to 2012, {_num(sv['world_h_per_modis_mean']['2013_2019'], 1)} in 2013 to 2019 and {_num(sv['world_h_per_modis_mean']['2025'], 1)} in 2025"),
        ("ratio change", f"the ratio rose by {pct(sv['world_h_per_modis_change_2012_2021_pct'], 1)}"),
    ]


FAMILY_OF = {"terra": "MODIS", "aqua": "MODIS", "snpp": "VIIRS", "noaa20": "VIIRS", "noaa21": "VIIRS"}
SHORT_NAMES = {"USA": "United States", "IDN-1931": "Central Kalimantan"}
# English names for the report (the published names keep the local form, and two of them carry a hyphen)
PLACE_NAMES = {"IDN-1931": "Central Kalimantan, Indonesia", "PRK-3308": "Kangwon, North Korea",
               "PRK-3311": "South Hamgyong, North Korea", "COD": "DR Congo"}


# ------------------------------------------------------------------------------------------------- 5. review checks
# Numbers the first review round asked for (models/r1_checks.json, `r1_checks()`): the low fire seam by fire band, the
# trends from 2003, burned area trends, case studies, and the uncertainty of the trends. Inputs are read only.
R1_PATH = C.REPO / "models" / "r1_checks.json"
FIRE_BANDS = (0, 10, 100, 1000)           # mean hotspots a year: under 10, 10 to 100, 100 to 1,000, 1,000 and more
BLOCK_YEARS = 3                           # year blocks for the permutation and the bootstrap of the trend map
PERMUTATIONS = 1000
BOOT_DRAWS = 1000


def _band_label(lo, hi) -> str:
    return f"{lo:,} and more" if hi is None else (f"under {hi:,}" if lo == 0 else f"{lo:,} to {hi:,}")


def _band_table(before: pd.Series, after: pd.Series, band_by: pd.Series) -> list[dict]:
    """Per band of `band_by` (mean hotspots a year): units, the median ratio of the before mean to the after mean (an
    after mean of 0 counts as an infinite ratio), the share of units that step down by more than 2 times (ratio above 2)
    and up by more than 2 times (below 0.5), and the band's share of the after fire."""
    ratio = (before / after.where(after > 0)).fillna(np.inf).where(before > 0, np.where(after > 0, 0.0, np.nan))
    edges = list(FIRE_BANDS) + [None]
    rows = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        sel = (band_by >= lo) & (band_by < (hi if hi is not None else np.inf))
        r = ratio[sel].dropna()
        rows.append({"band": _band_label(lo, hi), "min_per_year": lo, "max_per_year": hi, "units": int(sel.sum()),
                     "median_ratio": _r(float(np.median(r)) if len(r) else None, 3),
                     "share_down_more_than_2x_pct": _pct((r > 2).sum(), len(r), 1),
                     "share_up_more_than_2x_pct": _pct((r < 0.5).sum(), len(r), 1),
                     "pooled_ratio": _r(before[sel].sum() / after[sel].sum() if after[sel].sum() > 0 else None, 3),
                     "share_of_after_fire_pct": _pct(after[sel].sum(), after.sum(), 3)})
    return rows


def seam_by_fire_band(con) -> dict:
    """The low fire seam, measured. Before 2012 the model gives every month a small expected value, also where MODIS saw
    nothing; VIIRS records 0 in an empty month. So units with little fire step down at 2012. For named places (states
    and countries, area_monthly.parquet) and level 3 hexagons (cell_l3.parquet): the ratio of the 2003 to 2011 mean
    (Terra and Aqua model years) to the 2013 to 2021 mean (VIIRS years), by band of the observed VIIRS mean (2013 to
    2021); the places with modelled fire before 2012 but none in 2013 to 2021; and the hotspots in state months where
    MODIS saw none. A ratio near 1 means no step."""
    (a1, b1), (a2, b2) = ERAS["modis"], ERAS["viirs"]
    n1, n2 = b1 - a1 + 1, b2 - a2 + 1
    am = PB.products("area_monthly.parquet")
    pl = con.execute(f"""SELECT kind, id, sum(h) FILTER (WHERE yr BETWEEN {a1} AND {b1}) / {n1} AS before,
                                sum(h) FILTER (WHERE yr BETWEEN {a2} AND {b2}) / {n2} AS after,
                                sum(h) FILTER (WHERE yr BETWEEN {A.BASE_YEARS[0]} AND {A.BASE_YEARS[1]}) / {A.BASE_YEARS[1] - A.BASE_YEARS[0] + 1} AS mean
                         FROM '{am}' WHERE kind IN ('country', 'state') GROUP BY kind, id""").df().fillna(0.0)
    hx = con.execute(f"""SELECT h3, sum(h) FILTER (WHERE yr BETWEEN {a1} AND {b1}) / {n1} AS before,
                                sum(h) FILTER (WHERE yr BETWEEN {a2} AND {b2}) / {n2} AS after,
                                sum(h) FILTER (WHERE yr BETWEEN {A.BASE_YEARS[0]} AND {A.BASE_YEARS[1]}) / {A.BASE_YEARS[1] - A.BASE_YEARS[0] + 1} AS mean
                         FROM '{PB.products('cell_l3.parquet')}' GROUP BY h3""").df().fillna(0.0)
    zero = con.execute(f"""SELECT sum(h) FILTER (WHERE kind = 'state' AND coalesce(modis, 0) = 0 AND yr BETWEEN {a1} AND {b1}) AS z_era,
                                  sum(h) FILTER (WHERE kind = 'world' AND yr BETWEEN {a1} AND {b1}) AS w_era,
                                  sum(h) FILTER (WHERE kind = 'state' AND coalesce(modis, 0) = 0 AND yr <= 2011) AS z_all,
                                  sum(h) FILTER (WHERE kind = 'world' AND yr <= 2011) AS w_all,
                                  sum(h) FILTER (WHERE kind = 'world') AS w_record
                           FROM '{am}'""").df().iloc[0]
    out = {"years_before": [a1, b1], "years_after": [a2, b2], "band_by": f"observed VIIRS mean, hotspots a year, {a2} to {b2}",
           "ratio": f"mean {a1} to {b1} / mean {a2} to {b2}"}
    for key, d, kinds in (("places", pl, ("state", "country")), ("hexagons_l3", hx, None)):
        if kinds:
            res = {}
            for k in kinds + ("both",):
                x = d if k == "both" else d[d.kind == k]
                res[{"state": "states", "country": "countries", "both": "both"}[k]] = {
                    "bands": _band_table(x.before, x.after, x.after),
                    "bands_by_record_mean": _band_table(x.before, x.after, x["mean"]),
                    "modelled_before_none_after": int(((x.before > 0) & (x.after == 0)).sum())}
            out[key] = res
        else:
            out[key] = {"bands": _band_table(d.before, d.after, d.after), "bands_by_record_mean": _band_table(d.before, d.after, d["mean"]),
                        "modelled_before_none_after": int(((d.before > 0) & (d.after == 0)).sum()), "hexagons": int(len(d))}
    out["modis_zero_state_months"] = {
        "what": "harmonized hotspots in state months where neither MODIS satellite saw a fire, before 2012",
        "years": [a1, b1], "hotspots": _r(float(zero.z_era), 0), "pct_of_those_years": _pct(zero.z_era, zero.w_era, 2),
        "pct_of_record": _pct(zero.z_era, zero.w_record, 3),
        "from_nov_2000": {"hotspots": _r(float(zero.z_all), 0), "pct_of_those_years": _pct(zero.z_all, zero.w_all, 2)}}
    return out


def _yearly_matrix(con, years, level: int = 3) -> pd.DataFrame:
    """Yearly harmonized hotspots of every map hexagon (map_l{level}.parquet, as the published trends), years in columns."""
    a, b = years
    y = con.execute(f"""SELECT h3, yr::INT AS yr, sum(h) AS v FROM '{PB.products(f"map_l{level}.parquet")}'
                        WHERE yr BETWEEN {a} AND {b} GROUP BY h3, yr""").df()
    return y.pivot_table(index="h3", columns="yr", values="v", fill_value=0.0, aggfunc="sum").reindex(columns=range(a, b + 1), fill_value=0.0)


def _trend_map_counts(Y: np.ndarray, q: float = 0.05) -> dict:
    """The published rules on a matrix of yearly totals: Hamed and Rao test, Sen's slope of log(1 + y) for the sign,
    Benjamini and Hochberg among the rows."""
    r = A.mk_matrix(Y, hamed_rao=True)
    pct = 100 * (np.exp(10 * A.sen_matrix(np.log1p(Y))) - 1)
    sig = bh_adjust(r["p"]) <= q
    up, down = int((sig & (pct > 0)).sum()), int((sig & (pct < 0)).sum())
    return {"tested": int(len(Y)), "rising": up, "falling": down, "flat": int((sig & (pct == 0)).sum()),
            "fall_per_rise": _r(down / max(up, 1), 2), "p": r["p"], "pct": pct}


def hex_fdr_2003(con) -> dict:
    """Level 3 hexagon falls and rises at BH 5% for 2003 to 2025, with the rules of the 2001 map: at least five years
    with fire, a floor of HEX_FLOOR hotspots a year (mean over the years tested), Hamed and Rao, Sen's slope of
    log(1 + y). Also the 2001 to 2025 map from the same code (it reproduces the published counts), and the 2003 test
    on the hexagons the 2001 map tests."""
    out = {}
    sets = {}
    for yrs in ((2001, 2025), (2003, 2025)):
        Ydf = _yearly_matrix(con, yrs)
        Ydf = Ydf[(Ydf > 0).sum(1) >= 5]
        tested = Ydf[Ydf.mean(1) >= HEX_FLOOR]
        sets[yrs] = tested.index
        c = _trend_map_counts(tested.to_numpy(float))
        out[f"{yrs[0]}_{yrs[1]}"] = {k: v for k, v in c.items() if k not in ("p", "pct")} | {"with_five_fire_years": int(len(Ydf))}
        if yrs == (2003, 2025):
            same = Ydf.loc[Ydf.index.intersection(sets[(2001, 2025)])]
            c2 = _trend_map_counts(same.to_numpy(float))
            out["2003_2025_on_the_2001_map_hexagons"] = {k: v for k, v in c2.items() if k not in ("p", "pct")}
    out["floor_per_year"] = HEX_FLOOR
    out["rule"] = "BH 5% among the tested level 3 hexagons; Hamed and Rao Mann Kendall; sign from Sen's slope of log(1 + yearly total)"
    return out


def _monthly_by_continent_firecci(con) -> pd.DataFrame:
    """ESA Fire_cci MRBA60H burned area (km2) by continent and month, 2003 to 2018 (a hexagon's continent: the most
    common among its level 5 hexagons in cells.parquet)."""
    from . import climate as K
    f = K.out("firecci_l3.parquet")
    return con.execute(f"""WITH cont AS (SELECT h3_cell_to_parent(h3_string_to_h3(h3), 3) AS hex, mode(continent) AS continent
                                         FROM '{PB.products('cells.parquet')}' GROUP BY 1)
                           SELECT coalesce(continent, 'Other') AS continent, yr::INT AS yr, mo::INT AS mo, sum(ba_km2) AS ba
                           FROM '{f}' LEFT JOIN cont USING (hex) WHERE product = 0 GROUP BY ALL""").df()


def trends_2003_2018(con, am: pd.DataFrame, grid: pd.DataFrame) -> dict:
    """World and continent trends (Hamed and Rao, Sen's slope, % per decade) over 2003 to 2018, the years of ESA's
    Fire_cci MODIS burned area, for the record, the MODIS only record and the burned area."""
    yrs = (2003, 2018)
    groups = {k: g for k, g in am.groupby(["kind", "id"])}
    ba = _monthly_by_continent_firecci(con)
    g = pd.DataFrame([(y, m) for y in range(yrs[0], yrs[1] + 1) for m in range(1, 13)], columns=["yr", "mo"])
    rows = []
    for kind, pid in [("world", "WORLD")] + [("continent", c) for c in CONTINENTS]:
        r = {"kind": kind, "id": pid, "name": "World" if kind == "world" else pid}
        for col, lab in (("h", "record"), ("modis", "modis_only")):
            t = A.trend(_series(groups[(kind, pid)], grid, col), years=yrs)
            r[lab] = {"pct_per_decade": _r(t.get("pct_per_decade"), 1), "p": _r(t.get("p"), 4)}
        b = ba if kind == "world" else ba[ba.continent == pid]
        s = g.merge(b.groupby(["yr", "mo"]).ba.sum().reset_index(), on=["yr", "mo"], how="left").fillna({"ba": 0.0})
        t = A.trend(s.rename(columns={"ba": "value"}), years=yrs)
        r["firecci_burned_area"] = {"pct_per_decade": _r(t.get("pct_per_decade"), 1), "p": _r(t.get("p"), 4)}
        rows.append(r)
    return {"years": list(yrs), "burned_area": "ESA Fire_cci MRBA60H (MODIS 250 m), sum of km2 per year", "rows": rows}


def _yearly(am_groups, grid, kind, pid, col="h") -> pd.Series:
    s = _series(am_groups[(kind, pid)], grid, col)
    k = s.groupby("yr").value.agg(["sum", "count"])
    return k[k["count"] == 12]["sum"]


def malaysia_means(am: pd.DataFrame, grid: pd.DataFrame) -> dict:
    """Malaysia's mean hotspots a year in 2001 to 2005 and 2021 to 2025, and the year after which it fell (Pettitt)."""
    from . import validate as V
    groups = {k: g for k, g in am.groupby(["kind", "id"])}
    y = _yearly(groups, grid, "country", "MYS").loc[2001:2025]
    pt = V.pettitt(y.to_numpy())
    first_low = int(y.index[pt["index"]])
    return {"id": "MYS", "mean_2001_2005": _r(y.loc[2001:2005].mean(), 0), "mean_2021_2025": _r(y.loc[2021:2025].mean(), 0),
            "ratio": _r(y.loc[2021:2025].mean() / y.loc[2001:2005].mean(), 3),
            "pettitt": {"last_high_year": first_low - 1, "first_low_year": first_low, "p": _r(pt["p"], 5),
                        "mean_before": _r(y.loc[:first_low - 1].mean(), 0), "mean_after": _r(y.loc[first_low:].mean(), 0)},
            "yearly": {int(k): _r(v, 0) for k, v in y.items()}}


def _rank_of(y: pd.Series, year: int) -> int:
    return int(y.rank(ascending=False, method="min")[year])


def argentina_case(am: pd.DataFrame, grid: pd.DataFrame) -> dict:
    """The 2022 Corrientes fires and two other Argentine records, from the published series (ranks among 2001 to 2025
    for years, and among the same calendar month of 2001 to 2026 for months)."""
    groups = {k: g for k, g in am.groupby(["kind", "id"])}

    def month(kind, pid, yr, mo):
        s = _series(groups[(kind, pid)], grid, "h").dropna(subset=["value"])
        m = s[s.mo == mo].set_index("yr").value
        base = m.loc[A.BASE_YEARS[0]:A.BASE_YEARS[1]]
        return {"h": _r(m[yr], 0), "median": _r(base.median(), 0), "ratio": _r(m[yr] / base.median(), 2), "rank": _rank_of(m, yr),
                "years": int(len(m))}

    def year(kind, pid, yr):
        y = _yearly(groups, grid, kind, pid).loc[2001:2025]
        return {"total": _r(y[yr], 0), "rank": _rank_of(y, yr), "years": int(len(y)), "median_year": _r(y.median(), 0)}

    s = _series(groups[("state", "ARG-1308")], grid, "h")
    cr = A.critical(s.dropna(subset=["value"]))
    nv = am[(am.kind == "state") & (am.id == "ARG-1308") & am.yr.between(2010, 2013)].groupby("yr")[["h", "modis"]].sum()
    naive = {int(y): _r(r.modis if y < 2012 else r.h, 0) for y, r in nv.iterrows()}
    return {"corrientes": {"id": "ARG-1308", "year_2022": year("state", "ARG-1308", 2022), "february_2022": month("state", "ARG-1308", 2022, 2),
                           "critical_months": cr["critical_period"],
                           "naive_vs_harmonized_2010_2013": {"naive": naive, "harmonized": {int(y): _r(v, 0) for y, v in nv.h.items()},
                                                             "naive_jump_2011_2012": _r(naive[2012] / naive[2011], 2),
                                                             "harmonized_change_2011_2012": _r(nv.h[2012] / nv.h[2011], 2)}},
            "argentina": {"id": "ARG", "february_2022": month("country", "ARG", 2022, 2), "year_2022": year("country", "ARG", 2022)},
            "entre_rios": {"id": "ARG-1309", "year_2008": year("state", "ARG-1309", 2008)},
            "cordoba": {"id": "ARG-1299", "year_2020": year("state", "ARG-1299", 2020)}}


def _report_places(names: dict) -> list[tuple[str, str, str]]:
    """(table, kind, id) of every place in the report's trend tables: continents, countries, states, sensitivity."""
    s = json.loads(out("summary.json").read_text())
    rows = [("tbl-continents", "world", "WORLD")] + [("tbl-continents", "continent", c) for c in CONTINENTS]
    for key, kind, tbl in (("countries", "country", "tbl-places-countries"), ("states", "state", "tbl-places-states")):
        for r in s["places"][key]["rising"] + s["places"][key]["falling"]:
            rows.append((tbl, kind, r["id"]))
    rows += [("tbl-sensitivity", k, i) for k, i in KEY_PLACES]
    return rows


def sen_ci_places(am: pd.DataFrame, grid: pd.DataFrame, names: dict) -> dict:
    """95% intervals of Sen's slope (% per decade of yearly fire, on log(1 + yearly total), as analytics.trend) for every
    place in the report's trend tables, 2001 to 2025 (and 2003 to 2025 for the sensitivity table): with the plain Mann
    Kendall variance (Gilbert 1987), and wider with the Hamed and Rao variance where it applies."""
    groups = {k: g for k, g in am.groupby(["kind", "id"])}
    rows = []
    for tbl, kind, pid in _report_places(names):
        s = _series(groups[(kind, pid)], grid, "h")
        for yrs in ((2001, 2025),) + (((2003, 2025),) if tbl == "tbl-sensitivity" else ()):
            t = A.trend_ci(s, years=yrs)
            rows.append({"table": tbl, "kind": kind, "id": pid, "name": names.get((kind, pid), "World" if kind == "world" else pid),
                         "years": list(yrs), "pct_per_decade": _r(t.get("pct_per_decade"), 1), "p": _r(t.get("p"), 5),
                         "ci95": [_r(v, 1) for v in t.get("ci95", [None, None])],
                         "ci95_hamed_rao": [_r(v, 1) for v in t.get("ci95_hamed_rao", [None, None])]})
    return {"method": "Sen's slope of log(1 + yearly total), interval by Gilbert (1987) from the Mann Kendall variance",
            "rows": rows}


def _blocks(n: int, size: int) -> list[np.ndarray]:
    return [np.arange(s, min(s + size, n)) for s in range(0, n, size)]


def tested_l3_matrix(con) -> pd.DataFrame:
    """Yearly fire 2001 to 2025 of the level 3 hexagons the published trend map tests (at least five years with fire and
    HEX_FLOOR hotspots a year)."""
    Y = _yearly_matrix(con, A.BASE_YEARS)
    Y = Y[(Y > 0).sum(1) >= 5]
    return Y[Y.mean(1) >= HEX_FLOOR]


def field_significance(Y: np.ndarray, perms: int = PERMUTATIONS, block: int = BLOCK_YEARS, seed: int = 7, q: float = 0.05) -> dict:
    """Is the map's count of trends more than chance, given that neighbouring hexagons and years are related? The order
    of the years is permuted jointly for every hexagon (so the spatial dependence stays), in blocks of `block` years (so
    some of the year to year dependence stays), `perms` times; each time the plain Mann Kendall test runs on every
    hexagon (vectorized) with Benjamini and Hochberg at q. The observed map gets the same test. Direction: the sign of S."""
    from scipy.stats import norm
    Y = np.asarray(Y, float)
    m, n = Y.shape
    D = np.sign(Y[:, None, :] - Y[:, :, None]).reshape(m, n * n).astype(np.float32)   # D[h, a * n + b] = sign(y_b - y_a)
    var = ((n * (n - 1) * (2 * n + 5) - A._ties_term(Y)) / 18).astype(float)
    sd = np.sqrt(var)

    def count(S):
        z = np.where(S > 0, (S - 1) / sd[:, None], np.where(S < 0, (S + 1) / sd[:, None], 0.0))
        p = 2 * norm.sf(np.abs(z))
        out = []
        for k in range(S.shape[1]):
            sig = bh_adjust(p[:, k]) <= q
            out.append((int(sig.sum()), int((sig & (S[:, k] < 0)).sum()), int((sig & (S[:, k] > 0)).sum())))
        return np.array(out)

    def U_of(order):
        pos = np.empty(n, int)
        pos[order] = np.arange(n)
        return (pos[:, None] < pos[None, :]).reshape(-1).astype(np.float32)

    obs = count((D @ U_of(np.arange(n)))[:, None].astype(float))[0]
    rng = np.random.default_rng(seed)
    blocks = _blocks(n, block)
    res = []
    for start in range(0, perms, 100):
        k = min(100, perms - start)
        U = np.stack([U_of(np.concatenate([blocks[i] for i in rng.permutation(len(blocks))])) for _ in range(k)], axis=1)
        res.append(count((D @ U).astype(float)))
    null = np.concatenate(res)
    disc, fall, rise = null[:, 0], null[:, 1], null[:, 2]
    ratio = np.where(rise > 0, fall / np.maximum(rise, 1), np.nan)
    q_ = lambda v, a: _r(float(np.nanpercentile(v, a)), 2)
    obs_ratio = obs[1] / max(obs[2], 1)
    return {"hexagons": int(m), "years": n, "block_years": block, "permutations": perms, "q": q,
            "test": "plain Mann Kendall, BH among the hexagons, the same for the observed map and each permutation",
            "observed": {"discoveries": int(obs[0]), "falling": int(obs[1]), "rising": int(obs[2]), "fall_per_rise": _r(obs_ratio, 2)},
            "null_discoveries": {"median": q_(disc, 50), "p95": q_(disc, 95), "p99": q_(disc, 99), "max": int(disc.max()),
                                 "mean": _r(float(disc.mean()), 1)},
            "null_fall_per_rise": {"median": q_(ratio, 50), "p2_5": q_(ratio, 2.5), "p97_5": q_(ratio, 97.5),
                                   "undefined_share": _r(float(np.isnan(ratio).mean()), 3)},
            "p_field_discoveries": _r(float((1 + (disc >= obs[0]).sum()) / (1 + perms)), 4),
            "p_field_fall_per_rise": _r(float((1 + (np.nan_to_num(ratio, nan=0) >= obs_ratio).sum()) / (1 + perms)), 4)}


def _row_tie_sums(Y: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per row, over groups of tied values of size u: sum u(u-1)(2u+5), sum u(u-1)(u-2), sum u(u-1) (each element of a
    group of u counts the group's term / u)."""
    c = (Y[:, :, None] == Y[:, None, :]).sum(-1).astype(float)
    return ((c - 1) * (2 * c + 5)).sum(1), ((c - 1) * (c - 2)).sum(1), (c - 1).sum(1)


def mk_pairs(Y: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Plain Mann Kendall p of every row of Y against times t that may repeat (a bootstrap sample of years): S over the
    pairs with different times, and the variance of S with ties in both the times and the values (Kendall 1975)."""
    from scipy.stats import norm
    n = len(t)
    i, j = np.triu_indices(n, 1)
    st = np.sign(t[j] - t[i])
    S = (np.sign(Y[:, j] - Y[:, i]) * st).sum(1)
    a1, a2, a3 = _row_tie_sums(Y)
    _, cnt = np.unique(t, return_counts=True)
    t1, t2, t3 = (np.sum(cnt * (cnt - 1) * (2 * cnt + 5)), np.sum(cnt * (cnt - 1) * (cnt - 2)), np.sum(cnt * (cnt - 1)))
    var = ((n * (n - 1) * (2 * n + 5) - t1 - a1) / 18 + t2 * a2 / (9 * n * (n - 1) * (n - 2)) + t3 * a3 / (2 * n * (n - 1)))
    z = np.where(S > 0, (S - 1) / np.sqrt(var), np.where(S < 0, (S + 1) / np.sqrt(var), 0.0))
    return S, 2 * norm.sf(np.abs(z))


def ratio_ci(Y: np.ndarray, draws: int = BOOT_DRAWS, block: int = BLOCK_YEARS, seed: int = 11, q: float = 0.05) -> dict:
    """A 95% interval for the map's falls per rise. Moving blocks of `block` consecutive years are drawn with
    replacement, the same years for every hexagon (so neighbours stay related), until there are as many years as in the
    record; each year keeps its date, so the trend stays in the sample. Each draw runs the plain Mann Kendall test with
    the ties in the dates allowed for, then Benjamini and Hochberg at q among the hexagons; direction: the sign of S.
    (The plain test gives the published ratio of 2.41 on the observed years too.) The interval shows how much the count
    could move with other weather in the same decades."""
    Y = np.asarray(Y, float)
    m, n = Y.shape
    t = np.arange(n)
    S0, p0 = mk_pairs(Y, t)
    sig0 = bh_adjust(p0) <= q
    obs = (int((sig0 & (S0 < 0)).sum()), int((sig0 & (S0 > 0)).sum()))
    rng = np.random.default_rng(seed)
    starts = np.arange(n - block + 1)
    k = int(np.ceil(n / block))
    vals = np.empty((draws, 3))
    for d in range(draws):
        idx = np.concatenate([np.arange(s0, s0 + block) for s0 in rng.choice(starts, k)])[:n]
        S, p = mk_pairs(Y[:, idx], t[idx])
        sig = bh_adjust(p) <= q
        f, r = int((sig & (S < 0)).sum()), int((sig & (S > 0)).sum())
        vals[d] = (f, r, f / max(r, 1))
    pc = lambda v, a: _r(float(np.percentile(v, a)), 2)
    ratio = obs[0] / max(obs[1], 1)
    return {"hexagons": int(m), "draws": draws, "block_years": block, "q": q,
            "observed": {"falling": obs[0], "rising": obs[1], "fall_per_rise": _r(ratio, 2)},
            "fall_per_rise_ci95": [pc(vals[:, 2], 2.5), pc(vals[:, 2], 97.5)], "fall_per_rise_median": pc(vals[:, 2], 50),
            # a draw holds about 16 of the 25 years (the rest repeat), so it has less power; the ratio of what passes
            # sits a little lower than observed (a bias corrected interval would be too unstable to report)
            "share_of_draws_below_observed": _r(float((vals[:, 2] < ratio).mean()), 3),
            "draws_with_more_falls_than_rises_pct": _r(float(100 * (vals[:, 0] > vals[:, 1]).mean()), 1),
            "falling_ci95": [pc(vals[:, 0], 2.5), pc(vals[:, 0], 97.5)], "rising_ci95": [pc(vals[:, 1], 2.5), pc(vals[:, 1], 97.5)],
            "method": ("moving block bootstrap of dated years (blocks of 3, the same years for all hexagons), plain Mann Kendall "
                       "with tied dates, BH 5%; a residual bootstrap around Sen lines was tried first and dropped: its shorter "
                       "memory made the test stronger in every draw, so its interval (1.87 to 2.33) missed the observed ratio")}


def hex_error_nonempty(con, model: str = "gbm_ta") -> dict:
    """How good a modelled hexagon month is where there is fire: the median error and the 90% range coverage of the held
    out totals of cross validation (cv_totals.parquet) where VIIRS saw at least 10 and at least 100 hotspots. Coverage
    is honest: the range is calibrated on the other folds (as harmonize.fit_intervals), for each fold in turn."""
    from . import harmonize as H
    f = C.work("models", "cv_totals.parquet")
    t = con.execute(f"SELECT y, p, scale, fold FROM '{f}' WHERE model = '{model}' AND scale LIKE '%month'").df()
    inside = np.zeros(len(t), bool)
    for fold in sorted(t.fold.unique()):
        cal, te = t.fold != fold, (t.fold == fold).to_numpy()
        ai = H.AreaInterval().fit(t.p[cal].to_numpy(), t.y[cal].to_numpy())
        lo, hi = ai.bounds(t.p[te].to_numpy())
        inside[te] = (t.y[te].to_numpy() >= lo) & (t.y[te].to_numpy() <= hi)
    t["inside"] = inside
    t["err"] = np.abs(t.p - t.y) / t.y.clip(lower=1)
    t["rel"] = (t.p - t.y) / t.y.clip(lower=1)
    rows = []
    for sc in ("cell x month", "region L4 x month", "region L3 x month"):
        g = t[t.scale == sc]
        for floor in (0, 10, 100):
            x = g[g.y >= floor] if floor else g
            rows.append({"scale": sc, "viirs_at_least": floor, "units": int(len(x)),
                         "median_abs_error_pct": _r(100 * x.err.median(), 1), "median_signed_error_pct": _r(100 * x.rel.median(), 1),
                         "coverage_90": _r(x.inside.mean(), 3)})
    return {"model": model, "what": "held out hexagon month totals of cross validation (years held out), Terra and Aqua model",
            "error": "|model - VIIRS| / max(VIIRS, 1)", "rows": rows}


def boreal_sensitivity(am: pd.DataFrame, grid: pd.DataFrame) -> dict:
    """Canada and the Northwest Territories: their trend with and without the record years 2023 to 2025."""
    groups = {k: g for k, g in am.groupby(["kind", "id"])}
    out = {}
    for kind, pid, name in (("country", "CAN", "Canada"), ("state", "CAN-635", "Northwest Territories, Canada")):
        s = _series(groups[(kind, pid)], grid, "h")
        r = {"name": name}
        for yrs in ((2001, 2025), (2001, 2022), (2003, 2022)):
            t = A.trend_ci(s, years=yrs)
            r[f"{yrs[0]}_{yrs[1]}"] = {"pct_per_decade": _r(t.get("pct_per_decade"), 1), "p": _r(t.get("p"), 5),
                                       "ci95": [_r(v, 1) for v in t.get("ci95", [None, None])]}
        y = _yearly(groups, grid, kind, pid).loc[2001:2025]
        r["top_years"] = [int(v) for v in y.sort_values(ascending=False).index[:3]]
        r["share_of_2001_2025_in_2023_2025_pct"] = _pct(y.loc[2023:2025].sum(), y.sum(), 1)
        out[pid] = r
    return out


def r1_checks(keys=None, write: bool = True, log=print) -> dict:
    """Compute the review checks and add them to models/r1_checks.json (other keys stay). keys: a subset of
    seam_by_band, hex_fdr_2003, trends_2003_2018, malaysia_means, argentina_case, sen_ci, field_significance, ratio_ci,
    hex_error_nonempty, boreal_sensitivity (all by default)."""
    import warnings
    con = _con()
    am, grid = _monthly(con)
    names = _names()
    want = set(keys) if keys else None
    res = {}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        jobs = {"seam_by_band": lambda: seam_by_fire_band(con), "hex_fdr_2003": lambda: hex_fdr_2003(con),
                "trends_2003_2018": lambda: trends_2003_2018(con, am, grid), "malaysia_means": lambda: malaysia_means(am, grid),
                "argentina_case": lambda: argentina_case(am, grid), "sen_ci": lambda: sen_ci_places(am, grid, names),
                "hex_error_nonempty": lambda: hex_error_nonempty(con), "boreal_sensitivity": lambda: boreal_sensitivity(am, grid)}
        for k, f in jobs.items():
            if want is None or k in want:
                t0 = time.time()
                res[k] = f()
                log(f"r1 {k}: {time.time() - t0:.0f} s")
        if want is None or {"field_significance", "ratio_ci"} & want:
            Y = tested_l3_matrix(con).to_numpy(float)
            for k, f in (("field_significance", field_significance), ("ratio_ci", ratio_ci)):
                if want is None or k in want:
                    t0 = time.time()
                    res[k] = f(Y)
                    log(f"r1 {k}: {time.time() - t0:.0f} s")
    con.close()
    if write:
        old = json.loads(R1_PATH.read_text()) if R1_PATH.exists() else {}
        old.update(res)
        old["built"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with C.atomic(R1_PATH) as tmp:
            tmp.write_text(PB.strict_json(old, indent=1))
    return res
