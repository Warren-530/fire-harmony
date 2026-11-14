"""The statistics of the exploratory analysis and the trend checks (fireharmony/eda.py), on cases with known answers,
and the published web/eda.json against the files it was built from."""
import json

import numpy as np
import pandas as pd
import pytest

from fireharmony import analytics as A
from fireharmony import config as C
from fireharmony import eda as E
from fireharmony import publish as PB


def test_bh_matches_the_textbook_example_and_analytics_fdr():
    # Benjamini and Hochberg (1995): 15 p values, 4 discoveries at q = 0.05
    p = np.array([0.0001, 0.0004, 0.0019, 0.0095, 0.0201, 0.0278, 0.0298, 0.0344, 0.0459, 0.3240, 0.4262, 0.5719,
                  0.6528, 0.7590, 1.0])
    q = E.bh_adjust(p)
    assert (q <= 0.05).sum() == 4
    assert np.all(np.diff(q[np.argsort(p)]) >= -1e-12) and q.max() <= 1
    rng = np.random.default_rng(1)
    for _ in range(20):
        r = np.concatenate([rng.uniform(size=200), rng.uniform(0, 0.01, size=30)])
        rng.shuffle(r)
        for level in (0.05, 0.10):
            assert ((E.bh_adjust(r) <= level) == A.fdr(r, level)).all()
    assert (E.by_adjust(r) >= E.bh_adjust(r)).all()


def test_histogram_quantiles_recover_a_lognormal():
    rng = np.random.default_rng(2)
    x = rng.lognormal(mean=np.log(8), sigma=1.0, size=400_000)
    fb = np.floor(np.log10(x) / E.FB).astype(int)
    h = pd.Series(1, index=fb).groupby(level=0).sum()
    got = E.hist_quantiles(h, [0.1, 0.5, 0.9])
    for q, v in got.items():
        assert abs(v / np.quantile(x, q) - 1) < 0.02          # bins are 4.7% wide


def test_median_time_handles_night_across_midnight():
    # night hotspots at 23:50 and 00:50 local time, equally many: the median is near 00:20, not noon
    d = pd.DataFrame({"tb": [143, 5], "n": [100, 100]})
    t = E._median_time(d, night=True)
    assert t < 1 or t > 23
    day = pd.DataFrame({"tb": [80, 81, 82], "n": [1, 2, 1]})          # 13:20 to 13:50
    assert 13.4 < E._median_time(day, night=False) < 13.7


def test_morans_i_sees_a_smooth_field_and_not_noise():
    n = 400
    i = np.r_[np.arange(n - 1), np.arange(1, n)]
    j = np.r_[np.arange(1, n), np.arange(n - 1)]                    # a chain: each node touches the next
    smooth = np.sin(np.linspace(0, 6 * np.pi, n))
    mi, p = E.morans_i(smooth, i, j, perms=199)
    assert mi > 0.9 and p < 0.01
    mi, p = E.morans_i(np.random.default_rng(3).normal(size=n), i, j, perms=199)
    assert abs(mi) < 0.15 and p > 0.01


def test_grouping_ids_match_duckdb():
    con = C.connect(extensions=())
    df = pd.DataFrame({k: [1, 2] for k in E.ALL_KEYS})
    con.register("t", df)
    sets = ", ".join("(" + ", ".join(k) + ")" for k in E.GROUPS.values())
    got = sorted(r[0] for r in con.execute(f"SELECT DISTINCT GROUPING({', '.join(E.ALL_KEYS)}) FROM t "
                                           f"GROUP BY GROUPING SETS ({sets})").fetchall())
    assert got == sorted(E._gid(k) for k in E.GROUPS.values())


@pytest.fixture(scope="module")
def eda():
    p = PB.products("web", "eda.json")
    if not p.exists():
        pytest.skip("web/eda.json not built (fireharmony eda)")
    return json.loads(p.read_text())


def test_scan_counts_every_hotspot(eda):
    index = json.loads(PB.products("hotspots", "index.json").read_text())
    assert eda["record"]["hotspots"] == index["rows"]
    for name in E.GROUPS:
        assert int(E.load(name).n.sum()) == index["rows"], name


def test_sensor_cards_are_consistent(eda):
    assert [s["id"] for s in eda["sensors"]] == ["terra", "aqua", "snpp", "noaa20", "noaa21"]
    for s in eda["sensors"]:
        assert abs(s["day_pct"] + s["night_pct"] - 100) < 0.05
        assert abs(sum(s["confidence_pct"].values()) - 100) < 0.05
        assert abs(sum(s["type_pct"].values()) - 100) < 0.05
        q = s["frp_q"]
        assert q["p10"] < q["p25"] < q["p50"] < q["p75"] < q["p90"] < q["p99"]
    by = {s["id"]: s for s in eda["sensors"]}
    assert by["snpp"]["below_10mw_pct"] > 3 * by["aqua"]["below_10mw_pct"]      # VIIRS sees the small fires


