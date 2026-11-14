"""Checks on the files the web app reads (data/products/v<version>/).

A browser parses JSON strictly: NaN or Infinity make JSON.parse fail and the app cannot start, so every JSON file
must be strict. The parquet files must open and hold the columns the app queries.
"""
import json

import duckdb
import pytest

from fireharmony import publish as PB

JSON_FILES = sorted(p.name for p in PB.products().glob("*.json")) if PB.products().exists() else []
PARQUET_COLUMNS = {
    "area_monthly.parquet": {"kind", "id", "yr", "mo", "h", "modis", "t", "a", "s", "n", "j", "src"},
    "drivers.parquet": {"kind", "id", "yr", "mo", "ratio", "rain3_pct", "in_season", "f_rain", "f_drivers"},
    "drivers_models.parquet": {"kind", "id", "r2_cv", "beta_rain", "uses_heat", "enso_r"},
    "outlook.parquet": {"kind", "id", "lead", "issue_yr", "issue_mo", "target_yr", "target_mo", "p", "p_clim", "bss"},
    "haze.parquet": {"city", "yr", "mo", "pm25_cnn", "pm25_model", "smoke_model", "fire_sumatra_k", "fire_borneo_k"},
}


def _reject(constant):
    raise ValueError(f"not strict JSON: {constant}")


@pytest.mark.parametrize("name", JSON_FILES)
def test_json_is_strict(name):
    json.loads(PB.products(name).read_text(), parse_constant=_reject)


@pytest.mark.parametrize("name", sorted(PARQUET_COLUMNS))
def test_parquet_has_the_columns_the_app_reads(name):
    p = PB.products(name)
    if not p.exists():
        pytest.skip(f"{name} not published yet")
    cols = {r[0] for r in duckdb.sql(f"DESCRIBE SELECT * FROM '{p}'").fetchall()}
    missing = PARQUET_COLUMNS[name] - cols
    assert not missing, missing


def test_dashboard_has_every_section():
    p = PB.products("dashboard.json")
    if not p.exists():
        pytest.skip("no dashboard.json yet")
    d = json.loads(p.read_text())
    for key in ("record", "world", "continents", "countries", "hot_now", "seam", "models", "physics", "mask", "drivers", "outlook", "haze"):
        assert d.get(key) is not None, key
    assert len(d["world"]["yearly"]) >= 25 and len(d["countries"]) == 25


def test_every_place_has_a_name():
    # the place search reads every name, so a null name could break it (4 unnamed placeholder states once slipped in)
    p = PB.products("areas.json")
    if not p.exists():
        pytest.skip("areas.json not published yet")
    areas = json.loads(p.read_text())
    assert all(isinstance(a.get("name"), str) and a["name"].strip() for a in areas)
    keys = [(a["kind"], a["id"]) for a in areas]
    assert len(keys) == len(set(keys))
