#!/usr/bin/env bash
# Phase 1 tail + Phase 2: gold -> cell facts -> panel -> tests -> cross validation -> harmonized record.
# Resumable: years that are already up to date are skipped, so after a crash just run it again.
set -euo pipefail
cd "$(dirname "$0")"
ts() { date -u +%H:%M:%S; }
FH=.venv/bin/fireharmony
echo "== aggregate $(ts)"; $FH aggregate --resume
echo "== features $(ts)"
if [ ! -f ~/nasa_work/data/work/features/cell_static_l5.parquet ] || \
   [ -n "$(find ~/nasa_work/data/work/gold -name data.parquet -newer ~/nasa_work/data/work/features/cell_static_l5.parquet)" ]; then
  $FH features
else echo "up to date"; fi
echo "== panel $(ts)"; $FH panel --resume
echo "== tests $(ts)"; .venv/bin/pytest -q 2>&1 | tail -6 || true
echo "== cv $(ts)"
if [ ! -f ~/nasa_work/data/work/models/cv_totals.parquet ] || \
   [ -n "$(find ~/nasa_work/data/work/panel_l5 -name data.parquet -newer ~/nasa_work/data/work/models/cv_totals.parquet)" ]; then
  $FH cv
else echo "up to date"; fi
echo "== harmonize $(ts)"; $FH harmonize
echo "== bridge $(ts)"; $FH bridge
echo "== validate $(ts)"; $FH validate
echo "PHASE2 DONE $(ts)"
