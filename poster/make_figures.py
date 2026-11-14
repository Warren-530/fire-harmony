"""The poster's figures, drawn at the size they print on the A1 poster so every label reads from two metres.

The report's figures are drawn for an A4 page: on the poster their legends and axes shrink to 7 to 12 pt. These are the
same data, drawn again with 18 pt labels, no titles (the poster cards carry them) and no source lines (the poster
footer carries them). Run from the repository root, after `fireharmony eda` and `fireharmony publish`:

    .venv/bin/python poster/make_figures.py

Writes poster/img/p_exchange.pdf, p_trend.pdf, p_seam.pdf and p_calendar.pdf. Inputs: eda/summary.json and the eda
tables (as `fireharmony eda --figures` uses them), the world series of `fireharmony validate` (work/models/world_monthly.parquet)
and models/area_intervals.json (as the report's seam figure uses them) and the published series of Central Kalimantan
(web/series/state/IDN-1931.json). The exchange rate map uses one violet hue (a magnitude), so it never reads like the
trend map's blue to red; the seam figure labels both panels on one scale, in thousands.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from fireharmony import config as C, eda as E, eda_figures as F, harmonize as H, validate as V  # noqa: E402
from fireharmony import publish as PB  # noqa: E402

OUT = REPO / "poster" / "img"
MM = 1 / 25.4
CARD_W = 250            # inner width of a poster card, mm
LABEL = 18              # every label on a poster figure, pt
HEAD = 20               # panel titles inside a figure, pt
PREVIEW = "/tmp/fh_poster_preview"
# the exchange rate is a magnitude, not a polarity: one violet hue, light to dark, so it never reads like the trend map's
# blue to red (checked with the dataviz validator: monotone lightness, steps at least 0.06 apart, one hue)
VIOLET = ["#c9bff3", "#ab9deb", "#8d7ce2", "#6f5bd8", "#5644c0", "#43329c", "#30237a", "#21185a"]


def _style(fh):
    import matplotlib as mpl
    mpl.rcParams.update({"font.size": LABEL, "axes.labelsize": LABEL, "xtick.labelsize": LABEL, "ytick.labelsize": LABEL,
                         "legend.fontsize": LABEL, "axes.titlesize": HEAD, "savefig.pad_inches": 0.04,
                         "figure.constrained_layout.use": False, "lines.linewidth": 3})


def _crop_world(ax, fh, south=-57, north=84):
    """Fire never burns on Antarctica or the high Arctic: trim them so the land fills the card."""
    x, _ = fh.equal_earth(np.array([-180.0, 180.0]), np.array([0.0, 0.0]))
    _, y = fh.equal_earth(np.array([0.0, 0.0]), np.array([south, north], float))
    ax.set_xlim(x[0] * 1.005, x[1] * 1.005)
    ax.set_ylim(y[0], y[1])


def _save(fig, name):
    fig.savefig(OUT / f"{name}.pdf")
    fig.savefig(f"{PREVIEW}/{name}.png", dpi=60)                     # small preview for a look by eye
    print("poster figure", name)


def exchange(res, r3, con, borders, fh):
    import matplotlib.pyplot as plt
    from matplotlib.colors import LinearSegmentedColormap, Normalize
    s = res["exchange_rate_l3"]
    x = r3[r3.aqua >= E.RATIO_MIN_AQUA].copy()
    x["ratio"] = x.snpp / x.aqua
    low = r3[(r3.aqua < E.RATIO_MIN_AQUA) & ((r3.aqua > 0) | (r3.snpp > 0))]
    fig = plt.figure(figsize=(CARD_W * MM, 106 * MM))
    ax = fig.add_axes((0, 0.30, 1, 0.70))
    fh.world_hexmap(ax, F._wkt(con, low.h3), colors=[fh.GRID] * len(low), outline=False)
    world = s["world"]
    norm = Normalize(vmin=np.log(2), vmax=np.log(18))
    violet = LinearSegmentedColormap.from_list("violet", VIOLET)
    pc = fh.world_hexmap(ax, F._wkt(con, x.h3), np.log(x.ratio.clip(2, 18)).to_numpy(), cmap=violet, norm=norm,
                         border_wkts=borders, outline=False)
    _crop_world(ax, fh)
    cax = fig.add_axes((0.2, 0.19, 0.6, 0.05))
    cb = fig.colorbar(pc, cax=cax, orientation="horizontal")
    cb.outline.set_visible(False)
    ticks = [2, 3, 4, world, 10, 15]
    cb.set_ticks(np.log(ticks))
    cb.set_ticklabels(["2", "3", "4", f"{world:.1f} world", "10", "15"])       # world has 4 decimals: one rounding
    cb.ax.tick_params(length=0, labelsize=LABEL, colors=fh.INK_2)
    fig.text(0.5, 0.0, "Suomi NPP hotspots for every Aqua hotspot", ha="center", va="bottom", fontsize=LABEL, color=fh.INK_2)
    _save(fig, "p_exchange")
    plt.close(fig)


def trend(res, d3, con, borders, fh):
    import matplotlib.pyplot as plt
    from matplotlib.colors import TwoSlopeNorm
    from matplotlib.patches import Patch
    t = d3[d3.tested]
    sig, ns, low = t[t.q_bh <= 0.05], t[~(t.q_bh <= 0.05)], d3[~d3.tested]
    fig = plt.figure(figsize=(CARD_W * MM, 124 * MM))
    ax = fig.add_axes((0, 0.25, 1, 0.75))
    fh.world_hexmap(ax, F._wkt(con, low.h3), colors=[F.LOW_FIRE] * len(low), outline=False)
    fh.world_hexmap(ax, F._wkt(con, ns.h3), colors=[fh.GRID] * len(ns), outline=False)
    norm = TwoSlopeNorm(vcenter=0, vmin=-80, vmax=80)
    pc = fh.world_hexmap(ax, F._wkt(con, sig.h3), sig.pct.clip(-80, 80).to_numpy(), cmap=fh.anomaly_cmap, norm=norm,
                         border_wkts=borders, outline=False)
    _crop_world(ax, fh)
    cax = fig.add_axes((0.03, 0.14, 0.46, 0.043))
    cb = fig.colorbar(pc, cax=cax, orientation="horizontal")
    cb.outline.set_visible(False)
    cb.set_ticks([-80, -40, 0, 40, 80])
    cb.set_ticklabels(["−80%", "−40%", "0", "+40%", "+80%"])
    cb.ax.tick_params(length=0, labelsize=LABEL, colors=fh.INK_2)
    fig.text(0.26, 0.0, "Change of yearly fire a decade", ha="center", va="bottom", fontsize=LABEL, color=fh.INK_2)
    fig.legend(handles=[Patch(facecolor=fh.GRID, label="No clear trend"),
                        Patch(facecolor=F.LOW_FIRE, edgecolor=fh.BASELINE, lw=0.8, label="Too little fire to test")],
               loc="lower left", bbox_to_anchor=(0.58, 0.0), fontsize=LABEL, handlelength=1.4, handleheight=1.1,
               labelcolor=fh.INK_2, frameon=False, borderaxespad=0)
    _save(fig, "p_trend")
    plt.close(fig)


def seam(con, fh):
    """The report's seam figure (validate.seam_figure), at poster size: the naive join jumps, the record does not."""
    import matplotlib.pyplot as plt
    # the world series `fireharmony validate` saved (V.monthly_series), so no pass over the harmonized record is needed
    wm = C.work("models", "world_monthly.parquet")
    world = pd.read_parquet(wm) if wm.exists() else V.monthly_series(con=con)
    iv = json.loads((REPO / "models" / "area_intervals.json").read_text())
    y = world[world.yr.between(2001, 2025)].groupby("yr").sum(numeric_only=True)
    yrs = y.index.to_numpy()
    lo, hi = y.harmonized.copy(), y.harmonized.copy()
    for yr in yrs:
        if yr < 2012:
            ai = H.AreaInterval.from_dict(iv["terra_only_year" if yr < 2003 else "terra_aqua_year"])
            a, b = ai.bounds(y.harmonized[yr])
            lo[yr], hi[yr] = a[0], b[0]
    M = 1e3                     # thousands, labelled with separators on both panels (one shared scale)
    fig, axes = plt.subplots(1, 2, figsize=(CARD_W * MM, 118 * MM), sharey=True)
    fig.subplots_adjust(left=0.16, right=0.88, top=0.87, bottom=0.13, wspace=0.62)
    pre, post = yrs < 2012, yrs >= 2012
    ax = axes[0]
    ax.plot(yrs[pre], y.modis_scale[pre] / M, color=fh.SENSOR["MODIS"])
    ax.plot(yrs[post], y.naive_join[post] / M, color=fh.SENSOR["VIIRS_SNPP"])
    ax.plot([2011, 2012], [y.modis_scale[2011] / M, y.naive_join[2012] / M], color=fh.MUTED, lw=1.5)
    jump = y.naive_join[2012] / y.modis_scale[2011]
    ax.text(2006, y.modis_scale[2006] / M + 900, "MODIS", ha="center", va="bottom", fontsize=LABEL, color=fh.INK_2)
    ax.text(2026, y.naive_join.iloc[-1] / M, "VIIRS", va="center", fontsize=LABEL, color=fh.INK_2)
    ax.set_title(f"Joined naively: {jump:.1f}× jump", loc="left", fontsize=HEAD, fontweight="semibold", color=fh.INK, pad=14)
    ax = axes[1]
    ax.fill_between(yrs, lo / M, hi / M, color=fh.HARMONIZED_BAND, alpha=0.14, lw=0)
    ax.plot(yrs, y.harmonized / M, color=fh.HARMONIZED, lw=3.4)
    ax.text(2026, y.harmonized.iloc[-1] / M, "Harmonized", va="center", fontsize=LABEL, color=fh.INK_2)
    ax.set_title("Harmonized: no jump", loc="left", fontsize=HEAD, fontweight="semibold", color=fh.INK, pad=14)
    for ax in axes:
        fh.clean(ax)
        ax.set_xlim(yrs[0] - 0.5, yrs[-1] + 0.5)
        ax.set_xticks([2005, 2015, 2025])
        ax.spines["bottom"].set_bounds(2001, 2025)
        ax.set_ylim(0, 21000)
        ax.set_yticks([0, 5000, 10000, 15000, 20000], ["0", "5,000", "10,000", "15,000", "20,000"])
        ax.tick_params(colors=fh.INK_2, labelleft=True)
    axes[0].set_ylabel("Thousand hotspots a year", color=fh.INK_2)
    _save(fig, "p_seam")
    plt.close(fig)
    return jump


