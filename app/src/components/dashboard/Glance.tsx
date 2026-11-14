// 1. At a glance: the latest month, the year (or season) so far, the trend, the months and hotspots in view, and the
// satellites. For the whole world on the published scale the numbers are dashboard.json's; for any other scope they
// come from the place's monthly series (scope.ts, the Explorer's own functions). Every number glides to its new value
// when the scope changes (AnimatedNumber; instant with reduced motion), and every tile has a small picture of what the
// number means. Hovering a year on the trend line marks that year in the other charts.
import { useEffect, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { DICTS } from '../../lib/i18n';
import type { DashboardData } from '../../lib/dashboard-types';
import { StatTile } from '../ui';
import { AnimatedNumber } from '../AnimatedNumber';
import { Sparkline } from '../Sparkline';
import {
  addMonths, count, dec, int, isClear, monthName, monthYear, NORMAL_WORD, normalTone, pct, pText, satellite,
  timesNormal, trendTone, trendWord, yearOf,
} from './format';
import { BASE_YEARS } from '../../lib/config';
import { Hint, keepNames, useWidth } from './parts';
import { TOTALS } from '../pages/format';
import { viewVerdict } from './verdict';
import { DbSection } from './DbSection';
import { CalendarCard } from './CalendarCard';
import { isWorld, seasonLabel, yearsLabel, type Scope, type ScopeView } from './scope';
import { setFocus, useFocus, type ScopeData } from './useScope';
import { SCALE_WORDS } from './ScopeBar';

const t = DICTS.en;

/** 1326011 -> "1.33", 12965138 -> "13", 14784887 -> "14.8", 443155456 -> "443" (the unit says "million"). */
const mil = (v: number): string => {
  const m = v / 1e6;
  return m >= 100 ? int(m) : m >= 10 ? dec(m, 1).replace(/\.0$/, '') : dec(m, 2);
};

/** A count's format and unit, chosen from the value it glides to (so the unit never changes half way). */
function countFormat(target: number, unit = 'hotspots'): { format: (v: number) => string; unit: string } {
  if (Math.abs(target) >= 1e6) return { format: mil, unit: unit ? `million ${unit}` : 'million' };
  if (Math.abs(target) < 10) return { format: (v) => dec(v, 1), unit };
  return { format: (v) => int(v), unit };
}

/** Months from a to b (yyyymm), b not included. */
const monthsBetween = (a: number, b: number): number =>
  (Math.floor(b / 100) - Math.floor(a / 100)) * 12 + (b % 100) - (a % 100);

/** The years of the record from the most fire to the least, as bars; the latest one lit. */
function RankStrip({ rank, of, month, label }: { rank: number; of: number; month: string; label: string }) {
  return (
    <span className="db-rankstrip" role="img" aria-label={t.panels.rank(rank, of, month)}>
      <span className="db-rankstrip-bars" aria-hidden="true">
        {Array.from({ length: of }, (_, i) => (
          <span key={i} className={i + 1 === rank ? 'db-rankstrip-bar is-on' : 'db-rankstrip-bar'}
            style={{ '--db-h': 1 - (0.62 * i) / Math.max(1, of - 1) } as CSSProperties} />
        ))}
      </span>
      <span className="db-rankstrip-ends" aria-hidden="true">
        <span>Most fire</span>
        <span className="db-rankstrip-you ui-mono" style={{ left: `${((rank - 0.5) / of) * 100}%` }}>{label}</span>
        <span>Least fire</span>
      </span>
    </span>
  );
}

/** A bar of the period so far against a normal one (the tick). */
function SoFar({ total, normal, normalOf }: { total: number; normal: number; normalOf: string }) {
  const max = Math.max(total, normal, 1) * 1.06;
  return (
    <span className="db-sofar" role="img" aria-label={`${count(total)} so far against ${count(normal)} in a normal ${normalOf}`}>
      <span className="db-sofar-track" aria-hidden="true">
        <span className="db-sofar-fill" style={{ '--db-frac': total / max } as CSSProperties} />
        <span className="db-sofar-tick" style={{ left: `${(normal / max) * 100}%` }} />
      </span>
      <span className="db-sofar-labels" aria-hidden="true">
        <span><span className="db-dot db-dot-accent" />So far</span>
        <span><span className="db-tickkey" />Normal</span>
      </span>
    </span>
  );
}

/** Months in two parts: modelled from MODIS, observed by VIIRS. */
function Eras({ modelled, observed, label, seams }: { modelled: number; observed: number; label: string; seams: { label: string; month: number }[] }) {
  const total = Math.max(1, modelled + observed);
  return (
    <span className="db-eras" role="img" aria-label={label}>
      <span className="db-eras-bar" aria-hidden="true">
        <span className="db-eras-part db-eras-modis" style={{ flexGrow: modelled / total }} />
        <span className="db-eras-part db-eras-viirs" style={{ flexGrow: observed / total }} />
      </span>
      <span className="db-eras-labels" aria-hidden="true">
        <span><span className="db-dot" style={{ background: 'var(--sensor-modis)' }} /><b className="ui-mono">{modelled}</b> modelled from MODIS</span>
        <span><span className="db-dot" style={{ background: 'var(--sensor-noaa20)' }} /><b className="ui-mono">{observed}</b> observed by VIIRS</span>
      </span>
      {seams.length ? (
        <span className="db-eras-seams" aria-hidden="true">
          Seams: {seams.map((x, i) => <span key={x.label}>{i ? ', ' : ''}<span className="db-nowrap"><b>{x.label}</b> ({monthYear(x.month)})</span></span>)}
        </span>
      ) : null}
    </span>
  );
}

const CONT_STEPS = ['--ember-900', '--ember-800', '--ember-700', '--ember-600', '--ember-500', '--ember-400'];
const REST = new Set(['Everywhere else', 'The rest']);

/** Shares as one bar (the continents of the world, the parts of a place, or a place against the rest of the world). */
function ShareBar({ items, label }: { items: { name: string; share: number }[]; label: string }) {
  const colour = (i: number, name: string) => (REST.has(name) ? 'var(--border-strong)' : `var(${CONT_STEPS[Math.min(i, CONT_STEPS.length - 1)]})`);
  // a small share and the rest keep one decimal, so they add up (0.3% and 99.7%, never 100%)
  const p = (v: number) => (v > 0 && v < 0.05 ? '<0.1%' : v >= 99.95 && v < 100 ? '>99.9%'
    : (v > 0 && v < 1) || (v > 99 && v < 100) ? pct(v, 1) : pct(v, 0));
  return (
    <span className="db-contbar" role="img" aria-label={`${label}: ${items.map((c) => `${c.name} ${p(c.share)}`).join(', ')}`}>
      <span className="db-contbar-bar" aria-hidden="true">
        {items.map((c, i) => <span key={c.name} style={{ flexGrow: c.share, background: colour(i, c.name) }} />)}
      </span>
      <span className="db-contbar-labels" aria-hidden="true">
        {items.map((c, i) => (
          <span key={c.name}><span className="db-dot" style={{ background: colour(i, c.name) }} />{c.name} <b className="ui-mono">{p(c.share)}</b></span>
        ))}
      </span>
    </span>
  );
}

interface Sat { name: string; sensor: string; colour: string; first: number; last: number }

/** Each satellite's months on one time axis. */
function SatelliteLanes({ sats, x0, x1, still }: { sats: Sat[]; x0: number; x1: number; still: number }) {
  const x = (yyyymm: number) => ((yearOf(yyyymm) - x0) / (x1 - x0)) * 100;
  const ticks = [2000, 2005, 2010, 2015, 2020, 2025].filter((y) => y >= x0 && y <= x1);
  return (
    <span className="db-lanes" role="img"
      aria-label={sats.map((s) => `${s.name} (${s.sensor}) from ${monthYear(s.first)}${s.last >= still ? ', still flying' : ` to ${monthYear(s.last)}`}`).join('; ')}>
      {sats.map((s) => (
        <span key={s.name} className="db-lane" aria-hidden="true">
          <span className="db-lane-name">{s.name}<span className="db-lane-sensor">{s.sensor}</span></span>
          <span className="db-lane-track">
            <span className="db-lane-bar" style={{ left: `${x(s.first)}%`, width: `${x(addMonths(s.last, 1)) - x(s.first)}%`, background: `var(${s.colour})` }} />
          </span>
        </span>
      ))}
      <span className="db-lane db-lane-axis" aria-hidden="true">
        <span className="db-lane-name" />
        <span className="db-lane-track">
          {ticks.map((y) => (
            <span key={y} className={y % 10 ? 'db-lane-tick db-lane-minor ui-mono' : 'db-lane-tick ui-mono'} style={{ left: `${((y - x0) / (x1 - x0)) * 100}%` }}>{y}</span>
          ))}
        </span>
      </span>
    </span>
  );
}

/** The line of totals in the trend tile: hovering it marks a year in every chart. */
function TrendSpark({ values, years, label }: { values: number[]; years: number[]; label: string }) {
  const [ref, w] = useWidth<HTMLSpanElement>();
  const f = useFocus();
  const at = f.yr !== null ? years.indexOf(f.yr) : -1;
  const move = (e: PointerEvent<HTMLSpanElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / Math.max(1, r.width)) * (values.length - 1));
    const yr = years[Math.max(0, Math.min(years.length - 1, i))];
    if (yr !== undefined) setFocus({ yr, mo: null, from: 'spark' });
  };
  return (
    <span className="db-g-spark" ref={ref} onPointerMove={move} onPointerLeave={() => setFocus({ yr: null, mo: null, from: '' })}>
      <Sparkline values={values} width={Math.max(120, w)} height={40} color="var(--harmonized)" label={label} highlight={at >= 0 ? at : undefined} />
      <span className="db-g-spark-ends ui-mono" aria-hidden="true">
        <span>{years[0]}</span>
        {at >= 0 ? <span className="db-g-spark-at">{years[at]}: {count(values[at])}</span> : null}
        <span>{years[years.length - 1]}</span>
      </span>
    </span>
  );
}

