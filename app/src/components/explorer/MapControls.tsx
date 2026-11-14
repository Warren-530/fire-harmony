// The map's own controls, top right over the map, folded so they never hide the map: a glass pill that opens the map
// settings (colour, scale, 3D) and a legend chip that opens the full legend (on phones the chip sits top left). A card
// closes on Escape, a tap or click anywhere outside it (a tap on the map then does not also pick a hexagon), a second
// press, or when a drawing starts. Only one card is open at a time. The open card's width is reported, so the camera
// can keep the selected area clear of it. A card opened during a drawing never covers the drawing bar: the bar moves
// left of the card when there is room, else the card opens under the bar. In a short window a card's body scrolls,
// with a fade at the edge that has more.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useI18n } from '../../lib/i18n';
import type { MapMode, Scale } from '../../lib/types';
import { MapLegend, TrendKey, legendRange, legendShort, rampFills } from '../Legend';
import type { DrawMode, ViewMode } from '../MapView';
import { Segmented } from '../ui';
import { Tooltip } from '../Tooltip';
import { IconActivity, IconChevronDown, IconClose, IconCube, IconExternal, IconFlame, IconLayers } from '../icons';
import { firmsUrl } from '../../lib/hotspots';
import { loadTrend, peekTrend, type Level, type TrendLayer } from './mapData';

// whether the latest press on the map closed a card: the click that follows it then only closes the card
let pressClosed = false;
/** True for a click on the map that only closed a map card (MapView skips picking a hexagon for it). */
export const justDismissed = (): boolean => pressClosed;

/** Whether a modal (a dialog, the palette) is open. A closed <dialog> left in the page does not count. */
const modalOpen = (): boolean => [...document.querySelectorAll('[aria-modal="true"], dialog[open]')]
  .some((d) => !(d instanceof HTMLDialogElement) || d.open);

export interface MapControlsProps {
  mode: MapMode;
  scale: Scale;
  view: ViewMode;
  level: Level;
  drawMode: DrawMode;
  onMode(mode: MapMode): void;
  onScale(scale: Scale): void;
  onView(view: ViewMode): void;
  /** The hotspots are drawn as dots (city zoom): the legend says what a dot is. */
  dots?: boolean;
  /** Where the map is (for the link to NASA FIRMS at the same place). */
  camera?: { lat: number; lon: number; zoom: number } | null;
  /** The width of the open card in px (0 when both are closed), and which card it is. */
  onOpenChange?(width: number, card: 'none' | 'settings' | 'legend'): void;
}

type Open = 'none' | 'settings' | 'legend';
const MODES: readonly MapMode[] = ['count', 'anomaly', 'trend'];
const MODE_ICON: Record<MapMode, ReactElement> = {
  count: <IconFlame size={18} />, anomaly: <IconLayers size={18} />, trend: <IconActivity size={18} />,
};

/** A small ramp of the mode's colours (the legend chip and the colour choices). */
function Ramp({ mode, className }: { mode: MapMode; className: string }) {
  return (
    <span className={className} aria-hidden="true">
      {rampFills(mode).map((f, i) => <span key={i} style={{ background: f }} />)}
    </span>
  );
}

/** A card's scrolling body: fades at the top or bottom edge while there is more to see there. */
function useScrollFade(ref: { current: HTMLElement | null }): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => {
      const top = el.scrollTop > 2, more = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
      const v = `${top ? 't' : ''}${more ? 'b' : ''}`;
      if (v) el.dataset.fade = v; else delete el.dataset.fade;
    };
    set();
    el.addEventListener('scroll', set, { passive: true });
    const ro = new ResizeObserver(set);
    ro.observe(el);
    for (const k of el.children) ro.observe(k);
    // (the content changes with the colour mode: the trend's legend is longer)
    const mo = new MutationObserver(set);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => { el.removeEventListener('scroll', set); ro.disconnect(); mo.disconnect(); };
  }, [ref]);
}

