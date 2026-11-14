// The place search: folding, ranking, aliases, typos, cities, coordinates and months. The first block uses a small
// made up list; the second runs on the published place and city lists when they are on this machine.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ALIASES, CITY_ALIASES, CITY_STATES, buildIndex, cityHint, cityNear, fold, matchLabel, normalise, parseCoords, parseMonth, placePicks,
  readCities, searchAreas, withinOneEdit, type CitiesFile, type City, type PlaceRowLite, type SearchIndex,
} from './search';
import { englishName, localName, withEnglishName } from './names';
import type { NamedArea } from './types';

const A = (kind: NamedArea['kind'], id: string, name: string, area_km2: number, iso3: string | null = null): NamedArea =>
  ({ kind, id, name, country_iso3: iso3, lat: 0, lon: 0, cells: 1, area_km2 });

const AREAS: NamedArea[] = [
  A('world', 'WORLD', 'World', 0),
  A('continent', 'Asia', 'Asia', 34e6),
  A('country', 'IDN', 'Indonesia', 1.9e6, 'IDN'),
  A('country', 'BRA', 'Brazil', 8.5e6, 'BRA'),
  A('country', 'CIV', "Côte d'Ivoire", 3.2e5, 'CIV'),
  A('country', 'USA', 'United States of America', 9.5e6, 'USA'),
  A('country', 'VNM', 'Vietnam', 3.3e5, 'VNM'),
  A('country', 'BRN', 'Brunei', 5.8e3, 'BRN'),
  A('state', 'IDN-1228', 'Kalimantan Barat, Indonesia', 158e3, 'IDN'),
  A('state', 'IDN-1234', 'Kalimantan Selatan, Indonesia', 38e3, 'IDN'),
  A('state', 'IDN-1931', 'Kalimantan Tengah, Indonesia', 153e3, 'IDN'),
  A('state', 'IDN-1185', 'Kalimantan Timur, Indonesia', 176e3, 'IDN'),
  A('state', 'IDN-492', 'Riau, Indonesia', 90e3, 'IDN'),
  A('state', 'IDN-1796', 'Kepulauan Riau, Indonesia', 8e3, 'IDN'),
  A('state', 'IDN-1231', 'Bangka-Belitung, Indonesia', 16e3, 'IDN'),
  A('state', 'MYS-1186', 'Sabah, Malaysia', 73e3, 'MYS'),
  A('state', 'MYS-1187', 'Sarawak, Malaysia', 124e3, 'MYS'),
  A('state', 'RUS-2390', 'Kalmyk, Russia', 75e3, 'RUS'),
  A('state', 'RUS-2361', 'Kaluga, Russia', 28e3, 'RUS'),
  A('state', 'BRA-594', 'Pará, Brazil', 1.1e6, 'BRA'),
  A('state', 'BRA-613', 'Paraná, Brazil', 2e5, 'BRA'),
  A('state', 'BRA-1311', 'São Paulo, Brazil', 2.5e5, 'BRA'),
  A('state', 'VNM-1', 'Hà Nam, Vietnam', 860, 'VNM'),
];
const FIRE = new Map([['state:IDN-1931', 9e4], ['state:IDN-1228', 8e4], ['state:IDN-1185', 5e4], ['state:IDN-1234', 3e4],
  ['state:RUS-2390', 2e3], ['state:RUS-2361', 500]]);
const CITIES_FILE: CitiesFile = {
  version: 1, source: 'test', columns: ['name', 'ascii', 'iso3', 'state', 'lat', 'lon', 'pop', 'capital'],
  rows: [
    ['São Paulo', 'Sao Paulo', 'BRA', 'BRA-1311', -23.5567, -46.627, 18845000, 1],
    ['Jakarta', null, 'IDN', null, -6.17, 106.83, 9125000, 2],
    ['Pekanbaru', null, 'IDN', 'IDN-492', 0.5333, 101.45, 799000, 1],
    ['Palangkaraya', null, 'IDN', 'IDN-1931', -2.21, 113.92, 148289, 1],
    ['Kansas City', null, 'USA', null, 39.109, -94.606, 1469000, 0],
    ['Kansas City', null, 'USA', null, 39.1136, -94.6301, 501577, 0],
  ],
};
const index = (fire = true): SearchIndex => buildIndex(AREAS, { fire: fire ? FIRE : null, cities: readCities(CITIES_FILE) });
const labels = (q: string, limit = 12, ix = index()) => searchAreas(q, limit, ix).map((h) => h.label);

