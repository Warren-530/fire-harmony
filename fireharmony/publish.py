"""Step 10: the files the web app reads (small, pre-built, laid out for the browser).

Every layout follows one query the app makes, so DuckDB in the browser downloads only what it needs:

  cells.parquet               hexagon facts (H3 level 5 as text): place names, land cover, peat, people
  area_monthly.parquet        monthly totals of every country, state, continent and the world (named places: no hexagons needed)
  areas.json                  the list of named places for search, with their size and centre
  map_l3.parquet, map_l4.parquet   one row per hexagon and month, sorted by month (the map of one month = one small read)
  cell_l3.parquet, cell_l4.parquet same values sorted by hexagon (large drawn areas, built from whole parent hexagons)
  l5/<level 1 hexagon>.parquet     full detail for drawn areas, one small file per large region (about 600,000 km2)
  meta.json                   record version, months covered, satellites, interval table, validation summary, units

Values: h = harmonized hotspots on the NOAA-20 VIIRS scale, modis = the same on the MODIS scale (per satellite),
t, a, s, n, j = raw detections of Terra, Aqua, Suomi NPP, NOAA-20, NOAA-21, src = best source in the group
(0 VIIRS observed, 1 Terra + Aqua model, 2 Terra only model, 3 no data). Months with src 3 are unknown, not zero.
"""
from __future__ import annotations

import json
import time

import pandas as pd

from . import config as C
from . import harmonize as H

VERSION = "1.0"
MIN_H = 0.05          # hexagon months below this (and with no detection at all) are left out of the files


def products(*parts: str):
    return C.path("products").joinpath(f"v{VERSION}", *parts)


def _harmonized() -> str:
    files = [str(H.harmonized_path(y)) for y in C.years() if H.harmonized_path(y).exists()]
    return f"read_parquet({files})"


def _sums(prefix: str = "") -> str:
    return (f"CAST(round(sum({prefix}h), 2) AS FLOAT) AS h, CAST(round(sum({prefix}modis_eq), 2) AS FLOAT) AS modis, "
            f"CAST(sum({prefix}T_n) AS INT) AS t, CAST(sum({prefix}A_n) AS INT) AS a, CAST(sum({prefix}S_n) AS INT) AS s, "
            f"CAST(sum({prefix}N_n) AS INT) AS n, CAST(sum({prefix}J_n) AS INT) AS j, CAST(min({prefix}source) AS TINYINT) AS src")


def _copy(con, sql: str, out, row_group: int = 20_000) -> dict:
    with C.atomic(C.ensure_parent(out)) as tmp:
        con.execute(f"COPY ({sql}) TO '{tmp}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE {row_group})")
    n = con.execute(f"SELECT count(*) FROM '{out}'").fetchall()[0][0]
    return {"file": out.name, "rows": n, "mb": round(out.stat().st_size / 1e6, 2)}


