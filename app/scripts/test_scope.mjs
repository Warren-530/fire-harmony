// Browser checks of the dashboard's scope bar (#/dashboard?area=…&years=…&months=…&scale=…) in a real (headless)
// Chrome: the four controls (a place from the search, a range of years, a season, the scale), the link and history,
// charts that follow the place while the layout stays, the linked pointer between charts, the "World" badge of the
// sections that cannot follow, the CSV of a view, the phone's sheet and pinned bar; and the numbers against the
// Explorer's own tiles and Period tab for the world, Indonesia, Riau, Brazil and 50 km around Palangkaraya.
// Usage: node scripts/test_scope.mjs [baseUrl] [only=explorer]     (THEME=light for the light theme)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] && !process.argv[2].startsWith('only=') ? process.argv[2] : 'http://127.0.0.1:5173/';
const only = (process.argv.find((a) => a.startsWith('only=')) ?? '').slice(5);
const outDir = process.env.TEST_OUT ?? '/tmp/fh_test_scope';
fs.mkdirSync(outDir, { recursive: true });
const THEME = process.env.THEME === 'light' ? 'light' : 'dark';
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const problems = [];
let page = null;

async function newPage({ width = 1440, height = 900, touch = false, theme = THEME } = {}) {
  if (page) await page.context().close();
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
  await context.addInitScript((t) => { try { localStorage.setItem('fh_theme', t); } catch { /* ignore */ } }, theme);
  page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${m.type()}: ${m.text()}`.slice(0, 300)); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 300)}`));
  return page;
}
/** Open a dashboard link and wait until the numbers of its scope are in. */
async function openDash(hash, opts) {
  await newPage(opts);
  await page.goto(new URL(hash, base).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#db-glance', { timeout: 60_000 });
  await scopeReady();
}
const scopeReady = () => page.waitForFunction(() => !document.querySelector('.db-glance.is-busy') && !document.querySelector('.db-scope-status .db-spin'), null, { timeout: 120_000 })
  .then(() => page.waitForTimeout(600));
const tile = (key) => page.evaluate((k) => {
  const el = document.querySelector(`.db-g[data-key="${k}"]`);
  return el ? { v: el.dataset.value === undefined ? null : Number(el.dataset.value), label: el.querySelector('.ui-stat-label')?.textContent ?? '' } : null;
}, key);
const hash = () => page.evaluate(() => decodeURIComponent(location.hash));

const results = [];
let shots = 0;
async function check(name, fn) {
  if (only && !name.toLowerCase().includes(only)) return;
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ ok: true, name });
    console.log(`PASS ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)${note ? ` - ${note}` : ''}`);
  } catch (e) {
    results.push({ ok: false, name });
    const file = path.join(outDir, `fail_${++shots}.png`);
    await page?.screenshot({ path: file }).catch(() => undefined);
    console.log(`FAIL ${name}: ${String(e?.message ?? e).split('\n')[0].slice(0, 300)} (screenshot ${file})`);
  }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };

// ------------------------------------------------------------------------------------------------ the bar on a laptop
await check('The bar shows the world, the whole record, every month, harmonized; each control has a label and a value', async () => {
  await openDash('#/dashboard');
  const btns = await page.$$eval('.db-scope-btn', (bs) => bs.map((b) => `${b.querySelector('.db-scope-label').textContent}: ${b.querySelector('.db-scope-value').textContent}`));
  assert(btns.join(' | ') === 'Place: World | Years: 2001 to 2026 | Months: All months | Scale: Harmonized', btns.join(' | '));
  const sticky = await page.evaluate(() => getComputedStyle(document.querySelector('.db-nav')).position);
  assert(sticky === 'sticky', sticky);
  return btns.join(' | ');
});

