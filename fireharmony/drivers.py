"""Drivers of unusual fire months (Phase 3): rain deficits, fire weather, heat, El Nino and the Indian Ocean Dipole.

For every published area (world, continents, countries, states) we describe the climate where the area's fires burn:
the level 3 hexagon values weighted by the area's normal fire in each hexagon. Each driver becomes an anomaly against
the same calendar month in 2001 to 2025. A small regression per area then says how strongly fire follows each driver,
and for any month how much of the fire anomaly the drivers explain.

Outputs (data/work/climate/):
  rain_bridge.parquet    IMERG Late to Final ratio per hexagon, learned where both exist (Oct 2024 to Sep 2025)
  rain_month.parquet     hex, yr, mo, rain_mm (Final, else bridged Late), rain_src (0 Final, 1 Late bridged)
  area_weights.parquet   kind, id, hex, w (the area's normal yearly fire in that hexagon, 2001 to 2025)
  area_climate.parquet   kind, id, yr, mo and the area's fire weighted climate
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import climate as K
from . import config as C
from . import harmonize as H

BASE = (2001, 2025)
RAIN_PSEUDO_MM = 300.0        # shrink each hexagon's Late to Final ratio towards its continent's ratio with this much rain
OVERLAP = (202410, 202509)    # IMERG Late and Final both exist in these months (yyyymm)


def out(*parts: str):
    return K.out(*parts)


# ------------------------------------------------------------------------------------------ rain: one record
def rain_bridge(con=None) -> pd.DataFrame:
    """Final / Late ratio per hexagon over the overlap year, shrunk towards the ratio of the hexagon's continent and
    then the world (like the VIIRS bridges). IMERG Final is gauge adjusted and Late is not, so the ratio moves with
    the gauge correction, which differs by region."""
    con = con or C.connect()
    a, b = OVERLAP
    df = con.execute(f"""
      WITH r AS (SELECT hex, rain_final_mm AS f, rain_late_mm AS l FROM '{out("rain_l3.parquet")}'
                 WHERE yr::INT * 100 + mo BETWEEN {a} AND {b} AND rain_final_mm IS NOT NULL AND rain_late_mm IS NOT NULL),
           n AS (SELECT hex, sum(f) AS f, sum(l) AS l, count(*) AS months FROM r GROUP BY hex),
           c AS (SELECT DISTINCT h3_cell_to_parent(h3_string_to_h3(h3), 3) AS hex, first(continent) OVER
                   (PARTITION BY h3_cell_to_parent(h3_string_to_h3(h3), 3) ORDER BY area_km2 DESC) AS continent
                 FROM '{C.path("products") / "v1.0" / "cells.parquet"}')
      SELECT n.*, c.continent FROM n LEFT JOIN c USING (hex)""").df()
    full = df.months == (b // 100 * 12 + b % 100) - (a // 100 * 12 + a % 100) + 1
    g = df[full]
    k_world = g.f.sum() / g.l.sum()
    cont = g.groupby("continent").apply(lambda x: (x.f.sum() + RAIN_PSEUDO_MM * 10 * k_world) / (x.l.sum() + RAIN_PSEUDO_MM * 10),
                                        include_groups=False).rename("k_cont")
    df = df.merge(cont, left_on="continent", right_index=True, how="left")
    df["k_cont"] = df.k_cont.fillna(k_world)
    df["k"] = np.where(full, (df.f + RAIN_PSEUDO_MM * df.k_cont) / (df.l + RAIN_PSEUDO_MM), df.k_cont)
    df.attrs["k_world"] = float(k_world)
    return df[["hex", "continent", "f", "l", "months", "k_cont", "k"]]


def rain_month(con=None) -> pd.DataFrame:
    """One monthly rain record per hexagon: IMERG Final where it exists, else IMERG Late times the hexagon's ratio."""
    con = con or C.connect()
    k = rain_bridge(con)
    with C.atomic(out("rain_bridge.parquet")) as tmp:
        k.to_parquet(tmp, index=False)
    con.register("kb", k[["hex", "k"]])
    df = con.execute(f"""
      SELECT r.hex, r.yr, r.mo,
             coalesce(r.rain_final_mm, r.rain_late_mm * kb.k)::FLOAT AS rain_mm,
             CASE WHEN r.rain_final_mm IS NOT NULL THEN 0 WHEN r.rain_late_mm IS NOT NULL THEN 1 END::TINYINT AS rain_src
      FROM '{out("rain_l3.parquet")}' r LEFT JOIN kb USING (hex)
      WHERE coalesce(r.rain_final_mm, r.rain_late_mm) IS NOT NULL
      ORDER BY r.yr, r.mo, r.hex""").df()
    con.unregister("kb")
    return df


