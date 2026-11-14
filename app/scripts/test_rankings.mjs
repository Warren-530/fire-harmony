// Browser checks of the Rankings page (#/rankings) in a real (headless) Chrome: every place of web/places.json, the sort
// of every column (checked against the file with the same rules), the filters (kind, continent, country, trend, far
// above normal, the least fire, text), the quick screens, the link that keeps the view, windowed rows that stay smooth
// with all 4,330 places, the CSV of the view, the tooltips of the column names, keys, a row that opens the Explorer
// and a button that opens the dashboard, and the cards of a phone.
// Usage: node scripts/test_rankings.mjs [baseUrl]     (THEME=light for the light theme; the dev server must run)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.env.TEST_OUT ?? '/tmp/fh_test_rankings';
fs.mkdirSync(outDir, { recursive: true });
const THEME = process.env.THEME === 'light' ? 'light' : 'dark';
const DATA = process.env.FIRE_DATA_DIR ?? path.join(os.homedir(), 'nasa_work/data/products/v1.0');
import { inEnglish, SHORT_FORMS } from './english_names.mjs';
// the file's rows with the names the app shows (English, src/lib/names.ts)
const rawRows = JSON.parse(fs.readFileSync(path.join(DATA, 'web/places.json'), 'utf8')).rows;
const rowsFile = inEnglish(rawRows);

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: [] });
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
async function open(hash, opts) {
  await newPage(opts);
  await page.goto(new URL(hash, base).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.rk-body .rk-row', { timeout: 60_000 });
  await page.waitForTimeout(400);
}

const results = [];
let shots = 0;
async function check(name, fn) {
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

// the page's own rules, from the file (model.ts): to check the order and the filters against the data
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const own = (r) => (r.kind === 'state' && r.name.includes(', ') ? r.name.slice(0, r.name.lastIndexOf(', ')) : r.kind === 'world' ? 'World' : r.name);
function trendClass(r) {
  if (r.trend_pct_per_decade === null || r.trend === null || r.trend === 'not enough data') return 'none';
  const dir = r.trend_pct_per_decade > 0 ? 'rising' : 'falling';
  if (r.kind === 'world' || r.kind === 'continent') return r.trend_p !== null && r.trend_p < 0.05 ? dir : 'unclear';
  if (!r.trend_tested) return 'untested';
  return r.trend_q !== null && r.trend_q <= 0.05 ? dir : 'unclear';
}
const shown = () => page.$$eval('.rk-body > .rk-row', (rows) => rows.map((r) => ({
  i: Number(r.dataset.index), name: r.querySelector('.rk-name-text')?.textContent ?? '', where: r.querySelector('.rk-where')?.textContent ?? '',
})).sort((a, b) => a.i - b.i));
const hash = () => page.evaluate(() => decodeURIComponent(location.hash));
const summary = () => page.locator('.rk-summary').innerText();

// ------------------------------------------------------------------------------------------------ laptop
await open('#/rankings');

await check('Opens with the countries, most fire first, the same numbers as web/places.json', async () => {
  const countries = rowsFile.filter((r) => r.kind === 'country').sort((a, b) => b.mean_per_year - a.mean_per_year);
  const s = await shown();
  const top = s.slice(0, 5).map((x) => x.name);
  assert(top.join() === countries.slice(0, 5).map(own).join(), `top ${top} vs ${countries.slice(0, 5).map(own)}`);
  const sum = await summary();
  assert(/^246 countries/.test(sum), `summary "${sum}"`);
  // the first row's cells against the file
  const cells = await page.$$eval('.rk-body > .rk-row[data-index="1"] .rk-c', (cs) => cs.map((c) => c.innerText.replace(/\s+/g, ' ').trim()));
  const bra = countries[1];
  assert(cells.some((c) => c.includes('1.48 million')), `fire a year of ${bra.name}: ${cells}`);
  assert(cells.some((c) => c.includes(String(bra.record_year))), `record year ${bra.record_year}: ${cells}`);
  assert(cells.some((c) => c.includes('0.69') && c.includes('22nd of 26')), `latest month 0.69, 22nd: ${cells}`);
  return `${top.join(', ')}; ${sum}; Brazil row: ${cells.slice(1, 4).join(' | ')}`;
});

await check('Column names say what they mean in a tooltip', async () => {
  const head = page.locator('.rk-row-head .rk-c-trend .rk-sort');
  await head.hover();
  await page.waitForSelector('.ui-tooltip[data-open]', { timeout: 3000 });
  const text = await page.locator('.ui-tooltip[data-open]').innerText();
  assert(/holds when it stays clear after all places are tested/i.test(text), `tooltip "${text}"`);
  assert(/logarithm of yearly fire/.test(text), `the trend tooltip says how to read a percent: "${text}"`);
  const label = await page.locator('.rk-row-head .rk-c-trend .rk-sort').innerText();
  assert(/trend per decade, 2001 to 2025/i.test(label.replace(/\s+/g, ' ')), `trend label "${label}"`);
  await page.mouse.move(5, 5);
  return text.slice(0, 90);
});

await check('Every column sorts both ways, as the file says, with aria-sort and the link', async () => {
  const keys = ['mean', 'share', 'trend', 'latest', 'ytd', 'record', 'peak', 'outlook'];
  const notes = [];
  for (const k of keys) {
    const btn = page.locator(`.rk-row-head .rk-c-${k} .rk-sort`);
    await btn.click(); await page.waitForTimeout(150);
    const dir1 = await page.locator(`.rk-row-head .rk-c-${k}`).getAttribute('aria-sort');
    const first1 = (await shown())[0].name;
    await btn.click(); await page.waitForTimeout(150);
    const dir2 = await page.locator(`.rk-row-head .rk-c-${k}`).getAttribute('aria-sort');
    const first2 = (await shown())[0].name;
    assert(dir1 && dir2 && dir1 !== dir2 && dir1 !== 'none', `${k}: aria-sort ${dir1} -> ${dir2}`);
    notes.push(`${k} ${first1}/${first2}`);
  }
  // the trend order against the file: falling fastest first (the last click on trend left it ascending)
  await page.locator('.rk-row-head .rk-c-trend .rk-sort').click(); await page.waitForTimeout(150);
  const h = await hash();
  const d1 = await page.locator('.rk-row-head .rk-c-trend').getAttribute('aria-sort');
  const want = rowsFile.filter((r) => r.kind === 'country' && r.trend_pct_per_decade !== null)
    .sort((a, b) => (d1 === 'ascending' ? a.trend_pct_per_decade - b.trend_pct_per_decade : b.trend_pct_per_decade - a.trend_pct_per_decade) || b.mean_per_year - a.mean_per_year)
    .slice(0, 6).map(own);
  const got = (await shown()).slice(0, 6).map((x) => x.name);
  assert(got.join() === want.join(), `trend ${d1}: ${got} vs ${want}`);
  assert(h.includes(`sort=trend-${d1 === 'ascending' ? 'asc' : 'desc'}`), `hash ${h}`);
  return `${notes.join('; ')}; trend ${d1}: ${got.slice(0, 3).join(', ')}…; ${h}`;
});

await check('Filters: states of one country, a continent, a trend, far above normal now, the least fire, text', async () => {
  await page.goto(new URL('#/rankings', base).toString()); await page.reload(); await page.waitForSelector('.rk-body .rk-row'); await page.waitForTimeout(300);
  await page.locator('.rk-kind', { hasText: 'States' }).click(); await page.waitForTimeout(150);
  await page.selectOption('.rk-field:has-text("Country") select', 'IDN'); await page.waitForTimeout(200);
  const idn = rowsFile.filter((r) => r.kind === 'state' && r.iso3 === 'IDN');
  const s1 = await summary();
  assert(new RegExp(`^${idn.length}( of [\\d,]+)? states`).test(s1), `${s1} (file: ${idn.length})`);
  const first = (await shown())[0].name;
  const wantFirst = own(idn.sort((a, b) => b.mean_per_year - a.mean_per_year)[0]);
  assert(first === wantFirst, `${first} vs ${wantFirst}`);
  await page.selectOption('.rk-field:has-text("Trend") select', 'falling'); await page.waitForTimeout(200);
  const falling = idn.filter((r) => trendClass(r) === 'falling');
  const s2 = await summary();
  assert(new RegExp(`^${falling.length}( of [\\d,]+)? states`).test(s2), `${s2} (file: ${falling.length})`);
  const words = await page.$$eval('.rk-body .rk-trend-word', (e) => e.map((x) => x.textContent));
  assert(words.every((w) => w === 'Falling'), `trend words ${words}`);
  const h1 = await hash();
  assert(h1.includes('kind=state') && h1.includes('country=IDN') && h1.includes('trend=falling'), h1);
  // the rest from a clean page: continent, far above normal, least fire, text
  await page.locator('.rk-reset').click(); await page.waitForTimeout(200);
  await page.selectOption('.rk-field:has-text("Continent") select', 'Africa'); await page.waitForTimeout(150);
  const africa = rowsFile.filter((r) => r.kind === 'country' && r.continent === 'Africa').length;
  const s3 = await summary();
  assert(new RegExp(`^${africa}( of [\\d,]+)? countries`).test(s3), `${s3} (file ${africa})`);
  await page.locator('.rk-far').click(); await page.waitForTimeout(150);
  const far = rowsFile.filter((r) => r.kind === 'country' && r.continent === 'Africa' && r.latest_ratio !== null && r.latest_ratio >= 2 && (r.latest_normal ?? 0) >= 50).length;
  const s4 = await summary();
  assert(s4.startsWith(`${far} `), `${s4} (file ${far})`);
  await page.locator('.rk-reset').click(); await page.waitForTimeout(150);
  await page.locator('.rk-kind', { hasText: 'All places' }).click();
  await page.selectOption('.rk-field:has-text("Fire a year") select', '10000'); await page.waitForTimeout(150);
  const big = rowsFile.filter((r) => (r.mean_per_year ?? 0) >= 10000).length;
  const s5 = await summary();
  assert(new RegExp(`^${big}( of [\\d,]+)? places`).test(s5), `${s5} (file ${big})`);
  await page.locator('.rk-reset').click(); await page.waitForTimeout(150);
  await page.locator('.rk-kind', { hasText: 'All places' }).click();
  await page.fill('.rk-search input', 'kalimantan'); await page.waitForTimeout(200);
  const k = (await shown()).map((x) => x.name);
  const kw = rawRows.filter((r) => fold(r.name).includes('kalimantan')).length;
  assert(k.length === kw && k.every((n) => /Kalimantan/.test(n)), `kalimantan: ${k} (file ${kw})`);
  await page.locator('.rk-search input').press('Escape');
  assert((await page.inputValue('.rk-search input')) === '', 'Escape did not clear the text');
  return `IDN ${idn.length} states, first ${first}; falling ${falling.length}; Africa ${africa}; far above normal ${far}; 10,000+ a year ${big}; "kalimantan" ${k.length}`;
});

await check('Quick screens set the filters and the order; the link brings the view back', async () => {
  await page.locator('.rk-reset').click().catch(() => undefined);
  await page.locator('.rk-screen', { hasText: 'Rising fastest' }).click(); await page.waitForTimeout(200);
  const pressed = await page.locator('.rk-screen', { hasText: 'Rising fastest' }).getAttribute('aria-pressed');
  const h = await hash();
  assert(pressed === 'true' && h.includes('trend=rising') && h.includes('sort=trend-desc'), `${pressed} ${h}`);
  const words = await page.$$eval('.rk-body .rk-trend-word', (e) => e.map((x) => x.textContent));
  assert(words.length && words.every((w) => w === 'Rising'), `${words}`);
  await open('#/rankings?kind=state&country=BRA&sort=latest-desc');
  const sel = await page.inputValue('.rk-field:has-text("Country") select');
  const kind = await page.locator('.rk-kind[aria-checked="true"]').innerText();
  const bra = rowsFile.filter((r) => r.kind === 'state' && r.iso3 === 'BRA' && r.latest_ratio !== null)
    .sort((a, b) => ((a.latest_normal ?? 0) < 10) - ((b.latest_normal ?? 0) < 10) || b.latest_ratio - a.latest_ratio || b.mean_per_year - a.mean_per_year);
  const first = (await shown())[0].name;
  assert(sel === 'BRA' && /States/.test(kind) && first === own(bra[0]), `${sel} ${kind} ${first} vs ${own(bra[0])}`);
  return `${h}; link back: ${kind.replace(/\s+/g, ' ')} of ${sel}, first ${first}`;
});

// The dev server runs React's development build, where creating elements costs several times more (React 19 keeps a
// stack for each element); the check allows that, and counts only tasks that would show as a stall.
await check('All 4,330 places scroll in a window of rows, without stalls', async () => {
  await open('#/rankings?kind=all');
  const sum = await summary();
  assert(/^4,330 places/.test(sum), sum);
  await page.evaluate(() => {
    window.__long = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration > 500) window.__long += 1; }).observe({ type: 'longtask', buffered: false });
  });
  const counts = [];
  for (let k = 0; k < 24; k++) {
    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(40);
    counts.push(await page.$$eval('.rk-body > .rk-row', (r) => r.length));
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
  const last = await shown();
  const long = await page.evaluate(() => window.__long);
  assert(Math.max(...counts) < 60, `rows in the page: ${Math.max(...counts)}`);
  assert(last[last.length - 1].i === 4329, `last row index ${last[last.length - 1].i}`);
  assert(long <= 2, `${long} long tasks`);
  return `${sum}; at most ${Math.max(...counts)} rows in the page while scrolling; the last row (${last[last.length - 1].name}) shows at the end; ${long} tasks over 500 ms`;
});

