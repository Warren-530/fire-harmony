// Browser checks of the Explorer's loose ends (package explorer-polish) in a real (headless) Chrome:
//  - one trend verdict on every page: Brazil, Indonesia, Kalimantan Tengah and Antarctica read the same word in the
//    Explorer (strip and details), on the Dashboard and in Rankings, as the rule of web/places.json gives it; hexagon
//    846890bffffffff (q = 0.052) reads the same in the panel and in the trend map's tooltip; Brazil's card never shows
//    a word that changes while its test loads, nor does a card while the series of a new place loads (a continent, the
//    world, a circle); the yearly chart's title never says more than the card (Kuwait, Tartus, Brazil, Indonesia, a
//    hexagon the trend map calls clear), and the Dashboard gives the reason a place is not tested (the open ocean);
//  - the place search on phones (390 and 320) and a tablet (820): the list has a way out (Close), never covers the
//    drawing tools, a tool closes it, and its last place can be scrolled into the screen at 320 by 640; the chips have
//    tooltips and no title attributes;
//  - the map's attribution button takes a 44 px press on a phone and on a touch tablet while it stays 24 px to the
//    eye, and once open none of its links is under the press; the timeline's month ("SEP 2015") keeps to one line at
//    320 px;
//  - a link that opens the trend view reads web/trend_l3.json at boot, once.
// Usage: node scripts/test_polish.mjs [baseUrl]     (THEME=light for the light theme, ONLY=<pattern> for some checks;
// the dev server must run)
// Prints one line per check and exits with 1 when any check fails. Screenshots of failures go to /tmp/fh_test_polish.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.env.TEST_OUT ?? '/tmp/fh_test_polish';
fs.mkdirSync(outDir, { recursive: true });
const THEME = process.env.THEME === 'light' ? 'light' : 'dark';
const DATA = process.env.FIRE_DATA_DIR ?? path.join(os.homedir(), 'nasa_work/data/products/v1.0');
const placeRows = JSON.parse(fs.readFileSync(path.join(DATA, 'web/places.json'), 'utf8')).rows;

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let context = null, page = null;
const problems = [];
async function open(size, { theme = THEME, touch = false, init = null } = {}) {
  if (context) await context.close();
  const [width, height] = size;
  context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch && width <= 430 });
  await context.addInitScript((t) => { try { localStorage.setItem('fh_theme', t); localStorage.setItem('fh_welcome_seen', '1'); } catch { /* ignore */ } }, theme);
  if (init) await context.addInitScript(init);
  page = await context.newPage();
  // (the outside basemap server failing for a moment is not an error of the app)
  page.on('console', (m) => {
    if (m.type() === 'error' && !/tiles\.openfreemap\.org/.test(`${m.text()} ${m.location().url}`)) problems.push(`${m.type()}: ${m.text()}`.slice(0, 300));
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('tiles.openfreemap.org')) problems.push(`http ${r.status()}: ${r.url()}`); });
}