await check('Place: search "Riau", Enter; the charts follow, world sections say "World", Back returns to the world', async () => {
  await page.locator('.db-scope-btn').nth(0).click();
  await page.waitForSelector('.db-pop input', { timeout: 5000 });
  await page.keyboard.type('Riau');
  await page.waitForSelector('.db-pick-item.is-active', { timeout: 15_000 });
  const first = await page.locator('.db-pick-item.is-active .db-pick-label').innerText();
  await page.keyboard.press('Enter');
  await scopeReady();
  const h = await hash();
  const t = await page.evaluate(() => ({
    world: document.querySelector('#db-world h2')?.textContent, hero: document.querySelector('.db-g[data-key="latest"] .ui-stat-label')?.textContent,
    seam: document.querySelector('#db-seam .db-scope-badge')?.textContent, glance: document.querySelector('#db-glance .db-scope-badge')?.textContent ?? null,
    value: document.querySelector('.db-scope-btn .db-scope-value')?.textContent,
  }));
  assert(first.startsWith('Riau') && h === '#/dashboard?area=state:IDN-492', `${first} ${h}`);
  assert(t.world === 'Fire in Riau' && /^Fire in Riau in October 2026$/.test(t.hero) && t.seam === 'World' && t.glance === null && t.value === 'Riau', JSON.stringify(t));
  await page.goBack(); await scopeReady();
  const back = await hash();
  const worldTitle = await page.locator('#db-world h2').innerText();
  await page.goForward(); await scopeReady();
  const fwd = await hash();
  assert(back === '#/dashboard' && worldTitle === 'Fire across the world' && fwd === '#/dashboard?area=state:IDN-492', `${back} ${worldTitle} ${fwd}`);
  return `picked "${first}" -> ${h}; "${t.world}", "${t.hero}", seam badge "${t.seam}"; Back -> ${back}, Forward -> ${fwd}`;
});

await check('Months: August then October makes a season; the tiles, titles and the normal year follow', async () => {
  await page.locator('.db-scope-btn').nth(2).click();
  await page.waitForSelector('.db-mcell', { timeout: 5000 });
  await page.locator('.db-mcell').nth(7).click();
  await page.locator('.db-mcell').nth(9).click();
  await page.keyboard.press('Escape');
  await scopeReady();
  const h = await hash();
  const p = await tile('period');
  const yearly = await page.locator('#db-world .ui-figure-title').first().innerText();
  const lit = await page.$$eval('#db-world .ui-figure-plot svg rect', (r) => r.length);
  assert(h === '#/dashboard?area=state:IDN-492&months=8-10', h);
  assert(p.label === 'Aug to Oct 2026' && /August to October fire in Riau/.test(yearly), `${p.label} | ${yearly}`);
  return `${h}; period tile "${p.label}" ${Math.round(p.v)}; "${yearly}"; ${lit} shaded parts in the normal year`;
});

