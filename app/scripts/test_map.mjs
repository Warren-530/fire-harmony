// End-to-end check of the Explorer's map in a real (headless) Chrome: the settings pill and the legend chip (Escape,
// a map tap and a second press close them; they never cover the zoom rail; nothing spills out of a card), the trend
// view (hash, key, palette, legend counts equal to the files, tooltip numbers equal to the files, the timeline note,
// play goes back to the months), the selected area (hexagons outside it dim), the timeline zoom (wheel, brush, keys,
// double click, exact month picks when zoomed), drawing (a shape that crosses itself is refused, the bar is never
// covered, touch wording), and the phone layout (zoom rail, attribution, legend chip, settings card). Since the review: a
// card opened during a drawing (the bar stays clear; Escape closes the card first), the timeline never squeezed beside
// the player, an open card kept clear of the area at 820 and 1024, the + and - keys, a double click keeps the month,
// the readout and range chip at the right end, short windows (a card's body scrolls with a fade), the phone search list
// over the timeline, the phone trend chip, the month on one line at 320, the touch brush, and the trend's first steps.
// Usage: node scripts/test_map.mjs [baseUrl]      (default http://127.0.0.1:5173/; the dev server must run)
//        THEME=light node scripts/test_map.mjs   (default dark)
//        ONLY='<regex>' node scripts/test_map.mjs   (only the checks whose names match; the later checks open their own pages)
// Prints one line per check and exits with 1 when any check fails. Screenshots of failures go to /tmp/fh_test_map.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.env.TEST_OUT ?? '/tmp/fh_test_map';
const THEME = process.env.THEME === 'light' ? 'light' : 'dark';
const DATA = process.env.FH_DATA ?? path.join(os.homedir(), 'nasa_work/data/products/v1.0');
fs.mkdirSync(outDir, { recursive: true });
const url = (hash) => new URL(hash, base).toString();

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const problems = [];
let page = null;
async function newPage({ width = 1440, height = 900, touch = false, still = false } = {}) {
  if (page) await page.context().close();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch,
    reducedMotion: still ? 'reduce' : 'no-preference' });
  await context.addInitScript((t) => { try { localStorage.setItem('fh_theme', t); localStorage.setItem('fh_welcome_seen', '1'); } catch { /* ignore */ } }, THEME);
  page = await context.newPage();
  // (the outside basemap server failing for a moment is not an error of the app)
  page.on('console', (m) => {
    if (m.type() === 'error' && !/tiles\.openfreemap\.org/.test(`${m.text()} ${m.location().url}`)) problems.push(`${m.type()}: ${m.text()}`.slice(0, 300));
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 300)}`));
  return page;
}

const results = [];
let n = 0;
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
async function check(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
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
/** SHOTS=<dir>: keep a picture of some states, to look at by eye. */
const shot = async (name) => { if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS, `${name}_${THEME}.png`) }); } };

const READY = '.fh-ex[data-series-ready="true"] .fh-ex-map[data-ready="true"]';
const AREA = '#/?area=state:IDN-1931&month=201909';
async function open(hash, timeout = 150_000) {
  // the same link again would only be a hash change that changes nothing: load the page afresh then
  if (page.url() === url(hash)) await page.reload({ waitUntil: 'domcontentloaded' });
  else await page.goto(url(hash), { waitUntil: 'domcontentloaded' });
  try { await page.waitForSelector(READY, { timeout }); } catch {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(READY, { timeout });
  }
}
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
    await page.waitForTimeout(400);
  }
  throw new Error('the map did not settle');
}
const box = (sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom };
}, sel);
const meets = (a, b) => !!a && !!b && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
/** Is the centre of each element the element itself (or inside it), as the pointer would find it? */
const reachable = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => {
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20), ok: !!hit && (el === hit || el.contains(hit)) };
}), sel);
const settingsState = () => page.locator('.fh-ex-controls-body').getAttribute('data-open');
const legendState = () => page.locator('.fh-ex-legend-card').getAttribute('data-open');
const areaName = () => page.locator('.fh-ex-name').innerText();
const hash = () => page.evaluate(() => decodeURIComponent(window.location.hash));
const blur = () => page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });

/** The counts of a trend file, as the report states them (q of 0.05 or less). */
function fileCounts(level) {
  const f = JSON.parse(fs.readFileSync(path.join(DATA, `web/trend_l${level}.json`), 'utf8'));
  const c = { hexagons: f.h3.length, tested: 0, rising: 0, falling: 0, flat: 0, untested: 0 };
  f.h3.forEach((_, i) => {
    const q = f.q[i];
    if (q === null) { c.untested++; return; }
    c.tested++;
    if (q <= 0.05 && f.pct[i] > 0) c.rising++; else if (q <= 0.05 && f.pct[i] < 0) c.falling++; else c.flat++;
  });
  return { c, f };
}
// a number as the tooltip shows it; "< 0.0001" (a p or q value the file rounds to 0) reads as 0
const num = (s) => (/^\s*</.test(String(s)) ? 0 : Number(String(s).replace(/[,\s]/g, '').replace('−', '-')));

// ------------------------------------------------------------------------------------------------- the checks

await newPage();

await check('the map settings start as a pill; the legend as a chip', async () => {
  await open(AREA);
  const bar = await box('.fh-ex-controls-bar');
  assert(bar && bar.h <= 44, `top bar ${bar?.h} px tall`);
  assert((await settingsState()) === 'false' && (await legendState()) === 'false', 'a card is open at the start');
  const pill = await page.locator('.fh-ex-controls-toggle').innerText();
  assert(/Fire count/.test(pill), `pill says "${pill}"`);
  return `bar ${Math.round(bar.w)} x ${Math.round(bar.h)} px, pill "${pill.trim()}"`;
});

await check('the settings card: opens on a press, closes on Escape, a map tap and a second press', async () => {
  const pill = page.locator('.fh-ex-controls-toggle');
  await pill.click();
  await page.waitForSelector('.fh-ex-controls-body[data-open="true"]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.fh-ex-controls-body')?.getAttribute('data-open') === 'false');
  await pill.click();
  await page.waitForSelector('.fh-ex-controls-body[data-open="true"]');
  const before = await areaName();
  const map = await box('.fh-ex-map');
  await page.mouse.click(map.x + map.w * 0.62, map.y + map.h * 0.55);   // on the hexagons
  await page.waitForFunction(() => document.querySelector('.fh-ex-controls-body')?.getAttribute('data-open') === 'false');
  await page.waitForTimeout(800);
  assert((await areaName()) === before, `the tap that closed the card also picked "${await areaName()}"`);
  await pill.click();
  await page.waitForSelector('.fh-ex-controls-body[data-open="true"]');
  await pill.click();
  await page.waitForFunction(() => document.querySelector('.fh-ex-controls-body')?.getAttribute('data-open') === 'false');
  return 'Escape, map tap (no hexagon picked), second press';
});

for (const [w, h] of [[1440, 900], [1366, 657], [1280, 720], [1100, 800], [1024, 768], [1024, 668], [900, 1000], [820, 1180], [769, 1024]]) {
  await check(`${w}x${h}: the open card never covers the zoom rail, and nothing sticks out of it`, async () => {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(700);
    for (const which of ['.fh-ex-controls-toggle', '.fh-ex-legend-chip']) {
      await page.locator(which).click();
      await page.waitForTimeout(450);
      const card = await box(which === '.fh-ex-legend-chip' ? '.fh-ex-legend-card' : '.fh-ex-controls-body');
      const zoom = await box('.fh-ex-zoom');
      assert(!meets(card, zoom), `card ${JSON.stringify(card)} meets zoom ${JSON.stringify(zoom)}`);
      const zoomHits = await reachable('.fh-ex-zoom button');
      assert(zoomHits.every((z) => z.ok), `covered: ${zoomHits.filter((z) => !z.ok).map((z) => z.label).join(', ')}`);
      const spill = await page.evaluate((sel) => {
        const c = document.querySelector(sel); const r = c.getBoundingClientRect();
        return Math.max(0, ...[...c.querySelectorAll('*')].map((k) => k.getBoundingClientRect()).filter((b) => b.width > 0).map((b) => b.right - r.right + 1));
      }, which === '.fh-ex-legend-chip' ? '.fh-ex-legend-card' : '.fh-ex-controls-body');
      assert(spill <= 1, `content sticks out of the card by ${spill.toFixed(1)} px`);
      assert(card.r <= w && card.x >= 0, `card outside the window: ${JSON.stringify(card)}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    // the drawing bar and the status sit below the top bar, in the free map area
    const top = await box('.fh-ex-map-top'), bar = await box('.fh-ex-controls-bar'), panel = await box('.fh-ex-panel');
    assert(!meets(top, bar) && top.x >= panel.r, `map top ${JSON.stringify(top)} meets the bar or the panel`);
    // the timeline is never squeezed: the chart gets the dock's width
    const scrub = await box('.fh-ex-scrub');
    assert(scrub.w >= 300, `the timeline chart is ${Math.round(scrub.w)} px wide`);
    return `zoom rail clear; chart ${Math.round(scrub.w)} px`;
  });
}

