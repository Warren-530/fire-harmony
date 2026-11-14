// The period panel: the user picks a range of months (a preset or any start and end month) and sees that period of the
// selected area against the same months of every other year, then downloads it: the monthly record of the period, and
// every satellite hotspot of the area in the period (read from the per region hotspot files by DuckDB in the browser).
// Any custom range takes three taps: From, its month (the picker then asks for the last month in the same list of
// years), and that month.
import * as Plot from '@observablehq/plot';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { exportHotspots, countHotspots, hotspotsCsvHeader, HOTSPOT_LIMIT } from '../../lib/hotspots';
import { fileSlug, saveFile } from '../../lib/download';
import { citation, formatCompact, formatCountWords, useI18n, FIRMS_ACKNOWLEDGEMENT } from '../../lib/i18n';
import {
  clampPeriod, csvForPeriod, monthKey, monthState, periodLabel, periodStats, pickEnd, presetPeriod,
  type Period, type PeriodPreset, type PeriodStats, type PeriodYear,
} from '../../lib/period';
import { comparedWithNormal, countText, knownRange, monthlyCsv, plural, shortAgainstNormal } from '../../lib/stats';
import { useTheme } from '../../lib/theme';
import type { AreaSelection, Meta, MonthlyPoint, Source } from '../../lib/types';
import { AnimatedNumber } from '../AnimatedNumber';
import { IconCalendar, IconChevronLeft, IconChevronRight, IconDownload, IconExternal } from '../icons';
import { onPressOutside } from '../explorer/dismiss';
import { afterPanelResize, panelResizing } from '../explorer/panelSize';
import { Tooltip } from '../Tooltip';
import { useToast } from '../Toast';
import { TableScroll, cssVar, plotTheme } from '../ui';
import '../../styles/period.css';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SOURCE_TEXT: Record<Source, string> = {
  0: 'VIIRS observed', 1: 'modelled from MODIS Terra and Aqua', 2: 'modelled from MODIS Terra only', 3: 'no data yet',
};
const SATELLITES = [
  { key: 't', name: 'Terra', colour: '--sensor-modis' }, { key: 'a', name: 'Aqua', colour: '--sensor-modis' },
  { key: 's', name: 'Suomi NPP', colour: '--sensor-snpp' }, { key: 'n', name: 'NOAA-20', colour: '--sensor-noaa20' },
  { key: 'j', name: 'NOAA-21', colour: '--sensor-noaa21' },
] as const;

/** Exact whole hotspots, as every detail of the Explorer writes them (lib/stats.ts countText: "65,657", "about 2"). */
const int = (v: number) => countText(v, 'exact');
/** Hotspots in words: 812, 21,200, 46.1 million (never "46.1m", which reads as metres). */
const words = (v: number) => formatCountWords(v, 'en');
const axis = (v: number) => formatCompact(v, 'en');
/** A ratio to normal as the strip writes it: "13.8×" from about 2, "+35%", "−60%" or "normal" below (lib/stats.ts). */
const times = (r: number) => shortAgainstNormal(r);
const ordinal = (n: number) => {
  const t = n % 100, s = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10];
  return `${n}${t >= 11 && t <= 13 ? 'th' : s ?? 'th'}`;
};

type Choice = PeriodPreset | 'custom';

export interface PeriodPanelProps {
  sel: AreaSelection;
  name: string;                       // the area's name, for titles and files
  points: readonly MonthlyPoint[];    // the area's monthly record (areaSeries)
  meta: Meta;
  onPeriodChange?: (p: Period) => void;
  initial?: Period | null;            // the months to open with (a link's "&from=&to=", or the period of the place before)
  firmsHref?: string | null;          // NASA FIRMS at the place on the map, for the fires of the last days
}

const PRESET_KEYS: readonly PeriodPreset[] = ['last12', 'ytd', 'lastYear', 'season', 'all'];

