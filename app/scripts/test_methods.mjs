// Function tests for #/methods: table of contents, scrollspy, deep links, copy link, back to top, lightbox,
// chart tooltips and tables, links into the Explorer and the Haze page, the command palette copy link; the live
// charts of the raw record and the trend tests (web/eda.json), the checks, the margin notes, and the phone layout.
// Usage: node scripts/test_methods.mjs [base address ending in /] [dark|light]
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';   // or a preview or live address ending in /
const theme = process.argv[3] ?? 'dark';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
await ctx.addInitScript((t) => { try { localStorage.setItem('fh_theme', t); } catch {} }, theme);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };
const errors = [];
function watch(page) {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`.slice(0, 240)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 240)}`));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toastText = (page) => page.evaluate(() => [...document.querySelectorAll('.ui-toast')].map((t) => t.textContent.trim()).join(' | '));
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
const active = (page) => page.evaluate(() => document.querySelector('.fh-doc-toc a[aria-current="true"]')?.getAttribute('href') ?? null);
// the model ladder and the picture beside it: one above the other
const stackedPair = () => { const c = [...document.querySelectorAll('.fh-mx-pair .ui-card')].map((x) => x.getBoundingClientRect()); return c.length === 2 && c[1].top >= c[0].bottom - 1; };
// chart text that sits on other text of the same chart (labels, ticks, axis names), as "chart :: a x b"
const textOverlaps = () => {
  const out = [];
  for (const svg of document.querySelectorAll('.fh-doc-body .ui-figure-plot svg')) {
    const boxes = [...svg.querySelectorAll('text')].filter((t) => !t.closest('[aria-label="tip"]') && t.textContent.trim())
      .flatMap((t) => { const sp = t.querySelectorAll('tspan'); return (sp.length ? [...sp] : [t]).map((n) => ({ n: n.textContent.trim(), r: n.getBoundingClientRect() })); })
      .filter((b) => b.n && b.r.width > 0);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 3)
        out.push(`${svg.closest('.ui-figure')?.querySelector('.ui-figure-title')?.textContent.slice(0, 40)} :: ${boxes[i].n} x ${boxes[j].n}`);
    }
  }
  return out;
};

