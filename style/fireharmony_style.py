"""Fire Harmony visual identity: one style for every plot, map, diagram, app chart and report.

Usage in any notebook / script:
    import fireharmony_style as fh
    fh.use()                                   # fonts + rcParams
    ax.plot(x, y, color=fh.SENSOR["MODIS"])    # colour follows the entity
    fh.title(ax, "Title", "Subtitle"); fh.source(fig, "Source: NASA FIRMS")

Colour rules (validated with the dataviz validator, 7 Nov 2026):
  * Sensors are categorical, in FIXED order: MODIS blue, VIIRS Suomi NPP orange, VIIRS NOAA-20 aqua,
    VIIRS NOAA-21 yellow. Passes adjacent-pair CVD + normal-vision checks in light and dark mode.
    Aqua and yellow are below 3:1 contrast on the light surface, so always direct-label or offer a table.
  * The HARMONIZED record is not a hue: it is the emphasis line in primary ink (thicker), so it reads
    as "the answer" and never collides with a sensor colour.
  * Magnitude (fire amount) uses the single-family EMBER ramp; anomalies use the blue-grey-red DIVERGING
    ramp with mirrored lightness. Never a rainbow; never a dual axis.
"""
from pathlib import Path
import matplotlib as mpl
import numpy as np
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.colors import LinearSegmentedColormap, ListedColormap

HERE = Path(__file__).resolve().parent

# ---------- surfaces & ink ----------
SURFACE = "#fcfcfb"; SURFACE_DARK = "#1a1a19"; PAGE = "#f9f9f7"
INK = "#0b0b0b"; INK_2 = "#52514e"; MUTED = "#898781"
GRID = "#e1e0d9"; BASELINE = "#c3c2b7"

# ---------- categorical: sensors (fixed order, never cycled) ----------
SENSOR = {"MODIS": "#2a78d6", "VIIRS_SNPP": "#eb6834", "VIIRS_NOAA20": "#1baf7a", "VIIRS_NOAA21": "#eda100"}
SENSOR_DARK = {"MODIS": "#3987e5", "VIIRS_SNPP": "#d95926", "VIIRS_NOAA20": "#199e70", "VIIRS_NOAA21": "#c98500"}
SENSOR_LABEL = {"MODIS": "MODIS (Terra + Aqua)", "VIIRS_SNPP": "VIIRS Suomi NPP", "VIIRS_NOAA20": "VIIRS NOAA-20", "VIIRS_NOAA21": "VIIRS NOAA-21"}
HARMONIZED = INK            # emphasis line, lw 2.6
HARMONIZED_BAND = "#0b0b0b" # uncertainty band, alpha 0.12

# extra categorical slots for non-sensor series (e.g. regions), same validated order continues
CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]

# ---------- sequential: EMBER (fire amount), light -> dark, OKLab L 0.97 -> 0.29 ----------
EMBER = ["#fff3e4", "#fed6af", "#feb079", "#fc7f41", "#e75623", "#c8331a", "#a21b18", "#790d14", "#520d13"]
# ---------- diverging: anomaly below <- normal -> above (mirrored lightness) ----------
ANOMALY = ["#0b4c92", "#3a75bf", "#78a1d6", "#b7cde8", "#f0efec", "#e7c0bc", "#d6857f", "#bc4a41", "#862723"]
# ---------- status (reserved, always with icon + label) ----------
STATUS = {"good": "#0ca30c", "warning": "#fab219", "serious": "#ec835a", "critical": "#d03b3b"}

ember_cmap = LinearSegmentedColormap.from_list("ember", EMBER)
anomaly_cmap = LinearSegmentedColormap.from_list("anomaly", ANOMALY)
for cm in (ember_cmap, anomaly_cmap):
    try:
        mpl.colormaps.register(cm)
    except ValueError:
        pass

# ---------- figure sizes (report: A4, 170 mm text width) ----------
MM = 1 / 25.4
SIZE = {"full": (170 * MM, 95 * MM), "full_tall": (170 * MM, 130 * MM), "half": (82 * MM, 62 * MM), "slide": (13.33, 7.5), "poster_panel": (250 * MM, 160 * MM)}


def use(dark=False):
    """Register Inter and apply the house rcParams."""
    for f in (HERE / "fonts").glob("Inter-*.ttf"):
        font_manager.fontManager.addfont(str(f))
    plt.style.use(str(HERE / "fireharmony.mplstyle"))
    if dark:
        mpl.rcParams.update({"figure.facecolor": SURFACE_DARK, "axes.facecolor": SURFACE_DARK, "savefig.facecolor": SURFACE_DARK,
                             "text.color": "#f0efec", "axes.labelcolor": "#c3c2b7", "xtick.color": MUTED, "ytick.color": MUTED,
                             "axes.edgecolor": "#383835", "grid.color": "#2c2c2a"})


def title(ax, text, subtitle=None):
    """Left-aligned title + optional muted subtitle above the plot area."""
    ax.set_title(text, loc="left", fontsize=12.5, fontweight="semibold", color=INK, pad=22 if subtitle else 10)
    if subtitle:
        ax.text(0, 1.02, subtitle, transform=ax.transAxes, fontsize=8.5, color=INK_2, va="bottom")


def source(fig, text):
    """Source / note line, muted, under everything else. save() places it once the layout is final, so it never covers
    an axis label, a tick label or a colour bar (a fixed spot at the bottom of the figure used to)."""
    fig._fh_source = text


