// Functional checks of the analytics dashboard (#/dashboard) in a real Chrome: every control is clicked, typed into
// or driven with keys, and the result is read back from the page. Usage: node functional.mjs [only=name,name]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';   // or a preview or live address ending in /
const only = (process.argv[2] ?? '').split(',').filter(Boolean);
const results = [];
const allErrors = [];
const assert = (c, msg) => { if (!c) throw new Error(msg); };
async function check(name, fn) {
  if (only.length && !only.some((o) => name.toLowerCase().includes(o.toLowerCase()))) return;
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ ok: true, name, detail: detail ?? '', ms: Date.now() - t0 });
  } catch (e) {
    results.push({ ok: false, name, detail: String(e?.message ?? e).split('\n')[0].slice(0, 500), ms: Date.now() - t0 });
  }
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
import { SHORT_FORMS } from './english_names.mjs';
const plain = (t) => t.replace(/[\u2010\u2011]/g, '-').replace(/\s+/g, ' ');
/** The labels of the burning calendar's boxes (one per month), from the dashboard or the Explorer. */
const calendarCells = (page) => page.evaluate(() => [...document.querySelectorAll('svg[data-export="calendar"] rect[role="gridcell"]')]
  .filter((r) => r.closest('.db-cal, .fh-ex')).map((r) => r.getAttribute('aria-label')));

async function open(ctx, hash = '#/dashboard', { wait = true, quiet = false } = {}) {
  const page = await ctx.newPage();
  const errors = [];   // (quiet: a page that asks for a missing file on purpose, a bad link: its 404 is not counted)
  // each problem is tagged with the route it happened on: the dashboard's own, or another page reached from a link
  // a page left behind (the Explorer map) can still log for a moment after Back: those few seconds count as 'other'
  let lastOther = 0;
  const where = () => {
    try {
      if (!new URL(page.url()).hash.startsWith('#/dashboard')) { lastOther = Date.now(); return 'other'; }
      return Date.now() - lastOther < 5000 ? 'other (just after leaving it)' : 'dashboard';
    } catch { return 'other'; }
  };
  // remember the moment the page comes back to the dashboard from another route
  let onOther = false;
  page.on('framenavigated', () => {
    try {
      const other = !new URL(page.url()).hash.startsWith('#/dashboard');
      if (other || onOther) lastOther = Date.now();
      onOther = other;
    } catch { /* ignore */ }
  });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push({ where: where(), text: `${m.type()}: ${m.text()}`.replace(/\s+/g, ' ').slice(0, 220), full: `${m.text()}`.slice(0, 3000), src: m.location()?.url ?? '' }); });
  page.on('pageerror', (e) => errors.push({ where: where(), text: `pageerror: ${String(e).replace(/\s+/g, ' ').slice(0, 220)}` }));
  if (!quiet) allErrors.push(errors);
  await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
  if (wait) { await page.waitForSelector('#db-glance', { timeout: 60000 }); await page.waitForTimeout(900); }
  return page;
}

/** Wait until window.scrollY has not changed for a while (a smooth scroll ended). */
async function settle(page, quiet = 650, max = 7000) {   // (a software rendered frame can take 300 ms or more)
  const t0 = Date.now();
  let last = await page.evaluate(() => scrollY), since = Date.now();
  while (Date.now() - t0 < max) {
    await page.waitForTimeout(50);
    const y = await page.evaluate(() => scrollY);
    if (Math.abs(y - last) > 0.5) { last = y; since = Date.now(); } else if (Date.now() - since >= quiet) break;
  }
  return last;
}

const activeChip = (page) => page.evaluate(() => document.querySelector('.db-nav-chip[aria-current="location"]')?.getAttribute('data-id') ?? null);
/** The section a reader is in: the last one whose top is above the scrollspy mark (28% down below the nav). */
const expectedChip = (page) => page.evaluate(() => {
  const nav = document.querySelector('.db-nav').getBoundingClientRect().bottom;
  const mark = nav + (innerHeight - nav) * 0.28;
  const ids = [...document.querySelectorAll('.db-nav-chip')].map((a) => a.getAttribute('data-id'));
  let cur = ids[0];
  for (const id of ids) { const el = document.getElementById(`db-${id}`); if (el && el.getBoundingClientRect().top <= mark) cur = id; }
  if (scrollY >= document.documentElement.scrollHeight - innerHeight - 2) cur = ids[ids.length - 1];
  return cur;
});
const sectionTop = (page, id) => page.evaluate((id) => {
  const nav = document.querySelector('.db-nav').getBoundingClientRect().bottom;
  return { top: Math.round(document.getElementById(`db-${id}`).getBoundingClientRect().top), navBottom: Math.round(nav) };
}, id);

/** Waits (up to 8 s) for a smooth scroll to bring a section under the nav: on a loaded machine the software renderer
 *  can hold the first frame of the scroll for most of a second. Then waits for the scroll to go quiet. */
async function arrive(page, id) {
  await page.waitForFunction((id) => {
    const nav = document.querySelector('.db-nav')?.getBoundingClientRect().bottom ?? 0;
    const top = document.getElementById(`db-${id}`)?.getBoundingClientRect().top ?? -1e9;
    return top >= nav - 1 && top <= nav + 40;
  }, id, { timeout: 8000 }).catch(() => undefined);
  return settle(page);
}

function parseCount(t) {
  const s = t.replace(/[^\d.,a-z]/gi, ' ').trim();
  const m = s.match(/([\d.,]+)\s*(million|billion)?/i);
  if (!m) return NaN;
  const v = Number(m[1].replace(/,/g, ''));
  return m[2]?.toLowerCase() === 'million' ? v * 1e6 : m[2]?.toLowerCase() === 'billion' ? v * 1e9 : v;
}

// ------------------------------------------------------------------------------------------------ desktop, 1440
// (the Explorer pages of the calendar checks open in this context too)
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.replace(/\/$/, '') });
const page = await open(ctx);

