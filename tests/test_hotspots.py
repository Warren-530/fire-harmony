"""Checks on the published hotspot files (products/v<version>/hotspots/), the source of the app's hotspot CSV.

* nothing is lost: the files hold every raw FIRMS detection, once
* the browser can read them by date: each file is sorted, so its row groups cover increasing dates
* the values are clean (known satellites, confidence classes, coordinates, the region of each hexagon)
* "counted" is the record's own rule: by local solar date, the counted hotspots of a year match the record's counts
  for every satellite and data quality
"""
import json

import pytest

from fireharmony import aggregate as AG
from fireharmony import config as C
from fireharmony import publish as PB

HS = PB.products("hotspots")
INDEX = HS / "index.json"
pytestmark = pytest.mark.skipif(not INDEX.exists(), reason="hotspots not built yet (fireharmony hotspots)")

SATELLITES = {"Terra", "Aqua", "Suomi-NPP", "NOAA-20", "NOAA-21"}
# a year with Terra, Aqua, Suomi-NPP and NOAA-20, all science quality
CHECK_YEAR = 2019


@pytest.fixture(scope="module")
def index():
    return json.loads(INDEX.read_text())


@pytest.fixture(scope="module")
def con():
    return C.connect()          # with the h3 extension


def test_index_matches_the_files(index, con):
    files = {p.name for p in HS.glob("l1=*.parquet")}
    assert files == {v["file"].split("/", 1)[1] for v in index["regions"].values()}
    rows = dict(con.execute(f"""SELECT regexp_extract(file_name, 'l1=([0-9a-f]+)', 1), num_rows::BIGINT
                                FROM parquet_file_metadata('{HS}/l1=*.parquet')""").fetchall())
    assert rows == {r: v["rows"] for r, v in index["regions"].items()}
    assert sum(rows.values()) == index["rows"]
    levels = con.execute(f"SELECT DISTINCT h3_get_resolution(h3_string_to_h3(unnest({list(index['regions'])})))").fetchall()
    assert levels == [(index["region_level"],)]


def test_every_raw_detection_is_there_once(index, con):
    raw = con.execute(f"SELECT sum(num_rows)::BIGINT FROM parquet_file_metadata('{C.raw('firms')}/year=*/detections.parquet')").fetchone()[0]
    assert index["rows"] == raw


def test_files_are_sorted_by_date(con):
    # row group statistics are what the browser uses to skip the months it does not need
    bad = con.execute(f"""
      WITH g AS (SELECT file_name, row_group_id, stats_min::DATE AS lo, stats_max::DATE AS hi
                 FROM parquet_metadata('{HS}/l1=*.parquet') WHERE path_in_schema = 'date'),
           s AS (SELECT *, lag(hi) OVER (PARTITION BY file_name ORDER BY row_group_id) AS prev_hi FROM g)
      SELECT count(*) FROM s WHERE lo < prev_hi OR lo > hi""").fetchone()[0]
    assert bad == 0


def test_columns_and_values(index, con):
    big = max(index["regions"], key=lambda r: index["regions"][r]["rows"])
    f = HS / f"l1={big}.parquet"
    types = dict(con.execute(f"SELECT column_name, column_type FROM (DESCRIBE SELECT * FROM '{f}')").fetchall())
    assert types == {"date": "DATE", "time": "SMALLINT", "lat": "FLOAT", "lon": "FLOAT", "satellite": "VARCHAR",
                     "daynight": "VARCHAR", "frp": "FLOAT", "confidence": "VARCHAR", "type": "TINYINT",
                     "quality": "VARCHAR", "h3_5": "VARCHAR", "counted": "BOOLEAN"}
    r = con.execute(f"""SELECT list(DISTINCT satellite), list(DISTINCT confidence), list(DISTINCT daynight),
                               list(DISTINCT quality), min(lat), max(lat), min(lon), max(lon), min(time), max(time),
                               min(frp), max(frp), count(*) FILTER (WHERE counted IS NULL),
                               count(*) FILTER (WHERE h3_h3_to_string(h3_cell_to_parent(h3_string_to_h3(h3_5), {index["region_level"]})) <> '{big}'),
                               count(*) FILTER (WHERE h3_get_resolution(h3_string_to_h3(h3_5)) <> 5)
                        FROM '{f}'""").fetchone()
    assert set(r[0]) <= SATELLITES
    assert set(r[1]) <= {"low", "nominal", "high"}
    assert set(r[2]) <= {"D", "N"}
    assert set(r[3]) <= {"sp", "nrt"}
    assert -90 <= r[4] <= r[5] <= 90 and -180 <= r[6] <= r[7] <= 180
    assert 0 <= r[8] <= r[9] <= 2359
    assert r[10] >= 0 and r[11] <= AG.FRP_MAX_MW
    assert r[12] == 0
    assert r[13] == 0 and r[14] == 0      # every hexagon is level 5 and inside the file's region


def test_counted_is_the_records_rule(index, con):
    gold = AG.gold_path(CHECK_YEAR)
    if not gold.exists():
        pytest.skip(f"{gold} not on disk")
    want = dict(((s, q), n) for s, q, n in con.execute(
        f"SELECT satellite, quality, sum(n_main)::BIGINT FROM '{gold}' GROUP BY ALL").fetchall())
    # the record dates each detection by local solar time: UTC plus 4 minutes per degree of longitude
    got = dict(((s, q), n) for s, q, n in con.execute(f"""
      SELECT satellite, quality, count(*)::BIGINT FROM read_parquet('{HS}/l1=*.parquet')
      WHERE counted AND date BETWEEN DATE '{CHECK_YEAR - 1}-12-31' AND DATE '{CHECK_YEAR + 1}-01-01'
        AND year(CAST(date + make_time(time // 100, time % 100, 0) + to_seconds(CAST(round(lon * 240) AS BIGINT)) AS DATE)) = {CHECK_YEAR}
      GROUP BY ALL""").fetchall())
    assert set(got) == set(want)
    for k, n in want.items():
        # float32 longitudes can move a detection one second, which changes its solar date only at midnight exactly
        assert abs(got[k] - n) <= max(5, n * 1e-6), (k, got[k], n)
