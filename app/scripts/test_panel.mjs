// End-to-end check of the Explorer's area panel in a real (headless) Chrome: the strip of numbers and the tabs above
// the fold, the trend card's rules, the Download menu, compare (and its link), the crosshair preview, the link notes,
// the numbers while a place loads, and on phones the bottom sheet (touch, mouse and keyboard).
// Usage: node scripts/test_panel.mjs [baseUrl]      (default http://127.0.0.1:5173/; the dev server must run)
// Prints one line per check and exits with 1 when any check fails. Screenshots of failures go to /tmp/fh_test_panel.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.env.TEST_OUT ?? '/tmp/fh_test_panel';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let context = null, page = null;
const problems = [];
async function open(size, theme = 'dark', touch = false) {
  if (context) await context.close();
  const [width, height] = size;
  context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch && width <= 430, acceptDownloads: true });
  // (the card of a first visit is tested in test_explorer: here it is closed, so the World's panel is as it was)
  await context.addInitScript((t) => { try { localStorage.setItem('fh_theme', t); localStorage.setItem('fh_welcome_seen', '1'); } catch { /* ignore */ } }, theme);
  page = await context.newPage();
  page.on('console', async (m) => {
    if (m.type() !== 'error') return;
    // (an error logged with a format, "%o", is written out with its arguments and where it came from)
    let text = m.text();
    if (/%[osdO]/.test(text)) text += ` ${(await Promise.all(m.args().map((a) => a.jsonValue().catch(() => '?')))).map((v) => String(v).slice(0, 120)).join(' ')}`;
    // (the outside basemap server failing for a moment, as its requests below, is not an error of the app)
    if (/tiles\.openfreemap\.org/.test(`${text} ${m.location().url}`)) return;
    problems.push(`${m.type()}: ${text} @ ${m.location().url.split('/').pop()}:${m.location().lineNumber}`.slice(0, 400));
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('tiles.openfreemap.org')) problems.push(`http ${r.status()}: ${r.url()}`); });
}

const results = [];
let n = 0;
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
// requests a check fails on purpose (a forced HTTP 500), left out of the last check
const expected = [];
async function check(name, fn) {
  if (ONLY && !ONLY.test(name) && !/no console errors/.test(name)) return;
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
const waitReady = (timeout = 150_000) => page.waitForSelector(READY, { timeout });
async function go(hash) {
  const url = new URL(hash, base).toString();
  if (page.url().startsWith(base) && page.url() !== 'about:blank') await page.evaluate((h) => { window.location.hash = h; }, hash);
  else await page.goto(url, { waitUntil: 'domcontentloaded' });
}
async function waitName(text, timeout = 90_000) {
  await page.waitForFunction((t) => document.querySelector('.fh-ex-name')?.textContent?.includes(t), text, { timeout });
  await waitReady();
}
const mapYm = () => page.locator('.fh-ex-map').getAttribute('data-ym').then(Number);
const trendCard = () => page.locator('.fh-ex-kpis [data-kpi="trend"]').innerText();
const facts = () => page.locator('.fh-ex-facts').innerText();
async function openTab(name) {
  await page.getByRole('tab', { name, exact: true }).click();
  await page.waitForFunction((nm) => [...document.querySelectorAll('[role="tab"]')]
    .some((el) => el.textContent === nm && el.getAttribute('aria-selected') === 'true'), name);
}
// The phone sheet to a given height, by pressing its handle (it cycles small, half, full).
async function sheetTo(size) {
  for (let k = 0; k < 4; k++) {
    if (await page.locator('.fh-ex-sheet').getAttribute('data-size') === size) break;
    await page.locator('.fh-ex-grip').tap();
    await page.waitForTimeout(450);
  }
  await page.waitForFunction((s) => document.querySelector('.fh-ex-sheet')?.dataset.size === s, size);
  await page.waitForTimeout(450);
}
const toastSeen = (text, timeout = 15_000) => page.waitForFunction((t) => [...document.querySelectorAll('.ui-toast')]
  .some((el) => el.textContent?.includes(t)), text, { timeout, polling: 100 });

// ------------------------------------------------------------------------------------------------- laptop

for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768], [1366, 657], [1280, 720]]) {
  await check(`${w}x${h}: the tabs start in the top half of the panel, none is cut, each tab opens in view`, async () => {
    await open([w, h]);
    await go('#/?area=state:IDN-1931&month=201509');
    await waitName('Kalimantan');
    const m = await page.evaluate(() => {
      const p = document.querySelector('.fh-ex-panel').getBoundingClientRect();
      const s = document.querySelector('.fh-ex-panel-scroll').getBoundingClientRect();
      const bar = document.querySelector('.fh-ex-tabbar').getBoundingClientRect();
      const strip = document.querySelector('.fh-ex-tabs');
      return { frac: (bar.top - p.top) / p.height, content: s.bottom - bar.bottom, sw: strip.scrollWidth, cw: strip.clientWidth };
    });
    assert(m.frac <= 0.55, `tabs at ${(m.frac * 100).toFixed(0)}% of the panel`);
    assert(m.content >= 240, `only ${m.content.toFixed(0)} px of tab content shows`);
    assert(m.sw <= m.cw + 1, `tab strip ${m.sw}/${m.cw}: a tab is cut`);
    assert(await page.locator('.fh-ex-kpis .ui-stat').count() === 3, 'three numbers');
    for (const tab of ['Calendar', 'Period', 'Why', 'Outlook', 'Overview']) {
      await openTab(tab);
      await page.waitForTimeout(450);
      const ok = await page.evaluate(() => {
        const s = document.querySelector('.fh-ex-panel-scroll').getBoundingClientRect();
        const first = document.querySelector('.fh-ex-tabpanel > *')?.getBoundingClientRect();
        return !!first && first.top >= s.top - 1 && first.top < s.bottom - 40;
      });
      assert(ok, `the first part of ${tab} is not in view`);
    }
    return `tabs at ${(m.frac * 100).toFixed(0)}%, ${m.content.toFixed(0)} px of content, strip ${m.sw}/${m.cw}`;
  });
}

