// End-to-end check of the Explorer in a real (headless) Chrome: every function a user can reach.
// Usage: node scripts/test_explorer.mjs [baseUrl]      (default http://127.0.0.1:5173/; the dev server must run)
// Prints one line per check and exits with 1 when any check fails. Screenshots of failures go to /tmp/fh_test_explorer.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.env.TEST_OUT ?? '/tmp/fh_test_explorer';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
await context.addInitScript(() => { try { localStorage.setItem('fh_theme', 'dark'); } catch { /* ignore */ } });
const page = await context.newPage();
const problems = [];
// (the outside basemap server failing for a moment, as its requests below, is not an error of the app)
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !/tiles\.openfreemap\.org/.test(`${m.text()} ${m.location().url}`)) {
    problems.push(`${m.type()}: ${m.text()}`.slice(0, 300));
  }
});
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 300)}`));
// A request the page itself cancels (a reload, a map that moved on) ends as ERR_ABORTED: not an error. Real failures
// are other network errors and HTTP errors.
page.on('requestfailed', (r) => {
  const why = r.failure()?.errorText ?? '';
  if (!r.url().includes('tiles.openfreemap.org') && !why.includes('ERR_ABORTED')) problems.push(`requestfailed: ${r.url()} ${why}`);
});
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('tiles.openfreemap.org')) problems.push(`http ${r.status()}: ${r.url()}`); });
// The dev server is shared: edits by others hot update the page or reload it. Count both, to explain odd results.
let loads = 0, ownLoads = 0;
const devUpdates = [];
page.on('load', () => { loads++; });
page.on('console', (m) => { if (/^\[vite\] (css )?hot updated/.test(m.text())) devUpdates.push(m.text().slice(7, 120)); });

const results = [];
let n = 0;
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
async function check(name, fn) {
  if (ONLY && !ONLY.test(name) && !/^the Explorer loads|no console errors/.test(name)) return;
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ ok: true, name });
    console.log(`PASS ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)${note ? ` - ${note}` : ''}`);
  } catch (e) {
    results.push({ ok: false, name });
    const file = path.join(outDir, `fail_${++n}.png`);
    await page.screenshot({ path: file, timeout: 60_000 }).catch(() => undefined);
    console.log(`FAIL ${name}: ${String(e?.message ?? e).split('\n')[0].slice(0, 300)} (screenshot ${file})`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const READY = '.fh-ex[data-series-ready="true"] .fh-ex-map[data-ready="true"]';
const hash = () => page.evaluate(() => decodeURIComponent(window.location.hash));
const areaName = () => page.locator('.fh-ex-name').innerText();
const mapYm = () => page.locator('.fh-ex-map').getAttribute('data-ym').then(Number);
const monthCode = () => page.locator('.fh-ex-month-code').innerText();
const blur = () => page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
const waitReady = (timeout = 90_000) => page.waitForSelector(READY, { timeout });
async function waitName(text, timeout = 60_000) {
  await page.waitForFunction((t) => document.querySelector('.fh-ex-name')?.textContent?.includes(t), text, { timeout });
  await waitReady();
}
// The predicate runs in the page, so it cannot use variables from this script: pass them as `arg`.
async function waitYm(pred, timeout = 30_000, arg = null) {
  await page.waitForFunction(`(${pred.toString()})(Number(document.querySelector('.fh-ex-map')?.dataset.ym), ${JSON.stringify(arg)})`, null, { timeout });
}
// The month on the map once it stops changing (a drag passes through months on its way).
async function stableYm(ms = 1200, timeout = 20_000) {
  const t0 = Date.now();
  let last = await mapYm(), since = Date.now();
  while (Date.now() - t0 < timeout) {
    await page.waitForTimeout(200);
    const now = await mapYm();
    if (now !== last) { last = now; since = Date.now(); } else if (Date.now() - since >= ms) return now;
  }
  throw new Error(`the map month did not settle (last ${last})`);
}
// Wait until the map stands still and frames come quickly again (SwiftShader compiles shaders on first use, which
// stalls the page for many seconds in a headless run).
async function settle(timeout = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await page.evaluate(() => new Promise((res) => {
      const m = window.__fhMap?.map();
      if (!m || m.isMoving()) { res(false); return; }
      const s = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - s < 250)));
    }));
    if (ok) return;
    await page.waitForTimeout(500);
  }
  throw new Error('the map did not settle');
}
// (polled on a timer, not on animation frames: those stall while SwiftShader draws 3D)
const toastSeen = (text, timeout = 15_000) => page.waitForFunction((t) => [...document.querySelectorAll('.ui-toast')]
  .some((el) => el.textContent?.includes(t)), text, { timeout, polling: 100 });
const toastGone = (text, timeout = 15_000) => page.waitForFunction((t) => ![...document.querySelectorAll('.ui-toast')]
  .some((el) => el.textContent?.includes(t)), text, { timeout, polling: 100 });
// The fire brief once it tells of a month ("In October 2025,"): its first sentence.
async function waitBrief(start, timeout = 15_000) {
  await page.waitForFunction((t) => document.querySelector('.fh-ex-brief')?.textContent?.startsWith(t), start, { timeout, polling: 100 });
  return (await page.locator('.fh-ex-brief').innerText()).split(/(?<=\.)\s/)[0];
}
const pitch = () => page.evaluate(() => window.__fhMap?.map()?.getPitch() ?? -1);
const addYm = (ym, by) => { const k = Math.floor(ym / 100) * 12 + (ym % 100) - 1 + by; return Math.floor(k / 12) * 100 + (k % 12) + 1; };
const emit = (detail) => page.evaluate((d) => { window.dispatchEvent(new CustomEvent('fh:command', { detail: d })); }, detail);
async function palette(text) {
  await blur();
  await page.keyboard.press('Control+k');
  const input = page.locator('.ui-palette input[role="combobox"]');
  await input.waitFor({ timeout: 10_000 });
  await input.fill(text);
  await page.waitForSelector('#fh-palette-list [role="option"]', { timeout: 10_000 });
  await page.keyboard.press('Enter');
  await input.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
}
// The map settings fold into a pill (top right): open the card before using its controls.
async function openSettings() {
  const pill = page.locator('.fh-ex-controls-toggle');
  if ((await pill.getAttribute('aria-expanded')) !== 'true') await pill.click();
  await page.waitForSelector('.fh-ex-controls-body[data-open="true"]', { timeout: 10_000 });
}
async function closeSettings() {
  await page.keyboard.press('Escape');
  await page.waitForSelector('.fh-ex-controls-body[data-open="false"]', { state: 'attached', timeout: 10_000 });
}
async function openTab(name) {
  await page.getByRole('tab', { name, exact: true }).click();
  await page.waitForFunction((nm) => [...document.querySelectorAll('[role="tab"]')]
    .some((el) => el.textContent === nm && el.getAttribute('aria-selected') === 'true'), name);
}
// The downloads are a menu of the panel's Download button (no tab): open it and pick an item.
async function downloadItem(name) {
  const button = page.locator('.fh-ex-actions [aria-haspopup="menu"]');
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await page.getByRole('menuitem', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}`) }).click();
}

