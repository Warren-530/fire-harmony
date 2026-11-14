"""The app's trend files carry the report's rules: the same tested hexagons and places, and the same counts."""
import json

import pytest

from fireharmony import publish as PB


def _load(name):
    p = PB.products("web", name)
    if not p.exists():
        pytest.skip(f"web/{name} not built")
    return json.loads(p.read_text())


@pytest.mark.parametrize("level", [3, 4])
def test_hexagon_counts_match_the_report(level):
    t, eda = _load(f"trend_l{level}.json"), _load("eda.json")
    if "q" not in t:
        pytest.skip("trend flags not written (fireharmony trendflags)")
    want = eda["fdr"][f"l{level}"]
    tested = [i for i, q in enumerate(t["q"]) if q is not None]
    assert len(tested) == want["hexagons"]
    assert all(t["mean"][i] >= t["floor_per_year"] for i in tested)
    sig = [i for i in tested if t["q"][i] <= 0.05]
    assert sum(t["pct"][i] > 0 for i in sig) == want["bh_005"]["rising"]
    assert sum(t["pct"][i] < 0 for i in sig) == want["bh_005"]["falling"]


def test_places_tested_as_in_the_report():
    rows, eda = _load("places.json")["rows"], _load("eda.json")
    if "trend_tested" not in rows[0]:
        pytest.skip("trend flags not written (fireharmony trendflags)")
    for kind, key in (("country", "countries"), ("state", "states")):
        t = [r for r in rows if r["kind"] == kind and r["trend_tested"]]
        assert len(t) == eda["places"][key]["tested"]
        sig = [r for r in t if r["trend_q"] <= 0.05]
        assert sum(r["trend_pct_per_decade"] < 0 for r in sig) == eda["places"][key]["bh_005"]["falling"]


def test_states_carry_their_own_country():
    rows = {r["id"]: r for r in _load("places.json")["rows"]}
    assert rows["ARE-349"]["name"] == "Abu Dhabi, United Arab Emirates" and rows["ARE-349"]["iso3"] == "ARE"
