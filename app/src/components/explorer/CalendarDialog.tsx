// The burning calendar at full size: the challenge's main product over the whole window. Twelve month columns by one
// row per year (2001 to the latest year, the current year in view without scrolling), month names at the top and the
// bottom and the years on both sides, coloured by fire count or against normal, the critical period outlined (the
// months above the 75th percentile in at least half of the years, the panel's CONAE rule), the modelled months MODIS
// saw none of hatched, a box's value on hover and on keyboard focus (the arrow keys move between boxes), a legend with
// five ticks, and the picture to download. A modal <dialog>: the focus stays inside, Esc and the Close button close it.
// Wide windows put the words in a side column so the boxes can be at least 24 px; narrow ones stack them.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { FIRST_YEAR } from '../../lib/config';
import { formatMonth, useI18n } from '../../lib/i18n';
import {
  anomalies, climatology, comparedWithNormal, countClass, countScale, countText, criticalMonths, littleFire, modelledWithoutModis,
  monthRuns, onScale, ratioClass, ratioDirection, ratioLimit, valueOf, LITTLE_FIRE_NORMAL, LITTLE_FIRE_NOTE,
} from '../../lib/stats';
import type { ColourMode, MonthlyPoint, Scale } from '../../lib/types';
import { saveCalendarPicture } from '../Downloads';
import { ANOMALY_FILLS, ColourBar, EMBER_FILLS, ZERO_FILL, countTicks5, ratioTicks5, type BarExtra } from '../Legend';
import { useToast } from '../Toast';
import { Tooltip } from '../Tooltip';
import { Delta, Segmented, Skeleton } from '../ui';
import { IconClose, IconDownload } from '../icons';
import { coarsePointer } from './pointer';

export type Month = { yr: number; mo: number };