await check('1280x720: a tab picked under the stuck tabs keeps them at the top of the panel', async () => {
  await openTab('Overview');
  await page.locator('.fh-ex-panel-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(300);
  const gaps = [];
  for (const tab of ['Calendar', 'Period', 'Overview']) {
    await openTab(tab);
    await page.waitForTimeout(900);
    gaps.push(await page.evaluate(() => Math.round(document.querySelector('.fh-ex-tabbar').getBoundingClientRect().top
      - document.querySelector('.fh-ex-panel-scroll').getBoundingClientRect().top)));
  }
  assert(gaps.every((g) => g <= 2), `the tabs sit ${gaps.join(', ')} px below the top of the panel's scroller`);
  return `tabs at ${gaps.join(', ')} px`;
});

await check('the strip opens its tabs, and the hovered year of the chart previews on the map', async () => {
  await page.locator('.fh-ex-kpis [data-kpi="month"]').click();
  await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Calendar');
  await page.locator('.fh-ex-kpis [data-kpi="ytd"]').click();
  await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Period');
  await page.locator('.fh-ex-kpis [data-kpi="trend"]').click();
  await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Overview');
  // the content slides in from the side of the tab picked
  const from = await page.locator('.fh-ex-tabpanel').getAttribute('data-from');
  assert(from === 'left', `Overview after Period slides from ${from}`);
  const ym0 = await mapYm();
  const svg = page.locator('.fh-ex-tabpanel .ui-figure-plot svg').first();
  await svg.scrollIntoViewIfNeeded();
  const b = await svg.boundingBox();
  let seen = null;
  for (const fx of [0.3, 0.5, 0.7]) {
    await page.mouse.move(b.x + b.width * fx, b.y + b.height * 0.5);
    try {
      await page.waitForFunction((y0) => Number(document.querySelector('.fh-ex-map')?.dataset.ym) !== y0, ym0, { timeout: 4000 });
      seen = await mapYm();
      break;
    } catch { /* try another year */ }
  }
  assert(seen !== null && seen % 100 === ym0 % 100, `the map shows ${seen} while ${ym0} is chosen`);
  await page.mouse.move(5, 5);
  await page.waitForFunction((y0) => Number(document.querySelector('.fh-ex-map')?.dataset.ym) === y0, ym0, { timeout: 10_000 });
  return `chosen ${ym0}, previewed ${seen}, back to ${ym0}`;
});

await check('the trend card says only what the data supports', async () => {
  await open([1440, 900]);
  const out = [];
  const cases = [
    ['state:IDN-1931', 'Kalimantan', 'full', /Falling/, /Still clear when all [\d,]+ states/],
    ['country:IDN', 'Indonesia', 'full', /Falling/, /Still clear when all [\d,]+ countries/],
    // one verdict on every page (explorer-polish): a fall that does not hold among all the countries reads "Not clear",
    // as on the Dashboard and in Rankings; a named place under 1,000 hotspots a year is "Not tested"
    ['country:BRA', 'Brazil', 'full', /Not clear/, /Not clear once all [\d,]+ countries/],
    ['state:PHL-2542', 'Abra', 'caution', /Not tested/, /Too little fire to test: under 1,000 hotspots a year/],
    ['state:CHE-162', 'Aargau', 'little', /Not tested/, /Too little fire to test: under 1,000 hotspots a year/],
    ['circle:-2.2096,113.9157,8', 'km around', 'caution', /Falling/, /read this trend with care/],
    ['circle:-2.2096,113.9157,50', 'km around', null, /./, /./],
    ['hex:836891fffffffff', 'Hexagon near', 'full', /Falling/, /Still clear when all [\d,]+ hexagons of this size/],
    // (a hexagon tested with all the hexagons of its size is read in full, as on the trend map: no caution)
    ['hex:846890bffffffff', 'Hexagon near', 'full', /Not clear/, /Not clear once all [\d,]+ hexagons of this size/],
  ];
  for (const [area, name, reading, card, fact] of cases) {
    await go(`#/?area=${area}`);
    await waitName(name);
    await page.waitForFunction((f) => new RegExp(f).test(document.querySelector('.fh-ex-facts')?.textContent ?? ''), fact.source, { timeout: 30_000 })
      .catch(() => undefined);
    const got = await page.locator('.fh-ex-kpis').getAttribute('data-trend');
    const text = await trendCard();
    const words = await facts();
    if (reading) assert(got === reading, `${name}: reading ${got}, want ${reading}`);
    assert(card.test(text), `${name}: card "${text.replace(/\n/g, ' / ')}"`);
    assert(fact.test(words), `${name}: details lack ${fact}`);
    const arrow = await page.locator('.fh-ex-kpis [data-kpi="trend"] .ui-delta').count();
    if (got === 'little') assert(arrow === 0, `${name}: an arrow on a trend that cannot be read`);
    const verdict = await page.locator('.fh-ex-kpis').getAttribute('data-verdict');
    if (verdict !== 'rising' && verdict !== 'falling') {
      const arrows = await page.locator('.fh-ex-kpis [data-kpi="trend"] :is(.ui-delta-up, .ui-delta-down)').count();
      assert(arrows === 0, `${name}: an arrow on a ${verdict} trend`);
    }
    if (area.startsWith('circle')) assert(!/tested together/.test(words), 'a circle is not in a family');
    if (area === 'country:BRA') {
      // the brief and the chart title do not call a fall clear that does not hold among all the countries
      const brief = await page.locator('.fh-ex-brief').innerText();
      const title = await page.locator('.fh-ex-chart .ui-figure-title').first().innerText();
      assert(!/clearly fell/.test(brief) && /not clear/.test(brief), `brief: ${brief}`);
      assert(/may be falling/.test(title) && /not clearly among all countries/.test(title), `title: ${title}`);
    }
    if (area === 'hex:846890bffffffff') assert(/q = 0\.052\)\./.test(words), 'q 0.0523 is not written as 0.052');
    out.push(`${name}: ${got}`);
  }
  return out.join('; ');
});

await check('1024x768 and 320x640: every part of the trend number fits its cell, the caution by the number', async () => {
  const out = [];
  for (const [w, h, touch] of [[1024, 768, false], [320, 640, true]]) {
    await open([w, h], 'light', touch);
    for (const [area, name] of [['circle:-2.2096,113.9157,8', 'km around'], ['state:PHL-2542', 'Abra'], ['country:BRA', 'Brazil'], ['country:USA', 'United States']]) {
      await go(`#/?area=${area}`);
      await waitName(name);
      await page.waitForTimeout(1200);
      if (touch) await sheetTo('half');
      const r = await page.evaluate(() => [...document.querySelectorAll('.fh-ex-kpis .fh-ex-kpi')].flatMap((cell) => {
        const c = cell.getBoundingClientRect();
        return [...cell.querySelectorAll('*')].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > c.right + 0.5 || b.left < c.left - 0.5); })
          .map((el) => `${cell.dataset.kpi}: ${el.className?.baseVal ?? el.className}`);
      }));
      assert(r.length === 0, `${w} ${name}: cut ${r.join(', ')}`);
      if (name === 'km around') {
        // a drawn area with little fire and a clear fall: the caution sits by the number
        assert(await page.locator('.fh-ex-kpis [data-kpi="trend"] [data-caution]').count() === 1, `${w} circle: no caution`);
        const tip = await page.locator('.fh-ex-kpis [data-kpi="trend"]').getAttribute('aria-label');
        assert(/care\./.test(tip ?? ''), `${w} circle: ${tip}`);
      }
    }
    out.push(`${w} px`);
  }
  await open([1440, 900]);   // the next checks run on a laptop
  return out.join(', ');
});

