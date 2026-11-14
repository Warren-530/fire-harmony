"""Builds the narrated notebooks from plain Python cell lists (keeps them easy to review in git).

Run:  .venv/bin/python notebooks/_build_notebooks.py   then execute with papermill (see run_notebooks.sh).
Writing rules for the markdown cells: short sentences, plain words, no dashes (see Report Writing Guide).
"""
import sys
from pathlib import Path

import nbformat as nbf

HERE = Path(__file__).resolve().parent
SETUP = """import sys, os
from pathlib import Path
REPO = Path.cwd().parent if Path.cwd().name == 'notebooks' else Path.cwd()
sys.path.insert(0, str(REPO)); sys.path.insert(0, str(REPO / 'style'))
import pandas as pd, numpy as np, duckdb, matplotlib.pyplot as plt
import fireharmony_style as fh
from fireharmony import config as C, features as FE
fh.use(); pd.set_option('display.width', 160); pd.set_option('display.max_columns', 30)
FIG = REPO / 'report' / 'figures'; FIG.mkdir(parents=True, exist_ok=True)
con = C.connect()"""


def box(title, lines):
    body = "\n".join(f"- {l}" for l in lines)
    return f"> **{title}**\n>\n" + "\n".join("> " + l for l in body.splitlines())


ONLY = sys.argv[1:]          # optional name prefixes: rebuild only these, so other notebooks keep their outputs


def nb(name, cells):
    if ONLY and not any(name.startswith(p) for p in ONLY):
        return
    n = nbf.v4.new_notebook()
    n.metadata["kernelspec"] = {"name": "python3", "display_name": "Python 3", "language": "python"}
    for kind, src in cells:
        n.cells.append(nbf.v4.new_markdown_cell(src) if kind == "md" else nbf.v4.new_code_cell(src))
    nbf.write(n, HERE / f"{name}.ipynb")
    print("wrote", name)


# ---------------------------------------------------------------------------------------------
nb("00_data_acquisition_and_verification", [
    ("md", "# 00 · Data acquisition and verification\n\n" + box("What and why", [
        "We list every dataset we downloaded, where it came from and how big it is.",
        "We prove the FIRMS copy we use matches NASA's official files row by row.",
        "We check that every file is real, complete data.",
        "Everything later in the project depends on this step, so we show it openly."])),
    ("code", SETUP),
    ("md", "## 1. The download log\n\nEvery file we downloaded is recorded in `manifest.csv`, with its source link, the time we downloaded it, its size and a SHA-256 checksum. A checksum is a fingerprint of the file. If even one byte changes, the fingerprint changes."),
    ("code", """m = pd.read_csv(C.raw('manifest.csv'))
summary = (m.groupby('dataset').agg(files=('file', 'count'), gigabytes=('bytes', lambda b: round(b.sum() / 1e9, 2)))
             .sort_values('gigabytes', ascending=False))
print(f"{len(m):,} files, {m.bytes.sum() / 1e9:.1f} GB in total")
summary"""),
    ("code", """NAMES = {'firms': 'FIRMS active fires, 27 yearly files', 'gpm_imerg_late_daily': 'GPM IMERG Late rain, daily',
         'gpm_imerg_monthly': 'GPM IMERG Final rain, monthly', 'landcover_mcd12c1': 'MCD12C1 land cover',
         'gfwed_fwi_sampled': 'GFWED fire weather', 'indonesia_viirs_ahi_emissions': 'Indonesia fire emissions',
         'merra2_aer_monthly': 'MERRA-2 aerosols', 'merra2_cnn_pm25_seasia': 'MERRA-2 CNN PM2.5, SE Asia',
         'merra2_slv_monthly': 'MERRA-2 weather', 'firemap_vnp14a1': 'VNP14A1 daily fire maps', 'firemap_vj114a1': 'VJ114A1 daily fire maps',
         'firemap_myd14a1': 'MYD14A1 daily fire maps', 'firemap_mod14a1': 'MOD14A1 daily fire maps', 'burned_vnp64a1': 'VNP64A1 burned area',
         'burned_mcd64a1': 'MCD64A1 burned area', 'peatmap': 'PEATMAP peatlands', 'esa_firecci_grid': 'ESA Fire_cci burned area',
         'global_fire_atlas': 'Global Fire Atlas', 'population_gpwv4': 'GPWv4 population', 'natural_earth': 'Natural Earth borders',
         'gihs': 'GIHS industrial heat sources', 'climate_indices': 'ONI and DMI indices', 'firms_validation': 'FIRMS country files (check)'}
grouped = (m.assign(group=m.dataset.str.replace(r'/year=\\d{4}', '', regex=True))
             .groupby('group').agg(gigabytes=('bytes', lambda b: b.sum() / 1e9)))
grouped.index = [NAMES.get(g, g) for g in grouped.index]
fig, ax = plt.subplots(figsize=fh.SIZE['full_tall'])
s = grouped.sort_values('gigabytes')
ax.barh(s.index, s.gigabytes, color=fh.SENSOR['MODIS'], height=0.62)
for y, v in enumerate(s.gigabytes):
    ax.text(v, y, f'  {v:.2f} GB' if v >= 0.01 else '  under 0.01 GB', va='center', fontsize=7, color=fh.INK_2)
fh.clean(ax, grid_axis='x'); ax.set_xlabel('Gigabytes'); ax.set_xlim(0, s.gigabytes.max() * 1.15)
fh.title(ax, 'Most of our data is fire detections and rainfall', 'Size of each downloaded dataset')
fh.source(fig, 'Source: our download manifest (manifest.csv)')
fh.save(fig, FIG / 'fig00_data_volume')"""),
    ("md", "## 2. Does our FIRMS copy match NASA's official files?\n\nWe use a free copy of the full FIRMS archive (640 million rows) because it is fast to query. To trust it, we took official country files straight from NASA FIRMS and looked up **every row** in our copy, matching on location, date and time."),
    ("code", """V = C.raw('firms_validation')
checks = [('Malaysia 2023', 'MODIS', 'modis_2023_Malaysia.csv', 2023, (99, 120, 0, 8)),
          ('Malaysia 2023', 'VIIRS_SNPP', 'viirs-snpp_2023_Malaysia.csv', 2023, (99, 120, 0, 8)),
          ('Malaysia 2023', 'VIIRS_NOAA20', 'viirs-jpss1_2023_Malaysia.csv', 2023, (99, 120, 0, 8)),
          ('Argentina 2005', 'MODIS', 'modis_2005_Argentina.csv', 2005, (-75, -52, -56, -21)),
          ('Argentina 2015', 'VIIRS_SNPP', 'viirs-snpp_2015_Argentina.csv', 2015, (-75, -52, -56, -21))]
rows = []
for place, sensor, f, y, (x0, x1, y0, y1) in checks:
    n_off, n_found = con.execute(f'''
      WITH o AS (SELECT round(latitude,4) lat, round(longitude,4) lon, acq_date::DATE d, lpad(acq_time::VARCHAR,4,'0') t FROM read_csv_auto('{V / f}')),
           mm AS (SELECT round(ST_Y(geometry),4) lat, round(ST_X(geometry),4) lon, acq_date d, strftime(acq_datetime,'%H%M') t
                  FROM '{C.raw('firms', f'year={y}', 'detections.parquet')}' WHERE sensor='{sensor}' AND ST_X(geometry) BETWEEN {x0} AND {x1} AND ST_Y(geometry) BETWEEN {y0} AND {y1})
      SELECT count(*), count(mm.lat) FROM o LEFT JOIN mm USING (lat, lon, d, t)''').fetchall()[0]
    rows.append({'official file': f'{place}, {sensor}', 'official rows': n_off, 'found in our copy': n_found, 'match': f'{100 * n_found / n_off:.2f}%'})
pd.DataFrame(rows)"""),
    ("md", "## 3. Is every file real, complete data?\n\nA download can fail quietly and leave an error page or a half file. We read the first bytes of every file and check its format signature. We also open every fire weather file fully."),
    ("code", """import subprocess
print(subprocess.run([sys.executable, str(Path.home() / 'nasa_work/scripts/verify_raw.py')], capture_output=True, text=True).stdout[-1500:])"""),
    ("md", box("Key findings", [
        "We hold about 44 GB of free NASA, ESA and NOAA data, all logged with checksums.",
        "Our FIRMS copy matches NASA's official files exactly: 100% of rows found, on two continents and across three sensor eras.",
        "Every file passed the integrity check, so the rest of the project starts from clean, trusted data."])),
])


# ---------------------------------------------------------------------------------------------
GOLD = """from fireharmony import aggregate as AG
GOLD = [str(AG.gold_path(y)) for y in C.years() if AG.gold_path(y).exists()]
STATIC = C.work('features', 'cell_static_l5.parquet')"""

