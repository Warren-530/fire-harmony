export const meta = {
  name: 'fire-harmony-qa-review',
  description: 'Six independent read-only reviews of the redesigned app (layout at 11 screen sizes, benchmark against leading apps, function, design, accessibility, numbers), then a skeptic per area re-checks every finding',
  phases: [
    { title: 'Review', detail: 'layout, benchmark, functional, design, accessibility and numbers reviewers, read only' },
    { title: 'Verify', detail: 'one skeptic per area tries to reproduce or refute each finding' },
  ],
}

const CONTEXT = `
PROJECT: Fire Harmony, a NASA Space Apps 2026 web app: one harmonized worldwide fire record (MODIS + VIIRS hotspots on
the NOAA-20 VIIRS scale, Nov 2000 to Oct 2026) with a burning calendar, anomalies, drivers, outlook and downloads for any
area. English only. The app was just redesigned ("Mission Control": dark first with a light theme, glass panels, one ember
accent, JetBrains Mono for numbers, Inter for text). Design rules: app/DESIGN.md. Shared building blocks:
app/src/components/ui.tsx and app/src/styles/theme.css.

WHERE: app at /home/sawy3/nasa_work/fire-harmony/app (React 19, Vite, TypeScript, DuckDB-WASM reading Parquet over HTTP,
MapLibre + deck.gl H3 hexagons, Observable Plot). The Vite dev server is ALREADY RUNNING at http://127.0.0.1:5173 and
serves the data under /data/ (from /home/sawy3/nasa_work/data/products/v1.0). Never start, stop or restart it.
Routes: #/ (Explorer: map, area panel with tabs Overview, Calendar, Period, Why, Outlook, Download; timeline dock;
map controls; deep links like #/?area=state:IDN-1931&month=202610), #/dashboard, #/haze, #/methods, #/data. Also
/hub.html (the submission hub page, standalone). Command palette: Ctrl+K or "/". Shortcuts dialog: "?". T switches theme.

BROWSER: headless Chrome through playwright-core. Scripts must live under /home/sawy3/nasa_work/fire-harmony/app/qa/<your
folder>/ (so "import { chromium } from 'playwright-core'" resolves) and run with node from the app folder. Launch with
executablePath '/usr/bin/google-chrome' and args ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
'--ignore-gpu-blocklist', '--disable-gpu-rasterization'] (the last one stops banded tiles in tall screenshots). For pages
taller than 8,000 px take the screenshot in parts with clip (one capture that tall repeats the top). Set the theme before load: page.addInitScript(() => localStorage.setItem('fh_theme', 'light'))
(default dark). The map needs WebGL; give the Explorer up to 90 s on the first load (DuckDB-WASM warm up).
Existing scripts you may run and read: scripts/shots.mjs (every page: screenshots + console errors; env SHOTS_ONLY,
SHOTS_WIDTH, SHOTS_THEME, SHOTS_HEIGHT), scripts/test_explorer.mjs (26 checks), scripts/test_period.mjs (the Period tab:
presets, pickers, downloads), the
dashboard and page test scripts under scripts/ or app/qa if any, scripts/shot_page.mjs. Type check: npx tsc --noEmit -p
tsconfig.app.json. Unit tests: npx vitest run.

LIMITS: the machine has 7.7 GB of RAM shared with other work and another reviewer runs at the same time as you. Use at most
ONE browser at a time (one context, a few pages), close it when done, and keep scripts small.

THE OWNER'S BAR (quote): "make sure the view is responding, for laptop and mobile view all adapted. Then also make sure
the component wont covered themselve, make sure the design is aesthetic, modern, clear and also high tech, interactive
enough, please refer to some famous tech app for the design also, it must be perfect".

KNOWN AND ACCEPTED (do not report): headless SwiftShader makes the first 3D render and the first map hover slow (20 to 100 s);
the two video links on /hub.html are placeholders (#todo-...); the outlook covers fire season months only, by design; hexagons
at sea show coordinates, not a place name; the data are the published v1.0 files (do not report data age). Python with DuckDB: /home/sawy3/nasa_work/fire-harmony/.venv/bin/python.

RULES (strict): you are a REVIEWER. Do not edit, create or delete anything under app/src, app/scripts, app/public,
report/, fireharmony/, tests/ or data/. Write only your own scratch files under app/qa/<your folder>/ and /tmp/qa_<your
folder>/. No git commands. Report what is wrong with enough detail that someone else can reproduce it in minutes: the
page, the width and theme, the exact steps, what you saw (quote the text or the console line, give the screenshot path)
and what you expected. Do not report a guess as a finding: reproduce it first. Say which files most likely need the fix.
Severity: critical (broken function, crash, wrong number, data loss, blocker for a judge), major (clearly wrong or ugly,
hurts the experience), minor (small visual or text issue), polish (nice to have).`

