"""Step 7: validation of the harmonized record (the seam tests).

There is no ground truth for the number of fires, but there is a consistent witness: MODIS flew the
whole time with the same instrument and algorithm. So across a seam, the harmonized record must change
by the same factor as MODIS alone. A naive record (MODIS before 2012, VIIRS after) jumps about four times.

  * seam_ratio:  mean of the window after the seam / mean of the window before, for any series
  * pettitt:     the classic distribution free change point test (Pettitt 1979)
  * pelt_breaks: change points of a de-seasonalized monthly series (PELT, ruptures)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config as C
from . import harmonize as H


def monthly_series(years=None, by: str | None = None, con=None) -> pd.DataFrame:
    """World (or per `by` column of cell facts) monthly totals of every series we compare."""
    con = con or C.connect()
    years = years or C.years()
    missing = [y for y in years if not H.harmonized_path(y).exists()]
    if missing:
        raise FileNotFoundError(f"harmonized record missing for {missing}: run `fireharmony harmonize`")
    files = [str(H.harmonized_path(y)) for y in years]
    grp = "yr, mo" if by is None else f"{by}, yr, mo"
    join = "" if by is None else f"JOIN '{C.work('features', 'cell_static_l5.parquet')}' USING (cell)"
    fleet = C.work("gold", "fleet_month.parquet")
    return con.execute(f"""
      WITH cov AS (SELECT yr, mo, least(1.0, sum(days_with_data) / day(last_day(make_date(yr::INT, mo::INT, 1)))) AS cov_t
                   FROM '{fleet}' WHERE satellite = 'Terra' GROUP BY yr, mo)
      SELECT {grp},
             sum(h)                                  AS harmonized,
             sum(modis_eq)                           AS modis_scale,
             sum(v_obs)                              AS viirs_observed,
             sum(pred_ta)                            AS model_terra_aqua,
             sum(pred_t)                             AS model_terra_only,
             -- naive: MODIS before 2012, VIIRS after (Jan 2012, when VIIRS covered only 39% of days, uses h)
             sum(CASE WHEN yr < 2012 THEN modis_eq ELSE coalesce(v_obs, h) END) AS naive_join,
             sum(T_n)                                AS terra_raw,
             -- the witness for 2002, corrected for days without data like the record is (Terra lost half of June 2001)
             sum(T_n) / any_value(cov.cov_t)         AS terra_cc
      FROM read_parquet({files}) {join} LEFT JOIN cov USING (yr, mo) GROUP BY ALL ORDER BY ALL""").df()


def seam_ratio(s: pd.Series, t: pd.Series, seam: str, years: int = 3) -> float:
    """Mean over `years` years after the seam divided by the mean over `years` years before it."""
    t = pd.to_datetime(t)
    seam = pd.Timestamp(seam)
    before = s[(t >= seam - pd.DateOffset(years=years)) & (t < seam)]
    after = s[(t >= seam) & (t < seam + pd.DateOffset(years=years))]
    return float(after.mean() / before.mean())


def per_witness(df: pd.DataFrame, col: str, witness: str, seam: str, before_from: str, years_after: int = 1) -> dict:
    """Hotspots of `col` per witness hotspot before and after a seam. Real changes in fire cancel out, because the
    witness sees them too, so any step left is a step of the record itself."""
    t = pd.to_datetime(dict(year=df.yr, month=df.mo, day=1))
    seam_t = pd.Timestamp(seam)
    b = df[(t >= pd.Timestamp(before_from)) & (t < seam_t)]
    a = df[(t >= seam_t) & (t < seam_t + pd.DateOffset(years=years_after))]
    rb, ra = b[col].sum() / b[witness].sum(), a[col].sum() / a[witness].sum()
    return {"before": float(rb), "after": float(ra), "step_pct": float(100 * (ra / rb - 1))}


def pettitt(x) -> dict:
    """Pettitt (1979) test for one change in the median. Returns the change index and an approximate p value."""
    x = np.asarray(x, float)
    n = len(x)
    sgn = np.sign(x[:, None] - x[None, :])
    u = np.array([sgn[: t + 1, t + 1:].sum() for t in range(n - 1)])
    k = np.abs(u).max()
    return {"index": int(np.abs(u).argmax()) + 1, "K": float(k), "p": float(min(1.0, 2 * np.exp(-6 * k ** 2 / (n ** 3 + n ** 2))))}


def deseasonalize(s: pd.Series, mo: pd.Series) -> pd.Series:
    """Log anomaly against the median of each calendar month."""
    ls = np.log(s.clip(lower=1))
    return ls - ls.groupby(mo.to_numpy()).transform("median")


def pelt_breaks(x, min_size: int = 6) -> list[int]:
    """Change points in the mean (PELT, l2 cost) with a BIC style penalty 2 log(n) sigma^2. Sigma comes from
    the median absolute month to month difference, so a single big jump cannot inflate it."""
    import ruptures as rpt
    x = np.asarray(x, float)
    sigma = np.median(np.abs(np.diff(x))) / (0.6745 * np.sqrt(2))
    pen = 2 * np.log(len(x)) * sigma ** 2
    return rpt.Pelt(model="l2", min_size=min_size).fit(x.reshape(-1, 1)).predict(pen=pen)[:-1]


def seam_report(df: pd.DataFrame) -> pd.DataFrame:
    """Seam ratios at 2002-07 (Aqua joins) and 2012-01 (VIIRS starts) for every series in `df`.
    The witnesses are the satellites that flew on both sides with the same instrument: Terra alone for
    2002 and MODIS for 2012. A good record changes across each seam by the same factor as its witness."""
    t = pd.to_datetime(dict(year=df.yr, month=df.mo, day=1))
    rows = []
    for col in ("terra_cc", "terra_raw", "modis_scale", "harmonized", "naive_join", "model_terra_aqua", "model_terra_only"):
        if col in df and df[col].notna().any():
            rows.append({"series": col, "seam_2002_07": seam_ratio(df[col], t, "2002-07-01", 1),
                         "seam_2012_01": seam_ratio(df[col], t, "2012-01-01", 3)})
    return pd.DataFrame(rows)


# ------------------------------------------------------------------------------------------ figures
def seam_figure(world: pd.DataFrame, intervals: dict, path_stem, last_full_year: int = 2025):
    """Report figure: the naive join jumps at 2012, the harmonized record does not (world, per year)."""
    import sys
    import matplotlib.pyplot as plt
    sys.path.insert(0, str(C.REPO / "style"))
    import fireharmony_style as fh
    fh.use()
    y = world[world.yr.between(2001, last_full_year)].groupby("yr").sum(numeric_only=True)   # full years only
    yrs = y.index.to_numpy()
    # 90% band for the modelled years, from the calibrated annual area interval
    band_lo, band_hi = y.harmonized.copy(), y.harmonized.copy()
    for yr in yrs:
        if yr < 2012:
            ai = H.AreaInterval.from_dict(intervals["terra_only_year" if yr < 2003 else "terra_aqua_year"])
            lo, hi = ai.bounds(y.harmonized[yr])
            band_lo[yr], band_hi[yr] = lo[0], hi[0]
    fig, axes = plt.subplots(1, 2, figsize=fh.SIZE["full"], sharey=True)
    M = 1e6
    ax = axes[0]
    pre, post = y.index < 2012, y.index >= 2012
    # naive_join after 2011 is VIIRS with January 2012 (VIIRS on only 39% of its days) filled, so 2012 is a full year
    ax.plot(yrs[pre], y.modis_scale[pre] / M, color=fh.SENSOR["MODIS"], lw=2)
    ax.plot(yrs[post], y.naive_join[post] / M, color=fh.SENSOR["VIIRS_SNPP"], lw=2)
    ax.plot([2011, 2012], [y.modis_scale[2011] / M, y.naive_join[2012] / M], color=fh.MUTED, lw=1)
    fh.direct_label(ax, 2011, y.modis_scale[2011] / M, "MODIS", dy=-8)
    fh.direct_label(ax, yrs[-1], y.naive_join.iloc[-1] / M, "VIIRS")
    jump = y.naive_join[2012] / y.modis_scale[2011]
    fh.title(ax, f"Joined naively: a fake {jump:.1f}x jump", "Sensor switch in 2012, world, hotspots per year")
    ax = axes[1]
    ax.fill_between(yrs, band_lo / M, band_hi / M, color=fh.HARMONIZED_BAND, alpha=0.12, lw=0)
    ax.plot(yrs, y.modis_scale / M, color=fh.SENSOR["MODIS"], lw=1.2)
    ax.plot(yrs, y.harmonized / M, color=fh.HARMONIZED, lw=2.6)
    fh.direct_label(ax, yrs[-1], y.harmonized.iloc[-1] / M, "Harmonized")
    fh.direct_label(ax, yrs[-1], y.modis_scale.iloc[-1] / M, "MODIS")
    fh.title(ax, "Harmonized: one consistent record", "NOAA-20 VIIRS scale, 90% range where modelled")
    for ax in axes:
        fh.clean(ax)
        ax.set_xlim(yrs[0] - 0.5, yrs[-1] + 4)
        ax.set_ylim(0, None)
    axes[0].set_ylabel("Million hotspots per year")
    fh.source(fig, "Source: NASA FIRMS (MODIS C6.1, VIIRS 375 m), vegetation fires; analysis: Fire Harmony")
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fh.save(fig, str(path_stem))
    plt.close(fig)
    return {"naive_jump_2011_to_2012": float(jump)}


# ------------------------------------------------------------------------------------------ seams by region, and power
SEAM_UNITS_TOP = 12                       # the countries with the most fire (mean hotspots a year, 2001 to 2025)
SEAM_EXTRA = ("ARG", "KAZ")               # countries the review asked about, added when they are not in the top 12
SEAM_CONTINENTS = ("Africa", "Asia", "Europe", "North America", "Oceania", "South America")
PLACEBO_PRE = range(2004, 2012)           # January placebo dates before the switch (as the world test)
PLACEBO_POST = range(2014, 2021)          # and after it, where the record (VIIRS) and MODIS are both observed
PLACEBO_PRE_3Y = range(2006, 2010)        # 3 year windows inside 2003 to 2011
PLACEBO_POST_3Y = range(2016, 2019)       # 3 year windows inside 2013 to 2020
PLACEBO_2002 = range(2003, 2011)          # July placebo dates for the 2002 test (as the world test)


def _placebo(df: pd.DataFrame, col: str, wit: str, month: int, years, n: int) -> dict:
    steps = {int(y): per_witness(df, col, wit, f"{y}-{month:02d}-01", f"{y - n}-{month:02d}-01", n)["step_pct"] for y in years}
    v = np.array([s for s in steps.values() if np.isfinite(s)])
    return {"steps": {y: round(s, 3) for y, s in steps.items()}, "mean": round(float(v.mean()), 3) if len(v) else None,
            "sd": round(float(v.std(ddof=1)), 3) if len(v) > 1 else None}


def _z(real: float, plc: dict) -> float | None:
    return round(float((real - plc["mean"]) / plc["sd"]), 2) if plc["sd"] else None


def seam_unit(df: pd.DataFrame) -> dict:
    """The seam tests of one area. df: yr, mo, h (the record), modis (MODIS only), terra_cc (Terra, corrected for its
    days without data), one row per month (months without a row are no fire). The 2012 step: the 12 (or 36) months
    after January 2012 against the 12 (36) before, record per MODIS hotspot; the 2002 step: July 2002, per Terra
    hotspot. Each with placebo dates without a sensor change, its z against the placebo dates before the switch, and
    the smallest step those placebos would let us see (2 placebo SDs)."""
    d = df.sort_values(["yr", "mo"]).reset_index(drop=True)
    s1 = per_witness(d, "h", "modis", "2012-01-01", "2011-01-01", 1)["step_pct"]
    s3 = per_witness(d, "h", "modis", "2012-01-01", "2009-01-01", 3)["step_pct"]
    pre, post = _placebo(d, "h", "modis", 1, PLACEBO_PRE, 1), _placebo(d, "h", "modis", 1, PLACEBO_POST, 1)
    pre3, post3 = _placebo(d, "h", "modis", 1, PLACEBO_PRE_3Y, 3), _placebo(d, "h", "modis", 1, PLACEBO_POST_3Y, 3)
    both = np.array([v for v in list(pre["steps"].values()) + list(post["steps"].values()) if np.isfinite(v)])
    both3 = np.array([v for v in list(pre3["steps"].values()) + list(post3["steps"].values()) if np.isfinite(v)])
    out = {"2012_modis_witness": {
        "step_1y": round(s1, 3), "placebo_pre": pre, "z": _z(s1, pre), "placebo_post": post,
        "z_all_placebos": round(float((s1 - both.mean()) / both.std(ddof=1)), 2) if len(both) > 2 else None,
        "detectable_1y": round(2 * pre["sd"], 2) if pre["sd"] else None,
        "step_3y": round(s3, 3), "placebo_pre_3y": pre3, "placebo_post_3y": post3, "z_3y": _z(s3, pre3),
        "z_3y_all_placebos": round(float((s3 - both3.mean()) / both3.std(ddof=1)), 2) if len(both3) > 2 else None}}
    if "terra_cc" in d and d.terra_cc.notna().any():
        s02 = per_witness(d, "h", "terra_cc", "2002-07-01", "2001-07-01", 1)["step_pct"]
        p02 = _placebo(d, "h", "terra_cc", 7, PLACEBO_2002, 1)
        out["2002_terra_witness"] = {"step_1y": round(s02, 3), "placebo": p02, "z": _z(s02, p02),
                                     "detectable_1y": round(2 * p02["sd"], 2) if p02["sd"] else None}
    return out


def regional_seams(area_monthly: pd.DataFrame, terra_cov: pd.DataFrame | None = None, names: dict | None = None,
                   top: int = SEAM_UNITS_TOP, extra=SEAM_EXTRA) -> dict:
    """The seam tests for the world, the six continents and the countries with the most fire. The world's small step
    at 2012 is a sum of regional steps that partly cancel, so each region is tested against its own witnesses.
    area_monthly: products/v1.0/area_monthly.parquet (kind, id, yr, mo, h, modis, t); terra_cov: yr, mo, cov (the share
    of days Terra had data, from world_monthly: terra_raw / terra_cc), so Terra's witness is corrected as the world's
    is; names: (kind, id) -> name."""
    am = area_monthly[["kind", "id", "yr", "mo", "h", "modis", "t"]].copy()
    am["yr"], am["mo"] = am.yr.astype(int), am.mo.astype(int)
    if terra_cov is not None:
        am = am.merge(terra_cov[["yr", "mo", "cov"]], on=["yr", "mo"], how="left")
        am["terra_cc"] = am.t / am["cov"].where(am["cov"] > 0)
    else:
        am["terra_cc"] = am.t.astype(float)
    a, b = 2001, 2025
    c = am[(am.kind == "country") & am.yr.between(a, b)].groupby("id").h.sum() / (b - a + 1)
    top_ids = list(c.sort_values(ascending=False).index[:top])
    units = [("world", "WORLD")] + [("continent", x) for x in SEAM_CONTINENTS] + [("country", x) for x in top_ids]
    units += [("country", x) for x in extra if x not in top_ids and x in c.index]
    names = names or {}
    rows = []
    for kind, id_ in units:
        d = am[(am.kind == kind) & (am.id == id_)]
        if d.empty:
            continue
        mean = float(d[d.yr.between(a, b)].h.sum() / (b - a + 1))
        rows.append({"kind": kind, "id": id_, "name": names.get((kind, id_), "World" if kind == "world" else id_),
                     "mean_per_year": round(mean, 0), "in_top": id_ in top_ids, **seam_unit(d)})
    return {"method": {"step": "record hotspots per witness hotspot, 12 (or 36) months after the seam against the same before",
                       "witness_2012": "MODIS only (Terra and Aqua)", "witness_2002": "Terra, corrected for its days without data",
                       "placebo_2012_pre": [PLACEBO_PRE.start, PLACEBO_PRE.stop - 1], "placebo_2012_post": [PLACEBO_POST.start, PLACEBO_POST.stop - 1],
                       "placebo_2012_pre_3y": [PLACEBO_PRE_3Y.start, PLACEBO_PRE_3Y.stop - 1],
                       "placebo_2012_post_3y": [PLACEBO_POST_3Y.start, PLACEBO_POST_3Y.stop - 1],
                       "placebo_2002": [PLACEBO_2002.start, PLACEBO_2002.stop - 1],
                       "z": "(step - placebo mean) / placebo SD, placebo dates before the switch",
                       "z_3y_note": ("the 3 year placebos rest on 4 dates before the switch and 3 after, so their SD is "
                                     "poorly known: read z_3y_all_placebos (both sets) and the 1 year test first"),
                       "detectable": "2 placebo SDs: the smallest step these tests would show",
                       "top_countries_by": f"mean hotspots a year {a} to {b}, top {top}, plus {', '.join(extra)}"},
            "units": rows}


def power(val: dict) -> dict:
    """The smallest step each world test can see: 2 SDs of its placebo steps (validation.json)."""
    plc, bw = val["placebo_seams"], val.get("burned_area_witness", {})
    out = {"rule": "smallest detectable step = 2 placebo SDs (about a 95% two sided band of steps without a sensor change)",
           "2012_modis_witness": {"placebo_sd": round(plc["2012_modis_witness"]["sd"], 3), "detectable_pct": round(2 * plc["2012_modis_witness"]["sd"], 2),
                                  "step_pct": round(plc["2012_modis_witness"]["real_step"], 2)},
           "2002_terra_witness": {"placebo_sd": round(plc["2002_terra_witness"]["sd"], 3), "detectable_pct": round(2 * plc["2002_terra_witness"]["sd"], 2),
                                  "step_pct": round(plc["2002_terra_witness"]["real_step"], 2)}}
    if bw:
        out["2012_burned_area_witness"] = {"placebo_sd": round(bw["1y"]["placebo_sd"], 3), "detectable_pct": round(2 * bw["1y"]["placebo_sd"], 2),
                                           "step_pct": round(bw["1y"]["step_pct"]["harmonized"], 2)}
    return out


def seam_checks(write: bool = True, log=print) -> dict:
    """regional_seams and power, added to models/validation.json (read only inputs: area_monthly.parquet, areas.json,
    world_monthly.parquet; no other key changes)."""
    import json
    from . import eda as E
    from . import publish as PB
    am = pd.read_parquet(PB.products("area_monthly.parquet"), columns=["kind", "id", "yr", "mo", "h", "modis", "t"])
    wm = pd.read_parquet(C.work("models", "world_monthly.parquet"), columns=["yr", "mo", "terra_raw", "terra_cc"])
    cov = wm.assign(cov=wm.terra_raw / wm.terra_cc)[["yr", "mo", "cov"]].dropna()
    areas = json.loads(PB.products("areas.json").read_text())
    names = {(a["kind"], a["id"]): E.english_name(a["id"], a["name"]) for a in areas}
    names.update({("continent", c): c for c in SEAM_CONTINENTS})
    p = C.REPO / "models" / "validation.json"
    val = json.loads(p.read_text())
    res = {"regional_seams": regional_seams(am, cov, names), "power": power(val)}
    if write:
        val.update(res)
        p.write_text(json.dumps(val, indent=1, default=float))
    for r in res["regional_seams"]["units"]:
        s = r["2012_modis_witness"]
        log(f"{r['name']:<20} 2012 {s['step_1y']:+6.2f}% (placebo sd {s['placebo_pre']['sd']:.2f}, z {s['z']})")
    return res