interface Tile {
  label: string; value: number | null; format: (v: number) => string; unit?: string;
  delta?: { dir: 'up' | 'down' | 'flat'; text: string }; context: ReactNode;
}

/** The six tiles: the same tiles for every scope, so a change of scope moves the numbers, not the layout. On phones the
 *  last three fold away until "Show more". */
function Tiles({ tiles, on }: { tiles: Tile[]; on: boolean }) {
  const v = (x: number) => (on ? x : 0);
  const cls = ['db-g db-g-wide db-g-hero', 'db-g', 'db-g', 'db-g', 'db-g', 'db-g db-g-wide'];
  const keys = ['latest', 'period', 'trend', 'months', 'total', 'satellites'];
  return (
    <div className="db-glance-grid">
      {tiles.map((tl, i) => (
        <div key={i} className={cls[i]} data-key={keys[i]} data-value={tl.value ?? undefined}>
          <StatTile label={tl.label}
            value={tl.value === null ? '–' : <AnimatedNumber value={v(tl.value)} format={tl.format} duration={900} />}
            unit={tl.value === null ? undefined : tl.unit} delta={tl.delta} context={tl.context} />
        </div>
      ))}
    </div>
  );
}

function satellitesTile(d: DashboardData): Tile {
  const r = d.record;
  const first = addMonths(r.latest_full_month, -(r.months - 1));
  const sats: Sat[] = r.satellites.map((s) => ({ ...satellite(s.satellite), first: s.first, last: s.last }));
  const nModis = sats.filter((s) => s.sensor === 'MODIS').length, nViirs = sats.length - nModis;
  return {
    label: 'Satellites', value: sats.length, format: int, unit: `${nModis} with MODIS, ${nViirs} with VIIRS`,
    context: (
      <>
        <span className="db-g-text">Each satellite sees fire a little differently. The record puts all five on one scale, so a month in 2003 compares with a month in 2026.</span>
        <SatelliteLanes sats={sats} x0={Math.floor(yearOf(first))} x1={yearOf(addMonths(r.last_month, 1))} still={r.latest_full_month} />
      </>
    ),
  };
}