await check('Keys: Down and Up move between rows; Enter opens the place; Back comes back to the same view', async () => {
  await open('#/rankings?kind=state&country=IDN');
  await page.locator('.rk-body > .rk-row[data-index="0"] .rk-name').focus();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  const focused = await page.evaluate(() => document.activeElement?.closest('.rk-row')?.getAttribute('data-index'));
  await page.keyboard.press('ArrowUp');
  const back = await page.evaluate(() => document.activeElement?.closest('.rk-row')?.getAttribute('data-index'));
  const name = await page.evaluate(() => document.activeElement?.querySelector('.rk-name-text')?.textContent);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.hash.startsWith('#/?area='), null, { timeout: 15_000 });
  const ex = await hash();
  await page.goBack();
  await page.waitForFunction(() => location.hash.startsWith('#/rankings'), null, { timeout: 15_000 });
  await page.waitForSelector('.rk-body .rk-row', { timeout: 30_000 });
  const h = await hash();
  assert(focused === '2' && back === '1', `focus ${focused} then ${back}`);
  assert(/^#\/\?area=state:IDN-/.test(ex), ex);
  assert(h.includes('country=IDN'), h);
  return `focus row 3 then row 2 (${name}); Enter -> ${ex}; Back -> ${h}`;
});

await check('A row click opens the Explorer at that place; the second button opens the dashboard there', async () => {
  await open('#/rankings');
  const rowName = (await shown())[2].name;
  // the whole row is the link (its name's link stretches over it): a click anywhere on it
  const box = await page.locator('.rk-body > .rk-row[data-index="2"] .rk-c-trend').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => location.hash.startsWith('#/?area='), null, { timeout: 15_000 });
  const ex = await hash();
  await page.goBack(); await page.waitForSelector('.rk-body .rk-row', { timeout: 30_000 }); await page.waitForTimeout(300);
  const row = page.locator('.rk-body > .rk-row[data-index="0"]');
  await row.hover();
  await row.locator('.rk-go').click();
  await page.waitForSelector('#db-glance', { timeout: 30_000 });
  const db = await hash();
  const want = rowsFile.filter((r) => r.kind === 'country').sort((a, b) => b.mean_per_year - a.mean_per_year);
  assert(ex === `#/?area=country:${want[2].iso3}`, `${rowName}: ${ex}`);
  assert(db === `#/dashboard?area=country:${want[0].iso3}`, db);
  return `${rowName} -> ${ex}; dashboard button -> ${db}`;
});