await check('Years: the keys move the first year; the trend and the record follow; the layout stays', async () => {
  const before = await page.$$eval('.db-g', (g) => g.slice(0, 3).map((e) => Math.round(e.getBoundingClientRect().left)));
  await page.locator('.db-scope-btn').nth(1).click();
  const first = page.locator('.db-years-range input').first();
  await first.focus();
  for (let k = 0; k < 4; k++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await scopeReady();
  const h = await hash();
  const tr = await tile('trend');
  const after = await page.$$eval('.db-g', (g) => g.slice(0, 3).map((e) => Math.round(e.getBoundingClientRect().left)));
  const rows = await page.$$eval('#db-world .ui-figure-table tbody tr', (r) => r.length);
  assert(h.includes('years=2005-2026'), h);
  assert(tr.label === 'Trend per decade, 2005 to 2025', tr.label);
  assert(before.join() === after.join(), `tiles moved: ${before} -> ${after}`);
  return `${h}; "${tr.label}" ${tr.v?.toFixed(1)}%; tiles stay at ${after.join(', ')} px; yearly table ${rows} rows`;
});

await check('Scale: MODIS drops the 90% range and says so; raw sensors draw each satellite', async () => {
  await page.locator('.db-scope-btn').nth(3).click();
  await page.locator('.db-pop [role="radio"]', { hasText: 'MODIS' }).click();
  await page.keyboard.press('Escape');
  await scopeReady();
  const h1 = await hash();
  const keys1 = await page.$$eval('#db-world .db-key', (k) => k.map((x) => x.textContent));
  await page.locator('.db-scope-btn').nth(3).click();
  await page.locator('.db-pop [role="radio"]', { hasText: 'Raw' }).click();
  await page.keyboard.press('Escape');
  await scopeReady();
  const keys2 = await page.$$eval('#db-world .db-key', (k) => k.map((x) => x.textContent));
  assert(h1.endsWith('scale=modis') && !keys1.some((k) => /90% range/.test(k)) && keys1.includes('MODIS scale'), `${h1} ${keys1}`);
  assert(['Terra', 'Aqua', 'Suomi NPP', 'NOAA-20', 'NOAA-21'].every((s) => keys2.includes(s)), `${keys2}`);
  return `${h1}: ${keys1.join(', ')}; raw: ${keys2.join(', ')}`;
});

await check('Pointing at a year in the yearly chart draws its months on the normal year and marks it on the trend line', async () => {
  await openDash('#/dashboard?area=country:IDN');
  await page.locator('#db-world').scrollIntoViewIfNeeded();
  const plot = page.locator('#db-world .ui-figure-plot svg').first();
  const b = await plot.boundingBox();
  await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.5);
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    line: document.querySelectorAll('#db-world .ui-figure-plot svg g.db-overlay path').length,
    text: document.querySelector('#db-world g.db-overlay text')?.textContent ?? '',
    spark: document.querySelector('.db-g-spark-at')?.textContent ?? '',
  }));
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  const gone = await page.$$eval('#db-world g.db-overlay', (g) => g.length);
  assert(r.line === 1 && /^\d{4}/.test(r.text) && r.spark.startsWith(r.text.slice(0, 4)), JSON.stringify(r));
  assert(gone === 0, `${gone} marks left after the pointer went`);
  // the other way: a month of the normal year marks that month of every year, and the month letters of the tables
  const season = page.locator('#db-world .ui-figure-plot svg').nth(1);
  const sb = await season.boundingBox();
  await page.mouse.move(sb.x + sb.width * 0.72, sb.y + sb.height * 0.5);
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => ({
    dots: document.querySelectorAll('#db-world g.db-overlay-m circle').length,
    text: document.querySelector('#db-world g.db-overlay-m text')?.textContent ?? '',
    letters: document.querySelectorAll('.db-month.is-focus').length,
  }));
  await page.mouse.move(2, 2);
  assert(m.dots >= 20 && / of each year$/.test(m.text) && m.letters > 0, JSON.stringify(m));
  return `year ${r.text} drawn over the normal year; trend line says "${r.spark}"; gone when the pointer leaves; "${m.text}": ${m.dots} dots on the yearly chart, ${m.letters} month letters lit in the tables`;
});

await check('Reset, the copied link and the numbers of a view as CSV', async () => {
  await openDash('#/dashboard?area=country:BRA&months=7-9&s=world');
  const top = await page.evaluate(() => Math.round(document.getElementById('db-world').getBoundingClientRect().top));
  await page.locator('.db-nav-tools button[aria-label="Copy a link to this section"]').click();
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), page.locator('button', { hasText: 'Download the numbers' }).click()]);
  const file = path.join(outDir, dl.suggestedFilename());
  await dl.saveAs(file);
  const csv = fs.readFileSync(file, 'utf8').split('\n');
  fs.rmSync(file);
  await page.locator('.db-scope-reset').click(); await scopeReady();
  const h = await hash();
  assert(top < 400, `the link did not open the section (top ${top})`);
  assert(/#\/dashboard\?area=country:BRA&months=7-9&s=/.test(decodeURIComponent(clip)), clip);
  assert(dl.suggestedFilename() === 'fire-harmony-brazil-july_to_september-2001-2026.csv' && csv[0].startsWith('# Fire Harmony dashboard') && csv.some((l) => l.startsWith('2019,2019,')), `${dl.suggestedFilename()} ${csv[0]}`);
  assert(h === '#/dashboard?s=world' || h === '#/dashboard', h);
  return `opened at the section (${top} px); copied ${decodeURIComponent(clip).replace(/^.*#/, '#')}; ${dl.suggestedFilename()} (${csv.length} lines); Reset -> ${h}`;
});

