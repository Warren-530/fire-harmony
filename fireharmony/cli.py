"""Command line entry points:  fireharmony clean --years 2019 2020   (or no --years for all)."""
from __future__ import annotations

import json
from typing import List, Optional

import duckdb
import numpy as np
import pandas as pd
import typer

from . import aggregate as AG
from . import clean as CL
from . import config as C
from . import features as FE
from . import panel as PA
from . import static_mask as SM

app = typer.Typer(add_completion=False, help="Fire Harmony data pipeline")


@app.callback()
def _guard(ctx: typer.Context):
    """Before every command: refuse to run on a nearly full C: drive. After it: hand freed space back to Windows."""
    if ctx.invoked_subcommand not in (None, "info"):
        C.require_free_space()
        ctx.call_on_close(C.release_space)


def _silver_ok(year: int) -> bool:
    out = CL.silver_path(year)
    if not out.exists() or out.stat().st_size == 0:
        return False
    try:
        src = C.raw("firms", f"year={year}", "detections.parquet")
        a = duckdb.sql(f"SELECT count(*) FROM read_parquet('{out}')").fetchall()[0][0]
        b = duckdb.sql(f"SELECT count(*) FROM read_parquet('{src}')").fetchall()[0][0]
        return a == b
    except Exception:
        return False


@app.command()
def clean(years: Optional[List[int]] = typer.Option(None, "--years", "-y"), force: bool = False):
    """Raw FIRMS -> silver detections (one year at a time, skips verified years)."""
    con = C.connect()
    for y in years or C.years():
        if not force and _silver_ok(y):
            typer.echo(json.dumps({"year": y, "status": "already done"}))
            continue
        res = CL.clean_year(y, con)
        res["status"] = "ok" if res["rows_raw"] == res["rows_silver"] else "ROW MISMATCH"
        typer.echo(json.dumps(res), nl=True)


@app.command()
def mask(train_until: Optional[int] = typer.Option(None, help="build only from years <= this (for testing the mask)")):
    """Build the static-source mask (factories, gas flares, volcanoes, offshore)."""
    con = C.connect()
    yrs = [y for y in C.years() if train_until is None or y <= train_until]
    tag = "all" if train_until is None else f"until{train_until}"
    typer.echo(json.dumps(SM.build(yrs, tag, con)))


@app.command()
def aggregate(years: Optional[List[int]] = typer.Option(None, "--years", "-y"),
              resume: bool = typer.Option(False, help="skip years whose gold is newer than its silver and the mask")):
    """Silver -> gold summaries (cell x month x satellite) at the analysis level."""
    con = C.connect()
    for y in years or C.years():
        inputs = [SM.mask_path("all")] + [CL.silver_path(x) for x in (y - 1, y, y + 1)]
        if resume and C.is_fresh(AG.gold_path(y), inputs):
            typer.echo(json.dumps({"year": y, "status": "up to date"}))
            continue
        typer.echo(json.dumps(AG.aggregate_year(y, con)))
    silver = [CL.silver_path(y) for y in C.years()]
    if not (resume and C.is_fresh(C.work("gold", "fleet_month.parquet"), silver)):
        typer.echo(json.dumps({"fleet_table": AG.fleet(con)}))


@app.command()
def features():
    """Cell facts: land cover, peat, population, country / state, biome (needs gold)."""
    typer.echo(json.dumps(FE.build(C.connect())))


@app.command()
def panel(years: Optional[List[int]] = typer.Option(None, "--years", "-y"),
          static: bool = typer.Option(False, "--static", help="only rebuild the cell universe and MODIS climatology"),
          resume: bool = typer.Option(False, help="skip years whose panel is newer than its inputs")):
    """Gold -> modelling panel: every fire-prone cell x every month, satellites side by side."""
    con = C.connect()
    gold = [AG.gold_path(y) for y in C.years()]
    u, clim = C.work("panel_l5", "universe.parquet"), C.work("panel_l5", "modis_climatology.parquet")
    if not (resume and C.is_fresh(u, gold) and C.is_fresh(clim, gold)):
        typer.echo(json.dumps(PA.build_static(con)))
    if static:
        return
    for y in years or C.years():
        if resume and C.is_fresh(PA.panel_path(y), [AG.gold_path(y), u, clim, C.work("gold", "fleet_month.parquet")]):
            typer.echo(json.dumps({"year": y, "status": "up to date"}))
            continue
        typer.echo(json.dumps(PA.build_year(y, con)))


