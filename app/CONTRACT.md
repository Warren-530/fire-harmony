# Fire Harmony app: build contract

The app is a static site (React 19 + Vite 8 + TypeScript 7). All analysis runs in the browser with DuckDB-WASM on
pre-built Parquet files. There is no server. Shared types are in `src/lib/types.ts` and settings in `src/lib/config.ts`.
Do not change those two files without a very good reason; if you must, keep every existing export.

## Data files (served at `DATA_URL`, in development `/data/` → `~/nasa_work/data/products/v1.0`)

All counts are hotspots per month. `h` = harmonized (NOAA-20 VIIRS scale), `modis` = MODIS scale (per satellite),
`t,a,s,n,j` = raw detections of Terra, Aqua, Suomi NPP, NOAA-20, NOAA-21, `src` = source (0 VIIRS observed,
1 Terra + Aqua model, 2 Terra only model, 3 no data yet; for groups it is the minimum = best source). H3 indexes are
hex text. A hexagon month that is missing from a file had no fire (value 0), EXCEPT in months where the area's source
is 3 (unknown). The world series in `area_monthly` gives the source class of every month.

| File | Columns | Sorted by | Use |
|---|---|---|---|
| `meta.json` | see `Meta` in types.ts; `files.l5.index` maps a level 1 hexagon to its file path | | first thing loaded |
| `areas.json` | `NamedArea[]` without the world entry (add `{kind:'world', id:'WORLD', name:'World', ...}`) | kind, name | place search |
| `area_monthly.parquet` | kind, id, name, yr, mo, h, modis, t, a, s, n, j, src | kind, id, yr, mo | series of a named place |
| `cells.parquet` | h3 (level 5), lat, lon, iso3, country, state, state_code, continent, biome, lc_main, peat_frac, pop2020, area_km2 | h3 | facts, people exposed |
| `map_l3.parquet`, `map_l4.parquet` | h3, yr, mo, h, modis, t, a, s, n, j, src | yr, mo, h3 | the map of one month |
| `cell_l3.parquet`, `cell_l4.parquet` | same | h3, yr, mo | big drawn areas (whole parents) |
| `clim_l3.parquet`, `clim_l4.parquet` | h3, mo, median, q25, q75 (2001 to 2025, zero months included) | h3, mo | map colour "vs normal" |
| `l5/l1=<level 1 hex>/data_0.parquet` (469 files) | l1, h3 (level 5), yr, mo, h, modis, t, a, s, n, j, src | | drawn areas, full detail |

Months run from 200010 to `meta.last_month` (yyyymm). October to December 2000 is partial (the archive starts in
November 2000); the calendar starts at 2001. The last month is usually partial and has src 3.

## Modules and owners (each builder writes ONLY its own files)

**data** — `src/lib/db.ts`, `src/lib/data.ts`, `src/lib/geo.ts`
- `getDb()`: one AsyncDuckDB (bundled workers via Vite `?url` imports, `selectBundle`), cached. `query<T>(sql)`
  returns plain objects; convert BigInt to number. Register remote files with `registerFileURL(name, url,
  DuckDBDataProtocol.HTTP, false)` so Parquet is read with range requests; read them as `read_parquet('<name>')`.
- `loadMeta()`, `loadAreas()` (adds the world), `worldSources()` (Map yyyymm → src from the world series).
- `areaSeries(sel: AreaSelection): Promise<MonthlyPoint[]>`: one point per month from 200010 to meta.last_month,
  zero filled; a month whose src is 3 gets h = modis = null. Named: from `area_monthly`. Polygon / circle: cells from
  `geo.ts`; if at most `MAX_L5_CELLS` level 5 cells, sum the `l5` files of their level 1 parents (WHERE h3 IN the set,
  loaded as a temporary table, not a giant literal list); otherwise compact the cover (`compactCells`), expand any
  cell coarser than level 3 to level 3, and sum `cell_l3`, `cell_l4` and `l5` parts. src of a zero-filled month =
  the world source of that month.
