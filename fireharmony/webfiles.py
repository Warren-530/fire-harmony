"""The browser's copy of the published files, cut into small pieces (products/v<version>/web/).

Why: GitHub Pages compresses .parquet and .json files on the fly, and then answers byte range requests on the
compressed bytes, so DuckDB in the browser cannot read just the part of a file it needs and downloads every file
whole (41 MB before the Explorer's first view). Small files make whole downloads cheap, and named places need no
database at all. The large files stay as they are, for downloads and for anyone using the data.

  web/series/<kind>/<key>.json     a named place: its monthly record (columns ym, h, modis, t, a, s, n, j, src) and
                                   its outlook rows; <key> = the id with every character outside A-Z a-z 0-9 _ - as _
  web/drivers/<kind>/<key>.json    the drivers model of the place and its driver months (only places with a model)
  web/outline/<kind>/<key>.json    the hexagons that draw the place's outline (level 5, or coarser for big places:
                                   at most 2,500, as the app's MAX_OUTLINE_CELLS) and its level 1 regions
  web/universe_l3.json             the level 3 map's fixed list of hexagons (every hexagon with a normal in clim_l3, in
                                   H3 order) and their normal per calendar month: the map without a database
  web/map_l3/<yyyy>.json           map_l3.parquet, one file per year, as columns that point into that list (i, the index,
                                   -1 for a hexagon outside it, then given in x), so the first map needs no DuckDB at all
  web/map_l4/<yyyy>q<q>.parquet    map_l4.parquet, one file per quarter (the map loads a quarter at a time)
  web/cell_l3/<l1>.parquet         cell_l3.parquet, one file per level 1 region (a clicked hexagon's series)
  web/cell_l4/<l1>.parquet         cell_l4.parquet, the same
  web/cells/<l1>.parquet           cells.parquet, the same (place names under the pointer, hotspot searches)
  web/haze_months.json             haze.parquet by city, as columns
  web/index.json                   the regions of each split, the places with a drivers file (kind/key), and the layout
                                   version (every named place has a series file, empty when it never had fire)
"""
from __future__ import annotations

import json
import re
import shutil
import time
from pathlib import Path

from . import config as C
from . import publish as PB

VERSION = 3          # 2: the level 3 map as JSON; 3: an (empty) series file for every place, the drivers list in the index
MAX_OUTLINE_CELLS = 2500
KIND_COLUMN = {"continent": "continent", "country": "iso3", "state": "state_code"}
SERIES_COLS = ["h", "modis", "t", "a", "s", "n", "j", "src"]


def key(area_id: str) -> str:
    """File name of a place: the same rule as webKey() in app/src/lib/web.ts."""
    return re.sub(r"[^A-Za-z0-9_-]", "_", area_id)


def web(*parts: str) -> Path:
    return PB.products("web", *parts)


def _num(v, digits: int = 3):
    if v is None:
        return None
    f = float(v)
    if f != f:          # NaN
        return None
    return int(f) if f.is_integer() else round(f, digits)


def _write_json(path: Path, obj) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = PB.strict_json(obj, separators=(",", ":"))
    path.write_text(text)
    return len(text)


def _check_keys(con) -> None:
    rows = con.execute(f"SELECT kind, id FROM '{PB.products('area_monthly.parquet')}' GROUP BY ALL").fetchall()
    seen: dict[tuple[str, str], str] = {}
    for kind, area_id in rows:
        k = (kind, key(area_id))
        if k in seen and seen[k] != area_id:
            raise RuntimeError(f"two {kind} ids share the file name {k[1]}: {seen[k]} and {area_id}")
        seen[k] = area_id


