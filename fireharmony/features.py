"""Step 4: cell facts (the static description of every level-5 hexagon).

For each H3 level-5 cell where any satellite ever recorded a hotspot we store:
  * centre latitude and longitude, and area in km2
  * land cover mix from MCD12C1 (IGBP, 0.05 degree), grouped into 9 classes, for 2001, 2012, 2018,
    2025 and their mean, plus the main class
  * peat fraction from PEATMAP (Xu et al. 2018)
  * population density and population from GPWv4 (2000, 2005, 2010, 2015, 2020)
  * country and state from Natural Earth, and a simple biome: latitude zone plus main land cover

Raster pixels join hexagons by their pixel centre. At the equator a level-5 hexagon (~253 km2) holds
about 8 land cover pixels and 12 population pixels, and more towards the poles, so every land cell gets
values. Rasters are read in strips of rows so memory stays low.
"""
from __future__ import annotations

import io
import time
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

from . import aggregate as AG
from . import config as C

LVL = 5
R_EARTH_KM = 6371.0072                     # authalic radius, so pixel areas add up to the true Earth area

IGBP = ["water", "evergreen needleleaf forest", "evergreen broadleaf forest", "deciduous needleleaf forest",
        "deciduous broadleaf forest", "mixed forests", "closed shrublands", "open shrublands", "woody savannas",
        "savannas", "grasslands", "permanent wetlands", "croplands", "urban and built-up",
        "cropland and natural vegetation mosaic", "snow and ice", "barren"]
LC_GROUPS = {                              # IGBP layer numbers in each group
    "water": [0], "forest": [1, 2, 3, 4, 5], "shrubland": [6, 7], "savanna": [8, 9], "grassland": [10],
    "wetland": [11], "cropland": [12, 14], "urban": [13], "barren": [15, 16]}
LC_FILES = {2001: "MCD12C1.A2001001.061.2022146170409.hdf", 2012: "MCD12C1.A2012001.061.2022162172724.hdf",
            2018: "MCD12C1.A2018001.061.2022169131657.hdf", 2025: "MCD12C1.A2025001.061.2026269181218.hdf"}
POP_YEARS = [2000, 2005, 2010, 2015, 2020]
PEAT_ZIPS = ["Africa", "Asia", "Europe", "North_America", "Oceania", "South_America"]


def out_path(name: str) -> Path:
    return C.work("features", f"{name}.parquet")


# ------------------------------------------------------------------------------------------ rasters
def _pixel_cells(con, i0: int, i1: int, nx: int, res_deg: float) -> np.ndarray:
    """H3 cell of every pixel centre in rows i0..i1 of a global grid that starts at (-180, 90)."""
    r = con.execute(f"""
        SELECT i, j, h3_latlng_to_cell(90 - (i + 0.5) * {res_deg}, -180 + (j + 0.5) * {res_deg}, {LVL}) AS cell
        FROM range({i0}, {i1}) a(i), range(0, {nx}) b(j)""").fetchnumpy()
    out = np.zeros((i1 - i0, nx), dtype=np.uint64)
    out[r["i"] - i0, r["j"]] = r["cell"]
    return out


def _pixel_area_km2(i0: int, i1: int, res_deg: float) -> np.ndarray:
    """Area of each pixel row on the sphere (km2)."""
    top = np.radians(90 - np.arange(i0, i1) * res_deg)
    bot = np.radians(90 - np.arange(i0 + 1, i1 + 1) * res_deg)
    return R_EARTH_KM ** 2 * np.radians(res_deg) * (np.sin(top) - np.sin(bot))


def _sum_by_cell(cells: np.ndarray, cols: dict[str, np.ndarray]) -> pd.DataFrame:
    u, inv = np.unique(cells, return_inverse=True)
    return pd.DataFrame({"cell": u, **{k: np.bincount(inv, weights=v, minlength=len(u)) for k, v in cols.items()}})


def _combine(parts: list[pd.DataFrame]) -> pd.DataFrame:
    return pd.concat(parts, ignore_index=True).groupby("cell", sort=True).sum().reset_index()


