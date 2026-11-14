# Fire Harmony app: design rules (v2, "Mission Control")

Professional, clear, high tech. Dark first (a light theme on request), one accent (the fire), data that glows.
Every page follows these rules so the app reads as one product. English only. They extend the project's Visual
Style Guide (palettes, Inter, chart rules) to a dark, interactive app.

## 1. Look

- **Surfaces** (from `styles/theme.css`): `--bg` page with a faint ember and blue glow, `--surface` cards,
  `--surface-2` raised parts and inputs, `--surface-3` hover. Floating panels over the map use `.ui-glass` (frosted,
  hairline border). Borders are hairlines (`--border`, `--border-strong` on hover). No heavy shadows, no gradients
  except the accent button and the page glow.
- **Text**: `--text`, `--text-2` (secondary), `--text-3` (labels, axes). Contrast at least 4.5:1 for text.
- **Accent**: `--accent` ember orange for the primary action, the active tab, the focus ring (`--focus`) and the
  selected item. Use it sparingly: one accent per view.
- **Data colours** (legacy names, remapped per theme): fire amount `--ember-100` (least) to `--ember-900` (most; on
  dark it is the brightest, so more fire looks hotter); against normal `--anom-b4 … --anom-0 … --anom-r4` (normal is
  dim, far from normal is bright); sensors `--sensor-modis`, `--sensor-snpp`, `--sensor-noaa20`, `--sensor-noaa21`; the
  harmonized record `--harmonized` (2.6 px) with `--band` for its 90% range. Status colours (`--good`, `--warning`,
  `--serious`, `--critical`) only with an icon and a word.
- **Type**: Inter for words; JetBrains Mono (`--font-mono`, class `.ui-mono`) for numbers, dates, coordinates and
  key hints, with tabular figures. Page title 30/700, section 20/650, card 15/600, body 15/1.55, labels 12–13.
  Sentence case. No hyphenated words except official names (NOAA-20, MERRA-2).
- **Icons**: only `components/icons.tsx` (one outline set). Never emoji. Icon buttons always have an aria-label.
- **Shape**: radius 14 px cards (`--radius-lg`), 9 px controls (`--radius-md`), 6 px small parts (`--radius-sm`, alias
  `--radius-xs`), `--radius-pill`.
- **Tokens** (`styles/tokens.css`; colours in `theme.css`). Use them, never literal values:
  type `--fs-12/13/14/15/16/20/30` with `--lh-*`, `--fs-stat-s/m/l`, `--fs-11` only for SVG ticks and key caps,
  `--tracking-caps`; space `--sp-1 … --sp-16` (4 px steps); controls `--ctl-sm` 32, `--ctl` 36, `--ctl-touch` 44 (every
  touch target); elevation `--elev-1` (hover), `--elev-2` (floating), `--elev-3` (dialogs, sheets), `--glow-accent`,
  `--ring-hairline`, `--ring-accent`; motion `--t-press` 90, `--t-fast` 140, `--t-med` 220, `--t-slow` 360, `--t-route` 180,
  `--t-track` 90 with `--ease-out`; layers `--z-raised`, `--z-sticky`, `--z-header`, `--z-modal`, `--z-toast`,
  `--z-tooltip`; glass `--material-thin/regular/thick` (`.ui-glass-thin` for small map chips, `.ui-glass` for panels).
- **Header contract**: `--fh-header-h` is 56 px (48 px in phone landscape). At 880 px and less the header hides while
  the reader scrolls down (`html[data-header-hidden]`, `--fh-header-shift`); sticky bars stick at
  `top: var(--fh-header-h)` and follow it (see `.fh-doc-toc` and `.db-nav` in `app.css`).
