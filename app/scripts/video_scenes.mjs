// The two videos as scenes: what is said (the script the team records) and what the screen shows (recorded frame by
// frame from the live site, light theme, with a drawn cursor). Each scene lasts as long as its words take to say,
// or as long as the recorded voice when video/voice/<video>/<id>.json gives a length. A scene with parts shows
// several pages under one line (each part gets its share of the time). The edit (video/edit.py) speeds the whole
// video up a little (speed) so it fits its limit (max seconds).
// Usage: node scripts/video_scenes.mjs <demo|final> [scene ids...]   (--script prints the script as JSON)
import { launch, scenePage, Film, sleep, FPS, FF } from './video_rec.mjs';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SITE = process.env.FH_SITE ?? 'https://warren-530.github.io/fire-harmony/';
const OUT = `${process.env.HOME}/nasa_work/tmp/video2`;
const REPO = new URL('../..', import.meta.url).pathname;
const READY = '.fh-ex[data-series-ready="true"] .fh-ex-map[data-ready="true"]';
const NARROW = { width: 1120, height: 630 };      // Methods: a narrower window, so the text column fills the frame

// a speaking pace of about 150 words a minute, plus a breath
export const words = (s) => s.split(/\s+/).filter(Boolean).length;
const plan = (say, pace = 2.5) => (say ? words(say) / pace + 0.6 : 2);

// --- helpers for the scenes ----------------------------------------------------------------------------------------
const fig = (page, text) => page.locator('figure', { hasText: text }).first();
const plot = (page, text) => fig(page, text);   // Film.chart() picks the chart in it
async function jumpTo(page, loc, top = 96) {          // before filming: put an element near the top, no animation
  await loc.waitFor({ state: 'attached', timeout: 60000 });
  await loc.evaluate((e, t) => { e.scrollIntoView({ block: 'start' }); window.scrollBy(0, -t); }, top);
  await sleep(1500);
}
async function methods(page, text, top = 96) {
  await jumpTo(page, page.locator('h2, h3, figure', { hasText: text }).first(), top);
}
const ready = (page) => page.waitForSelector(READY, { timeout: 120000 });
const has = (sel) => (page) => page.waitForSelector(sel, { timeout: 90000 });
const card = (p, text) => p.locator('h3', { hasText: text }).first();

// shared actions
async function searchKalimantan(f, quick = false) {
  await f.click('.fh-input', { after: 0.15 }); await f.type('Central Kal', quick ? { min: 1, max: 3 } : {});
  await f.until(() => document.querySelectorAll('.fh-listbox [role="option"]').length > 0, { max: 20 });
  await f.sec(quick ? 0.1 : 0.3); await f.click('.fh-listbox [role="option"]', { after: 0.2 });
  await f.until(() => document.querySelector('.fh-ex-name')?.textContent.includes('Central Kalimantan'), { max: 30 });
}