def series_files(con, log=print) -> dict:
    """One JSON file per named place: the record (its rows as columns) and its outlook."""
    am, ol = PB.products("area_monthly.parquet"), PB.products("outlook.parquet")
    outlook: dict[tuple[str, str], list] = {}
    cols = [c[0] for c in con.execute(f"DESCRIBE SELECT * EXCLUDE (kind, id) FROM '{ol}'").fetchall()]
    for row in con.execute(f"SELECT kind, id, * EXCLUDE (kind, id) FROM '{ol}' ORDER BY kind, id, lead").fetchall():
        outlook.setdefault((row[0], row[1]), []).append({c: _num(v, 4) for c, v in zip(cols, row[2:])})
    n, size = 0, 0
    cur = con.execute(f"""SELECT kind, id, list(yr::INT * 100 + mo::INT ORDER BY yr, mo), {", ".join(f"list({c} ORDER BY yr, mo)" for c in SERIES_COLS)}
                          FROM '{am}' GROUP BY kind, id""")
    while batch := cur.fetchmany(500):
        for kind, area_id, ym, *vals in batch:
            obj = {"kind": kind, "id": area_id, "ym": ym}
            for c, v in zip(SERIES_COLS, vals):
                obj[c] = [_num(x) for x in v]
            obj["outlook"] = outlook.get((kind, area_id), [])
            size += _write_json(web("series", kind, f"{key(area_id)}.json"), obj)
            n += 1
    # every named place gets a file, so the app never asks for one that is not there (a 404 in the console): a place
    # with no fire in the whole record has empty columns, which the app reads as zero fire
    empty = 0
    for a in json.loads(PB.products("areas.json").read_text()):
        f = web("series", a["kind"], f"{key(a['id'])}.json")
        if not f.exists():
            _write_json(f, {"kind": a["kind"], "id": a["id"], "ym": [], **{c: [] for c in SERIES_COLS}, "outlook": []})
            empty += 1
    log(f"web: {n} series files, {size / 1e6:.1f} MB, and {empty} empty ones for places without fire")
    return {"files": n, "mb": round(size / 1e6, 1)}


def driver_files(con, log=print) -> dict:
    d, dm = PB.products("drivers.parquet"), PB.products("drivers_models.parquet")
    mcols = [c[0] for c in con.execute(f"DESCRIBE SELECT * EXCLUDE (kind, id) FROM '{dm}'").fetchall()]
    models = {(r[0], r[1]): {c: _num(v, 4) if not isinstance(v, (str, bool)) else v for c, v in zip(mcols, r[2:])}
              for r in con.execute(f"SELECT kind, id, * EXCLUDE (kind, id) FROM '{dm}'").fetchall()}
    dcols = [c[0] for c in con.execute(f"DESCRIBE SELECT * EXCLUDE (kind, id) FROM '{d}'").fetchall()]
    n, size = 0, 0
    cur = con.execute(f"""SELECT kind, id, {", ".join(f"list({c} ORDER BY yr, mo)" for c in dcols)} FROM '{d}' GROUP BY kind, id""")
    while batch := cur.fetchmany(200):
        for kind, area_id, *vals in batch:
            if (kind, area_id) not in models:
                continue
            months = {c: [(x if isinstance(x, bool) else _num(x, 4)) for x in v] for c, v in zip(dcols, vals)}
            size += _write_json(web("drivers", kind, f"{key(area_id)}.json"), {"model": models[(kind, area_id)], "months": months})
            n += 1
    log(f"web: {n} driver files, {size / 1e6:.1f} MB")
    return {"files": n, "mb": round(size / 1e6, 1)}


def outline_files(con, log=print) -> dict:
    """The hexagons that draw each place's outline, chosen as MapView's namedShape did from cells.parquet."""
    cells = PB.products("cells.parquet")
    union = " UNION ALL ".join(f"SELECT '{k}' AS kind, {col} AS id, h3 FROM '{cells}' WHERE {col} IS NOT NULL"
                               for k, col in KIND_COLUMN.items())
    con.execute(f"CREATE OR REPLACE TEMP TABLE pc AS {union}")
    parent = lambda res: "h3" if res == 5 else f"h3_h3_to_string(h3_cell_to_parent(h3_string_to_h3(h3), {res}))"
    counts = " UNION ALL ".join(f"SELECT kind, id, {r} AS res, count(DISTINCT {parent(r)}) AS n FROM pc GROUP BY kind, id" for r in (5, 4, 3, 2))
    con.execute(f"""CREATE OR REPLACE TEMP TABLE pick AS
        SELECT kind, id, coalesce(max(res) FILTER (WHERE n <= {MAX_OUTLINE_CELLS}), 2) AS res FROM ({counts}) GROUP BY kind, id""")
    n, size = 0, 0
    for res in (5, 4, 3, 2):
        cur = con.execute(f"""SELECT pc.kind, pc.id, list(DISTINCT {parent(res)}),
                                     list(DISTINCT h3_h3_to_string(h3_cell_to_parent(h3_string_to_h3(h3), 1)))
                              FROM pc JOIN pick USING (kind, id) WHERE pick.res = {res} GROUP BY pc.kind, pc.id""")
        while batch := cur.fetchmany(500):
            for kind, area_id, hexes, regions in batch:
                size += _write_json(web("outline", kind, f"{key(area_id)}.json"), {"cells": sorted(hexes), "regions": sorted(regions)})
                n += 1
    log(f"web: {n} outline files, {size / 1e6:.1f} MB")
    return {"files": n, "mb": round(size / 1e6, 1)}


