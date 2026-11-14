// Haze from fires upwind: fine particles (PM2.5) in the cities near Sumatra and Borneo in the fire season, and how
// much of it is smoke from the fires there (the haze model of fireharmony/haze.py). The English text lives here.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import * as Plot from '@observablehq/plot';
import {
  Badge, Card, DataTable, Grid, Note, Page, PageHeader, PlotFigure, Section, Skeleton, StatGrid, StatTile, cssVar,
  type Column, type DeltaDir, type FigureTable,
} from '../components/ui';
import { CopyButton } from '../components/pages/Copy';
import { useCopy } from '../components/pages/clipboard';
import { AreaLink, Problem } from '../components/pages/parts';
import { useCommand } from '../lib/commands';
import { CITY_RADIUS_KM, circleLink, searchAreas, useSearchIndex } from '../lib/search';
import { IconDashboard, IconMap, IconSearch } from '../components/icons';
import { hazeCity, hazeModels, loadAreas, loadDashboard } from '../lib/data';
import { seriesFile } from '../lib/web';
import { leadOf, outlookSkill } from '../components/methods/skill';
import type { DashboardData } from '../lib/dashboard-types';
import type { HazeCityModel, HazeModels, HazeMonth, OutlookRow } from '../lib/types';
import '../styles/pages.css';

type DashCity = NonNullable<DashboardData['haze']>['cities'][number];
type Region = 'sumatra' | 'borneo';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map((m) => m.slice(0, 3));
const COUNTRY: Record<string, string> = { MYS: 'Malaysia', SGP: 'Singapore', IDN: 'Indonesia', BRN: 'Brunei', THA: 'Thailand' };
/** The order of the countries in the city picker. */
const COUNTRY_ORDER = ['MYS', 'SGP', 'BRN', 'IDN', 'THA'];
const DEFAULT_CITY = 'Kuala Lumpur';
const PEAK: [number, number] = [8, 10];             // August to October, the peak months (as in fireharmony/dashboard.py)
const COMPARED = [2015, 2019, 2026] as const;       // the years of dashboard.json haze.cities (smoke_2015 ...)
const REF_YEAR = 2015;                              // the reference season of the month by month chart
type Compared = (typeof COMPARED)[number];
const UNIT = 'µg/m³';
/** The WHO annual guideline for PM2.5 (WHO global air quality guidelines, 2021): the yardstick for a mean over many
 *  days. The 24 hour guideline (haze.json who_daily_guideline) is for single days only. */
const WHO_ANNUAL = 5;
/** A share of the smoke this close to all (or none) of it is said in words: the model's split is not that exact. */
const NEARLY_ALL = 0.95;
const Z90 = 1.645;                                  // a normal 90% range is about 1.645 errors either side
const SOURCE = 'Source: NASA MERRA‑2 PM2.5 (bias corrected), NASA FIRMS hotspots harmonized by Fire Harmony; analysis: Fire Harmony';

const T = {
  eyebrow: 'Haze',
  title: 'Where does the haze come from?',
  lead: 'From July to November, smoke from fires in Sumatra and Borneo drifts over Malaysia and its neighbours. Pick a city to see how much of its fine particle pollution (PM2.5) is smoke from those fires, season by season, and how 2026 compares.',
  cityLabel: 'City',
  find: 'Find a city',
  findLabel: 'Find a city of the haze link',
  count: (n: number) => `${n} cities`,
  found: (n: number, of: number) => `${n} of ${of} cities`,
  noMatch: (q: string) => `No city of the haze link matches “${q}”.`,
  anywhere: 'See the fire within 50 km of any city in the Explorer',
  // why the link stops where it does (two sentences), and where to go for anywhere else
  scope: [
    'These cities lie in the path of the smoke from fires in Sumatra and Borneo, which drifts over the region from July to November.',
    'The bias corrected PM2.5 we test the link on covers only 12° south to 12° north and 90° to 130° east, so the link ends there.',
  ],
  scopeLink: 'Anywhere else: the fire within 50 km of a city, in the Explorer',
  shared: 'Johor Bahru and Singapore share one grid cell of the PM2.5 data, so their numbers are the same.',
  sharedWith: (c: string, others: string[]) => `${c} shares one grid cell of the PM2.5 data with ${others.join(' and ')}, so their numbers are the same.`,
  weakTitle: 'Tested, but not shown',
  weakSub: (n: number) => `${n} more cities of the region were fitted the same way. On years the model never saw, it does not explain enough of their haze, so we leave them out.`,
  weakRule: 'A city is shown when, on years left out, the model explains at least half of the changes in its monthly PM2.5 in the fire season, and the fire explains at least 5% of what the month of year leaves. All eight cities of the first release pass it.',
  weakCols: { city: 'City', country: 'Country', all: 'Changes explained', fire: 'By fire, beyond the season' },
  statsTitle: (c: string) => `${c} in the fire season`,
  statsSub: 'The fire season runs from July to November. Measured PM2.5 is NASA MERRA‑2 with a bias correction; the smoke shares come from our haze model.',
  seasonsTitle: 'Season by season',
  seasonsSub: 'Each bar is one fire season. Click a bar to see that season month by month below.',
  monthsTitle: (y: number) => `Month by month in ${y}`,
  monthsSub: 'Pick a season, or click a bar above.',
  yearLabel: 'Season',
  citiesTitle: (n: number) => `${n === 8 ? 'Eight' : n} cities in the big haze years`,
  citiesSub: 'Mean of August to October, the peak months, in micrograms per cubic metre. Click a city to show it above.',
  howTitle: 'How we know',
  howSub: 'The model, its limits, and where to see the fires themselves.',
  methodTitle: 'How we did it',
  method: [
    'Smoke adds up. So for each city, the monthly PM2.5 is a normal level for the month plus an amount for every 1,000 hotspots in Sumatra and in Borneo (Kalimantan, Sarawak, Sabah and Brunei). The amounts cannot be below zero.',
    'We fit this on the fire seasons of 2002 to 2025, with bias corrected PM2.5 from NASA MERRA‑2 and our harmonized hotspots, and we test it on years left out.',
    'For 2026 there is no bias corrected PM2.5 yet, so the model estimates it from the fires. Uncorrected MERRA‑2 is shown for comparison.',
  ],
  limitsTitle: 'Limits',
  limits: [
    'Monthly means hide the worst days. The days above the WHO 24 hour guideline are counted from the daily data.',
    'A city takes the PM2.5 of the grid cell it lies in (about 55 by 70 km). Johor Bahru and Singapore share one cell.',
    'Fires in Peninsular Malaysia are small and burn in the same years as in Sumatra, so their part cannot be told apart.',
  ],
  firesTitle: 'See the fires behind the smoke',
  firesSub: 'Open a province or state in the Explorer.',
  regions: { sumatra: 'Sumatra', borneo: 'Borneo' } satisfies Record<Region, string>,
  normal: 'Normal level',
  smokeFrom: (r: string) => `Smoke from ${r}`,
  measured: 'Measured (MERRA‑2, bias corrected)',
  measuredShort: 'Measured',
  model: 'Our model',
  merra2: 'MERRA‑2, not corrected',
  who: (v: number) => `WHO 24 hour guideline, for daily values (${v} ${UNIT})`,
  whoAnnual: (v: number) => `WHO annual guideline, for long means (${v} ${UNIT})`,
  shareHow: 'A share is the smoke the model gives each region over the fire seasons, out of all the smoke from fires.',
  ref2015: '2015, measured, for reference',
  badLink: (c: string) => `The link points to a place we could not find, so we show ${c}.`,
  next: {
    title: 'Next months',
    subtitle: (c: string, m: string) => `The fire outlook for the provinces and states whose smoke reaches ${c}, from the data to ${m}.`,
    plain: 'This is a fire outlook, not a smoke forecast: it gives the chance of more fire than usual upwind, and wind and rain decide where the smoke goes.',
    outside: 'outside its fire season, so no outlook',
    chance: (normal: string) => `chance of above normal fire (normal ${normal})`,
    skill: { good: 'useful in past tests', some: 'some skill in past tests', none: 'no better than the normal chance in past tests' },
    open: (place: string) => `Open the outlook of ${place} in the Explorer`,
    none: 'No province or state upwind has an outlook for the coming months: the fire season there is over.',
    error: 'The outlook could not be loaded.',
    note: 'Above normal means more fire than in half of the years 2001 to 2025 for that month; normal is the share of past years above normal. The outlook covers months of the fire season only.',
  },
  soFar: 'so far',
  notYet: 'Not out yet',
  around: (c: string, km: number) => `The fire within ${km} km of ${c}`,
  aroundSub: (m0: string, m1: string) => `Open the circle around the city: every month on the map, or its fire season (${m0} to ${m1}) on the Dashboard.`,
  aroundExplorer: 'Open in the Explorer',
  aroundDashboard: 'Open on the Dashboard',
  loadError: 'The haze data could not be loaded.',
  rowsError: 'The monthly haze data could not be loaded.',
};

