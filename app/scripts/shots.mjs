// Screenshots of every page in a real (headless) Chrome, plus every console error and failed request.
// Usage: node scripts/shots.mjs [baseUrl] [outDir]      (default http://127.0.0.1:5173/ and /tmp/fh_shots)
// Optional: SHOTS_ONLY=explorer,haze  to take only some pages; SHOTS_WIDTH=1440 for the viewport width;
// SHOTS_THEME=light for the light theme (the app defaults to dark); SHOTS_HEIGHT for the viewport height (default 900).
// Pages are scrolled to the end first (lazy figures and reveal effects load), and pages taller than 8,000 px are saved
// in parts (<name>.png, <name>_2.png ...), because one capture that tall repeats the top of the page.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const out = process.argv[3] ?? '/tmp/fh_shots';
const only = (process.env.SHOTS_ONLY ?? '').split(',').filter(Boolean);
const width = Number(process.env.SHOTS_WIDTH ?? 1440);
const height = Number(process.env.SHOTS_HEIGHT ?? 900);
const theme = process.env.SHOTS_THEME === 'light' ? 'light' : 'dark';   // the app defaults to dark
fs.mkdirSync(out, { recursive: true });

const PAGES = [
  { name: 'explorer', hash: '#/', wait: async (p) => { await p.waitForSelector('.fh-ex[data-series-ready="true"] .fh-ex-map[data-ready="true"]', { timeout: 90_000 }); await p.waitForTimeout(3500); } },
  { name: 'dashboard', hash: '#/dashboard', wait: async (p) => { await p.waitForTimeout(6000); } },
  { name: 'haze', hash: '#/haze', wait: async (p) => { await p.waitForSelector('.fh-chart-plot svg', { timeout: 60_000 }); await p.waitForTimeout(1500); } },
  { name: 'methods', hash: '#/methods', wait: async (p) => { await p.waitForTimeout(2500); } },
  { name: 'data', hash: '#/data', wait: async (p) => { await p.waitForTimeout(2000); } },
];

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  // GPU raster through SwiftShader draws banded tiles in tall captures: raster on the CPU, keep WebGL for the map
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-rasterization'],
});
const report = {};
for (const pg of PAGES) {
  if (only.length && !only.includes(pg.name)) continue;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.addInitScript((t) => { try { localStorage.setItem('fh_theme', t); } catch { /* ignore */ } }, theme);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`.slice(0, 400)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 400)}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
  const t0 = Date.now();
  let ok = true;
  try {
    await page.goto(new URL(pg.hash, base).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await pg.wait(page);
  } catch (e) {
    ok = false;
    errors.push(`wait failed: ${String(e).slice(0, 300)}`);
  }
  const file = path.join(out, `${pg.name}.png`);
  // scroll through once so lazy content and reveal effects are in place, then back to the top
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += Math.round(height * 0.8)) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  const PART = 4000;
  if (full <= 8000) {
    await page.screenshot({ path: file, fullPage: true });
  } else {
    for (let i = 0, y = 0; y < full; i++, y += PART) {
      const name = i === 0 ? file : path.join(out, `${pg.name}_${i + 1}.png`);
      await page.screenshot({ path: name, fullPage: true, clip: { x: 0, y, width, height: Math.min(PART, full - y) } });
    }
  }
  const alerts = await page.$$eval('[role="alert"]', (els) => els.map((e) => e.textContent?.trim()).filter(Boolean));
  report[pg.name] = { ok, ms: Date.now() - t0, file, alerts, errors };
  await page.close();
}
await browser.close();
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
for (const [k, v] of Object.entries(report)) {
  console.log(`${v.ok ? 'OK  ' : 'FAIL'} ${k} ${v.ms} ms, ${v.errors.length} console problems, alerts: ${JSON.stringify(v.alerts)}`);
  for (const e of v.errors.slice(0, 8)) console.log('     ', e);
}
