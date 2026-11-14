// Browser test of the Explorer's Period tab: presets, month pickers, a click on a year bar, both downloads (checked line
// by line), a drawn circle and the world. Usage: node scripts/test_period.mjs [baseUrl] [outDir] (SHOTS_THEME=light)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const out = process.argv[3] ?? '/tmp/fh_period';
fs.mkdirSync(out, { recursive: true });
const theme = process.env.SHOTS_THEME === 'light' ? 'light' : 'dark';

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); };

async function open(area, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
  await ctx.addInitScript((t) => { try { localStorage.setItem('fh_theme', t); localStorage.setItem('fh_welcome_seen', '1'); } catch { /* ignore */ } }, theme);
  const page = await ctx.newPage();
  const errors = [];
  // (the outside basemap server failing for a moment is not an error of the app)
  page.on('console', (m) => { if (m.type() === 'error' && !/tiles\.openfreemap\.org/.test(`${m.text()} ${m.location().url}`)) errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`); });
  await page.goto(new URL(area ? `#/?area=${area}` : '#/', base).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.fh-ex[data-series-ready="true"]', { timeout: 120_000 });
  await page.getByRole('tab', { name: 'Period', exact: true }).click();
  await page.waitForSelector('.pp-tiles', { timeout: 60_000 });
  await page.waitForTimeout(1000);
  return { ctx, page, errors };
}

const tile = (page, i) => page.locator('.pp-tile-value').nth(i).innerText();
const caption = (page) => page.locator('.pp-caption strong').innerText();

// The custom range: From opens the list of years; picking the first month moves on to the last one in the same list.
// Returns how many presses it took (a range in any year takes three: From, a month, a month).
// From, then the two months: the picker lists every year, so a month of another year is a scroll away (the click
// scrolls the list to it), never a tap away. Every tap is counted.
async function pickRange(page, from, to) {
  await page.locator('.pp-when[data-end="from"]').click();
  let taps = 1;
  for (const [yr, mo] of [from, to]) {
    await page.locator(`.pp-month[data-ym="${yr * 100 + mo}"]`).click();
    taps++;
  }
  return taps;
}

async function download(page, button) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), button.click()]);
  const file = path.join(out, d.suggestedFilename());
  await d.saveAs(file);
  return { name: d.suggestedFilename(), text: fs.readFileSync(file, 'utf8') };
}