await check('the Download menu: keyboard, every item, the hotspots of a period', async () => {
  await go('#/?area=state:IDN-492');
  await waitName('Riau');
  const button = page.locator('.fh-ex-actions [aria-haspopup="menu"]');
  await button.focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForSelector('[role="menu"] [role="menuitem"]');
  const items = await page.locator('[role="menuitem"]').allInnerTexts();
  assert(items.length === 5, `${items.length} items`);
  const first = await page.evaluate(() => document.activeElement?.getAttribute('role'));
  assert(first === 'menuitem', `focus on ${first}`);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="menu"]', { state: 'detached' });
  assert(await page.evaluate(() => document.activeElement?.getAttribute('aria-haspopup')) === 'menu', 'focus back on the button');
  // the hotspots of a period: the Period tab opens at its downloads, the Hotspots button in focus
  await button.click();
  await page.getByRole('menuitem', { name: /^Hotspots of a period/ }).click();
  await page.waitForFunction(() => document.activeElement?.closest('.pp-download-row') !== null, null, { timeout: 30_000 });
  const tab = await page.locator('[role="tab"][aria-selected="true"]').innerText();
  assert(tab === 'Period', `tab ${tab}`);
  // the CSV from the menu
  await button.click();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('menuitem', { name: /^Monthly record/ }).click()]);
  assert(/riau/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await toastSeen('CSV saved');
  return `${items.length} items: ${items.map((s) => s.split('\n')[0]).join(', ')}`;
});

await check('the Download menu hangs from its button; a press on the map closes it and picks nothing there', async () => {
  const button = page.locator('.fh-ex-actions [aria-haspopup="menu"]');
  await button.click();
  await page.waitForSelector('[role="menu"] [role="menuitem"]');
  await page.waitForTimeout(400);
  const mb = await page.locator('[role="menu"]').boundingBox(), bb = await button.boundingBox();
  assert(Math.abs(mb.x - bb.x) <= 1.5, `menu at x ${mb.x.toFixed(0)}, its button at ${bb.x.toFixed(0)}`);
  const name0 = await page.locator('.fh-ex-name').innerText();
  await page.mouse.click(1080, 360);
  await page.waitForSelector('[role="menu"]', { state: 'detached' });
  await page.waitForTimeout(2000);
  const name1 = await page.locator('.fh-ex-name').innerText();
  assert(name1 === name0, `the press picked ${name1}`);
  return `menu x ${mb.x.toFixed(0)} = button x ${bb.x.toFixed(0)}; still ${name1}`;
});