await check('English names: no short forms, the local name under a state, both names filter', async () => {
  await open('#/rankings?kind=all');
  const text = await page.evaluate(() => document.body.innerText);
  assert(!SHORT_FORMS.test(text), `a short form: ${(text.match(SHORT_FORMS) ?? [])[0]}`);
  await open('#/rankings?kind=state&country=IDN');
  const ck = await page.evaluate(() => [...document.querySelectorAll('.rk-body .rk-row')].map((r) => ({ name: r.querySelector('.rk-name-text')?.textContent,
    where: r.querySelector('.rk-where')?.textContent })).find((r) => r.name === 'Central Kalimantan'));
  assert(ck && /Kalimantan Tengah/.test(ck.where), `Central Kalimantan row ${JSON.stringify(ck)}`);
  await page.fill('.rk-search input', 'tengah'); await page.waitForTimeout(250);
  const t = (await shown()).map((x) => x.name);
  assert(t.includes('Central Kalimantan') && t.includes('Central Sulawesi'), `"tengah": ${t.join(', ')}`);
  const opt = await page.evaluate(() => [...document.querySelectorAll('.rk-field select option')].map((o) => o.textContent).filter((x) => /\(1 state/.test(x) || /1 states/.test(x)));
  assert(!opt.some((x) => /1 states/.test(x)), `plural: ${opt.join(', ')}`);
  return `${ck.name}: ${ck.where}; "tengah" → ${t.join(', ')}; ${opt[0] ?? 'no country with one state'}`;
});

await check('Download CSV saves the rows of the view, with what they are', async () => {
  await open('#/rankings?kind=state&country=IDN&sort=trend-asc');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), page.locator('button', { hasText: 'Download CSV' }).click()]);
  const file = path.join(outDir, dl.suggestedFilename());
  await dl.saveAs(file);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  fs.rmSync(file);
  const head = lines.findIndex((l) => l.startsWith('kind,'));
  const split = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  const cols = split(lines[head]);
  const data = lines.slice(head + 1).map(split);
  const idn = rowsFile.filter((r) => r.kind === 'state' && r.iso3 === 'IDN');
  const firstId = data[0][cols.indexOf('id')];
  const want = idn.filter((r) => r.trend_pct_per_decade !== null).sort((a, b) => a.trend_pct_per_decade - b.trend_pct_per_decade)[0];
  const fileRow = rowsFile.find((r) => r.id === firstId);
  assert(lines[0].startsWith('# Fire Harmony rankings') && /Cite:/.test(lines.slice(0, head).join(' ')), lines[0]);
  assert(data.length === idn.length, `${data.length} rows vs ${idn.length}`);
  assert(firstId === want.id, `${firstId} vs ${want.id}`);
  assert(Number(data[0][cols.indexOf('trend_pct_per_decade')]) === fileRow.trend_pct_per_decade, 'trend value differs');
  assert(lines[0].includes('in Indonesia') && !/in IDN\b/.test(lines[0]), `the header names the country: ${lines[0]}`);
  assert(!data.some((r) => SHORT_FORMS.test(r[cols.indexOf('name')])), 'a short form in the names');
  return `${dl.suggestedFilename()}: ${head} comment lines, ${data.length} rows, first ${fileRow.name} (${fileRow.trend_pct_per_decade}% a decade)`;
});

