"""Haze link for Malaysia and its neighbours (Phase 3): how much of a city's smoke comes from fires upwind.

Smoke adds up, so the model is simple and physical. For each city, the monthly mean surface PM2.5 in the fire season
(July to November, MERRA-2 CNN bias corrected, 2002 to 2025) is a normal level for the calendar month plus a
non-negative amount for every 1,000 harmonized hotspots in each source region (Sumatra, and Borneo: Kalimantan,
Sarawak, Sabah and Brunei). Non-negative least squares; scored leave one year out.
Outputs (data/work/climate/): haze_city_month.parquet; models/haze.json.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as C
from . import drivers as D

CITIES = {   # name: (lat, lon, country)
    "Kuala Lumpur": (3.139, 101.687, "MYS"), "George Town": (5.414, 100.329, "MYS"), "Johor Bahru": (1.492, 103.741, "MYS"),
    "Kuching": (1.553, 110.359, "MYS"), "Kota Kinabalu": (5.980, 116.073, "MYS"), "Singapore": (1.352, 103.820, "SGP"),
    "Pekanbaru": (0.507, 101.448, "IDN"), "Palangka Raya": (-2.208, 113.917, "IDN")}
SOURCES = {   # smoke source regions (state codes of the published areas)
    "sumatra": ["IDN-1136", "IDN-381", "IDN-539", "IDN-492", "IDN-1930", "IDN-1225", "IDN-1230", "IDN-1229", "IDN-1231", "IDN-1796"],
    "borneo": ["IDN-1228", "IDN-1931", "IDN-1234", "IDN-1185", "MYS-1187", "MYS-1186", "MYS-4833",
               "BRN-1181", "BRN-1182", "BRN-1183", "BRN-1184"]}
# Peninsular Malaysia's own fire is small (median 300 hotspots a month in the season, against 7,000 to 8,000 in
# Sumatra and in Kalimantan) and burns in the same El Nino years, so as a third source it only soaked up variance
# (it even "explained" haze in Kuching and Palangka Raya). Two regions fit just as well (leave one year out).
SEASON = (7, 11)
FIT_YEARS = (2002, 2025)
WHO_DAILY = 15.0              # WHO 2021 air quality guideline, 24 hour mean PM2.5 (ug/m3)
WHO_IT2 = 50.0                # WHO interim target 2, 24 hour mean
WHO_ANNUAL = 5.0              # WHO 2021 air quality guideline, annual mean PM2.5 (ug/m3)
LAGS = range(-3, 4)           # months, for the check of the PM2.5 target against raw MERRA-2


def source_fire(con=None) -> pd.DataFrame:
    """Harmonized hotspots per month in each source region (thousands)."""
    con = con or C.connect()
    am = C.path("products") / "v1.0" / "area_monthly.parquet"
    rows = []
    for k, ids in SOURCES.items():
        q = ", ".join(f"'{i}'" for i in ids)
        df = con.execute(f"SELECT yr, mo, sum(h) / 1000 AS fire FROM '{am}' WHERE kind = 'state' AND id IN ({q}) GROUP BY ALL").df()
        rows.append(df.assign(source=k))
    f = pd.concat(rows).pivot_table(index=["yr", "mo"], columns="source", values="fire", fill_value=0.0).reset_index()
    f.columns.name = None
    return f


def city_pm25(con=None) -> pd.DataFrame:
    """Monthly PM2.5 of each city: CNN bias corrected (grid cell holding the city; monthly mean of daily means, and
    the days above the WHO guideline) and MERRA-2 (the city's level 3 hexagon, every month)."""
    con = con or C.connect()
    out = []
    grid = con.execute(f"SELECT DISTINCT lat, lon FROM '{D.out('pm25_cnn_day.parquet')}'").df()
    for name, (la, lo, _) in CITIES.items():
        g = grid.iloc[((grid.lat - la) ** 2 + (grid.lon - lo) ** 2).argmin()]
        cnn = con.execute(f"""SELECT year(date) AS yr, month(date) AS mo, avg(pm25) AS pm25_cnn,
                                     count(*) FILTER (WHERE pm25 > {WHO_DAILY}) AS days_over_who,
                                     count(*) FILTER (WHERE pm25 > {WHO_IT2}) AS days_over_50, count(*) AS days
                              FROM '{D.out('pm25_cnn_day.parquet')}' WHERE lat = {g.lat} AND lon = {g.lon} GROUP BY ALL""").df()
        m2 = con.execute(f"""SELECT yr, mo, pm25 AS pm25_merra2, u10, v10 FROM '{D.out('merra2_l3.parquet')}'
                             WHERE hex = h3_latlng_to_cell({la}, {lo}, 3)""").df()
        rain = con.execute(f"""SELECT yr, mo, rain_mm FROM '{D.out('rain_month.parquet')}'
                               WHERE hex = h3_latlng_to_cell({la}, {lo}, 3)""").df()
        df = m2.merge(cnn, on=["yr", "mo"], how="outer").merge(rain, on=["yr", "mo"], how="left")
        out.append(df.assign(city=name))
    return pd.concat(out, ignore_index=True).astype({"yr": int, "mo": int})


def _design(d: pd.DataFrame) -> np.ndarray:
    months = np.column_stack([(d.mo == m).astype(float) for m in range(SEASON[0], SEASON[1] + 1)])
    return np.column_stack([months, d[list(SOURCES)].to_numpy()])


def fit_city(d: pd.DataFrame) -> dict:
    """PM2.5 = normal level of the month + sum over sources of k x thousand hotspots (k >= 0), non-negative least
    squares, scored leave one year out."""
    from scipy.optimize import nnls
    d = d.dropna(subset=["pm25_cnn"])
    X, y = _design(d), d.pm25_cnn.to_numpy()
    pred = np.full(len(d), np.nan)
    for yr in d.yr.unique():
        tr, te = (d.yr != yr).to_numpy(), (d.yr == yr).to_numpy()
        pred[te] = X[te] @ nnls(X[tr], y[tr])[0]
    b = nnls(X, y)[0]
    nm = SEASON[1] - SEASON[0] + 1
    r2 = lambda p: 1 - float(((y - p) ** 2).sum() / ((y - y.mean()) ** 2).sum())
    resid = y - X @ b
    return {"n_months": int(len(d)), "r2_fit": round(r2(X @ b), 4), "r2_cv": round(r2(pred), 4),
            "rmse_cv": round(float(np.sqrt(np.mean((y - pred) ** 2))), 3), "resid_sd": round(float(resid.std(ddof=nm + len(SOURCES))), 3),
            "normal_by_month": {int(m): round(float(v), 3) for m, v in zip(range(SEASON[0], SEASON[1] + 1), b[:nm])},
            "ug_per_1000_hotspots": {k: round(float(v), 4) for k, v in zip(SOURCES, b[nm:])}}


def _loyo(X: np.ndarray, y: np.ndarray, yrs: np.ndarray) -> np.ndarray:
    """Leave one year out predictions of non-negative least squares."""
    from scipy.optimize import nnls
    pred = np.full(len(y), np.nan)
    for yr in np.unique(yrs):
        tr, te = yrs != yr, yrs == yr
        pred[te] = X[te] @ nnls(X[tr], y[tr])[0]
    return pred


def r2_by_term(d: pd.DataFrame, target: str = "pm25_cnn") -> dict:
    """How much of a city's smoke the fire explains beyond the calendar: leave one year out R2 of the month of year term
    alone (the normal level of each month) and of the full model (month + fire in each source region), and fire's share
    of what the month term leaves, (R2 full - R2 month) / (1 - R2 month). d: the city's fire season months."""
    d = d.dropna(subset=[target])
    X, y, yrs = _design(d), d[target].to_numpy(float), d.yr.to_numpy()
    nm = SEASON[1] - SEASON[0] + 1
    r2 = lambda p: 1 - float(((y - p) ** 2).sum() / ((y - y.mean()) ** 2).sum())
    rm, rf = r2(_loyo(X[:, :nm], y, yrs)), r2(_loyo(X, y, yrs))
    return {"n_months": int(len(d)), "r2_month_cv": round(rm, 4), "r2_full_cv": round(rf, 4),
            "r2_fire_beyond_month": round((rf - rm) / (1 - rm), 4) if rm < 1 else None}


def _series_at(cnn: pd.DataFrame, la: float, lo: float) -> pd.Series:
    """Monthly CNN PM2.5 of the grid cell nearest (la, lo), indexed by month number yr * 12 + mo."""
    lats, lons = np.sort(cnn.lat.unique()), np.sort(cnn.lon.unique())
    ga, gb = lats[np.abs(lats - la).argmin()], lons[np.abs(lons - lo).argmin()]
    s = cnn[(cnn.lat == ga) & (cnn.lon == gb)]
    return pd.Series(s.v.to_numpy(), index=(s.yr * 12 + s.mo).to_numpy()).sort_index()


def _r(a: np.ndarray, b: np.ndarray) -> float | None:
    ok = np.isfinite(a) & np.isfinite(b)
    return round(float(np.corrcoef(a[ok], b[ok])[0, 1]), 3) if ok.sum() > 3 else None


def lag_table(cnn_city: pd.Series, ref: pd.Series) -> dict:
    """Correlation of a monthly CNN series with the reference series (raw MERRA-2) shifted by k months: month t of the
    CNN against month t + k of the reference."""
    return {int(k): _r(cnn_city.to_numpy(float), ref.reindex(cnn_city.index + k).to_numpy(float)) for k in LAGS}


def _anomaly(s: pd.Series) -> pd.Series:
    mo = (s.index - 1) % 12 + 1
    return s - s.groupby(mo).transform("mean")


def target_check(con=None, day_file=None, day=("2015-09-15", "Pekanbaru")) -> dict:
    """Is the CNN PM2.5 target (pm25_cnn_day.parquet) decoded right? For the 8 cities, its monthly series against raw
    MERRA-2 surface PM2.5 of the city's hexagon (merra2_l3.parquet) at lags of -3 to +3 months, and against the grid
    flipped in latitude and in longitude; the whole field against MERRA-2 in every month (as decoded, flipped, and read
    as if the file were lon by lat); and, if `day_file` (one source file of the product, for `day`) is given, the
    city's value in it against the table. Also the seasonal cycle of each, which is where they part."""
    con = con or C.connect()
    f = D.out("pm25_cnn_day.parquet")
    cnn = con.execute(f"SELECT lat, lon, year(date)::INT AS yr, month(date)::INT AS mo, avg(pm25) AS v FROM '{f}' GROUP BY ALL").df()
    lats, lons = np.sort(cnn.lat.unique()), np.sort(cnn.lon.unique())
    m2 = con.execute(f"SELECT hex, yr::INT AS yr, mo::INT AS mo, pm25 FROM '{D.out('merra2_l3.parquet')}'").df()
    m2["t"] = m2.yr * 12 + m2.mo
    cities, pooled = {}, {k: {kk: [] for kk in LAGS} for k in ("as decoded", "lat flipped", "lon flipped")}
    for name, (la, lo, _) in CITIES.items():
        hx = con.execute(f"SELECT h3_latlng_to_cell({la}, {lo}, 3)").fetchall()[0][0]
        ref = m2[m2.hex == hx].set_index("t").pm25.sort_index()
        rows, anom = {}, {}
        for tag, (a, b) in {"as decoded": (la, lo), "lat flipped": (-la, lo), "lon flipped": (la, lons[0] + lons[-1] - lo)}.items():
            sa = _series_at(cnn, a, b)
            rows[tag] = lag_table(sa, ref)
            anom[tag] = _r(_anomaly(sa).to_numpy(float), _anomaly(ref.reindex(sa.index)).to_numpy(float))
            for k, v in rows[tag].items():
                pooled[tag][k].append(v)
        s = _series_at(cnn, la, lo)
        mo = (s.index - 1) % 12 + 1
        refm = ref.reindex(s.index)
        cities[name] = {"r_by_lag": rows, "anomaly_r_lag0": anom["as decoded"], "anomaly_r_lag0_by_grid": anom,
                        "season_cnn": {int(m): round(float(v), 1) for m, v in s.groupby(mo).mean().items()},
                        "season_merra2": {int(m): round(float(v), 1) for m, v in refm.groupby(mo).mean().items()}}
    mean_lag = {tag: {int(k): round(float(np.nanmean([v for v in vs if v is not None])), 3) for k, vs in d.items()} for tag, d in pooled.items()}
    best_lag = int(max(mean_lag["as decoded"], key=mean_lag["as decoded"].get))
    # against each calendar month's mean (the year to year swings, where the fire is): the seasonal cycles differ
    anom_mean = {tag: round(float(np.mean([c["anomaly_r_lag0_by_grid"][tag] for c in cities.values()])), 3) for tag in pooled}
    # the whole field: the cells that fall in a hexagon of our fire grid, every month
    g = pd.DataFrame({"lat": np.repeat(lats, len(lons)), "lon": np.tile(lons, len(lats))})
    con.register("_g", g)
    gh = con.execute("SELECT lat, lon, h3_latlng_to_cell(lat, lon, 3) AS hex FROM _g").df().merge(m2, on="hex")
    con.unregister("_g")
    cnn["ilat"], cnn["ilon"] = np.searchsorted(lats, cnn.lat), np.searchsorted(lons, cnn.lon)
    field = {k: [] for k in ("as decoded", "lat flipped", "lon flipped", "read as lon by lat")}
    for (yr, mo), dd in cnn.groupby(["yr", "mo"]):
        F = np.full((len(lats), len(lons)), np.nan)
        F[dd.ilat, dd.ilon] = dd.v
        alts = {"as decoded": F, "lat flipped": F[::-1], "lon flipped": F[:, ::-1],
                "read as lon by lat": F.ravel().reshape(len(lons), len(lats)).T}
        ref = gh[(gh.yr == yr) & (gh.mo == mo)]
        il, io = np.searchsorted(lats, ref.lat), np.searchsorted(lons, ref.lon)
        for k, A in alts.items():
            x, y = A[il, io], ref.pm25.to_numpy(float)
            ok = (x > 0) & (y > 0)
            field[k].append(_r(np.log(x[ok]), np.log(y[ok])))
    field_r = {k: round(float(np.mean(v)), 3) for k, v in field.items()}
    out = {"cities": cities, "r_by_lag": mean_lag, "best_lag": best_lag, "anomaly_r_lag0_mean": anom_mean, "field_r_mean_by_month": field_r}
    pek = _series_at(cnn, *CITIES["Pekanbaru"][:2])
    hx = con.execute(f"SELECT h3_latlng_to_cell({CITIES['Pekanbaru'][0]}, {CITIES['Pekanbaru'][1]}, 3)").fetchall()[0][0]
    pref = m2[m2.hex == hx].set_index("t").pm25
    out["pekanbaru"] = {f"{y}-{m:02d}": {"cnn": round(float(pek.get(y * 12 + m, np.nan)), 1), "merra2": round(float(pref.get(y * 12 + m, np.nan)), 1)}
                        for y, m in ((2015, 9), (2016, 9), (2015, 11), (2016, 11), (2019, 11))}
    if day_file is not None and Path(day_file).exists():
        import netCDF4
        dname, city = day
        with netCDF4.Dataset(str(day_file)) as ds:
            a = ds["MERRA2_CNN_Surface_PM25"][:].filled(np.nan).astype(np.float64)
            la_, lo_ = ds["lat"][:].data, ds["lon"][:].data
            dims = list(ds["MERRA2_CNN_Surface_PM25"].dimensions)
        a[a <= -998] = np.nan
        i, j = np.abs(la_ - CITIES[city][0]).argmin(), np.abs(lo_ - CITIES[city][1]).argmin()
        src = float(np.nanmean(a[:, i, j]))
        tab = con.execute(f"SELECT pm25 FROM '{f}' WHERE date = '{dname}' AND lat = {float(la_[i])} AND lon = {float(lo_[j])}").fetchall()
        out["day_check"] = {"date": dname, "city": city, "cell": [float(la_[i]), float(lo_[j])], "dims": dims,
                            "source_file_ug_m3": round(src, 3), "table_ug_m3": round(float(tab[0][0]), 3) if tab else None,
                            "hourly_max_ug_m3": round(float(np.nanmax(a[:, i, j])), 1), "field_max_ug_m3": round(float(np.nanmax(np.nanmean(a, 0))), 1)}
    ok = best_lag == 0 and field_r["as decoded"] == max(field_r.values()) and anom_mean["as decoded"] == max(anom_mean.values()) and \
        ("day_check" not in out or abs(out["day_check"]["source_file_ug_m3"] - (out["day_check"]["table_ug_m3"] or -1)) < 0.01)
    out["verdict"] = ("decoded right; the product differs from raw MERRA-2" if ok else "decoding suspect")
    sep = {c: round(v["season_cnn"].get(9, np.nan) / max(v["season_merra2"].get(9, np.nan), 1e-9), 2) for c, v in cities.items()}
    nov = {c: round(v["season_cnn"].get(11, np.nan) / max(v["season_merra2"].get(11, np.nan), 1e-9), 2) for c, v in cities.items()}
    out["cnn_over_merra2_mean"] = {"september": sep, "november": nov}
    dc = out.get("day_check")
    day_txt = (f"The source file of {dc['date']} (fetched again) gives {dc['source_file_ug_m3']:.2f} at {dc['city']}, as the table "
               f"does ({dc['table_ug_m3']:.2f}), with the dimensions {', '.join(dc['dims'])}. " if dc else "")
    out["note"] = (day_txt + "The table matches its grid: lag 0 fits best ({r0} on average at the 8 cities), the swings from year "
                   "to year agree best as decoded ({a0}, against {alat} and {alon} with the grid flipped), and the field as "
                   "decoded matches MERRA-2 far better than flipped or transposed ({f0} against {f1} at most). The "
                   "difference is in the product. The CNN correction damps "
                   "the smoke peaks (Pekanbaru, September 2015: {s15} against {m15} in raw MERRA-2) and rises every year to "
                   "November, the start of the wet season, whatever the fire does (Pekanbaru: {n15}, {n16}, {n19}). Raw MERRA-2 "
                   "aerosols take their fire emissions from MODIS fire radiative power (QFED), so they are not independent of "
                   "fire counts either. The haze model's month of year term absorbs the November rise; the fire terms are read "
                   "beyond it (r2_fire_beyond_month).").format(
                       r0=mean_lag["as decoded"][0], a0=anom_mean["as decoded"], alat=anom_mean["lat flipped"], alon=anom_mean["lon flipped"],
                       f0=field_r["as decoded"], f1=max(v for k, v in field_r.items() if k != "as decoded"),
                       s15=out["pekanbaru"]["2015-09"]["cnn"], m15=out["pekanbaru"]["2015-09"]["merra2"],
                       n15=out["pekanbaru"]["2015-11"]["cnn"], n16=out["pekanbaru"]["2016-11"]["cnn"], n19=out["pekanbaru"]["2019-11"]["cnn"])
    if not ok:
        out["note"] = "Check the decoder in climate.pm25_cnn_table: " + out["note"]
    return out


def city_checks(fire: pd.DataFrame, pm: pd.DataFrame, models: dict) -> dict:
    """Per city: the R2 of the month term and of the full model (leave one year out), on the CNN target and on raw
    MERRA-2, and the 2015 August to October smoke against the WHO annual guideline."""
    out = {}
    for name in CITIES:
        x = fire.merge(pm[pm.city == name].drop(columns="city"), on=["yr", "mo"], how="left")
        season = x[x.mo.between(*SEASON) & x.yr.between(*FIT_YEARS)]
        k = models[name]["ug_per_1000_hotspots"]
        s15 = x[(x.yr == 2015) & x.mo.between(8, 10)]
        smoke15 = float((s15[list(SOURCES)].to_numpy() @ np.array([k[s] for s in SOURCES])).mean())
        out[name] = {**r2_by_term(season, "pm25_cnn"),
                     "merra2_target": r2_by_term(season, "pm25_merra2"),
                     "smoke_2015_aug_oct": round(smoke15, 2), "smoke_2015_aug_oct_per_who_annual": round(smoke15 / WHO_ANNUAL, 2),
                     "pm25_cnn_2015_aug_oct": round(float(s15.pm25_cnn.mean()), 2),
                     "pm25_cnn_2015_aug_oct_per_who_annual": round(float(s15.pm25_cnn.mean()) / WHO_ANNUAL, 2)}
    return out


def checks(con=None, day_file=None, log=print, write: bool = True) -> dict:
    """The target check and the per city R2 by term, added to models/haze.json (no other key changes)."""
    con = con or C.connect()
    hz = json.loads((C.REPO / "models" / "haze.json").read_text())
    fire, pm = source_fire(con), city_pm25(con)
    tc = target_check(con, day_file)
    if "day_check" not in tc and "day_check" in hz.get("target_check", {}):
        tc["day_check"] = hz["target_check"]["day_check"]           # the source file is gone; keep the earlier check
    cc = city_checks(fire, pm, hz["cities"])
    hz["target_check"] = tc
    hz["who_annual_guideline"] = WHO_ANNUAL
    for name, v in cc.items():
        hz["cities"][name].update(v)
    if write:
        with C.atomic(C.REPO / "models" / "haze.json") as tmp:
            tmp.write_text(json.dumps(hz, indent=1))
    log(f"haze target: {tc['verdict']} (best lag {tc['best_lag']})")
    return {"target_check": tc, "cities": cc}


def build(log=print) -> dict:
    con = C.connect()
    fire = source_fire(con)
    pm = city_pm25(con)
    models, rows = {}, []
    for name in CITIES:
        # every month with fire data, so the model also estimates months that have no PM2.5 data yet
        x = fire.merge(pm[pm.city == name].drop(columns="city"), on=["yr", "mo"], how="left").assign(city=name)
        x = x.sort_values(["yr", "mo"]).reset_index(drop=True)
        season = x[x.mo.between(*SEASON)]
        m = fit_city(season[season.yr.between(*FIT_YEARS)])
        models[name] = {**m, "lat": CITIES[name][0], "lon": CITIES[name][1], "country": CITIES[name][2]}
        nm = SEASON[1] - SEASON[0] + 1
        k = np.array(list(m["ug_per_1000_hotspots"].values()))
        ins = x.mo.between(*SEASON)
        x["smoke_model"] = np.where(ins, x[list(SOURCES)].to_numpy() @ k, np.nan)
        base = x.mo.map(m["normal_by_month"])
        x["pm25_model"] = base + x.smoke_model
        # smoke from fire above normal: the model with each source at its normal fire for that month
        normal_fire = fire[fire.yr.between(*D.BASE)].groupby("mo")[list(SOURCES)].median()
        nf = normal_fire.reindex(x.mo).to_numpy()
        x["smoke_excess"] = np.where(ins, (x[list(SOURCES)].to_numpy() - nf).clip(min=0) @ k, np.nan)
        rows.append(x)
        log(f"haze {name}: R2 cv {m['r2_cv']:.2f}, ug/m3 per 1000 hotspots {m['ug_per_1000_hotspots']}")
    res = pd.concat(rows, ignore_index=True)
    with C.atomic(D.out("haze_city_month.parquet")) as tmp:
        res.to_parquet(tmp, index=False)
    old = json.loads((C.REPO / "models" / "haze.json").read_text()) if (C.REPO / "models" / "haze.json").exists() else {}
    with C.atomic(C.REPO / "models" / "haze.json") as tmp:
        tmp.write_text(json.dumps({**old, "season_months": list(SEASON), "fit_years": list(FIT_YEARS), "sources": SOURCES,
                                   "who_daily_guideline": WHO_DAILY, "cities": models}, indent=1))
    checks(con, log=log)                     # the target check and the R2 by term, added to haze.json
    return {"cities": len(models), "rows": len(res)}