for (const [w, h] of [[1440, 900], [1280, 720], [1024, 768]]) {
  await check(`${w}x${h}: after the deep link the area is clear of the map controls; the gaps stay thin`, async () => {
    await page.setViewportSize({ width: w, height: h });
    await open(AREA);
    await settle();
    await page.waitForTimeout(500);
    await settle();
    const controls = await box('.fh-ex-controls'), zoom = await box('.fh-ex-zoom');
    assert(controls.h <= 44, `the settings take ${controls.h} px`);
    const area = await page.evaluate(() => {
      const m = window.__fhMap.map();
      const b = m.getContainer().getBoundingClientRect();
      const pts = [[110.7, -3.6], [115.8, -3.6], [115.8, 0.8], [110.7, 0.8]].map((p) => m.project(p));
      return { x: b.left + Math.min(...pts.map((p) => p.x)), r: b.left + Math.max(...pts.map((p) => p.x)), y: b.top + Math.min(...pts.map((p) => p.y)), b: b.top + Math.max(...pts.map((p) => p.y)) };
    });
    assert(!meets(area, controls) && !meets(area, zoom), `area ${JSON.stringify(area)} meets the controls ${JSON.stringify(controls)} or zoom`);
    const gap = await page.evaluate(() => window.__fhMap.gapPx());
    assert(gap && gap.gap <= 3, `gap ${JSON.stringify(gap)}`);
    return `controls ${Math.round(controls.w)} x ${Math.round(controls.h)}; gap ${gap.gap.toFixed(2)} px at level ${gap.level}`;
  });
}

await check('the camera keeps the area clear of the open settings card', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(AREA);
  await settle();
  await page.locator('.fh-ex-controls-toggle').click();
  await page.waitForTimeout(1500);
  await settle();
  const card = await box('.fh-ex-controls-body');
  const area = await page.evaluate(() => {
    const m = window.__fhMap.map();
    const b = m.getContainer().getBoundingClientRect();
    // the state's main bounds (Kalimantan Tengah) projected on screen
    const pts = [[110.7, -3.6], [115.8, -3.6], [115.8, 0.8], [110.7, 0.8]].map((p) => m.project(p));
    return { x: b.left + Math.min(...pts.map((p) => p.x)), r: b.left + Math.max(...pts.map((p) => p.x)), y: b.top + Math.min(...pts.map((p) => p.y)), b: b.top + Math.max(...pts.map((p) => p.y)) };
  });
  assert(!meets(area, card), `area ${JSON.stringify(area)} under the card ${JSON.stringify(card)}`);
  await page.keyboard.press('Escape');
  return `area right edge ${Math.round(area.r)}, card from ${Math.round(card.x)}`;
});

await check('a hexagon tooltip beside the open settings card moves clear of it', async () => {
  await settle();
  await page.locator('.fh-ex-controls-toggle').click();
  await page.waitForSelector('.fh-ex-controls-body[data-open="true"]');
  await page.waitForTimeout(500);
  const card = await box('.fh-ex-controls-body'), map = await box('.fh-ex-map');
  const hex = await page.evaluate(([x, y]) => window.__fhMap.hexNear(x, y), [card.x - map.x - 40, card.y - map.y + 70]);
  assert(hex && hex.d < 80, `no hexagon with fire near the card (${JSON.stringify(hex)})`);
  await page.mouse.move(map.x + hex.x - 20, map.y + hex.y - 10);
  await page.mouse.move(map.x + hex.x, map.y + hex.y, { steps: 4 });
  await page.waitForSelector('.fh-ex-tip', { timeout: 90_000 });
  await page.waitForTimeout(300);
  const tip = await box('.fh-ex-tip');
  assert(!meets(tip, card), `tooltip ${JSON.stringify(tip)} meets the card ${JSON.stringify(card)}`);
  await page.mouse.move(map.x + 5, map.y + map.h / 2);
  await page.keyboard.press('Escape');
  return `tooltip at ${Math.round(tip.x)}..${Math.round(tip.r)}, card from ${Math.round(card.x)}`;
});

await check('the selected area stands out: hexagons outside it dim', async () => {
  await settle();
  const r = await page.evaluate(() => {
    const m = window.__fhMap;
    const a = m.hexWhere(true), b = m.hexWhere(false);
    return { inside: a && m.fillOf(a.h3), outside: b && m.fillOf(b.h3), count: m.insideCount(), selected: document.querySelector('.fh-ex-map')?.dataset.selected };
  });
  assert(r.selected === 'true' && r.count > 0, `selected ${r.selected}, ${r.count} hexagons inside`);
  assert(r.inside && r.outside && r.outside[3] < r.inside[3] * 0.6, `alpha inside ${r.inside?.[3]}, outside ${r.outside?.[3]}`);
  return `${r.count} hexagons inside; alpha ${r.inside[3]} inside, ${r.outside[3]} outside`;
});

await check('trend view: the key R, the hash, the legend counts equal the file', async () => {
  await blur();
  await page.keyboard.press('r');
  await page.waitForSelector('.fh-ex-map[data-mode="trend"]', { timeout: 120_000 });
  assert((await hash()).includes('mode=trend'), `hash ${await hash()}`);
  const level = Number(await page.locator('.fh-ex-map').getAttribute('data-level'));
  const { c } = fileCounts(level);
  await page.locator('.fh-ex-legend-chip').click();
  await page.waitForFunction(() => !/…/.test(document.querySelector('.fh-ex-trend-key')?.textContent ?? '…'), null, { timeout: 60_000 });
  const shown = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.fh-ex-trend-classes li')]
    .map((li) => [li.dataset.class, li.querySelector('.fh-ex-trend-count').textContent])));
  for (const k of ['rising', 'falling', 'flat', 'untested']) assert(num(shown[k]) === c[k], `${k}: legend ${shown[k]}, file ${c[k]}`);
  const tested = await page.locator('.fh-ex-trend-tested').innerText();
  assert(tested.includes(c.tested.toLocaleString('en-GB')) && tested.includes(c.hexagons.toLocaleString('en-GB')), `tested line "${tested}"`);
  const why = await page.locator('.fh-ex-trend-why').innerText();
  assert(/5% false discovery rate/.test(why), `why "${why}"`);
  await page.keyboard.press('Escape');
  return `level ${level}: rising ${c.rising}, falling ${c.falling}, no clear trend ${c.flat}, not tested ${c.untested}; ${tested}`;
});