await check('compare: pin, see together, counts or percent, link and reload, remove', async () => {
  await go('#/?area=country:IDN');
  await waitName('Indonesia');
  await page.getByRole('button', { name: /^Compare/ }).click();
  await page.waitForFunction(() => window.location.hash.includes('compare=country:IDN'));
  await go('#/?area=country:BRA&compare=country:IDN');
  await waitName('Brazil');
  await openTab('Overview');
  await page.waitForSelector('.fh-ex-compare .ui-figure-plot svg', { timeout: 60_000 });
  const keys = await page.locator('.fh-ex-cmp-key').allInnerTexts();
  assert(keys.length === 2 && keys.join('|').includes('Indonesia') && keys.join('|').includes('Brazil'), keys.join('|'));
  await page.getByRole('radio', { name: '% of its mean' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.fh-ex-compare .ui-figure-plot svg text')].some((t) => /%$/.test(t.textContent ?? '')));
  // pin a third place, then reload: the pins come back from the link
  await page.getByRole('button', { name: /^Compare/ }).click();
  await page.waitForFunction(() => window.location.hash.includes('compare=country:IDN,country:BRA'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitName('Brazil');
  await page.waitForSelector('.fh-ex-pin', { timeout: 30_000 });
  const pins = await page.locator('.fh-ex-pin-name').allInnerTexts();
  assert(pins.join('|') === 'Indonesia', `pins after reload: ${pins.join('|')}`);
  assert(await page.getByRole('button', { name: /^Compare/ }).getAttribute('aria-pressed') === 'true', 'Brazil shows as pinned');
  await page.getByRole('button', { name: 'Remove Indonesia' }).click();
  await page.waitForFunction(() => window.location.hash.includes('compare=country:BRA') && !window.location.hash.includes('IDN'));
  await page.getByRole('button', { name: /^Compare/ }).click();
  await page.waitForFunction(() => !window.location.hash.includes('compare='));
  assert(await page.locator('.fh-ex-compare').count() === 0, 'the compare chart stays');
  return `keys ${keys.join(', ')}; after reload ${pins.join(', ')}`;
});

await check('compare: the pins stay while you go Back and Forward', async () => {
  await go('#/?area=country:IDN');
  await waitName('Indonesia');
  await page.getByRole('button', { name: /^Compare/ }).click();
  await page.waitForFunction(() => window.location.hash.includes('compare=country:IDN'));
  await go('#/?area=country:BRA');
  await waitName('Brazil');
  await page.getByRole('button', { name: /^Compare/ }).click();
  await page.waitForFunction(() => window.location.hash.includes('compare=country:IDN,country:BRA'));
  await go('#/?area=state:IDN-1931');
  await waitName('Kalimantan');
  await page.goBack();
  await waitName('Brazil');
  await page.goBack();
  await waitName('Indonesia');
  await page.waitForTimeout(800);
  const pins = await page.locator('.fh-ex-pin-name').allInnerTexts();
  const hash = await page.evaluate(() => window.location.hash);
  assert(hash.includes('compare=country:IDN,country:BRA'), `after Back twice: ${hash}`);
  assert(pins.join('|') === 'Brazil', `pins shown with Indonesia: ${pins.join('|')}`);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.waitForFunction(() => !window.location.hash.includes('compare='));
  return `${hash}`;
});

await check('the link notes say what really happened', async () => {
  await go('#/?area=hex:836581fffffffff');
  await waitName('Hexagon near');
  const before = await page.locator('.fh-ex-name').innerText();
  await go('#/?area=polygon:1,1;2,2');
  await page.waitForSelector('.fh-ex-note');
  const shape = await page.locator('.fh-ex-note').innerText();
  assert(/shape we could not read, so the view stays/.test(shape), shape);
  assert(await page.locator('.fh-ex-name').innerText() === before, 'the view changed');
  await go('#/?area=state:IDN-1931&month=202812');
  await waitName('Kalimantan');
  const month = await page.locator('.fh-ex-note').innerText();
  assert(/month outside the record \(November 2000 to October 2026\), so we show the nearest month/.test(month), month);
  await go('#/?area=state:IDN-1931&month=201513');
  await page.waitForFunction(() => /month we could not read/.test(document.querySelector('.fh-ex-note')?.textContent ?? ''));
  await go('#/?area=state:NOWHERE-1');
  await waitName('World');
  const place = await page.locator('.fh-ex-note').innerText();
  assert(/could not find, so we show the world/.test(place), place);
  await go('#/?area=state:IDN-1931&month=199901');
  await waitName('Kalimantan');
  await page.waitForFunction(() => /month outside the record/.test(document.querySelector('.fh-ex-note')?.textContent ?? ''));
  await go('#/?area=country:BRA&compare=country:IDN,country:USA,country:AUS,country:CAN');
  await waitName('Brazil');
  await page.waitForFunction(() => /more than three places, so only the first three are pinned/.test(document.querySelector('.fh-ex-note')?.textContent ?? ''));
  const extra = await page.locator('.fh-ex-note').innerText();
  assert(!/could not be read/.test(extra), extra);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.waitForFunction(() => !window.location.hash.includes('compare='));
  return `${shape} | ${month} | ${place} | ${extra}`;
});

await check('while a place loads, the numbers never show a value outside the old and the new', async () => {
  await page.mouse.move(5, 5);   // off the yearly chart (its hovered year would preview another month)
  await go('#/?area=hex:836581fffffffff&month=202610');
  await waitName('Hexagon near');
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const w = window;
    w.__seen = [];
    const read = () => document.querySelector('.fh-ex-kpis [data-kpi="month"] .fh-ex-kpi-value')?.textContent ?? '';
    w.__timer = window.setInterval(() => w.__seen.push(read()), 15);
    window.location.hash = '#/?area=state:IDN-1931&month=201509';
  });
  await waitName('Kalimantan');
  await page.waitForTimeout(1500);
  // (the timer runs when the page is free: under the software GPU it may take few samples, so wait for the end value)
  await page.waitForFunction(() => /79,000/.test(document.querySelector('.fh-ex-kpis [data-kpi="month"] .fh-ex-kpi-value')?.textContent ?? ''), null, { timeout: 30_000 });
  const seen = await page.evaluate(() => { window.clearInterval(window.__timer); return window.__seen; });
  seen.push(await page.locator('.fh-ex-kpis [data-kpi="month"] .fh-ex-kpi-value').innerText());
  const nums = seen.map((s) => Number(s.replace(/[^\d.-]/g, '')) * (/million/.test(s) ? 1e6 : 1)).filter((v) => Number.isFinite(v));
  const lo = Math.min(nums[0], nums[nums.length - 1]), hi = Math.max(nums[0], nums[nums.length - 1]);
  const bad = nums.filter((v) => v < lo - 0.5 || v > hi + 0.5 || v < 0);
  assert(bad.length === 0, `values outside ${lo}..${hi}: ${bad.slice(0, 5).join(', ')}`);
  return `${nums.length} samples from ${nums[0]} to ${nums[nums.length - 1]}`;
});

// ------------------------------------------------------------------------------------------------- phones

await check('390x844: the panel is a bottom sheet over the map; the page does not scroll', async () => {
  await open([390, 844], 'dark', true);
  await go('#/?area=state:IDN-1931&month=201509');
  await waitName('Kalimantan');
  await page.waitForTimeout(2500);   // the camera flies to the place
  const m = await page.evaluate(() => {
    const s = document.querySelector('.fh-ex-sheet').getBoundingClientRect();
    const header = document.querySelector('.fh-header').getBoundingClientRect();
    return { size: document.querySelector('.fh-ex-sheet').dataset.size, top: s.top, headerBottom: header.bottom, vh: innerHeight,
      sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth };
  });
  assert(m.size === 'half', `sheet ${m.size}`);
  const inHalf = await page.evaluate(() => {
    const bottom = document.querySelector('.fh-ex-sheet').getBoundingClientRect().bottom;
    return ['.fh-ex-kpis', '.fh-ex-sheet .fh-ex-dock', '.fh-ex-sheet .fh-ex-actions', '.fh-ex-tabbar']
      .filter((q) => document.querySelector(q).getBoundingClientRect().bottom > bottom + 1);
  });
  assert(inHalf.length === 0, `cut by the half sheet: ${inHalf.join(', ')}`);
  const mapShare = (m.top - m.headerBottom) / m.vh;
  assert(mapShare >= 0.4, `the map shows on ${(mapShare * 100).toFixed(0)}% of the screen`);
  assert(m.sh <= m.vh + 1 && m.sw <= 391, `page ${m.sw}x${m.sh}`);
  // the place sits above the sheet: its box projected on the map ends above the sheet's top
  const bottom = await page.evaluate(() => {
    const map = window.__fhMap?.map();
    if (!map) return null;
    const pts = [[110.7, -3.6], [115.8, -3.6], [110.7, 0.8], [115.8, 0.8]].map((p) => map.project(p));
    return Math.max(...pts.map((p) => p.y)) + document.querySelector('.fh-ex-stage').getBoundingClientRect().top;
  });
  assert(bottom !== null && bottom <= m.top + 24, `the place reaches ${bottom?.toFixed(0)} px, the sheet starts at ${m.top.toFixed(0)}`);
  return `map ${(mapShare * 100).toFixed(0)}% of the screen; place ends ${bottom.toFixed(0)}, sheet at ${m.top.toFixed(0)}`;
});

await check('390x844: the handle cycles the heights by tap and by keyboard; small is inert below its top', async () => {
  const size = () => page.locator('.fh-ex-sheet').getAttribute('data-size');
  const grip = page.locator('.fh-ex-grip');
  await grip.tap();
  await page.waitForFunction(() => document.querySelector('.fh-ex-sheet')?.dataset.size === 'full');
  await grip.tap();
  await page.waitForFunction(() => document.querySelector('.fh-ex-sheet')?.dataset.size === 'peek');
  const inert = await page.locator('.fh-ex-sheet .fh-ex-panel-scroll').evaluate((el) => el.inert);
  assert(inert, 'the hidden part of a small sheet can take focus');
  const label = await grip.getAttribute('aria-label');
  assert(/Panel size: small/.test(label) && (await grip.getAttribute('aria-expanded')) === 'false', label);
  await grip.focus();
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => document.querySelector('.fh-ex-sheet')?.dataset.size === 'half');
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => document.querySelector('.fh-ex-sheet')?.dataset.size === 'full');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('.fh-ex-sheet')?.dataset.size === 'half');
  return `now ${await size()}`;
});

