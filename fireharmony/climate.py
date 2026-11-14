"""Climate drivers per level 3 hexagon and month (Phase 3).

Raw rasters in, small tables out (data/work/climate/). Once these tables are built and checked, the raw rasters can
be deleted: the tables hold everything the drivers, outlook and haze analyses use.

  hex_l3.parquet           the level 3 hexagons that hold our fire grid, with their centres
  rain_daily/*.parquet     IMERG Late daily rain per hexagon, one small file per day (hex, date, rain_mm)
  rain_l3.parquet          hex, yr, mo, rain_final_mm (IMERG Final, Jan 2000 to Sep 2025),
                           rain_late_mm and late_days (IMERG Late, the days of the month summed, Oct 2024 on)
  merra2_l3.parquet        hex, yr, mo, t2m_c, qv2m_gkg, u10, v10 (MERRA-2 weather), aod, pm25 (MERRA-2 aerosols)
  fwi_l3.parquet           hex, yr, mo, fwi, dc, dmc, ffmc, isi, bui (GFWED, mean of the 8th and the 22nd)
  pm25_cnn_day.parquet     lat, lon, date, pm25 (MERRA-2 CNN bias corrected surface PM2.5, SE Asia, Jul to Nov,
                           mean of the 24 hourly values of the UTC day)
  indices.parquet          yr, mo, oni (labelled with the centre month of its 3 month season), dmi

A grid cell belongs to the level 3 hexagon (about 12,400 km2) that holds its centre, and a hexagon's value is the
cos(latitude) weighted mean of its cells. A hexagon with no cell centre inside takes the cell nearest its centre.
"""
from __future__ import annotations

import calendar
import datetime as dt
import glob
import os
import re
import subprocess
import time
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as C

LVL = 3
UNIVERSE = C.work("panel_l5", "universe.parquet")


def out(*parts: str) -> Path:
    return C.work("climate", *parts)


def raw(name: str) -> Path:
    return C.raw(name)


# ------------------------------------------------------------------------------------------ hexagons and grids
def hexes() -> pd.DataFrame:
    """The level 3 hexagons that hold at least one cell of the fire grid, with a position 0..H-1 and their centre."""
    p = out("hex_l3.parquet")
    if p.exists():
        return pd.read_parquet(p)
    con = C.connect()
    df = con.execute(f"""SELECT hex, h3_cell_to_lat(hex) AS lat, h3_cell_to_lng(hex) AS lon
                         FROM (SELECT DISTINCT h3_cell_to_parent(cell, {LVL}) AS hex FROM '{UNIVERSE}') ORDER BY hex""").df()
    df["pos"] = np.arange(len(df), dtype=np.int32)
    with C.atomic(p) as tmp:
        df.to_parquet(tmp, index=False)
    return df


def grid_map(name: str, lat: np.ndarray, lon: np.ndarray) -> dict:
    """For a regular (lat, lon) grid (lat-major, any order): flat index of every cell whose centre lies in one of
    our hexagons, the hexagon's position and the cell's cos(latitude) weight. Cached in climate/maps/<name>.npz."""
    p = out("maps", f"{name}.npz")
    if p.exists():
        z = np.load(p)
        if z["shape"].tolist() == [len(lat), len(lon)]:
            return {k: z[k] for k in ("k", "pos", "w")}
    hx = hexes()
    con = C.connect()
    la, lo = np.meshgrid(np.asarray(lat, float), np.asarray(lon, float), indexing="ij")
    g = pd.DataFrame({"k": np.arange(la.size, dtype=np.int64), "lat": la.ravel(), "lon": lo.ravel()})
    g = g[g.lat.abs() < 89.99]                                 # pole rows: no fire, and h3 needs |lat| < 90
    con.register("g", g)
    con.register("hx", hx[["hex", "pos"]])
    m = con.execute(f"""SELECT g.k, hx.pos, cos(radians(g.lat)) AS w FROM g
                        JOIN hx ON hx.hex = h3_latlng_to_cell(g.lat, g.lon, {LVL}) ORDER BY g.k""").df()
    # hexagons with no cell centre inside: the cell nearest the hexagon centre
    miss = hx[~hx.pos.isin(m.pos)]
    if len(miss):
        lat_a, lon_a = np.asarray(lat, float), np.asarray(lon, float)
        i = np.abs(lat_a[None, :] - miss.lat.to_numpy()[:, None]).argmin(axis=1)
        d = (lon_a[None, :] - miss.lon.to_numpy()[:, None] + 180) % 360 - 180
        j = np.abs(d).argmin(axis=1)
        step = np.abs(np.diff(lat_a)).max()
        near = np.abs(lat_a[i] - miss.lat.to_numpy()) <= step         # not for hexagons beyond the grid's edge
        extra = pd.DataFrame({"k": (i * len(lon_a) + j)[near], "pos": miss.pos.to_numpy()[near], "w": np.cos(np.radians(lat_a[i][near]))})
        m = pd.concat([m, extra], ignore_index=True)
    res = {"k": m.k.to_numpy(np.int64), "pos": m.pos.to_numpy(np.int32), "w": m.w.to_numpy(np.float64)}
    C.ensure_parent(p)
    np.savez(p, shape=np.array([len(lat), len(lon)]), **res)
    return res