export function MapControls(props: MapControlsProps) {
  const { mode, scale, view, level, drawMode, onMode, onScale, onView, dots = false, camera = null } = props;
  const { t } = useI18n();
  const m = t.ex.map, x = t.exMap;
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [open, setOpen] = useState<Open>('none');
  const root = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const settingsCard = useRef<HTMLDivElement>(null);
  const legendCard = useRef<HTMLDivElement>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const settingsBody = useRef<HTMLDivElement>(null);
  const legendBody = useRef<HTMLDivElement>(null);
  useScrollFade(settingsBody);
  useScrollFade(legendBody);
  const three = view === '3d';
  const cb = useRef(props);
  useLayoutEffect(() => { cb.current = props; });

  // the trend map of the level, for the counts in its legend (the same file MapView loads)
  const [trend, setTrend] = useState<TrendLayer | null>(() => peekTrend(level));
  useEffect(() => {
    if (mode !== 'trend') return undefined;
    let alive = true;
    setTrend(peekTrend(level));
    loadTrend(level).then((tr) => { if (alive) setTrend(tr); }, () => undefined);
    return () => { alive = false; };
  }, [mode, level]);

  // the map's height, so a card never runs past it (explorer.css: --ex-stage-h)
  useEffect(() => {
    const el = root.current, stage = el?.parentElement;
    if (!el || !stage) return undefined;
    const ro = new ResizeObserver(() => el.style.setProperty('--ex-stage-h', `${Math.round(stage.getBoundingClientRect().height)}px`));
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  // a drawing needs the whole map: close any card
  useEffect(() => { if (drawMode !== 'none') setOpen('none'); }, [drawMode]);

  // every press on the map notes whether a card was open (read by MapView's click, which comes after the press)
  const openRef = useRef<Open>('none');
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => {
    const onPress = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('.fh-ex-map-canvas')) pressClosed = openRef.current !== 'none';
    };
    window.addEventListener('pointerdown', onPress, true);
    return () => window.removeEventListener('pointerdown', onPress, true);
  }, []);

  // Escape, or a press anywhere outside, closes the open card
  useEffect(() => {
    if (open === 'none') return undefined;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || modalOpen()) return;
      e.preventDefault();
      setOpen('none');
      const back = open === 'settings' ? pill.current : chip.current;
      if (root.current?.contains(document.activeElement)) back?.focus({ preventScroll: true });
    };
    const onDown = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el || root.current?.contains(el) || el.closest('.ui-tooltip')) return;
      setOpen('none');
    };
    // (Escape is caught first, so with a card open during a drawing it closes the card and the drawing goes on)
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, [open]);

  // a card opened during a drawing: the drawing bar moves left of the card when at least 320 px are left there, else
  // the card opens under the bar (explorer.css: --ex-top-right on the map, --ex-card-drop on the card)
  useLayoutEffect(() => {
    const el = root.current, stage = el?.parentElement;
    if (!el || !stage) return undefined;
    const clear = () => { stage.style.removeProperty('--ex-top-right'); el.style.removeProperty('--ex-card-drop'); };
    const card = open === 'settings' ? settingsCard.current : open === 'legend' ? legendCard.current : null;
    const top = stage.querySelector<HTMLElement>('.fh-ex-map-top');
    if (!card || !top || drawMode === 'none') { clear(); return undefined; }
    const place = () => {
      const s = stage.getBoundingClientRect(), r = el.getBoundingClientRect(), t = top.getBoundingClientRect();
      const cardLeft = r.left + card.offsetLeft;
      if (cardLeft - 12 - t.left >= 320) {
        stage.style.setProperty('--ex-top-right', `${Math.round(s.right - cardLeft + 12)}px`);
        el.style.removeProperty('--ex-card-drop');
        return;
      }
      stage.style.removeProperty('--ex-top-right');
      const bar = top.querySelector('.fh-ex-draw')?.getBoundingClientRect();
      const head = el.querySelector('.fh-ex-controls-bar')?.getBoundingClientRect();
      const drop = bar && head ? Math.max(0, Math.round(bar.bottom - head.bottom)) : 0;
      if (drop) el.style.setProperty('--ex-card-drop', `${drop}px`); else el.style.removeProperty('--ex-card-drop');
    };
    place();
    // (in the next frame: moving the bar can wrap it, which would notify this observer again in the same frame)
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); });
    ro.observe(stage);
    const bar = top.querySelector('.fh-ex-draw');
    if (bar) ro.observe(bar);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); clear(); };
  }, [open, drawMode]);

  // tell the Explorer how much of the map the open card takes
  useLayoutEffect(() => {
    const card = open === 'settings' ? settingsCard.current : open === 'legend' ? legendCard.current : null;
    cb.current.onOpenChange?.(card ? Math.round(card.getBoundingClientRect().width) : 0, card ? open : 'none');
    // a card always opens at its top (its fade set now: the scroll event would only come with the next frame)
    const body = open === 'settings' ? settingsBody.current : open === 'legend' ? legendBody.current : null;
    if (body) { body.scrollTop = 0; body.dispatchEvent(new Event('scroll')); }
  }, [open]);

  const toggle = (which: Exclude<Open, 'none'>) => setOpen((o) => (o === which ? 'none' : which));
  const close = (back: HTMLButtonElement | null) => { setOpen('none'); back?.focus({ preventScroll: true }); };
  const onRadioKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const n = (MODES.indexOf(mode) + step + MODES.length) % MODES.length;
    onMode(MODES[n]);
    radios.current[n]?.focus();
  };

  const short = legendShort(mode, scale, t);
  const settingsOpen = open === 'settings', legendOpen = open === 'legend';
  const heightNote = mode === 'trend' ? x.heightNote.trend : x.heightNote.month;
  return (
    <div ref={root} className="fh-ex-controls" data-open={open === 'none' ? 'false' : 'true'} data-card={open}>
      <div className="fh-ex-controls-bar">
        <Tooltip content={x.legendChip(short)} describe={false}>
          <button ref={chip} type="button" className="fh-ex-legend-chip ui-press" aria-expanded={legendOpen}
            aria-controls={`${id}legend`} aria-label={x.legendChip(short)} onClick={() => toggle('legend')}>
            <Ramp mode={mode} className="fh-ex-ramp" />
            {/* (phones: the range of the colours in numbers, beside the ramp) */}
            <span className="fh-ex-legend-chip-range ui-mono" aria-hidden="true">{legendRange(mode, scale, level, t)}</span>
            <span className="fh-ex-legend-chip-text">{short}</span>
            <IconChevronDown size={14} className="fh-ex-chevron" />
          </button>
        </Tooltip>
        <Tooltip content={settingsOpen ? x.close : x.controls} keys={settingsOpen ? ['Esc'] : undefined} describe={false}>
          <button ref={pill} type="button" className="fh-ex-controls-toggle ui-press" aria-expanded={settingsOpen}
            aria-controls={`${id}body`} onClick={() => toggle('settings')}
            aria-label={x.pill(x.modes[mode], mode === 'trend' ? m.scaleShort.harmonized : m.scaleShort[scale], three ? '3D' : '2D')}>
            <IconLayers size={18} />
            <span className="fh-ex-controls-toggle-text">{x.modes[mode]}</span>
            <IconChevronDown size={16} className="fh-ex-chevron" />
          </button>
        </Tooltip>
      </div>

      <div ref={settingsCard} id={`${id}body`} className="fh-ex-controls-body fh-ex-card ui-glass" role="group" aria-label={x.controls}
        data-open={settingsOpen ? 'true' : 'false'} inert={!settingsOpen}>
        <div className="fh-ex-card-head">
          <p className="fh-ex-card-title">{x.controls}</p>
          <Tooltip content={x.close} keys={['Esc']} describe={false}>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon fh-ex-card-close" aria-label={x.close} onClick={() => close(pill.current)}>
              <IconClose size={16} />
            </button>
          </Tooltip>
        </div>
        <div ref={settingsBody} className="fh-ex-card-body">
          <div className="fh-ex-field">
            <span className="fh-ex-field-label" id={`${id}colour`}>{x.colour}</span>
            <div className="fh-ex-modes" role="radiogroup" aria-labelledby={`${id}colour`} onKeyDown={onRadioKey}>
              {MODES.map((v, i) => (
                <Tooltip key={v} content={x.modeHelp[v]} keys={[x.modeKeys[v]]}>
                  <button ref={(el) => { radios.current[i] = el; }} type="button" role="radio" aria-checked={mode === v}
                    tabIndex={mode === v ? 0 : -1} className="fh-ex-mode ui-press" data-mode={v} onClick={() => onMode(v)}>
                    <span className="fh-ex-mode-icon" aria-hidden="true">{MODE_ICON[v]}</span>
                    <span className="fh-ex-mode-label">{x.modes[v]}</span>
                    <Ramp mode={v} className="fh-ex-mode-ramp" />
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
          <div className="fh-ex-field">
            {mode === 'trend' ? (
              <>
                <span className="fh-ex-field-label">{x.scale}</span>
                <p className="fh-ex-controls-note">{x.scaleTrend}</p>
              </>
            ) : (
              <Segmented label={x.scale} value={scale} onChange={onScale}
                options={(['harmonized', 'modis', 'raw'] as const).map((s) => ({ value: s, label: m.scaleShort[s], title: t.explorer.scaleHelp[s] }))} />
            )}
          </div>
          <Tooltip content={three ? m.to2d : m.to3d} describe={false}>
            <button type="button" className="fh-ex-3d ui-press" aria-pressed={three} aria-label={three ? m.to2d : m.to3d} onClick={() => onView(three ? '2d' : '3d')}>
              <IconCube size={18} />
              <span className="fh-ex-3d-text">
                <span className="fh-ex-3d-title">{x.view3d}</span>
                <span className="fh-ex-3d-hint">{three ? heightNote : x.view3dHint}</span>
              </span>
              <kbd className="ui-kbd fh-ex-kbd">D</kbd>
              <span className="fh-ex-switch" aria-hidden="true"><span /></span>
            </button>
          </Tooltip>
        </div>
      </div>

      <div ref={legendCard} id={`${id}legend`} className="fh-ex-legend-card fh-ex-card ui-glass" role="group" aria-label={x.legend}
        data-open={legendOpen ? 'true' : 'false'} inert={!legendOpen}>
        <div className="fh-ex-card-head">
          <p className="fh-ex-card-title">{x.legend}</p>
          <Tooltip content={x.closeLegend} keys={['Esc']} describe={false}>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon fh-ex-card-close" aria-label={x.closeLegend} onClick={() => close(chip.current)}>
              <IconClose size={16} />
            </button>
          </Tooltip>
        </div>
        <div ref={legendBody} className="fh-ex-card-body">
          <div className="fh-ex-legend-box">
            <MapLegend mode={mode} scale={scale} level={level} width={268} />
          </div>
          {mode === 'trend' ? <TrendKey counts={trend && trend.level === level ? trend.counts : null} floor={trend?.file.floor_per_year ?? 100} level={level} /> : null}
          {dots ? <p className="fh-ex-legend-dots"><span className="fh-ex-dots-swatch" aria-hidden="true" />{x.dots.legend}</p> : null}
          <p className="fh-ex-controls-note">
            {m.hexSize[level]}
            {mode === 'anomaly' && scale !== 'harmonized' ? ` ${m.anomalyNote}` : ''}
            {three ? ` ${heightNote}` : ''}
          </p>
          {camera ? (
            <Tooltip content={x.dots.firmsTip}>
              <a className="fh-ex-firms" href={firmsUrl(camera.lat, camera.lon, camera.zoom)} target="_blank" rel="noopener noreferrer">
                {x.dots.firms}<IconExternal size={14} />
              </a>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
}
