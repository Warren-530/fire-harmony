// The Rankings page's data: every place of web/places.json (built by fireharmony/webfiles.py), with the words the
// page shows for each (its own name, where it is, the class of its trend), the filters and the order kept in the
// link (#/rankings?kind=state&country=IDN&sort=trend-asc), and the CSV of the current view. Pure functions, tested in
// model.test.ts.
import { normalise } from '../../lib/search';

export type Kind = 'world' | 'continent' | 'country' | 'state';

/** One row of web/places.json. Counts are harmonized hotspots (NOAA-20 VIIRS scale); means are 2001 to 2025. */
export interface PlaceRow {
  kind: Kind; id: string; name: string; iso3: string | null; continent: string | null; area_km2: number | null;
  mean_per_year: number | null; cv: number | null; record_year: number | null; record_total: number | null;
  trend_pct_per_decade: number | null; trend_p: number | null; trend: string | null;
  latest_ym: number | null; latest: number | null; latest_normal: number | null; latest_ratio: number | null;
  latest_rank: number | null; latest_years: number | null;
  ytd: number | null; ytd_normal: number | null; ytd_ratio: number | null;
  peak_month: number | null; critical_months: number[] | null; share_pct: number | null;
  outlook_p: number | null; outlook_p_clim: number | null; outlook_target: number | null; outlook_bss: number | null;
  drivers_r2: number | null; trend_tested: boolean; trend_q: number | null; barren_pct: number | null;
  local_name?: string | null;   // a state's local name, where its English name replaced it (lib/names.ts, as the file loads)
}

export interface PlacesFile {
  version: number;
  latest_month: number;
  rows: PlaceRow[];
  trend_rule?: { place_floor_per_year: number; max_barren_share: number; adjustment: string };
}

/** How a trend reads: rising or falling (and the result holds), not clear, not tested, or no trend at all. */
export type TrendClass = 'rising' | 'falling' | 'unclear' | 'untested' | 'none';

/** A row with what the page needs to show, filter and sort it. */
export interface Ranked extends PlaceRow {
  key: string;            // "state:IDN-492"
  own: string;            // "Riau" (a state without its country)
  country: string | null; // "Indonesia" (for states)
  where: string;          // "State in Indonesia", "Country in Asia", "Continent", "Whole world"
  trendClass: TrendClass;
  untestedWhy: 'little' | 'barren' | null;
  farAbove: boolean;
  text: string;           // folded words the text filter looks in
}

/** The least fire a year for a trend to be tested, and the most bare ground (the rule in fireharmony/trendflags.py). */
export const TEST_FLOOR = 1000;
export const BARREN_MAX = 50;
/** "Far above normal now": at least this many times a normal month, where a normal month has at least FAR_MIN_NORMAL. */
export const FAR_RATIO = 2;
export const FAR_MIN_NORMAL = 50;
/** A ratio against fewer normal hotspots than this is shown, but sorted after the others (a few fires in a quiet
 *  place make huge ratios). */
export const SMALL_NORMAL = 10;

const KIND_WORD: Record<Kind, string> = { world: 'Whole world', continent: 'Continent', country: 'Country', state: 'State' };

/** The class of a place's trend (also used by the dashboard, so both pages give a place the same verdict). */
export function trendClassOf(r: PlaceRow): { cls: TrendClass; why: Ranked['untestedWhy'] } {
  const v = r.trend_pct_per_decade;
  if (v === null || r.trend === null || r.trend === 'not enough data') return { cls: 'none', why: null };
  const dir: TrendClass = v > 0 ? 'rising' : 'falling';
  if (r.kind === 'world' || r.kind === 'continent') {
    // the world and the continents are tested one by one, not in the family of all places, with the same floor of
    // fire as every named place (Antarctica's few hotspots are not a trend; the Explorer uses the same rule)
    if ((r.mean_per_year ?? 0) < TEST_FLOOR) return { cls: 'untested', why: 'little' };
    return { cls: r.trend_p !== null && r.trend_p < 0.05 ? dir : 'unclear', why: null };
  }
  if (!r.trend_tested) {
    const little = (r.mean_per_year ?? 0) < TEST_FLOOR;
    return { cls: 'untested', why: little ? 'little' : 'barren' };
  }
  return { cls: r.trend_q !== null && r.trend_q <= 0.05 ? dir : 'unclear', why: null };
}