// ---------------------------------------------------------------- Riau, a named province
{
  const { ctx, page, errors } = await open('state:IDN-492');
  await page.screenshot({ path: path.join(out, `riau_${theme}.png`), fullPage: true });
  check('opens on the last 12 months', /to/.test(await caption(page)), await caption(page));

  for (const name of ['Fire season', 'Whole record', 'Last 12 months']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(1000);   // let the tiles finish counting
    const pressed = await page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed');
    check(`preset "${name}"`, pressed === 'true', `${await caption(page)}; hotspots ${await tile(page, 0)}`);
  }
  await page.getByRole('button', { name: 'Fire season', exact: true }).click();
  await page.screenshot({ path: path.join(out, `riau_season_${theme}.png`), fullPage: true });

  // month pickers: August to October 2019 (the 2019 haze, seven years before the default): three taps
  const taps = await pickRange(page, [2019, 8], [2019, 10]);
  await page.waitForTimeout(1000);   // the tiles count up for 600 ms
  const cap = await caption(page);
  const closed = (await page.locator('.pp-pop').count()) === 0;
  check('month pickers set Aug to Oct 2019', cap === 'Aug to Oct 2019' && taps === 3 && closed, `${cap}; ${taps} taps; picker closed ${closed}`);
  // the keyboard: From, the left arrow (July), Enter, then Escape keeps the last month
  await page.locator('.pp-when[data-end="from"]').click();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const capKeys = await caption(page);
  check('month picker by keyboard (Jul to Oct 2019)', capKeys === 'Jul to Oct 2019', capKeys);
  // up and down move by a row of the 4 by 3 grid: From July, up is March; the year buttons jump a year
  await page.locator('.pp-when[data-end="from"]').click();
  await page.keyboard.press('ArrowUp');
  const upTo = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  await page.getByRole('button', { name: 'Year before', exact: true }).click();
  const yearShown = await page.locator('.pp-pop-year').innerText();
  const jumped = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  await page.keyboard.press('Escape');
  check('month picker: up is a row of four, the year buttons jump a year', upTo === 'March 2019' && yearShown === '2018' && jumped === 'March 2018',
    `${upTo}; year ${yearShown}; focus ${jumped}`);
  await page.waitForTimeout(400);
  await pickRange(page, [2019, 8], [2019, 10]);
  await page.waitForTimeout(1000);
  const total = await tile(page, 0), ratio = await tile(page, 1), rank = await tile(page, 2);
  // (the ratio as the strip writes it: "2.4×" from about twice normal, else "+35%", "−60%" or "normal")
  check('2019 season numbers', /\d/.test(total) && /×|%|normal/.test(ratio) && /\d(st|nd|rd|th)/.test(rank), `${total} hotspots, ${ratio}, rank ${rank}`);
  await page.screenshot({ path: path.join(out, `riau_2019_${theme}.png`), fullPage: true });

  // the numbers table holds the same total for 2019
  await page.locator('.pp-numbers summary').click();
  const row2019 = await page.locator('.pp-numbers tr[aria-current="true"] td').innerText();
  check('table row of the chosen months', row2019.replace(/\D/g, '') === total.replace(/\D/g, ''), `${row2019} vs ${total}`);

  // click the 2015 bar of the chart (pointer over its x position, then click)
  const svg = page.locator('.pp-chart-plot svg');
  const box = await svg.boundingBox();
  const bars = page.locator('.pp-chart-plot svg g[aria-label="bar"] rect');
  const n = await bars.count();
  let clicked = false;
  for (let i = 0; i < n; i++) {
    const b = await bars.nth(i).boundingBox();
    if (!b) continue;
    await page.mouse.move(b.x + b.width / 2, Math.max(box.y + 20, b.y + b.height / 2));
    await page.waitForTimeout(60);
    const tip = (await page.locator('.pp-chart-plot svg [aria-label="tip"]').textContent().catch(() => '')) ?? '';
    if (/2015/.test(tip)) { await page.mouse.down(); await page.mouse.up(); clicked = true; break; }
  }
  await page.waitForTimeout(400);
  check('click on the 2015 bar picks Aug to Oct 2015', clicked && (await caption(page)) === 'Aug to Oct 2015', await caption(page));

  // downloads
  const monthly = await download(page, page.getByRole('button', { name: /Monthly record/ }));
  const mLines = monthly.text.trim().split('\n').filter((l) => !l.startsWith('#'));
  check('monthly CSV of the period', mLines[0].startsWith('year,month,harmonized') && mLines.length === 4
    && mLines.slice(1).every((l) => /^2015,(8|9|10),/.test(l)), `${monthly.name}: ${mLines.length - 1} rows`);

  const hs = await download(page, page.getByRole('button', { name: /^Hotspots CSV/ }));
  const lines = hs.text.trim().split('\n');
  const head = lines.filter((l) => l.startsWith('#'));
  const rows = lines.filter((l) => !l.startsWith('#'));
  const cols = rows[0].split(',');
  const data = rows.slice(1).map((l) => l.split(','));
  const dates = data.map((r) => r[0]);
  const solar = data.map((r) => r[2]);
  const okDates = solar.every((d) => d >= '2015-08-01' && d <= '2015-10-31') && dates.every((d) => d >= '2015-07-31' && d <= '2015-11-01');
  const sorted = dates.every((d, i) => i === 0 || dates[i - 1] <= d);
  const sats = [...new Set(data.map((r) => r[5]))].sort();
  const lat = data.map((r) => Number(r[3])), lon = data.map((r) => Number(r[4]));
  const inBox = lat.every((v) => v > -2 && v < 3) && lon.every((v) => v > 99 && v < 104);   // Riau lies about 1S to 2.5N, 100E to 103.5E
  const counted = data.filter((r) => r[11] === 'true').length;
  check('hotspot CSV columns', cols.join(',') === 'date_utc,time_utc,solar_date,latitude,longitude,satellite,daynight,frp_mw,confidence,type,quality,counted', cols.join(','));
  check('hotspot CSV header lines', head.length === 9 && /Riau/.test(head[0]) && /FIRMS/.test(head.join(' ')), `${head.length} lines`);
  check('hotspot CSV rows in the period, sorted, inside Riau', data.length > 1000 && okDates && sorted && inBox,
    `${data.length} rows, ${counted} counted, satellites ${sats.join('/')}, lat ${Math.min(...lat)}..${Math.max(...lat)}, lon ${Math.min(...lon)}..${Math.max(...lon)}`);
  // the record's raw detections of Aug to Oct 2015 (the satellite bars) are its counted hotspots, by local solar date too
  const satText = await page.locator('.pp-sat-n').allInnerTexts();
  const satSum = satText.reduce((s, t) => s + Number(t.replace(/\D/g, '')), 0);
  check('counted hotspots match the record (within 0.1%)', Math.abs(counted - satSum) <= Math.max(3, satSum * 0.001), `${counted} counted in the CSV, ${satSum} in the record`);

  // only the counted ones
  await page.getByLabel(/Only the hotspots counted/).check();
  const hs2 = await download(page, page.getByRole('button', { name: /^Hotspots CSV/ }));
  const rows2 = hs2.text.trim().split('\n').filter((l) => !l.startsWith('#')).slice(1);
  check('counted only CSV', rows2.length === counted && rows2.every((l) => l.endsWith(',true')), `${rows2.length} rows`);

  const toastText = await page.locator('.ui-toast, [role="status"]').allInnerTexts().catch(() => []);
  check('toasts confirm the saves', toastText.some((t) => /saved/.test(t)), toastText.join(' | ').slice(0, 120));
  check('no console errors (Riau)', errors.length === 0, errors.join(' | ').slice(0, 300));
  await ctx.close();
}

