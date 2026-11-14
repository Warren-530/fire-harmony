"""More cities for the haze link (fireharmony/haze_cities.py): the same method as haze.py, the same skill rule, and
the app's haze files in step with the outputs (run: .venv/bin/pytest -q tests/test_haze_cities.py)."""
import json

import numpy as np
import pandas as pd
import pytest

from fireharmony import config as C
from fireharmony import drivers as D
from fireharmony import haze as Z
from fireharmony import haze_cities as HC

HAZE_JSON = C.REPO / "models" / "haze.json"
MONTHS = D.out("haze_city_month.parquet")
needs_data = pytest.mark.skipif(not (HAZE_JSON.exists() and MONTHS.exists() and D.out("pm25_cnn_day.parquet").exists()),
                                reason="the haze outputs are not here")


def test_rule():
    assert HC.passes({"r2_cv": 0.5, "r2_fire_beyond_month": 0.05})
    assert not HC.passes({"r2_cv": 0.49, "r2_fire_beyond_month": 0.9})
    assert not HC.passes({"r2_cv": 0.9, "r2_fire_beyond_month": 0.049})
    assert not HC.passes({"r2_cv": 0.9, "r2_fire_beyond_month": None})


def test_candidates_are_inside_the_pm25_data_and_new():
    for name, (la, lo, iso) in HC.CANDIDATES.items():
        assert HC.inside(la, lo), name
        assert name not in Z.CITIES and iso in {"IDN", "MYS", "BRN", "THA", "SGP"}
    assert not HC.inside(13.75, 100.5)          # Bangkok: outside the data


@needs_data
def test_the_eight_cities_pass_the_rule():
    hz = json.loads(HAZE_JSON.read_text())
    for name in Z.CITIES:
        assert HC.passes(hz["cities"][name]), name


@needs_data
def test_city_frame_is_haze_build_for_its_own_cities():
    """city_frame makes a city's months as haze.build does: the published rows of Kuala Lumpur come out again."""
    con = C.connect()
    fire, pm = Z.source_fire(con), Z.city_pm25(con)
    name = "Kuala Lumpur"
    model, x = HC.city_frame(name, Z.CITIES[name], fire, pm)
    hz = json.loads(HAZE_JSON.read_text())
    assert model["r2_cv"] == pytest.approx(hz["cities"][name]["r2_cv"], abs=1e-4)
    assert model["ug_per_1000_hotspots"] == pytest.approx(hz["cities"][name]["ug_per_1000_hotspots"], abs=1e-4)
    pub = pd.read_parquet(MONTHS)
    pub = pub[pub.city == name].sort_values(["yr", "mo"]).reset_index(drop=True)
    assert len(pub) == len(x)
    for col in ("pm25_model", "smoke_model", "smoke_excess", "pm25_cnn", "sumatra", "borneo"):
        np.testing.assert_allclose(pub[col].to_numpy(float), x[col].to_numpy(float), rtol=1e-6, atol=1e-6, err_msg=col)


@needs_data
def test_outputs_keep_only_cities_that_pass():
    hz = json.loads(HAZE_JSON.read_text())
    more = hz.get("more_cities")
    assert more, "run fireharmony haze-cities"
    assert more["rule"] == HC.SKILL_RULE
    kept = {r["name"] for r in more["kept"]}
    weak = {r["name"] for r in more["not_enough_skill"]}
    assert kept and not kept & weak and kept | weak == set(HC.CANDIDATES)
    for r in more["kept"]:
        assert HC.passes(r) and r["name"] in hz["cities"], r["name"]
    for r in more["not_enough_skill"]:
        assert not HC.passes(r) and r["name"] not in hz["cities"], r["name"]
    assert set(hz["cities"]) == set(Z.CITIES) | kept
    rows = pd.read_parquet(MONTHS)
    per = rows.groupby("city").size()
    assert set(per.index) == set(hz["cities"])
    assert per.nunique() == 1                         # every city has every month


@needs_data
def test_app_files_match_the_outputs():
    """The app reads products haze.json and web/haze_months.json: they hold the same cities and numbers."""
    from fireharmony import publish as PB
    hz = json.loads(HAZE_JSON.read_text())
    pub = json.loads(PB.products("haze.json").read_text())
    assert set(pub["cities"]) == set(hz["cities"])
    for n, m in hz["cities"].items():
        assert pub["cities"][n]["r2_cv"] == m["r2_cv"] and pub["cities"][n]["ug_per_1000_hotspots"] == m["ug_per_1000_hotspots"]
    web = json.loads(PB.products("web", "haze_months.json").read_text())
    assert set(web) == set(hz["cities"])
    rows = pd.read_parquet(MONTHS)
    for n in ("Palembang", "Kuala Lumpur"):
        if n not in hz["cities"]:
            continue
        r = rows[(rows.city == n) & (rows.yr >= 2001)].sort_values(["yr", "mo"])
        got = np.array([np.nan if v is None else v for v in web[n]["smoke_model"]], float)
        np.testing.assert_allclose(got, r.smoke_model.to_numpy(float), atol=6e-4, err_msg=n)
