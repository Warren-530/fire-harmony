"""Step 6: harmonization, one record on the NOAA-20 VIIRS scale from 2000 to today.

The reference ("what NOAA-20 VIIRS would have counted") per cell and month:
  * VIIRS era: every VIIRS satellite that flew that month, each scaled to NOAA-20 by a regional
    ratio learned on the months they flew together, then averaged. More satellites never mean more
    fire, because we average instead of adding (the fleet rule). Counts are divided by the share
    of days with data, so a satellite outage does not look like a quiet month.
  * MODIS era (Nov 2000 to Dec 2011): predicted from MODIS by the harmonization model. Two feature
    sets bridge both seams straight to the VIIRS scale: Terra + Aqua (from Jul 2002) and Terra only
    (Nov 2000 to Jun 2002).
The model is trained on 2012 to 2019, when both MODIS orbits were still at their nominal times, like
the years we back-cast.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config as C
from . import features as FE
from . import panel as PA

TRAIN_YEARS = (2012, 2019)
MIN_COV = 0.5                       # a satellite counts for a month only if it delivered data on >= half its days
BRIDGE_REGION_LEVEL = 1             # H3 level-1 regions (~600,000 km2) for the VIIRS satellite ratios
BRIDGE_PSEUDO = 2000                # shrink each regional ratio towards the global one with this many detections


def panel_sql(years, where: str = "TRUE", cols: str = "*") -> str:
    files = [str(PA.panel_path(y)) for y in years if PA.panel_path(y).exists()]
    if not files:
        raise FileNotFoundError("no panel files: run `fireharmony panel` first")
    return f"SELECT {cols} FROM read_parquet({files}) WHERE {where}"


# ------------------------------------------------------------------------------------------ VIIRS bridge
def bridge_ratios(con=None, sat: str = "S", years=range(2018, 2027)) -> pd.DataFrame:
    """Ratio NOAA-20 / satellite `sat` per region, learned on months where both flew (cov >= 0.9).
    Uses the mask-rule count for both satellites, so science quality and near real time rows are treated
    the same way. Regional ratios are shrunk towards the global ratio (empirical Bayes style)."""
    con = con or C.connect()
    df = con.execute(f"""
      SELECT h3_cell_to_parent(cell, {BRIDGE_REGION_LEVEL}) AS region, sum(N_nm) AS n20, sum({sat}_nm) AS other
      FROM ({panel_sql(years, f"cov_N >= 0.9 AND cov_{sat} >= 0.9", f"cell, N_nm, {sat}_nm")})
      GROUP BY region""").df()
    k_global = df.n20.sum() / df.other.sum()
    df["k"] = (df.n20 + BRIDGE_PSEUDO * k_global) / (df.other + BRIDGE_PSEUDO)
    df.attrs["k_global"] = k_global
    return df[["region", "n20", "other", "k"]]


def viirs_reference(df: pd.DataFrame, k: dict[str, pd.DataFrame]) -> pd.Series:
    """NOAA-20 scale per-satellite average of the observed VIIRS counts (NaN where no VIIRS flew)."""
    region = pd.Series(df["region1"].to_numpy())
    parts, used = [], []
    for sat in ("N", "S", "J"):
        cov = df[f"cov_{sat}"].to_numpy()
        ok = cov >= MIN_COV
        scale = 1.0 if sat == "N" else region.map(k[sat].set_index("region")["k"]).fillna(k[sat].attrs["k_global"]).to_numpy()
        val = np.where(ok, df[f"{sat}_n"].to_numpy() / np.where(ok, cov, 1) * scale, 0.0)
        parts.append(val); used.append(ok.astype(float))
    n_used = np.sum(used, axis=0)
    return pd.Series(np.where(n_used > 0, np.sum(parts, axis=0) / np.maximum(n_used, 1), np.nan), index=df.index)


# ------------------------------------------------------------------------------------------ features
STATIC_COLS = ["lat", "peat_frac", "pop_density_2020"] + [f"lc_{g}" for g in FE.LC_GROUPS]
BIOMES = [f"{z} {g}" for z in ("tropical", "subtropical", "temperate", "boreal") for g in FE.LC_GROUPS]


def static_features(con=None) -> pd.DataFrame:
    s = pd.read_parquet(FE.out_path(f"cell_static_l{FE.LVL}"), columns=["cell", "biome", "continent", *STATIC_COLS])
    s["abs_lat"] = s["lat"].abs()
    s["log_pop"] = np.log10(1 + s.pop("pop_density_2020"))
    num = s.select_dtypes("number").columns.drop("cell")
    s[num] = s[num].astype(np.float32)
    return s


def modis_features(df: pd.DataFrame, terra_only: bool = False) -> pd.DataFrame:
    """Model inputs that exist in every MODIS month. Counts are divided by the share of days with data."""
    sats = ["T"] if terra_only else ["T", "A"]
    X = pd.DataFrame(index=df.index)
    for s in sats:
        cov = df[f"cov_{s}"].clip(lower=MIN_COV)
        for m in ("n", "nd", "nn", "ns", "nl", "frp", "fd", "c7"):
            X[f"{s}_{m}"] = df[f"{s}_{m}"] / cov
        X[f"{s}_pix"] = df[f"{s}_pix"]
        X[f"{s}_frp_per_det"] = df[f"{s}_frp"] / df[f"{s}_n"].where(df[f"{s}_n"] > 0)
    tag = "t" if terra_only else "m"
    for c in (f"ctx4_{tag}", f"ctx3_{tag}", f"clim_{tag}"):
        X[c[:-2]] = df[c]
    X["mo_sin"] = np.sin(2 * np.pi * df["mo"] / 12)
    X["mo_cos"] = np.cos(2 * np.pi * df["mo"] / 12)
    return X


# ------------------------------------------------------------------------------------------ data
# Only the columns the models and the VIIRS reference use, as 4-byte floats: about 5 times less memory.
_F = lambda c: f"CAST({c} AS FLOAT) AS {c}"
MODEL_COLS = ", ".join(
    ["cell", "yr", "mo"]
    + [_F(f"{s}_{m}") for s in ("T", "A") for m in ("n", "nd", "nn", "ns", "nl", "frp", "fd", "c7", "pix")]
    + [_F(f"{s}_n") for s in ("S", "N", "J")]
    + [_F(f"cov_{s}") for s in ("T", "A", "S", "N", "J")]
    + [_F(c) for c in ("ctx4_m", "ctx3_m", "ctx4_t", "ctx3_t", "clim_m", "clim_t")])
def load(years, cell_frac: float = 1.0, zero_rate: float = 0.05, con=None, bucket_from: float = 0.0) -> pd.DataFrame:
    """Panel rows for `years`, joined with cell facts.

    Rows where no satellite saw anything are kept at `zero_rate` and weighted 1 / zero_rate, so totals stay
    unbiased while memory stays low. `cell_frac` keeps a fixed, hash-based share of whole level-3 regions
    (12,400 km2 blocks, the same blocks every time). Testing on whole blocks is more honest than testing on
    scattered cells, because errors in neighbouring cells are related and app users draw whole areas."""
    con = con or C.connect()
    active = "(T_n + A_n + S_n + N_n + J_n) > 0"
    df = con.execute(f"""
      SELECT {MODEL_COLS}, h3_cell_to_parent(cell, {BRIDGE_REGION_LEVEL}) AS region1, h3_cell_to_parent(cell, 3) AS region3,
             CASE WHEN {active} THEN 1.0 ELSE {1 / zero_rate} END AS w,
             hash(h3_cell_to_parent(cell, 3)) % 1000 AS cell_bucket
      FROM ({panel_sql(years)})
      WHERE hash(h3_cell_to_parent(cell, 3)) % 1000 BETWEEN {int(bucket_from * 1000)} AND {int(cell_frac * 1000) - 1}
        AND ({active} OR hash(cell, yr, mo) % 100000 < {int(zero_rate * 100000)})""").df()
    return df.merge(static_features(), on="cell", how="left")


def design(df: pd.DataFrame, terra_only: bool = False) -> pd.DataFrame:
    X = modis_features(df, terra_only)
    for c in STATIC_COLS:
        if c != "pop_density_2020":
            X[c] = df[c]
    X["abs_lat"], X["log_pop"] = df["abs_lat"], df["log_pop"]
    X["biome"] = pd.Categorical(df["biome"], categories=BIOMES)   # fixed list: same codes in training and prediction
    return X


def modis_total(df: pd.DataFrame, terra_only: bool = False) -> pd.Series:
    """Per-satellite MODIS count, coverage corrected: Terra alone, or the mean of Terra and Aqua."""
    t = df["T_n"] / df["cov_T"].clip(lower=MIN_COV)
    if terra_only:
        return t.where(df["cov_T"] >= MIN_COV)
    a = df["A_n"] / df["cov_A"].clip(lower=MIN_COV)
    both = (df["cov_T"] >= MIN_COV) & (df["cov_A"] >= MIN_COV)
    return ((t + a) / 2).where(both)


# ------------------------------------------------------------------------------------------ models
class RatioModel:
    """Level 1 of the ladder: VIIRS / MODIS exchange rate per region and calendar month, shrunk towards
    the region's all-year rate and then the global rate. MODIS zero means a prediction of zero."""

    def __init__(self, terra_only=False, region="region1", pseudo=200.0):
        self.terra_only, self.region, self.pseudo = terra_only, region, pseudo

    def fit(self, df, y, w):
        m = modis_total(df, self.terra_only).fillna(0) * w
        d = pd.DataFrame({"r": df[self.region], "mo": df["mo"], "y": y * w, "m": m})
        self.g = d.y.sum() / d.m.sum()
        reg = d.groupby("r")[["y", "m"]].sum()
        self.reg = (reg.y + self.pseudo * self.g) / (reg.m + self.pseudo)
        rm = d.groupby(["r", "mo"])[["y", "m"]].sum().reset_index()
        prior = rm.r.map(self.reg)
        rm["k"] = (rm.y + self.pseudo * prior) / (rm.m + self.pseudo)
        self.rm = rm.set_index(["r", "mo"])["k"]
        return self

    def predict(self, df):
        idx = pd.MultiIndex.from_arrays([df[self.region], df["mo"]])
        k = pd.Series(self.rm.reindex(idx).to_numpy(), index=df.index)
        k = k.fillna(df[self.region].map(self.reg)).fillna(self.g)
        return (modis_total(df, self.terra_only).fillna(0) * k).to_numpy()