const FINDINGS = {
  type: 'object',
  properties: {
    checked: { type: 'array', items: { type: 'string' }, description: 'what you checked (one line each), including what passed' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'short unique id, e.g. F-explorer-3' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor', 'polish'] },
          area: { type: 'string', enum: ['explorer', 'period', 'dashboard', 'haze', 'methods', 'data', 'shared', 'hub', 'data-products'] },
          title: { type: 'string' },
          steps: { type: 'string', description: 'page, width, theme and exact steps to reproduce' },
          observed: { type: 'string' },
          expected: { type: 'string' },
          evidence: { type: 'string', description: 'screenshot paths, console lines, measured values' },
          files: { type: 'array', items: { type: 'string' } },
          suggestion: { type: 'string' },
        },
        required: ['id', 'severity', 'area', 'title', 'steps', 'observed', 'expected', 'evidence', 'files'],
      },
    },
  },
  required: ['checked', 'findings'],
}

const VIEWPORTS = '1920x1080, 1440x900, 1366x768, 1280x800, 1024x768, 820x1180, 768x1024, 430x932, 390x844, 360x740, 320x640'

const REVIEWERS = [
  { key: 'layout', prompt: `${CONTEXT}

YOUR FOLDER: layout. YOUR JOB: prove that no component covers another and that every page adapts to every screen, with
measurements, not impressions. Write one script that, for every page (the Explorer with a named area selected and with
the Period tab open, the dashboard, haze, methods, data and /hub.html) at every viewport (${VIEWPORTS}), in dark and
light, and for the Explorer also in 3D view and with the timeline dock visible:
- collects the bounding boxes of every visible element that shows text or is a control (buttons, inputs, selects,
  links, chips, tabs, legend items, tooltips, panels, the timeline dock, map controls, headers, tiles);
- reports pairs that overlap by more than 2 px where neither contains the other (a control over text, a panel over a
  control, a tooltip clipped by the window, two labels on top of each other), ignoring elements that are meant to sit
  on the map (but NOT panels or controls on top of other panels or controls);
- reports text that is clipped (scrollWidth > clientWidth + 1 with overflow hidden and no ellipsis, or lines cut at the
  bottom), elements outside the window on the left or right, any sideways scroll, controls smaller than 44 x 44 px on
  touch sized screens (width 430 or less), and font sizes below 11 px;
- takes a screenshot of each page and viewport and marks the problems on it (draw boxes with page.evaluate) so others
  can see them.
Then look at the marked screenshots yourself and report each real problem (merge duplicates; one finding per cause).` },
  { key: 'benchmark', prompt: `${CONTEXT}

YOUR FOLDER: benchmark. YOUR JOB: make the app look and feel like the best tech products. First study how leading
apps solve the same problems, using what you know and the web (WebFetch on design write ups and documentation, for
example the Vercel Geist design system, Linear's design notes, Apple's Human Interface Guidelines for maps, sheets and
materials, Windy.com, Flightradar24, kepler.gl, NASA Worldview, Stripe's dashboard): a full screen map with a timeline
(Windy, Worldview), a map with a side panel and a bottom sheet on phones (Apple Maps, Flightradar24), 3D hexagon layers
(kepler.gl), analytics tiles and charts (Vercel, Stripe), keyboard first precision UI and the command palette (Linear,
Raycast). Then take screenshots of every page of our app (dark and light, 1440 and 390 px; the Explorer in several
states) and compare. Write a concrete upgrade spec: for each page and for the shared design system, the specific
changes (layout, spacing on an 8 px grid, type scale, colour use, depth and materials, motion with durations and
easing, hover and press states, empty and loading states, micro interactions, the phone layout) that would make it
match those products, each with the reference it comes from, the files to change and how to check it is done. Keep the
data, the numbers and the English copy; keep the project's palette rules (ember for fire, the blue to red anomaly
scale, the sensor colours) and DESIGN.md's direction; nothing that hurts speed or accessibility. Report every
spec item as a finding with severity major (clearly below the reference) or minor/polish, and put the full spec in
evidence.` },
  { key: 'functional', prompt: `${CONTEXT}

YOUR FOLDER: functional. YOUR JOB: prove that every function works, in a real browser, at 1440 px and 390 px, in dark and
light. Run the type check, the unit tests and the existing test scripts first and report their results. Then write
and run your own checks for anything they do not cover. At least:
- Explorer: search and pick places (Indonesia, Riau, Brazil, World), the 4,329 place list never breaks (type odd
  strings, accents, numbers); draw a rectangle, a polygon and a circle; type coordinates; click a hexagon; back to world;
  deep links (#/?area=state:IDN-1931&month=202610 and with mode, view, scale), browser back and forward; the timeline
  (play, pause, step, speed, drag the scrubber); 2D and 3D; colour by count and by anomaly; the scales; every tab; the
  Period tab (presets, month pickers, a click on a year bar, both downloads: open the files and check the columns and
  that dates are inside the period); every Download tab file (open it); copy link; keyboard shortcuts (Space, arrows,
  Shift+arrows, D, C, A, Escape) and that they do not fire while typing.
- Dashboard, Haze, Methods, Data: every control, link, tooltip, table, download and deep link; the command palette and
  the shortcuts dialog from every page; the theme switch on every page; no console errors or failed requests.
- /hub.html: every link (note which are placeholders; that is expected, do not report the placeholder hrefs).
Report real failures only.` },
  { key: 'design', prompt: `${CONTEXT}

YOUR FOLDER: design. YOUR JOB: judge the visual design like a senior product designer preparing a demo for judges. Read
app/DESIGN.md first. Take screenshots of every page in dark and light at 1440, 1024 and 390 px wide (full page), and of
the Explorer states: first load, a named area, a drawn shape, 3D view, each tab including Period, the timeline playing,
the command palette and the shortcuts dialog, hover tooltips on the map and charts, loading skeletons and error states
where you can trigger them (for example a deep link to an unknown area). View every screenshot yourself (open the
PNG files) and inspect them closely. Report: overlapping or clipped text, misalignment, inconsistent spacing, type sizes
or weights between pages, colours that break the theme (a light patch in dark or the reverse), charts with unreadable
labels, controls that look disabled when they are not, layout that breaks or scrolls sideways at 390 px, empty or awkward
areas, and anything that does not look professional and high tech. Give the screenshot path for each finding.` },
  { key: 'accessibility', prompt: `${CONTEXT}

YOUR FOLDER: accessibility. YOUR JOB: check that the app works for people who use only a keyboard, a screen reader, or
need strong contrast or less motion, on every page. Check: every control reachable and usable by keyboard in a sensible
order, with a visible focus ring; no keyboard trap (dialogs close with Escape and return focus); every button, input,
select, chart and map control has an accessible name (use page.accessibility.snapshot() or the ARIA attributes); tabs,
dialogs, toasts and live regions use the right roles; text contrast at least 4.5:1 (3:1 for large text and for chart
marks and UI parts) in BOTH themes, measured with getComputedStyle colours composited over the real background; touch
targets at least 44 px on phones (390 px); prefers-reduced-motion respected (emulate it with page.emulateMedia); no
information given by colour alone; the page language and titles are set. Report each failure with the element (a
selector or its text), the measured values and the page.` },
  { key: 'numbers', prompt: `${CONTEXT}

YOUR FOLDER: numbers. YOUR JOB: make sure every number the app shows is right. Compare what the pages show (read the
DOM text in the browser) with the published data in /home/sawy3/nasa_work/data/products/v1.0 (dashboard.json, meta.json,
areas.json, area_monthly.parquet, outlook.parquet, drivers*.parquet, haze.json, hotspots/index.json), computing the
expected values yourself with Python and DuckDB. Cover: every dashboard tile and table and a sample of chart tooltips;
the Explorer tiles, brief and tabs (Overview, Calendar values on hover, Period totals, normal and rank, Why, Outlook) for
World, Indonesia (country:IDN), Riau (state:IDN-492), Central Kalimantan (state:IDN-1931), Malaysia (country:MYS), Brazil
(country:BRA) and a drawn circle; the Haze page; the Methods page numbers; the units and the rounding (a ratio of 13.83
shown as 13.8 times is right; 14 times or 1.38 is wrong). The normal is the median of the same calendar month over
2001 to 2025; the rank counts every year with a value (1 = most fire). Also read report/report.qmd and list any number
in it that disagrees with the data or the app. Report every mismatch with both values and how you computed yours.` },
]