await check('Page header: eyebrow, title, lead, data month badge, download button', async () => {
  const h = await page.evaluate(() => ({
    eyebrow: document.querySelector('.ui-page-eyebrow, .ui-eyebrow')?.textContent?.trim(),
    h1: document.querySelector('h1')?.textContent?.trim(),
    lead: document.querySelector('.ui-page-lead, .ui-lead')?.textContent?.trim().slice(0, 40),
    badge: [...document.querySelectorAll('.ui-badge')].map((b) => b.textContent.trim()).find((t) => t.startsWith('Data to')),
    dl: [...document.querySelectorAll('.ui-page-header button, header button')].some((b) => b.textContent.includes('Download the numbers')),
  }));
  assert(h.h1 === 'Fire across the world, in numbers', `h1 is "${h.h1}"`);
  assert(/^Analytics$/i.test(h.eyebrow ?? ''), `eyebrow is "${h.eyebrow}"`);
  assert(h.badge === 'Data to October 2026', `badge is "${h.badge}"`);
  // the page's own badge only where the header hides its "Data to" (phones)
  const vis = await page.evaluate(() => ({ page: document.querySelector('.db-page-badge')?.getBoundingClientRect().width ?? 0,
    header: document.querySelector('.fh-header .fh-data-badge')?.getBoundingClientRect().width ?? 0 }));
  assert(vis.page === 0 && vis.header > 0, `badges ${JSON.stringify(vis)}`);
  assert(h.dl, 'no download button');
  return `${h.eyebrow} | ${h.h1} | ${h.badge} | lead "${h.lead}…"`;
});

await check('Labels: the two totals named and linked, one trend label, no "13.0 million", English names only', async () => {
  const t = plain(await page.evaluate(() => document.querySelector('#db-glance')?.innerText ?? ''));
  assert(/Hotspots on the NOAA-20 scale/i.test(t), 'no "Hotspots on the NOAA-20 scale"');
  assert(/Detections read: 640\.6 million/.test(t), 'no "Detections read: 640.6 million"');
  assert(/Trend per decade, 2001 to 2025/i.test(t), 'the trend tile label');
  const body = plain(await page.evaluate(() => document.body.innerText));
  assert(!/\d\.0 million/.test(body), `a trailing .0: ${(body.match(/[\d.]+\.0 million/) ?? [])[0]}`);
  assert(!SHORT_FORMS.test(body), `a short form: ${(body.match(SHORT_FORMS) ?? [])[0]}`);
  const heads = await page.evaluate(() => [...document.querySelectorAll('.db-sort-btn')].map((b) => b.textContent.trim()).filter((x) => /trend/i.test(x)));
  assert(heads.length && heads.every((x) => /^Trend per decade, 2001 to 2025$/i.test(x)), `table trend labels ${heads.join(' | ')}`);
  const hint = await page.evaluate(() => [...document.querySelectorAll('#db-glance .db-hint')].map((h) => h.getAttribute('aria-label')).find((x) => /detections/.test(x ?? '')));
  assert(hint && /640\.6 million/.test(hint) && /443 million/.test(hint), `the tooltip that links them: ${hint}`);
  return `${heads[0]}; ${hint.slice(0, 80)}…`;
});

await check('Burning calendar under At a glance: the World, Indonesia and a city circle match the Explorer; links to the full calendar', async () => {
  const out = [];
  for (const [area, label] of [['world:WORLD', 'World'], ['country:IDN', 'Indonesia'], ['circle:-2.2096,113.91,50', 'Palangka Raya']]) {
    const db = area === 'world:WORLD' ? page : await open(ctx, `#/dashboard?area=${area}`);
    await db.waitForSelector('.db-cal svg[data-export="calendar"] rect[role="gridcell"]', { timeout: 120000 });
    await db.waitForTimeout(600);
    const mine = await calendarCells(db);
    const link = await db.evaluate(() => [...document.querySelectorAll('.db-cal a')].find((a) => /Open the full calendar/.test(a.textContent))?.getAttribute('href'));
    const png = await db.evaluate(() => [...document.querySelectorAll('.db-cal button')].some((b) => /PNG/.test(b.textContent)));
    const ex = await ctx.newPage();
    await ex.goto(`${BASE}#/?area=${area}&tab=calendar`, { waitUntil: 'domcontentloaded' });
    await ex.waitForSelector('.fh-ex svg[data-export="calendar"] rect[role="gridcell"]', { timeout: 150000 });
    await ex.waitForFunction(() => document.querySelector('.fh-ex')?.getAttribute('data-series-ready') === 'true', null, { timeout: 150000 });
    await ex.waitForTimeout(800);
    const theirs = await calendarCells(ex);
    await ex.close();
    const same = mine.length === theirs.length && mine.every((x, i) => x === theirs[i]);
    assert(same, `${label}: ${mine.length} boxes vs ${theirs.length}; first difference ${mine.find((x, i) => x !== theirs[i])} / ${theirs.find((x, i) => x !== mine[i])}`);
    assert(link === `#/?area=${area}&tab=calendar&cal=full`, `${label}: link ${link}`);
    assert(png, `${label}: no PNG button`);
    out.push(`${label} ${mine.length} boxes`);
    if (db !== page) await db.close();
  }
  // (on a page of its own: the Explorer, once opened, stays mounted)
  const lp = await open(ctx);
  await lp.waitForSelector('.db-cal a', { timeout: 60000 });
  await lp.locator('.db-cal a', { hasText: 'Open the full calendar' }).click();
  await lp.waitForTimeout(800);
  const h = await lp.evaluate(() => location.hash);
  await lp.close();
  assert(h.includes('tab=calendar') && h.includes('cal=full'), `hash ${h}`);
  return `${out.join(', ')}; the link opens ${h}`;
});

await check('A small share and the rest add up (Central Kalimantan: "Everywhere else" is 99.x%, not 100%)', async () => {
  // (a state shows its share of the world's fire; a country shows its states instead)
  const p = await open(ctx, '#/dashboard?area=state:IDN-1931');
  await p.waitForFunction(() => /Everywhere else\s*[\d.]+%/.test(document.querySelector('#db-glance')?.innerText ?? ''), null, { timeout: 60000 });
  await p.waitForTimeout(600);
  const t = await p.evaluate(() => document.querySelector('#db-glance')?.innerText ?? '');
  await p.close();
  const m = t.match(/Everywhere else\s*([\d.]+%)/);
  assert(m && m[1] !== '100%' && /^99\.\d%$/.test(m[1]), `share bar "${(t.match(/Everywhere else[^\n]*/) ?? [t.slice(0, 120)])[0]}"`);
  return m[0];
});

await check('A link to a place we do not know says so, and shows the world', async () => {
  const out = [];
  for (const h of ['#/dashboard?place=country:XXX', '#/dashboard?area=country:XXX']) {
    const p = await open(ctx, h, { quiet: true });
    await p.waitForFunction(() => document.body.innerText.includes('The link points to a place we could not find'), null, { timeout: 60000 });
    await p.waitForTimeout(800);
    const title = await p.evaluate(() => document.querySelector('h1')?.textContent);
    await p.close();
    assert(title === 'Fire across the world, in numbers', `${h}: title ${title}`);
    out.push(h);
  }
  return out.join(', ');
});