class GBMModel:
    """Level 3 of the ladder: LightGBM with a Poisson loss on MODIS detail, MODIS context and cell facts."""

    PARAMS = dict(objective="poisson", learning_rate=0.05, num_leaves=127, min_data_in_leaf=200,
                  feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0,
                  max_bin=255, verbose=-1, num_threads=4, seed=7)

    def __init__(self, terra_only=False, rounds=600, **params):
        self.terra_only, self.rounds = terra_only, rounds
        self.params = {**self.PARAMS, **params}

    def fit(self, df, y, w):
        import lightgbm as lgb
        X = design(df, self.terra_only)
        self.cols = list(X.columns)
        self.booster = lgb.train(self.params, lgb.Dataset(X, y, weight=w, free_raw_data=True), self.rounds)
        return self

    def predict(self, df):
        X = design(df, self.terra_only)[self.cols]
        # explicit thread count: a booster loaded from file otherwise uses every core, and two processes
        # predicting side by side then fight for the CPU (load 20 on 12 cores, four times slower)
        return self.booster.predict(X, num_threads=int(self.params.get("num_threads", 4)))

    @classmethod
    def load(cls, path, terra_only: bool):
        import lightgbm as lgb
        m = cls(terra_only=terra_only)
        m.booster = lgb.Booster(model_file=str(path))
        m.cols = m.booster.feature_name()
        return m