/** The page's rows, from the file's rows (the order of the file is kept). */
export function rankRows(rows: readonly PlaceRow[]): Ranked[] {
  const countryName = new Map<string, string>();
  for (const r of rows) if (r.kind === 'country' && r.iso3) countryName.set(r.iso3, r.name);
  return rows.map((r) => {
    const name = r.kind === 'world' ? 'World' : (r.name || r.id).trim();
    const country = r.kind === 'state' && r.iso3 ? countryName.get(r.iso3) ?? null : null;
    const cut = name.lastIndexOf(', ');
    const own = r.kind === 'state' && cut > 0 ? name.slice(0, cut) : name;
    const where = r.kind === 'state' ? `State in ${country ?? (cut > 0 ? name.slice(cut + 2) : r.iso3 ?? '')}`
      : r.kind === 'country' ? (r.continent ? `Country in ${r.continent}` : 'Country') : KIND_WORD[r.kind];
    const { cls, why } = trendClassOf(r);
    const farAbove = r.latest_ratio !== null && r.latest_ratio >= FAR_RATIO && (r.latest_normal ?? 0) >= FAR_MIN_NORMAL;
    const text = normalise([own, name, country ?? '', r.iso3 ?? '', r.id, r.local_name ?? ''].join(' '));
    return { ...r, name, key: `${r.kind}:${r.id}`, own, country, where, trendClass: cls, untestedWhy: why, farAbove, text };
  });
}

// ------------------------------------------------------------------------------------------------ filters and order

export type SortKey = 'name' | 'mean' | 'share' | 'trend' | 'latest' | 'ytd' | 'record' | 'peak' | 'outlook';
export type Dir = 'asc' | 'desc';
export type MinFire = 0 | 100 | 1000 | 10000;

export interface Filters {
  kind: Kind | 'all';
  continent: string;      // 'all' or a continent name
  country: string;        // 'all' or an ISO3 code (the states of one country)
  trend: TrendClass | 'all';
  now: 'all' | 'above';
  min: MinFire;           // the least fire a year
  q: string;              // text
  sort: SortKey;
  dir: Dir;
}

export const DEFAULT_FILTERS: Filters = {
  kind: 'country', continent: 'all', country: 'all', trend: 'all', now: 'all', min: 0, q: '', sort: 'mean', dir: 'desc',
};

const KINDS: readonly (Kind | 'all')[] = ['all', 'world', 'continent', 'country', 'state'];
const TRENDS: readonly (TrendClass | 'all')[] = ['all', 'rising', 'falling', 'unclear', 'untested', 'none'];
const SORTS: readonly SortKey[] = ['name', 'mean', 'share', 'trend', 'latest', 'ytd', 'record', 'peak', 'outlook'];
const MINS: readonly MinFire[] = [0, 100, 1000, 10000];

/** The first direction of a column: numbers from the most, names and months from the start. */
export const FIRST_DIR: Record<SortKey, Dir> = {
  name: 'asc', mean: 'desc', share: 'desc', trend: 'desc', latest: 'desc', ytd: 'desc', record: 'desc', peak: 'asc', outlook: 'desc',
};

/** Filters from the link ("#/rankings?kind=state&country=IDN&sort=trend-asc"); anything unknown keeps its default. */
export function filtersFromHash(hash: string): Filters {
  const q = new URLSearchParams(hash.split('?')[1] ?? '');
  const f: Filters = { ...DEFAULT_FILTERS };
  const kind = q.get('kind');
  if (kind && (KINDS as readonly string[]).includes(kind)) f.kind = kind as Filters['kind'];
  const continent = q.get('continent');
  if (continent) f.continent = continent;
  const country = q.get('country');
  if (country && /^[A-Za-z]{3}$/.test(country)) f.country = country.toUpperCase();
  const trend = q.get('trend');
  if (trend && (TRENDS as readonly string[]).includes(trend)) f.trend = trend as Filters['trend'];
  if (q.get('now') === 'above') f.now = 'above';
  const min = Number(q.get('min'));
  if ((MINS as readonly number[]).includes(min)) f.min = min as MinFire;
  f.q = (q.get('q') ?? '').slice(0, 80);
  const [sort, dir] = (q.get('sort') ?? '').split('-');
  if ((SORTS as readonly string[]).includes(sort)) {
    f.sort = sort as SortKey;
    f.dir = dir === 'asc' || dir === 'desc' ? dir : FIRST_DIR[f.sort];
  }
  return f;
}

