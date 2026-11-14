"""Step 3: silver detections -> gold summary table (cell x month x satellite).

Vegetation-fire rule ("veg_main"):
  * science-quality rows: NASA's own label, type = 0, and not in open water
  * near-real-time rows (no type): not inside the static-source mask (which includes open water)
Main confidence policy: drop "low" (MODIS < 30 %, VIIRS 'l'); an all-confidence count is kept too.
Months use local solar dates, so a night of burning is not split across two UTC days.

Gold is split by *solar* year. Raw and silver files are split by UTC date, and solar time differs
from UTC by up to 12 hours, so detections on 31 Dec and 1 Jan (UTC) can belong to the neighbouring
solar year (about 45,000 a year, mostly Asia and Australia late on 31 Dec). We read those two edge
days from the neighbouring files, so every (cell, month, satellite) key lives in exactly one file
and distinct counts such as `fire_days` stay exact.
"""
from __future__ import annotations

from . import clean as CL
from . import config as C
from . import static_mask as SM

GOLD = "gold/cell_month_l{lvl}"


def gold_path(year: int, lvl: int | None = None):
    lvl = lvl or C.cfg()["analysis_level"]
    return C.work(GOLD.format(lvl=lvl), f"year={year}", "data.parquet")


def solar_year_source(year: int) -> str:
    """SQL that returns every silver detection whose local solar date falls in `year`."""
    parts = [f"SELECT * FROM read_parquet('{CL.silver_path(year)}') WHERE year(date_solar) = {year}"]
    for nb, edge in ((year - 1, f"{year - 1}-12-31"), (year + 1, f"{year + 1}-01-01")):
        if nb not in C.years():
            continue
        p = CL.silver_path(nb)
        if not p.exists():
            raise FileNotFoundError(f"gold {year} needs silver {nb} for the year edge: run `fireharmony clean --years {nb}`")
        parts.append(f"SELECT * FROM read_parquet('{p}') WHERE date_utc = DATE '{edge}' AND year(date_solar) = {year}")
    return "\n        UNION ALL BY NAME\n        ".join(parts)


SATS = ["Terra", "Aqua", "Suomi-NPP", "NOAA-20", "NOAA-21"]
SENSORS = ["MODIS", "MODIS", "VIIRS_SNPP", "VIIRS_NOAA20", "VIIRS_NOAA21"]
# satellite and quality packed into one small integer: hash keys stay numeric and slim
SATQ = ("CAST((CASE s.satellite " + " ".join(f"WHEN '{x}' THEN {i}" for i, x in enumerate(SATS))
        + " END) * 2 + (s.quality = 'nrt')::INT AS UTINYINT)")
KEYS = "cell, mo, satq"
# FRP outside 0..20,000 MW is treated as missing. Real fires reach ~16,000 MW (MODIS) and ~8,500 MW (VIIRS);
# 80 of 640.6 million raw rows fall outside, including three corrupt NOAA-21 values (+4.5e6 and -9.5e14 MW).
FRP_MAX_MW = 20000


def _decode(col: str, names: list[str]) -> str:
    return "CASE " + " ".join(f"WHEN {col} // 2 = {i} THEN '{n}'" for i, n in enumerate(names)) + " END"


