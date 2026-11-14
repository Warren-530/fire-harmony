// Data: where the data comes from, how to cite it, the months it covers, every published file (with its size and a
// download link), what the columns mean, and how to query the files yourself. The English text lives here.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Card, DataTable, Grid, Note, Page, PageHeader, Section, Skeleton, StatGrid, StatTile, type Column } from '../components/ui';
import { IconBook, IconChart, IconDownload, IconExternal, IconReport } from '../components/icons';
import { useToast } from '../components/Toast';
import { CodeBlock, type CodeSample } from '../components/pages/CodeBlock';
import { CopyButton } from '../components/pages/Copy';
import { DocLayout, type DocSection } from '../components/pages/DocLayout';
import { CellLabel, Facts, Problem, SourceBar } from '../components/pages/parts';
import { recordPeriods } from '../components/pages/record';
import { SortTable, type SortColumn } from '../components/pages/SortTable';
import { WebFilesSection } from '../components/pages/WebFiles';
import { addMonths, count, fileSize, int, monthName, TOTALS } from '../components/pages/format';
import { Hint } from '../components/dashboard/parts';
import { BASE_YEARS, PROJECT_LINKS, dataUrl, downloadUrl } from '../lib/config';
import { loadAreas, loadDashboard, loadMeta } from '../lib/data';
import { citation, FIRMS_ACKNOWLEDGEMENT } from '../lib/i18n';
import type { DashboardData } from '../lib/dashboard-types';
import type { Meta } from '../lib/types';
import '../styles/pages.css';

const SECTIONS: DocSection[] = [
  { id: 'at-a-glance', label: 'At a glance' },
  { id: 'sources', label: 'Sources and licences' },
  { id: 'cite', label: 'How to cite' },
  { id: 'months', label: 'Months covered' },
  { id: 'files', label: 'Published files' },
  { id: 'app-files', label: 'The app’s files' },
  { id: 'columns', label: 'Columns' },
  { id: 'use', label: 'Use the data yourself' },
];

// ------------------------------------------------------------------------------------------------ sources

interface Source { id: string; name: string; detail: string; url: string; what: string; why: string; licence: string }