const results = [];
let n = 0;
async function check(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;   // ONLY=<pattern>: just some checks
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
const goto = (hash) => page.goto(new URL(hash, base).toString(), { waitUntil: 'domcontentloaded' });
async function explorer(hash) {
  await goto(hash);
  await page.waitForSelector(READY, { timeout: 180_000 });
  await page.waitForFunction(() => { const v = document.querySelector('.fh-ex-kpis')?.dataset.verdict; return v && v !== 'pending'; }, null, { timeout: 60_000 });
}
const tap = (loc) => loc.tap();

/** The word of the Rankings rule (rankings/model.ts trendClassOf, worded as dashboard/verdict.ts rowVerdict). */
function ruleWord(r) {
  if (r.trend_pct_per_decade === null || r.trend === null || r.trend === 'not enough data') return 'Too few years';
  const dir = r.trend_pct_per_decade > 0 ? 'Rising' : 'Falling';
  if (r.kind === 'world' || r.kind === 'continent') {
    if ((r.mean_per_year ?? 0) < 1000) return 'Not tested';
    return r.trend_p !== null && r.trend_p < 0.05 ? dir : 'Not clear';
  }
  if (!r.trend_tested) return 'Not tested';
  return r.trend_q !== null && r.trend_q <= 0.05 ? dir : 'Not clear';
}
const WORD_CLASS = { Rising: 'rising', Falling: 'falling', 'Not clear': 'unclear', 'Not tested': 'untested', 'Too few years': 'none' };

// ------------------------------------------------------------------------------------------------ one verdict

await check('one verdict: Brazil, Indonesia, Kalimantan Tengah and Antarctica read the same in the Explorer, the Dashboard and Rankings', async () => {
  await open([1440, 900]);
  const out = [];
  for (const [kind, id] of [['country', 'BRA'], ['country', 'IDN'], ['state', 'IDN-1931'], ['continent', 'Antarctica']]) {
    const row = placeRows.find((r) => r.kind === kind && r.id === id);
    const want = ruleWord(row);
    await explorer(`#/?area=${kind}:${id}`);
    const ex = await page.evaluate(() => ({
      verdict: document.querySelector('.fh-ex-kpis')?.dataset.verdict,
      strip: document.querySelector('.fh-ex-kpis [data-kpi="trend"] .fh-ex-kpi-pill')?.textContent?.trim(),
      details: document.querySelector('.fh-ex-facts [data-verdict] .fh-ex-fact-word')?.textContent?.trim(),
      arrow: document.querySelector('.fh-ex-kpis [data-kpi="trend"] .ui-delta')?.getAttribute('data-dir') ?? null,
    }));
    assert(ex.strip === want && ex.details === want && ex.verdict === WORD_CLASS[want], `${row.name}: Explorer strip "${ex.strip}", details "${ex.details}", class ${ex.verdict}; want "${want}"`);
    // (the name as the app shows it: English where the place list has an English name, "Central Kalimantan")
    const shown = (await page.locator('.fh-ex-name').innerText()).trim();
    const own = kind === 'state' ? shown.slice(0, shown.lastIndexOf(', ')) : shown;
    const q = own.toLowerCase();
    await goto(`#/dashboard?area=${kind}:${id}`);
    await page.waitForSelector('.db-g[data-key="trend"] .ui-delta', { timeout: 90_000 });
    await page.waitForFunction(() => !document.querySelector('.db-glance.is-busy'), null, { timeout: 90_000 });
    await page.waitForTimeout(500);
    const db = (await page.locator('.db-g[data-key="trend"] .ui-delta').first().innerText()).trim();
    assert(db === want, `${row.name}: Dashboard "${db}", want "${want}"`);
    await goto(`#/rankings?kind=${kind}&q=${encodeURIComponent(q)}`);
    await page.waitForSelector('.rk-body .rk-row', { timeout: 60_000 });
    await page.waitForTimeout(400);
    const rk = await page.evaluate((nm) => {
      const r = [...document.querySelectorAll('.rk-body > .rk-row')].find((x) => x.querySelector('.rk-name-text')?.textContent === nm);
      const t = r?.querySelector('.rk-trend');
      return t ? [...t.classList].find((c) => c.startsWith('rk-trend-') && c !== 'rk-trend-top')?.slice(9) ?? null : r ? 'none' : 'missing';
    }, own);
    assert(rk === WORD_CLASS[want], `${row.name}: Rankings class ${rk}, want ${WORD_CLASS[want]}`);
    out.push(`${row.name}: ${want}`);
  }
  return out.join('; ');
});

await check('one verdict: hexagon 846890bffffffff (q = 0.052) is "Not clear" in the panel and in the trend map', async () => {
  await open([1440, 900]);
  await explorer('#/?area=hex:846890bffffffff&mode=trend');
  const panel = await page.evaluate(() => ({
    verdict: document.querySelector('.fh-ex-kpis')?.dataset.verdict,
    word: document.querySelector('.fh-ex-facts [data-verdict] .fh-ex-fact-word')?.textContent?.trim(),
    facts: document.querySelector('.fh-ex-facts [data-verdict]')?.textContent ?? '',
  }));
  assert(panel.verdict === 'unclear' && panel.word === 'Not clear' && /q = 0\.052\)/.test(panel.facts), `panel ${JSON.stringify(panel)}`);
  // the map at level 4 (the hexagon's level): hover its centre and read the tooltip
  await page.waitForFunction(() => document.querySelector('.fh-ex-map')?.dataset.level === '4', null, { timeout: 120_000 });
  await page.waitForFunction(() => !document.querySelector('.fh-ex-map-status'), null, { timeout: 180_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const box = await page.locator('.fh-ex-map').boundingBox();
  const pt = await page.evaluate(() => { const m = window.__fhMap.map(); const p = m.project([113.39, -1.69]); return { x: p.x, y: p.y }; });
  await page.mouse.move(box.x + pt.x - 20, box.y + pt.y - 10);
  await page.mouse.move(box.x + pt.x, box.y + pt.y, { steps: 4 });
  await page.waitForSelector('.fh-ex-tip .fh-ex-tip-verdict', { timeout: 90_000 });
  const tip = await page.evaluate(() => ({
    tone: document.querySelector('.fh-ex-tip-verdict')?.dataset.tone, text: document.querySelector('.fh-ex-tip-verdict')?.textContent?.trim(),
    q: document.querySelector('.fh-ex-tip dd[data-k="q"]')?.textContent,
  }));
  assert(tip.tone === 'flat' && tip.text === 'Not clear' && tip.q === '0.05228', `tooltip ${JSON.stringify(tip)}`);
  return `panel "${panel.word}", map "${tip.text}" (q ${tip.q})`;
});

await check('one verdict: while Brazil\'s test loads, its card never shows a word that then changes', async () => {
  // record every word the trend cell shows from the first paint on
  await open([1280, 800], {
    init: () => {
      window.__trendWords = [];
      new MutationObserver(() => {
        const el = document.querySelector('.fh-ex-kpis [data-kpi="trend"] .fh-ex-kpi-pill');
        const w = el?.textContent?.trim() ?? '';
        if (w && window.__trendWords[window.__trendWords.length - 1] !== w) window.__trendWords.push(w);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    },
  });
  await explorer('#/?area=country:BRA');
  await page.waitForTimeout(800);
  const seen = await page.evaluate(() => window.__trendWords);
  assert(seen.length >= 1 && seen.every((w) => w === 'Not clear'), `words seen: ${seen.join(' → ')}`);
  return `seen: ${seen.join(' → ')}`;
});

await check('one voice: the yearly chart\'s title never says more than the card (not tested, not clear, clear)', async () => {
  await open([1280, 800], { theme: 'light' });
  const out = [];
  for (const [hash, cls, re] of [
    ['area=country:KWT', 'untested', /^Yearly fire in Kuwait: not tested, as most of it is on bare land$/],
    ['area=state:SYR-135', 'untested', /^Yearly fire in Tartus, Syria: too little to test a trend$/],
    // (a trend in the details has one decimal, as the brief and the chart title write it)
    ['area=country:BRA', 'unclear', /may be falling, by about 21\.\d% per decade, but not clearly among all countries$/],
    ['area=country:IDN', 'falling', /^Yearly fire in Indonesia is falling, by about 5\d\.\d% per decade$/],
    // a hexagon the trend map calls "Rising, a clear trend": no caution here either
    ['area=hex:836a94fffffffff', 'rising', /is rising, by about \d+\.\d% per decade$/],
  ]) {
    await explorer(`#/?${hash}`);
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({
      cls: document.querySelector('.fh-ex-kpis')?.dataset.verdict,
      title: [...document.querySelectorAll('.ui-figure-title')].map((e) => e.textContent).find((x) => /Yearly fire|Fire over the years/.test(x)) ?? '',
      caution: !!document.querySelector('.fh-ex-kpis [data-caution]'), notes: document.querySelector('.fh-ex-facts [data-verdict]')?.textContent ?? '',
    }));
    assert(r.cls === cls && re.test(r.title), `${hash}: card ${r.cls}, title "${r.title}"`);
    assert(!r.caution && !/with care/.test(r.notes), `${hash}: a caution (${r.notes})`);
    out.push(`${hash.slice(5)}: ${r.cls}`);
  }
  // the Dashboard says why the open ocean is not tested
  await goto('#/dashboard?area=continent:Seven%20seas%20(open%20ocean)');
  await page.waitForSelector('.db-g[data-key="trend"] .ui-delta', { timeout: 90_000 });
  await page.waitForFunction(() => !document.querySelector('.db-glance.is-busy'), null, { timeout: 90_000 });
  await page.waitForTimeout(400);
  const db = await page.locator('.db-g[data-key="trend"]').first().innerText();
  assert(/Not tested/.test(db) && /Too little fire to test: under 1,000 hotspots a year/.test(db), `Dashboard: ${db.replace(/\s+/g, ' ')}`);
  return out.join('; ');
});

await check('one verdict: while the series of a new place loads, the card shows no word from the place before', async () => {
  await open([1440, 900], {
    init: () => {
      window.__seen = [];
      new MutationObserver(() => {
        const name = document.querySelector('.fh-ex-name')?.textContent ?? '';
        const k = document.querySelector('.fh-ex-kpis');
        const w = `${name}|${k?.dataset.verdict ?? ''}|${k?.querySelector('[data-kpi="trend"] .fh-ex-kpi-pill')?.textContent?.trim() ?? ''}`;
        if (window.__seen[window.__seen.length - 1] !== w) window.__seen.push(w);
      }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    },
  });
  const out = [];
  for (const [a, b, name] of [['country:BRA', 'continent:Africa', 'Africa'], ['continent:Europe', 'continent:Asia', 'Asia'],
    ['country:IDN', 'world:WORLD', 'World'], ['country:BRA', 'circle:-2.2096,113.9157,8', '8 km around']]) {
    await explorer(`#/?area=${a}`);
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.__seen = []; });
    await page.evaluate((h) => { window.location.hash = h; }, `#/?area=${b}`);
    await page.waitForFunction((nm) => document.querySelector('.fh-ex[data-series-ready="true"]') && document.querySelector('.fh-ex-name')?.textContent?.startsWith(nm)
      && !['pending', undefined].includes(document.querySelector('.fh-ex-kpis')?.dataset.verdict), name, { timeout: 120_000 });
    await page.waitForTimeout(1500);
    const seen = await page.evaluate(() => window.__seen);
    // under the new name: only the shimmer (no word), then one word that stays
    const words = [...new Set(seen.filter((x) => x.startsWith(name)).map((x) => x.split('|')[2]).filter(Boolean))];
    assert(words.length === 1, `${a} to ${b}: ${seen.join(' → ')}`);
    out.push(`${name}: ${words[0]}`);
  }
  return out.join('; ');
});

// ------------------------------------------------------------------------------------------------ the place search

for (const [w, h] of [[390, 844], [320, 640]]) {
  await check(`${w}x${h} phone: the list of places has a way out, never covers the tools, and a tool closes it`, async () => {
    await open([w, h], { touch: true });
    await explorer('#/?area=country:BRA');
    await tap(page.locator('.fh-ex-sheet .fh-ex-area-tools .ui-btn-icon').first());
    await page.waitForSelector('.fh-picker .fh-suggest:not([hidden])', { timeout: 10_000 });
    await page.waitForTimeout(400);
    const covered = () => page.evaluate(() => [...document.querySelectorAll('.fh-picker-tools .ui-chip')].flatMap((c) => {
      const b = c.getBoundingClientRect();
      const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return c.contains(top) ? [] : [`${c.textContent} under ${top?.className}`];
    }));
    let bad = await covered();
    assert(!bad.length, `covered on focus: ${bad.join(', ')}`);
    // the way out: Close hides the list and the keyboard
    const close = page.locator('.fh-suggest-close');
    const cb = await close.boundingBox();
    assert(cb && cb.height >= 44, `Close is ${cb?.height} px tall`);
    await tap(close);
    await page.waitForFunction(() => document.querySelector('.fh-picker .fh-suggest')?.hidden === true, null, { timeout: 5000 });
    assert(await page.evaluate(() => document.activeElement?.classList.contains('fh-search-input')) === false, 'the box keeps the focus');
    // typing opens it again; the tools stay clear; a tool closes it
    await tap(page.locator('.fh-search-input'));
    await page.keyboard.type('Riau', { delay: 30 });
    await page.waitForSelector('.fh-picker .fh-suggest:not([hidden]) .fh-option', { timeout: 30_000 });
    bad = await covered();
    assert(!bad.length, `covered while typing: ${bad.join(', ')}`);
    await tap(page.locator('.fh-picker-tools .ui-chip', { hasText: 'Rectangle' }));
    // (on a phone drawing takes the map: the sheet goes down and the search closes with its list)
    await page.waitForFunction(() => !document.querySelector('.fh-picker .fh-suggest:not([hidden])'), null, { timeout: 5000 });
    const drawing = await page.locator('.fh-ex-sheet').getAttribute('data-size');
    await page.keyboard.press('Escape');
    return `tools clear on focus and while typing; Close ${Math.round(cb.height)} px; Rectangle closed the list (sheet ${drawing})`;
  });
}

await check('320x640 phone: with 12 places listed, the list ends on the screen and its last place can be scrolled into view', async () => {
  await open([320, 640], { touch: true, theme: 'light' });
  await explorer('#/?area=country:BRA&month=201509');
  await tap(page.locator('.fh-ex-sheet .fh-ex-area-tools .ui-btn-icon').first());
  await page.waitForSelector('.fh-picker .fh-suggest:not([hidden])', { timeout: 10_000 });
  await page.keyboard.type('Pala', { delay: 40 });
  await page.waitForSelector('.fh-picker .fh-suggest:not([hidden]) .fh-option', { timeout: 30_000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => { const ul = document.querySelector('.fh-picker .fh-listbox'); ul.scrollTop = ul.scrollHeight; });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const box = document.querySelector('.fh-picker .fh-suggest').getBoundingClientRect();
    const opts = [...document.querySelectorAll('.fh-picker .fh-option')];
    const last = opts[opts.length - 1].getBoundingClientRect();
    return { n: opts.length, top: box.top, bottom: box.bottom, last: last.bottom, H: window.innerHeight };
  });
  assert(r.n >= 8 && r.bottom <= r.H && r.last <= r.H, `box ${Math.round(r.top)} to ${Math.round(r.bottom)}, last place ends at ${Math.round(r.last)}, screen ${r.H}`);
  await page.keyboard.press('Escape');
  return `${r.n} places; box ${Math.round(r.top)} to ${Math.round(r.bottom)}, last ends at ${Math.round(r.last)} of ${r.H}`;
});

await check('820x1180 tablet: Close and a tool close the list; every chip has a tooltip and no title', async () => {
  await open([820, 1180], { touch: true });
  await explorer('#/?area=country:BRA');
  const titles = await page.$$eval('.fh-picker [title]', (els) => els.map((e) => e.outerHTML.slice(0, 80)));
  assert(!titles.length, `title attributes: ${titles.join(' | ')}`);
  await tap(page.locator('.fh-search-input'));
  await page.waitForSelector('.fh-picker .fh-suggest:not([hidden])', { timeout: 10_000 });
  await tap(page.locator('.fh-suggest-close'));
  await page.waitForFunction(() => document.querySelector('.fh-picker .fh-suggest')?.hidden === true, null, { timeout: 5000 });
  // on a touch screen the tools sit above the box, so the list (here while typing) never hides them
  await tap(page.locator('.fh-search-input'));
  await page.keyboard.type('Kal', { delay: 30 });
  await page.waitForSelector('.fh-picker .fh-suggest:not([hidden]) .fh-option', { timeout: 30_000 });
  const hidden = await page.evaluate(() => [...document.querySelectorAll('.fh-picker-tools .ui-chip')].filter((c) => {
    const b = c.getBoundingClientRect();
    return !c.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
  }).map((c) => c.textContent));
  assert(!hidden.length, `the list hides ${hidden.join(', ')}`);
  await tap(page.locator('.fh-picker-tools .ui-chip', { hasText: 'Circle' }));
  await page.waitForSelector('.fh-circle-form', { timeout: 5000 });
  assert(await page.evaluate(() => document.querySelector('.fh-picker .fh-suggest')?.hidden) === true, 'the list stays open over the circle form');
  await page.keyboard.press('Escape');
  // the tooltips (laptop: on hover)
  await open([1280, 800]);
  await explorer('#/?area=country:BRA');
  const tips = [];
  for (const [chip, want] of [['Rectangle', 'Draw rectangle'], ['Polygon', 'Draw polygon'], ['Circle', 'A circle from latitude'], ['World', 'Back to the whole world']]) {
    await page.locator('.fh-picker .ui-chip', { hasText: chip }).hover();
    await page.waitForSelector('.ui-tooltip[data-open]', { timeout: 5000 });
    const text = await page.locator('.ui-tooltip[data-open]').innerText();
    assert(text.includes(want), `${chip}: tooltip "${text}"`);
    tips.push(`${chip}: ${text}`);
    await page.mouse.move(700, 450);
    await page.waitForTimeout(150);
  }
  return tips.join('; ');
});

// ------------------------------------------------------------------------------------------------ map details

for (const [w, h] of [[390, 844], [320, 640], [820, 1180], [1024, 768]]) {
  await check(`${w}x${h}: the attribution takes a 44 px press but looks 24 px, open it covers none of its links; the month keeps to one line`, async () => {
    await open([w, h], { touch: true, theme: w === 320 ? 'light' : THEME });
    await explorer('#/?area=country:BRA&month=201509');
    const r = await page.evaluate(() => {
      const b = document.querySelector('.fh-ex .maplibregl-ctrl-attrib-button');
      const box = b.getBoundingClientRect();
      const hit = (x, y) => { const el = document.elementFromPoint(x, y); return el === b || b.contains(el); };
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      // how far a press still reaches the button, across and up and down from its centre (the zoom rail above keeps
      // its own presses; the right side is the screen's edge)
      const span = (dx, dy) => { let k = 0; while (k < 40 && hit(cx + dx * (k + 1), cy + dy * (k + 1))) k += 1; return k; };
      const reach = { left: span(-1, 0), up: span(0, -1), down: span(0, 1), across: Math.min(span(-1, 0), 22) + Math.min(span(1, 0), 22) + 1,
        tall: span(0, -1) + span(0, 1) + 1 };
      const code = document.querySelector('.fh-ex-month-code');
      return { w: box.width, h: box.height, reach, code: code?.textContent, lines: code ? code.getClientRects().length : 0, codeH: code?.getBoundingClientRect().height };
    });
    assert(Math.round(r.w) === 24 && Math.round(r.h) === 24, `the button is ${r.w} by ${r.h}`);
    assert(r.reach.left >= 21 && r.reach.tall >= 44, `the press is too small: ${JSON.stringify(r.reach)}`);
    assert(r.code === 'SEP 2015' && r.lines === 1 && r.codeH < 26, `month "${r.code}" on ${r.lines} lines, ${r.codeH} px`);
    // open: every link takes its own presses, and the zoom rail stays clear of the box
    await tap(page.locator('.fh-ex .maplibregl-ctrl-attrib-button'));
    await page.waitForSelector('.fh-ex .maplibregl-compact-show', { timeout: 5000 });
    await page.waitForTimeout(300);
    const o = await page.evaluate(() => {
      const links = [...document.querySelectorAll('.fh-ex .maplibregl-ctrl-attrib-inner a')].flatMap((a) => [...a.getClientRects()].map((q) => {
        let covered = 0;
        for (let x = Math.ceil(q.left) + 1; x < Math.floor(q.right) - 1; x++) if (!a.contains(document.elementFromPoint(x, q.top + q.height / 2))) covered++;
        return { text: a.textContent.trim(), covered };
      }));
      const box = document.querySelector('.fh-ex .maplibregl-ctrl-attrib').getBoundingClientRect();
      const zoom = document.querySelector('.fh-ex-zoom').getBoundingClientRect();
      return { links, gap: box.top - zoom.bottom };
    });
    const bad = o.links.filter((l) => l.covered > 0);
    assert(o.links.length >= 2 && !bad.length, `covered links: ${JSON.stringify(bad)}`);
    assert(o.gap >= 0, `the zoom rail covers the open attribution by ${-o.gap} px`);
    await tap(page.locator('.fh-ex .maplibregl-ctrl-attrib-button'));
    return `button ${r.w}x${r.h}, press reach ${JSON.stringify(r.reach)}, "${r.code}" ${Math.round(r.codeH)} px; open: ${o.links.length} links clear, ${Math.round(o.gap)} px to the rail`;
  });
}

// ------------------------------------------------------------------------------------------------ package A (QA round 1)

for (const [w, h] of [[1440, 900], [1280, 800]]) {
  await check(`${w}x${h}: the timeline leaves room after the last month, so its spike shows beside the playhead, drawn behind the line`, async () => {
    await open([w, h]);
    await explorer('#/?area=state:IDN-1931&month=202610');
    const r = await page.evaluate(() => {
      const svg = document.querySelector('.fh-ex-scrub-svg');
      const right = svg.getBoundingClientRect().right;
      const head = svg.querySelector('.fh-ex-scrub-head circle').getBoundingClientRect();
      const line = svg.querySelector('.fh-ex-scrub-line');
      const heads = [...svg.querySelectorAll('.fh-ex-scrub-head')];
      const order = line ? heads.map((g) => (g.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING ? 'before' : 'after')) : [];
      return { room: right - (head.left + head.width / 2), order, width: svg.getBoundingClientRect().width };
    });
    // (three months of room: at least 2.5 months of the plot's width)
    const pxMonth = (r.width - 20) / (311 + 3);
    assert(r.room >= 2.5 * pxMonth + 10, `the playhead is ${r.room.toFixed(1)} px from the right end (${(2.5 * pxMonth + 10).toFixed(1)} needed)`);
    assert(r.order[0] === 'before' && r.order[r.order.length - 1] === 'after', `playhead order ${r.order}`);
    return `${r.room.toFixed(0)} px after the last month`;
  });
}

await check('1440x900: "Link copied" sits above the timeline', async () => {
  await open([1440, 900]);
  await explorer('#/?area=state:IDN-1931&month=202610');
  await page.getByRole('button', { name: 'Copy a link to this view' }).click();
  await page.waitForSelector('.ui-toast', { timeout: 10_000 });
  const r = await page.evaluate(() => ({ toast: document.querySelector('.ui-toast').getBoundingClientRect().bottom,
    dock: document.querySelector('.fh-ex-dock').getBoundingClientRect().top }));
  assert(r.toast <= r.dock, `the toast ends at ${r.toast}, the timeline starts at ${r.dock}`);
  return `toast ${Math.round(r.dock - r.toast)} px above the timeline`;
});

for (const [w, h] of [[820, 1180], [1024, 768]]) {
  await check(`${w}x${h} touch: the speeds are 44 by 44 px; the zoom buttons give way to the finger`, async () => {
    await open([w, h], { touch: true });
    await explorer('#/?area=state:IDN-1931&month=202610');
    const r = await page.evaluate(() => {
      const opts = [...document.querySelectorAll('.fh-ex-speed .ui-segmented-option')].filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; });
      const cycle = document.querySelector('.fh-ex-speed-cycle');
      const c = cycle && cycle.getBoundingClientRect().width > 0 ? cycle.getBoundingClientRect() : null;
      return { opts, cycle: c ? [Math.round(c.width), Math.round(c.height)] : null, zoom: document.querySelectorAll('.fh-ex-zoom button').length };
    });
    const sizes = r.opts.length ? r.opts : r.cycle ? [r.cycle] : [];
    assert(sizes.length && sizes.every(([a, b]) => a >= 44 && b >= 44), `speeds ${JSON.stringify(sizes)}`);
    assert(r.zoom === 1, `${r.zoom} buttons in the zoom rail`);
    return `speeds ${JSON.stringify(sizes)}`;
  });
}

