// The first view's files (prefetchFirstView): what a link starts reading at boot, before the Explorer's code arrives.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let asked: string[] = [];

beforeEach(() => {
  asked = [];
  vi.resetModules();   // each test gets its own caches of web.ts
  vi.stubGlobal('window', { location: { href: 'http://127.0.0.1:5173/' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    asked.push(String(url).replace('http://127.0.0.1:5173/data/', ''));
    const body = String(url).endsWith('web/index.json') ? { version: 2, map_l3: ['2025', '2026'], map_l4: [], cell_l3: [], cell_l4: [], cells: [] } : {};
    return new Response(JSON.stringify(body), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const boot = async (hash: string) => {
  const web = await import('./web');
  web.prefetchFirstView(hash);
  await new Promise((r) => setTimeout(r, 0));
  return web;
};

describe('prefetchFirstView', () => {
  it('the trend view (mode=trend) reads the level 3 trend map at boot, handed over once', async () => {
    const web = await boot('#/?area=country:IDN&mode=trend');
    expect(asked).toContain('web/trend_l3.json');
    expect(asked).toContain('web/places.json');             // a country's verdict needs the test of all places
    expect(asked).toContain('web/series/country/IDN.json');
    await web.webTake('trend_l3.json');
    await web.webTake('trend_l3.json');                      // the boot copy is taken once; the second read is new
    expect(asked.filter((u) => u === 'web/trend_l3.json')).toHaveLength(2);
  });
  it('the counts view reads no trend map; a hexagon in the link reads the trend map of its level', async () => {
    await boot('#/?area=world:WORLD&month=202610');
    expect(asked.some((u) => u.startsWith('web/trend_l'))).toBe(false);
    expect(asked).not.toContain('web/places.json');
    asked = [];
    vi.resetModules();
    await boot('#/?area=hex:846890bffffffff');
    expect(asked).toContain('web/trend_l4.json');
  });
  it('a country in the link is read as the Explorer reads it (any case)', async () => {
    await boot('#/?area=Country:bra');
    expect(asked).toContain('web/series/country/BRA.json');
  });
});

describe('Fast Refresh: MapView.tsx exports only its component (and types)', () => {
  it('has no exported constant or helper function besides MapView', () => {
    const src = fs.readFileSync(path.join(__dirname, '../components/MapView.tsx'), 'utf8');
    const values = [...src.matchAll(/^export\s+(?!type\b|interface\b)(?:const|let|function|class|async function|\{)\s*(\w*)/gm)].map((m) => m[1]);
    expect(values).toEqual(['MapView']);
  });
});
