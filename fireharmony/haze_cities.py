"""More cities for the haze link: every city of the region that the same smoke reaches, tested the same way.

haze.py links the PM2.5 of eight cities to the fire in Sumatra and Borneo. Its target, the bias corrected MERRA-2 CNN
PM2.5 (data/work/climate/pm25_cnn_day.parquet), covers 12 S to 12 N and 90 E to 130 E only, so the link can only be
tested inside that box. Here the other cities of that box that the smoke of the same sources reaches (Sumatra, Borneo,
Peninsular Malaysia, Singapore, Brunei, southern Thailand, and Jakarta) get the same model, fitted by haze.py's own
functions (city_pm25, fit_city, r2_by_term, city_checks), which this module calls and never changes.

A city is kept only when its held out skill passes the rule that all eight cities of haze.py pass (SKILL_RULE): on
years left out, the model explains at least half of the changes of its monthly PM2.5 in the fire season
(r2_cv >= 0.5), and the fire explains at least 5% of what the month of year leaves (r2_fire_beyond_month >= 0.05;
George Town, the lowest of the eight, has 0.07). The others are listed with their scores as "not enough skill".

Outputs, added to haze.py's (run after `fireharmony haze`; `fireharmony haze-cities`, then publish.haze_files and
webfiles.haze_file):
  models/haze.json: the kept cities join "cities" (haze.py's eight are never touched), and "more_cities" holds the rule,
                    the kept cities and the cities without enough skill (with their scores);
  data/work/climate/haze_city_month.parquet: the kept cities' months are added (the eight cities' rows are kept as
                    they are).
"""
from __future__ import annotations

import json
from unittest import mock

import numpy as np
import pandas as pd

from . import config as C
from . import drivers as D
from . import haze as Z

# name: (lat, lon, country). Coordinates of the place search's city list (web/cities.json, Natural Earth) where it has
# the city, so the Explorer's circle around a city is the same; else the city centre.
CANDIDATES = {
    # Sumatra and its islands
    "Medan": (3.5819, 98.6481, "IDN"), "Banda Aceh": (5.55, 95.32, "IDN"), "Padang": (-0.9581, 100.3581, "IDN"),
    "Jambi": (-1.59, 103.61, "IDN"), "Palembang": (-2.9781, 104.7481, "IDN"), "Bengkulu": (-3.8, 102.27, "IDN"),
    "Bandar Lampung": (-5.4281, 105.2681, "IDN"), "Batam": (1.13, 104.05, "IDN"),
    # Kalimantan
    "Pontianak": (-0.03, 109.32, "IDN"), "Banjarmasin": (-3.32, 114.59, "IDN"), "Samarinda": (-0.5, 117.15, "IDN"),
    "Balikpapan": (-1.25, 116.83, "IDN"), "Tarakan": (3.3, 117.633, "IDN"),
    # Java
    "Jakarta": (-6.1725, 106.8275, "IDN"),
    # Peninsular Malaysia
    "Ipoh": (4.6, 101.065, "MYS"), "Alor Setar": (6.1133, 100.3729, "MYS"), "Kota Bharu": (6.13, 102.24, "MYS"),
    "Kuala Terengganu": (5.3304, 103.12, "MYS"), "Kuantan": (3.83, 103.32, "MYS"), "Seremban": (2.7105, 101.94, "MYS"),
    "Melaka": (2.2064, 102.2465, "MYS"),
    # Sarawak and Sabah
    "Sibu": (2.303, 111.843, "MYS"), "Bintulu": (3.1664, 113.036, "MYS"), "Miri": (4.3999, 113.9845, "MYS"),
    "Sandakan": (5.843, 118.108, "MYS"), "Tawau": (4.271, 117.896, "MYS"),
    # Brunei and southern Thailand
    "Bandar Seri Begawan": (4.8833, 114.9333, "BRN"), "Hat Yai": (6.9964, 100.4714, "THA"),
}
DOMAIN = {"lat": (-12.0, 12.0), "lon": (90.0, 130.0)}     # where the bias corrected PM2.5 exists
SKILL_RULE = {"r2_cv_min": 0.5, "r2_fire_beyond_month_min": 0.05}
RULE_TEXT = ("Kept when, on years left out, the model explains at least half of the changes of the city's monthly "
             "PM2.5 in the fire season (R2 0.5), and the fire explains at least 5% of what the month of year leaves. "
             "All eight cities of the first release pass it.")


def passes(m: dict) -> bool:
    """The skill rule (SKILL_RULE) on a city's held out scores."""
    fb = m.get("r2_fire_beyond_month")
    return (m.get("r2_cv") is not None and m["r2_cv"] >= SKILL_RULE["r2_cv_min"]
            and fb is not None and fb >= SKILL_RULE["r2_fire_beyond_month_min"])


def inside(lat: float, lon: float) -> bool:
    return DOMAIN["lat"][0] <= lat <= DOMAIN["lat"][1] and DOMAIN["lon"][0] <= lon <= DOMAIN["lon"][1]


def city_frame(name: str, where: tuple, fire: pd.DataFrame, pm: pd.DataFrame) -> tuple[dict, pd.DataFrame]:
    """One city's model and months, exactly as haze.build makes them for its eight cities: the fit on the fire season
    months of the fit years (haze.fit_city), the smoke the model gives in every season month, the modelled PM2.5, and
    the smoke from fire above normal."""
    x = fire.merge(pm[pm.city == name].drop(columns="city"), on=["yr", "mo"], how="left").assign(city=name)
    x = x.sort_values(["yr", "mo"]).reset_index(drop=True)
    season = x[x.mo.between(*Z.SEASON)]
    m = Z.fit_city(season[season.yr.between(*Z.FIT_YEARS)])
    model = {**m, "lat": where[0], "lon": where[1], "country": where[2]}
    k = np.array(list(m["ug_per_1000_hotspots"].values()))
    ins = x.mo.between(*Z.SEASON)
    x["smoke_model"] = np.where(ins, x[list(Z.SOURCES)].to_numpy() @ k, np.nan)
    x["pm25_model"] = x.mo.map(m["normal_by_month"]) + x.smoke_model
    normal_fire = fire[fire.yr.between(*D.BASE)].groupby("mo")[list(Z.SOURCES)].median()
    nf = normal_fire.reindex(x.mo).to_numpy()
    x["smoke_excess"] = np.where(ins, (x[list(Z.SOURCES)].to_numpy() - nf).clip(min=0) @ k, np.nan)
    return model, x


