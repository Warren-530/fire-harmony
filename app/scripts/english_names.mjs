// The app's English place names (src/lib/names.ts) for the browser checks, which compare the page with the published
// files: the files keep Natural Earth's names, the app shows the English ones. Read from the app's own sources, so
// the checks follow any change there.
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/lib/names.ts', import.meta.url), 'utf8');
const STATES = JSON.parse(fs.readFileSync(new URL('../src/lib/stateNamesEn.json', import.meta.url), 'utf8'));
const block = (name) => {
  const at = src.indexOf(`const ${name}`);
  const body = src.slice(src.indexOf('{', at) + 1, src.indexOf('};', at));
  return Object.fromEntries([...body.matchAll(/(?:'([^']+)'|([A-Za-z]+)): '([^']+)'/g)].map((m) => [m[1] ?? m[2], m[3]]));
};
const COUNTRY = block('COUNTRY_EN'), PLACE = block('PLACE_EN'), CONTINENT = block('CONTINENT_EN'), CITY = block('CITY_EN');

/** The name the app shows for a row of web/places.json or areas.json ({kind, id, name}). */
export function englishName(kind, id, name) {
  if (!name) return name;
  if ((kind === 'state' || kind === 'country') && PLACE[id]) return PLACE[id];
  if (kind === 'country') return COUNTRY[name] ?? name;
  if (kind === 'continent') return CONTINENT[name] ?? name;
  if (kind === 'city') return CITY[name] ?? name;
  if (kind !== 'state') return name;
  const at = name.lastIndexOf(', ');
  const own = at < 0 ? name : name.slice(0, at), country = at < 0 ? null : name.slice(at + 2);
  const en = STATES[id] ?? own;
  return country === null ? en : `${en}, ${COUNTRY[country] ?? country}`;
}

/** Rows with their English names, as the app loads them. */
export const inEnglish = (rows) => rows.map((r) => ({ ...r, name: englishName(r.kind, r.id, r.name) }));

/** Natural Earth's short forms that the app never shows. */
export const SHORT_FORMS = /Dem\. Rep\.|S\. Sudan|\bRep\.(?=[\s,)]|$)|\bIs\.(?=[\s,)]|$)|Seven seas/;