await check('trend view: the hexagon tooltip shows the file\'s numbers', async () => {
  await settle();
  const level = Number(await page.locator('.fh-ex-map').getAttribute('data-level'));
  const { f } = fileCounts(level);
  const at = new Map(f.h3.map((h, i) => [h, i]));
  const map = await box('.fh-ex-map');
  const seen = [];
  for (const [kind, skip] of [['falling', 0], ['falling', 3], ['flat', 0], ['untested', 0], ['rising', 0]]) {
    const hex = await page.evaluate(([k, s]) => window.__fhMap.trendHex(k, s), [kind, skip]);
    if (!hex) continue;
    await page.mouse.move(map.x + hex.x - 25, map.y + hex.y - 15);
    await page.mouse.move(map.x + hex.x, map.y + hex.y, { steps: 4 });
    await page.waitForSelector('.fh-ex-tip', { timeout: 90_000 });
    const vals = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.fh-ex-tip dd[data-k]')].map((d) => [d.dataset.k, d.textContent])));
    const i = at.get(hex.h3);
    assert(i !== undefined, `${hex.h3} is not in the file`);
    if (kind !== 'untested') {
      assert(num(vals.pct.replace(/%.*$/, '')) === f.pct[i], `${hex.h3} pct ${vals.pct} vs ${f.pct[i]}`);
      assert(num(vals.p) === f.p[i], `${hex.h3} p ${vals.p} vs ${f.p[i]}`);
      assert(num(vals.q) === f.q[i], `${hex.h3} q ${vals.q} vs ${f.q[i]}`);
    } else {
      const text = await page.locator('.fh-ex-tip').innerText();
      assert(/Too little fire to test/.test(text) && /Under 100 hotspots a year/.test(text), `untested tooltip: ${text}`);
    }
    assert(num(vals.mean) === f.mean[i], `${hex.h3} mean ${vals.mean} vs ${f.mean[i]}`);
    seen.push(`${kind} ${hex.h3} ${vals.pct ?? ''} p ${vals.p ?? '-'} q ${vals.q ?? '-'} mean ${vals.mean}`);
    await page.mouse.move(map.x + 5, map.y + map.h / 2);
    await page.waitForTimeout(200);
  }
  assert(seen.length >= 3, `only ${seen.length} hexagons checked`);
  return seen.join('; ');
});

await check('trend view: the timeline says the month does not apply; play goes back to the months', async () => {
  const note = await page.locator('.fh-ex-trend-note').innerText();
  assert(/2001 to 2025/.test(note), `note "${note}"`);
  const panel = await page.locator('.fh-ex-kind').innerText();
  assert(/state/i.test(panel), 'the area panel still shows the state');
  // the link opens the trend map again
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.fh-ex-map[data-mode="trend"]', { timeout: 150_000 });
  await page.getByRole('button', { name: 'Play the months (Space)' }).click();
  await page.waitForFunction(() => document.querySelector('.fh-ex-map')?.dataset.mode === 'count', null, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Pause (Space)' }).click();
  await page.waitForSelector('.fh-ex-trend-note', { state: 'detached', timeout: 10_000 });
  return `note "${note.split('\n')[0]}"`;
});

await check('trend view from the command palette and the settings tile', async () => {
  await blur();
  await page.keyboard.press('Control+k');
  const input = page.locator('.ui-palette input[role="combobox"]');
  await input.waitFor({ timeout: 10_000 });
  await input.fill('trend');
  await page.waitForSelector('#fh-palette-list [role="option"]', { timeout: 10_000 });
  const first = await page.locator('#fh-palette-list [role="option"]').first().innerText();
  await page.getByRole('option', { name: /Colour by trend/ }).click();
  await page.waitForSelector('.fh-ex-map[data-mode="trend"]', { timeout: 60_000 });
  await page.locator('.fh-ex-controls-toggle').click();
  await page.getByRole('radio', { name: 'Fire count' }).click();
  await page.waitForSelector('.fh-ex-map[data-mode="count"]', { timeout: 30_000 });
  await page.getByRole('radio', { name: 'Trend 2001 to 2025' }).click();
  await page.waitForSelector('.fh-ex-map[data-mode="trend"]', { timeout: 30_000 });
  await page.keyboard.press('Escape');
  await blur();
  await page.keyboard.press('c');
  await page.waitForSelector('.fh-ex-map[data-mode="count"]', { timeout: 30_000 });
  return `palette's first hit "${first.split('\n')[0]}"`;
});

await check('timeline zoom: wheel zooms in, every month can be picked exactly, double click zooms out', async () => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(800);
  const scrub = page.locator('.fh-ex-scrub');
  let b = await scrub.boundingBox();
  assert(b.width >= 300, `the chart is ${b.width} px wide at 1024`);
  await page.mouse.move(b.x + b.width * 0.7, b.y + 30);
  for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(60); }
  await page.waitForFunction(() => document.querySelector('.fh-ex-scrub')?.dataset.zoomed === 'true');
  const [a, z] = (await scrub.getAttribute('data-win')).split(',').map(Number);
  const pxMonth = (b.width - 20) / (z - a);
  assert(pxMonth >= 8, `${pxMonth.toFixed(1)} px per month`);
  // ten months picked by clicking: each is exactly the month under the pointer
  const first = await page.evaluate(() => 200011);
  const addYm = (ym, by) => { const t = Math.floor(ym / 100) * 12 + (ym % 100) - 1 + by; return Math.floor(t / 12) * 100 + (t % 12) + 1; };
  const picks = [];
  for (let k = 0; k < 10; k++) {
    const i = Math.ceil(a) + Math.floor(((k + 0.5) / 10) * (Math.floor(z) - Math.ceil(a)));
    const x = b.x + 10 + ((i - a) / (z - a)) * (b.width - 20);
    await page.mouse.click(x, b.y + 30);
    const want = addYm(first, i);
    await page.waitForFunction((m) => Number(document.querySelector('.fh-ex-map')?.dataset.ym) === m, want, { timeout: 30_000 });
    picks.push(want);
  }
  await page.mouse.dblclick(b.x + b.width / 2, b.y + 30);
  await page.waitForFunction(() => document.querySelector('.fh-ex-scrub')?.dataset.zoomed === 'false', null, { timeout: 5000 });
  return `${pxMonth.toFixed(1)} px per month; picked ${picks.join(', ')}`;
});

await check('timeline zoom: the brush strip, the range chip and the keys', async () => {
  const scrub = page.locator('.fh-ex-scrub');
  const b = await scrub.boundingBox();
  const stripY = b.y + 66;
  await page.mouse.move(b.x + b.width * 0.40, stripY);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.55, stripY, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.fh-ex-scrub')?.dataset.zoomed === 'true');
  const chip = await page.locator('.fh-ex-zoom-chip').innerText();
  assert(/\d{4} to \d{4}/.test(chip), `chip "${chip}"`);
  // the window follows the month: step far away with the keys
  await page.locator('.fh-ex-scrub').focus();
  await page.keyboard.press('End');
  const n = await scrub.getAttribute('aria-valuemax').then(Number);
  await page.waitForFunction((last) => Number(document.querySelector('.fh-ex-scrub')?.dataset.win?.split(',')[1]) >= last - 0.5, n, { timeout: 8000 })
    .catch(() => undefined);
  const [a, z] = (await scrub.getAttribute('data-win')).split(',').map(Number);
  assert(z >= n - 0.5, `the window ${a}..${z} did not follow the last month ${n}`);
  await page.keyboard.press('0');
  await page.waitForFunction(() => document.querySelector('.fh-ex-scrub')?.dataset.zoomed === 'false', null, { timeout: 5000 });
  await page.keyboard.press('+');
  await page.waitForFunction(() => document.querySelector('.fh-ex-scrub')?.dataset.zoomed === 'true', null, { timeout: 5000 });
  await page.locator('.fh-ex-zoom-chip').click();
  await page.waitForFunction(() => document.querySelector('.fh-ex-scrub')?.dataset.zoomed === 'false', null, { timeout: 5000 });
  const year = await page.evaluate(() => getComputedStyle(document.querySelector('.fh-ex-scrub-year')).fontSize);
  assert(parseFloat(year) >= 11, `year labels ${year}`);
  return `brushed "${chip.trim()}", followed the last month, keys + and 0, chip; year labels ${year}`;
});