def _place_source(fig):
    text = getattr(fig, "_fh_source", None)
    if not text or getattr(fig, "_fh_source_artist", None) is not None:
        return
    import textwrap
    fig.canvas.draw()                                   # runs the layout engine: axes are where they will be saved
    bb = fig.get_tightbbox(fig.canvas.get_renderer())   # inches, every artist drawn so far
    w, h = fig.get_size_inches()
    chars = max(40, int(bb.width * 72 / 3.7))           # Inter at 7 pt is about 3.7 pt per character
    fig._fh_source_artist = fig.text(bb.x0 / w, (bb.y0 - 5 / 72) / h, textwrap.fill(text, chars), fontsize=7, color=MUTED,
                                     ha="left", va="top", linespacing=1.35)


def direct_label(ax, x, y, text, dy=0):
    """Label at a line end: text in ink (never the series colour)."""
    ax.annotate(text, (x, y), xytext=(6, dy), textcoords="offset points", va="center", fontsize=8.5, color=INK_2)


def label_ends(ax, items, gap, dx=6):
    """Labels at line ends (x, y, text), moved apart vertically so they never overlap: `gap` is the smallest distance
    between two labels, in data units of y. The group stays centred on the line ends."""
    items = sorted(items, key=lambda t: t[1])
    ys = [t[1] for t in items]
    for i in range(1, len(ys)):
        ys[i] = max(ys[i], ys[i - 1] + gap)
    shift = (sum(t[1] for t in items) - sum(ys)) / max(1, len(ys))
    for (x, _, text), y in zip(items, ys):
        ax.annotate(text, (x, y + shift), xytext=(dx, 0), textcoords="offset points", va="center", fontsize=8.5, color=INK_2)


def year_axis(ax, first, last, step=5):
    """A year axis that stops at the data: ticks and the axis line end at `last`, the space to the right is for labels."""
    ticks = [y for y in range(first - first % step + step if first % step else first, last + 1, step)]
    ax.set_xticks(ticks)
    ax.spines["bottom"].set_bounds(first, last)


def clean(ax, grid_axis="y"):
    """Recessive frame: no top/right/left spines, hairline grid on one axis."""
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.grid(axis=grid_axis, color=GRID, lw=0.6)
    ax.set_axisbelow(True)
    ax.tick_params(length=0)


def save(fig, path_stem):
    """Vector PDF for the report + 2x PNG for web/slides (with the source line under the figure)."""
    _place_source(fig)
    fig.savefig(f"{path_stem}.pdf")
    fig.savefig(f"{path_stem}.png", dpi=240)


# ---------- world maps: Equal Earth projection with H3 hexagons ----------
_EE = (1.340264, -0.081106, 0.000893, 0.003796)


def equal_earth(lon, lat):
    """Equal Earth projection (Savric et al. 2018), unit sphere. Equal area, so hexagons keep their true size."""
    a1, a2, a3, a4 = _EE
    m = np.sqrt(3) / 2
    th = np.arcsin(m * np.sin(np.radians(lat)))
    t2 = th * th
    t6 = t2 ** 3
    x = np.radians(lon) * np.cos(th) / (m * (a1 + 3 * a2 * t2 + t6 * (7 * a3 + 9 * a4 * t2)))
    y = th * (a1 + a2 * t2 + t6 * (a3 + a4 * t2))
    return x, y


def wkt_rings(wkt):
    """Outer rings of a POLYGON / MULTIPOLYGON WKT as (n, 2) lon/lat arrays; rings crossing the dateline are skipped."""
    import re
    for part in re.findall(r"\(\(([^()]+)\)", wkt):
        pts = np.array([[float(v) for v in p.split()] for p in part.split(",")])
        if pts[:, 0].max() - pts[:, 0].min() <= 180:
            yield pts


def world_hexmap(ax, hex_wkts, values=None, colors=None, cmap="ember", norm=None, border_wkts=(), outline=True):
    """Draw hexagons (WKT boundaries) on an Equal Earth world map. Give `values` (+ cmap/norm) or `colors`.
    Returns the PatchCollection (for a colour bar). Borders are hairlines in the baseline grey."""
    from matplotlib.collections import PatchCollection
    from matplotlib.patches import Polygon
    pats, vals, cols = [], [], []
    for i, w in enumerate(hex_wkts):
        for r in wkt_rings(w):
            x, y = equal_earth(r[:, 0], r[:, 1])
            pats.append(Polygon(np.c_[x, y]))
            if values is not None:
                vals.append(values[i])
            if colors is not None:
                cols.append(colors[i])
    pc = PatchCollection(pats, lw=0, cmap=cmap if values is not None else None, norm=norm)
    if values is not None:
        pc.set_array(np.asarray(vals))
    else:
        pc.set_facecolor(cols)
    ax.add_collection(pc)
    for w in border_wkts:
        for r in wkt_rings(w):
            x, y = equal_earth(r[:, 0], r[:, 1])
            ax.plot(x, y, color=BASELINE, lw=0.3)
    x, y = equal_earth(np.r_[np.full(50, -180), np.linspace(-180, 180, 50), np.full(50, 180), np.linspace(180, -180, 50)],
                       np.r_[np.linspace(-90, 90, 50), np.full(50, 90), np.linspace(90, -90, 50), np.full(50, -90)])
    if outline:
        ax.plot(x, y, color=BASELINE, lw=0.6)
    ax.set_xlim(x.min() * 1.02, x.max() * 1.02)
    ax.set_ylim(y.min() * 1.02, y.max() * 1.02)
    ax.set_aspect("equal")
    ax.axis("off")
    return pc
