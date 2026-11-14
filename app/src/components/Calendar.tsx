// The burning calendar: one box per month (years down, months across), coloured by fire or by fire against normal.
// The colours follow the area's own range (log steps between its low and high months, see countScale), so the
// season and the bad years show for the world, a country or a small state alike. Next to it, the month under the
// pointer (or the keyboard cursor, or the month on the map) in words, and the colour bar.
import {
  useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent,
} from 'react';
import { FIRST_YEAR } from '../lib/config';
import {
  anomalies, climatology, comparedWithNormal, countClass, countScale, countText, littleFire, modelledWithoutModis, ratioClass,
  ratioDirection, ratioLimit, valueOf, LITTLE_FIRE_NORMAL, LITTLE_FIRE_NOTE,
} from '../lib/stats';
import { formatMonth, useI18n } from '../lib/i18n';
import type { ColourMode, MonthlyPoint, Scale } from '../lib/types';
import { Delta, Skeleton } from './ui';
import { ANOMALY_FILLS, ColourBar, EMBER_FILLS, MODELLED_STRIPE, ZERO_FILL, countTicks5, ratioTicks5, type BarExtra } from './Legend';
import { coarsePointer } from './explorer/pointer';
import { inFrame } from './explorer/hover';
import { afterPanelResize, panelResizing } from './explorer/panelSize';

export type Month = { yr: number; mo: number };

export interface CalendarProps {
  points: readonly MonthlyPoint[];   // on the chosen scale: h holds the value (see onScale in stats.ts)
  scale: Scale;
  mode: ColourMode;
  years: readonly [number, number];  // the years shown
  selected: Month | null;            // the month on the map
  onSelect(month: Month): void;
  onHover?(month: Month | null): void;   // the month under the pointer or the keyboard cursor (null when it leaves)
  name: string;
  busy?: boolean;                    // the points are not the selected area's yet: no words about its months
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const key = (yr: number, mo: number) => yr * 100 + mo;
const same = (a: Month | null, b: Month | null) => !!a && !!b && a.yr === b.yr && a.mo === b.mo;

export function Calendar({ points, scale, mode, years, selected, onSelect, onHover, name, busy = false }: CalendarProps) {
  const { t, lang } = useI18n();
  const c = t.calendar;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHoverState] = useState<Month | null>(null);
  const hoverNow = useRef<Month | null>(null);
  const setHover = (m: Month | null) => { hoverNow.current = m; setHoverState(m); };
  const [cursor, setCursor] = useState<Month | null>(null);
  const [focused, setFocused] = useState(false);
  const hoverCb = useRef(onHover);
  useLayoutEffect(() => { hoverCb.current = onHover; });
  const pointAt = (m: Month | null) => { hoverCb.current?.(m); };

  // lay the boxes out in whole pixels for the width we have
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    setWidth(Math.round(el.getBoundingClientRect().width));
    // (while the Explorer's panel is resized by a drag the boxes wait, and are laid out once when it ends)
    const read = (w: number) => { if (!panelResizing()) setWidth((prev) => (Math.abs(prev - w) >= 2 ? w : prev)); };
    const ro = new ResizeObserver((entries) => read(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    const off = afterPanelResize(() => read(Math.round(el.getBoundingClientRect().width)));
    return () => { ro.disconnect(); off(); };
  }, []);

  const byKey = useMemo(() => new Map(points.map((p) => [key(p.yr, p.mo), p])), [points]);
  const normals = useMemo(() => climatology(points, 'harmonized').map((n) => n.median), [points]);
  const anomByKey = useMemo(() => new Map(anomalies(points, 'harmonized').map((a) => [key(a.yr, a.mo), a])), [points]);
  const own = useMemo(() => points.filter((p) => p.yr >= FIRST_YEAR), [points]);
  const cScale = useMemo(() => countScale(own.map((p) => valueOf(p, 'harmonized'))), [own]);
  const limit = useMemo(
    () => ratioLimit(own.map((p) => [valueOf(p, 'harmonized'), normals[p.mo - 1] ?? null] as const)), [own, normals]);
  // a place with little fire (too little to judge a normal month), and the modelled months MODIS saw none of
  const little = useMemo(() => littleFire(points), [points]);
  const anyModelled = useMemo(() => own.some(modelledWithoutModis), [own]);
  const latest = useMemo(() => {
    for (let i = own.length - 1; i >= 0; i--) if (valueOf(own[i], 'harmonized') !== null) return { yr: own[i].yr, mo: own[i].mo };
    return null;
  }, [own]);