- **Tokens** (`styles/tokens.css`; colours in `theme.css`). Use them, never a literal:
  type `--fs-12/13/14/15/16/20/30` with `--lh-*` (`--fs-11` only for SVG ticks and key caps), `--fs-stat-s/m/l`,
  `--tracking-caps` (0.06em, for 12 px capitals); space `--sp-1`…`--sp-16` in 4 px steps, control heights `--ctl-sm` 32,
  `--ctl` 36, `--ctl-touch` 44; radius `--radius-lg` 14, `--radius-md` 9, `--radius-sm` 6, `--radius-pill`;
  elevation `--elev-1` (cards on hover), `--elev-2` (anything floating), `--elev-3` (dialogs, sheets); motion
  `--t-press` 90, `--t-fast` 140, `--t-med` 220, `--t-slow` 360, `--t-route` 180, `--t-track` 90 (progress bars),
  `--ease-out`; layers `--z-raised`, `--z-sticky`, `--z-header`, `--z-modal`, `--z-toast`, `--z-tooltip`.
  A bar that sticks under the app header uses `top: var(--fh-header-visible-h)` (the header hides on phones while
  reading down; app.css already does this for the contents bar, the dashboard sections and the Explorer tabs).

## 2. Building blocks

Shared since the Stage 1 shell: `Tooltip` (`<Tooltip content="Play" keys={['Space']}>`, no `title=`), `ScrollFade` (or the
`ui-scroll-fade` class) for rows that scroll sideways, `ui-press` for custom controls (buttons, chips, tabs and
segmented controls press already), sliding tab and nav indicators, themed Plot tips in every chart. Search:
`lib/search.ts` (`useSearchIndex`, `searchAreas`, `markedParts`, `cityNear`, `useCircleCity`, `recentPlaces`); palette and
commands: `lib/commands.ts` (`openPalette`, `runCommand` for anything that needs the Explorer, `emitCommand`).
From `components/ui.tsx`: Page, PageHeader, Section, Grid, Stack, Card, StatGrid, StatTile, Delta, DataTable,
Segmented, Badge, Note, Callout, Skeleton, PlotFigure (with table view), plotTheme, cssVar.
New: `components/icons.tsx`, `AnimatedNumber` (numbers glide to new values), `Sparkline`, `Toast` (`useToast()`),
`CommandPalette` (Ctrl/Cmd+K or "/"), and `lib/commands.ts` (`emitCommand`, `useCommand`, `openArea`).
CSS helpers in `theme.css`: `.ui-btn` (`-primary`, `-ghost`, `-icon`), `.ui-chip` (aria-pressed), `.ui-tabs`/`.ui-tab`
(aria-selected), `.ui-kbd`, `.ui-tip` (data-tip), `.ui-glass` (`-thin` for rails and chips, `-thick` for dialogs),
`.ui-reveal` (with `style={{'--i': n}}` for stagger), `.ui-press` (the press feedback for a custom control) and
`.ui-scroll-fade` (edge fades for a row that scrolls sideways). Components: `Tooltip` (themed, on focus, hover and long
press; use it instead of `title=`) and `ScrollFade` (a sideways row with fades and, on mouse devices, arrows).

## 3. Interaction

- **Everything is linked**: hovering a month (timeline, calendar, chart) previews it everywhere; clicking commits.
- **Everything is shareable**: the hash holds the view (`#/?area=state:IDN-1931&month=202610&mode=anomaly&view=3d`).
- **Keyboard first**: Ctrl/Cmd+K palette, Space play/pause, Left/Right month, Shift+Left/Right year, D 2D/3D,
  C fire count, A against normal, R trend, + and − zoom the map, T theme, ? shortcuts. Esc closes the top layer first
  (a menu or map settings), then cancels a drawing. Focus is always visible.
- **Layers that close**: every menu and popover closes on Esc and on a press outside it, and that press is swallowed so
  it does not also act on the map (`components/explorer/dismiss.ts`; use it for any new popover).
- **Phones**: the Explorer's area panel is a bottom sheet with three heights (peek, half, full; `explorer/Sheet.tsx`),
  so the map never scrolls away; half fits its content up to 57% of the room.
- **The panel's width** (1024 px and wider): its right edge is a separator (`explorer/PanelHandle.tsx`) that a mouse,
  pen or finger drags, and Left and Right move (16 px, 64 with Shift; Home or a double click resets); 320 px to
  min(720 px, half the window), kept in localStorage (`explorer/panelSize.ts`). Everything placed beside the panel uses
  `--panel-w`; a part that draws for its width waits for the drag to end (`panelResizing`, `afterPanelResize`).