// ------------------------------------------------------------------------------------------------- the checks

await check('the Explorer loads (world, latest month, map and numbers)', async () => {
  const t0 = Date.now();
  ownLoads++;
  await page.goto(new URL('#/', base).toString(), { waitUntil: 'domcontentloaded' });
  try { await waitReady(150_000); } catch {   // a busy machine: one more try
    ownLoads++;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitReady(150_000);
  }
  const ms = Date.now() - t0;
  assert((await areaName()) === 'World', `area is ${await areaName()}`);
  const ym = await mapYm();
  assert(ym >= 202601, `map month ${ym}`);
  assert(/^[A-Z]{3} \d{4}$/.test(await monthCode()), `month code ${await monthCode()}`);
  assert(await page.locator('.fh-ex-kpis .ui-stat').count() === 3, 'three numbers in the strip');
  return `ready in ${(ms / 1000).toFixed(1)} s; map shows ${ym}, month code ${await monthCode()}`;
});

await check('a first visit: the welcome card at the top of the panel, covering nothing, with three stories; closed, it stays closed', async () => {
  const card = page.locator('[data-welcome]');
  await card.waitFor({ timeout: 10_000 });
  const overlaps = await page.evaluate(() => {
    const a = document.querySelector('[data-welcome]').getBoundingClientRect();
    const panel = document.querySelector('.fh-ex-panel').getBoundingClientRect();
    const out = [];
    if (a.left < panel.left - 1 || a.right > panel.right + 1) out.push('outside the panel');
    for (const sel of ['.fh-ex-controls-bar', '.fh-ex-zoom', '.fh-ex-dock', '.fh-ex-area', '.fh-ex-kpis']) {
      const e = document.querySelector(sel);
      if (!e) continue;
      const b = e.getBoundingClientRect();
      if (b.width > 0 && !(b.right <= a.left || b.left >= a.right || b.bottom <= a.top || b.top >= a.bottom)) out.push(sel);
    }
    return out;
  });
  assert(overlaps.length === 0, `the card overlaps ${overlaps}`);
  const close = page.getByRole('button', { name: 'Close the welcome' });
  assert(await close.count() === 1, 'no Close button');
  const stories = await page.locator('[data-story]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  assert(stories.length === 3, `stories ${stories}`);
  // a story opens its place, its month and its tab
  await page.locator('[data-story="kalimantan"]').click();
  await waitName('Kalimantan');
  await waitYm((ym) => ym === 201509);
  const tab = await page.locator('[role="tab"][aria-selected="true"]').innerText();
  assert(tab === 'Calendar', `tab ${tab}`);
  await page.goBack();
  await waitName('World');
  await card.waitFor({ timeout: 10_000 });
  await close.click();
  assert(await card.count() === 0, 'the card stays after Close');
  ownLoads++;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(150_000);
  assert(await card.count() === 0, 'the card came back after a reload');
  return `stories: ${stories.join(' ')}`;
});

await check('search and pick "Indonesia" (camera flies there)', async () => {
  const zoom0 = await page.evaluate(() => window.__fhMap.map().getZoom());
  const box = page.getByRole('combobox', { name: 'Find a place' });
  await box.click();
  await box.fill('Indonesia');
  const option = page.getByRole('option', { name: /^Indonesia\s*Country$/ });
  await option.waitFor({ timeout: 10_000 });
  await option.click();
  await waitName('Indonesia');
  await page.waitForFunction((z) => window.__fhMap.map().getZoom() > z + 1 && !window.__fhMap.map().isMoving(), zoom0, { timeout: 30_000 });
  const h = await hash();
  assert(h.includes('area=country:IDN'), `hash ${h}`);
  return `hash ${h}`;
});

await check('deep link #/?area=state:IDN-1931&month=202610', async () => {
  await page.goto(new URL('#/?area=state:IDN-1931&month=202610', base).toString(), { waitUntil: 'domcontentloaded' });
  await waitName('Kalimantan');
  await waitYm((ym) => ym === 202610);
  assert((await monthCode()) === 'OCT 2026', `month code ${await monthCode()}`);
  const kind = await page.locator('.fh-ex-kind').innerText();
  assert(/state/i.test(kind), `kind line ${kind}`);
  return `${await areaName()}, ${await monthCode()}`;
});

await check('the same link opened fresh (reload): place, month and camera come back', async () => {
  ownLoads++;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitName('Kalimantan');
  await waitYm((ym) => ym === 202610);
  await page.waitForFunction(() => {
    const m = window.__fhMap?.map();
    if (!m || m.isMoving()) return false;
    const c = m.getCenter();
    return c.lng > 105 && c.lng < 120 && c.lat > -6 && c.lat < 2 && m.getZoom() > 4;
  }, null, { timeout: 60_000 });
  return await page.evaluate(() => {
    const m = window.__fhMap.map(), c = m.getCenter();
    return `camera at ${c.lat.toFixed(1)}, ${c.lng.toFixed(1)}, zoom ${m.getZoom().toFixed(1)}`;
  });
});

await check('scale choices: MODIS, raw sensors, harmonized', async () => {
  const legend = () => page.locator('.fh-ex-controls .fh-ex-legend-title').textContent();
  await openSettings();
  await page.getByRole('radio', { name: 'MODIS', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.fh-ex-controls .fh-ex-legend-title')?.textContent?.includes('MODIS'));
  assert((await hash()).includes('scale=modis'), 'hash has scale=modis');
  await page.getByRole('radio', { name: 'Raw', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.fh-ex-controls .fh-ex-legend-title')?.textContent?.includes('Raw'));
  assert((await hash()).includes('scale=raw'), 'hash has scale=raw');
  const chart = await page.locator('.ui-figure-title').first().innerText();
  assert(/Raw detections/.test(chart), `chart title on raw: ${chart}`);
  await page.getByRole('radio', { name: 'Harmonized', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.fh-ex-controls .fh-ex-legend-title')?.textContent?.includes('NOAA-20'));
  assert(!(await hash()).includes('scale='), 'harmonized is the default (not in the hash)');
  await closeSettings();
  return `legend back to "${await legend()}"`;
});

await check('colour choices: against normal (button and A), fire count (C)', async () => {
  await openSettings();
  await page.getByRole('radio', { name: 'Against normal' }).click();
  await page.waitForFunction(() => document.querySelector('.fh-ex-controls .fh-ex-legend-title')?.textContent?.includes('normal'));
  assert((await hash()).includes('mode=anomaly'), 'hash has mode=anomaly');
  await closeSettings();
  await blur();
  await page.keyboard.press('c');
  await page.waitForFunction(() => !window.location.hash.includes('mode=anomaly'));
  await page.keyboard.press('a');
  await page.waitForFunction(() => window.location.hash.includes('mode=anomaly'));
  await page.keyboard.press('c');
  await page.waitForFunction(() => !window.location.hash.includes('mode=anomaly'));
});

await check('step months with the keys (Left, Right, Shift+Left)', async () => {
  await blur();
  const ym0 = await mapYm();
  await page.keyboard.press('ArrowLeft');
  await waitYm((ym) => ym !== 202610);
  const ym1 = await mapYm();
  assert(ym1 === 202609, `left gave ${ym1}`);
  await page.keyboard.press('Shift+ArrowLeft');
  await waitYm((ym) => ym === 202509);
  await page.keyboard.press('ArrowRight');
  await waitYm((ym) => ym === 202510);
  const brief = await waitBrief('In October 2025,'); // the brief follows the month, as the tiles do
  return `${ym0} → 202609 → 202509 → 202510; brief "${brief}"`;
});

await check('play for a few seconds, then stop (map, timeline and numbers follow)', async () => {
  await blur();
  const ym0 = await mapYm();
  const tile0 = await page.locator('.fh-ex-kpis .ui-stat-label').first().innerText();
  await page.getByRole('button', { name: 'Play the months (Space)' }).click();
  await page.waitForTimeout(4500);
  const ym1 = await mapYm();
  assert(ym1 !== ym0, `the map did not move (${ym0})`);
  await page.getByRole('button', { name: 'Pause (Space)' }).click();
  const ym2 = await mapYm();
  await page.waitForTimeout(2500);
  const ym3 = await mapYm();
  assert(ym3 === ym2, `still moving after pause (${ym2} → ${ym3})`);
  const tile1 = await page.locator('.fh-ex-kpis .ui-stat-label').first().innerText();
  assert(tile1 !== tile0, 'the month tile followed the player');
  await waitBrief(`In ${tile1},`);
  // Space plays and pauses too
  await blur();
  await page.keyboard.press(' ');
  await page.waitForFunction(() => document.querySelector('.fh-ex-play')?.getAttribute('aria-pressed') === 'true');
  await page.keyboard.press(' ');
  await page.waitForFunction(() => document.querySelector('.fh-ex-play')?.getAttribute('aria-pressed') === 'false');
  return `${ym0} → ${ym3}; tile "${tile0}" → "${tile1}"`;
});

await check('the timeline: click, drag and hover preview', async () => {
  const scrub = page.locator('.fh-ex-scrub');
  const b = await scrub.boundingBox();
  await page.mouse.click(b.x + 12, b.y + b.height / 2);
  await waitYm((ym) => ym < 200201);
  const early = await mapYm();
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await waitYm((ym) => ym > 201300 && ym < 202000);
  const dragged = await stableYm();
  assert(dragged > 201300 && dragged < 202000, `drag ended on ${dragged}`);
  assert((await monthCode()) === `${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][dragged % 100 - 1]} ${Math.floor(dragged / 100)}`,
    `month code ${await monthCode()} for ${dragged}`);
  await page.mouse.move(b.x + b.width * 0.95, b.y + b.height / 2);
  await page.waitForSelector('.fh-ex-scrub-readout', { timeout: 5000 });
  await waitYm((ym) => ym > 202400, 15_000);       // the hovered month previews on the map
  const previewed = await mapYm();
  await page.mouse.move(b.x + b.width / 2, b.y - 120);   // leave: back to the chosen month
  await waitYm((ym, chosen) => ym === chosen, 15_000, dragged);
  return `click ${early}, drag ${dragged}, hover preview ${previewed}`;
});

await check('3D on and off (D and the button)', async () => {
  await blur();
  await page.keyboard.press('d');
  await page.waitForFunction(() => document.querySelector('.fh-ex-3d')?.getAttribute('aria-pressed') === 'true');
  await page.waitForFunction(() => Math.abs((window.__fhMap?.map()?.getPitch() ?? 0) - 45) < 1, null, { timeout: 120_000 });
  assert((await hash()).includes('view=3d'), 'hash has view=3d');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, '3d.png'), timeout: 120_000 });
  await openSettings();
  await page.locator('.fh-ex-3d').click();
  await page.waitForFunction(() => (window.__fhMap?.map()?.getPitch() ?? 1) < 1, null, { timeout: 120_000 });
  await closeSettings();
  assert(!(await hash()).includes('view=3d'), 'hash back to 2D');
  return `pitch now ${await pitch()}`;
});

await check('click a hexagon: it becomes the area, outlined, with its own series', async () => {
  await settle();
  const hex = await page.evaluate(() => window.__fhMap.firstHex(5));
  assert(hex, 'no hexagon with fire on screen');
  const box = await page.locator('.fh-ex-map').boundingBox();
  await page.mouse.move(box.x + hex.x - 30, box.y + hex.y - 20);
  await page.mouse.move(box.x + hex.x, box.y + hex.y, { steps: 5 });
  // the first hover compiles the picking shaders: slow on SwiftShader, instant on a real GPU
  await page.waitForSelector('.fh-ex-tip', { timeout: 90_000 });
  await page.waitForFunction(() => !/Finding the place/.test(document.querySelector('.fh-ex-tip')?.textContent ?? ''), null, { timeout: 15_000 });
  const tip = await page.locator('.fh-ex-tip').innerText();
  assert(/Hotspots/.test(tip) && /Normal for/.test(tip), `tooltip: ${tip}`);
  // the place in English, as everywhere in the app (lib/names.ts): "Central Kalimantan", never "Kalimantan Tengah"
  assert(!/Kalimantan (Tengah|Barat|Timur|Selatan|Utara)|Dem\. Rep\./.test(tip), `a local name in the tooltip: ${tip.split('\n')[0]}`);
  await page.mouse.click(box.x + hex.x, box.y + hex.y);
  await waitName('Hexagon near');
  const h = await hash();
  assert(h.includes(`area=hex:${hex.h3}`), `hash ${h}`);
  const kind = await page.locator('.fh-ex-kind').innerText();
  assert(/hexagon/i.test(kind), `kind line ${kind}`);
  return `${await areaName()} (${hex.h3}), tooltip "${tip.split('\n')[0]}"`;
});

await check('draw a rectangle by dragging on the map', async () => {
  await page.getByRole('button', { name: 'Rectangle' }).click();
  await page.waitForSelector('.fh-ex-draw', { timeout: 5000 });
  const box = await page.locator('.fh-ex-map').boundingBox();
  const x0 = box.x + box.width * 0.5, y0 = box.y + box.height * 0.35;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 140, y0 + 90, { steps: 8 });
  await page.mouse.up();
  await waitName('Area near');
  const kind = await page.locator('.fh-ex-kind').innerText();
  assert(/drawn area/i.test(kind), `kind line ${kind}`);
  assert((await hash()).includes('area=polygon:'), 'hash has the polygon');
  return `${await areaName()}, ${kind}`;
});

await check('Escape cancels drawing', async () => {
  await page.getByRole('button', { name: 'Polygon' }).click();
  await page.waitForSelector('.fh-ex-draw', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.fh-ex-draw', { state: 'detached', timeout: 5000 });
});

await check('the circle form (latitude, longitude, radius)', async () => {
  await page.getByRole('button', { name: 'Circle' }).click();
  await page.getByLabel('Latitude', { exact: true }).fill('-2.2');
  await page.getByLabel('Longitude', { exact: true }).fill('113.9');
  await page.getByLabel('Radius (km)', { exact: true }).fill('80');
  await page.getByRole('button', { name: 'Show this area' }).click();
  await waitName('80 km around');
  assert((await hash()).includes('area=circle:-2.2,113.9,80'), `hash ${await hash()}`);
  // a wrong value is refused with a message
  await page.getByRole('button', { name: 'Circle' }).click();
  await page.getByLabel('Latitude', { exact: true }).fill('123');
  await page.getByRole('button', { name: 'Show this area' }).click();
  await page.waitForSelector('.fh-form-errors li', { timeout: 5000 });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  return await areaName();
});

await check('the tabs: overview, calendar, why, outlook; the Download menu and its data files', async () => {
  await page.goto(new URL('#/?area=state:IDN-1931&month=201509', base).toString(), { waitUntil: 'domcontentloaded' });
  await waitName('Kalimantan');
  await openTab('Overview');
  await page.waitForSelector('.fh-ex-tabpanel .ui-figure-plot svg', { timeout: 30_000 });
  const title = await page.locator('.fh-ex-tabpanel .ui-figure-title').innerText();
  await openTab('Calendar');
  await page.waitForSelector('.fh-ex-tabpanel .fh-ex-cal-svg', { timeout: 30_000 });
  await openTab('Why');
  await page.waitForFunction(() => /September 2015/.test(document.querySelector('.fh-ex-tabpanel')?.textContent ?? ''), null, { timeout: 30_000 });
  const why = await page.locator('.fh-ex-tabpanel .ui-card-title').first().innerText();
  await openTab('Outlook');
  await page.waitForFunction(() => /Fire outlook/.test(document.querySelector('.fh-ex-tabpanel')?.textContent ?? ''), null, { timeout: 30_000 });
  // the downloads are a menu now (no tab is cut off): its data files open in a dialog
  await downloadItem('All data files');
  await page.waitForSelector('dialog.fh-ex-files-dialog[open] .fh-ex-files', { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog.fh-ex-files-dialog:not([open])', { state: 'attached', timeout: 10_000 });
  // keyboard: arrows move between the tabs
  await page.getByRole('tab', { name: 'Outlook', exact: true }).focus();
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Overview');
  return `chart "${title}"; why "${why}"`;
});

await check('the calendar: hover marks the timeline, click picks the month', async () => {
  await openTab('Calendar');
  const svg = page.locator('.fh-ex-cal-svg');
  await svg.waitFor();
  // the tab's content slides in from the side: measure the cells once it has landed
  await page.waitForFunction(() => (document.querySelector('.fh-ex-tabpanel')?.getAnimations?.() ?? []).length === 0, null, { timeout: 10_000 });
  // a chart: the title is the finding, with a source line
  const title = await page.locator('.fh-ex-cal-box .ui-figure-title').innerText();
  assert(/^(The fire season is |Fire usually peaks in |In most years there is little)/.test(title), `calendar title "${title}"`);
  assert((await page.locator('.fh-ex-cal-box .ui-figure-source').innerText()).includes('NASA FIRMS'), 'calendar source line');
  const cell = page.locator('.fh-ex-cal-svg [role="gridcell"][id$="-2019-9"]');
  await cell.scrollIntoViewIfNeeded();
  const b = await cell.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForSelector('.fh-ex-scrub-mark', { state: 'attached', timeout: 5000 });   // a thin line: never "visible"
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await waitYm((ym) => ym === 201909);
  assert((await monthCode()) === 'SEP 2019', `month code ${await monthCode()}`);
  // keyboard in the grid (the pointer leaves the grid first: focusing it may scroll the panel, and a cell that moves
  // under a resting pointer is hovered, which previews its month on the map)
  await page.mouse.move(5, 5);
  await svg.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await waitYm((ym) => ym === 201910);
  return `"${title}"; September 2019, then October 2019 with the keyboard`;
});

await check('CSV download (file checked)', async () => {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    downloadItem('Monthly record (CSV)'),
  ]);
  const file = path.join(outDir, dl.suggestedFilename());
  await dl.saveAs(file);
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.trim().split('\n');
  const head = lines.find((l) => l.startsWith('year,'));
  assert(head === 'year,month,harmonized,range_low,range_high,normal,times_normal,source,modis_scale,terra,aqua,suomi_npp,noaa20,noaa21', `header ${head}`);
  const rows = lines.filter((l) => /^\d{4},/.test(l));
  assert(rows.length >= 300, `${rows.length} rows`);
  const sep2015 = rows.find((l) => l.startsWith('2015,9,'));
  assert(sep2015 && Number(sep2015.split(',')[2]) > 10_000, `September 2015 row: ${sep2015}`);
  await toastSeen('CSV saved');
  return `${dl.suggestedFilename()}, ${rows.length} months, 2015-09: ${sep2015.split(',')[2]} hotspots`;
});

await check('calendar and chart pictures (PNG)', async () => {
  const [png] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    downloadItem('Calendar (PNG)'),
  ]);
  const file = path.join(outDir, png.suggestedFilename());
  await png.saveAs(file);
  const head = fs.readFileSync(file).subarray(0, 8).toString('hex');
  assert(head === '89504e470d0a1a0a', 'not a PNG');
  await toastSeen('Picture saved');
  const [png2] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    downloadItem('Chart (PNG)'),
  ]);
  const file2 = path.join(outDir, png2.suggestedFilename());
  await png2.saveAs(file2);
  assert(fs.statSync(file2).size > 10_000, 'chart picture too small');
  return `${png.suggestedFilename()}, ${png2.suggestedFilename()}`;
});