# ------------------------------------------------------------------------------------------ areas
def area_weights(con=None) -> pd.DataFrame:
    """For every published area: its level 3 hexagons, each weighted by the area's normal yearly fire there
    (harmonized hotspots per year, 2001 to 2025). So an area's climate is the climate where its fires burn."""
    con = con or C.connect()
    a, b = BASE
    hz = C.work("harmonized_l5", "year=*", "data.parquet")
    cells = C.path("products") / "v1.0" / "cells.parquet"
    return con.execute(f"""
      WITH f AS (SELECT cell, sum(h) / {b - a + 1} AS fire FROM read_parquet('{hz}')
                 WHERE yr BETWEEN {a} AND {b} GROUP BY cell),
           c AS (SELECT h3_string_to_h3(h3) AS cell, iso3, state_code, continent FROM '{cells}'),
           j AS (SELECT h3_cell_to_parent(c.cell, 3) AS hex, c.iso3, c.state_code, c.continent, coalesce(f.fire, 0) AS fire
                 FROM c LEFT JOIN f USING (cell)),
           u AS (SELECT 'world' AS kind, 'WORLD' AS id, hex, fire FROM j
                 UNION ALL SELECT 'continent', continent, hex, fire FROM j WHERE continent IS NOT NULL
                 UNION ALL SELECT 'country', iso3, hex, fire FROM j WHERE iso3 IS NOT NULL
                 UNION ALL SELECT 'state', state_code, hex, fire FROM j WHERE state_code IS NOT NULL)
      SELECT kind, id, hex, sum(fire)::DOUBLE AS w FROM u GROUP BY ALL HAVING sum(fire) > 0 ORDER BY kind, id, hex""").df()


MIN_COVER = 0.9               # an area's climate value needs data in hexagons that hold 90% of its fire


def area_climate(con=None) -> pd.DataFrame:
    """Fire weighted climate of every area and month. A value is kept only where hexagons holding at least
    90% of the area's fire have data."""
    con = con or C.connect()
    con.execute("SET preserve_insertion_order = false")
    cols = {"rain_mm": "r", "t2m_c": "m", "qv2m_gkg": "m", "aod": "m", "pm25": "m", "u10": "m", "v10": "m", "fwi": "f", "dc": "f"}
    agg = ",\n".join(
        f"CASE WHEN sum(a.w) FILTER (WHERE x.{c} IS NOT NULL) >= {MIN_COVER} * any_value(t.w_total) "
        f"THEN (sum(a.w * x.{c}) FILTER (WHERE x.{c} IS NOT NULL) / sum(a.w) FILTER (WHERE x.{c} IS NOT NULL))::FLOAT END AS {c}"
        for c in cols)
    return con.execute(f"""
      WITH x AS (SELECT * FROM (SELECT hex, yr, mo, t2m_c, qv2m_gkg, aod, pm25, u10, v10 FROM '{out("merra2_l3.parquet")}')
                 FULL JOIN (SELECT hex, yr, mo, rain_mm FROM '{out("rain_month.parquet")}') USING (hex, yr, mo)
                 FULL JOIN (SELECT hex, yr, mo, fwi, dc FROM '{out("fwi_l3.parquet")}') USING (hex, yr, mo)),
           a AS (SELECT * FROM '{out("area_weights.parquet")}'),
           t AS (SELECT kind, id, sum(w) AS w_total FROM a GROUP BY ALL)
      SELECT a.kind, a.id, x.yr::SMALLINT AS yr, x.mo::TINYINT AS mo,
             {agg}
      FROM a JOIN x USING (hex) JOIN t USING (kind, id)
      GROUP BY ALL ORDER BY kind, id, yr, mo""").df()