function viirsStart(d: DashboardData): number {
  const v = d.record.satellites.filter((s) => satellite(s.satellite).sensor === 'VIIRS').map((s) => s.first);
  return v.length ? Math.min(...v) : Number.NaN;
}

function seamsOf(d: DashboardData): { label: string; month: number }[] {
  const aqua = d.record.satellites.find((x) => x.satellite === 'Aqua');
  const viirsFirst = viirsStart(d);
  return [
    ...(aqua ? [{ label: 'Aqua joins', month: aqua.first }] : []),
    ...(Number.isFinite(viirsFirst) ? [{ label: 'VIIRS joins', month: viirsFirst }] : []),
  ];
}

/** The tiles of the published page: the whole world, every month, harmonized (dashboard.json). */
function worldTiles(d: DashboardData, readRows: number | null): Tile[] {
  const { record: r, world: w } = d;
  const first = addMonths(r.latest_full_month, -(r.months - 1));
  const after = addMonths(r.latest_full_month, 1);
  const latestMonth = w.latest.yr * 100 + w.latest.mo;
  const lt = normalTone(w.latest.ratio), yt = normalTone(w.ytd.ratio);
  const tr = w.trend;
  const full = w.yearly.filter((y) => y.complete);
  const viirsFirst = viirsStart(d);
  const modelled = Number.isFinite(viirsFirst) ? monthsBetween(first, viirsFirst) : r.months;
  const days = (Date.UTC(Math.floor(after / 100), (after % 100) - 1, 1) - Date.UTC(Math.floor(first / 100), (first % 100) - 1, 1)) / 864e5;
  const perDay = Math.round(r.hotspots_total / days / 100) * 100;
  const conts = [...d.continents].sort((a, b) => b.share_pct - a.share_pct).map((c) => ({ name: c.name, share: c.share_pct }));
  const years = r.months / 12;
  const y0 = full[0]?.yr ?? 2001, y1 = full[full.length - 1]?.yr ?? 2025;
  const trendText = tr.direction === 'no trend'
    ? `No clear trend in the yearly totals, ${y0} to ${y1} (${pText(tr.p)}).`
    : `World fire ${tr.direction === 'decreasing' ? 'fell' : 'rose'} by about ${pct(Math.abs(tr.pct_per_decade), 0)} every ten years from ${y0} to ${y1}. ${isClear(tr.p) ? 'Clear' : 'Not clear'}: ${pText(tr.p)}.`;
  const highest = full.reduce((m, y) => (y.harmonized > m.harmonized ? y : m), full[0]);
  const lowest = full.reduce((m, y) => (y.harmonized < m.harmonized ? y : m), full[0]);
  return [
    {
      label: `World fire in ${monthYear(latestMonth)}`, value: w.latest.h, format: mil, unit: 'million hotspots',
      delta: { dir: lt, text: timesNormal(w.latest.ratio) },
      context: (
        <>
          <span className="db-g-text">
            {NORMAL_WORD[lt]}{w.latest.rank ? `: the ${t.panels.rank(w.latest.rank, w.latest.years, monthName(w.latest.mo))}` : ''}.
            {' '}A normal {monthName(w.latest.mo)} has {count(w.latest.normal)}.
          </span>
          {w.latest.rank ? <RankStrip rank={w.latest.rank} of={w.latest.years} month={monthName(w.latest.mo)} label={String(w.latest.yr)} /> : null}
        </>
      ),
    },
    {
      label: `${w.ytd.yr} so far`, value: w.ytd.total, format: mil, unit: 'million hotspots', delta: { dir: yt, text: timesNormal(w.ytd.ratio) },
      context: (
        <>
          <span className="db-g-text">January to {monthName(w.ytd.months)}. A normal January to {monthName(w.ytd.months)} has {count(w.ytd.normal)}.</span>
          <SoFar total={w.ytd.total} normal={w.ytd.normal} normalOf={`January to ${monthName(w.ytd.months)}`} />
        </>
      ),
    },
    {
      label: `Trend per decade, ${y0} to ${y1}`, value: tr.pct_per_decade, format: (x) => pct(x, 1, true), unit: 'per decade',
      delta: { dir: trendTone(tr.direction), text: trendWord(tr.direction) },
      context: (
        <>
          <span className="db-g-text">{trendText}</span>
          <TrendSpark values={full.map((y) => y.harmonized)} years={full.map((y) => y.yr)}
            label={`World hotspots per year, ${y0} to ${y1}: highest in ${highest.yr} (${count(highest.harmonized)}), lowest in ${lowest.yr} (${count(lowest.harmonized)})`} />
        </>
      ),
    },
    {
      label: 'Months in the record', value: r.months, format: int,
      context: (
        <>
          <span className="db-g-text">
            {monthYear(first)} to {monthYear(r.latest_full_month)}{Number.isInteger(years) ? `, ${years} full years` : ''}.
            {r.last_month > r.latest_full_month ? ` ${monthYear(r.last_month)} is still coming in.` : ''}
          </span>
          {Number.isFinite(viirsFirst)
            ? <Eras modelled={modelled} observed={r.months - modelled} seams={seamsOf(d)}
              label={`${modelled} months modelled from MODIS, ${monthYear(first)} to ${monthYear(addMonths(viirsFirst, -1))}; ${r.months - modelled} months observed by VIIRS, ${monthYear(viirsFirst)} to ${monthYear(r.latest_full_month)}`} />
            : null}
        </>
      ),
    },
    {
      label: TOTALS.scale, value: r.hotspots_total, format: mil, unit: 'million',
      context: (
        <>
          <span className="db-g-text">About {int(perDay)} a day. A hotspot is one pixel that a satellite marked as burning.
            {readRows !== null ? <> {TOTALS.read}: {TOTALS.readValue(readRows)}.<Hint text={TOTALS.link(TOTALS.readValue(readRows), count(r.hotspots_total))} /></> : null}</span>
          <ShareBar items={conts} label="Share of world fire" />
        </>
      ),
    },
    satellitesTile(d),
  ];
}

