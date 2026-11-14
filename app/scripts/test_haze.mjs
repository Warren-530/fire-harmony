// Function tests for #/haze: city picker (click and arrow keys), address, copy link, season select and bar click,
// tooltips and table views, chips into the Explorer, deep link, theme re-draw, phone width; the fire within 50 km of
// each city in the Explorer and on the Dashboard, the season card with no hole, touch targets.
// Usage: node scripts/test_haze.mjs [base address ending in /] [dark|light]
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`.slice(0, 240)); });
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 240)}`));
const toastText = () => page.evaluate(() => [...document.querySelectorAll('.ui-toast')].map((t) => t.textContent.trim()).join(' | '));
const waitToast = async (text) => { for (let i = 0; i < 20; i++) { if ((await toastText()).includes(text)) return true; await sleep(100); } return false; };
const selected = () => page.evaluate(() => document.querySelector('.fh-hz-city[aria-checked="true"] .fh-hz-city-name')?.textContent);
const hashCity = () => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('city'));

await page.goto(`${BASE}#/haze`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.fh-hz-city', { timeout: 20000 }).catch(() => null);
await page.waitForSelector('.fh-chart-plot svg, .ui-figure-plot svg', { timeout: 20000 }).catch(() => null);
await sleep(2500);

// 1. Picker: the eight cities and every city of the region that passed the same skill test (haze.json more_cities),
// grouped by country, radio semantics
const hz = await page.evaluate(async () => (await fetch('data/haze.json')).json());
const cities = await page.$$eval('.fh-hz-city', (bs) => bs.map((b) => b.querySelector('.fh-hz-city-name')?.textContent));
const kept = (hz.more_cities?.kept ?? []).map((r) => r.name);
const weak = hz.more_cities?.not_enough_skill ?? [];
check('every city of haze.json to pick from (the eight and the new ones)', cities.length === Object.keys(hz.cities).length
  && cities.every((c) => c in hz.cities) && kept.length >= 10 && kept.every((k) => cities.includes(k)), `${cities.length}: ${cities.join(', ')}`);
check('no city without enough skill is offered', weak.length > 0 && weak.every((r) => !cities.includes(r.name)), weak.map((r) => r.name).join(', '));
const groups = await page.$$eval('.fh-hz-group', (gs) => gs.map((g) => ({ name: g.querySelector('.fh-hz-group-name')?.firstChild?.textContent,
  cities: [...g.querySelectorAll('.fh-hz-city-name')].map((n) => n.textContent) })));
const COUNTRY = { MYS: 'Malaysia', SGP: 'Singapore', IDN: 'Indonesia', BRN: 'Brunei', THA: 'Thailand' };
check('the cities are grouped by country', groups.length >= 3 && groups.every((g) => g.cities.every((c) => COUNTRY[hz.cities[c]?.country] === g.name))
  && groups[0].name === 'Malaysia', groups.map((g) => `${g.name} ${g.cities.length}`).join(', '));
check('the picker is a radio group', await page.evaluate(() => document.querySelector('.fh-hz-cities')?.getAttribute('role') === 'radiogroup'));
// the search box filters the cities (name or country); Enter picks the first; a city that is not here points to the Explorer
await page.fill('.fh-hz-find-input', 'pal');
await sleep(300);
const found = await page.$$eval('.fh-hz-city-name', (n) => n.map((e) => e.textContent));
const count = await page.evaluate(() => document.querySelector('.fh-hz-picker-count')?.textContent);
check('the search finds the cities by name', found.length >= 2 && found.every((c) => /pal/i.test(c)) && found.includes('Palembang') && /of \d+ cities/.test(count ?? ''), `${found.join(', ')} (${count})`);
await page.press('.fh-hz-find-input', 'Enter');
await sleep(700);
check('Enter in the search shows the first city found', (await selected()) === found[0], await selected());
await page.fill('.fh-hz-find-input', 'Brunei');
await sleep(300);
check('the search finds the cities by country', (await page.$$eval('.fh-hz-city-name', (n) => n.map((e) => e.textContent))).join() === 'Bandar Seri Begawan');
await page.fill('.fh-hz-find-input', 'Bangkok');
await sleep(300);
const none = await page.evaluate(() => ({ text: document.querySelector('.fh-hz-none')?.textContent ?? '', href: document.querySelector('.fh-hz-none a')?.getAttribute('href') }));
check('a city the haze link does not cover points to the Explorer', /No city of the haze link matches/.test(none.text) && none.href === '#/?search=1', JSON.stringify(none));
await page.fill('.fh-hz-find-input', '');
await sleep(300);
// why the haze link covers this region only: two sentences, and the way to anywhere else
const scope = await page.evaluate(() => ({ text: document.querySelector('.fh-hz-scope')?.textContent ?? '', href: document.querySelector('.fh-hz-scope a')?.getAttribute('href') }));
check('the page says why the link covers this region only', /Sumatra and Borneo/.test(scope.text) && /July to November/.test(scope.text) && /12° south to 12° north/.test(scope.text)
  && scope.href === '#/?search=1', scope.text.slice(0, 200));
// a new city shows its own tested skill, the numbers of haze.json
await page.click('.fh-hz-city:has-text("Palembang")');
await sleep(1500);
const pal = await page.evaluate(() => [...document.querySelectorAll('.ui-stat')].map((t) => t.innerText));
const pct = (v) => `${Math.round(100 * Math.max(0, v))}%`;
const tile = (re) => pal.find((t) => re.test(t)) ?? '';
check('Palembang: the changes explained are its held out R² in haze.json', tile(/Year to year changes explained/).includes(pct(hz.cities.Palembang.r2_cv)), `${tile(/Year to year/).slice(0, 80)} vs ${pct(hz.cities.Palembang.r2_cv)}`);
check('Palembang: what fire explains beyond the season is its tested score', tile(/Explained by fire, beyond the season/).includes(pct(hz.cities.Palembang.r2_fire_beyond_month)),
  `${tile(/Explained by fire/).slice(0, 80)} vs ${pct(hz.cities.Palembang.r2_fire_beyond_month)}`);
// the cities without enough skill, with their scores
const weakRows = await page.$$eval('.fh-hz-weak tbody tr', (rs) => rs.map((r) => [...r.children].map((c) => c.textContent.trim())));
check('the cities without enough skill are listed with their scores', weakRows.length === weak.length
  && weak.every((r, i) => weakRows[i][0] === r.name && weakRows[i][2] === (r.r2_cv <= 0 ? 'none' : pct(r.r2_cv))), JSON.stringify(weakRows.slice(0, 3)));
// the table of the big haze years: every city, and Palembang's 2015 smoke is the mean of its August to October rows
const months = await page.evaluate(async () => (await fetch('data/web/haze_months.json')).json());
const pm = months.Palembang;
const s15 = [8, 9, 10].map((mo) => pm.smoke_model[pm.yr.findIndex((y, i) => y === 2015 && pm.mo[i] === mo)]);
const want15 = (s15.reduce((a, v) => a + v, 0) / 3).toFixed(1);
const smokeRows = await page.evaluate(() => {
  const card = document.querySelector('.fh-hz-tables .ui-card');
  return card ? [...card.querySelectorAll('tbody tr')].map((r) => [...r.children].map((c) => c.textContent.trim())) : [];
});
const palRow = smokeRows.find((r) => r[0].startsWith('Palembang'));
check('the haze years table lists every city, with the numbers of the haze outputs', smokeRows.length === cities.length && palRow && palRow[1].endsWith(want15),
  `${smokeRows.length} rows; Palembang ${JSON.stringify(palRow)} vs ${want15}`);
await page.click('.fh-hz-city:has-text("Kuala Lumpur")');
await sleep(900);
const first = await selected();
check('a city is selected at the start', !!first, first);

// 2. Click a city: selection, heading, address
await page.click('.fh-hz-city:has-text("Kuching")');
await sleep(900);
check('click selects Kuching', (await selected()) === 'Kuching');
check('the address names the city', (await hashCity()) === 'Kuching', await page.evaluate(() => location.hash));
check('the season heading follows the city', (await page.evaluate(() => document.body.innerText)).includes('Kuching in the fire season'));

// 3. Arrow keys move the selection (roving tabindex)
await page.focus('.fh-hz-city[aria-checked="true"]');
await page.keyboard.press('ArrowRight');
await sleep(700);
const afterKey = await selected();
const idx = cities.indexOf('Kuching');
check('ArrowRight selects the next city', afterKey === cities[(idx + 1) % cities.length], afterKey);
check('focus follows the selection', await page.evaluate(() => document.activeElement?.getAttribute('aria-checked') === 'true'));
await page.keyboard.press('ArrowLeft');
await sleep(700);
check('ArrowLeft goes back', (await selected()) === 'Kuching');
const tabStops = await page.$$eval('.fh-hz-city', (bs) => bs.filter((b) => b.tabIndex === 0).length);
check('one tab stop in the group', tabStops === 1, String(tabStops));

// 4. Copy a link to this city
await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
await page.click('.ui-page-header button:has-text("Copy a link to this city")');
check('Link copied toast', await waitToast('Link copied'), await toastText());
const link = await page.evaluate(() => navigator.clipboard.readText());
check('the link opens this city', link.startsWith(`${BASE}#/haze?`) && new URLSearchParams(link.split('?')[1]).get('city') === 'Kuching', link);

// 5. Season select
const yearsOpt = await page.$$eval('select.fh-pg-select option', (os) => os.map((o) => o.value));
check('season select lists the seasons', yearsOpt.length >= 20, String(yearsOpt.length));
await page.selectOption('select.fh-pg-select', '2019');
await sleep(800);
const txt = await page.evaluate(() => document.body.innerText);
check('choosing 2019 shows that season month by month', txt.includes('Month by month in 2019'), '');
check('the address keeps the season', (await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).get('year'))) === '2019');