for (const [w, h] of [[1024, 768], [1280, 720]]) {
  await check(`${w}x${h}: the drawing bar sits in the free map area, never covered`, async () => {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(600);
    await page.locator('.fh-ex-controls-toggle').click();
    await page.getByRole('button', { name: 'Polygon' }).click();
    await page.waitForSelector('.fh-ex-draw', { timeout: 5000 });
    assert((await settingsState()) === 'false', 'the settings stayed open while drawing');
    const hits = await reachable('.fh-ex-draw button');
    assert(hits.every((x) => x.ok), `covered: ${hits.filter((x) => !x.ok).map((x) => x.label).join(', ')}`);
    const bar = await box('.fh-ex-draw'), panel = await box('.fh-ex-panel');
    assert(bar.x >= panel.r && bar.r <= w, `bar ${JSON.stringify(bar)}`);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.fh-ex-draw', { state: 'detached', timeout: 5000 });
    return `bar ${Math.round(bar.x)}..${Math.round(bar.r)}`;
  });
}

await check('drawing: a polygon that crosses itself is refused with a message', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(600);
  const before = await areaName();
  await page.getByRole('button', { name: 'Polygon' }).click();
  await page.waitForSelector('.fh-ex-draw', { timeout: 5000 });
  const m = await box('.fh-ex-map');
  const pts = [[0.55, 0.35], [0.75, 0.65], [0.75, 0.35], [0.55, 0.65]];   // a bow tie
  for (const [px, py] of pts) { await page.mouse.click(m.x + m.w * px, m.y + m.h * py); await page.waitForTimeout(350); }
  await page.getByRole('button', { name: 'Finish' }).click().catch(() => undefined);
  await page.waitForFunction(() => /crosses itself/.test(document.querySelector('.fh-ex-draw')?.textContent ?? ''), null, { timeout: 5000 });
  assert((await areaName()) === before, 'the bow tie became the area');
  await page.getByRole('button', { name: 'Undo point' }).click();
  await page.waitForFunction(() => !/crosses itself/.test(document.querySelector('.fh-ex-draw')?.textContent ?? ''), null, { timeout: 5000 });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForSelector('.fh-ex-draw', { state: 'detached', timeout: 5000 });
  // a bow tie in a link is refused too
  await open('#/?area=polygon:100,0;102,2;100,2;102,0');
  const name = await areaName();
  assert(!/Area near|Drawn/.test(name), `the link opened "${name}"`);
  const note = await page.locator('.fh-ex-note').innerText().catch(() => '');
  return `refused while drawing; the link shows "${name}" (${note})`;
});

// ------------------------------------------------------------------------------------------------- phones

for (const [w, h] of [[768, 1024], [390, 844], [320, 640]]) {
  await check(`${w}x${h} touch: chip, pill, zoom rail and attribution stay apart; the card fits and closes`, async () => {
    await newPage({ width: w, height: h, touch: true });
    await open(AREA);
    const chip = await box('.fh-ex-legend-chip'), pill = await box('.fh-ex-controls-toggle'), zoom = await box('.fh-ex-zoom');
    const attrib = await box('.maplibregl-ctrl-attrib'), top = await box('.fh-ex-map-top');
    assert(!meets(chip, pill), 'legend chip meets the settings pill');
    assert(!meets(zoom, attrib), `zoom ${JSON.stringify(zoom)} meets the attribution ${JSON.stringify(attrib)}`);
    assert(top.y >= pill.b, 'the status and drawing area overlap the top bar');
    assert(pill.h >= 44 && chip.h >= 44, `touch targets ${pill.h} and ${chip.h} px`);
    const zb = await page.evaluate(() => [...document.querySelectorAll('.fh-ex-zoom button')].map((b) => b.getBoundingClientRect().height));
    assert(zb.every((v) => v >= 44), `zoom buttons ${zb.join(', ')} px`);
    await page.locator('.fh-ex-controls-toggle').tap();
    await page.waitForSelector('.fh-ex-controls-body[data-open="true"]');
    await page.waitForTimeout(400);
    const card = await box('.fh-ex-controls-body');
    assert(card.x >= 0 && card.r <= w, `card ${JSON.stringify(card)}`);
    const spill = await page.evaluate(() => {
      const c = document.querySelector('.fh-ex-controls-body'); const r = c.getBoundingClientRect();
      return Math.max(0, ...[...c.querySelectorAll('*')].map((k) => k.getBoundingClientRect()).filter((b) => b.width > 0).map((b) => b.right - r.right + 1));
    });
    assert(spill <= 1, `content sticks out by ${spill}`);
    // (the phone sheet shrinks as the card opens and the map redraws, which is slow in a software renderer)
    const zoomVisible = await page.waitForFunction(() => getComputedStyle(document.querySelector('.fh-ex-zoom')).visibility === 'hidden', null, { timeout: 12_000 })
      .then(() => 'hidden', () => 'visible');
    assert(zoomVisible === 'hidden' || !meets(card, zoom), 'the open card covers the zoom rail');
    const before = await areaName();
    const m = await box('.fh-ex-map');
    // a tap on the map beside the card, or (when the card fills the map) on a quiet spot below it: the timeline's month,
    // or the top of the phone sheet
    const spot = card.b < m.b - 40 ? { x: m.x + 30, y: m.b - 30 } : await page.evaluate(() => {
      const spots = [];
      const month = document.querySelector('.fh-ex-month')?.getBoundingClientRect();
      if (month && month.width > 0) spots.push({ x: month.x + 10, y: month.y + 10 });
      const top = document.querySelector('.fh-ex-sheet-top')?.getBoundingClientRect();
      if (top && top.width > 0) spots.push({ x: top.x + 8, y: top.bottom - 4 }, { x: top.x + 8, y: top.y + 8 });
      return spots.find((p) => {
        const el = document.elementFromPoint(p.x, p.y);
        return el && !el.closest('button, a, input, select, [role="button"], .fh-ex-controls');
      }) ?? spots[0];
    });
    await page.touchscreen.tap(spot.x, spot.y);
    await page.waitForFunction(() => document.querySelector('.fh-ex-controls-body')?.getAttribute('data-open') === 'false', null, { timeout: 5000 });
    await page.waitForTimeout(600);
    assert((await areaName()) === before, 'the tap that closed the card also changed the area');
    // drawing: touch wording, and the settings close
    await page.locator('.fh-ex-controls-toggle').tap();
    await page.waitForSelector('.fh-ex-controls-body[data-open="true"]');
    // on phones the drawing tools sit in the sheet's search: its button opens them (and that press closes the card)
    const polygon = page.getByRole('button', { name: 'Polygon' });
    if (!(await polygon.isVisible())) {
      await page.getByRole('button', { name: 'Find or draw a place' }).tap();
      await polygon.waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(400);
    }
    await polygon.tap();
    await page.waitForSelector('.fh-ex-draw', { timeout: 5000 });
    assert((await settingsState()) === 'false', 'settings stayed open while drawing');
    const text = await page.locator('.fh-ex-draw').innerText();
    assert(/Tap points/.test(text) && !/Escape|double click/i.test(text), `drawing text "${text}"`);
    // the map scrolls into view when the tool is picked below it
    await page.waitForFunction(() => { const r = document.querySelector('.fh-ex-draw')?.getBoundingClientRect(); return r && r.top >= 0 && r.bottom <= window.innerHeight; }, null, { timeout: 5000 });
    // a phone sheet glides down when a drawing starts (slowly in a software renderer): wait for it to settle
    let hits = [];
    for (let i = 0; i < 16; i++) {
      await page.waitForTimeout(500);
      hits = await reachable('.fh-ex-draw button');
      if (hits.every((x) => x.ok)) break;
    }
    assert(hits.every((x) => x.ok), `covered: ${hits.filter((x) => !x.ok).map((x) => x.label).join(', ')}`);
    await page.getByRole('button', { name: 'Cancel' }).tap();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(wide <= w + 1, `page is ${wide} px wide`);
    return `card ${Math.round(card.w)} px wide; "${text.split('.')[0]}"`;
  });
}