# ------------------------------------------------------------------------------------------ cross validation
FOLDS = [(2012, 2013), (2014, 2015), (2016, 2017), (2018, 2019)]
SCALES = {"cell x month": ["cell", "yr", "mo"], "region L4 x month": ["region4", "yr", "mo"],
          "region L3 x month": ["region3", "yr", "mo"], "continent x month": ["continent", "yr", "mo"],
          "world x month": ["yr", "mo"], "region L3 x year": ["region3", "yr"], "continent x year": ["continent", "yr"]}


def add_target(df: pd.DataFrame, k: dict) -> pd.DataFrame:
    df["y"] = viirs_reference(df, k)
    return df[df["y"].notna()].reset_index(drop=True)


def _totals(t: pd.DataFrame, p: np.ndarray, by: list[str]) -> pd.DataFrame:
    d = pd.DataFrame({"y": t["y"].to_numpy() * t["w"].to_numpy(), "p": p * t["w"].to_numpy()})
    for b in by:
        d[b] = t[b].to_numpy()
    g = d.groupby(by, observed=True)[["y", "p"]].sum().reset_index()
    return g[(g.y > 0) | (g.p > 0)]


RECONCILE_BY = ["region1", "yr", "mo"]
RECONCILE_CAP = (0.5, 2.0)


