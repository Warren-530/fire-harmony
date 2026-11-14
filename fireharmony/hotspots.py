"""Every FIRMS hotspot, laid out for the web app's "download the hotspots of my search" (products/v<version>/hotspots/).

One file per H3 level 1 region (about 600,000 km2), all years, sorted by date in small row groups, so the browser reads
only the region files and the months of the search. Columns:
  date        UTC acquisition date            time    UTC time as HHMM
  lat, lon    pixel centre (degrees)           satellite  Terra, Aqua, Suomi-NPP, NOAA-20, NOAA-21
  daynight    D or N                           frp     fire radiative power (MW), empty if the value is corrupt
  confidence  low, nominal or high (MODIS percent below 30 is low, 80 and above is high; VIIRS l, n, h)
  type        NASA's label in science quality data (0 vegetation fire, 1 volcano, 2 other static land source,
              3 offshore); empty in near real time data
  quality     sp (science quality) or nrt (near real time)
  h3_5        the level 5 hexagon (about 253 km2), to select a named area or a drawn shape
  counted     true when the hotspot is in the harmonized record: a vegetation fire (NASA's type 0, or outside the
              static source mask where there is no type), not in open water, and not low confidence
Built in two passes so memory stays small: each year is split by region into a temporary folder, then each region's
years are joined and sorted into its final file. The temporary folder is deleted at the end.
"""
from __future__ import annotations

import glob
import json
import shutil
import time
from pathlib import Path

from . import aggregate as AG
from . import config as C
from . import publish as PB
from . import static_mask as SM

REGION_LEVEL = 1
ROW_GROUP = 60_000


def out_dir() -> Path:
    return PB.products("hotspots")


def _tmp_dir() -> Path:
    return C.work("hotspots_tmp")


BIG_YEAR = 25_000_000      # years with more detections are written a month at a time (2024 has 69 million)


def split_year(year: int, con=None) -> dict:
    """Pass 1: one year of raw FIRMS detections -> hotspots_tmp/year=YYYY/l1=<hex>/*.parquet, then a _SUCCESS mark.
    A partitioned write keeps a buffer per region until it is flushed, so the flush threshold is set low (500 regions
    times the default half a million rows would not fit in memory), and big years go a month at a time."""
    con = con or C.connect()
    con.execute("SET preserve_insertion_order = false")
    con.execute("SET partitioned_write_flush_threshold = 100000")
    con.execute("SET partitioned_write_max_open_files = 64")
    cf = C.cfg()["confidence"]
    mlvl = C.cfg()["static_mask"]["h3_level"]
    src = C.raw("firms", f"year={year}", "detections.parquet")
    dest = _tmp_dir() / f"year={year}"
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True, exist_ok=True)
    n = con.execute(f"SELECT count(*) FROM read_parquet('{src}')").fetchone()[0]
    chunks = [(m, f"WHERE month(acq_datetime) = {m}") for m in range(1, 13)] if n > BIG_YEAR else [(0, "")]
    for m, where in chunks:
        _write_chunk(con, src, dest, where, f"m{m:02d}_{{i}}", cf, mlvl)
    (dest / "_SUCCESS").write_text(str(n))
    return {"year": year, "rows": int(n), "regions": len(list(dest.glob("l1=*")))}


def _write_chunk(con, src, dest, where: str, pattern: str, cf: dict, mlvl: int) -> None:
    con.execute(f"""
      COPY (
        WITH p AS (
          SELECT acq_datetime, ST_Y(geometry) AS lat, ST_X(geometry) AS lon, sensor, satellite, quality, daynight, frp, type,
                 CASE WHEN sensor = 'MODIS' THEN
                        CASE WHEN confidence_pct < {cf['modis_low_below']} THEN 'low'
                             WHEN confidence_pct < {cf['modis_high_from']} THEN 'nominal' ELSE 'high' END
                      ELSE CASE confidence WHEN 'l' THEN 'low' WHEN 'n' THEN 'nominal' WHEN 'h' THEN 'high' END END AS confidence
          FROM read_parquet('{src}') {where}
        ),
        q AS (
          SELECT *, h3_latlng_to_cell(lat, lon, {mlvl}) AS c8, h3_latlng_to_cell(lat, lon, 5) AS c5 FROM p
        )
        SELECT CAST(q.acq_datetime AS DATE) AS date,
               CAST(hour(q.acq_datetime) * 100 + minute(q.acq_datetime) AS SMALLINT) AS time,
               CAST(q.lat AS FLOAT) AS lat, CAST(q.lon AS FLOAT) AS lon, q.satellite, q.daynight,
               CAST(CASE WHEN q.frp BETWEEN 0 AND {AG.FRP_MAX_MW} THEN q.frp END AS FLOAT) AS frp,
               q.confidence, CAST(q.type AS TINYINT) AS type, q.quality,
               h3_h3_to_string(q.c5) AS h3_5,
               (CASE WHEN q.type IS NOT NULL THEN q.type = 0 AND NOT coalesce(m.open_water, false) ELSE m.cell IS NULL END)
                 AND q.confidence <> 'low' AS counted,
               h3_h3_to_string(h3_cell_to_parent(q.c5, {REGION_LEVEL})) AS l1
        FROM q LEFT JOIN read_parquet('{SM.mask_path("all")}') m ON q.c8 = m.cell
      ) TO '{dest}' (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (l1), OVERWRITE_OR_IGNORE true, FILENAME_PATTERN '{pattern}')""")