// ------------------------------------------------------------------------------------------------ numbers

/** Fixed decimals, rounding half up on the digits shown. */
function fmt(v: number, digits = 1): string {
  const p = 10 ** digits;
  const r = Math.round(v * p + Math.sign(v) * 1e-7) / p;
  return new Intl.NumberFormat('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(r);
}
const pct = (share: number) => `${fmt(100 * share, 0)}%`;
const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
};
/** Hotspot counts, to three figures. */
function hotspots(v: number): string {
  if (v < 1000) return fmt(v, 0);
  const step = 10 ** (Math.floor(Math.log10(v)) - 2);
  return fmt(Math.round(v / step) * step, 0);
}
const daysIn = (yr: number, mo: number) => new Date(Date.UTC(yr, mo, 0)).getUTCDate();
const mean = (xs: number[]) => xs.reduce((a, v) => a + v, 0) / xs.length;

/** A share of the smoke for people: "nearly all" above 95%, "very little" below 5%, else a percent. */
function shareText(v: number): string {
  if (v >= NEARLY_ALL) return 'Nearly all';
  if (v <= 1 - NEARLY_ALL) return 'Very little';
  return pct(v);
}

function sourcePhrase(shareSumatra: number): string {
  if (shareSumatra >= NEARLY_ALL) return 'nearly all from Sumatra';
  if (shareSumatra <= 1 - NEARLY_ALL) return 'nearly all from Borneo';
  if (shareSumatra >= 0.6) return 'mostly from Sumatra';
  if (shareSumatra <= 0.4) return 'mostly from Borneo';
  return 'from both Sumatra and Borneo';
}

// ------------------------------------------------------------------------------------------------ the data of a city

interface SeasonStat {
  yr: number; months: number; partial: boolean;
  obs: number | null;                 // measured season mean (null when a month has no corrected PM2.5)
  model: number; normal: number; sumatra: number; borneo: number; smoke: number;
  daysWho: number | null; days: number;
  hotS: number; hotB: number;         // harmonized hotspots in each source region over the season
}

interface MonthStat {
  yr: number; mo: number;
  obs: number | null; model: number; normal: number; sumatra: number; borneo: number; smoke: number;
  lo: number; hi: number;             // the model's typical error on years left out, as a 90% range
  merra2: number | null; daysWho: number | null; days: number;
}

function monthStats(rows: HazeMonth[], m: HazeCityModel, [m0, m1]: [number, number]): MonthStat[] {
  const k = m.ug_per_1000_hotspots;
  return rows.filter((r) => r.mo >= m0 && r.mo <= m1 && r.pm25_model !== null).map((r) => {
    const model = r.pm25_model ?? 0;
    const sumatra = k.sumatra * r.fire_sumatra_k, borneo = k.borneo * r.fire_borneo_k, smoke = sumatra + borneo;
    return {
      yr: r.yr, mo: r.mo, obs: r.pm25_cnn, model, normal: Math.max(0, model - smoke), sumatra, borneo, smoke,
      lo: Math.max(0, model - Z90 * m.rmse_cv), hi: model + Z90 * m.rmse_cv,
      merra2: r.pm25_merra2, daysWho: r.days_over_who, days: daysIn(r.yr, r.mo),
    };
  });
}

function seasonStats(rows: HazeMonth[], m: HazeCityModel, season: [number, number], firstYear: number): SeasonStat[] {
  const by = new Map<number, HazeMonth[]>();
  for (const r of rows) {
    if (r.yr < firstYear || r.mo < season[0] || r.mo > season[1] || r.pm25_model === null) continue;
    const list = by.get(r.yr);
    if (list) list.push(r); else by.set(r.yr, [r]);
  }
  const fullLength = season[1] - season[0] + 1;
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([yr, ms]) => {
    const st = monthStats(ms, m, season);
    const sumatra = mean(st.map((d) => d.sumatra)), borneo = mean(st.map((d) => d.borneo));
    const model = mean(st.map((d) => d.model));
    const obs = st.every((d) => d.obs !== null) ? mean(st.map((d) => d.obs ?? 0)) : null;
    return {
      yr, months: st.length, partial: st.length < fullLength,
      obs, model, sumatra, borneo, smoke: sumatra + borneo, normal: Math.max(0, model - sumatra - borneo),
      daysWho: st.every((d) => d.daysWho !== null) ? st.reduce((a, d) => a + (d.daysWho ?? 0), 0) : null,
      days: st.reduce((a, d) => a + d.days, 0),
      hotS: 1000 * ms.reduce((a, r) => a + r.fire_sumatra_k, 0), hotB: 1000 * ms.reduce((a, r) => a + r.fire_borneo_k, 0),
    };
  });
}

/** Mean of one value over the peak months of a year (null unless every peak month has it). */
function peakMean(rows: HazeMonth[], yr: number, pick: (r: HazeMonth) => number | null): number | null {
  const vals = rows.filter((r) => r.yr === yr && r.mo >= PEAK[0] && r.mo <= PEAK[1]).map(pick);
  return vals.length === PEAK[1] - PEAK[0] + 1 && vals.every((v) => v !== null) ? mean(vals as number[]) : null;
}

interface CitySummary {
  name: string; country: string; model: HazeCityModel;
  pm25Mean: number | null;            // measured fire season mean, fit years
  shareS: number; shareB: number;     // shares of the smoke from fires, fit years
  smoke: Record<Compared, number | null>;                                   // peak months
  pm25: Record<Compared, { v: number | null; estimate: boolean }> | null;   // peak months (needs the monthly rows)
}

function summarize(name: string, m: HazeModels, dash: DashCity | undefined, rows: HazeMonth[] | undefined): CitySummary {
  const model = m.cities[name];
  const [f0, f1] = m.fit_years;
  let shareS = dash?.share_sumatra ?? null, shareB = dash?.share_borneo ?? null, pm25Mean = dash?.pm25_mean ?? null;
  const smoke = {} as Record<Compared, number | null>;
  for (const y of COMPARED) smoke[y] = dash ? dash[`smoke_${y}`] : null;
  let pm25: CitySummary['pm25'] = null;
  if (rows) {
    const fit = rows.filter((r) => r.yr >= f0 && r.yr <= f1 && r.mo >= m.season_months[0] && r.mo <= m.season_months[1]);
    if (shareS === null || shareB === null) {
      const s = fit.reduce((a, r) => a + model.ug_per_1000_hotspots.sumatra * r.fire_sumatra_k, 0);
      const b = fit.reduce((a, r) => a + model.ug_per_1000_hotspots.borneo * r.fire_borneo_k, 0);
      shareS = s / Math.max(s + b, 1e-9);
      shareB = b / Math.max(s + b, 1e-9);
    }
    if (pm25Mean === null) {
      const obs = fit.map((r) => r.pm25_cnn).filter((v): v is number => v !== null);
      pm25Mean = obs.length ? mean(obs) : null;
    }
    pm25 = {} as Record<Compared, { v: number | null; estimate: boolean }>;
    for (const y of COMPARED) {
      smoke[y] ??= peakMean(rows, y, (r) => r.smoke_model);
      const measured = peakMean(rows, y, (r) => r.pm25_cnn);
      pm25[y] = measured !== null ? { v: measured, estimate: false } : { v: peakMean(rows, y, (r) => r.pm25_model), estimate: true };
    }
  }
  return {
    name, country: COUNTRY[model.country] ?? model.country, model, pm25Mean,
    shareS: shareS ?? 0, shareB: shareB ?? 0, smoke, pm25,
  };
}

// ------------------------------------------------------------------------------------------------ the address bar

function hashParams(): URLSearchParams {
  const h = window.location.hash;
  const i = h.indexOf('?');
  return new URLSearchParams(i < 0 ? '' : h.slice(i + 1));
}

/** The hash of a view of this page: "#/haze?city=Kuala+Lumpur&year=2015". */
function hazeHash(city: string, year: number | null): string {
  const q = new URLSearchParams({ city });
  if (year !== null) q.set('year', String(year));
  return `#/haze?${q.toString()}`;
}

/** Keep the city and season in the address, so a view can be shared (no new history entry, no route change). */
function writeHash(city: string, year: number | null): void {
  const next = hazeHash(city, year);
  if (window.location.hash !== next) window.history.replaceState(window.history.state, '', next);
}

/** The full address of a view, to share. */
const hazeHref = (city: string, year: number | null) => `${window.location.href.split('#')[0]}${hazeHash(city, year)}`;

// ------------------------------------------------------------------------------------------------ charts

function colours() {
  return {
    ink: cssVar('--ink', '#0b0b0b'), ink2: cssVar('--ink-2', '#52514e'), muted: cssVar('--muted', '#898781'),
    surface: cssVar('--surface-1', '#fcfcfb'), grid: cssVar('--grid', '#e1e0d9'), baseline: cssVar('--baseline', '#c3c2b7'),
    normal: cssVar('--baseline', '#c3c2b7'), sumatra: cssVar('--fh-sumatra', '#f0622a'), borneo: cssVar('--fh-borneo', '#8b7cf6'),
  };
}

