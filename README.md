# Fire Harmony

**One consistent worldwide fire record from MODIS and VIIRS hotspots, 2000 to today, with a burning activity calendar for any place on Earth.**

NASA Space Apps Challenge 2026, challenge *Harmonization of MODIS and VIIRS Hot Spots* (written by CONAE).

Team **Kopi and Cosmos**: Saw Yong Quan and Yap Yong Son.

| | Link |
|---|---|
| Web app | https://warren-530.github.io/fire-harmony/ |
| Everything (videos, report, poster) | https://warren-530.github.io/fire-harmony/hub.html |
| Data | https://huggingface.co/datasets/warrensaw530/fire-harmony |

---

## The problem in one paragraph

Satellites have recorded fire hotspots since 2000. MODIS has a coarse camera and flew alone until 2012. VIIRS has a sharper camera and sees much more fire: with the same afternoon overpass, about 6 times more (5 times by day, 30 times at night), because almost half of what it sees is weak fire that MODIS cannot detect. Joining the two records naively makes a fake jump of 8.4 times in 2012, which swamps every real trend. Fire Harmony learns the "exchange rate" between the sensors, which changes with place, land, season and fire size, and builds one record on the NOAA-20 VIIRS scale with a 90% range for every modelled value.

## How it works

```
raw FIRMS (640 million rows) -> silver (clean, local solar time, H3 cells) -> static source mask
  -> gold (hexagon x month x satellite) -> cell facts (land cover, peat, people, country)
  -> panel (every fire-prone hexagon x every month) -> harmonization model -> harmonized record
  -> validation (seam tests) -> app data products
```

| Step | Module | What it does |
|---|---|---|
| Clean | `fireharmony/clean.py` | One schema for all sensors, local solar time, unified confidence, H3 cells at levels 3 to 8. Nothing is dropped. |
| Static mask | `fireharmony/static_mask.py` | Factories, gas flares, volcanoes and open water, for rows without NASA's `type` label (near real time data). Tested on years it never saw: catches 96% of VIIRS static detections, removes 1.4% of real fires. |
| Gold | `fireharmony/aggregate.py` | Counts per hexagon (level 5, about 253 km2), solar month and satellite: fires, day and night, weak and strong fires, fire power, fire days. |
| Cell facts | `fireharmony/features.py` | MCD12C1 land cover, PEATMAP peat (4.23 million km2), GPWv4 population, Natural Earth country and state, biome. |
| Panel | `fireharmony/panel.py` | The full grid of fire-prone hexagons and months, including months where MODIS saw nothing (about 9% of VIIRS fire). |
| Harmonize | `fireharmony/harmonize.py` | VIIRS satellites scaled to NOAA-20 and averaged (more satellites never means more fire). MODIS months predicted by LightGBM (Terra + Aqua, and Terra only before July 2002), trained on 2012 to 2019 and scored on held-out years and regions. The Terra only months are bridged to the Terra + Aqua model with regional ratios learned in July 2002 to June 2005. Calibrated 90% ranges for any area. |
| Validate | `fireharmony/validate.py` | Seam tests at 2002 and 2012 against the satellites that flew on both sides and against ESA Fire_cci burned area, placebo seams at dates with no satellite change, Pettitt and PELT change point tests. |
| Physics | `fireharmony/physics.py` | On 10 calibration tiles in 2019: the chance that MODIS sees a fire VIIRS saw, by fire strength, day and night, and cloud. |
| Climate | `fireharmony/climate.py` | GPM IMERG rain (Late bridged to Final), MERRA-2 weather, aerosols and sea surface temperature, GFWED fire weather, bias corrected PM2.5, ONI and DMI, reduced to level 3 hexagons and months. |
| Drivers | `fireharmony/drivers.py` | For every country and state: how strongly fire follows a rain deficit and heat (scored on years left out), and how El Nino moves the rain. Explains any month. |
| Outlook | `fireharmony/outlook.py` | The chance of above normal fire 1 to 3 months ahead, with its skill on blocks of years the model never saw (Brier skill score). |
| Haze | `fireharmony/haze.py` | Smoke at eight cities in Malaysia and its neighbours from fires in Sumatra and Borneo. |

Every step is tested (`tests/test_data_quality.py`: row conservation, solar year edges, unique keys, value ranges, the source of every harmonized value, published totals) and explained in a narrated notebook (`notebooks/`).

## Run it

Needs Python 3.12 and about 60 GB of disk for raw and intermediate data. Paths are set in `config.yaml`.