/** "The most fire of any October in 26 years", "The 3rd highest October in 26 years". */
function rankWords(rank: number, of: number, what: string): string {
  return rank === 1 ? `The most fire of any ${what} in ${of} years` : rank === of ? `The least fire of any ${what} in ${of} years` : `The ${t.panels.rank(rank, of, what)}`;
}

/** "August to October 2026", "January to October 2026", "November 2025 to February 2026", "October 2026". */
function spanWords(from: number, to: number): string {
  const a = Math.floor(from / 100), b = Math.floor(to / 100);
  if (from === to) return monthYear(from);
  return a === b ? `${monthName(from % 100)} to ${monthName(to % 100)} ${b}` : `${monthYear(from)} to ${monthYear(to)}`;
}
/** "August to October", "November to February", "October": the same months in a normal year. */
const spanMonths = (from: number, to: number): string => (from === to ? monthName(from % 100) : `${monthName(from % 100)} to ${monthName(to % 100)}`);

/** About how many a day, rounded for people: 3,600; 140; 2.4. */
function perDayWords(total: number, months: number): string {
  const v = total / Math.max(1, months * 30.44);
  return v >= 1000 ? int(Math.round(v / 100) * 100) : v >= 10 ? int(Math.round(v)) : dec(v, 1);
}