def _ladder():
    from . import harmonize as H
    return {"ratio_ta": lambda: H.RatioModel(), "ratio_t": lambda: H.RatioModel(terra_only=True),
            "gbm_ta": lambda: H.GBMModel(), "gbm_t": lambda: H.GBMModel(terra_only=True)}


@app.command()
def cv(train_frac: float = 0.2, test_frac: float = 0.2):
    """Score the harmonization ladder on held-out years and held-out regions."""
    from . import harmonize as H
    scores, totals = H.cross_validate(_ladder(), train_frac, test_frac, con=C.connect(), log=typer.echo)
    for name, df in (("cv_scores", scores), ("cv_totals", totals)):
        with C.atomic(C.work("models", f"{name}.parquet")) as tmp:
            df.to_parquet(tmp, index=False)
    summary = scores.groupby(["scale", "model"])[["bias_pct", "lin_ccc_log", "median_abs_rel_err_pct"]].mean().round(3)
    typer.echo(summary.to_string())


@app.command()
def harmonize(cell_frac: float = 0.35, years: Optional[List[int]] = typer.Option(None, "--years", "-y"),
              from_saved: bool = typer.Option(False, help="use the models already saved in models/ (no training)")):
    """Train the final models, calibrate the area intervals, and write the harmonized record."""
    import pickle

    import pandas as pd

    from . import harmonize as H
    con = C.connect()
    mdir = C.REPO / "models"
    mdir.mkdir(exist_ok=True)
    if from_saved:
        models = {"terra_aqua": H.GBMModel.load(mdir / "gbm_terra_aqua.txt", False),
                  "terra_only": H.GBMModel.load(mdir / "gbm_terra_only.txt", True)}
        saved = pickle.load(open(mdir / "bridges.pkl", "rb"))
        for y in years or C.years():
            typer.echo(json.dumps(H.harmonize_year(y, models, saved["k"], saved["modis_eq"], con)))
        return
    k = {"S": H.bridge_ratios(con, "S"), "J": H.bridge_ratios(con, "J", range(2024, 2027))}
    a, b = H.TRAIN_YEARS
    tr = H.add_target(H.load(range(a, b + 1), cell_frac=cell_frac, con=con), k)
    typer.echo(json.dumps({"training_rows": len(tr), "k_S": k["S"].attrs["k_global"], "k_J": k["J"].attrs["k_global"]}))
    models = {"terra_aqua": H.GBMModel().fit(tr, tr["y"].to_numpy(), tr["w"].to_numpy()),
              "terra_only": H.GBMModel(terra_only=True).fit(tr, tr["y"].to_numpy(), tr["w"].to_numpy())}
    del tr
    for name, m in models.items():
        m.booster.save_model(str(mdir / f"gbm_{name}.txt"))
    # MODIS scale toggle: Terra -> (Terra + Aqua) / 2, learned while both flew with nominal orbits
    me = H.load(range(2003, 2012), cell_frac=cell_frac, con=con)
    y_me = H.modis_total(me)
    me = me[y_me.notna()]
    modis_eq = H.RatioModel(terra_only=True).fit(me, H.modis_total(me).to_numpy(), me["w"].to_numpy())
    del me
    with open(mdir / "bridges.pkl", "wb") as f:
        pickle.dump({"k": k, "modis_eq": modis_eq}, f)
    # area intervals from the out-of-fold totals of the cross validation
    iv = H.fit_intervals(pd.read_parquet(C.work("models", "cv_totals.parquet")))
    (mdir / "area_intervals.json").write_text(json.dumps(iv, indent=1))
    typer.echo(json.dumps({k: v["coverage_by_scale"] for k, v in iv.items()}))
    for y in years or C.years():
        typer.echo(json.dumps(H.harmonize_year(y, models, k, modis_eq, con)))


@app.command()
def bridge():
    """Bridge the Terra only months before July 2002 to the Terra + Aqua model (ratios learned in 2002 to 2005)."""
    from . import harmonize as H
    con = C.connect()
    k = H.terra_only_bridge(con)
    q = k.k.quantile([0.05, 0.5, 0.95]).round(3).tolist()
    w = k[k.t >= 1e5]
    out = {"k_global": round(k.attrs["k_global"], 4), "regions": len(k), "k_5_50_95_pct": q,
           "k_range_regions_over_100k": [round(float(w.k.min()), 3), round(float(w.k.max()), 3)], "years": []}
    with C.atomic(C.REPO / "models" / "terra_only_bridge.json") as tmp:
        tmp.write_text(json.dumps({"k_global": k.attrs["k_global"], "months": list(H.TERRA_BRIDGE),
                                   "regions": {f"{int(r):x}": float(v) for r, v in zip(k.region, k.k)}}, indent=0))
    for y in C.years():
        if y * 100 + 1 < H.AQUA_START:
            out["years"].append(H.bridge_year(y, k, con))
    typer.echo(json.dumps(out, indent=1))