await check('Copy a link to this view (button and palette command) holds the filters', async () => {
  await open('#/rankings?kind=state&trend=rising');
  await page.locator('button[aria-label="Copy a link to this view"]').click();
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert(clip.endsWith('#/rankings?kind=state&trend=rising'), clip);
  return clip;
});

// ------------------------------------------------------------------------------------------------ narrower laptop, tablet, phone
await check('1024: eight columns fit, nothing scrolls sideways; 820: cards', async () => {
  await open('#/rankings', { width: 1024, height: 768 });
  const a = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cols: [...document.querySelectorAll('.rk-row-head .rk-c')].filter((c) => getComputedStyle(c).display !== 'none').length }));
  await open('#/rankings', { width: 820, height: 1180, touch: true });
  const b = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, head: getComputedStyle(document.querySelector('.rk-head')).display, h: document.querySelector('.rk-body > .rk-row').getBoundingClientRect().height }));
  assert(a.sw === 1024 && a.cols === 8, JSON.stringify(a));
  assert(b.sw === 820 && b.head === 'none' && b.h > 150, JSON.stringify(b));
  return `1024: ${a.cols} columns, page ${a.sw} px; 820: cards of ${Math.round(b.h)} px, page ${b.sw} px`;
});

await check('Phone 390: cards, nothing cut, 44 px targets, sort menu, filters panel, a card tap opens the Explorer', async () => {
  await open('#/rankings', { width: 390, height: 844, touch: true });
  const m = await page.evaluate(() => {
    const over = [...document.querySelectorAll('.rk-body > .rk-row')].map((row) => {
      const b = row.getBoundingClientRect();
      let bottom = 0;
      for (const el of row.querySelectorAll('.rk-c *')) { if (!el.getClientRects().length || getComputedStyle(el).display === 'none') continue; bottom = Math.max(bottom, el.getBoundingClientRect().bottom - b.top); }
      return bottom - b.height;
    });
    const small = [...document.querySelectorAll('.rk-root button, .rk-root select, .rk-root .rk-search, .rk-go')]
      .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
      .map((e) => ({ t: (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 24), h: Math.round(e.getBoundingClientRect().height) }))
      .filter((e) => e.h < 44);
    return { sw: document.documentElement.scrollWidth, over: Math.max(...over), small };
  });
  await page.selectOption('.rk-sortpick select', 'name-asc'); await page.waitForTimeout(200);
  const az = (await shown()).slice(0, 3).map((x) => x.name);
  await page.locator('.rk-more-btn').tap(); await page.waitForTimeout(150);
  const openMore = await page.locator('#rk-more').evaluate((e) => getComputedStyle(e).display);
  await page.locator('.rk-body > .rk-row[data-index="0"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const card = await page.locator('.rk-body > .rk-row[data-index="0"] .rk-c-ytd').boundingBox();
  await page.touchscreen.tap(card.x + card.width / 2, card.y + card.height / 2);
  await page.waitForFunction(() => location.hash.startsWith('#/?area='), null, { timeout: 15_000 });
  const ex = await hash();
  assert(m.sw === 390, `page ${m.sw} px`);
  assert(m.over <= 0, `card content runs ${m.over} px past the card`);
  assert(!m.small.length, `small targets: ${JSON.stringify(m.small)}`);
  assert(az.join() === [...az].sort((x, y) => x.localeCompare(y)).join(), `A to Z: ${az}`);
  assert(openMore === 'grid', `filters panel ${openMore}`);
  return `page ${m.sw} px, no card overflows, every target 44 px or more; A to Z: ${az.join(', ')}; filters open; tap -> ${ex}`;
});

await check('Phone 320 in the other theme: nothing scrolls sideways, the names fit their cards', async () => {
  await open('#/rankings?kind=state', { width: 320, height: 640, touch: true, theme: THEME === 'dark' ? 'light' : 'dark' });
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cut: [...document.querySelectorAll('.rk-body .rk-c-place')].filter((c) => c.getBoundingClientRect().right > c.closest('.rk-row').getBoundingClientRect().right + 1).length,
  }));
  assert(m.sw === 320 && m.cut === 0, JSON.stringify(m));
  return `page ${m.sw} px; ${m.cut} names past their card`;
});

