// Function tests for #/data: copy buttons and toasts, citation tabs, code tabs, sortable files table, file sizes,
// download toast, source links, deep link, phone layout; one copy button style in one place, inline code that keeps
// the line height, and the app's own files (web/) with their sizes.
// Usage: node scripts/test_data.mjs [base address ending in /] [dark|light]
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';   // or a preview or live address ending in /
const theme = process.argv[3] ?? 'dark';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
await ctx.addInitScript((t) => { try { localStorage.setItem('fh_theme', t); } catch {} }, theme);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`.slice(0, 240)); });
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 240)}`));
const toastText = () => page.evaluate(() => [...document.querySelectorAll('.ui-toast')].map((t) => t.textContent.trim()).join(' | '));
const clip = () => page.evaluate(() => navigator.clipboard.readText());
const reset = () => page.evaluate(() => navigator.clipboard.writeText('sentinel'));
const waitToast = async (text) => { for (let i = 0; i < 20; i++) { if ((await toastText()).includes(text)) return true; await sleep(100); } return false; };

await page.goto(`${BASE}#/data`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#sources .ui-table', { timeout: 15000 }).catch(() => null);
await sleep(1200);

// 1. The header links to the citation (the copy buttons live in their blocks, one style in one place)
await page.click('.ui-page-header a:has-text("How to cite")');
await sleep(1500);
const citeTop = await page.evaluate(() => Math.round(document.getElementById('cite')?.getBoundingClientRect().top ?? -1));
check('header: How to cite scrolls to the citation', citeTop > 30 && citeTop < 160, `top=${citeTop}`);
await reset();
await page.locator('#cite .fh-copy').first().click();
check('the citation copy shows "Citation copied"', await waitToast('Citation copied'), await toastText());
const cite = await clip();
check('the citation is on the clipboard', cite.startsWith('Fire Harmony (2026)'), cite.slice(0, 80));
await sleep(250);   // the 140 ms crossfade
const btnState = await page.evaluate(() => {
  const b = document.querySelector('#cite .fh-copy');
  const on = b?.querySelector('.fh-copy-face[data-on]');
  return { copied: b?.getAttribute('data-copied'), face: on?.textContent, visible: on ? getComputedStyle(on).visibility : '' };
});
check('the copy button turns to Copied with a check', btnState.copied === '' && btnState.face === 'Copied' && btnState.visible === 'visible', JSON.stringify(btnState));
await sleep(1600);
const back = await page.evaluate(() => document.querySelector('#cite .fh-copy .fh-copy-face[data-on]')?.textContent);
check('after 1.5 s it says Copy again', back === 'Copy', back);
// every copy button sits the same distance from its block's top right corner
const corners = await page.evaluate(() => [...document.querySelectorAll('.fh-code-box .fh-copy, .fh-cite .fh-copy')].map((b) => {
  const box = b.closest('.fh-code-box, .fh-cite').getBoundingClientRect(), r = b.getBoundingClientRect();
  return { top: Math.round(r.top - box.top), right: Math.round(box.right - r.right), h: Math.round(r.height) };
}));
const same = corners.every((c) => Math.abs(c.top - corners[0].top) <= 2 && Math.abs(c.right - corners[0].right) <= 2);
check('every copy button sits at the top right of its block, the same distance from the corner', corners.length >= 4 && same, JSON.stringify(corners));
check('copy buttons are 32 px ghost buttons', corners.every((c) => c.h === 32), JSON.stringify(corners.map((c) => c.h)));

// 2. At a glance numbers
const glance = await page.evaluate(() => document.getElementById('at-a-glance')?.innerText ?? '');
for (const v of ['312', '443 million', '4,330', '640.6 million', 'GB', '781 hotspot files']) check(`at a glance shows ${v}`, glance.includes(v), glance.replace(/\s+/g, ' ').slice(-160));

// 3. Sources: 11 rows, links open a new tab safely
const src = await page.$$eval('#sources tbody tr', (rs) => rs.map((r) => { const a = r.querySelector('a'); return { name: a?.textContent?.trim(), href: a?.href, target: a?.target, rel: a?.rel }; }));
check('11 sources', src.length === 11, src.map((s) => s.name).join(', '));
check('every source links out in a new tab with rel=noreferrer', src.every((s) => s.href?.startsWith('https://') && s.target === '_blank' && s.rel.includes('noreferrer')), JSON.stringify(src.filter((s) => !(s.href?.startsWith('https://') && s.target === '_blank'))));
for (const n of ['NASA FIRMS', 'NASA LP DAAC', 'NASA GES DISC', 'NASA GISS GFWED', 'NASA SEDAC GPW', 'ESA Fire_cci', 'PEATMAP', 'GIHS', 'Natural Earth', 'NOAA', 'OpenFreeMap'])
  check(`source listed: ${n}`, src.some((s) => s.name?.includes(n)));

// 4. Citation tabs: click and arrow keys; copy follows the shown format
const tabs = page.locator('#cite [role="tablist"][aria-label="Citation format"] [role="tab"]');
await tabs.nth(1).click();
await sleep(200);
let panel = await page.evaluate(() => document.querySelector('#cite [role="tabpanel"]')?.textContent ?? '');
check('BibTeX tab shows BibTeX', panel.includes('@'), panel.slice(0, 60));
await reset();
await page.click('#cite .ui-card:first-of-type .fh-copy, #cite .fh-copy >> nth=0');
await waitToast('Citation copied');
const bib = await clip();
check('copy in the BibTeX tab copies BibTeX', bib.trim().startsWith('@'), bib.slice(0, 60));
await tabs.nth(1).focus();
await page.keyboard.press('ArrowLeft');
await sleep(200);
const sel = await page.evaluate(() => [...document.querySelectorAll('#cite [role="tablist"][aria-label="Citation format"] [role="tab"]')].map((t) => `${t.textContent}:${t.getAttribute('aria-selected')}:${t === document.activeElement}`).join(' '));
check('ArrowLeft moves to the Text tab and focuses it', sel.startsWith('Text:true:true'), sel);

// 5. Acknowledge NASA FIRMS
await reset();
await page.locator('#cite .fh-copy').nth(1).click();
check('Acknowledgement copied toast', await waitToast('Acknowledgement copied'), await toastText());
check('the FIRMS sentence is on the clipboard', (await clip()).startsWith('We acknowledge the use of data'), (await clip()).slice(0, 60));

// 6. Months covered
const months = await page.evaluate(() => document.getElementById('months')?.innerText ?? '');
check('months: first full month November 2000', months.includes('November 2000'));
check('months: latest full month October 2026', months.includes('October 2026'));
check('months: VIIRS observed from February 2012', months.includes('February 2012 to October 2026'));
check('months: 20 + 115 + 177 + 1 months', ['20 months', '115 months', '177 months', '1 month'].every((m) => months.includes(m)));

// 7. Files: sizes from meta.json and measured JSON sizes, sorting with aria-sort
await page.locator('#files').scrollIntoViewIfNeeded();
await sleep(1500);
const files = () => page.$$eval('#files tbody tr', (rs) => rs.map((r) => [...r.children].map((c) => c.textContent.trim())));
let f = await files();
check('19 files listed', f.length === 19, String(f.length));
const hsRow = f.find((r) => r[0].startsWith('hotspots/ (')), hsIdx = f.find((r) => r[0] === 'hotspots/index.json');
check('the hotspot files: 781 files, 640,601,590 rows, 6.5 GB', hsRow && hsRow[0] === 'hotspots/ (781 files)' && hsRow[2] === '640,601,590' && hsRow[3] === '6.5 GB', JSON.stringify(hsRow));
check('the hotspot index: 781 regions and a measured size', hsIdx && hsIdx[2] === '781 regions' && /kB$/.test(hsIdx[3]), JSON.stringify(hsIdx));
const dashes = f.filter((r) => r[3] === '–').map((r) => r[0]);
check('every file has a size', dashes.length === 0, dashes.join(', '));
const order0 = f.map((r) => r[0]).join(',');
const sizeBtn = page.locator('#files thead button:has-text("Size")');
await sizeBtn.click();
await sleep(200);
let sortAttr = await page.evaluate(() => [...document.querySelectorAll('#files thead th')].map((t) => t.getAttribute('aria-sort')));
f = await files();
check('first click on Size sorts largest first (aria-sort descending)', sortAttr[3] === 'descending' && f[0][0].startsWith('hotspots/ ('), `${sortAttr} first=${f[0][0]}`);
check('only the sorted column has aria-sort', sortAttr.filter(Boolean).length === 1, String(sortAttr));
await sizeBtn.click();
await sleep(200);
sortAttr = await page.evaluate(() => [...document.querySelectorAll('#files thead th')].map((t) => t.getAttribute('aria-sort')));
f = await files();
// (the order is read from the sizes shown, not a file name: a republish changes which file is smallest)
const bytesOf = (s) => { const m = /([\d.,]+)\s*(bytes|kB|MB|GB)/.exec(s); return m ? parseFloat(m[1].replace(/,/g, '')) * { bytes: 1, kB: 1e3, MB: 1e6, GB: 1e9 }[m[2]] : NaN; };
const ascending = f.every((r, i) => i === 0 || bytesOf(f[i - 1][3]) <= bytesOf(r[3]));
check('second click sorts smallest first (ascending)', sortAttr[3] === 'ascending' && ascending, `${sortAttr} first=${f[0][0]} ${f[0][3]}`);
await sizeBtn.click();
await sleep(200);
sortAttr = await page.evaluate(() => [...document.querySelectorAll('#files thead th')].map((t) => t.getAttribute('aria-sort')));
check('third click goes back to the first order', sortAttr.every((a) => a === null) && (await files()).map((r) => r[0]).join(',') === order0, String(sortAttr));
await page.locator('#files thead button:has-text("File")').focus();
await page.keyboard.press('Enter');
await sleep(200);
sortAttr = await page.evaluate(() => document.querySelectorAll('#files thead th')[0].getAttribute('aria-sort'));
f = await files();
check('Enter on File sorts A to Z', sortAttr === 'ascending' && f[0][0] === 'area_monthly.parquet', `${sortAttr} first=${f[0][0]}`);
await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
await page.locator('#files thead button:has-text("Rows")').click();
await sleep(200);
f = await files();
check('Rows sorts the most rows first', f[0][0].startsWith('hotspots/ (') && f[1][0].startsWith('l5/'), `${f[0][0]}, ${f[1][0]}`);
await page.locator('#files thead button:has-text("Rows")').click();
await page.locator('#files thead button:has-text("Rows")').click();

// 8. A file link downloads and says so
const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
const pop = ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null);
await page.locator('#files a.fh-dt-file:has-text("haze.json")').click();
check('a file click shows "Downloading haze.json (...)"', await waitToast('Downloading haze.json ('), await toastText());
const d = await dl;
check('the browser downloads the file', d !== null && d.suggestedFilename().includes('haze'), d ? d.suggestedFilename() : 'no download event');
const p2 = await pop; if (p2) await p2.close();
const hrefs = await page.$$eval('#files a.fh-dt-file', (as) => as.map((a) => a.getAttribute('href')));
check('every file link points at the data folder', hrefs.length === 17 && hrefs.every((h) => /data\//.test(h)), hrefs.slice(0, 3).join(' '));

// 8b. Columns: the record files and the hotspot files
const colTables = await page.$$eval('#columns table', (ts) => ts.map((t) => t.querySelectorAll('tbody tr').length));
check('two column tables: 8 record columns and 10 hotspot columns', colTables.length === 2 && colTables[0] === 8 && colTables[1] === 10, String(colTables));
const satText = await page.evaluate(() => [...document.querySelectorAll('#columns tbody tr')].find((r) => r.textContent.startsWith('satellite'))?.textContent ?? '');
check('the satellite values are written as stored', satText.includes('Suomi-NPP') && satText.includes('NOAA-21'), satText);

// 9. Code tabs and copy
const ctabs = page.locator('#use [role="tab"]');
await ctabs.nth(1).click();
await sleep(200);
check('Python tab shows Python', (await page.textContent('#use pre')).includes('import duckdb'));
await reset();
await page.locator('#use .fh-copy').click();
check('Python copied toast', await waitToast('Python copied'), await toastText());
check('the Python example is on the clipboard', (await clip()).includes('import duckdb'));
await ctabs.nth(1).focus();
await page.keyboard.press('ArrowRight');
await sleep(150);
check('ArrowRight wraps to the SQL tab', (await page.evaluate(() => document.activeElement?.textContent)) === 'DuckDB SQL' && (await page.textContent('#use pre')).includes('read_parquet'));
await reset();
await page.locator('#use .fh-copy').click();
check('SQL copied toast', await waitToast('SQL copied'), await toastText());
const sql = await clip();
check('the SQL example is on the clipboard, with the real file address', sql.includes("read_parquet('http://127.0.0.1:5173/") && sql.includes('area_monthly.parquet'), sql.slice(0, 160));
const codeLabel = await page.locator('#use .fh-copy').getAttribute('aria-label');
check('the code copy button names what it copies', /Copy the .* example/.test(codeLabel ?? ''), codeLabel);

// 10. Deep link and scrollspy on Data
await page.goto(`${BASE}#/data?section=columns`, { waitUntil: 'domcontentloaded' });
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(2500);
const deep = await page.evaluate(() => ({ top: Math.round(document.getElementById('columns').getBoundingClientRect().top), cur: document.querySelector('.fh-doc-toc a[aria-current="true"]')?.getAttribute('href') }));
check('deep link #/data?section=columns scrolls there', deep.top > 30 && deep.top < 160, `top=${deep.top}`);
check('deep link marks Columns current', deep.cur === '#/data?section=columns', deep.cur);

// 10b. Inline code keeps the line height: a note line with code is as tall as a line without
const lines = await page.evaluate(() => {
  const note = [...document.querySelectorAll('#use .ui-note')].find((n) => n.querySelector('code'));
  if (!note) return null;
  const code = note.querySelector('code').getBoundingClientRect(), lh = parseFloat(getComputedStyle(note).lineHeight);
  return { code: Math.round(code.height), lh: Math.round(lh), border: getComputedStyle(note.querySelector('code')).borderTopWidth };
});
check('inline code chips are no taller than a line and have no border', lines && lines.code <= lines.lh && lines.border === '0px', JSON.stringify(lines));

// 10c. The app's own files: six cards with fields, measured sizes, and code to read them
await page.goto(`${BASE}#/data?section=app-files`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.fh-wf-card', { timeout: 15000 }).catch(() => null);
let wf = null;
for (let i = 0; i < 30; i++) {
  wf = await page.evaluate(() => [...document.querySelectorAll('.fh-wf-card')].map((c) => ({ key: c.dataset.file, files: [...c.querySelectorAll('.fh-wf-file code')].map((x) => x.textContent),
    sizes: [...c.querySelectorAll('.fh-wf-size')].map((x) => x.textContent), fields: c.querySelectorAll('.fh-wf-fields > div').length, count: c.querySelector('.fh-wf-count')?.textContent ?? '' })));
  if (wf.filter((c) => c.key !== 'archive').every((c) => c.sizes.every((z) => /B$/.test(z)))) break;
  await sleep(300);
}
check('six cards for the app files', wf.length === 6, wf.map((c) => c.key).join(', '));
const names = wf.flatMap((c) => c.files);
for (const n of ['universe_l3.json', 'trend_l3.json', 'trend_l4.json', 'places.json', 'cities.json', 'eda.json', 'v1.0/site_data.tar.gz'])
  check(`app files list ${n}`, names.includes(n), names.join(', '));
check('a map year file is listed', names.some((n) => /^map_l3\/\d{4}\.json$/.test(n)), names.join(', '));
check('every local file has a measured size', wf.filter((c) => c.key !== 'archive').every((c) => c.sizes.every((z) => /\d.*B$/.test(z))), JSON.stringify(wf.map((c) => c.sizes)));
check('each card lists the fields', wf.every((c) => c.fields >= 2), JSON.stringify(wf.map((c) => c.fields)));
check('the map card counts the year files from index.json', /\d+ year files, \d{4} to \d{4}/.test(wf.find((c) => c.key === 'map')?.count ?? ''), wf.find((c) => c.key === 'map')?.count);
const trendFields = await page.evaluate(() => document.querySelector('.fh-wf-card[data-file="trend"]')?.innerText ?? '');
check('the trend files name mean and q', /\bmean\b/.test(trendFields) && /\bq\b/.test(trendFields) && trendFields.includes('Benjamini'), '');
const placeFields = await page.evaluate(() => document.querySelector('.fh-wf-card[data-file="places"]')?.innerText ?? '');
check('the places file names trend_tested, trend_q and barren_pct', ['trend_tested', 'trend_q', 'barren_pct'].every((f) => placeFields.includes(f)), '');
const jsTab = page.locator('#app-files [role="tab"]:has-text("JavaScript")');
check('the app files have a JavaScript example', (await jsTab.count()) === 1);
await reset();
await page.locator('#app-files .fh-copy').click();
check('JavaScript copied', await waitToast('JavaScript copied'), await toastText());
check('the JavaScript example reads trend_l3.json', (await clip()).includes('trend_l3.json'), (await clip()).slice(0, 80));

// 10b. The counts and their labels; the report beside the page actions; the rest of the project in the footer
{
  await page.goto(`${BASE}#/data`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /Places, with the world\s*[\d,]+/.test(document.querySelector('#at-a-glance')?.innerText ?? ''), null, { timeout: 30000 }).catch(() => null);
  const g = (await page.evaluate(() => document.querySelector('#at-a-glance')?.innerText ?? '')).replace(/[\u2010\u2011]/g, '-');
  const truth = await page.evaluate(async () => ({ places: (await (await fetch('data/web/places.json')).json()).rows.length,
    rows: (await (await fetch('data/meta.json')).json()).files.hotspots.rows, total: (await (await fetch('data/dashboard.json')).json()).record.hotspots_total }));
  const fmt = (n) => n.toLocaleString('en-GB');
  check('Places, with the world: the rows of places.json (the Rankings count)', g.includes(`Places, with the world\n${fmt(truth.places)}`) || new RegExp(`Places, with the world\\s*${fmt(truth.places)}`).test(g), g.slice(0, 300));
  check('no stale count of 4,333 places', !g.includes('4,333'), '');
  check('Detections read: 640.6 million', new RegExp(`Detections read\\s*${(truth.rows / 1e6).toFixed(1)} million`).test(g), '');
  check('Hotspots on the NOAA-20 scale: 443 million', new RegExp(`Hotspots on the NOAA-20 scale\\s*${Math.round(truth.total / 1e6)} million`).test(g), '');
  check('a tooltip links the two totals', await page.evaluate(() => [...document.querySelectorAll('#at-a-glance .db-hint')].some((h) => /detections of five satellites/.test(h.getAttribute('aria-label') ?? ''))), '');
  const rep = await page.evaluate(() => [...document.querySelectorAll('.ui-page-header a')].find((a) => /Read the full report/.test(a.textContent))?.getAttribute('href'));
  check('Read the full report (PDF) beside the page actions', rep === './Fire_Harmony_report.pdf', String(rep));
  const WANT = { 'Report PDF': './Fire_Harmony_report.pdf', 'Poster PDF': './Fire_Harmony_poster.pdf', 'Code on GitHub': 'https://github.com/Warren-530/fire-harmony',
    'Dataset on Hugging Face': 'https://huggingface.co/datasets/warrensaw530/fire-harmony', 'About the project': './hub.html' };
  const foot = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.fh-footer-project a')].map((a) => [a.textContent.trim(), a.getAttribute('href')])));
  check('1440: the footer has the project group with its five links', Object.entries(WANT).every(([k, v]) => foot[k] === v), JSON.stringify(foot));
  for (const h of ['./Fire_Harmony_report.pdf', './Fire_Harmony_poster.pdf', './hub.html']) {
    const r = await page.request.get(new URL(h, BASE).toString());
    check(`${h} answers`, r.ok(), String(r.status()));
  }
  // phones: the same links in the footer and in the page menu, under the pages
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(600);
  const foot390 = await page.evaluate(() => [...document.querySelectorAll('.fh-footer-project a')].filter((a) => a.getBoundingClientRect().height >= 44).length);
  check('390: the footer project links, 44 px each', foot390 === 5, String(foot390));
  await page.click('.fh-menu-btn');
  await sleep(500);
  const menu = await page.evaluate(() => {
    const pages = document.querySelector('.fh-menu-list')?.getBoundingClientRect(), proj = document.querySelector('.fh-menu-project')?.getBoundingClientRect();
    return { links: [...document.querySelectorAll('.fh-menu-project a')].map((a) => a.getAttribute('href')), under: !!pages && !!proj && proj.top >= pages.bottom };
  });
  check('390: the page menu lists the project under the pages', menu.under && Object.values(WANT).every((v) => menu.links.includes(v)), JSON.stringify(menu));
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.setViewportSize({ width: 320, height: 640 });
  await sleep(600);
  check('320: no sideways scroll with the project links', (await page.evaluate(() => document.documentElement.scrollWidth)) === 320, '');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}#/data`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
}

// 11. Page width and console
const sw = await page.evaluate(() => document.documentElement.scrollWidth);
check('no sideways scroll at 1440', sw === 1440, String(sw));

// 12. Phone: stacked tables, sort bar still works
await page.setViewportSize({ width: 390, height: 860 });
await page.goto(`${BASE}#/data?section=files`, { waitUntil: 'domcontentloaded' });
await sleep(1800);
const phone = await page.evaluate(() => ({
  sw: document.documentElement.scrollWidth,
  rowDisplay: getComputedStyle(document.querySelector('#files tbody tr')).display,
  srcDisplay: getComputedStyle(document.querySelector('#sources tbody tr')).display,
  label: getComputedStyle(document.querySelector('#sources .fh-pg-label')).display,
  sizeLabel: getComputedStyle(document.querySelector('#files tbody td.ui-num'), '::before').content,
}));
check('phone: no sideways scroll', phone.sw === 390, String(phone.sw));
check('phone: files become cards', phone.rowDisplay === 'flex', phone.rowDisplay);   // flex, so rows and size wrap at 320 px
check('phone: sources become cards with labels', phone.srcDisplay === 'grid' && phone.label === 'block', `${phone.srcDisplay} ${phone.label}`);
check('phone: number cells name their column', phone.sizeLabel.includes('Rows'), phone.sizeLabel);
await page.locator('#files thead button:has-text("Size")').click();
await sleep(200);
f = await files();
check('phone: the sort bar still sorts', f[0][0].startsWith('hotspots/ (') && f[1][0].startsWith('l5/'), `${f[0][0]}, ${f[1][0]}`);
const tocChip = await page.evaluate(() => { const a = document.querySelector('.fh-doc-toc a[aria-current="true"]'); const l = a?.closest('ol'); if (!a || !l) return 'none'; const r = a.getBoundingClientRect(), lr = l.getBoundingClientRect(); return r.left >= lr.left - 1 && r.right <= lr.right + 1 ? 'visible' : `off ${Math.round(r.left)}..${Math.round(r.right)} in ${Math.round(lr.left)}..${Math.round(lr.right)}`; });
check('phone: the active chip of the section bar is in view', tocChip === 'visible', tocChip);
const sorts = await page.$$eval('#files thead button.fh-sort', (bs) => bs.map((x) => [x.textContent.trim(), Math.round(x.getBoundingClientRect().width), Math.round(x.getBoundingClientRect().height)]));
check('phone: the sort buttons are at least 44 by 44 px', sorts.length > 0 && sorts.every(([, bw, bh]) => bw >= 44 && bh >= 44), JSON.stringify(sorts));
// the copy buttons keep their corner on a narrow phone too (the tabs give way, the button never drops to a new row)
for (const w of [390, 320]) {
  await page.setViewportSize({ width: w, height: 760 });
  await page.goto(`${BASE}#/data?section=cite`, { waitUntil: 'domcontentloaded' });
  await sleep(1600);
  const c = await page.evaluate(() => [...document.querySelectorAll('.fh-code-box .fh-copy, .fh-cite .fh-copy')].map((b) => {
    const box = b.closest('.fh-code-box, .fh-cite').getBoundingClientRect(), r = b.getBoundingClientRect();
    return { top: Math.round(r.top - box.top), right: Math.round(box.right - r.right) };
  }));
  const sameHere = c.every((x) => Math.abs(x.top - c[0].top) <= 2 && Math.abs(x.right - c[0].right) <= 2);
  check(`${w}px: every copy button stays at the top right of its block`, c.length >= 4 && sameHere, JSON.stringify(c));
  check(`${w}px: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth)) === w);
}

console.log(`Data (${theme}):`);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? `  [${r.detail}]` : ''}`);
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
console.log('console problems:', errors.length ? errors : 'none');
await browser.close();