/** The link of a view: only what differs from the defaults. */
export function hashOf(f: Filters): string {
  const q = new URLSearchParams();
  if (f.kind !== DEFAULT_FILTERS.kind) q.set('kind', f.kind);
  if (f.continent !== 'all') q.set('continent', f.continent);
  if (f.country !== 'all') q.set('country', f.country);
  if (f.trend !== 'all') q.set('trend', f.trend);
  if (f.now !== 'all') q.set('now', f.now);
  if (f.min) q.set('min', String(f.min));
  if (f.q.trim()) q.set('q', f.q.trim());
  if (f.sort !== DEFAULT_FILTERS.sort || f.dir !== DEFAULT_FILTERS.dir) q.set('sort', `${f.sort}-${f.dir}`);
  const s = q.toString();
  return s ? `#/rankings?${s}` : '#/rankings';
}

/** True when a row passes every filter except the one named in `skip` (for the counts beside each choice). */
export function passes(r: Ranked, f: Filters, words: string[], skip?: keyof Filters): boolean {
  if (skip !== 'kind' && f.kind !== 'all' && r.kind !== f.kind) return false;
  if (skip !== 'continent' && f.continent !== 'all') {
    if (r.kind === 'continent' ? r.id !== f.continent : r.continent !== f.continent) return false;
    if (r.kind === 'world') return false;
  }
  if (skip !== 'country' && f.country !== 'all') {
    if (r.kind === 'world' || r.kind === 'continent') return false;
    if (r.iso3 !== f.country) return false;
  }
  if (skip !== 'trend' && f.trend !== 'all' && r.trendClass !== f.trend) return false;
  if (skip !== 'now' && f.now === 'above' && !r.farAbove) return false;
  if (skip !== 'min' && f.min > 0 && (r.mean_per_year ?? 0) < f.min) return false;
  if (skip !== 'q' && words.length && !words.every((w) => r.text.includes(w))) return false;
  return true;
}

/** The folded words of a text filter. */
export const queryWords = (q: string): string[] => normalise(q).split(' ').filter(Boolean);

/** A ratio whose normal is too small to compare sorts after the others. */
const weak = (normal: number | null): boolean => normal === null || normal < SMALL_NORMAL;

type SortValue = { group: number; v: number | string };

/** What a column sorts by. group 0 sorts first, then 1 (small numbers), then 2 (no value), in either direction. */
export function sortValue(r: Ranked, key: SortKey): SortValue {
  const num = (v: number | null, small = false): SortValue => (v === null || !Number.isFinite(v) ? { group: 2, v: 0 } : { group: small ? 1 : 0, v });
  switch (key) {
    case 'name': return { group: 0, v: normalise(r.own) };
    case 'mean': return num(r.mean_per_year);
    case 'share': return num(r.share_pct);
    case 'trend': return num(r.trend_pct_per_decade);
    case 'latest': return num(r.latest_ratio, weak(r.latest_normal));
    case 'ytd': return num(r.ytd_ratio, weak(r.ytd_normal));
    case 'record': return num(r.record_year);
    case 'peak': return num(r.peak_month);
    case 'outlook': return num(r.outlook_p);
  }
}

const KIND_ORDER: Record<Kind, number> = { world: 0, continent: 1, country: 2, state: 3 };

/** The rows that pass the filters, in the chosen order (ties: more fire first, then the name). */
export function viewOf(rows: readonly Ranked[], f: Filters): Ranked[] {
  const words = queryWords(f.q);
  const out = rows.filter((r) => passes(r, f, words));
  const k = f.dir === 'asc' ? 1 : -1;
  const keyed = out.map((r) => ({ r, s: sortValue(r, f.sort) }));
  keyed.sort((a, b) => {
    if (a.s.group !== b.s.group) return a.s.group - b.s.group;
    const va = a.s.v, vb = b.s.v;
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    if (c !== 0) return c * k;
    const m = (b.r.mean_per_year ?? 0) - (a.r.mean_per_year ?? 0);
    if (m !== 0) return m;
    return KIND_ORDER[a.r.kind] - KIND_ORDER[b.r.kind] || a.r.own.localeCompare(b.r.own);
  });
  return keyed.map((x) => x.r);
}