def reconcile(df: pd.DataFrame, p_fine: np.ndarray, p_coarse: np.ndarray, by=RECONCILE_BY) -> np.ndarray:
    """Top-down reconciliation: keep the fine model's map (how fire spreads over hexagons, including cells MODIS saw
    as empty) but scale it so each large region's monthly total matches the coarse model (the exchange rate per
    region and month, which is calibrated on regional totals). Where the coarse total is zero (MODIS saw nothing in
    the whole region that month) the fine model is kept. The scale factor is capped at 0.5 to 2 so a noisy regional
    total cannot distort the map. Sampling weights `w` are used when the frame has them."""
    w = df["w"].to_numpy() if "w" in df.columns else np.ones(len(df))
    d = pd.DataFrame({k: df[k].to_numpy() for k in by})
    d["f"], d["c"] = np.nan_to_num(p_fine) * w, np.nan_to_num(p_coarse) * w
    g = d.groupby(by, observed=True)[["f", "c"]].transform("sum")
    scale = np.where((g.f > 0) & (g.c > 0), g.c / g.f.where(g.f > 0, 1), 1.0)
    return p_fine * np.clip(scale, *RECONCILE_CAP)


def _score_fold(t, p, name, fold, rows, totals, log):
    for scale, by in SCALES.items():
        g = _totals(t, p, by)
        rows.append({"fold": f"{fold[0]}-{fold[1]}", "model": name, "scale": scale, **score_totals(g)})
        if scale == "cell x month":
            g = g.sample(min(len(g), 100_000), random_state=0)
        totals.append(g[["y", "p"]].assign(model=name, scale=scale, fold=fold[0]))
    r = {x["scale"]: x for x in rows[-len(SCALES):]}
    log(f"  fold {fold} {name:10s} world-month bias {r['world x month']['bias_pct']:+5.1f}%  "
        f"L3-month CCC {r['region L3 x month']['lin_ccc_log']:.3f}  L3-month median error {r['region L3 x month']['median_abs_rel_err_pct']:.0f}%  "
        f"continent-month median error {r['continent x month']['median_abs_rel_err_pct']:.1f}%")


def cross_validate(models: dict, train_frac=0.2, test_frac=0.2, zero_rate=0.05, con=None, log=print):
    """Blocked hold-out: for each pair of years, train on the other training years using one set of level-3
    regions, then score the held-out years on different regions (new years and new places at once).
    When both gbm_X and ratio_X are given, the reconciled hybrid_X is scored too (from the same predictions).

    Training rows are sampled (empty rows at `zero_rate`, weighted), but the held-out rows are NOT: every cell and
    month of the test regions is loaded, so every score and every calibration total is exact at all scales. (With
    sampled test rows a single kept empty cell month stood for 20 cells, which distorted cell and small-area totals.)

    Returns (scores, totals): agreement scores per fold, model and scale, and the out-of-fold totals
    (observed y, predicted p) per scale, used to calibrate the area intervals."""
    con = con or C.connect()
    k = {"S": bridge_ratios(con, "S"), "J": bridge_ratios(con, "J", range(2024, 2027))}
    a, b = TRAIN_YEARS
    train_all = add_target(load(range(a, b + 1), cell_frac=train_frac, zero_rate=zero_rate, con=con), k)
    log(f"training rows: {len(train_all):,}; bridge k_S global {k['S'].attrs['k_global']:.3f}, k_J global {k['J'].attrs['k_global']:.3f}")
    rows, totals = [], []
    for fold in FOLDS:
        tr = train_all[~train_all.yr.isin(fold).to_numpy()]
        te = add_target(load(fold, cell_frac=train_frac + test_frac, bucket_from=train_frac, zero_rate=1.0, con=con), k)
        te["region4"] = _parent(con, te["cell"].to_numpy(), 4)
        log(f"  fold {fold}: {len(tr):,} training rows, {len(te):,} held-out rows (unsampled)")
        preds = {}
        for name, make in models.items():
            m = make().fit(tr, tr["y"].to_numpy(), tr["w"].to_numpy())
            t = te[modis_total(te, getattr(m, "terra_only", False)).notna().to_numpy()]
            p = m.predict(t)
            preds[name] = (t.index, p)
            _score_fold(t, p, name, fold, rows, totals, log)
            del m
        for x in ("ta", "t"):
            if f"gbm_{x}" in preds and f"ratio_{x}" in preds:
                (ig, pg), (ir, pr) = preds[f"gbm_{x}"], preds[f"ratio_{x}"]
                assert ig.equals(ir)
                t = te.loc[ig]
                _score_fold(t, reconcile(t, pg, pr), f"hybrid_{x}", fold, rows, totals, log)
        del te, preds
    return pd.DataFrame(rows), pd.concat(totals, ignore_index=True)


