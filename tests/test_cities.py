"""web/cities.json: every city has a real country and state of the app, and well known cities land where they should."""
import json

import pytest

from fireharmony import publish as PB


@pytest.fixture(scope="module")
def cities():
    p = PB.products("web", "cities.json")
    if not p.exists():
        pytest.skip("web/cities.json not built (fireharmony cities)")
    d = json.loads(p.read_text())
    return [dict(zip(d["columns"], r)) for r in d["rows"]]


@pytest.fixture(scope="module")
def places():
    return {(a["kind"], a["id"]) for a in json.loads(PB.products("areas.json").read_text())}


def test_every_city_has_a_place(cities, places):
    assert len(cities) > 3000
    for c in cities:
        assert ("country", c["iso3"]) in places, c
        assert ("state", c["state"]) in places, c


@pytest.mark.parametrize("name, iso3, state", [
    ("Kinshasa", "COD", None), ("Brazzaville", "COG", None), ("Palangkaraya", "IDN", "IDN-1931"),
    ("Pekanbaru", "IDN", "IDN-492"), ("Cuiabá", "BRA", "BRA-602"), ("Manaus", "BRA", "BRA-592"),
])
def test_known_cities(cities, name, iso3, state):
    hits = [c for c in cities if c["name"] == name]
    assert hits, name
    best = max(hits, key=lambda c: c["pop"])
    assert best["iso3"] == iso3
    if state:
        assert best["state"] == state