describe('folding', () => {
  it('ignores case, accents, quotes and punctuation', () => {
    expect(normalise('São Paulo, Brazil')).toBe('sao paulo brazil');
    expect(normalise("Côte d'Ivoire")).toBe('cote divoire');
    expect(normalise('  Bangka-Belitung ')).toBe('bangka belitung');
    expect(normalise('Łódź')).toBe('lodz');
    expect(normalise('Ærø')).toBe('aero');
  });
  it('keeps where each folded letter came from', () => {
    const f = fold("Côte d'Ivoire");
    expect(f.s).toBe('cote divoire');
    expect(f.at.length).toBe(f.s.length);
    expect(f.at[5]).toBe(5);    // the "d"
    expect(f.at[6]).toBe(7);    // the "i" after the quote
  });
  it('allows one edit and no more', () => {
    expect(withinOneEdit('indonesia', 'indonesai')).toBe(true);    // swap
    expect(withinOneEdit('sumatra', 'sumatera')).toBe(true);       // insertion
    expect(withinOneEdit('kalimantan', 'kalimentan')).toBe(true);  // substitution
    expect(withinOneEdit('sumatra', 'sumatara')).toBe(true);
    expect(withinOneEdit('brazil', 'brasol')).toBe(false);
  });
});

describe('ranking', () => {
  it('ranks exact, prefix, word, substring', () => {
    const hits = searchAreas('riau', 12, index());
    expect(hits[0].label).toBe('Riau, Indonesia');
    expect(hits[0].match).toBe('exact');
    expect(hits.find((h) => h.label.startsWith('Kepulauan'))?.match).toBe('word');
    expect(searchAreas('alima', 12, index()).every((h) => h.match === 'substring')).toBe(true);
  });
  it('breaks ties by fire per year, else by area', () => {
    expect(labels('kal').slice(0, 4)).toEqual([
      'Kalimantan Tengah, Indonesia', 'Kalimantan Barat, Indonesia', 'Kalimantan Timur, Indonesia', 'Kalimantan Selatan, Indonesia']);
    expect(labels('kal', 12, index(false)).slice(0, 3)).toEqual([
      'Kalimantan Timur, Indonesia', 'Kalimantan Barat, Indonesia', 'Kalimantan Tengah, Indonesia']);
  });
  it('gives the same order for any limit (panel 12, palette 8)', () => {
    expect(labels('kal', 8)).toEqual(labels('kal', 12).slice(0, 8));
  });
  it('matches every word of the query in any order', () => {
    expect(labels('kal tim')[0]).toBe('Kalimantan Timur, Indonesia');
    expect(labels('indonesia riau')[0]).toBe('Riau, Indonesia');
  });
  it('finds ISO3 codes and the short form of names', () => {
    expect(labels('idn')[0]).toBe('Indonesia');
    expect(labels('viet nam')[0]).toBe('Vietnam');
    expect(labels('bangka belitung')[0]).toBe('Bangka-Belitung, Indonesia');
    expect(labels('bangkabel')[0]).toBe('Bangka-Belitung, Indonesia');
  });
  it('ignores accents both ways', () => {
    expect(labels('para')[0]).toBe('Pará, Brazil');
    expect(labels('paraná')[0]).toBe('Paraná, Brazil');
    expect(labels("cote d'ivoire")[0]).toBe("Côte d'Ivoire");
    expect(labels('cote divoire')[0]).toBe("Côte d'Ivoire");
  });
  it('marks the matched letters of the label', () => {
    const [hit] = searchAreas('sao', 12, index());
    expect(hit.label).toBe('São Paulo, Brazil');
    expect(hit.marks).toEqual([[0, 3]]);
    const word = searchAreas('kal tim', 12, index())[0];
    expect(word.marks).toEqual([[0, 3], [11, 14]]);
  });
  it('tolerates one typo from 5 letters', () => {
    expect(labels('indonesai')[0]).toBe('Indonesia');
    expect(labels('kalimantn')[0]).toMatch(/^Kalimantan/);
    expect(searchAreas('kalimantn', 12, index())[0].match).toBe('typo');
    expect(labels('riua')).toEqual([]);    // 4 letters: no typo
  });
});

