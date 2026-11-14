// The scope bar: what the whole dashboard shows. Four controls in the manner of Linear's and Vercel's filter bars:
// the place (search any country, state or city, or pick a recent one), the years (a range over a small chart of the
// place's fire in each year), the months (every month, one month, or a season that may cross the new year, over the
// place's normal year) and the scale. On a laptop each control opens its own panel under it; on a phone one sheet
// holds all four. Every change goes into the link.
import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  CITY_RADIUS_KM, markedParts, recentPlaces, rememberPlace, searchAreas, useRecentVersion, useSearchIndex, type HitKind, type SearchHit,
} from '../../lib/search';
import type { Scale } from '../../lib/types';
import { FIRST_YEAR } from '../../lib/config';
import { Tooltip } from '../Tooltip';
import {
  IconCalendar, IconCheck, IconChevronDown, IconCircle, IconClose, IconGlobe, IconLayers, IconPolygon, IconSearch, IconTarget,
} from '../icons';
import { count, monthShort } from './format';
import {
  isWorld, placeKey, seasonLabel, seasonMonths, wraps, yearsLabel, WORLD_PLACE, type Scope, type ScopePlace, type ScopeView,
} from './scope';
import type { ScopeData } from './useScope';

const reduceMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const phone = (): boolean => window.matchMedia?.('(max-width: 760px), (max-height: 500px)').matches ?? false;

export const SCALE_WORDS: Record<Scale, { label: string; short: string; help: string }> = {
  harmonized: { label: 'Harmonized', short: 'Harmonized', help: 'The harmonized record: every month on the NOAA-20 VIIRS scale, with a 90% range where it is modelled' },
  modis: { label: 'MODIS scale', short: 'MODIS', help: 'The same record on the MODIS scale (Terra and Aqua), for comparing with older studies' },
  raw: { label: 'Raw sensors', short: 'Raw', help: 'The raw detections of each satellite, added up, before harmonizing' },
};

const KIND_ICON: Record<HitKind, ReactNode> = {
  world: <IconGlobe size={16} />, continent: <IconGlobe size={16} />, country: <IconGlobe size={16} />, state: <IconPolygon size={16} />,
  city: <IconTarget size={16} />, point: <IconCircle size={16} />,
};
const KIND_WORD: Record<HitKind, string> = { world: 'World', continent: 'Continent', country: 'Country', state: 'State', city: 'City, 50 km', point: 'Circle' };

/** Places to start from when nothing is typed: the big fire countries, a fire province and a city. */
const SUGGEST = ['country:IDN', 'country:BRA', 'state:IDN-492', 'country:COD', 'country:AUS', 'country:USA'];

const placeOfHit = (h: SearchHit): ScopePlace => (h.selection.type === 'circle'
  ? { type: 'circle', lat: h.selection.lat, lon: h.selection.lon, km: h.selection.radiusKm }
  : h.selection.type === 'named' ? { type: 'named', kind: h.selection.area.kind, id: h.selection.area.id } : WORLD_PLACE);

// ------------------------------------------------------------------------------------------------ popover

type Panel = 'place' | 'years' | 'months' | 'scale';

/** A panel under its button (laptop) or a sheet from the bottom (phone), in a portal so the sticky bar's blur does not
 *  hold it. Escape or a click outside closes it, and the focus goes back to the button. */
function Pop({ anchor, open, onClose, label, wide = false, children }: {
  anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; label: string; wide?: boolean; children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({});
  const [sheet, setSheet] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const s = phone();
      setSheet(s);
      if (!a || s) { setPos({}); return; }
      const w = Math.min(window.innerWidth - 16, wide ? 520 : 380);
      const left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8));
      setPos({ top: Math.round(a.bottom + 8), left: Math.round(left), width: w, maxHeight: `calc(100dvh - ${Math.round(a.bottom + 24)}px)` });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place); };
  }, [open, anchor, wide]);
  // the latest onClose, so a new function on each render does not run the effects again (they would move the focus)
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchor.current?.contains(t)) return;
      closeRef.current();
    };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(); anchor.current?.focus(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); };
  }, [open, anchor]);
  // the focus goes into the panel once, when it opens: to the control marked for it, else the value that is on (the
  // scale), else the first field, else the month that is on, else the first button
  useEffect(() => {
    if (!open) return;
    const b = box.current;
    if (!b) return;
    const order = ['[data-autofocus]', '[role="radio"][aria-checked="true"]', 'input', '.db-mcell[aria-pressed="true"]', '.db-pop-body button'];
    for (const sel of order) {
      const el = b.querySelector<HTMLElement>(sel);
      if (el) { el.focus({ preventScroll: true }); break; }
    }
  }, [open]);
  if (!open) return null;
  return createPortal(
    <>
      {sheet ? <div className="db-pop-backdrop" aria-hidden="true" onClick={onClose} /> : null}
      <div ref={box} className={sheet ? 'db-pop is-sheet' : 'db-pop'} role="dialog" aria-label={label} style={pos}>
        {sheet ? (
          <div className="db-pop-head">
            <p className="db-pop-title">{label}</p>
            <Tooltip content="Close" keys={['Esc']}>
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon db-pop-close" aria-label="Close" onClick={() => { onClose(); anchor.current?.focus(); }}>
                <IconClose size={18} />
              </button>
            </Tooltip>
          </div>
        ) : null}
        <div className="db-pop-body">{children}</div>
      </div>
    </>,
    document.body,
  );
}

