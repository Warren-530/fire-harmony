"""Step 2: clean and standardise FIRMS detections (raw -> silver), one year at a time.

Output: work/silver/detections/year=YYYY/data.parquet with one tidy schema for all sensors:
location, UTC and local solar time, sensor/satellite/family, quality (sp/nrt), unified
confidence class, fire radiative power, pixel size, type, and H3 cell IDs at levels 3 to 8.
Rows keep the raw files' spatial order (no sort, to stay light on memory). Nothing is dropped here: filtering happens later, so every choice stays visible and testable.
"""
from __future__ import annotations

import time

from . import config as C

SILVER = "silver/detections"


def silver_path(year: int):
    return C.work(SILVER, f"year={year}", "data.parquet")


def clean_year(year: int, con=None) -> dict:
    con = con or C.connect()
    cf = C.cfg()["confidence"]
    src = C.raw("firms", f"year={year}", "detections.parquet")
    out = silver_path(year)
    h3_cols = ",\n      ".join(f"h3_latlng_to_cell(lat, lon, {r}) AS h3_{r}" for r in C.cfg()["h3_levels"])
    t = time.time()
    with C.atomic(out) as tmp:
        con.execute(f"""
    COPY (
      WITH b AS (
        SELECT ST_Y(geometry) AS lat, ST_X(geometry) AS lon, * EXCLUDE (geometry)
        FROM read_parquet('{src}')
      )
      SELECT
        lat, lon,
        acq_datetime                                        AS acq_utc,
        acq_date                                            AS date_utc,
        acq_datetime + to_seconds(CAST(round(lon * 240) AS BIGINT)) AS acq_solar,   -- 4 minutes per degree
        CAST(acq_datetime + to_seconds(CAST(round(lon * 240) AS BIGINT)) AS DATE) AS date_solar,
        sensor, satellite,
        CASE WHEN sensor = 'MODIS' THEN 'MODIS' ELSE 'VIIRS' END AS family,
        quality, version,
        frp, daynight, scan, track,
        scan * track                                        AS pixel_km2,
        coalesce(brightness, bright_ti4)                    AS bt_mir_k,
        coalesce(bright_t31, bright_ti5)                    AS bt_tir_k,
        confidence                                          AS conf_raw,
        confidence_pct                                      AS conf_pct,
        CASE WHEN sensor = 'MODIS' THEN
               CASE WHEN confidence_pct < {cf['modis_low_below']} THEN 'low'
                    WHEN confidence_pct < {cf['modis_high_from']} THEN 'nominal' ELSE 'high' END
             ELSE CASE confidence WHEN 'l' THEN 'low' WHEN 'n' THEN 'nominal' WHEN 'h' THEN 'high' END
        END                                                 AS conf_class,
        type,
      {h3_cols}
      FROM b
    ) TO '{tmp}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 200000)
    """)
    n_raw = con.execute(f"SELECT count(*) FROM read_parquet('{src}')").fetchall()[0][0]
    n_out = con.execute(f"SELECT count(*) FROM read_parquet('{out}')").fetchall()[0][0]
    return {"year": year, "rows_raw": n_raw, "rows_silver": n_out, "seconds": round(time.time() - t, 1), "mb": round(out.stat().st_size / 1e6, 1)}