```bash
uv venv && uv pip install -e ".[dev]"      # or: python -m venv .venv && .venv/bin/pip install -e ".[dev]"
./run_phase1.sh                             # clean -> static mask -> gold -> tests
./run_phase2.sh                             # cell facts -> panel -> cross validation -> harmonized record -> Terra only bridge -> seam tests
.venv/bin/fireharmony publish              # the web app's data files (add --meta-only to refresh only meta.json)
./run_phase3.sh                             # climate tables -> drivers -> haze -> outlook -> the app's extra files
./run_notebooks.sh                          # execute the narrated notebooks and write the report figures
```

Each step can also run on its own: `.venv/bin/fireharmony --help`. Long steps resume where they stopped.

## The web app

A pure frontend: React, Vite and TypeScript, with DuckDB in the browser reading the published Parquet files over HTTP
(only the bytes it needs), MapLibre and deck.gl for the hexagon maps, Observable Plot for the charts. Pages: Explorer
(any area, any month: map, burning calendar, numbers, drivers, outlook, downloads), Dashboard (every statistic of the
project), Haze, Methods and Data. Design rules: `app/DESIGN.md`; shared building blocks: `app/src/components/ui.tsx`.

```bash
cd app && npm install
npm run dev                                  # http://localhost:5173 (serves data/products/v1.0 under /data/)
npx tsc --noEmit -p tsconfig.app.json        # typecheck (tsc -p . checks nothing: the root tsconfig only has references)
npx vitest run                               # unit tests (the JS statistics must match the Python ones)
node scripts/shots.mjs                       # every page in headless Chrome: screenshots + console errors
```

Deploy: the data goes to a Hugging Face dataset (`scripts/deploy_data_hf.py <user>/<name>`, token in `~/nasa_work/.env`
as `HF_TOKEN`) and the app to GitHub Pages, built with `VITE_DATA_URL` pointing at the dataset.

## Report, poster and hub page

| Deliverable | Source | Build |
|---|---|---|
| Research report (PDF) | `report/report.qmd` (Quarto + Typst, our own partials, `references.bib`) | `cd report && ../.venv/bin/python make_qr.py && ~/nasa_work/tools/quarto-1.11.9/bin/quarto render report.qmd` |
| Poster (A1 PDF and PNG) | `poster/poster.typ` | `cd poster && ../.venv/bin/python make_qr.py && typst compile --root .. --font-path ../report/fonts poster.typ` |
| Hub page (the single "Final Project" link) | `app/public/hub.html` | served by the app at `hub.html` |
| Report figures | `notebooks/_build_notebooks.py` (style: `style/fireharmony_style.py`) | `./run_notebooks.sh` (fig03: `fireharmony validate`) |

The report follows the writing rules checked by `~/nasa_work/tools/report_lint.py` (no dashes or hyphens, short sentences).

## Hotspot files (the CSV download)

`fireharmony hotspots` writes every FIRMS hotspot (640,601,590 rows, 6.5 GB) as one Parquet file per H3 level 1 region
(`products/v1.0/hotspots/`), sorted by date, so the browser reads only the regions and months of a search. A hotspot's
`counted` flag is the record's own rule (vegetation fire, not open water, not low confidence), and the app selects months
by local solar date, as the record does (`tests/test_hotspots.py`).

## Data (all free and open)

| Data | Provider | Use |
|---|---|---|
| FIRMS active fires: MODIS C6.1 (Terra, Aqua), VIIRS 375 m (Suomi NPP, NOAA-20, NOAA-21) | NASA FIRMS | The fires |
| MCD12C1 land cover; MOD14A1, MYD14A1, VNP14A1, VJ114A1 daily fire maps; MCD64A1, VNP64A1 burned area | NASA LP DAAC | Cell facts, physics checks, validation |
| MERRA-2 aerosols and weather; GPM IMERG rainfall | NASA GES DISC | Drivers and haze |
| GFWED Fire Weather Index | NASA GISS | Drivers |
| GPWv4 population density | NASA SEDAC | People exposed |
| Global Fire Atlas | NASA CMS / ORNL DAAC | Validation |
| Fire_cci burned area | ESA (partner agency) | Validation |
| PEATMAP | University of Leeds, CC BY 4.0 | Peat |
| GIHS industrial heat sources | Zenodo, CC BY 4.0 | Static mask |
| Natural Earth borders | Public domain | Places by name |
| ONI and DMI climate indices | NOAA | Drivers |

Full provenance with checksums is in the data acquisition log and notebook `00`.

## Licence

Apache 2.0. See `LICENSE`.