// --- the scenes ---------------------------------------------------------------------------------------------------
export const VIDEOS = {
  demo: { pace: 2.6, speed: 1.12, max: 30, scenes: [
    { id: 'd1', url: 'hub.html', say: 'Hi, we are Kopi and Cosmos, and this is Fire Harmony.',
      run: async (f) => { await f.sec(0.5); await f.moveEl('a:has-text("Open the web app")', { ms: 1300 }); await f.sec(0.6); } },
    { id: 'd2', url: '#/methods', view: NARROW, prep: (p) => methods(p, 'Joined naively, the record jumps', 70),
      say: "NASA's fire record jumps eight times in 2012, just because a sharper satellite arrived.",
      run: async (f, p) => { await f.sweepFig(plot(p, 'Joined naively, the record jumps'), { y: 0.45, x0: 0.15, x1: 0.62, ms: 3200 }); } },
    { id: 'd3', url: '#/methods', view: NARROW, prep: (p) => methods(p, 'From MODIS alone, the model tracks VIIRS', 70),
      say: 'We train the model on years both satellites flew, putting 26 years of fire on one scale.',
      run: async (f, p) => { await f.sweepFig(fig(p, 'The model sees only MODIS'), { y: 0.4, x0: 0.1, x1: 0.85, ms: 3600 }); } },
    { id: 'd4', url: '#/', wait: ready,
      say: 'Search any place: you get its burning calendar, and how unusual this month is, and why.',
      run: async (f) => {
        await searchKalimantan(f, true); await f.sec(0.6);
        await f.click('[role="tab"]:has-text("Calendar")', { after: 0.4 });
        await f.moveEl(await f.chart('.fh-ex-cal'), { dx: 0.62, dy: 0.62, ms: 500 });
        await f.click('[role="tab"]:has-text("Why")', { after: 0.6 });
      } },
    { id: 'd5', say: 'Plus an outlook, a dashboard, rankings, haze over Malaysia, an AI assistant, and open downloads.',
      parts: [
        { share: 0.17, url: '#/?area=state:IDN-1931&month=202610&tab=outlook', wait: ready,
          run: async (f, p) => { await f.moveEl(p.locator('.fh-ex-tabpanel').getByText('chance of an above').first(), { dx: 0.4, ms: 500 }); } },
        { share: 0.18, url: '#/dashboard', wait: has('main figure svg'),
          run: async (f) => { await f.move(700, 360, 400); await f.scroll(700, 1300); } },
        { share: 0.16, url: '#/rankings?kind=state&trend=rising', wait: has('.rk-row'),
          run: async (f) => { await f.moveEl('.rk-row', { nth: 1, dx: 0.3, ms: 500 }); await f.scroll(260, 700); } },
        { share: 0.16, url: '#/haze?city=Kuala+Lumpur', wait: has('main figure svg'),
          run: async (f) => { await f.sweepFig('main', { y: 0.5, ms: 1500 }); } },
        { share: 0.17, url: '#/?area=state:IDN-1931&month=202610', wait: ready,
          prep: async (p) => {
            await p.click('.fh-ask-btn'); await p.fill('.fh-ask-form textarea', 'How unusual was October 2026 in Central Kalimantan?');
            await p.keyboard.press('Enter'); await p.waitForSelector('.fh-ask-views, .fh-ask-ai[data-error]', { timeout: 90000 }); await sleep(800);
          },
          run: async (f, p) => { await f.moveEl(p.locator('.fh-ask-ai').last(), { dx: 0.5, dy: 0.4, ms: 600 }); await f.moveEl('.fh-ask-view', { ms: 500 }); } },
        { share: 0.16, url: '#/data', wait: has('main h2'),
          run: async (f) => { await f.move(600, 380, 500); await f.scroll(420, 1000); } },
      ] },
    { id: 'd6', url: 'hub.html', say: 'Free, no login.', end: true,
      run: async (f) => { await f.sec(0.3); await f.moveEl('a:has-text("Open the web app")', { ms: 900 }); } },
  ] },

  final: { pace: 2.5, speed: 1.11, max: 298, scenes: [
    // opening
    { id: 'f01', url: 'hub.html',
      say: 'Hi, we are Kopi and Cosmos from Kuala Lumpur. We took on the challenge of harmonizing MODIS and VIIRS fire hotspots, and this is what we built: Fire Harmony.',
      run: async (f) => { await f.sec(1.0); await f.moveEl('.shot img', { dx: 0.4, dy: 0.45, ms: 1300 }); await f.sec(1.4); await f.moveEl('a:has-text("Open the web app")', { ms: 1200 }); } },
    // the problem
    { id: 'f02', url: '#/methods', view: NARROW, prep: (p) => methods(p, 'Joined naively, the record jumps', 60),
      say: "Since 2000, NASA satellites have flagged every hot pixel they see. In 2012 VIIRS joined MODIS, with a much sharper eye for small fires, and world fire seems to jump eight times overnight. That jump isn't real, and it hides the real changes.",
      run: async (f, p) => {
        const s = plot(p, 'Joined naively, the record jumps');
        await f.sweepFig(s, { y: 0.55, x0: 0.08, x1: 0.42, ms: 4000 }); await f.sec(0.5);
        await f.sweepFig(s, { y: 0.35, x0: 0.42, x1: 0.62, ms: 2600 }); await f.sec(1.0);
        await f.sweepFig(s, { y: 0.45, x0: 0.62, x1: 0.95, ms: 2800 });
      } },
    { id: 'f03', url: '#/', wait: ready,
      say: 'You can see it in the app. Switch the map to raw, and the panel shows the jump. Back to harmonized, and it is gone.',
      run: async (f, p) => {
        await f.click('.fh-ex-controls-toggle', { ms: 600, after: 0.25 });
        await f.click('[role="radio"]:has-text("Raw")', { ms: 550, after: 0.4 });
        const title = p.locator('.fh-ex-panel').getByText('Raw detections jump').first();
        await f.moveEl(title, { dx: 0.4, ms: 650 });
        const b = await title.boundingBox();
        await f.scroll(Math.max(0, b.y - 330), 600);
        const c = await title.boundingBox();
        await f.sweep(c.x + 20, c.x + 250, c.y + 110, 1500); await f.sec(0.2);
        await f.click('[role="radio"]:has-text("Harmonized")', { ms: 600, after: 0.4 });
        await f.move(c.x + 160, c.y + 100, 500); await f.sec(0.4);
      } },
    // the data
    { id: 'f04', url: '#/methods', view: NARROW, prep: (p) => methods(p, 'Key numbers', 80),
      say: 'We started from all 640 million NASA FIRMS hotspots from five satellites, plus NASA rain, heat and air quality, and also ESA burned area.',
      run: async (f, p) => {
        const b = await p.locator('h2', { hasText: 'Key numbers' }).first().boundingBox();
        await f.move(b.x + 120, b.y + 150, 900); await f.sec(1.3);
        await f.move(b.x + 420, b.y + 160, 900); await f.sec(1.3);
        await f.move(b.x + 700, b.y + 160, 900); await f.sec(0.8);
        await f.scroll(260, 1400);
      } },
    { id: 'f05', url: '#/methods', view: NARROW, prep: (p) => methods(p, 'VIIRS sees the weak fires', 70),
      say: 'VIIRS splits fire into many more, much weaker hotspots. MODIS sees the strong fires and misses most weak ones.',
      run: async (f, p) => {
        await f.sweepFig(plot(p, 'VIIRS splits fire into many more'), { y: 0.5, x0: 0.15, x1: 0.85, ms: 2800 });
        await f.scrollToEl(fig(p, 'MODIS sees strong fires and misses'), { top: 120, ms: 1200 });
        await f.sweepFig(plot(p, 'MODIS sees strong fires and misses'), { y: 0.5, x0: 0.15, x1: 0.85, ms: 2400 });
      } },
    { id: 'f06', url: '#/methods', view: NARROW, prep: (p) => methods(p, 'Aqua and VIIRS see the afternoon fire', 70),
      say: 'They also pass at different hours: Aqua and VIIRS catch the afternoon fire, Terra the quieter morning, and after 2021 the MODIS orbits drift.',
      run: async (f, p) => {
        await f.sweepFig(plot(p, 'Aqua and VIIRS see the afternoon fire'), { y: 0.5, x0: 0.15, x1: 0.85, ms: 3000 });
        await f.sweepFig(plot(p, 'Terra and Aqua drift from their set hours'), { y: 0.5, x0: 0.2, x1: 0.9, ms: 3000 });
      } },
    { id: 'f07', url: '#/methods', view: NARROW, prep: (p) => methods(p, 'The exchange rate between VIIRS and MODIS changes', 70),
      say: "So there's no single exchange rate between them. It changes from place to place, and it's higher where more fire burns at night.",
      run: async (f, p) => {
        const b = await (await f.chart(plot(p, 'The exchange rate between VIIRS and MODIS changes'))).boundingBox();
        await f.move(b.x + b.width * 0.55, b.y + b.height * 0.55, 900); await f.sec(0.8);
        await f.move(b.x + b.width * 0.7, b.y + b.height * 0.62, 900); await f.sec(0.8);
        await f.moveEl(await f.chart(plot(p, 'The more fire burns at night')), { dx: 0.5, dy: 0.5, ms: 1100 }); await f.sec(0.6);
      } },
    // the method
    { id: 'f08', url: '#/methods', view: NARROW, prep: (p) => methods(p, 'One record on one scale', 70),
      say: "Here's how we harmonize. We count fire on a grid of hexagons. Since 2012 VIIRS observes the fires: its three satellites go on one scale, NOAA-20's, and we average them.",
      run: async (f, p) => {
        await f.sec(1.0);
        await f.scrollToEl(fig(p, 'Since 2012 VIIRS observes the fires'), { top: 110, ms: 1400 });
        await f.sweepFig(plot(p, 'Since 2012 VIIRS observes the fires'), { y: 0.5, x0: 0.1, x1: 0.9, ms: 4000 });
      } },
    { id: 'f09', url: '#/methods', view: NARROW, prep: (p) => methods(p, 'Gradient boosting beats one exchange rate', 70),
      say: 'Before 2012, a gradient boosting model learns from years both sensors flew, and predicts what VIIRS would have counted. It beats a single exchange rate for every area smaller than a continent, and every value gets a 90% range.',
      run: async (f, p) => {
        await f.sweepFig(plot(p, 'Gradient boosting beats one exchange rate'), { y: 0.5, x0: 0.15, x1: 0.85, ms: 3400 });
        await f.scrollToEl(fig(p, 'The model sees only MODIS'), { top: 110, ms: 1300 });
        await f.sweepFig(fig(p, 'The model sees only MODIS'), { y: 0.4, x0: 0.08, x1: 0.92, ms: 4600 });
      } },
    { id: 'f10', url: '#/methods', view: NARROW, prep: (p) => methods(p, 'Removing heat that is not fire', 70),
      say: "We also remove heat that isn't fire, like gas flares, volcanoes and factories. Our mask catches most of it and keeps almost every real fire.",
      run: async (f, p) => {
        await f.sec(0.8);
        await f.scrollToEl(fig(p, 'The mask catches most static heat'), { top: 110, ms: 1300 });
        await f.sweepFig(plot(p, 'The mask catches most static heat'), { y: 0.5, x0: 0.15, x1: 0.85, ms: 3000 });
      } },
    // the proof
    { id: 'f11', url: '#/methods', view: NARROW, prep: (p) => methods(p, 'How we know it works', 70),
      say: 'So, does it work? At both satellite switches the record moves by less than one percent, as little as at dates when nothing changed. ESA burned area agrees. And on months the model never saw, its 90% ranges hold 92 to 96% of the time.',
      run: async (f, p) => {
        await f.sec(0.6);
        await f.moveEl(card(p, 'Does the record jump when the satellites change?'), { dx: 0.3, dy: 3, ms: 900 }); await f.sec(1.2);
        await f.moveEl(card(p, 'Does burned area, a different measurement, agree?'), { dx: 0.3, dy: 3, ms: 900 }); await f.sec(1.2);
        await f.moveEl(card(p, 'Do the 90% ranges hold nine times in ten?'), { dx: 0.3, dy: 3, ms: 900 }); await f.sec(0.8);
      } },
    { id: 'f12', url: '#/methods', view: NARROW, prep: (p) => methods(p, 'Do the 90% ranges hold nine times in ten?', 120),
      say: 'We test the outlook the same way. One month ahead it beats a fixed 50% chance, and when it says 74%, it happens 74% of the time.',
      run: async (f, p) => {
        await f.moveEl(card(p, 'Does the outlook beat a simple forecast'), { dx: 0.3, dy: 0.5, ms: 900 }); await f.sec(0.8);
        await f.moveEl(card(p, 'Does the outlook beat a simple forecast'), { dx: 0.4, dy: 6, ms: 900 }); await f.sec(1.0);
      } },
    { id: 'f13', url: '#/methods', view: NARROW, prep: (p) => methods(p, 'Many tests at once', 70),
      say: 'For trends, we run Mann-Kendall tests with false discovery control, so a place only turns red or blue when its trend is real. Fire fell in 2.4 times as many places as it rose.',
      run: async (f, p) => {
        await f.sec(0.8);
        await f.scrollToEl(fig(p, 'Fire fell in more places than it rose'), { top: 90, ms: 1500 });
        await f.sweepFig(plot(p, 'Fire fell in more places than it rose'), { y: 0.5, x0: 0.12, x1: 0.88, ms: 3400 });
      } },
    { id: 'f14', url: '#/methods', view: NARROW, prep: (p) => methods(p, 'The trends do not come from the harmonization', 70),
      say: "And the trends don't come from our model: a record built from MODIS alone agrees on the direction in 48 of 49 countries.",
      run: async (f, p) => {
        const b = await (await f.chart(plot(p, 'The trends do not come from the harmonization'))).boundingBox();
        await f.move(b.x + b.width * 0.3, b.y + b.height * 0.6, 900); await f.sec(0.6);
        await f.move(b.x + b.width * 0.55, b.y + b.height * 0.45, 900); await f.sec(0.6);
        await f.move(b.x + b.width * 0.75, b.y + b.height * 0.3, 900);
      } },
    // the app
    { id: 'f15', url: '#/', wait: ready,
      say: 'Now, the app is free, with no login. Every hexagon is a month of fire on one scale; press play, and the season moves across the map.',
      run: async (f) => {
        await f.move(760, 400, 900); await f.sec(0.5); await f.move(880, 450, 800); await f.sec(0.5);
        await f.click('button[aria-label^="Play the months"]', { after: 0.3 }); await f.move(820, 420, 1200);
      } },
    { id: 'f16', url: '#/', wait: ready,
      say: "Let's search Central Kalimantan, in Borneo. October 2026 burned at almost 14 times normal; only two Octobers since 2000 were worse.",
      run: async (f) => { await searchKalimantan(f); await f.sec(1.4); await f.moveEl('.ui-stat', { nth: 0, dx: 0.5, dy: 0.6, ms: 900 }); await f.sec(0.8); } },
    { id: 'f17', url: '#/?area=state:IDN-1931&month=202610&tab=calendar', wait: ready,
      say: 'The burning calendar shows every month since 2000. The season is August to October, and the bad years stand out: 2015, 2006, and this year.',
      run: async (f) => {
        await f.click('button[aria-label="Expand calendar"]', { after: 0.4 });
        await f.until(() => !!document.querySelector('.fh-calf[open] .fh-calf-cell'), { max: 30 });
        await f.sec(0.6);
        for (const ym of ['201509', '200610', '202610']) { await f.moveEl(`.fh-calf-cell[data-ym="${ym}"]`, { ms: 950 }); await f.sec(1.0); }
      } },
    { id: 'f18', url: '#/?area=state:IDN-1931&month=202610&tab=period', wait: ready,
      say: 'I can pick any period, like August to October 2019, and get its total, its normal and its rank. One click downloads every hotspot as a spreadsheet.',
      run: async (f) => {
        await f.until(() => !!document.querySelector('.pp-tiles'), { max: 30 });
        await f.click('.pp-when[data-end="from"]', { after: 0.4 });
        await f.click('.pp-month[data-ym="201908"]', { after: 0.4 });
        await f.click('.pp-month[data-ym="201910"]', { after: 0.6 });
        await f.moveEl('.pp-tile-value', { nth: 0, ms: 800 }); await f.sec(0.7);
        await f.moveEl('.pp-tile-value', { nth: 2, ms: 700 }); await f.sec(0.7);
        await f.click('button:has-text("Download")', { after: 0.5 });
        await f.moveEl('[role="menuitem"]', { nth: 1, ms: 700 }); await f.sec(0.8);
        await f.key('Escape', 0.2);
      } },
    { id: 'f19', url: '#/?area=state:IDN-1931&month=202610&tab=why', wait: ready,
      say: 'Why was it so bad? Rain far below normal for three months, and a strong El Niño. Here, rain alone explains two thirds of the swings.',
      run: async (f, p) => {
        const tp = p.locator('.fh-ex-tabpanel');
        await f.sec(0.3);
        await f.moveEl(tp.getByText('Rain, this month').first(), { dx: 0.5, ms: 800 }); await f.sec(1.0);
        await f.moveEl(tp.getByText('El Niño index').first(), { dx: 0.5, ms: 700 }); await f.sec(0.8);
        await f.scroll(300, 1300); await f.sec(0.5);
      } },
    { id: 'f20', url: '#/?area=state:IDN-1931&month=202610&tab=outlook', wait: ready,
      say: 'The outlook gives an 80% chance of above normal fire in November.',
      run: async (f, p) => { await f.sec(0.3); await f.moveEl(p.locator('.fh-ex-tabpanel').getByText('chance of an above').first(), { dx: 0.4, ms: 900 }); await f.sec(1.0); } },
    { id: 'f21', reuse: 'keep_3d_trend.mp4',   // 3D takes minutes per second of video without a GPU: kept from an earlier take
      url: '#/?area=state:IDN-1931&month=202610', wait: ready,
      say: 'In 3D, height is fire. And the trend view shows where fire has really been rising or falling since 2001.',
      run: async (f) => {
        await f.click('.fh-ex-controls-toggle', { after: 0.4 }); await f.click('.fh-ex-3d', { after: 0.3 }); await f.sec(2.2);
        await f.click('[role="radio"]:has-text("Trend 2001 to 2025")', { after: 0.4 }); await f.sec(1.0);
        await f.click('button[aria-label="Close map settings"]', { after: 0.3 }); await f.move(900, 420, 900); await f.sec(1.2);
      } },
    { id: 'f22', url: '#/?area=state:IDN-1931&month=202610', wait: ready,
      say: 'Not just countries and states: draw a box or any shape, or type a city for the 50 kilometres around it, and every number follows.',
      run: async (f) => {
        await f.click('button:has-text("Rectangle")', { after: 0.5 });
        await f.drag(760, 300, 960, 460, 1300);
        await f.until(() => !document.querySelector('.fh-ex-name')?.textContent.includes('Central Kalimantan'), { max: 30 });
        await f.sec(1.0);
        await f.moveEl('.ui-stat', { nth: 0, dx: 0.5, dy: 0.6, ms: 900 }); await f.sec(0.8);
      } },
    { id: 'f23', url: '#/dashboard', wait: has('main figure svg'),
      say: "The Dashboard holds every statistic for the world or any area: the burning calendar, the seasons, the trend, the seam test and the model's error.",
      run: async (f) => {
        await f.move(700, 320, 800); await f.sec(0.4);
        await f.scroll(620, 1500); await f.sweepFig('main', { nth: 1, y: 0.5, ms: 1800 });
        await f.scroll(900, 1600); await f.sec(0.4); await f.scroll(900, 1600);
      } },
    { id: 'f24', url: '#/rankings', wait: has('.rk-row'),
      say: 'Rankings puts all 4,330 places in one table: sort by trend, filter by continent, and click a row to open it.',
      run: async (f, p) => {
        await f.click(p.getByRole('button', { name: /Rising fastest/ }).first(), { after: 0.8 });
        await f.moveEl('.rk-row', { nth: 0, dx: 0.3, ms: 900 }); await f.sec(0.6);
        await f.moveEl('.rk-row', { nth: 2, dx: 0.3, ms: 700 }); await f.sec(0.6);
        await f.scroll(300, 1200);
      } },
    { id: 'f25', url: '#/haze?city=Kuala+Lumpur', wait: has('main figure svg'),
      say: 'The Haze page links fires to the air: for Kuala Lumpur and 27 other cities, how much of the PM2.5 is smoke from Sumatra and Borneo.',
      run: async (f) => { await f.sec(0.4); await f.sweepFig('main', { y: 0.5, ms: 3000 }); await f.scroll(320, 1300); await f.sweepFig('main', { nth: 1, y: 0.5, ms: 2000 }); } },
    { id: 'f26', url: '#/?area=state:IDN-1931&month=202610&tab=calendar', wait: ready, phone: true,
      say: 'And all of it works on a phone.',
      run: async (f) => { await f.sec(0.4); await f.swipe(195, 418, 140, 800); await f.sec(0.8); } },
    { id: 'f27', url: '#/?area=state:IDN-1931&month=202610', wait: ready,
      say: 'And you can just ask, in plain words. The assistant looks the numbers up in our own data and links each place to the map.',
      run: async (f, p) => {
        await f.click('.fh-ask-btn', { ms: 600, after: 0.3 });
        await f.click('.fh-ask-form textarea', { ms: 450, after: 0.1 }); await f.type('Compare Riau in 2015 and 2019', { min: 1, max: 2 });
        await f.key('Enter', 0.2);
        await f.sec(0.9);                // a moment of the busy dots on screen; the rest of Gemini's wait is cut
        // the page clock keeps running while we wait (the assistant's timers need it), but no frames are taken
        for (const t0 = Date.now(); Date.now() - t0 < 90000 && !(await p.evaluate(() => !!document.querySelector('.fh-ask-views'))); ) {
          await p.evaluate(() => window.__fhV.frame(250)); await sleep(250);
        }
        await f.sec(0.5);
        await f.moveEl(p.locator('.fh-ask-ai').last(), { dx: 0.5, dy: 0.35, ms: 600 }); await f.sec(0.8);
        await f.moveEl('.fh-ask-view', { ms: 600 }); await f.sec(0.6);
      } },
    { id: 'f28', url: '#/data', wait: has('main h2'),
      say: 'Everything is open: the record, the maps and all 640 million hotspots, with the code.',
      run: async (f) => { await f.move(600, 380, 900); await f.scroll(420, 1800); await f.move(760, 420, 800); } },
    // who it is for, and what comes next
    { id: 'f29', url: '#/?area=state:ARG-1308&month=202202&tab=calendar', wait: ready,
      say: 'Who is it for? Fire managers checking if a season is unusual, like Corrientes, Argentina, in 2022. Health agencies watching the haze. And scientists, who get a record they can trust from 2001.',
      run: async (f) => {
        await f.sec(0.6);
        await f.moveEl(await f.chart('.fh-ex-cal'), { dx: 0.25, dy: 0.9, ms: 1200 }); await f.sec(1.4);
        await f.move(820, 420, 1200); await f.sec(0.8);
      } },
    { id: 'f30', url: '#/?area=country:ARG&month=202202', wait: ready,
      say: "Next, we would like to add CONAE's hotspot catalogue for Argentina, update the record every day, and send alerts when fire runs far above normal.",
      run: async (f) => { await f.sec(0.5); await f.move(800, 380, 1200); await f.sec(0.6); await f.move(880, 470, 1000); } },
    { id: 'f31', url: 'hub.html', end: true, say: "That's Fire Harmony: one record, every fire. We are Kopi and Cosmos. Thanks for watching!",
      run: async (f) => { await f.sec(0.5); await f.moveEl('a:has-text("Open the web app")', { ms: 1100 }); } },
  ] },
};

