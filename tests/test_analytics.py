"""Unit tests of the burning calendar statistics on synthetic series with known answers."""
import numpy as np
import pandas as pd

from fireharmony import analytics as A


def series(peak_month, years=range(2001, 2026), growth=0.0, width=1.5, seed=0):
    rng = np.random.default_rng(seed)
    rows = []
    for i, y in enumerate(years):
        for m in range(1, 13):
            d = min(abs(m - peak_month), 12 - abs(m - peak_month))          # circular distance in months
            v = 1000 * np.exp(-0.5 * (d / width) ** 2) * (1 + growth) ** i + 5
            rows.append({"yr": y, "mo": m, "value": rng.poisson(v)})
    return pd.DataFrame(rows)


def test_climatology_and_anomaly_find_a_spike():
    df = series(8)
    df.loc[(df.yr == 2019) & (df.mo == 8), "value"] *= 3
    a = A.anomalies(df)
    spike = a[(a.yr == 2019) & (a.mo == 8)].iloc[0]
    assert A.climatology(df)["median"].idxmax() == 8
    assert 2.7 < spike.ratio_to_normal < 3.3 and spike.percentile == 100 and spike.rank_in_month == 1


def test_critical_period_is_the_peak_season():
    assert A.critical(series(8))["critical_period"] == [7, 8, 9]


def test_season_crossing_new_year_stays_whole():
    s = A.season(series(1))                       # Sahel style: peak in January
    assert s.attrs["fire_year_starts_in_month"] in (6, 7, 8)
    assert (s.peak_month == 1).mean() > 0.9
    assert ((s.end - s.start) < 6).all()          # one compact season, not split in two


def test_trend_detects_growth():
    up = A.trend(series(8, growth=0.03))
    flat = A.trend(series(8, growth=0.0, seed=3))
    assert up["trend"] == "increasing" and 25 < up["pct_per_decade"] < 45
    assert flat["trend"] == "no trend"


def test_fdr_keeps_only_strong_results():
    keep = A.fdr([0.001, 0.01, 0.02, 0.4, 0.8])
    assert keep.tolist() == [True, True, True, False, False]
