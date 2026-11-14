"""Step 5: the modelling panel, one row per (cell, month) for every fire-prone cell.

Gold has rows only where a satellite saw something. Harmonization also needs the months where MODIS
saw nothing, because about 7.5% of VIIRS detections fall in such cell-months (2012, measured). So the
panel is the full grid: every cell where any satellite ever recorded a vegetation fire, times every
month. For each row it holds:

  * per satellite (T Terra, A Aqua, S Suomi NPP, N NOAA-20, J NOAA-21): detections (n), day (nd),
    night (nn), small FRP < 5 MW (ns), large FRP >= 50 MW (nl), total FRP (frp), mean pixel area (pix),
    fire days (fd) and level-7 cell days (c7). Science quality and near real time rows are added
    together: FIRMS never publishes both for the same satellite and day.
  * cov_X: the share of the month's days on which satellite X delivered any data (fleet table)
  * MODIS context that also exists before 2012: Aqua + Terra detections summed over the level-4 and
    level-3 parent cells, and the cell's MODIS climatology for that calendar month
Only MODIS-derived context is added, so the same features exist in the years we back-cast.
"""
from __future__ import annotations

import time

from . import aggregate as AG
from . import config as C

SATS = {"T": "Terra", "A": "Aqua", "S": "Suomi-NPP", "N": "NOAA-20", "J": "NOAA-21"}
METRICS = {"n": "n_main", "nd": "n_day", "nn": "n_night", "ns": "n_small", "nl": "n_large", "frp": "frp_sum",
           "fd": "fire_days", "c7": "cell7_days", "nm": "n_maskrule"}
CLIM_YEARS = (2003, 2019)      # both MODIS satellites flying, orbits not yet drifting


def panel_path(year: int):
    return C.work("panel_l5", f"year={year}", "data.parquet")


def _gold(years) -> str:
    files = [str(AG.gold_path(y)) for y in years if AG.gold_path(y).exists()]
    if not files:
        raise FileNotFoundError("no gold files: run `fireharmony aggregate` first")
    return f"read_parquet({files})"


def build_static(con=None) -> dict:
    """The cell universe and the MODIS climatology (needed by every panel year)."""
    con = con or C.connect()
    out_u, out_c = C.work("panel_l5", "universe.parquet"), C.work("panel_l5", "modis_climatology.parquet")
    with C.atomic(out_u) as tmp:
        con.execute(f"""COPY (
            SELECT cell, sum(n_allconf) AS veg_all_time FROM {_gold(C.years())}
            GROUP BY cell HAVING sum(n_allconf) > 0 ORDER BY cell) TO '{tmp}' (FORMAT parquet)""")
    a, b = CLIM_YEARS
    with C.atomic(out_c) as tmp:
        con.execute(f"""COPY (
            SELECT cell, mo,
                   sum(n_main) FILTER (WHERE family = 'MODIS') / {b - a + 1}   AS clim_m,      -- Terra + Aqua, per month
                   sum(n_main) FILTER (WHERE satellite = 'Terra') / {b - a + 1} AS clim_t      -- Terra only
            FROM {_gold(range(a, b + 1))} GROUP BY ALL ORDER BY cell, mo) TO '{tmp}' (FORMAT parquet)""")
    n_cells = con.execute(f"SELECT count(*) FROM '{out_u}'").fetchall()[0][0]
    return {"cells": n_cells, "universe": str(out_u), "climatology": str(out_c)}


def months_of(year: int, con) -> list[int]:
    """Solar months of `year` that hold any detection. Gold is split by solar month, so this includes
    October 2000: the archive starts on 1 Nov 2000 UTC, which is still 31 October in the Americas."""
    return [r[0] for r in con.execute(f"SELECT DISTINCT mo FROM '{AG.gold_path(year)}' ORDER BY 1").fetchall()]