await check('The "World" badge says why in a tooltip', async () => {
  await openDash('#/dashboard?area=country:AUS');
  const badge = page.locator('#db-model .db-scope-badge');
  await badge.scrollIntoViewIfNeeded();
  await badge.hover();
  await page.waitForSelector('.ui-tooltip[data-open]', { timeout: 3000 });
  const t = await page.locator('.ui-tooltip[data-open]').innerText();
  assert(/always shows the whole world/.test(t), t);
  const note = await page.locator('#db-outlook .db-place-note').innerText();
  assert(/Australia/.test(note), note);
  return `"${t}"; outlook says: "${note.replace(/\s+/g, ' ').slice(0, 90)}…"`;
});

// ------------------------------------------------------------------------------------------------ phones
await check('Phone 390: the scope in words opens one sheet; a place picked there scopes the page; the pinned button counts the changes', async () => {
  await openDash('#/dashboard', { width: 390, height: 844, touch: true });
  const inNav = await page.evaluate(() => getComputedStyle(document.querySelector('.db-nav .db-scope')).display);
  await page.locator('.db-scope-summary').tap();
  await page.waitForSelector('.db-pop.is-sheet', { timeout: 5000 });
  const small = await page.$$eval('.db-pop.is-sheet button, .db-pop.is-sheet input[type="range"]', (els) => els.filter((e) => e.getClientRects().length)
    .map((e) => ({ t: (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 20), h: Math.round(e.getBoundingClientRect().height) })).filter((x) => x.h < 44));
  await page.locator('.db-sheet-place').tap();
  await page.locator('.db-pop input[type="search"]').fill('Brazil');
  await page.waitForSelector('.db-pick-item', { timeout: 15_000 });
  await page.locator('.db-pick-item').first().tap();
  await page.locator('.db-mcell').nth(8).tap();
  await page.locator('.db-sheet-foot .ui-btn-primary').tap();
  await scopeReady();
  const h = await hash();
  const n = await page.locator('.db-nav-scope-n').innerText();
  const summary = await page.locator('.db-scope-summary-value').innerText();
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  assert(inNav === 'none', `scope row in the pinned bar: ${inNav}`);
  assert(!small.length, `small targets in the sheet: ${JSON.stringify(small)}`);
  assert(h === '#/dashboard?area=country:BRA&months=9', h);
  assert(n === '2' && /Brazil/.test(summary) && /Sep/.test(summary) && sw === 390, `${n} "${summary}" ${sw}`);
  return `sheet with every control at 44 px or more; ${h}; pinned button shows ${n}; "${summary.replace(/\s+/g, ' ')}"`;
});

await check('Phone held sideways (844 x 390): the pinned bar is one row of at most 52 px, with the scope as a button', async () => {
  await openDash('#/dashboard?area=country:IDN', { width: 844, height: 390, touch: true });
  await page.evaluate(() => window.scrollTo(0, 2400));
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const nav = document.querySelector('.db-nav').getBoundingClientRect();
    return { h: Math.round(nav.height), top: Math.round(nav.top), scope: getComputedStyle(document.querySelector('.db-nav .db-scope')).display,
      btn: getComputedStyle(document.querySelector('.db-nav-scope')).display };
  });
  assert(m.h <= 52 && m.scope === 'none' && m.btn !== 'none', JSON.stringify(m));
  return `pinned bar ${m.h} px at ${m.top} px; scope button shown`;
});

// ------------------------------------------------------------------------------------------------ keyboard and pointer
const focused = () => page.evaluate(() => {
  const a = document.activeElement;
  return a ? (a.getAttribute('aria-label') ?? a.textContent ?? '').trim() : '';
});