- **Hover is cheap**: a hovered month goes through the store of `explorer/hover.ts` (`previewMonth`, `inFrame`,
  `useHoveredMonth`): one update a frame, in one commit, and only the parts that show it render (the timeline); the
  page renders only when the pointer rests (140 ms and six frames). A hover never draws a chart again: marks under the
  pointer are Plot's pointer marks or an overlay. Arrays passed to a chart are memoised (a new `[a, b]` each render
  redraws it). On the map the tooltip is `explorer/MapTip.tsx` (moved by a transform, drawn again only for a new
  hexagon); on the flat map the hexagon under the pointer is found on the CPU from its H3 cell, and the highlight
  changes only with the hexagon (never deck.gl's autoHighlight, which redraws the whole map on every move).
- **One trend verdict**: a trend is "rising" or "falling" only when it passes the report's rules (enough fire: 100
  hotspots a year for a hexagon, 1,000 for a country or state; and the false discovery rate test across all places or
  hexagons of the same kind). Otherwise it reads "not clear" or "too little fire to test". The Explorer
  (`lib/stats.ts` trendVerdict), the trend map, the Dashboard (`components/dashboard/verdict.ts`) and Rankings
  (`components/rankings/model.ts`) must say the same word for the same place. The words: Rising, Falling, Not clear,
  Not tested (a named place under 1,000 hotspots a year, the world and continents included, or mostly bare ground),
  Too little fire (a hexagon, drawn area or city circle under 100 a year), Too few years. Over 2001 to 2025 the Explorer
  takes a named place's or a hexagon's class from its published file (`explorer/panelData.ts` placeFamily, hexFamily),
  and while that file, or the new place's own series, loads its trend card shows a shimmer, never a word that may
  change or one worked out from the place shown before. A hexagon that passed the test of all hexagons reads in full,
  as on the trend map (the caution "read this trend with care" is only for a drawn area or a circle with 100 to 1,000
  hotspots a year). Every other text about the trend speaks with the card's voice: the yearly chart's title
  (`explorer/trendWords.ts` chartTitle) never says "is rising" or "is falling" when the card does not, and says "not
  tested" when the card does. `components/explorer/verdict.test.ts` checks every place of `web/places.json` (against
  rowVerdict, and against the rule written out from the row's own fields) and every hexagon of the trend map.
- **Pages**: Explorer, Dashboard (with a scope bar: place, years, months, scale, all in the link), Rankings (every
  place, filters and sort in the link), Haze, Methods, Data.
- **Feedback**: hover states on everything clickable (cursor pointer, 140 ms), press scale 0.97, toasts for saves and
  copies, skeletons for loads over 300 ms, keep old content visible while new data loads (no flicker).
- **Motion** (tokens `--t-press` 90 ms, `--t-fast` 140 ms, `--t-med` 220 ms, `--t-slow` 360 ms, `--ease-out`): it explains a change (a
  number glides, a panel slides from where it was opened, the map flies to the area). Exits faster than entries.
  Never block input. `prefers-reduced-motion` turns it off.

## 4. Charts

Pick the form first (trend = line, month grid = heatmap, one number = stat tile, share = bars, never pies). Title
says the finding, subtitle the unit. Thin marks (2 px; harmonized 2.6 px), hairline grid, no frame, no dashed
lines, never two y axes. Tooltips with exact values on hover and focus (Plot `tip` + `pointer`), a crosshair on time
series, clickable legends to hide series where there are several, direct labels for up to 4 series, uncertainty bands
where they exist, and a table view for every chart (`FigureTableView` and `TableScroll` in `ui.tsx`: open, it takes a
row of its own under the source line and scrolls inside the card, at most 320 px tall, its column names stuck on top;
the card, never the table, sets its width). Numbers formatted for people (1.33 million, 6.3%, 0.94 times
normal) and months by name (October 2026).

## 5. Layout

Content 1280 px wide (the Explorer map is full bleed). Cards 20 px padding, 16 px gaps, sections 40 px apart.
Breakpoints 1440, 1024, 768, 390: one column below 768, nothing scrolls sideways, touch targets at least 44 px.

## 6. Words

Plain, short, concrete. Say what a number means and how we know it ("on years the model never saw"). State the limits
next to the result.