// ------------------------------------------------------------------------------------------------ quick screens

export interface Screen { id: string; label: string; help: string; set: Partial<Filters> }

/** Ready made screens: each sets a few filters and the order, and keeps the kind of place. */
export const SCREENS: readonly Screen[] = [
  { id: 'most', label: 'Most fire', help: 'The places with the most hotspots a year, 2001 to 2025',
    set: { trend: 'all', now: 'all', min: 0, sort: 'mean', dir: 'desc' } },
  { id: 'rising', label: 'Rising fastest', help: 'Trends that rise, and hold when all places are tested together',
    set: { trend: 'rising', now: 'all', min: 0, sort: 'trend', dir: 'desc' } },
  { id: 'falling', label: 'Falling fastest', help: 'Trends that fall, and hold when all places are tested together',
    set: { trend: 'falling', now: 'all', min: 0, sort: 'trend', dir: 'asc' } },
  { id: 'above', label: 'Far above normal now', help: `At least ${FAR_RATIO} times a normal month in the latest month, where a normal month has ${FAR_MIN_NORMAL} hotspots or more`,
    set: { trend: 'all', now: 'above', min: 0, sort: 'latest', dir: 'desc' } },
  { id: 'ytd', label: 'Busy year so far', help: 'This year so far against the same months in a normal year, among places with 1,000 hotspots a year or more',
    set: { trend: 'all', now: 'all', min: 1000, sort: 'ytd', dir: 'desc' } },
  { id: 'outlook', label: 'Highest chance next month', help: 'The chance of more fire than normal next month, from the outlook model',
    set: { trend: 'all', now: 'all', min: 0, sort: 'outlook', dir: 'desc' } },
];