nb("01_eda_global_fires", [
    ("md", "# 01 · A first look at the world's fires\n\n" + box("What and why", [
        "We count the fires each satellite saw, every year, all over the world.",
        "We compare two cameras that pass over at the same time of day, to see how different they really are.",
        "We check whether the gap between them is one number or many.",
        "These facts decide how the harmonization has to work."])),
    ("code", SETUP + "\n" + GOLD),
    ("md", "## 1. Fires per year, satellite by satellite\n\nA hotspot is one pixel that a satellite marked as unusually hot. We count vegetation fires only, with the main confidence rule. We show each satellite on its own. MODIS flies on two satellites (Terra and Aqua), so we use their average, which makes one MODIS satellite comparable with one VIIRS satellite."),
    ("code", """yearly = con.execute(f'''
  SELECT yr, satellite, sum(n_main) AS n FROM read_parquet({GOLD}) WHERE yr BETWEEN 2001 AND 2025 GROUP BY ALL''').df()
w = yearly.pivot(index='yr', columns='satellite', values='n')
w['MODIS'] = w[['Terra', 'Aqua']].mean(axis=1, skipna=False)          # one MODIS satellite: only years with both
lines = {'MODIS': 'MODIS', 'Suomi-NPP': 'VIIRS_SNPP', 'NOAA-20': 'VIIRS_NOAA20', 'NOAA-21': 'VIIRS_NOAA21'}
first_full = {'MODIS': 2003, 'Suomi-NPP': 2013, 'NOAA-20': 2019, 'NOAA-21': 2025}   # first full year of each satellite
for col, y0 in first_full.items():
    w.loc[w.index < y0, col] = np.nan                                    # partial years would fake a dip
from fireharmony import eda_figures as EF   # the report figures are drawn from the published files, as in the report
EF.fires_per_satellite(fh, FIG / 'fig01_fires_per_satellite')
(w[list(lines)] / 1e6).round(2).tail(14)"""),
    ("md", "## 2. Same time of day, two cameras\n\nAqua (MODIS) and Suomi NPP (VIIRS) both cross the equator at about 1:30 in the afternoon. So when we compare them, time of day and weather are the same. Only the camera differs."),
    ("code", """cmp = con.execute(f'''
  SELECT satellite, sum(n_main) AS n, sum(n_day) AS n_d, sum(n_night) AS n_n, sum(n_small) AS n_s
  FROM read_parquet({GOLD}) WHERE yr BETWEEN 2013 AND 2019 AND satellite IN ('Aqua', 'Suomi-NPP') GROUP BY 1''').df().set_index('satellite')
ratio = (cmp.loc['Suomi-NPP'] / cmp.loc['Aqua'])[['n', 'n_d', 'n_n']].round(1)
small = (100 * cmp['n_s'] / cmp['n']).round(1)
print(f"VIIRS / MODIS, same afternoon pass: all {ratio['n']}x, day {ratio['n_d']}x, night {ratio['n_n']}x")
print(f"weak fires (below 5 MW): Suomi NPP {small['Suomi-NPP']}%, Aqua {small['Aqua']}%")"""),
    ("md", "## 3. The gap depends on the land\n\nWe group the hexagon cells by their main land cover and compute the same ratio for each group."),
    ("code", """lc = con.execute(f'''
  SELECT s.lc_main, sum(g.n_main) FILTER (WHERE g.satellite = 'Suomi-NPP') / sum(g.n_main) FILTER (WHERE g.satellite = 'Aqua') AS ratio,
         sum(g.n_main) FILTER (WHERE g.satellite = 'Suomi-NPP') AS viirs
  FROM read_parquet({GOLD}) g JOIN '{STATIC}' s USING (cell)
  WHERE g.yr BETWEEN 2013 AND 2019 GROUP BY 1 HAVING viirs > 1e6 ORDER BY ratio''').df()
from fireharmony import eda_figures as EF   # the report figures are drawn from the published files, as in the report
EF.ratio_by_land_cover(fh, FIG / 'fig02_ratio_by_land_cover', con)
lc.round(2)"""),
    ("md", "## 4. Fires that MODIS misses completely\n\nSome months, a hexagon has VIIRS fires but no MODIS fire at all. A simple exchange rate turns those into zero. How much fire is that?"),
    ("code", """miss = con.execute(f'''
  WITH p AS (SELECT cell, yr, mo, coalesce(sum(n_main) FILTER (WHERE family = 'MODIS'), 0) m,
                    coalesce(sum(n_main) FILTER (WHERE satellite = 'Suomi-NPP'), 0) v
             FROM read_parquet({GOLD}) WHERE yr BETWEEN 2013 AND 2019 GROUP BY ALL)
  SELECT 100 * sum(v) FILTER (WHERE m = 0) / sum(v) AS pct FROM p''').fetchall()[0][0]
print(f'{miss:.1f}% of VIIRS hotspots fall in cell months where MODIS saw nothing')"""),
    ("md", box("Key findings", [
        "Per satellite, VIIRS records about eight times more hotspots than MODIS. Joining them without care creates a fake jump in 2012.",
        "With the same afternoon pass, VIIRS sees about 6 times more fire than MODIS: 5 times by day and 30 times at night.",
        "Almost half of what VIIRS sees is weak fire below 5 MW. MODIS almost never records such fires (below 1%).",
        "The gap changes with the land: from about 5.7 times in savannas to 8.3 times in shrublands.",
        "About 9% of VIIRS hotspots (2013 to 2019) fall where MODIS saw nothing that month. A single exchange rate cannot recover them, so our model also uses the fire activity around each cell and its usual season."])),
])

nb("02_cleaning_and_static_sources", [
    ("md", "# 02 · Cleaning, and the hot places that are not fires\n\n" + box("What and why", [
        "Satellites also see factories, gas flares, volcanoes and ships. We must remove them, or they look like fires.",
        "NASA labels these places in its science quality data, but not in its near real time data (the newest months).",
        "We build a mask from the labelled years and test it on years it never saw.",
        "We also show the confidence rule and the few strange values we found."])),
    ("code", SETUP + "\nfrom fireharmony import static_mask as SM\nRAW = [str(C.raw('firms', f'year={y}', 'detections.parquet')) for y in C.years()]\nFAMILY = \"CASE WHEN sensor = 'MODIS' THEN 'MODIS' ELSE 'VIIRS' END\""),
    ("md", "## 1. What NASA's labels say\n\nIn science quality data each hotspot has a type: 0 vegetation fire, 1 active volcano, 2 other hot land source (such as industry), 3 offshore. Near real time rows have no type."),
    ("code", """types = con.execute(f'''
  WITH c AS (SELECT {FAMILY} AS family, quality, coalesce(CAST(type AS VARCHAR), 'no label') AS type, count(*) n FROM read_parquet({RAW}) GROUP BY 1, 2, 3)
  SELECT *, round(100.0 * n / sum(n) OVER (PARTITION BY family, quality), 2) AS pct FROM c ORDER BY 1, 2, 3''').df()
types"""),
    ("md", "## 2. Confidence\n\nEach hotspot also has a confidence. Our main record drops the low class (MODIS below 30%, VIIRS 'low'). A sensitivity test keeps them."),
    ("code", """conf = con.execute(f'''
  WITH d AS (SELECT {FAMILY} AS family,
                    CASE WHEN sensor = 'MODIS' THEN CASE WHEN confidence_pct < 30 THEN 'low' WHEN confidence_pct < 80 THEN 'nominal' ELSE 'high' END
                         ELSE CASE confidence WHEN 'l' THEN 'low' WHEN 'n' THEN 'nominal' ELSE 'high' END END AS conf_class
             FROM read_parquet({RAW}) WHERE type = 0),
       c AS (SELECT family, conf_class, count(*) n FROM d GROUP BY 1, 2)
  SELECT *, round(100.0 * n / sum(n) OVER (PARTITION BY family), 1) AS pct FROM c ORDER BY 1, 2''').df()
conf"""),
    ("md", "## 3. A mask for rows without labels\n\nWe use small hexagons (level 8, about 0.74 km2). We mask a hexagon for one of three reasons. Science quality data saw at least 3 static detections there. Or it touches a GIHS industrial site, or is next to one. Or a detection there lies in open water."),
    ("code", """m = pd.read_parquet(SM.mask_path('all'))
m.groupby('source').size().rename('hexagons').to_frame()"""),
    ("md", "## 4. Testing the mask on years it never saw\n\nWe build the test mask from FIRMS data up to 2022 only. The GIHS industrial sites use data up to 2023. So we test on science quality data from 2024 and 2025, which neither part has seen, and where NASA's labels tell us the truth. Recall is the share of static detections the mask catches. Fire loss is the share of real fires it removes by mistake."),
    ("code", """ev = SM.evaluate()
fig, axes = plt.subplots(1, 2, figsize=fh.SIZE['full'])
for ax, col, ttl in [(axes[0], 'recall', 'Static detections caught'), (axes[1], 'fire_loss', 'Real fires removed by mistake')]:
    d = ev[ev.variant.str.startswith('ring 0')]
    ax.bar(d.family, 100 * d[col], color=[fh.SENSOR['MODIS'], fh.SENSOR['VIIRS_SNPP']], width=0.55)
    for i, v in enumerate(100 * d[col]):
        ax.text(i, v, f'{v:.1f}%', ha='center', va='bottom', fontsize=8, color=fh.INK_2)
    fh.clean(ax); ax.set_ylabel('%'); fh.title(ax, ttl)
fig.suptitle('The mask catches most static sources and keeps almost every fire', x=0.01, ha='left', fontsize=12.5, fontweight='semibold')
fh.source(fig, 'Mask built from data up to 2022 (GIHS up to 2023), tested on 2024 and 2025. Source: NASA FIRMS, GIHS; analysis: Fire Harmony')
fig.get_layout_engine().set(rect=(0, 0.04, 1, 0.93)); fh.save(fig, FIG / 'fig04_static_mask_test')
ev.round(4)"""),
    ("md", "## 5. Strange values\n\nFire radiative power (FRP) tells how strongly a fire burns, in megawatts. A handful of raw values are impossible. We keep those detections but treat their FRP as missing."),
    ("code", """con.execute(f'''SELECT sensor, quality, count(*) AS n, min(frp) AS lowest, max(frp) AS highest
  FROM read_parquet({RAW}) WHERE NOT frp BETWEEN 0 AND 20000 GROUP BY ALL ORDER BY n DESC''').df()"""),
    ("md", box("Key findings", [
        "In science quality data, 95% of MODIS and 93% of VIIRS hotspots are vegetation fires. The rest are mostly industry and other static sources.",
        "The main confidence rule removes about 5% of MODIS and 12% of VIIRS vegetation hotspots.",
        "Tested on 2024 and 2025, years it never saw, our mask catches 96% of VIIRS static detections and wrongly removes only 1.5% of real fires. For MODIS it catches 88% and removes 0.8%.",
        "Widening the mask by one ring of neighbours would catch 3 points more MODIS static detections but only 0.3 points more for VIIRS, and it would remove more real fires. Near real time data is mostly VIIRS, so we keep the narrow mask.",
        "The open water part removes new offshore sources, such as a platform off north west Australia that appeared in 2026.",
        "Only 81 of 640.6 million rows have impossible FRP values (three of them are corrupt NOAA-21 values). We keep those detections and ignore only their FRP."])),
])