/** The tiles of any other scope, from the place's series. */
function scopedTiles(d: DashboardData, v: ScopeView, s: Scope, data: ScopeData): Tile[] {
  const world = isWorld(s.place);
  const name = data.short;
  const where = s.place.type === 'circle' ? `within ${s.place.km} km of ${name}` : world ? 'in the world' : `in ${name}`;
  const subject = world ? 'World fire' : s.place.type === 'circle' ? `Fire within ${s.place.km} km of ${name}` : `Fire in ${name}`;
  const season = s.months;
  const what = season ? `${seasonLabel(season)} fire` : 'Fire';
  const lat = v.latest, p = v.period, tr = v.trend;
  const lt = normalTone(lat?.ratio ?? null), pt = normalTone(p?.ratio ?? null);
  const full = v.years.filter((y) => y.complete && y.yr >= tr.from && y.yr <= tr.to);
  const mean = full.length ? full.reduce((a, y) => a + y.value, 0) / full.length : null;
  const ver = viewVerdict(tr, s, data.row, data.rows, mean);
  const noYears = tr.from > tr.to;
  const trendText = noYears
    ? `The trend uses the full years ${BASE_YEARS[0]} to ${BASE_YEARS[1]}, and none of them is in view.`
    : tr.pct === null || tr.direction === 'not enough data'
      ? `Too few full ${season ? 'seasons' : 'years'} in view for a trend: 8 are needed.`
      : ver.cls === 'little' ? ver.note
        : ver.cls === 'raw'
          ? `Raw detections ${where} ${tr.pct < 0 ? 'fell' : 'rose'} by about ${pct(Math.abs(tr.pct), 0)} every ten years from ${tr.from} to ${tr.to}. ${ver.note}`
          : tr.direction === 'no trend'
            ? `No clear trend in the ${season ? 'season' : 'yearly'} totals, ${tr.from} to ${tr.to}${tr.p !== null ? ` (${pText(tr.p)})` : ''}.${ver.cls === 'untested' && ver.note ? ` ${ver.note}` : ''}`
            : `${what} ${where} ${tr.direction === 'decreasing' ? 'fell' : 'rose'} by about ${pct(Math.abs(tr.pct), 0)} every ten years from ${tr.from} to ${tr.to}. ${ver.note}`;
  const latestFmt = countFormat(lat?.value ?? 0), periodFmt = countFormat(p?.total ?? 0), totalFmt = countFormat(v.total, '');
  const mo = lat ? lat.ym % 100 : 0;
  const worldTotal = data.world?.total ?? null;
  const shareOfWorld = worldTotal && worldTotal > 0 && !world ? (100 * v.total) / worldTotal : null;
  const parts = world ? data.parts?.filter((x) => x.row.kind === 'continent') ?? null : data.parts;
  let bar: { items: { name: string; share: number }[]; label: string } | null = null;
  if (parts && parts.length && v.total > 0 && !(s.place.type === 'named' && s.place.kind === 'state')) {
    const top = parts.slice(0, 5).map((x) => ({ name: x.own, share: (100 * x.stats.total) / v.total }));
    const rest = Math.max(0, 100 - top.reduce((a, b) => a + b.share, 0));
    bar = { items: rest >= 0.5 ? [...top, { name: 'The rest', share: rest }] : top, label: `Share of ${world ? 'world' : `${name}’s`} fire in view` };
  } else if (shareOfWorld !== null) {
    bar = { items: [{ name, share: shareOfWorld }, { name: 'Everywhere else', share: 100 - shareOfWorld }], label: 'Share of world fire in view' };
  } else if (world) {
    bar = { items: [...d.continents].sort((a, b) => b.share_pct - a.share_pct).map((c) => ({ name: c.name, share: c.share_pct })), label: 'Share of world fire, 2001 to 2025' };
  }
  // raw counts add up every satellite flying, and more fly now than in most years, so against normal reads high
  const scaleNote = s.scale === 'harmonized' ? ''
    : s.scale === 'raw' ? ' Raw counts add up every satellite flying, and more fly now than in most years, so this reads high against normal. Compare on the harmonized scale.'
      : ` On the ${SCALE_WORDS[s.scale].label.toLowerCase()}.`;
  const shareText = shareOfWorld !== null
    ? `${shareOfWorld >= 1 ? pct(shareOfWorld, 1) : shareOfWorld >= 0.01 ? pct(shareOfWorld, 2) : 'Under 0.01%'} of the world’s fire in the same months.`
    : 'A hotspot is one pixel that a satellite marked as burning.';
  return [
    {
      label: lat ? `${subject} in ${monthYear(lat.ym)}` : subject, value: lat?.value ?? null, format: latestFmt.format, unit: latestFmt.unit,
      delta: lat && lat.ratio !== null ? { dir: s.scale === 'raw' ? 'flat' : lt, text: timesNormal(lat.ratio) } : lat && lat.normal === 0 ? { dir: 'flat', text: 'No fire in a normal month' } : undefined,
      context: lat ? (
        <>
          <span className="db-g-text">
            {lat.ratio !== null ? NORMAL_WORD[lt] : 'Nothing to compare with'}{lat.rank ? `: ${rankWords(lat.rank, lat.years, monthName(mo)).replace(/^The/, 'the')}` : ''}.
            {lat.normal !== null ? ` A normal ${monthName(mo)} has ${count(lat.normal)}.` : ''}{scaleNote}
          </span>
          {lat.rank ? <RankStrip rank={lat.rank} of={lat.years} month={monthName(mo)} label={String(Math.floor(lat.ym / 100))} /> : null}
        </>
      ) : <span className="db-g-text">No month with data in view.</span>,
    },
    {
      label: p ? p.label : 'So far', value: p?.total ?? null, format: periodFmt.format, unit: periodFmt.unit,
      delta: p && p.ratio !== null ? { dir: s.scale === 'raw' ? 'flat' : pt, text: timesNormal(p.ratio) } : undefined,
      context: p ? (
        <>
          <span className="db-g-text">
            {spanWords(p.from, p.to)}.{p.normal !== null ? ` A normal ${spanMonths(p.from, p.to)} has ${count(p.normal)}.` : ''}
            {p.rank && p.ranked ? ` ${rankWords(p.rank, p.ranked, spanMonths(p.from, p.to))}.` : ''}{scaleNote}
          </span>
          {p.normal !== null ? <SoFar total={p.total} normal={p.normal} normalOf={spanMonths(p.from, p.to)} /> : null}
        </>
      ) : <span className="db-g-text">No months with data in view.</span>,
    },
    {
      label: noYears ? 'Trend per decade' : `Trend per decade, ${yearsLabel([tr.from, tr.to])}`, value: noYears ? null : tr.pct, format: (x) => pct(x, 1, true), unit: 'per decade',
      delta: { dir: ver.tone, text: ver.word },
      context: (
        <>
          <span className="db-g-text">{trendText}</span>
          {full.length > 1 ? (
            <TrendSpark values={full.map((y) => y.value)} years={full.map((y) => y.yr)}
              label={`${what} ${where} in each year, ${full[0].yr} to ${full[full.length - 1].yr}`} />
          ) : null}
        </>
      ),
    },
    {
      label: 'Months in view', value: v.monthsCounted, format: int,
      context: (
        <>
          <span className="db-g-text">
            {season ? `${seasonLabel(season)} of each year` : 'Every month'}, {yearsLabel(s.years)}
            {v.firstYm && v.lastYm ? `: ${monthYear(v.firstYm)} to ${monthYear(v.lastYm)}.` : '.'}
          </span>
          <Eras modelled={v.modelledMonths} observed={v.monthsCounted - v.modelledMonths} seams={season || s.years[0] > 2002 ? [] : seamsOf(d)}
            label={`${v.modelledMonths} months modelled from MODIS and ${v.monthsCounted - v.modelledMonths} observed by VIIRS`} />
        </>
      ),
    },
    {
      label: 'Hotspots in view', value: v.total, format: totalFmt.format, unit: totalFmt.unit || 'hotspots',
      context: (
        <>
          <span className="db-g-text">{v.monthsCounted ? `About ${perDayWords(v.total, v.monthsCounted)} a day. ` : ''}{shareText}</span>
          {bar ? <ShareBar items={bar.items} label={bar.label} /> : null}
        </>
      ),
    },
    satellitesTile(d),
  ];
}