def test_fdr_counts_follow_from_the_trend_files(eda):
    floor = eda["fdr"]["floor_per_year"]
    for lvl in (3, 4):
        t = json.loads(PB.products("web", f"trend_l{lvl}.json").read_text())
        p, pct = np.array(t["p"]), np.array(t["pct"])
        f = eda["fdr"][f"l{lvl}_all"]                       # every hexagon, as a map without a floor
        assert f["hexagons"] == len(p)
        sig = A.fdr(p, 0.05)
        assert f["bh_005"]["rising"] == int((sig & (pct > 0)).sum())
        assert f["bh_005"]["falling"] == int((sig & (pct < 0)).sum())
        assert (sig == (p <= f["p_cut_005"])).all()        # BH at q is the same as p <= the largest p that passes
        d = pd.read_parquet(E.out(f"hex_fdr_l{lvl}.parquet"))
        assert d.h3.tolist() == t["h3"]
        k = d[d.mean_h >= floor]                            # the tested hexagons: BH runs over them only
        g = eda["fdr"][f"l{lvl}"]
        assert g["hexagons"] == len(k) == int(d.tested.sum())
        sig = A.fdr(k.p.to_numpy(), 0.05)
        assert g["bh_005"]["rising"] == int((sig & (k.pct.to_numpy() > 0)).sum())
        assert g["bh_005"]["falling"] == int((sig & (k.pct.to_numpy() < 0)).sum())
        assert (sig == (k.p.to_numpy() <= g["p_cut_005"])).all()
        assert g["by_005"]["rising"] <= g["bh_005"]["rising"] <= g["bh_010"]["rising"]
        floors = {r["floor_per_year"]: r for r in eda["fdr"][f"floors_l{lvl}"]}
        assert floors[0]["bh_005"] == f["bh_005"] and floors[floor]["bh_005"] == g["bh_005"]
        shares = [floors[x]["share_of_fire_pct"] for x in sorted(floors)]
        assert shares[0] > 99.9 and all(np.diff(shares) <= 0)


def test_low_fire_hexagons_hold_the_extra_falls(eda):
    f = eda["fdr"]
    cls = f["classes_l3"]
    assert sum(c["hexagons"] for c in cls) == f["l3_all"]["hexagons"]
    assert sum(c["falling"] for c in cls) == f["l3_all"]["bh_005"]["falling"]
    assert sum(c["rising"] for c in cls) == f["l3_all"]["bh_005"]["rising"]
    low, top = cls[0], cls[-1]
    assert low["max_per_year"] == 10 and top["max_per_year"] is None
    assert low["h_per_modis_change_pct"] < -30 < -10 < top["h_per_modis_change_pct"] < 10
    assert low["falling"] > 20 * low["rising"]
    # with the floor the harmonized record agrees with MODIS alone far more often than without it
    m = f["modis_check_l3"]
    assert m["tested"]["harmonized_significant_same_sign_pct"] > m["all"]["harmonized_significant_same_sign_pct"]


def test_exchange_rate_splits_into_day_rate_and_night_factor(eda):
    x = eda["exchange_rate_l3"]
    parts = x["parts"]
    assert parts["identity_max_error"] < 1e-9
    assert parts["hexagons"] == x["hexagons"]                 # the hexagon scan finds the hexagons of the map file
    for q, k in (("q05", "q05"), ("q50", "median"), ("q95", "q95")):
        assert abs(parts["rate"][q] / x[k] - 1) < 0.002
    assert parts["rate_day"]["q75"] - parts["rate_day"]["q25"] < parts["rate"]["q75"] - parts["rate"]["q25"]


def test_eda_json_uses_english_place_names(eda):
    rows = [r for key in ("countries", "states") for side in ("rising", "falling") for r in eda["places"][key][side]]
    rows += eda["sensitivity"]["harmonized_vs_modis"]["rows"] + eda["fdr"]["l3_by_country"]
    names = [r["name"] for r in rows]
    assert not [n for n in names if "Rep." in n or "\u014f" in n or n.endswith("of America")]
    assert E.english_name("ARE-349", "Abu Dhabi, Iran") == "Abu Dhabi, United Arab Emirates"
    assert E.english_name("COD-1898", "Nord-Kivu, Dem. Rep. Congo") == "Nord-Kivu, DR Congo"


def test_ranked_places_pass_the_floor_and_the_fdr(eda):
    for key in ("countries", "states"):
        part = eda["places"][key]
        for side in ("rising", "falling"):
            rows = part[side]
            assert 0 < len(rows) <= 10
            for r in rows:
                assert r["mean_per_year"] >= eda["places"]["floor_per_year"] and r["q"] <= 0.05
                assert (r["pct_per_decade"] > 0) == (side == "rising")
        assert part["bh_005"]["rising"] + part["bh_005"]["falling"] <= part["raw_005"]["rising"] + part["raw_005"]["falling"]


def test_world_trend_matches_places_json(eda):
    places = json.loads(PB.products("web", "places.json").read_text())["rows"]
    world = next(r for r in places if r["kind"] == "world")
    got = eda["sensitivity"]["places"][0]
    assert got["id"] == "WORLD" and got["trends"][0]["years"] == [2001, 2025]
    assert abs(got["trends"][0]["pct_per_decade"] - world["trend_pct_per_decade"]) < 0.06


def test_snpp_fire_unseen_by_modis_is_a_share_of_the_overlap_years(eda):
    s = eda["overlap"]["snpp_where_modis_saw_none"]
    years = [s["by_year"][str(y)] for y in range(s["years"][0], s["years"][1] + 1)]
    assert 0 < min(years) <= s["pct"] <= max(years) < 100           # the share of all years lies among the yearly shares


def test_report_text_carries_the_numbers_of_eda_json():
    summary = E.out("summary.json")
    if not summary.exists():
        pytest.skip("eda/summary.json not built (fireharmony eda)")
    text = (C.REPO / "report" / "report.qmd").read_text()
    text = " ".join(text.split())                       # line breaks in the source do not matter
    missing = [f"{k}: {v}" for k, v in E.text_numbers(json.loads(summary.read_text())) if " ".join(v.split()) not in text]
    assert not missing, missing
