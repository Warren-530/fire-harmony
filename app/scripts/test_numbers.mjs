// Every "Show the numbers" table view keeps its card: on the Dashboard, Methods, Haze and the Explorer's Overview and
// Period tabs, at 1440, 1280, 1024, 820, 390 and 320 px (dark; light at 1440 and 390), each table view is opened and
// closed in turn, and the card's width, the chart's width and the page's width must not move; the open table must stay
// inside its card, take a row of its own under the source line, scroll inside the card (at most 320 px tall, its
// column names stuck on top) and fade at an edge with more to see.
// Usage: node scripts/test_numbers.mjs [baseUrl]     (default http://127.0.0.1:5173/; run with nice -n 15)
import { chromium } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';
const SIZES = [[1440, 900], [1280, 800], [1024, 768], [820, 1180], [390, 844], [320, 640]];
const PAGES = [
  { name: 'Dashboard', hash: '#/dashboard', ready: '.db-body .ui-figure-plot svg' },
  { name: 'Methods', hash: '#/methods', ready: '.ui-figure-plot svg' },
  { name: 'Haze', hash: '#/haze', ready: '.ui-figure-plot svg' },
  { name: 'Explorer overview', hash: '#/?area=country:IDN&tab=overview', ready: '.fh-ex[data-series-ready="true"] .fh-ex-chart .ui-figure-plot svg', explorer: true },
  { name: 'Explorer period', hash: '#/?area=country:IDN&tab=period', ready: '.fh-ex[data-series-ready="true"] .pp-chart-plot svg', explorer: true },
];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`); };
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A press on "Show the numbers" (a real click; a click by script if something sticky covers it for a moment). */
const toggle = async (det) => {
  const s = det.locator('summary');
  await s.click({ timeout: 4000 }).catch(() => s.evaluate((el) => el.click()));
};

async function run(theme, [w, h]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await ctx.addInitScript((t) => { try { localStorage.setItem('fh_theme', t); localStorage.setItem('fh_welcome_seen', '1'); } catch { /* */ } }, theme);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${w} ${theme}: ${String(e).slice(0, 200)}`));
  for (const p of PAGES) {
    await page.goto(`${BASE}${p.hash}`, { waitUntil: 'domcontentloaded' });
    const ok = await page.waitForSelector(p.ready, { timeout: 90_000, state: 'attached' }).then(() => true, () => false);
    if (!ok) { check(`${p.name} ${w}px ${theme}: loads`, false, 'no chart'); continue; }
    await sleep(p.explorer ? 2500 : 1800);
    // on a phone the Explorer's panel is a sheet: open it full
    if (p.explorer && w <= 768) {
      for (let k = 0; k < 3; k++) {
        if ((await page.locator('.fh-ex-sheet[data-size="full"]').count()) > 0) break;
        await page.locator('.fh-ex-grip').click().catch(() => undefined);
        await sleep(600);
      }
    }
    // open every folded part (phones fold the sections), so every table view is on the page
    for (let k = 0; k < 16; k++) {
      const folded = page.locator('.db-fold[aria-expanded="false"]:visible');
      if (!(await folded.count())) break;
      await folded.first().click({ timeout: 4000 }).catch(() => undefined);
      await sleep(250);
    }
    const sel = p.explorer ? '.fh-ex-panel details.ui-figure-table, .fh-ex-panel details.pp-numbers' : 'details.ui-figure-table';
    const n = await page.locator(sel).count();
    const bad = [];
    let opened = 0, scrolled = 0, sticky = 0;
    for (let i = 0; i < n; i++) {
      const det = page.locator(sel).nth(i);
      if (!(await det.isVisible().catch(() => false))) continue;
      // (in the middle of the window: clear of the sticky header and contents bar)
      // (and long enough for a section that comes into view to finish rising in: sizes are read from the layout, not
      // from boxes that a transform still scales)
      await det.evaluate((d) => d.scrollIntoView({ block: 'center' })).catch(() => undefined);
      await sleep(500);
      const before = await det.evaluate((d) => {
        const card = d.closest('.ui-card') ?? d.closest('.ui-figure, .pp-chart') ?? d.parentElement;
        const fig = d.closest('.ui-figure, .pp-chart');
        const svg = fig?.querySelector('.ui-figure-plot svg, .pp-chart-plot svg');
        return { w: card.offsetWidth, svg: svg ? Math.round(svg.clientWidth || Number(svg.getAttribute('width'))) : null, sw: document.documentElement.scrollWidth };
      });
      await toggle(det);
      await sleep(450);   // the charts redraw 150 ms after a change of width (none should come)
      const open = await det.evaluate((d) => {
        const card = d.closest('.ui-card') ?? d.closest('.ui-figure, .pp-chart') ?? d.parentElement;
        const fig = d.closest('.ui-figure, .pp-chart');
        const svg = fig?.querySelector('.ui-figure-plot svg, .pp-chart-plot svg');
        const box = d.querySelector('.ui-table-scroll');
        const r = card.getBoundingClientRect(), b = box?.getBoundingClientRect();
        const src = d.parentElement?.querySelector(':scope > .ui-figure-source')?.getBoundingClientRect();
        const th = box?.querySelector('thead th');
        return {
          open: d.open, w: card.offsetWidth, svg: svg ? Math.round(svg.clientWidth || Number(svg.getAttribute('width'))) : null,
          sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth,
          box: b ? { l: Math.round(b.left), r: Math.round(b.right), h: Math.round(b.height) } : null,
          cardR: Math.round(r.right), cardL: Math.round(r.left),
          scrolls: box ? box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1 : false,
          tall: box ? box.scrollHeight > box.clientHeight + 1 : false, more: box?.dataset.more ?? '',
          sticky: th ? getComputedStyle(th).position === 'sticky' : false,
          below: !src || !b ? true : b.top >= src.bottom - 1,
        };
      });
      opened++;
      if (open.scrolls) scrolled++;
      if (open.sticky) sticky++;
      const why = [];
      if (!open.open) why.push('did not open');
      if (Math.abs(open.w - before.w) > 1) why.push(`card ${before.w} -> ${open.w} px`);
      if (before.svg !== null && open.svg !== null && Math.abs(open.svg - before.svg) > 1) why.push(`chart ${before.svg} -> ${open.svg}`);
      if (open.sw > open.vw + 1 || open.sw !== before.sw) why.push(`page ${before.sw} -> ${open.sw} (window ${open.vw})`);
      if (!open.box) why.push('no scroller');
      else {
        if (open.box.r > open.cardR + 1 || open.box.l < open.cardL - 1) why.push(`table ${open.box.l}..${open.box.r} outside card ${open.cardL}..${open.cardR}`);
        if (open.box.h > 321) why.push(`table ${open.box.h} px tall`);
        // (read again once if missing: a software rendered frame can be late)
        if (open.tall && !/down/.test(open.more)) {
          await sleep(500);
          const more = await det.evaluate((d) => d.querySelector('.ui-table-scroll')?.dataset.more ?? '');
          if (!/down/.test(more)) why.push('no fade at the bottom');
        }
      }
      if (!open.sticky) why.push('header not sticky');
      if (!open.below) why.push('not under the source line');
      await toggle(det);
      await sleep(350);
      const after = await det.evaluate((d) => {
        const card = d.closest('.ui-card') ?? d.closest('.ui-figure, .pp-chart') ?? d.parentElement;
        return { open: d.open, w: card.offsetWidth, sw: document.documentElement.scrollWidth };
      });
      if (after.open || Math.abs(after.w - before.w) > 1 || after.sw !== before.sw) why.push(`after closing: open ${after.open}, card ${after.w}, page ${after.sw}`);
      if (why.length) bad.push(`#${i} ${why.join('; ')}`);
    }
    check(`${p.name} ${w}px ${theme}: ${opened} table views keep their card`, opened > 0 && bad.length === 0,
      bad.length ? bad.slice(0, 4).join(' | ') : `${opened} opened, ${scrolled} scroll inside, ${sticky} with stuck column names`);
  }
  await ctx.close();
}

for (const s of SIZES) await run('dark', s);
for (const s of [SIZES[0], SIZES[4]]) await run('light', s);
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`${results.filter((r) => r.ok).length} of ${results.length} checks passed.`);
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