# ------------------------------------------------------------------------------------------ anomalies
def _by_month_stats(df: pd.DataFrame, col: str, base=BASE) -> pd.DataFrame:
    b = df[df.yr.between(*base)]
    return b.groupby(["kind", "id", "mo"])[col].agg(["mean", "std", "median"]).add_prefix(f"{col}_")


def climate_anomalies(clim: pd.DataFrame, idx: pd.DataFrame) -> pd.DataFrame:
    """Driver anomalies per area and month, each against the same calendar month in 2001 to 2025.
      rain3_pct, rain3_z   rain of this month and the 2 before, % from normal and standardised log (SPI like)
      t2m_anom, t2m_z      2 m air temperature, degrees from normal and standardised
      fwi_ratio            fire weather index against its normal (GFWED, January 2002 to April 2026)
      oni, dmi             El Nino (ONI, the 3 month season centred on the month) and the Indian Ocean Dipole"""
    df = clim.sort_values(["kind", "id", "yr", "mo"]).reset_index(drop=True)
    df["t"] = df.yr.astype(int) * 12 + df.mo.astype(int)
    g = df.groupby(["kind", "id"], sort=False)
    # 3 month rain only where the 3 months are consecutive and all present (a NaN month makes the sum NaN)
    ok = (df.t - g.t.shift(2)) == 2
    df["rain3_mm"] = np.where(ok, df.rain_mm + g.rain_mm.shift(1) + g.rain_mm.shift(2), np.nan)
    df["lrain3"] = np.log(df.rain3_mm + 10.0)
    for col in ("lrain3", "rain3_mm", "t2m_c", "fwi"):
        df = df.merge(_by_month_stats(df, col), left_on=["kind", "id", "mo"], right_index=True, how="left")
    df["rain3_z"] = (df.lrain3 - df.lrain3_mean) / df.lrain3_std
    df["rain3_pct"] = 100 * (df.rain3_mm / df.rain3_mm_median - 1)
    df["t2m_anom"] = df.t2m_c - df.t2m_c_mean
    df["t2m_z"] = df.t2m_anom / df.t2m_c_std
    df["fwi_ratio"] = df.fwi / df.fwi_median.where(df.fwi_median > 0.5)
    df = df.merge(idx[["yr", "mo", "oni", "dmi"]].astype({"yr": "int16", "mo": "int8"}), on=["yr", "mo"], how="left")
    keep = ["kind", "id", "yr", "mo", "rain_mm", "rain3_mm", "rain3_pct", "rain3_z", "t2m_c", "t2m_anom", "t2m_z",
            "fwi", "fwi_ratio", "dc", "aod", "pm25", "u10", "v10", "oni", "dmi"]
    return df[keep]


# ------------------------------------------------------------------------------------------ fire anomaly
MIN_FIRE = 300               # areas with fewer harmonized hotspots per year (2001 to 2025) get no driver model
MAX_BARREN = 0.5             # nor do areas whose fire is mostly on barren land or ice (gas flares, lava, as in
                             # Svalbard, Iceland's lava fields or the Algerian Sahara): that is not vegetation fire


def barren_share(con=None) -> pd.DataFrame:
    """Share of each area's normal fire (2001 to 2025) that falls on barren land, ice or water (MCD12C1)."""
    con = con or C.connect()
    a, b = BASE
    hz = C.work("harmonized_l5", "year=*", "data.parquet")
    cells = C.path("products") / "v1.0" / "cells.parquet"
    return con.execute(f"""
      WITH f AS (SELECT cell, sum(h) AS fire FROM read_parquet('{hz}') WHERE yr BETWEEN {a} AND {b} GROUP BY cell),
           c AS (SELECT h3_string_to_h3(h3) AS cell, iso3, state_code, continent, lc_main IN ('barren', 'water') AS bare FROM '{cells}'),
           j AS (SELECT c.*, coalesce(f.fire, 0) AS fire FROM c LEFT JOIN f USING (cell)),
           u AS (SELECT 'world' AS kind, 'WORLD' AS id, bare, fire FROM j
                 UNION ALL SELECT 'continent', continent, bare, fire FROM j WHERE continent IS NOT NULL
                 UNION ALL SELECT 'country', iso3, bare, fire FROM j WHERE iso3 IS NOT NULL
                 UNION ALL SELECT 'state', state_code, bare, fire FROM j WHERE state_code IS NOT NULL)
      SELECT kind, id, coalesce(sum(fire) FILTER (WHERE bare), 0) / nullif(sum(fire), 0) AS barren_share
      FROM u GROUP BY ALL""").df()


