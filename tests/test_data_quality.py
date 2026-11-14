"""Data-quality checks on the pipeline outputs (run: .venv/bin/pytest -q).

They run on whatever years exist, so they work while the pipeline is still being built.
"""
import duckdb
import pytest

from fireharmony import aggregate as AG
from fireharmony import clean as CL
from fireharmony import config as C
from fireharmony import static_mask as SM

SILVER_YEARS = [y for y in C.years() if CL.silver_path(y).exists() and CL.silver_path(y).stat().st_size > 0]
GOLD_YEARS = [y for y in C.years() if AG.gold_path(y).exists()]
# gold years whose silver (and the neighbouring years' silver) is still on disk; the silver layer can be
# deleted to save space once gold is built, and these comparisons are then skipped
GOLD_WITH_SILVER = [y for y in GOLD_YEARS if all(CL.silver_path(x).exists() for x in (y - 1, y, y + 1) if x in C.years())]


def q(sql):
    return duckdb.sql(sql).fetchall()


def silver_files_around(year):
    """Silver files that can hold detections of solar year `year` (itself and its neighbours)."""
    return [str(CL.silver_path(y)) for y in (year - 1, year, year + 1) if y in SILVER_YEARS]


@pytest.mark.parametrize("year", SILVER_YEARS)
def test_silver_keeps_every_row(year):
    raw = C.raw("firms", f"year={year}", "detections.parquet")
    assert q(f"SELECT count(*) FROM '{raw}'")[0][0] == q(f"SELECT count(*) FROM '{CL.silver_path(year)}'")[0][0]


@pytest.mark.parametrize("year", SILVER_YEARS)
def test_silver_values_are_sane(year):
    p = CL.silver_path(year)
    bad = q(f"""SELECT
        count(*) FILTER (WHERE lat NOT BETWEEN -90 AND 90 OR lon NOT BETWEEN -180 AND 180),
        count(*) FILTER (WHERE conf_class IS NULL),
        count(*) FILTER (WHERE h3_5 IS NULL OR h3_8 IS NULL),
        count(*) FILTER (WHERE NOT frp BETWEEN 0 AND 20000) > 1e-5 * count(*),   -- a few corrupt FRP values are tolerated
        count(*) FILTER (WHERE sensor NOT IN ('MODIS','VIIRS_SNPP','VIIRS_NOAA20','VIIRS_NOAA21')),
        count(*) FILTER (WHERE quality NOT IN ('sp','nrt')),
        count(*) FILTER (WHERE quality = 'sp' AND type IS NULL),
        count(*) FILTER (WHERE abs(epoch(acq_solar) - epoch(acq_utc)) > 12.1 * 3600),
        count(*) FILTER (WHERE year(date_utc) <> {year})
      FROM '{p}'""")[0]
    names = ["bad coordinates", "missing confidence", "missing H3", "more than 1 in 100,000 FRP values corrupt", "unknown sensor",
             "unknown quality", "science-quality row without type", "solar time more than 12 h from UTC",
             "row outside its UTC year file"]
    problems = {n: v for n, v in zip(names, bad) if v}
    assert not problems, problems


@pytest.mark.parametrize("year", GOLD_WITH_SILVER)
def test_gold_matches_silver(year):
    """Main-rule fires in gold equal a direct count on silver: science quality, type 0, not low confidence, not open water."""
    water = SM.mask_path("all")
    s = q(f"""SELECT count(*) FROM read_parquet({silver_files_around(year)}) d
              LEFT JOIN (SELECT cell FROM '{water}' WHERE open_water) w ON d.h3_8 = w.cell
              WHERE year(date_solar) = {year} AND quality = 'sp' AND type = 0 AND conf_class <> 'low' AND w.cell IS NULL""")[0][0]
    g = q(f"SELECT coalesce(sum(n_main), 0) FROM '{AG.gold_path(year)}' WHERE quality = 'sp'")[0][0]
    assert s == g


@pytest.mark.parametrize("year", GOLD_WITH_SILVER)
def test_gold_keeps_every_detection(year):
    """Vegetation (any confidence) plus non-vegetation in gold equals every silver row of that solar year."""
    s = q(f"SELECT count(*) FROM read_parquet({silver_files_around(year)}) WHERE year(date_solar) = {year}")[0][0]
    g = q(f"SELECT coalesce(sum(n_allconf + n_nonveg), 0) FROM '{AG.gold_path(year)}'")[0][0]
    assert s == g


def test_gold_keys_are_unique_across_files():
    """No key twice, and every row in its own year's file. Checked one year file at a time: a key holds its year, so
    when every row sits in its year's file no key can repeat across files (one query over all years ran out of
    memory on this machine)."""
    if not GOLD_YEARS:
        pytest.skip("no gold yet")
    bad = {}
    for y in GOLD_YEARS:
        f = str(AG.gold_path(y))
        dup, wrong_year = q(f"""
          SELECT (SELECT count(*) FROM (SELECT 1 FROM read_parquet('{f}') GROUP BY cell, yr, mo, sensor, satellite, quality HAVING count(*) > 1)),
                 (SELECT count(*) FROM read_parquet('{f}') WHERE yr <> {int(y)})""")[0]
        if dup or wrong_year:
            bad[y] = {"duplicate keys": dup, "rows in the wrong year file": wrong_year}
    assert not bad, bad