describe('aliases', () => {
  it('lists the provinces of an island with a hint', () => {
    const hits = searchAreas('borneo', 12, index());
    expect(hits.map((h) => h.label).slice(0, 4)).toEqual([
      'Kalimantan Tengah, Indonesia', 'Kalimantan Barat, Indonesia', 'Kalimantan Timur, Indonesia', 'Kalimantan Selatan, Indonesia']);
    expect(hits.map((h) => h.label)).toEqual(expect.arrayContaining(['Sabah, Malaysia', 'Sarawak, Malaysia', 'Brunei']));
    expect(hits[0].hint).toBe('State on Borneo');
    expect(hits.find((h) => h.label === 'Brunei')?.hint).toBe('Country on Borneo');
    const sumatra = searchAreas('sumatra', 12, index());
    expect(sumatra.find((h) => h.label === 'Riau, Indonesia')?.hint).toBe('State on Sumatra');
    expect(sumatra.find((h) => h.label.startsWith('Kepulauan'))?.hint).toBe('State off Sumatra');
  });
  it('gives the island hint to a plain name match of equal rank', () => {
    expect(searchAreas('kal', 12, index())[0].hint).toBe('State on Borneo');
  });
  it('finds common names of countries', () => {
    for (const q of ['usa', 'US', 'america', 'United States']) expect(labels(q)[0]).toBe('United States of America');
    expect(labels('ivory coast')[0]).toBe("Côte d'Ivoire");
    expect(searchAreas('ivory coast', 12, index())[0].hint).toBe('Country, also known as Ivory Coast');
    expect(labels('brasil')[0]).toBe('Brazil');
    expect(labels('the brasil')[0]).toBe('Brazil');
  });
  it('does not let a short start pull in a long region name', () => {
    expect(labels('sou')).not.toContain('Indonesia');
    expect(labels('sumat')).toContain('Riau, Indonesia');
  });
});

