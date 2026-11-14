"""The report's trend rules, written into the app's files, so the map and the rankings say what the report says.

The report (fireharmony/eda.py, section "Trend rigour") tests a trend only where there is enough fire for it:
  - a map hexagon needs at least eda.HEX_FLOOR (100) hotspots a year on average. Below that, the model's small
    expected values before 2012 (where MODIS saw nothing and VIIRS later records 0) make falls that are not real;
  - a country or state needs at least eda.PLACE_FLOOR (1,000) hotspots a year, and less than eda.MAX_BARREN of its
    fire on barren land or water (lava, gas flares).
The tested trends are then adjusted for the many tests at once (Benjamini and Hochberg, false discovery rate), each
level and each kind of place on its own, as the report does.

  web/trend_l3.json, trend_l4.json   + "mean" (hotspots a year, 2001 to 2025), "q" (adjusted p value, null when
                                       not tested), "floor_per_year"
  web/places.json                    + per row "trend_tested", "trend_q" (null when not tested), "barren_pct"; and
                                       the right country for the two states published under a neighbour's name
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from . import config as C
from . import eda as E
from . import publish as PB
from . import webfiles as W


def _r(v, d):
    return None if v is None or not np.isfinite(v) else round(float(v), d)


def hex_flags(con, level: int) -> dict:
    d = E.hex_trends(level, con)
    path = PB.products("web", f"trend_l{level}.json")
    t = json.loads(path.read_text())
    assert list(d.h3) == t["h3"], "trend file and its table are out of order"
    t["mean"] = [_r(v, 1) for v in d.mean_h]
    t["q"] = [_r(q, 5) if ok else None for q, ok in zip(d.q_bh, d.tested)]
    t["floor_per_year"] = E.HEX_FLOOR
    W._write_json(path, t)
    sig = d.tested & (d.q_bh <= 0.05)
    return {"hexagons": len(d), "tested": int(d.tested.sum()), "rising": int((sig & (d.pct > 0)).sum()),
            "falling": int((sig & (d.pct < 0)).sum())}


def state_names(con) -> dict[str, tuple[str, str]]:
    """Each state's name and country from the most common country of its hexagons (publish.py used any_value, which
    put Abu Dhabi in Iran)."""
    rows = con.execute(f"""SELECT state_code, mode(state || ', ' || country), mode(iso3) FROM '{PB.products('cells.parquet')}'
                           WHERE state_code IS NOT NULL AND state IS NOT NULL GROUP BY state_code""").fetchall()
    return {r[0]: (r[1], r[2]) for r in rows}


def place_flags(con) -> dict:
    path = PB.products("web", "places.json")
    obj = json.loads(path.read_text())
    rows = pd.DataFrame(obj["rows"])
    rows = rows.merge(E.barren_shares(con), on=["kind", "id"], how="left")
    rows["trend_tested"] = False
    rows["trend_q"] = np.nan
    for kind in ("country", "state"):
        k = (rows.kind == kind) & rows.trend_p.notna() & (rows.mean_per_year >= E.PLACE_FLOOR) & ~(rows.barren >= E.MAX_BARREN)
        rows.loc[k, "trend_tested"] = True
        rows.loc[k, "trend_q"] = E.bh_adjust(rows.loc[k, "trend_p"])
    fixed = []
    names = state_names(con)
    areas_path = PB.products("areas.json")
    areas = json.loads(areas_path.read_text())
    for a in areas:
        if a["kind"] == "state" and a["id"] in names:
            name, iso3 = names[a["id"]]
            if (name, iso3) != (a["name"], a["country_iso3"]):
                fixed.append(f"{a['id']}: {a['name']} -> {name}")
                a["name"], a["country_iso3"] = name, iso3
    if fixed:
        areas_path.write_text(json.dumps(areas, ensure_ascii=False, separators=(",", ":")))
        by_id = {a["id"]: a for a in areas if a["kind"] == "state"}
        cont = dict(con.execute(f"SELECT iso3, mode(continent) FROM '{PB.products('cells.parquet')}' WHERE iso3 IS NOT NULL GROUP BY iso3").fetchall())
        for i in rows.index[rows.kind == "state"]:
            a = by_id.get(rows.at[i, "id"])
            if a and (rows.at[i, "name"], rows.at[i, "iso3"]) != (a["name"], a["country_iso3"]):
                rows.at[i, "name"], rows.at[i, "iso3"] = a["name"], a["country_iso3"]
                rows.at[i, "continent"] = cont.get(a["country_iso3"], rows.at[i, "continent"])
    out = []
    for r in rows.to_dict("records"):
        b = r.pop("barren")
        r["barren_pct"] = _r(100 * b, 1) if b is not None and np.isfinite(b) else None
        q = r.pop("trend_q")
        r["trend_q"] = _r(q, 6) if r["trend_tested"] else None
        out.append({k: (None if isinstance(v, float) and not np.isfinite(v) else v) for k, v in r.items()})
    obj["rows"] = out
    obj["trend_rule"] = {"place_floor_per_year": E.PLACE_FLOOR, "max_barren_share": E.MAX_BARREN,
                         "adjustment": "Benjamini and Hochberg, countries and states each on their own"}
    W._write_json(path, obj)
    t = rows[rows.trend_tested]
    return {"tested": int(len(t)), "significant": int((t.trend_q <= 0.05).sum()), "names_fixed": fixed}


def build(log=print) -> dict:
    con = C.connect()
    con.execute("SET memory_limit = '1GB'")
    con.execute("SET threads = 2")
    rep = {"trend_l3": hex_flags(con, 3), "trend_l4": hex_flags(con, 4), "places": place_flags(con)}
    log(f"trend flags: {rep}")
    return rep
