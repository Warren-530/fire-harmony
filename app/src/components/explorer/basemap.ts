// The base map, tuned for reading fire on top of it. The free OpenFreeMap styles are very quiet: in the dark one,
// land and water are almost the same black, borders are 23% grey and every name is dim grey, so countries and cities
// vanish under bright hexagons. We change the colours as the style loads (transformStyle): navy land and deeper blue
// water so coasts show, clear country and state borders, and light names with a dark halo. The hexagons are drawn
// below the borders and names (hexBeforeId), so both stay readable on top of the fire. Every name is written in
// English, on one line (the styles add the local script under it: "RUSSIA / РОССИЯ"; the app is English only), with a
// halo of at least 1.5 px in the colour of the page, so a name stays readable over the brightest hexagons.
import type { LayerSpecification, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';

export type Theme = 'dark' | 'light';

const DARK = {
  land: '#0f151e', water: '#0a1d31', waterway: '#0d2540', cover: '#121a25', residential: '#141c27', building: '#18212d',
  roadMinor: '#1a2230', roadMajor: '#232d3c', rail: '#1d2633',
  country: 'rgba(196, 208, 226, 0.62)', state: 'rgba(160, 174, 196, 0.38)',
  textCountry: '#f4f7fb', textCity: '#e6ebf2', textState: '#c3ccd8', textWater: '#7fa3cc', textRoad: '#7d8999',
  halo: 'rgba(4, 6, 10, 0.94)',
} as const;

const LIGHT = {
  country: 'rgba(70, 72, 80, 0.55)', state: 'rgba(90, 92, 100, 0.32)',
  textCountry: '#18191c', textCity: '#232529', textState: '#41454c', halo: 'rgba(255, 255, 255, 0.95)',
} as const;

/** One name in English: the English name where the tiles have one, else the name in Latin letters, else the name. */
export const ENGLISH_NAME = ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];

/** Every label of a style in English, on one line (road numbers, "ref", stay as they are). */
export function englishLabels(s: StyleSpecification): void {
  for (const l of s.layers) {
    if (l.type !== 'symbol') continue;
    const layout = (l as unknown as { layout?: Record<string, unknown> }).layout;
    const field = layout?.['text-field'];
    if (!layout || field === undefined || field === null) continue;
    const text = JSON.stringify(field);
    if (!/name/.test(text) || /"ref"/.test(text)) continue;
    layout['text-field'] = ENGLISH_NAME;
  }
}

type Paint = Record<string, unknown>;
const paint = (l: LayerSpecification): Paint => {
  const x = l as unknown as { paint?: Paint };
  x.paint = x.paint ?? {};
  return x.paint;
};

const lineWidth = (lo: number, mid: number, hi: number) => ['interpolate', ['linear'], ['zoom'], 0, lo, 4, mid, 9, hi];

/** The colour of a place label, by the layer ids of both styles (dark: place_*, light: label_*). */
function textOf(id: string, c: { textCountry: string; textCity: string; textState: string }): string | null {
  if (id.startsWith('place_country') || id.startsWith('label_country')) return c.textCountry;
  if (id === 'place_state' || id === 'label_state') return c.textState;
  if (id.startsWith('place_') || id.startsWith('label_')) return c.textCity;
  return null;
}
const isCountry = (id: string) => id.startsWith('place_country') || id.startsWith('label_country');

function tuneDark(s: StyleSpecification): void {
  for (const l of s.layers) {
    const id = l.id, p = paint(l);
    if (l.type === 'background') p['background-color'] = DARK.land;
    else if (l.type === 'fill') {
      if (id === 'water') p['fill-color'] = DARK.water;
      else if (id.startsWith('landcover') || id === 'landuse_park') p['fill-color'] = DARK.cover;
      else if (id.startsWith('landuse')) p['fill-color'] = DARK.residential;
      else if (id === 'building') { p['fill-color'] = DARK.building; p['fill-outline-color'] = DARK.building; }
    } else if (l.type === 'line') {
      if (id === 'waterway') p['line-color'] = DARK.waterway;
      else if (id.startsWith('boundary_country')) { p['line-color'] = DARK.country; p['line-width'] = lineWidth(0.7, 1.1, 1.8); }
      else if (id.startsWith('boundary_state')) { p['line-color'] = DARK.state; p['line-width'] = lineWidth(0.4, 0.7, 1.1); }
      else if (id.startsWith('highway_motorway') || id.startsWith('highway_major')) p['line-color'] = DARK.roadMajor;
      else if (id.startsWith('highway') || id.startsWith('road')) p['line-color'] = DARK.roadMinor;
      else if (id.startsWith('railway')) p['line-color'] = DARK.rail;
    } else if (l.type === 'symbol') {
      const color = id === 'water_name' ? DARK.textWater : id.startsWith('highway') ? DARK.textRoad : textOf(id, DARK);
      if (color) {
        p['text-color'] = color;
        p['text-halo-color'] = DARK.halo;
        p['text-halo-width'] = isCountry(id) ? 2 : 1.8;
        p['text-halo-blur'] = 0.3;
      }
    }
  }
}

function tuneLight(s: StyleSpecification): void {
  for (const l of s.layers) {
    const id = l.id, p = paint(l);
    if (l.type === 'line') {
      if (id.startsWith('boundary_country')) { p['line-color'] = LIGHT.country; p['line-width'] = lineWidth(0.7, 1.1, 1.8); }
      else if (id.startsWith('boundary_state')) { p['line-color'] = LIGHT.state; p['line-width'] = lineWidth(0.4, 0.7, 1.1); }
    } else if (l.type === 'symbol') {
      const color = textOf(id, LIGHT);
      if (color) { p['text-color'] = color; p['text-halo-color'] = LIGHT.halo; p['text-halo-width'] = isCountry(id) ? 2 : 1.8; p['text-halo-blur'] = 0.3; }
    }
  }
}

/** The style as MapLibre loads it, with our colours (use as setStyle's transformStyle). */
export function tuneStyle(theme: Theme, next: StyleSpecification): StyleSpecification {
  const s: StyleSpecification = JSON.parse(JSON.stringify(next));
  englishLabels(s);
  if (theme === 'dark') tuneDark(s); else tuneLight(s);
  return s;
}

/** The style layer the hexagons are drawn under: the first border or label layer, so both stay on top of the fire. */
export function hexBeforeId(style: StyleSpecification | undefined): string | undefined {
  const layers = style?.layers ?? [];
  return (layers.find((l) => l.id.startsWith('boundary')) ?? layers.find((l) => l.type === 'symbol'))?.id;
}

/** A plain background to show before the real style has loaded (same land colour, no flash). */
export function blankStyle(theme: Theme): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': theme === 'dark' ? DARK.land : '#f2f3f0' } }] };
}

/** deck.gl 9.4 draws inside the map (interleaved mode) with the size of map.transform. MapLibre 6 moved the transform
 * to the map's camera (map._camera.transform), so map.transform is undefined and every draw fails. Give the map the old
 * property back, reading the camera's transform. */
export function exposeTransform(map: MapLibreMap): void {
  if ('transform' in map) return;
  Object.defineProperty(map, 'transform', {
    configurable: true,
    get(this: { _camera?: { transform?: unknown } }) { return this._camera?.transform; },
  });
}
