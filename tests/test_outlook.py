"""The outlook's fair skill score (run: .venv/bin/pytest -q tests/test_outlook.py)."""
import json

import numpy as np
import pandas as pd
import pytest

from fireharmony import config as C
from fireharmony import outlook as O


def _fake_cv(seed=1, areas=12, years=range(2002, 2026), months=(8, 9, 10)):
    """Held out rows with a known truth: the outcome follows this month's anomaly y0 a little, the model knows y0."""
    rng = np.random.default_rng(seed)
    rows = []
    for a in range(areas):
        for L in O.LEADS:
            for yr in years:
                for mo in months:
                    y0 = rng.normal()
                    above = float(rng.random() < 1 / (1 + np.exp(-0.8 * y0 / L)))
                    rows.append({"kind": "state", "id": f"A{a}", "lead": L, "yr": yr, "mo": mo, "target_yr": yr,
                                 "target_mo": mo, "in_season": True, "y0": y0, "above": above,
                                 "p": 1 / (1 + np.exp(-0.8 * y0 / L))})
    cv = pd.DataFrame(rows)
    # the old reference: the share of the OTHER years above normal for the same area and month (leave one out)
    g = cv.groupby(["kind", "id", "lead", "target_mo"]).above
    cv["p_clim"] = (g.transform("sum") - cv.above) / (g.transform("size") - 1)
    return cv


def test_fixed_50_is_the_textbook_brier_skill_score():
    cv = _fake_cv()
    sk = O.skill_table(cv, draws=100)
    for L in O.LEADS:
        g = cv[cv.lead == L]
        bs = ((g.p - g.above) ** 2).mean()
        row = sk[f"lead {L}"]
        assert row["fixed_50"]["brier_ref"] == pytest.approx(0.25)
        assert row["fixed_50"]["bss"] == pytest.approx(1 - bs / 0.25, abs=1e-4)
        lo, hi = row["fixed_50"]["ci95"]
        assert lo <= row["fixed_50"]["bss"] <= hi
    # skill fades with lead, as the fake truth does
    assert sk["lead 1"]["fixed_50"]["bss"] > sk["lead 3"]["fixed_50"]["bss"]


def test_leave_one_out_climatology_is_anti_correlated_and_inflates_skill():
    cv = _fake_cv()
    row = O.skill_table(cv, draws=50)["lead 1"]
    old = row["old_reference_p_clim"]
    assert old["r_with_outcome"] < 0
    assert old["brier_ref"] > 0.25
    assert old["bss"] > row["fixed_50"]["bss"]


def test_persistence_baseline_and_its_absence():
    cv = _fake_cv()
    row = O.skill_table(cv, draws=50)["lead 1"]
    pers = row["persistence"]
    assert pers is not None and pers["rows_with_y0"] == int((cv.lead == 1).sum())
    assert pers["bss"] > 0                                   # y0 carries the signal
    # the fake model is the truth, a fitted logistic on y0 can only come close
    assert pers["model_bss_over_persistence"] > -0.02
    no_y0 = O.skill_table(cv.drop(columns="y0"), draws=20)
    assert no_y0["lead 1"]["persistence"] is None
    assert no_y0["method"]["persistence"].startswith("skipped")


def test_logistic_fit_recovers_its_slope():
    rng = np.random.default_rng(3)
    x = rng.normal(size=20000)
    y = (rng.random(20000) < 1 / (1 + np.exp(-(0.3 + 1.2 * x)))).astype(float)
    b = O._logit_fit(x, y)
    assert b[0] == pytest.approx(0.3, abs=0.06) and b[1] == pytest.approx(1.2, abs=0.08)


def test_area_rows_move_the_old_score_to_bss_clim():
    cv = _fake_cv(areas=3)
    now = pd.DataFrame({"kind": "state", "id": ["A0", "A1"], "lead": 1, "issue_yr": 2026, "issue_mo": 10, "target_yr": 2026,
                        "target_mo": 11, "p": [0.7, 0.2], "p_clim": 0.5, "bss": [0.4, 0.3], "n_tested": 70})
    out = O.fair_outlook_rows(now, cv)
    assert list(out.bss_clim) == pytest.approx([0.4, 0.3])
    want = O.area_skill(cv).set_index(["id", "lead"]).bss
    assert out.bss.to_numpy() == pytest.approx([want[("A0", 1)], want[("A1", 1)]], abs=1e-6)
    gate = O.list_gate(out)
    assert gate["areas_issued"] == 2 and gate["pass_old_reference"] == 2


def test_published_summary_has_the_fair_score():
    s = json.loads((C.REPO / "models" / "outlook.json").read_text())
    assert "score" in s, "the old score must stay"
    f = s["score_fair"]["lead 1"]["fixed_50"]
    assert 0.14 <= f["bss"] <= 0.16
    assert f["ci95"][0] < f["bss"] < f["ci95"][1]
    assert s["score_fair"]["lead 3"]["fixed_50"]["bss"] < f["bss"]
