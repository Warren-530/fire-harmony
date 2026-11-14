"""Step 2b: static-source mask (places that are hot but are not vegetation fires).

Near-real-time FIRMS rows (and all NOAA-21 rows so far) carry no `type`, so they cannot tell a
gas flare or a steel plant from a fire. We build a mask of small H3 cells (level 8, ~0.74 km2):
  * cells where science-quality data recorded >= N detections of type 1 (volcano),
    2 (other static land source) or 3 (offshore), optionally widened by `type_ring` neighbours, and
  * every cell that touches a GIHS industrial heat site polygon (Zenodo, CC BY 4.0), plus
    `gihs_ring` rings of neighbours. Filling the whole polygon matters: 459 of the 22,465 sites
    are larger than the ~5 km2 that a centre cell and one ring would cover (the largest is 124 km2).
  * open water: every cell holding a detection that lies in a 0.05 degree MCD12C1 pixel that is 100%
    water (at least ~2.5 km from land). This mirrors NASA's offshore class (type 3) for rows without a
    type: in 2026 near real time data it removes platforms, flares at sea, ships and sun glint, such as
    a new platform off north west Australia with 743 detections that the labelled years never saw.
`train_years` lets notebook 02 build the mask on early years and test it on later ones.
"""
from __future__ import annotations

from . import clean as CL
from . import config as C

GIHS_SHP = "GIHS_2000_2023/GIHS_2000_2023.shp"


def mask_path(tag: str = "all"):
    return C.work("static_mask", f"cells_{tag}.parquet")


def gihs_source() -> str:
    return f"/vsizip/{C.raw('gihs', 'GIHS_2000_2023.zip')}/{GIHS_SHP}"


def water_cells(con) -> None:
    """TEMP TABLE water_cells: level-8 cells of detections that lie in fully water MCD12C1 pixels.
    Open water is a fixed property of a place, so all years are scanned, even for the test mask."""
    import numpy as np
    import pandas as pd
    from pyhdf.SD import SD, SDC
    from . import features as FE
    lvl = int(C.cfg()["static_mask"]["h3_level"])
    water = SD(str(C.raw("landcover_mcd12c1", FE.LC_FILES[2018])), SDC.READ).select("Land_Cover_Type_1_Percent")[:, :, 0]
    px = np.flatnonzero(water.ravel() == 100).astype(np.int32)             # row * 7200 + col of fully water pixels
    con.register("water_px", pd.DataFrame({"px": px}))
    all_files = [str(CL.silver_path(y)) for y in C.years() if CL.silver_path(y).exists()]
    con.execute(f"""
      CREATE OR REPLACE TEMP TABLE water_cells AS
        SELECT DISTINCT d.h3_{lvl} AS cell
        FROM read_parquet({all_files}) d
        SEMI JOIN water_px w ON w.px = CAST(least(floor((90 - d.lat) / 0.05), 3599) AS INT) * 7200
                                     + CAST(least(floor((d.lon + 180) / 0.05), 7199) AS INT)""")
    con.unregister("water_px")