await check('motion with meaning: a pulse on a picked hexagon and a frame where the camera lands; none with reduced motion', async () => {
  await newPage({ width: 1280, height: 800 });
  await page.goto(url('#/'), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(READY, { timeout: 150_000 });
  await settle();
  await page.evaluate(() => { window.location.hash = '#/?area=country:BRA&month=201909'; });
  await page.waitForSelector('.fh-ex-reticle', { state: 'attached', timeout: 30_000 });
  await settle();
  const hex = await page.evaluate(() => window.__fhMap.firstHex(5));
  const m = await box('.fh-ex-map');
  await page.mouse.click(m.x + hex.x, m.y + hex.y);
  await page.waitForSelector('.fh-ex-pulse', { state: 'attached', timeout: 30_000 });
  // reduced motion: the same steps, without either
  await newPage({ width: 1280, height: 800, still: true });
  await page.goto(url('#/'), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(READY, { timeout: 150_000 });
  await settle();
  await page.evaluate(() => { window.location.hash = '#/?area=country:BRA&month=201909'; });
  await page.waitForFunction(() => document.querySelector('.fh-ex-name')?.textContent?.includes('Brazil'), null, { timeout: 60_000 });
  await settle();
  const hex2 = await page.evaluate(() => window.__fhMap.firstHex(5));
  const m2 = await box('.fh-ex-map');
  await page.mouse.click(m2.x + hex2.x, m2.y + hex2.y);
  await page.waitForFunction(() => document.querySelector('.fh-ex-name')?.textContent?.includes('Hexagon near'), null, { timeout: 60_000 });
  const extra = await page.evaluate(() => document.querySelectorAll('.fh-ex-pulse, .fh-ex-reticle').length);
  assert(extra === 0, `${extra} motion marks under reduced motion`);
  return 'reticle and pulse seen; none under reduced motion';
});


// ------------------------------------------------------------------------------------------------- since the review

/** A desktop page with the area open (a check run alone with ONLY opens its own). */
async function ensure(w, h) {
  if (!page || page.viewportSize()?.width < 769 || !(await page.locator(READY).count())) { await newPage({ width: w, height: h }); await open(AREA); }
  await page.setViewportSize({ width: w, height: h });
}

for (const [w, h] of [[1440, 900], [1024, 768], [900, 1000], [820, 1180]]) {
  await check(`${w}x${h}: a card opened during a drawing never covers the drawing bar; Escape closes the card first`, async () => {
    await ensure(w, h);
    await page.waitForTimeout(700);
    if (await page.locator('.fh-ex-draw').count()) await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Polygon' }).click();
    await page.waitForSelector('.fh-ex-draw', { timeout: 5000 });
    const notes = [];
    for (const [which, card] of [['.fh-ex-controls-toggle', '.fh-ex-controls-body'], ['.fh-ex-legend-chip', '.fh-ex-legend-card']]) {
      await page.locator(which).click();
      await page.waitForSelector(`${card}[data-open="true"]`);
      await page.waitForTimeout(700);
      // the bar glides aside (the software renderer can hold the page for a while): wait until it stands still
      let bar = await box('.fh-ex-draw');
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(250);
        const next = await box('.fh-ex-draw');
        if (Math.abs(next.x - bar.x) < 0.5 && Math.abs(next.y - bar.y) < 0.5) { bar = next; break; }
        bar = next;
      }
      const c = await box(card);
      assert(!meets(c, bar), `the card ${JSON.stringify(c)} meets the drawing bar ${JSON.stringify(bar)}`);
      const hits = await reachable('.fh-ex-draw button');
      assert(hits.every((x) => x.ok), `covered: ${hits.filter((x) => !x.ok).map((x) => x.label).join(', ')}`);
      const zoom = await box('.fh-ex-zoom');
      assert(!meets(c, zoom), 'the card meets the zoom rail');
      notes.push(`${card === '.fh-ex-legend-card' ? 'legend' : 'settings'} ${c.y >= bar.b ? 'under' : 'beside'} the bar`);
      await shot(`draw_card_${w}x${h}_${card === '.fh-ex-legend-card' ? 'legend' : 'settings'}`);
      await page.keyboard.press('Escape');
      await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('data-open') === 'false', card, { timeout: 5000 });
      assert(await page.locator('.fh-ex-draw').count() === 1, 'Escape also ended the drawing');
    }
    await page.keyboard.press('Escape');
    await page.waitForSelector('.fh-ex-draw', { state: 'detached', timeout: 5000 });
    return notes.join('; ');
  });
}

await check('the timeline chart beside the player is never squeezed (1101 to 1366 px)', async () => {
  await ensure(1440, 900);
  const out = [];
  for (const w of [1101, 1150, 1200, 1240, 1280, 1366, 1440]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(500);
    const scrub = await box('.fh-ex-scrub'), dock = await box('.fh-ex-dock');
    assert(scrub.w >= 400, `${w}: the chart is ${Math.round(scrub.w)} px wide`);
    assert(dock.r <= w, `${w}: the dock runs off the window`);
    out.push(`${w}: ${Math.round(scrub.w)}`);
  }
  return `chart px ${out.join(', ')}`;
});