# ---------------------------------------------------------------------------------------------
nb("03_gridding_and_cell_features", [
    ("md", "# 03 · The hexagon grid, and what each hexagon holds\n\n" + box("What and why", [
        "We put every hotspot into a hexagon from the H3 grid. All hexagons at one level have about the same area, so places can be compared fairly.",
        "For every hexagon where a fire was ever seen, we store its land cover, peat, people and country.",
        "These cell facts help the model learn why the two sensors differ, and they let users pick a place by name."])),
    ("code", SETUP + "\n" + GOLD + "\nfrom matplotlib.colors import LogNorm\ns = pd.read_parquet(STATIC)"),
    ("md", "## 1. One grid, several zoom levels\n\nEach hexagon splits into seven smaller ones at the next level. Level 5 is our main analysis cell. The app shows levels 3 and 4 when zoomed out."),
    ("code", """g19 = str(AG.gold_path(2019))
levels = con.execute(f'''
  SELECT lvl, h3_get_hexagon_area_avg(lvl, 'km^2') AS km2,
         (SELECT count(DISTINCT h3_cell_to_parent(cell, lvl)) FROM '{g19}' WHERE n_main > 0) AS active_2019
  FROM (SELECT unnest([3, 4, 5]) AS lvl)''').df()
levels.round(1)"""),
    ("md", "## 2. What each hexagon holds"),
    ("code", """grid = pd.read_parquet(C.work('panel_l5', 'universe.parquet'))
pop = pd.read_parquet(C.work('features', 'population.parquet'))
print(f"{len(s):,} hexagons where a satellite ever saw any hotspot; {len(grid):,} of them had a vegetation fire (our grid)")
print(f"world population in our population layer: {pop.pop2000.sum() / 1e9:.2f} billion (2000), {pop.pop2020.sum() / 1e9:.2f} billion (2020)")
peat = pd.read_parquet(C.work('features', 'peat.parquet'))
print(f"peat layer: {peat.peat_km2.sum() / 1e6:.2f} million km2 in {len(peat):,} hexagons (PEATMAP reports 4.23); "
      f"{s.peat_km2.sum() / 1e6:.2f} million km2 of it in the {(s.peat_frac > 0).sum():,} hexagons where a satellite saw a hotspot")
print(f"{s.pop2020.sum() / 1e9:.2f} billion people live in these hexagons (2020)")
s[['lat', 'lon', 'country', 'state', 'biome', 'lc_forest', 'lc_savanna', 'lc_cropland', 'peat_frac', 'pop2020']].sample(5, random_state=1).round(3)"""),
    ("md", "## 3. Where the fires are\n\nThe mean harmonized hotspots a year from 2001 to 2025, in level 4 hexagons (about 1,770 km2), on an equal area world map."),
    ("code", """borders = con.execute(f"SELECT ST_AsText(ST_Simplify(geom, 0.15)) AS w FROM ST_Read('{FE.ne_source('ne_10m_admin_0_countries')}')").df().w
from fireharmony import eda_figures as EF   # the report figures are drawn from the published files, as in the report
EF.world_fire_map(fh, FIG / 'fig05_world_fire_map', con, borders)"""),
    ("md", "## 4. Fires by biome\n\nOur biome is simple and open: a latitude zone plus the main land cover of the hexagon."),
    ("code", """b = (s.groupby('biome').n_veg_all_time.sum() / 1e6).sort_values().tail(10)
print(f"tropical savanna share of all hotspots: {100 * s.loc[s.biome == 'tropical savanna', 'n_veg_all_time'].sum() / s.n_veg_all_time.sum():.0f}%")
fig, ax = plt.subplots(figsize=fh.SIZE['half'])
ax.barh(b.index, b.values, color=fh.EMBER[5], height=0.6)
fh.clean(ax, grid_axis='x'); ax.set_xlabel('Million hotspots, all sensors, 2000 to 2026')
fh.title(ax, 'Tropical savannas burn more than any other biome', 'Top 10 biomes')
fh.source(fig, 'Source: NASA FIRMS, MCD12C1; analysis: Fire Harmony')
fh.save(fig, FIG / 'fig06_fires_by_biome')
b.round(1)"""),
    ("md", "## 5. Peat\n\nPeat fires smoulder for weeks and cause most of the haze in South East Asia."),
    ("code", """(s.groupby('country').peat_km2.sum() / 1e3).sort_values(ascending=False).head(10).round(1).rename('peat, thousand km2').to_frame()"""),
    ("md", box("Key findings", [
        "A level 5 hexagon covers about 253 km2. We use 413,699 of them, every place where a satellite ever saw a vegetation fire.",
        "Our peat layer adds up to 4.23 million km2, the same as the published PEATMAP total. 3.26 million km2 of it lies in hexagons where a satellite saw a hotspot.",
        "Our population layer gives 6.05 billion people in 2000 and 8.0 billion in 2020, close to the GPW totals.",
        "Tropical savannas hold 42% of the world's hotspots, more than twice as many as the next biome (tropical grassland)."])),
])


# ---------------------------------------------------------------------------------------------
PENDING = "> **Key findings**\n>\n> (written after the results are checked)"
nb("05_harmonization_models", [
    ("md", "# 05 · Harmonization: learning the exchange rate between sensors\n\n" + box("What and why", [
        "We put every VIIRS satellite on one scale, the NOAA-20 scale, so the record does not depend on how many satellites flew.",
        "For the MODIS years we predict what NOAA-20 VIIRS would have counted, from what MODIS saw.",
        "We climb a ladder of models, from a simple exchange rate to gradient boosting, and keep the one that wins on years and places it never saw.",
        "Every modelled value gets a 90% range that we check on held out data."])),
    ("code", SETUP + "\nimport json, pickle\nimport lightgbm as lgb\nfrom fireharmony import harmonize as H\nMODELS = REPO / 'models'"),
    ("md", "## 1. All VIIRS satellites on one scale\n\nSuomi NPP and NOAA-21 carry the same camera as NOAA-20, but they pass at slightly different times. We learn a ratio for each region (H3 level 1, about 600,000 km2) from the months when both flew. Then we average the satellites instead of adding them, so more satellites never mean more fire."),
    ("code", """b = pickle.load(open(MODELS / 'bridges.pkl', 'rb'))
for sat, name in (('S', 'Suomi NPP'), ('J', 'NOAA-21')):
    k = b['k'][sat]
    w = k.other / k.other.sum()
    print(f"{name} to NOAA-20: world ratio {k.attrs['k_global']:.3f}; regional ratios (weighted by fires) 5% to 95%: "
          f"{np.interp([0.05, 0.95], np.cumsum(w[k.k.argsort()]), np.sort(k.k)).round(3)}")"""),
    ("md", "## 2. The model ladder\n\nWe compare three rungs. The exchange rate multiplies what MODIS saw by a learned rate for each region and month. Gradient boosting also uses the size and strength of the fires, the activity around each cell and its usual season, so it can also place fire where MODIS saw nothing. We also tested a reconciled model. It keeps the map of gradient boosting but scales it so the total of each large region (H3 level 1, about 600,000 km2) matches the exchange rate in that month. It scored best in the tests below, but those tests can only use 2012 to 2019. Further back in time its correction grows (by 1 to 2% in 2003 to 2011, 7% in Aqua's first year and 12.5% with Terra alone), so it would add steps to the record where the satellites change. So the record uses plain gradient boosting.\n\nWe hold out two years at a time (2012 and 2013, then 2014 and 2015, and so on). We train on the other years using one set of regions, and test on the held out years in other regions (whole H3 level 3 blocks of about 12,400 km2). So every score is for years and places the model never saw. CCC is Lin's concordance on a log scale: 1 means perfect agreement."),
    ("code", """sc = pd.read_parquet(C.work('models', 'cv_scores.parquet'))
tab = sc.groupby(['scale', 'model'])[['lin_ccc_log', 'median_abs_rel_err_pct', 'bias_pct']].mean().unstack('model').round(3)
order = ['cell x month', 'region L4 x month', 'region L3 x month', 'continent x month', 'world x month', 'region L3 x year', 'continent x year']
tab = tab.reindex(order)
from fireharmony import eda_figures as EF   # the report figures are drawn from the published files, as in the report
EF.model_ladder(fh, FIG / 'fig07_model_ladder')   # gradient boosting against the exchange rate, from dashboard.json
tab"""),
    ("md", "## 3. What the model learned\n\nThe importance of a feature is how much it improved the fit in total."),
    ("code", """bst = lgb.Booster(model_file=str(MODELS / 'gbm_terra_aqua.txt'))
imp = pd.Series(bst.feature_importance('gain'), index=bst.feature_name()).sort_values()
imp = 100 * imp / imp.sum()
WHAT = {'n': 'hotspots', 'nd': 'day hotspots', 'nn': 'night hotspots', 'ns': 'weak hotspots (below 5 MW)', 'nl': 'strong hotspots (50 MW or more)',
        'frp': 'total fire power', 'fd': 'days with fire', 'c7': 'fire cell days (5 km² cells)', 'pix': 'pixel size', 'frp_per_det': 'fire power per hotspot'}
def plain(f):
    if f in ('ctx4', 'ctx3'): return f"MODIS fire around the cell (level {f[-1]} hexagon)"
    if f == 'clim': return "The cell's usual MODIS fire that month"
    if f in ('mo_sin', 'mo_cos'): return 'Time of year'
    sat, _, m = f.partition('_')
    return f"{dict(T='Terra', A='Aqua').get(sat, sat)}: {WHAT.get(m, m)}" if m else f
fig, ax = plt.subplots(figsize=(fh.SIZE['full'][0], fh.SIZE['full'][1] * 0.95))
top = imp.tail(12)
ax.barh([plain(f) for f in top.index], top.values, color=fh.SENSOR['MODIS'], height=0.6)
for y, v in enumerate(top.values):
    ax.text(v, y, f'  {v:.1f}%', va='center', fontsize=7.5, color=fh.INK_2)
fh.clean(ax, grid_axis='x'); ax.set_xlabel('Share of the total gain of the model, %'); ax.set_xlim(0, top.max() * 1.15)
fh.title(ax, 'What MODIS saw matters most', 'The 12 most useful inputs of the Terra and Aqua model')
fh.source(fig, 'Source: NASA FIRMS; analysis: Fire Harmony')
fh.save(fig, FIG / 'fig08_feature_importance')
imp.tail(15).round(1)[::-1]"""),
    ("md", "## 4. Ranges you can trust\n\nFor any area and month, the range comes from a small table. We group held out totals by size and, for each size, we find how far predictions usually miss. We tried one smooth formula first, but it covered only half of the continent totals, so we use the table. Below, the share of held out totals that fall inside their 90% range, for each kind of area."),
    ("code", """iv = json.loads((MODELS / 'area_intervals.json').read_text())
pd.DataFrame({k: v['coverage_by_scale'] for k, v in iv.items()})"""),
    ("md", "## 5. The Terra only years\n\nBefore July 2002 only Terra flew, so the record there comes from the Terra only model. "
           "Where both models ran, the Terra only model read lower in the first years after the seam, so we bridge it to the Terra + Aqua model, "
           "region by region, with ratios learned in the three years after July 2002. Notebook 06 shows why and how well it works."),
    ("code", """br = json.loads((MODELS / 'terra_only_bridge.json').read_text())
k = pd.Series(br['regions'])
ym = lambda m: pd.Period(year=m // 100, month=m % 100, freq='M').strftime('%B %Y')
print(f"Terra only to Terra + Aqua, learned {ym(br['months'][0])} to {ym(br['months'][1])}: world ratio {br['k_global']:.3f}; "
      f"level 1 regions, middle 90%: {k.quantile(0.05):.2f} to {k.quantile(0.95):.2f}")"""),
    ("md", box("Key findings", [
        "Suomi NPP and NOAA-20 agree to within 1% worldwide. NOAA-21 counts about 4% fewer fires than NOAA-20 (NOAA-20 counts 4.6% more), and we correct for it.",
        "On years and regions it never saw, gradient boosting beats the simple exchange rate for every area smaller than a continent. For regions of 12,400 km2 and one month the median error falls from 66% to 38%, and the agreement (CCC) rises from 0.87 to 0.94.",
        "For whole continents the exchange rate alone was better (median error 5.7% against 9.9% per month), because it is tuned on regional totals. For the whole world gradient boosting is better again (1.9% against 2.5%).",
        "A reconciled model (gradient boosting scaled to the regional totals of the exchange rate) scored best at most scales in 2012 to 2019, but its correction drifts back in time. We tested it and chose not to use it.",
        "The best clue is how widely MODIS saw fire. The number of small cells (H3 level 7, about 5 km2) where Terra saw fire carries 41% of the gain, "
        "more than the hotspot counts of Terra and Aqua together (27%).",
        "The 90% ranges hold. Between 92% and 96% of held out monthly totals fall inside them, for every size of area, and 92% to 100% of yearly totals.",
        "The model is slightly low overall: by 1.0% with Terra and Aqua, and by 1.6% with Terra alone.",
        "Before July 2002 the Terra only model is bridged to the Terra + Aqua model (world ratio 1.033), so the record does not step when Aqua joins."])),
])