await check('Keyboard: the focus stays on the control in the Years, Months and Scale panels', async () => {
  await openDash('#/dashboard?area=country:IDN');
  await page.locator('.db-scope-btn').nth(1).click();
  await page.waitForSelector('.db-years-range input');
  const f0 = await focused();
  await page.locator('.db-years-range input').nth(1).focus();
  for (let k = 0; k < 3; k++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(120); }
  const y = { h: await hash(), f: await focused() };
  await page.keyboard.press('Escape');
  await page.locator('.db-scope-btn').nth(2).click();
  await page.waitForSelector('.db-mcell');
  const m0 = await focused();
  await page.locator('.db-mcell').nth(7).focus();
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  const m1 = await focused();
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  const m = { h: await hash(), f: await focused() };
  await page.keyboard.press('Escape');
  await page.locator('.db-scope-btn').nth(3).click();
  await page.waitForTimeout(200);
  const s0 = await focused();
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
  const s = { h: await hash(), f: await focused() };
  await page.keyboard.press('Escape');
  assert(f0 === 'First year', `the years panel opened on "${f0}"`);
  assert(y.h.includes('years=2001-2023') && y.f === 'Last year', `three steps left on the last year: ${JSON.stringify(y)}`);
  assert(/^Jan/.test(m0) && /^Aug/.test(m1), `months: opened on "${m0}", after Enter on August "${m1}"`);
  assert(m.h.includes('months=8-10') && /^Oct/.test(m.f), `months: ${JSON.stringify(m)}`);
  assert(s0 === 'Harmonized' && s.h.endsWith('scale=raw') && s.f === 'Raw', `scale: opened on "${s0}", then ${JSON.stringify(s)}`);
  return `years ${y.h.replace(/^.*years=/, '')} with the focus on "${y.f}"; months 8-10 with the focus on "${m.f.slice(0, 3)}"; scale raw with the focus on "${s.f}"`;
});

await check('Years: a single year widens either way by dragging, at the ends of the record too, with a mouse and by touch', async () => {
  await openDash('#/dashboard?area=country:IDN&years=2026-2026');
  await page.locator('.db-scope-btn').nth(1).click();
  await page.waitForSelector('.db-years-range');
  const drag = async (fromYr, toYr) => {
    const b = await page.locator('.db-pop .db-years-range').boundingBox();
    const x = (yr) => b.x + 9 + ((b.width - 18) * (yr - 2001)) / 25;
    await page.mouse.move(x(fromYr), b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(x(toYr), b.y + b.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    return (await hash()).replace(/^.*years=([\d-]+).*$/, '$1');
  };
  const a = await drag(2026, 2016);                 // the right end: only the first year can move
  await page.keyboard.press('Escape');
  await openDash('#/dashboard?area=country:IDN&years=2015-2015');
  await page.locator('.db-scope-btn').nth(1).click();
  await page.waitForSelector('.db-years-range');
  const b1 = await drag(2015, 2010);                // the middle, to the left
  const b2 = await drag(2015, 2020);                // the last year, to the right
  await page.keyboard.press('Escape');
  // by touch in the phone's sheet (real touch events: the slider lets the sheet scroll up and down)
  await openDash('#/dashboard?area=country:IDN&years=2026-2026', { width: 390, height: 844, touch: true });
  await page.locator('.db-scope-summary').tap();
  await page.waitForSelector('.db-pop.is-sheet .db-years-range');
  const r = page.locator('.db-pop.is-sheet .db-years-range');
  await r.scrollIntoViewIfNeeded();
  const tb = await r.boundingBox();
  const tx = (yr) => tb.x + 9 + ((tb.width - 18) * (yr - 2001)) / 25;
  const cdp = await page.context().newCDPSession(page);
  const yTouch = tb.y + tb.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx(2026), y: yTouch }] });
  for (let k = 1; k <= 10; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tx(2026) + ((tx(2018) - tx(2026)) * k) / 10, y: yTouch }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  const t = (await hash()).replace(/^.*years=([\d-]+).*$/, '$1');
  assert(a === '2016-2026', `from 2026 alone, dragged left: ${a}`);
  assert(b1 === '2010-2015' && b2 === '2010-2020', `from 2015 alone: left ${b1}, then right ${b2}`);
  assert(t === '2018-2026', `by touch from 2026 alone: ${t}`);
  return `2026 dragged left: ${a}; 2015 left: ${b1}, then the last year right: ${b2}; by touch on a phone: ${t}`;
});