await check('390x844: a tab tapped in the half sheet brings the tabs to its top, and they stay stuck', async () => {
  await sheetTo('half');
  const gaps = [];
  for (const tab of ['Calendar', 'Why', 'Overview']) {
    await page.getByRole('tab', { name: tab, exact: true }).tap();
    await page.waitForTimeout(1000);
    gaps.push(await page.evaluate(() => Math.round(document.querySelector('.fh-ex-tabbar').getBoundingClientRect().top
      - document.querySelector('.fh-ex-sheet .fh-ex-panel-scroll').getBoundingClientRect().top)));
  }
  assert(gaps.every((g) => g <= 2), `the tabs sit ${gaps.join(', ')} px below the top of the sheet's scroller`);
  return `tabs at ${gaps.join(', ')} px`;
});

await check('390x844: a tap on the place in the small sheet opens it; the full sheet hides the top bar of the map', async () => {
  await sheetTo('peek');
  await page.locator('.fh-ex-sheet .fh-ex-name').tap();
  await page.waitForFunction(() => document.querySelector('.fh-ex-sheet')?.dataset.size === 'half');
  await sheetTo('full');
  const bar = await page.locator('.fh-ex-controls').evaluate((el) => getComputedStyle(el).visibility);
  assert(bar === 'hidden', `the map's top bar is ${bar} behind the full sheet`);
  await sheetTo('half');
  return 'small, half; full hides the top bar';
});

await check('390x844: the place search in the sheet never hides its drawing tools', async () => {
  await page.getByRole('button', { name: 'Find or draw a place' }).tap();
  await page.waitForFunction(() => document.querySelector('.fh-ex-sheet')?.dataset.size === 'full');
  await page.waitForSelector('.fh-ex-sheet .fh-listbox:not([hidden])', { timeout: 15_000 }).catch(() => undefined);
  const r = await page.evaluate(() => {
    const tools = [...document.querySelectorAll('.fh-ex-sheet .fh-picker-tools .ui-chip')];
    return tools.map((b) => { const c = b.getBoundingClientRect(); const hit = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
      return b.contains(hit) ? '' : `${b.textContent} under ${hit?.className}`; }).filter(Boolean);
  });
  assert(r.length === 0, r.join(' | '));
  // a press on the sheet's top closes the list of places
  await page.locator('.fh-ex-sheet .fh-ex-kind').tap();
  await page.waitForFunction(() => document.querySelector('.fh-ex-sheet .fh-listbox')?.hidden !== false, null, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Close the search' }).tap();
  await sheetTo('half');
  return 'tools in view; the list closes';
});

await check('390x844: drag the sheet with a finger and with a mouse; it snaps', async () => {
  const drag = async (dy, kind) => {
    // the sheet ends its glide to the last height first (under the software GPU frames can stall, and a transition
    // only moves on with them: wait until the box has its height)
    await page.waitForFunction(() => {
      const el = document.querySelector('.fh-ex-sheet');
      return !!el && Math.abs(el.getBoundingClientRect().height - parseFloat(el.style.height)) < 1;
    }, null, { timeout: 30_000, polling: 100 });
    await page.waitForTimeout(200);
    const b = await page.locator('.fh-ex-sheet-top').boundingBox();
    const x = b.x + b.width / 2, y = b.y + 30;
    const cdp = kind === 'touch' ? await context.newCDPSession(page) : null;
    if (cdp) {
      const touch = (type, yy) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: yy }] });
      await touch('touchStart', y);
      for (let i = 1; i <= 8; i++) { await touch('touchMove', y + (dy * i) / 8); await page.waitForTimeout(16); }
      await touch('touchEnd', y + dy);
      await cdp.detach();
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) { await page.mouse.move(x, y + (dy * i) / 8); await page.waitForTimeout(16); }
      await page.mouse.up();
    }
    await page.waitForTimeout(600);
    return page.locator('.fh-ex-sheet').getAttribute('data-size');
  };
  const a = await drag(-320, 'touch');
  assert(a === 'full', `a finger up from half gives ${a}`);
  const b = await drag(560, 'mouse');
  assert(b === 'peek', `a mouse down from full gives ${b}`);
  const c = await drag(-120, 'mouse');
  assert(c === 'half', `a short drag up from small gives ${c}`);
  const h = await page.locator('.fh-ex-sheet').evaluate((el) => el.getBoundingClientRect().height);
  return `full, small, half (${h.toFixed(0)} px)`;
});

await check('390x844: every tab in the sheet, nothing sideways, controls at least 44 px', async () => {
  await sheetTo('full');
  const small = [];
  for (const tab of ['Overview', 'Calendar', 'Period', 'Why', 'Outlook']) {
    await page.getByRole('tab', { name: tab, exact: true }).tap();
    await page.waitForTimeout(500);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(sw <= 391, `${tab}: the page is ${sw} px wide`);
    const tiny = await page.evaluate(() => [...document.querySelectorAll('.fh-ex-sheet button, .fh-ex-sheet summary, .fh-ex-sheet label.pp-check')]
      .filter((el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('[inert]') && r.height < 43.5; })
      .map((el) => `${el.className || el.tagName} ${Math.round(el.getBoundingClientRect().height)}`));
    small.push(...tiny.map((s) => `${tab}: ${s}`));
  }
  assert(small.length === 0, small.slice(0, 6).join(' | '));
  return 'five tabs';
});

