"""The review checks of round 1 (fireharmony/eda.py r1_checks and the vectorized trend tests in analytics.py), on cases
with known answers, and models/r1_checks.json against the published files (run: .venv/bin/pytest -q tests/test_r1_checks.py)."""
import json

import numpy as np
import pandas as pd
import pymannkendall as mk
import pytest

from fireharmony import analytics as A
from fireharmony import config as C
from fireharmony import eda as E
from fireharmony import publish as PB

R1_KEYS = ("seam_by_band", "hex_fdr_2003", "trends_2003_2018", "malaysia_means", "argentina_case", "sen_ci",
           "field_significance", "ratio_ci", "hex_error_nonempty", "boreal_sensitivity")


def test_sen_ci_holds_the_slope_and_narrows_with_less_noise():
    rng = np.random.default_rng(3)
    t = np.arange(25)
    wide = A.sen_ci(2 * t + rng.normal(0, 8, 25))
    tight = A.sen_ci(2 * t + rng.normal(0, 1, 25))
    for slope, lo, hi in (wide, tight):
        assert lo <= slope <= hi and lo < 2 < hi
    assert (tight[2] - tight[1]) < (wide[2] - wide[1])
    # a larger variance of S (as the Hamed and Rao correction gives) widens the interval
    y = 2 * t + rng.normal(0, 8, 25)
    base = A.sen_ci(y)
    assert A.sen_ci(y, var_s=4 * 1833.3)[2] - A.sen_ci(y, var_s=4 * 1833.3)[1] > base[2] - base[1]


def test_mk_matrix_and_sen_matrix_match_pymannkendall():
    rng = np.random.default_rng(5)
    Y = np.vstack([np.round(rng.gamma(2, 50, 25) * (1 + k * 0.03 * np.arange(25))) for k in range(-4, 5)])
    Y[0, :6] = 0                                                   # ties, as the hexagons with little fire have
    plain, hr = A.mk_matrix(Y), A.mk_matrix(Y, hamed_rao=True)
    sen = A.sen_matrix(Y)
    for k, y in enumerate(Y):
        o = mk.original_test(y)
        assert plain["s"][k] == o.s and plain["p"][k] == pytest.approx(o.p, abs=1e-9)
        assert sen[k] == pytest.approx(mk.sens_slope(y).slope)
        h = mk.hamed_rao_modification_test(y)
        if h.var_s > 0:
            assert hr["p"][k] == pytest.approx(h.p, abs=1e-6)


def test_band_table_sorts_units_into_the_four_fire_bands():
    before = pd.Series([30.0, 8.0, 150.0, 1200.0, 5.0])
    after = pd.Series([5.0, 4.0, 100.0, 1000.0, 0.0])
    rows = E._band_table(before, after, band_by=after)
    assert [r["band"] for r in rows] == ["under 10", "10 to 100", "100 to 1,000", "1,000 and more"]
    assert [r["units"] for r in rows] == [3, 0, 1, 1]
    under = rows[0]
    assert under["median_ratio"] == 6.0                            # 6, 2 and infinite (no fire after)
    assert under["share_down_more_than_2x_pct"] == pytest.approx(66.7, abs=0.1)
    assert rows[2]["median_ratio"] == 1.5 and rows[3]["median_ratio"] == 1.2


def _trend_field(falls, rises, flat, n=25, seed=2):
    rng = np.random.default_rng(seed)
    t = np.arange(n)
    rows = [rng.poisson(400 * np.exp(-0.06 * t)) for _ in range(falls)]
    rows += [rng.poisson(200 * np.exp(0.06 * t)) for _ in range(rises)]
    rows += [rng.poisson(300, n) for _ in range(flat)]
    return np.vstack(rows).astype(float)


def test_field_significance_tells_a_real_trend_map_from_chance():
    Y = _trend_field(falls=40, rises=15, flat=60)
    res = E.field_significance(Y, perms=60)
    assert res["observed"]["falling"] >= 35 and res["observed"]["rising"] >= 12
    # one permutation serves every hexagon, so a few block orders near the true one give big null maps: p is coarse
    assert res["p_field_discoveries"] < 0.1
    assert res["null_discoveries"]["median"] < res["observed"]["discoveries"]
    noise = E.field_significance(_trend_field(0, 0, 80, seed=4), perms=40)
    assert noise["observed"]["discoveries"] <= 5


def test_ratio_ci_brackets_the_falls_per_rise():
    Y = _trend_field(falls=40, rises=20, flat=40)
    res = E.ratio_ci(Y, draws=60)
    lo, hi = res["fall_per_rise_ci95"]
    assert lo <= res["observed"]["fall_per_rise"] <= hi + 0.2
    assert lo > 1                                                   # more falls than rises in (nearly) every draw


# --------------------------------------------------------------------------------------- the published checks


@pytest.fixture(scope="module")
def r1():
    p = C.REPO / "models" / "r1_checks.json"
    if not p.exists():
        pytest.skip("models/r1_checks.json not built (eda.r1_checks())")
    return json.loads(p.read_text())


def test_r1_checks_has_every_key(r1):
    assert set(R1_KEYS) <= set(r1)


def test_seam_by_band_has_four_bands_for_places_and_hexagons(r1):
    sb = r1["seam_by_band"]
    tables = [sb["places"][k]["bands"] for k in sb["places"]] + [sb["hexagons_l3"]["bands"]]
    for bands in tables:
        assert [b["band"] for b in bands] == ["under 10", "10 to 100", "100 to 1,000", "1,000 and more"]
        assert all(b["units"] > 0 for b in bands)
    hx = sb["hexagons_l3"]["bands"]
    assert hx[0]["median_ratio"] > hx[1]["median_ratio"] > hx[3]["median_ratio"]   # the low fire seam


def test_trend_checks_agree_with_the_published_map(r1):
    h = r1["hex_fdr_2003"]["2001_2025"]
    eda = PB.products("web", "eda.json")
    if eda.exists():
        f = json.loads(eda.read_text())["fdr"]["l3"]
        assert (h["tested"], h["falling"], h["rising"]) == (f["hexagons"], f["bh_005"]["falling"], f["bh_005"]["rising"])
    fs = r1["field_significance"]
    assert fs["hexagons"] == h["tested"] and fs["p_field_discoveries"] <= 0.01
    lo, hi = r1["ratio_ci"]["fall_per_rise_ci95"]
    assert lo > 1 and lo < hi


def test_malaysia_means_follow_from_area_monthly(r1):
    if not PB.products("area_monthly.parquet").exists():
        pytest.skip("published data absent")
    con = E._con()
    try:
        am, grid = E._monthly(con)
    finally:
        con.close()
    assert json.loads(PB.strict_json(E.malaysia_means(am, grid))) == r1["malaysia_means"]
    m = r1["malaysia_means"]
    assert 30000 < m["mean_2001_2005"] < 33000 and 5500 < m["mean_2021_2025"] < 6500