await check('copy link (toast and clipboard)', async () => {
  await page.getByRole('button', { name: 'Copy a link to this view' }).click();
  await toastSeen('Link copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const url = await page.evaluate(() => window.location.href);
  assert(copied === url, `clipboard ${copied} vs ${url}`);
  assert(copied.includes('area=state:IDN-1931') && /month=\d{6}/.test(copied), copied);
  return copied;
});

await check('links keep the tab, the Period months and the full calendar; a pinned circle survives Copy link and a reload', async () => {
  await page.goto(new URL('#/?area=circle:-2.2096,113.91,50&month=202610&tab=period&from=202610&to=202610', base).toString(), { waitUntil: 'domcontentloaded' });
  await waitName('km around');
  await page.waitForSelector('.pp-caption strong', { timeout: 60_000 });
  const tab = await page.locator('[role="tab"][aria-selected="true"]').innerText();
  const period = await page.locator('.pp-caption strong').innerText();
  assert(tab === 'Period' && /^Oct 2026$/.test(period), `tab ${tab}, period ${period}`);
  // a tab change is written into the link
  await openTab('Calendar');
  await page.waitForFunction(() => window.location.hash.includes('tab=calendar') && !window.location.hash.includes('from='), null, { timeout: 10_000 });
  // the full calendar from a link
  await page.goto(new URL('#/?area=state:IDN-1931&tab=calendar&cal=full', base).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.fh-calf[open] .fh-calf-cell', { timeout: 120_000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.fh-calf[open]') && !window.location.hash.includes('cal=full'), null, { timeout: 10_000 });
  // pin a city circle, copy the link, reload
  await page.goto(new URL('#/?area=circle:-2.2096,113.91,50&month=202610', base).toString(), { waitUntil: 'domcontentloaded' });
  await waitName('km around');
  await waitReady();
  await page.getByRole('button', { name: /^Compare/ }).click();
  await page.waitForFunction(() => window.location.hash.includes('compare=circle:-2.2096,113.91,50'), null, { timeout: 10_000 });
  await page.goto(new URL('#/?area=state:IDN-1931&month=202610&compare=circle:-2.2096,113.91,50', base).toString(), { waitUntil: 'domcontentloaded' });
  await waitName('Kalimantan');
  await page.getByRole('button', { name: 'Copy a link to this view' }).click();
  await toastSeen('Link copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert(copied.includes('compare=circle:-2.2096,113.91,50'), copied);
  ownLoads++;
  await page.goto(copied, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitName('Kalimantan');
  await page.waitForSelector('.fh-ex-pin', { timeout: 60_000 });
  const pin = await page.locator('.fh-ex-pin-name').first().innerText();
  assert(/50 km around/.test(pin), `pin ${pin}`);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  // "&search=1" opens the place search with the focus in it
  await page.goto(new URL('#/?search=1', base).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.activeElement?.classList.contains('fh-search-input'), null, { timeout: 60_000 });
  return `Period ${period}; copied ${copied.split('#')[1]}; pinned "${pin}"`;
});

await check('command palette: open a place and run actions', async () => {
  await blur();
  await page.keyboard.press('Control+k');
  const input = page.locator('.ui-palette input[role="combobox"]');
  await input.waitFor({ timeout: 10_000 });
  await input.fill('Malaysia');
  await page.waitForSelector('#fh-palette-list [role="option"]', { timeout: 10_000 });
  await page.keyboard.press('Enter');
  await waitName('Malaysia');
  await page.keyboard.press('Control+k');
  await input.fill('against normal');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.location.hash.includes('mode=anomaly'));
  await page.keyboard.press('Control+k');
  await input.fill('fire count');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.location.hash.includes('mode=anomaly'));
  return await areaName();
});