const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          real: { type: 'boolean', description: 'true only if you reproduced it yourself' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor', 'polish'] },
          note: { type: 'string', description: 'what you did and saw; if real, the exact cause and the fix in one or two sentences' },
          files: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'real', 'severity', 'note'],
      },
    },
  },
  required: ['verdicts'],
}

// a small pool: at most LIMIT agents at once (each runs a headless Chrome; more would not fit in 7.7 GB)
const LIMIT = 2
async function pool(items, fn) {
  const out = new Array(items.length)
  let next = 0
  async function worker() { while (next < items.length) { const i = next++; try { out[i] = await fn(items[i], i) } catch (e) { out[i] = null } } }
  await Promise.all(Array.from({ length: Math.min(LIMIT, items.length) }, worker))
  return out
}

phase('Review')
const reviews = await pool(REVIEWERS, (r) =>
  agent(r.prompt, { label: `review:${r.key}`, phase: 'Review', schema: FINDINGS })
    .then((res) => ({ key: r.key, ...(res ?? { checked: [], findings: [] }) })))

const all = reviews.filter(Boolean).flatMap((r) => r.findings.map((f) => ({ ...f, reviewer: r.key })))
log(`${all.length} findings from ${reviews.filter(Boolean).length} reviewers`)

// one skeptic per area: it re-checks every finding of its area and keeps only what it reproduces
const byArea = {}
for (const f of all) (byArea[f.area] = byArea[f.area] || []).push(f)
phase('Verify')
const areas = Object.keys(byArea)
const verified = await pool(areas, (area) =>
  agent(`${CONTEXT}

YOUR FOLDER: verify_${area}. YOU ARE A SKEPTIC. Below are findings that reviewers reported for the area "${area}". For
EACH one, try to reproduce it yourself, following the steps (write a small script if needed). Mark real = true ONLY if
you reproduced it. If you cannot reproduce it, or it is a matter of taste that the design rules do not support, or it
reports a placeholder link on hub.html, mark real = false and say why. You may lower or raise the severity. For real
findings, find the exact cause in the code and describe the fix in one or two sentences, with the files.

FINDINGS:
${JSON.stringify(byArea[area], null, 1)}`, { label: `verify:${area}`, phase: 'Verify', schema: VERDICTS })
    .then((v) => ({ area, verdicts: v?.verdicts ?? [] })))

const verdictById = {}
for (const v of verified.filter(Boolean)) for (const x of v.verdicts) verdictById[x.id] = x
const confirmed = all.filter((f) => verdictById[f.id]?.real).map((f) => ({ ...f, severity: verdictById[f.id].severity,
  cause_and_fix: verdictById[f.id].note, files: verdictById[f.id].files?.length ? verdictById[f.id].files : f.files }))
const rejected = all.filter((f) => verdictById[f.id] && !verdictById[f.id].real).map((f) => ({ id: f.id, title: f.title, why: verdictById[f.id].note }))
const unverified = all.filter((f) => !verdictById[f.id]).map((f) => f.id)
if (unverified.length) log(`not verified (skeptic missing): ${unverified.join(', ')}`)
return {
  checked: Object.fromEntries(reviews.filter(Boolean).map((r) => [r.key, r.checked])),
  confirmed, rejected, unverified,
}
