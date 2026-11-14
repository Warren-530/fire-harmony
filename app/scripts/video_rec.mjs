// Screen recording helpers for the videos: Chrome's own screen frames (CDP screencast) piped into ffmpeg at a steady
// 30 fps, a drawn mouse cursor (headless Chrome draws none) and hand-like mouse moves, typing and scrolling.
// Used by app/scripts/video_scenes.mjs.
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const REPO = new URL('../..', import.meta.url).pathname;
export const FF = execFileSync(`${REPO}.venv/bin/python`, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
export const FPS = 30;
export const VIEW = { width: 1280, height: 720 };          // CSS pixels; a 1.5 device scale gives 1920x1080 frames
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

export async function launch() {
  return chromium.launch({ executablePath: '/usr/bin/google-chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--disable-smooth-scrolling', '--disable-quic'] });
}

// The cursor: an arrow, a hand over things you can click, an I-beam over text fields; a soft ring on each press.
const CURSOR = (scale = 1) => {
  const ARROW = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 2.5v17.2l4.3-4.1 2.9 6.6 2.7-1.2-2.9-6.5h6z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const HAND = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M9 11V4.6a1.6 1.6 0 0 1 3.2 0V10l.1-1.4a1.6 1.6 0 0 1 3.1.2V11l.1-.9a1.5 1.5 0 0 1 3 .3v1.3l.1-.4a1.4 1.4 0 0 1 2.7.6V16c0 3.3-2.4 6-5.8 6h-1.8c-2 0-3.3-.8-4.5-2.3L4.6 14.9a1.5 1.5 0 0 1 2.3-2L9 15z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const BEAM = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M9 3.5h2.2c.5 0 .8.4.8.8m3-.8h-2.2c-.5 0-.8.4-.8.8v15.4c0 .4-.3.8-.8.8H9m6 0h-2.2c-.5 0-.8-.4-.8-.8M10 12h4" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><path d="M9 3.5h2.2c.5 0 .8.4.8.8m3-.8h-2.2c-.5 0-.8.4-.8.8v15.4c0 .4-.3.8-.8.8H9m6 0h-2.2c-.5 0-.8-.4-.8-.8M10 12h4" fill="none" stroke="#111" stroke-width="1.4" stroke-linecap="round"/></svg>';
  const install = () => {
    if (document.getElementById('fh-cursor')) return;
    const st = document.createElement('style');
    st.textContent = `#fh-cursor{position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;
      transform:translate(-100px,-100px);filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35));will-change:transform;transform-origin:0 0}
      #fh-cursor svg{display:block}
      .fh-cursor-ring{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;z-index:2147483646;pointer-events:none;
      background:rgba(231,86,35,.22);border:2px solid rgba(231,86,35,.55);animation:fhRing .45s ease-out forwards}
      @keyframes fhRing{from{transform:scale(.35);opacity:1}to{transform:scale(1.15);opacity:0}}`;
    document.documentElement.appendChild(st);
    const c = document.createElement('div'); c.id = 'fh-cursor'; c.innerHTML = ARROW; c.dataset.kind = 'arrow';
    document.documentElement.appendChild(c);
    let last = null;
    const kindAt = (el) => {
      if (!el || el.nodeType !== 1) return 'arrow';
      const cur = getComputedStyle(el).cursor;
      if (cur === 'pointer') return 'hand';
      if (cur === 'text' || el.matches('input[type="text"], input[type="search"], input:not([type]), textarea')) return 'beam';
      return 'arrow';
    };
    window.addEventListener('pointermove', (e) => {
      const k = kindAt(e.target);
      const off = k === 'hand' ? [-8, -2] : k === 'beam' ? [-12, -12] : [-5, -2.5];
      c.style.transform = `translate(${e.clientX + off[0] * scale}px, ${e.clientY + off[1] * scale}px) scale(${scale})`;
      if (k !== last) { c.innerHTML = k === 'hand' ? HAND : k === 'beam' ? BEAM : ARROW; last = k; }
    }, true);
    window.addEventListener('pointerdown', (e) => {
      const r = document.createElement('div'); r.className = 'fh-cursor-ring';
      r.style.left = `${e.clientX}px`; r.style.top = `${e.clientY}px`;
      document.documentElement.appendChild(r); setTimeout(() => r.remove(), 500);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
};

// Virtual time: once __fhV.on is set, the page's clock (performance.now, Date.now), animation frames, timers and CSS
// animations only move when the recorder steps them, one video frame at a time.
const VTIME = () => {
  const realNow = performance.now.bind(performance), realDateNow = Date.now.bind(Date);
  const rRAF = window.requestAnimationFrame.bind(window), rCAF = window.cancelAnimationFrame.bind(window);
  const rST = window.setTimeout.bind(window), rCT = window.clearTimeout.bind(window);
  const rSI = window.setInterval.bind(window), rCI = window.clearInterval.bind(window);
  const V = { on: false, now: 0, base: 0, raf: new Map(), rafId: 1, timers: new Map(), tid: 1e7, seen: new WeakMap() };
  window.__fhV = V;
  V.start = () => { V.now = realNow(); V.base = realDateNow() - V.now; V.on = true; };
  performance.now = () => (V.on ? V.now : realNow());
  Date.now = () => (V.on ? V.base + V.now : realDateNow());
  window.requestAnimationFrame = (cb) => { if (!V.on) return rRAF(cb); const id = V.rafId++; V.raf.set(id, cb); return -id; };
  window.cancelAnimationFrame = (id) => { if (id < 0) V.raf.delete(-id); else rCAF(id); };
  window.setTimeout = (fn, d = 0, ...a) => { if (!V.on || typeof fn !== 'function') return rST(fn, d, ...a); const id = V.tid++; V.timers.set(id, { at: V.now + Math.max(0, +d || 0), fn, a }); return id; };
  window.clearTimeout = (id) => { if (V.timers.has(id)) V.timers.delete(id); else rCT(id); };
  window.setInterval = (fn, d = 0, ...a) => { if (!V.on || typeof fn !== 'function') return rSI(fn, d, ...a); const id = V.tid++; V.timers.set(id, { at: V.now + Math.max(4, +d || 0), fn, a, every: Math.max(4, +d || 0) }); return id; };
  window.clearInterval = (id) => { if (V.timers.has(id)) V.timers.delete(id); else rCI(id); };
  V.step = (dt) => {
    const end = V.now + dt;
    for (let guard = 0; guard < 500; guard++) {           // timers due in this frame, in time order
      let next = null, nid = null;
      for (const [id, t] of V.timers) if (t.at <= end && (!next || t.at < next.at)) { next = t; nid = id; }
      if (!next) break;
      V.now = Math.max(V.now, next.at);
      if (next.every) next.at += next.every; else V.timers.delete(nid);
      try { next.fn(...next.a); } catch (e) { console.error(e); }
    }
    V.now = end;
    const q = [...V.raf.values()]; V.raf.clear();
    for (const cb of q) { try { cb(V.now); } catch (e) { console.error(e); } }
    for (const an of document.getAnimations()) {           // CSS transitions and animations follow the same clock
      let st = V.seen.get(an);
      if (st === undefined) { st = V.now - dt - (Number(an.currentTime) || 0); V.seen.set(an, st); }
      try { if (an.playState !== 'paused') an.pause(); an.currentTime = (V.now - st) * (an.playbackRate || 1); } catch { /* */ }
    }
  };
  V.frame = (dt) => new Promise((res) => rRAF(() => { V.step(dt); rRAF(() => res(true)); }));
};

// view: the window in CSS pixels; the device scale makes every frame 1920 pixels wide, and the cursor stays the same
// size on screen (32 px in the video) whatever the window.
// On a phone there is no cursor: a soft ring shows each touch and follows a swipe.
const TOUCH = () => {
  const install = () => {
    const st = document.createElement('style');
    st.textContent = `.fh-touch{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;z-index:2147483647;pointer-events:none;
      background:rgba(29,29,27,.18);border:2px solid rgba(29,29,27,.35);transition:opacity .25s}`;
    document.documentElement.appendChild(st);
    let dot = null;
    const at = (t) => { if (!dot) { dot = document.createElement('div'); dot.className = 'fh-touch'; document.documentElement.appendChild(dot); }
      dot.style.opacity = '1'; dot.style.left = `${t.clientX}px`; dot.style.top = `${t.clientY}px`; };
    window.addEventListener('touchstart', (e) => at(e.touches[0]), { capture: true, passive: true });
    window.addEventListener('touchmove', (e) => at(e.touches[0]), { capture: true, passive: true });
    window.addEventListener('touchend', () => { if (dot) { const d = dot; dot = null; d.style.opacity = '0'; setTimeout(() => d.remove(), 300); } }, { capture: true, passive: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
};

export async function scenePage(browser, { theme = 'light', welcome = false, phone = false, view = VIEW } = {}) {
  const dsf = 1920 / view.width;
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: view, deviceScaleFactor: dsf });
  await ctx.addInitScript(([t, w]) => {
    try { localStorage.setItem('fh_theme', t); if (!w) localStorage.setItem('fh_welcome_seen', '1'); } catch { /* */ }
  }, [theme, welcome]);
  await ctx.addInitScript(VTIME);
  if (!phone) await ctx.addInitScript(CURSOR, (4 / 3) / dsf); else await ctx.addInitScript(TOUCH);
  const page = await ctx.newPage();
  page.mx = (phone ? 390 : view.width) * 0.62; page.my = (phone ? 844 : view.height) * 0.55;   // where the cursor starts
  page.phone = phone;
  return page;
}

// Start recording the page into out (H.264, 30 fps, 1920x1080). Returns stop() -> seconds recorded.
export async function record(page, out, { size = [1920, 1080] } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const ff = spawn(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
    '-vf', `scale=${size[0]}:${size[1]}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '15', out],
    { stdio: ['pipe', 'ignore', 'inherit'] });
  const t0 = Date.now() / 1000;
  let last = null, written = 0, frames = 0;
  const fill = (upto) => { while (last && written < upto) { ff.stdin.write(last); written++; } };
  cdp.on('Page.screencastFrame', (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    const n = Math.floor((f.metadata.timestamp - t0) * FPS);
    fill(n);
    last = Buffer.from(f.data, 'base64'); frames++;
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: size[0], maxHeight: size[1], everyNthFrame: 1 });
  // nudge a repaint so the first frame arrives at once
  await page.evaluate(() => { document.documentElement.style.outline = '0 solid transparent'; });
  return async () => {
    const end = Date.now() / 1000;
    await cdp.send('Page.stopScreencast').catch(() => {});
    fill(Math.floor((end - t0) * FPS));
    await new Promise((r) => { ff.on('close', r); ff.stdin.end(); });
    await cdp.detach().catch(() => {});
    return { seconds: written / FPS, frames, fps: frames / Math.max(end - t0, 0.001) };
  };
}

// --- hand-like input ---------------------------------------------------------------------------------------------
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export async function moveTo(page, x, y, ms) {
  const x0 = page.mx, y0 = page.my, d = Math.hypot(x - x0, y - y0);
  if (d < 1) return;
  const dur = ms ?? Math.min(1100, Math.max(320, 260 + d * 0.55));
  const bend = rand(-0.12, 0.12) * d;                       // a gentle curve, as a wrist makes
  const cx = (x0 + x) / 2 + (-(y - y0) / d) * bend, cy = (y0 + y) / 2 + ((x - x0) / d) * bend;
  const steps = Math.max(8, Math.round(dur / 16));
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps), u = 1 - t;
    const px = u * u * x0 + 2 * u * t * cx + t * t * x, py = u * u * y0 + 2 * u * t * cy + t * t * y;
    await page.mouse.move(px, py);
    await sleep(dur / steps - 4);
  }
  page.mx = x; page.my = y;
}

export async function box(page, sel, { nth = 0, timeout = 30000 } = {}) {
  const loc = page.locator(sel).nth(nth);
  await loc.waitFor({ state: 'visible', timeout });
  await loc.scrollIntoViewIfNeeded();
  return loc.boundingBox();
}

export async function moveToEl(page, sel, { nth = 0, dx = 0.5, dy = 0.5, ms } = {}) {
  const b = await box(page, sel, { nth });
  await moveTo(page, b.x + b.width * dx + rand(-2, 2), b.y + b.height * dy + rand(-1.5, 1.5), ms);
  return b;
}

export async function click(page, sel, opts = {}) {
  await moveToEl(page, sel, opts);
  await sleep(rand(120, 220));
  await page.mouse.down(); await sleep(rand(60, 110)); await page.mouse.up();
  await sleep(opts.after ?? 350);
}

export async function clickAt(page, x, y, opts = {}) {
  await moveTo(page, x, y, opts.ms);
  await sleep(rand(120, 220));
  await page.mouse.down(); await sleep(rand(60, 110)); await page.mouse.up();
  await sleep(opts.after ?? 350);
}

export async function type(page, text, { min = 55, max = 130 } = {}) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(ch === ' ' ? rand(max, max * 1.6) : rand(min, max));
  }
}

// Smooth wheel scroll by dy CSS pixels over ms, with the cursor where it is.
export async function scroll(page, dy, ms = 900) {
  const steps = Math.max(6, Math.round(ms / 16));
  let done = 0;
  for (let i = 1; i <= steps; i++) {
    const target = Math.round(dy * ease(i / steps));
    await page.mouse.wheel(0, target - done); done = target;
    await sleep(ms / steps - 3);
  }
}

// Scroll so the element's top sits at `top` CSS px from the viewport top.
export async function scrollToEl(page, sel, { top = 90, ms = 1100, nth = 0 } = {}) {
  const y = await page.locator(sel).nth(nth).evaluate((e) => e.getBoundingClientRect().top);
  await scroll(page, y - top, ms);
  await sleep(250);
}

// Sweep the cursor along a horizontal line (for chart tooltips).
export async function sweep(page, x0, x1, y, ms = 1800) {
  await moveTo(page, x0, y);
  const steps = Math.round(ms / 16);
  for (let i = 1; i <= steps; i++) { const t = i / steps; await page.mouse.move(x0 + (x1 - x0) * t, y + Math.sin(t * 6) * 1.5); await sleep(12); }
  page.mx = x1; page.my = y;
}

export { existsSync };

// --- frame by frame ---------------------------------------------------------------------------------------------
// A Film steps the page's clock 1/30 s at a time and takes one screenshot per step, so the video is smooth at 30 fps
// however slowly the page draws. All the hand-like helpers below move one frame at a time.
export class Film {
  constructor(page, out, { size = [1920, 1080] } = {}) { this.page = page; this.out = out; this.size = size; this.n = 0; }
  get vf() {   // a phone stands upright in the middle of the frame, on the page colour
    return this.page.phone ? 'scale=-2:1010:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xE9E9E4,format=yuv420p'
      : `scale=${this.size[0]}:${this.size[1]}:flags=lanczos,format=yuv420p`;
  }
  async start() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.ff = spawn(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
      '-vf', this.vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', this.out],
      { stdio: ['pipe', 'ignore', 'inherit'] });
    await this.page.evaluate(() => window.__fhV.start());
    this.t0 = Date.now();
    return this;
  }
  async frame(k = 1) {
    for (let i = 0; i < k; i++) {
      await this.page.evaluate((dt) => window.__fhV.frame(dt), 1000 / FPS);
      const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
      const buf = Buffer.from(data, 'base64');
      if (!this.ff.stdin.write(buf)) await new Promise((r) => this.ff.stdin.once('drain', r));
      this.n++;
    }
  }
  sec(s) { return this.frame(Math.max(1, Math.round(s * FPS))); }
  // keep filming until fn() is true in the page (data loading); max real seconds
  async until(fn, { max = 60, arg } = {}) {
    const t = Date.now();
    while (Date.now() - t < max * 1000) { if (await this.page.evaluate(fn, arg).catch(() => false)) return true; await this.frame(); }
    console.warn('until: timed out', String(fn).slice(0, 80)); return false;
  }
  async stop() {
    await new Promise((r) => { this.ff.on('close', r); this.ff.stdin.end(); });
    await this.cdp.detach().catch(() => {});
    return { seconds: this.n / FPS, frames: this.n, realSeconds: (Date.now() - this.t0) / 1000 };
  }
  // the hand-like input, one frame at a time
  async move(x, y, ms) {
    const p = this.page, x0 = p.mx, y0 = p.my, d = Math.hypot(x - x0, y - y0);
    if (d < 1) return;
    const dur = ms ?? Math.min(1000, Math.max(300, 240 + d * 0.5));
    const bend = rand(-0.12, 0.12) * d;
    const cx = (x0 + x) / 2 + (-(y - y0) / d) * bend, cy = (y0 + y) / 2 + ((x - x0) / d) * bend;
    const steps = Math.max(6, Math.round(dur / (1000 / FPS)));
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps), u = 1 - t;
      await p.mouse.move(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y);
      await this.frame();
    }
    p.mx = x; p.my = y;
  }
  loc(sel, nth = 0) { return typeof sel === 'string' ? this.page.locator(sel).nth(nth) : sel; }
  // the nth chart (an svg at least 140x90) inside a container, in page order: never an icon
  async chart(container, nth = 0) {
    const c = this.loc(container);
    await c.waitFor({ state: 'attached', timeout: 30000 });
    this.tags = (this.tags ?? 0) + 1;
    const tag = `c${this.tags}`;
    const ok = await c.evaluate((el, [n, t]) => {
      const all = [...(/^(svg|img|canvas)$/i.test(el.tagName) ? [el] : []), ...el.querySelectorAll('svg, img, canvas')]
        .filter((s) => { const r = s.getBoundingClientRect(); return r.width >= 140 && r.height >= 90; });
      const s = all[n]; if (s) s.setAttribute('data-fh-chart', t); return !!s;
    }, [nth, tag]);
    if (!ok) throw new Error(`no chart ${nth} in ${container}`);
    return this.page.locator(`[data-fh-chart="${tag}"]`);
  }
  // scroll an element into view with the wheel, as a person would: over its own scrolling box (a panel, a list)
  async reveal(loc) {
    for (let i = 0; i < 8; i++) {
      const r = await loc.evaluate((el) => {
        if (el.closest('.fh-header')) return null;      // the fixed header is always in view (a wheel there would zoom the map)
        const b = el.getBoundingClientRect();
        let sc = el.parentElement;
        while (sc && sc !== document.body && sc !== document.documentElement) {
          const st = getComputedStyle(sc);
          if (/(auto|scroll)/.test(st.overflowY) && sc.scrollHeight > sc.clientHeight + 2) break;
          sc = sc.parentElement;
        }
        const own = sc && sc !== document.body && sc !== document.documentElement;
        const vb = own ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
        const top = Math.max(vb.top, 60), bottom = Math.min(vb.bottom, innerHeight) - 8;
        const cy = b.top + b.height / 2;
        if (cy >= top + 12 && cy <= bottom - 12) return null;
        const mid = (top + bottom) / 2;
        return { dy: cy - mid, x: Math.min(Math.max(b.left + b.width / 2, vb.left + 12), vb.right - 12), y: mid };
      });
      if (!r) return;
      if (Math.abs(this.page.mx - r.x) > 60 || Math.abs(this.page.my - r.y) > 160) await this.move(r.x, r.y, 450);
      await this.scroll(r.dy, Math.min(1200, 320 + Math.abs(r.dy) * 0.5));
      await this.frame(3);
    }
  }
  async moveEl(sel, { nth = 0, dx = 0.5, dy = 0.5, ms } = {}) {
    const loc = this.loc(sel, nth);
    await loc.waitFor({ state: 'visible', timeout: 30000 });
    await this.reveal(loc);
    const b = await loc.boundingBox();
    await this.move(b.x + b.width * dx + rand(-2, 2), b.y + b.height * dy + rand(-1.5, 1.5), ms);
    return b;
  }
  async press() { await this.frame(Math.round(rand(3, 6))); await this.page.mouse.down(); await this.frame(2); await this.page.mouse.up(); await this.frame(); }
  async click(sel, opts = {}) { await this.moveEl(sel, opts); await this.press(); await this.sec(opts.after ?? 0.35); }
  async clickAt(x, y, opts = {}) { await this.move(x, y, opts.ms); await this.press(); await this.sec(opts.after ?? 0.35); }
  async type(text, { min = 2, max = 4 } = {}) {
    for (const ch of text) { await this.page.keyboard.type(ch); await this.frame(Math.round(ch === ' ' ? rand(max, max * 1.6) : rand(min, max))); }
  }
  async drag(x0, y0, x1, y1, ms = 900) {
    await this.move(x0, y0); await this.frame(4); await this.page.mouse.down(); await this.frame(2);
    const steps = Math.max(8, Math.round(ms / (1000 / FPS)));
    for (let i = 1; i <= steps; i++) { const t = ease(i / steps); await this.page.mouse.move(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); await this.frame(); }
    this.page.mx = x1; this.page.my = y1; await this.frame(2); await this.page.mouse.up(); await this.frame(3);
  }
  async key(k, after = 0.3) { await this.page.keyboard.press(k); await this.sec(after); }
  async scroll(dy, ms = 900) {
    const steps = Math.max(6, Math.round(ms / (1000 / FPS)));
    let done = 0;
    for (let i = 1; i <= steps; i++) { const target = Math.round(dy * ease(i / steps)); await this.page.mouse.wheel(0, target - done); done = target; await this.frame(); }
  }
  async scrollToEl(sel, { top = 90, ms = 1100, nth = 0 } = {}) {
    const y = await this.loc(sel, nth).evaluate((e) => e.getBoundingClientRect().top);
    await this.scroll(y - top, ms); await this.frame(3);
  }
  // touch: a tap, and a swipe (finger down, move, up), one frame at a time
  async touch(type, x, y) {
    await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }] });
  }
  async tap(sel, { nth = 0, dx = 0.5, dy = 0.5, after = 0.35 } = {}) {
    const loc = this.loc(sel, nth); await loc.waitFor({ state: 'visible', timeout: 30000 });
    const b = await loc.boundingBox(); const x = b.x + b.width * dx, y = b.y + b.height * dy;
    await this.frame(6); await this.touch('touchStart', x, y); await this.frame(3); await this.touch('touchEnd', x, y); await this.sec(after);
  }
  async swipe(x, y0, y1, ms = 600) {
    const steps = Math.max(6, Math.round(ms / (1000 / FPS)));
    await this.touch('touchStart', x, y0); await this.frame(2);
    for (let i = 1; i <= steps; i++) { await this.touch('touchMove', x, y0 + (y1 - y0) * ease(i / steps)); await this.frame(); }
    await this.touch('touchEnd', x, y1); await this.frame(4);
  }
  // keep the cursor gently alive until the scene reaches `sec` seconds
  async idleTo(sec) {
    if (this.page.phone) { const left = sec - this.n / FPS; if (left > 0) await this.frame(Math.round(left * FPS)); return; }
    while (this.n / FPS < sec - 0.05) {
      const left = sec - this.n / FPS, ms = Math.min(900, left * 1000);
      if (ms < 120) { await this.frame(Math.max(1, Math.round(left * FPS))); break; }
      await this.move(this.page.mx + rand(-14, 14), this.page.my + rand(-9, 9), ms);
      if (this.n / FPS < sec - 0.4) await this.frame(Math.round(rand(4, 10)));
    }
  }
  // sweep the cursor across a figure's plot (fractions of its svg box)
  async sweepFig(sel, { y = 0.5, x0 = 0.12, x1 = 0.92, ms = 2200, nth = 0 } = {}) {
    const b = await (await this.chart(sel, nth)).boundingBox();
    await this.sweep(b.x + b.width * x0, b.x + b.width * x1, b.y + b.height * y, ms);
  }
  async sweep(x0, x1, y, ms = 1800) {
    await this.move(x0, y);
    const steps = Math.round(ms / (1000 / FPS));
    for (let i = 1; i <= steps; i++) { const t = i / steps; await this.page.mouse.move(x0 + (x1 - x0) * t, y + Math.sin(t * 6) * 1.5); await this.frame(); }
    this.page.mx = x1; this.page.my = y;
  }
}