await check('390x844: the place search opens the sheet full and a pick brings it back', async () => {
  await sheetTo('peek');
  await page.getByRole('button', { name: 'Find or draw a place' }).tap();
  await page.waitForFunction(() => document.querySelector('.fh-ex-sheet')?.dataset.size === 'full');
  const box = page.getByRole('combobox', { name: 'Find a place' });
  await box.fill('Riau');
  await page.getByRole('option', { name: /^Riau/ }).first().tap();
  await waitName('Riau');
  await page.waitForFunction(() => document.querySelector('.fh-ex-sheet')?.dataset.size === 'half');
  return 'search, pick, half';
});

for (const [w, h, theme] of [[320, 640, 'light'], [820, 1180, 'dark']]) {
  await check(`${w}x${h} ${theme}: nothing sideways, words of the numbers never cut in two`, async () => {
    await open([w, h], theme, true);
    await go('#/?area=state:IDN-1931&month=201509');
    await waitName('Kalimantan');
    await page.waitForTimeout(1500);
    if (w <= 768) await sheetTo('full');
    for (const tab of ['Overview', 'Calendar', 'Period']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await page.waitForTimeout(500);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      assert(sw <= w + 1, `${tab}: the page is ${sw} px wide`);
    }
    const broken = await page.evaluate(() => [...document.querySelectorAll('.fh-ex-panel .ui-stat-unit, .fh-ex-panel .fh-ex-kpi-label')]
      .filter((el) => el.getClientRects().length > 1).map((el) => el.textContent));
    assert(broken.length === 0, `cut: ${broken.join(', ')}`);
    await page.screenshot({ path: path.join(outDir, `panel_${w}_${theme}.png`) });
    return `${w} px`;
  });
}

await check('820x1180 touch tablet: every control of the side panel is at least 44 px', async () => {
  await open([820, 1180], 'light', true);
  await go('#/?area=country:BRA&compare=country:IDN');
  await waitName('Brazil');
  await page.waitForSelector('.fh-ex-cmp-key', { timeout: 60_000 });
  const small = [];
  for (const tab of ['Overview', 'Period']) {
    await openTab(tab);
    await page.waitForTimeout(800);
    const tiny = await page.evaluate(() => [...document.querySelectorAll('.fh-ex-panel button, .fh-ex-panel summary, .fh-ex-panel input')]
      .filter((el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        if (!(r.width > 0 && r.height > 0) || s.visibility === 'hidden' || el.closest('[hidden], .sr-only') || el.type === 'checkbox') return false;
        return r.height < 43.5 || (el.classList.contains('ui-btn-icon') && r.width < 43.5); })
      .map((el) => `${(el.getAttribute('aria-label') || el.textContent || el.className).slice(0, 30)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`));
    small.push(...tiny.map((x) => `${tab}: ${x}`));
  }
  assert(small.length === 0, small.slice(0, 8).join(' | '));
  await page.getByRole('button', { name: 'Clear', exact: true }).click().catch(() => undefined);
  return 'Overview with a pinned place, and Period';
});

// ------------------------------------------------------------------------------------------------- package A (QA round 1)

await check('a place that loads never shows the numbers of the place before; a failed load offers Try again', async () => {
  await open([1440, 900]);
  let hold = true, fail = false;
  await page.route('**/web/series/country/AUS.json', async (route) => {
    if (fail) { await route.fulfill({ status: 500, body: 'forced' }); return; }
    const t0 = Date.now();
    while (hold && Date.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 100));
    await route.continue();
  });
  await go('#/');
  await waitReady();
  await go('#/?area=country:AUS');
  await page.waitForFunction(() => document.querySelector('.fh-ex-name')?.textContent?.includes('Australia'), null, { timeout: 30_000 });
  let samples = 0;
  for (let i = 0; i < 8; i++) {
    const s = await page.evaluate(() => ({
      ready: document.querySelector('.fh-ex')?.getAttribute('data-series-ready'),
      brief: document.querySelector('.fh-ex-brief')?.textContent ?? '',
      title: document.querySelector('.fh-ex-chart .ui-figure-title')?.textContent ?? '',
      busy: document.querySelectorAll('.fh-ex-panel [aria-busy="true"]').length,
    }));
    if (s.ready !== 'false') break;
    samples++;
    assert(!/\d/.test(s.brief) && !/\d/.test(s.title), `digits while loading: brief "${s.brief}", title "${s.title}"`);
    assert(s.busy > 0, 'nothing is marked busy while loading');
    await page.waitForTimeout(500);
  }
  assert(samples >= 3, `only ${samples} samples while loading`);
  await waitReady();
  // a forced failure of the same file, in a fresh page (the page above keeps the file it loaded): picked from the World
  await open([1440, 900]);
  let failing = true;
  expected.push('AUS.json');
  await page.route('**/web/series/country/AUS.json', (route) => (failing ? route.fulfill({ status: 500, body: 'forced' }) : route.continue()));
  await go('#/');
  await waitReady();
  await go('#/?area=country:AUS');
  await page.waitForSelector('.fh-ex-fail-box', { timeout: 30_000 });
  const retry = page.getByRole('button', { name: 'Try again' });
  assert(await retry.isVisible(), 'no Try again');
  assert(await page.locator('.fh-ex-brief').count() === 0, 'a brief under the error');
  const during = await page.evaluate(() => document.querySelector('.fh-ex-chart .ui-figure-title')?.textContent ?? '');
  assert(!/\d/.test(during), `a chart title with numbers under the error: ${during}`);
  failing = false;
  await retry.click();
  await waitName('Australia');
  const title = await page.locator('.fh-ex-chart .ui-figure-title').first().innerText();
  assert(/Australia/.test(title), `title after Try again: ${title}`);
  await page.unroute('**/web/series/country/AUS.json');
  return `${samples} samples while loading, none with a number; a forced 500 shows Try again, which loads "${title}"`;
});

