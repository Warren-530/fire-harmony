#!/usr/bin/env bash
# Phase 3: climate drivers -> driver models -> haze link -> outlook -> the app's extra files -> tests.
# The raw climate rasters are only needed by `climate` (and only the first time: the reduced tables are cached).
set -euo pipefail
cd "$(dirname "$0")"
ts() { date -u +%H:%M:%S; }
FH=.venv/bin/fireharmony
echo "== climate $(ts)"; $FH climate
echo "== drivers $(ts)"; $FH drivers
echo "== haze $(ts)"; $FH haze
echo "== outlook $(ts)"; $FH outlook
echo "== publish extras and dashboard $(ts)"; $FH publish --extras-only
echo "== tests $(ts)"; .venv/bin/pytest -q tests/test_climate.py 2>&1 | tail -4 || true
echo "PHASE3 DONE $(ts)"
