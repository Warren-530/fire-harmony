// End-to-end check of the place search and the command palette in a real (headless) Chrome: one search engine for the
// palette and the Explorer's panel (ranking, islands and common names, cities as 50 km circles named after them),
// the palette's groups, highlights, keys and touch layout, keys typed while its code loads, Explorer actions from any
// page, copy link, recent places in both lists, and history (Back during a camera flight too).
// Usage: node scripts/test_search.mjs [baseUrl]      (default http://127.0.0.1:5173/; the dev server must run)
//        THEME=light node scripts/test_search.mjs   (the laptop checks in light and the phone checks in dark; default the
//        other way round)
// Prints one line per check and exits with 1 when any check fails. Screenshots of failures go to /tmp/fh_test_search.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.env.TEST_OUT ?? '/tmp/fh_test_search';
fs.mkdirSync(outDir, { recursive: true });
const url = (hash) => new URL(hash, base).toString();
const LAPTOP_THEME = process.env.THEME === 'light' ? 'light' : 'dark';
const PHONE_THEME = LAPTOP_THEME === 'light' ? 'dark' : 'light';

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const problems = [];
let page = null;

/** A new window (closing the last one): size, theme, and touch for a phone. */
async function newPage({ width = 1440, height = 900, theme = 'dark', touch = false } = {}) {
  if (page) await page.context().close();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
  await context.addInitScript((t) => { try { localStorage.setItem('fh_theme', t); } catch { /* ignore */ } }, theme);
  page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && /cannot fit|Map cannot/i.test(m.text()))) problems.push(`${m.type()}: ${m.text()}`.slice(0, 300));
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 300)}`));
  return page;
}

const results = [];
let n = 0;
async function check(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ ok: true, name });
    console.log(`PASS ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)${note ? ` - ${note}` : ''}`);
  } catch (e) {
    results.push({ ok: false, name });
    const file = path.join(outDir, `fail_${++n}.png`);
    await page?.screenshot({ path: file, timeout: 60_000 }).catch(() => undefined);
    console.log(`FAIL ${name}: ${String(e?.message ?? e).split('\n')[0].slice(0, 300)} (screenshot ${file})`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const READY = '.fh-ex[data-series-ready="true"] .fh-ex-map[data-ready="true"]';
const INPUT = '.ui-palette input[role="combobox"]';
const hash = () => page.evaluate(() => decodeURIComponent(window.location.hash));
const areaName = () => page.locator('.fh-ex-name').innerText();
const blur = () => page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
async function waitName(text, timeout = 90_000) {
  await page.waitForFunction((t) => document.querySelector('.fh-ex-name')?.textContent?.includes(t), text, { timeout });
}
/** Opens the palette (Ctrl+K) and types a query; resolves to the labels of the options. */
async function palette(query, wait = 'option') {
  if (!(await page.locator(INPUT).count())) {
    await blur();
    await page.keyboard.press('Control+k');
  }
  await page.waitForSelector(INPUT, { timeout: 20_000 });
  await page.fill(INPUT, query);
  if (wait === 'option') {
    await page.waitForFunction(() => document.querySelectorAll('#fh-palette-list [role="option"]').length > 0, null, { timeout: 20_000 });
    await page.waitForTimeout(250);
  }
  return labels();
}
const labels = () => page.evaluate(() => [...document.querySelectorAll('#fh-palette-list [role="option"] .ui-palette-label')].map((e) => e.textContent));
const hints = () => page.evaluate(() => [...document.querySelectorAll('#fh-palette-list [role="option"] .ui-palette-hint')].map((e) => e.textContent));
async function closePalette() {
  if (await page.locator(INPUT).count()) await page.keyboard.press('Escape');
  await page.waitForSelector('.ui-palette-backdrop', { state: 'detached', timeout: 5_000 });
}
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.ui-toast')].map((t) => t.textContent ?? ''));
async function camera() {
  await page.waitForFunction(() => { const m = window.__fhMap?.map(); return m && !m.isMoving(); }, null, { timeout: 60_000 });
  return page.evaluate(() => { const m = window.__fhMap.map(), c = m.getCenter(); return { lat: c.lat, lon: c.lng, zoom: m.getZoom() }; });
}
async function cameraIn(box, timeout = 90_000) {
  await page.waitForFunction((b) => {
    const m = window.__fhMap?.map();
    if (!m || m.isMoving()) return false;
    const c = m.getCenter();
    return c.lat > b.s && c.lat < b.n && c.lng > b.w && c.lng < b.e && m.getZoom() > b.z;
  }, box, { timeout });
  const c = await camera();
  return `camera ${c.lat.toFixed(1)}, ${c.lon.toFixed(1)}, zoom ${c.zoom.toFixed(1)}`;
}
/** Whether an input's placeholder fits its free width (measured with its own font), as a note. */
const fits = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return 'missing';
  const cs = getComputedStyle(el);
  const c = document.createElement('canvas').getContext('2d');
  c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const need = c.measureText(el.placeholder).width;
  return need <= room ? `"${el.placeholder}"` : `cut: "${el.placeholder}" needs ${need.toFixed(0)} px of ${room.toFixed(0)}`;
}, sel);
const PANEL_INPUT = '.fh-picker input[role="combobox"]';
// in English, as the report writes them (lib/names.ts); the local names are found too
const KALIMANTAN = ['Central Kalimantan, Indonesia', 'East Kalimantan, Indonesia', 'South Kalimantan, Indonesia', 'West Kalimantan, Indonesia'];
let paletteKal = [];

// ------------------------------------------------------------------------------------------------- laptop, dark

console.log(`laptop checks in ${LAPTOP_THEME}, phone checks in ${PHONE_THEME}`);

await check('keys typed while the palette code still loads go into the box, not to the Explorer (T, D, A, Space)', async () => {
  await newPage({ theme: LAPTOP_THEME });
  // the palette's code is held back until 2.5 s after the keys (as on a slow network), the idle prefetch too
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route(/\/src\/components\/CommandPalette\.tsx/, async (route) => { await held; await route.continue(); });
  await page.goto(url('#/?area=state:IDN-492&month=201909'), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(READY, { timeout: 180_000 });
  await waitName('Riau');
  await page.waitForTimeout(1500);
  const before = await hash();
  await blur();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Thailand da', { delay: 30 });
  await page.keyboard.press('Space');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  const early = await page.locator(INPUT).count();
  setTimeout(() => release(), 2500);
  await page.waitForSelector(INPUT, { timeout: 30_000 });
  await page.waitForFunction((s) => document.querySelector(s)?.value === 'Thailand', INPUT, { timeout: 10_000 });
  assert(early === 0, 'the palette was already loaded, so the key buffer was not tested');
  await page.waitForTimeout(500);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  const after = await hash();
  const playing = await page.evaluate(() => document.querySelector('.fh-ex-play')?.getAttribute('aria-pressed'));
  assert(theme === LAPTOP_THEME, `theme flipped to ${theme}`);
  assert(after === before, `the hash changed: ${before} -> ${after}`);
  assert(playing !== 'true', 'Space started playing');
  assert(await page.evaluate((s) => document.activeElement === document.querySelector(s), INPUT), 'the box has no focus');
  await page.waitForFunction(() => document.querySelectorAll('#fh-palette-list [role="option"]').length > 0, null, { timeout: 20_000 });
  assert((await labels())[0] === 'Thailand', `first result ${(await labels())[0]}`);
  // once loaded: D, A and Space typed into the open palette stay there too
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Da Nang', { delay: 30 });
  await page.waitForTimeout(400);
  const value = await page.locator(INPUT).inputValue();
  assert(value === 'Da Nang' && (await hash()) === before, `box "${value}", hash ${await hash()}`);
  await closePalette();
  return `box "Thailand" while the code loaded, then "Da Nang"; hash and theme unchanged`;
});

await newPage({ theme: LAPTOP_THEME });

await check('keys typed right after Ctrl+K on a fresh page go into the box, not to the page', async () => {
  await page.goto(url('#/dashboard'), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.fh-search-trigger', { timeout: 60_000 });
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Thailand', { delay: 30 });
  await page.waitForSelector(INPUT, { timeout: 20_000 });
  await page.waitForFunction((s) => document.querySelector(s)?.value === 'Thailand', INPUT, { timeout: 10_000 });
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  assert(theme === LAPTOP_THEME, `theme flipped to ${theme}`);
  assert(await page.evaluate((s) => document.activeElement === document.querySelector(s), INPUT), 'the box has no focus');
  await page.waitForFunction(() => document.querySelectorAll('#fh-palette-list [role="option"]').length > 0, null, { timeout: 20_000 });
  const first = (await labels())[0];
  assert(first === 'Thailand', `first result ${first}`);
  await closePalette();
  return `box "Thailand", theme ${theme}`;
});

await check('the palette has groups, and the active row stays in view (End, Home, Page Down, wrap)', async () => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector(INPUT);
  const heads = await page.evaluate(() => [...document.querySelectorAll('.ui-palette-group-title > span:first-child')].map((e) => e.textContent));
  assert(heads.includes('Pages') && heads.includes('Actions') && heads.includes('Try'), `groups ${heads.join(', ')}`);
  // away from the map, the Actions group says once that its map actions open the Explorer (not on every row)
  const notes = await page.evaluate(() => [...document.querySelectorAll('.ui-palette-group-note')].map((e) => e.textContent));
  const rowNotes = (await hints()).filter((h) => /Opens the Explorer/.test(h)).length;
  assert(notes.length === 1 && notes[0] === 'Map actions open the Explorer' && rowNotes === 0, `group notes ${notes.join(' | ')}, rows ${rowNotes}`);
  const inView = () => page.evaluate(() => {
    const list = document.getElementById('fh-palette-list');
    const act = list?.querySelector('[aria-selected="true"]');
    const head = act?.closest('[role="group"]')?.querySelector('.ui-palette-group-title');
    if (!list || !act) return 'no active row';
    const l = list.getBoundingClientRect(), a = act.getBoundingClientRect(), hb = head?.getBoundingClientRect().bottom ?? l.top;
    return a.top >= Math.max(l.top, hb) - 1 && a.bottom <= l.bottom + 1 ? 'ok' : `row ${a.top.toFixed(0)}-${a.bottom.toFixed(0)}, list ${l.top.toFixed(0)}-${l.bottom.toFixed(0)}`;
  });
  const total = await page.locator('#fh-palette-list [role="option"]').count();
  await page.keyboard.press('End');
  assert(await inView() === 'ok', `after End: ${await inView()}`);
  const last = await page.evaluate(() => document.querySelector('#fh-palette-list [aria-selected="true"]')?.id);
  assert(last === `fh-pal-${total - 1}`, `End gave ${last} of ${total}`);
  await page.keyboard.press('Home');
  assert(await inView() === 'ok', `after Home: ${await inView()}`);
  for (let i = 0; i < total; i++) {
    await page.keyboard.press('ArrowDown');
    const v = await inView();
    assert(v === 'ok', `step ${i + 1}: ${v}`);
  }
  await page.keyboard.press('PageDown');
  assert(await inView() === 'ok', `after Page Down: ${await inView()}`);
  // a suggestion to try types itself in
  await page.locator('#fh-palette-list [role="option"]', { hasText: 'Borneo' }).click();
  await page.waitForFunction((s) => document.querySelector(s)?.value === 'Borneo', INPUT, { timeout: 5_000 });
  await page.waitForFunction(() => document.querySelector('#fh-palette-list .ui-palette-hint')?.textContent === 'State on Borneo', null, { timeout: 10_000 });
  await closePalette();
  return `${total} rows, groups ${heads.join(', ')}; "Borneo" from Try lists its provinces`;
});

await check('"kal": the four Kalimantan provinces first, with the matched letters marked', async () => {
  paletteKal = await palette('kal');
  assert(JSON.stringify(paletteKal.slice(0, 4).sort()) === JSON.stringify(KALIMANTAN), `first four ${paletteKal.slice(0, 4).join(' | ')}`);
  const mark = await page.evaluate(() => document.querySelector('#fh-palette-list [role="option"] mark')?.textContent);
  assert(mark === 'Kal', `mark ${mark}`);
  const weight = await page.evaluate(() => getComputedStyle(document.querySelector('#fh-palette-list mark')).fontWeight);
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('#fh-palette-list mark')).backgroundColor);
  assert(Number(weight) >= 600 && /rgba\(0, 0, 0, 0\)|transparent/.test(bg), `mark weight ${weight}, background ${bg}`);
  const h = await hints();
  assert(h[0] === 'State on Borneo', `hint ${h[0]}`);
  return paletteKal.slice(0, 5).join(' | ');
});

await check('islands, regions and common names: sumatra, borneo, amazon, usa, sao paulo, ivory coast, türkiye, brasil, viet nam', async () => {
  const want = {
    sumatra: ['Riau, Indonesia', 'South Sumatra, Indonesia', 'Jambi, Indonesia'],
    borneo: ['Central Kalimantan, Indonesia', 'Sarawak, Malaysia', 'Brunei'],
    amazon: ['Pará, Brazil', 'Mato Grosso, Brazil', 'Amazonas, Brazil'],
    usa: ['United States'],
    'sao paulo': ['São Paulo, Brazil', 'São Paulo'],
  };
  const notes = [];
  for (const [q, names] of Object.entries(want)) {
    const got = await palette(q);
    for (const nm of names) assert(got.includes(nm), `"${q}" lacks ${nm}: ${got.join(' | ')}`);
    notes.push(`${q} → ${got[0]}`);
  }
  assert((await palette('sumatra'))[0] && (await hints())[0].endsWith('on Sumatra'), `sumatra hint ${(await hints())[0]}`);
  for (const [q, first] of [['ivory coast', "Côte d'Ivoire"], ['türkiye', 'Turkey'], ['brasil', 'Brazil'], ['viet nam', 'Vietnam'],
    ['republic of congo', 'Congo'], ['nsw', 'New South Wales, Australia'], ['kalteng', 'Central Kalimantan, Indonesia'], ['america', 'United States'],
    ['central kalimantan', 'Central Kalimantan, Indonesia'], ['kalimantan tengah', 'Central Kalimantan, Indonesia'], ['drc', 'DR Congo']]) {
    const got = await palette(q);
    assert(got[0] === first, `"${q}" first ${got[0]}`);
  }
  const cerrado = await palette('cerrado');
  assert(cerrado.includes('Goiás, Brazil') && cerrado.includes('Tocantins, Brazil'), `cerrado ${cerrado.join(' | ')}`);
  await closePalette();
  return notes.join('; ');
});

await check('cities: "pekanbaru" and "palangka" offer the city with its state and country', async () => {
  const p = await palette('pekanbaru');
  assert(p[0] === 'Pekanbaru' && (await hints())[0] === 'City in Riau, Indonesia', `pekanbaru: ${p[0]} / ${(await hints())[0]}`);
  const q = await palette('palangka');
  assert(q[0] === 'Palangka Raya' && (await hints())[0] === 'City in Central Kalimantan, Indonesia', `palangka: ${q[0]} / ${(await hints())[0]}`);
  // the city of a small state of the same name comes first (Kuala Lumpur the city, not its 300 km² district)
  const kl = await palette('Kuala Lumpur');
  assert(kl[0] === 'Kuala Lumpur' && (await hints())[0].startsWith('City'), `kuala lumpur: ${kl[0]} / ${(await hints())[0]}`);
  // a local name finds the English one, and says so
  await palette('Kalimantan Tengah');
  assert((await labels())[0] === 'Central Kalimantan, Indonesia' && (await hints())[0] === 'State, local name Kalimantan Tengah', `local: ${(await labels())[0]} / ${(await hints())[0]}`);
  const l = await palette('london');
  const londons = (await hints()).filter((_, i) => l[i] === 'London');
  assert(londons.length === 2 && londons[0] !== londons[1], `london hints ${londons.join(' | ')}`);
  assert(londons.includes('City in the United Kingdom') && londons.includes('City in Ontario, Canada'), `london hints ${londons.join(' | ')}`);
  const j = await palette('johannesburg');
  assert(j[0] === 'Johannesburg' && (await hints())[0] === 'City in Gauteng, South Africa', `johannesburg: ${(await hints())[0]}`);
  await closePalette();
  return `London: ${londons.join(' / ')}`;
});

await check('Tab keeps the focus in the palette; Escape closes it; T and ? do nothing meanwhile', async () => {
  await palette('', 'none');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => !!document.activeElement?.closest('.ui-palette'));
  assert(inside, `focus left the palette for ${await page.evaluate(() => document.activeElement?.className)}`);
  await page.keyboard.press('t');
  await page.keyboard.press('Shift+?');
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  const shortcuts = await page.locator('.ui-shortcuts').count();
  assert(theme === LAPTOP_THEME && shortcuts === 0, `theme ${theme}, shortcuts dialogs ${shortcuts}`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.ui-palette-backdrop', { state: 'detached', timeout: 5_000 });
  return 'focus stayed, Escape closed';
});

await check('open and close animation: a fade and a scale from 98% in 140 ms; none under reduced motion', async () => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector(INPUT);
  const anim = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.ui-palette')); return `${s.animationName} ${s.animationDuration}`; });
  assert(anim === 'ui-palette-in 0.14s', `animation ${anim}`);
  await page.keyboard.press('Escape');
  const closing = await page.evaluate(() => document.querySelector('.ui-palette-backdrop')?.hasAttribute('data-closing') ?? false);
  await page.waitForSelector('.ui-palette-backdrop', { state: 'detached', timeout: 5_000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Control+k');
  await page.waitForSelector(INPUT);
  const still = await page.evaluate(() => getComputedStyle(document.querySelector('.ui-palette')).animationName);
  await page.keyboard.press('Escape');
  const gone = await page.locator('.ui-palette-backdrop').count();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert(closing && still === 'none' && gone === 0, `closing ${closing}, reduced ${still}, still open ${gone}`);
  return `${anim}; reduced motion: ${still}`;
});

await check('the palette placeholder fits (the panel one is checked with the panel)', async () => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector(INPUT);
  const p = await fits(INPUT);
  await closePalette();
  assert(!p.startsWith('cut') && p !== 'missing', `palette ${p}`);
  return `palette ${p}`;
});

await check('an Explorer action on a fresh Dashboard opens the Explorer and runs once (Colour against normal)', async () => {
  await palette('Colour against normal');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.location.hash.startsWith('#/') && !window.location.hash.startsWith('#/dashboard'), null, { timeout: 30_000 });
  await page.waitForSelector(READY, { timeout: 150_000 });
  await page.waitForFunction(() => window.location.hash.includes('mode=anomaly'), null, { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('.fh-ex-controls .fh-ex-legend-title')?.textContent?.includes('normal'), null, { timeout: 30_000 });
  return await hash();
});

await check('panel search: its placeholder fits, and "kal" gives the same places in the same order as the palette, marked', async () => {
  const fit = await fits(PANEL_INPUT);
  assert(!fit.startsWith('cut') && fit !== 'missing', `panel placeholder ${fit}`);
  const box = page.getByRole('combobox', { name: 'Find a place' });
  await box.click();
  await box.fill('kal');
  await page.waitForFunction(() => document.querySelectorAll('.fh-listbox [role="option"]').length >= 8, null, { timeout: 20_000 });
  await page.waitForTimeout(300);
  const panel = await page.evaluate(() => [...document.querySelectorAll('.fh-listbox [role="option"] .fh-option-name')].map((e) => e.textContent));
  assert(JSON.stringify(panel.slice(0, 8)) === JSON.stringify(paletteKal.slice(0, 8)), `panel ${panel.slice(0, 8).join(' | ')} vs palette ${paletteKal.slice(0, 8).join(' | ')}`);
  const mark = await page.evaluate(() => document.querySelector('.fh-listbox mark')?.textContent);
  assert(mark === 'Kal', `mark ${mark}`);
  await box.fill('');
  await page.keyboard.press('Escape');
  return `${panel.length} results, placeholder ${fit}`;
});

await check('panel search picks add history: Back returns to the previous area (camera too), Forward again', async () => {
  const box = page.getByRole('combobox', { name: 'Find a place' });
  const pickPlace = async (q, option) => {
    await box.click();
    await box.fill(q);
    const opt = page.getByRole('option', { name: option });
    await opt.waitFor({ timeout: 20_000 });
    await opt.click();
  };
  await pickPlace('Indonesia', /^Indonesia\s*Country$/);
  await waitName('Indonesia');
  await cameraIn({ s: -12, n: 7, w: 94, e: 142, z: 2.5 });
  const len = await page.evaluate(() => history.length);
  await pickPlace('Brazil', /^Brazil\s*Country$/);
  await waitName('Brazil');
  const len2 = await page.evaluate(() => history.length);
  assert(len2 === len + 1, `history ${len} -> ${len2}`);
  await page.goBack();
  await waitName('Indonesia');
  const cam = await cameraIn({ s: -12, n: 7, w: 94, e: 142, z: 2.5 });
  assert((await hash()).includes('area=country:IDN'), `hash after Back ${await hash()}`);
  await page.goForward();
  await waitName('Brazil');
  await cameraIn({ s: -35, n: 6, w: -75, e: -33, z: 2 });
  return `Back to Indonesia (${cam}), Forward to Brazil`;
});

await check('a city from the palette opens a 50 km circle named after it; it shows under Recent', async () => {
  await palette('palangka');
  await page.keyboard.press('Enter');
  await waitName('Palangka Raya');
  const nm = await areaName();
  assert(nm === '50 km around Palangka Raya, Indonesia', `name ${nm}`);
  const h = await hash();
  assert(/area=circle:-2\.\d+,113\.\d+,50/.test(h), `hash ${h}`);
  await cameraIn({ s: -3.5, n: -1, w: 112.5, e: 115.5, z: 6 });
  await palette('', 'none');
  const recent = await page.evaluate(() => {
    const g = [...document.querySelectorAll('#fh-palette-list [role="group"]')].find((x) => x.querySelector('.ui-palette-group-title')?.textContent === 'Recent');
    return g ? [...g.querySelectorAll('.ui-palette-label')].map((e) => e.textContent) : [];
  });
  await closePalette();
  assert(recent[0] === 'Palangka Raya', `recent ${recent.join(' | ')}`);
  // the panel's own list shows the palette's pick at once (no reload)
  await page.locator(PANEL_INPUT).click();
  await page.waitForFunction(() => document.querySelector('.fh-listbox .fh-group-title')?.textContent === 'Recent', null, { timeout: 10_000 });
  const panelRecent = await page.evaluate(() => document.querySelector('.fh-listbox [role="option"] .fh-option-name')?.textContent);
  await page.keyboard.press('Escape');
  await blur();
  assert(panelRecent === 'Palangka Raya', `panel recent ${panelRecent}`);
  return `${nm}; recent ${recent.join(', ')}; the panel lists it first too`;
});

await check('a circle link at a city is named after the city on a fresh load; 4.7 km away it keeps its coordinates', async () => {
  await page.goto(url('#/?area=circle:0.5669,101.4231,50'), { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitName('Pekanbaru');
  const at = await areaName();
  assert(at === '50 km around Pekanbaru, Indonesia', `name ${at}`);
  await page.evaluate(() => { window.location.hash = '#/?area=circle:0.5333,101.45,50'; });
  await waitName('0.53°N');
  return `${at}; ${await areaName()}`;
});

await check('months and coordinates: "sep 2019" shows that month, "-2.2, 113.9" offers a circle', async () => {
  await page.waitForSelector(READY, { timeout: 150_000 });
  const m = await palette('sep 2019');
  assert(m[0] === 'Show September 2019 on the map', `month item ${m[0]}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.fh-ex-map')?.getAttribute('data-ym') === '201909', null, { timeout: 30_000 });
  const c = await palette('-2.2, 113.9');
  assert(/^50 km around /.test(c[0]), `coordinates item ${c[0]}`);
  await closePalette();
  return `${m[0]}; ${c[0]}`;
});

