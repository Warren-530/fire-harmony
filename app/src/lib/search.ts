// One place search for the whole app: the Explorer's area panel and the command palette both call searchAreas, so a
// query gives the same places in the same order everywhere. It is forgiving like Raycast or Apple Maps:
// - case and accents do not matter ("sao paulo", "para", "cote d'ivoire"), nor spaces and hyphens ("viet nam");
// - matches rank exact (a name, an ISO3 code or a common short name), then prefix, word prefix, substring, and last a
//   one letter typo (queries of 5 letters or more); ties go to the bigger place (fire per year from web/places.json,
//   else area), then the kind, then the name; cities (web/cities.json) come after places of the same rank;
// - the names people use resolve: "Sumatra" and "Borneo" list their provinces, "USA", "UK", "Ivory Coast", "Brasil"
//   find their country, "Amazon" the states of Brazil's Legal Amazon, "Siberia" the Siberian regions, "Cerrado",
//   "Pantanal", "Gran Chaco", "Sahel" and "Congo Basin" the places they lie in, "Kalteng" or "NSW" their province;
//   a state is found with the word for one too ("riau province", "irkutsk oblast");
// - a city opens a circle of 50 km around it, and such a circle is named after the city wherever areas are named.
// Pure functions first (tested in search.test.ts), then the loaders and the React hooks the components use.
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AreaSelection, NamedArea } from './types';
import { englishName } from './names';

// ------------------------------------------------------------------------------------------- text folding

const FOLD: Record<string, string> = {
  'ø': 'o', 'Ø': 'o', 'æ': 'ae', 'Æ': 'ae', 'œ': 'oe', 'Œ': 'oe', 'ß': 'ss', 'ł': 'l', 'Ł': 'l', 'đ': 'd', 'Đ': 'd',
  'ð': 'd', 'Ð': 'd', 'þ': 'th', 'Þ': 'th', 'ı': 'i', 'ħ': 'h', 'ə': 'e', 'Ə': 'e',
};
const QUOTES = new Set(["'", '’', '‘', 'ʻ', 'ʼ', '`', '´']);
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Folded text (lower case, no accents or quotes, any other punctuation as one space) and, for each folded
 *  character, the index of the character of the source it came from (to highlight a match in the source). */
export interface Folded { s: string; at: number[] }

export function fold(text: string): Folded {
  let s = '';
  const at: number[] = [];
  let gap = true;   // no space at the start, and never two in a row
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (QUOTES.has(ch)) continue;
    const code = ch.charCodeAt(0);
    const rep = code < 128 ? (code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch)
      : FOLD[ch] ?? ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const c of rep) {
      const word = c.charCodeAt(0) < 128 ? /[a-z0-9]/.test(c) : WORD_CHAR.test(c);
      if (word) { s += c; at.push(i); gap = false; }
      else if (!gap) { s += ' '; at.push(i); gap = true; }
    }
  }
  if (s.endsWith(' ')) { s = s.slice(0, -1); at.pop(); }
  return { s, at };
}

const folded = new Map<string, Folded>();
/** fold, kept for the names of the index (it is built again when the fire sizes and the cities arrive). */
function foldName(text: string): Folded {
  let f = folded.get(text);
  if (!f) { f = fold(text); folded.set(text, f); }
  return f;
}

/** "São Paulo, Brazil" → "sao paulo brazil"; "Côte d'Ivoire" → "cote divoire". */
export const normalise = (text: string): string => fold(text).s;