def build(train_years=None, tag: str = "all", con=None) -> dict:
    con = con or C.connect()
    sm = C.cfg()["static_mask"]
    lvl = int(sm["h3_level"])
    type_ring, gihs_ring = int(sm.get("type_ring", 0)), int(sm["gihs_ring"])
    yrs = train_years or C.years()
    files = [str(CL.silver_path(y)) for y in yrs if CL.silver_path(y).exists()]
    missing = [y for y in yrs if not CL.silver_path(y).exists()]
    if missing:
        raise FileNotFoundError(f"silver missing for {missing}: run `fireharmony clean` first")
    con.execute(f"""
    CREATE OR REPLACE TEMP TABLE firms_core AS
      SELECT h3_{lvl} AS cell,
             count(*) FILTER (WHERE type = 1) AS n_type1,
             count(*) FILTER (WHERE type = 2) AS n_type2,
             count(*) FILTER (WHERE type = 3) AS n_type3,
             count(DISTINCT year(date_utc))   AS years_seen
      FROM read_parquet({files}) WHERE quality = 'sp' AND type IN (1, 2, 3)
      GROUP BY 1 HAVING count(*) >= {int(sm['min_type2_detections'])};
    CREATE OR REPLACE TEMP TABLE firms_static AS
      SELECT cell, max(n_type1) n_type1, max(n_type2) n_type2, max(n_type3) n_type3, max(years_seen) years_seen,
             bool_or(is_core) AS is_core
      FROM (SELECT unnest(h3_grid_disk(cell, {type_ring})) AS cell, n_type1, n_type2, n_type3, years_seen,
                   FALSE AS is_core FROM firms_core
            UNION ALL
            SELECT cell, n_type1, n_type2, n_type3, years_seen, TRUE FROM firms_core)
      GROUP BY cell;
    """)
    con.execute(f"""
    CREATE OR REPLACE TEMP TABLE gihs_cells AS
      WITH site AS (
        SELECT list_distinct(list_concat(
                 h3_polygon_wkt_to_cells_experimental(ST_AsText(geom), {lvl}, 'overlap'),
                 [h3_latlng_to_cell(ST_Y(ST_Centroid(geom)), ST_X(ST_Centroid(geom)), {lvl})])) AS cells
        FROM ST_Read('{gihs_source()}')
      ),
      core AS (SELECT DISTINCT unnest(cells) AS cell FROM site)
      SELECT DISTINCT unnest(h3_grid_disk(cell, {gihs_ring})) AS cell FROM core;
    """)
    water_cells(con)
    out = mask_path(tag)
    with C.atomic(out) as tmp:
        con.execute(f"""
        COPY (
          SELECT coalesce(f.cell, g.cell, w.cell) AS cell,
                 coalesce(n_type1, 0) n_type1, coalesce(n_type2, 0) n_type2, coalesce(n_type3, 0) n_type3,
                 coalesce(years_seen, 0) years_seen,
                 CASE WHEN f.cell IS NOT NULL AND g.cell IS NOT NULL THEN 'both'
                      WHEN f.cell IS NOT NULL THEN 'firms_type' WHEN g.cell IS NOT NULL THEN 'gihs' ELSE 'water' END AS source,
                 w.cell IS NOT NULL AS open_water
          FROM firms_static f FULL OUTER JOIN gihs_cells g ON f.cell = g.cell
               FULL OUTER JOIN water_cells w ON coalesce(f.cell, g.cell) = w.cell
          ORDER BY cell
        ) TO '{tmp}' (FORMAT parquet, COMPRESSION zstd)
        """)
    s = con.execute(f"SELECT source, count(*) FROM read_parquet('{out}') GROUP BY 1 ORDER BY 1").fetchall()
    return {"tag": tag, "years": [min(yrs), max(yrs)], "type_ring": type_ring, "gihs_ring": gihs_ring,
            "cells_by_source": dict(s), "file": str(out)}


def evaluate(test_years=(2024, 2025), tag: str = "until2022", con=None):
    """How well the mask (built only from earlier years) separates static sources from fires, judged by
    NASA's own `type` labels in later science-quality data. Also tests widening the FIRMS cells by one ring.

    Test years are 2024 and 2025: the FIRMS part of the test mask uses data up to 2022, and the GIHS industrial
    polygons use data up to 2023, so neither has seen the test years. Reads the RAW FIRMS files (the silver layer
    may be deleted), with the same confidence rule as the pipeline.

    recall     share of static detections (type 1, 2, 3) that fall inside the mask
    precision  share of masked detections that really are static
    fire_loss  share of real vegetation fires (type 0) that the mask would wrongly remove"""
    import pandas as pd
    con = con or C.connect()
    lvl = int(C.cfg()["static_mask"]["h3_level"])
    cf = C.cfg()["confidence"]
    files = [str(C.raw("firms", f"year={y}", "detections.parquet")) for y in test_years]
    m = mask_path(tag)
    con.execute(f"""
      CREATE OR REPLACE TEMP TABLE mask_ring1 AS
        SELECT DISTINCT cell FROM (
          SELECT unnest(h3_grid_disk(cell, 1)) AS cell FROM '{m}' WHERE source IN ('firms_type', 'both')
          UNION ALL SELECT cell FROM '{m}')""")
    con.execute(f"""
      CREATE OR REPLACE TEMP TABLE test_det AS
        SELECT h3_latlng_to_cell(ST_Y(geometry), ST_X(geometry), {lvl}) AS cell, type,
               CASE WHEN sensor = 'MODIS' THEN 'MODIS' ELSE 'VIIRS' END AS family
        FROM read_parquet({files})
        WHERE quality = 'sp'
          AND CASE WHEN sensor = 'MODIS' THEN confidence_pct >= {cf['modis_low_below']} ELSE confidence <> 'l' END""")
    rows = []
    for variant, tbl in (("ring 0 (used)", f"(SELECT cell FROM '{m}')"), ("ring 1", "mask_ring1")):
        r = con.execute(f"""
          SELECT d.family, count(*) FILTER (WHERE d.type <> 0) AS static_n,
                 count(*) FILTER (WHERE d.type <> 0 AND k.cell IS NOT NULL) AS static_masked,
                 count(*) FILTER (WHERE d.type = 0) AS fire_n,
                 count(*) FILTER (WHERE d.type = 0 AND k.cell IS NOT NULL) AS fire_masked
          FROM test_det d LEFT JOIN {tbl} k ON d.cell = k.cell GROUP BY 1 ORDER BY 1""").df()
        r["variant"] = variant
        rows.append(r)
    con.execute("DROP TABLE test_det")
    df = pd.concat(rows, ignore_index=True)
    df["recall"] = df.static_masked / df.static_n
    df["precision"] = df.static_masked / (df.static_masked + df.fire_masked)
    df["fire_loss"] = df.fire_masked / df.fire_n
    return df
