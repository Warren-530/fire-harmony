"""Cities for the app's place search (web/cities.json): pick a city to study the fire around it.

Source: Natural Earth 1:10m populated places, simple version (public domain), naturalearthdata.com. Kept: every
national and state capital, and every other place with 100,000 people or more. Each city gets the country and state
it lies in from our own hexagon table (cells.parquet, level 5), so it opens the same places as the rest of the app;
a city on the coast whose own hexagon is sea takes the nearest land hexagon within two rings (about 20 km).

  web/cities.json   {"version": 1, "source": ..., "columns": [...], "rows": [[name, ascii, iso3, state_code, lat,
                     lon, pop, capital], ...]}   capital: 2 national, 1 state, 0 none; sorted by population, largest first
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from . import config as C
from . import publish as PB
from . import webfiles as W

SOURCE = "Natural Earth 1:10m populated places (public domain), naturalearthdata.com"
MIN_POP = 100_000
CAPITAL = {"Admin-0 capital": 2, "Admin-0 capital alt": 2, "Admin-0 region capital": 1,
           "Admin-1 capital": 1, "Admin-1 region capital": 1}
SKIP = {"Scientific station", "Meteorological Station", "Historic place"}
COLUMNS = ["name", "ascii", "iso3", "state", "lat", "lon", "pop", "capital"]


def _source() -> Path:
    p = Path.home() / "nasa_work/data/raw/naturalearth_cities/ne_10m_populated_places_simple.geojson"
    if not p.exists():
        raise FileNotFoundError(f"{p} is missing: download ne_10m_populated_places_simple.geojson from Natural Earth")
    return p


def _kept(props: dict) -> bool:
    if props.get("featurecla") in SKIP:
        return False
    return props.get("featurecla") in CAPITAL or (props.get("pop_max") or 0) >= MIN_POP


def build(log=print) -> dict:
    t0 = time.time()
    feats = json.loads(_source().read_text())["features"]
    rows = []
    for f in feats:
        p = f.get("properties") or {}
        if not _kept(p):
            continue
        lat, lon = p.get("latitude"), p.get("longitude")
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            continue
        name = str(p.get("name") or "").strip()
        if not name:
            continue
        ascii_ = str(p.get("nameascii") or "").strip()
        rows.append((name, ascii_ if ascii_ and ascii_ != name else None, float(lat), float(lon),
                     int(p.get("pop_max") or 0), CAPITAL.get(p.get("featurecla"), 0), str(p.get("adm0_a3") or "")))
    con = C.connect()
    con.execute("SET memory_limit = '600MB'")
    con.execute("SET threads = 2")
    con.execute("CREATE OR REPLACE TEMP TABLE city (i INT, lat DOUBLE, lon DOUBLE, a3 VARCHAR)")
    con.executemany("INSERT INTO city VALUES (?, ?, ?, ?)", [(i, r[2], r[3], r[6]) for i, r in enumerate(rows)])
    cells = PB.products("cells.parquet")
    # the nearest land hexagon within two rings (by distance to its centre: the city's own hexagon when it is land),
    # preferring hexagons of the city's own country (Kinshasa sits across the river from Brazzaville)
    found = con.execute(f"""
        WITH c AS (SELECT i, lat, lon, a3, h3_latlng_to_cell(lat, lon, 5) AS own FROM city),
        ring AS (SELECT i, lat, lon, a3, unnest(h3_grid_disk(own, 2)) AS cell FROM c),
        hit AS (SELECT ring.i, k.iso3, k.state_code,
                       row_number() OVER (PARTITION BY ring.i ORDER BY (k.iso3 = ring.a3) DESC,
                                          (k.lat - ring.lat)^2 + ((k.lon - ring.lon) * cos(radians(ring.lat)))^2) AS rk
                FROM ring JOIN '{cells}' k ON k.h3 = h3_h3_to_string(ring.cell))
        SELECT i, iso3, state_code FROM hit WHERE rk = 1""").fetchall()
    where = {i: (iso3, st) for i, iso3, st in found}
    out, missing = [], 0
    for i, (name, ascii_, lat, lon, pop, cap, _a3) in enumerate(rows):
        if i not in where or not where[i][0]:
            missing += 1
            continue
        iso3, st = where[i]
        out.append([name, ascii_, iso3, st, round(lat, 4), round(lon, 4), pop, cap])
    out.sort(key=lambda r: (-r[6], r[0]))
    size = W._write_json(W.web("cities.json"), {"version": 1, "source": SOURCE, "columns": COLUMNS, "rows": out})
    rep = {"cities": len(out), "without_place": missing, "kb": round(size / 1e3), "seconds": round(time.time() - t0)}
    log(f"cities: {rep}")
    return rep