def _parent(con, cells: np.ndarray, level: int) -> np.ndarray:
    con.register("_cells", pd.DataFrame({"c": cells}))
    out = con.execute(f"SELECT h3_cell_to_parent(c, {level}) AS p FROM _cells").fetchnumpy()["p"]
    con.unregister("_cells")
    return out


def score_totals(g: pd.DataFrame) -> dict:
    ly, lp = np.log1p(g.y), np.log1p(g.p)
    ccc = 2 * np.cov(ly, lp)[0, 1] / (ly.var() + lp.var() + (ly.mean() - lp.mean()) ** 2)
    return {"units": len(g), "bias_pct": float(100 * (g.p.sum() / g.y.sum() - 1)),
            "mae_log": float(np.mean(np.abs(ly - lp))), "lin_ccc_log": float(ccc),
            "spearman": float(g.y.rank().corr(g.p.rank())),
            "median_abs_rel_err_pct": float(100 * np.median(np.abs(g.p - g.y) / g.y.clip(lower=1)))}


# ------------------------------------------------------------------------------------------ intervals
class AreaInterval:
    """90% range for the total of any area and period, from a small lookup table (cheap for the browser).

    Mondrian split conformal: held-out totals are grouped into bands of predicted size (half decades of mu),
    and each band gets its own quantiles of the relative error (obs - mu) / mu. The range is then
    [mu * (1 + q_lo), mu * (1 + q_hi)], cut at zero. Coverage holds within every size band, so a village and a
    continent both get honest ranges. (A single variance curve sqrt(a*mu + b*mu^2) was tried first: fitted on
    1.3 million small units, it covered only about half of continent and world totals, because errors of
    neighbouring cells are related and do not average out as fast as the curve assumes.)"""

    EDGES = [0.0] + [10 ** (k / 2) for k in range(0, 15)] + [np.inf]     # 0, 1, 3.2, 10, ..., 1e7, inf
    MIN_UNITS = 40

    def fit(self, mu: np.ndarray, obs: np.ndarray, level: float = 0.9):
        mu, obs = np.asarray(mu, float), np.asarray(obs, float)
        ok = mu > 0
        mu, obs = mu[ok], obs[ok]
        r = (obs - mu) / mu
        self.level, self.bands = level, []
        lo_e = self.EDGES[0]
        idx = np.digitize(mu, self.EDGES[1:-1])
        pending = []
        for b in range(len(self.EDGES) - 1):
            pending.extend(r[idx == b])
            last = b == len(self.EDGES) - 2
            if len(pending) >= self.MIN_UNITS or (last and pending):
                rr = np.sort(np.asarray(pending))
                n = len(rr)
                lo_k = max(int(np.floor((n + 1) * (1 - level) / 2)) - 1, 0)
                hi_k = min(int(np.ceil((n + 1) * (1 + level) / 2)) - 1, n - 1)
                self.bands.append({"mu_min": lo_e, "mu_max": self.EDGES[b + 1], "q_lo": float(rr[lo_k]),
                                   "q_hi": float(rr[hi_k]), "units": n})
                lo_e, pending = self.EDGES[b + 1], []
        if pending and self.bands:                                       # leftovers join the last band
            self.bands[-1]["units"] += len(pending)
        if len(self.bands) >= 2 and self.bands[-1]["units"] < self.MIN_UNITS:
            # the top band (largest areas) closed with too few units for a reliable 90% quantile: merge it down
            last, prev = self.bands.pop(), self.bands.pop()
            sel = mu >= prev["mu_min"]
            rr = np.sort(r[sel]); n = len(rr)
            lo_k = max(int(np.floor((n + 1) * (1 - level) / 2)) - 1, 0)
            hi_k = min(int(np.ceil((n + 1) * (1 + level) / 2)) - 1, n - 1)
            self.bands.append({"mu_min": prev["mu_min"], "mu_max": last["mu_max"], "q_lo": float(rr[lo_k]),
                               "q_hi": float(rr[hi_k]), "units": n})
        return self

    def _q(self, mu):
        mu = np.atleast_1d(np.asarray(mu, float))
        lo = np.array([b["mu_min"] for b in self.bands])
        i = np.clip(np.searchsorted(lo, mu, side="right") - 1, 0, len(self.bands) - 1)
        return mu, np.array([self.bands[k]["q_lo"] for k in i]), np.array([self.bands[k]["q_hi"] for k in i])

    def bounds(self, mu):
        mu, ql, qh = self._q(mu)
        return np.maximum(0, mu * (1 + ql)), mu * (1 + qh)

    def coverage(self, mu, obs):
        lo, hi = self.bounds(mu)
        obs = np.asarray(obs, float)
        return float(np.mean((obs >= lo) & (obs <= hi)))

    def to_dict(self):
        return {"method": "mondrian split conformal on relative error, bands of predicted total", "level": self.level,
                "bands": [{k: (None if v == np.inf else v) for k, v in b.items()} for b in self.bands]}

    @classmethod
    def from_dict(cls, d):
        ai = cls()
        ai.level = d["level"]
        ai.bands = [{k: (np.inf if v is None else v) for k, v in b.items()} for b in d["bands"]]
        return ai