/** A round upper end for a value axis. */
function niceTop(v: number): number {
  const step = v > 40 ? 10 : 5;
  return Math.ceil(v / step) * step;
}

interface Seg { yr: number; y1: number; y2: number; fill: string; top: boolean; partial: boolean }

function seasonTip(s: SeasonStat): string {
  return [
    `${s.yr}${s.partial ? ` (July to ${MONTHS[6 + s.months - 1]} so far)` : ''}`,
    `${T.measuredShort}: ${s.obs === null ? T.notYet.toLowerCase() : `${fmt(s.obs)} ${UNIT}`}`,
    `${T.model}: ${fmt(s.model)} ${UNIT}`,
    `  ${T.normal}: ${fmt(s.normal)}`,
    `  ${T.smokeFrom('Sumatra')}: ${fmt(s.sumatra)}`,
    `  ${T.smokeFrom('Borneo')}: ${fmt(s.borneo)}`,
  ].join('\n');
}

/** The season chart shows season means, so its guideline is the WHO annual one (never the 24 hour guideline). */
function buildSeasons(width: number, seasons: SeasonStat[], selected: number | null, onPick: (yr: number) => void): Plot.PlotOptions {
  const c = colours();
  const years = seasons.map((s) => s.yr);
  const marginLeft = 34, marginRight = 8;
  const band = Math.max(1, (width - marginLeft - marginRight) / Math.max(1, years.length));
  const inset = Math.max(1, (band - 24) / 2);
  const guide = WHO_ANNUAL;   // season means: the annual guideline
  const top = niceTop(Math.max(guide, ...seasons.map((s) => Math.max(s.model, s.obs ?? 0))) * 1.08);
  const segs: Seg[] = [];
  for (const s of seasons) {
    const parts = ([[s.normal, c.normal], [s.sumatra, c.sumatra], [s.borneo, c.borneo]] as const).filter(([v]) => v > 1e-3);
    let y = 0;
    parts.forEach(([v, fill], i) => {
      segs.push({ yr: s.yr, y1: y, y2: y + v, fill, top: i === parts.length - 1, partial: s.partial });
      y += v;
    });
  }
  const every = band >= 34 ? 1 : band >= 16 ? 2 : 5;
  const partial = seasons.filter((s) => s.partial);
  const bar = (data: Seg[], extra: Plot.BarYOptions) => Plot.barY(data, {
    x: 'yr', y1: 'y1', y2: 'y2', fill: 'fill', fillOpacity: (d: Seg) => (d.partial ? 0.5 : 1),
    insetLeft: inset, insetRight: inset, ...extra,
  });
  // Clicking a season (anywhere in its column) shows it month by month.
  const clickable: Plot.RenderFunction = (index, scales, values, dimensions, context, next) => {
    const g = next ? next(index, scales, values, dimensions, context) : null;
    g?.querySelectorAll('rect').forEach((rect, k) => {
      const s = seasons[index[k] ?? -1];
      if (!s) return;
      rect.style.cursor = 'pointer';
      rect.addEventListener('click', () => onPick(s.yr));
    });
    return g;
  };
  return {
    height: 320, marginLeft, marginRight, marginTop: 16, marginBottom: 30,
    color: { type: 'identity' },
    x: { type: 'band', domain: years, padding: 0, label: null, tickSize: 0, tickPadding: 8,
      tickFormat: (d: number) => (d % every === 0 ? String(d) : '') },
    y: { domain: [0, top], grid: true, label: null, ticks: 5, tickSize: 0, tickPadding: 6 },
    marks: [
      selected !== null && years.includes(selected)
        ? Plot.barY([selected], { x: (d: number) => d, y1: 0, y2: top, fill: c.grid, fillOpacity: 0.65, insetLeft: Math.max(0, inset - 7), insetRight: Math.max(0, inset - 7) })
        : null,
      bar(segs.filter((d) => !d.top), { insetTop: 2 }),
      bar(segs.filter((d) => d.top), { ry2: 4 }),
      Plot.ruleY([0], { stroke: c.baseline }),
      Plot.ruleY([guide], { stroke: c.ink2, strokeWidth: 1 }),
      Plot.dot(seasons.filter((s) => s.obs !== null), { x: 'yr', y: 'obs', r: band >= 14 ? 4 : 3, fill: c.ink, stroke: c.surface, strokeWidth: 2 }),
      // over the last, thin column of a phone the label ends at the column's right edge, so it stays inside the card
      Plot.text(partial, { x: 'yr', y: 'model', text: () => T.soFar, dy: -10, ...(band < 34 ? { textAnchor: 'end' as const, dx: band / 2 } : {}),
        fill: c.ink2, fontSize: 11, stroke: c.surface, strokeWidth: 3, paintOrder: 'stroke' }),
      Plot.barY(seasons, { x: 'yr', y1: 0, y2: top, fill: c.surface, fillOpacity: 0, render: clickable }),
      Plot.tip(seasons, Plot.pointerX({ x: 'yr', y: 'model', title: seasonTip, fill: c.surface, stroke: c.grid, fontSize: 12 })),
    ],
  };
}

function monthTip(d: MonthStat): string {
  return [
    `${MONTHS[d.mo - 1]} ${d.yr}`,
    `${T.measuredShort}: ${d.obs === null ? T.notYet.toLowerCase() : `${fmt(d.obs)} ${UNIT}`}`,
    `${T.model}: ${fmt(d.model)} ${UNIT} (90% range ${fmt(d.lo)} to ${fmt(d.hi)})`,
    `  ${T.normal}: ${fmt(d.normal)}`,
    `  ${T.smokeFrom('Sumatra')}: ${fmt(d.sumatra)}`,
    `  ${T.smokeFrom('Borneo')}: ${fmt(d.borneo)}`,
    ...(d.obs === null && d.merra2 !== null ? [`${T.merra2}: ${fmt(d.merra2)} ${UNIT}`] : []),
    ...(d.daysWho !== null ? [`Days above the WHO daily guideline: ${d.daysWho} of ${d.days}`] : []),
  ].join('\n');
}

function buildMonths(months: MonthStat[], who: number, showMerra: boolean, ref: MonthStat[] = []): Plot.PlotOptions {
  const c = colours();
  const merra = showMerra ? months.filter((d) => d.obs === null && d.merra2 !== null) : [];
  const refObs = ref.filter((d) => d.obs !== null);
  const top = niceTop(Math.max(who, ...months.map((d) => Math.max(d.model, d.obs ?? 0)), ...merra.map((d) => d.merra2 ?? 0),
    ...refObs.map((d) => d.obs ?? 0)) * 1.06);
  // Straight segments between months: the layers then never cross, whatever their thickness.
  const layer = (y1: (d: MonthStat) => number, y2: (d: MonthStat) => number, fill: string) => [
    Plot.areaY(months, { x: 'mo', y1, y2, fill }),
    Plot.lineY(months, { x: 'mo', y: y2, stroke: c.surface, strokeWidth: 2 }),   // the 2 px gap between layers
  ];
  const obs = months.filter((d) => d.obs !== null);
  return {
    height: 300, marginLeft: 34, marginRight: 14, marginTop: 16, marginBottom: 30,
    x: { domain: [6.8, 11.2], ticks: [7, 8, 9, 10, 11], tickFormat: (m: number) => MON[m - 1] ?? '', label: null, tickSize: 0, tickPadding: 8 },
    y: { domain: [0, top], grid: true, label: null, ticks: 5, tickSize: 0, tickPadding: 6 },
    marks: [
      ...layer(() => 0, (d) => d.normal, c.normal),
      ...layer((d) => d.normal, (d) => d.normal + d.sumatra, c.sumatra),
      ...layer((d) => d.normal + d.sumatra, (d) => d.model, c.borneo),
      Plot.ruleY([0], { stroke: c.baseline }),
      Plot.ruleY([who], { stroke: c.ink2, strokeWidth: 1 }),
      // the 2015 season (measured), the yardstick of a bad haze year
      refObs.length ? Plot.lineY(refObs, { x: 'mo', y: 'obs', stroke: c.ink, strokeOpacity: 0.22, strokeWidth: 6, strokeLinecap: 'round' }) : null,
      refObs.length ? Plot.text(refObs.slice(-1), { x: 'mo', y: 'obs', text: () => '2015', dx: 8, textAnchor: 'start', fill: c.ink2, fontSize: 11,
        fontWeight: 600, stroke: c.surface, strokeWidth: 3, paintOrder: 'stroke' }) : null,
      merra.length ? Plot.lineY(merra, { x: 'mo', y: 'merra2', stroke: c.muted, strokeWidth: 2 }) : null,
      merra.length ? Plot.dot(merra, { x: 'mo', y: 'merra2', r: 4, fill: c.surface, stroke: c.muted, strokeWidth: 2 }) : null,
      obs.length ? Plot.lineY(obs, { x: 'mo', y: 'obs', stroke: c.ink, strokeWidth: 2 }) : null,
      obs.length ? Plot.dot(obs, { x: 'mo', y: 'obs', r: 4.5, fill: c.ink, stroke: c.surface, strokeWidth: 2 }) : null,
      Plot.tip(months, Plot.pointerX({ x: 'mo', y: (d: MonthStat) => d.obs ?? d.model, fill: c.surface, stroke: c.grid, fontSize: 12,
        title: (d: MonthStat) => {
          const r = refObs.find((x) => x.mo === d.mo);
          return `${monthTip(d)}${r && r.obs !== null ? `\n${MONTHS[d.mo - 1]} 2015, measured: ${fmt(r.obs)} ${UNIT}` : ''}`;
        } })),
    ],
  };
}

