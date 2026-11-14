"""The haze link's checks: the PM2.5 target and what the fire explains beyond the calendar
(run: .venv/bin/pytest -q tests/test_haze.py)."""
import json

import numpy as np
import pandas as pd
import pytest

from fireharmony import config as C
from fireharmony import haze as Z


def _season(seed=2, fire_k=(0.0, 0.0), month_level=(8, 9, 14, 21, 30)):
    """Fake fire season months, 2002 to 2025: PM2.5 = level of the month + k x fire + noise."""
    rng = np.random.default_rng(seed)
    rows = []
    for yr in range(2002, 2026):
        boost = rng.gamma(1.0, 20.0)                   # a fire year or not
        for i, mo in enumerate(range(Z.SEASON[0], Z.SEASON[1] + 1)):
            su, bo = boost * rng.uniform(0.5, 1.5), boost * rng.uniform(0.5, 1.5)
            pm = month_level[i] + fire_k[0] * su + fire_k[1] * bo + rng.normal(0, 1.0)
            rows.append({"yr": yr, "mo": mo, "sumatra": su, "borneo": bo, "pm25_cnn": pm})
    return pd.DataFrame(rows)


def test_month_term_alone_explains_a_calendar_only_city():
    r = Z.r2_by_term(_season(fire_k=(0.0, 0.0)))
    assert r["r2_month_cv"] > 0.9
    assert r["r2_fire_beyond_month"] < 0.05


def test_fire_explains_what_the_month_term_leaves():
    r = Z.r2_by_term(_season(fire_k=(0.4, 0.1)))
    assert r["r2_full_cv"] > r["r2_month_cv"]
    assert r["r2_fire_beyond_month"] > 0.8
    want = (r["r2_full_cv"] - r["r2_month_cv"]) / (1 - r["r2_month_cv"])
    assert r["r2_fire_beyond_month"] == pytest.approx(want, abs=1e-3)


def test_lag_table_finds_a_shift():
    rng = np.random.default_rng(5)
    t = np.arange(2002 * 12 + 1, 2026 * 12 + 1)
    ref = pd.Series(rng.normal(size=len(t)), index=t)
    cnn = ref.shift(-2).dropna()                  # cnn at t is the reference at t + 2
    r = Z.lag_table(cnn, ref)
    assert max(r, key=r.get) == 2 and r[2] == pytest.approx(1.0)


def test_haze_json_has_the_target_check_and_r2_by_term():
    hz = json.loads((C.REPO / "models" / "haze.json").read_text())
    tc = hz["target_check"]
    assert {"verdict", "best_lag", "r_by_lag", "note"} <= set(tc)
    assert tc["verdict"].startswith("decoded right") and tc["best_lag"] == 0
    assert hz["who_annual_guideline"] == 5.0
    expect = {"George Town": (0.91, 0.92), "Pekanbaru": (0.85, 0.87), "Kuala Lumpur": (0.54, 0.79)}
    for city, (m, f) in expect.items():
        c = hz["cities"][city]
        assert c["r2_month_cv"] == pytest.approx(m, abs=0.01)
        assert c["r2_full_cv"] == pytest.approx(f, abs=0.01)
        assert c["r2_full_cv"] == pytest.approx(c["r2_cv"], abs=1e-3)      # the same model as the published one
        assert 0 <= c["r2_fire_beyond_month"] <= 1
        assert c["smoke_2015_aug_oct_per_who_annual"] == pytest.approx(c["smoke_2015_aug_oct"] / 5.0, abs=0.01)