@app.command()
def reconcile(cell_frac: float = 0.35, years: Optional[List[int]] = typer.Option(None, "--years", "-y")):
    """Top-down reconciliation of the harmonized record (regional totals from the exchange rate, map from LightGBM),
    then area intervals from the hybrid models' cross validation."""
    import pickle

    from . import harmonize as H
    con = C.connect()
    mdir = C.REPO / "models"
    saved = pickle.load(open(mdir / "bridges.pkl", "rb"))
    a, b = H.TRAIN_YEARS
    tr = H.add_target(H.load(range(a, b + 1), cell_frac=cell_frac, con=con), saved["k"])
    ratios = {"terra_aqua": H.RatioModel().fit(tr, tr["y"].to_numpy(), tr["w"].to_numpy()),
              "terra_only": H.RatioModel(terra_only=True).fit(tr, tr["y"].to_numpy(), tr["w"].to_numpy())}
    del tr
    with open(mdir / "ratio_models.pkl", "wb") as f:
        pickle.dump(ratios, f)
    for y in years or C.years():
        typer.echo(json.dumps(H.reconcile_year(y, ratios, con)))
    iv = H.fit_intervals(pd.read_parquet(C.work("models", "cv_totals.parquet")),
                         tuple((("hybrid_" if k in H.RECONCILED else "gbm_") + k, era)
                               for k, era in (("ta", "terra_aqua"), ("t", "terra_only"))))   # follow what reconcile_year did
    (mdir / "area_intervals.json").write_text(json.dumps(iv, indent=1))
    typer.echo(json.dumps({k: v["coverage_by_scale"] for k, v in iv.items()}))