// ------------------------------------------------------------------------------------------------ one verdict on every page
const DATA = process.env.FIRE_DATA_DIR ?? path.join(process.env.HOME ?? '', 'nasa_work/data/products/v1.0');
const placeRows = JSON.parse(fs.readFileSync(path.join(DATA, 'web/places.json'), 'utf8')).rows;
/** The words of the Rankings rule (model.ts trendClassOf) for a row of web/places.json. */
function verdictWord(r) {
  if (r.trend_pct_per_decade === null || r.trend === null || r.trend === 'not enough data') return 'Too few years';
  const dir = r.trend_pct_per_decade > 0 ? 'Rising' : 'Falling';
  if (r.kind === 'world' || r.kind === 'continent') return r.trend_p !== null && r.trend_p < 0.05 ? dir : 'Not clear';
  if (!r.trend_tested) return 'Not tested';
  return r.trend_q !== null && r.trend_q <= 0.05 ? dir : 'Not clear';
}
const own = (r) => (r.name.includes(', ') ? r.name.slice(0, r.name.lastIndexOf(', ')) : r.name);
const trendWords = (sel) => page.$$eval(`${sel} tbody tr`, (trs) => trs.map((tr) => ({
  name: tr.querySelector('.db-c-name a')?.textContent ?? '', word: tr.querySelector('.db-c-trend .db-trendmark-word')?.textContent ?? '',
})));

await check('Trend verdicts: the tiles and tables of the Dashboard use the rule of Rankings for the whole record', async () => {
  await openDash('#/dashboard');
  await page.waitForFunction(() => document.querySelectorAll('.db-table-countries tbody tr').length >= 10, null, { timeout: 30_000 });
  await page.waitForTimeout(800);
  const countries = await trendWords('.db-table-countries');
  const byName = new Map(placeRows.filter((r) => r.kind === 'country').map((r) => [r.name, r]));
  const bad = countries.filter((c) => byName.has(c.name) && verdictWord(byName.get(c.name)) !== c.word).map((c) => `${c.name}: ${c.word}`);
  const brazilRow = countries.find((c) => c.name === 'Brazil');
  await openDash('#/dashboard?area=country:BRA');
  const bra = await page.evaluate(() => document.querySelector('.db-g[data-key="trend"]')?.innerText.replace(/\s+/g, ' ') ?? '');
  await openDash('#/dashboard?area=country:IDN');
  await page.waitForSelector('.db-table-parts tbody tr', { timeout: 60_000 });
  const states = await trendWords('.db-table-parts');
  const stateBy = new Map(placeRows.filter((r) => r.kind === 'state' && r.iso3 === 'IDN').map((r) => [own(r), r]));
  const badStates = states.filter((c) => stateBy.has(c.name) && verdictWord(stateBy.get(c.name)) !== c.word).map((c) => `${c.name}: ${c.word}`);
  const spark = await page.$$eval('.db-table-parts thead th', (th) => th.map((x) => x.textContent));
  assert(countries.length >= 20 && !bad.length, `countries that disagree with Rankings: ${bad.join(', ')}`);
  assert(brazilRow?.word === 'Not clear' && /Not clear/.test(bra) && /q = 0\.06/.test(bra), `Brazil: table "${brazilRow?.word}", tile "${bra}"`);
  assert(states.length >= 20 && !badStates.length, `states of Indonesia that disagree: ${badStates.join(', ')}`);
  assert(spark.includes('2001 to 2025'), `the line's column: ${spark.join(' | ')}`);
  return `${countries.length} countries and ${states.length} states of Indonesia read as in Rankings; Brazil: "${bra.replace(/^.*Not clear /, '').slice(0, 120)}…"`;
});

await check('Raw sensors: no trend verdict and a caveat on the ratios; odd scopes read well', async () => {
  await openDash('#/dashboard?area=country:BRA&scale=raw');
  const raw = await page.evaluate(() => Object.fromEntries(['trend', 'latest', 'period'].map((k) => [k, document.querySelector(`.db-g[data-key="${k}"]`)?.innerText.replace(/\s+/g, ' ') ?? ''])));
  await openDash('#/dashboard?area=state:IDN-492&years=2026-2026&months=12');
  const one = await tile('trend');
  await openDash('#/dashboard?area=circle:0,-30,50&months=8-10');
  const t = await page.evaluate(() => ({ h1: document.querySelector('h1')?.textContent ?? '', hero: document.querySelector('.db-g[data-key="latest"] .ui-stat-label')?.textContent ?? '' }));
  assert(/Raw, not comparable/.test(raw.trend) && /not a change in fire/.test(raw.trend), raw.trend);
  assert(/harmonized scale/.test(raw.latest) && /harmonized scale/.test(raw.period), `${raw.latest} | ${raw.period}`);
  assert(one.label === 'Trend per decade', `a single year after 2025: "${one.label}"`);
  assert(!/km around 50 km|of 50 km/.test(`${t.h1} ${t.hero}`) && /0\.00°N, 30\.00°W/.test(t.h1), JSON.stringify(t));
  return `raw: "${raw.trend.slice(0, 70)}…"; 2026 alone: "${one.label}"; "${t.h1}"; "${t.hero}"`;
});

