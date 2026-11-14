// Pick an area: search a place or a city (type ahead, arrow keys, Enter), draw a rectangle or a polygon on the map,
// give a circle by latitude, longitude and radius, or go back to the whole world. The search is the app's one place
// search (lib/search.ts, the same as the command palette): the matched letters in bold, islands and common names
// ("Borneo", "USA"), cities (a circle of 50 km around them), coordinates ("-2.2, 113.9") and recent places.
import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactElement,
} from 'react';
import type { AreaSelection, NamedArea } from '../lib/types.ts';
import { useI18n } from '../lib/i18n.ts';
import {
  CITY_RADIUS_KM, areaLink, markedParts, parseCoords, pointHit, recentPlaces, rememberPlace, searchAreas,
  useFittingPlaceholder, useRecentVersion, useSearchIndex, type HitKind, type PlacePick, type SearchHit,
} from '../lib/search.ts';
import { runCommand } from '../lib/commands.ts';
import { count, monthName, num } from './pages/format.ts';
import { IconAlert, IconCalendar, IconCircle, IconClose, IconFlame, IconGlobe, IconPolygon, IconSearch, IconSquare, IconTarget } from './icons';
import { Tooltip } from './Tooltip';
import '../styles/palette.css';

export type DrawMode = 'none' | 'rectangle' | 'polygon';

export interface AreaPickerProps {
  areas: readonly NamedArea[] | null;   // null while loading
  areasError: string | null;
  selection: AreaSelection;
  drawMode: DrawMode;
  onSelect: (selection: AreaSelection) => void;
  onDrawMode: (mode: DrawMode) => void;
}

const MAX_RESULTS = 12;
const MAX_RADIUS_KM = 2000;
const RECENT_SHOWN = 3;
/** The least height of the list of places (its head and two options), however little room there is below the box. */
const SUGGEST_MIN_PX = 140;
const PLACEHOLDERS = ['Find a country, state or city', 'Find a place or city', 'Find a place'];
/** The words of the list's head (the way out of the list on a touch screen) and of the suggestions. */
const T = {
  start: 'Suggestions',
  startGroups: 'Recent and suggested',
  found: (n: number) => (n === 1 ? '1 place' : `${n} places`),
  close: 'Close the list',
  closeShort: 'Close',
  groups: { recent: 'Recent', near: 'Near me', hot: 'Far above normal now', most: 'Most fire', try: 'Try' },
  near: 'Fire near me',
  nearHint: `${CITY_RADIUS_KM} km around where you are`,
  nearWait: 'Finding where you are…',
  nearFailed: 'Your location is not available. Search a city instead.',
  hot: (p: PlacePick) => `${p.ratio !== null ? num(p.ratio, 1) : ''} times normal${p.ym ? ` in ${monthName(p.ym)}` : ''}`,
  most: (p: PlacePick) => `${count(p.perYear)} hotspots a year`,
  tryLabel: 'Borneo, September 2015',
  tryHint: 'The great fires of 2015 in Central Kalimantan',
};
/** The try row: Central Kalimantan in September 2015. */
const TRY_AREA = { kind: 'state', id: 'IDN-1931', ym: 201509 } as const;
const ICON: Record<HitKind, ReactElement> = {
  world: <IconGlobe />, continent: <IconGlobe />, country: <IconGlobe />, state: <IconPolygon />, city: <IconTarget />, point: <IconCircle />,
};

/** One row of the list: a search result, a recent place or a suggestion (`run`: a row that does more than open a place;
 *  `icon`: its own icon). */
type Option = Pick<SearchHit, 'key' | 'kind' | 'label' | 'hint' | 'link' | 'selection'> & {
  marks: [number, number][]; group: string | null; run?: () => void; icon?: ReactElement;
};

const fromHit = (h: SearchHit, group: string | null = null): Option => ({ ...h, group });

/** A suggested place, from the place list (so it opens with all its facts). */
function picked(p: PlacePick, areas: ReadonlyMap<string, NamedArea>, group: string, hint: string): Option | null {
  const a = areas.get(`${p.kind}:${p.id}`);
  if (!a) return null;
  return { key: `${p.kind}:${p.id}`, kind: a.kind, label: a.name || a.id, hint, link: areaLink(a.kind, a.id),
    selection: { type: 'named', area: a }, marks: [], group, icon: group === T.groups.hot ? <IconFlame /> : undefined };
}