def grid_cell(con, cities: dict) -> dict:
    """The PM2.5 grid point each city takes (haze.city_pm25's rule: the nearest point of the grid)."""
    grid = con.execute(f"SELECT DISTINCT lat, lon FROM '{D.out('pm25_cnn_day.parquet')}'").df()
    out = {}
    for name, (la, lo, _) in cities.items():
        g = grid.iloc[((grid.lat - la) ** 2 + (grid.lon - lo) ** 2).argmin()]
        out[name] = (round(float(g.lat), 4), round(float(g.lon), 4))
    return out


def fit_all(con=None, cities: dict | None = None, log=print) -> dict:
    """Fit every candidate with haze.py's functions; no file is written. Returns the models, their months and checks."""
    con = con or C.connect()
    cities = {n: v for n, v in (cities or CANDIDATES).items() if n not in Z.CITIES and inside(v[0], v[1])}
    fire = Z.source_fire(con)
    # (haze.py reads its city list from its own CITIES: it is handed the candidates for these calls only)
    with mock.patch.object(Z, "CITIES", cities):
        pm = Z.city_pm25(con)
    models, frames = {}, {}
    for name, where in cities.items():
        models[name], frames[name] = city_frame(name, where, fire, pm)
    with mock.patch.object(Z, "CITIES", cities):
        checks = Z.city_checks(fire, pm, models)
    for name in cities:
        models[name].update(checks[name])
        log(f"haze {name}: R2 cv {models[name]['r2_cv']:.2f}, fire beyond the month {models[name]['r2_fire_beyond_month']}")
    cells = grid_cell(con, {**Z.CITIES, **cities})
    return {"models": models, "frames": frames, "cells": cells, "cities": cities}


def build(log=print, write: bool = True) -> dict:
    """Fit the candidates, keep those that pass the rule, and add them to haze.py's outputs (see the module text)."""
    con = C.connect()
    res = fit_all(con, log=log)
    models, frames, cells = res["models"], res["frames"], res["cells"]
    path = C.REPO / "models" / "haze.json"
    hz = json.loads(path.read_text())
    base = {n for n in hz["cities"] if n in Z.CITIES}             # haze.py's own cities
    # the cities that share a grid cell of the PM2.5 data (they then share one result)
    by_cell: dict[tuple, list[str]] = {}
    for n, c in cells.items():
        by_cell.setdefault(c, []).append(n)
    kept, weak = [], []
    for name, m in models.items():
        row = {"name": name, "country": m["country"], "lat": m["lat"], "lon": m["lon"], "r2_cv": m["r2_cv"],
               "r2_month_cv": m.get("r2_month_cv"), "r2_fire_beyond_month": m.get("r2_fire_beyond_month"),
               "n_months": m["n_months"], "cell": list(cells[name]),
               "shares_cell_with": sorted(o for o in by_cell[cells[name]] if o != name)}
        (kept if passes(m) else weak).append(row)
    kept.sort(key=lambda r: (r["country"], r["name"]))
    weak.sort(key=lambda r: -(r["r2_cv"] or -9))
    # the eight cities must pass the rule they set (a check of the rule, not a choice)
    eight = {n: passes(hz["cities"][n]) for n in base}
    out = {"rule": SKILL_RULE, "rule_text": RULE_TEXT, "domain": DOMAIN, "first_cities": sorted(base),
           "first_cities_pass": eight, "kept": kept, "not_enough_skill": weak,
           "grid_cells": {n: list(c) for n, c in cells.items()}}
    if not write:
        return out
    # models/haze.json: the kept cities join the eight (any extra city of an earlier run that no longer passes leaves)
    hz["cities"] = {n: v for n, v in hz["cities"].items() if n in base}
    for r in kept:
        hz["cities"][r["name"]] = models[r["name"]]
    hz["more_cities"] = out
    with C.atomic(path) as tmp:
        tmp.write_text(json.dumps(hz, indent=1))
    # haze_city_month.parquet: the eight cities' rows as they are, then the kept cities' months
    p = D.out("haze_city_month.parquet")
    old = pd.read_parquet(p)
    keep_old = old[old.city.isin(base)]
    new = [frames[r["name"]][old.columns] for r in kept]
    res_df = pd.concat([keep_old, *new], ignore_index=True)
    with C.atomic(p) as tmp:
        res_df.to_parquet(tmp, index=False)
    log(f"haze cities: {len(kept)} kept, {len(weak)} without enough skill; {len(res_df)} rows")
    return {"kept": [r["name"] for r in kept], "not_enough_skill": [(r["name"], r["r2_cv"], r["r2_fire_beyond_month"]) for r in weak],
            "rows": int(len(res_df)), "first_cities_pass": eight}


def publish(log=print) -> dict:
    """The app's haze files from the outputs: products haze.parquet and haze.json, and web/haze_months.json."""
    from . import publish as PB
    from . import webfiles as W
    con = C.connect()
    rep = {"haze": PB.haze_files(con), "web": W.haze_file(con)}
    log(f"haze files: {rep}")
    return rep