export function PeriodPanel({ sel, name, points, meta, onPeriodChange, initial = null, firmsHref = null }: PeriodPanelProps) {
  const { t } = useI18n();
  const range = useMemo(() => knownRange(points), [points]);
  const presets = useMemo(
    () => Object.fromEntries(PRESET_KEYS.map((k) => [k, presetPeriod(k, points)])) as Record<PeriodPreset, Period | null>, [points]);
  // the months it opens with: a preset when they are one (its chip shows pressed), else a custom range
  const [choice, setChoice] = useState<Choice>(() => (initial
    ? PRESET_KEYS.find((k) => presets[k]?.from === initial.from && presets[k]?.to === initial.to) ?? 'custom' : 'last12'));
  const [custom, setCustom] = useState<Period | null>(() => (initial ? { from: initial.from, to: initial.to } : null));
  const period: Period | null = useMemo(() => {
    if (!range) return null;
    if (choice === 'custom' && custom) return clampPeriod(custom, range.first, range.last);
    return (choice !== 'custom' ? presets[choice] : null) ?? presets.last12;
  }, [choice, custom, presets, range]);
  const stats = useMemo(() => (period ? periodStats(points, period, meta) : null), [points, period, meta]);
  const notify = useRef(onPeriodChange);
  notify.current = onPeriodChange;
  useEffect(() => { if (period) notify.current?.(period); }, [period?.from, period?.to]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!range || !period || !stats) {
    return <p className="pp-empty">No month of this area has data yet.</p>;
  }
  const setPeriod = (p: Period) => { setCustom(clampPeriod(p, range.first, range.last)); setChoice('custom'); };
  const label = periodLabel(period, SHORT);
  const chips: { key: PeriodPreset; text: string }[] = [
    { key: 'last12', text: 'Last 12 months' },
    { key: 'ytd', text: `${Math.floor(range.last / 100)} so far` },
    { key: 'lastYear', text: presets.lastYear ? String(Math.floor(presets.lastYear.from / 100)) : 'Last year' },
    { key: 'season', text: 'Fire season' },
    { key: 'all', text: 'Whole record' },
  ];

  return (
    <section className="pp" aria-label="Period">
      <div className="pp-presets" role="group" aria-label="Choose a period">
        {chips.map((c) => (
          <Tooltip key={c.key} content={presets[c.key] ? periodLabel(presets[c.key] as Period, SHORT) : 'This area has no fire season'}>
            <button type="button" className="ui-chip" aria-pressed={choice === c.key}
              disabled={!presets[c.key]} onClick={() => setChoice(c.key)}>
              {c.text}
            </button>
          </Tooltip>
        ))}
      </div>
      <RangePicker period={period} min={range.first} max={range.last} onChange={setPeriod} />
      <p className="pp-caption" aria-live="polite">
        <IconCalendar /> <strong>{label}</strong> · {stats.months} {stats.months === 1 ? 'month' : 'months'} · {sourceText(stats)}
      </p>

      <Tiles stats={stats} />

      {stats.years.length > 1 ? (
        <YearsChart stats={stats} onPick={(y) => setPeriod({ from: y.from, to: y.to })} />
      ) : stats.perYear !== null ? (
        <p className="pp-note">A period longer than a year is compared per year: {int(stats.perYear)} hotspots per 12 months
          {stats.normal ? <>, against {int(stats.normal)} in a normal year (median of 2001 to 2025)</> : null}.</p>
      ) : null}

      <Satellites stats={stats} />

      <Downloads sel={sel} name={name} points={points} meta={meta} period={period} label={label} stats={stats} />

      {firmsHref ? (
        <p className="pp-note pp-firms">
          {t.exMap.dots.firmsNote(`${MONTH_NAMES[(range.last % 100) - 1]} ${Math.floor(range.last / 100)}`)}{' '}
          <Tooltip content={t.exMap.dots.firmsTip}>
            <a className="fh-ex-firms" href={firmsHref} target="_blank" rel="noopener noreferrer">{t.exMap.dots.firms}<IconExternal size={14} /></a>
          </Tooltip>
        </p>
      ) : null}
    </section>
  );
}