def _split(con, src: Path, dest: Path, name_sql: str) -> list[str]:
    """One zstd parquet per value of name_sql, with all the columns of src, in one pass (a partitioned write with small
    buffers, so it fits next to other work), then flattened to dest/<value>.parquet."""
    tmp = dest.with_name(dest.name + ".tmp")
    if tmp.exists():
        shutil.rmtree(tmp)
    con.execute("SET partitioned_write_flush_threshold = 100000")
    con.execute("SET partitioned_write_max_open_files = 64")
    con.execute(f"""COPY (SELECT *, {name_sql} AS _part FROM '{src}') TO '{tmp}'
                    (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (_part), ROW_GROUP_SIZE 100000)""")
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    parts = []
    for d in sorted(tmp.glob("_part=*")):
        name = d.name.split("=", 1)[1]
        files = sorted(d.glob("*.parquet"))
        if len(files) == 1:
            files[0].rename(dest / f"{name}.parquet")
        else:
            listed = ", ".join(f"'{f}'" for f in files)
            con.execute(f"COPY (SELECT * FROM read_parquet([{listed}])) TO '{dest / (name + '.parquet')}' (FORMAT parquet, COMPRESSION zstd)")
        parts.append(name)
    shutil.rmtree(tmp)
    return parts


def universe_file(con, level: int) -> int:
    """The map's fixed list of hexagons of one level, as mapData.ts built it in the browser before: every hexagon with a
    normal in clim_l<level> (fire in some month of the base years), in H3 order, with its normal (the median) for each
    calendar month, 0 when it has none. Leaves the temp table u<level> (i, h3) for map_json_files."""
    clim = PB.products(f"clim_l{level}.parquet")
    months = ", ".join(f"COALESCE(max(median) FILTER (WHERE mo = {m}), 0) AS m{m}" for m in range(1, 13))
    con.execute(f"""CREATE OR REPLACE TEMP TABLE u{level} AS
                    SELECT (row_number() OVER (ORDER BY h3) - 1)::INTEGER AS i, h3, {months} FROM '{clim}' GROUP BY h3""")
    rows = con.execute(f"SELECT h3, {', '.join(f'm{m}' for m in range(1, 13))} FROM u{level} ORDER BY i").fetchall()
    obj = {"version": 1, "level": level, "h3": [r[0] for r in rows],
           "normals": [[_num(r[m], 2) for r in rows] for m in range(1, 13)]}
    _write_json(web(f"universe_l{level}.json"), obj)
    return len(rows)