const SOURCES: Source[] = [
  { id: 'firms', name: 'NASA FIRMS', detail: 'MODIS C6.1 and VIIRS 375 m active fires', url: 'https://www.earthdata.nasa.gov/data/tools/firms',
    what: 'Fire hotspots from MODIS Collection 6.1 (Terra, Aqua) and VIIRS 375 m (Suomi NPP, NOAA‑20, NOAA‑21)',
    why: 'The fires: every number in this app', licence: 'Free and open, no restrictions' },
  { id: 'lpdaac', name: 'NASA LP DAAC', detail: 'MCD12C1 land cover', url: 'https://lpdaac.usgs.gov/',
    what: 'MCD12C1 land cover; MODIS and VIIRS daily fire maps and burned area for checks',
    why: 'Land cover facts for the model, and checks', licence: 'Free and open, no restrictions' },
  { id: 'gesdisc', name: 'NASA GES DISC', detail: 'MERRA‑2 and GPM IMERG', url: 'https://disc.gsfc.nasa.gov/',
    what: 'MERRA‑2 weather and aerosols, bias corrected PM2.5 (MERRA‑2 CNN), and GPM IMERG rain',
    why: 'Drivers of unusual months, the outlook and the haze link', licence: 'Free and open, no restrictions' },
  { id: 'gfwed', name: 'NASA GISS GFWED', detail: 'Global Fire Weather Database', url: 'https://data.giss.nasa.gov/impacts/gfwed/',
    what: 'The fire weather index, computed from MERRA‑2', why: 'Fire weather next to each month', licence: 'Free and open, no restrictions' },
  { id: 'sedac', name: 'NASA SEDAC GPW', detail: 'Gridded Population of the World, version 4', url: 'https://sedac.ciesin.columbia.edu/data/collection/gpw-v4',
    what: 'Population density, 2020', why: 'How many people live near fire', licence: 'CC BY 4.0' },
  { id: 'firecci', name: 'ESA Fire_cci', detail: 'Burned area', url: 'https://climate.esa.int/en/projects/fire/',
    what: 'Burned area grids', why: 'An independent check of the harmonized record', licence: 'ESA CCI terms: free, please cite' },
  { id: 'peatmap', name: 'PEATMAP', detail: 'University of Leeds', url: 'https://archive.researchdata.leeds.ac.uk/251/',
    what: 'Global peatland map (Xu and others, 2018)', why: 'Peat facts for the model', licence: 'CC BY 4.0' },
  { id: 'gihs', name: 'GIHS', detail: 'Global industrial heat sources, on Zenodo', url: 'https://zenodo.org/records/20960492',
    what: 'Industrial heat sources, 2000 to 2023 (Ma and Wang)', why: 'Removing heat that is not fire', licence: 'CC BY 4.0' },
  { id: 'naturalearth', name: 'Natural Earth', detail: 'Borders', url: 'https://www.naturalearthdata.com/',
    what: 'Country and state borders', why: 'Finding places by name', licence: 'Public domain' },
  { id: 'noaa', name: 'NOAA climate indices', detail: 'ONI and DMI', url: 'https://psl.noaa.gov/data/climateindices/',
    what: 'El Niño (ONI) and Indian Ocean Dipole (DMI) indices', why: 'Drivers of unusual months and the outlook', licence: 'Public domain' },
  { id: 'basemap', name: 'OpenFreeMap', detail: 'With OpenStreetMap data', url: 'https://openfreemap.org/',
    what: 'Base map tiles', why: 'The map background', licence: 'ODbL, © OpenStreetMap contributors' },
];

const sourceColumns: Column<Source>[] = [
  { key: 'name', label: 'Source', render: (s) => (
    <span className="fh-dt-source">
      <a className="fh-dt-source-name" href={s.url} target="_blank" rel="noreferrer">
        {s.name}<IconExternal size={12} /><span className="sr-only"> (opens in a new tab)</span>
      </a>
      <span className="fh-dt-source-detail">{s.detail}</span>
    </span>) },
  // On a phone the table becomes one card per source; each cell then names its column (hidden on wide screens).
  { key: 'what', label: 'What we use', render: (s) => <><CellLabel>What we use</CellLabel>{s.what}</> },
  { key: 'why', label: 'Why', render: (s) => <><CellLabel>Why</CellLabel>{s.why}</> },
  { key: 'licence', label: 'Licence', render: (s) => <><CellLabel>Licence</CellLabel>{s.licence}</> },
];

// ------------------------------------------------------------------------------------------------ files

/** File names inside a sentence in the number font, so "map_l3" never reads as "map_I3". */
function withCode(text: string): ReactNode {
  const parts = text.split(/(\b(?:map|cell|clim)_l\d\b|\b(?:[a-z0-9_]+\/)?[a-z_]+\.(?:json|parquet)\b)/);
  return parts.length === 1 ? text : parts.map((p, i) => (i % 2 ? <code key={i} className="fh-dt-inline">{p}</code> : p));
}

interface FileRow {
  key: string; file: string; link: string | null; what: string; rows: number | null; bytes: number | null;
  rowsLabel?: string;
  pending?: boolean;          // a JSON file whose size is still being measured
}