await check('every Explorer command, from the palette and the command channel', async () => {
  const done = [];
  await palette('Play the months');
  await page.waitForFunction(() => document.querySelector('.fh-ex-play')?.getAttribute('aria-pressed') === 'true');
  await emit({ action: 'play-toggle' });
  await page.waitForFunction(() => document.querySelector('.fh-ex-play')?.getAttribute('aria-pressed') === 'false');
  done.push('play-toggle');
  // (the map can still be loading its finer hexagons after the flight to Malaysia: wait until it shows the chosen month)
  await page.waitForFunction(() => { const m = document.querySelector('.fh-ex-map'); return m?.dataset.status === 'idle' && window.location.hash.includes(`month=${m.dataset.ym}`); },
    null, { timeout: 60_000 });
  const ym0 = await mapYm();
  // (the player may have stopped on the last month, or on the first after it wrapped: step away from the ends)
  const dir = ym0 >= 201601 ? -1 : 1;
  await emit({ action: 'step-month', by: dir });
  await waitYm((ym, want) => ym === want, 15_000, addYm(ym0, dir));
  await emit({ action: 'step-month', by: 12 * dir });
  await waitYm((ym, want) => ym === want, 15_000, addYm(ym0, 13 * dir));
  done.push(`step-month ${ym0} → ${addYm(ym0, dir)} → ${addYm(ym0, 13 * dir)}`);
  await emit({ action: 'scale', scale: 'modis' });
  await page.waitForFunction(() => document.querySelector('.fh-ex-controls .fh-ex-legend-title')?.textContent?.includes('MODIS'));
  await emit({ action: 'scale', scale: 'harmonized' });
  await page.waitForFunction(() => document.querySelector('.fh-ex-controls .fh-ex-legend-title')?.textContent?.includes('NOAA-20'));
  done.push('scale');
  await emit({ action: 'colour', mode: 'anomaly' });
  await page.waitForFunction(() => window.location.hash.includes('mode=anomaly'));
  await emit({ action: 'colour', mode: 'count' });
  await page.waitForFunction(() => !window.location.hash.includes('mode=anomaly'));
  done.push('colour');
  await palette('Switch 2D or 3D hexagons');
  await page.waitForFunction(() => Math.abs((window.__fhMap?.map()?.getPitch() ?? 0) - 45) < 1, null, { timeout: 120_000 });
  await emit({ action: 'toggle-3d' });
  await page.waitForFunction(() => (window.__fhMap?.map()?.getPitch() ?? 1) < 1, null, { timeout: 120_000 });
  done.push('toggle-3d');
  await settle();
  await toastGone('CSV saved');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), palette('Download this area as CSV')]);
  assert(/malaysia\.csv$/.test(dl.suggestedFilename()), `file ${dl.suggestedFilename()}`);
  await toastSeen('CSV saved');
  done.push(`download-csv (${dl.suggestedFilename()})`);
  await toastGone('Link copied');
  await palette('Copy a link to this view');
  await toastSeen('Link copied');
  done.push('copy-link');
  await emit({ action: 'select-area', kind: 'country', id: 'BRA' });
  await waitName('Brazil');
  assert((await hash()).includes('area=country:BRA'), `hash ${await hash()}`);
  done.push('select-area');
  return done.join('; ');
});