def map_json_files(con, level: int) -> list[str]:
    """map_l<level>.parquet as one JSON file per year: the months with fire of each hexagon, as columns i (index in the
    universe), m (month), h (harmonized), d (MODIS scale), r (raw detections, all sensors); hexagons outside the universe
    (no normal: no fire in the base years) in x, with their own h3. Values with two decimals; zeros are left out."""
    src = PB.products(f"map_l{level}.parquet")
    dest = web(f"map_l{level}")
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    raw = "(COALESCE(m.t, 0) + COALESCE(m.a, 0) + COALESCE(m.s, 0) + COALESCE(m.n, 0) + COALESCE(m.j, 0))"
    con.execute(f"""CREATE OR REPLACE TEMP TABLE mj AS
        SELECT m.yr::INTEGER AS yr, m.mo::INTEGER AS mo, COALESCE(u.i, -1) AS i, CASE WHEN u.i IS NULL THEN m.h3 END AS x,
               COALESCE(m.h, 0)::DOUBLE AS h, COALESCE(m.modis, 0)::DOUBLE AS d, {raw}::BIGINT AS r
        FROM '{src}' m LEFT JOIN u{level} u ON u.h3 = m.h3
        WHERE COALESCE(m.h, 0) > 0 OR COALESCE(m.modis, 0) > 0 OR {raw} > 0""")
    parts = []
    for (yr,) in con.execute("SELECT DISTINCT yr FROM mj ORDER BY yr").fetchall():
        ins = con.execute(f"SELECT i, mo, h, d, r FROM mj WHERE yr = {yr} AND i >= 0 ORDER BY mo, i").fetchall()
        out = con.execute(f"SELECT x, mo, h, d, r FROM mj WHERE yr = {yr} AND i < 0 ORDER BY mo, x").fetchall()
        obj = {"version": 1, "level": level, "part": str(yr),
               "i": [r[0] for r in ins], "m": [r[1] for r in ins], "h": [_num(r[2], 2) for r in ins],
               "d": [_num(r[3], 2) for r in ins], "r": [int(r[4]) for r in ins],
               "x": {"h3": [r[0] for r in out], "m": [r[1] for r in out], "h": [_num(r[2], 2) for r in out],
                     "d": [_num(r[3], 2) for r in out], "r": [int(r[4]) for r in out]}}
        _write_json(dest / f"{yr}.json", obj)
        parts.append(str(yr))
    con.execute("DROP TABLE mj")
    return parts


def split_files(con, log=print) -> dict:
    l1 = "h3_h3_to_string(h3_cell_to_parent(h3_string_to_h3(h3), 1))"
    out = {}
    log(f"web: universe_l3 with {universe_file(con, 3)} hexagons")
    out["map_l3"] = map_json_files(con, 3)
    out["map_l4"] = _split(con, PB.products("map_l4.parquet"), web("map_l4"), "yr::VARCHAR || 'q' || ((mo::INT - 1) // 3 + 1)::VARCHAR")
    for name in ("cell_l3", "cell_l4", "cells"):
        out[name] = _split(con, PB.products(f"{name}.parquet"), web(name), l1)
    for k, v in out.items():
        log(f"web: {k} in {len(v)} files")
    return out


def haze_file(con) -> dict:
    h = PB.products("haze.parquet")
    cols = [c[0] for c in con.execute(f"DESCRIBE SELECT * EXCLUDE (city) FROM '{h}'").fetchall()]
    out = {}
    for city, *vals in con.execute(f"SELECT city, {', '.join(f'list({c} ORDER BY yr, mo)' for c in cols)} FROM '{h}' GROUP BY city").fetchall():
        out[city] = {c: [_num(x, 3) for x in v] for c, v in zip(cols, vals)}
    return {"cities": len(out), "bytes": _write_json(web("haze_months.json"), out)}


def build(log=print) -> dict:
    t0 = time.time()
    con = C.connect()
    # small on purpose: this runs next to other work, and every step is a scan of one published file
    con.execute("SET memory_limit = '900MB'")
    con.execute("SET threads = 2")
    con.execute("SET preserve_insertion_order = false")
    _check_keys(con)
    rep = {"version": VERSION}
    rep["series"] = series_files(con, log)
    rep["drivers"] = driver_files(con, log)
    rep["outline"] = outline_files(con, log)
    splits = split_files(con, log)
    rep["haze"] = haze_file(con)
    # the places that have a drivers file (kind/key), so the app asks only for those
    drivers = sorted(f"{d.name}/{f.stem}" for d in web("drivers").iterdir() if d.is_dir() for f in d.glob("*.json"))
    index = {"version": VERSION, **{k: v for k, v in splits.items()}, "drivers": drivers}
    _write_json(web("index.json"), index)
    rep.update({k: len(v) for k, v in splits.items()})
    size = sum(p.stat().st_size for p in web().rglob("*") if p.is_file())
    rep["mb"] = round(size / 1e6, 1)
    rep["seconds"] = round(time.time() - t0)
    meta = json.loads(PB.products("meta.json").read_text())
    meta.setdefault("files", {})["web"] = {"version": VERSION, "index": "web/index.json", "mb": rep["mb"]}
    with C.atomic(PB.products("meta.json")) as t:
        t.write_text(PB.strict_json(meta, indent=1, default=float))
    return rep