// the length of each scene: the recorded voice if there is one, else the planned pace
export function target(video, sc) {
  const voice = `${REPO}video/voice/${video}/${sc.id}.json`;
  if (existsSync(voice)) return JSON.parse(readFileSync(voice, 'utf8')).seconds;
  return plan(sc.say, VIDEOS[video].pace);
}

async function film(browser, part, out, goal) {
  const page = await scenePage(browser, { view: part.view, phone: part.phone });
  await page.goto(SITE + part.url, { waitUntil: 'domcontentloaded' });
  if (part.wait) await part.wait(page); else await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(2000);
  if (part.prep) await part.prep(page);
  if (!part.phone) { await page.mouse.move(page.mx, page.my); await sleep(300); }
  const f = await new Film(page, out).start();
  try { await part.run(f, page); } catch (e) { console.warn(`${out.split('/').pop()}: ${String(e).split('\n')[0]}`); }
  const acted = f.n / FPS;
  await f.idleTo(goal);
  const r = await f.stop();
  await page.context().close();
  return { acted, ...r };
}

async function main() {
  const [video, ...ids] = process.argv.slice(2);
  if (video === '--script') {
    console.log(JSON.stringify(Object.fromEntries(Object.entries(VIDEOS).map(([k, v]) => [k, {
      speed: v.speed ?? 1, max: v.max, scenes: v.scenes.map((s) => ({ id: s.id, say: s.say, seconds: +target(k, s).toFixed(2) })) }])), null, 1));
    return;
  }
  const V = VIDEOS[video];
  if (!V) throw new Error('usage: video_scenes.mjs <demo|final> [ids]');
  const dir = `${OUT}/${video}`; mkdirSync(dir, { recursive: true });
  const browser = await launch();
  const log = [];
  for (const sc of V.scenes.filter((s) => !ids.length || ids.includes(s.id))) {
    const goal = target(video, sc);
    const out = `${dir}/${sc.id}.mp4`;
    let r;
    if (sc.reuse && existsSync(`${OUT}/${sc.reuse}`)) {
      execFileSync('cp', [`${OUT}/${sc.reuse}`, out]); r = { acted: 0, realSeconds: 0 };
    } else if (sc.parts) {
      const files = [];
      let acted = 0, real = 0;
      for (const [k, part] of sc.parts.entries()) {
        const pf = `${dir}/${sc.id}_p${k + 1}.mp4`;
        const pr = await film(browser, part, pf, goal * part.share);
        files.push(pf); acted += pr.acted; real += pr.realSeconds;
      }
      const list = `${dir}/${sc.id}_parts.txt`;
      writeFileSync(list, files.map((x) => `file '${x}'\n`).join(''));
      execFileSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
      for (const x of [...files, list]) unlinkSync(x);
      r = { acted, realSeconds: real };
    } else {
      r = await film(browser, sc, out, goal);
    }
    log.push({ id: sc.id, goal: +goal.toFixed(2), acted: +r.acted.toFixed(2) });
    console.log(`${sc.id}: goal ${goal.toFixed(1)} s, actions ${r.acted.toFixed(1)} s, ${r.realSeconds.toFixed(0)} s to film`);
  }
  await browser.close();
  const file = `${dir}/scenes.json`;
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  for (const l of log) prev[l.id] = l;
  writeFileSync(file, JSON.stringify(prev, null, 1));
}
if (process.argv[1]?.endsWith('video_scenes.mjs')) await main();