await check('Phones keep the details: the rank of the month, rough ratios, the normal chance; nothing is cut; the count stays on one line', async () => {
  const out = [];
  for (const [w, h] of [[390, 844], [320, 640]]) {
    await open('#/rankings?sort=outlook-desc', { width: w, height: h, touch: true });
    const m = await page.evaluate(() => {
      const vis = (e) => e.getClientRects().length && getComputedStyle(e).display !== 'none';
      const rows = [...document.querySelectorAll('.rk-body > .rk-row')];
      const rank = rows.map((r) => r.querySelector('.rk-c-latest .rk-sub')).filter((e) => e && vis(e)).map((e) => e.textContent);
      const normal = rows.map((r) => r.querySelector('.rk-c-outlook .rk-sub')).filter((e) => e && vis(e)).map((e) => e.textContent);
      const cut = [...document.querySelectorAll('.rk-body .rk-sub, .rk-body .rk-label, .rk-body .rk-strong')].filter((e) => vis(e) && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent);
      const over = Math.max(...rows.map((row) => {
        const b = row.getBoundingClientRect();
        let bottom = 0;
        for (const el of row.querySelectorAll('.rk-c *')) { if (!vis(el)) continue; bottom = Math.max(bottom, el.getBoundingClientRect().bottom - b.top); }
        return bottom - b.height;
      }));
      const sum = document.querySelector('.rk-summary');
      const input = document.querySelector('.rk-search input');
      // the chosen sort fits its menu (its words plus about 32 px of padding and arrow)
      const sel = document.querySelector('.rk-sortpick select');
      const cs = getComputedStyle(sel);
      const ctx2 = document.createElement('canvas').getContext('2d');
      ctx2.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const sortFits = ctx2.measureText(sel.options[sel.selectedIndex].text).width + 32 <= sel.getBoundingClientRect().width;
      return { rank, normal, cut, over, sumH: Math.round(sum.getBoundingClientRect().height), sum: sum.textContent, ph: input.placeholder, phCut: input.scrollWidth > input.clientWidth,
        sortFits, sortText: sel.options[sel.selectedIndex].text };
    });
    assert(m.rank.length >= 3 && m.rank.every((t) => /\d+(st|nd|rd|th) of \d+|Rough/.test(t)), `${w}: rank lines ${JSON.stringify(m.rank)}`);
    assert(m.normal.length >= 3 && m.normal.every((t) => /^Normal \d+%$/.test(t)), `${w}: normal chance ${JSON.stringify(m.normal)}`);
    assert(!m.cut.length, `${w}: cut ${JSON.stringify(m.cut.slice(0, 5))}`);
    assert(m.over <= 0, `${w}: card content runs ${m.over} px past the card`);
    assert(m.sumH <= 22, `${w}: "${m.sum}" takes ${m.sumH} px`);
    assert(!m.phCut, `${w}: the placeholder "${m.ph}" is cut`);
    assert(m.sortFits, `${w}: the sort menu cuts "${m.sortText}"`);
    out.push(`${w}: ${m.rank.length} rank lines ("${m.rank[0]}"), ${m.normal.length} normal chances, "${m.sum}" on one line, placeholder "${m.ph}"`);
  }
  return out.join('; ');
});