def build_year(year: int, con=None) -> dict:
    con = con or C.connect()
    con.execute("SET preserve_insertion_order=false")
    t = time.time()
    u, clim = C.work("panel_l5", "universe.parquet"), C.work("panel_l5", "modis_climatology.parquet")
    fleet = C.work("gold", "fleet_month.parquet")
    if not (u.exists() and clim.exists()):
        raise FileNotFoundError("run `fireharmony panel --static` first")
    mos = months_of(year, con)
    have = {r[0] for r in con.execute(f"SELECT DISTINCT mo FROM '{fleet}' WHERE yr = {year}").fetchall()}
    lacking = [m for m in mos if m not in have and not (year == 2000 and m == 10)]   # Oct 2000 is solar only
    if lacking:
        raise RuntimeError(f"fleet table has no rows for {year} months {lacking}: run `fireharmony aggregate` to rebuild it")
    wide = ",\n".join(
        f"sum({src}) FILTER (WHERE satellite = '{sat}') AS {p}_{m}"
        for p, sat in SATS.items() for m, src in METRICS.items())
    pix = ",\n".join(
        f"sum(pixel_km2_mean * n_main) FILTER (WHERE satellite = '{sat}') / nullif(sum(n_main) FILTER (WHERE satellite = '{sat}'), 0) AS {p}_pix"
        for p, sat in SATS.items())
    # coalesce inside least(): DuckDB's LEAST skips NULLs, so least(1.0, NULL) would be 1.0, i.e. a satellite
    # that did not fly would look fully present. A missing satellite must get coverage 0.
    cov = ",\n".join(f"least(1.0, coalesce(max(data_days) FILTER (WHERE satellite = '{sat}'), 0) / ndays) AS cov_{p}"
                     for p, sat in SATS.items())
    fill = ", ".join(f"coalesce(w.{p}_{m}, 0) AS {p}_{m}" for p in SATS for m in METRICS)
    out = panel_path(year)
    with C.atomic(out) as tmp:
        con.execute(f"""
        COPY (
          WITH grid AS (
            SELECT u.cell, {year} AS yr, m.mo FROM '{u}' u CROSS JOIN (SELECT unnest({mos}) AS mo) m
          ),
          w AS (
            SELECT cell, mo, {wide}, {pix}
            FROM '{AG.gold_path(year)}' GROUP BY cell, mo
          ),
          f AS (
            SELECT mo, {cov}
            FROM (SELECT mo, satellite, sum(days_with_data) AS data_days,
                         day(last_day(make_date({year}, mo, 1))) AS ndays
                  FROM '{fleet}' WHERE yr = {year} GROUP BY mo, satellite)
            GROUP BY mo, ndays
          ),
          j AS (
            SELECT g.cell, g.yr, g.mo, {fill}, {", ".join(f"w.{p}_pix" for p in SATS)},
                   {", ".join(f"coalesce(f.cov_{p}, 0) AS cov_{p}" for p in SATS)},
                   coalesce(c.clim_m, 0) AS clim_m, coalesce(c.clim_t, 0) AS clim_t
            FROM grid g LEFT JOIN w USING (cell, mo) LEFT JOIN f USING (mo) LEFT JOIN '{clim}' c USING (cell, mo)
          )
          SELECT *,
                 sum(T_n + A_n) OVER (PARTITION BY h3_cell_to_parent(cell, 4), mo) AS ctx4_m,
                 sum(T_n + A_n) OVER (PARTITION BY h3_cell_to_parent(cell, 3), mo) AS ctx3_m,
                 sum(T_n)       OVER (PARTITION BY h3_cell_to_parent(cell, 4), mo) AS ctx4_t,
                 sum(T_n)       OVER (PARTITION BY h3_cell_to_parent(cell, 3), mo) AS ctx3_t
          FROM j
          ORDER BY cell, mo
        ) TO '{tmp}' (FORMAT parquet, COMPRESSION zstd)
        """)
    r = con.execute(f"SELECT count(*), sum(T_n + A_n), sum(S_n), sum(N_n) FROM '{out}'").fetchall()[0]
    return {"year": year, "rows": r[0], "modis": int(r[1] or 0), "snpp": int(r[2] or 0), "noaa20": int(r[3] or 0),
            "mb": round(out.stat().st_size / 1e6, 1), "seconds": round(time.time() - t, 1)}