const areaBox = () => page.evaluate(() => {
  const m = window.__fhMap.map();
  const b = m.getContainer().getBoundingClientRect();
  const pts = [[110.7, -3.6], [115.8, -3.6], [115.8, 0.8], [110.7, 0.8]].map((p) => m.project(p));
  return { x: b.left + Math.min(...pts.map((p) => p.x)), r: b.left + Math.max(...pts.map((p) => p.x)), y: b.top + Math.min(...pts.map((p) => p.y)), b: b.top + Math.max(...pts.map((p) => p.y)) };
});
for (const [w, h] of [[820, 1180], [1024, 768]]) {
  await check(`${w}x${h}: an open card, settings or the trend legend, keeps clear of the selected area`, async () => {
    await newPage({ width: w, height: h });
    await open(`${AREA}&mode=trend`);
    await settle();
    const notes = [];
    for (const [which, card] of [['.fh-ex-controls-toggle', '.fh-ex-controls-body'], ['.fh-ex-legend-chip', '.fh-ex-legend-card']]) {
      await page.locator(which).click();
      await page.waitForSelector(`${card}[data-open="true"]`);
      await page.waitForTimeout(1500);
      await settle();
      const c = await box(card), a = await areaBox(), panel = await box('.fh-ex-panel'), dock = await box('.fh-ex-dock');
      assert(!meets(a, c), `the area ${JSON.stringify(a)} is under the card ${JSON.stringify(c)}`);
      assert(a.x >= panel.r - 1, `the area starts at ${Math.round(a.x)}, under the panel (to ${Math.round(panel.r)})`);
      assert(a.b <= dock.y + 1, `the area ends at ${Math.round(a.b)}, under the dock (from ${Math.round(dock.y)})`);
      await shot(`area_card_${w}x${h}_${card === '.fh-ex-legend-card' ? 'legend' : 'settings'}`);
      notes.push(`${card === '.fh-ex-legend-card' ? 'legend' : 'settings'}: area ${Math.round(a.x)}..${Math.round(a.r)} x ${Math.round(a.y)}..${Math.round(a.b)}, card to ${Math.round(c.b)}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
    return notes.join('; ');
  });
}

await check('the keys + and − zoom the map from anywhere on the page, not while typing', async () => {
  await ensure(1440, 900);
  await page.waitForTimeout(500);
  await settle();
  const zoom = () => page.evaluate(() => window.__fhMap.map().getZoom());
  await blur();
  const z0 = await zoom();
  await page.keyboard.press('+');
  await page.waitForFunction((z) => window.__fhMap.map().getZoom() > z + 0.9, z0, { timeout: 10_000 });
  await settle();
  // with a button of the panel focused
  await page.locator('.fh-ex-panel .fh-ex-tool').first().focus();
  await page.keyboard.press('-');
  await page.waitForFunction((z) => Math.abs(window.__fhMap.map().getZoom() - z) < 0.1, z0, { timeout: 10_000 });
  await settle();
  // typing in the place search: no zoom
  await page.locator('.fh-search-input').first().focus();
  await page.keyboard.type('-+');
  await page.waitForTimeout(800);
  assert(Math.abs((await zoom()) - z0) < 0.1, 'typing in the search zoomed the map');
  await page.locator('.fh-search-input').first().fill('');
  await blur();
  return `zoom ${z0.toFixed(2)} > ${(z0 + 1).toFixed(2)} > ${z0.toFixed(2)}`;
});

await check('a double click that zooms the timeline out keeps the month', async () => {
  await ensure(1440, 900);
  const scrub = page.locator('.fh-ex-scrub');
  const b = await scrub.boundingBox();
  await page.mouse.move(b.x + b.width * 0.5, b.y + 30);
  for (let k = 0; k < 5; k++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(60); }
  await page.waitForFunction(() => document.querySelector('.fh-ex-scrub')?.dataset.zoomed === 'true');
  await page.waitForTimeout(400);
  // (the chosen month: the map may show a preview of the month under the pointer)
  const chosen = () => scrub.getAttribute('aria-valuenow');
  const ym = await chosen();
  const out = [];
  for (const at of [0.2, 0.8]) {
    await page.mouse.dblclick(b.x + b.width * at, b.y + 30);
    await page.waitForFunction(() => document.querySelector('.fh-ex-scrub')?.dataset.zoomed === 'false', null, { timeout: 5000 });
    await page.waitForTimeout(800);
    const now = await chosen();
    assert(now === ym, `the month went from ${ym} to ${now} (double click at ${at * 100}%)`);
    out.push(now);
    await page.mouse.move(b.x + b.width * 0.5, b.y + 30);
    for (let k = 0; k < 5; k++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(60); }
    await page.waitForFunction(() => document.querySelector('.fh-ex-scrub')?.dataset.zoomed === 'true');
    await page.waitForTimeout(400);
  }
  return `the chosen month stays month ${ym} of the record`;
});

await check('zoomed: the readout at the right end stays clear of the attribution and names a month in view; the chip is above the plot', async () => {
  await ensure(1440, 900);
  const scrub = page.locator('.fh-ex-scrub');
  const b = await scrub.boundingBox();
  if ((await scrub.getAttribute('data-zoomed')) !== 'true') {
    await page.mouse.move(b.x + b.width * 0.5, b.y + 30);
    for (let k = 0; k < 5; k++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(60); }
    await page.waitForFunction(() => document.querySelector('.fh-ex-scrub')?.dataset.zoomed === 'true');
    await page.waitForTimeout(400);
  }
  const chip = await box('.fh-ex-zoom-chip');
  assert(chip && chip.b <= b.y + 8 + 0.5, `the range chip ${JSON.stringify(chip)} reaches into the plot (from ${b.y + 8})`);
  await page.mouse.move(b.x + b.width - 3, b.y + 30, { steps: 3 });
  await page.waitForSelector('.fh-ex-scrub-readout');
  await shot('readout_right_1440');
  const read = await box('.fh-ex-scrub-readout'), attr = await box('.maplibregl-ctrl-attrib');
  assert(!meets(read, attr), `the readout ${JSON.stringify(read)} meets the attribution ${JSON.stringify(attr)}`);
  assert(!meets(read, chip), `the readout ${JSON.stringify(read)} meets the range chip ${JSON.stringify(chip)}`);
  const text = await page.locator('.fh-ex-scrub-readout').innerText();
  const chipText = await page.locator('.fh-ex-zoom-chip').innerText();
  const M = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const [, mon, yr] = /([A-Z]{3})\s+(\d{4})/.exec(text.toUpperCase()) ?? [];
  const [a, z] = (await scrub.getAttribute('data-win')).split(',').map(Number);
  const i = (Number(yr) - 2000) * 12 + M.indexOf(mon) - 10;   // months since November 2000
  assert(i >= Math.ceil(a - 0.5) && i <= Math.floor(z + 0.5), `the readout says ${mon} ${yr} (month ${i}), the window is ${a}..${z}`);
  await page.mouse.move(b.x + b.width / 2, b.y - 120);
  await page.locator('.fh-ex-zoom-chip').click();
  await page.waitForFunction(() => document.querySelector('.fh-ex-scrub')?.dataset.zoomed === 'false', null, { timeout: 5000 });
  return `readout "${text.replace(/\s+/g, ' ')}" for chip "${chipText.trim()}"`;
});

// (in 2D: 3D columns are very slow in the software renderer; the card is as tall in 3D)
for (const [w, h] of [[1024, 620], [1366, 600]]) {
  await check(`${w}x${h}: the settings card's body scrolls with a fade, its head stays, and the 3D row can be reached`, async () => {
    await ensure(w, h);
    await page.waitForTimeout(600);
    await blur();
    await page.locator('.fh-ex-controls-toggle').click();
    await page.waitForSelector('.fh-ex-controls-body[data-open="true"]');
    await page.waitForTimeout(600);
    await shot(`card_short_${w}x${h}`);
    const s = await page.evaluate(() => {
      const b = document.querySelector('.fh-ex-controls-body .fh-ex-card-body');
      return { sh: b.scrollHeight, ch: b.clientHeight, fade: b.dataset.fade ?? '' };
    });
    const zoom = await box('.fh-ex-zoom'), card = await box('.fh-ex-controls-body');
    assert(!meets(card, zoom), 'the card meets the zoom rail');
    if (s.sh > s.ch + 2) {
      assert(s.fade === 'b', `a body with more below has fade "${s.fade}"`);
      // scrolled to the end (again while the card may still settle to the new window height; the scroll event can wait
      // for a slow frame of the software renderer)
      await page.waitForFunction(() => {
        const b = document.querySelector('.fh-ex-controls-body .fh-ex-card-body');
        b.scrollTop = b.scrollHeight;
        return b.dataset.fade === 't';
      }, null, { timeout: 8000, polling: 250 }).catch(() => undefined);
      const end = await page.evaluate(() => document.querySelector('.fh-ex-controls-body .fh-ex-card-body').dataset.fade ?? '');
      assert(end === 't', `at the end the fade is "${end}"`);
    }
    const hits = await reachable('.fh-ex-controls-body .fh-ex-card-close, .fh-ex-controls-body .fh-ex-3d');
    assert(hits.every((x) => x.ok), `covered: ${hits.filter((x) => !x.ok).map((x) => x.label).join(', ')}`);
    await page.keyboard.press('Escape');
    await blur();
    return s.sh > s.ch + 2 ? `body ${s.ch} of ${s.sh} px, fades at the bottom then the top` : `all ${s.sh} px shown`;
  });
}

await check('trend colours: a small clear trend stands apart from no clear trend', async () => {
  const { f } = fileCounts(3);
  const weak = f.h3.filter((_, i) => f.q[i] !== null && f.q[i] <= 0.05 && Math.abs(f.pct[i]) < 15);
  const flat = f.h3.filter((_, i) => f.q[i] !== null && f.q[i] > 0.05);
  await newPage({ width: 1440, height: 900 });
  await open('#/?mode=trend');
  await page.waitForFunction(() => document.querySelector('.fh-ex-map')?.dataset.level === '3', null, { timeout: 60_000 });
  const fills = await page.evaluate(([a, b]) => ({ weak: a.map((h) => window.__fhMap.fillOf(h)).find(Boolean), flat: b.map((h) => window.__fhMap.fillOf(h)).find(Boolean) }), [weak.slice(0, 40), flat.slice(0, 40)]);
  assert(fills.weak && fills.flat, `fills ${JSON.stringify(fills)}`);
  const d = Math.hypot(fills.weak[0] - fills.flat[0], fills.weak[1] - fills.flat[1], fills.weak[2] - fills.flat[2]);
  assert(d >= 55, `a weak trend ${fills.weak} is only ${d.toFixed(0)} from no trend ${fills.flat}`);
  // relative luminance: on the dark map no clear trend is the darker of the two, so it recedes behind every clear trend
  const lum = (c) => c.slice(0, 3).map((v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, k) => s + v * [0.2126, 0.7152, 0.0722][k], 0);
  const ratio = (Math.max(lum(fills.weak), lum(fills.flat)) + 0.05) / (Math.min(lum(fills.weak), lum(fills.flat)) + 0.05);
  if (THEME === 'dark') assert(lum(fills.weak) > lum(fills.flat) && ratio >= 1.25, `weak ${fills.weak} and flat ${fills.flat}: contrast ${ratio.toFixed(2)}`);
  return `weak ${fills.weak.slice(0, 3)} against flat ${fills.flat.slice(0, 3)}: distance ${d.toFixed(0)}, contrast ${ratio.toFixed(2)}`;
});

await check('390x844 touch: the place search list opens over the timeline in the sheet', async () => {
  await newPage({ width: 390, height: 844, touch: true });
  await open(AREA);
  await page.getByRole('button', { name: 'Find or draw a place' }).tap();
  await page.waitForSelector('.fh-listbox [role="option"]', { timeout: 10_000 });
  await page.waitForTimeout(1200);
  // (the sheet grows to full height as the search takes the focus: wait until the list stands still)
  let last = '';
  for (let i = 0; i < 30; i++) {
    const now = await page.evaluate(() => { const r = document.querySelector('.fh-listbox')?.getBoundingClientRect(); return r ? `${Math.round(r.top)},${Math.round(r.bottom)}` : ''; });
    if (now && now === last) break;
    last = now;
    await page.waitForTimeout(300);
  }
  await shot('phone_search_390x844');
  const rows = await page.evaluate(() => [...document.querySelectorAll('.fh-listbox [role="option"]')].map((o) => {
    const r = o.getBoundingClientRect();
    if (r.bottom > window.innerHeight || r.height === 0) return null;
    const list = o.closest('.fh-listbox').getBoundingClientRect();
    if (r.top < list.top || r.bottom > list.bottom) return null;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { name: o.textContent.trim().slice(0, 14), ok: !!hit && o.contains(hit) };
  }).filter(Boolean));
  // the list sits under the search box in the half sheet: three rows show, the rest scroll (QA: open the sheet full on focus)
  assert(rows.length >= 3, `${rows.length} rows in view`);
  assert(rows.every((r) => r.ok), `covered: ${rows.filter((r) => !r.ok).map((r) => r.name).join(', ')}`);
  return `${rows.length} rows, all reachable`;
});

for (const [w, h] of [[390, 844], [320, 640]]) {
  await check(`${w}x${h} touch: the trend map says it is one map for 2001 to 2025 with the sheet at its smallest; the month stays on one line`, async () => {
    await newPage({ width: w, height: h, touch: true });
    await open(AREA);
    const lines = await page.evaluate(() => {
      const el = document.querySelector('.fh-ex-sheet .fh-ex-month-code');
      return el ? Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || '20')) : null;
    });
    assert(lines === null || lines <= 1, `the month code takes ${lines} lines`);
    await page.locator('.fh-ex-controls-toggle').tap();
    await page.waitForSelector('.fh-ex-controls-body[data-open="true"]');
    await page.locator('.fh-ex-mode[data-mode="trend"]').tap();
    await page.waitForSelector('.fh-ex-map[data-mode="trend"]', { timeout: 120_000 });
    await page.locator('.fh-ex-controls-toggle').tap();
    await page.waitForFunction(() => document.querySelector('.fh-ex-controls-body')?.getAttribute('data-open') === 'false');
    await page.waitForSelector('.fh-ex-sheet[data-size="peek"]', { timeout: 10_000 });
    await page.waitForTimeout(1000);
    await shot(`trend_chip_${w}x${h}`);
    const chip = await box('.fh-ex-trend-chip');
    assert(chip && chip.w > 0 && chip.r <= w && chip.x >= 0 && chip.b <= h, `chip ${JSON.stringify(chip)}`);
    const pill = await box('.fh-ex-controls-toggle');
    assert(chip.y >= pill.b, 'the chip meets the top bar');
    const text = await page.locator('.fh-ex-trend-chip').innerText();
    assert(/2001 to 2025/.test(text), `chip "${text}"`);
    const hit = await reachable('.fh-ex-trend-chip button');
    assert(hit.every((x) => x.ok), 'the chip\'s button is covered');
    const bh = await page.evaluate(() => document.querySelector('.fh-ex-trend-chip button').getBoundingClientRect().height);
    assert(bh >= 44, `the chip's button is ${bh} px tall`);
    await page.locator('.fh-ex-trend-chip button').tap();
    await page.waitForSelector('.fh-ex-map[data-mode="count"]', { timeout: 60_000 });
    return `chip "${text.replace(/\s+/g, ' ')}" ${Math.round(chip.w)} px; month on one line`;
  });
}