await check('Laptops: each sort arrow sits next to its label, long names take two lines, the page links never reach the search', async () => {
  const out = [];
  for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768]]) {
    await open('#/rankings?q=united', { width: w, height: h });
    const m = await page.evaluate(() => {
      const far = [...document.querySelectorAll('.rk-row-head .rk-sort')].filter((b) => b.getClientRects().length).map((b) => {
        const icon = b.querySelector('.rk-sort-icon').getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(b.querySelector('.rk-sort-label'));
        const rects = [...range.getClientRects()].filter((x) => x.width > 0 && Math.abs(x.top - icon.top) < 14 && !(x.left >= icon.left - 0.5 && x.right <= icon.right + 0.5));
        return { t: b.textContent, d: Math.round(Math.min(...rects.map((x) => Math.max(0, icon.left - x.right, x.left - icon.right)))) };
      }).filter((x) => x.d > 6);
      const cut = [...document.querySelectorAll('.rk-name-text')].filter((e) => e.scrollHeight > e.clientHeight + 1).map((e) => e.textContent);
      return { far, cut, names: [...document.querySelectorAll('.rk-name-text')].map((e) => e.textContent) };
    });
    assert(!m.far.length, `${w}: arrows away from their labels ${JSON.stringify(m.far)}`);
    assert(m.names.includes('United States') && !m.cut.length, `${w}: names cut ${m.cut.join(', ')}`);
    out.push(`${w}: arrows by their labels, no name cut`);
  }
  const gaps = [];
  for (const w of [881, 1024, 1240, 1241, 1250, 1263, 1280, 1299, 1300, 1440]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(150);
    gaps.push(await page.evaluate(() => {
      const links = [...document.querySelectorAll('.fh-header .fh-nav a')];
      const last = links[links.length - 1].getBoundingClientRect();
      const next = [...document.querySelectorAll('.fh-header-tools > *, .fh-search-trigger')].filter((e) => e.getClientRects().length)
        .map((e) => e.getBoundingClientRect().left).filter((x) => x > last.left);
      return { w: innerWidth, gap: Math.round(Math.min(...next) - last.right) };
    }));
  }
  const tight = gaps.filter((g) => g.gap < 8);
  assert(!tight.length, `the last page link comes within 8 px of the next control: ${JSON.stringify(tight)}`);
  return `${out.join('; ')}; header gaps ${gaps.map((g) => `${g.w}: ${g.gap}`).join(', ')} px`;
});