@app.command()
def validate():
    """Seam tests (2002 and 2012), change point tests and the headline figure, saved to models/ and report/."""
    from . import validate as V
    con = C.connect()
    world = V.monthly_series(con=con)
    full = world[world.yr.between(2001, 2025)]
    rep = V.seam_report(world)
    annual = full.groupby("yr").sum(numeric_only=True)
    pett = {col: V.pettitt(annual[col].to_numpy()) for col in ("naive_join", "harmonized", "modis_scale")}
    for col, r in pett.items():
        r["change_year"] = int(annual.index[r["index"]])
    t = pd.to_datetime(dict(year=full.yr, month=full.mo, day=1))
    breaks = {col: [str(t.iloc[i].date()) for i in V.pelt_breaks(V.deseasonalize(full[col], full.mo))]
              for col in ("naive_join", "harmonized", "modis_scale")}
    iv = json.loads((C.REPO / "models" / "area_intervals.json").read_text())
    fig_dir = C.REPO / "report" / "figures"
    fig_dir.mkdir(parents=True, exist_ok=True)
    figinfo = V.seam_figure(world, iv, fig_dir / "fig03_seam_test")
    near = {seam: {col: [b for b in bs if abs((pd.Timestamp(b) - pd.Timestamp(seam)).days) <= 366] for col, bs in breaks.items()}
            for seam in ("2002-07-01", "2012-01-01")}
    # same calendar months on both sides of each seam (Jul 2001 to Jun 2002 against Jul 2002 to Jun 2003, and so on);
    # the archive starts in Nov 2000, so the 2002 seam can only have a one year window
    pw = {"2002_terra_witness": {col: {"1y": V.per_witness(world, col, "terra_cc", "2002-07-01", "2001-07-01", 1)}
                                 for col in ("harmonized", "modis_scale")},
          "2012_modis_witness": {col: {f"{n}y": V.per_witness(world, col, "modis_scale", "2012-01-01", f"{2012 - n}-01-01", n) for n in (1, 3)}
                                 for col in ("harmonized", "naive_join")}}
    # placebo seams: the same one year test at boundaries with no sensor change, to see how large steps normally are
    def placebo(month: int, witness: str, years) -> dict:
        steps = {y: V.per_witness(world, "harmonized", witness, f"{y}-{month:02d}-01", f"{y - 1}-{month:02d}-01", 1)["step_pct"]
                 for y in years}
        v = np.array(list(steps.values()))
        return {"steps": steps, "mean": float(v.mean()), "sd": float(v.std(ddof=1)), "max_abs": float(np.abs(v).max())}
    plc = {"2002_terra_witness": placebo(7, "terra_cc", range(2003, 2011)),
           "2012_modis_witness": placebo(1, "modis_scale", range(2004, 2012))}
    for key, seam in (("2002_terra_witness", "1y"), ("2012_modis_witness", "1y")):
        real = pw[key]["harmonized"][seam]["step_pct"]
        plc[key]["real_step"] = real
        plc[key]["z"] = float((real - plc[key]["mean"]) / plc[key]["sd"])
    # a third witness that the VIIRS switch cannot touch: ESA Fire_cci burned area (MRBA60H, from MODIS 250 m, one
    # product for 2003 to 2018; its Sentinel-3 continuation from 2019 is left out, as it would be a seam of its own)
    from . import climate as K
    ba_w = {}
    if K.out("firecci_l3.parquet").exists():
        ba = con.execute(f"""SELECT yr::INT AS yr, mo::INT AS mo, sum(ba_km2) AS ba_km2 FROM '{K.out("firecci_l3.parquet")}'
                             WHERE product = 0 GROUP BY 1, 2""").df()
        wb = world.merge(ba, on=["yr", "mo"], how="inner")
        for n in (1, 3):
            steps = {y: V.per_witness(wb, "harmonized", "ba_km2", f"{y}-01-01", f"{y - n}-01-01", n)["step_pct"]
                     for y in range(2003 + n, 2019 - n + 1) if y != 2012}
            v = np.array(list(steps.values()))
            real = {col: V.per_witness(wb, col, "ba_km2", "2012-01-01", f"{2012 - n}-01-01", n)["step_pct"]
                    for col in ("harmonized", "modis_scale", "naive_join")}
            ba_w[f"{n}y"] = {"step_pct": real, "placebo_steps": steps, "placebo_mean": float(v.mean()),
                             "placebo_sd": float(v.std(ddof=1)), "z": float((real["harmonized"] - v.mean()) / v.std(ddof=1))}
        y = wb.groupby("yr")[["harmonized", "modis_scale", "ba_km2"]].sum()
        ba_w["hotspots_per_km2_burned"] = (y.harmonized / y.ba_km2).round(3).to_dict()
        ba_w["yearly_correlation"] = {"harmonized": float(np.corrcoef(y.harmonized, y.ba_km2)[0, 1]),
                                      "modis_scale": float(np.corrcoef(y.modis_scale, y.ba_km2)[0, 1])}
    out = {"seam_ratios": rep.round(3).to_dict(orient="records"), "per_witness": pw, "placebo_seams": plc,
           "burned_area_witness": ba_w, "pettitt_annual_2001_2025": pett,
           "pelt_breaks_monthly": breaks, "pelt_breaks_within_12_months_of_seam": near, **figinfo}
    (C.REPO / "models" / "validation.json").write_text(json.dumps(out, indent=1, default=float))
    with C.atomic(C.work("models", "world_monthly.parquet")) as tmp:
        world.to_parquet(tmp, index=False)
    typer.echo(json.dumps(out, indent=1, default=float))


@app.command()
def publish(meta_only: bool = typer.Option(False, help="only refresh the intervals and validation in meta.json"),
            extras_only: bool = typer.Option(False, help="only the drivers, outlook and haze files")):
    """Build the web app's data files (small, laid out for the browser) in data/products/v<version>/."""
    from . import publish as PB
    if meta_only:
        typer.echo(json.dumps(PB.refresh_meta(), indent=1))
        return
    from . import dashboard as DB
    if extras_only:
        rep = PB.extras()
        rep["dashboard"] = DB.build(log=lambda *a: None)
        typer.echo(json.dumps(rep, indent=1))
        return
    con = C.connect()
    rep = PB.build(con)
    rep["extras"] = PB.extras(con)          # meta.json is rewritten by build, so the extras are added again
    rep["dashboard"] = DB.build(log=lambda *a: None)
    rep.get("l5", {}).pop("index", None)
    typer.echo(json.dumps(rep, indent=1))


@app.command()
def webfiles():
    """The browser's copy of the published files, cut into small pieces (products/v<version>/web/)."""
    from . import webfiles as W
    typer.echo(json.dumps(W.build(log=typer.echo), indent=1))


@app.command()
def placestats():
    """Statistics of every named place and the trend of every map hexagon (web/places.json, web/trend_l3.json, trend_l4)."""
    from . import placestats as P
    typer.echo(json.dumps(P.build(log=typer.echo), indent=1))


@app.command()
def eda(figures: bool = typer.Option(False, "--figures", help="also draw the report figures fig20 to fig24"),
        rescan: bool = typer.Option(False, "--rescan", help="scan the hotspot files again (the scan is cached in eda/)")):
    """Exploratory analysis of the raw record and the trend checks (products/v<version>/eda/, web/eda.json)."""
    from . import eda as E
    typer.echo(json.dumps(E.build(log=typer.echo, figures=figures, rescan=rescan), indent=1))