const page = await ctx.newPage();
watch(page);
await page.goto(`${BASE}#/methods`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.fh-keys .ui-stat, .fh-keys [class*="stat"]', { timeout: 15000 }).catch(() => null);
await sleep(1500);

// 1. Header, key numbers
check('title', (await page.textContent('h1'))?.includes('How Fire Harmony works'));
const keys = await page.evaluate(() => document.querySelector('.fh-keys')?.innerText ?? '');
for (const v of ['8.4', '+0.55%', '+0.85%', '37.8%', '92 to 96%', '96.3%', '44%']) check(`key number ${v}`, keys.includes(v), '');
// 1b. What each test shows, said exactly; the short version; the report one click away
{
  const text = await page.evaluate(() => document.querySelector('.fh-doc-body')?.innerText ?? '');
  check('the trend sizes are explained: Sen’s slope of the logarithm', /logarithm of yearly fire/.test(text) && /about a quarter of the fire/.test(text), '');
  check('burned area agrees at the 2012 switch, and nothing claims both dates', /at the 2012 switch/.test(text) && !/both dates/.test(text), '');
  check('no claim that the switch cannot touch burned area, or that it never saw a hot pixel', !/cannot touch|never saw a hot pixel/.test(text), '');
  check('the outlook names the forecast it is measured against', /against the share of past years above normal|against a fixed 50% chance/.test(text) && !/beats the normal chance/.test(text), '');
  check('the model inputs are what Terra and Aqua saw', /what Terra and Aqua saw each month/.test(text), '');
  check('the haze share is named with the month of year', /with the month of year/.test(text) && !/Explained by the fires/.test(text), '');
  const sv = await page.evaluate(() => ({ title: document.querySelector('.fh-mx-short-title')?.textContent, n: document.querySelectorAll('.fh-mx-short-list li').length,
    links: [...document.querySelectorAll('.fh-mx-short-link')].map((a) => a.getAttribute('href')) }));
  check('a short version with five claims, each with a link to its evidence', sv.title === 'Short version' && sv.n === 5 && sv.links.length === 5 && sv.links.every((h) => /^#\/methods\?section=/.test(h)), JSON.stringify(sv));
  const rep = await page.evaluate(() => [...document.querySelectorAll('.ui-page-header a')].find((a) => /Read the full report/.test(a.textContent))?.getAttribute('href'));
  check('Read the full report (PDF) beside the page actions', rep === './Fire_Harmony_report.pdf', String(rep));
  const limits = await page.evaluate(() => document.querySelector('#limits')?.innerText ?? '');
  check('the first limit: the MODIS orbits drift from 2021 at night and 2022 by day; 2020 is the first unseen year', /from 2021 at night and from 2022 by day/.test(limits) && /2020, the first year it never saw/.test(limits), limits.slice(0, 200));
}
const tocLinks = await page.$$eval('.fh-doc-toc-list a', (as) => as.map((a) => a.textContent.trim()));
check('toc has 10 sections', tocLinks.length === 10, tocLinks.join(' / '));

// 2. TOC click: smooth scroll, aria-current, address, focus on the heading
await page.click('.fh-doc-toc-list a[href="#/methods?section=tests"]');
await sleep(1600);
const afterClick = await page.evaluate(() => {
  const s = document.getElementById('tests'); const h = s?.querySelector('h2');
  return { hash: location.hash, top: Math.round(s.getBoundingClientRect().top), focus: document.activeElement === h,
    focusText: document.activeElement?.textContent?.slice(0, 40), counter: document.querySelector('.fh-doc-toc-head .ui-mono, .fh-doc-toc .ui-mono')?.textContent };
});
check('toc click sets the address', afterClick.hash === '#/methods?section=tests', afterClick.hash);
check('toc click scrolls the section under the header', afterClick.top > 40 && afterClick.top < 140, `top=${afterClick.top}`);
check('toc click focuses the section heading', afterClick.focus, afterClick.focusText);
check('toc click marks the link current', (await active(page)) === '#/methods?section=tests', await active(page));
check('toc counter shows 06/10', (await page.evaluate(() => document.querySelector('.fh-doc-toc')?.innerText ?? '')).includes('06/10'));

// 3. Scrollspy follows the wheel
await page.mouse.move(800, 500);
for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 900); await sleep(120); }
await sleep(700);
const spy1 = await active(page);
check('scrollspy moves on with the wheel', spy1 && spy1 !== '#/methods?section=tests', spy1);
const spyOk = await page.evaluate(() => {
  const cur = document.querySelector('.fh-doc-toc a[aria-current="true"]')?.getAttribute('href')?.split('section=')[1];
  const s = document.getElementById(cur ?? ''); if (!s) return 'no section';
  const r = s.getBoundingClientRect(); return r.top < window.innerHeight * 0.6 && r.bottom > 80 ? 'ok' : `top=${Math.round(r.top)} bottom=${Math.round(r.bottom)}`;
});
check('scrollspy section is the one on screen', spyOk === 'ok', spyOk);
const progress = await page.evaluate(() => document.querySelector('.fh-doc-progress > span')?.style.transform ?? '');
check('reading progress bar moves', /scaleX\(0\.[1-9]/.test(progress) || /scaleX\(1/.test(progress), progress);

// 4. Copy a link to this section
const cur = await active(page);
await page.click('.fh-doc-toc button:has-text("Copy a link to this section")');
await sleep(400);
check('copy link toast', (await toastText(page)).includes('Link copied'), await toastText(page));
check('copy link puts the section link on the clipboard', (await clip(page)) === `${BASE}${cur}`, await clip(page));

// 5. Back to the top
await page.click('.fh-doc-toc button:has-text("Back to the top")');
await sleep(2400);
const top = await page.evaluate(() => ({ y: Math.round(window.scrollY), hash: location.hash, focus: document.activeElement?.tagName }));
check('back to the top scrolls up', top.y < 5, `y=${top.y}`);
check('back to the top clears the section from the address', top.hash === '#/methods', top.hash);
check('back to the top focuses the page title', top.focus === 'H1', top.focus);

// 6. Keyboard: Tab into the TOC, Enter on a link
await page.focus('.fh-doc-toc-list a[href="#/methods?section=raw-record"]');
await page.keyboard.press('Enter');
await sleep(1600);
check('keyboard Enter on a toc link', (await page.evaluate(() => location.hash)) === '#/methods?section=raw-record');
const visible = await page.evaluate(() => Math.round(document.getElementById('raw-record').getBoundingClientRect().top));
check('keyboard Enter scrolls to the section', visible > 40 && visible < 140, `top=${visible}`);

// 7. Lightbox: open from "View larger", keys, Escape, focus back
await page.evaluate(() => window.scrollTo(0, 0));
const opener = page.locator('.fh-fig-open').first();
await opener.scrollIntoViewIfNeeded();
await opener.click();
await sleep(500);
let lb = await page.evaluate(() => {
  const d = document.querySelector('dialog.fh-lightbox');
  return { open: d?.open, text: d?.innerText?.slice(0, 80), focus: document.activeElement?.getAttribute('aria-label'),
    img: d?.querySelector('img')?.naturalWidth ?? 0, html: document.documentElement.classList.contains('fh-lightbox-open') };
});
check('lightbox opens from View larger', lb.open, lb.text);
check('lightbox names the one picture, with no count of 1', /Figure 1(?! of)/.test(lb.text ?? ''), lb.text);
check('lightbox focuses the close button', lb.focus === 'Close the figure', lb.focus);
check('lightbox image loads', lb.img > 0, `naturalWidth=${lb.img}`);
check('one picture: no previous or next buttons', await page.evaluate(() => document.querySelectorAll('dialog.fh-lightbox .fh-lightbox-nav').length === 0));
await page.keyboard.press('ArrowRight');
await sleep(250);
check('ArrowRight keeps the one picture', (await page.innerText('dialog.fh-lightbox')).includes('Figure 1'));
// Tab stays inside the dialog
for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
check('Tab stays inside the lightbox', await page.evaluate(() => !!document.activeElement?.closest('dialog.fh-lightbox')));
await page.keyboard.press('Escape');
await sleep(400);
lb = await page.evaluate(() => ({ open: document.querySelector('dialog.fh-lightbox')?.open ?? false,
  focus: document.activeElement?.classList.contains('fh-fig-open'), label: document.activeElement?.getAttribute('aria-label'),
  html: document.documentElement.classList.contains('fh-lightbox-open') }));
check('Escape closes the lightbox', lb.open === false);
check('focus returns to the View larger button', lb.focus && lb.label?.startsWith('View figure 1 larger'), lb.label);
check('page scroll lock is released', lb.html === false);
// open by clicking the image itself, close with the close button
const plate = page.locator('.fh-fig-plate').first();
await plate.scrollIntoViewIfNeeded();
await plate.click();
await sleep(500);
check('a click on the image opens the lightbox', !!(await page.evaluate(() => document.querySelector('dialog.fh-lightbox')?.open)));
await page.click('dialog.fh-lightbox button[aria-label="Close the figure"]');
await sleep(400);
const lb2 = await page.evaluate(() => ({ open: document.querySelector('dialog.fh-lightbox')?.open ?? false, label: document.activeElement?.getAttribute('aria-label') }));
check('the close button closes the lightbox', lb2.open === false);
check('focus returns to that figure button', lb2.label?.startsWith('View figure 1 larger'), lb2.label);
// backdrop click closes
await page.locator('.fh-fig-open').first().click();
await sleep(400);
await page.mouse.click(8, 450);
await sleep(400);
check('a click outside the figure closes the lightbox', !(await page.evaluate(() => document.querySelector('dialog.fh-lightbox')?.open)));
// figure alt texts and captions
const figs = await page.$$eval('.fh-fig', (fs) => fs.map((f) => ({ alt: f.querySelector('img')?.alt?.length ?? 0, cap: f.querySelector('figcaption')?.textContent?.length ?? 0 })));
check('1 picture figure (the rest drawn live), with alt text and a caption', figs.length === 1 && figs.every((f) => f.alt > 40 && f.cap > 20), JSON.stringify(figs));

// 8. Satellite chart: tooltip on hover and the table view
const sat = page.locator('#one-scale svg[class^="plot"]').first();
await sat.scrollIntoViewIfNeeded();
await sleep(300);
const box = await sat.boundingBox();
await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.25);
await sleep(400);
const tip = await page.evaluate(() => [...document.querySelectorAll('#one-scale svg g[aria-label="tip"]')].map((g) => g.textContent).join(' '));
check('satellite chart shows a tooltip on hover', tip.length > 5, tip.slice(0, 120));
const det = page.locator('#one-scale details.ui-figure-table summary').first();
await det.click();
await sleep(300);
const rowsN = await page.evaluate(() => document.querySelector('#one-scale details.ui-figure-table[open] tbody')?.children.length ?? 0);
check('satellite chart table view opens', rowsN === 5, `rows=${rowsN}`);
const sw = await page.evaluate(() => document.documentElement.scrollWidth);
check('open table does not widen the page', sw === 1440, `scrollWidth=${sw}`);
await det.click();

// placebo chart tooltip
const pl = page.locator('#tests svg[class^="plot"]').first();
await pl.scrollIntoViewIfNeeded();
await sleep(300);
const pb = await pl.boundingBox();
let ptip = '';
for (const fx of [0.5, 0.52, 0.55, 0.6]) {
  await page.mouse.move(pb.x + pb.width * fx, pb.y + pb.height * 0.2);
  await sleep(250);
  ptip = await page.evaluate(() => [...document.querySelectorAll('#tests svg g[aria-label="tip"]')].map((g) => g.textContent).join(' '));
  if (ptip.length > 5) break;
}
check('placebo chart shows a tooltip on hover', ptip.length > 5, ptip.slice(0, 120));

// 9. Source bar tooltips do not leave the page
const tipsOk = await page.evaluate(() => [...document.querySelectorAll('.fh-src-seg')].map((s) => s.dataset.tip).filter(Boolean).length);
check('source bar has 4 described segments', tipsOk === 4, `n=${tipsOk}`);

// 10. Links into the Explorer and to the Haze page
const maluku = page.locator('#unusual-months a.fh-pg-link').first();
const mHref = await maluku.getAttribute('href');
await maluku.scrollIntoViewIfNeeded();
await maluku.click();
await sleep(1500);
const ex = await page.evaluate(() => ({ hash: location.hash, explorer: !!document.querySelector('.fh-explorer, [data-route="explorer"], .ex-root, main') }));
// the Explorer may add the month it shows to the link (area=...&month=...): the area must be the one linked
const areaOf = (h) => new URLSearchParams((h ?? '').split('?')[1] ?? '').get('area');
check('a province link opens the Explorer at that area', ex.hash.startsWith('#/?area=state:') && areaOf(ex.hash) === areaOf(mHref), `${mHref} -> ${ex.hash}`);
await page.goto(`${BASE}#/methods?section=haze`, { waitUntil: 'domcontentloaded' });
await sleep(2500);
const deep = await page.evaluate(() => ({ top: Math.round(document.getElementById('haze')?.getBoundingClientRect().top ?? -1), cur: document.querySelector('.fh-doc-toc a[aria-current="true"]')?.getAttribute('href') }));
check('deep link #/methods?section=haze scrolls to the section', deep.top > 30 && deep.top < 160, `top=${deep.top}`);
check('deep link marks the section current', deep.cur === '#/methods?section=haze', deep.cur);
const cityLink = page.locator('#haze a[href^="#/haze?city="]').nth(2);
const cHref = await cityLink.getAttribute('href');
const cName = (await cityLink.textContent()).trim();
await cityLink.click();
await sleep(2500);
const hz = await page.evaluate(() => ({ hash: location.hash, sel: document.querySelector('.fh-hz-city[aria-checked="true"] .fh-hz-city-name')?.textContent }));
check('a city link opens the Haze page with that city', hz.sel === cName && decodeURIComponent(hz.hash.replace(/\+/g, ' ')).includes(cName), `${cHref} -> ${hz.hash}, selected ${hz.sel}`);

// 11. Command palette: copy a link to this view, on Methods (fresh load, clipboard set to a sentinel first)
await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
await page.goto(`${BASE}#/methods?section=limits`, { waitUntil: 'domcontentloaded' });
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(2500);
await page.keyboard.press('Control+k');
await page.waitForSelector('.ui-palette input[role="combobox"]', { timeout: 5000 }).catch(() => null);
await page.keyboard.type('copy a link');
await page.waitForSelector('.ui-palette [role="option"][aria-selected="true"]:has-text("Copy a link")', { timeout: 5000 }).catch(() => null);
const palOpt = await page.evaluate(() => document.querySelector('.ui-palette [role="option"][aria-selected="true"]')?.textContent?.trim());
check('command palette finds "Copy a link to this view"', palOpt?.startsWith('Copy a link'), palOpt);
await page.keyboard.press('Enter');
await sleep(500);
check('command palette copy link gives the section link', (await clip(page)) === `${BASE}#/methods?section=limits`, await clip(page));
check('command palette copy link toast', (await toastText(page)).includes('Link copied'), await toastText(page));

// 12. Theme switch re-draws the charts with the new colours
await page.locator('#one-scale svg[class^="plot"]').first().scrollIntoViewIfNeeded();
await sleep(600);
const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sensor-modis').trim());
const satFill1 = await page.evaluate(() => document.querySelector('#one-scale svg[class^="plot"] rect[fill]')?.getAttribute('fill'));
await page.evaluate(() => document.querySelector('button[aria-label*="theme" i], button[aria-label*="light" i], button[aria-label*="dark" i]')?.click());
await sleep(800);
const satFill2 = await page.evaluate(() => document.querySelector('#one-scale svg[class^="plot"] rect[fill]')?.getAttribute('fill'));
const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sensor-modis').trim());
check('theme switch re-draws the satellite chart', before !== after ? satFill1 !== satFill2 : true, `${before}->${after}; ${satFill1}->${satFill2}`);

// 13. The raw record (web/eda.json): the sensors table, the live charts and their tooltips
await page.goto(`${BASE}#/methods?section=raw-record`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#raw-record .ui-table', { timeout: 20000 }).catch(() => null);
await sleep(1500);
const raw = await page.evaluate(() => {
  const s = document.getElementById('raw-record');
  return { rows: s?.querySelectorAll('.fh-mx-sensors tbody tr').length ?? 0, text: s?.innerText ?? '',
    charts: s?.querySelectorAll('svg[class^="plot"]').length ?? 0, subs: [...(s?.querySelectorAll('.fh-doc-sub-title') ?? [])].map((h) => h.textContent) };
});
check('raw record: five satellites in the table', raw.rows === 5, String(raw.rows));
for (const v of ['640,601,590', '20.12', '6.9 and 1.5', '13:33', '09:15', '6,234', '5.5', '8.9', '0.57', '31 times', '1.3 times'])
  check(`raw record says ${v}`, raw.text.includes(v), '');
check('raw record: the four parts of the report section', ['Five satellites, two kinds of hotspot', 'VIIRS sees the weak fires', 'The hour of the pass', 'No single exchange rate'].every((t) => raw.subs.includes(t)), raw.subs.join(' / '));
check('raw record: eight live charts', raw.charts >= 8, String(raw.charts));
const frp = page.locator('#raw-record svg[class^="plot"]').first();
await frp.scrollIntoViewIfNeeded();
await sleep(300);
const fb = await frp.boundingBox();
let ftip = '';
for (const fx of [0.2, 0.25, 0.3, 0.7, 0.75]) {
  await page.mouse.move(fb.x + fb.width * fx, fb.y + fb.height * 0.5);
  await sleep(250);
  ftip = await page.evaluate(() => [...document.querySelectorAll('#raw-record svg g[aria-label="tip"]')].map((g) => g.textContent).join(' '));
  if (ftip.length > 5) break;
}
check('FRP chart shows a tooltip on hover', /% of its hotspots/.test(ftip), ftip.slice(0, 120));
const small = await page.evaluate(() => [...document.querySelectorAll('#raw-record svg text, #trends svg text, [id^="fig-"] svg text')]
  .map((t) => parseFloat(getComputedStyle(t).fontSize)).filter((v) => v < 11).length);
check('no chart text under 11 px', small === 0, `${small} smaller`);

// 14. How we know it works: eight checks, a verdict each, a link that jumps to its chart
await page.goto(`${BASE}#/methods?section=tests`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.fh-ck-card', { timeout: 20000 }).catch(() => null);
await sleep(1200);
const ck = await page.evaluate(() => ({ n: document.querySelectorAll('.fh-ck-card').length, summary: document.querySelector('.fh-ck-summary')?.textContent ?? '',
  verdicts: [...document.querySelectorAll('.fh-ck-card .ui-badge')].map((b) => b.textContent), gauges: document.querySelectorAll('.fh-ck-gauge[role="img"][aria-label]').length }));
check('eight checks', ck.n === 8, String(ck.n));
check('the summary counts the passed checks', /7 of 8 checks passed/.test(ck.summary), ck.summary);
check('the summary says which checks use held out data, and does not claim all do', /5 score the model on years or regions it never saw; the other 3 test the full record/.test(ck.summary) && !/passed on data the model never saw/.test(ck.summary), ck.summary);
const kinds = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.fh-ck-card')].map((c) => [c.dataset.check, c.querySelector('.fh-ck-kind')?.dataset.kind])));
check('the seam, Pettitt and burned area checks are tests of the full record', kinds.seam === 'record' && kinds.pettitt === 'record' && kinds.burned === 'record' && kinds.heldout === 'held-out' && kinds.haze === 'held-out', JSON.stringify(kinds));
const drv = await page.evaluate(() => document.querySelector('.fh-ck-card[data-check="drivers"]')?.innerText ?? '');
check('the drivers check says rain and heat, as the report (no El Niño or fire weather in the fit)', /rain and heat/i.test(drv) && !/El Niño|fire weather/.test(drv) && /dry savannas/.test(drv) && /1,726 areas/.test(drv), drv.slice(0, 200));
const gaugeHit = await page.evaluate(() => {
  // row by row: the zero line of a row must end below the value labels of that row
  return [...document.querySelectorAll('.fh-ck-card[data-check="seam"] .fh-ck-row')].some((row) => {
    const t = row.querySelector('.fh-ck-target')?.getBoundingClientRect();
    return !!t && [...row.querySelectorAll('.fh-ck-mark-label')].some((l) => { const r = l.getBoundingClientRect(); return t.left >= r.left && t.left <= r.right && t.top < r.bottom - 0.5; });
  });
});
check('the zero line of the seam gauge does not run through its value labels', !gaugeHit);
check('each check has a verdict and a described gauge', ck.verdicts.length === 8 && ck.gauges === 8, `${ck.verdicts.join(', ')}; gauges ${ck.gauges}`);
await page.locator('.fh-ck-card[data-check="seam"] .fh-ck-link').click();
await sleep(1500);
const jump = await page.evaluate(() => Math.round(document.getElementById('fig-placebo')?.getBoundingClientRect().top ?? -1));
check('a check link scrolls to its chart', jump > 40 && jump < 160, `top=${jump}`);
await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } });
await sleep(800);
const live = await page.evaluate(() => ['fig-seam', 'fig-ladder', 'fig-mask', 'fig-outlook', 'fig-drivers', 'cal-IDN-1931', 'cal-MYS'].map((id) => document.querySelectorAll(`#${id} svg[class^="plot"]`).length));
check('the seam, ladder, mask, outlook, drivers and both calendars are drawn live', live[0] >= 1 && live[1] >= 1 && live[2] >= 1 && live[3] >= 2 && live[4] >= 2 && live[5] >= 1 && live[6] >= 1, String(live));
const maskLabels = await page.evaluate(() => [...document.querySelectorAll('#fig-mask svg text')].filter((t) => t.textContent === 'Static heat caught').length);
check('the mask chart names each test once', maskLabels === 1, String(maskLabels));
const calText = await page.evaluate(() => ({ ck: document.getElementById('cal-IDN-1931')?.innerText ?? '', my: document.getElementById('cal-MYS')?.innerText ?? '' }));
check('the Central Kalimantan calendar names the worst seasons and the ONI of September 2026, as the report', /2015, 2006 and 2026/.test(calText.ck) && /reached 2\.5/.test(calText.ck) && /November and December 2026 have no data yet/.test(calText.ck), calText.ck.slice(0, 200));
check('the Malaysia calendar says 31,911 in 2001 to 4,842 in 2025, as the report', /31,911 hotspots in 2001 to 4,842 in 2025/.test(calText.my), calText.my.slice(0, 200));
const cal = page.locator('#cal-IDN-1931 svg[class^="plot"]').first();
await cal.scrollIntoViewIfNeeded();
const cb = await cal.boundingBox();
await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.6);
await sleep(400);
const ctip = await page.evaluate(() => [...document.querySelectorAll('#cal-IDN-1931 svg g[aria-label="tip"]')].map((g) => g.textContent).join(' '));
check('the calendar shows a month and its hotspots on hover', /(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/.test(ctip) && /hotspots|No data yet/.test(ctip), ctip.slice(0, 120));
const outside = await page.evaluate(() => {
  const out = [];
  for (const svg of document.querySelectorAll('.fh-doc-body .ui-figure-plot svg')) {
    const c = svg.closest('.ui-card')?.getBoundingClientRect();
    if (!c) continue;
    for (const t of svg.querySelectorAll('text')) {
      if (t.closest('[aria-label="tip"]') || !t.textContent.trim()) continue;
      const r = t.getBoundingClientRect();
      if (r.width && (r.left < c.left - 1 || r.right > c.right + 1)) out.push(t.textContent.slice(0, 24));
    }
  }
  return out;
});
check('1440: no chart text runs past its card', outside.length === 0, outside.slice(0, 6).join(' | '));
const lap1440 = await page.evaluate(textOverlaps);
check('1440: no chart text sits on other text in its chart', lap1440.length === 0, lap1440.slice(0, 4).join(' | '));
const pair = await page.evaluate(() => {
  const all = [...document.querySelectorAll('#fig-ladder svg text')];
  // (one hexagon in one month is left out: most such months have no fire, so its error says little)
  const hexagon = all.some((t) => t.textContent === 'One hexagon, one month');
  const names = all.filter((t) => t.textContent === 'Small region, one month').map((t) => t.getBoundingClientRect());
  const bars = [...document.querySelectorAll('#fig-ladder svg rect')].map((r) => r.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 4);
  const plate = document.querySelector('.fh-mx-pair .fh-fig-plate'), img = plate?.querySelector('img');
  const cards = [...document.querySelectorAll('.fh-mx-pair .ui-card')].map((c) => Math.round(c.getBoundingClientRect().bottom));
  const pr = plate?.getBoundingClientRect();
  return { hexagon, nameRight: names[0]?.right ?? null, barLeft: bars.length ? Math.min(...bars.map((r) => r.left)) : null,
    shape: pr && img && img.naturalWidth ? (pr.height - 16) / (pr.width - 16) - img.naturalHeight / img.naturalWidth : null, cards };
});
check('the ladder leaves out one hexagon in one month (mostly empty months)', !pair.hexagon, JSON.stringify(pair));
check('1440: the ladder names sit beside their bars', pair.nameRight !== null && pair.barLeft !== null && pair.nameRight <= pair.barLeft - 4, JSON.stringify(pair));
check('1440: the picture keeps its own shape on its mat (no bright mat grows around it)', pair.shape !== null && Math.abs(pair.shape) < 0.02, JSON.stringify(pair));
check('1440: the ladder and picture cards end alike', pair.cards.length === 2 && Math.abs(pair.cards[0] - pair.cards[1]) <= 2, JSON.stringify(pair.cards));

// 15. How we test trends: the false discovery table, countries and states, the links to the trend map and Rankings
await page.goto(`${BASE}#/methods?section=trends`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#trends .ui-table', { timeout: 20000 }).catch(() => null);
await sleep(1200);
const tr = await page.evaluate(() => {
  const s = document.getElementById('trends');
  return { text: s?.innerText ?? '', links: [...(s?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href')) };
});
for (const v of ['7,449', '2,760', '810 (10.9%)', '1,950 (26.2%)', '0.63', '1,514', '48 of 49', '−6.3%*', '+109.4%'])
  check(`trends say ${v}`, tr.text.includes(v), '');
check('trends link to the trend map and to Rankings', tr.links.includes('#/?mode=trend') && tr.links.includes('#/rankings'), tr.links.slice(0, 6).join(' '));
const states = page.locator('#trends [role="radio"]:has-text("States")');
await states.scrollIntoViewIfNeeded();
await states.click();
await sleep(400);
const st = await page.evaluate(() => [...document.querySelectorAll('#trends .ui-table')].map((t) => t.innerText).find((x) => x.includes('Riau')) ?? '');
check('the States switch shows the states', st.includes('Riau, Indonesia') && st.includes('Northwest Territories'), st.slice(0, 80));
const rowOf = (name) => st.split('\n').find((l) => l.startsWith(name)) ?? '';
check('state p and q read as in the report (North Darfur 0.0003, Aktobe 0.0019, Central Kalimantan q 0.010)',
  /0\.0003\s+0\.0016/.test(rowOf('North Darfur')) && /0\.0019\s+0\.0069/.test(rowOf('Aktobe')) && /0\.0030\s+0\.010$/.test(rowOf('Central Kalimantan').trim()),
  [rowOf('North Darfur'), rowOf('Aktobe'), rowOf('Central Kalimantan')].join(' / '));
check('Brazil’s p reads 0.023, as the report', /Its p value of 0\.023 would/.test(tr.text), '');

// 16. At 1440 the text has a margin note beside it: no lede without one is taller than one screen
const ledes = await page.evaluate(() => [...document.querySelectorAll('.fh-doc-lede')].map((l) => {
  const prose = l.querySelector('.fh-doc-prose')?.getBoundingClientRect(), note = l.querySelector('.fh-doc-margin')?.getBoundingClientRect();
  return { aside: !!note, h: Math.round(l.getBoundingClientRect().height), beside: note && prose ? note.left > prose.right : null };
}));
check('margin notes sit beside the text at 1440', ledes.filter((l) => l.aside).every((l) => l.beside), JSON.stringify(ledes.filter((l) => l.aside && !l.beside)));
check('no text runs longer than a screen without a margin note', ledes.filter((l) => !l.aside).every((l) => l.h < 900), JSON.stringify(ledes.filter((l) => !l.aside && l.h >= 900)));

// 17. Phones: no sideways scroll, stacked labels never touch, tables fit at 320
for (const [w, h] of [[390, 844], [320, 640]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${BASE}#/methods`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.fh-ck-card', { timeout: 20000 }).catch(() => null);
  await sleep(2000);
  const ph = await page.evaluate(() => {
    const overlaps = [];
    for (const tr of document.querySelectorAll('.fh-pg-stack tbody tr')) {
      const ls = [...tr.querySelectorAll('.fh-pg-label')].map((l) => l.getBoundingClientRect()).filter((r) => r.width > 0);
      for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
        const a = ls[i], b = ls[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps.push(tr.querySelector('th')?.textContent?.slice(0, 30));
      }
    }
    const cut = [...document.querySelectorAll('.fh-doc-body .ui-table-wrap')].filter((w) => !w.closest('details') && w.scrollWidth > w.clientWidth + 1)
      .map((w) => `${w.closest('section')?.id}:${w.scrollWidth}/${w.clientWidth}`);
    return { sw: document.documentElement.scrollWidth, overlaps, cut };
  });
  check(`${w}px: no sideways scroll`, ph.sw === w, String(ph.sw));
  check(`${w}px: stacked table labels never overlap`, ph.overlaps.length === 0, ph.overlaps.join(', '));
  check(`${w}px: every table fits its card`, ph.cut.length === 0, ph.cut.join(', '));
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } });
  await sleep(800);
  const out = await page.evaluate(() => {
    const res = [];
    for (const svg of document.querySelectorAll('.fh-doc-body .ui-figure-plot svg')) {
      const c = svg.closest('.ui-card')?.getBoundingClientRect();
      if (!c) continue;
      for (const t of svg.querySelectorAll('text')) {
        if (t.closest('[aria-label="tip"]') || !t.textContent.trim()) continue;
        const r = t.getBoundingClientRect();
        if (r.width && (r.left < c.left - 1 || r.right > c.right + 1)) res.push(t.textContent.slice(0, 24));
      }
    }
    return res;
  });
  check(`${w}px: no chart text runs past its card`, out.length === 0, out.slice(0, 6).join(' | '));
  const lap = await page.evaluate(textOverlaps);
  check(`${w}px: no chart text sits on other text in its chart`, lap.length === 0, lap.slice(0, 4).join(' | '));
  check(`${w}px: the ladder and the picture stack`, await page.evaluate(stackedPair));
  const tiny = await page.evaluate(() => [...document.querySelectorAll('.fh-doc-body .ui-table a.fh-pg-link, .fh-doc-body button.fh-sort')]
    .map((a) => { const r = a.getBoundingClientRect(); return { t: a.textContent.trim().slice(0, 16), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => x.w > 0 && (x.w < 44 || x.h < 44)));
  check(`${w}px: every link in a table is at least 44 by 44 px`, tiny.length === 0, JSON.stringify(tiny.slice(0, 5)));
  if (w === 390) {
    // folded: each section shows its lead and first card; the page is far shorter; a fold opens with the keyboard
    await page.goto(`${BASE}#/methods`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { try { sessionStorage.removeItem('fh_db_open'); } catch {} });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.fh-ck-card', { timeout: 20000 }).catch(() => null);
    await sleep(2500);
    const fold = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, folds: [...document.querySelectorAll('.db-fold')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => b.textContent) }));
    check('390px: folded, the page is under 20,000 px', fold.h < 20000, String(fold.h));
    check('390px: each long section ends with "Show the detail (…)"', fold.folds.length >= 6 && fold.folds.every((t) => /^Show the detail \(/.test(t)), fold.folds.slice(0, 3).join(' | '));
    const btn = page.locator('.db-fold').first();
    await btn.focus();
    await page.keyboard.press('Enter');
    await sleep(400);
    check('390px: a fold opens with the keyboard', (await btn.getAttribute('aria-expanded')) === 'true', '');
    await page.keyboard.press('Enter');
    await sleep(300);
    const sel = await page.evaluate(() => { const s = document.querySelector('.fh-doc-toc-select select'); return s ? { opts: s.options.length, h: Math.round(s.getBoundingClientRect().height) } : null; });
    check('390px: the contents are one select of 44 px', !!sel && sel.opts === 10 && sel.h >= 44, JSON.stringify(sel));
    await page.selectOption('.fh-doc-toc-select select', 'haze');
    await sleep(2500);
    const at = await page.evaluate(() => ({ hash: location.hash, top: Math.round(document.getElementById('haze')?.getBoundingClientRect().top ?? -1) }));
    check('390px: the select goes to its section', at.hash === '#/methods?section=haze' && at.top > 0 && at.top < 220, JSON.stringify(at));
    const lead = await page.evaluate(() => { const l = document.querySelector('.ui-lead'); return l ? Math.round(l.getBoundingClientRect().height / parseFloat(getComputedStyle(l).lineHeight)) : 0; });
    check('390px: the lead folds to two lines', lead === 2, String(lead));
  }
}

// 18. A small laptop (1024): the ladder and the picture stack, so the names sit beside the bars and the picture is large
await page.setViewportSize({ width: 1024, height: 768 });
await page.goto(`${BASE}#/methods?section=one-scale`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#fig-ladder svg[class^="plot"]', { timeout: 20000 }).catch(() => null);
await sleep(1500);
const at1024 = await page.evaluate(() => {
  const name = [...document.querySelectorAll('#fig-ladder svg text')].find((t) => t.textContent === 'Small region, one month')?.getBoundingClientRect();
  const bars = [...document.querySelectorAll('#fig-ladder svg rect')].map((r) => r.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 4);
  return { beside: !!name && bars.length > 0 && name.right <= Math.min(...bars.map((r) => r.left)) - 4,
    plate: Math.round(document.querySelector('.fh-mx-pair .fh-fig-plate')?.getBoundingClientRect().width ?? 0) };
});
check('1024: the ladder and the picture stack', await page.evaluate(stackedPair));
check('1024: the ladder names sit beside their bars and the picture is at least 600 px wide', at1024.beside && at1024.plate >= 600, JSON.stringify(at1024));
check('1024: no chart text sits on other text in its chart', (await page.evaluate(textOverlaps)).length === 0);

console.log(`Methods (${theme}):`);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? `  [${r.detail}]` : ''}`);
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
console.log('console problems:', errors.length ? errors : 'none');
await browser.close();