function sourceText(s: PeriodStats): string {
  const k = (Object.keys(s.sources) as unknown as Source[]).filter((src) => s.sources[src] > 0);
  if (k.length === 1) return SOURCE_TEXT[k[0]];
  const obs = s.sources[0], mod = s.sources[1] + s.sources[2];
  const parts = [obs ? `${obs} observed by VIIRS` : '', mod ? `${mod} modelled from MODIS` : '', s.sources[3] ? `${s.sources[3]} without data yet` : ''];
  return parts.filter(Boolean).join(', ');
}

/** From and To: two buttons, each opening the years of the record as one list (every year a grid of twelve months).
 *  A range is shaded, its ends solid. Picking the first month moves on to the last one in the same list, so any
 *  range takes three taps: From, the first month and the last month (scroll to another year in between, or jump
 *  with the year buttons). Arrow keys move (up and down by a row of four), Page keys by a year, Home and End to the
 *  ends of a year, Enter picks, Escape closes. A press outside closes it and does nothing else. */
function RangePicker({ period, min, max, onChange }: { period: Period; min: number; max: number; onChange: (p: Period) => void }) {
  const [open, setOpen] = useState<'from' | 'to' | null>(null);
  const [cursor, setCursor] = useState(period.from);
  const minYear = Math.floor(min / 100), maxYear = Math.floor(max / 100);
  const [viewYear, setViewYear] = useState(Math.floor(period.from / 100));
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const opened = useRef(false);      // the list has been scrolled to its first year since it opened
  const years = useMemo(() => Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i), [minYear, maxYear]);

  const show = (end: 'from' | 'to') => {
    const ym = end === 'from' ? period.from : period.to;
    opened.current = false;
    setCursor(ym);
    setViewYear(Math.floor(ym / 100));
    setOpen(end);
  };
  // the year in view: the one under the upper part of the list (the year buttons step from it)
  const onScroll = () => {
    const l = list.current;
    if (!l) return;
    const at = l.scrollTop + l.clientHeight * 0.4;
    let yr = minYear;
    for (const b of l.querySelectorAll<HTMLElement>('[data-yr]')) if (b.offsetTop <= at) yr = Number(b.dataset.yr);
    setViewYear(yr);
  };
  const toYear = (yr: number) => {
    const l = list.current, b = l?.querySelector<HTMLElement>(`[data-yr="${yr}"]`);
    if (l && b) l.scrollTop = b.offsetTop;
  };
  // on opening, the list starts at the year of the month in focus; then the month in focus is kept in view
  useLayoutEffect(() => {
    if (!open) return;
    const l = list.current;
    if (!l) return;
    // room under the last year, so any year can reach the top of the list
    const last = l.querySelector<HTMLElement>(`[data-yr="${maxYear}"]`);
    if (last) l.style.paddingBottom = `${Math.max(0, l.clientHeight - last.offsetHeight - 4)}px`;
    const cell = l.querySelector<HTMLButtonElement>(`[data-ym="${cursor}"]`);
    if (!opened.current) { opened.current = true; toYear(Math.floor(cursor / 100)); }
    else if (cell) {
      const c = cell.getBoundingClientRect(), r = l.getBoundingClientRect();
      if (c.top < r.top + 4) l.scrollTop -= r.top + 4 - c.top;
      else if (c.bottom > r.bottom - 4) l.scrollTop += c.bottom - r.bottom + 4;
    }
    cell?.focus({ preventScroll: true });
    onScroll();
  }, [open, cursor]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    return onPressOutside(() => [box.current], () => setOpen(null));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    box.current?.querySelector('.pp-pop')?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }, [open]);

  const pick = (ym: number) => {
    if (!open) return;
    const next = pickEnd(period, open, ym);
    onChange(next);
    // the last month is picked in the same list, from where the first one was
    if (open === 'from') { setOpen('to'); setCursor(next.from); }
    else { setOpen(null); box.current?.querySelector<HTMLButtonElement>('.pp-when[data-end="to"]')?.focus(); }
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      const end = open;
      setOpen(null);
      box.current?.querySelector<HTMLButtonElement>(`.pp-when[data-end="${end}"]`)?.focus();
      return;
    }
    if (!(e.target as HTMLElement).closest('.pp-months')) return;
    const next = monthKey(cursor, e.key, min, max);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    setCursor(next);
  };
  // the year buttons jump a year from the one at the top, and the month in focus goes with them
  const stepYear = (by: number) => {
    const yr = Math.min(Math.max(viewYear + by, minYear), maxYear);
    toYear(yr);
    setViewYear(yr);
    setCursor(Math.min(Math.max(yr * 100 + (cursor % 100), min), max));
  };
  const when = (end: 'from' | 'to') => {
    const ym = end === 'from' ? period.from : period.to;
    return (
      <button type="button" className="pp-when ui-press" data-end={end} aria-expanded={open === end} aria-controls={open === end ? `${id}-pop` : undefined}
        aria-label={`${end === 'from' ? 'From' : 'To'} ${SHORT[(ym % 100) - 1]} ${Math.floor(ym / 100)}. Change`}
        onClick={() => (open === end ? setOpen(null) : show(end))}>
        <span className="pp-when-label">{end === 'from' ? 'From' : 'To'}</span>
        <span className="pp-when-value">{SHORT[(ym % 100) - 1]} {Math.floor(ym / 100)}</span>
        <IconCalendar />
      </button>
    );
  };
  return (
    <div ref={box} className="pp-range" onKeyDown={onKey}>
      {when('from')}
      <span className="pp-range-to" aria-hidden="true">to</span>
      {when('to')}
      {open ? (
        <div id={`${id}-pop`} className="pp-pop" role="dialog" aria-label={open === 'from' ? 'Choose the first month' : 'Choose the last month'}>
          <div className="pp-pop-head">
            <Tooltip content="Year before">
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon pp-pop-step" aria-label="Year before"
                disabled={viewYear <= minYear} onClick={() => stepYear(-1)}><IconChevronLeft size={16} /></button>
            </Tooltip>
            <span className="pp-pop-year" aria-live="polite">{viewYear}</span>
            <Tooltip content="Year after">
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon pp-pop-step" aria-label="Year after"
                disabled={viewYear >= maxYear} onClick={() => stepYear(1)}><IconChevronRight size={16} /></button>
            </Tooltip>
          </div>
          <p className="pp-pop-hint">{open === 'from' ? 'Pick the first month' : 'Now pick the last month'}</p>
          <div ref={list} className="pp-years" onScroll={onScroll}>
            {years.map((yr) => (
              <div key={yr} className="pp-year" data-yr={yr}>
                <p className="pp-year-label" aria-hidden="true">{yr}</p>
                <div className="pp-months" role="group" aria-label={`Months of ${yr}`}>
                  {SHORT.map((m, i) => {
                    const ym = yr * 100 + i + 1;
                    const st = monthState(ym, period, min, max);
                    return (
                      <button key={m} type="button" className="pp-month ui-press" data-ym={ym} data-state={st}
                        aria-pressed={ym === (open === 'from' ? period.from : period.to)} aria-label={`${MONTH_NAMES[i]} ${yr}`}
                        disabled={st === 'out'} tabIndex={ym === cursor ? 0 : -1} onClick={() => pick(ym)}>
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Tiles({ stats }: { stats: PeriodStats }) {
  const r = stats.ratio;
  const long = stats.perYear !== null;
  return (
    <div className="pp-tiles">
      <div className="pp-tile pp-tile-main">
        <p className="pp-tile-label">Hotspots</p>
        <p className="pp-tile-value"><AnimatedNumber value={stats.total ?? 0} format={int} /></p>
        <p className="pp-tile-context">
          {stats.range ? <>90% range {int(stats.range.lo)} to {int(stats.range.hi)}</> : 'harmonized, on the NOAA-20 VIIRS scale'}
        </p>
      </div>
      <div className="pp-tile">
        <p className="pp-tile-label">{long ? 'Per year, against normal' : 'Against normal'}</p>
        <p className={`pp-tile-value${r !== null && r >= 1.5 ? ' pp-hot' : r !== null && r <= 0.67 ? ' pp-cool' : ''}`}>
          {r === null ? '–' : times(r)}
        </p>
        <p className="pp-tile-context">{stats.normal === null ? 'no normal for these months' : `normal ${int(stats.normal)}${long ? ' a year' : ''}`}</p>
      </div>
      <div className="pp-tile">
        <p className="pp-tile-label">Rank</p>
        <p className="pp-tile-value">{stats.rank === null ? '–' : ordinal(stats.rank)}</p>
        <p className="pp-tile-context">
          {stats.rank === null ? (long ? 'ranked for a year or less' : 'some months have no data yet') : `of ${stats.ranked} years, by fire`}
        </p>
      </div>
      <div className="pp-tile">
        <p className="pp-tile-label">Busiest month</p>
        <p className="pp-tile-value pp-tile-value-sm">{stats.peak ? `${SHORT[stats.peak.mo - 1]} ${stats.peak.yr}` : '–'}</p>
        <p className="pp-tile-context">{stats.peak ? `${int(stats.peak.value)} hotspots` : 'no fire in this period'}</p>
      </div>
    </div>
  );
}

/** The same months in every year as bars; the chosen period is the fire coloured bar, a click picks another year. */
function YearsChart({ stats, onPick }: { stats: PeriodStats; onPick: (y: PeriodYear) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const theme = useTheme();
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // (while the Explorer's panel is resized by a drag the chart waits, and is drawn once when it ends)
    const read = (n: number) => { if (!panelResizing()) setWidth((w) => (Math.abs(n - w) > 4 ? n : w)); };
    const ro = new ResizeObserver((e) => read(Math.round(e[0].contentRect.width)));
    ro.observe(el);
    const off = afterPanelResize(() => read(Math.round(el.getBoundingClientRect().width)));
    return () => { ro.disconnect(); off(); };
  }, []);
  const data = useMemo(() => stats.years.filter((y) => y.value !== null), [stats.years]);
  useEffect(() => {
    const el = box.current;
    if (!el || width < 120 || !data.length) return;
    const accent = cssVar('--accent'), muted = cssVar('--text-3'), ink2 = cssVar('--text-2');
    const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(width / 64))));
    // ticks every few years, but none under the chosen bar or next to it (that bar is labelled with its own year)
    const at = data.findIndex((d) => d.selected);
    const tickOk = (i: number) => i % every === 0 && (at < 0 || Math.abs(i - at) >= Math.max(2, Math.ceil(every / 2)));
    const chart = Plot.plot(plotTheme(width, 150, {
      marginTop: 10, marginRight: stats.normal !== null ? 48 : 6, marginBottom: 22, marginLeft: 40,
      x: { type: 'band', domain: data.map((d) => d.label), padding: 0.22, label: null,
        tickFormat: (l: string, i: number) => (tickOk(i) ? l : '') },
      y: { grid: true, label: null, ticks: 3, tickFormat: axis, nice: true },
      marks: [
        Plot.barY(data, { x: 'label', y: 'value', fill: (d: PeriodYear) => (d.selected ? accent : muted),
          fillOpacity: (d: PeriodYear) => (d.selected ? 1 : 0.45), rx: 1.5 }),
        // the chosen bar's year, under it in the place of a tick, in the fire colour
        Plot.text(data.filter((d) => d.selected), { x: 'label', text: 'label', frameAnchor: 'bottom', dy: 15, fill: accent,
          fontWeight: 700, fontSize: 11 }),
        stats.normal !== null ? Plot.ruleY([stats.normal], { stroke: ink2, strokeWidth: 1.2, strokeOpacity: 0.9 }) : null,
        // the label sits in the right margin, clear of every bar
        stats.normal !== null ? Plot.text([stats.normal], { y: (d: number) => d, frameAnchor: 'right', dx: 6, text: () => 'normal',
          fill: ink2, fontSize: 11, textAnchor: 'start' }) : null,
        Plot.tip(data, Plot.pointerX({ x: 'label', y: 'value',
          title: (d: PeriodYear) => `${periodLabel(d, SHORT)}\n${int(d.value as number)} hotspots${stats.normal ? ` · ${comparedWithNormal((d.value as number) / stats.normal)}` : ''}${d.selected ? '' : '\nClick to pick these months'}` })),
      ],
    }));
    const onClick = () => { const v = (chart as unknown as { value?: PeriodYear | null }).value; if (v && !v.selected) pick.current(v); };
    chart.addEventListener('click', onClick);
    chart.style.cursor = 'pointer';
    el.replaceChildren(chart);
    return () => { chart.removeEventListener('click', onClick); chart.remove(); };
  }, [width, data, stats.normal, theme]);
  const own = data.find((d) => d.selected);
  return (
    <figure className="pp-chart">
      <figcaption>
        <span className="pp-chart-title">The same months in every year</span>
        <span className="pp-chart-sub">{own ? `${own.label} in fire colour; the grey line is the normal (median of 2001 to 2025)` : 'The grey line is the normal (median of 2001 to 2025)'}</span>
      </figcaption>
      <div ref={box} className="pp-chart-plot" role="img"
        aria-label={`Bar chart of the same months in ${data.length} years${own ? `; ${own.label} has ${int(own.value as number)} hotspots` : ''}`} />
      <details className="pp-numbers">
        <summary>Show the numbers</summary>
        {/* (scrolls inside the panel, its column names stuck on top: the shared table view of ui.tsx) */}
        <TableScroll>
          <table className="ui-table">
            <thead><tr><th scope="col">Months</th><th scope="col" className="ui-num">Hotspots</th></tr></thead>
            <tbody>{data.map((d) => (
              <tr key={d.from} aria-current={d.selected ? 'true' : undefined}>
                <th scope="row">{periodLabel(d, SHORT)}</th><td className="ui-num">{int(d.value as number)}</td>
              </tr>))}
            </tbody>
          </table>
        </TableScroll>
      </details>
    </figure>
  );
}

function Satellites({ stats }: { stats: PeriodStats }) {
  const rows = SATELLITES.filter((s) => stats.raw[s.key] > 0);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((s) => stats.raw[s.key]));
  return (
    <div className="pp-sats">
      <p className="pp-sats-title">Raw detections by satellite <span>(before harmonization)</span></p>
      <ul>
        {rows.map((s) => (
          <li key={s.key}>
            <span className="pp-sat-name"><i style={{ background: `var(${s.colour})` }} aria-hidden="true" />{s.name}</span>
            <span className="pp-sat-bar" aria-hidden="true"><b style={{ width: `${(100 * stats.raw[s.key]) / max}%`, background: `var(${s.colour})` }} /></span>
            <span className="pp-sat-n">{int(stats.raw[s.key])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Job = { state: 'idle' } | { state: 'working'; what: string } | { state: 'error'; text: string };

function Downloads({ sel, name, points, meta, period, label, stats }: {
  sel: AreaSelection; name: string; points: readonly MonthlyPoint[]; meta: Meta; period: Period; label: string; stats: PeriodStats;
}) {
  const toast = useToast();
  const [countedOnly, setCountedOnly] = useState(false);
  const [job, setJob] = useState<Job>({ state: 'idle' });
  // a new area or period clears the last message; keyed on the selection's content, since the parent may rebuild the object
  const selKey = useMemo(() => JSON.stringify(sel.type === 'named' ? [sel.area.kind, sel.area.id] : sel), [sel]);
  useEffect(() => { setJob({ state: 'idle' }); }, [period.from, period.to, selKey]);
  const inRecord = stats.raw.t + stats.raw.a + stats.raw.s + stats.raw.n + stats.raw.j;   // counted hotspots, by solar month
  const tooMany = inRecord > HOTSPOT_LIMIT;
  const base = `fire_harmony_${fileSlug(name)}_${period.from}_${period.to}`;

  const saveMonthly = () => {
    const csv = monthlyCsv(name, points, meta, { citation: citation(meta.version), sourceLabel: (s) => SOURCE_TEXT[s] });
    saveFile(new Blob([csvForPeriod(csv, period)], { type: 'text/csv;charset=utf-8' }), `${base}_monthly.csv`);
    toast(`Monthly record of ${label} saved`);
  };

  const saveHotspots = async () => {
    try {
      if (!countedOnly && inRecord > HOTSPOT_LIMIT * 0.6) {
        setJob({ state: 'working', what: 'Counting the hotspots…' });
        const n = await countHotspots(sel, period.from, period.to, false);
        if (n > HOTSPOT_LIMIT) {
          setJob({ state: 'error', text: `This search finds ${int(n)} hotspots, more than the ${int(HOTSPOT_LIMIT)} a file can hold. Pick a smaller area or fewer months, or keep only the hotspots in the record.` });
          return;
        }
      }
      setJob({ state: 'working', what: 'Reading the hotspot files…' });
      const out = await exportHotspots({ sel, fromYm: period.from, toYm: period.to, countedOnly });
      if (!out || out.rows === 0) {
        setJob({ state: 'error', text: `No satellite hotspot in ${name} in ${label}.` });
        return;
      }
      const head = hotspotsCsvHeader(name, label, countedOnly, citation(meta.version), FIRMS_ACKNOWLEDGEMENT);
      saveFile(new Blob([head, out.bytes], { type: 'text/csv;charset=utf-8' }), `${base}_hotspots.csv`);
      setJob({ state: 'idle' });
      toast(`${int(out.rows)} hotspots saved`);
    } catch (e) {
      setJob({ state: 'error', text: `The hotspots could not be read (${e instanceof Error ? e.message : String(e)}). Please try again.` });
    }
  };

  const working = job.state === 'working';
  return (
    <div className="pp-downloads">
      <p className="pp-downloads-title">Download this period</p>
      <div className="pp-download-row">
        <button type="button" className="ui-btn" onClick={saveMonthly}>
          <IconDownload /> Monthly record <span className="pp-btn-meta">CSV · {plural(stats.months, 'row')}</span>
        </button>
        <button type="button" className="ui-btn ui-btn-primary" onClick={saveHotspots} disabled={working || tooMany} aria-describedby="pp-hs-note">
          <IconDownload /> {working ? job.what : 'Hotspots'}
          {!working ? <span className="pp-btn-meta">CSV · {countedOnly ? 'about' : 'at least'} {words(inRecord)}</span> : null}
        </button>
      </div>
      <label className="pp-check">
        <input type="checkbox" checked={countedOnly} onChange={(e) => setCountedOnly(e.target.checked)} />
        Only the hotspots counted in the record (vegetation fires, not low confidence)
      </label>
      <p id="pp-hs-note" className={`pp-note${job.state === 'error' || tooMany ? ' pp-note-warn' : ''}`} role={job.state === 'error' ? 'alert' : undefined}>
        {job.state === 'error' ? job.text
          : tooMany ? `About ${words(inRecord)} hotspots: more than the ${words(HOTSPOT_LIMIT)} a file can hold. Pick a smaller area or fewer months.`
          : 'Every satellite hotspot in the area and period: date and time (UTC), position, satellite, fire radiative power, confidence, and whether the record counts it.'}
      </p>
    </div>
  );
}