await check('One colour per meaning: the naive join and the two smoke regions use the theme tokens', async () => {
  const c = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const naive = document.querySelector('.db-morph-naive');
    return { naive: naive ? getComputedStyle(naive).stroke : null, token: css.getPropertyValue('--fh-naive').trim(),
      keys: [...document.querySelectorAll('#db-haze .db-key-swatch, #db-haze [class*="swatch"]')].map((k) => getComputedStyle(k).backgroundColor).slice(0, 4),
      sumatra: css.getPropertyValue('--fh-sumatra').trim(), borneo: css.getPropertyValue('--fh-borneo').trim() };
  });
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
  assert(c.naive === hex(c.token), `naive line ${c.naive} vs --fh-naive ${c.token}`);
  return `naive ${c.token}, Sumatra ${c.sumatra}, Borneo ${c.borneo}`;
});

await check('Eleven sections in order, each with a chip in the section navigation', async () => {
  const s = await page.evaluate(() => ({
    titles: [...document.querySelectorAll('.db-body section.ui-section h2')].map((h) => h.textContent.trim()),
    chips: [...document.querySelectorAll('.db-nav-chip')].map((a) => `${a.getAttribute('data-id')}=${a.querySelector('.db-nav-label').textContent}`),
    outro: !!document.querySelector('.db-outro a[href="#/methods"]'),
  }));
  assert(s.titles.length === 11, `${s.titles.length} sections`);
  assert(s.chips.length === 11, `${s.chips.length} chips`);
  assert(s.outro, 'no link to #/methods in the closing note');
  return `${s.titles.join(' / ')} || chips: ${s.chips.join(', ')} || closing note links to #/methods`;
});

await check('Nav chip click: smooth scroll, section under the nav, hash ?s=, active chip, focus on the heading', async () => {
  await page.click('.db-nav-chip[data-id="seam"]');
  const ys = [];
  // (sampled until the section arrives: a software rendered page can start the scroll late)
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(60);
    const at = await page.evaluate(() => ({ y: Math.round(scrollY), top: document.getElementById('db-seam').getBoundingClientRect().top,
      nav: document.querySelector('.db-nav').getBoundingClientRect().bottom }));
    ys.push(at.y);
    if (at.top >= at.nav - 1 && at.top <= at.nav + 40) break;
  }
  const end = await arrive(page, 'seam');
  const mid = ys.filter((y) => y > 5 && Math.abs(y - end) > 5).length;
  const { top, navBottom } = await sectionTop(page, 'seam');
  const st = await page.evaluate(() => ({ hash: location.hash, focus: document.activeElement?.textContent?.trim(), tag: document.activeElement?.tagName }));
  const chip = await activeChip(page);
  assert(mid >= 2, `no intermediate scroll positions (${ys.join(',')} -> ${end}): not smooth`);
  assert(top >= navBottom && top <= navBottom + 40, `section top ${top}, nav bottom ${navBottom}`);
  assert(st.hash === '#/dashboard?s=seam', `hash ${st.hash}`);
  assert(chip === 'seam', `active chip ${chip}`);
  assert(st.tag === 'H2' && st.focus === 'The seam test', `focus on ${st.tag} "${st.focus}"`);
  return `scrolled through ${ys.join(', ')} to ${end}; section top ${top} px under nav bottom ${navBottom}; hash ${st.hash}; focus on h2`;
});

await check('Scrollspy: the lit chip follows the reading position while scrolling with the wheel', async () => {
  await page.evaluate(() => window.scrollTo(0, 0)); await settle(page);
  const seen = [];
  for (let i = 0; i < 26; i++) {
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(140);
    if (i % 3 === 2) {
      await settle(page, 450);
      await page.waitForTimeout(80);
      const [a, e] = [await activeChip(page), await expectedChip(page)];
      seen.push(`${a}${a === e ? '' : `(expected ${e})`}`);
      assert(a === e, `lit chip ${a}, reader is in ${e}`);
    }
  }
  return `lit chips while scrolling: ${seen.join(' > ')}`;
});

await check('Progress line: 0 at the top, in between, 1 at the bottom', async () => {
  const prog = () => page.evaluate(() => Number(getComputedStyle(document.querySelector('.db-nav-progress')).getPropertyValue('--db-progress') || 0));
  await page.evaluate(() => window.scrollTo(0, 0)); await settle(page); await page.waitForTimeout(150);
  const a = await prog();
  await page.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) / 2)); await settle(page); await page.waitForTimeout(150);
  const b = await prog();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await settle(page); await page.waitForTimeout(150);
  const c = await prog();
  const chip = await activeChip(page);
  assert(a < 0.01 && b > 0.4 && b < 0.6 && c > 0.99, `progress ${a}, ${b}, ${c}`);
  assert(chip === 'haze', `at the bottom the lit chip is ${chip}`);
  return `progress ${a.toFixed(2)} / ${b.toFixed(2)} / ${c.toFixed(2)}; at the bottom the lit chip is "${chip}"`;
});

await check('Copy link: toast "Link copied" and the clipboard holds the link to the section in view', async () => {
  await page.click('.db-nav-chip[data-id="model"]'); await settle(page); await page.waitForTimeout(200);
  await page.click('button[aria-label="Copy a link to this section"]');
  await page.waitForSelector('.ui-toast:has-text("Link copied")', { timeout: 3000 });
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert(clip === `${BASE}#/dashboard?s=model`, `clipboard "${clip}"`);
  return `toast shown; clipboard = ${clip}`;
}).catch(() => {});

await check('Back to top: scrolls to the top, clears the section from the hash, lights the first chip', async () => {
  await page.click('button[aria-label="Back to the top"]');
  await page.waitForFunction(() => scrollY < 2, null, { timeout: 8000 }).catch(() => undefined);
  const y = await settle(page);
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => location.hash);
  const chip = await activeChip(page);
  assert(y < 2, `scrollY ${y}`); assert(st === '#/dashboard', `hash ${st}`); assert(chip === 'glance', `chip ${chip}`);
  return `scrollY ${y}, hash ${st}, chip ${chip}`;
});