def landcover(con=None, strip: int = 120) -> pd.DataFrame:
    """Area-weighted share of each land cover group per cell, for each MCD12C1 year."""
    from pyhdf.SD import SD, SDC
    con = con or C.connect()
    res, ny, nx = 0.05, 3600, 7200
    sds = {y: SD(str(C.raw("landcover_mcd12c1", f)), SDC.READ).select("Land_Cover_Type_1_Percent") for y, f in LC_FILES.items()}
    parts = []
    for i0 in range(0, ny, strip):
        i1 = min(i0 + strip, ny)
        lc = {y: s[i0:i1, :, :] for y, s in sds.items()}                      # (rows, 7200, 17) uint8 percent
        ref = lc[2018]
        keep = (ref[..., 0] < 100) & (ref[..., 0] != 255)                    # any land in the pixel
        if not keep.any():
            continue
        area = np.broadcast_to(_pixel_area_km2(i0, i1, res)[:, None], keep.shape)
        cells = _pixel_cells(con, i0, i1, nx, res)[keep]
        cols = {"px_area_km2": area[keep]}
        for y, a in lc.items():
            a = a[keep].astype(np.float32)
            a[a > 100] = 0                                                      # fill value 255 -> no information
            for g, layers in LC_GROUPS.items():
                cols[f"lc{y}_{g}"] = a[:, layers].sum(axis=1) / 100 * cols["px_area_km2"]
        parts.append(_sum_by_cell(cells, cols))
    df = _combine(parts)
    tot = df.pop("px_area_km2")
    for c in [c for c in df.columns if c.startswith("lc")]:
        df[c] = (df[c] / tot).astype(np.float32)                               # share of the sampled area
    for g in LC_GROUPS:
        df[f"lc_{g}"] = df[[f"lc{y}_{g}" for y in LC_FILES]].mean(axis=1).astype(np.float32)
    return df


def _land_share_on_grid(res_deg: float, ny: int, nx: int) -> np.ndarray:
    """Land share (1 - water) of every pixel of a global grid, taken from the MCD12C1 0.05 degree pixel
    that holds the pixel centre (2018 map)."""
    from pyhdf.SD import SD, SDC
    water = SD(str(C.raw("landcover_mcd12c1", LC_FILES[2018])), SDC.READ).select("Land_Cover_Type_1_Percent")[:, :, 0]
    water = np.where(water > 100, 100, water).astype(np.float32)          # fill value -> treat as water
    lat = 90 - (np.arange(ny) + 0.5) * res_deg
    lon = -180 + (np.arange(nx) + 0.5) * res_deg
    i = np.clip(((90 - lat) / 0.05).astype(int), 0, 3599)
    j = np.clip(((lon + 180) / 0.05).astype(int), 0, 7199)
    return 1 - water[np.ix_(i, j)] / 100


def population(con=None, strip: int = 144) -> pd.DataFrame:
    """Population per cell (persons), for each GPW year.

    GPWv4 density is people per km2 of *land*, so population = density x pixel area x land share.
    Without the land share, partly-sea coastal pixels (often dense cities) are overcounted and the world
    total comes out about 10% too high (8.6 instead of about 7.8 billion people in 2020)."""
    con = con or C.connect()
    res, ny, nx = 1 / 24, 4320, 8640
    Image.MAX_IMAGE_PIXELS = None
    land = _land_share_on_grid(res, ny, nx)
    grids = {}
    for y in POP_YEARS:
        z = zipfile.ZipFile(C.raw("population_gpwv4", f"gpw-v4-population-density-rev11_{y}_2pt5_min_tif.zip"))
        name = next(n for n in z.namelist() if n.endswith(".tif"))
        a = np.array(Image.open(io.BytesIO(z.read(name))), dtype=np.float32)
        a[~(a >= 0)] = 0                                                        # nodata (-3.4e38) and NaN -> 0
        grids[y] = a
    parts = []
    for i0 in range(0, ny, strip):
        i1 = min(i0 + strip, ny)
        keep = np.zeros((i1 - i0, nx), bool)
        for a in grids.values():
            keep |= a[i0:i1] > 0
        if not keep.any():
            continue
        area = (np.broadcast_to(_pixel_area_km2(i0, i1, res)[:, None], keep.shape) * land[i0:i1])[keep]
        cells = _pixel_cells(con, i0, i1, nx, res)[keep]
        parts.append(_sum_by_cell(cells, {f"pop{y}": a[i0:i1][keep] * area for y, a in grids.items()}))
    return _combine(parts)