await check('the full calendar: 2026 in view, boxes of 24 px from 1024 up, keys and focus, the picture with five ticks', async () => {
  const out = [];
  for (const [w, h, theme] of [[1440, 900, 'dark'], [1024, 768, 'light'], [390, 844, 'dark'], [320, 640, 'light']]) {
    await open([w, h], theme, w < 800);
    await go('#/?area=state:IDN-1931&month=202610&tab=calendar&cal=full');
    await page.waitForSelector('.fh-calf[open] .fh-calf-cell[data-ym="202610"]', { timeout: 150_000 });
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const c = document.querySelector('.fh-calf-cell[data-ym="202610"]').getBoundingClientRect();
      const box = document.querySelector('.fh-calf-gridbox');
      const parts = [...document.querySelectorAll('.fh-calf-head, .fh-calf-tools, .fh-calf-readout, .fh-calf-gridbox, .fh-calf-legend')]
        .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
      let overlap = 0;
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i], b = parts[j];
        overlap += Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      }
      return { cw: c.width, ch: c.height, bottom: c.bottom, right: c.right, vh: innerHeight, vw: innerWidth, scrolls: box.scrollHeight > box.clientHeight + 1,
        ticks: document.querySelectorAll('.fh-calf-legend svg.fh-ex-legend > text.fh-ex-legend-tick').length, overlap,
        sideways: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    assert(m.bottom <= m.vh && m.right <= m.vw && !m.scrolls, `${w}x${h}: October 2026 not in view (${m.bottom}/${m.vh})`);
    if (w >= 1024) assert(m.cw >= 24 && m.ch >= 24, `${w}x${h}: boxes ${m.cw}x${m.ch}`);
    assert(m.overlap < 1, `${w}x${h}: parts of the dialog overlap (${m.overlap} px²)`);
    assert(!m.sideways, `${w}x${h}: sideways scroll`);
    assert(m.ticks === 5, `${w}x${h}: ${m.ticks} legend ticks`);
    out.push(`${w}x${h} ${theme}: ${m.cw.toFixed(0)}x${m.ch.toFixed(0)}`);
    if (w === 1440) {
      // the arrow keys move the focus between boxes, with a ring; Enter shows the month on the map
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowUp');
      const f = await page.evaluate(() => [document.activeElement?.getAttribute('data-ym'), getComputedStyle(document.activeElement).boxShadow]);
      assert(f[0] === '202509' && /rgb/.test(f[1]), `focus ${f[0]} ${f[1]}`);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.location.hash.includes('month=202509'), null, { timeout: 10_000 });
      // the picture, from the dialog
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.locator('.fh-calf-download').click()]);
      assert(/_calendar\.png$/.test(dl.suggestedFilename()), `file ${dl.suggestedFilename()}`);
      // Escape closes it and the link forgets it
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.fh-calf[open]') && !window.location.hash.includes('cal=full'), null, { timeout: 10_000 });
      // the button in the Calendar tab opens it again
      await page.getByRole('button', { name: 'Expand calendar' }).click();
      await page.waitForSelector('.fh-calf[open]', { timeout: 10_000 });
      await page.getByRole('button', { name: 'Close the calendar' }).click();
      await page.waitForFunction(() => !document.querySelector('.fh-calf[open]'), null, { timeout: 10_000 });
    }
  }
  return out.join('; ');
});

await check('the yearly chart shows 2026 so far, with the numbers of the strip; the World and a circle too', async () => {
  await open([1440, 900]);
  const out = [];
  for (const area of ['state:IDN-1931', 'world:WORLD', 'circle:-2.2096,113.91,50']) {
    await go(`#/?area=${area}&month=202610`);
    await page.waitForFunction((a) => window.location.hash.includes(a.split(':')[0] === 'world' ? 'month=202610' : a.split(':')[1].split(',')[0]), area);
    await waitReady();
    await page.waitForSelector('.fh-ex-chart-note', { timeout: 30_000 });
    const note = await page.locator('.fh-ex-chart-note').first().innerText();
    const ytd = await page.locator('.fh-ex-kpis [data-kpi="ytd"] .fh-ex-kpi-value').innerText();
    const pill = await page.locator('.fh-ex-kpis [data-kpi="ytd"] .ui-delta').innerText().catch(() => '');
    const num = ytd.replace(/\s+/g, ' ').trim();
    assert(note.includes(num.replace(' million', ' million')) || note.includes(num.split(' ')[0]), `${area}: note "${note}" against strip "${num}"`);
    const ratio = pill.match(/[\d.]+×/)?.[0]?.replace('×', '');
    if (ratio) assert(note.includes(`${ratio} times`), `${area}: note "${note}" against pill "${pill}"`);
    assert(await page.locator('.fh-ex-chart .fh-ex-key').filter({ hasText: 'so far' }).count() === 1, `${area}: no key for the year so far`);
    out.push(note);
  }
  const brief = await (async () => { await go('#/?area=state:IDN-1931&month=202610'); await waitName('Kalimantan'); return page.locator('.fh-ex-brief').innerText(); })();
  assert(/This year breaks with the trend\./.test(brief), `brief: ${brief}`);
  return out.join(' / ');
});

await check('Chart (PNG) saves the comparison on screen; This place only saves the old picture', async () => {
  await open([1440, 900]);
  await go('#/?area=state:BRA-602&compare=state:BRA-602,state:BRA-592,state:BRA-594');
  await waitName('Mato Grosso');
  await page.waitForFunction(() => document.querySelectorAll('.fh-ex-cmp-key:not([disabled])').length >= 3, null, { timeout: 60_000 });
  const menu = async () => { await page.locator('.fh-ex-actions button[aria-haspopup="menu"]').click(); return (await page.locator('[role="menuitem"]').allInnerTexts()).map((x) => x.split('\n')[0]); };
  const items = await menu();
  assert(items.includes('Chart (PNG)') && items.includes('This place only (PNG)'), `menu ${items}`);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByRole('menuitem', { name: /^Chart \(PNG\)/ }).click()]);
  assert(dl.suggestedFilename() === 'fire_harmony_compare_mato_grosso_amazonas_para_brazil.png', `file ${dl.suggestedFilename()}`);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  const plain = await menu();
  await page.keyboard.press('Escape');
  assert(plain.includes('Chart (PNG)') && !plain.includes('This place only (PNG)'), `menu without pins ${plain}`);
  return `${dl.suggestedFilename()}; without pins: ${plain.join(', ')}`;
});