def fire_anomaly(con=None) -> pd.DataFrame:
    """Monthly fire of every published area against its normal (the median of the calendar month, 2001 to 2025).
    y = log((h + c) / (normal + c)) with c = 2% of the area's mean monthly normal (so empty months do not explode),
    ratio = h / normal, and the weight of the month = normal / mean normal (fire season months count most)."""
    con = con or C.connect()
    am = con.execute(f"SELECT kind, id, yr, mo, h, src FROM '{C.path('products') / 'v1.0' / 'area_monthly.parquet'}'").df()
    last = am.yr.max() * 12 + am[am.yr == am.yr.max()].mo.max()
    months = pd.DataFrame({"t": np.arange(2000 * 12 + 11, last + 1)})
    months["yr"], months["mo"] = (months.t - 1) // 12, (months.t - 1) % 12 + 1
    areas = am[["kind", "id"]].drop_duplicates()
    full = areas.merge(months[["yr", "mo"]], how="cross")
    df = full.merge(am, on=["kind", "id", "yr", "mo"], how="left")
    df["h"] = df.h.fillna(0.0)
    unknown = am.groupby(["yr", "mo"]).src.min().eq(3)                 # months with no data anywhere yet
    df.loc[df.set_index(["yr", "mo"]).index.isin(unknown[unknown].index) | (df.src == 3), "h"] = np.nan
    b = df[df.yr.between(*BASE)]
    norm = b.groupby(["kind", "id", "mo"]).h.median().rename("normal").reset_index()
    df = df.merge(norm, on=["kind", "id", "mo"], how="left")
    mean_norm = df.groupby(["kind", "id"]).normal.transform("mean")
    c = np.maximum(0.02 * mean_norm, 0.5)
    df["y"] = np.log((df.h + c) / (df.normal + c))
    df["ratio"] = df.h / df.normal.where(df.normal > 0)
    df["w"] = (df.normal / mean_norm).clip(lower=0.02)
    df["fire_per_year"] = b.groupby(["kind", "id"]).h.sum().reindex(pd.MultiIndex.from_frame(df[["kind", "id"]])).to_numpy() / (BASE[1] - BASE[0] + 1)
    return df[["kind", "id", "yr", "mo", "h", "normal", "y", "ratio", "w", "fire_per_year"]]


# ------------------------------------------------------------------------------------------ driver model per area
DRIVERS = ("rain3_z", "t2m_z", "oni")
ONI_LAGS = range(0, 7)        # El Nino acts with a delay: we pick the lag (0 to 6 months) that fits best
FIT_YEARS = (2002, 2025)


def _wls(X: np.ndarray, y: np.ndarray, w: np.ndarray) -> np.ndarray:
    sw = np.sqrt(w)
    return np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)[0]


TERMS = {"rain3_z": "rain3_z", "t2m_z": "t2m_z"}     # model term -> column


def _design(d: pd.DataFrame, terms) -> np.ndarray:
    return np.column_stack([np.ones(len(d)), *[d[TERMS[t]] for t in terms]])


def _terms(d: pd.DataFrame) -> list[str]:
    """Physically sensible drivers only: a rain deficit must raise fire and so must heat. In the tropics hot months
    can come out with less fire, because thick smoke cools the surface in MERRA-2 (the fire drives the 'driver'),
    so a term with the wrong sign is dropped and the model is fitted again."""
    terms = list(TERMS)
    while terms:
        b = dict(zip(["const", *terms], _wls(_design(d, terms), d.y.to_numpy(), d.w.to_numpy())))
        wrong = [t for t in terms if (b[t] > 0 if t == "rain3_z" else b[t] < 0)]
        if not wrong:
            return terms
        terms = [t for t in terms if t not in wrong]
    return terms