def calendar(fh):
    import matplotlib.pyplot as plt
    from matplotlib.colors import LogNorm
    s = json.loads(PB.products("web", "series", "state", "IDN-1931.json").read_text())
    d = pd.DataFrame({"ym": s["ym"], "v": s["h"]})
    d["yr"], d["mo"] = d.ym // 100, d.ym % 100
    m = d[d.yr.between(2001, 2026)].pivot(index="yr", columns="mo", values="v").reindex(columns=range(1, 13))
    v = m.to_numpy(float)
    vmin = max(1, np.nanpercentile(v[v > 0], 5))
    shown = np.where(np.isnan(v), np.nan, np.maximum(v, vmin))
    fig = plt.figure(figsize=(150 * MM, 170 * MM))
    ax = fig.add_axes((0.15, 0.18, 0.83, 0.81))
    mesh = ax.pcolormesh(np.arange(13), np.arange(len(m) + 1), shown, cmap="ember",
                         norm=LogNorm(vmin=vmin, vmax=np.nanmax(v)), edgecolors=fh.SURFACE, linewidth=1.6)
    for i, j in zip(*np.where(np.isnan(v))):                             # months with no data yet: hatched
        ax.add_patch(plt.Rectangle((j, i), 1, 1, fill=False, hatch="///", edgecolor=fh.BASELINE, lw=0))
    ax.set_xticks(np.arange(12) + 0.5, list("JFMAMJJASOND"))
    rows = [k for k, yr in enumerate(m.index) if yr % 5 == 1]
    ax.set_yticks(np.array(rows) + 0.5, [str(m.index[k]) for k in rows])
    ax.invert_yaxis()
    ax.tick_params(length=0, colors=fh.INK_2, labelsize=LABEL)
    ax.xaxis.tick_top()
    for sp in ax.spines.values():
        sp.set_visible(False)
    ax.grid(False)
    cax = fig.add_axes((0.15, 0.09, 0.83, 0.027))
    cb = fig.colorbar(mesh, cax=cax, orientation="horizontal")
    cb.outline.set_visible(False)
    ticks = [t for t in (10, 100, 1000, 10000) if vmin <= t <= np.nanmax(v)]
    cb.set_ticks(ticks)
    cb.set_ticklabels([f"{t:,}" for t in ticks])
    cb.minorticks_off()
    cb.ax.tick_params(length=0, labelsize=LABEL, colors=fh.INK_2)
    fig.text(0.565, 0.0, "Hotspots a month (log scale)", ha="center", va="bottom", fontsize=LABEL, color=fh.INK_2)
    _save(fig, "p_calendar")
    plt.close(fig)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    Path(PREVIEW).mkdir(exist_ok=True)
    fh = F._fh()
    _style(fh)
    res = json.loads(E.out("summary.json").read_text())
    d3 = pd.read_parquet(E.out("hex_fdr_l3.parquet"))
    r3 = pd.read_parquet(E.out("exchange_rate_l3.parquet"))
    calendar(fh)
    con = C.connect()
    con.execute("SET memory_limit = '1GB'")
    con.execute("SET threads = 2")
    borders = F._borders(con)
    exchange(res, r3, con, borders, fh)
    trend(res, d3, con, borders, fh)
    jump = seam(con, fh)
    con.close()
    print(f"naive jump {jump:.2f}")


if __name__ == "__main__":
    main()