def test_gold_counts_are_consistent():
    if not GOLD_YEARS:
        pytest.skip("no gold yet")
    files = [str(AG.gold_path(y)) for y in GOLD_YEARS]
    bad = q(f"""SELECT
        count(*) FILTER (WHERE n_main > n_allconf),
        count(*) FILTER (WHERE n_day + n_night > n_main),
        count(*) FILTER (WHERE n_small + n_large > n_main),
        count(*) FILTER (WHERE fire_days > 31 OR (n_main > 0 AND fire_days = 0)),
        count(*) FILTER (WHERE cell7_days > n_main),
        count(*) FILTER (WHERE frp_sum < 0 OR pixel_km2_mean <= 0)
      FROM read_parquet({files})""")[0]
    names = ["main above all-confidence", "day + night above main", "small + large above main",
             "impossible fire days", "more cell-days than detections", "negative FRP or pixel size"]
    problems = {n: v for n, v in zip(names, bad) if v}
    assert not problems, problems


@pytest.mark.parametrize("tag", [t for t in ("all", "until2022") if SM.mask_path(t).exists()])
def test_mask_is_sane(tag):
    p = SM.mask_path(tag)
    n, n_distinct, n_gihs, n_firms = q(f"""SELECT count(*), count(DISTINCT cell),
        count(*) FILTER (WHERE source IN ('gihs', 'both')), count(*) FILTER (WHERE source IN ('firms_type', 'both'))
        FROM '{p}'""")[0]
    assert n == n_distinct, "mask cells are not unique"
    assert n_gihs > 22_000, "GIHS sites missing from the mask"   # at least one cell per GIHS site
    assert n_firms > 10_000, "FIRMS static cells missing from the mask"


# ------------------------------------------------------------------------------------------ cell facts
from fireharmony import features as FE   # noqa: E402
from fireharmony import panel as PA      # noqa: E402

STATIC = FE.out_path(f"cell_static_l{FE.LVL}")


@pytest.mark.skipif(not FE.out_path("peat").exists(), reason="no peat layer yet")
def test_peat_total_matches_peatmap():
    """PEATMAP reports 4.23 million km2 of peat worldwide (Xu et al. 2018)."""
    total = q(f"SELECT sum(peat_km2) FROM '{FE.out_path('peat')}'")[0][0]
    assert 3.8e6 < total < 4.7e6, f"{total:,.0f} km2"


@pytest.mark.skipif(not STATIC.exists(), reason="no cell facts yet")
def test_cell_facts_are_sane():
    lc = " + ".join(f"lc_{g}" for g in FE.LC_GROUPS)
    # A few real fire cells legitimately lack a country (flares on tiny oil islands that Natural Earth does not
    # map) or land cover (coastal cells whose pixel centres are all water). Allow them, but only as a tiny share.
    n, n_distinct, bad_lc, bad_peat, no_country, no_lc = q(f"""SELECT count(*), count(DISTINCT cell),
        count(*) FILTER (WHERE lc_forest IS NOT NULL AND abs({lc} - 1) > 0.02),
        count(*) FILTER (WHERE peat_frac NOT BETWEEN 0 AND 1),
        sum(n_veg_all_time) FILTER (WHERE iso3 IS NULL) / sum(n_veg_all_time) > 1e-5,
        sum(n_veg_all_time) FILTER (WHERE lc_forest IS NULL) / sum(n_veg_all_time) > 1e-5
      FROM '{STATIC}'""")[0]
    assert n == n_distinct, "cells are not unique"
    problems = {k: v for k, v in {"land cover shares do not add to 1": bad_lc, "peat fraction outside 0..1": bad_peat,
                                  "over 0.001% of fires in cells without a country": no_country, "over 0.001% of fires in cells without land cover": no_lc}.items() if v}
    assert not problems, problems


# ------------------------------------------------------------------------------------------ panel
PANEL_YEARS = [y for y in C.years() if PA.panel_path(y).exists()]


@pytest.mark.parametrize("year", PANEL_YEARS)
def test_panel_keeps_every_gold_detection(year):
    sats = {"T": "Terra", "A": "Aqua", "S": "Suomi-NPP", "N": "NOAA-20", "J": "NOAA-21"}
    g = dict(q(f"SELECT satellite, sum(n_main) FROM '{AG.gold_path(year)}' GROUP BY 1"))
    p = q(f"SELECT {', '.join(f'sum({k}_n)' for k in sats)} FROM '{PA.panel_path(year)}'")[0]
    for (k, sat), v in zip(sats.items(), p):
        assert int(v or 0) == int(g.get(sat, 0)), f"{sat}: panel {v} vs gold {g.get(sat, 0)}"


