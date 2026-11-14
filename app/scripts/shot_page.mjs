// Screenshot one page at several widths, with its console errors and failed requests, and check that nothing scrolls
// sideways. Usage: node scripts/shot_page.mjs <url> <outPrefix> [widths, default 1440,390]
import { chromium } from 'playwright-core';

const [url, prefix = '/tmp/fh_page', widthArg = '1440,390'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
for (const w of widthArg.split(',').map(Number)) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${prefix}_${w}.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(`${w}px: ${errors.length} errors${errors.length ? ` (${errors.slice(0, 3).join(' | ')})` : ''}, sideways scroll: ${overflow}`);
  await page.close();
}
await browser.close();