def hex_mean(field: np.ndarray, mp: dict, n_hex: int) -> np.ndarray:
    """cos(latitude) weighted mean of a (lat, lon) field per hexagon; NaN cells are left out."""
    v = np.asarray(field, np.float64).ravel()[mp["k"]]
    ok = np.isfinite(v)
    num = np.bincount(mp["pos"][ok], weights=mp["w"][ok] * v[ok], minlength=n_hex)
    den = np.bincount(mp["pos"][ok], weights=mp["w"][ok], minlength=n_hex)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(den > 0, num / den, np.nan)


def _frame(values: dict, yr: int, mo: int, hx: pd.DataFrame) -> pd.DataFrame:
    df = pd.DataFrame({"hex": hx.hex.to_numpy(), "yr": np.int16(yr), "mo": np.int8(mo)})
    for k, v in values.items():
        df[k] = v.astype(np.float32)
    return df


# ------------------------------------------------------------------------------------------ IMERG
IMERG_FILL = -9990.0


def read_imerg(path: str | Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """IMERG HDF5 or nc4 file -> precipitation (lat, lon) with fills as NaN, lat S->N, lon W->E.
    Final monthly files hold a mean rate in mm/hr (group /Grid); Late daily files hold mm/day (root group)."""
    import h5py
    with h5py.File(path, "r") as f:
        g = f["Grid"] if "Grid" in f else f
        a = g["precipitation"][0, :, :]                       # stored (time, lon, lat)
        lat = np.round(g["lat"][:].astype(np.float64), 2)
        lon = np.round(g["lon"][:].astype(np.float64), 2)
    a = np.where(a < IMERG_FILL, np.nan, a).astype(np.float32).T
    return np.ascontiguousarray(a), lat, lon


def imerg_final(con=None) -> pd.DataFrame:
    """Monthly rain (mm) per hexagon from IMERG Final, one file per month. Cached in rain_final_l3.parquet, so the
    rain table can be rebuilt (for example when more IMERG Late days arrive) after the raw files are deleted."""
    cache = out("rain_final_l3.parquet")
    files = sorted(glob.glob(str(raw("gpm_imerg_monthly") / "3B-MO.MS.MRG.3IMERG.*.V07B.HDF5")))
    if cache.exists() and (not files or os.path.getmtime(cache) > max(os.path.getmtime(f) for f in files)):
        return pd.read_parquet(cache)
    df = _imerg_final_from_raw(files)
    with C.atomic(cache) as tmp:
        df.to_parquet(tmp, index=False)
    return df


def _imerg_final_from_raw(files: list[str]) -> pd.DataFrame:
    hx = hexes()
    pat = re.compile(r"3IMERG\.(\d{4})(\d{2})01-")
    parts, mp = [], None
    for f in files:
        yr, mo = map(int, pat.search(f).groups())
        a, lat, lon = read_imerg(f)
        mp = mp or grid_map("imerg", lat, lon)
        hours = 24 * calendar.monthrange(yr, mo)[1]
        parts.append(_frame({"rain_final_mm": hex_mean(a * hours, mp, len(hx))}, yr, mo, hx))
    return pd.concat(parts, ignore_index=True)


def imerg_late_day(path: str | Path, day: dt.date) -> pd.DataFrame:
    """Daily rain (mm) per hexagon from one IMERG Late daily file."""
    hx = hexes()
    a, lat, lon = read_imerg(path)
    mp = grid_map("imerg", lat, lon)
    return pd.DataFrame({"hex": hx.hex.to_numpy(), "date": pd.Timestamp(day), "rain_mm": hex_mean(a, mp, len(hx)).astype(np.float32)})


LATE_RE = re.compile(r"3B-DAY-L\.MS\.MRG\.3IMERG\.(\d{8})-S000000-E235959\.(V07[A-Z])\.nc4$")


def _day_path(day: dt.date) -> Path:
    return out("rain_daily", f"{day:%Y%m%d}.parquet")


def imerg_late_local() -> dict:
    """Reduce the local IMERG Late daily files (Oct 2025 on) to one small table per day. Resumable."""
    by_day = {}
    for f in sorted(glob.glob(str(raw("gpm_imerg_late_daily") / "3B-DAY-L.MS.MRG.3IMERG.*.nc4"))):
        m = LATE_RE.search(f)
        by_day[dt.datetime.strptime(m.group(1), "%Y%m%d").date()] = f    # newest version wins (sorted V07B < V07C)
    done = 0
    for day, f in sorted(by_day.items()):
        p = _day_path(day)
        if p.exists():
            continue
        df = imerg_late_day(f, day)
        with C.atomic(p) as tmp:
            df.to_parquet(tmp, index=False)
        done += 1
    return {"days_on_disk": len(by_day), "newly_reduced": done}


CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"


def _token() -> str:
    env = C.REPO.parent / ".env"
    for line in env.read_text().splitlines():
        if line.startswith("EARTHDATA_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("no EARTHDATA_TOKEN in ~/nasa_work/.env")


def _cmr_late(start: str, end: str) -> list[tuple[dt.date, str]]:
    import json
    import urllib.parse
    out_, page = [], 1
    while True:
        q = {"short_name": "GPM_3IMERGDL", "version": "07", "temporal": f"{start}T00:00:00Z,{end}T23:59:59Z",
             "page_size": 2000, "page_num": page, "sort_key": "start_date"}
        r = subprocess.run(["curl", "-s", "-m", "120", CMR + "?" + urllib.parse.urlencode(q)], capture_output=True, text=True, check=True)
        entries = json.loads(r.stdout)["feed"]["entry"]
        for e in entries:
            url = next(l["href"] for l in e["links"] if l.get("rel", "").endswith("/data#") and l["href"].startswith("https://data.gesdisc"))
            m = LATE_RE.search(url)
            out_.append((dt.datetime.strptime(m.group(1), "%Y%m%d").date(), url))
        if len(entries) < 2000:
            return out_
        page += 1


def imerg_late_fetch(start: str = "2024-10-01", end: str = "2025-09-30", log=print) -> dict:
    """Download IMERG Late daily files for a past window, reduce each day to hexagons at once and delete the file,
    so the disk never holds more than one day. This gives a year where Late and Final overlap, to bridge Late to
    Final like the other sensor seams. Resumable: days already reduced are skipped.
    The Earthdata token is passed to curl on stdin (never on the command line) and only to GES DISC."""
    tmpdir = out("tmp")
    tmpdir.mkdir(parents=True, exist_ok=True)
    jobs = [(d, u) for d, u in _cmr_late(start, end) if not _day_path(d).exists()]
    cfg = f'header = "Authorization: Bearer {_token()}"\n'
    t0, n = time.time(), 0
    for day, url in jobs:
        if not url.startswith("https://data.gesdisc.earthdata.nasa.gov/"):
            raise RuntimeError(f"unexpected host: {url}")
        f = tmpdir / url.rsplit("/", 1)[1]
        r = subprocess.run(["curl", "-sS", "-L", "--http1.1", "--fail", "--retry", "5", "--retry-all-errors", "-m", "900",
                            "-c", str(tmpdir / ".cookies"), "-b", str(tmpdir / ".cookies"), "-K", "-", "-o", str(f), url],
                           input=cfg, capture_output=True, text=True)
        if r.returncode != 0:
            f.unlink(missing_ok=True)
            raise RuntimeError(f"download failed for {day}: {r.stderr.strip()[:200]}")
        df = imerg_late_day(f, day)
        with C.atomic(_day_path(day)) as tmp:
            df.to_parquet(tmp, index=False)
        f.unlink()
        n += 1
        if n % 10 == 0:
            log(f"{n}/{len(jobs)} days, {(time.time() - t0) / n:.1f} s per day, last {day}")
    return {"fetched": n, "window": [start, end]}


def rain_table(con=None) -> pd.DataFrame:
    """Monthly rain per hexagon: IMERG Final, and IMERG Late summed over the days of each month (complete months
    only, late_days = days present)."""
    con = con or C.connect()
    final = imerg_final(con)
    late = con.execute(f"""SELECT hex, year(date)::SMALLINT AS yr, month(date)::TINYINT AS mo,
                                  sum(rain_mm)::FLOAT AS rain_late_mm, count(*)::SMALLINT AS late_days
                           FROM read_parquet('{out("rain_daily", "*.parquet")}') GROUP BY ALL""").df()
    nd = late.apply(lambda r: calendar.monthrange(int(r.yr), int(r.mo))[1], axis=1)
    late.loc[late.late_days < nd, "rain_late_mm"] = np.nan          # a part month is not a monthly total
    df = final.merge(late, on=["hex", "yr", "mo"], how="outer")
    return df.sort_values(["yr", "mo", "hex"]).reset_index(drop=True)


# ------------------------------------------------------------------------------------------ MERRA-2
# GES DISC recipe (Buchard et al. 2017): PM2.5 = dust + sea salt (both < 2.5 um) + BC + OC + SO4 x (132.14 / 96.06)
PM25_WEIGHTS = {"DUSMASS25": 1.0, "SSSMASS25": 1.0, "BCSMASS": 1.0, "OCSMASS": 1.0, "SO4SMASS": 132.14 / 96.06}


def _merra2_files(folder: str, coll: str) -> dict[tuple[int, int], str]:
    files = {}
    for f in glob.glob(str(raw(folder) / f"MERRA2_*.{coll}.*.nc4")):
        ym = re.search(r"\.(\d{4})(\d{2})\.nc4$", f)
        files[(int(ym.group(1)), int(ym.group(2)))] = f
    return dict(sorted(files.items()))


def merra2_table() -> pd.DataFrame:
    import netCDF4
    hx = hexes()
    slv = _merra2_files("merra2_slv_monthly", "tavgM_2d_slv_Nx")
    aer = _merra2_files("merra2_aer_monthly", "tavgM_2d_aer_Nx")
    parts, mp = [], None
    for (yr, mo) in sorted(set(slv) | set(aer)):
        vals = {}
        if (yr, mo) in slv:
            with netCDF4.Dataset(slv[(yr, mo)]) as ds:
                mp = mp or grid_map("merra2", ds["lat"][:].data, ds["lon"][:].data)
                get = lambda v: ds[v][0].filled(np.nan).astype(np.float64)
                vals["t2m_c"] = hex_mean(get("T2M") - 273.15, mp, len(hx))
                vals["qv2m_gkg"] = hex_mean(get("QV2M") * 1000, mp, len(hx))
                vals["u10"] = hex_mean(get("U10M"), mp, len(hx))
                vals["v10"] = hex_mean(get("V10M"), mp, len(hx))
        if (yr, mo) in aer:
            with netCDF4.Dataset(aer[(yr, mo)]) as ds:
                mp = mp or grid_map("merra2", ds["lat"][:].data, ds["lon"][:].data)
                get = lambda v: ds[v][0].filled(np.nan).astype(np.float64)
                vals["aod"] = hex_mean(get("TOTEXTTAU"), mp, len(hx))
                vals["pm25"] = hex_mean(sum(w * get(v) for v, w in PM25_WEIGHTS.items()) * 1e9, mp, len(hx))
        parts.append(_frame(vals, yr, mo, hx))
    return pd.concat(parts, ignore_index=True)


# ------------------------------------------------------------------------------------------ GFWED fire weather
FWI_VARS = ("FWI", "DC", "DMC", "FFMC", "ISI", "BUI")


def fwi_table() -> pd.DataFrame:
    """Canadian fire weather indices per hexagon and month: the mean of the two sampled days (8th and 22nd)."""
    import warnings

    import netCDF4
    warnings.filterwarnings("ignore", message="WARNING: missing_value not used")   # the attribute is the string 'NaN'
    hx = hexes()
    by_month: dict[tuple[int, int], list[str]] = {}
    for f in sorted(glob.glob(str(raw("gfwed_fwi_sampled") / "FWI.MERRA2.CORRECTED.Daily.Default.*.nc"))):
        d = re.search(r"\.(\d{4})(\d{2})(\d{2})\.nc$", f)
        by_month.setdefault((int(d.group(1)), int(d.group(2))), []).append(f)
    parts, mp = [], None
    for (yr, mo), fs in sorted(by_month.items()):
        acc = {v: [] for v in FWI_VARS}
        for f in fs:
            with netCDF4.Dataset(f) as ds:
                mp = mp or grid_map("gfwed", ds["lat"][:].data, ds["lon"][:].data)
                for v in FWI_VARS:
                    a = ds[f"MERRA2.CORRECTED_{v}"][0]
                    acc[v].append(np.ma.filled(a.astype(np.float64), np.nan))
        vals = {v.lower(): hex_mean(np.nanmean(np.stack(acc[v]), axis=0), mp, len(hx)) for v in FWI_VARS}
        df = _frame(vals, yr, mo, hx)
        df["fwi_days"] = np.int8(len(fs))
        parts.append(df)
    return pd.concat(parts, ignore_index=True)


# ------------------------------------------------------------------------------------------ PM2.5 (SE Asia)
def pm25_cnn_table() -> pd.DataFrame:
    """MERRA-2 CNN bias corrected surface PM2.5 on its native SE Asia grid, mean of the 24 hourly values per UTC day."""
    import netCDF4
    files = sorted(glob.glob(str(raw("merra2_cnn_pm25_seasia") / "MERRA2_HAQAST_CNN_L4_V1.*.nc4")))
    parts, grid = [], None
    for f in files:
        day = pd.Timestamp(re.search(r"\.(\d{8})\.nc4$", f).group(1))
        with netCDF4.Dataset(f) as ds:
            if grid is None:
                lat, lon = ds["lat"][:].data.astype(np.float32), ds["lon"][:].data.astype(np.float32)
                la, lo = np.meshgrid(lat, lon, indexing="ij")
                grid = (la.ravel(), lo.ravel())
            a = ds["MERRA2_CNN_Surface_PM25"][:].filled(np.nan).astype(np.float32)   # (24, lat, lon)
        a[a <= -998] = np.nan
        with np.errstate(invalid="ignore"):
            m = np.nanmean(a, axis=0).ravel()
        parts.append(pd.DataFrame({"lat": grid[0], "lon": grid[1], "date": day, "pm25": m}))
    return pd.concat(parts, ignore_index=True)


# ------------------------------------------------------------------------------------------ climate indices
SEASON_CENTER = {"DJF": 1, "JFM": 2, "FMA": 3, "MAM": 4, "AMJ": 5, "MJJ": 6,
                 "JJA": 7, "JAS": 8, "ASO": 9, "SON": 10, "OND": 11, "NDJ": 12}


def indices_table() -> pd.DataFrame:
    """ONI (CPC, labelled with the centre month of its 3 month season, so the ONI of month m needs month m + 1)
    and DMI (NOAA PSL, monthly)."""
    oni = pd.read_csv(raw("climate_indices") / "noaa_oni.txt", sep=r"\s+")
    assert list(oni.columns) == ["SEAS", "YR", "TOTAL", "ANOM"], oni.columns
    oni = pd.DataFrame({"yr": oni.YR.astype(int), "mo": oni.SEAS.map(SEASON_CENTER).astype(int), "oni": oni.ANOM.astype(float)})
    lines = (raw("climate_indices") / "noaa_psl_dmi_iod.txt").read_text().splitlines()
    y0, y1 = (int(v) for v in lines[0].split())
    a = np.array([ln.split() for ln in lines[1:2 + y1 - y0]], dtype=float)
    assert a.shape == (y1 - y0 + 1, 13) and (a[:, 0] == np.arange(y0, y1 + 1)).all()
    dmi = pd.DataFrame([(int(r[0]), m + 1, r[m + 1]) for r in a for m in range(12)], columns=["yr", "mo", "dmi"])
    dmi.loc[dmi.dmi <= -99, "dmi"] = np.nan
    df = oni.merge(dmi, on=["yr", "mo"], how="outer")
    df = df[df.yr >= 1990].dropna(subset=["oni", "dmi"], how="all").sort_values(["yr", "mo"]).reset_index(drop=True)
    return df.astype({"yr": np.int16, "mo": np.int8})


# ------------------------------------------------------------------------------------------ build
TABLES = {"rain": ("rain_l3.parquet", rain_table), "merra2": ("merra2_l3.parquet", merra2_table),
          "fwi": ("fwi_l3.parquet", fwi_table), "pm25": ("pm25_cnn_day.parquet", pm25_cnn_table),
          "indices": ("indices.parquet", indices_table)}


RAW_OF = {"merra2": ("merra2_slv_monthly", "merra2_aer_monthly"), "fwi": ("gfwed_fwi_sampled",),
          "pm25": ("merra2_cnn_pm25_seasia",), "indices": ("climate_indices",)}


def build(only=None, log=print) -> dict:
    """Build the climate tables. A table whose raw files were deleted after it was built is kept as it is
    (the rain table rebuilds from its own caches: rain_final_l3.parquet and rain_daily/)."""
    rep = {"hexagons": len(hexes())}
    if only is None or "rain" in only:
        rep["late_local"] = imerg_late_local()
    for key, (name, fn) in TABLES.items():
        if only and key not in only:
            continue
        gone = key in RAW_OF and not any(raw(f).exists() and any(raw(f).iterdir()) for f in RAW_OF[key])
        if gone and out(name).exists():
            rep[key] = "kept: raw files deleted after it was built"
            log(f"{key}: kept ({name}; the raw files were deleted after it was built)")
            continue
        t0 = time.time()
        df = fn()
        with C.atomic(out(name)) as tmp:
            df.to_parquet(tmp, index=False)
        rep[key] = {"rows": len(df), "seconds": round(time.time() - t0)}
        log(f"{key}: {len(df):,} rows in {rep[key]['seconds']} s")
    return rep


# ------------------------------------------------------------------------------------------ ocean boxes (MERRA-2)
# Surface temperature in the tropical band from MERRA-2 (over open ocean it is the sea surface temperature MERRA-2
# is driven by). It gives an Indian Ocean Dipole index up to last month (the published DMI lags by about 5 months)
# and a Nino 3.4 check of the ONI. Rows 160..200 are 10S..10N on the 0.5 degree grid; all 576 longitudes.
BAND = (160, 200)
BOXES = {"iod_west": (-10, 10, 50, 70), "iod_east": (-10, 0, 90, 110), "nino34": (-5, 5, -170, -120)}


def sst_boxes_fetch(log=print) -> pd.DataFrame:
    """Box mean surface temperature per month from MERRA-2 M2TMNXSLV (cloud OPeNDAP, one 94 KB request per month)."""
    import json
    import urllib.parse

    import netCDF4
    p = out("sst_boxes.parquet")
    have = pd.read_parquet(p) if p.exists() else pd.DataFrame(columns=["yr", "mo", *BOXES])
    done = set(zip(have.yr.astype(int), have.mo.astype(int)))
    grans, page = [], 1
    while True:
        q = {"short_name": "M2TMNXSLV", "version": "5.12.4", "temporal": "2000-01-01T00:00:00Z,", "page_size": 2000,
             "page_num": page, "sort_key": "start_date"}
        r = subprocess.run(["curl", "-s", "-m", "120", CMR + "?" + urllib.parse.urlencode(q)], capture_output=True, text=True, check=True)
        entries = json.loads(r.stdout)["feed"]["entry"]
        for e in entries:
            svc = [l["href"] for l in e.get("links", []) if l["href"].startswith("https://opendap.earthdata.nasa.gov/")]
            ym = re.search(r"\.(\d{4})(\d{2})\.nc4", e["title"])
            if svc and ym:
                grans.append((int(ym.group(1)), int(ym.group(2)), svc[0]))
        if len(entries) < 2000:
            break
        page += 1
    tmpdir = out("tmp")
    tmpdir.mkdir(parents=True, exist_ok=True)
    cfg = f'header = "Authorization: Bearer {_token()}"\n'
    a, b = BAND
    rows = []
    for yr, mo, svc in grans:
        if (yr, mo) in done:
            continue
        ce = f"/TS[0:1:0][{a}:1:{b}][0:1:575];/lat[{a}:1:{b}];/lon[0:1:575]"
        url = f"{svc}.dap.nc4?dap4.ce=" + urllib.parse.quote(ce, safe="/;=")      # brackets must be encoded
        f = tmpdir / f"ts_{yr}{mo:02d}.nc4"
        r = subprocess.run(["curl", "-sS", "-g", "-L", "--http1.1", "--fail", "--retry", "5", "--retry-all-errors", "-m", "300",
                            "-c", str(tmpdir / ".cookies"), "-b", str(tmpdir / ".cookies"), "-K", "-", "-o", str(f), url],
                           input=cfg, capture_output=True, text=True)
        if r.returncode != 0:
            f.unlink(missing_ok=True)
            raise RuntimeError(f"TS {yr}-{mo:02d} failed: {r.stderr.strip()[:200]}")
        with netCDF4.Dataset(f) as ds:
            ts = ds["TS"][0].filled(np.nan).astype(np.float64)
            lat, lon = ds["lat"][:].data, ds["lon"][:].data
        f.unlink()
        row = {"yr": yr, "mo": mo}
        for k, (la0, la1, lo0, lo1) in BOXES.items():
            m = ((lat >= la0) & (lat <= la1))[:, None] & ((lon >= lo0) & (lon <= lo1))[None, :]
            w = np.broadcast_to(np.cos(np.radians(lat))[:, None], ts.shape)
            ok = m & np.isfinite(ts)
            row[k] = float((ts[ok] * w[ok]).sum() / w[ok].sum()) - 273.15
        rows.append(row)
        if len(rows) % 24 == 0:
            log(f"TS boxes: {len(rows)} new months, last {yr}-{mo:02d}")
    df = pd.concat([have, pd.DataFrame(rows)], ignore_index=True).astype({"yr": int, "mo": int}).sort_values(["yr", "mo"])
    with C.atomic(p) as tmp:
        df.to_parquet(tmp, index=False)
    return df


# ------------------------------------------------------------------------------------------ burned area (ESA Fire_cci)
def firecci_table() -> pd.DataFrame:
    """ESA Fire_cci monthly burned area per level 3 hexagon (km2): MRBA60H (harmonised, from MODIS 250 m, 2003 to
    2018) and MRBA60 (Sentinel-3, 2019 to 2024, its continuation). Burned area is a sum, so each 0.25 degree cell's
    area goes whole to the hexagon that holds its centre (not a mean). product: 0 MRBA60H, 1 MRBA60."""
    import netCDF4
    hx = hexes()
    files = sorted(glob.glob(str(raw("esa_firecci_grid") / "*-ESACCI-L4_FIRE-BA-*.nc")))
    pat = re.compile(r"(\d{4})(\d{2})01-ESACCI-L4_FIRE-BA-(MR_HAR-fv6\.0\.0|SYN-fv1\.1)\.nc$")
    parts, maps = [], {}
    for f in files:
        yr, mo, prod = pat.search(f).groups()
        with netCDF4.Dataset(f) as ds:
            lat, lon = ds["lat"][:].data.astype(np.float64), ds["lon"][:].data.astype(np.float64)
            a = ds["burned_area"][0].filled(np.nan).astype(np.float64)
        a[~np.isfinite(a) | (a < 0) | (a > 1e30)] = np.nan
        key = "firecci_sn" if lat[0] < lat[-1] else "firecci_ns"                     # the two products store lat in opposite order
        if key not in maps:
            maps[key] = grid_map(key, lat, lon)
        mp = maps[key]
        v = a.ravel()[mp["k"]]
        ok = np.isfinite(v)
        km2 = np.bincount(mp["pos"][ok], weights=v[ok], minlength=len(hx)) / 1e6
        df = pd.DataFrame({"hex": hx.hex.to_numpy(), "yr": np.int16(int(yr)), "mo": np.int8(int(mo)), "ba_km2": km2.astype(np.float32)})
        parts.append(df[df.ba_km2 > 0].assign(product=np.int8(0 if prod.startswith("MR_HAR") else 1)))
    return pd.concat(parts, ignore_index=True)


TABLES["firecci"] = ("firecci_l3.parquet", firecci_table)
RAW_OF["firecci"] = ("esa_firecci_grid",)