@app.command()
def trendflags():
    """The report's trend rules in the app's files: floors and false discovery rate q values (web/trend_l*.json, places.json)."""
    from . import trendflags as TF
    typer.echo(json.dumps(TF.build(log=lambda *a: None), indent=1))


@app.command()
def cities():
    """Cities for the place search (web/cities.json, from Natural Earth populated places), with their country and state."""
    from . import cities as CT
    typer.echo(json.dumps(CT.build(log=typer.echo), indent=1))


@app.command()
def climate(only: Optional[List[str]] = typer.Option(None, "--only", help="rain, merra2, fwi, pm25, indices")):
    """Climate drivers per level 3 hexagon and month (rain, weather, aerosols, fire weather, PM2.5, ENSO and IOD)."""
    from . import climate as K
    typer.echo(json.dumps(K.build(only, log=typer.echo), indent=1))


@app.command()
def climate_fetch_late(start: str = "2024-10-01", end: str = "2025-09-30"):
    """Download IMERG Late daily rain for a past window (one day at a time, reduced to hexagons, then deleted)."""
    from . import climate as K
    typer.echo(json.dumps(K.imerg_late_fetch(start, end, log=typer.echo), indent=1))


@app.command()
def climate_fetch_sst():
    """MERRA-2 surface temperature in the Indian Ocean Dipole and Nino 3.4 boxes, every month (cloud OPeNDAP)."""
    from . import climate as K
    df = K.sst_boxes_fetch(log=typer.echo)
    typer.echo(json.dumps({"months": len(df), "first": f"{df.yr.iloc[0]}-{df.mo.iloc[0]:02d}", "last": f"{df.yr.iloc[-1]}-{df.mo.iloc[-1]:02d}"}))


@app.command()
def drivers():
    """Drivers of unusual fire months per area: rain deficit, heat and the El Nino link (needs `climate` first)."""
    from . import drivers as D
    typer.echo(json.dumps(D.build(log=typer.echo), indent=1, default=float))


@app.command()
def outlook():
    """Chance of above normal fire 1 to 3 months ahead per area, with its skill on held out years (needs `drivers`)."""
    from . import outlook as O
    typer.echo(json.dumps(O.build(log=typer.echo), indent=1, default=float))


@app.command()
def haze():
    """Haze link: smoke at Malaysian and neighbouring cities from fires in Sumatra and Borneo (needs `drivers`), then the
    other cities of the PM2.5 data that pass the same skill rule (haze_cities.py; haze.build alone keeps eight)."""
    from . import haze as Z
    from . import haze_cities as HC
    rep = Z.build(log=typer.echo)
    rep["more_cities"] = HC.build(log=typer.echo)
    typer.echo(json.dumps(rep, indent=1, default=float))


@app.command(name="haze-cities")
def haze_cities(publish: bool = typer.Option(True, help="also write the app's haze files (products and web)")):
    """The other cities of the bias corrected PM2.5 data, fitted as haze.py fits its eight, kept by the same skill rule
    (after `haze`); with --publish, products haze.parquet, haze.json and web/haze_months.json too."""
    from . import haze_cities as HC
    rep = {"cities": HC.build(log=typer.echo)}
    if publish:
        rep["files"] = HC.publish(log=typer.echo)
    typer.echo(json.dumps(rep, indent=1, default=float))


@app.command()
def physics(year: int = 2019):
    """Physics check on the calibration tiles: the chance that MODIS sees a fire that VIIRS saw (notebook 04)."""
    from . import physics as PH
    typer.echo(json.dumps(PH.build(year, log=typer.echo), indent=1))


@app.command()
def dashboard():
    """The statistics of the app's analytics dashboard (products/v<version>/dashboard.json)."""
    from . import dashboard as DB
    typer.echo(json.dumps(DB.build(log=typer.echo), indent=1))


@app.command()
def hotspots(years: Optional[List[int]] = typer.Option(None, "--years", "-y")):
    """Every FIRMS hotspot by region and date for the app's "download the hotspots of my search" (products/hotspots/)."""
    from . import hotspots as HS
    typer.echo(json.dumps(HS.build(years, log=typer.echo), indent=1))


@app.command()
def info():
    """Show config and paths."""
    typer.echo(json.dumps({k: str(v) for k, v in C.cfg()["paths"].items()}, indent=1))


if __name__ == "__main__":
    app()