COLS = "date, time, lat, lon, satellite, daynight, frp, confidence, type, quality, h3_5, counted"
BIG_REGION = 8_000_000     # regions with more hotspots are sorted a year at a time, then joined in year order


def _sorted_copy(con, src: str, dest) -> None:
    con.execute(f"""COPY (SELECT {COLS} FROM read_parquet('{src}') ORDER BY date, time)
                    TO '{dest}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE {ROW_GROUP})""")


def _merge_big(con, r: str, dest: Path) -> None:
    """A region too big to sort in memory at once (the largest has about 25 million hotspots): each year is sorted on
    its own, then the years are read in order, which DuckDB keeps when insertion order is preserved."""
    parts = _tmp_dir() / f"sorted_l1={r}"
    shutil.rmtree(parts, ignore_errors=True)
    parts.mkdir(parents=True)
    files = []
    for ydir in sorted(_tmp_dir().glob(f"year=*/l1={r}")):
        f = parts / f"{ydir.parent.name.split('=')[1]}.parquet"
        _sorted_copy(con, f"{ydir}/*.parquet", f)
        files.append(f"'{f}'")
    con.execute("SET preserve_insertion_order = true")
    with C.atomic(dest) as tmp:
        con.execute(f"""COPY (SELECT * FROM read_parquet([{", ".join(files)}]))
                        TO '{tmp}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE {ROW_GROUP})""")
    shutil.rmtree(parts)


def merge_regions(con=None, log=print) -> dict:
    """Pass 2: per region, all years sorted by date and time -> hotspots/l1=<hex>.parquet, plus an index.
    Resumes: a region file written after the last year was split is kept."""
    con = con or C.connect()
    out = out_dir()
    out.mkdir(parents=True, exist_ok=True)
    tmp_root = _tmp_dir()
    regions = sorted({Path(p).name.split("=", 1)[1] for p in glob.glob(str(tmp_root / "year=*" / "l1=*"))})
    sizes = dict(con.execute(f"""SELECT regexp_extract(file_name, 'l1=([0-9a-f]+)', 1), sum(num_rows)::BIGINT
                                 FROM parquet_file_metadata('{tmp_root}/year=*/l1=*/*.parquet') GROUP BY 1""").fetchall())
    stamp = max(p.stat().st_mtime for p in tmp_root.glob("year=*/_SUCCESS"))
    index, total = {}, 0
    for i, r in enumerate(regions):
        dest = out / f"l1={r}.parquet"
        if not (dest.exists() and dest.stat().st_mtime > stamp):
            if sizes.get(r, 0) > BIG_REGION:
                _merge_big(con, r, dest)
            else:
                with C.atomic(dest) as tmp:
                    _sorted_copy(con, f"{tmp_root}/year=*/l1={r}/*.parquet", tmp)
        n = con.execute(f"SELECT count(*) FROM '{dest}'").fetchone()[0]
        index[r] = {"file": f"hotspots/{dest.name}", "rows": int(n), "mb": round(dest.stat().st_size / 1e6, 2)}
        total += n
        if (i + 1) % 50 == 0:
            log(f"hotspots: {i + 1}/{len(regions)} regions")
    (out / "index.json").write_text(PB.strict_json({"region_level": REGION_LEVEL, "rows": total, "regions": index}))
    return {"regions": len(regions), "rows": int(total), "gb": round(sum(v["mb"] for v in index.values()) / 1e3, 2)}


def build(years=None, log=print) -> dict:
    t0 = time.time()
    con = C.connect()
    years = list(years) if years else [int(Path(p).name.split("=")[1]) for p in sorted(glob.glob(str(C.raw("firms", "year=*"))))]
    rows = 0
    for y in years:
        done = _tmp_dir() / f"year={y}" / "_SUCCESS"
        if done.exists():                       # resume: this year was split in an earlier run
            rows += int(done.read_text() or 0)
            log(f"hotspots: {y} already split")
            continue
        r = split_year(y, con)
        rows += r["rows"]
        log(f"hotspots: {y} split into {r['regions']} regions ({r['rows']:,} rows) at {time.time() - t0:.0f} s")
    rep = merge_regions(con, log)
    shutil.rmtree(_tmp_dir(), ignore_errors=True)
    rep.update({"raw_rows": rows, "seconds": round(time.time() - t0)})
    meta = json.loads(PB.products("meta.json").read_text())
    meta.setdefault("files", {})["hotspots"] = {"index": "hotspots/index.json", "regions": rep["regions"], "rows": rep["rows"], "gb": rep["gb"]}
    with C.atomic(PB.products("meta.json")) as tmp:
        tmp.write_text(PB.strict_json(meta, indent=1, default=float))
    return rep