def fit_area(d: pd.DataFrame) -> dict:
    """One area: fire anomaly ~ rain deficit (+ heat), weighted least squares where fire season months count most.
    El Nino is not a term here: it acts through the rain, so we model that link separately (enso_link).
    The score is honest: leave one year out, with the terms chosen again inside each fold."""
    import statsmodels.api as sm
    d = d.dropna(subset=["y", "rain3_z", "t2m_z"])
    if len(d) < 120:
        return {}
    pred = np.full(len(d), np.nan)
    for yr in d.yr.unique():
        tr, te = d.yr != yr, (d.yr == yr).to_numpy()
        terms = _terms(d[tr])
        pred[te] = _design(d[te], terms) @ _wls(_design(d[tr], terms), d.y[tr].to_numpy(), d.w[tr].to_numpy())
    yw = np.average(d.y, weights=d.w)
    r2_cv = 1 - float((d.w * (d.y - pred) ** 2).sum() / (d.w * (d.y - yw) ** 2).sum())
    terms = _terms(d)
    fit = sm.WLS(d.y.to_numpy(), _design(d, terms), weights=d.w.to_numpy()).fit(cov_type="HAC", cov_kwds={"maxlags": 3})
    names = ["const", *terms]
    full = {k: 0.0 for k in ("const", *TERMS)}
    return {"n_months": int(len(d)), "terms": terms, "r2_cv": round(r2_cv, 4), "r2_fit": round(float(fit.rsquared), 4),
            "beta": {**full, **{k: round(float(v), 5) for k, v in zip(names, fit.params)}},
            "se": {**full, **{k: round(float(v), 5) for k, v in zip(names, fit.bse)}},
            "p": {**{k: 1.0 for k in full}, **{k: float(v) for k, v in zip(names, fit.pvalues)}}}


def enso_link(d: pd.DataFrame) -> dict:
    """How El Nino moves the area's rain: rain3_z ~ ONI L months earlier (L = 0 to 6, the strongest), weighted by
    fire season. A negative slope means El Nino brings drought here."""
    best = None
    for L in ONI_LAGS:
        x = d.dropna(subset=["rain3_z", f"oni_l{L}"])
        if len(x) < 120:
            continue
        w = x.w.to_numpy()
        xm, ym = np.average(x[f"oni_l{L}"], weights=w), np.average(x.rain3_z, weights=w)
        cov = np.average((x[f"oni_l{L}"] - xm) * (x.rain3_z - ym), weights=w)
        vx, vy = np.average((x[f"oni_l{L}"] - xm) ** 2, weights=w), np.average((x.rain3_z - ym) ** 2, weights=w)
        r = cov / np.sqrt(vx * vy)
        if best is None or abs(r) > abs(best["r"]):
            best = {"lag": L, "r": float(r), "slope": float(cov / vx), "n": int(len(x))}
    return best or {}


def with_oni_lags(anom: pd.DataFrame, idx: pd.DataFrame) -> pd.DataFrame:
    """Adds oni_l0 .. oni_l6: the ONI L months before each month (the same for every area)."""
    t = idx.assign(t=idx.yr.astype(int) * 12 + idx.mo.astype(int)).set_index("t").oni
    tt = anom.yr.astype(int) * 12 + anom.mo.astype(int)
    for L in ONI_LAGS:
        anom[f"oni_l{L}"] = (tt - L).map(t).to_numpy()
    return anom


SEASON_SHARE = 0.2           # a month is in the fire season when its normal fire is at least a fifth of an average
                             # month (0.15 to 0.5 all give honest outlook chances; 0.2 keeps the shoulder months, such
                             # as November in Indonesia, and leaves out the deep off season, such as May in Kalimantan)