// ------------------------------------------------------------------------------------------------ small parts

function Key({ swatch, colour, children }: { swatch: 'box' | 'dot' | 'line' | 'rule' | 'hollow'; colour: string; children: ReactNode }) {
  const cls = swatch === 'box' ? 'fh-pg-swatch' : swatch === 'dot' ? 'fh-pg-swatch fh-pg-swatch-dot'
    : swatch === 'hollow' ? 'fh-pg-swatch fh-pg-swatch-dot' : swatch === 'line' ? 'fh-pg-swatch fh-pg-swatch-line' : 'fh-pg-swatch fh-pg-swatch-rule';
  const style = swatch === 'hollow' ? { background: 'var(--surface-1)', border: `2px solid ${colour}`, width: 11, height: 11 } : { background: colour };
  return <span className="fh-pg-key"><span className={cls} style={style} aria-hidden="true" />{children}</span>;
}

function PartsLegend() {
  return (
    <>
      <Key swatch="box" colour="var(--baseline)">{T.normal}</Key>
      <Key swatch="box" colour="var(--fh-sumatra)">{T.smokeFrom('Sumatra')}</Key>
      <Key swatch="box" colour="var(--fh-borneo)">{T.smokeFrom('Borneo')}</Key>
    </>
  );
}

/** Words folded for a search: no case, no accents. */
const folded = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/**
 * The cities, grouped by country, with a search box. One radio group (arrow keys move through the cities shown, one
 * tab stop); each city a compact button with the split of its smoke between Sumatra and Borneo. On a phone each
 * country is one row that scrolls sideways, so the cities fit on the first screen.
 */