describe('cities', () => {
  it('come after places of the same rank, with a hint that tells them apart', () => {
    const hits = searchAreas('sao paulo', 12, index());
    expect(hits.map((h) => `${h.kind}:${h.label}`).slice(0, 2)).toEqual(['state:São Paulo, Brazil', 'city:São Paulo']);
    expect(hits[1].hint).toBe('City in São Paulo, Brazil');
    // a capital is a city like any other (the source's capital flag also marks some cities that are not)
    expect(searchAreas('jakarta', 12, index())[0].hint).toBe('City in Indonesia');
  });
  it('name the state only where it helps', () => {
    const c = (name: string, ascii: string | null = null) => ({ name, ascii });
    expect(cityHint(c('Pekanbaru'), 'Indonesia', { name: 'Riau, Indonesia', km2: 9e4 })).toBe('City in Riau, Indonesia');
    expect(cityHint(c('São Paulo'), 'Brazil', { name: 'São Paulo, Brazil', km2: 2.5e5 })).toBe('City in São Paulo, Brazil');
    // a district far smaller than the 50 km circle, a state that is the city itself, a city that is its country
    expect(cityHint(c('London'), 'United Kingdom', { name: 'Southwark, United Kingdom', km2: 226 })).toBe('City in the United Kingdom');
    expect(cityHint(c('Ho Chi Minh City'), 'Vietnam', { name: 'Hồ Chí Minh city, Vietnam', km2: 3000 })).toBe('City in Vietnam');
    expect(cityHint(c('St. Petersburg'), 'Russia', { name: 'City of St. Petersburg, Russia', km2: 2740 })).toBe('City in Russia');
    expect(cityHint(c('Hong Kong'), 'Hong Kong', { name: 'Sai Kung, Hong Kong', km2: 739 })).toBe('City in Hong Kong');
    expect(cityHint(c('Kuwait City'), 'Kuwait', { name: 'Al Asimah, Kuwait', km2: 1209 })).toBe('City in Kuwait');
    expect(cityHint(c('Manila'), 'Philippines', undefined)).toBe('City in the Philippines');
  });
  it('open a circle of 50 km', () => {
    const [hit] = searchAreas('palangka', 12, index());
    expect(hit.kind).toBe('city');
    expect(hit.selection).toEqual({ type: 'circle', lat: -2.21, lon: 113.92, radiusKm: 50 });
    expect(hit.link).toBe('#/?area=circle:-2.21,113.92,50');
    expect(searchAreas('pekanbaru', 12, index())[0].hint).toBe('City in Riau, Indonesia');
  });
  it('drop exact duplicates', () => {
    expect(labels('kansas city').filter((l) => l === 'Kansas City')).toHaveLength(1);
  });
  it('name their states when two of the same name would read the same', () => {
    const file: CitiesFile = { ...CITIES_FILE, rows: [
      ['Santa Rita', null, 'BRA', 'BRA-594', -1.3, -48.0, 50000, 0], ['Santa Rita', null, 'BRA', 'BRA-1311', -22.0, -47.0, 40000, 0],
    ] };
    const small = AREAS.map((a) => (a.kind === 'state' ? { ...a, area_km2: 100 } : a));
    const ix = buildIndex(small, { cities: readCities(file) });
    expect(searchAreas('santa rita', 12, ix).map((h) => h.hint).sort()).toEqual(['City in Pará, Brazil', 'City in São Paulo, Brazil']);
  });
  it('lie in the state named after them when their point falls just over its border', () => {
    const areas = [...AREAS, A('country', 'MYS', 'Malaysia', 3.3e5, 'MYS'), A('country', 'ITA', 'Italy', 3e5, 'ITA'),
      A('country', 'PER', 'Peru', 1.3e6, 'PER'), A('state', 'MYS-1', 'Selangor, Malaysia', 11500, 'MYS'), A('state', 'MYS-2', 'Kuala Lumpur, Malaysia', 295, 'MYS'),
      A('state', 'ITA-1', 'Reggio Calabria, Italy', 5400, 'ITA'), A('state', 'ITA-2', 'Messina, Italy', 7400, 'ITA'),
      A('state', 'PER-1', 'Lima Province, Peru', 3900, 'PER'), A('state', 'PER-2', 'Lima, Peru', 35000, 'PER')];
    const file: CitiesFile = { ...CITIES_FILE, rows: [
      ['Kuala Lumpur', null, 'MYS', 'MYS-1', 3.17, 101.7, 1448000, 2], ['Messina', null, 'ITA', 'ITA-1', 38.2, 15.55, 252000, 0],
      ['Lima', null, 'PER', 'PER-1', -12.05, -77.05, 8012000, 2], ['Pekanbaru', null, 'IDN', 'IDN-492', 0.5333, 101.45, 799000, 1],
    ] };
    const ix = buildIndex(areas, { cities: readCities(file) });
    const hint = (q: string) => searchAreas(q, 12, ix).find((h) => h.kind === 'city')?.hint;
    expect(hint('kuala lumpur')).toBe('City in Malaysia');           // its own state, too small to name
    expect(hint('messina')).toBe('City in Messina, Italy');
    expect(hint('lima')).toBe('City in Peru');                       // "Lima Province" is the city itself
    expect(hint('pekanbaru')).toBe('City in Riau, Indonesia');
    expect(searchAreas('kuala lumpur', 12, ix).find((h) => h.kind === 'city')?.city?.state).toBe('MYS-2');
  });
  it('name a circle within 1 km', () => {
    const ix = index();
    expect(cityNear(-2.2101, 113.9203, 1, ix)?.name).toBe('Palangka Raya, Indonesia');
    expect(cityNear(-2.3, 113.92, 1, ix)).toBeNull();
  });
});