await check('copy a link on Methods, Haze and the Dashboard: one toast, and the link of that page', async () => {
  const notes = [];
  for (const [hsh, want] of [['#/methods?section=limits', /#\/methods\?section=/], ['#/haze', /#\/haze/], ['#/dashboard', /#\/dashboard(\?s=[a-z]+)?$/]]) {
    await page.evaluate((x) => { window.location.hash = x; }, hsh);
    await page.waitForTimeout(2500);
    await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
    await page.waitForFunction(() => document.querySelectorAll('.ui-toast').length === 0, null, { timeout: 15_000 }).catch(() => undefined);
    await palette('Copy a link to this view');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const copied = (await toasts()).filter((t) => t.includes('Link copied')).length;
    assert(want.test(clip), `${hsh}: clipboard ${clip}`);
    assert(copied === 1, `${hsh}: ${copied} toasts`);
    notes.push(clip.replace(base, ''));
  }
  return notes.join(', ');
});

await check('an Explorer action on Methods ("play": Play the months, above the city Play Ku) opens the Explorer and plays', async () => {
  await page.evaluate(() => { window.location.hash = '#/methods'; });
  await page.waitForTimeout(1500);
  const first = (await palette('play'))[0];
  assert(first === 'Play the months', `first row ${first}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.fh-ex-play')?.getAttribute('aria-pressed') === 'true', null, { timeout: 60_000 });
  await page.locator('.fh-ex-play').click();
  await page.waitForFunction(() => document.querySelector('.fh-ex-play')?.getAttribute('aria-pressed') === 'false', null, { timeout: 30_000 });
  return await hash();
});

const BOXES = {
  Australia: { s: -40, n: -12, w: 115, e: 150, z: 2.2 },
  Indonesia: { s: -12, n: 7, w: 94, e: 142, z: 2.5 },
  Brazil: { s: -35, n: 6, w: -75, e: -33, z: 2 },
};
await check('a palette pick on Methods, then Back during the flight: Back returns to Methods, Forward ends on the place', async () => {
  const notes = [];
  for (const [place, mid] of [['Australia', 600], ['Indonesia', 1100]]) {
    await page.evaluate(() => { window.location.hash = '#/methods'; });
    await page.waitForTimeout(2000);
    await palette(place);
    await page.keyboard.press('Enter');
    await waitName(place, 60_000);
    await page.waitForTimeout(mid);
    await page.goBack();
    await page.waitForFunction(() => window.location.hash.startsWith('#/methods'), null, { timeout: 10_000 });
    await page.waitForTimeout(3000);
    await page.goForward();
    await waitName(place, 30_000);
    notes.push(`${place} (Back after ${mid} ms): ${await cameraIn(BOXES[place], 60_000)}`);
  }
  return notes.join('; ');
});

await check('Back right after opening a place from a Dashboard row: Forward ends with the camera on it', async () => {
  await page.evaluate(() => { window.location.hash = '#/dashboard'; });
  await page.waitForSelector('.db-table-countries tbody tr', { timeout: 90_000 });
  const row = page.locator('.db-table-countries tbody tr', { hasText: 'Brazil' }).first();
  await row.scrollIntoViewIfNeeded();
  await row.locator('td').nth(1).click();
  await waitName('Brazil', 60_000);
  await page.goBack();
  await page.waitForFunction(() => window.location.hash.startsWith('#/dashboard'), null, { timeout: 10_000 });
  await page.waitForTimeout(3000);
  await page.goForward();
  await waitName('Brazil', 30_000);
  return await cameraIn(BOXES.Brazil);
});

await check('light theme: the active row ring comes from the light accent', async () => {
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await palette('kal');
  const ring = await page.evaluate(() => getComputedStyle(document.querySelector('.ui-palette-item.is-active')).boxShadow);
  await closePalette();
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, LAPTOP_THEME);
  // rgb(231 86 35) or color(srgb 0.906 0.337 0.137 / a)
  const nums = (ring.match(/[\d.]+/g) ?? []).map(Number);
  const srgb = /color\(srgb/.test(ring);
  const [r, g, b] = srgb ? nums.slice(0, 3).map((v) => v * 255) : nums.slice(0, 3);
  assert(Math.abs(r - 231) < 3 && Math.abs(g - 86) < 3 && Math.abs(b - 35) < 3, `ring ${ring}`);
  return ring;
});

await check('an empty panel search suggests: recent, near me, far above normal now, most fire, try; no continent; no half row', async () => {
  await page.goto(url('#/'), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(READY, { timeout: 150_000 });
  await page.locator(PANEL_INPUT).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.fh-listbox .fh-group-title')].some((g) => g.textContent === 'Most fire'), null, { timeout: 60_000 });
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    const list = document.querySelector('.fh-suggest:not([hidden]) .fh-listbox');
    const groups = [...list.querySelectorAll('.fh-group-title')].map((g) => g.textContent);
    const names = [...list.querySelectorAll('.fh-option-name')].map((n) => n.textContent);
    const lb = list.getBoundingClientRect(), pad = parseFloat(getComputedStyle(list).paddingBottom) || 0;
    // a row is cut when its option box is partly inside the list's visible box
    const cutRows = [...list.querySelectorAll('.fh-option')].filter((o) => { const r = o.getBoundingClientRect(); return r.top < lb.bottom - pad - 1 && r.bottom > lb.bottom - pad + 1; })
      .map((o) => `${o.textContent} ${Math.round(o.getBoundingClientRect().top)}..${Math.round(o.getBoundingClientRect().bottom)} in ..${Math.round(lb.bottom - pad)}, scrolled ${list.scrollTop}`);
    return { groups, names, cut: cutRows.length, cutRows, more: list.hasAttribute('data-more') };
  });
  for (const g of ['Far above normal now', 'Most fire']) assert(info.groups.includes(g), `groups ${info.groups.join(', ')}`);
  assert(!info.names.some((n) => /Antarctica|ocean|Seven seas|^Africa$|^Asia$/.test(n)), `names ${info.names.join(' | ')}`);
  assert(info.cut === 0, `${info.cut} row cut by the list's foot: ${info.cutRows.join(' | ')}`);
  await page.locator('.fh-listbox').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(200);
  const tryRow = page.locator('.fh-listbox [role="option"]', { hasText: 'Borneo, September 2015' });
  assert(await tryRow.count() === 1, 'no try row');
  await tryRow.click();
  await waitName('Central Kalimantan');
  await page.waitForFunction(() => document.querySelector('.fh-ex-map')?.getAttribute('data-ym') === '201509', null, { timeout: 60_000 });
  return `${info.groups.join(', ')}; ${info.names.slice(0, 6).join(' | ')}; the try row opens Central Kalimantan in September 2015`;
});

await check('on the Explorer the header button says "Go to…", and "/" goes to the panel search', async () => {
  await blur();
  const text = await page.locator('.fh-search-trigger-text').innerText();
  assert(text === 'Go to…', `trigger ${text}`);
  await page.keyboard.press('/');
  await page.waitForTimeout(300);
  const focused = await page.evaluate((s) => document.activeElement === document.querySelector(s), PANEL_INPUT);
  assert(focused, '"/" did not focus the panel search');
  assert(!(await page.locator(INPUT).count()), '"/" opened the palette on the Explorer');
  await page.keyboard.press('Escape');
  await blur();
  await page.goto(url('#/methods'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  assert((await page.locator('.fh-search-trigger-text').innerText()) === 'Search places', 'trigger on Methods');
  return 'Go to… on the map, Search places elsewhere';
});

await check('the palette opens the rest of the project: report, poster, code, dataset, about', async () => {
  const got = await palette('report');
  assert(got.includes('Open the report'), `report: ${got.join(' | ')}`);
  for (const [q, want] of [['poster', 'Open the poster'], ['github', 'Open the code'], ['hugging face', 'Open the dataset'], ['about', 'About the project']]) {
    const g = await palette(q);
    assert(g.includes(want), `${q}: ${g.join(' | ')}`);
  }
  const popup = page.waitForEvent('popup', { timeout: 15_000 });
  await palette('open the report');
  await page.keyboard.press('Enter');
  const p = await popup;
  const href = p.url();
  await p.close();
  assert(/Fire_Harmony_report\.pdf$/.test(href), `opened ${href}`);
  return `the report opens ${href.replace(/^.*\//, '')} in a new tab`;
});

await check('the Explorer loads behind an outline of its own layout (panel, map ground, dock), with no footer', async () => {
  const out = [];
  for (const [w, h, touch] of [[1440, 900, false], [390, 844, true]]) {
    await newPage({ width: w, height: h, touch });
    // the Explorer's code arrives late on purpose, so the outline can be measured
    await page.route(/\/src\/pages\/Explorer\.tsx/, async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.continue(); });
    await page.goto(url('#/'), { waitUntil: 'commit' });
    // (the shell's own code takes a moment in the dev server; the outline is then on screen until the Explorer's code)
    await page.waitForSelector('.fh-ex-boot', { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const boot = document.querySelector('.fh-ex-boot'), panel = document.querySelector('.fh-ex-boot-panel'), dock = document.querySelector('.fh-ex-boot-dock');
      const footer = document.querySelector('.fh-footer');
      const r = (e) => (e ? (({ left, top, width, bottom, right }) => ({ left: Math.round(left), top: Math.round(top), width: Math.round(width), bottom: Math.round(bottom), right: Math.round(right) }))(e.getBoundingClientRect()) : null);
      return { boot: r(boot), panel: r(panel), dock: dock && getComputedStyle(dock).display !== 'none' ? r(dock) : null,
        footer: footer ? getComputedStyle(footer).display : 'none', doc: !!document.querySelector('.fh-page-loading'), h: innerHeight, w: innerWidth };
    });
    await page.screenshot({ path: path.join(outDir, `boot_${w}.png`) });
    assert(m.boot && !m.doc, `outline ${JSON.stringify(m)}`);
    assert(m.footer === 'none', `the footer shows: ${m.footer}`);
    if (w > 768) {
      assert(m.panel.left === 16 && m.panel.width === 384 && m.dock && m.dock.left === 16 + 384 + 16 && m.dock.bottom === m.h - 16, `laptop frame ${JSON.stringify(m)}`);
    } else {
      assert(m.panel.left === 0 && m.panel.width === w && m.panel.bottom === m.h && !m.dock, `phone sheet ${JSON.stringify(m)}`);
    }
    await page.unroute(/\/src\/pages\/Explorer\.tsx/);
    out.push(`${w}: panel ${m.panel.left},${m.panel.top} ${m.panel.width} px${m.dock ? `, dock from ${m.dock.left}` : ', a sheet'}`);
  }
  await newPage({ width: 1440, height: 900, theme: LAPTOP_THEME });
  return out.join('; ');
});

await check('before any code arrives, index.html shows the same outline in the theme last picked (never a white page)', async () => {
  const out = [];
  for (const [w, h, touch, theme] of [[1440, 900, false, 'dark'], [390, 844, true, 'light']]) {
    await newPage({ width: w, height: h, touch, theme });
    // the app's code arrives late on purpose: only index.html's own outline can be on screen
    await page.route(/\/src\/main\.tsx/, async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.continue().catch(() => undefined); });
    await page.goto(url('#/'), { waitUntil: 'commit' });
    await page.waitForSelector('.fh-preboot-panel', { timeout: 20_000 });
    await page.waitForTimeout(200);
    const m = await page.evaluate(() => {
      const r = (e) => (e ? (({ left, top, width, bottom }) => ({ left: Math.round(left), top: Math.round(top), width: Math.round(width), bottom: Math.round(bottom) }))(e.getBoundingClientRect()) : null);
      const dock = document.querySelector('.fh-preboot-dock');
      return { panel: r(document.querySelector('.fh-preboot-panel')), dock: dock && getComputedStyle(dock).display !== 'none' ? r(dock) : null,
        bg: getComputedStyle(document.documentElement).backgroundColor, theme: document.documentElement.dataset.theme, h: innerHeight };
    });
    await page.unroute(/\/src\/main\.tsx/);
    assert(m.theme === theme, `theme ${m.theme}`);
    assert(m.bg === (theme === 'dark' ? 'rgb(7, 9, 13)' : 'rgb(246, 246, 243)'), `page colour ${m.bg}`);
    if (w > 768) assert(m.panel.left === 16 && m.panel.top === 72 && m.panel.width === 384 && m.dock && m.dock.left === 416 && m.dock.bottom === m.h - 16, `laptop ${JSON.stringify(m)}`);
    else assert(m.panel.left === 0 && m.panel.width === w && m.panel.bottom === m.h && !m.dock, `phone ${JSON.stringify(m)}`);
    out.push(`${w} ${theme}: ${m.bg}, panel ${m.panel.left},${m.panel.top} ${m.panel.width} px`);
  }
  await newPage({ width: 1440, height: 900, theme: LAPTOP_THEME });
  return out.join('; ');
});

await check('no console errors (and no failed map fits)', async () => {
  assert(problems.length === 0, problems.slice(0, 5).join(' | '));
});

// ------------------------------------------------------------------------------------------------- phones (the other theme)

for (const [w, h] of [[390, 844], [320, 640]]) {
  await newPage({ width: w, height: h, theme: PHONE_THEME, touch: true });
  await check(`phone ${w}: no key hints, a close button, rows of 44 px or more, a placeholder that fits`, async () => {
    await page.goto(url('#/dashboard'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.fh-search-trigger', { timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.locator('.fh-search-trigger').tap();
    await page.waitForSelector(INPUT, { timeout: 20_000 });
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => {
      const pal = document.querySelector('.ui-palette');
      const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
      const kbd = [...pal.querySelectorAll('.ui-kbd')].filter(visible).length;
      const close = pal.querySelector('.ui-palette-close');
      const cr = close?.getBoundingClientRect();
      const rows = [...pal.querySelectorAll('[role="option"]')].map((o) => o.getBoundingClientRect().height);
      const shortcutsAction = [...pal.querySelectorAll('.ui-palette-label')].some((l) => l.textContent === 'Keyboard shortcuts');
      const box = pal.getBoundingClientRect();
      const input = pal.querySelector('input');
      const cs = getComputedStyle(input);
      const c = document.createElement('canvas').getContext('2d');
      c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const room = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { kbd, close: cr ? `${Math.round(cr.width)}x${Math.round(cr.height)}` : 'none', minRow: Math.min(...rows), shortcutsAction,
        inside: box.left >= 0 && box.right <= window.innerWidth, wide: document.documentElement.scrollWidth,
        placeholder: input.placeholder, fits: c.measureText(input.placeholder).width <= room };
    });
    assert(info.kbd === 0, `${info.kbd} key hints`);
    assert(info.close === '44x44', `close button ${info.close}`);
    assert(info.minRow >= 44, `a row of ${info.minRow} px`);
    assert(!info.shortcutsAction, 'the keyboard shortcuts action shows on touch');
    assert(info.inside && info.wide <= w + 1, `palette outside the screen (page ${info.wide} px wide)`);
    assert(info.fits, `placeholder cut: ${info.placeholder}`);
    await page.screenshot({ path: path.join(outDir, `phone_${w}.png`) });
    await page.locator('.ui-palette-close').tap();
    await page.waitForSelector('.ui-palette-backdrop', { state: 'detached', timeout: 5_000 });
    return `placeholder "${info.placeholder}", rows ${info.minRow.toFixed(0)} px and up, close ${info.close}`;
  });
  await check(`phone ${w}: the panel search placeholder fits; a tapped city opens a circle named after it`, async () => {
    await page.goto(url('#/'), { waitUntil: 'domcontentloaded' });
    // on phones the panel is a bottom sheet: its search button opens the search at the sheet's full height
    // (package explorer-panel)
    await page.waitForSelector(`${PANEL_INPUT}, .fh-ex-sheet`, { timeout: 90_000 });
    const opener = page.getByRole('button', { name: 'Find or draw a place', exact: true });
    if (await opener.count()) await opener.tap();
    await page.waitForSelector(PANEL_INPUT, { timeout: 90_000 });
    await page.waitForTimeout(800);
    const fit = await fits(PANEL_INPUT);
    assert(!fit.startsWith('cut') && fit !== 'missing', `panel placeholder ${fit}`);
    await page.locator(PANEL_INPUT).tap();
    await page.waitForTimeout(900);
    // the box moves up for its list, but stays clear of the sticky header
    const gap = await page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top
      - document.querySelector('.fh-header').getBoundingClientRect().bottom, PANEL_INPUT);
    assert(gap >= 0, `the box is ${(-gap).toFixed(0)} px under the header`);
    await page.waitForFunction(() => [...document.querySelectorAll('.fh-listbox .fh-group-title')].some((g) => /Far above normal now|Most fire|Try/.test(g.textContent)), null, { timeout: 60_000 });
    const phoneGroups = await page.evaluate(() => [...document.querySelectorAll('.fh-listbox .fh-group-title')].map((g) => g.textContent));
    assert(!(await page.evaluate(() => [...document.querySelectorAll('.fh-listbox .fh-option-name')].some((n) => /Antarctica|ocean/.test(n.textContent)))), 'a continent in the phone list');
    await page.locator(PANEL_INPUT).fill('kuala lumpur');
    const city = page.locator('.fh-listbox [role="option"]', { hasText: 'City in Malaysia' }).first();
    await city.waitFor({ timeout: 30_000 });
    await city.tap();
    await waitName('Kuala Lumpur', 90_000);
    const nm = await areaName();
    assert(nm === '50 km around Kuala Lumpur, Malaysia', `name ${nm}`);
    return `placeholder ${fit}; groups ${phoneGroups.join(', ')}; ${nm}`;
  });
}

await check('no console errors on the phones either', async () => {
  assert(problems.length === 0, problems.slice(0, 5).join(' | '));
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; failed: ${failed.map((f) => f.name).join('; ')}` : ''}.`);
process.exit(failed.length ? 1 : 0);