// ------------------------------------------------------------------------------------------------ the place

function PlacePicker({ scope, onPick }: { scope: Scope; onPick: (p: ScopePlace, label: string) => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const index = useSearchIndex(true);
  useRecentVersion();
  const listId = useId();
  // the search field takes the focus when the picker appears (in the phone sheet it replaces the button pressed)
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus({ preventScroll: true }); }, []);
  const hits = useMemo(() => (q.trim() ? searchAreas(q, 8, index) : []), [q, index]);
  const idle = useMemo(() => {
    if (q.trim() || !index) return [];
    const world = index.byKey.get('world:WORLD');
    const out: { key: string; kind: HitKind; label: string; hint: string; place: ScopePlace; hit?: SearchHit; group: string }[] = [];
    if (world) out.push({ key: 'world:WORLD', kind: 'world', label: 'World', hint: 'Every place', place: WORLD_PLACE, group: 'Start' });
    for (const r of recentPlaces(index)) {
      if (r.selection.type === 'polygon') continue;
      const place: ScopePlace = r.selection.type === 'circle'
        ? { type: 'circle', lat: r.selection.lat, lon: r.selection.lon, km: r.selection.radiusKm }
        : { type: 'named', kind: r.selection.area.kind, id: r.selection.area.id };
      if (out.some((o) => placeKey(o.place) === placeKey(place))) continue;
      out.push({ key: `r:${r.key}`, kind: r.kind, label: r.label, hint: r.hint, place, group: 'Recent' });
    }
    for (const k of SUGGEST) {
      const e = index.byKey.get(k);
      if (!e?.area || out.some((o) => o.key === k || o.key === `r:${k}`)) continue;
      out.push({ key: k, kind: e.kind, label: e.label, hint: e.hint, place: { type: 'named', kind: e.area.kind, id: e.area.id }, group: 'Places with much fire' });
    }
    const pky = index.entries.find((e) => e.city && e.label === 'Palangka Raya');
    if (pky?.city && !out.some((o) => o.label === 'Palangka Raya')) {
      out.push({ key: pky.key, kind: 'city', label: 'Palangka Raya', hint: `${CITY_RADIUS_KM} km around the city, Central Kalimantan`, group: 'Places with much fire',
        place: { type: 'circle', lat: pky.city.lat, lon: pky.city.lon, km: CITY_RADIUS_KM } });
    }
    return out;
  }, [q, index]);
  const items = q.trim()
    ? hits.map((h) => ({ key: h.key, kind: h.kind, label: h.label, hint: h.hint, place: placeOfHit(h), hit: h, group: '' }))
    : idle;
  useEffect(() => setActive(0), [q]);
  const pick = (i: number) => {
    const it = items[i];
    if (!it) return;
    if (it.hit) rememberPlace(it.hit);
    onPick(it.place, it.label);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(active); }
  };
  const current = placeKey(scope.place);
  let lastGroup = '';
  return (
    <div className="db-pick">
      <label className="db-pick-search">
        <IconSearch size={16} />
        <input ref={field} data-autofocus type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
          placeholder="Find a country, state or city" aria-label="Find a place" role="combobox" aria-expanded="true"
          aria-controls={listId} aria-activedescendant={items[active] ? `${listId}-${active}` : undefined} autoComplete="off" />
      </label>
      <ul className="db-pick-list" id={listId} role="listbox" aria-label="Places">
        {!index ? <li className="db-pick-empty"><span className="db-spin" aria-hidden="true" />Loading the places…</li> : null}
        {index && q.trim() && !items.length ? <li className="db-pick-empty">No place is called “{q.trim()}”. Try a country, a province or a city.</li> : null}
        {items.map((it, i) => {
          const head = it.group && it.group !== lastGroup ? it.group : null;
          lastGroup = it.group;
          const on = placeKey(it.place) === current;
          return [
            head ? <li key={`g:${head}`} className="db-pick-group" role="presentation">{head}</li> : null,
            <li key={it.key} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              className={i === active ? 'db-pick-item is-active' : 'db-pick-item'}
              onPointerMove={() => setActive(i)} onClick={() => pick(i)}>
              <span className="db-pick-icon" aria-hidden="true">{KIND_ICON[it.kind]}</span>
              <span className="db-pick-text">
                <span className="db-pick-label">
                  {it.hit ? markedParts(it.label, it.hit.marks).map((p, k) => (p.hit ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>)) : it.label}
                </span>
                <span className="db-pick-hint">{it.hint}</span>
              </span>
              <span className="db-pick-kind">{on ? <IconCheck size={16} /> : it.hint.startsWith(KIND_WORD[it.kind].split(',')[0]) ? null : KIND_WORD[it.kind]}</span>
            </li>,
          ];
        })}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the years

export interface YearBar { yr: number; value: number; complete: boolean }

function YearsPicker({ scope, lastYear, years, onChange }: { scope: Scope; lastYear: number; years: YearBar[]; onChange: (y: [number, number]) => void }) {
  const [a, b] = scope.years;
  const span = lastYear - FIRST_YEAR;
  const bars = useMemo(() => {
    const ys = years.filter((y) => y.yr >= FIRST_YEAR && y.yr <= lastYear);
    const max = Math.max(1, ...ys.map((y) => y.value));
    return Array.from({ length: span + 1 }, (_, i) => {
      const y = ys.find((x) => x.yr === FIRST_YEAR + i);
      return { yr: FIRST_YEAR + i, h: y ? y.value / max : 0, partial: y ? !y.complete : false };
    });
  }, [years, lastYear, span]);
  const presets: { label: string; y: [number, number] }[] = [
    { label: 'Whole record', y: [FIRST_YEAR, lastYear] },
    { label: 'MODIS years, 2001 to 2011', y: [FIRST_YEAR, 2011] },
    { label: 'VIIRS years, 2012 on', y: [2012, lastYear] },
    { label: 'Last 10 years', y: [lastYear - 9, lastYear] },
  ];
  const set = (x: number, y: number) => onChange(x <= y ? [x, y] : [y, x]);
  // Dragging is handled here, not by the two inputs (they stay for the keyboard and screen readers): a press moves the
  // nearer end, and when both ends sit on one year the first move decides which end follows, so a single year can
  // widen either way, even at the ends of the record.
  const box = useRef<HTMLDivElement>(null);
  const firstIn = useRef<HTMLInputElement>(null);
  const lastIn = useRef<HTMLInputElement>(null);
  const drag = useRef<{ id: number; end: 'a' | 'b' | null; from: number } | null>(null);
  const ab = useRef<[number, number]>([a, b]);
  ab.current = [a, b];
  const yearAt = (clientX: number): number => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return a;
    const f = (clientX - r.left - 9) / Math.max(1, r.width - 18);   // the thumbs' centres run 9 px inside each side
    return FIRST_YEAR + Math.round(Math.max(0, Math.min(1, f)) * span);
  };
  const moveEnd = (end: 'a' | 'b', yr: number) => {
    const [x, y] = ab.current;
    const next: [number, number] = end === 'a' ? [Math.min(yr, y), y] : [x, Math.max(yr, x)];
    if (next[0] !== x || next[1] !== y) { ab.current = next; onChange(next); }
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const yr = yearAt(e.clientX);
    const [x, y] = ab.current;
    let end: 'a' | 'b' | null;
    if (x === y) end = yr < x ? 'a' : yr > y ? 'b' : null;           // on the joined thumb: wait for the first move
    else end = Math.abs(yr - x) < Math.abs(yr - y) ? 'a' : Math.abs(yr - x) > Math.abs(yr - y) ? 'b' : yr < x ? 'a' : 'b';
    drag.current = { id: e.pointerId, end, from: yr };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer tracks */ }
    e.preventDefault();
    (end === 'b' ? lastIn : firstIn).current?.focus({ preventScroll: true });
    if (end) moveEnd(end, yr);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const yr = yearAt(e.clientX);
    if (!d.end) {
      if (yr === d.from) return;
      d.end = yr < d.from ? 'a' : 'b';
      (d.end === 'b' ? lastIn : firstIn).current?.focus({ preventScroll: true });
    }
    moveEnd(d.end, yr);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };
  return (
    <div className="db-years">
      <p className="db-pop-value"><span className="ui-mono">{yearsLabel(scope.years)}</span><span className="db-pop-note">{b - a + 1} {b === a ? 'year' : 'years'}</span></p>
      <div className="db-years-chart" aria-hidden="true">
        {bars.map((x) => (
          <span key={x.yr} className={x.yr >= a && x.yr <= b ? 'db-years-bar is-on' : 'db-years-bar'}
            style={{ '--h': Math.max(0.04, x.h) } as CSSProperties} data-partial={x.partial ? '' : undefined} />
        ))}
      </div>
      <div ref={box} className="db-years-range" style={{ '--a': (a - FIRST_YEAR) / span, '--b': (b - FIRST_YEAR) / span } as CSSProperties}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <span className="db-years-track" aria-hidden="true"><span className="db-years-fill" /></span>
        <input ref={firstIn} type="range" min={FIRST_YEAR} max={lastYear} step={1} value={a} aria-label="First year" aria-valuetext={String(a)}
          onChange={(e) => set(Math.min(Number(e.target.value), b), b)} />
        <input ref={lastIn} type="range" min={FIRST_YEAR} max={lastYear} step={1} value={b} aria-label="Last year" aria-valuetext={String(b)}
          onChange={(e) => set(a, Math.max(Number(e.target.value), a))} />
      </div>
      <div className="db-years-ends ui-mono" aria-hidden="true"><span>{FIRST_YEAR}</span><span>{lastYear}</span></div>
      <div className="db-pop-chips" role="group" aria-label="Ready made ranges">
        {presets.map((p) => (
          <button key={p.label} type="button" className="ui-chip" aria-pressed={p.y[0] === a && p.y[1] === b} onClick={() => onChange(p.y)}>{p.label}</button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the months

function MonthsPicker({ scope, view, normal, onChange }: {
  scope: Scope; view: ScopeView | null; normal: (number | null)[]; onChange: (m: [number, number] | null) => void;
}) {
  const [start, setStart] = useState<number | null>(null);
  const on = new Set(seasonMonths(scope.months));
  const max = Math.max(1, ...normal.map((v) => v ?? 0));
  const click = (mo: number) => {
    if (start === null) { setStart(mo); onChange([mo, mo]); return; }
    onChange([start, mo]);
    setStart(null);
  };
  const fire = view?.fireSeason ?? null;
  return (
    <div className="db-months-pick">
      <p className="db-pop-value">{seasonLabel(scope.months)}{wraps(scope.months) ? <span className="db-pop-note">across the new year</span> : null}</p>
      <div className="db-mstrip" role="group" aria-label="Months of each year">
        {Array.from({ length: 12 }, (_, i) => {
          const mo = i + 1;
          const v = normal[i] ?? 0;
          return (
            <button key={mo} type="button" className={start === mo ? 'db-mcell ui-press is-start' : 'db-mcell ui-press'} aria-pressed={scope.months !== null && on.has(mo)}
              aria-label={`${monthShort(mo)}, a normal month has ${count(v)} hotspots`} onClick={() => click(mo)}>
              <span className="db-mcell-bar" style={{ '--h': Math.max(0.05, v / max) } as CSSProperties} aria-hidden="true" />
              <span className="db-mcell-name">{monthShort(mo)}</span>
            </button>
          );
        })}
      </div>
      <p className="db-pop-help">{start === null ? 'Select a month, then another to make a season. A season can cross the new year.' : `Now select the last month of the season from ${monthShort(start)}.`}</p>
      <div className="db-pop-chips" role="group" aria-label="Ready made months">
        <button type="button" className="ui-chip" aria-pressed={scope.months === null} onClick={() => { setStart(null); onChange(null); }}>Every month</button>
        {fire ? (
          <button type="button" className="ui-chip" aria-pressed={scope.months?.[0] === fire[0] && scope.months?.[1] === fire[1]}
            onClick={() => { setStart(null); onChange(fire); }}>
            Usual fire season, {seasonLabel(fire, true)}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the scale

function ScalePicker({ scope, onChange }: { scope: Scope; onChange: (s: Scale) => void }) {
  const opts: Scale[] = ['harmonized', 'modis', 'raw'];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = opts.indexOf(scope.scale);
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const n = (i + step + opts.length) % opts.length;
    onChange(opts[n]);
    refs.current[n]?.focus();
  };
  return (
    <div className="ui-segmented db-scale">
      <div className="ui-segmented-options" role="radiogroup" aria-label="Scale" onKeyDown={onKey}>
        {opts.map((o, i) => (
          <Tooltip key={o} content={SCALE_WORDS[o].help}>
            <button ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={scope.scale === o} tabIndex={scope.scale === o ? 0 : -1}
              className="ui-segmented-option" onClick={() => onChange(o)}>
              {SCALE_WORDS[o].short}
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the bar

function ScopeButton({ refEl, icon, label, value, open, onClick, active }: {
  refEl: RefObject<HTMLButtonElement | null>; icon: ReactNode; label: string; value: string; open: boolean; onClick: () => void; active: boolean;
}) {
  return (
    <button ref={refEl} type="button" className={active ? 'db-scope-btn ui-press is-set' : 'db-scope-btn ui-press'} aria-haspopup="dialog" aria-expanded={open}
      onClick={onClick}>
      <span className="db-scope-icon" aria-hidden="true">{icon}</span>
      <span className="db-scope-text">
        <span className="db-scope-label">{label}</span>
        <span className="db-scope-value">{value}</span>
      </span>
      <IconChevronDown size={14} className="db-scope-chev" />
    </button>
  );
}

export interface ScopeBarProps {
  scope: Scope;
  lastYear: number;
  data: ScopeData;
  normal: (number | null)[];    // the place's normal year (medians), for the months picker
  years: YearBar[];             // the place's fire in each year (or season), for the years picker
  onChange: (s: Scope) => void;
  onReset: () => void;
  isDefault: boolean;
}

/** The summary of a scope in words, for screen readers and the phone button. */
export function scopeWords(s: Scope, name: string, lastYear: number): string {
  const yrs = s.years[0] === FIRST_YEAR && s.years[1] === lastYear ? 'the whole record' : yearsLabel(s.years);
  return `${name}, ${seasonLabel(s.months).toLowerCase()}, ${yrs}, ${SCALE_WORDS[s.scale].label.toLowerCase()}`;
}

export function ScopeBar({ scope, lastYear, data, normal, years, onChange, onReset, isDefault }: ScopeBarProps) {
  const [open, setOpen] = useState<Panel | null>(null);
  const refs = { place: useRef<HTMLButtonElement>(null), years: useRef<HTMLButtonElement>(null), months: useRef<HTMLButtonElement>(null), scale: useRef<HTMLButtonElement>(null) };
  const toggle = (p: Panel) => setOpen((o) => (o === p ? null : p));
  const close = () => setOpen(null);
  const allYears = scope.years[0] === FIRST_YEAR && scope.years[1] === lastYear;
  const status = data.error ? 'The numbers of this place could not be loaded'
    : data.loading ? (scope.place.type === 'circle' ? `Adding up the fire within ${scope.place.km} km…` : `Loading ${data.short}…`)
      : '';
  return (
    <div className="db-scope" role="group" aria-label="What the dashboard shows">
      <ScopeButton refEl={refs.place} icon={isWorld(scope.place) ? <IconGlobe size={16} /> : scope.place.type === 'circle' ? <IconTarget size={16} /> : <IconPolygon size={16} />}
        label={data.kindWord === 'World' ? 'Place' : data.kindWord} value={data.short} open={open === 'place'} onClick={() => toggle('place')} active={!isWorld(scope.place)} />
      <ScopeButton refEl={refs.years} icon={<IconCalendar size={16} />} label="Years" value={allYears ? `${FIRST_YEAR} to ${lastYear}` : yearsLabel(scope.years)}
        open={open === 'years'} onClick={() => toggle('years')} active={!allYears} />
      <ScopeButton refEl={refs.months} icon={<IconCalendar size={16} />} label="Months" value={seasonLabel(scope.months, true)}
        open={open === 'months'} onClick={() => toggle('months')} active={scope.months !== null} />
      <ScopeButton refEl={refs.scale} icon={<IconLayers size={16} />} label="Scale" value={SCALE_WORDS[scope.scale].short}
        open={open === 'scale'} onClick={() => toggle('scale')} active={scope.scale !== 'harmonized'} />
      <span className="db-scope-status" role="status" aria-live="polite">
        {status ? <><span className="db-spin" aria-hidden="true" />{status}</> : <span className="db-scope-hint">Every chart that can follow this view does</span>}
      </span>
      {!isDefault ? (
        <Tooltip content="Back to the whole world, every month and year, harmonized">
          <button type="button" className="ui-btn ui-btn-ghost db-scope-reset" onClick={onReset}>Reset</button>
        </Tooltip>
      ) : null}

      <Pop anchor={refs.place} open={open === 'place'} onClose={close} label="Choose a place">
        <PlacePicker scope={scope} onPick={(p) => { close(); onChange({ ...scope, place: p }); refs.place.current?.focus({ preventScroll: true }); }} />
      </Pop>
      <Pop anchor={refs.years} open={open === 'years'} onClose={close} label="Choose the years" wide>
        <YearsPicker scope={scope} lastYear={lastYear} years={years} onChange={(y) => onChange({ ...scope, years: y })} />
      </Pop>
      <Pop anchor={refs.months} open={open === 'months'} onClose={close} label="Choose the months" wide>
        <MonthsPicker scope={scope} view={data.view} normal={normal} onChange={(m) => onChange({ ...scope, months: m })} />
      </Pop>
      <Pop anchor={refs.scale} open={open === 'scale'} onClose={close} label="Choose the scale">
        <div className="db-scale-pick">
          <ScalePicker scope={scope} onChange={(s) => onChange({ ...scope, scale: s })} />
          <p className="db-pop-help">{SCALE_WORDS[scope.scale].help}.</p>
        </div>
      </Pop>
    </div>
  );
}

/** The same four controls stacked in one sheet, for the phone's pinned bar. */
export function ScopeSheet({ open, onClose, anchor, ...p }: ScopeBarProps & { open: boolean; onClose: () => void; anchor: RefObject<HTMLElement | null> }) {
  const [placeOpen, setPlaceOpen] = useState(false);
  useEffect(() => { if (!open) setPlaceOpen(false); }, [open]);
  // after a place is picked the focus goes back to the place button (the picker that had it is gone)
  const placeBtn = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (placeOpen || !refocus.current) return;
    refocus.current = false;
    placeBtn.current?.focus({ preventScroll: true });
  }, [placeOpen]);
  const { scope, data, lastYear, onChange } = p;
  return (
    <Pop anchor={anchor} open={open} onClose={onClose} label="What the dashboard shows" wide>
      <div className="db-sheet">
        <section className="db-sheet-part" aria-label="Place">
          <p className="db-sheet-title">Place</p>
          {placeOpen ? (
            <PlacePicker scope={scope} onPick={(pl) => { refocus.current = true; setPlaceOpen(false); onChange({ ...scope, place: pl }); }} />
          ) : (
            <button ref={placeBtn} type="button" className="db-sheet-place ui-press" onClick={() => setPlaceOpen(true)} data-autofocus>
              <span className="db-pick-icon" aria-hidden="true">{scope.place.type === 'circle' ? <IconTarget size={16} /> : <IconGlobe size={16} />}</span>
              <span className="db-pick-text"><span className="db-pick-label">{data.name}</span><span className="db-pick-hint">Select to find another place</span></span>
              <IconChevronDown size={16} />
            </button>
          )}
        </section>
        <section className="db-sheet-part" aria-label="Years">
          <p className="db-sheet-title">Years</p>
          <YearsPicker scope={scope} lastYear={lastYear} years={p.years} onChange={(y) => onChange({ ...scope, years: y })} />
        </section>
        <section className="db-sheet-part" aria-label="Months">
          <p className="db-sheet-title">Months</p>
          <MonthsPicker scope={scope} view={data.view} normal={p.normal} onChange={(m) => onChange({ ...scope, months: m })} />
        </section>
        <section className="db-sheet-part" aria-label="Scale">
          <p className="db-sheet-title">Scale</p>
          <ScalePicker scope={scope} onChange={(s) => onChange({ ...scope, scale: s })} />
        </section>
        <div className="db-sheet-foot">
          {!p.isDefault ? <button type="button" className="ui-btn ui-btn-ghost" onClick={p.onReset}>Reset</button> : <span />}
          <button type="button" className="ui-btn ui-btn-primary" onClick={onClose}>Show the numbers</button>
        </div>
      </div>
    </Pop>
  );
}

/** How many parts of the scope differ from the default (the badge on the phone's button). */
export function scopeChanges(s: Scope, lastYear: number): number {
  return [!isWorld(s.place), s.years[0] !== FIRST_YEAR || s.years[1] !== lastYear, s.months !== null, s.scale !== 'harmonized'].filter(Boolean).length;
}

export { reduceMotion };
