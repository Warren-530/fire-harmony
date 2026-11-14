#!/usr/bin/env bash
# Build the narrated notebooks from notebooks/_build_notebooks.py, then execute them top to bottom
# (papermill), so the saved outputs and the report figures are always fresh.
#   ./run_notebooks.sh            all notebooks
#   ./run_notebooks.sh 01 02      only notebooks whose names start with 01 or 02
set -euo pipefail
cd "$(dirname "$0")/notebooks"
../.venv/bin/python _build_notebooks.py "$@"          # with arguments, only those notebooks are rebuilt
pats=("$@"); [ ${#pats[@]} -eq 0 ] && pats=("")
for p in "${pats[@]}"; do
  for nb in ${p}*.ipynb; do
    [[ "$nb" == _* ]] && continue
    echo "== $nb $(date -u +%H:%M:%S)"
    ../.venv/bin/papermill --log-level WARNING -k python3 "$nb" "$nb"
  done
done
echo "NOTEBOOKS DONE $(date -u +%H:%M:%S)"