nb("06_validation_suite", [
    ("md", "# 06 · Does it work? The validation suite\n\n" + box("What and why", [
        "Nobody knows the true number of fires, so we test the record against a witness.",
        "MODIS flew the whole time with the same camera. Across 2012 the harmonized record must change by the same factor as MODIS.",
        "Terra flew alone before July 2002 and on after it. Across 2002 the record must change by the same factor as Terra.",
        "To know how big a step is normal, we run the same test at dates when nothing changed (placebo seams).",
        "We also run change point tests, compare the model with VIIRS in the years VIIRS flew, and check that the worst months stay the worst."])),
    ("code", SETUP + """
import json
from IPython.display import Image
from fireharmony import validate as V
MODELS = REPO / 'models'
val = json.loads((MODELS / 'validation.json').read_text())
bridge = json.loads((MODELS / 'terra_only_bridge.json').read_text())
world = pd.read_parquet(C.work('models', 'world_monthly.parquet'))
HZ = C.work('harmonized_l5', 'year=*', 'data.parquet')
FLEET = C.work('gold', 'fleet_month.parquet')"""),
    ("md", "## 1. The seam tests\n\nThe seam ratio is the mean of the years after a seam divided by the mean of the years before it. "
           "We use one year each side for 2002 (the archive starts in November 2000) and three years for 2012. A good record changes by the same factor as its witness.\n\n"
           "Terra missed some days (half of June 2001, a week of March 2002), so we correct each Terra month for its missing days (`terra_cc`). The raw Terra count (`terra_raw`) would make the year before the seam look too small."),
    ("code", "pd.DataFrame(val['seam_ratios']).set_index('series')"),
    ("md", "## 2. Steps against the witness\n\nFire really changes from year to year, and the witness sees those changes too. So we divide each record by its witness, month by month. "
           "If the record is consistent, this ratio stays the same across the seam, and any step left belongs to the record itself. "
           "The windows hold the same calendar months on both sides (July to June for 2002, January to December for 2012)."),
    ("code", """rows = []
for seam, cols in val['per_witness'].items():
    for col, w in cols.items():
        for win, r in w.items():
            rows.append({'seam': seam.replace('_', ' '), 'series': col, 'window after the seam': win, 'step (%)': round(r['step_pct'], 2)})
# the same test without the Terra only bridge (section 4): the raw Terra only model before July 2002
raw = world.assign(unbridged=np.where(world.yr * 100 + world.mo < 200207, world.model_terra_only, world.harmonized))
rows.append({'seam': '2002 terra witness', 'series': 'harmonized without the bridge', 'window after the seam': '1y',
             'step (%)': round(V.per_witness(raw, 'unbridged', 'terra_cc', '2002-07-01', '2001-07-01', 1)['step_pct'], 2)})
pd.DataFrame(rows)"""),
    ("md", "## 3. How big is a normal step? Placebo seams\n\n"
           "The record and its witness never see exactly the same fires, so their ratio moves a little every year, seam or not. "
           "To see how much, we run the same one year test at dates when no satellite joined or left: every July from 2003 to 2010 against Terra, and every January from 2004 to 2011 against MODIS. "
           "A real seam problem would stand far outside the spread of these placebo steps."),
    ("code", """pl = val['placebo_seams']
pd.DataFrame([{'seam': k.replace('_', ' '), 'real step (%)': d['real_step'], 'placebo mean (%)': d['mean'], 'placebo sd (%)': d['sd'],
               'largest placebo step (%)': d['max_abs'], 'z of the real step': d['z']} for k, d in pl.items()]).set_index('seam').round(2)"""),
    ("code", """fig, axes = plt.subplots(1, 2, figsize=fh.SIZE['full'], sharey=True)
for ax, (key, d), real_year, name in zip(axes, pl.items(), (2002, 2012),
                                         ('Aqua joins, July 2002', 'VIIRS starts, January 2012')):
    yrs = np.array([int(y) for y in d['steps']]); st = np.array(list(d['steps'].values()))
    lo, hi = d['mean'] - 2 * d['sd'], d['mean'] + 2 * d['sd']
    ax.axhspan(lo, hi, color=fh.GRID, alpha=0.45, lw=0)
    for v in (lo, hi):
        ax.axhline(v, color=fh.BASELINE, lw=0.8, ls=(0, (3, 2)))
    ax.axhline(0, color=fh.BASELINE, lw=0.8)
    ax.scatter(yrs, st, s=26, color=fh.MUTED, zorder=3)
    ax.scatter([real_year], [d['real_step']], s=56, color=fh.INK, zorder=4)
    left = real_year > yrs.max()                       # 2012: the placebo years come before the seam
    ax.annotate('the real seam', (real_year, d['real_step']), xytext=(-8 if left else 8, 10), textcoords='offset points',
                ha='right' if left else 'left', va='bottom', fontsize=8.5, color=fh.INK_2)
    ax.annotate('normal range', (yrs.min() if left else yrs.max(), hi), xytext=(0, 3), textcoords='offset points',
                ha='left' if left else 'right', va='bottom', fontsize=7.5, color=fh.MUTED)
    fh.clean(ax)
    span = np.r_[yrs, real_year]
    ax.set_xticks(np.arange(span.min(), span.max() + 1, 2))
    ax.set_xlim(span.min() - 0.7, span.max() + 0.7)
    fh.title(ax, name, 'record against Terra, July to June' if key.startswith('2002') else 'record against MODIS, January to December')
axes[0].set_ylabel('Step against the witness (%)')
fig.suptitle('The steps at the real seams are as small as in ordinary years', x=0.01, ha='left', fontsize=12.5, fontweight='semibold')
fh.source(fig, 'Grey dots: the same one year test at dates with no satellite change. Normal range: their mean plus or minus two standard deviations. '
               'Source: NASA FIRMS; analysis: Fire Harmony')
fig.get_layout_engine().set(rect=(0, 0.035, 1, 0.95))
fh.save(fig, FIG / 'fig13_placebo_seams')"""),
    ("md", "## 3b. A witness that VIIRS cannot touch: burned area\n\n"
           "ESA's Fire_cci burned area (MRBA60H) is made from MODIS 250 m images, the same way for 2003 to 2018. The switch to VIIRS in our record does not change it. "
           "So the number of hotspots per km2 burned should not step at 2012. We run the same step and placebo tests against it "
           "(its Sentinel 3 continuation from 2019 is left out, because it would be a seam of its own)."),
    ("code", """bw = val['burned_area_witness']
pd.DataFrame([{'window': k, 'harmonized step (%)': d['step_pct']['harmonized'], 'MODIS step (%)': d['step_pct']['modis_scale'],
               'naive join step (%)': d['step_pct']['naive_join'], 'placebo sd (%)': d['placebo_sd'], 'z of the harmonized step': d['z']}
              for k, d in bw.items() if k in ('1y', '3y')]).set_index('window').round(2)"""),
    ("code", """hpk = pd.Series(bw['hotspots_per_km2_burned']).rename('harmonized hotspots per km2 burned')
print('yearly correlation with burned area:', {k: round(v, 3) for k, v in bw['yearly_correlation'].items()})
hpk.round(2).to_frame().T"""),
    ("md", "## 4. The two models where both ran: the Terra only bridge\n\n"
           "Before July 2002 only Terra flew, so the record there comes from the Terra only model. After it the Terra + Aqua model takes over. "
           "Both models ran in many later years, so we can compare them. In the training years (2013 to 2019) they agree within about 1.5% for the world. "
           "In the first years after the seam the Terra only model reads lower, and some regions differ a lot more. The gap also drifts slowly over the years. "
           "So we bridge the Terra only model to the Terra + Aqua model, region by region (level 1 hexagons), with ratios learned in the three years after July 2002. "
           "This is the same idea as the bridges that put Suomi NPP and NOAA-21 on the NOAA-20 scale."),
    ("code", """both = world[world.model_terra_only.notna() & world.model_terra_aqua.notna() & (world.model_terra_only > 0)]
by_year = both.groupby('yr').apply(lambda g: g.model_terra_aqua.sum() / g.model_terra_only.sum(), include_groups=False).rename('world')
cont = con.execute(f'''
  WITH j AS (SELECT s.continent, CASE WHEN h.yr * 100 + h.mo BETWEEN 200207 AND 200506 THEN '2002 to 2005'
                                      WHEN h.yr * 100 + h.mo BETWEEN 200507 AND 200812 THEN '2005 to 2008'
                                      WHEN h.yr BETWEEN 2013 AND 2019 THEN '2013 to 2019' END AS period, h.pred_ta, h.pred_t
             FROM read_parquet('{HZ}') h JOIN '{FE.out_path("cell_static_l5")}' s USING (cell)
             WHERE h.pred_ta IS NOT NULL AND h.pred_t IS NOT NULL)
  SELECT continent, period, sum(pred_ta) / sum(pred_t) AS ratio, sum(pred_t) AS t FROM j
  WHERE period IS NOT NULL GROUP BY 1, 2''').df()
cont = cont[cont.groupby('continent').t.transform('min') > 1e6].pivot(index='continent', columns='period', values='ratio')
k = pd.Series(bridge['regions'])
print('Terra + Aqua model / Terra only model, world, by year:'); print(by_year.round(3).to_frame().T.to_string())
print(f"\\nBridge: world ratio {bridge['k_global']:.3f}; regions: middle 90% from {k.quantile(0.05):.2f} to {k.quantile(0.95):.2f}")
cont.round(3)"""),
    ("md", "## 5. Why the MODIS scale view steps at 2002\n\n"
           "The MODIS scale view (a toggle in the app) is the per satellite average of Terra and Aqua. Before July 2002 it has to be modelled from Terra alone. "
           "In its first year, Aqua recorded fewer fires for each Terra fire than in any later year until 2020. So that view drops at the seam. "
           "The main record does not use this average, and it stays level."),
    ("code", """aq = con.execute(f'''
  WITH w AS (SELECT yr, mo, t, a FROM '{C.path("products") / "v1.0" / "area_monthly.parquet"}' WHERE kind = 'world'),
  f AS (SELECT yr, mo, satellite, days_with_data / day(last_day(make_date(yr::INT, mo::INT, 1)))::DOUBLE AS cov
        FROM '{FLEET}' WHERE satellite IN ('Terra', 'Aqua'))
  SELECT CASE WHEN w.mo >= 7 THEN w.yr ELSE w.yr - 1 END AS fire_year, sum(a / fa.cov) / sum(t / ft.cov) AS aqua_per_terra
  FROM w JOIN f ft ON ft.yr = w.yr AND ft.mo = w.mo AND ft.satellite = 'Terra'
         JOIN f fa ON fa.yr = w.yr AND fa.mo = w.mo AND fa.satellite = 'Aqua'
  WHERE fa.cov >= 0.5 AND ft.cov >= 0.5 GROUP BY 1 HAVING count(*) = 12 ORDER BY 1''').df().set_index('fire_year')
later = aq.loc[2003:2020, 'aqua_per_terra']
print(f"Aqua per Terra (coverage corrected), July {aq.index[0]} to June {aq.index[0] + 1}: {aq.aqua_per_terra.iloc[0]:.2f}; "
      f"fire years 2003 to 2020: {later.min():.2f} to {later.max():.2f} (mean {later.mean():.2f})")
aq.round(3).T"""),
    ("md", "## 6. The headline figure"),
    ("code", "Image(str(FIG / 'fig03_seam_test.png'), width=900)"),
    ("md", "## 7. Change point tests\n\nThe Pettitt test looks for one sudden change in a series of yearly totals (2001 to 2025). PELT looks for changes in the monthly series after removing the usual season."),
    ("code", """pett = pd.DataFrame(val['pettitt_annual_2001_2025']).T[['change_year', 'p']]
pett['PELT breaks'] = pd.Series({k: ', '.join(d[:7] for d in v) for k, v in val['pelt_breaks_monthly'].items()})
pett['PELT breaks within 12 months of a seam'] = pd.Series({s: ', '.join(f"{seam[:7]}: {', '.join(d[:7] for d in v[s]) or 'none'}" for seam, v in val['pelt_breaks_within_12_months_of_seam'].items())
                                                    for s in pett.index})
pett"""),
    ("code", """yearly = world[world.yr.between(2001, 2025)].groupby('yr')[['harmonized', 'modis_scale']].sum()
pd.DataFrame({f'{a} to {b}': yearly.loc[a:b].median() / 1e6 for a, b in ((2001, 2008), (2009, 2016), (2017, 2025))}).round(2).rename_axis('median year (million)')"""),
    ("md", "## 8. The model against VIIRS, in the years VIIRS flew\n\nFrom 2012 we have both: what VIIRS saw and what our model predicts from MODIS alone. The final model was trained on 2012 to 2019 (on a third of the regions), so for those years this is a fit, not a test: the held out test is in notebook 05. The years 2020 to 2025 were never used for training, so they are a real test, and they also show what happens as the MODIS orbits drift."),
    ("code", """# only months where both exist: January 2012 has no VIIRS value, April 2022 no Terra + Aqua model (Aqua was down)
obs_months = world[world.yr.between(2012, 2025) & world.viirs_observed.notna() & world.model_terra_aqua.notna()]
y = obs_months.groupby('yr')[['viirs_observed', 'model_terra_aqua']].sum()
ratio = (y.model_terra_aqua / y.viirs_observed).rename('model / observed')
from fireharmony import eda_figures as EF
EF.model_vs_viirs(fh, FIG / 'fig09_model_vs_viirs', y)   # training years shaded, the held out years labelled
pd.concat([(y / 1e6).round(2), ratio.round(3)], axis=1)"""),
    ("md", "## 9. Do the worst months stay the worst?\n\nFor each continent we rank the months by observed fire and by modelled fire, and compare the rankings: for 2020 to 2025 (never used in training, a real test) and, for reference, for the training years 2012 to 2019."),
    ("code", """def rank_test(years):
    cont = V.monthly_series(years=years, by='continent', con=con)
    cont = cont[cont.viirs_observed.notna() & cont.model_terra_aqua.notna()]
    out = []
    for c, g in cont.groupby('continent'):
        if g.viirs_observed.sum() < 1e5:
            continue
        top_obs = set(g.nlargest(10, 'viirs_observed').index); top_mod = set(g.nlargest(10, 'model_terra_aqua').index)
        out.append({'continent': c, 'spearman': g.viirs_observed.corr(g.model_terra_aqua, method='spearman'),
                    'top 10 months shared': len(top_obs & top_mod)})
    return pd.DataFrame(out).set_index('continent')
pd.concat({'2020 to 2025 (test)': rank_test(range(2020, 2026)), '2012 to 2019 (training years)': rank_test(range(2012, 2020))}, axis=1).round(3)"""),
    ("md", box("Key findings", [
        "Across 2012, MODIS fell by 2.7% and the harmonized record by 1.1%, in step with it. A naive join jumps 7.9 times (8.4 times from 2011 to 2012).",
        "Divided by its witness, the harmonized record steps by 0.55% at 2012 (1.65% with three years each side). The naive join steps by about 700%.",
        "Before July 2002 the record comes from the Terra only model. In the three years after the seam that model read about 3% below the Terra + Aqua model for the world, and up to 11% apart by continent. "
        "We bridge it region by region. Without the bridge the record would step by 3.6% at 2002. With it, the step is 0.85%.",
        "Both steps are normal. At dates with no satellite change the same test moves by 5.0% against Terra and 1.2% against MODIS (one standard deviation). "
        "The real steps sit 0.07 and 0.37 standard deviations from the placebo mean.",
        "Against ESA burned area, which the switch to VIIRS cannot touch, the record steps by 3.2% at 2012, inside the normal spread of 4.2%. "
        "From 2003 to 2018 it holds 2.8 to 3.2 hotspots for every km2 burned, with no jump. The naive join jumps by 720%.",
        "The MODIS scale view (a toggle in the app) drops by 7.1% in July 2002, because Aqua saw relatively few fires in its first year: 1.86 for each Terra fire, against 1.92 to 2.18 in 2003 to 2020. We state this next to the toggle.",
        "Change point tests find a break at the 2012 seam only in the naive join. The harmonized record and MODIS have no break within a year of either seam.",
        "Pettitt dates the main change in the harmonized record to 2009 and in MODIS to 2013. Both mark the fall in global fire after the late 2000s: the median year had 18.3 million hotspots in 2001 to 2008 and 16.5 million in 2017 to 2025.",
        "The other breaks (late 2021, early 2023, late 2024) appear in MODIS too, so they are fire events, not seams.",
        "From MODIS alone, the model matches VIIRS within 1.5% in 2013 to 2019 (training years, so a fit). In the test years 2020 to 2025 it reads 2 to 6% low, as the MODIS orbits drift. The record uses VIIRS itself in those years, so it is not affected.",
        "The worst months stay the worst. In the test years the rankings agree at 0.98 or more on every continent but Europe (0.91), and 8 to 10 of the 10 worst months are the same."])),
])


