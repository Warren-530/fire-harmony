"""The level 3 map as JSON (web/universe_l3.json, web/map_l3/<yyyy>.json) holds the same numbers as map_l3.parquet."""
import json

import duckdb
import pytest

from fireharmony import publish as PB


@pytest.fixture(scope="module")
def universe():
    p = PB.products("web", "universe_l3.json")
    if not p.exists():
        pytest.skip("web files not built (fireharmony webfiles)")
    return json.loads(p.read_text())


def test_universe_is_the_climatology_hexagons_in_order(universe):
    con = duckdb.connect()
    want = [r[0] for r in con.execute(f"SELECT DISTINCT h3 FROM '{PB.products('clim_l3.parquet')}' ORDER BY h3").fetchall()]
    assert universe["h3"] == want
    assert len(universe["normals"]) == 12 and all(len(m) == len(want) for m in universe["normals"])


@pytest.mark.parametrize("year", [2003, 2019, 2026])
def test_year_matches_the_parquet(universe, year):
    block = json.loads(PB.products("web", "map_l3", f"{year}.json").read_text())
    h3 = universe["h3"]
    got = {(h3[i], m): (h, d, r) for i, m, h, d, r in zip(block["i"], block["m"], block["h"], block["d"], block["r"])}
    x = block["x"]
    got.update({(c, m): (h, d, r) for c, m, h, d, r in zip(x["h3"], x["m"], x["h"], x["d"], x["r"])})
    con = duckdb.connect()
    rows = con.execute(f"""SELECT h3, mo::INT, COALESCE(h, 0), COALESCE(modis, 0),
                                  COALESCE(t, 0) + COALESCE(a, 0) + COALESCE(s, 0) + COALESCE(n, 0) + COALESCE(j, 0)
                           FROM '{PB.products('map_l3.parquet')}' WHERE yr = {year}""").fetchall()
    want = {(c, m): (h, d, r) for c, m, h, d, r in rows if h > 0 or d > 0 or r > 0}
    assert set(got) == set(want)
    for k, (h, d, r) in want.items():
        gh, gd, gr = got[k]
        assert abs(gh - h) <= 0.006 and abs(gd - d) <= 0.006 and gr == r, k


def test_every_place_has_a_series_file_and_the_drivers_list_is_exact():
    """The app asks only for files that exist: a series file for every named place (empty when it never had fire), and
    a drivers file exactly for the places the index lists."""
    import re
    web = PB.products("web")
    ix = json.loads((web / "index.json").read_text())
    if ix.get("version", 0) < 3:
        pytest.skip("web files older than layout 3")
    key = lambda i: re.sub(r"[^A-Za-z0-9_-]", "_", i)
    areas = json.loads(PB.products("areas.json").read_text())
    missing = [f"{a['kind']}/{a['id']}" for a in areas if not (web / "series" / a["kind"] / f"{key(a['id'])}.json").exists()]
    assert not missing, missing[:5]
    on_disk = sorted(f"{d.name}/{f.stem}" for d in (web / "drivers").iterdir() if d.is_dir() for f in d.glob("*.json"))
    assert ix["drivers"] == on_disk