// Folders (l5/, hotspots/) have no single file to download: their index lists the files.
const FILES: { key: string; file: string; what: string; json?: boolean; folder?: boolean }[] = [
  { key: 'meta', file: 'meta.json', what: 'Version, months covered, satellites, sources and the 90% range tables. Read this first.', json: true },
  { key: 'areas', file: 'areas.json', what: 'Every named place: continents, countries and states, with their size and centre.', json: true },
  { key: 'area_monthly', file: 'area_monthly.parquet', what: 'The monthly series of every named place, and of the world.' },
  { key: 'map_l3', file: 'map_l3.parquet', what: 'The map of each month in large hexagons (about 12,400\u00a0km²).' },
  { key: 'map_l4', file: 'map_l4.parquet', what: 'The map of each month in medium hexagons (about 1,800\u00a0km²).' },
  { key: 'clim_l3', file: 'clim_l3.parquet', what: 'The normal of each large hexagon for each calendar month, 2001 to 2025.' },
  { key: 'clim_l4', file: 'clim_l4.parquet', what: 'The normal of each medium hexagon for each calendar month, 2001 to 2025.' },
  { key: 'cell_l3', file: 'cell_l3.parquet', what: 'The same values as map_l3, sorted by hexagon, for drawn areas.' },
  { key: 'cell_l4', file: 'cell_l4.parquet', what: 'The same values as map_l4, sorted by hexagon, for drawn areas.' },
  { key: 'l5', file: 'l5/', what: 'Full detail: small hexagons (about 250\u00a0km²), one file per large region. meta.json lists them.', folder: true },
  { key: 'cells', file: 'cells.parquet', what: 'Facts for each small hexagon: country, state, biome, land cover, peat and people.' },
  { key: 'drivers', file: 'drivers.parquet', what: 'The drivers of every month of every named place: rain, heat, El Niño and fire weather.' },
  { key: 'drivers_models', file: 'drivers_models.parquet', what: 'How well the drivers explain the fire of each named place.' },
  { key: 'outlook', file: 'outlook.parquet', what: 'The outlook: the chance of above normal fire in each of the next three months.' },
  { key: 'haze', file: 'haze.parquet', what: 'Monthly PM2.5 and smoke from fires at each city of the haze link.' },
  { key: 'haze_json', file: 'haze.json', what: 'The haze model of each city.', json: true },
  { key: 'dashboard', file: 'dashboard.json', what: 'Every headline number of the Dashboard and Methods pages.', json: true },
  { key: 'hotspots_index', file: 'hotspots/index.json', what: 'The hotspot file of each region, with its rows and size.', json: true },
  { key: 'hotspots', file: 'hotspots/', what: 'Every NASA FIRMS hotspot of the five satellites, one file per region of about 600,000\u00a0km², sorted by date. hotspots/index.json lists them.', folder: true },
];

interface FileFacts { file?: unknown; rows?: unknown; mb?: unknown; gb?: unknown; places?: unknown; files?: unknown; regions?: unknown }
const asNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The rows of the files table. `sizes` holds the measured JSON sizes, null while they load. */
function fileRows(meta: Meta, sizes: Record<string, number> | null): FileRow[] {
  const files = meta.files as unknown as Record<string, FileFacts | undefined>;
  const regions = asNum(files.hotspots?.regions);
  return FILES.map((f) => {
    const m = files[f.key];
    const gb = asNum(m?.gb);
    const mb = asNum(m?.mb) ?? (gb !== null ? gb * 1e3 : null);
    const bytes = mb !== null ? mb * 1e6 : sizes?.[f.file] ?? null;
    const pending = bytes === null && Boolean(f.json) && sizes === null;
    if (f.folder) {
      const n = asNum(m?.files) ?? asNum(m?.regions);
      return { key: f.key, file: n !== null ? `${f.file} (${int(n)} files)` : f.file, link: null, what: f.what, rows: asNum(m?.rows), bytes };
    }
    const places = asNum(m?.places);
    const listed = f.key === 'hotspots_index' ? regions : null;
    return {
      key: f.key, file: f.file, link: downloadUrl(f.file), what: f.what, bytes, pending,
      rows: places ?? listed ?? asNum(m?.rows),
      rowsLabel: places !== null ? `${int(places)} places` : listed !== null ? `${int(listed)} regions` : undefined,
    };
  });
}

