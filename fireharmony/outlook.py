"""Fire outlook 1 to 3 months ahead (Phase 3), with its skill measured honestly.

Question: will fire in an area be above normal (above the median of that calendar month in 2001 to 2025) one, two
or three months from now? We answer with a probability, from what is known at the end of the latest month:
  the area's fire anomaly in the last three months (fire persists), rain over the last three months (IMERG, bridged),
  last month's temperature (MERRA-2), El Nino (the latest ONI) and the Indian Ocean Dipole (from MERRA-2 sea
  surface temperature), and how much of the area's normal yearly fire falls in the target month.
One gradient boosting model serves every area and lead. Skill is scored on years the model never saw (blocks of
years held out in turn) with the Brier skill score against a fixed 50% chance (the event is above the median, so it
happens half the time), with a 95% interval from a block bootstrap of target years and a persistence baseline
(skill_table). The older score against the share of the other years above normal is kept as "score" (it is inflated:
holding a year out moves that share the wrong way). `rescore` scores an existing cross validation again without training.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config as C
from . import drivers as D

LEADS = (1, 2, 3)
YEAR_BLOCKS = ((2002, 2006), (2007, 2011), (2012, 2016), (2017, 2021), (2022, 2025))
FEATURES = ["lead", "y0", "y1", "y2", "rain3_z", "rain_z", "t2m_z_prev", "oni", "dmi", "target_share", "target_mo_sin",
            "target_mo_cos", "abs_lat", "log_fire_per_year"]
PARAMS = {"objective": "binary", "learning_rate": 0.05, "num_leaves": 31, "min_data_in_leaf": 200, "feature_fraction": 0.8,
          "bagging_fraction": 0.8, "bagging_freq": 1, "lambda_l2": 1.0, "verbose": -1, "num_threads": 4, "seed": 7}
ROUNDS = 400


def dmi_merra2() -> pd.DataFrame:
    """Indian Ocean Dipole index for every month up to last month.
    The published DMI (NOAA PSL, from HadISST) is used where it exists. After it ends (it lags by about 5 months) we
    use our own index from MERRA-2 surface temperature: west box anomaly minus east box anomaly, each against its
    calendar month in 2001 to 2025, put on the DMI scale by a straight line fitted where both exist. Our east box
    holds some land (Sumatra, Java), so it agrees with the DMI only at r = 0.78; the ONI check from the same data
    agrees at r = 0.99. dmi_src: 0 published, 1 MERRA-2."""
    s = pd.read_parquet(D.out("sst_boxes.parquet"))
    base = s[s.yr.between(*D.BASE)]
    for k in ("iod_west", "iod_east", "nino34"):
        s[f"{k}_anom"] = s[k] - s.mo.map(base.groupby("mo")[k].mean())
    s["dmi_m2"] = s.iod_west_anom - s.iod_east_anom
    s["nino34_3m"] = s.nino34_anom.rolling(3, center=True).mean()
    idx = pd.read_parquet(D.out("indices.parquet")).astype({"yr": int, "mo": int})
    s = s.merge(idx[["yr", "mo", "dmi"]], on=["yr", "mo"], how="left")
    both = s.dropna(subset=["dmi", "dmi_m2"])
    slope, icept = np.polyfit(both.dmi_m2, both.dmi, 1)
    s["dmi_best"] = s.dmi.fillna(icept + slope * s.dmi_m2)
    s["dmi_src"] = np.where(s.dmi.notna(), 0, 1).astype(np.int8)
    return s[["yr", "mo", "dmi_m2", "nino34_3m", "dmi_best", "dmi_src"]]


def examples(fire: pd.DataFrame, anom: pd.DataFrame, areas: pd.DataFrame, dmi: pd.DataFrame) -> pd.DataFrame:
    """One row per area, issue month t and lead L, with the features known at the end of month t and the outcome.
    fire: drivers.fire_anomaly(); anom: drivers.climate_anomalies(); areas: kind, id, abs_lat."""
    f = fire.copy()
    f["t"] = f.yr.astype(int) * 12 + f.mo.astype(int)
    f = f.merge(anom[["kind", "id", "yr", "mo", "rain3_z", "t2m_z", "rain_mm"]], on=["kind", "id", "yr", "mo"], how="left")
    # rain of the month itself, standardised the same way as the 3 month rain
    lr = np.log(f.rain_mm + 5.0)
    base = f.yr.between(*D.BASE)
    st = f[base].assign(lr=lr[base]).groupby(["kind", "id", "mo"]).lr.agg(["mean", "std"])
    f = f.join(st, on=["kind", "id", "mo"])
    f["rain_z"] = (lr - f["mean"]) / f["std"]
    f = f.drop(columns=["mean", "std"])
    g = f.groupby(["kind", "id"], sort=False)
    f["y1"], f["y2"] = g.y.shift(1), g.y.shift(2)
    f["t2m_z_prev"] = g.t2m_z.shift(1)                               # MERRA-2 for the latest month is not out yet
    idx = pd.read_parquet(D.out("indices.parquet")).astype({"yr": int, "mo": int})
    idx["t"] = idx.yr * 12 + idx.mo
    oni = idx.set_index("t").oni
    dm = dmi.assign(t=dmi.yr.astype(int) * 12 + dmi.mo.astype(int)).set_index("t").dmi_best
    f["oni"] = (f.t - 1).map(oni)                                    # the latest season is centred on last month
    f["dmi"] = (f.t - 1).map(dm)
    norm = f[f.yr.between(*D.BASE)].groupby(["kind", "id", "mo"]).normal.first().rename("n_target")
    year_total = norm.groupby(level=[0, 1]).sum().rename("n_year")
    rows = []
    for L in LEADS:
        x = f.rename(columns={"y": "y0"}).copy()
        x["lead"] = L
        tt = x.t + L
        x["target_yr"], x["target_mo"] = (tt - 1) // 12, (tt - 1) % 12 + 1
        x["tt"] = tt
        nxt = f[["kind", "id", "t", "h", "normal"]].rename(columns={"t": "tt", "h": "h_target", "normal": "normal_target"})
        rows.append(x.merge(nxt, on=["kind", "id", "tt"], how="left").drop(columns="tt"))
    x = pd.concat(rows, ignore_index=True)
    x = x.join(norm, on=["kind", "id", "target_mo"]).join(year_total, on=["kind", "id"])
    x["target_share"] = x.n_target / x.n_year.where(x.n_year > 0)
    # the outlook is for the fire season: a target month whose normal fire is at least a fifth of an average month
    # (outside it, "above normal" turns on a handful of hotspots and the chances were not to be trusted)
    x["in_season"] = 12 * x.target_share >= D.SEASON_SHARE
    x["target_mo_sin"], x["target_mo_cos"] = np.sin(2 * np.pi * x.target_mo / 12), np.cos(2 * np.pi * x.target_mo / 12)
    x = x.merge(areas[["kind", "id", "abs_lat"]], on=["kind", "id"], how="left")
    x["log_fire_per_year"] = np.log10(x.fire_per_year)
    x["above"] = np.where(x.h_target.notna(), (x.h_target > x.normal_target).astype(float), np.nan)
    return x


def climatology_chance(x: pd.DataFrame, train: pd.Series) -> pd.Series:
    """Chance of above normal fire for the area and target calendar month in the training years only."""
    c = x[train].groupby(["kind", "id", "target_mo"]).above.mean().rename("p_clim")
    return x[["kind", "id", "target_mo"]].join(c, on=["kind", "id", "target_mo"]).p_clim.fillna(x[train].above.mean())


def cross_validate(x: pd.DataFrame, log=print) -> pd.DataFrame:
    """Out of fold probabilities: each block of years is predicted by a model trained on the other blocks."""
    import lightgbm as lgb
    x = x[x.above.notna() & x.y0.notna()].copy()
    x["p"], x["p_clim"] = np.nan, np.nan
    for a, b in YEAR_BLOCKS:
        te = x.target_yr.between(a, b)
        tr = ~te & x.target_yr.between(YEAR_BLOCKS[0][0], YEAR_BLOCKS[-1][1])
        m = lgb.train(PARAMS, lgb.Dataset(x.loc[tr, FEATURES], x.loc[tr, "above"]), ROUNDS)
        x.loc[te, "p"] = m.predict(x.loc[te, FEATURES], num_threads=4)
        x.loc[te, "p_clim"] = climatology_chance(x, tr)[te]
        log(f"outlook fold {a} to {b}: {int(te.sum()):,} test rows")
    return x[x.p.notna()]


def brier(df: pd.DataFrame) -> dict:
    bs = float(((df.p - df.above) ** 2).mean())
    bc = float(((df.p_clim - df.above) ** 2).mean())
    return {"n": int(len(df)), "brier": round(bs, 4), "brier_clim": round(bc, 4), "bss": round(1 - bs / bc, 4)}


# ------------------------------------------------------------------------------------------ a fair skill score
# The event is "above the median of that calendar month", so in the long run it happens half the time and a fixed
# 50% chance is the honest reference. The share of the other years above normal (p_clim) looks like a climatology,
# but holding a year out moves it the wrong way (if the held out year is above the median, fewer of the others are),
# so its Brier score (0.29) is worse than a constant 50% (0.25) and skill measured against it is inflated.
FAIR_P = 0.5
BOOT_BLOCK = 5                 # target years per bootstrap block (fire years cluster: El Nino, droughts)
BOOT_DRAWS = 500
LIST_MIN_BSS = 0.1             # an area joins the Dashboard's "most likely above normal" list with this skill at lead 1


def _logit_fit(x: np.ndarray, y: np.ndarray, iters: int = 30) -> np.ndarray:
    """Logistic regression of y (0 or 1) on [1, x] by Newton steps (two parameters, so no library is needed)."""
    X = np.column_stack([np.ones_like(x), x])
    b = np.zeros(2)
    for _ in range(iters):
        p = 1 / (1 + np.exp(-np.clip(X @ b, -30, 30)))
        H = (X * (p * (1 - p))[:, None]).T @ X + 1e-9 * np.eye(2)
        step = np.linalg.solve(H, X.T @ (y - p))
        b += step
        if np.abs(step).max() < 1e-8:
            break
    return b


def persistence_chance(cv: pd.DataFrame) -> pd.Series:
    """The simplest forecast that knows something: a logistic fit of the outcome on this month's fire anomaly y0
    (fire persists), one per lead, fitted on the other year blocks like the model. NaN where y0 is unknown."""
    out = pd.Series(np.nan, index=cv.index)
    ok = cv.y0.notna() & cv.above.notna()
    for L in sorted(cv.lead.unique()):
        for a, b in YEAR_BLOCKS:
            te = ok & (cv.lead == L) & cv.target_yr.between(a, b)
            tr = ok & (cv.lead == L) & ~cv.target_yr.between(a, b)
            if not te.any() or not tr.any():
                continue
            k = _logit_fit(cv.y0[tr].to_numpy(float), cv.above[tr].to_numpy(float))
            out[te] = 1 / (1 + np.exp(-(k[0] + k[1] * cv.y0[te].to_numpy(float))))
    return out


def _year_sums(g: pd.DataFrame, refs: dict) -> pd.DataFrame:
    """Per target year: the rows and the summed squared error of the model and of each reference."""
    e = pd.DataFrame({"yr": g.target_yr.to_numpy(), "n": 1.0, "model": ((g.p - g.above) ** 2).to_numpy()})
    for k, col in refs.items():
        e[k] = ((col - g.above) ** 2).to_numpy()
    return e.groupby("yr").sum()


def block_bootstrap(sums: pd.DataFrame, pairs: dict, draws: int = BOOT_DRAWS, block: int = BOOT_BLOCK, seed: int = 7) -> dict:
    """95% intervals of Brier skill scores from a moving block bootstrap of target years: blocks of `block`
    consecutive years drawn with replacement until the record's length is reached, the same years for every score.
    sums: one row per year (_year_sums); pairs: name -> (model column, reference column); skill = 1 - sum m / sum r."""
    rng = np.random.default_rng(seed)
    n = len(sums)
    starts = np.arange(max(n - block + 1, 1))
    k = int(np.ceil(n / block))
    S = {c: sums[c].to_numpy(float) for c in sums.columns}
    vals = {name: np.empty(draws) for name in pairs}
    for d in range(draws):
        pick = np.concatenate([np.arange(s, min(s + block, n)) for s in rng.choice(starts, k)])[:n]
        for name, (m, r) in pairs.items():
            vals[name][d] = 1 - S[m][pick].sum() / S[r][pick].sum()
    return {name: [round(float(np.percentile(v, 2.5)), 4), round(float(np.percentile(v, 97.5)), 4)] for name, v in vals.items()}


def area_skill(cv: pd.DataFrame, ref: float | str = FAIR_P) -> pd.DataFrame:
    """Brier skill score of every area and lead against a fixed chance (a number) or a column (p_clim)."""
    r = cv[ref] if isinstance(ref, str) else ref
    e = cv[["kind", "id", "lead"]].assign(m=(cv.p - cv.above) ** 2, r=(r - cv.above) ** 2)
    g = e.groupby(["kind", "id", "lead"]).agg(n=("m", "size"), m=("m", "mean"), r=("r", "mean")).reset_index()
    g["bss"] = 1 - g.m / g.r.where(g.r > 0)
    return g[["kind", "id", "lead", "n", "bss"]]


def skill_table(cv: pd.DataFrame, draws: int = BOOT_DRAWS, block: int = BOOT_BLOCK, seed: int = 7) -> dict:
    """The outlook's skill per lead, scored fairly. cv: the held out rows that are scored (in the fire season), with
    p, p_clim, above, lead, target_yr and, if known, y0 (this month's fire anomaly, for the persistence baseline).
    Per lead: the Brier score; the Brier skill score against a fixed 50% chance with a 95% interval (block bootstrap of
    target years); the same against the pooled base rate; the old score against p_clim, kept and labelled; a
    persistence baseline (its own skill, and the model's skill over it); the share of areas with a positive score and
    the median score of an area."""
    cv = cv[cv.above.notna() & cv.p.notna()]
    has_y0 = "y0" in cv and bool(cv.y0.notna().any())
    if has_y0:
        cv = cv.assign(p_pers=persistence_chance(cv))
    out = {}
    areas = area_skill(cv)
    for L in sorted(cv.lead.unique()):
        g = cv[cv.lead == L]
        base = float(g.above.mean())
        refs = {"fixed": pd.Series(FAIR_P, index=g.index), "base": pd.Series(base, index=g.index), "clim": g.p_clim}
        pairs = {"fixed": ("model", "fixed"), "clim": ("model", "clim")}
        if has_y0:
            gp = g.p_pers.notna()
            refs["pers"] = g.p_pers.where(gp, FAIR_P)           # rows without y0 (very few) fall back to 50%
            pairs.update({"pers_vs_fixed": ("pers", "fixed"), "model_vs_pers": ("model", "pers")})
        sums = _year_sums(g, refs)
        ci = block_bootstrap(sums, pairs, draws, block, seed)
        tot = sums.sum()
        sk = lambda m, r: round(float(1 - tot[m] / tot[r]), 4)
        a = areas[areas.lead == L].dropna(subset=["bss"])
        row = {"n": int(tot.n), "brier": round(float(tot.model / tot.n), 4),
               "fixed_50": {"brier_ref": round(float(tot.fixed / tot.n), 4), "bss": sk("model", "fixed"), "ci95": ci["fixed"]},
               "base_rate": {"rate": round(base, 4), "brier_ref": round(float(tot.base / tot.n), 4), "bss": sk("model", "base")},
               "old_reference_p_clim": {"brier_ref": round(float(tot.clim / tot.n), 4), "bss": sk("model", "clim"), "ci95": ci["clim"],
                                        "r_with_outcome": round(float(np.corrcoef(g.p_clim, g.above)[0, 1]), 3),
                                        "note": ("the share of the other years above normal; holding a year out moves it the "
                                                 "wrong way, so it scores worse than a fixed 50% and inflates skill")},
               "areas": int(len(a)), "share_of_areas_with_skill": round(float((a.bss > 0).mean()), 3) if len(a) else None,
               "median_area_bss": round(float(a.bss.median()), 4) if len(a) else None}
        row["persistence"] = None
        if has_y0:
            row["persistence"] = {"what": "logistic fit of the outcome on this month's fire anomaly y0, per lead, on the other year blocks",
                                  "rows_with_y0": int(gp.sum()), "brier": round(float(tot.pers / tot.n), 4),
                                  "bss": sk("pers", "fixed"), "ci95": ci["pers_vs_fixed"],
                                  "model_bss_over_persistence": sk("model", "pers"), "model_over_persistence_ci95": ci["model_vs_pers"]}
        out[f"lead {L}"] = row
    out["method"] = {"reference": f"a fixed {FAIR_P:.0%} chance (the event is above the median, so its long run rate is 50%)",
                     "interval": f"95% moving block bootstrap of target years, blocks of {block} years, {draws} draws",
                     "scored_rows": "held out year blocks, target months in the fire season",
                     "persistence": "logistic on y0 per lead" if has_y0 else "skipped: no y0 column"}
    return out


def with_y0(cv: pd.DataFrame, con=None) -> pd.DataFrame:
    """Add y0, the issue month's fire anomaly, rebuilt with the outlook's own feature code (drivers.fire_anomaly)."""
    f = D.fire_anomaly(con)[["kind", "id", "yr", "mo", "y"]].rename(columns={"y": "y0"})
    f = f.astype({"yr": "int64", "mo": "int64"})
    return cv.merge(f, on=["kind", "id", "yr", "mo"], how="left")


def fair_summary(cv_all: pd.DataFrame, con=None, log=print) -> dict:
    """score_fair for models/outlook.json from the cross validated rows (all months; the fire season is scored)."""
    cv = cv_all[cv_all.in_season]
    if "y0" not in cv:
        cv = with_y0(cv, con)
    sk = skill_table(cv)
    log("outlook fair skill: " + ", ".join(f"lead {L} {sk[f'lead {L}']['fixed_50']['bss']:.3f}" for L in LEADS))
    return sk


def list_gate(now: pd.DataFrame) -> dict:
    """How many issued areas pass the Dashboard list's rule (lead 1, country or state, skill at least LIST_MIN_BSS),
    with the fair score (bss) and with the old one (bss_clim)."""
    gate = now[(now.lead == 1) & now.kind.isin(["country", "state"])]
    return {"rule": f"lead 1, country or state, bss >= {LIST_MIN_BSS}", "areas_issued": int(len(gate)),
            "pass_old_reference": int((gate.bss_clim >= LIST_MIN_BSS).sum()) if "bss_clim" in gate else None,
            "pass_fair": int((gate.bss >= LIST_MIN_BSS).sum())}


def fair_outlook_rows(now: pd.DataFrame, cv_all: pd.DataFrame) -> pd.DataFrame:
    """The issued outlook with bss against a fixed 50% chance; the old score (against p_clim) moves to bss_clim."""
    fair = area_skill(cv_all[cv_all.in_season]).rename(columns={"bss": "bss_fair"})
    if "bss_clim" not in now:
        now = now.rename(columns={"bss": "bss_clim"})
    now = now.drop(columns=[c for c in ("bss", "bss_fair") if c in now])
    now = now.merge(fair[["kind", "id", "lead", "bss_fair"]], on=["kind", "id", "lead"], how="left").rename(columns={"bss_fair": "bss"})
    first = ["kind", "id", "lead", "issue_yr", "issue_mo", "target_yr", "target_mo", "p", "p_clim", "bss"]
    return now[first + [c for c in now.columns if c not in first]].astype({"bss": "float32", "bss_clim": "float32"})


def rescore(out_dir=None, summary_path=None, log=print) -> dict:
    """Score the existing cross validation again, fairly, without training anything: adds score_fair,
    share_of_areas_with_skill_fair and dashboard_list_gate to models/outlook.json, and rewrites outlook.parquet with bss
    against a fixed 50% chance (bss_clim keeps the old score). out_dir: write outlook.parquet (and, unless summary_path
    is given, outlook.json) there instead, as a dry run."""
    import json
    from pathlib import Path
    cv_all = pd.read_parquet(D.out("outlook_cv.parquet"))
    con = C.connect()
    sk = fair_summary(cv_all, con, log)
    now = fair_outlook_rows(pd.read_parquet(D.out("outlook.parquet")), cv_all)
    dest = Path(out_dir) if out_dir else D.out("outlook.parquet").parent
    with C.atomic(dest / "outlook.parquet") as tmp:
        now.to_parquet(tmp, index=False)
    summ = json.loads((C.REPO / "models" / "outlook.json").read_text())
    summ["score_fair"] = sk
    summ["share_of_areas_with_skill_fair"] = {f"lead {L}": sk[f"lead {L}"]["share_of_areas_with_skill"] for L in LEADS}
    summ["dashboard_list_gate"] = list_gate(now)
    summ_path = Path(summary_path) if summary_path else (Path(out_dir) / "outlook.json" if out_dir else C.REPO / "models" / "outlook.json")
    with C.atomic(summ_path) as tmp:
        tmp.write_text(json.dumps(summ, indent=1))
    return {"outlook_parquet": str(dest / "outlook.parquet"), "summary": str(summ_path), **summ["dashboard_list_gate"]}


def fit_final(x: pd.DataFrame):
    import lightgbm as lgb
    tr = x.above.notna() & x.y0.notna() & x.target_yr.between(YEAR_BLOCKS[0][0], YEAR_BLOCKS[-1][1])
    return lgb.train(PARAMS, lgb.Dataset(x.loc[tr, FEATURES], x.loc[tr, "above"]), ROUNDS)


def build(log=print) -> dict:
    """Train, score on held out year blocks, then issue the outlook from the latest complete month."""
    import json
    import time
    t0 = time.time()
    con = C.connect()
    clim = pd.read_parquet(D.out("area_climate.parquet"))
    idx = pd.read_parquet(D.out("indices.parquet"))
    anom = D.climate_anomalies(clim, idx)
    fire = D.fire_anomaly(con)
    bs = D.barren_share(con)
    keep = bs[bs.barren_share.fillna(0) <= D.MAX_BARREN][["kind", "id"]]
    fire = fire[fire.fire_per_year >= D.MIN_FIRE].merge(keep, on=["kind", "id"])
    areas = con.execute(f"""SELECT kind, id, abs(lat) AS abs_lat FROM read_json_auto('{C.path("products") / "v1.0" / "areas.json"}')""").df()
    areas = pd.concat([areas, pd.DataFrame({"kind": ["world"], "id": ["WORLD"], "abs_lat": [0.0]})])
    x = examples(fire, anom, areas, dmi_merra2())
    log(f"outlook: {len(x):,} examples in {time.time() - t0:.0f} s")
    cv_all = cross_validate(x, log)
    cv = cv_all[cv_all.in_season]                       # scored where it is issued: in the fire season
    score = {f"lead {L}": brier(cv[cv.lead == L]) for L in LEADS}
    score["all"] = brier(cv)
    score["test 2022 to 2025"] = brier(cv[cv.target_yr >= 2022])
    score["all months, fire season or not"] = brier(cv_all)
    by_area = cv.groupby(["kind", "id", "lead"]).apply(lambda g: pd.Series(brier(g)), include_groups=False).reset_index()
    # issue: the latest month with fire data everywhere
    last = fire.dropna(subset=["h"]).groupby(["yr", "mo"]).size()
    iy, im = last.index[-1]
    model = fit_final(x)
    model.save_model(str(C.REPO / "models" / "outlook_gbm.txt"))
    now = x[(x.yr == iy) & (x.mo == im) & x.in_season].copy()
    now["p"] = model.predict(now[FEATURES], num_threads=4)
    hist = x[x.above.notna() & x.target_yr.between(YEAR_BLOCKS[0][0], YEAR_BLOCKS[-1][1])]
    base_rate = hist.groupby(["kind", "id", "target_mo"]).above.mean().rename("p_clim")
    now = now.join(base_rate, on=["kind", "id", "target_mo"])
    now["p_clim"] = now.p_clim.fillna(hist.above.mean())
    res = now[["kind", "id", "lead", "yr", "mo", "target_yr", "target_mo", "p", "p_clim"]].rename(columns={"yr": "issue_yr", "mo": "issue_mo"})
    res = res.merge(by_area[["kind", "id", "lead", "bss", "n"]].rename(columns={"n": "n_tested"}), on=["kind", "id", "lead"], how="left")
    res = res.astype({"issue_yr": "int16", "issue_mo": "int8", "target_yr": "int16", "target_mo": "int8", "lead": "int8",
                      "p": "float32", "p_clim": "float32", "bss": "float32"})
    res = fair_outlook_rows(res, cv_all)                  # bss against a fixed 50% chance; the old score is bss_clim
    with C.atomic(D.out("outlook.parquet")) as tmp:
        res.to_parquet(tmp, index=False)
    with C.atomic(D.out("outlook_cv.parquet")) as tmp:
        cv_all[["kind", "id", "lead", "yr", "mo", "target_yr", "target_mo", "in_season", "p", "p_clim", "above", "y0"]].to_parquet(tmp, index=False)
    fair = fair_summary(cv_all, con, log)
    imp = pd.Series(model.feature_importance("gain"), index=FEATURES)
    summary = {"issued_from": f"{iy}-{im:02d}", "areas": int(res[["kind", "id"]].drop_duplicates().shape[0]), "score": score,
               "feature_gain_pct": (100 * imp / imp.sum()).round(1).sort_values(ascending=False).to_dict(),
               "share_of_areas_with_skill": {f"lead {L}": round(float((by_area[by_area.lead == L].bss > 0).mean()), 3) for L in LEADS},
               "score_fair": fair,
               "share_of_areas_with_skill_fair": {f"lead {L}": fair[f"lead {L}"]["share_of_areas_with_skill"] for L in LEADS},
               "dashboard_list_gate": list_gate(res),
               "seconds": round(time.time() - t0)}
    with C.atomic(C.REPO / "models" / "outlook.json") as tmp:
        tmp.write_text(json.dumps(summary, indent=1))
    return summary