await check('Pinned under the header on a laptop, the gap above the glass panel is filled', async () => {
  await openDash('#/dashboard?area=country:IDN');
  // the page may still grow while its charts come in: scroll, wait, and scroll a little more
  await page.evaluate(() => window.scrollTo(0, 2600));
  await page.waitForTimeout(500);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const nav = document.querySelector('.db-nav');
    const panel = nav.querySelector('.db-nav-panel').getBoundingClientRect();
    const head = document.querySelector('.fh-header').getBoundingClientRect();
    const before = getComputedStyle(nav, '::before');
    return { stuck: nav.hasAttribute('data-stuck'), gap: Math.round(panel.top - head.bottom), fill: Math.round(parseFloat(before.height)), bg: before.backgroundColor };
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const top = await page.evaluate(() => document.querySelector('.db-nav').hasAttribute('data-stuck'));
  assert(m.stuck && m.fill >= m.gap && !/rgba\(0, 0, 0, 0\)|transparent/.test(m.bg), JSON.stringify(m));
  assert(!top, 'still marked as stuck at the top of the page');
  return `stuck: a ${m.fill} px fill over the ${m.gap} px gap (${m.bg}); not stuck at the top`;
});

// ------------------------------------------------------------------------------------------------ the same numbers as the Explorer
const PLACES = [
  ['World', 'world:WORLD'], ['Indonesia', 'country:IDN'], ['Riau', 'state:IDN-492'], ['Brazil', 'country:BRA'], ['Palangkaraya, 50 km', 'circle:-2.2096,113.91,50'],
];
/** "1.33" with "million hotspots" -> 1330000; "199,000" -> 199000; "−51.9%" -> -51.9. */
const num = (v, unit = '') => {
  const x = Number(v.replace(/[−–]/g, '-').replace(/[^\d.-]/g, ''));
  return /million/.test(unit) ? x * 1e6 : x;
};
const near = (a, b, sig = 3) => {
  if (a === null || b === null) return false;
  const tol = Math.max(0.051, Math.abs(a) * 0.5 * 10 ** (1 - sig) * 10 ** (Math.floor(Math.log10(Math.max(1e-9, Math.abs(a)))) - Math.floor(Math.log10(Math.max(1e-9, Math.abs(a))))));
  return Math.abs(a - b) <= Math.max(tol, Math.abs(a) * 0.005);
};
await check('The burning calendar follows the scope: its years are the rows, a season keeps only its months', async () => {
  await page.goto(new URL('#/dashboard?area=country:IDN&years=2010-2020&months=8-10', base).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.db-cal svg[data-export="calendar"] rect[role="gridcell"]', { timeout: 120_000 });
  await scopeReady();
  const cal = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.db-cal rect[role="gridcell"]')].map((r) => r.getAttribute('aria-label') ?? '');
    const months = new Set(labels.map((l) => l.split(' ')[0])), years = new Set(labels.map((l) => Number(l.split(' ')[1]?.replace(':', ''))));
    return { n: labels.length, months: [...months], years: [Math.min(...years), Math.max(...years)], link: [...document.querySelectorAll('.db-cal a')].map((a) => a.getAttribute('href'))[0] };
  });
  assert(cal.n === 33 && cal.months.sort().join() === 'August,October,September' && cal.years.join() === '2010,2020', JSON.stringify(cal));
  assert(cal.link === '#/?area=country:IDN&tab=calendar&cal=full', cal.link);
  return `${cal.n} boxes, ${cal.months.join(', ')}, ${cal.years.join(' to ')}`;
});