/** The expand icon (four corners pointing out), drawn like the app's outline icons. */
export function IconExpand({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}

export interface CalendarDialogProps {
  open: boolean;
  onClose(): void;
  points: readonly MonthlyPoint[] | null;   // as loaded; null (or `busy`) while the area's series loads
  busy: boolean;
  scale: Scale;
  mode: ColourMode;                          // the colours it opens with (the panel's)
  selected: Month | null;                    // the month on the map
  onSelect(m: Month): void;
  name: string;
  title: string;                             // the finding ("The fire season is August to October, peaking in September")
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const key = (yr: number, mo: number) => yr * 100 + mo;
const WIDE = 900;          // from this dialog width the words go in a side column
const SIDE = 300;

export function CalendarDialog(props: CalendarDialogProps) {
  const { open, onClose, points, busy, scale, selected, onSelect, name, title } = props;
  const { t, lang } = useI18n();
  const c = t.calendar, f = c.full;
  const toast = useToast();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const dialog = useRef<HTMLDialogElement>(null);
  const gridBox = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ColourMode>(props.mode);
  const [size, setSize] = useState({ w: 0, h: 0, dw: 0 });
  const [hover, setHover] = useState<Month | null>(null);
  const [cursor, setCursor] = useState<Month | null>(null);
  const [focused, setFocused] = useState(false);
  const [saving, setSaving] = useState(false);

  // open and close the modal with the prop; Esc (the dialog's cancel) and the Close button tell the Explorer
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) { setMode(props.mode); d.showModal(); }
    else if (!open && d.open) d.close();
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  const scaled = useMemo(() => (points ? onScale(points, scale) : null), [points, scale]);
  const own = useMemo(() => (scaled ?? []).filter((p) => p.yr >= FIRST_YEAR), [scaled]);
  const byKey = useMemo(() => new Map(own.map((p) => [key(p.yr, p.mo), p])), [own]);
  const normals = useMemo(() => (scaled ? climatology(scaled, 'harmonized').map((n) => n.median) : []), [scaled]);
  const anomByKey = useMemo(() => new Map((scaled ? anomalies(scaled, 'harmonized') : []).map((a) => [key(a.yr, a.mo), a])), [scaled]);
  const cScale = useMemo(() => countScale(own.map((p) => valueOf(p, 'harmonized'))), [own]);
  const limit = useMemo(() => ratioLimit(own.map((p) => [valueOf(p, 'harmonized'), normals[p.mo - 1] ?? null] as const)), [own, normals]);
  const little = useMemo(() => (scaled ? littleFire(scaled) : false), [scaled]);
  const runs = useMemo(() => (scaled && !little ? monthRuns(criticalMonths(scaled, 'harmonized')) : []), [scaled, little]);
  const critical = useMemo(() => new Set(runs.flatMap(([a, b]) => MONTHS.filter((m) => (a <= b ? m >= a && m <= b : m >= a || m <= b)))), [runs]);
  const anyModelled = useMemo(() => own.some(modelledWithoutModis), [own]);
  const years = useMemo(() => {
    const ys = [...new Set(own.map((p) => p.yr))].sort((a, b) => a - b);
    return ys;
  }, [own]);
  const latest = useMemo(() => {
    for (let i = own.length - 1; i >= 0; i--) if (valueOf(own[i], 'harmonized') !== null) return { yr: own[i].yr, mo: own[i].mo };
    return null;
  }, [own]);

  // the room for the boxes, measured
  useLayoutEffect(() => {
    const el = gridBox.current, d = dialog.current;
    if (!open || !el || !d) return undefined;
    const measure = () => setSize((prev) => {
      const next = { w: Math.floor(el.clientWidth), h: Math.floor(el.clientHeight), dw: Math.floor(d.clientWidth) };
      return prev.w === next.w && prev.h === next.h && prev.dw === next.dw ? prev : next;
    });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(d);
    return () => ro.disconnect();
  }, [open, size.dw >= WIDE]);   // eslint-disable-line react-hooks/exhaustive-deps

  const wide = size.dw >= WIDE;
  const narrow = size.dw > 0 && size.dw < 480;
  const gap = narrow ? 1.5 : 2;
  const yl = narrow ? 30 : 44, ml = narrow ? 16 : 18;
  const n = Math.max(1, years.length);
  const cw = Math.max(14, Math.min(64, Math.floor((size.w - 2 * yl - 13 * gap) / 12)));
  const fitH = Math.floor((size.h - 2 * ml - (n + 1) * gap) / n);
  const ch = Math.max(12, Math.min(36, fitH));
  const scrolls = fitH < 12;

  // the current year in view: the boxes fit; if a very short window makes them scroll, start at the bottom
  useLayoutEffect(() => {
    const el = gridBox.current;
    if (open && el && scrolls) el.scrollTop = el.scrollHeight;
  }, [open, scrolls, ch]);

  // the focus starts on the month on the map (else the latest), so the arrow keys work at once
  const cellRefs = useRef(new Map<number, HTMLDivElement>());
  const firstFocus = useRef(false);
  useEffect(() => { if (!open) { firstFocus.current = false; setHover(null); setFocused(false); } }, [open]);
  useEffect(() => {
    if (!open || firstFocus.current || !own.length || busy) return;
    firstFocus.current = true;
    const start = selected && byKey.has(key(selected.yr, selected.mo)) ? selected : latest;
    setCursor(start);
    if (start) requestAnimationFrame(() => cellRefs.current.get(key(start.yr, start.mo))?.focus({ preventScroll: true }));
  }, [open, own.length, busy, selected, latest, byKey]);

  const fillOf = (p: MonthlyPoint): string | null => {
    const v = valueOf(p, 'harmonized');
    if (v === null) return null;
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

  const move = useCallback((m: Month) => {
    if (!byKey.has(key(m.yr, m.mo))) return;
    setCursor(m);
    cellRefs.current.get(key(m.yr, m.mo))?.focus();
  }, [byKey]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
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
      case 'PageUp': next = { yr: Math.max(years[0] ?? from.yr, from.yr - 5), mo: from.mo }; break;
      case 'PageDown': next = { yr: Math.min(years[years.length - 1] ?? from.yr, from.yr + 5), mo: from.mo }; break;
      case 'Enter': case ' ': {
        e.preventDefault();
        const p = byKey.get(key(from.yr, from.mo));
        if (p && valueOf(p, 'harmonized') !== null) onSelect(from);
        return;
      }
      default: return;
    }
    e.preventDefault();
    if (next) move(next);
  };

  const active = hover ?? (focused ? cursor : null) ?? (selected && byKey.has(key(selected.yr, selected.mo)) ? selected : null) ?? latest;
  const activePoint = active ? byKey.get(key(active.yr, active.mo)) : undefined;
  const activeValue = activePoint ? valueOf(activePoint, 'harmonized') : null;
  const activeAnom = active ? anomByKey.get(key(active.yr, active.mo)) : undefined;
  const monthName = active ? t.common.months[active.mo - 1] : '';
  const coarse = coarsePointer();

  const extras: BarExtra[] = [
    ...(mode === 'count' ? [{ label: t.explorer.noFire, fill: ZERO_FILL }] : []),
    { label: t.explorer.noDataYet, fill: 'hatch' },
    ...(anyModelled ? [{ label: c.modelledNone, fill: 'modelled' as const }] : []),
    ...(runs.length ? [{ label: f.critical, fill: 'outline' as const }] : []),
  ];
  const legendW = wide ? SIDE - 8 : Math.max(220, Math.min(420, size.dw - 32));

  const download = async () => {
    if (!points || saving) return;
    setSaving(true);
    try {
      await saveCalendarPicture({ name, points, scale, mode, lastYear: years[years.length - 1] ?? 2026, t, lang });
      toast(t.ex.toasts.png);
    } catch { toast(t.ex.toasts.failed, 'info'); } finally { setSaving(false); }
  };

  const readout = active && !busy ? (
    <div className="fh-calf-readout" aria-live="polite">
      <p className="fh-calf-month">{formatMonth(active.yr, active.mo, lang)}</p>
      {activeValue === null ? <p className="ui-note">{c.noData}</p> : (
        <>
          <p className="fh-calf-value ui-mono">{unit(countText(activeValue, 'exact'))}</p>
          {little ? <p className="ui-note">{LITTLE_FIRE_NORMAL}</p> : (
            <div className="fh-calf-notes">
              {activeAnom?.ratio !== null && activeAnom?.ratio !== undefined ? (
                <Delta dir={ratioDirection(activeAnom.ratio)} text={comparedWithNormal(activeAnom.ratio)} />
              ) : activeAnom?.median === 0 ? (
                <Delta dir={activeValue > 0 ? 'up' : 'flat'} text={activeValue > 0 ? t.kpi.fireUnusual : t.kpi.noFireUsual} />
              ) : null}
              {activeAnom?.rank && activeValue > 0 ? <span className="ui-note">{c.rank(activeAnom.rank, activeAnom.years, monthName)}</span> : null}
              {activeAnom?.median ? <span className="ui-note">{c.normal(monthName, countText(activeAnom.median, 'exact'))}</span> : null}
            </div>
          )}
          {activePoint && modelledWithoutModis(activePoint) ? <p className="ui-note">{c.modelledNoneLong}</p> : null}
        </>
      )}
    </div>
  ) : <div className="fh-calf-readout" aria-hidden="true"><Skeleton height={16} /><Skeleton height={20} /></div>;

  const close = (
    <Tooltip content={f.close} keys={['Esc']}>
      <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon fh-calf-close" aria-label={f.close} onClick={onClose}>
        <IconClose size={18} />
      </button>
    </Tooltip>
  );
  const tools = (
    <div className="fh-calf-tools">
      <Segmented<ColourMode> label={f.colour} hideLabel value={mode} onChange={setMode}
        options={[{ value: 'count', label: f.count }, { value: 'anomaly', label: f.anomaly }]} />
      <Tooltip content={f.download}>
        <button type="button" className="ui-btn fh-calf-download" onClick={() => { void download(); }} disabled={!points || busy || saving}
          aria-label={saving ? f.making : f.download}>
          <IconDownload size={17} /><span>{saving ? f.making : f.download}</span>
        </button>
      </Tooltip>
    </div>
  );
  const head = (
    <div className="fh-calf-head">
      <div className="fh-calf-titles">
        <h2 id={`${uid}-title`} className="fh-calf-title">{busy || !points ? <Skeleton height={20} /> : title}</h2>
        <p className="fh-calf-sub">{name}{years.length ? ` · ${f.years(years[0], years[years.length - 1])}` : ''}</p>
      </div>
      {close}
    </div>
  );
  const legend = (
    <div className="fh-calf-legend">
      <ColourBar width={legendW} title={mode === 'count' ? t.explorer.legend[scale] : t.explorer.legend.anomaly}
        colours={mode === 'count' ? EMBER_FILLS : ANOMALY_FILLS}
        ticks={mode === 'count' ? countTicks5(cScale ?? { lo: 1, hi: 10 }, lang) : ratioTicks5(limit, t.explorer.normalLabel, lang)}
        extras={extras} exportName="calendar-full-legend" />
      {little ? <p className="ui-note fh-ex-little">{LITTLE_FIRE_NOTE}</p> : null}
      <p className="ui-note fh-calf-help">{coarse ? f.helpTouch : f.help}</p>
    </div>
  );

  const rows = years;
  const grid = (
    <div ref={gridBox} className="fh-calf-gridbox" data-scrolls={scrolls ? '' : undefined}>
      {size.w > 0 && own.length && !busy ? (
        <div className="fh-calf-grid" role="grid" aria-label={f.label(name)} aria-describedby={`${uid}-help`} onKeyDown={onKey}
          onMouseLeave={() => setHover(null)}
          style={{ gridTemplateColumns: `${yl}px repeat(12, ${cw}px) ${yl}px`, gridTemplateRows: `${ml}px repeat(${n}, ${ch}px) ${ml}px`, gap }}
          data-cell={`${cw}x${ch}`}>
          {/* (every part has its place in the grid, so the outlines of the critical period lie over the boxes) */}
          <div role="row" className="fh-calf-row">
            {t.common.monthsShort.map((m, i) => (
              <span key={m} role="columnheader" className={`fh-calf-mlabel${critical.has(i + 1) ? ' is-critical' : ''}`}
                aria-label={t.common.months[i]} style={{ gridRow: 1, gridColumn: i + 2 }}>{cw >= 30 ? m : m.charAt(0)}</span>
            ))}
          </div>
          {rows.map((yr, r) => (
            <div key={yr} role="row" className="fh-calf-row">
              <span role="rowheader" className={`fh-calf-ylabel${selected?.yr === yr ? ' is-on' : ''}`} style={{ gridRow: r + 2, gridColumn: 1 }}>{yr}</span>
              {MONTHS.map((mo) => {
                const p = byKey.get(key(yr, mo));
                if (!p) return null;
                const fill = fillOf(p);
                const isCursor = cursor ? cursor.yr === yr && cursor.mo === mo : r === rows.length - 1 && mo === 1;
                const isSel = !!selected && selected.yr === yr && selected.mo === mo;
                return (
                  <div key={mo} ref={(el) => { if (el) cellRefs.current.set(key(yr, mo), el); else cellRefs.current.delete(key(yr, mo)); }}
                    role="gridcell" tabIndex={isCursor ? 0 : -1} aria-label={describe(p)} aria-selected={isSel}
                    className={`fh-calf-cell${fill === null ? ' is-nodata' : ''}${modelledWithoutModis(p) ? ' is-modelled' : ''}${isSel ? ' is-selected' : ''}`}
                    style={{ gridRow: r + 2, gridColumn: mo + 1, ...(fill ? { background: fill } : {}) }} data-ym={key(yr, mo)}
                    onMouseEnter={() => setHover({ yr, mo })}
                    onFocus={() => { setFocused(true); setCursor({ yr, mo }); }} onBlur={() => setFocused(false)}
                    onClick={() => { setCursor({ yr, mo }); if (fill !== null) onSelect({ yr, mo }); }} />
                );
              })}
              <span className={`fh-calf-ylabel fh-calf-ylabel-end${selected?.yr === yr ? ' is-on' : ''}`} aria-hidden="true"
                style={{ gridRow: r + 2, gridColumn: 14 }}>{yr}</span>
            </div>
          ))}
          <div className="fh-calf-row" aria-hidden="true">
            {t.common.monthsShort.map((m, i) => (
              <span key={m} className={`fh-calf-mlabel${critical.has(i + 1) ? ' is-critical' : ''}`} style={{ gridRow: n + 2, gridColumn: i + 2 }}>
                {cw >= 30 ? m : m.charAt(0)}</span>
            ))}
          </div>
          {/* the critical period: one outline per run of months (a run across the new year is two) */}
          {runs.flatMap(([a, b]) => (a <= b ? [[a, b]] : [[a, 12], [1, b]])).map(([a, b]) => (
            <span key={`${a}-${b}`} className="fh-calf-crit" aria-hidden="true"
              style={{ gridColumn: `${a + 1} / ${b + 2}`, gridRow: `2 / ${n + 2}` }} />
          ))}
        </div>
      ) : busy || !points ? <Skeleton height={Math.max(200, size.h - 8)} /> : null}
    </div>
  );

  return (
    <dialog ref={dialog} className="fh-calf ui-glass ui-glass-thick" aria-labelledby={`${uid}-title`} data-wide={wide ? '' : undefined}
      onCancel={(e) => { e.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); }}>
      {open ? (
        <div className="fh-calf-body">
          {wide ? (
            <>
              <div className="fh-calf-main">{grid}</div>
              <aside className="fh-calf-side" style={{ width: SIDE }}>
                {head}
                {tools}
                {readout}
                {legend}
                <span id={`${uid}-help`} className="sr-only">{coarse ? f.helpTouch : f.help}</span>
              </aside>
            </>
          ) : (
            <>
              {head}
              {tools}
              {readout}
              <div className="fh-calf-main">{grid}</div>
              {legend}
              <span id={`${uid}-help`} className="sr-only">{coarse ? f.helpTouch : f.help}</span>
            </>
          )}
        </div>
      ) : null}
    </dialog>
  );
}
