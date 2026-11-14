"""Python reference values for the app's statistics tests (app/src/lib/stats.test.ts).

The JS stats must reproduce fireharmony.analytics and pymannkendall. This takes four real areas from the published
area_monthly.parquet (world, Malaysia, Riau, Central Kalimantan) and five synthetic Mann-Kendall vectors.
Run after `fireharmony publish`:  .venv/bin/python app/scripts/make_reference.py
"""
import json
import sys
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import pymannkendall as mk

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
from fireharmony import analytics as A           # noqa: E402
from fireharmony import publish as PB            # noqa: E402

P = PB.products("area_monthly.parquet")
OUT = REPO / "app" / "src" / "lib" / "__fixtures__" / "python_reference.json"


def area_cases(con) -> list[dict]:
    states = [r[0] for r in con.execute(f"""SELECT DISTINCT id FROM '{P}' WHERE kind = 'state'
                                            AND (name LIKE 'Riau,%' OR name LIKE 'Kalimantan Tengah,%') ORDER BY id""").fetchall()]
    cases = []
    for kind, id_ in [("world", "WORLD"), ("country", "MYS")] + [("state", s) for s in states]:
        df = con.execute(f"SELECT yr, mo, h, src FROM '{P}' WHERE kind = '{kind}' AND id = '{id_}' ORDER BY yr, mo").df()
        last = df.yr.max()
        grid = pd.period_range("2000-11", f"{int(last)}-{int(df[df.yr == last].mo.max()):02d}", freq="M")
        s = pd.DataFrame({"yr": grid.year, "mo": grid.month}).merge(df, on=["yr", "mo"], how="left")
        s["h"] = s["h"].fillna(0.0)                      # months with no row had no fire
        s.loc[s.src == 3, "h"] = np.nan                  # no data yet
        s = s.rename(columns={"h": "value"})
        clim, an, tr, cr = A.climatology(s), A.anomalies(s), A.trend(s), A.critical(s)
        cases.append({
            "name": f"{kind}:{id_}",
            "series": [{"yr": int(r.yr), "mo": int(r.mo), "value": None if pd.isna(r.value) else round(float(r.value), 4)}
                       for r in s.itertuples()],
            "expected": {
                "climatology": [{"mo": int(m), "median": round(float(r["median"]), 4), "q25": round(float(r.q25), 4),
                                 "q75": round(float(r.q75), 4)} for m, r in clim.iterrows()],
                "anomalies_last_24": [{"yr": int(r.yr), "mo": int(r.mo),
                                       "ratio": None if pd.isna(r.ratio_to_normal) else round(float(r.ratio_to_normal), 6),
                                       "percentile": None if pd.isna(r.percentile) else float(r.percentile),
                                       "rank": None if pd.isna(r.rank_in_month) else int(r.rank_in_month)}
                                      for r in an.tail(24).itertuples()],
                "critical_months": cr["critical_period"], "critical_threshold": round(float(cr["threshold"]), 4),
                "fire_year_start": A.fire_year_start(s),
                "trend": {k: (round(v, 8) if isinstance(v, float) else v) for k, v in tr.items()}}})
    return cases


def mann_kendall_cases() -> list[dict]:
    """Synthetic vectors (Hamed and Rao modification, as in the Python analytics), fixed seed."""
    rng = np.random.default_rng(42)
    out = []
    for n, slope, ar in [(25, 0.0, 0.0), (25, 2.0, 0.0), (25, -3.0, 0.5), (12, 1.0, 0.3), (25, 0.5, 0.8)]:
        e, x = np.zeros(n), rng.normal(0, 10, n)
        for k in range(n):
            e[k] = x[k] + (ar * e[k - 1] if k else 0)
        y = 100 + slope * np.arange(n) + e
        r = mk.hamed_rao_modification_test(y)
        out.append({"y": [round(float(v), 6) for v in y], "trend": r.trend, "p": float(r.p), "z": float(r.z), "s": float(r.s),
                    "var_s": float(r.var_s), "slope": float(r.slope), "intercept": float(r.intercept)})
    return out


if __name__ == "__main__":
    con = duckdb.connect()
    cases = area_cases(con)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"generated_by": "fireharmony.analytics + pymannkendall (Python); the JS stats must reproduce these",
                               "base_years": list(A.BASE_YEARS), "areas": cases, "mann_kendall_hamed_rao": mann_kendall_cases()}))
    print("wrote", OUT.relative_to(REPO), [c["name"] for c in cases])
    for c in cases:
        print(c["name"], c["expected"]["critical_months"], {k: c["expected"]["trend"][k] for k in ("trend", "pct_per_decade")})