function CityPicker({ cities, value, onChange }: { cities: CitySummary[]; value: string; onChange: (c: string) => void }) {
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const q = folded(query);
  const groups = useMemo(() => {
    const hit = (c: CitySummary) => !q || folded(c.name).includes(q) || folded(c.country).includes(q);
    const order = [...COUNTRY_ORDER, ...new Set(cities.map((c) => c.model.country))].filter((v, i, a) => a.indexOf(v) === i);
    return order.map((iso) => ({ iso, name: COUNTRY[iso] ?? iso,
      list: cities.filter((c) => c.model.country === iso && hit(c)).sort((a, b) => a.name.localeCompare(b.name, 'en')) }))
      .filter((g) => g.list.length);
  }, [cities, q]);
  const flat = groups.flatMap((g) => g.list);
  const stop = flat.some((c) => c.name === value) ? value : flat[0]?.name;   // the one tab stop
  const focusCity = (name: string) => box.current?.querySelector<HTMLButtonElement>(`[data-city="${CSS.escape(name)}"]`)?.focus();
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = flat.findIndex((c) => c.name === value);
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % flat.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + flat.length) % flat.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = flat.length - 1;
    const next = flat[n];
    if (!next) return;
    e.preventDefault();
    onChange(next.name);
    focusCity(next.name);
  };
  // the city shown stays in view in its row (phones: the rows scroll sideways), without moving the page
  useEffect(() => {
    const b = box.current?.querySelector<HTMLElement>('.fh-hz-city[aria-checked="true"]');
    const row = b?.parentElement;
    if (!b || !row || row.scrollWidth <= row.clientWidth) return;
    const l = b.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft, r = l + b.offsetWidth;
    if (l < row.scrollLeft || r > row.scrollLeft + row.clientWidth) row.scrollTo({ left: Math.max(0, l - 24) });
  }, [value, groups]);
  return (
    <div className="fh-hz-picker">
      <div className="fh-hz-picker-bar">
        <label className="fh-hz-find">
          <IconSearch size={16} />
          <input type="search" className="fh-hz-find-input" value={query} placeholder={T.find} aria-label={T.findLabel}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => {
              if (e.key === 'Enter' && flat[0]) { e.preventDefault(); onChange(flat[0].name); focusCity(flat[0].name); }
            }} />
        </label>
        <p className="fh-hz-picker-count" aria-live="polite">{q ? T.found(flat.length, cities.length) : T.count(cities.length)}</p>
      </div>
      <div ref={box} className="fh-hz-cities" role="radiogroup" aria-label={T.cityLabel} onKeyDown={onKey}>
        {groups.map((g) => (
          <div key={g.iso} className="fh-hz-group" data-size={g.list.length > 2 ? 'many' : 'few'}>
            <p className="fh-hz-group-name" aria-hidden="true">{g.name}<span className="ui-mono">{g.list.length}</span></p>
            <div className="fh-hz-group-list ui-scroll-fade">
              {g.list.map((c) => {
                const main = c.shareS >= c.shareB ? `${shareText(c.shareS)} from Sumatra` : `${shareText(c.shareB)} from Borneo`;
                return (
                  <button key={c.name} data-city={c.name} type="button" role="radio" className="fh-hz-city"
                    aria-checked={c.name === value} tabIndex={c.name === stop ? 0 : -1} onClick={() => onChange(c.name)}>
                    <span className="fh-hz-city-name">{c.name}</span>
                    <span className="fh-hz-city-country sr-only">{`, ${c.country}`}</span>
                    <span className="fh-hz-city-bar" aria-hidden="true">
                      {c.shareS > 0.005 ? <span style={{ flexGrow: c.shareS, background: 'var(--fh-sumatra)' }} /> : null}
                      {c.shareB > 0.005 ? <span style={{ flexGrow: c.shareB, background: 'var(--fh-borneo)' }} /> : null}
                    </span>
                    <span className="fh-hz-city-share sr-only">{`: ${main}`}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {!flat.length ? (
        <p className="fh-hz-none" role="status">{T.noMatch(query.trim())} <a href="#/?search=1">{T.anywhere}</a></p>
      ) : null}
    </div>
  );
}

/** The cities beyond the first eight in haze.json (fireharmony/haze_cities.py): the rule, the kept cities, the cities
 *  fitted the same way without enough skill (with their scores), and every city's grid cell of the PM2.5 data. */
interface WeakCity { name: string; country: string; r2_cv: number; r2_fire_beyond_month: number | null }
interface MoreCities {
  rule_text?: string; kept: { name: string }[]; not_enough_skill: WeakCity[]; grid_cells?: Record<string, [number, number]>;
}

/** The cities of the page that share a grid cell of the PM2.5 data with others (their numbers are the same). */
function matesOf(cells: Record<string, [number, number]>, names: string[]): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const n of names) {
    const c = cells[n];
    if (c) by.set(c.join(','), [...(by.get(c.join(',')) ?? []), n]);
  }
  const out = new Map<string, string[]>();
  for (const list of by.values()) if (list.length > 1) for (const n of list) out.set(n, list.filter((o) => o !== n));
  return out;
}
const sharedNote = (mates: Map<string, string[]> | null, city: string): string | null => {
  const o = mates?.get(city);
  return o && o.length ? T.sharedWith(city, o) : null;
};

/** Why the haze link covers this region only, and where to look anywhere else. */
function ScopeNote() {
  return (
    <p className="fh-hz-scope">
      {T.scope.join(' ')}{' '}
      <a href="#/?search=1" className="fh-hz-scope-link">{T.scopeLink}</a>
    </p>
  );
}

/** The cities fitted the same way that are not shown, with their scores on years left out. */
function WeakCities({ more }: { more: MoreCities }) {
  const score = (v: number | null) => (v === null ? '–' : v <= 0 ? 'none' : pct(v));
  const cols: Column<WeakCity>[] = [
    { key: 'name', label: T.weakCols.city },
    { key: 'country', label: T.weakCols.country, render: (r) => COUNTRY[r.country] ?? r.country },
    { key: 'r2_cv', label: T.weakCols.all, num: true, render: (r) => score(r.r2_cv) },
    { key: 'r2_fire_beyond_month', label: T.weakCols.fire, num: true, render: (r) => score(r.r2_fire_beyond_month) },
  ];
  return (
    <Card title={T.weakTitle} subtitle={T.weakSub(more.not_enough_skill.length)} className="fh-hz-weak">
      <DataTable columns={cols} rows={more.not_enough_skill} rowKey={(r) => r.name}
        caption="On years left out, the share of the changes in monthly PM2.5 the model explains, and the share of what the month of year leaves that the fire explains" />
      <Note>{T.weakRule}</Note>
    </Card>
  );
}

/**
 * Where a city's circle goes: the city of the place search (web/cities.json) with the same name and country, so the
 * Explorer and the Dashboard name the circle after it (they name a circle by the city within 1 km of its centre).
 * Until the cities have loaded, the city of the haze model (haze.json) stands in.
 */
function useCityCentre(name: string, model: HazeCityModel | undefined): { lat: number; lon: number } | null {
  const index = useSearchIndex();
  return useMemo(() => {
    if (!model) return null;
    const hit = index ? searchAreas(name, 20, index).find((h) => h.city && h.city.iso3 === model.country) : undefined;
    return hit?.city ? { lat: hit.city.lat, lon: hit.city.lon } : { lat: model.lat, lon: model.lon };
  }, [index, name, model]);
}

function FireAround({ city, model, season }: { city: string; model: HazeCityModel | undefined; season: [number, number] }) {
  const at = useCityCentre(city, model);
  if (!at) return null;
  const area = circleLink(at.lat, at.lon, CITY_RADIUS_KM).replace(/^#\/\?/, '');
  const months = season[0] === season[1] ? String(season[0]) : `${season[0]}-${season[1]}`;
  return (
    <div className="fh-hz-around">
      <div className="fh-hz-around-text">
        <p className="fh-hz-around-title">{T.around(city, CITY_RADIUS_KM)}</p>
        <p className="fh-hz-around-sub">{T.aroundSub(MONTHS[season[0] - 1] ?? '', MONTHS[season[1] - 1] ?? '')}</p>
      </div>
      <div className="fh-hz-around-actions">
        <a className="ui-btn" href={`#/?${area}`}><IconMap size={16} />{T.aroundExplorer}</a>
        <a className="ui-btn ui-btn-ghost" href={`#/dashboard?${area}&months=${months}`}><IconDashboard size={16} />{T.aroundDashboard}</a>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ next months

interface Upwind { region: Region; kind: string; id: string; name: string; row: OutlookRow }

/** The outlook rows of the source provinces of the haze model (web/series/state/<id>.json, the same rows as the
 *  Explorer's Outlook tab), with their names. */
function useUpwindOutlook(models: HazeModels | null, names: Map<string, string> | null): Upwind[] | null | 'failed' {
  const [out, setOut] = useState<Upwind[] | null | 'failed'>(null);
  const sources = (models as (HazeModels & { sources?: Partial<Record<Region, string[]>> }) | null)?.sources;
  useEffect(() => {
    if (!sources || !names) return undefined;
    let alive = true;
    const list = (['sumatra', 'borneo'] as const).flatMap((region) => (sources[region] ?? []).map((id) => ({ region, id })));
    Promise.all(list.map(async ({ region, id }) => {
      const f = await seriesFile('state', id).catch(() => null);
      const name = (names.get(`state:${id}`) ?? id).replace(/, (Indonesia|Malaysia|Brunei)$/, '');
      return ((f?.outlook ?? []) as unknown as OutlookRow[]).map((row) => ({ region, kind: 'state', id, name, row }));
    })).then((rows) => { if (alive) setOut(rows.flat()); }, () => { if (alive) setOut('failed'); });
    return () => { alive = false; };
  }, [sources, names]);
  return out;
}

const skillWord = (b: number | null): string => (b === null || b < 0.05 ? T.next.skill.none : b < 0.2 ? T.next.skill.some : T.next.skill.good);

const NEXT_SHOWN = 3;   // places shown per region and month; the rest one tap away

function UpwindPlace({ u }: { u: Upwind }) {
  const pc = (v: number) => `${fmt(100 * v, 0)}%`;
  return (
    <li>
      <a className="fh-hz-next-place" href={`#/?area=${u.kind}:${encodeURIComponent(u.id)}&tab=outlook`}
        aria-label={`${u.name}: ${pc(u.row.p)} ${T.next.chance(pc(u.row.p_clim))}, ${skillWord(u.row.bss)}. ${T.next.open(u.name)}`}>
        <span className="fh-hz-next-place-name">{u.name}</span>
        <span className="fh-hz-next-p"><b className="ui-mono">{pc(u.row.p)}</b><span className="fh-hz-next-normal"> normal {pc(u.row.p_clim)}</span></span>
      </a>
    </li>
  );
}

function NextMonths({ city, s, models, names, skill }: {
  city: string; s: CitySummary | null; models: HazeModels | null; names: Map<string, string> | null; skill: string | null;
}) {
  const up = useUpwindOutlook(models, names);
  if (up === 'failed') return <Card title={T.next.title}><Problem text={T.next.error} onRetry={() => window.location.reload()} /></Card>;
  if (!up || !s) return <Card title={T.next.title}><Skeleton height={140} /></Card>;
  const first = up[0]?.row;
  const issued = first ? `${MONTHS[first.issue_mo - 1]} ${first.issue_yr}` : '';
  // the months ahead with an outlook somewhere upwind, and the regions in the order of their smoke here
  const months = [...new Set(up.map((u) => u.row.target_yr * 100 + u.row.target_mo))].sort((a, b) => a - b);
  const regions: Region[] = s.shareS >= s.shareB ? ['sumatra', 'borneo'] : ['borneo', 'sumatra'];
  return (
    <Card title={T.next.title} subtitle={issued ? T.next.subtitle(city, issued) : undefined}>
      <div className="fh-hz-next">
        <p className="fh-hz-next-plain">{T.next.plain}</p>
        {!months.length ? <p className="fh-hz-next-none">{T.next.none}</p> : (
          <ol className="fh-hz-next-months">
            {months.map((ym) => (
              <li key={ym} className="fh-hz-next-month">
                <p className="fh-hz-next-when">{MONTHS[(ym % 100) - 1]} {Math.floor(ym / 100)}</p>
                <p className="fh-hz-next-head" aria-hidden="true"><span>Chance of above normal fire</span></p>
                <ul className="fh-hz-next-regions">
                  {regions.map((r) => {
                    const here = up.filter((u) => u.region === r && u.row.target_yr * 100 + u.row.target_mo === ym)
                      .sort((a, b) => b.row.p - a.row.p);
                    return (
                      <li key={r} className="fh-hz-next-region">
                        <span className="fh-hz-next-name">
                          <span className="fh-pg-chip-dot" style={{ background: r === 'sumatra' ? 'var(--fh-sumatra)' : 'var(--fh-borneo)' }} aria-hidden="true" />
                          {T.regions[r]}
                        </span>
                        {here.length ? (
                          <>
                            <ul className="fh-hz-next-places">{here.slice(0, NEXT_SHOWN).map((u) => <UpwindPlace key={u.id} u={u} />)}</ul>
                            {here.length > NEXT_SHOWN ? (
                              <details className="fh-hz-next-more">
                                <summary>{`Show ${here.length - NEXT_SHOWN} more in ${T.regions[r]}`}</summary>
                                <ul className="fh-hz-next-places">{here.slice(NEXT_SHOWN).map((u) => <UpwindPlace key={u.id} u={u} />)}</ul>
                              </details>
                            ) : null}
                          </>
                        ) : <span className="fh-hz-next-out">{T.next.outside}</span>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        )}
        <Note>{T.next.note}{skill ? ` ${skill}` : ''}</Note>
      </div>
    </Card>
  );
}

function StatSkeletons({ n }: { n: number }) {
  return <div className="fh-pg-stat-skeletons" aria-hidden="true">{Array.from({ length: n }, (_, i) => <Skeleton key={i} height={118} />)}</div>;
}

// ------------------------------------------------------------------------------------------------ the page

const NARROW = '(max-width: 767px)';
/** True on a phone (below 768 px), following the window. */
function useNarrow(): boolean {
  const [n, setN] = useState(() => window.matchMedia?.(NARROW).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(NARROW);
    if (!m) return undefined;
    const on = () => setN(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return n;
}

export function Haze() {
  const [models, setModels] = useState<HazeModels | null>(null);
  const [dash, setDash] = useState<DashCity[] | null>(null);
  const [rows, setRows] = useState<Map<string, HazeMonth[]>>(() => new Map());
  const [rowsDone, setRowsDone] = useState(false);
  const [failed, setFailed] = useState<'models' | 'rows' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [city, setCity] = useState<string>(() => hashParams().get('city') ?? DEFAULT_CITY);
  const [year, setYear] = useState<number | null>(() => {
    const y = Number(hashParams().get('year'));
    return Number.isInteger(y) && y > 2000 ? y : null;
  });
  const [names, setNames] = useState<Map<string, string> | null>(null);
  const [skillLine, setSkillLine] = useState<string | null>(null);
  const firstCity = useRef(city);
  const retry = () => { setFailed(null); setAttempt((a) => a + 1); };

  useEffect(() => {
    let alive = true;
    loadDashboard().then((d) => {
      if (!alive) return;
      setDash(d.haze?.cities ?? null);
      const sk = d.outlook ? outlookSkill(d.outlook) : null, l1 = sk ? leadOf(sk, 1) : null;
      setSkillLine(sk && l1 ? `On blocks of years it never saw, the outlook scores ${fmt(100 * l1.bss, 0)}% one month ahead (Brier skill score, ${sk.against}).` : null);
    }, () => { if (alive) setDash(null); });
    (async () => {
      let m: HazeModels;
      try { m = await hazeModels(); } catch { if (alive) setFailed('models'); return; }
      if (!alive) return;
      setModels(m);
      try {
        // The city on screen first, then the others (for the table). One small file; the queries run one by one.
        const list = Object.keys(m.cities);
        const order = [firstCity.current, ...list.filter((n) => n !== firstCity.current)].filter((n) => n in m.cities);
        const out = new Map<string, HazeMonth[]>();
        for (const [i, n] of order.entries()) {
          out.set(n, await hazeCity(n));
          if (!alive) return;
          if (i === 0) setRows(new Map(out));
        }
        setRows(out);
        setRowsDone(true);
      } catch {
        if (alive) setFailed('rows');
      }
    })();
    return () => { alive = false; };
  }, [attempt]);

  // Names of the source provinces, for the links to the Explorer (after the haze data, so it never waits for them).
  useEffect(() => {
    if (!models || names) return;
    loadAreas().then((a) => setNames(new Map(a.map((x) => [`${x.kind}:${x.id}`, x.name]))), () => setNames(new Map()));
  }, [models, names]);

  const cityNames = useMemo(() => (models ? Object.keys(models.cities) : []), [models]);
  // the cities beyond the first eight (haze_cities.py): the rule, the cities without enough skill, and the grid cells
  const more = (models as (HazeModels & { more_cities?: MoreCities }) | null)?.more_cities ?? null;
  const cellMates = useMemo(() => (more?.grid_cells ? matesOf(more.grid_cells, cityNames) : null), [more, cityNames]);
  const shown = models && !(city in models.cities) ? (cityNames[0] ?? DEFAULT_CITY) : city;
  const dashBy = useMemo(() => new Map((dash ?? []).map((d) => [d.name, d])), [dash]);
  const summaries = useMemo(() => (models ? cityNames.map((n) => summarize(n, models, dashBy.get(n), rows.get(n))) : []),
    [models, cityNames, dashBy, rows]);
  const summary = summaries.find((s) => s.name === shown) ?? null;
  const cityRows = rows.get(shown) ?? null;
  const fitFirst = models?.fit_years[0] ?? 2002, fitLast = models?.fit_years[1] ?? 2025;
  const who = models?.who_daily_guideline ?? 15;

  const seasons = useMemo(
    () => (models && cityRows && summary ? seasonStats(cityRows, summary.model, models.season_months, fitFirst) : null),
    [models, cityRows, summary, fitFirst]);
  const complete = useMemo(() => (seasons ?? []).filter((s) => !s.partial && s.yr <= fitLast), [seasons, fitLast]);
  const smokiest = useMemo(() => (complete.length ? complete.reduce((a, s) => (s.smoke > a.smoke ? s : a)) : null), [complete]);
  const years = (seasons ?? []).map((s) => s.yr);
  const current = (seasons ?? []).filter((x) => x.partial).pop() ?? null;   // the season in progress (2026 so far)
  const selYear = year !== null && years.includes(year) ? year : (current?.yr ?? smokiest?.yr ?? null);
  const selSeason = seasons?.find((s) => s.yr === selYear) ?? null;
  const partialSeason = seasons?.find((s) => s.partial) ?? null;
  const months = useMemo(
    () => (models && cityRows && summary && selYear !== null
      ? monthStats(cityRows.filter((r) => r.yr === selYear), summary.model, models.season_months) : null),
    [models, cityRows, summary, selYear]);
  // 2015, the worst haze of the record, drawn under any other season as a yardstick
  const ref2015 = useMemo(
    () => (models && cityRows && summary && selYear !== null && selYear !== REF_YEAR
      ? monthStats(cityRows.filter((r) => r.yr === REF_YEAR), summary.model, models.season_months) : []),
    [models, cityRows, summary, selYear]);

  // A link to another city of this page ("#/haze?city=Kuching", from the palette or the Methods page) switches to it.
  useEffect(() => {
    const onHash = () => {
      if (!window.location.hash.startsWith('#/haze')) return;
      const q = hashParams(), c = q.get('city'), y = Number(q.get('year'));
      if (c) setCity(c);
      setYear(Number.isInteger(y) && y > 2000 ? y : null);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const chooseCity = (c: string) => { setCity(c); writeHash(c, year); };
  const chooseYear = (y: number) => { setYear(y); writeHash(shown, y); };
  const copy = useCopy();
  useCommand((c) => { if (c.action === 'copy-link') void copy(hazeHref(shown, year), 'Link copied'); }, [shown, year]);
  // on a phone the cities come first, right under the title (the lead folds to two lines under them)
  const narrow = useNarrow();
  const cityRow = summaries.length ? <CityPicker cities={summaries} value={shown} onChange={chooseCity} /> : <Skeleton height={96} />;
  const shareButton = (
    <CopyButton text={() => hazeHref(shown, year)} done="Link copied" label="Copy a link to this city"
      ariaLabel={`Copy a link to the haze of ${shown}`} />
  );

  if (failed === 'models') {
    return (
      <Page>
        <div className="fh-pg">
          <PageHeader eyebrow={T.eyebrow} title={T.title} lead={T.lead} />
          <Card><Problem text={T.loadError} onRetry={retry} /></Card>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <div className="fh-pg">
      <PageHeader eyebrow={T.eyebrow} title={T.title} lead={T.lead} actions={shareButton} under={narrow ? cityRow : undefined} />

      {narrow ? null : cityRow}
      <ScopeNote />
      {models && !(city in models.cities) ? <Note>{T.badLink(shown)}</Note> : null}

      <Section title={T.statsTitle(shown)} subtitle={T.statsSub}>
        {summary ? <CityStats s={summary} fitFirst={fitFirst} fitLast={fitLast} rows={cityRows} dash={dashBy.get(shown)} /> : <StatSkeletons n={5} />}
        {summary ? <ShareNote /> : null}
        {cellMates ? (sharedNote(cellMates, shown) ? <Note>{sharedNote(cellMates, shown)}</Note> : null)
          : shown === 'Johor Bahru' || shown === 'Singapore' ? <Note>{T.shared}</Note> : null}
        {models ? <FireAround city={shown} model={models.cities[shown]} season={models.season_months} /> : null}
        <NextMonths city={shown} s={summary} models={models} names={names} skill={skillLine} />
      </Section>

      <Section title={T.seasonsTitle} subtitle={T.seasonsSub}>
        <Card>
          {seasons && summary && smokiest ? (
            <div className="fh-chart-plot">
              <PlotFigure
                title={`${shown}’s smokiest fire season was ${smokiest.yr}: fires added ${fmt(smokiest.smoke)}\u00a0${UNIT}, ${sourcePhrase(smokiest.sumatra / Math.max(smokiest.smoke, 1e-9))}`}
                subtitle={<>
                  PM2.5 in {UNIT}, mean of July to November. Bars: our model, the normal level plus the smoke from each region. Dots: what was measured.
                  <span className="fh-pg-legend">
                    <PartsLegend />
                    <Key swatch="dot" colour="var(--ink)">{T.measured}</Key>
                    <Key swatch="rule" colour="var(--ink-2)">{T.whoAnnual(WHO_ANNUAL)}</Key>
                    {partialSeason ? <Key swatch="box" colour="color-mix(in srgb, var(--fh-sumatra) 50%, transparent)">{partialSeason.yr}: July to {MONTHS[6 + partialSeason.months - 1]} so far, our estimate</Key> : null}
                  </span>
                </>}
                source={SOURCE}
                height={320}
                build={(w) => buildSeasons(w, seasons, selYear, chooseYear)}
                deps={[seasons, selYear, shown]}
                table={seasonTable(seasons)}
              />
            </div>
          ) : failed === 'rows' ? <Problem text={T.rowsError} onRetry={retry} /> : <Skeleton height={420} />}
        </Card>
      </Section>

      <Section title={selYear !== null ? T.monthsTitle(selYear) : 'Month by month'} subtitle={T.monthsSub}>
        {seasons && selYear !== null ? (
          <div className="fh-pg-toolbar">
            <label className="fh-pg-field">
              <span className="fh-pg-field-label">{T.yearLabel}</span>
              <span className="fh-pg-select-wrap">
                <select className="fh-pg-select" value={selYear} onChange={(e) => chooseYear(Number(e.target.value))}>
                  {[...seasons].reverse().map((s) => (
                    <option key={s.yr} value={s.yr}>
                      {s.yr}{s.partial ? ' (so far, estimate)' : s.yr === smokiest?.yr ? ' (most smoke)' : ''}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          </div>
        ) : null}
        <Grid wide>
          <Card>
            {months && summary && selSeason ? (
              <MonthFigure months={months} season={selSeason} city={shown} who={who} model={summary.model} rows={cityRows ?? []} fitYears={[fitFirst, fitLast]} ref={ref2015} />
            ) : failed === 'rows' ? <Problem text={T.rowsError} onRetry={retry} /> : <Skeleton height={400} />}
          </Card>
          {selSeason && seasons ? <SeasonFacts s={selSeason} city={shown} seasons={seasons} fitLast={fitLast} who={who} />
            : <Card><Skeleton height={360} /></Card>}
        </Grid>
      </Section>

      <Section title={T.citiesTitle(summaries.length || 8)} subtitle={T.citiesSub}>
        {summaries.length ? <CityTables rows={summaries} shown={shown} onPick={(c) => { chooseCity(c); window.scrollTo({ top: 0, behavior: 'smooth' }); }} complete={rowsDone} />
          : <Skeleton height={320} />}
        <Note>Smoke is our model’s estimate of the PM2.5 that comes from fires in Sumatra and Borneo. PM2.5 for 2015 and 2019 is measured (MERRA‑2, bias corrected); for 2026 both are our estimates (est.), because the corrected data is not out yet. {sharedNote(cellMates, 'Johor Bahru') ?? T.shared}</Note>
      </Section>

      <Section title={T.howTitle} subtitle={T.howSub}>
        <Grid cols={3}>
          <Card title={T.methodTitle}>
            <div className="fh-pg-card-prose">{T.method.map((p) => <p key={p}>{p}</p>)}</div>
          </Card>
          <Card title={T.limitsTitle}>
            <ul className="fh-pg-list">{T.limits.map((p) => <li key={p}>{p}</li>)}</ul>
          </Card>
          <Card title={T.firesTitle} subtitle={T.firesSub}>
            <SourceLinks models={models} names={names} />
          </Card>
        </Grid>
        {more && more.not_enough_skill.length ? <WeakCities more={more} /> : null}
      </Section>
      </div>
    </Page>
  );
}

/** The smoke of a normal season: the median over the fit years of the August to October mean (haze_months.json). */
function normalSmoke(rows: HazeMonth[], [f0, f1]: [number, number]): number | null {
  const v: number[] = [];
  for (let y = f0; y <= f1; y++) { const m = peakMean(rows, y, (r) => r.smoke_model); if (m !== null) v.push(m); }
  if (!v.length) return null;
  v.sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}

/** "62% less than in 2015", "88% above a normal season": a change in words. */
function against(now: number, then: number, words: { same: string; less: string; more: string }): { dir: DeltaDir; text: string } {
  const ch = now / then - 1;
  return Math.abs(ch) < 0.05 ? { dir: 'flat', text: words.same } : ch < 0 ? { dir: 'down', text: `${pct(-ch)} ${words.less}` } : { dir: 'up', text: `${pct(ch)} ${words.more}` };
}

/** The fire R squared beyond the month of year, where a release publishes it: the city's model in haze.json
 *  (haze.checks and haze_cities.py: r2_fire_beyond_month, the score the cities are kept by), else dashboard.json. */
function fireR2(dash: DashCity | undefined, model?: HazeCityModel): number | null {
  for (const o of [model, dash] as unknown as (Record<string, unknown> | undefined)[]) {
    for (const k of ['r2_fire_beyond_month', 'r2_fire', 'r2_fire_cv', 'r2_beyond_season', 'partial_r2']) {
      const v = o?.[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  return null;
}

function CityStats({ s, fitFirst, fitLast, rows, dash }: { s: CitySummary; fitFirst: number; fitLast: number; rows: HazeMonth[] | null; dash: DashCity | undefined }) {
  const k = s.model.ug_per_1000_hotspots;
  const s26 = s.smoke[2026], s15 = s.smoke[2015];
  const pm26 = rows ? peakMean(rows, 2026, (r) => r.pm25_model) : null;
  const normal = rows ? normalSmoke(rows, [fitFirst, fitLast]) : null;
  // the changes from the monthly rows (not the rounded values of dashboard.json), where they are in
  const r26 = (rows ? peakMean(rows, 2026, (r) => r.smoke_model) : null) ?? s26;
  const r15 = (rows ? peakMean(rows, 2015, (r) => r.smoke_model) : null) ?? s15;
  // the season against a normal one first; 2015, the worst haze year, second
  const vsNormal = r26 !== null && normal !== null && normal > 0
    ? against(r26, normal, { same: 'About a normal season', less: 'below a normal season', more: 'above a normal season' }) : undefined;
  const vs2015 = r26 !== null && r15 !== null && r15 > 0 ? against(r26, r15, { same: 'About the same as 2015', less: 'less than in 2015', more: 'more than in 2015' }) : null;
  const r2fire = fireR2(dash, s.model);
  const per = (v: number) => (v > 0.005
    ? `Every 1,000 more hotspots there add about ${fmt(v, 2)}\u00a0${UNIT} to the monthly mean.`
    : 'Fires there add no smoke that the data can show here.');
  return (
    <StatGrid>
      <StatTile label="Smoke from fires, 2026" value={s26 === null ? '–' : fmt(s26)} unit={UNIT} delta={vsNormal}
        context={<>
          August to October, our estimate.{normal !== null ? ` A normal season (the median of ${fitFirst} to ${fitLast}) has ${fmt(normal)}\u00a0${UNIT}.` : ''}
          {vs2015 ? <span className="fh-hz-second">{vs2015.text}{s15 !== null ? ` (${fmt(s15)}\u00a0${UNIT})` : ''}.{pm26 !== null ? ` All\u00a0PM2.5 in 2026: ${fmt(pm26)}\u00a0${UNIT}.` : ''}</span> : null}
        </>} />
      <StatTile label="Fire season PM2.5" value={s.pm25Mean === null ? '–' : fmt(s.pm25Mean)} unit={UNIT}
        context={`Mean of July to November, ${fitFirst} to ${fitLast}, measured. For a long mean like this one, the WHO annual guideline is ${WHO_ANNUAL}\u00a0${UNIT}.`} />
      <StatTile label="Smoke from Sumatra" value={shareText(s.shareS)}
        context={<>Share of the smoke from fires, {fitFirst} to {fitLast}. {per(k.sumatra)}</>} />
      <StatTile label="Smoke from Borneo" value={shareText(s.shareB)}
        context={<>Kalimantan, Sarawak, Sabah and Brunei. {per(k.borneo)}</>} />
      <StatTile label="Year to year changes explained, with the month of year" value={pct(Math.max(0, s.model.r2_cv))}
        context="Of the ups and downs of monthly PM2.5 here, on years the model never saw. The month of year is part of the model, so this is not the fires alone." />
      {r2fire !== null ? (
        <StatTile label="Explained by fire, beyond the season" value={pct(Math.max(0, r2fire))}
          context="What the fires add to the month of year alone, on years the model never saw." />
      ) : null}
    </StatGrid>
  );
}

/** One line under the city's numbers: how a share of the smoke is worked out. */
function ShareNote() {
  return <Note>{T.shareHow}</Note>;
}

function seasonTable(seasons: SeasonStat[]): FigureTable {
  return {
    columns: ['Season', `Measured (${UNIT})`, `Our model (${UNIT})`, T.normal, T.smokeFrom('Sumatra'), T.smokeFrom('Borneo')],
    rows: seasons.map((s) => [s.partial ? `${s.yr} (so far)` : String(s.yr), s.obs === null ? '–' : fmt(s.obs), fmt(s.model),
      fmt(s.normal), fmt(s.sumatra), fmt(s.borneo)]),
  };
}

function MonthFigure({ months, season, city, who, model, rows, fitYears, ref }: {
  months: MonthStat[]; season: SeasonStat; city: string; who: number; model: HazeCityModel; rows: HazeMonth[]; fitYears: [number, number];
  ref: MonthStat[];
}) {
  const hasRef = ref.some((d) => d.obs !== null);
  const hasObs = months.some((d) => d.obs !== null);
  const maxSmoke = Math.max(...months.map((d) => d.smoke));
  const peak = months.reduce((a, d) => ((d.obs ?? d.model) > (a.obs ?? a.model) ? d : a));
  const title = !hasObs
    ? `In ${MONTHS[peak.mo - 1]} ${peak.yr}, our model puts PM2.5 in ${city} at ${fmt(peak.model)}\u00a0${UNIT}, about ${fmt(peak.smoke)} of it smoke from fires`
    : maxSmoke >= 2
      ? `In ${MONTHS[peak.mo - 1]} ${peak.yr}, PM2.5 in ${city} reached ${fmt(peak.obs ?? peak.model)}\u00a0${UNIT}, with about ${fmt(peak.smoke)} from fire smoke`
      : `In ${season.yr}, fire smoke added at most ${fmt(maxSmoke)}\u00a0${UNIT} a month in ${city}`;
  // How far off uncorrected MERRA‑2 runs in haze: the haziest measured month of the fit years.
  let bias: ReactNode = null;
  if (!hasObs) {
    const fit = rows.filter((r) => r.yr >= fitYears[0] && r.yr <= fitYears[1] && r.pm25_cnn !== null && r.pm25_merra2 !== null);
    const worst = fit.reduce<HazeMonth | null>((a, r) => (a === null || (r.pm25_cnn ?? 0) > (a.pm25_cnn ?? 0) ? r : a), null);
    if (worst && worst.pm25_cnn !== null && worst.pm25_merra2 !== null) {
      bias = <Note>There is no bias corrected PM2.5 for {season.yr} yet. Uncorrected MERRA‑2 can run far from it in haze: in {MONTHS[worst.mo - 1]} {worst.yr} it read {fmt(worst.pm25_merra2)}&nbsp;{UNIT} here, against {fmt(worst.pm25_cnn)} after the correction.</Note>;
    }
  }
  const table: FigureTable = {
    columns: ['Month', `Measured (${UNIT})`, `Our model (${UNIT})`, '90% range', 'Smoke from fires', 'Days above WHO guideline'],
    rows: months.map((d) => [MONTHS[d.mo - 1] ?? String(d.mo), d.obs === null ? '–' : fmt(d.obs), fmt(d.model),
      `${fmt(d.lo)} to ${fmt(d.hi)}`, fmt(d.smoke), d.daysWho === null ? '–' : `${d.daysWho} of ${d.days}`]),
  };
  return (
    <>
      <PlotFigure
        title={title}
        subtitle={<>
          Monthly mean PM2.5 in {UNIT}, {season.partial ? `July to ${MONTHS[6 + season.months - 1]} ${season.yr}, our estimate` : `July to November ${season.yr}`}. The coloured layers add up to our model.
          <span className="fh-pg-legend">
            <PartsLegend />
            {hasObs ? <Key swatch="line" colour="var(--ink)">{T.measured}</Key> : <Key swatch="hollow" colour="var(--muted)">{T.merra2}</Key>}
            {hasRef ? <Key swatch="line" colour="color-mix(in srgb, var(--ink) 30%, transparent)">{T.ref2015}</Key> : null}
            <Key swatch="rule" colour="var(--ink-2)">{T.who(who)}</Key>
          </span>
        </>}
        source={SOURCE}
        height={300}
        build={() => buildMonths(months, who, !hasObs, ref)}
        deps={[months, who, hasObs, ref]}
        table={table}
      />
      <Note>On years the model never saw, it was typically within {fmt(model.rmse_cv)}&nbsp;{UNIT} of the measured month here.</Note>
      {bias}
    </>
  );
}

function SeasonFacts({ s, city, seasons, fitLast, who }: { s: SeasonStat; city: string; seasons: SeasonStat[]; fitLast: number; who: number }) {
  const full = seasons.filter((x) => !x.partial && x.yr <= fitLast);
  const rank = s.partial ? null : [...full].sort((a, b) => b.smoke - a.smoke).findIndex((x) => x.yr === s.yr) + 1;
  const rows: [ReactNode, ReactNode][] = [
    [T.measuredShort + ' PM2.5, season mean', s.obs === null ? T.notYet : <>{fmt(s.obs)} <small>{UNIT}</small></>],
    [T.model, <>{fmt(s.model)} <small>{UNIT}</small></>],
    [<><span className="fh-pg-swatch" style={{ background: 'var(--fh-sumatra)' }} aria-hidden="true" />{T.smokeFrom('Sumatra')}</>, <>{fmt(s.sumatra)} <small>{UNIT}</small></>],
    [<><span className="fh-pg-swatch" style={{ background: 'var(--fh-borneo)' }} aria-hidden="true" />{T.smokeFrom('Borneo')}</>, <>{fmt(s.borneo)} <small>{UNIT}</small></>],
    ['Hotspots in Sumatra', hotspots(s.hotS)],
    ['Hotspots in Borneo', hotspots(s.hotB)],
  ];
  if (rank !== null && rank > 0) rows.push([`Smoke rank since ${full[0]?.yr ?? ''}`, <>{ordinal(rank)} <small>of {full.length}</small></>]);
  return (
    <div className="fh-hz-season">
      <Card title={`The ${s.yr} season in ${city}`}
        subtitle={s.partial ? `July to ${MONTHS[6 + s.months - 1]} so far, our estimate` : 'July to November'}
        footer="Hotspots are harmonized, on the NOAA‑20 VIIRS scale.">
        <div className="fh-hz-days">
          {s.daysWho === null ? (
            <p className="fh-hz-days-none">Days above the WHO 24 hour guideline of {who}&nbsp;{UNIT}: not out yet (no daily data for {s.yr}).</p>
          ) : (
            <>
              <p className="fh-hz-days-value"><b className="ui-mono">{s.daysWho}</b> <span>of {s.days} days</span></p>
              <p className="fh-hz-days-label">above the WHO 24 hour guideline of {who}&nbsp;{UNIT}</p>
            </>
          )}
        </div>
        <dl className="fh-hz-facts">
          {rows.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </Card>
    </div>
  );
}

function CityTables({ rows, shown, onPick, complete }: { rows: CitySummary[]; shown: string; onPick: (c: string) => void; complete: boolean }) {
  const maxSmoke = Math.max(1e-9, ...rows.flatMap((r) => COMPARED.map((y) => r.smoke[y] ?? 0)));
  const cityColumn: Column<CitySummary> = { key: 'name', label: 'City', render: (r) => (
    <span className="fh-hz-city-cell">
      <button type="button" className="fh-hz-city-btn" onClick={() => onPick(r.name)}>{r.name}</button>
      {r.name === shown ? <Badge tone="ember">Shown</Badge> : null}
    </span>) };
  const yearLabel = (y: Compared) => (y === 2026 ? '2026 (est.)' : String(y));
  const smokeColumns: Column<CitySummary>[] = [cityColumn, ...COMPARED.map((y): Column<CitySummary> => ({
    key: `s${y}`, label: yearLabel(y), num: true, render: (r) => {
      const v = r.smoke[y];
      return v === null ? '–' : (
        <span className={`fh-hz-cell${y === 2026 ? ' fh-hz-cell-estimate' : ''}`}>
          <span className="fh-hz-cell-bar" aria-hidden="true"><span style={{ width: `${(100 * v) / maxSmoke}%` }} /></span>
          {fmt(v)}
        </span>
      );
    } }))];
  const pmColumns: Column<CitySummary>[] = [cityColumn, ...COMPARED.map((y): Column<CitySummary> => ({
    key: `p${y}`, label: yearLabel(y), num: true, render: (r) => {
      const p = r.pm25?.[y];
      if (!p) return complete ? '–' : '…';
      return p.v === null ? '–' : fmt(p.v);
    } }))];
  return (
    <div className="fh-hz-tables">
      <Grid cols={2}>
        <Card title="Smoke from fires" subtitle={`Our model, ${UNIT}`}>
          <DataTable columns={smokeColumns} rows={rows} rowKey={(r) => r.name} caption={`Smoke from fires in Sumatra and Borneo, ${UNIT}, mean of August to October`} />
        </Card>
        <Card title="PM2.5 in all" subtitle={`Measured for 2015 and 2019, our estimate for 2026, ${UNIT}`}>
          <DataTable columns={pmColumns} rows={rows} rowKey={(r) => r.name} caption={`PM2.5 in all, ${UNIT}, mean of August to October`} />
        </Card>
      </Grid>
    </div>
  );
}

function SourceLinks({ models, names }: { models: HazeModels | null; names: Map<string, string> | null }) {
  const sources = (models as (HazeModels & { sources?: Partial<Record<Region, string[]>> }) | null)?.sources;
  if (!models || !names) return <Skeleton height={120} />;
  const chips = (region: Region) => {
    const ids = sources?.[region] ?? [];
    const out: { kind: string; id: string; label: string }[] = [];
    let brunei = false;
    for (const id of ids) {
      if (id.startsWith('BRN-')) { brunei = true; continue; }
      const name = names.get(`state:${id}`);
      out.push({ kind: 'state', id, label: (name ?? id).replace(/, (Indonesia|Malaysia|Brunei)$/, '') });
    }
    if (brunei) out.push({ kind: 'country', id: 'BRN', label: 'Brunei' });
    if (!out.length) out.push(region === 'sumatra' ? { kind: 'country', id: 'IDN', label: 'Indonesia' } : { kind: 'country', id: 'MYS', label: 'Malaysia' });
    return out;
  };
  return (
    <div className="fh-hz-sources">
      {(['sumatra', 'borneo'] as const).map((r) => (
        <div key={r}>
          <p className="fh-hz-source-title">
            <span className="fh-pg-chip-dot" style={{ background: r === 'sumatra' ? 'var(--fh-sumatra)' : 'var(--fh-borneo)' }} aria-hidden="true" />
            {T.regions[r]}
          </p>
          <ul className="fh-pg-chips">
            {chips(r).map((c) => <li key={`${c.kind}:${c.id}`}><AreaLink kind={c.kind} id={c.id} className="fh-pg-chip">{c.label}</AreaLink></li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}