# ---------------------------------------------------------------------------------------------
nb("07_climatology_anomalies_critical_periods", [
    ("md", "# 07 · The burning calendar: normal seasons, unusual months and critical periods\n\n" + box("What and why", [
        "The burning calendar shows how much fire burned in each month of each year, on one consistent scale.",
        "We work out what a normal month looks like, so any month can be called normal or unusual.",
        "We mark the critical periods that CONAE asks for: the months when fire is usually at its worst.",
        "We use Malaysia and its upwind neighbours in Indonesia as the example, but every function works for any area."])),
    ("code", SETUP + "\nfrom matplotlib.colors import LogNorm\nfrom fireharmony import analytics as A\nAREAS = {'Malaysia': \"iso3 = 'MYS'\", 'Riau (Indonesia)': \"state = 'Riau'\", 'Central Kalimantan (Indonesia)': \"state = 'Kalimantan Tengah'\"}\nseries = {k: A.area_series(w, con=con) for k, w in AREAS.items()}"),
    ("md", "## 1. The burning calendar\n\nEach box is one month. The colour is the number of hotspots on the NOAA-20 VIIRS scale. Years before 2012 come from the harmonization model."),
    ("code", """from fireharmony import eda_figures as EF   # the report figures are drawn from the published files, as in the report
EF.calendars(fh, FIG)   # Malaysia, Central Kalimantan (with El Nino years) and Corrientes, on one colour scale"""),
    ("md", "## 2. The normal season and the critical period\n\nThe line is the median of each calendar month from 2001 to 2025. The band holds the middle half of the years."),
    ("code", """rows = []
for name, s in series.items():
    crit = A.critical(s)
    rows.append({'area': name, 'critical period (months)': crit['critical_period'], 'fire year starts in month': A.fire_year_start(s)})
from fireharmony import eda_figures as EF   # the report figures are drawn from the published files, as in the report
EF.normal_season(fh, FIG / 'fig11_normal_season')
pd.DataFrame(rows)"""),
    ("md", "## 3. Is this month unusual?\n\nFor the latest months we compare each one with the same month in normal years: the ratio to the median, its percentile and its rank since 2001."),
    ("code", """latest = []
for name, s in series.items():
    a = A.anomalies(s)
    latest.append(a.tail(4).assign(area=name)[['area', 'yr', 'mo', 'value', 'ratio_to_normal', 'percentile', 'rank_in_month']])
pd.concat(latest).round(2)"""),
    ("md", "## 4. When does the season start, peak and end?\n\nStart, middle and end are the points where 10%, 50% and 90% of a fire year's hotspots have burned, counted in months from the start of the fire year."),
    ("code", """seas = A.season(series['Riau (Indonesia)'])
seas.round(2).tail(10)"""),
    ("md", "## 5. Trends\n\nIs fire becoming more or less common? We use the Mann Kendall test, corrected for years that resemble their neighbours, and Sen's slope."),
    ("code", """tr = pd.DataFrame({name: A.trend(s) for name, s in series.items()}).T
tr['MODIS alone, % per decade'] = [A.trend(s.assign(value=s.modis_scale))['pct_per_decade'] for s in series.values()]
tr"""),
    ("md", "## 6. El Niño\n\nEl Niño years are dry in South East Asia. The Oceanic Niño Index (ONI) is the sea surface temperature anomaly in the central Pacific; above +0.5 is El Niño, above +1.5 strong."),
    ("code", """oni = pd.read_csv(C.raw('climate_indices', 'noaa_oni.txt'), sep=r'\\s+')
peak = oni.groupby('YR').ANOM.max().loc[2014:2026]
peak.round(2).rename('highest 3 month ONI').to_frame().T"""),
    ("md", box("Key findings", [
        "Each area has a short critical period: August in Malaysia, July and August in Riau, August to October in Central Kalimantan.",
        "Riau also has a second, smaller season in February and March.",
        "Fire has fallen strongly since 2001: by about 54% per decade in Malaysia, 74% in Riau and 76% in Central Kalimantan. MODIS alone shows a similar fall (54%, 67% and 74%), so the harmonization does not cause it.",
        "In 2026, during the strongest El Niño since 2015, Central Kalimantan burned 5 to 14 times more than normal from August to October, ranking second or third since 2001 in each month. Malaysia and Riau stayed below normal.",
        "The newest month has only a few days of data, so we show it as not yet known instead of zero."])),
])