- `mapMonth(level: 3 | 4, yr, mo): Promise<HexValue[]>` joined with `clim_l<level>` for the calendar month.
- `geo.ts`: `selectionRing(sel)` (circle → 64-point ring), `cellsForRing(ring, res)` (h3-js v4 `polygonToCells`
  with GeoJSON [lon, lat] order), `coverCells(sel)` → `{l3: string[]; l4: string[]; l5: string[]}`, and
  `peopleIn(sel)` is NOT needed.

**stats** — `src/lib/stats.ts`, `src/lib/stats.test.ts`
Pure functions, no DOM. Must reproduce `src/lib/__fixtures__/python_reference.json` (made by the Python pipeline):
- `valueOf(p, scale)`: harmonized → h, modis → modis, raw → h (charts show raw sensors separately).
- `climatology(points, scale, base = BASE_YEARS)` → `{mo, median, q25, q75}[12]` (pandas: median and linear quantiles
  over the base years; null months skipped).
- `anomalies(points, scale, base)` → `Anomaly[]` for every point: ratio = value / median (null if median 0),
  percentile = 100 × (number of base values ≤ value) / (number of base values), rank = 1 + number of years (any
  year, not only base years, with a value for that calendar month) with a strictly larger value; years = how many
  values were ranked. Null value → null fields.
- `criticalMonths(points, scale, base, q = 0.75, share = 0.5)`: threshold = q quantile (linear) of all base months;
  a calendar month is critical if value > threshold in at least `share` of the base years.
- `fireYearStart(points, scale, base)`: the month after the calendar month with the lowest median.
- `trend(points, scale, years = BASE_YEARS)`: yearly totals (full years only, skip a year with any null month),
  Mann-Kendall with the Hamed and Rao (1998) variance correction exactly as `pymannkendall.hamed_rao_modification_test`
  (alpha 0.05), Sen's slope; pct_per_decade = 100 × 10 × slope / median of the yearly totals. Fewer than 8 years →
  'not enough data'.
- `intervalFor(total, src, period: 'month' | 'year', meta)`: src 0 or 3 → null; src 1 → `terra_aqua_<period>`,
  src 2 → `terra_only_<period>`; find the band with mu_min ≤ total < mu_max (null mu_max = no limit); range
  `[max(0, total × (1 + q_lo)), total × (1 + q_hi)]`. For a year that mixes sources use the worst (largest) src.
- `annualTotals(points, scale)` and `fireBrief(name, points, scale, meta, lang: 'en' | 'ms')` (2 to 4 short plain
  sentences: the latest complete month against its normal and its rank, the year so far, the trend; no jargon).
- Tests: vitest, against every case in the fixtures (climatology, last 24 anomalies, critical months, fire year
  start, trend; Mann-Kendall vectors: s, var_s, z, p within 1e-6 relative, trend label, slope).

**map** — `src/components/MapView.tsx`, `src/components/Legend.tsx`
MapLibre GL (style `BASEMAP_STYLE`) with deck.gl through `MapboxOverlay` (interleaved false) and `H3HexagonLayer`.
Props: `{ level: 3 | 4; values: HexValue[]; mode: ColourMode; selection: AreaSelection | null; drawMode: 'none' |
'rectangle' | 'polygon'; onDrawComplete(ring: [number, number][]): void; onHexClick?(h3: string): void;
onZoomChange?(zoom: number): void; }`. Count colours: ember ramp (CSS variables `--ember-100` .. `--ember-900`, read
with getComputedStyle) on a log scale; anomaly colours: diverging `--anom-b4 .. --anom-0 .. --anom-r4` on log2(value /
median) clipped to ±2 (no colour where median is 0 and value is 0). Draw the selection outline. Rectangle: press, drag,
release. Polygon: click points, double click to finish, Escape cancels. Tooltip on hover: hexagon value, normal, ratio.
Legend: colour bar with units and a short label. Keyboard and screen reader friendly controls.