  const lastYear = own.length ? own[own.length - 1].yr : years[1];
  const rows: number[] = [];
  for (let yr = Math.max(FIRST_YEAR, years[0]); yr <= Math.min(lastYear, years[1]); yr++) rows.push(yr);

  const compact = width > 0 && width < 520;
  const LEFT = compact ? 36 : 46, TOP = 20, GAP = compact ? 1.5 : 2;
  const bw = Math.max(14, Math.min(56, Math.floor((Math.max(width, 240) - LEFT) / 12)));
  const bh = compact ? 12 : 15;
  const svgW = LEFT + 12 * bw, svgH = TOP + rows.length * bh + 2;
  const allYears = bh >= 13;
  const monthLabels = bw >= 30 ? t.common.monthsShort : LETTERS;

  const valueAt = (m: Month): number | null => {
    const p = byKey.get(key(m.yr, m.mo));
    return p ? valueOf(p, 'harmonized') : null;
  };
  const known = (m: Month | null): m is Month => !!m && valueAt(m) !== null;
  const inRows = (m: Month) => m.yr >= (rows[0] ?? 0) && m.yr <= (rows[rows.length - 1] ?? 0);

  const fillOf = (p: MonthlyPoint): string => {
    const v = valueOf(p, 'harmonized');
    if (v === null) return `url(#${uid}h)`;
    if (mode === 'count') {
      const k = cScale ? countClass(v, cScale) : -1;
      return k < 0 ? ZERO_FILL : EMBER_FILLS[k];
    }
    const k = ratioClass(v, normals[p.mo - 1] ?? null, limit);
    return k === null ? ZERO_FILL : ANOMALY_FILLS[k];
  };

  const unit = c.units[scale];
  const describe = (p: MonthlyPoint): string => {
    const label = formatMonth(p.yr, p.mo, lang);
    const v = valueOf(p, 'harmonized');
    if (v === null) return `${label}: ${t.explorer.noDataYet}`;
    const a = anomByKey.get(key(p.yr, p.mo));
    const vs = !little && a?.ratio !== null && a?.ratio !== undefined ? `, ${comparedWithNormal(a.ratio)}` : '';
    return `${label}: ${unit(countText(v, 'exact'))}${vs}${modelledWithoutModis(p) ? `. ${c.modelledNone}` : ''}`;
  };