// 6. Season chart: tooltip and click on a bar
const svg = page.locator('.ui-figure-plot svg[class^="plot"]').first();
await svg.scrollIntoViewIfNeeded();
await sleep(300);
const b = await svg.boundingBox();
// the 2015 bar sits at about (2015 - 2002 + 0.5) / 25 of the plot width
const x2015 = b.x + 34 + ((2015 - 2002 + 0.5) / 25) * (b.width - 42);
await page.mouse.move(x2015, b.y + b.height * 0.6);
await sleep(400);
const tip = await page.evaluate(() => [...document.querySelectorAll('.ui-figure-plot svg g[aria-label="tip"]')].map((g) => g.textContent).join(' '));
check('season chart tooltip gives exact values', /2015/.test(tip) && /µg|μg/.test(tip), tip.slice(0, 140));
await page.mouse.click(x2015, b.y + b.height * 0.6);
await sleep(800);
check('a click on the 2015 bar shows that season', (await page.evaluate(() => document.body.innerText)).includes('Month by month in 2015'));
// table views
const sums = page.locator('details.ui-figure-table summary');
const nSum = await sums.count();
await sums.first().click();
await sleep(300);
const trs = await page.evaluate(() => document.querySelector('details.ui-figure-table[open] tbody')?.children.length ?? 0);
check('the season chart has a table view', trs >= 20, `rows=${trs}, tables=${nSum}`);
await sums.first().click();

