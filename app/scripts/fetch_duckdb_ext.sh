#!/usr/bin/env bash
# Copy DuckDB's Parquet and JSON extensions (the official signed builds) into public/duckdb-ext/, so the app loads them
# from its own site (lib/db.ts, loadExtensions). The version must be the DuckDB version inside @duckdb/duckdb-wasm:
# it is in the extension URL the engine asks for (see the network panel, or strings dist/duckdb-eh.wasm).
# Run from app/: bash scripts/fetch_duckdb_ext.sh
set -euo pipefail
DUCKDB_VERSION=v1.5.4
for platform in wasm_eh wasm_mvp; do
  mkdir -p "public/duckdb-ext/$DUCKDB_VERSION/$platform"
  for ext in parquet json; do
    curl -fsSL --retry 5 --retry-delay 5 -o "public/duckdb-ext/$DUCKDB_VERSION/$platform/$ext.duckdb_extension.wasm" \
      "https://extensions.duckdb.org/$DUCKDB_VERSION/$platform/$ext.duckdb_extension.wasm"
  done
done
du -sh public/duckdb-ext