await check('the hash drives the view (back to the world)', async () => {
  await page.evaluate(() => { window.location.hash = '#/?area=world:WORLD&mode=anomaly'; });
  await waitName('World');
  await page.waitForFunction(() => document.querySelector('.fh-ex-controls .fh-ex-legend-title')?.textContent?.includes('normal'));
  await page.evaluate(() => { window.location.hash = '#/?area=country:BRA'; });
  await waitName('Brazil');
});

await check('the panel folds away and comes back', async () => {
  await page.getByRole('button', { name: 'Hide the panel' }).click();
  await page.getByRole('button', { name: 'Show the panel' }).click();
  await page.waitForSelector('.fh-ex-panel:not([hidden])');
});

await check('light theme (T) redraws the map and keeps working', async () => {
  await blur();
  await page.keyboard.press('t');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, 'light.png'), timeout: 60_000 });
  await page.keyboard.press('t');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
});

await check('phone width: nothing scrolls sideways', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.innerWidth === 390, null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  assert(wide <= 391, `page is ${wide} px wide`);
  await page.screenshot({ path: path.join(outDir, 'phone.png'), fullPage: true, timeout: 60_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  return `${wide} px`;
});

await check('no console errors or failed requests', async () => {
  assert(problems.length === 0, problems.slice(0, 5).join(' | '));
});

await browser.close();
const outside = Math.max(0, loads - ownLoads);
if (devUpdates.length || outside) {
  console.log(`note: while the checks ran, the dev server hot updated ${devUpdates.length} modules and reloaded the page ` +
    `${outside} times (edits to the code)${devUpdates.length ? `: ${devUpdates.slice(0, 4).join(', ')}` : ''}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; failed: ${failed.map((f) => f.name).join('; ')}` : ''}.`);
process.exit(failed.length ? 1 : 0);