await check('little fire: hatched modelled months, the note, no rank or season; whole numbers; Central Kalimantan unchanged', async () => {
  await open([1440, 900]);
  const out = [];
  for (const [id, name] of [['MYS-4831', 'Kuala Lumpur'], ['NOR-901', 'Svalbard']]) {
    await go(`#/?area=state:${id}&month=202610`);
    await waitName(name);
    const brief = await page.locator('.fh-ex-brief').innerText();
    const details = await facts();
    assert(/Little fire burns here/.test(await page.locator('.fh-ex-panel').innerText()), `${name}: no note`);
    assert(!/highest|lowest|usually has none|fire season|Fire where none/i.test(brief + details), `${name}: rank or season: ${brief} ${details}`);
    assert(/Too little fire here to judge a normal month/.test(brief), `${name}: brief ${brief}`);
    assert(!/\d\.\d hotspot/.test(brief + details), `${name}: decimals ${brief}`);
    await openTab('Calendar');
    const hatched = await page.locator('.fh-ex-cal-svg [data-modelled]').count();
    assert(hatched > 50, `${name}: ${hatched} hatched months`);
    assert(/Modelled; MODIS saw none/.test(await page.locator('.fh-ex-cal-side .fh-ex-legend').getAttribute('aria-label')), `${name}: no key`);
    await openTab('Overview');
    out.push(`${name}: ${hatched} hatched`);
  }
  await go('#/?area=circle:3.1686,101.698,50&month=202610');
  await waitName('Kuala Lumpur');
  const cell = await page.locator('.fh-ex-kpis [data-kpi="month"] .fh-ex-kpi-value').innerText();
  assert(/about\s*2/.test(cell) && !/2\.4/.test(cell), `KL circle: ${cell}`);
  await go('#/?area=state:IDN-1931&month=202610');
  await waitName('Kalimantan');
  const panel = await page.locator('.fh-ex-panel').innerText();
  assert(!/Little fire burns here/.test(panel) && /3rd highest October/.test(panel), 'Central Kalimantan changed');
  await page.locator('.fh-ex-legend-chip').click();
  const legend = await page.locator('.fh-ex-legend-card .fh-ex-legend').getAttribute('aria-label');
  assert(/: 1,/.test(legend), `map legend ${legend}`);
  await page.keyboard.press('Escape');
  return `${out.join('; ')}; KL circle "${cell.replace(/\s+/g, ' ')}"; map legend ${legend}`;
});

await check('Why: no driver reads "no data yet"; the chip shows the latest month with every driver', async () => {
  await open([1440, 900]);
  await go('#/?area=state:IDN-1931&month=202610&tab=why');
  await waitName('Kalimantan');
  await page.waitForSelector('.fh-ex-dl > div', { timeout: 30_000 });
  const text = await page.locator('.fh-ex-drivers').innerText();
  assert(!/no data yet/i.test(text), `Why: ${text.slice(0, 200)}`);
  assert((text.match(/Fire weather data run to/g) ?? []).length === 1, 'the fire weather note is not said once');
  const chip = page.locator('.fh-ex-drivers-chip');
  assert(await chip.count() === 1, 'no chip');
  const label = await chip.innerText();
  await chip.click();
  await page.waitForFunction(() => !/month=202610/.test(window.location.hash), null, { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelectorAll('.fh-ex-dl > div').length === 5 && !document.querySelector('.fh-ex-dl > div[data-latest]'), null, { timeout: 10_000 });
  return `${label}; then ${await page.locator('.fh-ex-dl > div').count()} rows, all of that month`;
});

await check('Outlook: always the next three months, in plain words; a city circle shows its state', async () => {
  await open([1440, 900]);
  const rows = async () => { await page.waitForSelector('.fh-ex-outlook-item', { timeout: 30_000 }); return page.locator('.fh-ex-outlook-item').allInnerTexts(); };
  await go('#/?area=state:IDN-1931&month=202610&tab=outlook');
  await waitName('Kalimantan');
  const a = await rows();
  assert(a.length === 3 && (await page.locator('.fh-ex-outlook-item[data-chance]').count()) === 1, `Central Kalimantan: ${a}`);
  assert(/^\d+% chance of an above normal November/.test(a[0]) && /In past years: above normal in \d+% of these months/.test(a[0]), a[0]);
  assert(/December 2026: outside the fire season the outlook covers\. Usually about [\d,]+ hotspots\./.test(a[1]), a[1]);
  await go('#/?area=state:IDN-492&month=202610&tab=outlook');
  await waitName('Riau');
  const b = await rows();
  assert(b.length === 3 && /^November 2026: outside/.test(b[0]) && /^December 2026: outside/.test(b[1]) && /^20% chance of an above normal January/.test(b[2]), `Riau: ${b}`);
  await go('#/?area=circle:3.1686,101.698,50&month=202610&tab=outlook');
  await waitName('Kuala Lumpur');
  await page.waitForSelector('.fh-ex-outlook-for', { timeout: 30_000 });
  const label = await page.locator('.fh-ex-outlook-for').innerText();
  assert(label === 'Outlook for Selangor, the state around Kuala Lumpur', label);
  assert(!/Normal chance/.test(await page.locator('body').innerText()), 'Normal chance is still written');
  return `${a[0].split('\n')[0]}; Riau ${b.map((x) => x.split(':')[0].split('\n')[0]).join(' / ')}; ${label}`;
});

await check('one number style: 13.8 for the ratio in every tab, no "1 rows", the Period bar of 2026 labelled', async () => {
  await open([1440, 900]);
  await go('#/?area=state:IDN-1931&month=202610');
  await waitName('Kalimantan');
  await page.mouse.move(1000, 400);
  const seen = [];
  for (const tab of ['Overview', 'Calendar', 'Period', 'Why']) {
    await openTab(tab);
    await page.waitForTimeout(1200);
    const text = await page.locator('.fh-ex-panel').innerText();
    const ratios = [...new Set(text.match(/\b1[34](\.\d)?(?=×| times normal)/g) ?? [])];
    assert(ratios.length && ratios.every((r) => r === '13.8'), `${tab}: ratios ${ratios}`);
    seen.push(`${tab} ${ratios.join('/')}`);
  }
  await go('#/?area=state:IDN-1931&month=202610&tab=period&from=202610&to=202610');
  await page.waitForSelector('.pp-chart-plot svg', { timeout: 30_000 });
  const meta = await page.locator('.pp-download-row .pp-btn-meta').first().innerText();
  assert(meta === 'CSV · 1 row', `button ${meta}`);
  const label = await page.evaluate(() => [...document.querySelectorAll('.pp-chart-plot svg text')].map((x) => x.textContent).filter((x) => x === '2026'));
  assert(label.length === 1, `labels 2026: ${label.length}`);
  return `${seen.join('; ')}; ${meta}`;
});

await check('no console errors or failed requests', async () => {
  const real = problems.filter((p) => !expected.some((e) => p.includes(e)) && !/status of 500/.test(p));
  assert(real.length === 0, real.slice(0, 5).join(' | '));
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; failed: ${failed.map((f) => f.name).join('; ')}` : ''}.`);
process.exit(failed.length ? 1 : 0);