def fit_intervals(totals: pd.DataFrame, models=(("gbm_ta", "terra_aqua"), ("gbm_t", "terra_only"))) -> dict:
    """Area intervals per era (Terra + Aqua, Terra only) and period (month, year) from the out-of-fold CV totals."""
    out = {}
    for model, key in models:
        for period in ("month", "year"):
            t = totals[(totals.model == model) & totals.scale.str.endswith(period)]
            if t.empty:
                raise ValueError(f"no cross validation totals for model {model}: run `fireharmony cv` first")
            ai = AreaInterval().fit(t.p.to_numpy(), t.y.to_numpy())
            # honest coverage: calibrate on three folds, test on the fourth, for each fold in turn
            held = {}
            for fold in sorted(t.fold.unique()):
                cal, test = t[t.fold != fold], t[t.fold == fold]
                fa = AreaInterval().fit(cal.p.to_numpy(), cal.y.to_numpy())
                for sc, g in test.groupby("scale"):
                    held.setdefault(sc, []).append(fa.coverage(g.p.to_numpy(), g.y.to_numpy()))
            out[f"{key}_{period}"] = {**ai.to_dict(), "calibration_units": int(len(t)),
                                      "coverage_by_scale": {sc: round(float(np.mean(v)), 3) for sc, v in held.items()},
                                      "coverage_note": "share of held-out totals inside their 90% range, calibrating on the other folds"}
    return out


# ------------------------------------------------------------------------------------------ production
SOURCES = {0: "viirs_observed", 1: "model_terra_aqua", 2: "model_terra_only", 3: "no_data"}


def harmonized_path(year: int):
    return C.work("harmonized_l5", f"year={year}", "data.parquet")


