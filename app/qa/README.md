# QA round (after the Mission Control redesign)

Four independent reviewers, each read only (they report, they do not edit), then fixes by file owner.

1. Functional: every page and control in headless Chrome (1440 and 390 px, dark and light): search, draw, circle, coordinates,
   hexagon click, timeline, 3D, tabs (overview, calendar, period, why, outlook, download), every download (open the file),
   command palette, shortcuts, theme switch, deep links, back and forward. Console errors and failed requests.
2. Design: screenshots of every page (dark and light, 1440, 1024, 390): consistency with DESIGN.md, alignment, spacing,
   type scale, overlaps, truncation, empty and loading states, motion.
3. Accessibility: keyboard only use, focus order and visibility, names of buttons and inputs, contrast of text and chart
   labels in both themes, reduced motion, nothing that needs a mouse or hover only.
4. Numbers: values shown in the app (dashboard tiles and charts, explorer tiles for World, Indonesia, Riau, Central
   Kalimantan, Malaysia, Brazil, a drawn circle; methods page) against data/products/v1.0 and the report.

Test scripts: npx tsc --noEmit -p tsconfig.app.json; npx vitest run; node scripts/test_explorer.mjs;
node scripts/test_period.mjs (lab page); node scripts/shots.mjs (+ SHOTS_THEME=light, SHOTS_WIDTH=390).
