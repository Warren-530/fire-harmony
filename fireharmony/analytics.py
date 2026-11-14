"""Step 8: the statistics behind the burning calendar, for any area's monthly series.

Input everywhere: a DataFrame with columns yr, mo, value (harmonized hotspots of one area per month).

  * climatology   the normal season: median and middle 50% of each calendar month over the base years
  * anomalies     this month against normal: ratio to the median, percentile rank, robust z score
  * critical      CONAE's "critical periods": months above the 75th percentile of all months, and the
                  calendar months where that happens in at least half of the years
  * season        start, peak and end of each fire year (10%, 50% and 90% of the year's fire), with the
                  fire year starting after the quietest month, so seasons that cross New Year stay whole
  * trend         Mann-Kendall test (corrected for autocorrelation) and Sen's slope, in % per decade
All functions are plain pandas, so the same rules can be written in SQL for the browser app.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

BASE_YEARS = (2001, 2025)          # full years of the harmonized record used as "normal"


def _base(df: pd.DataFrame, base=BASE_YEARS) -> pd.DataFrame:
    return df[df.yr.between(*base)]


def climatology(df: pd.DataFrame, base=BASE_YEARS) -> pd.DataFrame:
    b = _base(df, base)
    g = b.groupby("mo")["value"]
    out = pd.DataFrame({"median": g.median(), "q25": g.quantile(0.25), "q75": g.quantile(0.75),
                        "mean": g.mean(), "years": g.size()})
    mad = b.groupby("mo")["value"].apply(lambda v: np.median(np.abs(v - np.median(v))))
    out["mad"] = mad
    return out.reindex(range(1, 13))


def anomalies(df: pd.DataFrame, base=BASE_YEARS) -> pd.DataFrame:
    """Each month against the same calendar month in the base years."""
    clim = climatology(df, base)
    b = _base(df, base)
    out = df.copy()
    med = out.mo.map(clim["median"])
    out["ratio_to_normal"] = out.value / med.where(med > 0)
    out["robust_z"] = (out.value - med) / (1.4826 * out.mo.map(clim["mad"])).where(lambda s: s > 0)
    base_vals = {m: np.sort(g.to_numpy()) for m, g in b.groupby("mo")["value"]}
    out["percentile"] = [np.nan if np.isnan(v) else
                         100 * np.searchsorted(base_vals.get(m, np.array([])), v, side="right") / max(len(base_vals.get(m, [])), 1)
                         for m, v in zip(out.mo, out.value)]
    out["rank_in_month"] = out.groupby("mo")["value"].rank(ascending=False, method="min").astype("Int64")
    return out


def critical(df: pd.DataFrame, base=BASE_YEARS, q: float = 0.75, share: float = 0.5) -> dict:
    """Months above the q quantile of all base months, and the calendar months that are critical in at
    least `share` of the base years (the usual critical period)."""
    b = _base(df, base)
    thr = float(b.value.quantile(q))
    flag = df.assign(critical=df.value > thr)
    freq = _base(flag, base).groupby("mo")["critical"].mean().reindex(range(1, 13), fill_value=0)
    return {"threshold": thr, "months": flag, "share_of_years_critical": freq,
            "critical_period": [int(m) for m in freq.index[freq >= share]]}


def fire_year_start(df: pd.DataFrame, base=BASE_YEARS) -> int:
    """The calendar month after the quietest month of the normal season."""
    med = climatology(df, base)["median"].fillna(0)
    return int(med.idxmin() % 12 + 1)


def season(df: pd.DataFrame, base=BASE_YEARS) -> pd.DataFrame:
    """Start, peak and end of each fire year, as months counted from the fire year start (fractional)."""
    start = fire_year_start(df, base)
    d = df.copy()
    d["fy"] = d.yr - (d.mo < start).astype(int) if start > 1 else d.yr
    d["k"] = (d.mo - start) % 12                              # 0..11 inside the fire year
    rows = []
    for fy, g in d.groupby("fy"):
        if g.k.nunique() < 12 or g.value.isna().any() or g.value.sum() <= 0:
            continue                                           # only complete, fully known fire years
        g = g.sort_values("k")
        c = g.value.cumsum().to_numpy() / g.value.sum()
        k = g.k.to_numpy()
        at = lambda p: float(np.interp(p, np.r_[0, c], np.r_[k[0], k + 1]))   # month position where share p is reached
        rows.append({"fire_year": int(fy), "start": at(0.1), "peak_month": int(g.loc[g.value.idxmax(), "mo"]),
                     "middle": at(0.5), "end": at(0.9), "total": float(g.value.sum())})
    out = pd.DataFrame(rows)
    out.attrs["fire_year_starts_in_month"] = start
    return out


def trend(df: pd.DataFrame, years=BASE_YEARS) -> dict:
    """Trend of yearly totals: Mann-Kendall with the Hamed and Rao correction for autocorrelation (falling back to
    the original test when the correction gives an impossible variance), and Sen's slope.

    pct_per_decade is the relative change per decade from Sen's slope of log(1 + yearly total), so it can never be
    below -100%. sen_slope_per_year stays in hotspots per year. Years with an unknown month are left out."""
    import pymannkendall as mk
    d = df[df.yr.between(*years)]
    known = d.groupby("yr")["value"].apply(lambda v: v.notna().all() and len(v) == 12)
    y = d[d.yr.isin(known.index[known])].groupby("yr")["value"].sum()
    if len(y) < 8 or y.sum() == 0:
        return {"years": len(y), "trend": "not enough data"}
    r, method = mk.hamed_rao_modification_test(y.to_numpy()), "hamed_rao"
    if not np.isfinite(r.p) or not r.var_s > 0:
        r, method = mk.original_test(y.to_numpy()), "original"
    log_slope = mk.sens_slope(np.log1p(y.to_numpy())).slope
    return {"years": len(y), "trend": r.trend, "p": float(r.p), "method": method,
            "sen_slope_per_year": float(r.slope), "pct_per_decade": float(100 * (np.exp(10 * log_slope) - 1))}


def fdr(pvals, alpha: float = 0.05) -> np.ndarray:
    """Benjamini Hochberg: which of many tests (for example one per region) stay significant."""
    p = np.asarray(pvals, float)
    n = len(p)
    order = np.argsort(p)
    passed = p[order] <= alpha * np.arange(1, n + 1) / n
    k = np.max(np.nonzero(passed)[0]) + 1 if passed.any() else 0
    out = np.zeros(n, bool)
    out[order[:k]] = True
    return out


def area_series(where: str, years=None, con=None) -> pd.DataFrame:
    """Monthly totals of one area from the harmonized record. `where` filters the cell facts, for example
    "iso3 = 'MYS'", "state = 'Riau'" or "lat BETWEEN -5 AND 5 AND lon BETWEEN 100 AND 120".
    Returns yr, mo, value (harmonized) plus the raw series for comparison."""
    from . import config as C
    from . import harmonize as H
    con = con or C.connect()
    years = years or C.years()
    missing = [y for y in years if not H.harmonized_path(y).exists()]
    if missing:
        raise FileNotFoundError(f"harmonized record missing for {missing}: run `fireharmony harmonize`")
    files = [str(H.harmonized_path(y)) for y in years]
    static = C.work("features", "cell_static_l5.parquet")
    df = con.execute(f"""
      SELECT yr, mo, sum(h) AS value, sum(modis_eq) AS modis_scale, sum(v_obs) AS viirs_observed,
             sum(T_n) + sum(A_n) AS modis_raw, sum(S_n) AS snpp_raw, sum(N_n) AS noaa20_raw,
             min(source) AS best_source, max(source) AS worst_source
      FROM read_parquet({files}) JOIN (SELECT cell FROM '{static}' WHERE {where}) USING (cell)
      GROUP BY yr, mo ORDER BY yr, mo""").df()
    # A month with no stored rows had no fire: fill it with zeros (missing months would bias the normal upwards).
    last = con.execute(f"SELECT max(yr * 100 + mo) FROM read_parquet({files})").fetchall()[0][0]
    grid = pd.period_range("2000-11", f"{last // 100}-{last % 100:02d}", freq="M")
    out = pd.DataFrame({"yr": grid.year, "mo": grid.month}).merge(df, on=["yr", "mo"], how="left")
    num = [c for c in out.columns if c not in ("yr", "mo", "best_source", "worst_source")]
    out[num] = out[num].fillna(0)
    # ...but a month that is unknown for the whole world (for example the current month after a few days, when
    # no satellite reached half its days) is unknown here too, even where this area has no stored row at all
    unknown = _unknown_months(tuple(years), con)
    is_unknown = pd.Series(list(zip(out.yr, out.mo))).isin(unknown).to_numpy() | (out.best_source == 3).to_numpy()
    out.loc[is_unknown, ["value", "modis_scale", "viirs_observed"]] = np.nan
    return out


_UNKNOWN: dict = {}


def _unknown_months(years: tuple, con) -> set:
    """Months where no cell of the world has better than 'no data' (cached)."""
    if years not in _UNKNOWN:
        from . import harmonize as H
        files = [str(H.harmonized_path(y)) for y in years if H.harmonized_path(y).exists()]
        rows = con.execute(f"SELECT yr, mo FROM read_parquet({files}) GROUP BY yr, mo HAVING min(source) = 3").fetchall()
        _UNKNOWN[years] = {(int(a), int(b)) for a, b in rows}
    return _UNKNOWN[years]


# ------------------------------------------------------------------------------------------ trend uncertainty
def sen_ci(y, alpha: float = 0.05, var_s: float | None = None) -> tuple[float, float, float]:
    """Sen's slope of y (per step) and its 1 - alpha interval by the rank method of Gilbert (1987): with the Mann
    Kendall variance var(S) (the plain one, with ties, unless given), C = z * sqrt(var S), and the interval runs from
    the (N - C) / 2 th to the (N + C) / 2 + 1 th of the N ordered pairwise slopes (interpolated)."""
    from scipy.stats import norm
    y = np.asarray(y, float)
    n = len(y)
    i, j = np.triu_indices(n, 1)
    d = np.sort((y[j] - y[i]) / (j - i))
    if var_s is None:
        _, cnt = np.unique(y, return_counts=True)
        var_s = (n * (n - 1) * (2 * n + 5) - np.sum(cnt * (cnt - 1) * (2 * cnt + 5))) / 18
    c = norm.ppf(1 - alpha / 2) * np.sqrt(var_s)
    N = len(d)
    ranks = np.arange(1, N + 1)
    lo = float(np.interp((N - c) / 2, ranks, d))
    hi = float(np.interp((N + c) / 2 + 1, ranks, d))
    return float(np.median(d)), lo, hi


def trend_ci(df: pd.DataFrame, years=BASE_YEARS, alpha: float = 0.05) -> dict:
    """analytics.trend with a 95% interval of its % per decade (Sen's slope of log(1 + yearly total)): the interval with
    the plain Mann Kendall variance, and a wider one with the variance the Hamed and Rao correction gives (when the
    correction applies, as in the test itself)."""
    import pymannkendall as mk
    t = trend(df, years)
    if "p" not in t:
        return t
    d = df[df.yr.between(*years)]
    known = d.groupby("yr")["value"].apply(lambda v: v.notna().all() and len(v) == 12)
    y = d[d.yr.isin(known.index[known])].groupby("yr")["value"].sum().to_numpy()
    ly = np.log1p(y)
    pct = lambda s: float(100 * (np.exp(10 * s) - 1))
    s, lo, hi = sen_ci(ly, alpha)
    out = {**t, "ci95": [pct(lo), pct(hi)]}
    hr = mk.hamed_rao_modification_test(y)
    if np.isfinite(hr.p) and hr.var_s > 0:
        # log(1 + y) has the ranks of y, so the corrected variance of the test on y applies as it is
        _, lo2, hi2 = sen_ci(ly, alpha, var_s=hr.var_s)
        out["ci95_hamed_rao"] = [pct(lo2), pct(hi2)]
    else:
        out["ci95_hamed_rao"] = out["ci95"]
    return out


def _ties_term(Y: np.ndarray) -> np.ndarray:
    """Per row, sum over groups of tied values of t (t - 1) (2t + 5): each element counts f(t) / t for its group of t."""
    c = (Y[:, :, None] == Y[:, None, :]).sum(-1).astype(float)
    return (((c - 1) * (2 * c + 5))).sum(1)


def mk_matrix(Y: np.ndarray, hamed_rao: bool = False, alpha: float = 0.05) -> dict:
    """Mann Kendall on every row of Y (rows: series, columns: years in order), vectorized, as pymannkendall computes it:
    S, var(S) with ties, z with the continuity correction, two sided p. hamed_rao: the variance corrected for the
    autocorrelation of the ranks of the series detrended by Sen's slope (Hamed and Rao 1998, all lags, only those
    outside the 95% band); where the correction gives a variance that is not positive, the plain test is used (as
    analytics.trend does)."""
    from scipy.stats import norm
    Y = np.asarray(Y, float)
    m, n = Y.shape
    i, j = np.triu_indices(n, 1)
    s = np.sign(Y[:, j] - Y[:, i]).sum(1)
    var = (n * (n - 1) * (2 * n + 5) - _ties_term(Y)) / 18
    if hamed_rao:
        slope = np.median((Y[:, j] - Y[:, i]) / (j - i), axis=1)
        X = Y - np.arange(1, n + 1)[None, :] * slope[:, None]
        less = (X[:, None, :] < X[:, :, None]).sum(-1)
        eq = (X[:, None, :] == X[:, :, None]).sum(-1)
        R = less + (eq + 1) / 2.0                      # average ranks, as scipy.stats.rankdata
        R = R - R.mean(1, keepdims=True)
        acov0 = (R * R).sum(1) / n
        band = norm.ppf(1 - alpha / 2) / np.sqrt(n)
        sni = np.zeros(m)
        for k in range(1, n):
            acf = (R[:, :-k] * R[:, k:]).sum(1) / n / np.where(acov0 > 0, acov0, np.nan)
            out = (acf > band) | (acf < -band)
            sni += np.where(out, (n - k) * (n - k - 1) * (n - k - 2) * acf, 0.0)
        n_ns = 1 + 2 / (n * (n - 1) * (n - 2)) * sni
        var_hr = var * n_ns
        var = np.where(np.isfinite(var_hr) & (var_hr > 0), var_hr, var)
    z = np.where(s > 0, (s - 1) / np.sqrt(var), np.where(s < 0, (s + 1) / np.sqrt(var), 0.0))
    p = 2 * (1 - norm.cdf(np.abs(z)))
    return {"s": s, "var_s": var, "z": z, "p": p}


def sen_matrix(Y: np.ndarray) -> np.ndarray:
    """Sen's slope (median of the pairwise slopes) of every row of Y."""
    Y = np.asarray(Y, float)
    i, j = np.triu_indices(Y.shape[1], 1)
    return np.median((Y[:, j] - Y[:, i]) / (j - i), axis=1)
