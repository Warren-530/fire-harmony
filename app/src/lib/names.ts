// English names of places, the same as the report's (fireharmony/eda.py NE_SHORT, PLACE_NAMES and NAME_FIXES).
// The published files keep Natural Earth's names: local names of states ("Kalimantan Tengah") and short names of
// countries ("Dem. Rep. Congo"). The app writes them out once, where the files load (data.ts loadAreas and
// loadDashboard, web.ts for places.json and eda.json, search.ts for the cities), and keeps the local name of a state
// as a subtitle and as a second name the search knows.
// stateNamesEn.json: Natural Earth's name_en for the states whose English name differs from the name beyond accents
// and case (built once by app/qa/B/state_names.py, keyed by the state id, Natural Earth's adm1_code).
import STATE_EN from './stateNamesEn.json';

/** Natural Earth's short country names, written out (eda.py NE_SHORT). */
export const COUNTRY_EN: Readonly<Record<string, string>> = {
  'Antigua and Barb.': 'Antigua and Barbuda', 'Bosnia and Herz.': 'Bosnia and Herzegovina',
  'Br. Indian Ocean Ter.': 'British Indian Ocean Territory', 'British Virgin Is.': 'British Virgin Islands',
  'Cayman Is.': 'Cayman Islands', 'Central African Rep.': 'Central African Republic', 'Cook Is.': 'Cook Islands',
  'Cyprus U.N. Buffer Zone': 'Cyprus UN Buffer Zone', 'Dem. Rep. Congo': 'DR Congo', 'Dominican Rep.': 'Dominican Republic',
  'Eq. Guinea': 'Equatorial Guinea', 'Faeroe Is.': 'Faroe Islands', 'Falkland Is.': 'Falkland Islands',
  'Fr. Polynesia': 'French Polynesia', 'Fr. S. Antarctic Lands': 'French Southern Lands',
  'Heard I. and McDonald Is.': 'Heard and McDonald Islands', 'Marshall Is.': 'Marshall Islands', 'N. Cyprus': 'Northern Cyprus',
  'N. Mariana Is.': 'Northern Mariana Islands', 'S. Geo. and the Is.': 'South Georgia and the South Sandwich Islands',
  'S. Sudan': 'South Sudan', 'Solomon Is.': 'Solomon Islands', 'Spratly Is.': 'Spratly Islands',
  'St. Kitts and Nevis': 'Saint Kitts and Nevis', 'St. Pierre and Miquelon': 'Saint Pierre and Miquelon',
  'St. Vin. and Gren.': 'Saint Vincent and the Grenadines', 'Turks and Caicos Is.': 'Turks and Caicos Islands',
  'U.S. Minor Outlying Is.': 'US Minor Outlying Islands', 'U.S. Virgin Is.': 'US Virgin Islands',
  'United States of America': 'United States', 'W. Sahara': 'Western Sahara', 'Wallis and Futuna Is.': 'Wallis and Futuna',
};

/** Whole names the report writes its own way (eda.py PLACE_NAMES and NAME_FIXES), by place id. */
const PLACE_EN: Readonly<Record<string, string>> = {
  'IDN-1931': 'Central Kalimantan, Indonesia', 'PRK-3308': 'Kangwon, North Korea', 'PRK-3311': 'South Hamgyong, North Korea',
  COD: 'DR Congo', 'ARE-349': 'Abu Dhabi, United Arab Emirates',
};

const CONTINENT_EN: Readonly<Record<string, string>> = { 'Seven seas (open ocean)': 'Open ocean' };

/** Cities written as their country writes them in English (web/cities.json has the older form). */
export const CITY_EN: Readonly<Record<string, string>> = { Palangkaraya: 'Palangka Raya' };

const STATES = STATE_EN as Readonly<Record<string, string>>;

type Kind = 'world' | 'continent' | 'country' | 'state' | 'city' | string;

const splitState = (name: string): [string, string | null] => {
  const at = name.lastIndexOf(', ');
  return at < 0 ? [name, null] : [name.slice(0, at), name.slice(at + 2)];
};

/** A country's English name ("Dem. Rep. Congo" → "DR Congo"); any other name as it is. */
export const englishCountry = (name: string): string => COUNTRY_EN[name] ?? name;

/** The English name of a place, as the report writes it: "Kalimantan Tengah, Indonesia" → "Central Kalimantan,
 *  Indonesia", "Bandundu, Dem. Rep. Congo" → "Bandundu, DR Congo", "Seven seas (open ocean)" → "Open ocean". */
export function englishName(kind: Kind, id: string, name: string): string {
  if (!name) return name;
  const fixed = PLACE_EN[id];
  if (fixed && (kind === 'state' || kind === 'country')) return fixed;
  if (kind === 'country') return englishCountry(name);
  if (kind === 'continent') return CONTINENT_EN[name] ?? name;
  if (kind === 'city') return CITY_EN[name] ?? name;
  if (kind !== 'state') return name;
  const [own, country] = splitState(name);
  const en = STATES[id] ?? own;
  return country === null ? en : `${en}, ${englishCountry(country)}`;
}

/** The local name of a state whose English name replaced it ("Kalimantan Tengah" for IDN-1931); null otherwise. */
export function localName(kind: Kind, id: string, name: string): string | null {
  if (kind !== 'state' || !name) return null;
  const [own] = splitState(name);
  const [en] = splitState(englishName(kind, id, name));
  return en !== own ? own : null;
}

const KINDS = new Set(['world', 'continent', 'country', 'state']);

/** The kind of a place object of a published file: its own field, or what its id says (an ISO3 code is a country,
 *  "IDN-1931" a state). Null for anything else (a city, a sensor). */
function kindOf(o: Record<string, unknown>): string | null {
  if (typeof o.kind === 'string') return KINDS.has(o.kind) ? o.kind : null;
  const id = typeof o.id === 'string' ? o.id : typeof o.iso3 === 'string' && !('id' in o) ? o.iso3 : null;
  if (id === null) return null;
  if (/^[A-Z]{3}$/.test(id)) return 'country';
  if (/^[A-Z]{3}[-+]/.test(id)) return 'state';
  return null;
}

/** Every place of a parsed published file (dashboard.json, eda.json) renamed in place, in English: any object with a
 *  name and a place kind or id. Continents without an id (a list of continent rows) are renamed by their name. */
export function englishNames<T>(data: T): T {
  const seen = new Set<object>();
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    const o = v as Record<string, unknown>;
    if (typeof o.name === 'string') {
      const kind = kindOf(o);
      const id = typeof o.id === 'string' ? o.id : typeof o.iso3 === 'string' ? o.iso3 : '';
      if (kind) {
        const en = englishName(kind, id, o.name);
        if (en !== o.name) {
          if (kind === 'state' && !('local_name' in o)) o.local_name = localName(kind, id, o.name);
          o.name = en;
        }
      } else if (o.name in CONTINENT_EN) o.name = CONTINENT_EN[o.name];
    }
    for (const x of Object.values(o)) walk(x);
  };
  walk(data);
  return data;
}

/** A place row ({kind, id, name}) in English, with the local name kept where it was replaced. */
export function withEnglishName<T extends { kind: string; id: string; name: string | null }>(row: T): T & { local_name: string | null } {
  const name = row.name ?? '';
  const en = englishName(row.kind, row.id, name);
  return { ...row, name: row.name === null ? null : en, local_name: localName(row.kind, row.id, name) } as T & { local_name: string | null };
}