# ---------------------------------------------------------------------------------------------
P3_SETUP = SETUP + """
import json
from matplotlib.colors import LogNorm, Normalize, TwoSlopeNorm
from fireharmony import climate as K, drivers as D
MODELS = REPO / 'models'
BORDERS = con.execute(f"SELECT ST_AsText(ST_Simplify(geom, 0.15)) AS w FROM ST_Read('{FE.ne_source('ne_10m_admin_0_countries')}')").df().w"""

nb("08_drivers_of_unusual_fire", [
    ("md", "# 08 · Why was a month unusual? Rain, heat and El Niño\n\n" + box("What and why", [
        "A month with five times the normal fire needs an explanation. Most often it is the weather before it.",
        "We bring NASA rain (GPM IMERG), weather (MERRA-2) and fire weather (GFWED) onto the same hexagons as the fires.",
        "For every country and state with enough fire we measure how strongly fire follows a rain deficit and heat, and how El Niño moves the rain.",
        "We score this on years the model never saw, so the app only explains where the explanation works."])),
    ("code", P3_SETUP + """
dm = json.loads((MODELS / 'drivers.json').read_text())['areas']
mods = pd.DataFrame([{'kind': k.split(':', 1)[0], 'id': k.split(':', 1)[1], 'r2_cv': v['r2_cv'], 'uses_heat': 't2m_z' in v['terms'],
                      'beta_rain': v['beta']['rain3_z'], 'beta_heat': v['beta']['t2m_z'], 'enso_r': v['enso'].get('r'),
                      'enso_lag': v['enso'].get('lag'), 'fire_per_year': v['fire_per_year']} for k, v in dm.items()])
expl = pd.read_parquet(K.out('drivers_monthly.parquet'))
names = con.execute(f"SELECT kind, id, name FROM read_json_auto('{C.path('products') / 'v1.0' / 'areas.json'}')").df()
mods = mods.merge(names, on=['kind', 'id'], how='left')
print(f"{len(mods):,} areas with a driver model (at least {D.MIN_FIRE} hotspots a year)")"""),
    ("md", "## 1. The climate tables\n\nEach raster was reduced once to level 3 hexagons (about 12,400 km2) and months, checked, and then deleted to save disk. A grid cell belongs to the hexagon that holds its centre, and a hexagon's value is the mean of its cells, weighted by their area."),
    ("code", """rows = []
for name, col in [('rain_l3', 'rain_final_mm'), ('rain_l3', 'rain_late_mm'), ('merra2_l3', 't2m_c'), ('fwi_l3', 'fwi')]:
    r = con.execute(f'''SELECT count(*), count(DISTINCT hex), min(yr::INT * 100 + mo), max(yr::INT * 100 + mo)
                        FROM '{K.out(name + '.parquet')}' WHERE {col} IS NOT NULL''').fetchall()[0]
    rows.append({'table': name, 'variable': col, 'rows': r[0], 'hexagons': r[1], 'first month': r[2], 'last month': r[3]})
pd.DataFrame(rows)"""),
    ("md", "## 2. One rain record: bridging IMERG Late to IMERG Final\n\n"
           "IMERG Final, which is corrected with rain gauges, ends in September 2025. After that only IMERG Late exists, which has no gauge correction. "
           "We downloaded a year where both exist (October 2024 to September 2025) and learned the ratio Final / Late for each hexagon, "
           "shrunk towards its continent, like the bridges between satellites. From October 2025 the rain is IMERG Late times that ratio."),
    ("code", """kb = pd.read_parquet(K.out('rain_bridge.parquet'))
print(f"world ratio Final / Late: {kb[kb.months == 12].f.sum() / kb[kb.months == 12].l.sum():.3f}; "
      f"hexagons with a full overlap year: {(kb.months == 12).sum():,} of {len(kb):,}")
kb[kb.months == 12].groupby('continent').apply(lambda g: pd.Series({'Final / Late': round(g.f.sum() / g.l.sum(), 3),
    'hexagons, middle 90%': f"{g.k.quantile(0.05):.2f} to {g.k.quantile(0.95):.2f}"}), include_groups=False)"""),
    ("md", "## 3. Fire follows the rain: Central Kalimantan\n\n"
           "Each dot is one month of 2002 to 2025. Across: the rain of that month and the 2 before, standardised (0 is normal, minus 2 is very dry). "
           "Up: fire against the normal of that month, on a log scale. Big dots are months of the fire season. The line is the fitted model."),
    ("code", """ck = expl[(expl.kind == 'state') & (expl.id == 'IDN-1931')]
m = dm['state:IDN-1931']
fit = ck[ck.yr.between(*D.FIT_YEARS)].dropna(subset=['rain3_z', 'ratio'])
fig, axes = plt.subplots(1, 2, figsize=fh.SIZE['full'], gridspec_kw={'width_ratios': [1.15, 1.45]})
ax = axes[0]
size = 8 + 60 * fit.normal / fit.normal.max()
ax.scatter(fit.rain3_z, fit.ratio.clip(lower=0.01), s=size, color=fh.EMBER[5], alpha=0.5, lw=0)
xs = np.linspace(-3, 3, 50)
ax.plot(xs, np.exp(m['beta']['const'] + m['beta']['rain3_z'] * xs), color=fh.INK, lw=2)
ax.set_yscale('log'); ax.axhline(1, color=fh.BASELINE, lw=0.8); ax.axvline(0, color=fh.BASELINE, lw=0.8)
ax.set_xlabel('Rain over 3 months (standardised)'); ax.set_ylabel('Fire, times normal')
fh.clean(ax, grid_axis='both')
fh.title(ax, 'Drier months burn more', f"R² on years left out: {m['r2_cv']:.2f}")
ax = axes[1]
s2 = ck[ck.yr.between(2014, 2026)]
tt = s2.yr + (s2.mo - 0.5) / 12
ax.plot(tt, s2.ratio, color=fh.EMBER[5], lw=1.6)
ax.plot(tt, s2.f_drivers, color=fh.INK, lw=0.9, marker='o', ms=2.4)
ax.set_yscale('log'); ax.axhline(1, color=fh.BASELINE, lw=0.8)
ax.set_xlim(2014, 2027.2)
ax.xaxis.set_major_locator(plt.MultipleLocator(2)); ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f'{int(v)}'))
fh.clean(ax)
fh.title(ax, 'Fire seasons follow drought', 'Times normal; black dots: the rain alone')
fh.source(fig, 'Source: NASA FIRMS, GPM IMERG; analysis: Fire Harmony')
fig.get_layout_engine().set(rect=(0, 0.035, 1, 1))
fh.save(fig, FIG / 'fig14_drivers_central_kalimantan')
ck[ck.yr.eq(2026) & ck.mo.between(6, 10)][['yr', 'mo', 'ratio', 'rain3_pct', 'f_rain', 'oni', 'oni_lagged', 'rain_z_from_enso']].round(2)"""),
    ("md", "## 4. Where the weather explains fire\n\n"
           "For every state with enough fire: the share of the ups and downs of fire that rain and heat explain, on years left out. "
           "Each level 3 hexagon takes the value of the state that holds most of its fire."),
    ("code", """from fireharmony import eda_figures as EF   # the report figures are drawn from the published files, as in the report
EF.driver_skill_map(fh, FIG / 'fig15_driver_skill_map', con, BORDERS)   # a neutral blue grey scale: R2 is not an anomaly
q = mods.groupby('kind').r2_cv.describe(percentiles=[0.25, 0.5, 0.75])[['count', '25%', '50%', '75%']].round(3)
q"""),
    ("code", """top = mods[(mods.kind == 'state') & (mods.fire_per_year > 3000)].nlargest(12, 'r2_cv')[['name', 'r2_cv', 'uses_heat', 'beta_rain', 'enso_r', 'enso_lag', 'fire_per_year']]
top.round(3)"""),
    ("md", "## 5. El Niño and the rain\n\nEl Niño does not light fires: it moves the rain. For each state we find the lag (0 to 6 months) at which El Niño moves its 3 month rain most, and the strength of that link."),
    ("code", """from fireharmony import eda_figures as EF   # the report figures are drawn from the published files, as in the report
EF.enso_rain_map(fh, FIG / 'fig16_enso_rain_link', con, BORDERS)   # brown where El Nino dries, teal where it wets
mods[mods.kind == 'country'].dropna(subset=['enso_r']).nsmallest(10, 'enso_r')[['name', 'enso_r', 'enso_lag', 'r2_cv']].round(3)"""),
    ("md", box("Key findings", [
        "On years the model never saw, rain and heat explain more than 20% of the ups and downs of fire in 23% of the 1,726 areas. In the median state they explain 5%: most monthly swings are not about the weather.",
        "They work best where fire follows drought. Indonesian provinces fill the top of the list (Maluku 0.70, Kalimantan Selatan 0.69, Central Kalimantan 0.66, Papua 0.62), followed by Papua New Guinea and the north of the Amazon (Roraima 0.53).",
        "In Central Kalimantan, one standard deviation less rain over three months means about four times more fire.",
        "El Niño acts through the rain. Its link with the 3 month rain is r = -0.66 in Indonesia, -0.80 in the Philippines (three months later), and -0.56 and -0.55 in Malaysia and Australia.",
        "In 2026 the three months to September brought 84% less rain than normal to Central Kalimantan, during a strong El Niño (ONI +2.46). Fire was 5 to 14 times normal from August to October.",
        "In the driest months the simple model points to more fire than burned (October 2015: 25 times normal against 17.5). Fire grows less than the model says once almost everything that can burn is dry. So the app says more than 10 times normal there, not a number.",
        "Heat is a real driver in boreal and temperate places such as Canada. In the tropics hot months come out with less fire, because thick smoke cools the surface, so heat is left out where that happens.",
        "The fire estimate is given for months of the fire season only, and areas whose fire is mostly gas flares or lava on barren land (57 areas, such as Svalbard, Iceland's lava fields and the Algerian Sahara) get no model.",
        "From October 2025 the rain comes from IMERG Late, bridged to IMERG Final with one ratio per hexagon (0.95 for the world, 0.88 for Africa and South America). IMERG Late changed version on 3 March 2026 after our bridge year. The 2026 rain looks like 2015 region by region (dry in the Maritime Continent and the north of South America, wet in East Africa in September and October), so we see no sign of a large version step, but a small bias is possible."])),
])