/**
 * Sizes of the JSON files, which meta.json does not list, measured once the page has drawn. They are small, and the
 * app has read meta.json and dashboard.json already, so most come from the browser cache. Null while they load; a
 * file that cannot be read is left out, and the table then shows a dash.
 */
function useJsonSizes(ready: boolean): Record<string, number> | null {
  const [sizes, setSizes] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const load = () => {
      const names = FILES.filter((f) => f.json).map((f) => f.file);
      void Promise.allSettled(names.map(async (n) => {
        const r = await fetch(dataUrl(n), { cache: 'force-cache' });
        if (!r.ok) return null;
        return [n, (await r.arrayBuffer()).byteLength] as const;
      })).then((res) => {
        if (!alive) return;
        const out: Record<string, number> = {};
        for (const x of res) if (x.status === 'fulfilled' && x.value) out[x.value[0]] = x.value[1];
        setSizes(out);
      });
    };
    // when the browser is idle, so the page draws first (a short timer where there is no idle callback, as in Safari)
    const idle = typeof window.requestIdleCallback === 'function';
    const handle = idle ? window.requestIdleCallback(load, { timeout: 2000 }) : window.setTimeout(load, 300);
    return () => {
      alive = false;
      if (idle) window.cancelIdleCallback(handle); else window.clearTimeout(handle);
    };
  }, [ready]);
  return sizes;
}

// ------------------------------------------------------------------------------------------------ columns and code

const COLUMNS: { name: string; text: string; files: string }[] = [
  { name: 'yr, mo', text: 'Year and month, in local solar time.', files: 'All monthly files' },
  { name: 'h', text: 'Harmonized hotspots per month, on the NOAA‑20 VIIRS scale.', files: 'area_monthly, map, cell, l5' },
  { name: 'modis', text: 'The same on the MODIS scale: one satellite, the average of Terra and Aqua.', files: 'area_monthly, map, cell, l5' },
  { name: 't, a, s, n, j', text: 'Raw detections of Terra, Aqua, Suomi NPP, NOAA‑20 and NOAA‑21.', files: 'area_monthly, map, cell, l5' },
  { name: 'src', text: 'Where the month comes from: 0 VIIRS observed, 1 model from MODIS Terra + Aqua, 2 model from MODIS Terra only, 3 no data yet. For a group of hexagons, the best of them.', files: 'area_monthly, map, cell, l5' },
  { name: 'h3', text: 'H3 hexagon index as hex text: level 3, 4 or 5.', files: 'map, cell, clim, l5, cells' },
  { name: 'kind, id, name', text: 'The named place: world, continent, country (ISO3 code, for example MYS) or state.', files: 'area_monthly, drivers, outlook' },
  { name: 'median, q25, q75', text: 'The normal for that calendar month over 2001 to 2025, and the middle half of the years.', files: 'clim_l3, clim_l4' },
];
const columnColumns: Column<(typeof COLUMNS)[number]>[] = [
  { key: 'name', label: 'Column', render: (c) => <code className="fh-dt-col">{c.name}</code> },
  { key: 'text', label: 'Meaning', render: (c) => c.text },
  { key: 'files', label: 'In', render: (c) => (
    <><CellLabel>In</CellLabel>{c.files.includes(' ') && !c.files.includes(',') ? c.files : (
      <span className="fh-dt-in">{c.files.split(', ').map((f, i) => <span key={f}>{i ? ', ' : null}<code>{f}</code></span>)}</span>
    )}</>
  ) },
];

/** `value` in a sentence -> the number font, as it is written in a query. */
function ticks(text: string): ReactNode {
  const parts = text.split('`');
  return parts.length === 1 ? text : parts.map((p, i) => (i % 2 ? <code key={i} className="fh-dt-inline">{p}</code> : p));
}