describe('labels, coordinates and months', () => {
  it('finds a state named with the word for one ("riau province", "sao paulo state")', () => {
    expect(labels('riau province')[0]).toBe('Riau, Indonesia');
    expect(searchAreas('sao paulo state', 12, index()).map((h) => h.kind)).toEqual(['state']);
  });
  it('matches actions and pages with their marks', () => {
    expect(matchLabel('Colour against normal', 'against')).toEqual({ kind: 'word', marks: [[7, 14]] });
    expect(matchLabel('Switch light or dark', 'theme', ['theme'])?.kind).toBe('word');
    expect(matchLabel('Dashboard', 'xyz')).toBeNull();
  });
  it('reads coordinates', () => {
    expect(parseCoords('-2.2, 113.9')).toEqual({ lat: -2.2, lon: 113.9 });
    expect(parseCoords('2.2°S, 113.9°E')).toEqual({ lat: -2.2, lon: 113.9 });
    expect(parseCoords('2.2 S 113.9 E')).toEqual({ lat: -2.2, lon: 113.9 });
    expect(parseCoords('95, 10')).toBeNull();
    expect(parseCoords('riau')).toBeNull();
  });
  it('reads months', () => {
    expect(parseMonth('2019-09')).toBe(201909);
    expect(parseMonth('09/2019')).toBe(201909);
    expect(parseMonth('sep 2019')).toBe(201909);
    expect(parseMonth('September 2019')).toBe(201909);
    expect(parseMonth('2019 sept')).toBe(201909);
    expect(parseMonth('2019')).toBeNull();
    expect(parseMonth('13/2019')).toBeNull();
  });
});

describe('English names, local names as a second name', () => {
  it('writes out the names of the report (lib/names.ts)', () => {
    expect(englishName('state', 'IDN-1931', 'Kalimantan Tengah, Indonesia')).toBe('Central Kalimantan, Indonesia');
    expect(localName('state', 'IDN-1931', 'Kalimantan Tengah, Indonesia')).toBe('Kalimantan Tengah');
    expect(englishName('country', 'COD', 'Dem. Rep. Congo')).toBe('DR Congo');
    expect(englishName('country', 'SSD', 'S. Sudan')).toBe('South Sudan');
    expect(englishName('state', 'COD-1871', 'Bandundu, Dem. Rep. Congo')).toBe('Bandundu, DR Congo');
    expect(localName('state', 'COD-1871', 'Bandundu, Dem. Rep. Congo')).toBeNull();
    expect(englishName('continent', 'Seven seas (open ocean)', 'Seven seas (open ocean)')).toBe('Open ocean');
    expect(englishName('city', '', 'Palangkaraya')).toBe('Palangka Raya');
    expect(englishName('state', 'IDN-492', 'Riau, Indonesia')).toBe('Riau, Indonesia');
  });
  it('finds a state by its English and by its local name', () => {
    const ix = buildIndex(AREAS.map(withEnglishName), { fire: FIRE, cities: readCities(CITIES_FILE) });
    for (const q of ['central kalimantan', 'kalimantan tengah', 'kalteng']) {
      const hit = searchAreas(q, 12, ix)[0];
      expect(hit.key, q).toBe('state:IDN-1931');
      expect(hit.label, q).toBe('Central Kalimantan, Indonesia');
    }
    expect(searchAreas('kalimantan tengah', 12, ix)[0].hint).toBe('State, local name Kalimantan Tengah');
    expect(searchAreas('central kalimantan', 12, ix)[0].marks).toEqual([[0, 18]]);
    // the city keeps its older spelling as a second name
    expect(searchAreas('palangkaraya', 4, ix)[0].label).toBe('Palangka Raya');
    expect(searchAreas('palangka raya', 4, ix)[0].label).toBe('Palangka Raya');
  });
  it('puts a city before a small state of the same name', () => {
    const areas = [...AREAS, A('state', 'MYS-4831', 'Kuala Lumpur, Malaysia', 300, 'MYS'), A('state', 'MYS-1140', 'Selangor, Malaysia', 8e3, 'MYS'),
      A('country', 'MYS', 'Malaysia', 3.3e5, 'MYS')];
    const file: CitiesFile = { ...CITIES_FILE, rows: [...CITIES_FILE.rows, ['Kuala Lumpur', null, 'MYS', 'MYS-1140', 3.1667, 101.7, 1448000, 2]] };
    const ix = buildIndex(areas, { cities: readCities(file) });
    const hits = searchAreas('Kuala Lumpur', 12, ix);
    expect(hits[0].kind).toBe('city');
    expect(hits[1].key).toBe('state:MYS-4831');
    // a big state of the city's name still comes first ("Riau" the province, not a city)
    expect(searchAreas('sao paulo', 12, ix)[0].kind).toBe('state');
  });
  it('suggests places far above normal with a real season, and those with the most fire', () => {
    const row = (kind: string, id: string, mean: number, ratio: number | null, normal: number): PlaceRowLite =>
      ({ kind, id, name: id, mean_per_year: mean, latest_ym: 202610, latest: (ratio ?? 0) * normal, latest_normal: normal, latest_ratio: ratio });
    const rows = [row('world', 'WORLD', 1.7e7, 0.9, 1.4e6), row('continent', 'Antarctica', 65, 50, 2), row('state', 'NGA-2872', 12858, 119.7, 14),
      row('state', 'IDN-1931', 47422, 13.8, 4748), row('state', 'PNG-1248', 20000, 15.7, 1200), row('country', 'COD', 1.6e6, 0.8, 9e4),
      row('country', 'BRA', 1.5e6, 1.1, 2e5), row('state', 'X-1', 900, 40, 1500), row('country', 'IDN', 2e5, 9.8, 3e4)];
    const p = placePicks(rows);
    expect(p.hot.map((x) => x.id)).toEqual(['PNG-1248', 'IDN-1931', 'IDN']);
    expect(p.most.map((x) => x.id)).toEqual(['COD', 'BRA']);
  });
});

