// The hub's hero picture: the full burning calendar of Central Kalimantan, one per theme (1200x750 WebP).
// Usage: node scripts/hub_hero.mjs [base address ending in /]  -> public/hub-calendar.webp (dark), public/hub-calendar-light.webp
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--disable-gpu'] });
for (const [theme, file] of [['light', 'hub-calendar-light'], ['dark', 'hub-calendar']]) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 750 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => { try { localStorage.setItem('fh_theme', t); localStorage.setItem('fh_welcome_seen', '1'); } catch { /* */ } }, theme);
  const page = await ctx.newPage();
  await page.goto(`${BASE}#/?area=state:IDN-1931&month=202610&cal=full`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('[role="gridcell"], .cal-cell, rect').length > 200, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.mouse.move(1199, 749);
  await page.screenshot({ path: `/tmp/fh_${file}.png` });
  await ctx.close();
  // downscale the 2x shot for crisp text, then WebP
  execFileSync('../.venv/bin/python', ['-c', `from PIL import Image; Image.open('/tmp/fh_${file}.png').resize((1200, 750), Image.LANCZOS).save('public/${file}.webp', quality=86, method=6)`]);
  console.log(`public/${file}.webp`);
}
await browser.close();