# ------------------------------------------------------------------------------------------ vectors
def peat(con=None, fill_level: int = 7) -> pd.DataFrame:
    """Peat area (km2) per cell, with the total area kept exact.

    PEATMAP stores each region as a few huge MultiPolygonZ shapes (South East Asia is one shape with
    1.7 million vertices) in World Cylindrical Equal Area. We split them into single polygons, drop Z,
    simplify by 100 m (tiny next to a 253 km2 cell) and fill each polygon with level-7 cells (5.2 km2).
    The polygon's true area (measured in the equal-area projection) is shared equally among its fill
    cells. Polygons too small to hold a fill cell centre give their area to the cell of their centroid.

    Two layers (Canada, and Hokkaido / Mongolia / North Korea) are soil landscape units with a peat
    percentage (PEAT_PER, 5 to 100). Their area is weighted by it: Canada becomes 1.13 million km2,
    which matches the published estimate, instead of the 3.6 million km2 of the unweighted polygons."""
    con = con or C.connect()
    parts = []
    for zname in PEAT_ZIPS:
        z = C.raw("peatmap", f"{zname}.zip")
        for shp in [n for n in zipfile.ZipFile(z).namelist() if n.endswith(".shp")]:
            t = time.time()
            src = f"/vsizip/{z}/{shp}"
            cols = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM ST_Read('{src}')").fetchall()]
            per = next((c for c in cols if c.lower() == "peat_per"), None)
            share = f'"{per}" / 100.0' if per else "1.0"
            df = con.execute(f"""
              WITH d AS (
                SELECT unnest(ST_Dump(geom), recursive := true), {share} AS share FROM ST_Read('{src}')
                WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
              ),
              p AS (
                SELECT ST_Area(geom) * share / 1e6 AS area_km2,
                       ST_Force2D(ST_Transform(ST_SimplifyPreserveTopology(ST_Force2D(geom), 100),
                                               'ESRI:54034', 'EPSG:4326', always_xy := true)) AS g
                FROM d WHERE ST_GeometryType(geom) = 'POLYGON'
              ),
              f AS (   -- parts under 1 km2 skip the fill (South America has 2.1 million pixel-sized parts)
                SELECT area_km2, g,
                       CASE WHEN area_km2 >= 1 THEN h3_polygon_wkb_to_cells_experimental(ST_AsWKB(g), {fill_level}, 'center')
                            ELSE []::UBIGINT[] END AS fc
                FROM p WHERE area_km2 > 0 AND NOT ST_IsEmpty(g)
              ),
              big AS (SELECT h3_cell_to_parent(unnest(fc), {LVL}) AS cell, area_km2 / len(fc) AS km2 FROM f WHERE len(fc) > 0),
              small AS (SELECT h3_latlng_to_cell(ST_Y(ST_Centroid(g)), ST_X(ST_Centroid(g)), {LVL}) AS cell, area_km2 AS km2
                        FROM f WHERE len(fc) = 0)
              SELECT cell, sum(km2) AS peat_km2 FROM (SELECT * FROM big UNION ALL SELECT * FROM small) GROUP BY cell
            """).df()
            print(f"  peat {shp}: {len(df):,} cells, {df.peat_km2.sum():,.0f} km2, {time.time() - t:.0f} s", flush=True)
            parts.append(df)
    return _combine(parts)


def ne_source(name: str) -> str:
    return f"/vsizip/{C.raw('natural_earth', f'{name}.zip')}/{name}.shp"


def admin(cells: pd.DataFrame, con=None) -> pd.DataFrame:
    """Country and state of each cell centre. Coastal cells whose centre is in the sea take the nearest
    country or state within 0.5 degrees."""
    con = con or C.connect()
    con.register("cells_df", cells[["cell", "lat", "lon"]])
    out = cells[["cell"]].copy()
    for tag, src, cols in [("country", ne_source("ne_10m_admin_0_countries"), "CASE WHEN ISO_A3_EH <> '-99' THEN ISO_A3_EH ELSE ADM0_A3 END AS iso3, NAME AS country, CONTINENT AS continent, SUBREGION AS subregion"),
                           ("state", ne_source("ne_10m_admin_1_states_provinces"), "name AS state, adm1_code AS state_code")]:
        con.execute(f"CREATE OR REPLACE TEMP TABLE poly AS SELECT {cols}, geom FROM ST_Read('{src}')")
        names = [c.split(" AS ")[-1] for c in cols.split(", ")]
        sel = ", ".join(f"p.{n}" for n in names)
        hit = con.execute(f"""
          SELECT c.cell, {sel} FROM cells_df c JOIN poly p ON ST_Intersects(p.geom, ST_Point(c.lon, c.lat))
          QUALIFY row_number() OVER (PARTITION BY c.cell ORDER BY {names[0]}) = 1""").df()
        miss = cells.loc[~cells.cell.isin(hit.cell), ["cell", "lat", "lon"]]
        con.register("miss_df", miss)
        near = con.execute(f"""
          SELECT m.cell, {sel} FROM miss_df m JOIN poly p ON ST_DWithin(p.geom, ST_Point(m.lon, m.lat), 0.5)
          QUALIFY row_number() OVER (PARTITION BY m.cell ORDER BY ST_Distance(p.geom, ST_Point(m.lon, m.lat))) = 1""").df()
        out = out.merge(pd.concat([hit, near], ignore_index=True), on="cell", how="left")
    return out


