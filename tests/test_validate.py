"""Seam tests by region and their power (run: .venv/bin/pytest -q tests/test_validate.py)."""
import json

import numpy as np
import pandas as pd
import pytest

from fireharmony import config as C
from fireharmony import validate as V


def _area(kind, id_, step_2012=0.0, step_2002=0.0, seed=0, scale=1000.0):
    """Monthly record and witnesses of a fake area: real fire swings a lot, the record follows MODIS and Terra except
    for chosen steps at January 2012 and July 2002."""
    rng = np.random.default_rng(seed)
    rows = []
    for yr in range(2000, 2026):
        for mo in range(1, 13):
            if (yr, mo) < (2000, 11):
                continue
            fire = scale * rng.lognormal(0, 0.6) * (2 + np.sin(mo / 2))
            modis = fire * (1 + rng.normal(0, 0.005))
            terra = fire * 0.6 * (1 + rng.normal(0, 0.005))
            h = 8 * fire * (1 + step_2012 / 100 if (yr, mo) >= (2012, 1) else 1.0)
            h *= (1 + step_2002 / 100) if (yr, mo) >= (2002, 7) else 1.0
            rows.append({"kind": kind, "id": id_, "yr": yr, "mo": mo, "h": h, "modis": modis, "t": terra})
    return pd.DataFrame(rows)


def test_a_step_at_2012_is_found_and_stands_out_from_the_placebos():
    d = _area("continent", "Testland", step_2012=-6.0, seed=1)
    r = V.seam_unit(d.assign(terra_cc=d.t))
    s = r["2012_modis_witness"]
    assert s["step_1y"] == pytest.approx(-6.0, abs=0.6)
    assert s["placebo_pre"]["sd"] < 1.5
    assert s["z"] < -3
    assert s["detectable_1y"] == pytest.approx(2 * s["placebo_pre"]["sd"], abs=0.01)
    assert len(s["placebo_post"]["steps"]) == 7 and len(s["placebo_pre"]["steps"]) == 8


def test_no_step_gives_a_small_z_and_the_2002_test_uses_terra():
    d = _area("continent", "Testland", step_2002=10.0, seed=2)
    r = V.seam_unit(d.assign(terra_cc=d.t))
    assert abs(r["2012_modis_witness"]["z"]) < 3
    assert r["2002_terra_witness"]["step_1y"] == pytest.approx(10.0, abs=1.0)


def test_regional_seams_picks_world_continents_and_top_countries():
    parts = [_area("world", "WORLD", seed=3, scale=9000)]
    parts += [_area("continent", c, seed=10 + i) for i, c in enumerate(V.SEAM_CONTINENTS)]
    parts += [_area("country", f"C{i:02d}", seed=30 + i, scale=100 * (i + 1)) for i in range(14)]
    parts += [_area("country", "ARG", seed=60, scale=5)]
    am = pd.concat(parts, ignore_index=True)
    cov = am[["yr", "mo"]].drop_duplicates().assign(cov=1.0)
    r = V.regional_seams(am, cov, top=12)
    ids = [u["id"] for u in r["units"]]
    assert ids[0] == "WORLD" and ids[1:7] == list(V.SEAM_CONTINENTS)
    assert ids[7] == "C13" and "C00" not in ids and "C01" not in ids     # the 12 with most fire, largest first
    assert ids[-1] == "ARG" and not r["units"][-1]["in_top"]


def test_power_is_two_placebo_sds():
    val = json.loads((C.REPO / "models" / "validation.json").read_text())
    pw = V.power(val)
    assert pw["2012_modis_witness"]["detectable_pct"] == pytest.approx(2 * val["placebo_seams"]["2012_modis_witness"]["sd"], abs=0.01)
    assert 2.0 < pw["2012_modis_witness"]["detectable_pct"] < 3.0
    assert 9.0 < pw["2002_terra_witness"]["detectable_pct"] < 11.0
    assert 7.5 < pw["2012_burned_area_witness"]["detectable_pct"] < 9.5


def test_validation_json_has_the_regional_seams():
    val = json.loads((C.REPO / "models" / "validation.json").read_text())
    assert {"regional_seams", "power", "per_witness", "placebo_seams"} <= set(val)
    units = {u["name"]: u for u in val["regional_seams"]["units"]}
    assert set(V.SEAM_CONTINENTS) <= set(units)
    w = units["World"]["2012_modis_witness"]
    assert w["step_1y"] == pytest.approx(val["per_witness"]["2012_modis_witness"]["harmonized"]["1y"]["step_pct"], abs=0.01)
    assert w["placebo_pre"]["sd"] == pytest.approx(val["placebo_seams"]["2012_modis_witness"]["sd"], abs=0.01)
    assert units["South America"]["2012_modis_witness"]["z"] < -3
