// Function tests for /hub.html (the submission's front door): the light and dark themes (the system's, the switch
// and the app's saved choice), contrast, one accent number, numbers from the published files, units that never split
// from their values, every link, both videos online, no sideways scroll at six widths.
// Usage: node scripts/test_hub.mjs [base address ending in /]
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--disable-gpu'] });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Contrast of every text block against the colour behind it (the nearest opaque background, else the page). */
const contrastProbe = () => {
  const parse = (c) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1]; return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const mix = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) layers.push(c); if (c.a >= 1) break; }
    let base = parse(getComputedStyle(document.documentElement).backgroundColor);
    for (const l of layers.reverse()) base = mix(l, base);
    return base;
  };
  const out = [];
  for (const el of document.querySelectorAll('.lead, .team, .eyebrow, .stat b, .stat > span, .sub, .todo strong, .todo em, .card h3, .card p, .card .meta, .tag, .panel p, .panel li, footer p, .btn')) {
    const s = getComputedStyle(el);
    // a gradient fill (the main button): the worst of its colours
    const stops = (s.backgroundImage.match(/rgba?\([^)]+\)/g) ?? []).map(parse);
    const backs = stops.length ? stops.map((c) => mix(c, bgOf(el))) : [bgOf(el)];
    const ratio = Math.min(...backs.map((bg) => {
      const fg = mix(parse(s.color), bg), L1 = lum(fg), L2 = lum(bg);
      return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    }));
    out.push({ el: el.className || el.tagName, text: el.textContent.trim().slice(0, 20), ratio: Math.round(ratio * 100) / 100 });
  }
  return out;
};