await check('390x844 touch: a tap on the timeline\'s year row brushes (44 px zone) and keeps the month', async () => {
  await newPage({ width: 390, height: 844, touch: true });
  await open(AREA);
  if ((await page.locator('.fh-ex-sheet').getAttribute('data-size')) === 'peek') { await page.locator('.fh-ex-grip').tap(); await page.waitForTimeout(1200); }
  const scrub = page.locator('.fh-ex-scrub');
  await scrub.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const b = await scrub.boundingBox();
  assert(b.height >= 88, `the touch chart is ${b.height} px tall`);
  const ym = await page.locator('.fh-ex-map').getAttribute('data-ym');
  await page.touchscreen.tap(b.x + b.width * 0.6, b.y + 48);   // on the year labels, above the strip
  await page.waitForFunction(() => document.querySelector('.fh-ex-scrub')?.dataset.zoomed === 'true', null, { timeout: 5000 });
  assert((await page.locator('.fh-ex-map').getAttribute('data-ym')) === ym, 'the tap also picked a month');
  return `zoomed to ${await scrub.getAttribute('data-win')}`;
});

// ------------------------------------------------------------------------------------------------- package A (QA round 1)

for (const [w, h] of [[390, 844], [320, 640]]) {
  await check(`${w}x${h} touch: one finger moves the map, the world shows Africa and South America above the sheet, the legend leaves the sheet alone`, async () => {
    await newPage({ width: w, height: h, touch: true });
    await page.goto(url('#/'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.fh-ex[data-series-ready="true"] .fh-ex-map[data-ready="true"]', { timeout: 150_000 });
    await page.waitForTimeout(2500);
    const geo = await page.evaluate(() => {
      const m = window.__fhMap.map();
      const sheet = document.querySelector('.fh-ex-sheet').getBoundingClientRect().top;
      const bar = document.querySelector('.fh-ex-controls-bar').getBoundingClientRect().bottom;
      const top = document.querySelector('.fh-ex-stage').getBoundingClientRect().top;
      const at = (lon, lat) => { const p = m.project([lon, lat]); return { x: p.x, y: p.y + top }; };
      return { sheet, bar, w: innerWidth, places: { capeTown: at(18.4, -33.9), tunis: at(10.2, 36.8), recife: at(-34.9, -8.1), saoPaulo: at(-46.6, -23.5), dakar: at(-17.4, 14.7) },
        size: document.querySelector('.fh-ex-sheet').dataset.size };
    });
    for (const [name, p] of Object.entries(geo.places)) {
      assert(p.x >= 0 && p.x <= geo.w && p.y > geo.bar - 30 && p.y < geo.sheet, `${name} at ${Math.round(p.x)}, ${Math.round(p.y)} (sheet top ${Math.round(geo.sheet)})`);
    }
    if (h <= 700) assert(geo.size === 'peek', `a ${h} px window opens the sheet at ${geo.size}`);
    // the + and − buttons are for mice: Locate stays
    const zoomButtons = await page.locator('.fh-ex-zoom button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    assert(zoomButtons.length === 1 && zoomButtons[0] === 'Show the whole area', `zoom rail ${zoomButtons}`);
    // the legend chip prints the range of its colours
    assert(/^1 to 2,000/.test((await page.locator('.fh-ex-legend-chip').innerText()).trim()), 'no range on the chip');
    // one finger drag
    const c0 = await page.evaluate(() => { const c = window.__fhMap.map().getCenter(); return [c.lng, c.lat]; });
    const cdp = await page.context().newCDPSession(page);
    const sx = Math.round(w / 2), sy = Math.round((geo.bar + geo.sheet) / 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx + i * 8, y: sy + i * 2 }] }); await page.waitForTimeout(30); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(800);
    const c1 = await page.evaluate(() => { const c = window.__fhMap.map().getCenter(); return [c.lng, c.lat]; });
    assert(Math.abs(c1[0] - c0[0]) > 5, `the map did not move: ${c0} -> ${c1}`);
    const twoFinger = await page.evaluate(() => !!document.querySelector('.maplibregl-cooperative-gesture-screen.maplibregl-show'));
    assert(!twoFinger, 'the two finger message showed');
    // the legend opens above the sheet and leaves its size; a tab answers right after it closes
    if ((await page.locator('.fh-ex-sheet').getAttribute('data-size')) === 'peek') await page.locator('.fh-ex-grip').tap();
    await page.waitForTimeout(500);
    const before = await page.locator('.fh-ex-sheet').getAttribute('data-size');
    await page.locator('.fh-ex-legend-chip').tap();
    await page.waitForSelector('.fh-ex-legend-card[data-open="true"]');
    await page.waitForTimeout(400);
    const during = await page.locator('.fh-ex-sheet').getAttribute('data-size');
    const gap = await page.evaluate(() => document.querySelector('.fh-ex-sheet').getBoundingClientRect().top - document.querySelector('.fh-ex-legend-card').getBoundingClientRect().bottom);
    await page.locator('.fh-ex-legend-chip').tap();
    await page.waitForSelector('.fh-ex-legend-card[data-open="false"]');
    const after = await page.locator('.fh-ex-sheet').getAttribute('data-size');
    assert(before === during && during === after, `sheet ${before} -> ${during} -> ${after}`);
    assert(gap >= 0, `the legend covers the sheet by ${-gap} px`);
    await page.getByRole('tab', { name: 'Calendar', exact: true }).tap();
    await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Calendar', null, { timeout: 3000 });
    return `camera moved ${(c1[0] - c0[0]).toFixed(1)}°; sheet ${before}; legend ${Math.round(gap)} px above it`;
  });
}