def explain(d: pd.DataFrame, m: dict, e: dict) -> pd.DataFrame:
    """For every month: how many times normal fire the rain alone would give (exp of its term), the heat alone and
    both together, next to what happened; and the El Nino context: the ONI at the area's lag and the rain anomaly
    (in standard deviations) that El Nino alone would bring.
    The fire estimate is given only for months of the fire season. The model is fitted with fire season months
    counting most, and outside the season a dry spell rarely lights much (in Central Kalimantan, May 2026 had the
    driest 3 months on record for May and fire stayed at a quarter of normal), so there it would mislead."""
    b = m["beta"]
    o = d[["kind", "id", "yr", "mo"]].copy()
    season = (d.w >= SEASON_SHARE).to_numpy()
    f_rain = np.exp(b["rain3_z"] * d.rain3_z.to_numpy())
    f_heat = np.exp(b["t2m_z"] * d.t2m_z.fillna(0.0).to_numpy())
    o["in_season"] = season
    o["f_rain"] = np.where(season, f_rain, np.nan).astype(np.float32)
    o["f_heat"] = np.where(season, f_heat, np.nan).astype(np.float32)
    o["heat_known"] = d.t2m_z.notna().to_numpy()
    o["f_drivers"] = np.where(season, f_rain * f_heat, np.nan).astype(np.float32)
    if e:
        o["oni_lagged"] = d[f"oni_l{e['lag']}"].astype(np.float32)
        o["rain_z_from_enso"] = (e["slope"] * d[f"oni_l{e['lag']}"]).astype(np.float32)
    return o


# ------------------------------------------------------------------------------------------ build
def build(log=print) -> dict:
    """All driver tables, then one model per area with enough fire, and the monthly explanation."""
    import json
    import time
    t0 = time.time()
    con = C.connect()
    rm = rain_month(con)
    with C.atomic(out("rain_month.parquet")) as tmp:
        rm.to_parquet(tmp, index=False)
    w = area_weights(con)
    with C.atomic(out("area_weights.parquet")) as tmp:
        w.to_parquet(tmp, index=False)
    clim = area_climate(con)
    with C.atomic(out("area_climate.parquet")) as tmp:
        clim.to_parquet(tmp, index=False)
    idx = pd.read_parquet(out("indices.parquet"))
    an = with_oni_lags(climate_anomalies(clim, idx), idx)
    fire = fire_anomaly(con)
    d = fire.merge(an, on=["kind", "id", "yr", "mo"], how="left")
    log(f"drivers: tables ready in {time.time() - t0:.0f} s")
    models, parts = {}, []
    bs = barren_share(con)
    keep = bs[bs.barren_share.fillna(0) <= MAX_BARREN][["kind", "id"]]
    todo = d[d.fire_per_year >= MIN_FIRE][["kind", "id"]].drop_duplicates().merge(keep, on=["kind", "id"])
    for i, (kind, id_) in enumerate(todo.itertuples(index=False)):
        x = d[(d.kind == kind) & (d.id == id_)]
        fit = x[x.yr.between(*FIT_YEARS)]
        m, e = fit_area(fit), enso_link(fit)
        if not m:
            continue
        models[f"{kind}:{id_}"] = {**m, "enso": e, "fire_per_year": round(float(x.fire_per_year.iloc[0]), 1)}
        parts.append(explain(x, m, e))
        if (i + 1) % 500 == 0:
            log(f"drivers: {i + 1}/{len(todo)} areas")
    ex = pd.concat(parts, ignore_index=True)
    keep = ["kind", "id", "yr", "mo", "h", "normal", "ratio", "rain3_pct", "rain3_z", "t2m_anom", "t2m_z", "fwi_ratio", "oni", "dmi"]
    res = d[keep].merge(ex, on=["kind", "id", "yr", "mo"], how="inner")
    with C.atomic(out("drivers_monthly.parquet")) as tmp:
        res.to_parquet(tmp, index=False)
    with C.atomic(C.REPO / "models" / "drivers.json") as tmp:
        tmp.write_text(json.dumps({"base_years": list(BASE), "fit_years": list(FIT_YEARS), "min_fire_per_year": MIN_FIRE,
                                   "areas": models}, indent=0))
    r2 = pd.Series({k: v["r2_cv"] for k, v in models.items()})
    return {"areas_modelled": len(models), "rows": len(res), "seconds": round(time.time() - t0),
            "r2_cv_quantiles": r2.quantile([0.1, 0.25, 0.5, 0.75, 0.9]).round(3).to_dict(),
            "share_r2_cv_above_0.2": round(float((r2 > 0.2).mean()), 3)}