type Locating = 'idle' | 'asking' | 'denied';

/** Geolocation can be offered: the browser has it, and the user has not refused it (Permissions API, where known). */
function useGeoAllowed(): [boolean, (v: boolean) => void] {
  const [allowed, setAllowed] = useState(() => typeof navigator !== 'undefined' && 'geolocation' in navigator && window.isSecureContext !== false);
  useEffect(() => {
    if (!allowed || !navigator.permissions?.query) return undefined;
    let status: PermissionStatus | null = null;
    const onChange = () => { if (status) setAllowed(status.state !== 'denied'); };
    navigator.permissions.query({ name: 'geolocation' as PermissionName }).then((s) => { status = s; onChange(); s.addEventListener('change', onChange); },
      () => undefined);
    return () => status?.removeEventListener('change', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [allowed, setAllowed];
}

/** The list's room cut to whole rows (a row with its group title), so the last row shown is never cut in half; the
 *  fade at its foot (data-more) says that more rows follow. `cap`: the most room, in px, for the head and the list. */
function wholeRows(box: HTMLElement, cap: number): number {
  const list = box.querySelector<HTMLElement>('.fh-listbox');
  if (!list) return cap;
  // Layout offsets, not screen boxes: the list rises in with a small scale (ui-rise), and a box measured during
  // that animation would be a few px short, which cuts the last row. The rows and the list share the box as their
  // offset parent (it is positioned); offsetTop ignores the list's own scroll.
  const rows = [...list.children] as HTMLElement[];
  if (list.offsetParent !== box || rows.some((li) => li.offsetParent !== box)) return cap;
  const frame = list.offsetTop + (box.offsetHeight - box.clientHeight);   // the head above the list, and the borders
  const cs = getComputedStyle(list);
  const padTop = parseFloat(cs.paddingTop) || 0, padBottom = parseFloat(cs.paddingBottom) || 0;
  const room = cap - frame - padBottom;
  let fit = padTop;
  for (const li of rows) {
    const end = li.offsetTop - list.offsetTop + li.offsetHeight;
    if (end > room + 0.5) break;
    fit = end;
  }
  return Math.ceil(frame + fit + padBottom);
}

/** On a phone the panel sits under the map: the search box moves up to just under the header, so its list of places
 *  has room (and the keyboard does not cover it). */
function liftOnPhone(row: HTMLElement | null): void {
  if (!row || !window.matchMedia('(max-width: 768px)').matches) return;
  requestAnimationFrame(() => {
    const header = document.querySelector<HTMLElement>('.fh-header');
    const under = header && /^(sticky|fixed)$/.test(getComputedStyle(header).position) ? header.getBoundingClientRect().bottom : 0;
    const at = row.getBoundingClientRect().top;
    const top = at - Math.max(0, under) - 12;       // how far to scroll: negative when the box is under the header
    const fine = top >= 0 && at < window.innerHeight * 0.3;
    if (fine || Math.abs(top) < 4) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollBy({ top, behavior: still ? 'auto' : 'smooth' });
  });
}

function Marked({ text, marks }: { text: string; marks: readonly [number, number][] }) {
  if (!marks.length) return <>{text}</>;
  return <>{markedParts(text, marks).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</>;
}

export function AreaPicker({ areas, areasError, selection, drawMode, onSelect, onDrawMode }: AreaPickerProps) {
  const { t } = useI18n();
  const uid = useId();
  const inputId = `${uid}search`;
  const listId = `${uid}list`;
  const formId = `${uid}circle`;

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [circleOpen, setCircleOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const suggestRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const circleButtonRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const placeholder = useFittingPlaceholder(inputRef, PLACEHOLDERS);

  // the place list loads with the Explorer; the fire sizes and the cities come the first time the box is used
  const index = useSearchIndex(open || query !== '');
  const recentVersion = useRecentVersion();
  const typed = query.trim() !== '';
  const [geoAllowed, setGeoAllowed] = useGeoAllowed();
  const [locating, setLocating] = useState<Locating>('idle');
  const locate = () => {
    setLocating('asking');
    navigator.geolocation.getCurrentPosition((pos) => {
      setLocating('idle');
      const lat = Math.round(pos.coords.latitude * 1e4) / 1e4, lon = Math.round(pos.coords.longitude * 1e4) / 1e4;
      const hit = pointHit(lat, lon, CITY_RADIUS_KM, index);
      rememberPlace(hit);
      onSelect(hit.selection);
      setOpen(false);
      setActive(-1);
      inputRef.current?.blur();
    }, () => { setLocating('denied'); setGeoAllowed(false); }, { maximumAge: 600_000, timeout: 15_000 });
  };
  // An empty box suggests: the recent places, fire near me, the places far above their normal now and those with the
  // most fire (web/places.json), and one view to try. Never a continent: Antarctica and the open ocean have no fire.
  const suggestions = useMemo<Option[]>(() => {
    const out: Option[] = recentPlaces(index).slice(0, RECENT_SHOWN).map((r) => ({ ...r, marks: [] as [number, number][], group: T.groups.recent }));
    const has = (key: string) => out.some((o) => o.key === key);
    if (geoAllowed) {
      out.push({ key: 'near-me', kind: 'point', label: T.near, hint: locating === 'asking' ? T.nearWait : T.nearHint,
        link: '', selection: { type: 'circle', lat: 0, lon: 0, radiusKm: CITY_RADIUS_KM }, marks: [], group: T.groups.near,
        icon: <IconTarget />, run: locate });
    }
    const byKey = new Map((areas ?? []).map((a) => [`${a.kind}:${a.id}`, a]));
    for (const p of index?.picks?.hot ?? []) { const o = picked(p, byKey, T.groups.hot, T.hot(p)); if (o && !has(o.key)) out.push(o); }
    for (const p of index?.picks?.most ?? []) { const o = picked(p, byKey, T.groups.most, T.most(p)); if (o && !has(o.key)) out.push(o); }
    const tryArea = byKey.get(`${TRY_AREA.kind}:${TRY_AREA.id}`);
    if (tryArea) {
      out.push({ key: 'try-borneo-2015', kind: 'state', label: T.tryLabel, hint: T.tryHint, link: `${areaLink(TRY_AREA.kind, TRY_AREA.id)}&month=${TRY_AREA.ym}`,
        selection: { type: 'named', area: tryArea }, marks: [], group: T.groups.try, icon: <IconCalendar />,
        run: () => { onSelect({ type: 'named', area: tryArea }); runCommand({ action: 'set-month', ym: TRY_AREA.ym }); } });
    }
    return out;
    // recentVersion: a pick here, in the palette or in another tab changes the recent places
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas, index, recentVersion, geoAllowed, locating]);
  const options = useMemo<Option[]>(() => {
    if (!typed) return suggestions;
    const coords = parseCoords(query);
    const hits = searchAreas(query, MAX_RESULTS, index).map((h) => fromHit(h));
    return coords ? [fromHit(pointHit(coords.lat, coords.lon, 50, index)), ...hits].slice(0, MAX_RESULTS) : hits;
  }, [typed, query, index, suggestions]);
  const grouped = !typed && options.some((o) => o.group !== null);
  const hasRecent = !typed && options.some((o) => o.group === T.groups.recent);
  const activeIndex = active < options.length ? active : -1;
  const listOpen = open && options.length > 0;

  useEffect(() => {
    if (!listOpen || activeIndex < 0) return;
    document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [listOpen, activeIndex, listId]);

  // The list never runs off the screen (a small phone, a phone with its keyboard up, a short window): it takes the
  // room from its top to the bottom of what is visible. Measured again while the sheet or the page moves under it.
  useLayoutEffect(() => {
    const box = suggestRef.current;
    if (!listOpen || !box) return undefined;
    let frame = 0;
    let until = performance.now() + 700;          // the phone sheet may still glide to its new size
    const list = box.querySelector<HTMLElement>('.fh-listbox');
    const more = () => { if (list) list.toggleAttribute('data-more', list.scrollTop + list.clientHeight < list.scrollHeight - 2); };
    const fit = () => {
      const vv = window.visualViewport;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      // (the box's layout top: its offset parent's top and its offset, which the rise animation does not move)
      const parent = box.offsetParent instanceof HTMLElement ? box.offsetParent : null;
      const top = parent ? parent.getBoundingClientRect().top + parent.clientTop + box.offsetTop : box.getBoundingClientRect().top;
      const room = Math.floor(bottom - top - 8);
      // the same caps as the style sheet (400 px, 56% of the window), then whole rows
      const cap = Math.min(400, window.innerHeight * 0.56, Math.max(SUGGEST_MIN_PX, room));
      const want = wholeRows(box, cap);
      box.style.setProperty('--fh-suggest-room', `${want}px`);
      // a cap of the style sheet that ended lower than asked (another rule): whole rows of what it got (its layout
      // height, which the rise animation's scale does not change)
      const got = box.offsetHeight;
      if (got < want - 1) box.style.setProperty('--fh-suggest-room', `${wholeRows(box, got)}px`);
      more();
    };
    const settle = () => { fit(); if (performance.now() < until) frame = requestAnimationFrame(settle); };
    const again = (event?: Event) => {
      if (event?.type === 'scroll' && event.target instanceof Node && box.contains(event.target)) return;   // the list's own scroll
      until = performance.now() + 300;
      cancelAnimationFrame(frame);
      settle();
    };
    settle();
    const vv = window.visualViewport;
    list?.addEventListener('scroll', more, { passive: true });
    // a row that grows (a hint on two lines once the fonts are in, a new hint text) moves the cut: fit again
    const rows = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => again());
    if (list && rows) for (const li of list.children) rows.observe(li);
    // (and the head above the list: once its fonts are in it may grow a few px and push the rows down)
    const head = box.querySelector<HTMLElement>('.fh-suggest-head');
    if (head && rows) rows.observe(head);
    let live = true;
    document.fonts?.ready.then(() => { if (live) again(); }, () => undefined);
    window.addEventListener('resize', again);
    document.addEventListener('scroll', again, true);
    vv?.addEventListener('resize', again);
    vv?.addEventListener('scroll', again);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      rows?.disconnect();
      list?.removeEventListener('scroll', more);
      window.removeEventListener('resize', again);
      document.removeEventListener('scroll', again, true);
      vv?.removeEventListener('resize', again);
      vv?.removeEventListener('scroll', again);
    };
  }, [listOpen, options]);

  // While drawing, Escape cancels from anywhere on the page.
  useEffect(() => {
    if (drawMode === 'none') return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      // (not when the Escape already closed something first, such as an open map card)
      if (event.key === 'Escape' && !event.defaultPrevented) onDrawMode('none');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawMode, onDrawMode]);

  const choose = (option: Option) => {
    if (option.run) {
      option.run();
      if (option.key === 'near-me') return;   // the list stays while the browser finds the place
    } else {
      rememberPlace(option);
      onSelect(option.selection);
    }
    setQuery('');
    setOpen(false);
    setActive(-1);
    // the search is done: the keys work the map again (R for the trend, Space to play) and a phone's keyboard goes down
    inputRef.current?.blur();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const n = options.length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setOpen(true);
        if (n > 0) setActive(open ? (activeIndex + 1) % n : 0);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setOpen(true);
        if (n > 0) setActive(activeIndex <= 0 ? n - 1 : activeIndex - 1);
        break;
      case 'Enter': {
        const pick = listOpen ? options[activeIndex >= 0 ? activeIndex : 0] : undefined;
        if (pick) {
          event.preventDefault();
          choose(pick);
        }
        break;
      }
      case 'Escape':
        if (open) {
          event.preventDefault();
          setOpen(false);
          setActive(-1);
        } else if (query !== '') {
          event.preventDefault();
          setQuery('');
        }
        break;
      default:
        break;
    }
  };

  let note: string | null = null;
  if (areasError !== null) note = t.picker.placesError;
  else if (areas === null || (typed && index === null)) note = t.picker.loadingPlaces;
  else if (typed && options.length === 0) note = 'No place matches. Try a city, an island like Borneo, or coordinates like -2.2, 113.9.';
  else if (!typed && locating === 'denied') note = T.nearFailed;

  const closeList = () => { setOpen(false); setActive(-1); };
  // a tool closes the list of places first (on a touch screen the box keeps no focus to lose)
  const toggleDraw = (mode: Exclude<DrawMode, 'none'>) => {
    closeList();
    setCircleOpen(false);
    onDrawMode(drawMode === mode ? 'none' : mode);
  };
  const toggleCircle = () => {
    closeList();
    if (drawMode !== 'none') onDrawMode('none');
    setCircleOpen((wasOpen) => !wasOpen);
  };
  const closeCircle = () => {
    setCircleOpen(false);
    circleButtonRef.current?.focus();
  };
  const world = areas?.find((a) => a.kind === 'world') ?? null;
  const atWorld = selection.type === 'named' && selection.area.kind === 'world';

  return (
    <div className="fh-picker">
      <label className="sr-only" htmlFor={inputId}>{t.picker.search}</label>
      <div className="fh-picker-row" ref={rowRef}>
      <div className="fh-search">
        <IconSearch size={17} className="fh-search-icon" />
        <input
          id={inputId}
          ref={inputRef}
          className="fh-input fh-search-input"
          type="text"
          role="combobox"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder={placeholder}
          value={query}
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={listOpen && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => { setOpen(true); liftOnPhone(rowRef.current); }}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
        />
        {query !== '' ? (
          <Tooltip content={t.picker.clear}>
            <button type="button" className="fh-search-clear ui-btn ui-btn-ghost ui-btn-icon" aria-label={t.picker.clear}
              onMouseDown={(e) => e.preventDefault()} onClick={() => { setQuery(''); setActive(-1); inputRef.current?.focus(); }}>
              <IconClose size={15} />
            </button>
          </Tooltip>
        ) : null}
      </div>
        <Tooltip content={t.picker.worldTitle}>
          <button type="button" className="ui-chip" aria-pressed={atWorld} disabled={!world}
            onClick={() => { if (world) { closeList(); onDrawMode('none'); setCircleOpen(false); onSelect({ type: 'named', area: world }); } }}>
            <IconGlobe size={16} />{t.ex.tools.world}
          </button>
        </Tooltip>
        {/* the list spans the whole row (under the World chip too), so names fit on one line; its head says what it
            holds and closes it (the way out on a touch screen, where there is no Escape key) */}
        <div className="fh-suggest" ref={suggestRef} hidden={!listOpen}>
        <div className="fh-suggest-head">
          <span className="fh-suggest-what" aria-hidden="true">{typed ? T.found(options.length) : hasRecent ? T.startGroups : T.start}</span>
          <Tooltip content={T.close} keys={['Esc']}>
            <button type="button" className="ui-btn ui-btn-ghost fh-suggest-close" aria-label={T.close}
              onMouseDown={(e) => e.preventDefault()} onClick={() => { closeList(); inputRef.current?.blur(); }}>
              <IconClose size={14} /><span>{T.closeShort}</span>
            </button>
          </Tooltip>
        </div>
        <ul
          id={listId}
          ref={listRef}
          className={`fh-listbox${grouped ? ' fh-listbox-groups' : ''}`}
          role="listbox"
          aria-label={typed ? t.picker.search : t.picker.suggestions}
          hidden={!listOpen}
        >
          {options.map((option, i) => {
            const head = grouped && option.group && option.group !== options[i - 1]?.group ? option.group : null;
            return (
              <li key={`${option.group ?? ''}${option.key}`} role="presentation">
                {head ? <div className="fh-group-title" role="presentation">{head}</div> : null}
                <div
                  id={`${listId}-${i}`}
                  className="fh-option"
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => { if (i !== activeIndex) setActive(i); }}
                  onClick={() => choose(option)}
                >
                  <span className="fh-option-icon" aria-hidden="true">{option.icon ?? ICON[option.kind]}</span>
                  <span className="fh-option-text">
                    <span className="fh-option-name"><Marked text={option.label} marks={option.marks} /></span>
                    <span className="fh-option-kind">{option.hint}</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        </div>
        {open && note !== null ? <div className="fh-search-note" role="status">{note}</div> : null}
        <span className="sr-only" aria-live="polite">
          {open && typed && options.length > 0 ? t.picker.results(options.length) : ''}
        </span>
      </div>

      <div className="fh-picker-tools" role="group" aria-label={t.ex.tools.label}>
        <Tooltip content={t.picker.drawRectangle}>
          <button type="button" className="ui-chip" aria-pressed={drawMode === 'rectangle'} onClick={() => toggleDraw('rectangle')}>
            <IconSquare size={16} />{t.ex.tools.rectangle}
          </button>
        </Tooltip>
        <Tooltip content={t.picker.drawPolygon}>
          <button type="button" className="ui-chip" aria-pressed={drawMode === 'polygon'} onClick={() => toggleDraw('polygon')}>
            <IconPolygon size={16} />{t.ex.tools.polygon}
          </button>
        </Tooltip>
        <Tooltip content={t.picker.circleTitle}>
          <button ref={circleButtonRef} type="button" className="ui-chip" aria-expanded={circleOpen} aria-controls={formId}
            aria-pressed={circleOpen || selection.type === 'circle'} onClick={toggleCircle}>
            <IconCircle size={16} />{t.ex.tools.circle}
          </button>
        </Tooltip>
      </div>

      {circleOpen ? (
        <CircleForm
          id={formId}
          start={circleStart(selection)}
          onSubmit={(circle) => {
            onSelect(circle);
            closeCircle();
          }}
          onClose={closeCircle}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------- lat / lon + radius

interface CircleFields { lat: string; lon: string; radius: string }
type CircleSelection = Extract<AreaSelection, { type: 'circle' }>;
type FieldName = keyof CircleFields;

function circleStart(sel: AreaSelection): CircleFields {
  if (sel.type === 'circle') return { lat: String(sel.lat), lon: String(sel.lon), radius: String(sel.radiusKm) };
  if (sel.type === 'named' && sel.area.kind !== 'world') {
    return { lat: sel.area.lat.toFixed(2), lon: sel.area.lon.toFixed(2), radius: '50' };
  }
  return { lat: '', lon: '', radius: '50' };
}

/** Accepts "3.5", "3,5", "−3.5" (Unicode minus). NaN when empty or not a number. */
function parseNumber(text: string): number {
  const clean = text.trim().replace(/−/g, '-').replace(',', '.');
  return clean === '' ? Number.NaN : Number(clean);
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

interface CircleFormProps {
  id: string;
  start: CircleFields;
  onSubmit: (circle: CircleSelection) => void;
  onClose: () => void;
}

function CircleForm({ id, start, onSubmit, onClose }: CircleFormProps) {
  const { t } = useI18n();
  const [fields, setFields] = useState<CircleFields>(start);
  const [invalid, setInvalid] = useState<readonly FieldName[]>([]);
  const refs = {
    lat: useRef<HTMLInputElement>(null),
    lon: useRef<HTMLInputElement>(null),
    radius: useRef<HTMLInputElement>(null),
  };
  const firstRef = refs.lat;

  useEffect(() => {
    firstRef.current?.focus();
  }, [firstRef]);

  const messages: Record<FieldName, string> = { lat: t.picker.latError, lon: t.picker.lonError, radius: t.picker.radiusError };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const lat = parseNumber(fields.lat);
    const lon = parseNumber(fields.lon);
    const radiusKm = parseNumber(fields.radius);
    const bad: FieldName[] = [];
    if (!inRange(lat, -90, 90)) bad.push('lat');
    if (!inRange(lon, -180, 180)) bad.push('lon');
    if (!inRange(radiusKm, 1, MAX_RADIUS_KM)) bad.push('radius');
    setInvalid(bad);
    const first = bad[0];
    if (first !== undefined) {
      refs[first].current?.focus();
      return;
    }
    onSubmit({ type: 'circle', lat, lon, radiusKm });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  const field = (name: FieldName, label: string) => (
    <div className="fh-field">
      <label htmlFor={`${id}-${name}`}>{label}</label>
      <input
        id={`${id}-${name}`}
        ref={refs[name]}
        className="fh-input ui-mono"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={fields[name]}
        aria-invalid={invalid.includes(name)}
        aria-describedby={invalid.includes(name) ? `${id}-${name}-error` : `${id}-help`}
        onChange={(event) => {
          const value = event.target.value;
          setFields((old) => ({ ...old, [name]: value }));
        }}
      />
    </div>
  );

  return (
    <form id={id} className="fh-circle-form" onSubmit={submit} onKeyDown={onKeyDown} noValidate aria-label={t.picker.circleTitle}>
      <p id={`${id}-help`} className="fh-form-help">{t.picker.latLonHelp}</p>
      <div className="fh-circle-fields">
        {field('lat', t.picker.latitude)}
        {field('lon', t.picker.longitude)}
        {field('radius', t.picker.radius)}
      </div>
      <div className="fh-circle-actions">
        <button type="submit" className="ui-btn ui-btn-primary">{t.picker.show}</button>
        <button type="button" className="ui-btn ui-btn-ghost" onClick={onClose}>{t.picker.close}</button>
      </div>
      <ul className="fh-form-errors" aria-live="polite">
        {invalid.map((name) => (
          <li key={name} id={`${id}-${name}-error`}>
            <IconAlert />
            <span><strong>{t.common.errorTitle}:</strong> {messages[name]}</span>
          </li>
        ))}
      </ul>
    </form>
  );
}

