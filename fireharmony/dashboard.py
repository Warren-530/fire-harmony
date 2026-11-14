"""The statistics behind the app's analytics dashboard, in one small file (products/v1.0/dashboard.json).

Everything here is read from outputs that the pipeline has already checked (the published area series, the
validation, the cross validation, the physics check, the drivers, the outlook and the haze link), so the dashboard
shows the same numbers as the notebooks. Run after `fireharmony publish`:  fireharmony dashboard
"""
from __future__ import annotations

import json
import pickle
import time

import numpy as np
import pandas as pd

from . import analytics as A
from . import config as C
from . import publish as PB

MIN_NORMAL_HOT = 200      # an area needs this many hotspots in a normal month to be listed as "most above normal"
TOP_COUNTRIES = 25


def _r(v, n=3):
    return None if v is None or (isinstance(v, float) and not np.isfinite(v)) else round(float(v), n)


def _monthly(am: pd.DataFrame, kind: str, id_: str, last_ym: int) -> pd.DataFrame:
    """One area's months from Nov 2000 to the last month, months with no row are zero, unknown months (src 3) NaN."""
    a = am[(am.kind == kind) & (am.id == id_)]
    t = np.arange(2000 * 12 + 10, (last_ym // 100) * 12 + (last_ym % 100))
    grid = pd.DataFrame({"yr": t // 12, "mo": t % 12 + 1})
    s = grid.merge(a[["yr", "mo", "h", "modis", "src"]], on=["yr", "mo"], how="left")
    s["value"] = s.h.fillna(0.0)
    s.loc[s.src == 3, "value"] = np.nan
    return s


def _unknown(am: pd.DataFrame) -> set:
    w = am[am.kind == "world"]
    return set(zip(w[w.src == 3].yr, w[w.src == 3].mo))


def record_and_world(am, meta, val, wm) -> dict:
    last = int(meta["last_month"])
    unknown = _unknown(am)
    s = _monthly(am, "world", "WORLD", last)
    s.loc[[(y, m) in unknown for y, m in zip(s.yr, s.mo)], "value"] = np.nan
    full = s[s.value.notna()]
    latest_full = full.iloc[-1]
    # yearly totals with the calibrated 90% band of the modelled years
    from .harmonize import AreaInterval
    iv = meta["intervals"]
    y = s.groupby("yr").agg(harmonized=("value", "sum"), months=("value", "count"), modis=("modis", "sum"))
    nj = wm.groupby("yr").naive_join.sum()
    yearly = []
    for yr, r in y.iterrows():
        if yr < 2001:
            continue
        lo = hi = None
        if yr < 2012 and r.months == 12:
            ai = AreaInterval.from_dict(iv["terra_only_year" if yr < 2003 else "terra_aqua_year"])
            a, b = ai.bounds(np.array([r.harmonized]))
            lo, hi = float(a[0]), float(b[0])
        yearly.append({"yr": int(yr), "harmonized": _r(r.harmonized, 0), "lo": _r(lo, 0), "hi": _r(hi, 0),
                       "modis": _r(r.modis, 0), "naive": _r(nj.get(yr), 0), "complete": bool(r.months == 12)})
    tr = A.trend(s.dropna(subset=["value"]))
    an = A.anomalies(s.dropna(subset=["value"]))
    clim = A.climatology(s.dropna(subset=["value"]))
    la = an[(an.yr == latest_full.yr) & (an.mo == latest_full.mo)].iloc[0]
    la_normal = float(clim.loc[int(latest_full.mo), "median"])
    la_years = int(an[an.mo == latest_full.mo].value.notna().sum())
    ytd = s[(s.yr == latest_full.yr) & (s.mo <= latest_full.mo)].value.sum()
    base = s[s.yr.between(*A.BASE_YEARS)]
    ytd_norm = base[base.mo <= latest_full.mo].groupby("yr").value.sum().median()
    fleet = [{"satellite": f["satellite"], "first": int(f["first"]), "last": int(f["last"])} for f in meta["satellites"]]
    return {
        "record": {"first_month": int(meta["first_month"]), "last_month": last,
                   "latest_full_month": int(latest_full.yr * 100 + latest_full.mo),
                   "months": int(len(full)), "hotspots_total": _r(full.value.sum(), 0), "satellites": fleet},
        "world": {"yearly": yearly,
                  "trend": {"pct_per_decade": _r(tr["pct_per_decade"], 2), "p": _r(tr["p"], 6), "direction": tr["trend"]},
                  "latest": {"yr": int(latest_full.yr), "mo": int(latest_full.mo), "h": _r(latest_full.value, 0),
                             "normal": _r(la_normal, 0), "ratio": _r(la.ratio_to_normal, 3),
                             "rank": None if pd.isna(la.rank_in_month) else int(la.rank_in_month), "years": la_years},
                  "ytd": {"yr": int(latest_full.yr), "months": int(latest_full.mo), "total": _r(ytd, 0), "normal": _r(ytd_norm, 0),
                          "ratio": _r(ytd / ytd_norm if ytd_norm else None, 3)},
                  "seasonality": [{"mo": int(m), "median": _r(r["median"], 0), "q25": _r(r.q25, 0), "q75": _r(r.q75, 0)}
                                  for m, r in clim.iterrows()]},
    }


def areas_table(am, areas, meta, kind: str, ids=None, top=None) -> list[dict]:
    last = int(meta["last_month"])
    unknown = _unknown(am)
    names = areas.set_index(["kind", "id"]).name.to_dict()
    sub = am[am.kind == kind]
    b = sub[sub.yr.between(*A.BASE_YEARS)]
    mean = (b.groupby("id").h.sum() / (A.BASE_YEARS[1] - A.BASE_YEARS[0] + 1)).sort_values(ascending=False)
    world_mean = am[(am.kind == "world") & am.yr.between(*A.BASE_YEARS)].h.sum() / (A.BASE_YEARS[1] - A.BASE_YEARS[0] + 1)
    pick = list(ids) if ids is not None else list(mean.index[:top])
    out = []
    for id_ in pick:
        s = _monthly(am, kind, id_, last)
        s.loc[[(y, m) in unknown for y, m in zip(s.yr, s.mo)], "value"] = np.nan
        ok = s.dropna(subset=["value"])
        tr = A.trend(ok)
        cr = A.critical(ok)
        an = A.anomalies(ok)
        lr = an.iloc[-1]
        yearly = ok.groupby("yr").value.agg(["sum", "count"])
        out.append({"kind": kind, "id": id_, "name": names.get((kind, id_), id_), "mean_per_year": _r(mean.get(id_), 0),
                    "share_pct": _r(100 * mean.get(id_, 0) / world_mean, 2),
                    "trend_pct_per_decade": _r(tr["pct_per_decade"], 1), "trend_p": _r(tr["p"], 5), "trend": tr["trend"],
                    "critical_months": [int(m) for m in cr["critical_period"]],
                    "latest_ratio": _r(lr.ratio_to_normal, 3), "latest_yr": int(lr.yr), "latest_mo": int(lr.mo),
                    "yearly": [{"yr": int(y), "h": _r(r["sum"], 0)} for y, r in yearly.iterrows() if y >= 2001 and r["count"] == 12]})
    return out


def hot_now(am, areas, meta) -> list[dict]:
    """The named areas most above normal in the latest full month (with a normal of at least MIN_NORMAL_HOT)."""
    unknown = _unknown(am)
    w = am[(am.kind == "world")]
    known = w[~w.apply(lambda r: (r.yr, r.mo) in unknown, axis=1)]
    ly, lm = int(known.yr.iloc[-1]), int(known.mo.iloc[-1])
    sub = am[am.kind.isin(["country", "state"])]
    base = sub[sub.yr.between(*A.BASE_YEARS) & (sub.mo == lm)]
    # median over 25 base years with zeros for missing rows
    norm = base.groupby(["kind", "id"]).h.apply(lambda v: float(np.median(np.r_[v.to_numpy(), np.zeros(25 - len(v))])) if len(v) < 25 else float(v.median()))
    now = sub[(sub.yr == ly) & (sub.mo == lm)].set_index(["kind", "id"]).h
    df = pd.DataFrame({"normal": norm}).join(now.rename("h"), how="left").fillna({"h": 0.0})
    df = df[df.normal >= MIN_NORMAL_HOT]
    df["ratio"] = df.h / df.normal
    names = areas.set_index(["kind", "id"]).name.to_dict()
    top = df.sort_values("ratio", ascending=False).head(15).reset_index()
    return [{"kind": r.kind, "id": r.id, "name": names.get((r.kind, r.id), r.id), "h": _r(r.h, 0), "normal": _r(r.normal, 0),
             "ratio": _r(r.ratio, 2), "yr": ly, "mo": lm} for r in top.itertuples()]


def seam_block(val, wm) -> dict:
    pw, plc, bw = val["per_witness"], val["placebo_seams"], val.get("burned_area_witness", {})
    raw = wm.assign(unbridged=np.where(wm.yr * 100 + wm.mo < 200207, wm.model_terra_only, wm.harmonized))
    from . import validate as V
    unbridged = V.per_witness(raw, "unbridged", "terra_cc", "2002-07-01", "2001-07-01", 1)["step_pct"]
    return {
        "naive_jump_2011_2012": _r(val["naive_jump_2011_to_2012"], 3),
        "steps": {"2012_harmonized_1y": _r(pw["2012_modis_witness"]["harmonized"]["1y"]["step_pct"], 2),
                  "2012_harmonized_3y": _r(pw["2012_modis_witness"]["harmonized"]["3y"]["step_pct"], 2),
                  "2012_naive_1y": _r(pw["2012_modis_witness"]["naive_join"]["1y"]["step_pct"], 1),
                  "2002_harmonized": _r(pw["2002_terra_witness"]["harmonized"]["1y"]["step_pct"], 2),
                  "2002_without_bridge": _r(unbridged, 2),
                  "2002_modis_scale": _r(pw["2002_terra_witness"]["modis_scale"]["1y"]["step_pct"], 2)},
        "placebo": {k.split("_")[0]: {"mean": _r(d["mean"], 2), "sd": _r(d["sd"], 2), "z": _r(d["z"], 2), "real": _r(d["real_step"], 2),
                                      "steps": {str(y): _r(s, 2) for y, s in d["steps"].items()}} for k, d in plc.items()},
        "burned_area": ({"step_1y": _r(bw["1y"]["step_pct"]["harmonized"], 2), "modis_step_1y": _r(bw["1y"]["step_pct"]["modis_scale"], 2),
                         "naive_step_1y": _r(bw["1y"]["step_pct"]["naive_join"], 1), "placebo_sd": _r(bw["1y"]["placebo_sd"], 2),
                         "z": _r(bw["1y"]["z"], 2), "hotspots_per_km2": {str(k): _r(v, 3) for k, v in bw["hotspots_per_km2_burned"].items()},
                         "yearly_correlation": _r(bw["yearly_correlation"]["harmonized"], 3)} if bw else None),
        "pettitt": {k: {"year": int(v["change_year"]), "p": _r(v["p"], 5)} for k, v in val["pettitt_annual_2001_2025"].items()},
        "pelt_near_seams": val["pelt_breaks_within_12_months_of_seam"],
        # the world's small 2012 step is a sum of regional steps that partly cancel (validate.regional_seams)
        "regional": ([{"kind": u["kind"], "id": u["id"], "name": u["name"], "mean_per_year": _r(u["mean_per_year"], 0),
                       "step_2012": _r(u["2012_modis_witness"]["step_1y"], 2), "placebo_sd_2012": _r(u["2012_modis_witness"]["placebo_pre"]["sd"], 2),
                       "z_2012": _r(u["2012_modis_witness"]["z"], 2), "detectable_2012": _r(u["2012_modis_witness"]["detectable_1y"], 2),
                       "step_2012_3y": _r(u["2012_modis_witness"]["step_3y"], 2),
                       "step_2002": _r(u.get("2002_terra_witness", {}).get("step_1y"), 2),
                       "z_2002": _r(u.get("2002_terra_witness", {}).get("z"), 2)} for u in val["regional_seams"]["units"]]
                     if "regional_seams" in val else None),
        "power": ({k: {"detectable_pct": _r(v["detectable_pct"], 2), "placebo_sd": _r(v["placebo_sd"], 2), "step_pct": _r(v["step_pct"], 2)}
                   for k, v in val["power"].items() if isinstance(v, dict)} if "power" in val else None),
    }


def models_block(meta) -> dict:
    sc = pd.read_parquet(C.work("models", "cv_scores.parquet"))
    t = sc.groupby(["scale", "model"])[["lin_ccc_log", "median_abs_rel_err_pct", "bias_pct"]].mean()
    order = ["cell x month", "region L4 x month", "region L3 x month", "continent x month", "world x month", "region L3 x year", "continent x year"]
    cv = [{"scale": s, "ratio_err": _r(t.loc[(s, "ratio_ta"), "median_abs_rel_err_pct"], 1), "gbm_err": _r(t.loc[(s, "gbm_ta"), "median_abs_rel_err_pct"], 1),
           "ratio_ccc": _r(t.loc[(s, "ratio_ta"), "lin_ccc_log"], 3), "gbm_ccc": _r(t.loc[(s, "gbm_ta"), "lin_ccc_log"], 3)} for s in order]
    cov = meta["intervals"]
    scales = sorted({k for v in cov.values() for k in v["coverage_by_scale"]}, key=lambda s: order.index(s) if s in order else 99)
    coverage = [{"scale": s, "terra_aqua": _r(cov["terra_aqua_month" if "month" in s else "terra_aqua_year"]["coverage_by_scale"].get(s), 3),
                 "terra_only": _r(cov["terra_only_month" if "month" in s else "terra_only_year"]["coverage_by_scale"].get(s), 3)} for s in scales]
    b = pickle.load(open(C.REPO / "models" / "bridges.pkl", "rb"))
    tb = json.loads((C.REPO / "models" / "terra_only_bridge.json").read_text())
    import lightgbm as lgb
    bst = lgb.Booster(model_file=str(C.REPO / "models" / "gbm_terra_aqua.txt"))
    imp = pd.Series(bst.feature_importance("gain"), index=bst.feature_name())
    imp = (100 * imp / imp.sum()).sort_values(ascending=False).head(10)
    return {"cv": cv, "bias_pct": {"terra_aqua": _r(t.loc[("cell x month", "gbm_ta"), "bias_pct"], 2), "terra_only": _r(t.loc[("cell x month", "gbm_t"), "bias_pct"], 2)},
            "coverage": coverage,
            "bridges": {"snpp_to_noaa20": _r(b["k"]["S"].attrs["k_global"], 3), "noaa21_to_noaa20": _r(b["k"]["J"].attrs["k_global"], 3),
                        "terra_only_to_terra_aqua": _r(tb["k_global"], 3)},
            "importance": [{"feature": k, "pct": _r(v, 1)} for k, v in imp.items()],
            "error_with_fire": error_with_fire()}


def error_with_fire() -> list[dict] | None:
    """The error and 90% range coverage of held out hexagon months where VIIRS saw fire (at least 10 and at least 100
    hotspots), next to all of them (eda.hex_error_nonempty): most units are nearly empty, so the overall numbers flatter
    the months that matter."""
    if not C.work("models", "cv_totals.parquet").exists():
        return None
    from . import eda as E
    con = E._con()
    try:
        rows = E.hex_error_nonempty(con)["rows"]
    finally:
        con.close()
    return [{"scale": r["scale"], "viirs_at_least": r["viirs_at_least"], "units": r["units"], "median_abs_error_pct": r["median_abs_error_pct"],
             "median_signed_error_pct": r["median_signed_error_pct"], "coverage_90": r["coverage_90"]} for r in rows]


def physics_block() -> dict | None:
    p = C.work("physics", "viirs_points_2019.parquet")
    if not p.exists():
        return None
    pts = pd.read_parquet(p, columns=["frp", "daynight", "tile", "lat", "lon", "aqua_seen", "aqua_view", "terra_seen", "terra_view"])
    seen = {}
    for sat in ("aqua", "terra"):
        clear = pts[pts[f"{sat}_view"] == 0]
        for dn, name in (("D", "day"), ("N", "night")):
            seen[f"{sat}_{name}"] = _r(clear[clear.daynight == dn][f"{sat}_seen"].mean(), 3)
    bins = [0, 1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 100, 200, 1e6]
    mid = [0.7, 1.4, 2.4, 3.9, 5.9, 8.4, 12, 17, 24, 39, 71, 141, 300]
    curve = []
    clear_a = pts[pts.aqua_view == 0].assign(b=pd.cut(pts.frp, bins, right=False, labels=mid))
    clear_t = pts[pts.terra_view == 0].assign(b=pd.cut(pts.frp, bins, right=False, labels=mid))
    for m in mid:
        row = {"frp": m}
        for sat, df in (("aqua", clear_a), ("terra", clear_t)):
            for dn, name in (("D", "day"), ("N", "night")):
                g = df[(df.b == m) & (df.daynight == dn)][f"{sat}_seen"]
                row[f"{sat}_{name}"] = _r(g.mean(), 3) if len(g) >= 200 else None
        curve.append(row)

    def half(key):
        xs = [c["frp"] for c in curve if c[key] is not None]
        ys = [c[key] for c in curve if c[key] is not None]
        for i in range(1, len(ys)):
            if ys[i - 1] < 0.5 <= ys[i]:
                return _r(float(np.exp(np.interp(0.5, [ys[i - 1], ys[i]], np.log([xs[i - 1], xs[i]])))), 1)
        return None
    clear = pts[pts.aqua_view == 0]
    tiles = clear.groupby("tile").agg(lat=("lat", "median"), lon=("lon", "median"), weak_share=("frp", lambda f: (f < 5).mean()),
                                      seen=("aqua_seen", "mean"), n=("frp", "size")).reset_index()
    return {"points": int(len(pts)), "seen": seen, "curve": curve, "half_mw": {"aqua_day": half("aqua_day"), "aqua_night": half("aqua_night")},
            "cloud_share": _r((pts.aqua_view == 1).mean(), 4),
            "tiles": [{"tile": r.tile, "lat": _r(r.lat, 2), "lon": _r(r.lon, 2), "weak_share": _r(r.weak_share, 3),
                       "viirs_per_aqua": _r(1 / r.seen, 2), "points": int(r.n)} for r in tiles.itertuples()]}


def mask_block() -> dict:
    """The static source mask, tested on 2024 and 2025 (it was built from data up to 2022). Cached."""
    cache = C.work("static_mask", "evaluation.json")
    if not cache.exists():
        from . import static_mask as SM
        ev = SM.evaluate()
        rows = ev[ev.variant.str.startswith("ring 0")]
        res = {r.family: {"recall": float(r.recall), "precision": float(r.precision), "fire_loss": float(r.fire_loss)} for r in rows.itertuples()}
        with C.atomic(cache) as tmp:
            tmp.write_text(json.dumps(res, indent=1))
    res = json.loads(cache.read_text())
    return {k.lower(): {kk: _r(vv, 4) for kk, vv in v.items()} for k, v in res.items()}


def drivers_block(areas) -> dict | None:
    p = C.REPO / "models" / "drivers.json"
    if not p.exists():
        return None
    dm = json.loads(p.read_text())["areas"]
    names = areas.set_index(["kind", "id"]).name.to_dict()
    rows = [{"kind": k.split(":", 1)[0], "id": k.split(":", 1)[1], "r2_cv": v["r2_cv"], "beta_rain": v["beta"]["rain3_z"],
             "uses_heat": "t2m_z" in v["terms"], "enso_r": v["enso"].get("r"), "enso_lag": v["enso"].get("lag"),
             "fire_per_year": v["fire_per_year"]} for k, v in dm.items()]
    df = pd.DataFrame(rows)
    df["name"] = [names.get((k, i), "World" if k == "world" else i) for k, i in zip(df.kind, df.id)]
    st = df[df.kind == "state"]
    edges = [-1, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 1.0]
    hist = pd.cut(df.r2_cv.clip(-0.99, 0.99), edges).value_counts().sort_index()
    top = st[st.fire_per_year >= 3000].nlargest(10, "r2_cv")
    enso = df[df.kind == "country"].dropna(subset=["enso_r"]).nsmallest(10, "enso_r")
    return {"areas": int(len(df)), "share_r2_above_0_2": _r((df.r2_cv > 0.2).mean(), 3), "median_r2_state": _r(st.r2_cv.median(), 3),
            "hist": [{"lo": float(i.left), "hi": float(i.right), "n": int(n)} for i, n in hist.items()],
            "top": [{"name": r.name, "kind": r.kind, "id": r.id, "r2_cv": _r(r.r2_cv, 3), "beta_rain": _r(r.beta_rain, 3),
                     "enso_r": _r(r.enso_r, 3)} for r in top.itertuples()],
            "enso": [{"name": r.name, "id": r.id, "enso_r": _r(r.enso_r, 3), "enso_lag": int(r.enso_lag)} for r in enso.itertuples()]}


def outlook_block(areas) -> dict | None:
    s = C.REPO / "models" / "outlook.json"
    if not s.exists():
        return None
    from . import outlook as O
    from . import climate as K
    summ = json.loads(s.read_text())
    cv = pd.read_parquet(K.out("outlook_cv.parquet"))
    cv = cv[cv.in_season]
    b = pd.cut(cv.p, np.linspace(0, 1, 11), include_lowest=True)
    cal = cv.groupby(b, observed=True).agg(p=("p", "mean"), o=("above", "mean"), n=("p", "size")).reset_index(drop=True)
    cont = cv[cv.kind == "continent"].groupby(["id", "lead"]).apply(lambda g: O.brier(g)["bss"], include_groups=False).unstack("lead")
    cont = cont.drop(index=[i for i in cont.index if i in ("Antarctica", "Seven seas (open ocean)")], errors="ignore")
    now = pd.read_parquet(K.out("outlook.parquet"))
    if "bss_clim" not in now:          # an outlook issued before the fair score: score its areas here
        now = O.fair_outlook_rows(now, cv)
    names = areas.set_index(["kind", "id"]).name.to_dict()
    # the list's rule (lead 1, skill >= 0.1) now uses the skill against a fixed 50% chance
    nxt = now[(now.lead == 1) & (now.bss >= O.LIST_MIN_BSS) & now.kind.isin(["country", "state"])].copy()
    nxt["name"] = [names.get((k, i), i) for k, i in zip(nxt.kind, nxt.id)]
    top = nxt.nlargest(12, "p")
    fair = summ.get("score_fair") or O.skill_table(cv)
    fair_cont = O.area_skill(cv[cv.kind == "continent"]).pivot(index="id", columns="lead", values="bss")
    fair_cont = fair_cont.drop(index=[i for i in fair_cont.index if i in ("Antarctica", "Seven seas (open ocean)")], errors="ignore")
    recent = cv[cv.target_yr >= 2022]
    pers = [fair[f"lead {L}"].get("persistence") for L in O.LEADS]
    return {"issued_from": summ["issued_from"], "areas": summ["areas"],
            "bss": [{"lead": L, "bss": _r(summ["score"][f"lead {L}"]["bss"], 3)} for L in O.LEADS],
            "bss_recent": _r(summ["score"]["test 2022 to 2025"]["bss"], 3),
            "share_with_skill": {str(L): _r(summ["share_of_areas_with_skill"][f"lead {L}"], 3) for L in O.LEADS},
            # the fair score: against a fixed 50% chance, with a 95% block bootstrap interval of target years
            "bss_fair": [{"lead": L, "bss": _r(fair[f"lead {L}"]["fixed_50"]["bss"], 3), "lo": _r(fair[f"lead {L}"]["fixed_50"]["ci95"][0], 3),
                          "hi": _r(fair[f"lead {L}"]["fixed_50"]["ci95"][1], 3)} for L in O.LEADS],
            "bss_recent_fair": _r(1 - float(((recent.p - recent.above) ** 2).mean()) / O.FAIR_P ** 2, 3) if len(recent) else None,
            "share_with_skill_fair": {str(L): _r(fair[f"lead {L}"]["share_of_areas_with_skill"], 3) for L in O.LEADS},
            "median_area_bss_fair": {str(L): _r(fair[f"lead {L}"]["median_area_bss"], 3) for L in O.LEADS},
            "persistence": ([{"lead": L, "bss": _r(p["bss"], 3), "lo": _r(p["ci95"][0], 3), "hi": _r(p["ci95"][1], 3),
                              "model_over_persistence": _r(p["model_bss_over_persistence"], 3)} for L, p in zip(O.LEADS, pers)]
                            if all(pers) else None),
            "by_continent_fair": [{"name": i, **{f"l{L}": _r(fair_cont.loc[i, L], 3) for L in O.LEADS}}
                                  for i in fair_cont.sort_values(1, ascending=False).index],
            "list_rule": {"min_bss": O.LIST_MIN_BSS, "reference": "a fixed 50% chance", "passing": int(len(nxt))},
            "calibration": [{"p": _r(r.p, 3), "o": _r(r.o, 3), "n": int(r.n)} for r in cal.itertuples()],
            "by_continent": [{"name": i, **{f"l{L}": _r(cont.loc[i, L], 3) for L in O.LEADS}} for i in cont.sort_values(1, ascending=False).index],
            "top_now": [{"name": r.name, "kind": r.kind, "id": r.id, "target_yr": int(r.target_yr), "target_mo": int(r.target_mo),
                         "p": _r(r.p, 3), "p_clim": _r(r.p_clim, 3), "bss": _r(r.bss, 3)} for r in top.itertuples()],
            "importance": [{"feature": k, "pct": v} for k, v in list(summ["feature_gain_pct"].items())[:8]]}


def haze_block() -> dict | None:
    p = C.REPO / "models" / "haze.json"
    if not p.exists():
        return None
    from . import climate as K
    hz = json.loads(p.read_text())
    h = pd.read_parquet(K.out("haze_city_month.parquet"))
    season = h[h.mo.between(*hz["season_months"])]
    cities = []
    for c, m in hz["cities"].items():
        s = season[season.city == c]
        fit = s[s.yr.between(*hz["fit_years"])]
        k = m["ug_per_1000_hotspots"]
        ss, sb = (k["sumatra"] * fit.sumatra).sum(), (k["borneo"] * fit.borneo).sum()
        sm = lambda yr: _r(s[(s.yr == yr) & s.mo.between(8, 10)].smoke_model.mean(), 1)
        cities.append({"name": c, "country": m["country"], "r2_cv": _r(m["r2_cv"], 3), "share_sumatra": _r(ss / max(ss + sb, 1e-9), 3),
                       "share_borneo": _r(sb / max(ss + sb, 1e-9), 3), "k_sumatra": _r(k["sumatra"], 3), "k_borneo": _r(k["borneo"], 3),
                       "smoke_2015": sm(2015), "smoke_2019": sm(2019), "smoke_2026": sm(2026), "pm25_mean": _r(fit.pm25_cnn.mean(), 1),
                       # how much the fire explains beyond the calendar (leave one year out): the month term alone, and
                       # fire's share of what the month term leaves (haze.checks)
                       "r2_month": _r(m.get("r2_month_cv"), 3), "r2_fire_beyond_month": _r(m.get("r2_fire_beyond_month"), 3),
                       "smoke_2015_per_who_annual": _r(m.get("smoke_2015_aug_oct_per_who_annual"), 2)})
    tc = hz.get("target_check")
    return {"season_months": hz["season_months"], "who_daily_guideline": hz["who_daily_guideline"],
            "who_annual_guideline": hz.get("who_annual_guideline"), "cities": cities,
            "target_check": ({"verdict": tc["verdict"], "best_lag": tc["best_lag"],
                              "anomaly_r": _r(tc["anomaly_r_lag0_mean"]["as decoded"], 3),
                              "pekanbaru": tc["pekanbaru"]} if tc else None)}


def build(log=print, out_path=None) -> dict:
    """out_path: write dashboard.json there instead of the published folder (a dry run)."""
    from pathlib import Path
    t0 = time.time()
    dest = Path(out_path) if out_path else PB.products("dashboard.json")
    con = C.connect()
    am = con.execute(f"SELECT kind, id, yr, mo, h, modis, src FROM '{PB.products('area_monthly.parquet')}'").df()
    areas = pd.read_json(PB.products("areas.json"))
    meta = json.loads(PB.products("meta.json").read_text())
    val = json.loads((C.REPO / "models" / "validation.json").read_text())
    wm = pd.read_parquet(C.work("models", "world_monthly.parquet"))
    out = {"version": meta["version"], "built_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    out.update(record_and_world(am, meta, val, wm))
    log("dashboard: record and world")
    out["continents"] = areas_table(am, areas, meta, "continent",
                                    ids=[c for c in am[am.kind == "continent"].id.unique() if c not in ("Antarctica", "Seven seas (open ocean)")])
    out["countries"] = areas_table(am, areas, meta, "country", top=TOP_COUNTRIES)
    log("dashboard: continents and countries")
    out["hot_now"] = hot_now(am, areas, meta)
    out["seam"] = seam_block(val, wm)
    out["models"] = models_block(meta)
    out["physics"] = physics_block()
    out["mask"] = mask_block()
    log("dashboard: seams, models, physics, mask")
    out["drivers"] = drivers_block(areas)
    out["outlook"] = outlook_block(areas)
    out["haze"] = haze_block()
    with C.atomic(dest) as tmp:
        tmp.write_text(PB.strict_json(out, indent=1))
    return {"file": str(dest), "kb": round(dest.stat().st_size / 1024, 1),
            "seconds": round(time.time() - t0)}