// 7. Tables of the cities: a click shows the city above
await page.locator('.fh-hz-pick, table a, table button').filter({ hasText: 'Singapore' }).first().click().catch(() => null);
await sleep(900);
check('a city in the table shows it above', (await selected()) === 'Singapore', await selected());

// 8. Theme switch re-draws the charts in the new colours
const fillsOf = () => page.evaluate(() => [...document.querySelectorAll('.ui-figure-plot svg[class^="plot"] rect, .ui-figure-plot svg[class^="plot"] path')]
  .map((e) => e.getAttribute('fill') ?? e.parentElement?.getAttribute('fill')).filter((f) => f && f !== 'none').slice(0, 60).join(','));
const f1 = await fillsOf();
await page.evaluate(() => document.querySelector('header button[aria-label*="mode" i]')?.click());
await sleep(900);
const f2 = await fillsOf();
check('a theme switch re-draws the haze charts', f1 !== f2 && f2.length > 0, `${f1.slice(0, 60)} -> ${f2.slice(0, 60)}`);
await page.evaluate(() => document.querySelector('header button[aria-label*="mode" i]')?.click());
await sleep(600);

// 9. Region chips open the Explorer
const nChips = await page.evaluate(() => document.querySelectorAll('a.fh-pg-chip').length);
const chip = page.locator('a.fh-pg-chip').filter({ hasText: 'Riau' }).first();
const chref = await chip.getAttribute('href');
await chip.scrollIntoViewIfNeeded();
await chip.click();
await sleep(1500);
const h = await page.evaluate(() => location.hash);
// the Explorer may add its own month to the address; the area must be the chip's
const areaOf = (x) => new URLSearchParams((x ?? '').split('?')[1] ?? '').get('area');
check('a region chip opens the Explorer at that area', /^#\/\?area=state:/.test(h) && areaOf(h) === areaOf(chref), `${chref} -> ${h}`);
let named = false;
for (let i = 0; i < 40 && !named; i++) { named = (await page.evaluate(() => document.body.innerText)).includes('Riau'); if (!named) await sleep(250); }
check('the Explorer names the area', named);

// 10. Deep link with a city and a season
await page.goto(`${BASE}#/haze?city=Johor+Bahru&year=2019`, { waitUntil: 'domcontentloaded' });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.fh-hz-city[aria-checked="true"]', { timeout: 20000 }).catch(() => null);
let season = false;
for (let i = 0; i < 80 && !season; i++) { season = (await page.evaluate(() => document.body.innerText)).includes('Month by month in 2019'); if (!season) await sleep(250); }
check('deep link selects Johor Bahru', (await selected()) === 'Johor Bahru', await selected());
check('deep link shows the 2019 season', season);
check('region chips listed', nChips >= 15, String(nChips));
const sw = await page.evaluate(() => document.documentElement.scrollWidth);
check('no sideways scroll at 1440', sw === 1440, String(sw));

// 10b. The season card: its facts fill the card, the footnote follows the last fact (1440 and 1024)
for (const w of [1440, 1024]) {
  await page.setViewportSize({ width: w, height: 900 });
  await sleep(900);
  const gap = await page.evaluate(() => {
    const card = document.querySelector('.fh-hz-season .ui-card');
    const last = card?.querySelector('.fh-hz-facts > div:last-child')?.getBoundingClientRect();
    const foot = card?.querySelector('.ui-card-footer')?.getBoundingClientRect();
    return last && foot ? Math.round(foot.top - last.bottom) : null;
  });
  check(`${w}px: the season footnote follows the last fact (gap ${gap} px)`, gap !== null && gap <= 24, String(gap));
}
await page.setViewportSize({ width: 1440, height: 900 });

// 10c. The fire around the city: a 50 km circle in the Explorer, named after the city, and on the Dashboard
await page.goto(`${BASE}#/haze?city=Kuala+Lumpur`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.fh-hz-around a', { timeout: 20000 }).catch(() => null);
let around = null;
for (let i = 0; i < 40; i++) {
  around = await page.evaluate(() => ({ title: document.querySelector('.fh-hz-around-title')?.textContent,
    links: [...document.querySelectorAll('.fh-hz-around a')].map((a) => a.getAttribute('href')) }));
  if (around.links[0]?.includes('3.1686')) break;   // the city of the place search (cities.json), not the grid cell
  await sleep(250);
}
check('the fire around the city is named', around.title === 'The fire within 50 km of Kuala Lumpur', around.title);
check('the Explorer link is a 50 km circle at the city', /^#\/\?area=circle:3\.1686,101\.698,50$/.test(around.links[0] ?? ''), around.links[0]);
check('the Dashboard link scopes the circle and the fire season', /^#\/dashboard\?area=circle:3\.1686,101\.698,50&months=7-11$/.test(around.links[1] ?? ''), around.links[1]);
await page.locator('.fh-hz-around a').first().click();
let circleName = '';
for (let i = 0; i < 60 && !circleName.includes('Kuala Lumpur'); i++) { circleName = await page.evaluate(() => document.body.innerText); await sleep(250); }
check('the Explorer opens the circle named after the city', circleName.includes('Kuala Lumpur') && (await page.evaluate(() => location.hash)).includes('circle:3.1686,101.698,50'), await page.evaluate(() => location.hash));
await page.goto(`${BASE}#/haze?city=Palangka+Raya`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.fh-hz-around a', { timeout: 20000 }).catch(() => null);
let pr = '';
for (let i = 0; i < 40 && !pr.includes('-2.2096'); i++) { pr = await page.evaluate(() => document.querySelector('.fh-hz-around a')?.getAttribute('href') ?? ''); await sleep(250); }
check('Palangka Raya finds its city in the city list', pr.includes('circle:-2.2096,113.91,50'), pr);
await page.locator('.fh-hz-around a').nth(1).click();
let db = '';
for (let i = 0; i < 60 && !/around Palangka Raya/i.test(db); i++) { db = await page.evaluate(() => document.body.innerText); await sleep(250); }
check('the Dashboard opens the circle of the city', /around Palangka Raya/i.test(db) && (await page.evaluate(() => location.hash)).startsWith('#/dashboard?area=circle:-2.2096,113.91,50'), await page.evaluate(() => location.hash));
await page.goto(`${BASE}#/haze`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.fh-hz-city', { timeout: 20000 }).catch(() => null);
await sleep(1500);

// 10d. Kuala Lumpur: 2026 against a normal season, the month view on 2026 with 2015 under it, the WHO guidelines,
// shares in words, the outlook upwind (a fire outlook, the Explorer's numbers)
await page.goto(`${BASE}#/haze?city=Kuala+Lumpur`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.fh-hz-next-month', { timeout: 30000 }).catch(() => null);
await sleep(1500);
const kl = await page.evaluate(() => {
  const tiles = [...document.querySelectorAll('.ui-stat')].map((t) => t.innerText);
  const smoke = tiles.find((t) => /Smoke from fires, 2026/.test(t)) ?? '';
  const seasonsFig = [...document.querySelectorAll('.ui-figure')].find((f) => /smokiest fire season/.test(f.innerText))?.innerText ?? '';
  const monthFig = [...document.querySelectorAll('.ui-figure')].find((f) => /PM2.5 in Kuala Lumpur/.test(f.querySelector('.ui-figure-title')?.textContent ?? ''))?.innerText ?? '';
  return { smoke, seasonsFig, monthFig, body: document.body.innerText,
    shares: [...document.querySelectorAll('.fh-hz-city-share, .ui-stat-value')].map((e) => e.textContent),
    next: document.querySelector('.fh-hz-next')?.closest('.ui-card')?.innerText ?? '',
    places: [...document.querySelectorAll('.fh-hz-next-month')].map((m) => ({ when: m.querySelector('.fh-hz-next-when')?.textContent,
      rows: [...m.querySelectorAll('.fh-hz-next-place')].map((a) => ({ href: a.getAttribute('href'), name: a.querySelector('.fh-hz-next-place-name')?.textContent, p: a.querySelector('.fh-hz-next-p b')?.textContent })) })) };
});
check('Kuala Lumpur: 2026 against a normal season (median of 2002 to 2025)', /\d+% (above|below) a normal season|About a normal season/.test(kl.smoke) && /median of 2002 to 2025/.test(kl.smoke), kl.smoke.slice(0, 200));
check('Kuala Lumpur: the 2015 comparison as a second line', /% (less|more) than in 2015|same as 2015/.test(kl.smoke), kl.smoke.slice(0, 200));
check('the month by month view opens on 2026 (so far)', kl.body.includes('Month by month in 2026'), '');
check('the 2026 month view draws 2015 for reference', /2015, measured, for reference/.test(kl.monthFig), kl.monthFig.slice(0, 200));
check('the season means are set against the WHO annual guideline, never 15', /WHO annual guideline/.test(kl.seasonsFig) && !/\(15 µg/.test(kl.seasonsFig), kl.seasonsFig.slice(0, 300));
check('the monthly chart labels 15 as the 24 hour guideline, for daily values', /WHO 24 hour guideline, for daily values/.test(kl.monthFig), '');
check('no mean is set against the daily guideline in the tiles', !/WHO daily guideline is/.test(kl.body), '');
check('no share reads 100%', !kl.shares.some((t) => /^100%|100% from/.test(t)) && kl.shares.some((t) => /Nearly all/.test(t)), kl.shares.join(' | ').slice(0, 300));
check('the share of the smoke says how it is worked out', kl.body.includes('A share is the smoke the model gives each region'), '');
check('the explained share is named with the month of year', kl.body.includes('Year to year changes explained, with the month of year') && !kl.body.includes('Explained by the fires'), '');
check('next months: a fire outlook, not a smoke forecast', /Next months/.test(kl.next) && /not a smoke forecast/.test(kl.next), kl.next.slice(0, 160));
// the values are those of the Explorer's Outlook tab: the outlook rows of each state's series file
const truthOut = await page.evaluate(async (rows) => {
  const out = [];
  for (const m of rows) for (const r of m.rows) {
    const id = decodeURIComponent((r.href.match(/area=state:([^&]+)/) ?? [])[1] ?? '');
    const f = await (await fetch(`data/web/series/state/${id.replace(/[^A-Za-z0-9_-]/g, '_')}.json`)).json();
    const row = f.outlook.find((o) => `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][o.target_mo - 1]} ${o.target_yr}` === m.when);
    out.push({ id, shown: r.p, file: row ? `${Math.round(row.p * 100)}%` : null, tab: /tab=outlook/.test(r.href) });
  }
  return out;
}, kl.places);
check('next months: every chance is the one of the state\'s outlook file (the Explorer\'s Outlook tab)', truthOut.length > 0 && truthOut.every((x) => x.shown === x.file && x.tab), JSON.stringify(truthOut.filter((x) => x.shown !== x.file || !x.tab).slice(0, 4)));
await page.goto(`${BASE}#/haze?city=Pekanbaru`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.fh-hz-next', { timeout: 30000 }).catch(() => null);
await sleep(800);
check('Pekanbaru shows the next months too', await page.evaluate(() => /Next months/.test(document.querySelector('.fh-hz-next')?.closest('.ui-card')?.innerText ?? '')), '');
// a link to a city we do not know says so
await page.goto(`${BASE}#/haze?city=Nowhere`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.fh-hz-city', { timeout: 20000 }).catch(() => null);
await sleep(800);
check('a bad city link says the place was not found', await page.evaluate(() => document.body.innerText.includes('The link points to a place we could not find')), '');

// 11. Phone
await page.setViewportSize({ width: 390, height: 860 });
await sleep(1200);
const sw2 = await page.evaluate(() => document.documentElement.scrollWidth);
check('phone: no sideways scroll', sw2 === 390, String(sw2));
await page.waitForSelector('.fh-hz-cities', { timeout: 20000 }).catch(() => null);
const rowsPhone = await page.evaluate(() => [...document.querySelectorAll('.fh-hz-group-list')].map((l) => ({
  wrap: getComputedStyle(l).flexWrap, scrolls: l.scrollWidth > l.clientWidth + 1, n: l.children.length, h: Math.round(l.getBoundingClientRect().height) })));
check('phone: each country is one row of cities that scrolls sideways', rowsPhone.length >= 3 && rowsPhone.every((r) => r.wrap === 'nowrap' && r.h <= 56)
  && rowsPhone.some((r) => r.scrolls), JSON.stringify(rowsPhone));
await page.waitForSelector('select.fh-pg-select', { timeout: 20000 }).catch(() => null);
await sleep(800);
const small = await page.evaluate(() => [...document.querySelectorAll('select.fh-pg-select, .fh-hz-city-btn, a.fh-pg-chip, .fh-hz-around .ui-btn, .ui-page-header .ui-btn')]
  .map((e) => ({ t: (e.textContent || e.className).trim().slice(0, 24), h: Math.round(e.getBoundingClientRect().height) })).filter((x) => x.h > 0 && x.h < 44));
check('phone: every control and city link is at least 44 px tall', small.length === 0, JSON.stringify(small.slice(0, 6)));
// the city row comes first, right under the title, and the lead folds to two lines
await page.goto(`${BASE}#/haze?city=Kuala+Lumpur`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.fh-hz-city', { timeout: 20000 }).catch(() => null);
await sleep(1200);
const order = await page.evaluate(() => {
  const cities = document.querySelector('.fh-hz-cities')?.getBoundingClientRect(), lead = document.querySelector('.ui-lead')?.getBoundingClientRect();
  const lh = parseFloat(getComputedStyle(document.querySelector('.ui-lead')).lineHeight);
  return { citiesTop: cities?.top ?? 1e9, leadTop: lead?.top ?? 0, lines: lead ? Math.round(lead.height / lh) : 0, onScreen: (cities?.top ?? 1e9) < window.innerHeight };
});
check('phone: the city row comes first, on the first screen', order.citiesTop < order.leadTop && order.onScreen, JSON.stringify(order));
check('phone: the lead shows two lines', order.lines === 2, JSON.stringify(order));
// 320: no chart label (the "so far" of the newest season among them) runs past its card
await page.setViewportSize({ width: 320, height: 640 });
await page.goto(`${BASE}#/haze`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.ui-figure-plot svg', { timeout: 20000 }).catch(() => null);
await sleep(1800);
const out320 = await page.evaluate(() => {
  const res = [];
  for (const svg of document.querySelectorAll('.ui-figure-plot svg')) {
    const c = svg.closest('.ui-card')?.getBoundingClientRect();
    if (!c) continue;
    for (const t of svg.querySelectorAll('text')) {
      if (t.closest('[aria-label="tip"]') || !t.textContent.trim()) continue;
      const r = t.getBoundingClientRect();
      if (r.width && (r.left < c.left - 1 || r.right > c.right + 1)) res.push(`${t.textContent.slice(0, 20)} ${Math.round(r.left)}..${Math.round(r.right)} vs ${Math.round(c.left)}..${Math.round(c.right)}`);
    }
  }
  return { res, sw: document.documentElement.scrollWidth };
});
check('320: no chart text runs past its card', out320.res.length === 0, out320.res.join(' | '));
check('320: no sideways scroll', out320.sw === 320, String(out320.sw));

console.log(`Haze (${theme}):`);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? `  [${r.detail}]` : ''}`);
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
console.log('console problems:', errors.length ? errors : 'none');
await browser.close();
