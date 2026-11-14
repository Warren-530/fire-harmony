"""Checks on the Phase 3 climate tables (run: .venv/bin/pytest -q tests/test_climate.py).

They run on whatever tables exist, so they also work while the climate step is still being built.
"""
import duckdb
import pytest

from fireharmony import climate as K


def q(sql):
    return duckdb.sql(sql).fetchall()


def have(name):
    return pytest.mark.skipif(not K.out(name).exists(), reason=f"no {name} yet")


@have("hex_l3.parquet")
def test_hexagons_hold_the_whole_fire_grid():
    n, n_unique = q(f"SELECT count(*), count(DISTINCT hex) FROM '{K.out('hex_l3.parquet')}'")[0]
    con = duckdb.connect()
    con.execute("LOAD h3")
    expected = con.execute(f"SELECT count(DISTINCT h3_cell_to_parent(cell, 3)) FROM '{K.UNIVERSE}'").fetchone()[0]
    assert n == n_unique == expected


@pytest.mark.parametrize("name", ["rain_l3.parquet", "merra2_l3.parquet", "fwi_l3.parquet"])
def test_one_row_per_hexagon_and_month(name):
    if not K.out(name).exists():
        pytest.skip(f"no {name} yet")
    rows, keys, hexes = q(f"SELECT count(*), count(DISTINCT (hex, yr, mo)), count(DISTINCT hex) FROM '{K.out(name)}'")[0]
    n_hex = q(f"SELECT count(*) FROM '{K.out('hex_l3.parquet')}'")[0][0]
    assert rows == keys, f"{rows - keys} duplicate keys"
    assert hexes == n_hex


@have("rain_l3.parquet")
def test_rain_is_sane():
    p = K.out("rain_l3.parquet")
    bad = q(f"""SELECT
        count(*) FILTER (WHERE rain_final_mm < 0 OR rain_late_mm < 0),
        count(*) FILTER (WHERE rain_final_mm > 5000 OR rain_late_mm > 5000),
        count(DISTINCT yr::INT * 100 + mo) FILTER (WHERE rain_final_mm IS NOT NULL) <> 309,
        count(*) FILTER (WHERE yr::INT * 100 + mo <= 202509 AND rain_final_mm IS NULL)
      FROM '{p}'""")[0]
    names = ["negative rain", "more than 5 m in a month", "IMERG Final does not cover Jan 2000 to Sep 2025", "Final month missing"]
    problems = {n: v for n, v in zip(names, bad) if v}
    assert not problems, problems


@have("merra2_l3.parquet")
def test_merra2_is_sane():
    bad = q(f"""SELECT
        count(DISTINCT yr::INT * 100 + mo) < 321,
        count(*) FILTER (WHERE t2m_c NOT BETWEEN -90 AND 60),
        count(*) FILTER (WHERE qv2m_gkg NOT BETWEEN 0 AND 40),
        count(*) FILTER (WHERE aod NOT BETWEEN 0 AND 10),
        count(*) FILTER (WHERE pm25 < 0),
        count(*) FILTER (WHERE abs(u10) > 30 OR abs(v10) > 30)
      FROM '{K.out("merra2_l3.parquet")}'""")[0]
    names = ["fewer than 321 months", "temperature out of range", "humidity out of range", "AOD out of range",
             "negative PM2.5", "wind out of range"]
    problems = {n: v for n, v in zip(names, bad) if v}
    assert not problems, problems


@have("fwi_l3.parquet")
def test_fire_weather_uses_both_sampled_days():
    assert q(f"SELECT min(fwi_days), max(fwi_days) FROM '{K.out('fwi_l3.parquet')}'")[0] == (2, 2)
    assert q(f"SELECT count(*) FROM '{K.out('fwi_l3.parquet')}' WHERE fwi < 0 OR ffmc > 102")[0][0] == 0


@have("pm25_cnn_day.parquet")
def test_pm25_covers_every_fire_season_day():
    days, first, last, bad_months, neg = q(f"""SELECT count(DISTINCT date), min(date), max(date),
        count(*) FILTER (WHERE month(date) NOT BETWEEN 7 AND 11), count(*) FILTER (WHERE pm25 < 0)
        FROM '{K.out('pm25_cnn_day.parquet')}'""")[0]
    assert days == 153 * 24 and bad_months == 0 and neg == 0, (days, first, last)


@have("indices.parquet")
def test_indices_reach_the_recent_season():
    last_oni = q(f"SELECT max(yr::INT * 100 + mo) FROM '{K.out('indices.parquet')}' WHERE oni IS NOT NULL")[0][0]
    assert last_oni >= 202609
    assert q(f"SELECT count(*) FROM '{K.out('indices.parquet')}' WHERE abs(oni) > 4 OR abs(dmi) > 3")[0][0] == 0


@have("area_weights.parquet")
def test_area_weights_add_up_at_every_level():
    tot = dict(q(f"SELECT kind, sum(w) FROM '{K.out('area_weights.parquet')}' GROUP BY kind"))
    for kind in ("continent", "country", "state"):
        assert abs(tot[kind] / tot["world"] - 1) < 1e-4, (kind, tot[kind], tot["world"])


@have("rain_bridge.parquet")
def test_rain_bridge_is_moderate():
    lo, hi, n_full = q(f"""SELECT quantile_cont(k, 0.025), quantile_cont(k, 0.975), count(*) FILTER (WHERE months = 12)
                           FROM '{K.out('rain_bridge.parquet')}'""")[0]
    assert 0.4 < lo and hi < 2.5, (lo, hi)
    assert n_full > 0.95 * q(f"SELECT count(*) FROM '{K.out('hex_l3.parquet')}'")[0][0]