**charts** — `src/components/Calendar.tsx`, `src/components/SeriesChart.tsx`, `src/components/Kpis.tsx`,
`src/components/FireBrief.tsx`
- Calendar: years (rows, 2001 down to the last year) × months J..D (columns), SVG, colour = count (ember, log) or
  anomaly (diverging, ratio to the calendar month's normal), a 1.5 px gap between boxes, unknown months hatched and
  labelled "no data yet", the selected month outlined, `onSelectMonth(yr, mo)`, a hidden table for screen readers.
- SeriesChart (Observable Plot): yearly or monthly totals; the harmonized line in ink (`--harmonized`, 2.6 px) with
  the 90% band (from `intervalFor`) in modelled years; option to add MODIS scale (`--sensor-modis`) and raw sensors
  (sensor colours); direct labels; no dual axes; title states the finding.
- Kpis: cards for the latest complete month vs normal (ratio, percentile, rank of N), this year to date vs the normal
  to date, the trend per decade with p, the critical period months. Each card: a word and an icon, never colour alone.
- FireBrief: renders `fireBrief(...)`.

**ui** — `src/App.tsx`, `src/main.tsx`, `src/pages/Explorer.tsx`, `src/pages/Methods.tsx`, `src/pages/Data.tsx`,
`src/components/AreaPicker.tsx`, `src/components/Downloads.tsx`, `src/lib/i18n.ts`, `src/styles/app.css`, `index.html`
- Hash routing (`#/`, `#/methods`, `#/data`), header with nav and an EN | BM switch (`i18n.ts`: one dictionary per
  language; Bahasa Melayu text written carefully and marked draft in a comment).
- Explorer (the main page, wireframe below) owns the state: selection (default: the world), scale, colour mode,
  selected month (default: the latest complete month), map level (3 when zoom < 4, else 4).
- AreaPicker: search box over areas (type ahead, keyboard), "Draw rectangle", "Draw polygon", "Lat / lon + radius".
- Downloads: CSV of the area's monthly series (yr, mo, h, range lo/hi, src label, modis, t, a, s, n, j, plus a header
  comment with the area, units and the citation), PNG of the calendar and chart (SVG → canvas), links to the data files.
- Methods: plain text on how harmonization works and how we tested it, with the figures in `public/figures/`
  (`fig03_seam_test.png`, `fig07_model_ladder.png`, `fig09_model_vs_viirs.png`, `fig04_static_mask_test.png`).
- Data: data sources and licences (NASA FIRMS, LP DAAC, GES DISC, SEDAC, ESA Fire_cci, PEATMAP, GIHS, Natural Earth,
  NOAA), how to cite, the file list.
- Styles: import `src/styles/tokens.css`; Inter from `public/fonts`; mobile friendly; visible focus; contrast.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Fire Harmony   Explorer  Methods  Data                              EN | BM  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Area: [Search place ▾] [Draw ▭] [Draw ⬠] [Lat/Lon]   Scale: (•) Harmonized ( ) MODIS ( ) Raw │
├─────────────────────────────────┬────────────────────────────────────────────┤
│  MAP (hexagons of the selected  │ KPI cards                                  │
│  month; count or vs normal)     │ FIRE BRIEF                                 │
├─────────────────────────────────┴────────────────────────────────────────────┤
│ BURNING CALENDAR (years × months); click a box → the map shows that month     │
├──────────────────────────────────────────────────────────────────────────────┤
│ SERIES CHART (yearly totals with 90% range)        DOWNLOADS                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Rules for everyone
- Text in the interface: short, plain English (and Bahasa Melayu), no jargon, no hyphenated words except official
  names (NOAA-20, MERRA-2).
- Colours only from the CSS variables in `tokens.css`. Never colour alone for meaning.
- Strict TypeScript, no `any` unless unavoidable. Small, readable functions.
- Do not add dependencies unless truly needed (disk is short); never touch files outside `app/`.
- `npm run build` and `npx vitest run` must pass at the end.
