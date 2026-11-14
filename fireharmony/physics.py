"""Physics check on the calibration tiles (notebook 04): how often does MODIS see a fire that VIIRS saw?

For 2019 on 10 MODIS tiles we take every FIRMS Suomi NPP 375 m hotspot, place it on the 1 km MODIS grid, and look at
the Aqua (MYD14A1) and Terra (MOD14A1) daily fire maps of the same UTC day. MODIS saw the fire if one of the 3 x 3
cells around it is a fire (MODIS footprints spread over neighbouring grid cells). Cells under cloud or with no MODIS
data that day are flagged, so the chance of detection can be given for a clear view.
Aqua crosses the equator at about 13:30 and 01:30 like Suomi NPP; Terra at about 10:30 and 22:30, so Terra often
looks at a different moment of the fire. Output: data/work/physics/viirs_points_2019.parquet.
"""
from __future__ import annotations

import glob
import re
import time

import numpy as np
import pandas as pd

from . import config as C

TILES = ["h08v05", "h11v03", "h12v10", "h12v11", "h20v08", "h20v10", "h22v02", "h25v06", "h29v09", "h30v10"]
R = 6371007.181                       # sphere radius of the MODIS sinusoidal grid (m)
T = 1111950.519667                    # tile size (m)
X0, Y0 = -20015109.354, 10007554.677  # upper left corner of tile h00v00 (m)
N = 1200                              # 1 km cells per tile side
S = T / N


def out(*parts: str):
    return C.work("physics", *parts)


def viirs_points(year: int = 2019, satellite: str = "Suomi-NPP", con=None) -> pd.DataFrame:
    """FIRMS hotspots of one VIIRS satellite on the 10 tiles, with their 1 km tile cell (h, v, row, col)."""
    con = con or C.connect()
    hv = ", ".join(f"({int(t[1:3])}, {int(t[4:6])})" for t in TILES)
    return con.execute(f"""
      WITH p AS (SELECT acq_date::DATE AS date, ST_Y(geometry) AS lat, ST_X(geometry) AS lon, frp, daynight, type,
                        confidence, scan, track
                 FROM '{C.raw("firms", f"year={year}", "detections.parquet")}' WHERE satellite = '{satellite}'),
           g AS (SELECT *, {R} * radians(lon) * cos(radians(lat)) AS x, {R} * radians(lat) AS y FROM p),
           t AS (SELECT *, floor((x - ({X0})) / {T})::INT AS h, floor(({Y0} - y) / {T})::INT AS v FROM g)
      SELECT date, lat, lon, frp, daynight, type, confidence, scan, track, h, v,
             floor(({Y0} - y - v * {T}) / {S})::INT AS row, floor((x - ({X0}) - h * {T}) / {S})::INT AS col
      FROM t WHERE (h, v) IN ({hv})""").df()


def _modis_layers(prod: str, tile: str, year: int):
    """Yields (date, FireMask layer) for every day of `year` in the 8 day files of a MODIS daily fire product."""
    from pyhdf.SD import SD, SDC
    folder = {"MOD14A1": "firemap_mod14a1", "MYD14A1": "firemap_myd14a1"}[prod]
    for f in sorted(glob.glob(str(C.raw(folder) / f"{prod}.A{year}*.{tile}.*.hdf"))):
        sd = SD(f, SDC.READ)
        dates = sd.attributes()["Dates"].split()
        ds = sd.select("FireMask")
        for k, d in enumerate(dates):
            if d.startswith(str(year)):
                yield pd.Timestamp(d), ds[k, :, :]
        sd.end()


def match_tile(points: pd.DataFrame, tile: str, year: int = 2019) -> pd.DataFrame:
    """For the VIIRS points of one tile: did Aqua and Terra see fire within one cell, and was the cell clear?"""
    from scipy.ndimage import maximum_filter
    p = points[(points.h == int(tile[1:3])) & (points.v == int(tile[4:6]))].copy()
    by_date = {d: idx for d, idx in p.groupby("date").groups.items()}
    for prod, tag in (("MYD14A1", "aqua"), ("MOD14A1", "terra")):
        seen = np.zeros(len(p), dtype=np.int8)
        state = np.full(len(p), -1, dtype=np.int8)          # 0 clear land or water, 1 cloud, 2 no data, -1 no file
        pos = pd.Series(np.arange(len(p)), index=p.index)
        for date, layer in _modis_layers(prod, tile, year):
            idx = by_date.get(date)
            if idx is None:
                continue
            fire = maximum_filter(layer >= 7, size=3)
            i = pos[idx].to_numpy()
            r, c = p.loc[idx, "row"].to_numpy(), p.loc[idx, "col"].to_numpy()
            seen[i] = fire[r, c]
            cell = layer[r, c]
            state[i] = np.select([cell == 4, cell == 0], [1, 2], 0)
        p[f"{tag}_seen"] = seen.astype(bool)
        p[f"{tag}_view"] = state
    return p.assign(tile=tile)


def build(year: int = 2019, log=print) -> dict:
    t0 = time.time()
    pts = viirs_points(year)
    log(f"physics: {len(pts):,} Suomi NPP hotspots on the 10 tiles in {time.time() - t0:.0f} s")
    parts = []
    for tile in TILES:
        parts.append(match_tile(pts, tile, year))
        log(f"physics: {tile} done ({len(parts[-1]):,} points) at {time.time() - t0:.0f} s")
    res = pd.concat(parts, ignore_index=True)
    with C.atomic(C.ensure_parent(out(f"viirs_points_{year}.parquet"))) as tmp:
        res.to_parquet(tmp, index=False)
    clear = res[res.aqua_view == 0]
    return {"points": len(res), "aqua_clear_share": round(float((res.aqua_view == 0).mean()), 3),
            "aqua_seen_given_clear": round(float(clear.aqua_seen.mean()), 3), "seconds": round(time.time() - t0)}