for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`.slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  await page.goto(`${BASE}hub.html`, { waitUntil: 'networkidle' });
  await sleep(500);
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  // light is the default for every visitor who has not picked a theme (owner, 10 Nov), whatever the system's
  check(`${scheme} system: the page opens light, the default`, bg === 'rgb(246, 246, 243)', bg);
  const low = (await page.evaluate(contrastProbe)).filter((x) => x.ratio < 4.5);
  check(`${scheme}: every text reaches 4.5:1`, low.length === 0, JSON.stringify(low.slice(0, 5)));
  const accent = await page.evaluate(() => {
    const a = getComputedStyle(document.querySelector('.stat.is-key b')).color;
    return [...document.querySelectorAll('.stat b')].filter((b) => getComputedStyle(b).color === a).length;
  });
  check(`${scheme}: one headline number in the accent`, accent === 1, String(accent));
  if (scheme === 'dark') {
    // the numbers come from the published files
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-filled'), null, { timeout: 8000 }).catch(() => null);
    const shown = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-fill]')].map((e) => [e.dataset.fill, e.textContent])));
    const truth = await page.evaluate(async () => {
      const meta = await (await fetch('data/meta.json')).json(), d = await (await fetch('data/dashboard.json')).json();
      return { rows: meta.files.hotspots.rows, jump: d.seam.naive_jump_2011_2012, step: d.seam.steps['2012_harmonized_1y'], months: d.record.months,
        total: d.record.hotspots_total };
    });
    check('hotspots from meta.json', shown.hotspots === (truth.rows / 1e6).toFixed(1), `${shown.hotspots} vs ${truth.rows}`);
    check('hotspots on the NOAA-20 scale from dashboard.json', shown.harmonized === String(Math.round(truth.total / 1e6)), `${shown.harmonized} vs ${truth.total}`);
    const text = await page.evaluate(() => document.body.innerText);
    check('the two totals are named: detections read, and on the NOAA-20 scale', /Detections read/.test(text) && /On the NOAA-20 scale they make/.test(text), '');
    check('the VIIRS to MODIS rate is said per satellite', text.includes('One VIIRS satellite counts about eight times as many hotspots as one MODIS satellite'), '');
    check('burned area agrees at the 2012 switch only', text.includes('ESA burned area maps agree at the 2012 switch'), '');
    // the product picture: a link to the full calendar, with its alt text, and the link previews with absolute URLs
    const shot = await page.evaluate(() => { const a = document.querySelector('a.shot'); const img = a?.querySelector('img');
      return { href: a?.getAttribute('href'), alt: img?.getAttribute('alt'), src: img?.getAttribute('src'), loaded: !!img && img.complete && img.naturalWidth > 0 }; });
    check('the product picture is the app in light, like the page', shot.src === 'hub-calendar-light.webp', shot.src);
    check('the product picture links to the full calendar', shot.href === './#/?area=state:IDN-1931&tab=calendar&cal=full', JSON.stringify(shot));
    check('the product picture has its alt text and loads', shot.alt === 'Burning calendar of Central Kalimantan, 2001 to 2026' && shot.loaded, JSON.stringify(shot));
    const og = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]')]
      .map((m) => [m.getAttribute('property') ?? m.getAttribute('name'), m.getAttribute('content')])));
    check('og:title, og:description, og:image and twitter:card', !!og['og:title'] && !!og['og:description'] && og['twitter:card'] === 'summary_large_image', JSON.stringify(og).slice(0, 200));
    check('og:image is an absolute URL of the site', /^https:\/\/warren-530\.github\.io\/fire-harmony\/og-image\.jpg$/.test(og['og:image'] ?? ''), og['og:image']);
    for (const f of ['og-image.jpg', 'hub-calendar-light.webp', 'hub-calendar.webp']) {
      const r = await page.request.get(new URL(f, `${BASE}hub.html`).toString());
      const n = (await r.body()).length;
      check(`${f} exists and is under 300 KB`, r.ok() && n < 300_000, `${r.status()} ${n} bytes`);
    }
    const app = await page.request.get(new URL('./', `${BASE}hub.html`).toString());
    const appHtml = await app.text();
    check('the app page has the same link preview (og:image, twitter:card)', appHtml.includes('property="og:image" content="https://warren-530.github.io/fire-harmony/og-image.jpg"')
      && appHtml.includes('name="twitter:card" content="summary_large_image"'), '');
    check('the jump from dashboard.json', shown.jump === truth.jump.toFixed(1), `${shown.jump} vs ${truth.jump}`);
    check('the step from dashboard.json', shown.step === `+${truth.step.toFixed(2)}`, `${shown.step} vs ${truth.step}`);
    check('the years from dashboard.json', shown.years === String(Math.floor(truth.months / 12)), `${shown.years} vs ${truth.months}`);
    check('the span of the record from dashboard.json', shown.span === 'November 2000 to October 2026', shown.span);
    // links
    const links = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')));
    for (const h of ['./', './Fire_Harmony_report.pdf', './Fire_Harmony_poster.pdf', 'https://github.com/Warren-530/fire-harmony', 'https://huggingface.co/datasets/warrensaw530/fire-harmony',
      './#/?search=1', './#/?area=state:IDN-1931&tab=calendar', './#/?area=state:ARG-1308&month=202202&tab=calendar'])
      check(`links to ${h}`, links.includes(h), '');
    check('eight first steps into the app', (await page.evaluate(() => document.querySelectorAll('.todo a[href^="./#/"]').length)) === 8);
    const media = 'https://huggingface.co/datasets/warrensaw530/fire-harmony/resolve/main/media/';
    check('no card is left marked as coming', (await page.evaluate(() => document.querySelectorAll('.card.soon').length)) === 0, '');
    for (const v of ['Fire_Harmony_final.mp4', 'Fire_Harmony_demo_30s.mp4']) {
      check(`links to the video ${v}`, links.includes(media + v), '');
      const r = await page.request.head(media + v);
      check(`the video ${v} is online and plays in the browser`, r.ok() && /video\/mp4/.test(r.headers()['content-type'] ?? ''), `${r.status()} ${r.headers()['content-type']}`);
    }
    check('no link left to a placeholder', !links.some((h) => h?.startsWith('#todo')), '');
    for (const h of ['./', './Fire_Harmony_report.pdf', './Fire_Harmony_poster.pdf']) {
      const r = await page.request.get(new URL(h, `${BASE}hub.html`).toString());
      check(`${h} answers`, r.ok(), String(r.status()));
    }
    // the switch: tooltip on focus, flips the theme, remembers it for the app
    await page.focus('#theme');
    await sleep(300);
    const tip = await page.evaluate(() => { const s = getComputedStyle(document.getElementById('theme'), '::after'); return { content: s.content, opacity: s.opacity }; });
    check('the theme switch shows its tooltip on focus', tip.content.includes('Switch to dark mode') && Number(tip.opacity) > 0.9, JSON.stringify(tip));
    await page.click('#theme');
    await sleep(400);
    const after = await page.evaluate(() => ({ bg: getComputedStyle(document.documentElement).backgroundColor, saved: localStorage.getItem('fh_theme'),
      label: document.getElementById('theme').getAttribute('aria-label'), hero: document.querySelector('.shot img')?.getAttribute('src') }));
    check('the switch turns the page dark', after.bg === 'rgb(7, 9, 13)', after.bg);
    check('the switch remembers the choice for the app (fh_theme)', after.saved === 'dark', after.saved);
    check('the switch says what it will do next', after.label === 'Switch to light mode', after.label);
    check('the product picture follows the switch (the app in dark)', after.hero === 'hub-calendar.webp', after.hero);
    const metas = await page.$$eval('meta[name="theme-color"]', (ms) => ms.map((m) => m.getAttribute('content')));
    check('the browser bar colour follows the switch', metas.length > 0 && metas.every((c) => c === '#07090d'), metas.join(' '));
    await page.reload({ waitUntil: 'networkidle' });
    check('the choice holds after a reload', (await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)) === 'rgb(7, 9, 13)');
    check('after a reload in dark, the dark picture loads', await page.evaluate(() => { const i = document.querySelector('.shot img'); return i.getAttribute('src') === 'hub-calendar.webp' && i.complete && i.naturalWidth > 0; }));
    const lowAfter = (await page.evaluate(contrastProbe)).filter((x) => x.ratio < 4.5);
    check('dark by the switch: every text reaches 4.5:1', lowAfter.length === 0, JSON.stringify(lowAfter.slice(0, 5)));
  }
  await ctx.close();
}

// widths: nothing scrolls sideways, every headline value stays on one line with its unit
for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768], [820, 1180], [390, 844], [360, 740], [320, 640]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}hub.html`, { waitUntil: 'networkidle' });
  await sleep(300);
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    wrapped: [...document.querySelectorAll('.stat b')].filter((b) => b.getBoundingClientRect().height > parseFloat(getComputedStyle(b).lineHeight) * 1.5 || b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent),
    small: [...document.querySelectorAll('a, button')].filter((a) => { const r = a.getBoundingClientRect(); return r.height > 0 && r.height < 44 && !a.closest('p, footer'); }).map((a) => a.textContent.trim().slice(0, 20)),
    // the product picture beside the title (stacked under it on narrow screens): never over the words, never off screen
    shot: (() => {
      const img = document.querySelector('a.shot')?.getBoundingClientRect();
      if (!img) return 'missing';
      const words = [...document.querySelectorAll('.hero-text h1, .hero-text .lead, .hero-text .cta, .eyebrow, .hero-text .team')].map((e) => e.getBoundingClientRect());
      const hit = words.some((r) => r.left < img.right - 1 && img.left < r.right - 1 && r.top < img.bottom - 1 && img.top < r.bottom - 1);
      return hit ? 'overlaps the words' : img.right > window.innerWidth + 0.5 || img.left < -0.5 ? 'off screen' : img.width < 200 ? 'too small' : 'ok';
    })(),
  }));
  check(`${w}px: the product picture beside or under the title, clear of the words`, r.shot === 'ok', r.shot);
  check(`${w}px: no sideways scroll`, r.sw === w, String(r.sw));
  check(`${w}px: every headline value on one line with its unit`, r.wrapped.length === 0, r.wrapped.join(', '));
  check(`${w}px: links and buttons at least 44 px tall`, r.small.length === 0, r.small.join(', '));
  await ctx.close();
}

// Without script: the theme follows the system, the light button keeps white text at 4.5:1, and the switch is hidden
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`${BASE}hub.html`, { waitUntil: 'load' });
  await sleep(500);
  const ns = await page.evaluate(() => ({ bg: getComputedStyle(document.documentElement).backgroundColor,
    btn: getComputedStyle(document.querySelector('.btn-primary')).backgroundImage, sw: getComputedStyle(document.getElementById('theme')).display }));
  check('no script: a light system gives the light page', ns.bg === 'rgb(246, 246, 243)', ns.bg);
  check('no script: the light main button is ember 600 to 700', /200, 51, 26/.test(ns.btn) && /162, 27, 24/.test(ns.btn), ns.btn);
  check('no script: the theme switch, which could do nothing, is hidden', ns.sw === 'none', ns.sw);
  const low = (await page.evaluate(contrastProbe)).filter((x) => x.ratio < 4.5);
  check('no script, light: every text reaches 4.5:1', low.length === 0, JSON.stringify(low.slice(0, 5)));
  await ctx.close();
}

console.log('Hub:');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? `  [${r.detail}]` : ''}`);
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
console.log('console problems:', errors.length ? errors : 'none');
await browser.close();