def harmonize_year(year: int, models: dict, k: dict, modis_eq_model, con=None, min_keep: float = 0.005) -> dict:
    """The harmonized record for one year, month by month (memory stays low).

    h        harmonized detections on the NOAA-20 VIIRS scale (observed VIIRS where it exists, else modelled)
    source   0 VIIRS observed, 1 Terra + Aqua model, 2 Terra only model, 3 no data
    pred_ta, pred_t   the model values (also in the VIIRS era, for the seam and validation checks)
    modis_eq          the same record on the MODIS scale (per satellite average of Terra and Aqua)
    Rows where h and both model values are below `min_keep` and no satellite saw anything are not stored."""
    con = con or C.connect()
    stat = static_features()
    parts = []
    for mo in PA.months_of(year, con):
        df = con.execute(f"""SELECT {MODEL_COLS}, h3_cell_to_parent(cell, {BRIDGE_REGION_LEVEL}) AS region1,
                                    h3_cell_to_parent(cell, 3) AS region3
                             FROM ({panel_sql([year], f"mo = {mo}")})""").df().merge(stat, on="cell", how="left")
        v = viirs_reference(df, k)
        ta_ok = modis_total(df).notna()
        t_ok = modis_total(df, terra_only=True).notna()
        pred_ta = np.full(len(df), np.nan)
        pred_t = np.full(len(df), np.nan)
        if ta_ok.any():
            pred_ta[ta_ok.to_numpy()] = models["terra_aqua"].predict(df[ta_ok])
        # The Terra only model is the record where Aqua is missing; elsewhere it is only needed for the checks
        # (the 2002 seam, and the comparison with VIIRS in 2012 to 2019). Prediction is 98% of the run time.
        need_t = (t_ok & ~ta_ok) if not (year <= 2005 or 2012 <= year <= 2019) else t_ok
        if need_t.any():
            pred_t[need_t.to_numpy()] = models["terra_only"].predict(df[need_t])
        h = np.where(v.notna(), v, np.where(ta_ok, pred_ta, pred_t))
        src = np.select([v.notna(), ta_ok, t_ok], [0, 1, 2], 3)
        meq = modis_total(df).to_numpy()
        meq = np.where(np.isnan(meq), modis_eq_model.predict(df) if t_ok.any() else np.nan, meq)
        meq = np.where(t_ok | ta_ok, meq, np.nan)
        out = pd.DataFrame({"cell": df.cell.to_numpy(), "yr": year, "mo": mo, "h": h.astype(np.float32), "source": src.astype(np.int8),
                            "v_obs": v.to_numpy(np.float32), "pred_ta": pred_ta.astype(np.float32), "pred_t": pred_t.astype(np.float32),
                            "modis_eq": meq.astype(np.float32),
                            **{f"{s}_n": df[f"{s}_n"].to_numpy(np.int32) for s in PA.SATS}})
        raw_any = out[[f"{s}_n" for s in PA.SATS]].sum(axis=1) > 0
        # keep a row if anything is non negligible: in VIIRS years h is 0 where VIIRS saw nothing, but the model
        # values must stay so the model can be compared with VIIRS in those empty cells too
        keep = raw_any | (np.nan_to_num(h) >= min_keep) | (np.nan_to_num(pred_ta) >= min_keep) | (np.nan_to_num(pred_t) >= min_keep)
        parts.append((out[keep], float(np.nansum(h)), float(np.nansum(h[keep.to_numpy()]))))
    res = pd.concat([p[0] for p in parts], ignore_index=True)
    p = harmonized_path(year)
    with C.atomic(p) as tmp:
        res.to_parquet(tmp, index=False)
    total, kept = sum(x[1] for x in parts), sum(x[2] for x in parts)
    return {"year": year, "rows": len(res), "h_total": round(total), "share_of_h_kept": round(kept / total, 5) if total else None,
            "pred_ta_total": round(float(res.pred_ta.sum())),
            "by_source": res.groupby("source")["h"].sum().round().astype(int).rename(SOURCES).to_dict()}


# ------------------------------------------------------------------------------------------ Terra only bridge
AQUA_START = 200207                 # before this month (yyyymm) the record is the Terra only model
TERRA_BRIDGE = (200207, 200506)     # the bridge is learned in the three years after Aqua joined


def terra_only_bridge(con=None, months=TERRA_BRIDGE) -> pd.DataFrame:
    """Ratio of the Terra + Aqua model to the Terra only model per level 1 region, learned on the months of `months`
    when Terra and Aqua both flew on 90% or more of the days. Shrunk towards the global ratio like the VIIRS bridges.

    Why: the two models agree within 1.5% for the world in the training years (2013 to 2019), but in 2002 to 2005
    the Terra only model reads about 4% lower, and the regions differ more (South America 11%, Asia 6%). The gap
    drifts slowly over the years, so we learn it right after the seam. The record uses the Terra only model before
    July 2002 and the Terra + Aqua model after it; without the bridge it would step where Aqua joins."""
    con = con or C.connect()
    a, b = months
    df = con.execute(f"""
      WITH f AS (SELECT yr, mo FROM '{C.work('gold', 'fleet_month.parquet')}' WHERE satellite IN ('Terra', 'Aqua')
                 GROUP BY yr, mo
                 HAVING count(DISTINCT satellite) = 2
                    AND min(days_with_data / day(last_day(make_date(yr::INT, mo::INT, 1)))) >= 0.9)
      SELECT h3_cell_to_parent(h.cell, {BRIDGE_REGION_LEVEL}) AS region, sum(h.pred_ta) AS ta, sum(h.pred_t) AS t
      FROM read_parquet('{C.work("harmonized_l5", "year=*", "data.parquet")}') h JOIN f USING (yr, mo)
      WHERE h.yr * 100 + h.mo BETWEEN {a} AND {b} AND h.pred_ta IS NOT NULL AND h.pred_t IS NOT NULL
      GROUP BY region""").df()
    k_global = df.ta.sum() / df.t.sum()
    df["k"] = (df.ta + BRIDGE_PSEUDO * k_global) / (df.t + BRIDGE_PSEUDO)
    df.attrs["k_global"] = float(k_global)
    return df[["region", "ta", "t", "k"]]