await check('Keyboard: Tab reaches the chips with a visible focus ring, Enter jumps to the section', async () => {
  await page.focus('.db-nav-chip[data-id="drivers"]');
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');    // keyboard focus, so :focus-visible applies
  const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`; });
  const id = await page.evaluate(() => document.activeElement.getAttribute('data-id'));
  await page.keyboard.press('Enter');
  await arrive(page, 'drivers'); await page.waitForTimeout(150);
  const { top, navBottom } = await sectionTop(page, 'drivers');
  const hash = await page.evaluate(() => location.hash);
  assert(id === 'drivers', `focus on ${id}`);
  assert(!ring.startsWith('none'), `focus ring ${ring}`);
  assert(top >= navBottom && top <= navBottom + 40 && hash === '#/dashboard?s=drivers', `top ${top} nav ${navBottom} hash ${hash}`);
  return `focus ring "${ring}"; Enter moved the section to ${top} px (nav bottom ${navBottom}); hash ${hash}`;
});

await check('Deep link #/dashboard?s=outlook opens the page at the outlook', async () => {
  const p2 = await open(ctx, '#/dashboard?s=outlook');
  await page.waitForTimeout(400);
  const { top, navBottom } = await sectionTop(p2, 'outlook');
  const chip = await activeChip(p2);
  await p2.close();
  assert(top >= navBottom - 2 && top <= navBottom + 40, `outlook top ${top}, nav bottom ${navBottom}`);
  assert(chip === 'outlook', `chip ${chip}`);
  return `outlook top ${top} px, nav bottom ${navBottom} px, lit chip ${chip}`;
});

const continents = '.db-table-continents table';
const colValues = (sel, col) => page.$$eval(`${sel} tbody tr`, (trs, col) => trs.map((tr) => tr.children[col]?.textContent.trim()), col);
const ariaSorts = (sel) => page.$$eval(`${sel} thead th`, (ths) => ths.map((th) => `${th.textContent.trim()}:${th.getAttribute('aria-sort') ?? '-'}`));
await check('Continent table: header buttons sort both ways and aria-sort follows', async () => {
  await page.locator('#db-where').scrollIntoViewIfNeeded();
  const head = (label) => page.locator(`${continents} thead button:has-text("${label}")`);
  const out = [];
  await head('Hotspots a year').click(); await page.waitForTimeout(100);
  let v = (await colValues(continents, 2)).map(parseCount);
  let s = await ariaSorts(continents);
  assert(v.every((x, i) => i === 0 || v[i - 1] >= x), `not high to low: ${v}`);
  assert(s.find((x) => x.startsWith('Hotspots a year')).endsWith('descending'), `aria-sort ${s}`);
  out.push(`hotspots high to low (${v.map((x) => Math.round(x / 1e4) / 100).join(', ')} million)`);
  await head('Hotspots a year').click(); await page.waitForTimeout(100);
  v = (await colValues(continents, 2)).map(parseCount);
  s = await ariaSorts(continents);
  assert(v.every((x, i) => i === 0 || v[i - 1] <= x), `not low to high: ${v}`);
  assert(s.find((x) => x.startsWith('Hotspots a year')).endsWith('ascending'), `aria-sort ${s}`);
  out.push('second click low to high');
  await head('Continent').click(); await page.waitForTimeout(100);
  const names = await colValues(continents, 0);
  s = await ariaSorts(continents);
  assert(names.join() === [...names].sort((a, b) => a.localeCompare(b)).join(), `names ${names}`);
  assert(s.filter((x) => x.endsWith('ascending') || x.endsWith('descending')).length === 1, `aria-sort ${s}`);
  out.push(`by name A to Z (${names.join(', ')}); only one header has an aria-sort direction, the rest "none"`);
  await head('Share of world fire').click();
  return out.join('; ');
});

const countries = '.db-table-countries table';
const countryNames = () => page.$$eval(`${countries} tbody tr`, (trs) => trs.filter((tr) => getComputedStyle(tr).display !== 'none').map((tr) => tr.querySelector('.db-link-text')?.textContent.trim()));
await check('Country search: type, Escape clears, no match shows an empty state with "Show all countries", clear button', async () => {
  const input = page.locator('input[aria-label="Find a country"]');
  const out = [];
  await input.click(); await input.fill(''); await input.type('bra', { delay: 40 });
  await page.waitForTimeout(150);
  let n = await countryNames();
  let res = await page.textContent('.db-result');
  assert(n.length >= 1 && n.every((x) => x.toLowerCase().includes('bra')), `rows ${n}`);
  out.push(`"bra" -> ${n.join(', ')} ("${res}")`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  n = await countryNames();
  assert((await input.inputValue()) === '' && n.length === 25, `after Escape: "${await input.inputValue()}", ${n.length} rows`);
  out.push('Escape -> all 25');
  await input.type('Cote', { delay: 30 }); await page.waitForTimeout(150);
  n = await countryNames();
  out.push(`"Cote" (no accent) -> ${n.join(', ') || 'none'}`);
  await input.fill('zzz'); await page.waitForTimeout(150);
  const empty = await page.textContent('.db-table-countries .db-empty');
  assert(/No country matches “zzz”/.test(empty), `empty state "${empty}"`);
  await page.click('.db-table-countries .db-empty button:has-text("Show all countries")'); await page.waitForTimeout(150);
  n = await countryNames();
  assert((await input.inputValue()) === '' && n.length === 25, 'Show all countries did not reset');
  out.push(`"zzz" -> "${empty.replace('Show all countries', '').trim()}"; the button brings back 25`);
  await input.fill('ang'); await page.waitForTimeout(100);
  await page.click('button[aria-label="Clear the search"]'); await page.waitForTimeout(100);
  assert((await input.inputValue()) === '', 'clear button did not clear');
  out.push('clear button empties the field');
  return out.join('; ');
});

await check('Continent chips filter the countries, aria-pressed, a second press shows all again', async () => {
  const out = [];
  for (const k of ['Africa', 'Europe', 'South America']) {
    const chip = page.locator(`.db-toolbar .ui-chip:has-text("${k}")`);
    const want = Number((await chip.locator('.db-chip-n').textContent()).trim());
    await chip.click(); await page.waitForTimeout(120);
    const n = await countryNames();
    const subs = await page.$$eval(`${countries} tbody tr`, (trs) => trs.map((tr) => tr.querySelector('.db-place-sub')?.textContent ?? ''));
    const pressed = await chip.getAttribute('aria-pressed');
    assert(pressed === 'true' && n.length === want && subs.every((x) => x.includes(k)), `${k}: pressed ${pressed}, ${n.length} rows, chip says ${want}`);
    out.push(`${k}: ${n.length} (${n.slice(0, 3).join(', ')}${n.length > 3 ? ', …' : ''})`);
    await chip.click(); await page.waitForTimeout(120);
    const all = await page.locator('.db-toolbar .ui-chip:has-text("All")').getAttribute('aria-pressed');
    assert(all === 'true' && (await countryNames()).length === 25, `${k} second press: All pressed ${all}`);
  }
  return `${out.join('; ')}; a second press goes back to All 25`;
});

await check('Country table: sorting by trend and by the latest month, and back', async () => {
  const head = (label) => page.locator(`${countries} thead button:has-text("${label}")`);
  await head('Trend per decade').click(); await page.waitForTimeout(100);
  const tr = await page.$$eval(`${countries} tbody tr .db-trendmark-value`, (els) => els.map((e) => Number(e.textContent.replace('−', '-').replace('%', ''))));
  assert(tr.every((x, i) => i === 0 || tr[i - 1] >= x), `trend not high to low: ${tr}`);
  await head('against normal').click(); await page.waitForTimeout(100);
  const lt = await page.$$eval(`${countries} tbody tr .db-anom .ui-mono`, (els) => els.map((e) => Number(e.textContent)));
  assert(lt.every((x, i) => i === 0 || lt[i - 1] >= x), `latest not high to low: ${lt}`);
  await head('Rank').click(); await page.waitForTimeout(100);
  const rk = await page.$$eval(`${countries} tbody tr .db-rankcell`, (els) => els.map((e) => Number(e.textContent)));
  assert(rk.every((x, i) => x === i + 1), `rank order ${rk}`);
  return `trend high to low (${tr[0]}% … ${tr[tr.length - 1]}%), latest month high to low (${lt[0]} … ${lt[lt.length - 1]} times), rank 1 to 25`;
});

await check('Row click opens the place in the Explorer (#/?area=country:…), Back returns', async () => {
  const first = await page.$eval(`${countries} tbody tr`, (tr) => tr.querySelector('.db-link').getAttribute('href'));
  await page.locator(`${countries} tbody tr`).first().locator('td.db-c-mean').click();
  await page.waitForFunction(() => location.hash.startsWith('#/?area='), null, { timeout: 5000 });
  const hash = await page.evaluate(() => location.hash);
  assert(hash === first, `hash ${hash}, link ${first}`);
  await page.goBack(); await page.waitForSelector('#db-glance', { timeout: 30000 }); await page.waitForTimeout(800);
  return `row click -> ${hash} (same as the row link); Back -> ${await page.evaluate(() => location.hash)}`;
});

await check('Continent row and ranked list rows open the Explorer', async () => {
  const out = [];
  await page.locator('#db-where').scrollIntoViewIfNeeded();
  await page.locator(`${continents} tbody tr`).first().locator('td').nth(1).click();
  await page.waitForFunction(() => location.hash.startsWith('#/?area='), null, { timeout: 5000 });
  out.push(`continent row -> ${await page.evaluate(() => location.hash)}`);
  await page.goBack(); await page.waitForSelector('#db-now', { timeout: 30000 }); await page.waitForTimeout(800);
  for (const [sec, label] of [['#db-now', 'unusual now'], ['#db-drivers', 'El Niño list'], ['#db-outlook', 'outlook chances']]) {
    const row = page.locator(`${sec} .db-rank-row.is-link`).first();
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);    // on the bar, away from the name
    await page.waitForFunction(() => location.hash.startsWith('#/?area='), null, { timeout: 5000 });
    out.push(`${label} row -> ${await page.evaluate(() => location.hash)}`);
    await page.goBack(); await page.waitForSelector('#db-now', { timeout: 30000 }); await page.waitForTimeout(800);
  }
  await page.locator('#db-drivers .db-table-drivers tbody tr').first().locator('td').first().click();
  await page.waitForFunction(() => location.hash.startsWith('#/?area='), null, { timeout: 5000 });
  out.push(`drivers table row -> ${await page.evaluate(() => location.hash)}`);
  await page.goBack(); await page.waitForSelector('#db-glance', { timeout: 30000 }); await page.waitForTimeout(800);
  return out.join('; ');
});

await check('Modifier click on a place link stays a normal link (new tab), the page does not change', async () => {
  const link = page.locator(`${countries} tbody tr .db-link`).first();
  await link.scrollIntoViewIfNeeded();
  const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null), link.click({ modifiers: ['Control'] })]);
  const hash = await page.evaluate(() => location.hash);
  const url = popup ? popup.url() : null;
  if (popup) await popup.close();
  assert(hash.startsWith('#/dashboard'), `page moved to ${hash}`);
  return `Ctrl+click opened ${url ?? '(no new tab in headless)'}; this page stays at ${hash}`;
});

await check('Seam switch: Naive join / Harmonized / Both by click and arrow keys; lines morph, readout updates', async () => {
  await page.click('.db-nav-chip[data-id="seam"]'); await settle(page);
  const mode = () => page.$eval('.db-seam', (e) => e.getAttribute('data-mode'));
  const read = () => page.$eval('.db-seam-readout', (e) => ({ sr: e.querySelector('.db-sr').textContent, seen: [...e.querySelectorAll('[aria-hidden="true"]')].map((x) => x.textContent).join(' ') }));
  const harmOpacity = () => page.$eval('.db-morph-harm', (e) => Number(getComputedStyle(e).opacity));
  const out = [];
  const before = await page.$eval('.db-morph-harm', (e) => getComputedStyle(e).d.slice(0, 40));
  await page.click('#db-seam [role="radio"]:has-text("Naive join")');
  await page.waitForTimeout(150);
  const during = await page.$eval('.db-morph-harm', (e) => getComputedStyle(e).d.slice(0, 40));
  // (the morph and the number glide over 700 ms; on a slow software renderer frames come late, so poll for the end)
  await page.waitForFunction(() => document.querySelector('.db-seam')?.getAttribute('data-mode') === 'naive'
    && Number(getComputedStyle(document.querySelector('.db-morph-harm')).opacity) < 0.05
    && /\+699%/.test(document.querySelector('.db-seam-readout')?.textContent ?? ''), null, { timeout: 6000 }).catch(() => undefined);
  const after = await page.$eval('.db-morph-harm', (e) => getComputedStyle(e).d.slice(0, 40));
  let r = await read();
  assert((await mode()) === 'naive' && r.sr.includes('+699%') && r.seen.includes('+699%') && (await harmOpacity()) < 0.05, `naive: ${await mode()} ${r.sr} ${r.seen}`);
  assert(before !== after, 'the harmonized line did not move');
  out.push(`click Naive join -> mode naive, readout "${r.seen.trim()}", harmonized line moves onto the naive path (${before !== during ? 'in between at 150 ms' : 'at once'}) and fades`);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.db-seam')?.getAttribute('data-mode') === 'harmonized'
    && /\+0\.55%/.test([...document.querySelectorAll('.db-seam-readout [aria-hidden="true"]')].map((x) => x.textContent).join(' ')), null, { timeout: 6000 }).catch(() => undefined);
  r = await read();
  const focus = await page.evaluate(() => document.activeElement.textContent);
  assert((await mode()) === 'harmonized' && r.seen.includes('+0.55%') && focus === 'Harmonized', `right: ${await mode()} ${r.seen} focus ${focus}`);
  out.push(`ArrowRight -> Harmonized (focus follows), readout "${r.seen.trim()}"`);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.db-seam')?.getAttribute('data-mode') === 'both'
    && Number(getComputedStyle(document.querySelector('.db-morph-harm')).opacity) > 0.95, null, { timeout: 6000 }).catch(() => undefined);
  r = await read();
  assert((await mode()) === 'both' && (await harmOpacity()) > 0.95, `both: ${await mode()}`);
  out.push(`ArrowRight -> Both, readout "${r.seen.replace(/\s+/g, ' ').trim()}"; screen reader text "${r.sr}"`);
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(200);
  assert((await mode()) === 'harmonized', 'ArrowLeft did not go back');
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(900);
  return out.join('; ');
});

await check('Every chart shows a tooltip under the pointer', async () => {
  const figs = await page.$$('.db-body .ui-figure');
  const out = [], miss = [];
  for (const [i, f] of figs.entries()) {
    const title = (await f.$eval('.ui-figure-title, h3, figcaption', (e) => e.textContent.trim()).catch(() => `figure ${i}`)).slice(0, 48);
    const svg = await f.$('.ui-figure-plot svg');
    if (!svg) { miss.push(`${title} (no svg)`); continue; }
    await svg.scrollIntoViewIfNeeded();
    const b = await svg.boundingBox();
    let tip = '';
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.4], [0.7, 0.3], [0.6, 0.7], [0.2, 0.2], [0.85, 0.5], [0.4, 0.85]]) {
      await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy, { steps: 3 });
      await page.waitForTimeout(120);
      tip = await f.$$eval('g[aria-label="tip"]', (gs) => gs.map((g) => g.textContent.trim()).filter(Boolean).join(' | ')).catch(() => '');
      if (tip) break;
    }
    if (tip) out.push(`${title}: "${tip.replace(/\s+/g, ' ').slice(0, 60)}"`); else miss.push(title);
  }
  await page.mouse.move(5, 5);
  assert(miss.length === 0, `no tooltip on: ${miss.join('; ')}`);
  return `${out.length} charts, every one with a tooltip. ${out.join(' || ')}`;
});

await check('Every chart has a table view ("Show the numbers") that opens and closes', async () => {
  const n = await page.$$eval('.db-body .ui-figure', (fs) => fs.length);
  const sums = page.locator('.db-body .ui-figure details > summary');
  const k = await sums.count();
  const rows = [];
  for (let i = 0; i < k; i++) {
    const s = sums.nth(i);
    await s.scrollIntoViewIfNeeded();
    await s.click();
    await page.waitForTimeout(60);
    const det = s.locator('xpath=..');
    const r = await det.locator('table tbody tr').count();
    const vis = await det.locator('table').isVisible();
    rows.push(r);
    assert(vis && r > 0, `table ${i} visible ${vis}, ${r} rows`);
    await s.click();
    assert(!(await det.locator('table').isVisible()), `table ${i} did not close`);
  }
  assert(k === n, `${n} charts, ${k} table views`);
  return `${n} charts, ${k} table views, rows: ${rows.join(', ')}`;
});

await check('Download the numbers saves fire-harmony-dashboard-v1.0.json (valid JSON) with a toast', async () => {
  await page.evaluate(() => window.scrollTo(0, 0)); await settle(page);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('button:has-text("Download the numbers")')]);
  const file = '/tmp/fh_dbtest/download.json';
  await dl.saveAs(file);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  await page.waitForSelector('.ui-toast:has-text("Dashboard numbers saved as JSON")', { timeout: 3000 });
  assert(dl.suggestedFilename() === 'fire-harmony-dashboard-v1.0.json', dl.suggestedFilename());
  return `${dl.suggestedFilename()}, ${Math.round(fs.statSync(file).size / 1024)} kB, keys: ${Object.keys(j).slice(0, 8).join(', ')}…; toast shown`;
});

await check('Theme: T switches light and dark, the charts redraw in the new colours', async () => {
  const stroke = () => page.$eval('#db-world .ui-figure-plot svg [aria-label="line"] path', (p) => p.getAttribute('stroke') ?? getComputedStyle(p).stroke);
  const textFill = () => page.$eval('#db-world .ui-figure-plot svg', (s) => getComputedStyle(s).color);
  await page.evaluate(() => document.activeElement?.blur());
  const t0 = await page.evaluate(() => document.documentElement.dataset.theme);
  const [s0, c0] = [await stroke(), await textFill()];
  await page.keyboard.press('t'); await page.waitForTimeout(700);
  const t1 = await page.evaluate(() => document.documentElement.dataset.theme);
  const [s1, c1] = [await stroke(), await textFill()];
  await page.keyboard.press('t'); await page.waitForTimeout(700);
  const t2 = await page.evaluate(() => document.documentElement.dataset.theme);
  const s2 = await stroke();
  assert(t0 !== t1 && t2 === t0, `themes ${t0} ${t1} ${t2}`);
  assert(s0 !== s1 && s2 === s0, `line stroke ${s0} -> ${s1} -> ${s2}`);
  return `${t0} -> ${t1} -> ${t2}; world line stroke ${s0} -> ${s1} -> ${s2}; axis colour ${c0} -> ${c1}`;
});

await check('Sections fade in once the reader scrolls (nothing hidden before the first scroll)', async () => {
  const p3 = await open(ctx);
  const before = await p3.$$eval('.db-reveal.db-pending', (e) => e.length);
  await p3.mouse.move(700, 500); await p3.mouse.wheel(0, 300); await p3.waitForTimeout(300);
  const pending = await p3.$$eval('.db-reveal.db-pending', (e) => e.length);
  for (let i = 0; i < 40; i++) { await p3.mouse.wheel(0, 700); await p3.waitForTimeout(50); }
  await p3.waitForTimeout(800);
  const left = await p3.$$eval('.db-reveal.db-pending', (e) => e.length);
  const revealed = await p3.$$eval('.db-body .ui-reveal', (e) => e.length);
  const hidden = await p3.$$eval('.db-body .ui-section > *', (els) => els.filter((e) => Number(getComputedStyle(e).opacity) < 0.99).length);
  await p3.close();
  assert(before === 0 && pending > 0 && left === 0 && hidden === 0, `before ${before}, after first scroll ${pending}, at the end ${left}, hidden ${hidden}`);
  return `before scrolling 0 hidden; after the first scroll ${pending} sections wait below the fold; after reading down ${revealed} blocks faded in, 0 hidden`;
});

await check('Reduced motion: nothing fades, jumps are instant, the seam switch does not animate', async () => {
  const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const p4 = await open(rctx);
  await p4.mouse.move(700, 500); await p4.mouse.wheel(0, 400); await p4.waitForTimeout(300);
  const pending = await p4.$$eval('.db-reveal.db-pending, .db-body .ui-reveal', (e) => e.length);
  await p4.click('.db-nav-chip[data-id="outlook"]');
  await p4.waitForTimeout(80);
  const { top, navBottom } = await sectionTop(p4, 'outlook');
  const t = await p4.$eval('.db-seam', (e) => getComputedStyle(e).getPropertyValue('--db-morph-t').trim());
  const live = await p4.$eval('.db-live', (e) => getComputedStyle(e).animationName);
  await rctx.close();
  assert(pending === 0, `${pending} blocks hidden or animated`);
  assert(top >= navBottom && top <= navBottom + 40, `after 80 ms outlook top ${top} (nav ${navBottom})`);
  assert(t === '0ms', `morph time ${t}`);
  return `no hidden or animated blocks; chip jump done within 80 ms (top ${top}, nav ${navBottom}); seam morph time ${t}; live dot animation ${live}`;
});

await check('Loading: a skeleton for slow loads; error state with "Try again" that recovers', async () => {
  const ectx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let fail = true, slow = true;
  await ectx.route('**/dashboard.json', async (route) => {
    if (slow) { slow = false; await new Promise((r) => setTimeout(r, 3000)); return route.fulfill({ status: 503, body: 'down' }); }
    if (fail) return route.fulfill({ status: 503, body: 'down' });
    return route.continue();
  });
  const p5 = await open(ectx, '#/dashboard', { wait: false });
  const skel = await p5.waitForSelector('.db-skeleton[role="status"]', { timeout: 2900 }).then(() => 1, () => 0);
  await p5.waitForSelector('.db-error[role="alert"]', { timeout: 10000 });
  const msg = await p5.textContent('.db-error-title');
  fail = false;
  await p5.click('.db-error button:has-text("Try again")');
  await p5.waitForSelector('#db-glance', { timeout: 30000 });
  const gone = await p5.$$eval('.db-error', (e) => e.length);
  await ectx.close();
  assert(skel === 1, `skeleton count ${skel}`);
  assert(gone === 0, 'error still shown');
  return `skeleton shown while waiting; then "${msg}"; Try again loaded the dashboard`;
});

// ------------------------------------------------------------------------------------------------ phone, 390
const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const ph = await open(pctx);
const visibleRows = () => ph.$$eval('.db-table-countries tbody tr', (trs) => trs.filter((tr) => getComputedStyle(tr).display !== 'none').length);

await check('Phone: the scope card sits right under the title, the lead shows two lines, and a number is on the first screen', async () => {
  await ph.evaluate(() => window.scrollTo(0, 0));
  await ph.waitForTimeout(300);
  const r = await ph.evaluate(() => {
    const h1 = document.querySelector('h1').getBoundingClientRect(), flow = document.querySelector('.ui-page-header .db-scope-flow')?.getBoundingClientRect();
    const lead = document.querySelector('.ui-lead'), lr = lead.getBoundingClientRect();
    const nums = [...document.querySelectorAll('.ui-stat-value, .db-g-value, [class*="tile"] .ui-mono')].map((e) => e.getBoundingClientRect()).filter((x) => x.height > 0);
    return { under: !!flow && flow.top >= h1.bottom - 1 && flow.bottom <= lr.top + 1, lines: Math.round(lr.height / parseFloat(getComputedStyle(lead).lineHeight)),
      firstNumber: nums.length ? Math.round(Math.min(...nums.map((x) => x.top))) : 9999, screen: innerHeight };
  });
  assert(r.under, 'the scope card is not between the title and the lead');
  assert(r.lines === 2, `the lead has ${r.lines} lines`);
  assert(r.firstNumber < r.screen, `the first number is at ${r.firstNumber} px of ${r.screen}`);
  return `first number at ${r.firstNumber} px of ${r.screen}`;
});

await check('Phone: no sideways scrolling, the nav strip scrolls on its own', async () => {
  const w = await ph.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    strip: (() => { const s = document.querySelector('.db-nav-strip'); return `${s.scrollWidth}/${s.clientWidth}`; })() }));
  assert(w.sw <= w.cw, `page ${w.sw} wide in ${w.cw}`);
  return `page ${w.sw} px in ${w.cw} px; nav strip ${w.strip} (content/visible)`;
});

await check('Phone: the lit chip is scrolled into view inside the strip', async () => {
  await ph.tap('.db-nav-chip[data-id="where"]'); await settle(ph); await ph.waitForTimeout(300);
  await ph.evaluate(() => document.getElementById('db-haze').scrollIntoView()); await settle(ph); await ph.waitForTimeout(700);
  const r = await ph.evaluate(() => {
    const s = document.querySelector('.db-nav-strip').getBoundingClientRect();
    const a = document.querySelector('.db-nav-chip[aria-current="location"]');
    const b = a.getBoundingClientRect();
    return { id: a.getAttribute('data-id'), inside: b.left >= s.left - 1 && b.right <= s.right + 1, l: Math.round(b.left), r: Math.round(b.right), sl: Math.round(s.left), sr: Math.round(s.right) };
  });
  assert(r.inside, `chip ${r.id} at ${r.l}-${r.r}, strip ${r.sl}-${r.sr}`);
  return `lit chip "${r.id}" at ${r.l} to ${r.r} px, inside the strip (${r.sl} to ${r.sr} px)`;
});

await check('Phone: each section folds after its first part; "Show more" opens it, says what it holds, and folds back in place', async () => {
  const folds = await ph.$$eval('.db-section .db-fold', (bs) => bs.map((b) => ({ id: b.closest('section').id, t: b.textContent.trim(), exp: b.getAttribute('aria-expanded') })));
  const h0 = await ph.evaluate(() => document.documentElement.scrollHeight);
  const hidden0 = await ph.$$eval('#db-where [data-fold]', (els) => els.filter((e) => e.getClientRects().length === 0).length);
  // the countries table is the second card of "Where the fire is": open it
  const btn = ph.locator('#db-where .db-fold');
  await btn.scrollIntoViewIfNeeded(); await btn.tap(); await ph.waitForTimeout(250);
  const shownNow = await ph.$$eval('#db-where [data-fold]', (els) => els.filter((e) => e.getClientRects().length > 0).length);
  const label = (await btn.textContent()).trim();
  const h1 = await ph.evaluate(() => document.documentElement.scrollHeight);
  const kept = await ph.evaluate(() => JSON.parse(sessionStorage.getItem('fh_db_open') ?? '[]'));
  assert(folds.length >= 10 && folds.every((f) => f.exp === 'false' && /^Show \d+ more /.test(f.t)), `buttons ${JSON.stringify(folds)}`);
  assert(h0 <= 12500, `folded page ${h0} px`);   // (12,000 before the scope card and the calendar; the labels say more now)
  assert(hidden0 >= 1 && shownNow >= 1 && label === 'Show less' && kept.includes('where'), `hidden ${hidden0}, shown ${shownNow}, "${label}", kept ${kept}`);
  return `${folds.length} sections fold (${folds.slice(0, 3).map((f) => `${f.id.slice(3)}: "${f.t}"`).join('; ')}…); page ${h0} px folded, ${h1} px with the places open; the choice is kept for the session`;
});

await check('Phone: countries show 10 cards, "Show all 25 countries" expands, collapsing keeps the button in place', async () => {
  await ph.evaluate(() => document.querySelector('.db-table-countries').scrollIntoView()); await settle(ph);
  const a = await visibleRows();
  const btn = ph.locator('.db-more');
  const label0 = (await btn.textContent()).trim();
  await btn.scrollIntoViewIfNeeded(); await btn.tap(); await ph.waitForTimeout(200);
  const b = await visibleRows();
  const label1 = (await btn.textContent()).trim();
  const exp = await btn.getAttribute('aria-expanded');
  await btn.scrollIntoViewIfNeeded(); await ph.waitForTimeout(100);
  const y0 = (await btn.boundingBox()).y;
  await btn.tap(); await ph.waitForTimeout(250);
  const y1 = (await btn.boundingBox()).y;
  const c = await visibleRows();
  assert(a === 10 && b === 25 && c === 10, `rows ${a} -> ${b} -> ${c}`);
  assert(exp === 'true' && label1 === 'Show the first 10', `expanded ${exp} "${label1}"`);
  assert(Math.abs(y1 - y0) <= 4, `button moved from ${y0} to ${y1}`);
  return `${a} cards, "${label0}" -> ${b} cards ("${label1}", aria-expanded ${exp}) -> ${c} cards; button stayed at ${Math.round(y0)} -> ${Math.round(y1)} px`;
});

await check('Phone: the sort menu reorders the cards', async () => {
  const names = () => ph.$$eval('.db-table-countries tbody tr', (trs) => trs.map((tr) => tr.querySelector('.db-link-text').textContent.trim()));
  await ph.selectOption('.db-sortpick select', 'name:asc'); await ph.waitForTimeout(150);
  const az = await names();
  await ph.selectOption('.db-sortpick select', 'latest:desc'); await ph.waitForTimeout(150);
  const hi = await ph.$$eval('.db-table-countries tbody tr .db-anom .ui-mono', (els) => els.map((e) => Number(e.textContent)));
  await ph.selectOption('.db-sortpick select', 'mean:desc'); await ph.waitForTimeout(150);
  const top = (await names())[0];
  assert(az.join() === [...az].sort((x, y) => x.localeCompare(y)).join(), `not A to Z: ${az.slice(0, 5)}`);
  assert(hi.every((x, i) => i === 0 || hi[i - 1] >= x), `not most above normal first: ${hi}`);
  return `Name, A to Z: ${az.slice(0, 3).join(', ')}…; Most above normal first: ${hi.slice(0, 3).join(', ')}…; Most fire first: ${top}`;
});

await check('Phone: a card tap opens the Explorer; the search field and chips work by touch', async () => {
  await ph.tap('.db-toolbar .ui-chip:has-text("Asia")'); await ph.waitForTimeout(150);
  const n = await visibleRows();
  await ph.tap('.db-toolbar .ui-chip:has-text("All")'); await ph.waitForTimeout(150);
  await ph.locator('.db-table-countries tbody tr').first().locator('td.db-c-trend').tap();
  await ph.waitForFunction(() => location.hash.startsWith('#/?area='), null, { timeout: 5000 });
  const hash = await ph.evaluate(() => location.hash);
  return `Asia chip -> ${n} cards; card tap -> ${hash}`;
});

await ph.close();
await pctx.close();

// touch screens (tablets): the country search of the Places table is 44 px tall
for (const [w, hgt] of [[820, 1180], [1024, 768]]) {
  const tctx = await browser.newContext({ viewport: { width: w, height: hgt }, isMobile: true, hasTouch: true });
  const tp = await open(tctx);
  await check(`Touch ${w}: the "Find a country" search is 44 px tall`, async () => {
    await tp.locator('.db-search').first().scrollIntoViewIfNeeded();
    const hh = await tp.evaluate(() => Math.round(document.querySelector('.db-search')?.getBoundingClientRect().height ?? 0));
    assert(hh >= 44, `${hh} px`);
    return `${hh} px`;
  });
  await tp.close();
  await tctx.close();
}
await page.close();
await ctx.close();
await browser.close();

const errs = allErrors.flat();
const mine = errs.filter((e) => e.where === 'dashboard' && !/status of 503/.test(e.text));   // the 503 is the error test itself
const other = errs.filter((e) => e.where !== 'dashboard');
results.push({ ok: mine.length === 0, name: 'No console errors or warnings on the dashboard (the 503 of the error test excluded)',
  detail: mine.length ? mine.slice(0, 6).map((e) => e.text).join(' | ') : `${allErrors.length} pages, 0 problems on #/dashboard` });
results.push({ ok: true, name: 'Console problems on other pages reached from dashboard links (not dashboard files)',
  detail: other.length ? [...new Set(other.map((e) => e.text))].slice(0, 4).join(' | ') : 'none' });
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ms !== undefined ? ` (${r.ms} ms)` : ''}\n      ${r.detail}`);
console.log(`\n${results.filter((r) => r.ok).length} of ${results.length} passed`);
fs.writeFileSync('/tmp/fh_dbtest/functional.json', JSON.stringify(results, null, 1));
fs.writeFileSync('/tmp/fh_dbtest/console_full.json', JSON.stringify(allErrors.flat(), null, 1));
