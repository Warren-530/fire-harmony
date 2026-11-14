"""Statistics of every named place and the trend of every map hexagon, for the app's rankings table and trend map.

  web/places.json      one row per named place (world, continents, countries, states): fire per year, share of the
                       world, the trend, the latest month against normal and its rank, the year so far, the record
                       year, the critical months and peak, the outlook and how well the drivers explain the fire
  web/trend_l3.json    for every level 3 map hexagon with fire: the trend of its yearly fire, 2001 to 2025
  web/trend_l4.json    the same for level 4 hexagons

Every statistic follows fireharmony/analytics.py, the rules the app's own statistics are tested against, so the
table agrees with what the Explorer shows for each place.
"""
from __future__ import annotations

import json
import time

import numpy as np
import pandas as pd

from . import analytics as A
from . import config as C
from . import publish as PB
from . import webfiles as W

BASE = A.BASE_YEARS


def _r(v, d=4):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if not np.isfinite(f) else round(f, d)


def _grid(meta: dict, world_src: dict) -> pd.DataFrame:
    """Every month of the record, with the world's source (3 = unknown everywhere)."""
    first, last = meta["first_month"], meta["last_month"]
    yms, ym = [], first
    while ym <= last:
        yms.append(ym)
        ym = ym + 1 if ym % 100 < 12 else (ym // 100 + 1) * 100 + 1
    g = pd.DataFrame({"ym": yms})
    g["yr"], g["mo"] = g.ym // 100, g.ym % 100
    g["unknown"] = g.ym.map(lambda v: world_src.get(v, 3) == 3)
    return g


def _place_stats(rows: pd.DataFrame, grid: pd.DataFrame) -> dict:
    """rows: yr, mo, h of one place (only months with a row). Filled as the app fills it: zero without a row,
    unknown where the world source is 3."""
    d = grid.merge(rows, on=["yr", "mo"], how="left")
    d["value"] = np.where(d.unknown, np.nan, d.h.fillna(0.0))
    df = d[["yr", "mo", "value"]]
    out: dict = {}
    full = df[df.yr.between(*BASE)].groupby("yr")["value"].agg(["sum", "count"])
    full = full[full["count"] == 12]["sum"]
    out["mean_per_year"] = _r(full.mean(), 1) if len(full) else None
    out["cv"] = _r(full.std(ddof=0) / full.mean(), 3) if len(full) and full.mean() > 0 else None
    if len(full) and full.max() > 0:
        out["record_year"], out["record_total"] = int(full.idxmax()), _r(full.max(), 1)
    t = A.trend(df)
    out["trend_pct_per_decade"] = _r(t.get("pct_per_decade"), 2)
    out["trend_p"] = _r(t.get("p"), 5)
    out["trend"] = t.get("trend")
    known = df.dropna(subset=["value"])
    if len(known):
        clim = A.climatology(df)
        an = A.anomalies(df)
        last = known.iloc[-1]
        yr, mo = int(last.yr), int(last.mo)
        row = an[(an.yr == yr) & (an.mo == mo)].iloc[0]
        med = clim["median"].get(mo)
        out["latest_ym"] = yr * 100 + mo
        out["latest"] = _r(last.value, 1)
        out["latest_normal"] = _r(med, 1)
        out["latest_ratio"] = _r(row["ratio_to_normal"], 3)
        ranked = an[(an.mo == mo) & an.value.notna()]
        out["latest_rank"] = int(row["rank_in_month"]) if pd.notna(row["rank_in_month"]) else None
        out["latest_years"] = int(len(ranked))
        # the year so far against the same months of the base years that know all of them (the app's yearToMonth)
        ytd = df[(df.mo <= mo)].groupby("yr")["value"].agg(["sum", "count"])
        own = ytd.loc[yr] if yr in ytd.index else None
        norm = ytd[(ytd.index >= BASE[0]) & (ytd.index <= BASE[1]) & (ytd["count"] == mo)]["sum"]
        if own is not None:
            out["ytd"] = _r(own["sum"], 1)
            out["ytd_normal"] = _r(norm.median(), 1) if len(norm) else None
            out["ytd_ratio"] = _r(own["sum"] / norm.median(), 3) if len(norm) and norm.median() > 0 else None
        medians = clim["median"].reindex(range(1, 13)).fillna(0)
        out["peak_month"] = int(medians.idxmax()) if medians.max() > 0 else None
        out["critical_months"] = A.critical(df)["critical_period"] if full.sum() > 0 else []
    return out


def places(con, log=print) -> int:
    meta = json.loads(PB.products("meta.json").read_text())
    areas = json.loads(PB.products("areas.json").read_text())
    am = PB.products("area_monthly.parquet")
    data = con.execute(f"SELECT kind, id, yr::INT AS yr, mo::INT AS mo, h, src FROM '{am}'").df()
    world = data[data.kind == "world"]
    world_src = dict(zip(world.yr * 100 + world.mo, world.src))
    grid = _grid(meta, world_src)
    cells = PB.products("cells.parquet")
    # the continent of each country and state, and the country of each state (the most common among its hexagons)
    cont = dict(con.execute(f"SELECT iso3, mode(continent) FROM '{cells}' WHERE iso3 IS NOT NULL GROUP BY iso3").fetchall())
    st = {r[0]: (r[1], r[2]) for r in con.execute(f"SELECT state_code, mode(iso3), mode(continent) FROM '{cells}' WHERE state_code IS NOT NULL GROUP BY state_code").fetchall()}
    ol = con.execute(f"SELECT kind, id, p, p_clim, target_yr::INT * 100 + target_mo::INT AS target, bss FROM '{PB.products('outlook.parquet')}' WHERE lead = 1").fetchall()
    outlook = {(r[0], r[1]): r[2:] for r in ol}
    dm = dict(((r[0], r[1]), r[2]) for r in con.execute(f"SELECT kind, id, r2_cv FROM '{PB.products('drivers_models.parquet')}'").fetchall())
    groups = {k: g[["yr", "mo", "h"]] for k, g in data.groupby(["kind", "id"])}
    world_mean = None
    rows = []
    for a in [{"kind": "world", "id": "WORLD", "name": "World", "country_iso3": None, "area_km2": None}] + areas:
        k = (a["kind"], a["id"])
        g = groups.get(k, pd.DataFrame({"yr": [], "mo": [], "h": []}))
        s = _place_stats(g, grid)
        if a["kind"] == "world":
            world_mean = s.get("mean_per_year")
        iso = a.get("country_iso3")
        row = {"kind": a["kind"], "id": a["id"], "name": a["name"], "iso3": iso,
               "continent": a["id"] if a["kind"] == "continent" else cont.get(iso) if a["kind"] == "country" else st.get(a["id"], (None, None))[1],
               "area_km2": a.get("area_km2"), **s}
        if world_mean and s.get("mean_per_year") is not None:
            row["share_pct"] = _r(100 * s["mean_per_year"] / world_mean, 4)
        if k in outlook:
            p, pc, target, bss = outlook[k]
            row.update({"outlook_p": _r(p, 3), "outlook_p_clim": _r(pc, 3), "outlook_target": int(target), "outlook_bss": _r(bss, 3)})
        if k in dm:
            row["drivers_r2"] = _r(dm[k], 3)
        rows.append(row)
    W._write_json(W.web("places.json"), {"version": 1, "latest_month": meta["last_month"], "rows": rows})
    log(f"places: {len(rows)} rows")
    return len(rows)


def yearly_trend(y: np.ndarray) -> tuple[float, float] | None:
    """analytics.trend on yearly totals (it needs 8 or more years): Mann-Kendall with the Hamed and Rao correction (the
    original test when the correction gives an impossible variance), and % per decade from Sen's slope of log(1 + y)."""
    import pymannkendall as mk
    if len(y) < 8 or y.sum() == 0:
        return None
    r = mk.hamed_rao_modification_test(y)
    if not np.isfinite(r.p) or not r.var_s > 0:
        r = mk.original_test(y)
    log_slope = mk.sens_slope(np.log1p(y)).slope
    return float(100 * (np.exp(10 * log_slope) - 1)), float(r.p)


def hex_trends(con, level: int, log=print) -> int:
    """The trend of each hexagon's yearly fire, 2001 to 2025."""
    m = PB.products(f"map_l{level}.parquet")
    y = con.execute(f"""SELECT h3, yr::INT AS yr, sum(h) AS v FROM '{m}' WHERE yr BETWEEN {BASE[0]} AND {BASE[1]}
                        GROUP BY h3, yr ORDER BY h3, yr""").df()
    years = np.arange(BASE[0], BASE[1] + 1)
    out = {"h3": [], "pct": [], "p": []}
    t0 = time.time()
    for i, (h3, g) in enumerate(y.groupby("h3", sort=True)):
        series = g.set_index("yr")["v"].reindex(years, fill_value=0.0).to_numpy(dtype=float)
        if (series > 0).sum() < 5:              # a handful of fire years: no trend worth showing
            continue
        t = yearly_trend(series)
        if t is None:
            continue
        out["h3"].append(h3)
        out["pct"].append(_r(t[0], 1))
        out["p"].append(_r(t[1], 4))
        if (i + 1) % 20000 == 0:
            log(f"trend l{level}: {i + 1} hexagons at {time.time() - t0:.0f} s")
    W._write_json(W.web(f"trend_l{level}.json"), {"version": 1, "years": list(BASE), **out})
    log(f"trend l{level}: {len(out['h3'])} hexagons")
    return len(out["h3"])


def build(log=print) -> dict:
    t0 = time.time()
    con = C.connect()
    con.execute("SET memory_limit = '800MB'")
    con.execute("SET threads = 2")
    rep = {"places": places(con, log), "trend_l3": hex_trends(con, 3, log), "trend_l4": hex_trends(con, 4, log)}
    rep["seconds"] = round(time.time() - t0)
    return rep
