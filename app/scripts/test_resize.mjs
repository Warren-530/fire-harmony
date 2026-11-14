// The Explorer's area panel can be resized (explorer/PanelHandle.tsx): its right edge is a separator that a mouse drags
// and the keys move (Left and Right by 16 px, Shift by 64, Home and a double click back to the usual width); the width
// stays between 320 px and min(720 px, half the window), is kept across a reload, and the dock, the drawing bar, the
// map's controls and its tooltip keep clear of the panel at 1024, 1280 and 1440 px. Below 1024 px there is no handle.
// The drag runs at a frame a step (no render of the page while dragging) and the charts in the panel draw once at its end.
// Usage: node scripts/test_resize.mjs [baseUrl]     (default http://127.0.0.1:5173/; run with nice -n 15)
import { chromium } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';
const READY = '.fh-ex[data-series-ready="true"] .fh-ex-map[data-ready="true"]';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];

const overlaps = (a, b) => a && b && a.width > 0 && b.width > 0 && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

async function open(page, hash = '#/?area=country:IDN') {
  await page.goto(`${BASE}${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(READY, { timeout: 120_000 });
  await sleep(1500);
}
const panelW = (page) => page.evaluate(() => Math.round(document.querySelector('.fh-ex-panel')?.getBoundingClientRect().width ?? 0));
const layout = (page) => page.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
  return { panel: r('.fh-ex-panel'), handle: r('.fh-ex-resize'), dock: r('.fh-ex-dock'), bar: r('.fh-ex-controls-bar'), zoom: r('.fh-ex-zoom'),
    top: r('.fh-ex-map-top'), draw: r('.fh-ex-draw'), tip: r('.fh-ex-tip'), legend: r('.fh-ex-legend-chip'), toggle: r('.fh-ex-controls-toggle'),
    vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth };
});

for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { try { localStorage.setItem('fh_theme', 'dark'); localStorage.setItem('fh_welcome_seen', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${w}: ${String(e).slice(0, 200)}`));
  await page.evaluate(() => { try { localStorage.removeItem('fh_panel_w'); } catch { /* */ } }).catch(() => undefined);
  await open(page);
  const max = Math.min(720, Math.floor(w / 2));
  const w0 = await panelW(page);
  const sep = page.locator('.fh-ex-resize[role="separator"]');
  const attrs = await sep.evaluate((e) => ({ o: e.getAttribute('aria-orientation'), min: e.getAttribute('aria-valuemin'), max: e.getAttribute('aria-valuemax'),
    now: e.getAttribute('aria-valuenow'), label: e.getAttribute('aria-label'), tab: e.tabIndex }));
  check(`${w}: the edge is a focusable vertical separator with its values`, attrs.o === 'vertical' && attrs.min === '320' && attrs.max === String(max)
    && Number(attrs.now) === w0 && !!attrs.label && attrs.tab === 0, JSON.stringify(attrs));

  // a mouse drag, 40 steps: the page does not render while dragging (only the frame writes --panel-w)
  const hb = await sep.boundingBox();
  const x0 = hb.x + hb.width / 2, y0 = hb.y + hb.height / 2;
  await page.evaluate(() => {
    const P = { commits: 0, plots: 0 };
    window.__drag = P;
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (hook && !hook.__fhWrapped) { const o = hook.onCommitFiberRoot?.bind(hook); hook.onCommitFiberRoot = (...a) => { P.commits++; return o?.(...a); }; hook.__fhWrapped = true; }
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n instanceof Element && /^plot-[0-9a-f]+(-figure)?$/.test(n.getAttribute('class') ?? '')) P.plots++; })
      .observe(document.querySelector('.fh-ex-panel'), { childList: true, subtree: true });
  });
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.evaluate(() => { const P = window.__drag; P.frames = []; P.on = true; const f = (t) => { if (P.on) { P.frames.push(t); requestAnimationFrame(f); } }; requestAnimationFrame(f); });
  for (let i = 1; i <= 40; i++) { await page.mouse.move(x0 + i * 4, y0); }
  const mid = await layout(page);
  const midPlots = await page.evaluate(() => window.__drag.plots);
  const dragFrames = await page.evaluate(() => {
    const P = window.__drag; P.on = false;
    const d = P.frames.slice(1).map((t, i) => t - P.frames[i]).sort((a, b) => a - b);
    return { n: P.frames.length, p50: Math.round(d[Math.floor(d.length / 2)] ?? 0), p95: Math.round(d[Math.floor(d.length * 0.95)] ?? 0) };
  });
  await page.mouse.up();
  await sleep(900);
  const w1 = await panelW(page);
  const drag = await page.evaluate(() => window.__drag);
  check(`${w}: a mouse drag widens the panel (${w0} -> ${w1} px)`, w1 > w0 && w1 <= max && Math.abs(w1 - Math.min(max, w0 + 160)) <= 2, `${w0} -> ${w1}, max ${max}`);
  check(`${w}: during the drag the dock follows the edge and no chart is drawn again`, mid.dock && Math.abs(mid.dock.left - (mid.panel.right + 16)) <= 2 && midPlots === 0,
    `dock left ${Math.round(mid.dock?.left)}, panel right ${Math.round(mid.panel?.right)}, plots ${midPlots}`);
  check(`${w}: the charts in the panel draw once when the drag ends`, drag.plots <= 2,
    `plots ${drag.plots}, commits ${drag.commits}; drag frames p50 ${dragFrames.p50} ms, p95 ${dragFrames.p95} ms over ${dragFrames.n} frames (software GL)`);

  // a drag far past the end stops at the widest, and far back at 320 px
  const hb2 = await sep.boundingBox();
  await page.mouse.move(hb2.x + hb2.width / 2, y0); await page.mouse.down();
  await page.mouse.move(hb2.x + 1200, y0, { steps: 8 }); await page.mouse.up(); await sleep(700);
  const wMax = await panelW(page);
  const hb3 = await sep.boundingBox();
  await page.mouse.move(hb3.x + hb3.width / 2, y0); await page.mouse.down();
  await page.mouse.move(10, y0, { steps: 8 }); await page.mouse.up(); await sleep(700);
  const wMin = await panelW(page);
  check(`${w}: the width stays between 320 px and ${max} px`, wMax === max && wMin === 320, `max ${wMax}, min ${wMin}`);

  // the keyboard: Right +16, Shift+Right +64, Left -16, Home back to the usual width
  const ym0 = await page.evaluate(() => document.querySelector('.fh-ex-map')?.dataset.ym);
  await sep.focus();
  await page.keyboard.press('ArrowRight'); await sleep(250);
  const k1 = await panelW(page);
  await page.keyboard.press('Shift+ArrowRight'); await sleep(250);
  const k2 = await panelW(page);
  await page.keyboard.press('ArrowLeft'); await sleep(250);
  const k3 = await panelW(page);
  const now = await sep.getAttribute('aria-valuenow');
  const ym = await page.evaluate(() => document.querySelector('.fh-ex-map')?.dataset.ym);
  check(`${w}: Left and Right resize by 16 px, Shift by 64 (the month stays)`, k1 === 336 && k2 === 400 && k3 === 384 && now === '384' && ym === ym0,
    `${wMin} -> ${k1} -> ${k2} -> ${k3}, valuenow ${now}, month ${ym}`);
  const focused = await page.evaluate(() => document.activeElement?.classList.contains('fh-ex-resize'));
  check(`${w}: the separator shows a grip when focused`, focused && await page.evaluate(() => getComputedStyle(document.querySelector('.fh-ex-resize-grip')).opacity === '1'));

  // kept across a reload
  await page.keyboard.press('Shift+ArrowRight'); await sleep(300);
  const kept = await panelW(page);
  await open(page);
  const afterReload = await panelW(page);
  check(`${w}: the width is kept across a reload`, afterReload === kept, `${kept} -> ${afterReload}`);

  // nothing on the map is covered: the dock, the top bar, the drawing bar and the zoom rail keep clear of the panel
  const wideW = Math.min(max, 640);
  await sep.focus();
  for (let i = 0; i < 12 && (await panelW(page)) < wideW; i++) { await page.keyboard.press('Shift+ArrowRight'); await sleep(120); }
  await sleep(600);
  await page.getByRole('button', { name: 'Rectangle' }).first().click().catch(() => undefined);
  await page.waitForSelector('.fh-ex-draw', { timeout: 5000 }).catch(() => undefined);
  await sleep(700);
  const L = await layout(page);
  const covered = ['dock', 'bar', 'zoom', 'draw', 'legend', 'toggle'].filter((k) => L[k] && overlaps(L.panel, L[k]));
  check(`${w}: with a ${Math.round(L.panel.width)} px panel nothing on the map is covered`, covered.length === 0 && L.sw === L.vw && L.dock.left >= L.panel.right + 8
    && (!L.draw || L.draw.left >= L.panel.right), `covered: ${covered.join(', ') || 'none'}; dock ${Math.round(L.dock.left)} vs panel ${Math.round(L.panel.right)}; draw ${L.draw ? Math.round(L.draw.left) : '-'}`);
  await page.keyboard.press('Escape');
  await sleep(400);
  // the hexagon tooltip keeps clear of the wide panel
  const hex = await page.evaluate(([px]) => window.__fhMap?.hexNear(px + 40, 300), [L.panel.right]);
  if (hex) {
    const mapBox = await page.locator('.fh-ex-map').boundingBox();
    await page.mouse.move(mapBox.x + hex.x - 6, mapBox.y + hex.y - 4);
    await page.mouse.move(mapBox.x + hex.x, mapBox.y + hex.y, { steps: 3 });
    await page.waitForSelector('.fh-ex-tip', { timeout: 20_000 }).catch(() => undefined);
    await sleep(400);
    const T = await layout(page);
    check(`${w}: the map's tooltip keeps clear of the wide panel`, !!T.tip && !overlaps(T.tip, T.panel), T.tip ? `tip ${Math.round(T.tip.left)}..${Math.round(T.tip.right)}, panel to ${Math.round(T.panel.right)}` : 'no tooltip');
    await page.mouse.move(5, 5);
  } else check(`${w}: the map's tooltip keeps clear of the wide panel`, false, 'no hexagon with fire beside the panel');

  // double click resets; the fold button still works and keeps the width
  const hb4 = await sep.boundingBox();
  await page.mouse.dblclick(hb4.x + hb4.width / 2, hb4.y + hb4.height / 2);
  await sleep(500);
  const reset = await panelW(page);
  const usual = w <= 1100 ? 340 : 384;
  check(`${w}: a double click goes back to the usual width`, reset === usual, `${reset} (usual ${usual})`);
  await sep.focus();
  await page.keyboard.press('Shift+ArrowRight'); await sleep(300);
  const before = await panelW(page);
  await page.locator('.fh-ex-collapse').click(); await sleep(500);
  const gone = await page.evaluate(() => ({ panel: document.querySelector('.fh-ex-panel')?.hidden, handle: !!document.querySelector('.fh-ex-resize') }));
  await page.locator('.fh-ex-expand').click(); await sleep(700);
  const back = await panelW(page);
  check(`${w}: folding the panel hides the handle and keeps the width`, gone.panel && !gone.handle && back === before, `${before} -> folded ${JSON.stringify(gone)} -> ${back}`);
  await sep.focus(); await page.keyboard.press('Home'); await sleep(300);
  check(`${w}: Home goes back to the usual width`, (await panelW(page)) === usual);
  await ctx.close();
}

// below 1024 px: no handle (tablets keep their panel, phones the sheet)
for (const [w, h] of [[1000, 800], [820, 1180], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(() => { try { localStorage.setItem('fh_welcome_seen', '1'); localStorage.setItem('fh_panel_w', '600'); } catch { /* */ } });
  const page = await ctx.newPage();
  await open(page);
  const r = await page.evaluate(() => ({ handle: !!document.querySelector('.fh-ex-resize'), w: Math.round(document.querySelector('.fh-ex-panel')?.getBoundingClientRect().width ?? 0) }));
  check(`${w}: no handle below 1024 px, and the panel keeps its own width`, !r.handle && r.w !== 600, JSON.stringify(r));
  await ctx.close();
}
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`${results.filter((r) => r.ok).length} of ${results.length} checks passed.`);
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