// ---------------------------------------------------------------- a drawn circle of 60 km in Central Kalimantan
{
  const { ctx, page, errors } = await open('circle:-2.2,113.9,60');
  await page.getByRole('button', { name: 'Fire season', exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `circle_${theme}.png`), fullPage: true });
  const hs = await download(page, page.getByRole('button', { name: /^Hotspots CSV/ }));
  const data = hs.text.trim().split('\n').filter((l) => !l.startsWith('#')).slice(1).map((l) => l.split(','));
  // every hotspot within about 60 km of the centre (plus a hexagon edge: the circle is covered with level 5 hexagons)
  const far = data.filter((r) => {
    const dLat = (Number(r[3]) + 2.2) * 111, dLon = (Number(r[4]) - 113.9) * 111 * Math.cos((2.2 * Math.PI) / 180);
    return Math.hypot(dLat, dLon) > 60 + 12;
  });
  check('circle CSV inside the circle', data.length > 0 && far.length === 0, `${data.length} rows, ${far.length} outside`);
  check('no console errors (circle)', errors.length === 0, errors.join(' | ').slice(0, 300));
  await ctx.close();
}

// ---------------------------------------------------------------- a link with the months, one month long (package A)
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await ctx.addInitScript((t) => { try { localStorage.setItem('fh_theme', t); localStorage.setItem('fh_welcome_seen', '1'); } catch { /* ignore */ } }, theme);
  const page = await ctx.newPage();
  const errors = [];
  // (the outside basemap server failing for a moment is not an error of the app)
  page.on('console', (m) => { if (m.type() === 'error' && !/tiles\.openfreemap\.org/.test(`${m.text()} ${m.location().url}`)) errors.push(m.text().slice(0, 300)); });
  await page.goto(new URL('#/?area=circle:-2.2096,113.91,50&month=202610&tab=period&from=202610&to=202610', base).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.pp-tiles', { timeout: 120_000 });
  await page.waitForTimeout(1000);
  const cap = await caption(page);
  check('a link opens the Period tab on its months (Oct 2026 to Oct 2026)', cap === 'Oct 2026', cap);
  const meta = await page.locator('.pp-download-row .pp-btn-meta').first().innerText();
  check('one month is "1 row", not "1 rows"', meta === 'CSV · 1 row', meta);
  const firms = await page.locator('.pp-firms a').getAttribute('href').catch(() => null);
  check('the Period tab links to NASA FIRMS at the place on the map', /^https:\/\/firms\.modaps\.eosdis\.nasa\.gov\/map\/#d:7days;@113\.9\d,-2\.2\d,\d+(\.\d)?z$/.test(firms ?? ''), firms ?? 'none');
  // the chosen year's bar has its year under it, and no tick sits under it
  await page.getByRole('button', { name: 'Last 12 months', exact: true }).click();
  await pickRange(page, [2026, 9], [2026, 10]);
  await page.waitForTimeout(1200);
  const labels = await page.evaluate(() => [...document.querySelectorAll('.pp-chart-plot svg text')].map((x) => x.textContent));
  check('the chosen bar is labelled with its year', labels.filter((x) => x === '2026').length === 1, labels.slice(-6).join(' '));
  check('no console errors (a link with the months)', errors.length === 0, errors.join(' | ').slice(0, 300));
  await ctx.close();
}

// ---------------------------------------------------------------- the world: too many hotspots for one file
{
  const { ctx, page, errors } = await open(null);
  const disabled = await page.getByRole('button', { name: /^Hotspots CSV/ }).isDisabled();
  const note = await page.locator('#pp-hs-note').innerText();
  check('world: hotspot CSV refused with a reason', disabled && /smaller area/.test(note), note.slice(0, 120));
  await page.screenshot({ path: path.join(out, `world_${theme}.png`), fullPage: true });
  check('no console errors (world)', errors.length === 0, errors.join(' | ').slice(0, 300));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
