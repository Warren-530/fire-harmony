// Where the data lives. In development the Vite server serves ~/nasa_work/data/products/v1.0 at /data/.
// In production VITE_DATA_URL points at the hosted copy. On GitHub Pages it is "data/", next to the app: DuckDB makes
// many small range reads, and each read through the Hugging Face dataset (a redirect to its CDN) took 1 to 3 s.
export const DATA_URL: string = (import.meta.env.VITE_DATA_URL as string | undefined) ?? '/data/';
// The hotspot files (6.5 GB, only for the hotspot CSV) are too big for GitHub Pages: VITE_HOTSPOTS_URL can point them
// elsewhere (the Hugging Face dataset). Without it they sit under DATA_URL like everything else.
export const HOTSPOTS_URL: string | undefined = (import.meta.env.VITE_HOTSPOTS_URL as string | undefined) || undefined;

export function dataUrl(path: string): string {
  if (HOTSPOTS_URL && path.startsWith('hotspots/')) {
    return new URL(path.slice('hotspots/'.length), new URL(HOTSPOTS_URL, window.location.href)).toString();
  }
  return new URL(path, new URL(DATA_URL, window.location.href)).toString();
}

// Files that are only downloaded, never read by the app (it reads small split copies under web/): on GitHub Pages they
// come from the Hugging Face dataset (VITE_DOWNLOADS_URL), the data's home, which keeps the site small enough to
// publish quickly. The app's own files (meta, areas, haze, dashboard, clim_l4, l5/, web/) stay next to the app.
export const DOWNLOADS_URL: string | undefined = (import.meta.env.VITE_DOWNLOADS_URL as string | undefined) || undefined;
export const DOWNLOAD_ONLY: ReadonlySet<string> = new Set([
  'area_monthly.parquet', 'cells.parquet', 'map_l3.parquet', 'map_l4.parquet', 'cell_l3.parquet', 'cell_l4.parquet',
  'clim_l3.parquet', 'drivers.parquet', 'drivers_models.parquet', 'outlook.parquet', 'haze.parquet',
]);

/** The link to download a published file: the Hugging Face copy for download only files when configured. */
export function downloadUrl(path: string): string {
  if (DOWNLOADS_URL && DOWNLOAD_ONLY.has(path)) return new URL(path, new URL(DOWNLOADS_URL, window.location.href)).toString();
  return dataUrl(path);
}

export const BASE_YEARS: [number, number] = [2001, 2025];  // "normal" years (full years of the harmonized record)
export const FIRST_YEAR = 2001;                             // first full year shown in the calendar (Oct to Dec 2000 is partial)

// Free basemap, no key needed.
/** Base map styles (OpenFreeMap): dark for the dark theme, positron for light. */
export const BASEMAP_STYLES = { dark: 'https://tiles.openfreemap.org/styles/dark', light: 'https://tiles.openfreemap.org/styles/positron' } as const;
export const BASEMAP_STYLE: string = BASEMAP_STYLES.dark;

// Above this many level 5 hexagons, a drawn area is answered from whole level 3 / level 4 parents plus level 5 edges.
export const MAX_L5_CELLS = 20000;

export const SENSOR_COLOURS = {
  MODIS: 'var(--sensor-modis)', VIIRS_SNPP: 'var(--sensor-snpp)', VIIRS_NOAA20: 'var(--sensor-noaa20)', VIIRS_NOAA21: 'var(--sensor-noaa21)',
} as const;

/** The rest of the project, linked from the footer, the page menu, the palette, Methods and Data. The report and the
 *  poster sit next to the app (public/), the hub page too. */
export const PROJECT_LINKS = {
  report: { href: './Fire_Harmony_report.pdf', label: 'Report PDF', note: 'The full method, results and limits', external: true },
  poster: { href: './Fire_Harmony_poster.pdf', label: 'Poster PDF', note: 'The project on one page', external: true },
  code: { href: 'https://github.com/Warren-530/fire-harmony', label: 'Code on GitHub', note: 'The pipeline and this app', external: true },
  dataset: { href: 'https://huggingface.co/datasets/warrensaw530/fire-harmony', label: 'Dataset on Hugging Face', note: 'Every published file', external: true },
  hub: { href: './hub.html', label: 'About the project', note: 'The project at a glance, with every link', external: false },
} as const;
export type ProjectLinkKey = keyof typeof PROJECT_LINKS;
export const PROJECT_ORDER: readonly ProjectLinkKey[] = ['report', 'poster', 'code', 'dataset', 'hub'];
// The relay of the "Ask" assistant (assistant/apps_script.gs, a Google Apps Script web app that keeps the Gemini key). Unset: no
// Ask button at all, so turning the assistant off is one build variable.
export const ASSISTANT_URL: string = (import.meta.env.VITE_ASSISTANT_URL as string | undefined) || '';