@pytest.mark.parametrize("year", PANEL_YEARS)
def test_panel_grid_is_complete(year):
    n_cells = q(f"SELECT count(*) FROM '{C.work('panel_l5', 'universe.parquet')}'")[0][0]
    rows, keys, months, bad_cov = q(f"""SELECT count(*), count(DISTINCT (cell, mo)), count(DISTINCT mo),
        count(*) FILTER (WHERE greatest(cov_T, cov_A, cov_S, cov_N, cov_J) > 1 OR least(cov_T, cov_A, cov_S, cov_N, cov_J) < 0)
        FROM '{PA.panel_path(year)}'""")[0]
    assert rows == keys == n_cells * months and bad_cov == 0


@pytest.mark.skipif(not FE.out_path("population").exists(), reason="no population layer yet")
def test_world_population_matches_gpw():
    """GPWv4 rev11 totals: about 6.1 billion people in 2000 and 7.8 billion in 2020."""
    p2000, p2020 = q(f"SELECT sum(pop2000), sum(pop2020) FROM '{FE.out_path('population')}'")[0]
    assert 5.8e9 < p2000 < 6.4e9 and 7.4e9 < p2020 < 8.2e9, (p2000, p2020)


@pytest.mark.parametrize("year", PANEL_YEARS)
def test_panel_coverage_matches_fleet(year):
    """A satellite has coverage > 0 in a month only if the fleet table shows it delivered data then
    (guards against DuckDB's LEAST skipping NULLs, which once made absent satellites look present)."""
    fleet = C.work("gold", "fleet_month.parquet")
    sats = {"T": "Terra", "A": "Aqua", "S": "Suomi-NPP", "N": "NOAA-20", "J": "NOAA-21"}
    for k, sat in sats.items():
        bad = q(f"""SELECT count(*) FROM (SELECT DISTINCT mo, cov_{k} AS cov FROM '{PA.panel_path(year)}') p
                    LEFT JOIN (SELECT DISTINCT mo FROM '{fleet}' WHERE yr = {year} AND satellite = '{sat}') f USING (mo)
                    WHERE (p.cov > 0) <> (f.mo IS NOT NULL)""")[0][0]
        assert bad == 0, f"{sat}: {bad} months where coverage disagrees with the fleet table"


# ------------------------------------------------------------------------------------------ harmonized record
from fireharmony import harmonize as H  # noqa: E402

HZ_YEARS = [y for y in C.years() if H.harmonized_path(y).exists()]
BRIDGE = C.REPO / "models" / "terra_only_bridge.json"


@pytest.mark.parametrize("year", HZ_YEARS)
def test_harmonized_value_follows_its_source(year):
    """h is observed VIIRS where VIIRS flew, else the Terra + Aqua model, else the Terra only model
    (bridged before July 2002, checked below). Nothing else may change h."""
    p = H.harmonized_path(year)
    bad = q(f"""SELECT
        count(*) FILTER (WHERE source = 0 AND h IS DISTINCT FROM v_obs),
        count(*) FILTER (WHERE source = 1 AND h IS DISTINCT FROM pred_ta),
        count(*) FILTER (WHERE source = 2 AND yr * 100 + mo >= {H.AQUA_START} AND h IS DISTINCT FROM pred_t),
        count(*) FILTER (WHERE source = 3 AND h IS NOT NULL),
        count(*) FILTER (WHERE h < 0 OR isnan(h))
      FROM '{p}'""")[0]
    names = ["VIIRS row not equal to v_obs", "Terra + Aqua row not equal to pred_ta", "Terra only row after July 2002 changed",
             "no data row with a value", "negative or NaN value"]
    problems = {n: v for n, v in zip(names, bad) if v}
    assert not problems, problems


@pytest.mark.skipif(not BRIDGE.exists() or not any(y * 100 + 1 < H.AQUA_START for y in HZ_YEARS), reason="no bridge yet")
@pytest.mark.parametrize("year", [y for y in HZ_YEARS if y * 100 + 1 < H.AQUA_START])
def test_terra_only_months_are_bridged(year):
    """Before July 2002 every Terra only value is the raw model value times the ratio of its level 1 region."""
    import json
    b = json.loads(BRIDGE.read_text())
    assert 0.9 < b["k_global"] < 1.1, b["k_global"]
    import pandas as pd
    k = pd.DataFrame({"region": [int(r, 16) for r in b["regions"]], "k": list(b["regions"].values())})
    con = duckdb.connect()
    con.execute("INSTALL h3 FROM community; LOAD h3")
    con.register("k", k)
    bad, n = con.execute(f"""
      SELECT count(*) FILTER (WHERE abs(h.h - h.pred_t * coalesce(k.k, {b['k_global']})) > 1e-5 * greatest(1, h.pred_t)), count(*)
      FROM '{H.harmonized_path(year)}' h LEFT JOIN k ON k.region = h3_cell_to_parent(h.cell, {H.BRIDGE_REGION_LEVEL})
      WHERE h.source = 2 AND h.yr * 100 + h.mo < {H.AQUA_START}""").fetchone()
    assert n > 0 and bad == 0, f"{bad} of {n} Terra only rows are not bridged"