# ------------------------------------------------------------------------------------------ combine
def universe(con=None) -> pd.DataFrame:
    """Every level-5 cell where any satellite ever recorded a hotspot, with its centre and area."""
    con = con or C.connect()
    files = [str(AG.gold_path(y)) for y in C.years() if AG.gold_path(y).exists()]
    if not files:
        raise FileNotFoundError("no gold files: run `fireharmony aggregate` first")
    return con.execute(f"""
      SELECT cell, h3_cell_to_lat(cell) AS lat, h3_cell_to_lng(cell) AS lon, h3_cell_area(cell, 'km^2') AS area_km2,
             sum(n_allconf) AS n_veg_all_time, sum(n_nonveg) AS n_nonveg_all_time
      FROM read_parquet({files}) GROUP BY cell ORDER BY cell""").df()


def geographic_continent(df: pd.DataFrame) -> pd.Series:
    """Natural Earth gives each COUNTRY one continent, so all of Russia (and every French overseas region) is
    'Europe'. Correct Europe-tagged cells that lie outside Europe by where they are."""
    c = df["continent"].copy()
    eur = c.eq("Europe")
    c[eur & (df.lon >= 60)] = "Asia"                                       # Siberia and the Russian Far East
    c[eur & (df.lon < -25) & df["iso3"].eq("RUS")] = "Asia"                # Chukotka, across the date line
    west = eur & (df.lon < -25) & ~df["iso3"].eq("RUS")
    c[west & (df.lat < 10)] = "South America"                              # French Guiana
    c[west & (df.lat >= 10)] = "North America"                             # Guadeloupe, Martinique, Saint Pierre
    c[eur & (df.lon >= -25) & (df.lon < 60) & (df.lat < 34)] = "Africa"     # Canary Islands, Reunion, Mayotte
    return c


def biome(df: pd.DataFrame) -> pd.Series:
    """Latitude zone + main land cover group (water ignored), for example 'tropical forest'."""
    a = df["lat"].abs()
    zone = np.select([a < 23.5, a < 35, a < 55], ["tropical", "subtropical", "temperate"], "boreal")
    land = [g for g in LC_GROUPS if g != "water"]
    lc = df[[f"lc_{g}" for g in land]].fillna(0).to_numpy()
    main = np.array(land)[lc.argmax(axis=1)]
    main[lc.sum(axis=1) < 0.05] = "water"
    return pd.Series([f"{z} {m}" for z, m in zip(zone, main)], index=df.index)


def build(con=None) -> dict:
    con = con or C.connect()
    t0 = time.time()
    steps = {}
    cells = universe(con); steps["universe"] = round(time.time() - t0)
    for name, fn in [("landcover", landcover), ("population", population), ("peat", peat)]:
        p = out_path(name)
        if not p.exists():                                           # each raster step is slow, so keep its result
            with C.atomic(p) as tmp:
                fn(con).to_parquet(tmp, index=False)
        steps[name] = round(time.time() - t0)
    df = cells
    for name in ("landcover", "population", "peat"):
        df = df.merge(pd.read_parquet(out_path(name)), on="cell", how="left")
    df["peat_km2"] = df["peat_km2"].fillna(0)
    df["peat_frac"] = (df["peat_km2"] / df["area_km2"]).clip(0, 1).astype(np.float32)
    for y in POP_YEARS:
        df[f"pop{y}"] = df[f"pop{y}"].fillna(0)
    df["pop_density_2020"] = (df["pop2020"] / df["area_km2"]).astype(np.float32)
    df["biome"] = biome(df)
    df["lc_main"] = df[[f"lc_{g}" for g in LC_GROUPS]].fillna(0).idxmax(axis=1).str[3:]
    df = df.merge(admin(df, con), on="cell", how="left")
    df["continent"] = geographic_continent(df)
    # one name per country code: the name of its main territory (ISO_A3_EH groups e.g. Baikonur with Kazakhstan)
    main_name = df.dropna(subset=["iso3"]).groupby("iso3")["country"].agg(lambda v: v.mode().iloc[0])
    df["country"] = df["iso3"].map(main_name).where(df["iso3"].notna(), df["country"])
    steps["admin"] = round(time.time() - t0)
    out = out_path(f"cell_static_l{LVL}")
    with C.atomic(out) as tmp:
        df.to_parquet(tmp, index=False)
    return {"cells": len(df), "no_landcover": int(df["lc_forest"].isna().sum()), "no_country": int(df["iso3"].isna().sum()),
            "peat_cells": int((df.peat_frac > 0).sum()), "seconds": steps, "file": str(out)}
