"""Configuration and a DuckDB connection factory shared by every pipeline step."""
from __future__ import annotations

import os
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

import duckdb
import yaml

REPO = Path(__file__).resolve().parents[1]


@lru_cache
def cfg() -> dict:
    c = yaml.safe_load((REPO / "config.yaml").read_text())
    for k, v in c["paths"].items():
        c["paths"][k] = Path(v).expanduser()
    return c


def path(name: str) -> Path:
    p = cfg()["paths"][name]
    p.mkdir(parents=True, exist_ok=True)
    return p


def raw(*parts: str) -> Path:
    return cfg()["paths"]["raw"].joinpath(*parts)


def work(*parts: str) -> Path:
    """A path inside the work folder. Reading never creates folders; writers call `ensure_parent`."""
    return cfg()["paths"]["work"].joinpath(*parts)


def ensure_parent(p: Path) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


@contextmanager
def atomic(p: Path):
    """Write to a temporary name, then rename. A killed run never leaves a half-written file at `p`."""
    ensure_parent(p)
    tmp = p.with_name(p.name + ".tmp")
    tmp.unlink(missing_ok=True)
    yield tmp
    os.replace(tmp, p)


def connect(extensions=("spatial", "h3")) -> duckdb.DuckDBPyConnection:
    """DuckDB with the memory limit, temp spill folder and extensions we use."""
    c = cfg()["duckdb"]
    con = duckdb.connect()
    con.execute(f"SET memory_limit='{c['memory_limit']}'")
    con.execute(f"SET threads={int(c['threads'])}")
    con.execute(f"SET temp_directory='{path('duckdb_temp')}'")
    con.execute(f"SET max_temp_directory_size='{c.get('max_temp_size', '5GB')}'")
    con.execute("SET preserve_insertion_order=true")   # keep the raw files' spatial (Hilbert) order without sorting
    try:
        con.execute("SET enable_progress_bar=false")
    except duckdb.Error:          # inside Jupyter DuckDB refuses even to switch the bar off without ipywidgets
        pass
    for ext in extensions:
        if ext == "h3":
            con.execute("INSTALL h3 FROM community")
        else:
            con.execute(f"INSTALL {ext}")
        con.execute(f"LOAD {ext}")
    if "spatial" in extensions:
        # DuckDB 2.0 asks for the axis order explicitly. Our data is (longitude, latitude), as GeoParquet CRS84.
        con.execute("SET geometry_always_xy = true")
    return con


def is_fresh(out: Path, inputs) -> bool:
    """True if `out` exists and is newer than every existing input (make style), so a resumed run can skip it."""
    if not out.exists():
        return False
    t = out.stat().st_mtime
    return all(t > Path(i).stat().st_mtime for i in inputs if Path(i).exists())


def free_gb() -> float:
    """Free space on the drive that really holds our data (Windows C:, where WSL's virtual disk lives)."""
    import shutil
    return shutil.disk_usage(cfg().get("disk", {}).get("watch", "/")).free / 1e9


def require_free_space(min_gb: float | None = None) -> None:
    need = cfg().get("disk", {}).get("min_free_gb", 10) if min_gb is None else min_gb
    have = free_gb()
    if have < need:
        raise SystemExit(f"Only {have:.1f} GB free on {cfg()['disk']['watch']} (need {need} GB). Free some space first: "
                         "WSL's disk lives on C:, and a full C: can corrupt it.")


def release_space() -> None:
    """Give space freed inside WSL back to Windows (the WSL disk is sparse). Needs the sudoers rule for fstrim;
    does nothing if it is missing."""
    import subprocess
    subprocess.run(["sudo", "-n", "/usr/sbin/fstrim", "/"], capture_output=True)


def years() -> list[int]:
    a, b = cfg()["years"]
    return list(range(a, b + 1))