/** Display text: no invisible marks, single spaces ("St.  Petersburg" → "St. Petersburg"). */
const tidy = (text: string): string => text.replace(/[\u200b-\u200f\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();

/** True when a and b differ by at most one insertion, deletion, substitution or swap of two neighbours. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;                                   // one substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);    // one swap
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);         // one deletion or insertion
}

// ------------------------------------------------------------------------------------------- names people use

/** Another name of one or more places. `to` holds keys "<kind>:<id>" from areas.json; `note` replaces the hint
 *  "also known as <name>". A region (`region`) lists its places with the hint "<Kind> <region>" ("State on Sumatra");
 *  `off` holds members with another hint (near rather than on it, "off Sumatra", or only partly in it). `as` caps the
 *  rank the name can give ("America" lists the two continents after the USA, among the names that start with it).
 *  Every key is checked against areas.json in the tests. */
interface Alias {
  say: string[];
  to: string[];
  region?: string;
  off?: { keys: string[]; hint: string };
  note?: (said: string) => string;
  as?: MatchKind;
}

const IDN = (...ids: string[]) => ids.map((id) => `state:IDN-${id}`);
const MYS = (...ids: string[]) => ids.map((id) => `state:MYS-${id}`);
const RUS = (...ids: string[]) => ids.map((id) => `state:RUS-${id}`);
const C = (...ids: string[]) => ids.map((id) => `country:${id}`);
const S = (...ids: string[]) => ids.map((id) => `state:${id}`);
const BRA = (...ids: string[]) => ids.map((id) => `state:BRA-${id}`);
const same = (...pairs: [string[], string][]): Alias[] => pairs.map(([say, key]) => ({ say, to: [key] }));

export const ALIASES: readonly Alias[] = [
  // islands and regions that are not one place in the data
  { say: ['Sumatra', 'Sumatera'], region: 'on Sumatra', to: IDN('1136', '381', '539', '492', '1930', '1225', '1230', '1229'),
    off: { keys: IDN('1796', '1231'), hint: 'off Sumatra' } },
  { say: ['Borneo'], region: 'on Borneo', to: [...IDN('1228', '1931', '1234', '1185'), ...MYS('1186', '1187'), 'country:BRN'],
    off: { keys: MYS('4833'), hint: 'off Borneo' } },
  { say: ['Kalimantan'], region: 'on Borneo', to: IDN('1228', '1931', '1234', '1185') },
  { say: ['Java', 'Jawa'], region: 'on Java', to: IDN('1226', '1227', '1223', '1224', '540', '1233') },
  { say: ['Sulawesi', 'Celebes'], region: 'on Sulawesi', to: IDN('1237', '1236', '557', '556', '513', '1837') },
  { say: ['New Guinea', 'Papua'], region: 'on New Guinea', to: [...IDN('558', '1933'), 'country:PNG'] },
  { say: ['Irian Jaya'], region: 'on New Guinea', to: IDN('558', '1933') },
  { say: ['Moluccas', 'Maluku Islands', 'Spice Islands'], region: 'in the Moluccas', to: IDN('554', '538') },
  { say: ['Nusa Tenggara', 'Lesser Sunda Islands'], region: 'in Nusa Tenggara', to: IDN('555', '1235') },
  { say: ['Peninsular Malaysia', 'West Malaysia', 'Malaya'], region: 'in Peninsular Malaysia',
    to: MYS('1143', '1140', '1144', '4831', '1145', '1146', '1147', '1137', '1141', '1139', '1148', '1149') },
  { say: ['East Malaysia'], region: 'in East Malaysia', to: MYS('1186', '1187', '4833') },
  { say: ['Siberia'], region: 'in Siberia',
    to: RUS('2398', '2396', '2382', '2397', '2167', '2403', '2401', '2399', '2400', '2603', '2402', '2605', '2602', '2606', '2610', '2612') },
  { say: ['Russian Far East', 'Far East Russia'], region: 'in the Russian Far East',
    to: RUS('2609', '2614', '2611', '2615', '2321', '3468', '2616', '2613', '2612') },
  { say: ['Amazon', 'Amazonia', 'Legal Amazon', 'Amazon rainforest'], region: "in Brazil's Legal Amazon",
    to: S('BRA-576', 'BRA-681', 'BRA-592', 'BRA-593', 'BRA-602', 'BRA-594', 'BRA-595', 'BRA-670', 'BRA-596') },
  { say: ['Patagonia'], region: 'in Patagonia', to: S('ARG-1276', 'ARG-1297', 'ARG-1274', 'ARG-1271', 'ARG-1272', 'CHL-2691', 'CHL-2692') },
  { say: ['Southeast Asia', 'South East Asia', 'ASEAN'], region: 'in Southeast Asia',
    to: C('BRN', 'KHM', 'IDN', 'LAO', 'MYS', 'MMR', 'PHL', 'SGP', 'THA', 'TLS', 'VNM') },
  { say: ['Central America'], region: 'in Central America', to: C('BLZ', 'CRI', 'SLV', 'GTM', 'HND', 'NIC', 'PAN') },
  { say: ['Scandinavia'], region: 'in Scandinavia', to: C('NOR', 'SWE', 'DNK') },
  { say: ['Nordic countries', 'Nordics'], region: 'in the Nordic countries', to: C('NOR', 'SWE', 'DNK', 'FIN', 'ISL') },
  { say: ['Indochina', 'Mainland Southeast Asia', 'Indochinese Peninsula'], region: 'in mainland Southeast Asia',
    to: C('KHM', 'LAO', 'MMR', 'THA', 'VNM') },
  { say: ['West Africa', 'Western Africa'], region: 'in West Africa',
    to: C('BEN', 'BFA', 'CPV', 'CIV', 'GMB', 'GHA', 'GIN', 'GNB', 'LBR', 'MLI', 'MRT', 'NER', 'NGA', 'SEN', 'SLE', 'TGO') },
  { say: ['Sahel'], region: 'with part of the Sahel', to: C('SEN', 'MRT', 'MLI', 'BFA', 'NER', 'NGA', 'TCD', 'SDN', 'ERI') },
  { say: ['Horn of Africa'], region: 'in the Horn of Africa', to: C('ETH', 'SOM', 'SOL', 'ERI', 'DJI') },
  { say: ['Congo Basin', 'Congo rainforest'], region: 'in the Congo Basin', to: C('COD', 'COG', 'CMR', 'CAF', 'GAB', 'GNQ') },
  // biomes and wetlands in the news for fire: the states they lie in (whole, or partly)
  { say: ['Cerrado'], region: 'in the Cerrado', to: BRA('1294', '596', '599'),
    off: { keys: BRA('602', '600', '601', '593', '622', '624'), hint: 'partly in the Cerrado' } },
  { say: ['Pantanal'], region: 'with part of the Pantanal', to: [...BRA('600', '602'), 'state:BOL-1940', 'state:PRY-597'] },
  { say: ['Gran Chaco', 'Chaco region'], region: 'in the Gran Chaco', to: S('ARG-1306', 'ARG-1307', 'ARG-1304', 'PRY-598', 'PRY-605', 'PRY-597'),
    off: { keys: S('ARG-1303', 'BOL-1941', 'BOL-1940', 'BOL-1292'), hint: 'partly in the Gran Chaco' } },
  // countries: short, local and older names
  { say: ['USA', 'US', 'U.S.', 'U.S.A.', 'United States', 'America', 'the States'], to: ['country:USA'] },
  { say: ['America', 'Americas'], to: ['continent:North America', 'continent:South America'], note: () => 'one of the Americas', as: 'prefix' },
  { say: ['UK', 'U.K.', 'Britain', 'Great Britain'], to: ['country:GBR'] },
  { say: ['England', 'Scotland', 'Wales', 'Northern Ireland'], to: ['country:GBR'], note: (s) => `includes ${s}` },
  { say: ['DRC', 'DR Congo', 'Democratic Republic of the Congo', 'Democratic Republic of Congo', 'Congo Kinshasa', 'Zaire'], to: ['country:COD'] },
  { say: ['Republic of the Congo', 'Republic of Congo', 'Congo Brazzaville', 'Congo Republic'], to: ['country:COG'] },
  { say: ['Ivory Coast'], to: ['country:CIV'] },
  ...same(
    [['Russian Federation'], 'country:RUS'], [['Türkiye', 'Turkiye'], 'country:TUR'], [['Brasil'], 'country:BRA'],
    [['Viet Nam'], 'country:VNM'], [['Burma'], 'country:MMR'], [['Czech Republic'], 'country:CZE'], [['Holland'], 'country:NLD'],
    [['UAE', 'Emirates'], 'country:ARE'], [['East Timor'], 'country:TLS'], [['Cape Verde'], 'country:CPV'],
    [['Swaziland'], 'country:SWZ'], [['Central African Republic', 'CAR'], 'country:CAF'], [['Dominican Republic'], 'country:DOM'],
    [['Bosnia and Herzegovina'], 'country:BIH'], [['Equatorial Guinea'], 'country:GNQ'], [['South Sudan'], 'country:SSD'],
    [['Republic of Korea'], 'country:KOR'], [['DPRK'], 'country:PRK'], [['Lao PDR'], 'country:LAO'], [['Kyrgyz Republic'], 'country:KGZ'],
    [['Macau'], 'country:MAC'], [['Falkland Islands', 'Malvinas'], 'country:FLK'], [['Solomon Islands'], 'country:SLB'],
    [['Marshall Islands'], 'country:MHL'], [['Cayman Islands'], 'country:CYM'], [['Cook Islands'], 'country:COK'],
    [['Faroe Islands', 'Faeroe Islands'], 'country:FRO'], [['French Polynesia'], 'country:PYF'],
    [['French Southern Lands'], 'country:ATF'], [['Heard Island and McDonald Islands'], 'country:HMD'],
    [['British Indian Ocean Territory'], 'country:IOT'], [['South Georgia'], 'country:SGS'],
    [['Northern Mariana Islands'], 'country:MNP'], [['Turks and Caicos Islands'], 'country:TCA'], [['Wallis and Futuna'], 'country:WLF'],
    [['British Virgin Islands'], 'country:VGB'], [['US Virgin Islands'], 'country:VIR'], [['US Minor Outlying Islands'], 'country:UMI'],
    [['Saint Kitts and Nevis'], 'country:KNA'], [['Saint Vincent and the Grenadines'], 'country:VCT'],
    [['Saint Pierre and Miquelon'], 'country:SPM'], [['Saint Barthelemy'], 'country:BLM'], [['Saint Martin'], 'country:MAF'],
    [['Antigua and Barbuda'], 'country:ATG'], [['Western Sahara'], 'country:ESH'], [['Northern Cyprus'], 'country:CYN'],
  ),
  // states: English names of Indonesian provinces, and common names of Malaysian, Russian, Chinese and Indian states
  ...same(
    [['North Sumatra'], 'state:IDN-381'], [['West Sumatra'], 'state:IDN-539'], [['South Sumatra'], 'state:IDN-1230'],
    [['Riau Islands'], 'state:IDN-1796'], [['Jakarta'], 'state:IDN-1227'], [['West Java'], 'state:IDN-1223'],
    [['Central Java'], 'state:IDN-1224'], [['East Java'], 'state:IDN-1233'], [['West Kalimantan'], 'state:IDN-1228'],
    [['Central Kalimantan'], 'state:IDN-1931'], [['South Kalimantan'], 'state:IDN-1234'], [['East Kalimantan'], 'state:IDN-1185'],
    [['North Sulawesi'], 'state:IDN-513'], [['Central Sulawesi'], 'state:IDN-557'], [['South Sulawesi'], 'state:IDN-1236'],
    [['Southeast Sulawesi', 'South East Sulawesi'], 'state:IDN-556'], [['West Sulawesi'], 'state:IDN-1237'],
    [['West Nusa Tenggara'], 'state:IDN-555'], [['East Nusa Tenggara'], 'state:IDN-1235'], [['North Maluku'], 'state:IDN-538'],
    [['West Papua'], 'state:IDN-1933'], [['Yogya', 'Jogja', 'Jogjakarta'], 'state:IDN-540'],
    // the short names of Indonesian provinces used in fire and haze reports
    [['Kalbar'], 'state:IDN-1228'], [['Kalteng'], 'state:IDN-1931'], [['Kalsel'], 'state:IDN-1234'], [['Kaltim'], 'state:IDN-1185'],
    [['Sumut'], 'state:IDN-381'], [['Sumbar'], 'state:IDN-539'], [['Sumsel'], 'state:IDN-1230'], [['Babel'], 'state:IDN-1231'],
    [['Kepri'], 'state:IDN-1796'], [['DKI'], 'state:IDN-1227'], [['Jabar'], 'state:IDN-1223'], [['Jateng'], 'state:IDN-1224'],
    [['Jatim'], 'state:IDN-1233'], [['DIY'], 'state:IDN-540'], [['Sulut'], 'state:IDN-513'], [['Sulteng'], 'state:IDN-557'],
    [['Sulsel'], 'state:IDN-1236'], [['Sultra'], 'state:IDN-556'], [['Sulbar'], 'state:IDN-1237'], [['NTB'], 'state:IDN-555'],
    [['NTT'], 'state:IDN-1235'], [['Malut'], 'state:IDN-538'],
    // and of Australian and Canadian ones
    [['NSW'], 'state:AUS-2654'], [['QLD'], 'state:AUS-2657'], [['BC'], 'state:CAN-633'], [['NWT'], 'state:CAN-635'],
    [['Penang'], 'state:MYS-1139'], [['Malacca'], 'state:MYS-1145'], [['KL'], 'state:MYS-4831'],
    [['Magadan'], 'state:RUS-2615'], [['Zabaykalsky Krai', 'Zabaykalsky', 'Transbaikal', 'Transbaikalia'], 'state:RUS-2610'],
    [['Buryatia'], 'state:RUS-2606'], [['Khakassia'], 'state:RUS-2402'], [['Tyva'], 'state:RUS-2605'], [['Yakutia'], 'state:RUS-2612'],
    [['Primorsky Krai', 'Primorye'], 'state:RUS-2611'], [['Jewish Autonomous Oblast'], 'state:RUS-2613'],
    [['Chukotka'], 'state:RUS-2321'], [['Saint Petersburg', 'St Petersburg'], 'state:RUS-2337'], [['Kalmykia'], 'state:RUS-2390'],
    [['Udmurtia'], 'state:RUS-2387'], [['Chuvashia'], 'state:RUS-2389'], [['Kabardino Balkaria'], 'state:RUS-2304'],
    [['Karachay Cherkessia'], 'state:RUS-2280'], [['Ingushetia'], 'state:RUS-2303'], [['Adygea'], 'state:RUS-2279'],
    [['Yamalo Nenets'], 'state:RUS-2382'], [['Nizhny Novgorod'], 'state:RUS-2357'], [['Moscow Oblast'], 'state:RUS-2364'],
    [['Altai Krai'], 'state:RUS-2399'], [['Altai Republic'], 'state:RUS-2400'], [['Moscow'], 'state:RUS-2365'],
    [['Moscow Region'], 'state:RUS-2364'],
    [['Tibet'], 'state:CHN-1662'], [['Inner Mongolia'], 'state:CHN-1838'],
    [['Orissa'], 'state:IND-2444'], [['Uttaranchal'], 'state:IND-3254'], [['Pondicherry'], 'state:IND-3262'],
  ),
  { say: ['North Kalimantan', 'Kaltara'], to: ['state:IDN-1185'], note: (said) => `includes ${said === 'Kaltara' ? 'Kaltara (North Kalimantan)' : said}` },
  { say: ['Lombok'], to: ['state:IDN-555'], note: () => 'includes Lombok' },
  { say: ['Flores'], to: ['state:IDN-1235'], note: () => 'includes Flores' },
];

/** Older or other names of cities: [name said, city name in the list, ISO3, "once called" (an older name) or "also
 *  known as" (another spelling)]. */
export const CITY_ALIASES: readonly [string, string, string, 'once called' | 'also known as'][] = [
  ['Saigon', 'Ho Chi Minh City', 'VNM', 'once called'], ['Bombay', 'Mumbai', 'IND', 'once called'],
  ['Calcutta', 'Kolkata', 'IND', 'once called'], ['Madras', 'Chennai', 'IND', 'once called'],
  ['Bangalore', 'Bengaluru', 'IND', 'once called'], ['Peking', 'Beijing', 'CHN', 'once called'],
  ['Saint Petersburg', 'St. Petersburg', 'RUS', 'also known as'],
];

// ------------------------------------------------------------------------------------------- the index

/** One city of web/cities.json. capital: the source's flag (2 a national capital, 1 a state capital, 0 neither); it also
 *  marks cities that are not capitals (Johannesburg, Lagos), so no hint relies on it. */
export interface City {
  name: string; ascii: string | null; iso3: string; state: string | null;
  lat: number; lon: number; pop: number; capital: number;
}

/** web/cities.json: {version, source, columns: [name, ascii, iso3, state, lat, lon, pop, capital], rows}. */
export interface CitiesFile { version: number; source: string; columns: string[]; rows: unknown[][] }

export type HitKind = NamedArea['kind'] | 'city' | 'point';
export type MatchKind = 'exact' | 'prefix' | 'word' | 'substring' | 'typo';
const RANK: Record<MatchKind, number> = { exact: 0, prefix: 1, word: 2, substring: 3, typo: 4 };
const KIND_ORDER: Record<HitKind, number> = { world: 0, continent: 1, country: 2, state: 3, city: 4, point: 5 };
export const KIND_LABEL: Record<HitKind, string> = {
  world: 'Whole world', continent: 'Continent', country: 'Country', state: 'State', city: 'City', point: 'Point',
};

/** A result: what to show (label with the matched parts, a hint) and what picking it opens. */
export interface SearchHit {
  key: string;                       // "state:IDN-492", "city:0.5333,101.45" (stable: lists, recent places)
  kind: HitKind;
  label: string;                     // "Riau, Indonesia", "Pekanbaru"
  hint: string;                      // "State on Sumatra", "City in Riau, Indonesia"
  marks: [number, number][];         // matched parts of the label, [start, end) in characters
  match: MatchKind;
  area: NamedArea | null;            // a named place
  city: City | null;                 // a city (opens a circle of CITY_RADIUS_KM)
  selection: AreaSelection;
  link: string;                      // the Explorer hash that opens it
}

export const CITY_RADIUS_KM = 50;

interface Entry {
  key: string;
  kind: HitKind;
  label: string;
  f: Folded;            // folded label
  short: string;        // folded own name (a state without ", Country"; a city's name)
  compact: string;      // short without spaces
  extra: string[];      // more folded names that count in full: ISO3, a city's ascii name
  words: { w: string; at: number }[];
  local: LocalName | null;   // a state's local name, where the label is its English name ("Kalimantan Tengah")
  hint: string;
  area: NamedArea | null;
  city: City | null;
  size: number;
  area2: number;        // area in km² (second size key for places)
}

interface AliasEntry { say: { f: string; c: string; text: string }[]; alias: Alias }

/** A second name a place is found by in full (its words, start and letters), shown in the hint when it matched. */
interface LocalName { text: string; f: Folded; short: string; compact: string; words: { w: string; at: number }[] }

export interface SearchIndex {
  entries: Entry[];               // places, then cities
  byKey: Map<string, Entry>;
  aliases: AliasEntry[];
  cityAliases: { f: string; c: string; key: string; text: string; how: string }[];
  countryName: Map<string, string>;
  stateName: Map<string, string>;
  cities: City[];
  picks: PlacePicks | null;       // the places an empty search suggests (from web/places.json)
  version: number;
}

const wordsOf = (s: string) => {
  const out: { w: string; at: number }[] = [];
  let at = 0;
  for (const w of s.split(' ')) { if (w) out.push({ w, at }); at += w.length + 1; }
  return out;
};

const areaKey = (a: Pick<NamedArea, 'kind' | 'id'>) => `${a.kind}:${a.id}`;
const linkNumber = (v: number): string => String(Math.round(v * 1e4) / 1e4);

/** The Explorer hash of a named place or of a circle (the same link as explorerLink in stats.ts). */
export function areaLink(kind: string, id: string): string {
  return kind === 'world' ? '#/?area=world:WORLD' : `#/?area=${kind}:${encodeURIComponent(id)}`;
}
export function circleLink(lat: number, lon: number, km: number = CITY_RADIUS_KM): string {
  return `#/?area=circle:${linkNumber(lat)},${linkNumber(lon)},${linkNumber(km)}`;
}

function placeEntry(a: NamedArea): Entry {
  const label = a.kind === 'world' ? 'World' : tidy(a.name && a.name.trim() ? a.name : a.id);
  const f = foldName(label);
  const own = a.kind === 'state' && label.includes(', ') ? label.slice(0, label.lastIndexOf(', ')) : label;
  const short = own === label ? f.s : foldName(own).s;
  const extra: string[] = [];
  if (a.kind === 'country') extra.push(a.id.toLowerCase());
  if (a.kind === 'world') extra.push('earth', 'globe', 'everywhere');
  let local: LocalName | null = null;
  if (a.local_name) {
    const lf = foldName(tidy(a.local_name));
    if (lf.s && lf.s !== short) local = { text: tidy(a.local_name), f: lf, short: lf.s, compact: lf.s.replace(/ /g, ''), words: wordsOf(lf.s) };
  }
  return {
    key: areaKey(a), kind: a.kind, label, f, short, compact: short.replace(/ /g, ''), extra, words: wordsOf(f.s), local,
    hint: KIND_LABEL[a.kind], area: a, city: null, size: a.area_km2 || 0, area2: a.area_km2 || 0,
  };
}

/** The cities as objects, without exact duplicates (the same name in the same state within 10 km). */
export function readCities(file: CitiesFile): City[] {
  const ix = (k: string) => file.columns.indexOf(k);
  const [iName, iAscii, iIso, iState, iLat, iLon, iPop, iCap] = ['name', 'ascii', 'iso3', 'state', 'lat', 'lon', 'pop', 'capital'].map(ix);
  const out: City[] = [];
  const seen = new Map<string, City[]>();
  for (const r of file.rows) {
    const given = tidy(String(r[iName] ?? ''));
    const name = englishName('city', '', given);      // "Palangkaraya" → "Palangka Raya" (lib/names.ts)
    const c: City = {
      // the older form stays a name the search knows (as the ascii name)
      name, ascii: r[iAscii] ? tidy(String(r[iAscii])) : name !== given ? given : null, iso3: String(r[iIso] ?? ''),
      state: r[iState] ? String(r[iState]) : null, lat: Number(r[iLat]), lon: Number(r[iLon]), pop: Number(r[iPop]) || 0,
      capital: Number(r[iCap]) || 0,
    };
    if (!c.name || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    const k = `${c.name}|${c.iso3}|${c.state ?? ''}`;
    const twins = seen.get(k);
    if (twins?.some((t) => distanceKm(t.lat, t.lon, c.lat, c.lon) < 10)) continue;
    if (twins) twins.push(c); else seen.set(k, [c]);
    out.push(c);
  }
  return out;
}

export const cityKey = (c: Pick<City, 'lat' | 'lon'>) => `city:${linkNumber(c.lat)},${linkNumber(c.lon)}`;

/** Words that only say a name is a city ("Hồ Chí Minh city", "City of St. Petersburg", "Jakarta Raya", "Lima Province"). */
const CITY_WORDS = new Set(['city', 'of', 'the', 'raya', 'metropolis', 'metropolitan', 'municipality', 'capital', 'district', 'federal',
  'special', 'province', 'prefecture']);
const coreOf = (s: string) => s.split(' ').filter((w) => !CITY_WORDS.has(w)).join(' ');
const hasCityWord = (s: string) => s.split(' ').some((w) => CITY_WORDS.has(w));
/** A state's name without its country ("Riau, Indonesia" → "Riau"). */
const ownName = (stateName: string) => (stateName.includes(', ') ? stateName.slice(0, stateName.lastIndexOf(', ')) : stateName);

/** A state smaller than this is a district of the city (London lies in "Southwark", Singapore in "South West"): far
 *  smaller than the 50 km circle a city opens, so its name would not help. */
const SMALL_STATE_KM2 = 2500;
/** Country names said with "the" ("City in the United Kingdom", "the Philippines"). */
const WITH_THE = /^(United |Central African |Dominican |Isle of |US |British Indian )|^(Netherlands|Philippines|Bahamas|Maldives|Comoros|Seychelles|Gambia)$|\b(Islands|Lands)$/;
const inCountry = (country: string) => (WITH_THE.test(country) ? `the ${country}` : country);

/** "City in <state>, <country>" ("City in Riau, Indonesia"), or "City in <country>" when the state does not help: it is
 *  not known, it is a small district, it is the city itself under a longer name ("Ho Chi Minh City" in "Hồ Chí Minh
 *  city"), or the city is its country ("Hong Kong", "Kuwait City"). */
export function cityHint(c: Pick<City, 'name' | 'ascii'>, country: string, state?: { name: string; km2: number }): string {
  const name = foldName(c.name).s;
  const cores = new Set([name, c.ascii ? foldName(c.ascii).s : name].map(coreOf).filter(Boolean));
  const plain = `City in ${inCountry(country)}`;
  if (!state || state.km2 < SMALL_STATE_KM2 || cores.has(coreOf(foldName(country).s))) return plain;
  const own = foldName(ownName(state.name)).s;
  if (cores.has(coreOf(own)) && (hasCityWord(own) || hasCityWord(name))) return plain;
  return `City in ${state.name}`;
}

/** Cities whose state in the list is not the one they lie in: [name, ISO3, the state id from areas.json, or null when
 *  the place list has no state for it (the hint then names the country), and a hint of its own]. These are capital
 *  districts the place list lacks (Washington, D.C. is not in Maryland) or whose point falls outside them. Every entry
 *  is checked against the published lists in the tests. */
export const CITY_STATES: readonly [string, string, string | null, string?][] = [
  ['Washington, D.C.', 'USA', null], ['Abuja', 'NGA', 'NGA-3470'], ['Phnom Penh', 'KHM', null], ['Putrajaya', 'MYS', null],
  ['Vatican City', 'ITA', null, 'City state inside Rome, Italy'],
];

/** The state a city lies in. The list gives the state its point falls in; where the point lies just over a border
 *  (Kuala Lumpur in Selangor, Messina across the strait in Reggio Calabria) and the country has a state named after
 *  the city, the city lies in that one. Only a state the hint would name is replaced (a small one is not named), and
 *  never one that is the city under a longer name ("Lima Province", "Kiev City"). `named`: "<ISO3>|<folded own name>"
 *  to the state id. */
function cityState(c: City, states: Map<string, { name: string; km2: number }>, named: Map<string, string>): string | null {
  if (!c.state) return null;
  const st = states.get(c.state);
  if (!st || st.km2 < SMALL_STATE_KM2) return c.state;
  const own = foldName(ownName(st.name)).s;
  const names = [foldName(c.name).s, c.ascii ? foldName(c.ascii).s : ''].filter(Boolean);
  if (names.some((n) => n === own || coreOf(n) === coreOf(own))) return c.state;
  for (const n of names) {
    const twin = named.get(`${c.iso3}|${n}`);
    if (twin) return twin;
  }
  return c.state;
}

function cityEntry(c: City, countryName: Map<string, string>, states: Map<string, { name: string; km2: number }>, fixedHint?: string): Entry {
  const f = foldName(c.name);
  const country = countryName.get(c.iso3) ?? c.iso3;
  const hint = fixedHint ?? cityHint(c, country, c.state ? states.get(c.state) : undefined);
  const extra = c.ascii ? [foldName(c.ascii).s].filter((x) => x !== f.s) : [];
  return {
    key: cityKey(c), kind: 'city', label: c.name, f, short: f.s, compact: f.s.replace(/ /g, ''), extra, words: wordsOf(f.s), local: null,
    hint, area: null, city: c, size: c.pop, area2: 0,
  };
}

/** Builds the index from the places (areas.json with the world), their fire per year (key "<kind>:<id>", from
 *  web/places.json) and the cities. Fire and cities are optional: without fire the size is the area. */
export function buildIndex(areas: readonly NamedArea[], opts: { fire?: ReadonlyMap<string, number> | null; cities?: readonly City[] | null;
  picks?: PlacePicks | null } = {}): SearchIndex {
  const entries = areas.map(placeEntry);
  const byKey = new Map(entries.map((e) => [e.key, e]));
  // with the fire per year, a place missing from that list had no fire (its area only breaks ties)
  if (opts.fire) for (const e of entries) e.size = opts.fire.get(e.key) ?? 0;
  const countryName = new Map<string, string>(), stateName = new Map<string, string>();
  const states = new Map<string, { name: string; km2: number }>();
  for (const a of areas) {
    if (a.kind === 'country') countryName.set(a.id, tidy(a.name || a.id));
    else if (a.kind === 'state') { stateName.set(a.id, tidy(a.name || a.id)); states.set(a.id, { name: tidy(a.name || a.id), km2: a.area_km2 || 0 }); }
  }
  // the states by their own name in each country (the smaller of two: the city itself), to place the cities
  const named = new Map<string, string>();
  for (const a of areas) {
    if (a.kind !== 'state' || !a.country_iso3) continue;
    const k = `${a.country_iso3}|${foldName(ownName(tidy(a.name || a.id))).s}`;
    const old = named.get(k);
    if (!old || (states.get(old)?.km2 ?? 0) > (a.area_km2 || 0)) named.set(k, a.id);
  }
  const fixes = new Map(CITY_STATES.map(([name, iso3, state, hint]) => [`${name}|${iso3}`, { state, hint }]));
  const cities = (opts.cities ?? []).map((c) => {
    const fix = fixes.get(`${c.name}|${c.iso3}`);
    const state = fix ? fix.state : cityState(c, states, named);
    return state === c.state ? c : { ...c, state };
  });
  const twins = new Map<string, Entry[]>();
  for (const c of cities) {
    const e = cityEntry(c, countryName, states, fixes.get(`${c.name}|${c.iso3}`)?.hint);
    entries.push(e);
    if (!byKey.has(e.key)) byKey.set(e.key, e);
    const k = `${e.label}|${e.hint}`;
    twins.get(k)?.push(e) ?? twins.set(k, [e]);
  }
  // two cities of the same name with the same short hint: name their states after all
  for (const list of twins.values()) {
    if (list.length < 2) continue;
    for (const e of list) { const st = e.city?.state ? stateName.get(e.city.state) : undefined; if (st) e.hint = `City in ${st}`; }
  }
  const aliases = ALIASES.map((alias) => ({
    alias, say: alias.say.map((text) => { const f = normalise(text); return { f, c: f.replace(/ /g, ''), text }; }),
  }));
  const cityAliases: SearchIndex['cityAliases'] = [];
  for (const [text, name, iso3, how] of CITY_ALIASES) {
    const c = cities.find((x) => x.iso3 === iso3 && (x.name === name || x.ascii === name));
    if (c) { const f = normalise(text); cityAliases.push({ f, c: f.replace(/ /g, ''), key: cityKey(c), text, how }); }
  }
  return { entries, byKey, aliases, cityAliases, countryName, stateName, cities, picks: opts.picks ?? null, version: 0 };
}

// ------------------------------------------------------------------------------------------- matching

interface Query { s: string; c: string; words: string[] }

function makeQuery(text: string): Query | null {
  let s = normalise(text);
  if (s.startsWith('the ') && s.length > 6) s = s.slice(4);
  return s ? { s, c: s.replace(/ /g, ''), words: s.split(' ') } : null;
}

/** Ranges of the source label for a range of the folded label. */
function marksOf(f: Folded, ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of ranges) {
    if (b <= a || a >= f.at.length) continue;
    const start = f.at[a], end = f.at[Math.min(b, f.at.length) - 1] + 1;
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end); else out.push([start, end]);
  }
  return out;
}

/** How a folded name matches the query (without typos), with the matched ranges of the name. */
function matchName(f: Folded, words: { w: string; at: number }[], short: string, compact: string, q: Query):
  { kind: MatchKind; ranges: [number, number][] } | null {
  const s = f.s;
  if (short === q.s || s === q.s || (q.c.length >= 3 && compact === q.c)) return { kind: 'exact', ranges: [[0, short.length]] };
  if (s.startsWith(q.s)) return { kind: 'prefix', ranges: [[0, q.s.length]] };
  if (q.c.length >= 3 && compact.startsWith(q.c) && !q.s.includes(' ')) {
    // "bangkabel" for "Bangka-Belitung": highlight the letters it covers
    let n = 0, i = 0;
    while (i < s.length && n < q.c.length) { if (s[i] !== ' ') n++; i++; }
    return { kind: 'prefix', ranges: [[0, i]] };
  }
  // every word of the query starts a different word of the name, in any order ("kal tim", "riau indonesia")
  const used = new Set<number>();
  const ranges: [number, number][] = [];
  let all = true;
  for (const qw of q.words) {
    const k = words.findIndex((w, j) => !used.has(j) && w.w.startsWith(qw));
    if (k < 0) { all = false; break; }
    used.add(k);
    ranges.push([words[k].at, words[k].at + qw.length]);
  }
  if (all) return { kind: 'word', ranges: ranges.sort((a, b) => a[0] - b[0]) };
  if (q.s.length >= 3) {
    const i = s.indexOf(q.s);
    if (i >= 0) return { kind: 'substring', ranges: [[i, i + q.s.length]] };
  }
  return null;
}

/** A one letter typo of the query against a name: the whole name, one of its words or its start. A typo in both of
 *  the first two letters is not tried (that keeps it quick). */
function typoOf(s: string, words: { w: string }[], short: string, q: Query): boolean {
  if (q.c.length < 5) return false;
  const near = (x: string) => x[0] === q.s[0] || x[1] === q.s[1] || x[1] === q.s[0];
  if (!near(s) && !words.some((w) => near(w.w))) return false;
  if (withinOneEdit(q.s, short) || withinOneEdit(q.s, s)) return true;
  if (!q.s.includes(' ') && words.some((w) => Math.abs(w.w.length - q.s.length) <= 1 && withinOneEdit(q.s, w.w))) return true;
  for (let L = q.s.length - 1; L <= q.s.length + 1; L++) if (L >= 4 && L < s.length && withinOneEdit(q.s, s.slice(0, L))) return true;
  return false;
}

/** How a query matches another name. A start of a name counts once it covers half of it ("sumat", "bor"), so a
 *  short query does not pull in every member of a long name ("sou" is not yet "Southeast Asia"). */
function aliasMatch(said: { f: string; c: string }, q: Query): { kind: MatchKind; weak: boolean } | null {
  if (said.f === q.s || said.c === q.c) return { kind: 'exact', weak: false };
  // a start of another name ranks one step below the same match of a place's own name ("bor": Borno, then Borneo)
  const weak = q.c.length < Math.max(3, Math.ceil(said.c.length / 2));
  if (q.c.length >= 2 && (said.f.startsWith(q.s) || said.c.startsWith(q.c))) return { kind: 'word', weak };
  if (q.c.length >= 2 && q.words.every((qw) => said.f.split(' ').some((w) => w.startsWith(qw)))) return { kind: 'substring', weak };
  if (q.c.length >= 5 && (withinOneEdit(q.s, said.f) || withinOneEdit(q.c, said.c))) return { kind: 'typo', weak: false };
  return null;
}

interface Found { e: Entry; kind: MatchKind; ranges: [number, number][]; hint: string; loose?: boolean }

const better = (a: MatchKind, b: MatchKind) => RANK[a] < RANK[b];

/** Cities come after places of the same match, except a small state named like the city (the state "Kuala Lumpur" of
 *  300 km² is the city's own district: its 50 km circle says more), which comes after the cities. */
const placeTier = (x: Found): number => (x.e.city ? 1 : x.e.kind === 'state' && x.e.area2 < SMALL_STATE_KM2 && x.kind === 'exact' ? 2 : 0);

function compare(x: Found, y: Found): number {
  return RANK[x.kind] - RANK[y.kind]
    || (x.loose ? 1 : 0) - (y.loose ? 1 : 0)     // a typo of the whole name before a typo of one of its words
    || placeTier(x) - placeTier(y)
    || y.e.size - x.e.size
    || y.e.area2 - x.e.area2
    || KIND_ORDER[x.e.kind] - KIND_ORDER[y.e.kind]
    || (x.e.label < y.e.label ? -1 : x.e.label > y.e.label ? 1 : 0);
}

function toHit(x: Found): SearchHit {
  const e = x.e;
  const selection: AreaSelection = e.city
    ? { type: 'circle', lat: e.city.lat, lon: e.city.lon, radiusKm: CITY_RADIUS_KM }
    : { type: 'named', area: e.area as NamedArea };
  const link = e.city ? circleLink(e.city.lat, e.city.lon) : areaLink(e.kind, (e.area as NamedArea).id);
  return { key: e.key, kind: e.kind, label: e.label, hint: x.hint, marks: marksOf(e.f, x.ranges), match: x.kind,
    area: e.area, city: e.city, selection, link };
}

/** Places and cities for a query, best first: at most `limit` (the palette shows 8, the panel 12). Empty for an
 *  empty query. The index defaults to the shared one (see useSearchIndex); before it has loaded the result is empty. */
export function searchAreas(query: string, limit = 12, index: SearchIndex | null = current): SearchHit[] {
  const q = makeQuery(query);
  if (!q || !index) return [];
  const found = findAll(q, index);
  // "riau province", "irkutsk oblast": the state is found by its name without the word that says it is one
  const bare = ADMIN_WORD.exec(q.s);
  const q2 = bare ? makeQuery(bare[1]) : null;
  if (q2) {
    for (const x of findAll(q2, index).values()) {
      const old = found.get(x.e.key);
      if (x.e.kind === 'state' && (!old || better(x.kind, old.kind))) found.set(x.e.key, x);
    }
  }
  return [...found.values()].sort(compare).slice(0, limit).map(toHit);
}

const ADMIN_WORD = /^(.{3,}) (province|provinsi|state|oblast|krai|kray|region|prefecture|department|governorate)$/;

/** Every place and city that matches the query, with how. */
function findAll(q: Query, index: SearchIndex): Map<string, Found> {
  const found = new Map<string, Found>();
  const offer = (e: Entry | undefined, kind: MatchKind, ranges: [number, number][], hint: string) => {
    if (!e) return;
    const old = found.get(e.key);
    if (!old || better(kind, old.kind)) found.set(e.key, { e, kind, ranges, hint });
  };
  for (const e of index.entries) {
    let m = matchName(e.f, e.words, e.short, e.compact, q);
    // other names: an ISO3 code ("idn", "ind") or a city's ascii name count as fully as the name itself
    for (const x of e.extra) {
      if (x === q.s) { m = { kind: 'exact', ranges: m?.kind === 'exact' ? m.ranges : [] }; break; }
      if (!m && q.s.length >= 2 && x.startsWith(q.s)) m = { kind: 'prefix', ranges: [] };
    }
    if (m) offer(e, m.kind, m.ranges, e.hint);
    // a state's local name ("Kalimantan Tengah" for Central Kalimantan) counts as fully as its English one
    if (e.local) {
      const l = matchName(e.local.f, e.local.words, e.local.short, e.local.compact, q);
      // (the English label keeps its marks where it matched too; the hint names the local name only when it alone matched)
      if (l && (!m || better(l.kind, m.kind))) offer(e, l.kind, m ? m.ranges : [], m ? e.hint : `${e.hint}, local name ${e.local.text}`);
    }
  }
  for (const { say, alias } of index.aliases) {
    let best: { kind: MatchKind; weak: boolean; text: string } | null = null;
    for (const said of say) {
      const k = aliasMatch(said, q);
      if (k && (!best || better(k.kind, best.kind) || (best.weak && !k.weak && k.kind === best.kind))) best = { ...k, text: said.text };
    }
    if (!best) continue;
    const { weak, text } = best;
    const kind = alias.as && RANK[alias.as] > RANK[best.kind] ? alias.as : best.kind;
    const add = (key: string, where: string | null) => {
      const e = index.byKey.get(key);
      if (!e) return;
      const kindWord = KIND_LABEL[e.kind];
      const hint = where ? `${kindWord} ${where}` : `${kindWord}, ${alias.note ? alias.note(text) : `also known as ${text}`}`;
      const old = found.get(key);
      // a region lends its hint to a place found by its own name ("kal": "Kalimantan Barat", "State on Borneo"); a short
      // start of a long name ("kal" of "Kalimantan") does no more than that
      if (old && where && old.hint === e.hint) old.hint = hint;
      if (weak) return;
      if (!old || better(kind, old.kind)) found.set(key, { e, kind, ranges: old?.ranges ?? [], hint });
    };
    for (const key of alias.to) add(key, alias.region ?? null);
    if (alias.off) for (const key of alias.off.keys) add(key, alias.off.hint);
  }
  for (const ca of index.cityAliases) {
    const k = aliasMatch(ca, q);
    const e = index.byKey.get(ca.key);
    if (k && !k.weak && e) offer(e, k.kind, [], `${e.hint}, ${ca.how} ${ca.text}`);
  }
  // typos only when nothing matches by its start: "indonesai", "kalimantn", but "london" never finds "Rondônia"
  if (q.c.length >= 5 && ![...found.values()].some((x) => RANK[x.kind] <= RANK.word)) {
    for (const e of index.entries) {
      if (found.has(e.key) || !(typoOf(e.f.s, e.words, e.short, q) || e.extra.some((x) => withinOneEdit(q.s, x)))) continue;
      found.set(e.key, { e, kind: 'typo', ranges: [], hint: e.hint, loose: !withinOneEdit(q.s, e.short) && !withinOneEdit(q.c, e.compact) });
    }
  }
  return found;
}

/** Matched parts of any label (actions and pages in the palette): null when it does not match. */
export function matchLabel(label: string, query: string, keywords: readonly string[] = []): { kind: MatchKind; marks: [number, number][] } | null {
  const q = makeQuery(query);
  if (!q) return { kind: 'exact', marks: [] };
  const f = fold(label);
  const m = matchName(f, wordsOf(f.s), f.s, f.s.replace(/ /g, ''), q);
  if (m) return { kind: m.kind, marks: marksOf(f, m.ranges) };
  for (const k of keywords) {
    const kf = normalise(k);
    if (kf === q.s) return { kind: 'word', marks: [] };
    if (q.s.length >= 2 && (kf.startsWith(q.s) || kf.split(' ').some((w) => w.startsWith(q.s)))) return { kind: 'substring', marks: [] };
  }
  if (q.c.length >= 5 && typoOf(f.s, wordsOf(f.s), f.s, q)) return { kind: 'typo', marks: [] };
  return null;
}

export const matchRank = (k: MatchKind): number => RANK[k];

// ------------------------------------------------------------------------------------------- coordinates and months

/** "-2.2, 113.9", "2.2 S 113.9 E", "2.2°S, 113.9°E" → { lat, lon }; null for anything else. */
export function parseCoords(text: string): { lat: number; lon: number } | null {
  const t = text.trim().replace(/−/g, '-').replace(/°/g, ' ');
  const m = /^(-?\d{1,2}(?:[.,]\d+)?)\s*([NS])?\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*([EW])?$/i.exec(t);
  if (!m) return null;
  let lat = Number(m[1].replace(',', '.')), lon = Number(m[3].replace(',', '.'));
  if (m[2] && /s/i.test(m[2])) lat = -Math.abs(lat);
  if (m[4] && /w/i.test(m[4])) lon = -Math.abs(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (!m[1].includes('.') && !m[1].includes(',') && !m[3].includes('.') && !m[2] && !m[4] && !text.includes(',')) return null;  // "2019 9" is a month
  return { lat, lon };
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "2019-09", "09/2019", "sep 2019", "September 2019", "2019 sept" → 201909; null for anything else. */
export function parseMonth(text: string): number | null {
  const t = normalise(text);
  let m = /^(\d{4}) (\d{1,2})$/.exec(t) ?? null;
  let yr: number | null = null, mo: number | null = null;
  if (m) { yr = Number(m[1]); mo = Number(m[2]); }
  else if ((m = /^(\d{1,2}) (\d{4})$/.exec(t))) { mo = Number(m[1]); yr = Number(m[2]); }
  else if ((m = /^([a-z]{3,9}) (\d{4})$/.exec(t)) || (m = /^(\d{4}) ([a-z]{3,9})$/.exec(t))) {
    const word = /^\d/.test(m[1]) ? m[2] : m[1];
    yr = Number(/^\d/.test(m[1]) ? m[1] : m[2]);
    const i = MONTH_NAMES.findIndex((n) => n.startsWith(word) || (word.length >= 4 && withinOneEdit(word, n)));
    mo = i >= 0 && word.length >= 3 ? i + 1 : null;
  }
  if (yr === null || mo === null || mo < 1 || mo > 12 || yr < 2000 || yr > 2100) return null;
  return yr * 100 + mo;
}

// ------------------------------------------------------------------------------------------- distances and city names

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The city within maxKm of a point (the nearest), with its name for a title ("Palangkaraya, Indonesia"). */
export function cityNear(lat: number, lon: number, maxKm = 1, index: SearchIndex | null = current): { city: City; name: string } | null {
  if (!index || !index.cities.length) return null;
  let best: City | null = null, bestKm = maxKm;
  const dLat = maxKm / 111 + 1e-6;
  for (const c of index.cities) {
    if (Math.abs(c.lat - lat) > dLat) continue;
    const km = distanceKm(lat, lon, c.lat, c.lon);
    if (km <= bestKm) { best = c; bestKm = km; }
  }
  if (!best) return null;
  return { city: best, name: `${best.name}, ${index.countryName.get(best.iso3) ?? best.iso3}` };
}

// ------------------------------------------------------------------------------------------- the shared index

let current: SearchIndex | null = null;
let version = 0;
const listeners = new Set<() => void>();
let started = false;
let parts: { areas: NamedArea[] | null; fire: Map<string, number> | null; cities: City[] | null; picks: PlacePicks | null } =
  { areas: null, fire: null, cities: null, picks: null };

function publish(): void {
  if (!parts.areas) return;
  current = buildIndex(parts.areas, { fire: parts.fire, cities: parts.cities, picks: parts.picks });
  current.version = ++version;
  for (const f of listeners) f();
}

/** The fields of a web/places.json row the search reads. */
export interface PlaceRowLite {
  kind: string; id: string; name: string | null; mean_per_year: number | null;
  latest_ym?: number | null; latest?: number | null; latest_normal?: number | null; latest_ratio?: number | null;
}
interface PlacesFile { rows: PlaceRowLite[] }

/** One place an empty search suggests, with what makes it worth a look. */
export interface PlacePick { kind: 'country' | 'state'; id: string; name: string; ratio: number | null; ym: number | null; perYear: number }
export interface PlacePicks { hot: PlacePick[]; most: PlacePick[] }

/** Fire floor of a suggestion: a country or a state with at least 1,000 hotspots a year (the trend test's floor). */
const PICK_FIRE = 1000;

/** What an empty search suggests (web/places.json): the countries and states furthest above their normal in the latest
 *  month (their mean of at least 1,000 hotspots a year, and the month's own normal at least 1,000 too, so a fire season
 *  is under way and a ratio is not that of a near empty month: 1,730 against a normal of 14 is "120 times"), and the
 *  places with the most fire a year. Never Antarctica or the open ocean (continents are not offered). */
export function placePicks(rows: readonly PlaceRowLite[], nHot = 3, nMost = 2): PlacePicks {
  const named = rows.filter((r): r is PlaceRowLite & { kind: 'country' | 'state' } => (r.kind === 'country' || r.kind === 'state')
    && (r.mean_per_year ?? 0) >= PICK_FIRE && Boolean(r.name));
  const pick = (r: PlaceRowLite & { kind: 'country' | 'state' }): PlacePick => ({ kind: r.kind, id: r.id, name: r.name ?? r.id,
    ratio: r.latest_ratio ?? null, ym: r.latest_ym ?? null, perYear: r.mean_per_year ?? 0 });
  const hot = named.filter((r) => (r.latest_ratio ?? 0) > 1 && (r.latest_normal ?? 0) >= PICK_FIRE)
    .sort((a, b) => (b.latest_ratio ?? 0) - (a.latest_ratio ?? 0) || a.id.localeCompare(b.id)).slice(0, nHot).map(pick);
  const most = [...named].sort((a, b) => (b.mean_per_year ?? 0) - (a.mean_per_year ?? 0) || a.id.localeCompare(b.id))
    .filter((r) => !hot.some((h) => h.id === r.id)).slice(0, nMost).map(pick);
  return { hot, most };
}

/** Starts loading the place list, then the fire per place and the cities (once). Safe to call often. */
export function warmSearch(): void {
  if (started) return;
  started = true;
  void Promise.all([import('./data'), import('./web')]).then(([data, web]) => {
    data.loadAreas().then((areas) => { parts = { ...parts, areas }; publish(); }, () => { started = false; });
    // the bigger files, in the background: the order of equal matches by fire, and the cities
    web.webTake<PlacesFile>('places.json').then((f) => {
      if (!f) return;
      const fire = new Map<string, number>();
      for (const r of f.rows) if (r.mean_per_year !== null && r.mean_per_year !== undefined) fire.set(`${r.kind}:${r.id}`, r.mean_per_year);
      parts = { ...parts, fire, picks: placePicks(f.rows) };
      publish();
    }, () => undefined);
    web.webJson<CitiesFile>('cities.json').then((f) => {
      if (!f) return;
      parts = { ...parts, cities: readCities(f) };
      publish();
    }, () => undefined);
  }, () => { started = false; });
}

function subscribe(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** The shared index (null until the place list has loaded); re-renders when the fire sizes or the cities arrive.
 *  Starts the loading the first time a component asks (pass false to only listen). */
export function useSearchIndex(load = true): SearchIndex | null {
  useEffect(() => { if (load) warmSearch(); }, [load]);
  return useSyncExternalStore(subscribe, () => current, () => null);
}

/** The name of the city at the centre of a circle (within 1 km), once the cities have loaded ("Palangkaraya,
 *  Indonesia"); null otherwise. Loads the cities when asked for a circle. */
export function useCircleCity(sel: AreaSelection | null): string | null {
  const circle = sel?.type === 'circle' ? sel : null;
  const index = useSearchIndex(circle !== null);
  const lat = circle?.lat ?? null, lon = circle?.lon ?? null;
  return useMemo(() => (lat === null || lon === null ? null : cityNear(lat, lon, 1, index)?.name ?? null), [lat, lon, index]);
}

// ------------------------------------------------------------------------------------------- recent places

const RECENT_KEY = 'fh_recent_places';
const RECENT_MAX = 5;

/** A place picked lately (kept in localStorage, newest first). */
export interface RecentPlace { key: string; kind: HitKind; label: string; hint: string; link: string; selection: AreaSelection }

function readRecent(): unknown[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

/** Recent places, resolved against the index where it has loaded (older entries were only "<kind>:<id>" keys). */
export function recentPlaces(index: SearchIndex | null = current): RecentPlace[] {
  const out: RecentPlace[] = [];
  for (const r of readRecent()) {
    if (typeof r === 'string') {
      const e = index?.byKey.get(r);
      if (e?.area) out.push({ key: e.key, kind: e.kind, label: e.label, hint: e.hint, link: areaLink(e.kind, e.area.id), selection: { type: 'named', area: e.area } });
    } else if (r && typeof r === 'object' && 'key' in r && 'label' in r && 'link' in r) {
      const p = r as RecentPlace;
      if (p.selection?.type === 'named' && index && !index.byKey.has(p.key)) continue;   // a place that is no longer in the list
      const e = index?.byKey.get(p.key);
      out.push(e?.area ? { ...p, label: e.label, selection: { type: 'named', area: e.area } } : p);
    }
  }
  return out.slice(0, RECENT_MAX);
}

let recentVersion = 0;
const recentListeners = new Set<() => void>();
function recentChanged(): void {
  recentVersion++;
  for (const f of recentListeners) f();
}

/** Puts a place first in the recent places (and tells every list that shows them). */
export function rememberPlace(p: Pick<SearchHit, 'key' | 'kind' | 'label' | 'hint' | 'link' | 'selection'>): void {
  try {
    const entry: RecentPlace = { key: p.key, kind: p.kind, label: p.label, hint: p.hint, link: p.link,
      selection: p.selection.type === 'named' ? { type: 'named', area: p.selection.area } : p.selection };
    const rest = readRecent().filter((r) => (typeof r === 'string' ? r : (r as RecentPlace)?.key) !== p.key);
    localStorage.setItem(RECENT_KEY, JSON.stringify([entry, ...rest].slice(0, RECENT_MAX)));
  } catch { /* private mode */ }
  recentChanged();
}

function subscribeRecent(f: () => void): () => void {
  recentListeners.add(f);
  // a pick in another tab
  const onStorage = (e: StorageEvent) => { if (e.key === RECENT_KEY || e.key === null) recentChanged(); };
  window.addEventListener('storage', onStorage);
  return () => { recentListeners.delete(f); window.removeEventListener('storage', onStorage); };
}

/** A number that changes whenever the recent places change: a pick in the palette, the panel or another tab. */
export function useRecentVersion(): number {
  return useSyncExternalStore(subscribeRecent, () => recentVersion, () => 0);
}

/** A point typed as coordinates, as a hit that opens a circle (named after a city when one is within 1 km). */
export function pointHit(lat: number, lon: number, km: number = CITY_RADIUS_KM, index: SearchIndex | null = current): SearchHit {
  const near = cityNear(lat, lon, 1, index);
  const where = near ? near.name : `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
  return {
    key: `circle:${linkNumber(lat)},${linkNumber(lon)},${km}`, kind: 'point', label: `${km} km around ${where}`, hint: 'A circle on the map',
    marks: [], match: 'exact', area: null, city: near?.city ?? null, selection: { type: 'circle', lat, lon, radiusKm: km }, link: circleLink(lat, lon, km),
  };
}

// ------------------------------------------------------------------------------------------- placeholders that fit

let measure: CanvasRenderingContext2D | null = null;

/** The longest of the candidate texts that fits the input's free width (its font and paddings), else the last. */
export function fittingPlaceholder(input: HTMLInputElement, candidates: readonly string[]): string {
  const cs = getComputedStyle(input);
  const room = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
  measure ??= document.createElement('canvas').getContext('2d');
  if (!measure || room <= 0) return candidates[candidates.length - 1] ?? '';
  measure.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return candidates.find((c) => measure!.measureText(c).width <= room) ?? candidates[candidates.length - 1] ?? '';
}

/** Keeps an input's placeholder to the longest candidate that fits, as the input changes size. `shown`: pass false
 *  while the input is not rendered (it is measured again when it appears). */
export function useFittingPlaceholder(ref: { current: HTMLInputElement | null }, candidates: readonly string[], shown = true): string {
  const [text, setText] = useState(candidates[0] ?? '');
  const key = candidates.join('|');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!shown || !el || typeof ResizeObserver === 'undefined') return undefined;
    let alive = true;
    const update = () => { if (alive) setText(fittingPlaceholder(el, candidates)); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    void document.fonts?.ready.then(update);
    return () => { alive = false; ro.disconnect(); };
  }, [ref, key, shown]); // eslint-disable-line react-hooks/exhaustive-deps
  return text;
}

/** A label cut into its matched and unmatched parts, for <mark>. */
export function markedParts(text: string, marks: readonly [number, number][]): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [a, b] of marks) {
    if (a > at) out.push({ text: text.slice(at, a), hit: false });
    if (b > a) out.push({ text: text.slice(Math.max(a, at), b), hit: true });
    at = Math.max(at, b);
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}