for (const [label, area] of PLACES) {
  await check(`Explorer equality, ${label}: the latest month, the year so far, the trend, and August to October 2026`, async () => {
    await openDash(`#/dashboard?area=${area}`);
    const dl = await tile('latest'), dp = await tile('period'), dt = await tile('trend');
    await openDash(`#/dashboard?area=${area}&months=8-10`);
    const ds = await tile('period');
    await newPage();
    // the Explorer's numbers glide on animation frames, which the software GPU can stall mid glide: with reduced
    // motion they show their value at once (package explorer-panel)
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(new URL(`#/?area=${area}`, base).toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.fh-ex[data-series-ready="true"] .fh-ex-kpis .ui-stat', { timeout: 180_000 });
    // the tiles may first show another series (a circle is added up by DuckDB) and then glide to their value: read
    // them once their text has stayed the same for 2 s
    const readTiles = () => page.$$eval('.fh-ex-kpis .ui-stat', (ts) => ts.map((t) => ({ v: t.querySelector('.ui-stat-value')?.childNodes[0]?.textContent ?? '', u: t.querySelector('.ui-stat-unit')?.textContent ?? '', l: t.querySelector('.ui-stat-label')?.textContent ?? '' })));
    let ex = await readTiles(), steady = 0;
    for (let k = 0; k < 120 && steady < 4; k++) {
      await page.waitForTimeout(500);
      const next = await readTiles();
      steady = JSON.stringify(next) === JSON.stringify(ex) ? steady + 1 : 0;
      ex = next;
    }
    await page.getByRole('tab', { name: 'Period', exact: true }).click();
    await page.waitForSelector('.pp-tiles', { timeout: 60_000 });
    // the Period tab's month picker (package explorer-panel): From opens 2026's months, picking August asks for the last
    await page.locator('.pp-when[data-end="from"]').click();
    if (await page.locator('.pp-month[data-ym="202608"]').count() === 0) await page.getByRole('button', { name: 'Year after', exact: true }).click();
    await page.locator('.pp-month[data-ym="202608"]').click(); await page.locator('.pp-month[data-ym="202610"]').click();
    // the number glides to its value: wait until it stops moving
    // (under the software GPU the map can hold the page for a while, so the number must stay put for 2 s)
    let pp = -1, same = 0;
    for (let k = 0; k < 60 && same < 4; k++) {
      await page.waitForTimeout(500);
      const v = Number((await page.locator('.pp-tile-value').first().innerText()).replace(/[^\d]/g, ''));
      same = v === pp ? same + 1 : 0;
      pp = v;
    }
    const cap = await page.locator('.pp-caption strong').innerText();
    assert(cap === 'Aug to Oct 2026', `the Explorer's period is "${cap}"`);
    const exLatest = num(ex[0].v, ex[0].u), exYtd = num(ex[1].v, ex[1].u), exTrend = num(ex[2].v);
    assert(near(dl.v, exLatest), `latest month: dashboard ${dl.v}, Explorer ${ex[0].v} ${ex[0].u}`);
    assert(near(dp.v, exYtd), `year so far: dashboard ${dp.v}, Explorer ${ex[1].v} ${ex[1].u}`);
    // the Explorer rounds the trend to a whole percent (to one decimal under 10%)
    assert(Math.abs(dt.v - exTrend) <= (Math.abs(exTrend) < 10 && /\./.test(ex[2].v) ? 0.051 : 0.5), `trend: dashboard ${dt.v}, Explorer ${ex[2].v}`);
    assert(Math.round(ds.v) === pp, `August to October 2026: dashboard ${ds.v}, Explorer period ${pp}`);
    return `latest ${Math.round(dl.v)} = ${ex[0].v} ${ex[0].u}; so far ${Math.round(dp.v)} = ${ex[1].v} ${ex[1].u}; trend ${dt.v.toFixed(2)} = ${ex[2].v}; Aug to Oct 2026 ${Math.round(ds.v)} = ${pp}`;
  });
}

if (page) await page.context().close();
await browser.close();
results.push({ ok: problems.length === 0, name: 'No console errors' });
console.log(`${problems.length ? 'FAIL' : 'PASS'} No console errors${problems.length ? `: ${problems.slice(0, 4).join(' | ')}` : ''}`);
console.log(`\n${results.filter((r) => r.ok).length} of ${results.length} passed`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