// ------------------------------------------------------------------------------------------- the published lists

const DATA = process.env.FIRE_DATA_DIR ?? path.join(os.homedir(), 'nasa_work/data/products/v1.0');
const have = fs.existsSync(path.join(DATA, 'areas.json')) && fs.existsSync(path.join(DATA, 'web/cities.json'));

describe.skipIf(!have)('on the published lists', () => {
  const read = <T,>(f: string): T => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')) as T;
  // in English, as the app loads them (data.ts loadAreas, web.ts for places.json)
  const areas: NamedArea[] = have ? [A('world', 'WORLD', 'World', 0), ...read<NamedArea[]>('areas.json').map(withEnglishName)] : [];
  const places: PlaceRowLite[] = have && fs.existsSync(path.join(DATA, 'web/places.json'))
    ? read<{ rows: PlaceRowLite[] }>('web/places.json').rows.map(withEnglishName) : [];
  const fire = new Map(places.filter((r) => r.mean_per_year !== null).map((r) => [`${r.kind}:${r.id}`, r.mean_per_year as number]));
  const cities: City[] = have ? readCities(read<CitiesFile>('web/cities.json')) : [];
  const ix = have ? buildIndex(areas, { fire, cities, picks: placePicks(places) }) : null;
  const top = (q: string, n = 12) => searchAreas(q, n, ix).map((h) => h.label);

  it('every alias names real places and cities', () => {
    const keys = new Set(areas.map((a) => `${a.kind}:${a.id}`));
    const placeKeys = new Set(places.map((r) => `${r.kind}:${r.id}`));
    for (const a of ALIASES) {
      for (const k of [...a.to, ...(a.off?.keys ?? [])]) {
        expect(keys.has(k), `${a.say[0]} → ${k}`).toBe(true);
        if (places.length) expect(placeKeys.has(k), `${k} in places.json`).toBe(true);
      }
    }
    for (const [said, name, iso3] of CITY_ALIASES) {
      expect(cities.some((c) => c.iso3 === iso3 && (c.name === name || c.ascii === name)), said).toBe(true);
    }
    for (const [name, iso3, state] of CITY_STATES) {
      expect(cities.some((c) => c.iso3 === iso3 && c.name === name), name).toBe(true);
      if (state) expect(keys.has(`state:${state}`), `${name} → ${state}`).toBe(true);
    }
  });
  it('"kal" gives the four Kalimantan provinces first, the same in 8 and 12', () => {
    const k = top('kal', 8).slice(0, 4).sort();
    expect(k).toEqual(['Central Kalimantan, Indonesia', 'East Kalimantan, Indonesia', 'South Kalimantan, Indonesia', 'West Kalimantan, Indonesia']);
    expect(top('kal', 8)).toEqual(top('kal', 12).slice(0, 8));
  });
  it('regions and common names resolve', () => {
    expect(top('sumatra')).toEqual(expect.arrayContaining(['Riau, Indonesia', 'South Sumatra, Indonesia', 'Aceh, Indonesia', 'Jambi, Indonesia']));
    expect(top('borneo')).toEqual(expect.arrayContaining(['Central Kalimantan, Indonesia', 'Sarawak, Malaysia', 'Sabah, Malaysia', 'Brunei']));
    expect(top('amazon', 9).sort()).toEqual(['Acre, Brazil', 'Amapá, Brazil', 'Amazonas, Brazil', 'Maranhão, Brazil', 'Mato Grosso, Brazil',
      'Pará, Brazil', 'Rondônia, Brazil', 'Roraima, Brazil', 'Tocantins, Brazil']);
    expect(top('usa')[0]).toBe('United States');
    expect(top('siberia')).toEqual(expect.arrayContaining(['Sakha Republic, Russia', 'Krasnoyarsk, Russia', 'Irkutsk, Russia']));
    for (const [q, want] of [['ivory coast', "Côte d'Ivoire"], ['türkiye', 'Turkey'], ['brasil', 'Brazil'], ['viet nam', 'Vietnam'],
      ['uk', 'United Kingdom'], ['drc', 'DR Congo'], ['russia', 'Russia'], ['britain', 'United Kingdom']] as const) {
      expect(top(q)[0], q).toBe(want);
    }
    expect(top('congo').slice(0, 2).sort()).toEqual(['Congo', 'DR Congo']);
    expect(top('republic of congo')[0]).toBe('Congo');
    expect(top('democratic republic of congo')[0]).toBe('DR Congo');
  });
  it('fire regions and the short names of reports resolve', () => {
    const hits = (q: string, n = 12) => searchAreas(q, n, ix);
    expect(top('cerrado', 9).sort()).toEqual(['Bahia, Brazil', 'Federal District, Brazil', 'Goiás, Brazil', 'Maranhão, Brazil',
      'Mato Grosso do Sul, Brazil', 'Mato Grosso, Brazil', 'Minas Gerais, Brazil', 'Piauí, Brazil', 'Tocantins, Brazil']);
    expect(hits('cerrado').find((h) => h.label === 'Goiás, Brazil')?.hint).toBe('State in the Cerrado');
    expect(hits('cerrado').find((h) => h.label === 'Bahia, Brazil')?.hint).toBe('State partly in the Cerrado');
    expect(top('pantanal').sort()).toEqual(['Alto Paraguay, Paraguay', 'Mato Grosso do Sul, Brazil', 'Mato Grosso, Brazil', 'Santa Cruz, Bolivia']);
    expect(top('gran chaco')).toEqual(expect.arrayContaining(['Chaco, Argentina', 'Formosa, Argentina', 'Boquerón, Paraguay', 'Tarija, Bolivia']));
    expect(top('chaco')[0]).toBe('Chaco, Argentina');
    expect(top('congo basin', 6).sort()).toEqual(['Cameroon', 'Central African Republic', 'Congo', 'DR Congo', 'Equatorial Guinea', 'Gabon']);
    expect(top('sahel')).toEqual(expect.arrayContaining(['Mali', 'Niger', 'Chad', 'Burkina Faso', 'Senegal']));
    expect(hits('sahel').every((h) => h.kind === 'country')).toBe(true);
    for (const [q, want] of [['kalteng', 'Central Kalimantan, Indonesia'], ['sumsel', 'South Sumatra, Indonesia'], ['kalbar', 'West Kalimantan, Indonesia'],
      ['jambi', 'Jambi, Indonesia'], ['nsw', 'New South Wales, Australia'], ['qld', 'Queensland, Australia'], ['nwt', 'Northwest Territories, Canada'],
      ['irkutsk oblast', 'Irkutsk, Russia']] as const) {
      expect(top(q)[0], q).toBe(want);
    }
    // "america": the USA, then the two continents, before the names that only start with it
    expect(top('america').slice(0, 4)).toEqual(['United States', 'South America', 'North America', 'American Samoa']);
  });
  it('"sao paulo" gives the state, then the city', () => {
    const hits = searchAreas('sao paulo', 12, ix);
    expect(hits[0].label).toBe('São Paulo, Brazil');
    expect(hits[1].kind).toBe('city');
    expect(hits[1].label).toBe('São Paulo');
  });
  it('cities: "palangka", "pekanbaru", "cuiaba" and names shared by two countries', () => {
    expect(searchAreas('palangka', 8, ix)[0].label).toBe('Palangka Raya');
    expect(searchAreas('pekanbaru', 8, ix)[0].label).toBe('Pekanbaru');
    expect(searchAreas('cuiaba', 8, ix)[0].label).toBe('Cuiabá');
    const londons = searchAreas('london', 12, ix).filter((h) => h.label === 'London');
    expect(londons.length).toBe(2);
    expect(new Set(londons.map((h) => h.hint)).size).toBe(2);
    const c = searchAreas('palangka', 8, ix)[0].city as City;
    expect(cityNear(c.lat, c.lon, 1, ix)?.name).toBe('Palangka Raya, Indonesia');
  });
  it('city hints never call a city a capital, and two cities of the same name never read the same', () => {
    const cityHits = ix ? ix.entries.filter((e) => e.city) : [];
    expect(cityHits.filter((e) => /capital of/i.test(e.hint)).map((e) => e.hint)).toEqual([]);
    const seen = new Map<string, number>();
    for (const e of cityHits) seen.set(`${e.label}|${e.hint}`, (seen.get(`${e.label}|${e.hint}`) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1)).toEqual([]);
    expect(searchAreas('johannesburg', 4, ix)[0].hint).toBe('City in Gauteng, South Africa');
    expect(searchAreas('london', 4, ix).filter((h) => h.label === 'London').map((h) => h.hint).sort())
      .toEqual(['City in Ontario, Canada', 'City in the United Kingdom']);
    expect(searchAreas('saigon', 4, ix)[0].hint).toBe('City in Vietnam, once called Saigon');
    expect(searchAreas('hong kong', 4, ix).find((h) => h.kind === 'city')?.hint).toBe('City in Hong Kong');
    // the state a city lies in, where its point falls just over a border or the place list lacks its capital district
    const cityHint = (q: string) => searchAreas(q, 12, ix).find((h) => h.kind === 'city')?.hint;
    for (const [q, want] of [['kuala lumpur', 'City in Malaysia'], ['messina', 'City in Messina, Italy'], ['aswan', 'City in Aswan, Egypt'],
      ['washington d.c.', 'City in the United States'], ['abuja', 'City in Federal Capital Territory, Nigeria'],
      ['putrajaya', 'City in Malaysia'], ['vatican', 'City state inside Rome, Italy'], ['pekanbaru', 'City in Riau, Indonesia'],
      ['palangka', 'City in Central Kalimantan, Indonesia'], ['new york', 'City in New York, United States']] as const) {
      expect(cityHint(q), q).toBe(want);
    }
  });
  it('finds Central Kalimantan by both names, and Kuala Lumpur the city first', () => {
    for (const q of ['Central Kalimantan', 'Kalimantan Tengah']) {
      expect(searchAreas(q, 12, ix)[0].key, q).toBe('state:IDN-1931');
      expect(searchAreas(q, 12, ix)[0].label, q).toBe('Central Kalimantan, Indonesia');
    }
    const kl = searchAreas('Kuala Lumpur', 12, ix);
    expect(kl[0].kind).toBe('city');
    expect(kl.findIndex((h) => h.key === 'state:MYS-4831')).toBeGreaterThan(0);
    expect(areas.some((a) => /Dem\. Rep\.|S\. Sudan| Rep\.$| Is\.$|, [^,]* Is\.$/.test(a.name))).toBe(false);
  });
  it('suggests no continent, and places with a fire season under way', () => {
    if (!places.length) return;
    const p = placePicks(places);
    expect(p.hot.length).toBe(3);
    expect(p.most.length).toBe(2);
    for (const x of [...p.hot, ...p.most]) expect(['country', 'state']).toContain(x.kind);
    const row = (id: string) => places.find((r) => r.id === id);
    for (const x of p.hot) expect((row(x.id)?.latest_normal ?? 0) >= 1000 && (row(x.id)?.mean_per_year ?? 0) >= 1000).toBe(true);
    expect(p.most[0].name).toBe('DR Congo');
  });
  it('is quick enough to run on every key', () => {
    const t0 = performance.now();
    for (const q of ['k', 'ka', 'kal', 'kali', 'kalim', 'kalima', 'sumatra', 'indonesai', 'sao paulo', 'xyzzyq']) searchAreas(q, 12, ix);
    expect((performance.now() - t0) / 10).toBeLessThan(60);
  });
});