nb("09_fire_outlook", [
    ("md", "# 09 · Fire outlook: one to three months ahead\n\n" + box("What and why", [
        "Fire agencies plan weeks ahead. They need to know if the coming months will be worse than normal.",
        "For every country and state we give the chance that fire will be above normal 1, 2 and 3 months ahead.",
        "We use only what is known at the end of the latest month: recent fire, recent rain, temperature, El Niño and the Indian Ocean Dipole.",
        "We test it on blocks of years the model never saw and compare it with the normal chance (the Brier skill score)."])),
    ("code", P3_SETUP + """
from fireharmony import outlook as O
cv_all = pd.read_parquet(K.out('outlook_cv.parquet'))
cv = cv_all[cv_all.in_season]          # the outlook is issued and scored for fire season months only
now = pd.read_parquet(K.out('outlook.parquet'))
summary = json.loads((MODELS / 'outlook.json').read_text())
names = con.execute(f"SELECT kind, id, name FROM read_json_auto('{C.path('products') / 'v1.0' / 'areas.json'}')").df()
print(f"issued from {summary['issued_from']}, {summary['areas']:,} areas")"""),
    ("md", "## 1. Skill on years the model never saw\n\nThe Brier score is the mean squared error of a probability. The Brier skill score compares it with always giving the normal chance of that area and month: 0 means no better, 1 is perfect.\n\n"
           "The outlook is given for months of the fire season only: a target month whose normal fire is at least a fifth of an average month. "
           "Outside the season, above normal turns on a handful of hotspots, and the chances were too sure of themselves. "
           "Areas whose fire is mostly on barren land or ice (gas flares and lava, for example in Svalbard, Iceland and the Algerian Sahara) get no outlook."),
    ("code", "pd.DataFrame(summary['score']).T"),
    ("md", "## 2. Can the chances be trusted?\n\nWhen the outlook says 70%, fire should be above normal in about 7 of 10 such cases. Each point groups forecasts with similar chances."),
    ("code", """cont = cv[cv.kind == 'continent'].groupby(['id', 'lead']).apply(lambda g: O.brier(g)['bss'], include_groups=False).unstack('lead')
cont = cont.drop(index=[i for i in cont.index if i in ('Antarctica', 'Seven seas (open ocean)')], errors='ignore').sort_values(1)
from fireharmony import eda_figures as EF   # the report figures are drawn from the published files, as in the report
print('Brier skill score against a fixed 50% chance:', EF.outlook_skill(fh, FIG / 'fig17_outlook_skill'))
cont.round(3)"""),
    ("md", "## 3. Skill in the places we feature"),
    ("code", """feat = [('country', 'IDN'), ('country', 'MYS'), ('state', 'IDN-1931'), ('state', 'IDN-492'), ('country', 'BRA'), ('country', 'AUS'), ('country', 'CAN'), ('country', 'USA')]
rows = []
for kind, id_ in feat:
    g = cv[(cv.kind == kind) & (cv.id == id_)]
    rows.append({'area': names.set_index(['kind', 'id']).name.get((kind, id_), id_), **{f'{L} month': O.brier(g[g.lead == L])['bss'] for L in O.LEADS}})
pd.DataFrame(rows).set_index('area').round(3)"""),
    ("md", "## 4. What the model uses\n\nThe share of the total gain of each input in the final model."),
    ("code", "pd.Series(summary['feature_gain_pct']).rename('share of gain, %').to_frame()"),
    ("md", "## 5. The outlook now"),
    ("code", """sel = now.merge(names, on=['kind', 'id'], how='left')
sel = sel[sel.set_index(['kind', 'id']).index.isin(feat)]
sel.pivot_table(index='name', columns='lead', values=['p', 'p_clim']).round(2)"""),
    ("md", box("Key findings", [
        "In the fire season months where it is given, the outlook beats the normal chance by 26% one month ahead, 19% two months ahead and 17% three months ahead (Brier skill score, years the model never saw). On the latest years (2022 to 2025) it scores 0.24 over the three leads.",
        "It works almost everywhere: more than 99% of areas beat the normal chance at every lead.",
        "Skill is highest where El Niño and drought drive fire: one month ahead it is 0.58 in Central Kalimantan, 0.53 in Indonesia, 0.48 in Malaysia and 0.45 in Brazil. It is lowest in Africa (0.11), where the savanna burns in much the same way every year.",
        "The chances can be trusted across the whole range: when the outlook says 74%, fire comes out above normal 74% of the time, and when it says 17%, 15% of the time.",
        "This needed one rule: the outlook is for months of the fire season only (a month whose normal fire is at least a fifth of an average month). In the deep off season, above normal turns on a handful of hotspots, and there the chances were too sure of themselves.",
        "Recent fire is the strongest clue (42% of the gain), then how much of the year's fire the target month holds, the Indian Ocean Dipole and El Niño (9% each).",
        "From the data to October 2026: Indonesia has an 84% chance of above normal fire in November (the normal chance is 46%), and Central Kalimantan 80%. Malaysia (18%) is likely to stay below normal."])),
])