def build(con=None) -> dict:
    con = con or C.connect()
    con.execute("SET preserve_insertion_order=true")
    t0, report = time.time(), {}
    static = C.work("features", "cell_static_l5.parquet")
    hz = _harmonized()
    kept = f"(SELECT * FROM {hz} WHERE h >= {MIN_H} OR (T_n + A_n + S_n + N_n + J_n) > 0)"

    report["cells"] = _copy(con, f"""
      SELECT h3_h3_to_string(cell) AS h3, CAST(round(lat, 4) AS FLOAT) AS lat, CAST(round(lon, 4) AS FLOAT) AS lon,
             iso3, country, state, state_code, continent, biome, lc_main,
             CAST(round(peat_frac, 3) AS FLOAT) AS peat_frac, CAST(round(pop2020) AS INT) AS pop2020,
             CAST(round(area_km2, 1) AS FLOAT) AS area_km2
      FROM '{static}' WHERE cell IN (SELECT cell FROM '{C.work('panel_l5', 'universe.parquet')}') ORDER BY h3""", products("cells.parquet"))

    # named places: world, continents, countries, states
    # a view, not a table: the record has about 130 million hexagon months, far too many to hold in memory
    con.execute(f"CREATE OR REPLACE TEMP VIEW hs AS SELECT h.*, s.continent, s.iso3, s.country, s.state, s.state_code "
                f"FROM {hz} h LEFT JOIN '{static}' s USING (cell)")
    parts = [f"SELECT 'world' AS kind, 'WORLD' AS id, 'World' AS name, yr, mo, {_sums()} FROM hs GROUP BY yr, mo",
             f"SELECT 'continent', continent, continent, yr, mo, {_sums()} FROM hs WHERE continent IS NOT NULL GROUP BY continent, yr, mo",
             f"SELECT 'country', iso3, any_value(country), yr, mo, {_sums()} FROM hs WHERE iso3 IS NOT NULL GROUP BY iso3, yr, mo",
             f"SELECT 'state', state_code, mode(state || ', ' || country), yr, mo, {_sums()} FROM hs WHERE state_code IS NOT NULL AND state IS NOT NULL GROUP BY state_code, yr, mo"]
    report["area_monthly"] = _copy(con, " UNION ALL ".join(parts) + " ORDER BY kind, id, yr, mo", products("area_monthly.parquet"), 50_000)
    areas = con.execute(f"""
      SELECT kind, id, name, country_iso3, round(lat, 3) AS lat, round(lon, 3) AS lon, cells, round(area_km2) AS area_km2 FROM (
        SELECT 'country' AS kind, iso3 AS id, any_value(country) AS name, iso3 AS country_iso3, avg(lat) lat, avg(lon) lon,
               count(*) cells, sum(area_km2) area_km2 FROM '{static}' WHERE iso3 IS NOT NULL GROUP BY iso3
        UNION ALL
        -- mode, not any_value: a state's border hexagons can carry a neighbour's country (Abu Dhabi was put in Iran)
        SELECT 'state', state_code, mode(state || ', ' || country), mode(iso3), avg(lat), avg(lon), count(*), sum(area_km2)
        FROM '{static}' WHERE state_code IS NOT NULL AND state IS NOT NULL GROUP BY state_code   -- 4 unnamed placeholders, 1 to 6 hexagons
        UNION ALL
        SELECT 'continent', continent, continent, NULL, avg(lat), avg(lon), count(*), sum(area_km2) FROM '{static}'
        WHERE continent IS NOT NULL GROUP BY continent) ORDER BY kind, name""").df()
    products("areas.json").write_text(areas.to_json(orient="records"))
    report["areas"] = {"places": len(areas)}

    # maps and large areas: level 3 and level 4 parents, in two sort orders
    for lvl in (3, 4):
        agg = (f"SELECT h3_h3_to_string(h3_cell_to_parent(cell, {lvl})) AS h3, CAST(yr AS SMALLINT) AS yr, CAST(mo AS TINYINT) AS mo, "
               f"{_sums()} FROM hs GROUP BY ALL HAVING sum(h) >= {MIN_H} OR sum(T_n + A_n + S_n + N_n + J_n) > 0")
        con.execute(f"CREATE OR REPLACE TEMP TABLE agg AS {agg}")
        report[f"map_l{lvl}"] = _copy(con, "SELECT * FROM agg ORDER BY yr, mo, h3", products(f"map_l{lvl}.parquet"))
        report[f"cell_l{lvl}"] = _copy(con, "SELECT * FROM agg ORDER BY h3, yr, mo", products(f"cell_l{lvl}.parquet"))
    con.execute("DROP TABLE agg")

    # full detail, one small file per level 1 region, written in one pass (directories l1=<hexagon>/)
    import shutil
    l5, tmp = products("l5"), products("l5.tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    con.execute(f"""
      COPY (SELECT h3_h3_to_string(h3_cell_to_parent(cell, 1)) AS l1, h3_h3_to_string(cell) AS h3,
                   CAST(yr AS SMALLINT) AS yr, CAST(mo AS TINYINT) AS mo,
                   CAST(round(h, 3) AS FLOAT) AS h, CAST(round(modis_eq, 3) AS FLOAT) AS modis,
                   CAST(T_n AS INT) AS t, CAST(A_n AS INT) AS a, CAST(S_n AS INT) AS s, CAST(N_n AS INT) AS n,
                   CAST(J_n AS INT) AS j, CAST(source AS TINYINT) AS src
            FROM {kept})
      TO '{tmp}' (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (l1), ROW_GROUP_SIZE 20000)""")
    shutil.rmtree(l5, ignore_errors=True)
    tmp.rename(l5)
    files = sorted(l5.glob("l1=*/*.parquet"))
    rows = con.execute(f"SELECT count(*) FROM read_parquet('{l5}/*/*.parquet')").fetchall()[0][0]
    report["l5"] = {"files": len(files), "rows": rows, "mb": round(sum(f.stat().st_size for f in files) / 1e6, 1),
                    "index": {f.parent.name[3:]: f"l5/{f.parent.name}/{f.name}" for f in files}}
    kept_share = con.execute(f"SELECT sum(h) FILTER (WHERE h >= {MIN_H} OR (T_n + A_n + S_n + N_n + J_n) > 0) / sum(h) FROM {hz}").fetchall()[0][0]
    report["share_of_h_kept_in_l5"] = round(float(kept_share), 5)
    con.execute("DROP VIEW hs")

    report.update(build_climatology(con))
    span = con.execute(f"SELECT min(yr * 100 + mo), max(yr * 100 + mo) FROM {hz}").fetchall()[0]
    fleet = con.execute(f"""SELECT satellite, min(yr * 100 + mo) AS first, max(yr * 100 + mo) AS last
                            FROM '{C.work('gold', 'fleet_month.parquet')}' GROUP BY 1 ORDER BY 2""").df()
    meta = {"version": VERSION, "built_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "first_month": int(span[0]), "last_month": int(span[1]), "min_h_kept": MIN_H,
            "scale": "harmonized hotspots per month on the NOAA-20 VIIRS scale (what one NOAA-20 satellite would record)",
            "sources": {"0": "VIIRS observed", "1": "model from MODIS Terra + Aqua", "2": "model from MODIS Terra only", "3": "no data yet"},
            "satellites": fleet.to_dict(orient="records"),
            "intervals": json.loads((C.REPO / "models" / "area_intervals.json").read_text()),
            "validation": validation_summary(),
            "files": report}
    with C.atomic(products("meta.json")) as tmp:
        tmp.write_text(strict_json(meta, indent=1, default=float))
    report["seconds"] = round(time.time() - t0)
    return report


def strict_json(obj, **kw) -> str:
    """JSON that browsers can parse: NaN and infinities become null (Python would write NaN, which JSON.parse rejects)."""
    import math

    def clean(o):
        if isinstance(o, float):
            return o if math.isfinite(o) else None
        if isinstance(o, dict):
            return {k: clean(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [clean(v) for v in o]
        if hasattr(o, "item"):                      # numpy scalars
            return clean(o.item())
        return o
    return json.dumps(clean(obj), allow_nan=False, **kw)


VALIDATION_KEYS = ("seam_ratios", "per_witness", "placebo_seams", "burned_area_witness", "pelt_breaks_within_12_months_of_seam")


def validation_summary() -> dict:
    val = json.loads((C.REPO / "models" / "validation.json").read_text())
    return {k: val[k] for k in VALIDATION_KEYS}


def refresh_meta() -> dict:
    """Put the latest intervals and validation into meta.json without rebuilding the data files."""
    path = products("meta.json")
    meta = json.loads(path.read_text())
    meta["intervals"] = json.loads((C.REPO / "models" / "area_intervals.json").read_text())
    meta["validation"] = validation_summary()
    with C.atomic(path) as tmp:
        tmp.write_text(strict_json(meta, indent=1, default=float))
    return {"meta": str(path), "validation_keys": list(meta["validation"])}


BASE = (2001, 2025)    # full years used for "normal"


def build_climatology(con=None) -> dict:
    """Normal season per level 3 and level 4 hexagon: median and middle 50% of each calendar month over 2001 to 2025.
    Months with no row in the map files had no fire, so they count as zero (leaving them out would push the normal up).
    Exact and light: per hexagon and month the years with fire are collected and the list is padded with zeros to 25
    years before taking the quantiles, so no full hexagon x year x month grid is ever built."""
    con = con or C.connect()
    con.execute("SET preserve_insertion_order=false")
    out = {}
    a, b = BASE
    n_years = b - a + 1
    for lvl in (3, 4):
        src = products(f"cell_l{lvl}.parquet")
        out[f"clim_l{lvl}"] = _copy(con, f"""
          WITH v AS (SELECT h3, mo, list_resize(list(h), {n_years}, 0.0) AS hs
                     FROM '{src}' WHERE yr BETWEEN {a} AND {b} GROUP BY h3, mo)
          SELECT h3, CAST(mo AS TINYINT) AS mo,
                 CAST(round(list_aggregate(hs, 'quantile_cont', 0.5), 2) AS FLOAT) AS median,
                 CAST(round(list_aggregate(hs, 'quantile_cont', 0.25), 2) AS FLOAT) AS q25,
                 CAST(round(list_aggregate(hs, 'quantile_cont', 0.75), 2) AS FLOAT) AS q75
          FROM v ORDER BY h3, mo""", products(f"clim_l{lvl}.parquet"))
    return out


# ------------------------------------------------------------------------------------------ Phase 3 products
def extras(con=None) -> dict:
    """Drivers, outlook and haze for the web app (small files, sorted so one area is a short range read):
      drivers.parquet         kind, id, yr, mo: fire ratio to normal, rain (3 months, % from normal), heat, fire weather,
                              ONI, the fire each driver alone would give (times normal) and the El Nino context
      drivers_models.parquet  one row per area: how well the drivers explain its fire (leave one year out R2) and how
      outlook.parquet         kind, id, lead: chance of above normal fire in the next 1 to 3 months, the normal chance
                              and the skill of the outlook in that area (Brier skill score on held out years)
      haze.parquet            city, yr, mo: PM2.5 (bias corrected and MERRA-2), the smoke the model gives and the fire
                              in the two source regions;  haze.json: the model per city"""
    import shutil

    from . import climate as K
    con = con or C.connect()
    rep = {}
    d = K.out("drivers_monthly.parquet")
    if d.exists():
        rep["drivers"] = _copy(con, f"""SELECT kind, id, yr::SMALLINT AS yr, mo::TINYINT AS mo, ratio::FLOAT AS ratio,
                                        rain3_pct::FLOAT AS rain3_pct, rain3_z::FLOAT AS rain3_z, t2m_anom::FLOAT AS t2m_anom,
                                        fwi_ratio::FLOAT AS fwi_ratio, oni::FLOAT AS oni, in_season, f_rain, f_heat, heat_known, f_drivers,
                                        oni_lagged, rain_z_from_enso
                                 FROM '{d}' WHERE yr >= 2001 ORDER BY kind, id, yr, mo""", products("drivers.parquet"), 25_000)
        m = json.loads((C.REPO / "models" / "drivers.json").read_text())["areas"]
        rows = [{"kind": k.split(":", 1)[0], "id": k.split(":", 1)[1], "r2_cv": v["r2_cv"], "n_months": v["n_months"],
                 "beta_rain": v["beta"]["rain3_z"], "beta_heat": v["beta"]["t2m_z"], "uses_heat": "t2m_z" in v["terms"],
                 "enso_lag": v["enso"].get("lag"), "enso_r": v["enso"].get("r"), "enso_slope": v["enso"].get("slope"),
                 "fire_per_year": v["fire_per_year"]} for k, v in m.items()]
        con.register("dm", pd.DataFrame(rows))
        rep["drivers_models"] = _copy(con, "SELECT * FROM dm ORDER BY kind, id", products("drivers_models.parquet"))
        con.unregister("dm")
    o = K.out("outlook.parquet")
    if o.exists():
        rep["outlook"] = _copy(con, f"SELECT * FROM '{o}' ORDER BY kind, id, lead", products("outlook.parquet"))
    hz = haze_files(con, meta=False)
    if hz:
        rep["haze"] = hz
    meta = json.loads(products("meta.json").read_text())
    meta.setdefault("files", {}).update(rep)
    with C.atomic(products("meta.json")) as tmp:
        tmp.write_text(strict_json(meta, indent=1, default=float))
    return rep


def haze_files(con=None, meta: bool = True) -> dict | None:
    """haze.parquet (every city's months) and haze.json (the model per city) from the haze link's outputs
    (data/work/climate/haze_city_month.parquet and models/haze.json; haze.py and haze_cities.py). meta: also note the
    file in meta.json (extras does that for all its files at once)."""
    from . import climate as K
    con = con or C.connect()
    h = K.out("haze_city_month.parquet")
    if not h.exists():
        return None
    rep = _copy(con, f"""SELECT city, yr::SMALLINT AS yr, mo::TINYINT AS mo, pm25_cnn::FLOAT AS pm25_cnn,
                                pm25_merra2::FLOAT AS pm25_merra2, pm25_model::FLOAT AS pm25_model,
                                smoke_model::FLOAT AS smoke_model, smoke_excess::FLOAT AS smoke_excess,
                                days_over_who::TINYINT AS days_over_who, days_over_50::TINYINT AS days_over_50,
                                sumatra::FLOAT AS fire_sumatra_k, borneo::FLOAT AS fire_borneo_k, rain_mm::FLOAT AS rain_mm
                         FROM '{h}' WHERE yr >= 2001 ORDER BY city, yr, mo""", products("haze.parquet"))
    with C.atomic(products("haze.json")) as tmp:
        tmp.write_text(strict_json(json.loads((C.REPO / "models" / "haze.json").read_text()), indent=1))
    if meta:
        m = json.loads(products("meta.json").read_text())
        m.setdefault("files", {})["haze"] = rep
        with C.atomic(products("meta.json")) as tmp:
            tmp.write_text(strict_json(m, indent=1, default=float))
    return rep
