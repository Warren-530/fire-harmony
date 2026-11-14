"""Report figures of the exploratory analysis and the trend checks (fig20 to fig24), in the house style.

Drawn by `fireharmony eda --figures` from the results of eda.build, so every number on a figure is the number in
web/eda.json and in the report.
  fig20_frp_by_sensor        FRP of MODIS and VIIRS hotspots in the same years, by day and by night
  fig21_overpass_drift       local solar time of the hotspots, and the drift of the MODIS orbits
  fig22_exchange_rate_map    Suomi NPP hotspots per Aqua hotspot, level 3 hexagons
  fig23_trend_fdr_map        level 3 trends that survive false discovery rate control
  fig24_trend_agreement      harmonized against MODIS only trends by country, and the world ratio by year
The report figures that come straight from the published files (fig01 to fig19 and fig25) are drawn by
report_figures() at the end of this module.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as C
from . import eda as E
from . import features as FE

FIG = C.REPO / "report" / "figures"
SRC = "Source: NASA FIRMS (MODIS C6.1, VIIRS 375 m); analysis: Fire Harmony"


def _fh():
    sys.path.insert(0, str(C.REPO / "style"))
    import fireharmony_style as fh
    fh.use()
    return fh


def _borders(con):
    return con.execute(f"SELECT ST_AsText(ST_Simplify(geom, 0.15)) AS w FROM ST_Read('{FE.ne_source('ne_10m_admin_0_countries')}')").df().w


def _wkt(con, hexes) -> list[str]:
    con.register("_hw", pd.DataFrame({"h3": list(hexes), "i": np.arange(len(hexes))}))
    w = con.execute("SELECT h3_cell_to_boundary_wkt(h3) AS w FROM _hw ORDER BY i").df().w.tolist()
    con.unregister("_hw")
    return w


def frp_figure(res: dict, fh, path) -> None:
    """Three panels under one headline that states the finding: the FRP of the hotspots of Terra, Aqua and Suomi NPP by
    day and by night, and Suomi NPP for every Aqua hotspot. Terra is a lighter tint of the MODIS blue, dashed and drawn
    over Aqua, so the two MODIS curves stay apart where they lie on top of each other (at night they almost do)."""
    import matplotlib.pyplot as plt
    h = res["frp_hist"]
    edges = np.array(h["bin_edges_mw"], float)
    mid = np.sqrt(edges[:-1] * edges[1:])
    ov = res["overlap"]
    by = {s["id"]: s for s in ov["sensors"]}
    r = ov["snpp_per_aqua"]
    fig, axes = plt.subplots(1, 3, figsize=(fh.SIZE["full"][0], fh.SIZE["full"][1] * 1.02),
                             gridspec_kw={"width_ratios": [1, 1, 0.78]})
    terra = "#86b3ea"                                   # MODIS blue, lighter: the same family, a second line
    style = {"snpp": dict(color=fh.SENSOR["VIIRS_SNPP"], lw=2.2, zorder=3),
             "aqua": dict(color=fh.SENSOR["MODIS"], lw=2.2, zorder=3),
             "terra": dict(color=terra, lw=1.5, ls=(0, (2.2, 1.6)), zorder=4)}
    share = {sid: {part: 100 * np.array(v[part], float) / max(sum(v[part]), 1) for part in ("day", "night")}
             for sid, v in h["sensors"].items()}
    ymax = max(float(v.max()) for s in share.values() for v in s.values())
    times = lambda v: f"{v:.0f}\u00d7" if v >= 10 else f"{v:.1f}\u00d7"
    pct = lambda v: f"{v:.0f}%" if v >= 1 else "under 1%"
    titles = {"day": "By day", "night": "At night"}
    for ax, part in ((axes[0], "day"), (axes[1], "night")):
        limit = ov["modis_limit_mw"][part]
        for sid in ("snpp", "aqua", "terra"):
            ax.plot(mid, share[sid][part], **style[sid])
        ax.axvline(limit, color=fh.MUTED, lw=0.9, ls=":", zorder=1)
        ax.text(limit * 1.12, ymax * 1.05, f"{limit:g} MW", fontsize=7, color=fh.INK_2, va="bottom", ha="left")
        sn, aq = by["snpp"][part], by["aqua"][part]
        ax.text(1900, ymax * 0.98, f"Below {limit:g} MW\nSuomi NPP {pct(sn['below_modis_limit_pct'])}\nAqua {pct(aq['below_modis_limit_pct'])}",
                fontsize=7.5, color=fh.INK_2, va="top", ha="right", linespacing=1.45)
        # direct labels at the peaks: no legend to decode
        k = int(np.argmax(share["snpp"][part]))
        ax.annotate("Suomi NPP", (mid[k], share["snpp"][part][k]), xytext=(-6, 2), textcoords="offset points",
                    fontsize=7.5, color=fh.INK, ha="right", va="bottom")
        ax.text(75, ymax * 0.62, "Aqua, solid\nTerra, dashed", fontsize=7.5, color=fh.INK, ha="left", va="top",
                linespacing=1.4)                        # clear space right of the MODIS curves
        ax.set_xscale("log")
        ax.set_xlim(0.25, 2400)
        ax.set_ylim(0, ymax * 1.12)
        ax.set_xticks([1, 10, 100, 1000])
        ax.set_xticklabels(["1", "10", "100", "1,000"])
        ax.minorticks_off()
        ax.set_xlabel("FRP (MW, log scale)")
        fh.clean(ax)
        ax.set_title(titles[part], loc="left", fontsize=10.5, fontweight="semibold", color=fh.INK, pad=16)
        ax.text(0, 1.025, f"MODIS sees half the fires at {limit:g} MW", transform=ax.transAxes, fontsize=8, color=fh.INK_2, va="bottom")
    axes[1].set_yticklabels([])
    axes[0].set_ylabel("Share of the satellite's hotspots (% per bin)")
    ax = axes[2]
    labels = ["All hotspots", "By day", "At night", "Fire power"]
    vals = [r["hotspots"], r["day_hotspots"], r["night_hotspots"], r["frp"]]
    ys = np.arange(len(vals))[::-1]
    ax.barh(ys, vals, color=fh.SENSOR["VIIRS_SNPP"], height=0.55)
    for y, v in zip(ys, vals):
        ax.text(v + 0.8, y, times(v), va="center", fontsize=8.5, color=fh.INK, fontweight="semibold")
    ax.axvline(1, color=fh.BASELINE, lw=0.9)
    ax.set_yticks(ys)
    ax.set_yticklabels(labels)
    ax.set_xlim(0, max(vals) * 1.3)
    ax.set_ylim(-0.6, len(vals) - 0.4)
    ax.set_xticks([0, 10, 20, 30])
    ax.set_xlabel("Suomi NPP for every Aqua hotspot")
    fh.clean(ax, grid_axis="x")
    ax.set_title("Many more hotspots", loc="left", fontsize=10.5, fontweight="semibold", color=fh.INK, pad=16)
    ax.text(0, 1.025, "Not much more fire power", transform=ax.transAxes, fontsize=8, color=fh.INK_2, va="bottom")
    fig.suptitle(f"Suomi NPP counts {times(r['hotspots'])} the hotspots of Aqua, but only {times(r['frp'])} the fire power",
                 x=0.01, ha="left", fontsize=12.5, fontweight="semibold", color=fh.INK)
    fh.source(fig, f"Hotspots the record counts, {h['years'][0]} to {h['years'][1]}, when Aqua and Suomi NPP pass at the same "
                   "hours. FRP bins of 0.1 in log10; each curve sums to 100%. " + SRC)
    fh.save(fig, str(path))
    plt.close(fig)


def _hhmm(x, _=None) -> str:
    return f"{int(x) % 24:02d}:{int(round((x % 1) * 60)) % 60:02d}"


def overpass_figure(res: dict, fh, path) -> None:
    import matplotlib.pyplot as plt
    from matplotlib.ticker import FuncFormatter, MultipleLocator
    ov = res["overpass"]
    fig, axes = plt.subplots(1, 2, figsize=fh.SIZE["full"], gridspec_kw={"width_ratios": [1, 1.15]})
    ax = axes[0]
    t = (np.arange(48) + 0.5) / 2
    style = {"terra": dict(color=fh.SENSOR["MODIS"], lw=1.4, ls=(0, (3, 2))), "aqua": dict(color=fh.SENSOR["MODIS"], lw=2),
             "snpp": dict(color=fh.SENSOR["VIIRS_SNPP"], lw=2)}
    names = {"terra": "Terra", "aqua": "Aqua", "snpp": "Suomi NPP"}
    for sid in ("terra", "aqua", "snpp"):
        y = np.array(ov["hour_share_2013_2019"][sid])
        ax.plot(t, y, **style[sid])
    for sid, (x, y, ha) in {"terra": (9.6, 30, "right"), "aqua": (14.2, 37, "left"), "snpp": (14.2, 23, "left"),
                             }.items():
        ax.text(x, y, names[sid], fontsize=8, color=fh.INK_2, ha=ha)
    ax.text(23.6, 9, "Terra\nby night", fontsize=7, color=fh.INK_2, ha="right", va="bottom")
    ax.text(0.6, 9, "VIIRS\nby night", fontsize=7, color=fh.INK_2, ha="left", va="bottom")
    ax.set_xlim(0, 24)
    ax.xaxis.set_major_locator(MultipleLocator(6))
    ax.xaxis.set_major_formatter(FuncFormatter(lambda x, _: f"{int(x):02d}:00"))
    ax.set_xlabel("Local solar time")
    ax.set_ylabel("Share of the satellite's hotspots (% per 30 minutes)")
    ax.set_ylim(0, None)
    fh.clean(ax)
    fh.title(ax, "When each satellite sees fire", "Share of its hotspots, 2013 to 2019")
    ax = axes[1]
    lines = {"terra": ("Terra", style["terra"]), "aqua": ("Aqua", style["aqua"]),
             "snpp": ("Suomi NPP", style["snpp"]), "noaa20": ("NOAA-20", dict(color=fh.SENSOR["VIIRS_NOAA20"], lw=1.6)),
             "noaa21": ("NOAA-21", dict(color=fh.SENSOR["VIIRS_NOAA21"], lw=1.6))}
    ends = []
    for sid, (label, st) in lines.items():
        by = pd.DataFrame(ov["sensors"][sid]["by_year"]).dropna(subset=["day_median_local"])
        by = by[by.yr.between(*{"terra": (2001, 2026), "aqua": (2003, 2026)}.get(sid, (2012, 2026)))]
        full = by[by.yr <= 2025]
        ax.plot(full.yr, full.day_median_local, **st)
        last = by[by.yr == 2026]
        if len(last):
            ax.plot([2025, 2026], [full.day_median_local.iloc[-1], last.day_median_local.iloc[0]], color=st["color"], lw=1, ls=":")
            ax.plot(2026, last.day_median_local.iloc[0], "o", ms=4, mfc=fh.SURFACE, mec=st["color"], mew=1.2)
        if sid in ("terra", "aqua"):
            ends.append((2026.2, float(by.day_median_local.iloc[-1]), f"{label} {_hhmm(by.day_median_local.iloc[-1])}"))
    v = ov["sensors"]["snpp"]["day_median_local"]
    ends.append((2026.2, v, f"VIIRS {_hhmm(v)}"))
    fh.label_ends(ax, ends, gap=0.3)
    ax.axvspan(2021.5, 2026.5, color=fh.GRID, alpha=0.45, lw=0)
    ax.text(2021.8, 12.0, "MODIS\norbits\ndrift", fontsize=7, color=fh.INK_2, va="center")
    ax.yaxis.set_major_formatter(FuncFormatter(_hhmm))
    ax.yaxis.set_major_locator(MultipleLocator(1))
    ax.set_ylim(8.8, 15.8)
    ax.set_xlim(2000.5, 2031)
    fh.year_axis(ax, 2001, 2026)
    fh.clean(ax)
    fh.title(ax, "By day, the MODIS orbits drift from 2022", "Median local time of daytime hotspots")
    fh.source(fig, "Local solar time is UTC plus 4 minutes per degree of longitude east. NOAA-20 and NOAA-21 fly on the "
                   "orbit of Suomi NPP. Open dots: 2026 so far. " + SRC)
    fh.save(fig, str(path))
    plt.close(fig)


def exchange_map(res: dict, r3: pd.DataFrame, con, borders, fh, path) -> None:
    """The exchange rate on a one direction violet scale (blue to red is kept for anomaly and trend), log spaced, with a
    tick at the world rate."""
    import matplotlib.pyplot as plt
    from matplotlib.colors import LinearSegmentedColormap, LogNorm
    s = res["exchange_rate_l3"]
    x = r3[r3.aqua >= E.RATIO_MIN_AQUA].copy()
    x["ratio"] = x.snpp / x.aqua
    low = r3[(r3.aqua < E.RATIO_MIN_AQUA) & ((r3.aqua > 0) | (r3.snpp > 0))]
    fig, ax = plt.subplots(figsize=fh.SIZE["full"])
    fh.world_hexmap(ax, _wkt(con, low.h3), colors=[fh.GRID] * len(low), outline=False)
    world = s["world"]
    violet = LinearSegmentedColormap.from_list("violet", ["#f4f0fb", "#ddd2f3", "#c1aee8", "#a089da", "#7f66c9", "#6249b0",
                                                          "#48348e", "#30236a"])
    pc = fh.world_hexmap(ax, _wkt(con, x.h3), x.ratio.clip(2, 18).to_numpy(), cmap=violet, norm=LogNorm(vmin=2, vmax=18),
                         border_wkts=borders)
    cb = fig.colorbar(pc, ax=ax, fraction=0.03, pad=0.01, orientation="horizontal", shrink=0.6)
    cb.outline.set_visible(False)
    ticks = [2, 3, 4, world, 10, 15]
    cb.set_ticks(ticks)
    cb.set_ticklabels(["2", "3", "4", f"{world:.1f}\nworld", "10", "15"])          # world has 4 decimals: one rounding
    cb.ax.minorticks_off()
    cb.set_label("Suomi NPP hotspots for every Aqua hotspot (log scale)", color=fh.INK_2, fontsize=8)
    fh.title(ax, "The exchange rate between VIIRS and MODIS changes from place to place",
             f"{s['years'][0]} to {s['years'][1]}, level 3 hexagons (about 12,400 km\u00b2); grey: fewer than "
             f"{E.RATIO_MIN_AQUA} Aqua hotspots a year")
    fh.source(fig, "Same overpass hours (13:30 and 01:30 at low latitudes). " + SRC)
    fh.save(fig, str(path))
    plt.close(fig)


def fdr_map(res: dict, d3: pd.DataFrame, con, borders, fh, path) -> None:
    import matplotlib.pyplot as plt
    from matplotlib.colors import TwoSlopeNorm
    from matplotlib.patches import Patch
    f = res["fdr"]
    b = f["l3"]["bh_005"]
    t = d3[d3.tested]
    sig = t[t.q_bh <= 0.05]
    ns = t[~(t.q_bh <= 0.05)]
    low = d3[~d3.tested]
    fig, ax = plt.subplots(figsize=fh.SIZE["full"])
    fh.world_hexmap(ax, _wkt(con, low.h3), colors=[LOW_FIRE] * len(low), outline=False)
    fh.world_hexmap(ax, _wkt(con, ns.h3), colors=[fh.GRID] * len(ns), outline=False)
    norm = TwoSlopeNorm(vcenter=0, vmin=-80, vmax=80)
    pc = fh.world_hexmap(ax, _wkt(con, sig.h3), sig.pct.clip(-80, 80).to_numpy(), cmap=fh.anomaly_cmap, norm=norm,
                         border_wkts=borders)
    cb = fig.colorbar(pc, ax=ax, fraction=0.03, pad=0.01, orientation="horizontal", shrink=0.6)
    cb.outline.set_visible(False)
    cb.set_ticks([-80, -40, 0, 40, 80])
    cb.set_ticklabels(["\u221280%", "\u221240%", "0", "+40%", "+80%"])
    cb.set_label("Change of yearly fire per decade (beyond 80% shown as 80%)", color=fh.INK_2, fontsize=8)
    ax.legend(handles=[Patch(facecolor=fh.GRID, label="No clear trend"),
                       Patch(facecolor=LOW_FIRE, edgecolor=fh.BASELINE, lw=0.4, label="Too little fire to test")],
              loc="lower left", bbox_to_anchor=(0.085, 0.23), fontsize=7, handlelength=1.2, handleheight=1.0)
    ratio = b["falling"] / b["rising"]
    fh.title(ax, f"Fire fell in {ratio:.1f} times as many places as it rose",
             "Level 3 hexagons, 2001 to 2025, coloured where the trend survives a 5% false discovery rate")
    fh.source(fig, f"{b['falling']:,} hexagons falling, {b['rising']:,} rising and {f['l3']['hexagons'] - b['falling'] - b['rising']:,} "
                   f"with no clear trend; {len(low):,} with fewer than {f['floor_per_year']} hotspots a year are not tested. Mann Kendall test with the Hamed and Rao "
                   "correction, Benjamini and Hochberg procedure. " + SRC)
    fh.save(fig, str(path))
    plt.close(fig)


LOW_FIRE = "#f1f0eb"          # hexagons below the floor: a step lighter than the grid grey of "no clear trend"


LABEL = {"IND": ("India", (6, 5)), "BRA": ("Brazil", (5, -4)), "IDN": ("Indonesia", (-6, 6)), "CAN": ("Canada", (-6, 0)),
         "COD": ("DR Congo", (6, -2)), "RUS": ("Russia", (-6, 3)), "AUS": ("Australia", (6, -3)), "PRK": ("North Korea", (5, -2))}
RIGHT = {"IND", "BRA", "COD", "AUS", "PRK"}


def agreement_figure(res: dict, rows: pd.DataFrame, fh, path) -> None:
    import matplotlib.pyplot as plt
    hv = res["sensitivity"]["harmonized_vs_modis"]
    fig, axes = plt.subplots(1, 2, figsize=fh.SIZE["full"], gridspec_kw={"width_ratios": [1.0, 1.0]})
    ax = axes[0]
    tr = lambda pct: np.log1p(np.asarray(pct, float) / 100)
    sig = (rows.h_q <= 0.05).to_numpy()
    size = 6 + 70 * np.sqrt(rows.mean_per_year / rows.mean_per_year.max()).to_numpy()
    lim = tr([-75, 200])
    ax.plot(lim, lim, color=fh.BASELINE, lw=0.9, ls="--", zorder=0)
    ax.axhline(0, color=fh.BASELINE, lw=0.6, zorder=0)
    ax.axvline(0, color=fh.BASELINE, lw=0.6, zorder=0)
    ax.scatter(tr(rows.modis_pct[~sig]), tr(rows.h_pct[~sig]), s=size[~sig], facecolors="none", edgecolors=fh.MUTED, lw=0.8)
    ax.scatter(tr(rows.modis_pct[sig]), tr(rows.h_pct[sig]), s=size[sig], color=fh.INK, alpha=0.8, lw=0.4, edgecolors=fh.SURFACE)
    for _, r in rows[rows.iso3.isin(LABEL)].iterrows():
        name, off = LABEL[r.iso3]
        ax.annotate(name, (tr(r.modis_pct), tr(r.h_pct)), xytext=off, textcoords="offset points", fontsize=7,
                    color=fh.INK_2, ha="left" if r.iso3 in RIGHT else "right", va="center")
    ticks = [-75, -50, -25, 0, 50, 100, 200]
    lab = [f"{t:+d}%".replace("-", "\u2212") if t else "0" for t in ticks]
    xt = [t for t in ticks if t != 50]                  # +50% and +100% would touch on the x axis
    ax.set_xticks(tr(xt))
    ax.set_yticks(tr(ticks))
    ax.set_xticklabels([l for t, l in zip(ticks, lab) if t != 50])
    ax.set_yticklabels(lab)
    ax.set_xlim(*lim)
    ax.set_ylim(*lim)
    ax.set_xlabel("MODIS only record")
    ax.set_ylabel("Harmonized record")
    fh.clean(ax, grid_axis="both")
    fh.title(ax, "Country trends agree", f"Change per decade, {hv['years'][0]} to {hv['years'][1]}")
    ax.text(tr(-72), tr(160), f"Same sign in {hv['same_sign_pct']:.0f}% of {hv['countries']} countries\n"
            f"and in {hv['h_significant_same_sign_pct']:.0f}% of the {hv['h_significant']} with\na significant trend (filled)",
            fontsize=7, color=fh.INK_2, ha="left", va="top", linespacing=1.4)
    ax = axes[1]
    w = pd.Series(res["sensitivity"]["world_h_per_modis_by_year"]).astype(float)
    w.index = w.index.astype(int)
    ax.axvspan(2000.5, 2002.5, color=fh.GRID, alpha=0.6, lw=0)
    ax.axvspan(2021.5, 2025.5, color=fh.GRID, alpha=0.6, lw=0)
    ax.axvline(2012, color=fh.MUTED, lw=0.8, ls=":")
    ax.plot(w.index, w.values, color=fh.INK, lw=2.2)
    ax.text(2012.3, 7.08, "VIIRS starts", fontsize=7, color=fh.INK_2)
    ax.text(2000.7, 8.95, "Terra\nonly", fontsize=7, color=fh.INK_2, va="top")
    ax.text(2021.7, 8.95, "MODIS\norbits\ndrift", fontsize=7, color=fh.INK_2, va="top")
    ax.set_ylim(7.0, 9.0)
    ax.set_xlim(2000.5, 2025.5)
    fh.year_axis(ax, 2001, 2025)
    ax.set_ylabel("Harmonized for every MODIS hotspot")
    fh.clean(ax)
    fh.title(ax, "Where the two records part", "World, each year")
    fh.source(fig, f"Countries with at least {E.PLACE_FLOOR:,} hotspots a year; circle area follows their fire. Significant: "
                   "Benjamini and Hochberg at 5%. " + SRC)
    fh.save(fig, str(path))
    plt.close(fig)


def draw(res, d3, hv_rows, r3, log=print) -> list[str]:
    import matplotlib.pyplot as plt
    fh = _fh()
    FIG.mkdir(parents=True, exist_ok=True)
    con = C.connect()
    con.execute("SET memory_limit = '1GB'")
    con.execute("SET threads = 2")
    borders = _borders(con)
    made = []
    for name, fn in (("fig20_frp_by_sensor", lambda p: frp_figure(res, fh, p)),
                     ("fig21_overpass_drift", lambda p: overpass_figure(res, fh, p)),
                     ("fig22_exchange_rate_map", lambda p: exchange_map(res, r3, con, borders, fh, p)),
                     ("fig23_trend_fdr_map", lambda p: fdr_map(res, d3, con, borders, fh, p)),
                     ("fig24_trend_agreement", lambda p: agreement_figure(res, hv_rows, fh, p))):
        fn(FIG / name)
        made.append(name)
        log(f"eda: {name}")
    plt.close("all")
    con.close()
    return made


# ============================================================================================ report figures from the
# published files. Each reads only files under products/v1.0 (and models/*.json in the repository), so anyone with the
# published dataset can redraw them, and every number on them is a number in those files. The notebooks call these too.
#   fig01_fires_per_satellite      hotspots per year and satellite              eda/scan_profile.parquet
#   fig02_ratio_by_land_cover      Suomi NPP per Aqua hotspot by land cover     l5/, cells.parquet
#   fig03_seam_test                naive join against the harmonized record     dashboard.json
#   fig05_world_fire_map           harmonized hotspots a year, level 4          cell_l4.parquet
#   fig07_model_ladder             held out error of the two models             dashboard.json
#   fig10, fig12, fig25 calendars  burning calendars on one colour scale        web/series/*.json, drivers.parquet
#   fig11_normal_season            normal season and critical period            web/series/*.json, web/places.json
#   fig15_driver_skill_map         R2 of the drivers by state                   drivers_models.parquet, cells.parquet
#   fig16_enso_rain_link           El Nino and the three month rain             drivers_models.parquet, cells.parquet
#   fig17_outlook_skill            reliability and Brier scores                 dashboard.json, models/outlook.json
#   fig18_haze_kuala_lumpur        seasons of PM2.5 and the smoke of the fires  haze.parquet, models/haze.json
#   fig19_modis_detection_curve    what MODIS sees, by FRP, day and night       dashboard.json
TIMES = "×"
MINUS = "−"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
# one direction scales for quantities that are not an anomaly (blue to red is kept for anomaly and trend)
VIOLET = ["#f4f0fb", "#ddd2f3", "#c1aee8", "#a089da", "#7f66c9", "#6249b0", "#48348e", "#30236a"]
SLATE = ["#f1f3f5", "#d9dee4", "#b7c0ca", "#93a0ae", "#6f7f90", "#536273", "#3a4756", "#26303b"]
BROWN_TEAL = ["#7a4a1c", "#a8692f", "#cf9a5e", "#ead2b0", "#f2f1ec", "#b5dcd5", "#6fb8ab", "#2f8b7f", "#155f57"]


def _pub(*parts):
    return C.path("products") / "v1.0" / Path(*parts)


def _json(*parts):
    import json
    return json.loads(_pub(*parts).read_text())


def _thousands(v, _=None) -> str:
    return f"{v:,.0f}"


def _cmap(colors, name):
    from matplotlib.colors import LinearSegmentedColormap
    return LinearSegmentedColormap.from_list(name, colors)


def _headline(fig, text):
    """Left aligned figure headline (it may hold a line break) above all axes; the layout engine makes room for it."""
    fig.suptitle(text, x=0.01, ha="left", fontsize=12.5, fontweight="semibold", color="#0b0b0b", linespacing=1.15)


def fires_per_satellite(fh, path) -> None:
    import matplotlib.pyplot as plt
    p = pd.read_parquet(_pub("eda", "scan_profile.parquet"), columns=["sat", "yr", "cnt", "n"])
    w = p[p.cnt == True].groupby(["yr", "sat"]).n.sum().unstack()      # noqa: E712 (nullable boolean)
    w = w.loc[2001:2025]
    w["MODIS"] = w[["Terra", "Aqua"]].mean(axis=1, skipna=False)
    lines = {"MODIS": "MODIS", "Suomi-NPP": "VIIRS_SNPP", "NOAA-20": "VIIRS_NOAA20", "NOAA-21": "VIIRS_NOAA21"}
    first_full = {"MODIS": 2003, "Suomi-NPP": 2013, "NOAA-20": 2019, "NOAA-21": 2025}
    for col, y0 in first_full.items():
        w.loc[w.index < y0, col] = np.nan
    fig, ax = plt.subplots(figsize=fh.SIZE["full"])
    ends = []
    for col, key in lines.items():
        s = w[col].dropna() / 1e6
        ax.plot(s.index, s.values, color=fh.SENSOR[key], lw=2, marker="o" if len(s) == 1 else None, ms=5)
        ends.append((s.index[-1], s.values[-1], fh.SENSOR_LABEL[key].replace(" (Terra + Aqua)", ", mean of Terra and Aqua")))
    fh.label_ends(ax, ends, gap=1.1)
    fh.clean(ax)
    ax.set_xlim(2000.5, 2031)
    ax.set_ylim(0, None)
    ax.set_ylabel("Million hotspots per year")
    fh.year_axis(ax, 2001, 2025)
    ax.set_title("World, vegetation fire hotspots per year and per satellite, full years only", loc="left", fontsize=8.5,
                 fontweight="normal", color=fh.INK_2, pad=6)
    _headline(fig, "One VIIRS satellite counts about eight times as many hotspots\nas one MODIS satellite")
    fh.source(fig, "Counted hotspots: vegetation fires, not low confidence, not in open water. " + SRC)
    fh.save(fig, str(path))
    plt.close(fig)


def ratio_by_land_cover(fh, path, con) -> pd.DataFrame:
    import matplotlib.pyplot as plt
    lc = con.execute(f"""
      SELECT c.lc_main, sum(l.s)::DOUBLE / sum(l.a) AS ratio, sum(l.s) AS viirs
      FROM read_parquet('{_pub('l5')}/*/*.parquet', hive_partitioning = true) l JOIN '{_pub('cells.parquet')}' c USING (h3)
      WHERE l.yr BETWEEN 2013 AND 2019 GROUP BY 1 HAVING viirs > 1e6 ORDER BY ratio""").df()
    fig, ax = plt.subplots(figsize=(112 * fh.MM, 66 * fh.MM))
    ax.barh(lc.lc_main, lc.ratio, color=fh.SENSOR["VIIRS_SNPP"], height=0.6)
    for i, v in enumerate(lc.ratio):
        ax.text(v, i, f"  {v:.1f}{TIMES}", va="center", fontsize=8, color=fh.INK_2)
    fh.clean(ax, grid_axis="x")
    ax.set_xlim(0, lc.ratio.max() * 1.18)
    ax.set_xlabel("Suomi NPP hotspots for every Aqua hotspot")
    fh.title(ax, "Shrubs and crops need the biggest exchange rate", "2013 to 2019, by the main land cover of each hexagon")
    ax.title.set_fontsize(11)
    fh.source(fig, "Source: NASA FIRMS, MCD12C1 land cover; analysis: Fire Harmony")
    fh.save(fig, str(path))
    plt.close(fig)
    return lc


def seam_test(fh, path) -> float:
    import matplotlib.pyplot as plt
    d = pd.DataFrame(_json("dashboard.json")["world"]["yearly"]).set_index("yr").loc[2001:2025]
    yrs = d.index.to_numpy()
    M = 1e6
    fig, axes = plt.subplots(1, 2, figsize=fh.SIZE["full"], sharey=True)
    ax = axes[0]
    pre, post = yrs < 2012, yrs >= 2012
    ax.plot(yrs[pre], d.modis[pre] / M, color=fh.SENSOR["MODIS"], lw=2)
    ax.plot(yrs[post], d.naive[post] / M, color=fh.SENSOR["VIIRS_SNPP"], lw=2)
    ax.plot([2011, 2012], [d.modis[2011] / M, d.naive[2012] / M], color=fh.MUTED, lw=1)
    fh.direct_label(ax, 2011, d.modis[2011] / M, "MODIS", dy=-8)
    fh.direct_label(ax, yrs[-1], d.naive.iloc[-1] / M, "VIIRS")
    jump = _json("dashboard.json")["seam"]["naive_jump_2011_2012"]
    fh.title(ax, f"Joined naively: a fake {jump:.1f}{TIMES} jump", "World, hotspots per year")
    ax = axes[1]
    lo, hi = d.lo.fillna(d.harmonized), d.hi.fillna(d.harmonized)
    ax.fill_between(yrs, lo / M, hi / M, color=fh.HARMONIZED_BAND, alpha=0.12, lw=0)
    ax.plot(yrs, d.modis / M, color=fh.SENSOR["MODIS"], lw=1.2)
    ax.plot(yrs, d.harmonized / M, color=fh.HARMONIZED, lw=2.6)
    fh.direct_label(ax, yrs[-1], d.harmonized.iloc[-1] / M, "Harmonized")
    fh.direct_label(ax, yrs[-1], d.modis.iloc[-1] / M, "MODIS")
    fh.title(ax, "Harmonized: one record", "NOAA-20 VIIRS scale, 90% range where modelled")
    for ax in axes:
        ax.title.set_fontsize(11.5)
        fh.clean(ax)
        ax.set_xlim(yrs[0] - 0.5, yrs[-1] + 5.5)
        ax.set_ylim(0, None)
        fh.year_axis(ax, 2001, 2025)
    axes[0].set_ylabel("Million hotspots per year")
    fh.source(fig, "Source: NASA FIRMS (MODIS C6.1, VIIRS 375 m), vegetation fires; analysis: Fire Harmony")
    fh.save(fig, str(path))
    plt.close(fig)
    return jump


def world_fire_map(fh, path, con, borders) -> None:
    import matplotlib.pyplot as plt
    from matplotlib.colors import LogNorm
    hexes = con.execute(f"""
      SELECT h3_cell_to_boundary_wkt(h3) AS w, sum(h) / 25 AS n FROM '{_pub('cell_l4.parquet')}'
      WHERE yr BETWEEN 2001 AND 2025 GROUP BY h3 HAVING n >= 1""").df()
    fig, ax = plt.subplots(figsize=fh.SIZE["full"])
    pc = fh.world_hexmap(ax, hexes.w, hexes.n.to_numpy(), norm=LogNorm(vmin=1, vmax=hexes.n.quantile(0.999)), border_wkts=borders)
    cb = fig.colorbar(pc, ax=ax, fraction=0.03, pad=0.01, orientation="horizontal", shrink=0.6)
    cb.outline.set_visible(False)
    cb.set_ticks([1, 10, 100, 1000])
    cb.set_ticklabels(["1", "10", "100", "1,000"])
    cb.ax.minorticks_off()
    cb.set_label("Harmonized hotspots a year per hexagon (log scale)", color=fh.INK_2, fontsize=8)
    fh.title(ax, "Africa holds half of the world's fire",
             "Mean of 2001 to 2025, level 4 hexagons (about 1,770 km²), NOAA-20 VIIRS scale, Equal Earth projection")
    fh.source(fig, "Source: NASA FIRMS (MODIS C6.1, VIIRS 375 m), harmonized by Fire Harmony")
    fh.save(fig, str(path))
    plt.close(fig)


LADDER = {"cell x month": "Hexagon of\n253 km²,\nmonth", "region L4 x month": "Hexagon of\n1,770 km²,\nmonth",
          "region L3 x month": "Hexagon of\n12,400 km²,\nmonth", "continent x month": "Continent,\nmonth",
          "world x month": "World,\nmonth", "region L3 x year": "Hexagon of\n12,400 km²,\nyear", "continent x year": "Continent,\nyear"}


def model_ladder(fh, path) -> None:
    import matplotlib.pyplot as plt
    cv = pd.DataFrame(_json("dashboard.json")["models"]["cv"]).set_index("scale").loc[list(LADDER)]
    fig, ax = plt.subplots(figsize=fh.SIZE["full"])
    x = np.arange(len(cv))
    wd = 0.36
    for i, (col, color, label) in enumerate([("ratio_err", fh.BASELINE, "Exchange rate per region and month"),
                                              ("gbm_err", fh.INK, "Gradient boosting (used)")]):
        ax.bar(x + (i - 0.5) * wd, cv[col], wd, color=color, label=label)
        for xi, v in zip(x, cv[col]):
            ax.text(xi + (i - 0.5) * wd, v + 1.2, f"{v:.0f}" if v >= 10 else f"{v:.1f}", ha="center", va="bottom",
                    fontsize=7.5, color=fh.INK_2)
    ax.set_xticks(x, [LADDER[s] for s in cv.index], fontsize=7.5)
    fh.clean(ax)
    ax.set_ylabel("Median error, %")
    ax.set_ylim(0, 112)
    ax.legend(frameon=False, fontsize=8, loc="upper right")
    fh.title(ax, "Gradient boosting beats the exchange rate for every area smaller than a continent",
             "Median error on held out years and regions, Terra and Aqua years")
    fh.source(fig, "Source: NASA FIRMS; analysis: Fire Harmony")
    fh.save(fig, str(path))
    plt.close(fig)


def _series(kind, id_):
    d = _json("web", "series", kind, f"{id_}.json")
    s = pd.DataFrame({"ym": d["ym"], "h": d["h"]})
    s["yr"], s["mo"] = s.ym // 100, s.ym % 100
    return s


CAL_NORM = (10, None)     # one colour scale for every calendar in the report: 10 hotspots up to the largest month


def _cal_norm(ids):
    from matplotlib.colors import LogNorm
    top = max(_series(k, i).h.max() for k, i in ids)
    return LogNorm(vmin=CAL_NORM[0], vmax=top)


def calendar(fh, path, kind, id_, title, subtitle, norm, colorbar=True, oni=None) -> None:
    """A burning calendar at the full text width: years across, months down, one colour scale for all calendars.
    The layout is fixed in millimetres, so every calendar of the report has cells of the same size."""
    import matplotlib.pyplot as plt
    from matplotlib.ticker import FuncFormatter
    s = _series(kind, id_)
    s = s[s.yr.between(2001, 2026)]
    m = s.pivot(index="mo", columns="yr", values="h").reindex(index=range(1, 13), columns=range(2001, 2027))
    v = m.to_numpy(dtype=float)
    shown = np.where(np.isnan(v), np.nan, np.maximum(v, norm.vmin))
    W, left, width, heat_h = 158.0, 13.0, 141.0, 48.0             # millimetres; with the save margin, the 164 mm text width
    y = 13.0 + 3.0 + 9.0 if colorbar else 7.0                        # bottom of the lowest strip (room for year labels)
    y_oni = y if oni is not None else None
    y_heat = y + (7.0 if oni is not None else 0.0)
    H = y_heat + heat_h + 15.0
    fig = plt.figure(figsize=(W * fh.MM, H * fh.MM), layout="none")
    rect = lambda x0, y0, w, h: [x0 / W, y0 / H, w / W, h / H]
    ax = fig.add_axes(rect(left, y_heat, width, heat_h))
    mesh = ax.pcolormesh(np.arange(27), np.arange(13), shown, cmap="ember", norm=norm, edgecolors=fh.SURFACE, linewidth=1.2)
    for i, j in zip(*np.where(np.isnan(v))):
        ax.add_patch(plt.Rectangle((j, i), 1, 1, fill=False, hatch="////", edgecolor=fh.BASELINE, lw=0))
    years = list(range(2001, 2027, 5))
    ax.set_yticks(np.arange(12) + 0.5, MONTHS, fontsize=7.5)
    ax.set_xticks(np.arange(0, 26, 5) + 0.5, [str(t) for t in years], fontsize=7.5)
    ax.set_xlim(0, 26)
    ax.set_ylim(12, 0)
    ax.tick_params(length=0)
    ax.grid(False)
    for sp in ax.spines.values():
        sp.set_visible(False)
    fh.title(ax, title, subtitle)
    if oni is not None:
        ax.tick_params(labelbottom=False)
        ox = fig.add_axes(rect(left, y_oni, width, 6.0), sharex=ax)
        el = oni[oni >= 0.5]
        ox.scatter(el.index - 2001 + 0.5, np.zeros(len(el)), s=10 + 22 * (el.values - 0.5), color=fh.INK, zorder=3, lw=0)
        for yr, o in el.items():
            ox.annotate(f"{o:.1f}", (yr - 2001 + 0.5, 0), xytext=(5, 0), textcoords="offset points", ha="left",
                        va="center", fontsize=7, color=fh.INK_2)
        ox.set_ylim(-1, 1)
        ox.set_yticks([0], ["El Niño"], fontsize=7.5)
        ox.set_xticks(np.arange(0, 26, 5) + 0.5, [str(t) for t in years], fontsize=7.5)
        ox.tick_params(length=0)
        ox.grid(False)
        for sp in ox.spines.values():
            sp.set_visible(False)
        ox.set_facecolor("none")
    if colorbar:
        cax = fig.add_axes(rect(left + width * 0.22, 13.0, width * 0.56, 3.0))
        cb = fig.colorbar(mesh, cax=cax, orientation="horizontal")
        cb.outline.set_visible(False)
        cb.set_ticks([t for t in (10, 100, 1000, 10000, 100000) if norm.vmin <= t <= norm.vmax])
        cb.ax.xaxis.set_major_formatter(FuncFormatter(_thousands))
        cb.ax.minorticks_off()
        cb.ax.tick_params(labelsize=7.5, length=0)
        cb.set_label("Harmonized hotspots per month, the same scale for every calendar (log scale; hatched: no data yet)",
                     fontsize=7.5, color=fh.INK_2)
    for x in (0.0, 1.0):          # invisible marks at both edges: every calendar keeps the same width when saved
        fig.text(x, 0.5, ".", alpha=0, ha="left" if x == 0 else "right")
    src = "Source: NASA FIRMS (MODIS C6.1, VIIRS 375 m), harmonized by Fire Harmony"
    if oni is not None:
        src += ". El Niño: a mean ONI of August to October of 0.5 or more (NOAA CPC), with its value"
    fh.source(fig, src)
    fh.save(fig, str(path))
    plt.close(fig)


def calendars(fh, fig_dir) -> None:
    ids = [("country", "MYS"), ("state", "IDN-1931"), ("state", "ARG-1308")]
    norm = _cal_norm(ids)
    d = pd.read_parquet(_pub("drivers.parquet"), columns=["kind", "id", "yr", "mo", "oni"])
    oni = d[(d.id == "IDN-1931") & d.mo.between(8, 10)].groupby("yr").oni.mean()
    calendar(fh, fig_dir / "fig10_calendar_malaysia", "country", "MYS",
             "Fire in Malaysia is about a fifth of what it was in the early 2000s",
             "Harmonized hotspots per month, NOAA-20 VIIRS scale", norm, colorbar=False)
    calendar(fh, fig_dir / "fig12_calendar_central_kalimantan", "state", "IDN-1931",
             "Central Kalimantan burns hardest in El Niño years, as in 2026",
             "Harmonized hotspots per month, NOAA-20 VIIRS scale; dots: El Niño years", norm, oni=oni)
    calendar(fh, fig_dir / "fig25_calendar_corrientes", "state", "ARG-1308",
             "Corrientes burned in summer 2022, far outside its critical period",
             "Harmonized hotspots per month, NOAA-20 VIIRS scale, Argentina", norm)


SEASON_AREAS = [("country", "MYS", "Malaysia"), ("state", "IDN-492", "Riau, Indonesia"),
                ("state", "IDN-1931", "Central Kalimantan, Indonesia")]


def normal_season(fh, path) -> None:
    import matplotlib.pyplot as plt
    from matplotlib.ticker import FuncFormatter
    places = {(r["kind"], r["id"]): r for r in _json("web", "places.json")["rows"]}
    fig, axes = plt.subplots(1, 3, figsize=fh.SIZE["full"], sharex=True)
    for ax, (kind, id_, name) in zip(axes, SEASON_AREAS):
        s = _series(kind, id_)
        b = s[s.yr.between(2001, 2025)].groupby("mo").h
        med, q25, q75 = b.median(), b.quantile(0.25), b.quantile(0.75)
        for m in places[(kind, id_)]["critical_months"]:
            ax.axvspan(m - 0.5, m + 0.5, color=fh.GRID, alpha=0.7, lw=0, zorder=0)
        ax.fill_between(med.index, q25, q75, color=fh.EMBER[2], alpha=0.5, lw=0)
        ax.plot(med.index, med, color=fh.EMBER[6], lw=2)
        ax.set_xticks(range(1, 13), list("JFMAMJJASOND"), fontsize=7.5)
        ax.yaxis.set_major_formatter(FuncFormatter(_thousands))
        ax.set_ylim(0, None)
        fh.clean(ax)
        ax.set_title(name, loc="left", fontsize=10, fontweight="semibold", color=fh.INK, pad=6)
    axes[0].set_ylabel("Hotspots per month")
    _headline(fig, "The season peaks in August in Malaysia and Riau,\nand in September in Central Kalimantan")
    fh.source(fig, "Line: the median month of 2001 to 2025; band: the middle half of the years; grey: the critical period "
                   "by CONAE's rule (a month above the 75th percentile of all months in at least half of the years). " + SRC)
    fh.save(fig, str(path))
    plt.close(fig)


def _state_hexes(con, values: pd.Series) -> pd.DataFrame:
    """Level 3 hexagons with the value of the state that holds most of their level 5 cells."""
    con.register("_sv", pd.DataFrame({"state_code": values.index, "v": values.values}))
    out = con.execute(f"""
      WITH c AS (SELECT h3_cell_to_parent(h3, 3) AS hex, state_code, count(*) AS n FROM '{_pub('cells.parquet')}'
                 WHERE state_code IS NOT NULL GROUP BY 1, 2),
           top AS (SELECT hex, arg_max(state_code, n) AS state_code FROM c GROUP BY 1)
      SELECT h3_cell_to_boundary_wkt(top.hex) AS wkt, _sv.v FROM top JOIN _sv USING (state_code)""").df()
    con.unregister("_sv")
    return out


def driver_skill_map(fh, path, con, borders) -> None:
    import matplotlib.pyplot as plt
    from matplotlib.colors import Normalize
    mods = pd.read_parquet(_pub("drivers_models.parquet"))
    st = mods[mods.kind == "state"].set_index("id").r2_cv.clip(lower=0)
    hx = _state_hexes(con, st)
    fig, ax = plt.subplots(figsize=fh.SIZE["full"])
    pc = fh.world_hexmap(ax, hx.wkt, hx.v.to_numpy(), cmap=_cmap(SLATE, "slate"), norm=Normalize(0, 0.6), border_wkts=borders)
    cb = fig.colorbar(pc, ax=ax, fraction=0.03, pad=0.01, orientation="horizontal", shrink=0.6)
    cb.outline.set_visible(False)
    cb.set_ticks([0, 0.2, 0.4, 0.6])
    cb.set_ticklabels(["0", "0.2", "0.4", "0.6 or more"])
    cb.set_label("Share of the ups and downs of fire that rain and heat explain (R², held out years)", color=fh.INK_2, fontsize=8)
    fh.title(ax, "Rain explains fire best in the peat and forest fires of the tropics",
             "States with at least 300 hotspots a year, shown on level 3 hexagons")
    fh.source(fig, "Source: NASA FIRMS, GPM IMERG, MERRA-2; analysis: Fire Harmony")
    fh.save(fig, str(path))
    plt.close(fig)


def enso_rain_map(fh, path, con, borders) -> None:
    import matplotlib.pyplot as plt
    from matplotlib.colors import TwoSlopeNorm
    mods = pd.read_parquet(_pub("drivers_models.parquet"))
    st = mods[mods.kind == "state"].set_index("id").enso_r.dropna()
    hx = _state_hexes(con, st)
    fig, ax = plt.subplots(figsize=fh.SIZE["full"])
    pc = fh.world_hexmap(ax, hx.wkt, hx.v.clip(-0.7, 0.7).to_numpy(), cmap=_cmap(BROWN_TEAL, "brown_teal"),
                         norm=TwoSlopeNorm(0, -0.7, 0.7), border_wkts=borders)
    cb = fig.colorbar(pc, ax=ax, fraction=0.03, pad=0.01, orientation="horizontal", shrink=0.6)
    cb.outline.set_visible(False)
    cb.set_ticks([-0.7, -0.35, 0, 0.35, 0.7])
    cb.set_ticklabels([f"{MINUS}0.7\nEl Niño dries", f"{MINUS}0.35", "0", "0.35", "0.7\nEl Niño wets"])
    cb.set_label("Correlation of El Niño (ONI) with the three month rain", color=fh.INK_2, fontsize=8)
    fh.title(ax, "El Niño dries Indonesia, Australia and northern South America",
             "States, fire season months, at the best lag of 0 to 6 months")
    fh.source(fig, "Source: NOAA CPC ONI, GPM IMERG; analysis: Fire Harmony")
    fh.save(fig, str(path))
    plt.close(fig)


def outlook_skill(fh, path) -> dict:
    import json
    import matplotlib.pyplot as plt
    cal = pd.DataFrame(_json("dashboard.json")["outlook"]["calibration"])
    cal = cal[cal.n >= 200]
    sc = json.loads((C.REPO / "models" / "outlook.json").read_text())["score"]
    fixed = 0.25
    fig, axes = plt.subplots(1, 2, figsize=fh.SIZE["full"], gridspec_kw={"width_ratios": [1, 1.25]})
    ax = axes[0]
    ax.plot([0, 1], [0, 1], color=fh.BASELINE, lw=0.8, ls=(0, (3, 2)))
    ax.plot(cal.p, cal.o, marker="o", ms=3.5, color=fh.INK, lw=1.6)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_xticks([0, 0.25, 0.5, 0.75, 1], ["0%", "25%", "50%", "75%", "100%"])
    ax.set_yticks([0, 0.25, 0.5, 0.75, 1], ["0%", "25%", "50%", "75%", "100%"])
    ax.set_xlabel("Chance given")
    ax.set_ylabel("Share of times above normal")
    ax.text(0.97, 0.05, "On the dashed line,\nthe chances are exact", ha="right", va="bottom", fontsize=7.5, color=fh.INK_2)
    fh.clean(ax, grid_axis="both")
    fh.title(ax, "The chances are honest", "Held out years, all areas and leads")
    ax = axes[1]
    leads = [1, 2, 3]
    bs = [sc[f"lead {L}"]["brier"] for L in leads]
    clim = sc["lead 1"]["brier_clim"]
    ax.bar(leads, bs, 0.55, color=fh.INK, zorder=2)
    for L, b in zip(leads, bs):          # inside the bar, so the labels never meet the reference lines
        ax.text(L, b - 0.008, f"{b:.3f}\nskill {1 - b / fixed:.2f}", ha="center", va="top", fontsize=7.5,
                color=fh.SURFACE, zorder=3, linespacing=1.3)
    ax.axhline(fixed, color=fh.EMBER[6], lw=1.2, zorder=4)
    ax.text(0.45, fixed + 0.004, f"A fixed 50% chance: {fixed:.3f}", ha="left", va="bottom", fontsize=7.5, color=fh.EMBER[6])
    ax.axhline(clim, color=fh.MUTED, lw=1.0, ls=(0, (3, 2)), zorder=4)
    ax.text(0.45, clim + 0.004, f"Share of other years above normal: {clim:.3f}", ha="left", va="bottom", fontsize=7.5,
            color=fh.INK_2)
    ax.set_xticks(leads, ["1 month", "2 months", "3 months"])
    ax.set_xlim(0.4, 3.6)
    ax.set_ylim(0, 0.335)
    ax.set_ylabel("Brier score (lower is better)")
    fh.clean(ax)
    fh.title(ax, "The skill fades by three months", "Brier score of the outlook by lead, and two references")
    fh.source(fig, "Skill: the Brier skill score against a fixed 50% chance. The share of other years above normal is a weaker "
                   "reference than it looks, because holding out a year moves it the wrong way. "
                   "Source: NASA FIRMS, GPM IMERG, MERRA-2, NOAA; analysis: Fire Harmony")
    fh.save(fig, str(path))
    plt.close(fig)
    return {f"lead {L}": round(1 - b / fixed, 3) for L, b in zip(leads, bs)}


def haze_kuala_lumpur(fh, path) -> dict:
    import json
    import matplotlib.pyplot as plt
    hz = json.loads((C.REPO / "models" / "haze.json").read_text())
    k = hz["cities"]["Kuala Lumpur"]["ug_per_1000_hotspots"]
    h = pd.read_parquet(_pub("haze.parquet"))
    kl = h[(h.city == "Kuala Lumpur") & h.mo.between(8, 10) & (h.yr >= hz["fit_years"][0])]   # the CNN PM2.5 starts in 2002
    y = kl.groupby("yr").agg(obs=("pm25_cnn", "mean"), mod=("pm25_model", "mean"), s=("fire_sumatra_k", "mean"),
                             b=("fire_borneo_k", "mean"), smoke=("smoke_model", "mean"))
    y.loc[kl.groupby("yr").pm25_cnn.count() < 3, "obs"] = np.nan      # a season counts only with all three months
    fig, axes = plt.subplots(2, 1, figsize=(fh.SIZE["full"][0], 112 * fh.MM), sharex=True, gridspec_kw={"height_ratios": [1.25, 1]})
    ax = axes[0]
    ax.vlines(y.index, y[["obs", "mod"]].min(axis=1), y[["obs", "mod"]].max(axis=1), color=fh.GRID, lw=1.2, zorder=1)
    ax.scatter(y.index, y["mod"], s=30, facecolors=fh.SURFACE, edgecolors=fh.EMBER[5], lw=1.3, zorder=3, label="Model: the season plus the fires")
    ax.scatter(y.index, y.obs, s=22, color=fh.INK, zorder=4, label="MERRA-2 CNN PM2.5")
    ax.set_ylabel("PM2.5, µg/m³")
    ax.set_ylim(0, None)
    ax.legend(frameon=False, fontsize=7.5, loc="upper left", ncol=2, handletextpad=0.3)
    fh.clean(ax)
    fh.title(ax, "Kuala Lumpur breathes Sumatra's fires", "Mean PM2.5 of August to October, each season")
    ax = axes[1]
    ss, sb = k["sumatra"] * y.s, k["borneo"] * y.b
    ax.bar(y.index, ss, color=fh.EMBER[5], width=0.75, label="Fires in Sumatra")
    ax.bar(y.index, sb, bottom=ss, color=fh.EMBER[2], width=0.75, label="Fires in Borneo")
    ax.set_ylabel("Smoke, µg/m³")
    ax.legend(frameon=False, fontsize=7.5, loc="upper left")
    fh.clean(ax)
    ax.set_title("Smoke added by fires, August to October mean", loc="left", fontsize=10, fontweight="semibold", color=fh.INK, pad=6)
    ax.set_xlim(y.index.min() - 0.7, y.index.max() + 0.7)
    fh.year_axis(ax, 2005, int(y.index.max()))
    ax.spines["bottom"].set_bounds(y.index.min() - 0.4, y.index.max() + 0.4)
    fh.source(fig, "2026 has no CNN PM2.5 yet, so it shows the model only. Source: NASA MERRA-2 CNN PM2.5, NASA FIRMS; "
                   "analysis: Fire Harmony")
    fh.save(fig, str(path))
    plt.close(fig)
    return {"smoke_2015": round(float(y.smoke.get(2015)), 1)}


def modis_detection(fh, path) -> None:
    import matplotlib.pyplot as plt
    ph = _json("dashboard.json")["physics"]
    c = pd.DataFrame(ph["curve"])
    terra = "#86b3ea"
    fig, axes = plt.subplots(1, 2, figsize=fh.SIZE["full"], sharey=True)
    for ax, part, name in ((axes[0], "day", "By day"), (axes[1], "night", "At night")):
        ax.axhline(50, color=fh.BASELINE, lw=0.8, ls=(0, (3, 2)))
        ax.plot(c.frp, 100 * c[f"aqua_{part}"], color=fh.SENSOR["MODIS"], lw=2.2, marker="o", ms=3)
        ax.plot(c.frp, 100 * c[f"terra_{part}"], color=terra, lw=1.5, ls=(0, (2.2, 1.6)), marker="o", ms=2.5)
        half = ph["half_mw"].get(f"aqua_{part}")
        if half:
            ax.axvline(half, color=fh.MUTED, lw=0.8, ls=":")
            ax.text(half * 1.1, 4, f"Aqua sees half\nat {half:.0f} MW", fontsize=7.5, color=fh.INK_2, va="bottom")
        ia = int(np.argmax(c.frp.values >= 100))
        ax.annotate("Aqua", (c.frp[ia], 100 * c[f"aqua_{part}"][ia]), xytext=(0, 6), textcoords="offset points",
                    ha="center", va="bottom", fontsize=8, color=fh.INK)
        ax.annotate("Terra", (c.frp[ia], 100 * c[f"terra_{part}"][ia]), xytext=(0, -7), textcoords="offset points",
                    ha="center", va="top", fontsize=8, color=fh.INK)
        ax.set_xscale("log")
        ax.set_xticks([1, 10, 100], ["1", "10", "100"])
        ax.minorticks_off()
        ax.set_ylim(0, 100)
        ax.set_xlabel("FRP that VIIRS measured (MW, log scale)")
        fh.clean(ax)
        ax.set_title(name, loc="left", fontsize=10.5, fontweight="semibold", color=fh.INK, pad=6)
    axes[0].set_ylabel("Also seen by MODIS on the same day (%)")
    _headline(fig, "MODIS sees strong fires and misses most weak ones")
    fh.source(fig, "Suomi NPP 375 m hotspots on 10 test areas in 2019 with a clear MODIS view. MODIS saw the fire when its daily "
                   "map (the strongest of all passes) shows fire in the 3 by 3 window of 1 km cells around it. "
                   "Source: NASA FIRMS (VIIRS 375 m), MOD14A1 and MYD14A1 (MODIS C6.1); analysis: Fire Harmony")
    fh.save(fig, str(path))
    plt.close(fig)


def model_vs_viirs(fh, path, y: pd.DataFrame) -> None:
    """World hotspots per year in the months VIIRS observed: VIIRS and the model from MODIS alone. `y` has the columns
    viirs_observed and model_terra_aqua (hotspots), indexed by year (notebook 06 computes it)."""
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=fh.SIZE["full"])
    ax.axvspan(2011.6, 2019.5, color=fh.GRID, alpha=0.45, lw=0)
    ax.text(2012, 1.0, "Training years", fontsize=7.5, color=fh.INK_2)
    ax.text(2019.8, 1.0, "Held out years", fontsize=7.5, color=fh.INK_2)
    ax.plot(y.index, y.viirs_observed / 1e6, color=fh.SENSOR["VIIRS_NOAA20"], lw=2)
    ax.plot(y.index, y.model_terra_aqua / 1e6, color=fh.INK, lw=2.6)
    fh.label_ends(ax, [(y.index[-1], y.viirs_observed.iloc[-1] / 1e6, "VIIRS observed"),
                       (y.index[-1], y.model_terra_aqua.iloc[-1] / 1e6, "Model from MODIS")], gap=1.1)
    gap = 100 * (y.model_terra_aqua / y.viirs_observed - 1)
    for yr in (2020, 2021):
        if yr in gap.index:
            ax.annotate(f"{gap[yr]:+.1f}%".replace("-", MINUS), (yr, y.model_terra_aqua[yr] / 1e6), xytext=(0, -12),
                        textcoords="offset points", ha="center", va="top", fontsize=7.5, color=fh.INK)
    fh.clean(ax)
    ax.set_xlim(2011.5, 2028)
    ax.set_ylim(0, None)
    ax.set_ylabel("Million hotspots per year (NOAA-20 scale)")
    fh.year_axis(ax, 2012, int(y.index.max()), step=2)
    fh.title(ax, "The model tracks VIIRS in its training years and reads low after them",
             "World, hotspots per year, months observed by VIIRS")
    ax.title.set_fontsize(11.5)
    fh.source(fig, "Source: NASA FIRMS; analysis: Fire Harmony")
    fh.save(fig, str(path))
    plt.close(fig)


REPORT_FIGURES = ("fig01", "fig02", "fig03", "fig05", "fig07", "fig10", "fig11", "fig15", "fig16", "fig17", "fig18", "fig19",
                  "fig22")


def report_figures(only=REPORT_FIGURES, log=print) -> dict:
    """Redraw the report figures that come from the published files (see the list above). Returns a few numbers that
    the report quotes, so a check can compare them with the text."""
    import matplotlib.pyplot as plt
    fh = _fh()
    con = C.connect()
    con.execute("SET memory_limit = '1GB'")
    con.execute("SET threads = 2")
    borders = None
    out = {}
    for key in only:
        if key in ("fig05", "fig15", "fig16", "fig22") and borders is None:
            borders = _borders(con)
        if key == "fig01":
            fires_per_satellite(fh, FIG / "fig01_fires_per_satellite")
        elif key == "fig02":
            out["ratio_by_land_cover"] = ratio_by_land_cover(fh, FIG / "fig02_ratio_by_land_cover", con).set_index("lc_main").ratio.round(2).to_dict()
        elif key == "fig03":
            out["naive_jump"] = seam_test(fh, FIG / "fig03_seam_test")
        elif key == "fig05":
            world_fire_map(fh, FIG / "fig05_world_fire_map", con, borders)
        elif key == "fig07":
            model_ladder(fh, FIG / "fig07_model_ladder")
        elif key == "fig10":
            calendars(fh, FIG)
        elif key == "fig11":
            normal_season(fh, FIG / "fig11_normal_season")
        elif key == "fig15":
            driver_skill_map(fh, FIG / "fig15_driver_skill_map", con, borders)
        elif key == "fig16":
            enso_rain_map(fh, FIG / "fig16_enso_rain_link", con, borders)
        elif key == "fig17":
            out["outlook_bss_fixed_50"] = outlook_skill(fh, FIG / "fig17_outlook_skill")
        elif key == "fig18":
            out.update(haze_kuala_lumpur(fh, FIG / "fig18_haze_kuala_lumpur"))
        elif key == "fig19":
            modis_detection(fh, FIG / "fig19_modis_detection_curve")
        elif key == "fig22":
            res = _json("web", "eda.json")
            r3 = pd.read_parquet(_pub("eda", "exchange_rate_l3.parquet"))
            exchange_map(res, r3, con, borders, fh, FIG / "fig22_exchange_rate_map")
        log(f"report figure: {key}")
        plt.close("all")
    con.close()
    return out