nb("10_haze_link", [
    ("md", "# 10 · Haze: smoke from fires upwind\n\n" + box("What and why", [
        "Smoke from Sumatra and Borneo crosses borders. In bad years it closes schools and airports in Malaysia and Singapore.",
        "For eight cities we ask how much of the fine particle pollution (PM2.5) in the fire season comes from fires in each source region.",
        "Smoke adds up, so the model is simple: a normal level for the month plus an amount for every 1,000 hotspots in Sumatra and in Borneo.",
        "We fit it on 2002 to 2025 with NASA's bias corrected MERRA-2 PM2.5 and test it on years left out."])),
    ("code", P3_SETUP + """
hz = json.loads((MODELS / 'haze.json').read_text())
h = pd.read_parquet(K.out('haze_city_month.parquet'))
season = h[h.mo.between(*hz['season_months'])]"""),
    ("md", "## 1. The model of each city"),
    ("code", """rows = []
for c, m in hz['cities'].items():
    s = season[(season.city == c) & season.yr.between(*hz['fit_years'])]
    k = m['ug_per_1000_hotspots']
    smoke_s, smoke_b = (k['sumatra'] * s.sumatra).sum(), (k['borneo'] * s.borneo).sum()
    rows.append({'city': c, 'R2 on years left out': m['r2_cv'], 'ug/m3 per 1,000 hotspots, Sumatra': k['sumatra'],
                 'ug/m3 per 1,000 hotspots, Borneo': k['borneo'], 'smoke share from Sumatra': smoke_s / max(smoke_s + smoke_b, 1e-9),
                 'mean PM2.5 Jul to Nov': s.pm25_cnn.mean()})
pd.DataFrame(rows).set_index('city').round(3)"""),
    ("md", "## 2. Kuala Lumpur, every fire season"),
    ("code", """from fireharmony import eda_figures as EF   # the report figures are drawn from the published files, as in the report
print(EF.haze_kuala_lumpur(fh, FIG / 'fig18_haze_kuala_lumpur'))   # seasons of August to October, from haze.parquet"""),
    ("md", "## 3. Three fire seasons compared: 2015, 2019 and 2026"),
    ("code", """cmp = season[season.yr.isin([2015, 2019, 2026]) & season.mo.between(8, 10)]
cmp.pivot_table(index='city', columns='yr', values=['pm25_cnn', 'pm25_model', 'smoke_model'], aggfunc='mean').round(1)"""),
    ("code", """season[season.yr.isin([2015, 2019, 2026]) & (season.city == 'Kuala Lumpur')][['yr', 'mo', 'sumatra', 'borneo', 'pm25_cnn', 'pm25_model', 'pm25_merra2', 'days_over_who', 'days_over_50']].round(1)"""),
    ("md", box("Key findings", [
        "Fires upwind explain 51 to 92% of the ups and downs of fire season PM2.5 in the eight cities, on years left out.",
        "Kuala Lumpur breathes Sumatra: 88% of its smoke from fires comes from there. Johor Bahru and Singapore get both (42% from Sumatra, 58% from Borneo). Kuching and Palangka Raya get only Borneo smoke.",
        "Every 1,000 more hotspots in Sumatra add about 0.22 micrograms per cubic metre to the monthly mean in Kuala Lumpur.",
        "In September and October 2015, smoke added about 23 micrograms per cubic metre to Kuala Lumpur's monthly mean, and the city had 28 days above the WHO daily guideline in each month.",
        "In 2026 the fires burned mostly in Borneo. Kuala Lumpur's smoke from August to October (7 micrograms per cubic metre) stayed below 2019 (8) and far below 2015 (18). Palangka Raya (22) came close to 2015 (25).",
        "For 2026 there is no bias corrected PM2.5 yet. Uncorrected MERRA-2 also shows less haze in Kuala Lumpur in September 2026 (38) than in 2015 (65) and 2019 (73)."])),
])

nb("04_calibration_tiles_physics", [
    ("md", "# 04 · Why VIIRS sees more fire: a pixel by pixel check\n\n" + box("What and why", [
        "VIIRS records about six times more hotspots than MODIS. Here we look at why, pixel by pixel.",
        "On 10 test tiles for all of 2019, we place every Suomi NPP 375 m hotspot on the 1 km MODIS grid and ask: did MODIS see it too?",
        "Aqua passes at the same hours as Suomi NPP (about 13:30 and 01:30), so it is the fair comparison. Terra passes three hours earlier.",
        "We split the answer by fire strength (FRP), day and night, and cloud. This physics is what the exchange rate in the model has to learn."])),
    ("code", SETUP + """
from fireharmony import physics as PH
pts = pd.read_parquet(PH.out('viirs_points_2019.parquet'))
print(f"{len(pts):,} Suomi NPP hotspots on the 10 tiles in 2019")"""),
    ("md", "## 1. The tiles\n\nEach MODIS tile is about 1,100 by 1,100 km. Where they are, and how many VIIRS hotspots each one had."),
    ("code", """tiles = pts.groupby('tile').agg(points=('frp', 'size'), lat=('lat', 'median'), lon=('lon', 'median'),
                                 weak_share=('frp', lambda f: (f < 5).mean()), clear_share=('aqua_view', lambda v: (v == 0).mean()))
tiles.round(3)"""),
    ("md", "## 2. How often MODIS sees a VIIRS fire\n\nOnly hotspots where the MODIS cell had a clear view that day count here (no cloud, no missing data)."),
    ("code", """rows = []
for sat in ('aqua', 'terra'):
    clear = pts[pts[f'{sat}_view'] == 0]
    for dn, g in clear.groupby('daynight'):
        rows.append({'MODIS': sat.title(), 'pass': {'D': 'day', 'N': 'night'}[dn], 'VIIRS hotspots': len(g), 'share seen by MODIS': g[f'{sat}_seen'].mean()})
pd.DataFrame(rows).set_index(['MODIS', 'pass']).round(3)"""),
    ("md", "## 3. The detection curve\n\nThe chance that Aqua sees a VIIRS fire, by the fire radiative power (FRP) that VIIRS measured. Strong fires are almost always seen; weak fires mostly are not. "
           "The weakest group (below 1 MW) comes out a little higher than the next one: weak hotspots at the edge of a big fire count as seen when MODIS sees the big fire in the next cell."),
    ("code", """bins = [0, 1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 100, 200, 1e6]
mid = [0.7, 1.4, 2.4, 3.9, 5.9, 8.4, 12, 17, 24, 39, 71, 141, 300]
curves = {}
for sat in ('aqua', 'terra'):
    clear = pts[pts[f'{sat}_view'] == 0].copy()
    clear['bin'] = pd.cut(clear.frp, bins, right=False, labels=mid)
    for dn in ('D', 'N'):
        g = clear[clear.daynight == dn].groupby('bin', observed=True)[f'{sat}_seen'].agg(['mean', 'size'])
        curves[(sat, dn)] = g[g['size'] >= 200]
from fireharmony import eda_figures as EF   # the report figures are drawn from the published files, as in the report
EF.modis_detection(fh, FIG / 'fig19_modis_detection_curve')   # day and night in two panels, from dashboard.json
def half_point(g):
    x, y = np.log(np.array(g.index, dtype=float)), g['mean'].to_numpy()
    k = np.argmax(y >= 0.5)
    return float(np.exp(np.interp(0.5, y[k - 1:k + 1], x[k - 1:k + 1]))) if y.max() >= 0.5 and k > 0 else None
print({f'{s} {d}': half_point(g) for (s, d), g in curves.items()})
pd.DataFrame({f'{s} {d}': g['mean'] for (s, d), g in curves.items()}).round(3)"""),
    ("md", "## 4. Cloud\n\nMODIS cannot see a fire through cloud. How often was the MODIS cell cloudy, or had no data, when VIIRS saw a fire?"),
    ("code", """v = pts.aqua_view.map({0: 'clear', 1: 'cloud', 2: 'no data', -1: 'no file'}).value_counts(normalize=True)
v.round(3).rename('share of VIIRS hotspots (Aqua cell)').to_frame()"""),
    ("md", "## 5. What this means for the exchange rate\n\nTiles with many weak fires need a bigger exchange rate: for every hotspot Aqua sees, VIIRS sees more."),
    ("code", """t = pts[pts.aqua_view == 0].groupby('tile').agg(weak_share=('frp', lambda f: (f < 5).mean()), seen=('aqua_seen', 'mean'), n=('frp', 'size'))
t['VIIRS per hotspot Aqua sees'] = 1 / t.seen
print(f"correlation of weak share with the exchange rate across tiles: {t.weak_share.corr(t['VIIRS per hotspot Aqua sees']):.2f}")
t.sort_values('weak_share').round(3)"""),
    ("md", box("Key findings", [
        "On a clear day, Aqua MODIS sees 44% of the fires that Suomi NPP VIIRS sees at the same hour (46% at night). Terra, three hours earlier, sees only 25% by day.",
        "Strong fires are almost always seen: above 100 MW, Aqua sees 81 to 85% of them by day and 97% at night. Weak fires are mostly missed: by day the chance reaches one in two only at about 10 MW.",
        "At night MODIS sees weak fires much better (half of them at about 2 MW), because the cool ground makes a small fire stand out.",
        "Cloud is a small part of the story: the Aqua cell was cloudy for only 1.4% of VIIRS fires, because both satellites look at the same sky.",
        "Where more fires are weak, the exchange rate is higher (r = 0.65 across the 10 tiles). In central India, where 73% of VIIRS fires are below 5 MW, VIIRS records 6.5 fires for every one Aqua sees. In Siberia it is 1.3.",
        "The rest of the six times gap is pixel size: one MODIS 1 km pixel covers about seven VIIRS 375 m pixels, so one fire can give several VIIRS hotspots. This is why the model uses how many small cells MODIS saw burning, and not only the count."])),
])