// The hotspot files (fireharmony/hotspots.py): one row per NASA FIRMS hotspot, with the values as they are stored
// (checked with DuckDB against all 781 files: the five satellite names, D/N, low/nominal/high, type 0 to 3 and empty
// exactly in the nrt rows, sp/nrt, time 0 to 2359).
const HOTSPOT_COLUMNS: { name: string; text: string }[] = [
  { name: 'date, time', text: 'The satellite pass in UTC: the date, and the time as HHMM, so `130` is 01:30.' },
  { name: 'lat, lon', text: 'The centre of the hot pixel, in degrees.' },
  { name: 'satellite', text: 'Which satellite saw it: `Terra`, `Aqua`, `Suomi-NPP`, `NOAA-20` or `NOAA-21`.' },
  { name: 'daynight', text: '`D` for a day pass, `N` for a night pass.' },
  { name: 'frp', text: 'Fire radiative power, in megawatts. Empty when the value is corrupt.' },
  { name: 'confidence', text: 'How sure NASA is that the pixel is a fire: `low`, `nominal` or `high`. MODIS gives a percent: below 30 is `low`, 80 or more is `high`.' },
  { name: 'type', text: 'NASA’s label, in science quality data only: `0` vegetation fire, `1` volcano, `2` other static land source, `3` offshore.' },
  { name: 'quality', text: 'Science quality (`sp`) or near real time (`nrt`).' },
  { name: 'h3_5', text: 'The small hexagon (level 5, about 250\u00a0km²), to pick out a named place or a drawn shape.' },
  { name: 'counted', text: '`true` when the harmonized record counts the hotspot: a vegetation fire, not in open water and not low confidence.' },
];
const hotspotColumns: Column<(typeof HOTSPOT_COLUMNS)[number]>[] = [
  { key: 'name', label: 'Column', render: (c) => <code className="fh-dt-col">{c.name}</code> },
  { key: 'text', label: 'Meaning', render: (c) => ticks(c.text) },
];

function samples(): CodeSample[] {
  const url = downloadUrl('area_monthly.parquet');
  return [
    {
      id: 'sql', label: 'DuckDB SQL', lang: 'sql', done: 'SQL copied',
      code: `-- Monthly fire in Riau, Indonesia, on one consistent scale
SELECT yr, mo, round(h) AS hotspots, src
FROM read_parquet('${url}')
WHERE kind = 'state' AND name = 'Riau, Indonesia'
ORDER BY yr, mo;

-- World fire per year, 2001 to 2025
SELECT yr, round(sum(h)) AS hotspots
FROM read_parquet('${url}')
WHERE kind = 'world' AND yr BETWEEN 2001 AND 2025
GROUP BY yr
ORDER BY yr;`,
    },
    {
      id: 'python', label: 'Python', lang: 'python', done: 'Python copied',
      code: `import duckdb  # pip install duckdb pandas

url = "${url}"
riau = duckdb.sql(f"""
    SELECT yr, mo, h AS hotspots, src
    FROM read_parquet('{url}')
    WHERE kind = 'state' AND name = 'Riau, Indonesia'
    ORDER BY yr, mo
""").df()
print(riau.tail(12))`,
    },
  ];
}

// ------------------------------------------------------------------------------------------------ citation

function bibtex(version: string): string {
  return `@misc{fireharmony2026,
  author       = {{Fire Harmony}},
  title        = {One consistent worldwide fire hotspot record from {MODIS} and {VIIRS}},
  year         = {2026},
  note         = {Version ${version}. NASA Space Apps Challenge 2026},
  howpublished = {Built from NASA FIRMS active fire data}
}`;
}