/** The screen the filters match, if any. */
export function screenOf(f: Filters): string | null {
  for (const s of SCREENS) {
    if ((Object.keys(s.set) as (keyof Filters)[]).every((k) => f[k] === s.set[k])) return s.id;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ words

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (mo: number | null): string => (mo && mo >= 1 && mo <= 12 ? MONTHS[mo - 1] : '');
export const monthYear = (ym: number | null): string => (ym ? `${monthName(ym % 100)} ${Math.floor(ym / 100)}` : '');

export const TREND_WORD: Record<TrendClass, string> = {
  rising: 'Rising', falling: 'Falling', unclear: '', untested: '', none: '',
};

/** The verdict under a trend: "Holds when all places are tested", "Not clear", "Too little fire to test". */
export function trendVerdict(r: Pick<Ranked, 'kind' | 'trendClass' | 'untestedWhy' | 'trend_p'>): string {
  if (r.trendClass === 'untested') return r.untestedWhy === 'barren' ? 'Mostly heat from bare ground, not tested' : 'Too little fire to test';
  if (r.trendClass === 'none') return 'Too few years for a trend';
  if (r.trendClass === 'unclear') {
    const alone = r.kind !== 'world' && r.kind !== 'continent' && r.trend_p !== null && r.trend_p < 0.05;
    return alone ? 'Not clear when all places are tested' : 'Not clear';
  }
  return r.kind === 'world' || r.kind === 'continent' ? 'Clear on its own test' : 'Holds when all places are tested';
}

export const FILTER_WORDS = {
  kind: { all: 'All places', world: 'World', continent: 'Continents', country: 'Countries', state: 'States' } as Record<Kind | 'all', string>,
  trend: { all: 'Any trend', rising: 'Rising, holds', falling: 'Falling, holds', unclear: 'Not clear', untested: 'Not tested', none: 'Too few years' } as Record<TrendClass | 'all', string>,
  min: { 0: 'Any amount', 100: '100 a year or more', 1000: '1,000 a year or more', 10000: '10,000 a year or more' } as Record<MinFire, string>,
};

/** "fire a year, most first" for the summary line. */
export function sortWords(f: Pick<Filters, 'sort' | 'dir'>): string {
  const d = f.dir === 'desc';
  switch (f.sort) {
    case 'name': return d ? 'by name, Z to A' : 'by name, A to Z';
    case 'mean': return d ? 'most fire first' : 'least fire first';
    case 'share': return d ? 'largest share first' : 'smallest share first';
    case 'trend': return d ? 'fastest rising first' : 'fastest falling first';
    case 'latest': return d ? 'most above normal in the latest month first' : 'most below normal in the latest month first';
    case 'ytd': return d ? 'most above normal this year first' : 'most below normal this year first';
    case 'record': return d ? 'latest record year first' : 'earliest record year first';
    case 'peak': return d ? 'peak month from December' : 'peak month from January';
    case 'outlook': return d ? 'highest chance next month first' : 'lowest chance next month first';
  }
}

// ------------------------------------------------------------------------------------------------ CSV

/** "1 state", "12 states". */
export const plural = (n: number, one: string, many: string = `${one}s`): string => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const CSV_COLUMNS: readonly [string, (r: Ranked) => unknown][] = [
  ['kind', (r) => r.kind], ['id', (r) => r.id], ['name', (r) => r.name], ['country_iso3', (r) => r.iso3], ['continent', (r) => r.continent],
  ['hotspots_per_year_2001_2025', (r) => r.mean_per_year], ['share_of_world_pct', (r) => r.share_pct],
  ['trend_pct_per_decade', (r) => r.trend_pct_per_decade], ['trend_p', (r) => r.trend_p], ['trend_q', (r) => r.trend_q],
  ['trend_tested', (r) => (r.kind === 'world' || r.kind === 'continent' ? '' : r.trend_tested ? 'yes' : 'no')],
  ['trend_reading', (r) => (TREND_WORD[r.trendClass] ? `${TREND_WORD[r.trendClass]}: ${trendVerdict(r)}` : trendVerdict(r))],
  ['latest_month', (r) => r.latest_ym], ['latest_hotspots', (r) => r.latest], ['latest_normal', (r) => r.latest_normal],
  ['latest_ratio', (r) => r.latest_ratio], ['latest_rank', (r) => r.latest_rank], ['latest_years_ranked', (r) => r.latest_years],
  ['year_so_far', (r) => r.ytd], ['year_so_far_normal', (r) => r.ytd_normal], ['year_so_far_ratio', (r) => r.ytd_ratio],
  ['record_year', (r) => r.record_year], ['record_year_hotspots', (r) => r.record_total], ['peak_month', (r) => r.peak_month],
  ['outlook_month', (r) => r.outlook_target], ['outlook_chance_above_normal', (r) => r.outlook_p], ['outlook_normal_chance', (r) => r.outlook_p_clim],
];

/** The rows of the view as CSV, with comment lines that say what they are. */
export function rankingsCsv(rows: readonly Ranked[], f: Filters, meta: { version: number | string; latestMonth: number; citation: string; link: string;
  countryName?: string | null }): string {
  const parts = [
    FILTER_WORDS.kind[f.kind],
    f.continent !== 'all' ? `in ${f.continent}` : '',
    f.country !== 'all' ? `in ${meta.countryName ?? f.country}` : '',
    f.trend !== 'all' ? `trend ${FILTER_WORDS.trend[f.trend].toLowerCase()}` : '',
    f.now === 'above' ? 'far above normal now' : '',
    f.min ? FILTER_WORDS.min[f.min] : '',
    f.q.trim() ? `matching "${f.q.trim()}"` : '',
  ].filter(Boolean).join(', ');
  const lines = [
    `# Fire Harmony rankings, data version ${meta.version}: ${rows.length} places (${parts}), ${sortWords(f)}.`,
    '# Counts are harmonized hotspots on the NOAA-20 VIIRS scale. Means and normals use 2001 to 2025.',
    `# The latest month is ${monthYear(meta.latestMonth)}. A ratio is the value against the median of the same months in 2001 to 2025.`,
    '# Trends: Mann-Kendall test and Sen\'s slope of the yearly totals; q is the Benjamini and Hochberg false discovery rate among the places tested.',
    `# View: ${meta.link}`,
    `# Cite: ${meta.citation}`,
    CSV_COLUMNS.map(([name]) => name).join(','),
    ...rows.map((r) => CSV_COLUMNS.map(([, get]) => csvCell(get(r))).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}