await check('1440x900: Tab onto the map shows a focus ring and the keys of the map', async () => {
  await open([1440, 900]);
  await explorer('#/?area=state:IDN-1931&month=202610');
  await page.locator('.maplibregl-canvas').focus();
  // (a focus from the keyboard: Shift+Tab away and Tab back)
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const r = await page.evaluate(() => ({
    focused: document.activeElement?.classList.contains('maplibregl-canvas') ?? false,
    ring: getComputedStyle(document.querySelector('.fh-ex-map'), '::after').boxShadow,
    hint: document.querySelector('.fh-ex-map-keys')?.textContent ?? null,
  }));
  assert(r.focused, 'the map canvas is not focused');
  assert(/inset/.test(r.ring), `no ring: ${r.ring}`);
  assert(r.hint === 'Arrow keys move the map, + and − zoom.', `hint ${r.hint}`);
  return `ring ${r.ring}`;
});

// ------------------------------------------------------------------------------------------------ prefetch

await check('a link to the trend view reads web/trend_l3.json at boot, once, before the Explorer\'s code', async () => {
  await open([1280, 800]);
  const seen = [];
  page.on('request', (q) => { const u = q.url(); if (/trend_l3\.json|pages\/Explorer\.tsx|places\.json/.test(u)) seen.push(u.replace(/^.*\//, '')); });
  await explorer('#/?area=country:IDN&mode=trend');
  const trend = seen.filter((s) => s.startsWith('trend_l3.json')).length;
  const at = seen.findIndex((s) => s.startsWith('trend_l3.json')), code = seen.findIndex((s) => s.startsWith('Explorer.tsx'));
  assert(trend === 1, `trend_l3.json read ${trend} times: ${seen.join(', ')}`);
  assert(code < 0 || at < code, `read after the Explorer's code: ${seen.join(', ')}`);
  assert(seen.some((s) => s.startsWith('places.json')), `no places.json for a country link: ${seen.join(', ')}`);
  return seen.join(', ');
});

await browser.close();
const bad = results.filter((r) => !r.ok).length;
if (problems.length) console.log(`console and network problems (${problems.length}): ${[...new Set(problems)].slice(0, 6).join(' | ')}`);
console.log(`${results.length - bad} of ${results.length} checks passed`);
process.exit(bad ? 1 : 0);