function CiteBox({ version }: { version: string }) {
  const [tab, setTab] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const forms = [
    { id: 'text', label: 'Text', value: citation(version), mono: false },
    { id: 'bibtex', label: 'BibTeX', value: bibtex(version), mono: true },
  ];
  const f = forms[tab] ?? forms[0];
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const n = (tab + step + forms.length) % forms.length;
    setTab(n);
    refs.current[n]?.focus();
  };
  return (
    <div className="fh-cite">
      <div className="fh-code-bar">
        <div className="ui-tabs fh-code-tabs" role="tablist" aria-label="Citation format" onKeyDown={onKey}>
          {forms.map((x, i) => (
            <button key={x.id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" className="ui-tab" id={`${base}-${x.id}`}
              aria-selected={i === tab} aria-controls={`${base}-panel`} tabIndex={i === tab ? 0 : -1} onClick={() => setTab(i)}>
              {x.label}
            </button>
          ))}
        </div>
        <CopyButton text={f.value} done="Citation copied" className="ui-btn-ghost fh-code-copy" ariaLabel={`Copy the citation as ${f.label}`} tip={`Copy the citation as ${f.label}`} />
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-${f.id}`} tabIndex={0}
        className={f.mono ? 'fh-code fh-cite-bib' : 'fh-cite-text'}>
        {f.mono ? <code>{f.value}</code> : <p>{f.value}</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the page

export function DataPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sizes = useJsonSizes(meta !== null);
  useEffect(() => {
    let alive = true;
    loadMeta().then((m) => { if (alive) setMeta(m); }, () => { if (alive) setFailed(true); });
    loadDashboard().then((d) => { if (alive) setDash(d); }, () => undefined);   // the months covered; meta.json is enough
    return () => { alive = false; };
  }, [attempt]);
  return (
    <Page>
      <div className="fh-pg">
      <PageHeader eyebrow="Data" title="Data, files and how to cite"
        lead="Fire Harmony uses only free and open data. Here are the sources and their licences, how to cite this work, the months it covers, and every file the app reads, with a recipe to query them yourself."
        actions={<>
          <a className="ui-btn ui-btn-primary" href={PROJECT_LINKS.report.href} target="_blank" rel="noopener"
            aria-label="Read the full report (PDF, opens in a new tab)"><IconReport size={16} />Read the full report (PDF)</a>
          <a className="ui-btn" href="#/data?section=cite"><IconBook size={16} />How to cite</a>
          <a className="ui-btn ui-btn-ghost" href="#/methods"><IconChart size={16} />How it is made</a>
        </>} />
      <DocLayout page="data" sections={SECTIONS} ready={meta !== null}>
        {meta ? <Body meta={meta} dash={dash} sizes={sizes} />
          : failed ? <Card><Problem text="The list of data files could not be loaded." onRetry={() => { setFailed(false); setAttempt((a) => a + 1); }} /></Card>
            : <><Skeleton height={130} /><Skeleton height={420} /><Skeleton height={260} /></>}
      </DocLayout>
      </div>
    </Page>
  );
}

function Body({ meta, dash, sizes }: { meta: Meta; dash: DashboardData | null; sizes: Record<string, number> | null }) {
  const toast = useToast();
  const rows = useMemo(() => fileRows(meta, sizes), [meta, sizes]);
  const known = rows.filter((r) => r.bytes !== null);
  const total = known.reduce((a, r) => a + (r.bytes ?? 0), 0);
  const l5 = (meta.files.l5?.files ?? 0);
  const topFiles = rows.filter((r) => r.link !== null).length;
  const hotspotFiles = asNum((meta.files as unknown as Record<string, FileFacts | undefined>).hotspots?.regions);
  const fileParts = [`${topFiles} files`, `${int(l5)} detail files`, ...(hotspotFiles !== null ? [`${int(hotspotFiles)} hotspot files`] : [])];
  const fileList = `${fileParts.slice(0, -1).join(', ')} and ${fileParts[fileParts.length - 1]}`;
  // every named place, with the world: the rows of web/places.json (the Rankings page), the same as areas.json and the
  // world (meta.json files.areas.places can count places a release later dropped)
  const [places, setPlaces] = useState<number | null>(null);
  useEffect(() => { loadAreas().then((a) => setPlaces(a.length), () => undefined); }, []);
  const readRows = asNum((meta.files as unknown as Record<string, FileFacts | undefined>).hotspots?.rows);
  const rec = dash?.record;
  const latestFull = rec?.latest_full_month ?? null;
  const firstFull = rec ? addMonths(rec.latest_full_month, -(rec.months - 1)) : null;
  const periods = rec && firstFull !== null ? recordPeriods(meta.satellites, firstFull, rec.latest_full_month, meta.last_month) : [];
  const built = new Date(meta.built_utc);
  const builtText = Number.isNaN(built.getTime()) ? null
    : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(built);

  const fileColumns: SortColumn<FileRow>[] = [
    { key: 'file', label: 'File', sortValue: (r) => r.file, render: (r) => (r.link ? (
      <a className="fh-dt-file" href={r.link} download target="_blank" rel="noreferrer"
        onClick={() => toast(`Downloading ${r.file}${r.bytes !== null ? ` (${fileSize(r.bytes)})` : ''}`, 'info')}>
        <IconDownload size={14} /><span>{r.file}</span>
      </a>
    ) : <span className="fh-dt-file fh-dt-file-folder"><span>{r.file}</span></span>) },
    { key: 'what', label: 'What it holds', render: (r) => withCode(r.what) },
    { key: 'rows', label: 'Rows', num: true, sortValue: (r) => r.rows ?? -1, render: (r) => r.rowsLabel ?? (r.rows === null ? '–' : int(r.rows)) },
    { key: 'size', label: 'Size', num: true, sortValue: (r) => r.bytes ?? -1, render: (r) => (r.bytes !== null ? fileSize(r.bytes) : r.pending ? '…' : '–') },
  ];

  return (
    <>
      <Section id="at-a-glance" title="At a glance" subtitle={`Version ${meta.version}${builtText ? `, built ${builtText}` : ''}.`}>
        <StatGrid>
          <StatTile label="Full months" value={rec ? int(rec.months) : '–'}
            context={firstFull !== null && latestFull !== null ? `${monthName(firstFull)} to ${monthName(latestFull)}.${meta.last_month > latestFull ? ` ${monthName(meta.last_month)} is still filling in.` : ''}` : undefined} />
          <StatTile label={TOTALS.read} value={readRows !== null ? TOTALS.readValue(readRows) : '–'}
            context={<>Every raw hotspot of NASA FIRMS, from five satellites.{readRows !== null && rec ? <> <Hint text={TOTALS.link(TOTALS.readValue(readRows), count(rec.hotspots_total))} /></> : null}</>} />
          <StatTile label={TOTALS.scale} value={rec ? count(rec.hotspots_total) : '–'}
            context={<>The harmonized record: what one NOAA‑20 VIIRS satellite would record.{readRows !== null && rec ? <> <Hint text={TOTALS.link(TOTALS.readValue(readRows), count(rec.hotspots_total))} /></> : null}</>} />
          <StatTile label="Places, with the world" value={places !== null ? int(places) : '–'}
            context="Continents, countries and states, plus the world: every place of the Rankings page." />
          <StatTile label="Data to download" value={known.length ? fileSize(total) : '–'}
            context={`${fileList}, in Parquet and JSON.`} />
        </StatGrid>
      </Section>

      <Section id="sources" title="Sources and licences" subtitle="Only free and open data, mostly from NASA.">
        <Card>
          <div className="fh-dt-sources fh-pg-stack">
            <DataTable columns={sourceColumns} rows={SOURCES} rowKey={(s) => s.id} caption="The data sources of Fire Harmony, what we use from each, why, and its licence" />
          </div>
        </Card>
      </Section>

      <Section id="cite" title="How to cite" subtitle="Please cite Fire Harmony and NASA FIRMS when you use these data or pictures.">
        <Grid cols={2}>
          <Card title="Cite Fire Harmony" subtitle="As text, or as BibTeX for LaTeX">
            <CiteBox version={meta.version} />
          </Card>
          <Card title="Acknowledge NASA FIRMS" subtitle="NASA FIRMS asks every user to add this sentence">
            <div className="fh-cite">
              <div className="fh-code-bar">
                <p className="fh-code-label">Acknowledgement</p>
                <CopyButton text={FIRMS_ACKNOWLEDGEMENT} done="Acknowledgement copied" className="ui-btn-ghost fh-code-copy" ariaLabel="Copy the FIRMS acknowledgement" tip="Copy the FIRMS acknowledgement" />
              </div>
              <blockquote className="fh-dt-quote">{FIRMS_ACKNOWLEDGEMENT}</blockquote>
            </div>
          </Card>
        </Grid>
        <Note>If you use the land cover, peat, population or border facts in cells.parquet, please cite those sources too. The code of Fire Harmony is open source under the Apache 2.0 licence.</Note>
      </Section>

      <Section id="months" title="Months covered" subtitle="Every month of the record, and where it comes from.">
        <Card>
          {periods.length ? <SourceBar periods={periods} /> : <Skeleton height={96} />}
          <div className="fh-pg-divider" />
          <Facts label="Months covered" rows={[
            ['First full month', firstFull !== null ? monthName(firstFull) : '–'],
            ['Latest full month', latestFull !== null ? monthName(latestFull) : '–'],
            ...(latestFull !== null && meta.last_month > latestFull ? [['Still filling in', monthName(meta.last_month)] as [string, string]] : []),
            ['Normal, for comparisons', `${BASE_YEARS[0]} to ${BASE_YEARS[1]}`],
          ]} />
          <Note>The files start in {monthName(meta.first_month)}, which has no data: the archive starts in November 2000. The burning calendar starts in 2001, the first full year. A month that is still filling in has source 3 and shows as no data yet.</Note>
        </Card>
      </Section>

      <Section id="files" title="Published files" subtitle="Open files in Parquet and JSON. Click a column to sort; click a file to download it.">
        <Card>
          <SortTable columns={fileColumns} rows={rows} rowKey={(r) => r.key} stack
            caption="Every file the app reads, what it holds, its rows and its size" />
        </Card>
        <Note>DuckDB, Python and R can read the Parquet files in place, so you only download the parts you need. A hexagon month that is missing from a file had no fire (value 0), except in months with source 3 (no data yet).</Note>
      </Section>

      <Section id="app-files" title="The app’s own files" subtitle="Small JSON files the app reads first, so a page opens without a database, and one archive of them all. Each card lists the fields of its file.">
        <WebFilesSection ready />
      </Section>

      <Section id="columns" title="Columns" subtitle="The record files share one set of names. The hotspot files have their own.">
        <Card>
          <div className="fh-pg-stack">
            <DataTable columns={columnColumns} rows={COLUMNS} rowKey={(c) => c.name} caption="What each column of the record files means" />
          </div>
        </Card>
        {hotspotFiles !== null ? (
          <Card>
            <div className="fh-pg-stack">
              <DataTable columns={hotspotColumns} rows={HOTSPOT_COLUMNS} rowKey={(c) => c.name}
                caption="What each column of the hotspot files means: one row for each NASA FIRMS hotspot" />
            </div>
          </Card>
        ) : null}
      </Section>

      <Section id="use" title="Use the data yourself" subtitle="Query the files straight from the web, with no download step.">
        <Card title="Query the monthly series with DuckDB" subtitle="DuckDB reads only the parts of a Parquet file that a query needs.">
          <CodeBlock samples={samples()} label="Code examples" />
          <Note>Install DuckDB from duckdb.org, or run <code>pip install duckdb</code>. Change the place name to any name in <code>areas.json</code>. Months with <code>src</code> 3 have no data yet.</Note>
        </Card>
      </Section>
    </>
  );
}