def aggregate_year(year: int, con=None, mask_tag: str = "all") -> dict:
    """One solar year of gold, in four statements that each get the full memory budget.

    The two distinct counts (fire days, level-7 cell days) are plain GROUP BY queries on numeric keys,
    written to their own files and joined at the end. DISTINCT aggregates inside one big GROUP BY could
    not spill to disk and ran out of memory on the VIIRS years (2024: 69 million detections, 29 million
    distinct level-7 cell days)."""
    con = con or C.connect()
    con.execute("SET preserve_insertion_order=false")      # the output is sorted explicitly below
    lvl = C.cfg()["analysis_level"]
    mlvl = C.cfg()["static_mask"]["h3_level"]
    msk, out = SM.mask_path(mask_tag), gold_path(year)
    if not msk.exists():
        raise FileNotFoundError(f"{msk} missing: run `fireharmony mask` first")
    fire = "veg_main AND conf_ok"
    d = f"""
      WITH s AS NOT MATERIALIZED (
        {solar_year_source(year)}
      ),
      d AS NOT MATERIALIZED (
        SELECT s.h3_{lvl} AS cell, month(s.date_solar) AS mo, {SATQ} AS satq,
               s.h3_7, s.date_solar, s.daynight, s.pixel_km2,
               CASE WHEN s.frp BETWEEN 0 AND {FRP_MAX_MW} THEN s.frp END AS frp,   -- corrupt values -> missing, detection still counts
               (m.cell IS NOT NULL) AS in_mask,
               -- vegetation fire: NASA's label where it exists, else outside the mask; never in open water
               -- (NASA labels a few detections at offshore platforms as type 0, e.g. 416 in one Persian Gulf cell)
               CASE WHEN s.type IS NOT NULL THEN s.type = 0 AND NOT coalesce(m.open_water, false)
                    ELSE m.cell IS NULL END AS veg_main,
               s.conf_class <> 'low' AS conf_ok
        FROM s LEFT JOIN read_parquet('{msk}') m ON s.h3_{mlvl} = m.cell
      )"""
    parts = {
        "main": f"""SELECT {KEYS},
                   count(*) FILTER (WHERE {fire})                          AS n_main,
                   count(*) FILTER (WHERE veg_main)                        AS n_allconf,
                   count(*) FILTER (WHERE NOT in_mask AND conf_ok)         AS n_maskrule,
                   count(*) FILTER (WHERE {fire} AND daynight = 'D')       AS n_day,
                   count(*) FILTER (WHERE {fire} AND daynight = 'N')       AS n_night,
                   count(*) FILTER (WHERE {fire} AND frp < 5)              AS n_small,
                   count(*) FILTER (WHERE {fire} AND frp >= 50)            AS n_large,
                   sum(frp) FILTER (WHERE {fire})                          AS frp_sum,
                   avg(pixel_km2) FILTER (WHERE {fire})                    AS pixel_km2_mean,
                   count(*) FILTER (WHERE NOT veg_main)                    AS n_nonveg
            FROM d GROUP BY ALL""",
        "days": f"""SELECT cell, month(date_solar) AS mo, satq, count(*) AS fire_days
            FROM (SELECT DISTINCT cell, date_solar, satq FROM d WHERE {fire}) GROUP BY ALL""",
        "c7": f"""SELECT cell, month(date_solar) AS mo, satq, count(*) AS cell7_days
            FROM (SELECT DISTINCT cell, h3_7, date_solar, satq FROM d WHERE {fire}) GROUP BY ALL""",
    }
    files = {k: C.ensure_parent(out.parent / f"_part_{k}.parquet") for k in parts}
    for k, q in parts.items():
        con.execute(f"COPY ({d} {q}) TO '{files[k]}' (FORMAT parquet)")
    with C.atomic(out) as tmp:
        con.execute(f"""
        COPY (
          SELECT m.cell, CAST({year} AS BIGINT) AS yr, m.mo,
                 {_decode("m.satq", SENSORS)} AS sensor, {_decode("m.satq", SATS)} AS satellite,
                 CASE WHEN m.satq // 2 <= 1 THEN 'MODIS' ELSE 'VIIRS' END AS family,
                 CASE WHEN m.satq % 2 = 1 THEN 'nrt' ELSE 'sp' END AS quality,
                 m.* EXCLUDE (cell, mo, satq),
                 coalesce(dd.fire_days, 0) AS fire_days, coalesce(c.cell7_days, 0) AS cell7_days
          FROM '{files["main"]}' m LEFT JOIN '{files["days"]}' dd USING ({KEYS}) LEFT JOIN '{files["c7"]}' c USING ({KEYS})
          ORDER BY cell, mo, sensor, satellite, quality
        ) TO '{tmp}' (FORMAT parquet, COMPRESSION zstd)
        """)
    for f in files.values():
        f.unlink(missing_ok=True)
    r = con.execute(f"SELECT count(*), sum(n_main), sum(n_allconf) FROM read_parquet('{out}')").fetchall()[0]
    return {"year": year, "rows": r[0], "n_main": int(r[1] or 0), "n_allconf": int(r[2] or 0), "mb": round(out.stat().st_size / 1e6, 1)}


def fleet(con=None) -> str:
    """Which satellites delivered data on how many days in each month (to normalise for fleet size).

    Built from the RAW FIRMS files, which are always complete. (It used to be built from whichever silver years
    existed: after re-cleaning only a few years it silently set coverage to 0 for every other year, and the panel
    then turned 24 years of the record into "no data".) A missing raw year is an error."""
    con = con or C.connect()
    files = [C.raw("firms", f"year={y}", "detections.parquet") for y in C.years()]
    missing = [str(f) for f in files if not f.exists()]
    if missing:
        raise FileNotFoundError(f"raw FIRMS files missing: {missing}")
    out = C.work("gold", "fleet_month.parquet")
    with C.atomic(out) as tmp:
        con.execute(f"""
        COPY (SELECT year(acq_date) yr, month(acq_date) mo, sensor, satellite, quality,
                     count(DISTINCT acq_date) AS days_with_data, count(*) AS detections
              FROM read_parquet({[str(f) for f in files]}) GROUP BY ALL ORDER BY 1, 2, 3, 4)
        TO '{tmp}' (FORMAT parquet)
        """)
    yrs = {r[0] for r in con.execute(f"SELECT DISTINCT yr FROM '{out}'").fetchall()}
    if yrs != set(C.years()):
        raise RuntimeError(f"fleet table covers {sorted(yrs)}, expected {C.years()}")
    return str(out)