def bridge_year(year: int, k: pd.DataFrame, con=None) -> dict:
    """Put the Terra only months before July 2002 on the Terra + Aqua footing: h = pred_t x k of the region.
    Starts from the stored model value, so running it twice gives the same result."""
    if year * 100 + 1 >= AQUA_START:
        return {"year": year, "bridged_rows": 0}
    con = con or C.connect()
    p = harmonized_path(year)
    con.register("k_bridge", k[["region", "k"]])
    pre = f"h.source = 2 AND h.yr * 100 + h.mo < {AQUA_START}"
    before, after, n = con.execute(f"""
      SELECT sum(h.h) FILTER (WHERE {pre}), sum(h.pred_t * coalesce(k.k, {k.attrs['k_global']})) FILTER (WHERE {pre}),
             count(*) FILTER (WHERE {pre})
      FROM read_parquet('{p}') h LEFT JOIN k_bridge k ON k.region = h3_cell_to_parent(h.cell, {BRIDGE_REGION_LEVEL})""").fetchone()
    with C.atomic(p) as tmp:
        con.execute(f"""
          COPY (SELECT h.* REPLACE (CASE WHEN {pre} THEN (h.pred_t * coalesce(k.k, {k.attrs['k_global']}))::FLOAT ELSE h.h END AS h)
                FROM read_parquet('{p}') h
                LEFT JOIN k_bridge k ON k.region = h3_cell_to_parent(h.cell, {BRIDGE_REGION_LEVEL})
                ORDER BY h.mo, h.cell)
          TO '{tmp}' (FORMAT parquet)""")
    con.unregister("k_bridge")
    return {"year": year, "bridged_rows": int(n), "h_before": round(float(before or 0)), "h_after": round(float(after or 0)),
            "change_pct": round(100 * (after / before - 1), 2) if before else None}


# Neither model is reconciled in the published record. Cross validation (2012 to 2019) prefers the reconciled model,
# but its regional correction is not stable back in time: +1 to 2% in 2003 to 2011, +7% in Aqua's first year and
# +12.5% for Terra only, which puts a 4 to 7% step into the record at July 2002 against the Terra witness. The plain
# model is steadier (see validation.json for its steps at 2002 and 2012), so the record uses it.
RECONCILED = ()


def reconcile_year(year: int, ratios: dict, con=None, which=RECONCILED) -> dict:
    """Apply top-down reconciliation to one year of the harmonized record, in place (atomic).

    The plain model values are kept in gbm_ta / gbm_t, and reconciliation always starts from them, so running it
    twice gives the same result. pred_ta / pred_t become the reconciled values, and h follows them in the modelled
    months (source 1 and 2). Observed VIIRS months are not touched.

    Only the Terra + Aqua model is reconciled. For the Terra only model the exchange rate learned in 2012 to 2019 does
    not carry back to 2000 to 2002: it lifted 2001 by 12.5% above the plain model and made the record step by 7%
    against the Terra witness at July 2002, where the plain model steps by 0.1%."""
    con = con or C.connect()
    path = harmonized_path(year)
    df = pd.read_parquet(path)
    for col in ("ta", "t"):
        if f"gbm_{col}" not in df.columns:
            df[f"gbm_{col}"] = df[f"pred_{col}"]
    cov = con.execute(f"SELECT DISTINCT mo, cov_T, cov_A FROM '{PA.panel_path(year)}'").df()
    df = df.merge(cov, on="mo", how="left")
    df["region1"] = _parent(con, df["cell"].to_numpy(), BRIDGE_REGION_LEVEL)
    for col, key in (("ta", "terra_aqua"), ("t", "terra_only")):
        ok = df[f"gbm_{col}"].notna().to_numpy()
        new = df[f"gbm_{col}"].to_numpy(np.float64, copy=True)
        if ok.any() and col in which:
            sub = df[ok]
            new[ok] = reconcile(sub, sub[f"gbm_{col}"].to_numpy(np.float64), ratios[key].predict(sub))
        df[f"pred_{col}"] = new.astype(np.float32)
    df["h"] = np.where(df.source == 1, df.pred_ta, np.where(df.source == 2, df.pred_t, df.h)).astype(np.float32)
    df = df.drop(columns=["cov_T", "cov_A", "region1"] + ([] if which else ["gbm_ta", "gbm_t"]))   # plain values: no copies
    with C.atomic(path) as tmp:
        df.to_parquet(tmp, index=False)
    return {"year": year, "reconciled": list(which), "h_total": round(float(df.h.sum())), "pred_ta_total": round(float(df.pred_ta.sum()))}
