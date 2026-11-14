#!/usr/bin/env bash
# Phase 1: clean all years -> static mask -> gold summaries -> data-quality tests.
# Every step skips or overwrites safely, so a killed run can simply be started again.
set -euo pipefail
cd "$(dirname "$0")"
ts() { date -u +%H:%M:%S; }
echo "== clean $(ts)";     .venv/bin/fireharmony clean
echo "== mask $(ts)";      .venv/bin/fireharmony mask
echo "== mask (train until 2022, for testing) $(ts)"; .venv/bin/fireharmony mask --train-until 2022
echo "== aggregate $(ts)"; .venv/bin/fireharmony aggregate
echo "== tests $(ts)";     .venv/bin/pytest -q 2>&1 | tail -15
echo "PHASE1 DONE $(ts)"