await check('Touch screens (820 and 1024): the sort headers, the search and the header controls are 44 px', async () => {
  const out = [];
  for (const [w, h] of [[820, 1180], [1024, 768]]) {
    await open('#/rankings', { width: w, height: h, touch: true });
    const m = await page.evaluate(() => {
      const hit = (el) => { const r = el.getBoundingClientRect(); const a = getComputedStyle(el, '::after');
        const t = a.content !== 'none' ? Math.max(0, -parseFloat(a.top) || 0) + Math.max(0, -parseFloat(a.bottom) || 0) : 0; return r.height + t; };
      const sort = [...document.querySelectorAll('.rk-row-head .rk-sort')].filter((b) => b.getBoundingClientRect().height > 0).map(hit);
      const search = document.querySelector('.rk-search')?.getBoundingClientRect().height ?? 0;
      const header = [...document.querySelectorAll('.fh-nav a, .fh-search-trigger, .fh-header .fh-data-badge')].filter((e) => e.getBoundingClientRect().height > 0)
        .map((e) => e.getBoundingClientRect().height);
      return { sort: Math.min(...sort, 99), search, header: header.length ? Math.min(...header) : 99 };
    });
    assert(m.sort >= 44 && m.search >= 44 && m.header >= 44, `${w}: ${JSON.stringify(m)}`);
    out.push(`${w}: sort ${m.sort}, search ${m.search}, header ${m.header}`);
  }
  // a laptop with a mouse keeps its sizes
  await open('#/rankings', { width: 1440, height: 900 });
  const lap = await page.evaluate(() => ({ nav: document.querySelector('.fh-nav a')?.getBoundingClientRect().height, search: document.querySelector('.rk-search')?.getBoundingClientRect().height }));
  assert(lap.nav === 36 && lap.search === 36, `1440 with a mouse: ${JSON.stringify(lap)}`);
  return `${out.join('; ')}; 1440 mouse: ${JSON.stringify(lap)}`;
});

await page.context().close();
await browser.close();
results.push({ ok: problems.length === 0, name: 'No console errors' });
console.log(`${problems.length ? 'FAIL' : 'PASS'} No console errors${problems.length ? `: ${problems.slice(0, 4).join(' | ')}` : ''}`);
console.log(`\n${results.filter((r) => r.ok).length} of ${results.length} passed`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
