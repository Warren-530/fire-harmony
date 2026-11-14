// Numbers and words for the analytics dashboard: counts for people (443 million, 1.33 million, 65,657), percents
// (6.3%), ratios ("0.94 times normal"), month names, p values in words, and the deep links into the Explorer.
import { DICTS, formatYyyymm } from '../../lib/i18n';

const t = DICTS.en;
export const LOCALE = t.locale;

const formats = new Map<string, Intl.NumberFormat>();
function nf(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, options);
    formats.set(key, f);
  }
  return f;
}

/** A true minus sign instead of the hyphen that Intl gives. */
const minus = (s: string): string => s.replace(/^-/, '−').replace(/(\s)-/g, '$1−');

/** Whole number with thousands separators: 65657 -> "65,657". */
export function int(v: number): string {
  return minus(nf('int', { maximumFractionDigits: 0 }).format(v));
}

/** Fixed decimals: dec(0.9389, 2) -> "0.94". */
export function dec(v: number, digits: number): string {
  return minus(nf(`dec${digits}`, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v));
}

/** Up to three figures, with no trailing zero ("13", not "13.0"; "1.3", not "1.30"). */
function upTo3(v: number): string {
  return minus(nf('upto3', { maximumSignificantDigits: 3 }).format(v));
}

/** A count for people: 443 million, 1.33 million, 13 million, 440,406 (no trailing ".0", as in components/pages/format). */
export function count(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${upTo3(v / 1e9)} billion`;
  if (a >= 1e6) return `${upTo3(v / 1e6)} million`;
  return int(v);
}

/** Millions for an axis or a table that says "millions" in its title: 18270924 -> "18.3". */
export function millions(v: number, digits = 1): string {
  return dec(v / 1e6, digits);
}

/** A value already in percent: 6.29 -> "6.3%"; signed: 0.55 -> "+0.55%", -6.29 -> "−6.3%". */
export function pct(v: number, digits = 1, signed = false): string {
  const s = minus(nf(`pct${digits}${signed}`, {
    minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(v));
  return `${s}%`;
}

/** A share from 0 to 1 as a percent: 0.9628 -> "96.3%" (1 decimal), 0.44 -> "44%" (0 decimals). */
export function share(v: number, digits = 0): string {
  return pct(v * 100, digits);
}

/** A ratio to normal: 0.939 -> "0.94", 1.62 -> "1.6", 16.23 -> "16.2". */
export function ratioNum(r: number): string {
  return r < 1 ? dec(r, 2) : dec(r, 1);
}

export function timesNormal(r: number): string {
  return `${ratioNum(r)} times normal`;
}

/** yyyymm -> "October 2026". */
export function monthYear(yyyymm: number): string {
  return formatYyyymm(yyyymm, 'en');
}

/** 10 -> "October". */
export function monthName(mo: number): string {
  return t.common.months[mo - 1] ?? String(mo);
}

/** 10 -> "Oct". */
export function monthShort(mo: number): string {
  return t.common.monthsShort[mo - 1] ?? String(mo);
}

/** The first letter of every month: J F M A M J J A S O N D. */
export const MONTH_LETTERS: readonly string[] = t.common.monthsShort.map((m) => m.charAt(0));

/** yyyymm moved by n months. */
export function addMonths(yyyymm: number, n: number): number {
  const k = Math.floor(yyyymm / 100) * 12 + (yyyymm % 100) - 1 + n;
  return Math.floor(k / 12) * 100 + (k % 12) + 1;
}

/** yyyymm -> decimal year at the start of the month (200207 -> 2002.5). */
export function yearOf(yyyymm: number): number {
  return Math.floor(yyyymm / 100) + ((yyyymm % 100) - 1) / 12;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

/** "p < 0.001", "p = 0.023", with no-break spaces so the value never wraps away from the p. */
export function pText(p: number): string {
  if (p < 0.001) return 'p\u00a0<\u00a00.001';
  return `p\u00a0=\u00a0${dec(p, p < 0.01 ? 3 : 2)}`;
}

/** A trend counts as clear when p < 0.05. */
export const isClear = (p: number | null | undefined): boolean => p !== null && p !== undefined && p < 0.05;

// ---------------------------------------------------------------------------------------------- against normal
export type Tone = 'up' | 'down' | 'flat';

/** Same thresholds as the Explorer: 1.25 times normal or more is above normal, 0.8 or less is below. */
export function normalTone(r: number | null): Tone {
  if (r === null || !Number.isFinite(r)) return 'flat';
  return r >= 1.25 ? 'up' : r <= 0.8 ? 'down' : 'flat';
}

export const NORMAL_WORD: Record<Tone, string> = { up: t.panels.above, down: t.panels.below, flat: t.panels.nearNormal };

const ANOMALY_VARS = ['--anom-b4', '--anom-b3', '--anom-b2', '--anom-b1', '--anom-0', '--anom-r1', '--anom-r2',
  '--anom-r3', '--anom-r4'] as const;

/** The anomaly colour of a ratio, on the same bins as the Explorer map: log2 steps of a half, clipped at 4 times. */
export function anomalyVar(r: number): string {
  const k = Math.round(Math.log2(Math.max(r, 1 / 16)) * 2) + 4;
  return ANOMALY_VARS[Math.max(0, Math.min(8, k))];
}

export type TrendWord = 'Rising' | 'Falling' | 'No clear trend';

export function trendTone(direction: string): Tone {
  return direction === 'increasing' ? 'up' : direction === 'decreasing' ? 'down' : 'flat';
}

export function trendWord(direction: string): TrendWord {
  return direction === 'increasing' ? 'Rising' : direction === 'decreasing' ? 'Falling' : 'No clear trend';
}

// ---------------------------------------------------------------------------------------------- links and names
/** The Explorer opens a named area from "#/?area=<kind>:<id>" (the same link as openArea in lib/commands). */
export function explorerHref(kind: string, id: string): string {
  return `#/?area=${encodeURIComponent(kind)}:${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------------------------------------- continents
/** The six inhabited continents (Natural Earth), for the country filter. dashboard.json has no continent per country,
 *  so the countries are listed here by ISO 3166 code. Russia and Turkey span two continents and are in both. */
export const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'] as const;
export type Continent = (typeof CONTINENTS)[number];

const CONTINENT_CODES: Record<Continent, string> = {
  Africa: 'DZA AGO BEN BWA BFA BDI CPV CMR CAF TCD COM COD COG CIV DJI EGY GNQ ERI SWZ ETH GAB GMB GHA GIN GNB KEN LSO LBR '
    + 'LBY MDG MWI MLI MRT MUS MAR MOZ NAM NER NGA RWA STP SEN SYC SLE SOM SOL ZAF SSD SDS SDN TZA TGO TUN UGA ZMB ZWE ESH',
  Asia: 'AFG ARM AZE BHR BGD BTN BRN KHM CHN CYP GEO IND IDN IRN IRQ ISR JPN JOR KAZ KWT KGZ LAO LBN MYS MDV MNG MMR NPL '
    + 'PRK OMN PAK PSE PHL QAT SAU SGP KOR LKA SYR TWN TJK THA TLS TUR TKM ARE UZB VNM YEM HKG MAC RUS',
  Europe: 'ALB AND AUT BLR BEL BIH BGR HRV CZE DNK EST FIN FRA DEU GRC HUN ISL IRL ITA XKX KOS LVA LIE LTU LUX MLT MDA MCO '
    + 'MNE NLD MKD NOR POL PRT ROU RUS SMR SRB SVK SVN ESP SWE CHE UKR GBR VAT TUR',
  'North America': 'ATG BHS BRB BLZ CAN CRI CUB DMA DOM SLV GRD GTM HTI HND JAM MEX NIC PAN KNA LCA VCT TTO USA GRL PRI',
  Oceania: 'AUS FJI KIR MHL FSM NRU NZL PLW PNG WSM SLB TON TUV VUT NCL',
  'South America': 'ARG BOL BRA CHL COL ECU GUY PRY PER SUR URY VEN FLK',
};

const CONTINENT_OF = new Map<string, Continent[]>();
for (const c of CONTINENTS) {
  for (const code of CONTINENT_CODES[c].split(' ')) CONTINENT_OF.set(code, [...(CONTINENT_OF.get(code) ?? []), c]);
}

/** The continents of a country code ("RUS" -> Europe and Asia). Empty when unknown. */
export function continentsOf(iso3: string): Continent[] {
  return CONTINENT_OF.get(iso3.split('-')[0]) ?? [];
}

/** "Europe and Asia". */
export function andList(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Satellite names as the app writes them, with the sensor and its colour. */
export function satellite(name: string): { name: string; sensor: 'MODIS' | 'VIIRS'; colour: string } {
  switch (name) {
    case 'Terra': return { name: 'Terra', sensor: 'MODIS', colour: '--sensor-modis' };
    case 'Aqua': return { name: 'Aqua', sensor: 'MODIS', colour: '--sensor-modis' };
    case 'Suomi-NPP': case 'Suomi NPP': return { name: 'Suomi NPP', sensor: 'VIIRS', colour: '--sensor-snpp' };
    case 'NOAA-20': return { name: 'NOAA-20', sensor: 'VIIRS', colour: '--sensor-noaa20' };
    case 'NOAA-21': return { name: 'NOAA-21', sensor: 'VIIRS', colour: '--sensor-noaa21' };
    default: return { name, sensor: 'VIIRS', colour: '--muted' };
  }
}

/** Plain names of the inputs of the harmonization model (fireharmony/harmonize.py, panel.py). */
const MODEL_INPUTS: Record<string, string> = {
  T_c7: 'Terra: fire days in 5 km² patches',
  A_c7: 'Aqua: fire days in 5 km² patches',
  T_n: 'Terra: hotspots',
  A_n: 'Aqua: hotspots',
  T_nd: 'Terra: hotspots by day',
  A_nd: 'Aqua: hotspots by day',
  T_nn: 'Terra: hotspots at night',
  A_nn: 'Aqua: hotspots at night',
  T_ns: 'Terra: weak hotspots',
  A_ns: 'Aqua: weak hotspots',
  T_nl: 'Terra: strong hotspots',
  A_nl: 'Aqua: strong hotspots',
  T_fd: 'Terra: days with fire',
  A_fd: 'Aqua: days with fire',
  T_frp: 'Terra: total fire strength',
  A_frp: 'Aqua: total fire strength',
  T_frp_per_det: 'Terra: fire strength per hotspot',
  A_frp_per_det: 'Aqua: fire strength per hotspot',
  T_pix: 'Terra: pixel size',
  A_pix: 'Aqua: pixel size',
  ctx4: 'MODIS hotspots in the wider region',
  ctx3: 'MODIS hotspots in the large region',
  clim: 'Normal MODIS fire for the month',
};

/** Plain names of the inputs of the outlook model (fireharmony/outlook.py). */
const OUTLOOK_INPUTS: Record<string, string> = {
  y0: 'Fire against normal, latest month',
  y1: 'Fire against normal, a month before',
  y2: 'Fire against normal, two months before',
  target_share: 'Share of the year’s fire in the target month',
  dmi: 'Indian Ocean Dipole',
  oni: 'El Niño index (ONI)',
  abs_lat: 'Distance from the equator',
  lead: 'Months ahead',
  rain3_z: 'Rain, last three months',
  rain_z: 'Rain, latest month',
  t2m_z_prev: 'Air temperature, latest month',
  target_mo_sin: 'Time of year',
  target_mo_cos: 'Time of year',
  log_fire_per_year: 'Fire in a normal year',
};

export const modelInput = (f: string): string => MODEL_INPUTS[f] ?? f;
export const outlookInput = (f: string): string => OUTLOOK_INPUTS[f] ?? f;

/** Area and period of the cross validation, in the words of the Methods page. */
export function scaleName(scale: string): string {
  return t.methods.coverageScales[scale] ?? scale;
}

/** Where each MODIS test tile of the physics check lies (from the median position of its fires). */
const TILE_PLACES: Record<string, string> = {
  h08v05: 'Southern California, United States',
  h11v03: 'Alberta, Canada',
  h12v10: 'Mato Grosso, Brazil',
  h12v11: 'Chaco, Paraguay',
  h20v08: 'Central African Republic',
  h20v10: 'Zambia',
  h22v02: 'Central Siberia, Russia',
  h25v06: 'Central India',
  h29v09: 'Central Kalimantan, Indonesia',
  h30v10: 'Northern Territory, Australia',
};

export function tilePlace(tile: string, lat: number, lon: number): string {
  const known = TILE_PLACES[tile];
  if (known) return known;
  return `${dec(Math.abs(lat), 1)}°${lat >= 0 ? 'N' : 'S'}, ${dec(Math.abs(lon), 1)}°${lon >= 0 ? 'E' : 'W'}`;
}