export function Glance({ d, scope, data }: { d: DashboardData; scope: Scope; data: ScopeData }) {
  // numbers start at zero and glide to their value once the page is on screen
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const v = data.view;
  const hs = (data.meta?.files as { hotspots?: { rows?: unknown } } | undefined)?.hotspots;
  const readRows = typeof hs?.rows === 'number' ? hs.rows : null;
  const tiles = v ? scopedTiles(d, v, scope, data) : worldTiles(d, readRows);
  const subtitle = v
    ? `${data.name}: ${scope.months ? `${seasonLabel(scope.months)} of each year` : 'every month'}, ${yearsLabel(scope.years)}, ${scope.scale === 'harmonized' ? 'on the NOAA-20 VIIRS scale' : `on the ${SCALE_WORDS[scope.scale].label.toLowerCase()}`}. The latest month, the ${scope.months ? 'season' : 'year'} so far and every month in view.`
    : 'The latest full month, the year so far and the whole record. Every count is on the NOAA-20 VIIRS scale, so any two months compare directly.';
  return (
    <DbSection id="db-glance" title="At a glance" subtitle={keepNames(subtitle)} keep={3}>
      <div className={data.loading ? 'db-glance is-busy' : 'db-glance'} aria-busy={data.loading || undefined}>
        <Tiles tiles={tiles} on={on} />
      </div>
      <CalendarCard scope={scope} data={data} lastYear={Math.floor(d.record.latest_full_month / 100)} />
    </DbSection>
  );
}