for (const theme of ['dark', 'light']) {
  await check(`${theme}: every map label is in English, on one line, with a halo of at least 1.5 px`, async () => {
    if (page) await page.context().close();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await context.addInitScript((t) => { try { localStorage.setItem('fh_theme', t); localStorage.setItem('fh_welcome_seen', '1'); } catch { /* ignore */ } }, theme);
    page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${m.type()}: ${m.text()}`.slice(0, 300)); });
    await page.goto(url('#/'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.fh-ex[data-series-ready="true"] .fh-ex-map[data-ready="true"]', { timeout: 150_000 });
    await page.waitForFunction(() => window.__fhMap.map().isStyleLoaded() && window.__fhMap.map().queryRenderedFeatures().some((f) => f.layer.type === 'symbol'), null, { timeout: 60_000 });
    const r = await page.evaluate(() => {
      const m = window.__fhMap.map();
      const style = m.getStyle();
      const bad = [], thin = [];
      for (const l of style.layers) {
        if (l.type !== 'symbol' || !l.layout?.['text-field']) continue;
        const tf = JSON.stringify(l.layout['text-field']);
        if (/name/.test(tf) && !/"ref"/.test(tf) && (/nonlatin/.test(tf) || !/name:en/.test(tf))) bad.push(l.id);
        const halo = l.paint?.['text-halo-width'];
        if (/^(place|label)_/.test(l.id) && !(typeof halo === 'number' && halo >= 1.5)) thin.push(`${l.id}:${halo}`);
      }
      const shown = m.queryRenderedFeatures().filter((f) => f.layer.type === 'symbol')
        .map((f) => f.properties['name:en'] ?? f.properties.name_en ?? f.properties['name:latin'] ?? f.properties.name).filter(Boolean);
      const script = shown.filter((x) => /[\u0370-\u03ff\u0400-\u04ff\u0590-\u06ff\u0900-\u0dff\u0e00-\u0eff\u1100-\u11ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(x));
      return { bad, thin, shown: shown.length, script };
    });
    assert(r.bad.length === 0, `layers not in English: ${r.bad.join(', ')}`);
    assert(r.thin.length === 0, `thin halos: ${r.thin.join(', ')}`);
    assert(r.script.length === 0, `labels in another script: ${r.script.slice(0, 5)}`);
    return `${r.shown} labels on screen, all in Latin letters`;
  });
}

await check('city zoom: the month\'s hotspots as dots within 10 s, a hover card, new dots when panning, none zoomed out; FIRMS at the same place', async () => {
  await newPage({ width: 1440, height: 900 });
  await page.goto(url('#/?area=circle:-2.2096,113.91,50&month=202610'), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.fh-ex[data-series-ready="true"] .fh-ex-map[data-ready="true"]', { timeout: 150_000 });
  await page.waitForFunction(() => !window.__fhMap.map().isMoving(), null, { timeout: 30_000 });
  const t0 = Date.now();
  await page.evaluate(() => { window.__fhMap.map().jumpTo({ center: [113.91, -2.21], zoom: 9 }); });
  await page.waitForSelector('.fh-ex-map[data-dots]', { timeout: 10_000 });
  const secs = (Date.now() - t0) / 1000;
  const n = Number(await page.locator('.fh-ex-map').getAttribute('data-dots'));
  assert(n > 100, `${n} dots`);
  assert(/Dots: each counted hotspot \(raw, not harmonized\)/.test(await page.locator('.fh-ex-dots-chip').innerText()), 'no dots chip');
  const d = await page.evaluate(() => { const x = window.__fhMap.dotOnScreen(); const r = document.querySelector('.fh-ex-map-canvas').getBoundingClientRect(); return x ? { x: x.x + r.left, y: x.y + r.top } : null; });
  assert(d, 'no dot on screen');
  await page.mouse.move(d.x, d.y);
  // (picking among 50,000 dots takes a software renderer several seconds; a graphics card does it at once)
  await page.waitForSelector('.fh-ex-tip[data-dot]', { timeout: 20_000 });
  const fields = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.fh-ex-tip[data-dot] dd')].map((x) => [x.dataset.k, x.textContent])));
  assert(/^2026-10-\d\d$/.test(fields.date) && /^\d\d:\d\d$/.test(fields.time) && fields.satellite && /MW$/.test(fields.frp), JSON.stringify(fields));
  const box0 = await page.locator('.fh-ex-map').getAttribute('data-dots-box');
  await page.evaluate(() => { window.__fhMap.map().jumpTo({ center: [111.7, -2.6], zoom: 9 }); });
  await page.waitForFunction((b) => { const v = document.querySelector('.fh-ex-map')?.dataset.dotsBox; return v && v !== b; }, box0, { timeout: 15_000 });
  await page.locator('.fh-ex-legend-chip').click();
  assert(await page.locator('.fh-ex-legend-dots').count() === 1, 'no dots line in the legend');
  const firms = await page.locator('.fh-ex-legend-card .fh-ex-firms').getAttribute('href');
  // (at the middle of the map the panels leave free, at the same zoom: FIRMS has its own zoom steps, one more)
  const fm = /^https:\/\/firms\.modaps\.eosdis\.nasa\.gov\/map\/#d:7days;@(-?\d+\.\d\d),(-?\d+\.\d\d),10\.0z$/.exec(firms ?? '');
  assert(fm && Math.abs(Number(fm[1]) - 111.7) < 1.5 && Math.abs(Number(fm[2]) + 2.6) < 1, firms);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__fhMap.map().jumpTo({ center: [113.9, -2.2], zoom: 6 }); });
  await page.waitForFunction(() => !document.querySelector('.fh-ex-map')?.dataset.dots, null, { timeout: 20_000 });
  return `${n} dots in ${secs.toFixed(1)} s; hover ${JSON.stringify(fields)}; ${firms}`;
});

await check('no console errors', async () => {
  assert(problems.length === 0, problems.slice(0, 5).join(' | '));
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; failed: ${failed.map((f) => f.name).join('; ')}` : ''}.`);
process.exit(failed.length ? 1 : 0);