  const cellAt = (e: MouseEvent<SVGSVGElement>): Month | null => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left - LEFT, y = e.clientY - r.top - TOP;
    if (x < 0 || y < 0) return null;
    const mo = Math.floor(x / bw) + 1, row = Math.floor(y / bh);
    if (mo < 1 || mo > 12 || row < 0 || row >= rows.length) return null;
    const m = { yr: rows[row], mo };
    return byKey.has(key(m.yr, m.mo)) ? m : null;
  };

  const choose = (m: Month | null) => {
    if (!m) return;
    setCursor(m);
    if (known(m)) onSelect(m);
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const from = cursor ?? selected ?? latest;
    if (!from) return;
    let next: Month | null = null;
    switch (e.key) {
      case 'ArrowLeft': next = from.mo === 1 ? { yr: from.yr - 1, mo: 12 } : { yr: from.yr, mo: from.mo - 1 }; break;
      case 'ArrowRight': next = from.mo === 12 ? { yr: from.yr + 1, mo: 1 } : { yr: from.yr, mo: from.mo + 1 }; break;
      case 'ArrowUp': next = { yr: from.yr - 1, mo: from.mo }; break;
      case 'ArrowDown': next = { yr: from.yr + 1, mo: from.mo }; break;
      case 'Home': next = { yr: from.yr, mo: 1 }; break;
      case 'End': next = { yr: from.yr, mo: 12 }; break;
      case 'PageUp': next = { yr: Math.max(rows[0] ?? from.yr, from.yr - 5), mo: from.mo }; break;
      case 'PageDown': next = { yr: Math.min(rows[rows.length - 1] ?? from.yr, from.yr + 5), mo: from.mo }; break;
      case 'Enter': case ' ':
        e.preventDefault();
        choose(from);
        return;
      default: return;
    }
    e.preventDefault();
    if (next && byKey.has(key(next.yr, next.mo)) && inRows(next)) { setCursor(next); pointAt(next); }
  };

  // the month described next to the calendar
  const active = hover ?? (focused ? cursor : null) ?? (selected && inRows(selected) ? selected : null) ?? latest;
  const activePoint = active ? byKey.get(key(active.yr, active.mo)) : undefined;
  const activeValue = activePoint ? valueOf(activePoint, 'harmonized') : null;
  const activeAnom = active ? anomByKey.get(key(active.yr, active.mo)) : undefined;
  const monthName = active ? t.common.months[active.mo - 1] : '';

  const box = (m: Month) => ({ x: LEFT + (m.mo - 1) * bw + GAP / 2, y: TOP + rows.indexOf(m.yr) * bh + GAP / 2 });
  const ring = (m: Month | null, cls: string) => {
    if (!m || !inRows(m) || !byKey.has(key(m.yr, m.mo))) return null;
    const { x, y } = box(m);
    return <rect className={cls} x={x - 1} y={y - 1} width={bw - GAP + 2} height={bh - GAP + 2} rx={3} fill="none" pointerEvents="none" />;
  };

  const extras: BarExtra[] = [
    ...(mode === 'count' ? [{ label: t.explorer.noFire, fill: ZERO_FILL }] : []),
    { label: t.explorer.noDataYet, fill: 'hatch' },
    ...(anyModelled ? [{ label: c.modelledNone, fill: 'modelled' as const }] : []),
  ];
  const coarse = coarsePointer();

  // the boxes (300 and more, each with its sentence for screen readers): drawn again only when they change, never for
  // the month under the pointer (its ring and the readout beside are drawn apart)
  const selKey = selected ? key(selected.yr, selected.mo) : '';
  const grid = useMemo(() => rows.map((yr, r) => (
    <g key={yr} role="row">
      <text className={`fh-ex-cal-label${selected?.yr === yr ? ' fh-ex-cal-label-on' : ''}`} aria-hidden="true"
        x={LEFT - 8} y={TOP + r * bh + (bh - GAP) / 2 + 4} textAnchor="end">
        {allYears || r === 0 || r === rows.length - 1 || (yr % 5 === 0 && r > 1 && r < rows.length - 2) ? yr : ''}
      </text>
      {MONTHS.map((mo) => {
        const p = byKey.get(key(yr, mo));
        if (!p) return null;
        const x = LEFT + (mo - 1) * bw + GAP / 2, y = TOP + r * bh + GAP / 2;
        return (
          <g key={mo}>
            <rect id={`${uid}-${yr}-${mo}`} role="gridcell" aria-label={describe(p)}
              aria-selected={same(selected, { yr, mo })} x={x} y={y} width={bw - GAP} height={bh - GAP} rx={2} fill={fillOf(p)}
              data-modelled={modelledWithoutModis(p) ? '' : undefined} />
            {modelledWithoutModis(p) ? <rect x={x} y={y} width={bw - GAP} height={bh - GAP} rx={2} fill={`url(#${uid}m)`} pointerEvents="none" aria-hidden="true" /> : null}
          </g>
        );
      })}
    </g>
  )), [rows[0], rows.length, byKey, anomByKey, normals, cScale, limit, little, mode, scale, lang, t, bw, bh, compact, allYears, selKey, uid]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fh-ex-cal">
      <div ref={wrap} className="fh-ex-cal-grid">
        {width > 0 ? (
          <svg className="fh-ex-cal-svg" width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} role="grid"
            aria-label={t.panels.calendarLabel(name)} aria-describedby={`${uid}help`} tabIndex={0} data-export="calendar"
            aria-activedescendant={focused && cursor && inRows(cursor) ? `${uid}-${cursor.yr}-${cursor.mo}` : undefined}
            onKeyDown={onKey} onFocus={() => { setFocused(true); if (!cursor) setCursor(selected ?? latest); }}
            onBlur={() => { setFocused(false); pointAt(null); }}
            // (the moves between two frames make one update, in the frame, with the month it previews: explorer/hover.ts)
            onMouseMove={(e) => { const m = cellAt(e); inFrame('calendar-hover', () => { if (!same(hoverNow.current, m)) { setHover(m); pointAt(m); } }); }}
            onMouseLeave={() => inFrame('calendar-hover', () => { setHover(null); pointAt(null); })} onClick={(e) => choose(cellAt(e))}>
            <defs>
              <pattern id={`${uid}h`} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width={4} height={4} fill="var(--surface-1)" />
                <line x1={0} y1={0} x2={0} y2={4} stroke="var(--baseline)" strokeWidth={1.6} />
              </pattern>
              <pattern id={`${uid}m`} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                <line x1={0} y1={0} x2={0} y2={5} stroke={MODELLED_STRIPE} strokeWidth={1.6} />
              </pattern>
            </defs>
            <g aria-hidden="true">
              {monthLabels.map((l, i) => (
                <text key={i} className={`fh-ex-cal-label${selected?.mo === i + 1 ? ' fh-ex-cal-label-on' : ''}`}
                  x={LEFT + i * bw + (bw - GAP) / 2} y={12} textAnchor="middle">{l}</text>
              ))}
            </g>
            {grid}
            {ring(hover, 'fh-ex-cal-hover')}
            {focused ? ring(cursor, 'fh-ex-cal-cursor') : null}
            {ring(selected, 'fh-ex-cal-selected')}
          </svg>
        ) : null}
      </div>

      <div className="fh-ex-cal-side">
        <div className="fh-ex-cal-readout" aria-live="polite" aria-busy={busy || undefined}>
          {busy ? <div className="fh-ex-wait" aria-hidden="true"><Skeleton height={16} /><Skeleton height={22} /><Skeleton height={14} /></div> : active ? (
            <>
              <p className="fh-ex-cal-month">{formatMonth(active.yr, active.mo, lang)}</p>
              {activeValue === null ? <p className="ui-note">{c.noData}</p> : (
                <>
                  <p className="fh-ex-cal-value">{unit(countText(activeValue, 'exact'))}</p>
                  {little ? <p className="ui-note">{LITTLE_FIRE_NORMAL}</p> : (
                    <>
                      {activeAnom?.ratio !== null && activeAnom?.ratio !== undefined ? (
                        <Delta dir={ratioDirection(activeAnom.ratio)} text={comparedWithNormal(activeAnom.ratio)} />
                      ) : activeAnom?.median === 0 ? (
                        <Delta dir={activeValue > 0 ? 'up' : 'flat'} text={activeValue > 0 ? t.kpi.fireUnusual : t.kpi.noFireUsual} />
                      ) : null}
                      {activeAnom?.rank && activeValue > 0 ? (
                        <p className="ui-note">{c.rank(activeAnom.rank, activeAnom.years, monthName)}.</p>
                      ) : null}
                      {activeAnom?.median !== null && activeAnom?.median !== undefined ? (
                        <p className="ui-note">{activeAnom.median > 0
                          ? `${c.normal(monthName, countText(activeAnom.median, 'exact'))}.` : `${c.noNormal(monthName)}.`}</p>
                      ) : null}
                    </>
                  )}
                  {activePoint && modelledWithoutModis(activePoint) ? <p className="ui-note">{c.modelledNoneLong}</p> : null}
                </>
              )}
              <p className="fh-ex-cal-state">{same(active, selected) ? c.onMap : coarse ? c.tapToShow : c.clickToShow}</p>
            </>
          ) : null}
        </div>
        <ColourBar width={272} exportName="calendar-legend"
          title={mode === 'count' ? t.explorer.legend[scale] : t.explorer.legend.anomaly}
          colours={mode === 'count' ? EMBER_FILLS : ANOMALY_FILLS}
          ticks={mode === 'count' ? countTicks5(cScale ?? { lo: 1, hi: 10 }, lang) : ratioTicks5(limit, t.explorer.normalLabel, lang)}
          extras={extras} />
        {little ? <p className="ui-note fh-ex-little" data-little="">{LITTLE_FIRE_NOTE}</p> : null}
        {scale !== 'harmonized' ? <p className="ui-note">{c.scaleNote[scale]}</p> : null}
        <p className="ui-note" id={`${uid}help`}>{coarse ? c.tapHelp : c.keyHelp}</p>
      </div>

      {/* hidden for the eye, read by screen readers: a block wrapper (a table ignores the 1 px width of .sr-only and
          would widen the page) */}
      <div className="sr-only">
      <table>
        <caption>{t.panels.calendarLabel(name)}</caption>
        <thead><tr><th scope="col">{t.chart.cols.year}</th>{t.common.months.map((m) => <th key={m} scope="col">{m}</th>)}</tr></thead>
        <tbody>
          {rows.map((yr) => (
            <tr key={yr}>
              <th scope="row">{yr}</th>
              {MONTHS.map((mo) => {
                const p = byKey.get(key(yr, mo));
                const v = p ? valueOf(p, 'harmonized') : null;
                return <td key={mo}>{p ? (v === null ? t.explorer.noDataYet : countText(v, 'exact')) : ''}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
