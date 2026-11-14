// The map's tooltip: a hexagon's month (or its trend), or a hotspot dot. It is a component of its own so the pointer
// moving over the map re-renders nothing else: the tooltip follows the pointer by a transform set through a ref (once
// a frame, as deck.gl picks once a frame), and is drawn again only when the hexagon or dot under the pointer changes.
// It keeps clear of the floating panels (their boxes are read when the pointer reaches a new hexagon, at most a few
// times a second, never after a write), and its own size comes from a ResizeObserver, not from a read after a write.
// The place's name (state and country) comes a moment after the pointer rests on a hexagon.
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { cellToLatLng } from 'h3-js';
import { formatCoord, formatMonth, formatNumber, useI18n } from '../../lib/i18n';
import { comparedWithNormal, countText } from '../../lib/stats';
import type { Scale } from '../../lib/types';
import type { HotspotDot } from '../../lib/hotspots';
import { placeOfHex, type ExtraHex, type Frame, type TrendLayer, type Universe } from './mapData';
import { NOT_IN_FILE, NOT_TESTED, plainDecimal, signedPct } from './trend';

/** What MapView tells the tooltip (x and y: px from the map's top left corner). */
export interface MapTipHandle {
  hex(x: number, y: number, h3: string, i: number | null, extra: ExtraHex | null): void;
  dot(x: number, y: number, d: HotspotDot): void;
  clear(): void;
}

interface Box { x: number; y: number; w: number; h: number }
type Item = { kind: 'hex'; h3: string; i: number | null; extra: ExtraHex | null } | { kind: 'dot'; d: HotspotDot };

/** The floating parts over the map a tooltip keeps clear of. */
const OBSTACLES = '.fh-ex-panel:not([hidden]), .fh-ex-dock, .fh-ex-expand, .fh-ex-controls-bar, .fh-ex-card[data-open="true"], '
  + '.fh-ex-zoom, .fh-ex-map-top > *, .fh-ex-trend-note';
/** The boxes of the panels are read again after this long (they move only when a panel opens, closes or resizes). */
const LAYOUT_MS = 400;

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** The map's size and the panels over it, in px from the map's top left corner. */
interface Layout { W: number; H: number; blocks: Box[]; at: number }
function readLayout(wrapEl: HTMLElement): Layout {
  const W = wrapEl.clientWidth, H = wrapEl.clientHeight;
  const origin = wrapEl.getBoundingClientRect();
  const scope = wrapEl.closest('.fh-ex') ?? wrapEl;
  const blocks: Box[] = [];
  scope.querySelectorAll<HTMLElement>(OBSTACLES).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) blocks.push({ x: r.left - origin.left - 6, y: r.top - origin.top - 6, w: r.width + 12, h: r.height + 12 });
  });
  return { W, H, blocks, at: performance.now() };
}

/**
 * Where the tooltip goes: beside the pointer (right and below first, then left, then above), inside the map, and clear
 * of every floating panel. When every side hits something, the side that hides least wins.
 */
function tipPlace(x: number, y: number, size: { w: number; h: number }, l: Layout): { x: number; y: number } {
  const { W, H, blocks } = l;
  const { w, h } = size;
  const options: Box[] = [
    { x: x + 16, y: y + 14, w, h }, { x: x - 16 - w, y: y + 14, w, h },
    { x: x + 16, y: y - 14 - h, w, h }, { x: x - 16 - w, y: y - 14 - h, w, h },
  ];
  let best = options[0], bestCost = Infinity;
  for (const o of options) {
    const out = Math.max(0, 8 - o.x) + Math.max(0, o.x + w - (W - 8)) + Math.max(0, 8 - o.y) + Math.max(0, o.y + h - (H - 8));
    const cost = blocks.reduce((s, b) => s + overlap(o, b), 0) + out * 400;
    if (cost < bestCost) { best = o; bestCost = cost; }
    if (cost === 0) break;
  }
  return { x: Math.max(8, Math.min(W - w - 8, best.x)), y: Math.max(8, Math.min(H - h - 8, best.y)) };
}

export function MapTip({ ref, wrap, u, f, trend, scale }: {
  ref?: Ref<MapTipHandle>;
  wrap: RefObject<HTMLDivElement | null>;   // the map's box (the tooltip's frame)
  u: Universe | null; f: Frame | null;      // the hexagons and the month on the map
  trend: TrendLayer | null;                 // the trend map's file, when the map shows the trend
  scale: Scale;
}) {
  const { t, lang } = useI18n();
  const [item, setItem] = useState<Item | null>(null);
  const [place, setPlace] = useState<{ h3: string; text: string | null } | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const itemRef = useRef<Item | null>(null);
  const at = useRef({ x: 0, y: 0 });
  const size = useRef({ w: 252, h: 170 });
  const layout = useRef<Layout | null>(null);

  // the tooltip to the pointer: a transform, no layout read unless the panels' boxes are old
  const put = () => {
    const node = el.current, w = wrap.current;
    if (!node || !w) return;
    if (!layout.current || performance.now() - layout.current.at > LAYOUT_MS) layout.current = readLayout(w);
    const p = tipPlace(at.current.x, at.current.y, size.current, layout.current);
    node.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
  };
  const show = (next: Item | null) => {
    const old = itemRef.current;
    const same = old === next || (!!old && !!next && (old.kind === 'hex' && next.kind === 'hex' ? old.h3 === next.h3 && old.extra === next.extra
      : old.kind === 'dot' && next.kind === 'dot' ? old.d === next.d : false));
    if (same) return false;
    if (next && !old) layout.current = null;     // a new visit to the map: read the panels again
    itemRef.current = next;
    setItem(next);
    return true;
  };
  useImperativeHandle(ref, () => ({
    hex(x, y, h3, i, extra) { at.current = { x, y }; show({ kind: 'hex', h3, i, extra }); put(); },
    dot(x, y, d) { at.current = { x, y }; show({ kind: 'dot', d }); put(); },
    clear() { show(null); },
  }), []);   // eslint-disable-line react-hooks/exhaustive-deps

  // a new tooltip is placed as soon as it is on the page; its size follows its content without a read after a write
  useLayoutEffect(() => { if (item) put(); });   // eslint-disable-line react-hooks/exhaustive-deps
  const shownNow = item !== null;
  useEffect(() => {
    const node = el.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const b = entries[0].borderBoxSize?.[0];
      const w = b ? b.inlineSize : node.offsetWidth, h = b ? b.blockSize : node.offsetHeight;
      if (w > 0 && h > 0 && (Math.abs(w - size.current.w) > 0.5 || Math.abs(h - size.current.h) > 0.5)) { size.current = { w, h }; put(); }
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [shownNow]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the name of the place under the pointer (state and country of the centre), a moment after it stops
  const hoverH3 = item?.kind === 'hex' ? item.h3 : null;
  useEffect(() => {
    if (!hoverH3) return undefined;
    let alive = true;
    const id = window.setTimeout(() => {
      placeOfHex(hoverH3).then((text) => { if (alive) setPlace({ h3: hoverH3, text }); }, () => undefined);
    }, 120);
    return () => { alive = false; window.clearTimeout(id); };
  }, [hoverH3]);

  if (!item) return null;
  const tm = t.ex.tip, xt = t.exMap.tip;
  // (placed at the top left corner and moved by its transform)
  const style = { left: 0, top: 0 };
  if (item.kind === 'dot') {
    const dd = t.exMap.dots, d = item.d;
    const hhmm = `${String(Math.floor(d.time / 100)).padStart(2, '0')}:${String(d.time % 100).padStart(2, '0')}`;
    return (
      <div ref={el} className="fh-ex-tip ui-glass" style={style} aria-hidden="true" data-dot="">
        <p className="fh-ex-tip-place">{dd.legend.split(':')[0]}</p>
        <p className="fh-ex-tip-coord ui-mono">{formatCoord(d.lat, d.lon, lang)}</p>
        <dl className="fh-ex-tip-rows">
          <div><dt>{dd.date}</dt><dd className="ui-mono" data-k="date">{d.date}</dd></div>
          <div><dt>{dd.time}</dt><dd className="ui-mono" data-k="time">{hhmm}</dd></div>
          <div><dt>{dd.satellite}</dt><dd data-k="satellite">{d.satellite}</dd></div>
          <div><dt>{dd.frp}</dt><dd className="ui-mono" data-k="frp">{dd.mw(formatNumber(d.frp, lang, 1))}</dd></div>
        </dl>
      </div>
    );
  }
  if (!u || !f) return null;
  const [lat, lon] = cellToLatLng(item.h3);
  const coord = formatCoord(lat, lon, lang);
  const known = place && place.h3 === item.h3;
  const where = known ? (place.text ?? coord) : tm.locating;
  let rows: ReactNode;
  let sub: string;
  let tone: string | undefined;
  if (trend) {
    sub = `${known && place.text ? `${coord} · ` : ''}${xt.years}`;
    const r = item.i !== null ? trend.rows[item.i] : -1;
    const file = trend.file;
    const cls = item.i !== null ? trend.cls[item.i] : NOT_IN_FILE;
    const pct = r >= 0 ? file.pct[r] : null, p = r >= 0 ? file.p[r] : null, q = r >= 0 ? file.q[r] : null, mean = r >= 0 ? file.mean[r] : null;
    const floor = formatNumber(file.floor_per_year, lang);
    const verdict = cls === NOT_TESTED || cls === NOT_IN_FILE ? xt.untested : cls === 0 ? xt.flat : cls > 0 ? xt.clear.rising : xt.clear.falling;
    tone = cls === NOT_TESTED || cls === NOT_IN_FILE ? 'quiet' : cls === 0 ? 'flat' : cls > 0 ? 'rising' : 'falling';
    rows = (
      <>
        <p className="fh-ex-tip-verdict" data-tone={tone}><span aria-hidden="true" />{verdict}</p>
        <dl className="fh-ex-tip-rows">
          {pct !== null && cls !== NOT_TESTED && cls !== NOT_IN_FILE ? (
            <div><dt>{xt.trend}</dt><dd className="ui-mono" data-k="pct">{xt.perDecade(signedPct(pct))}</dd></div>
          ) : null}
          {p !== null && cls !== NOT_TESTED && cls !== NOT_IN_FILE ? <div><dt>{xt.p}</dt><dd className="ui-mono" data-k="p">{p === 0 ? '< 0.0001' : plainDecimal(p, 4)}</dd></div> : null}
          {q !== null ? <div><dt>{xt.q}</dt><dd className="ui-mono" data-k="q">{q === 0 ? '< 0.00001' : plainDecimal(q, 5)}</dd></div> : null}
          {mean !== null ? <div><dt>{xt.mean}</dt><dd className="ui-mono" data-k="mean">{formatNumber(mean, lang, 1)}</dd></div> : null}
        </dl>
        {cls === NOT_TESTED || cls === NOT_IN_FILE ? <p className="fh-ex-tip-note">{xt.untestedWhy(floor)}</p> : null}
      </>
    );
  } else {
    const pick = (a: Float32Array) => (item.i !== null ? a[item.i] : 0);
    const v = item.extra ? (scale === 'modis' ? item.extra.modis : scale === 'raw' ? item.extra.raw : item.extra.h)
      : pick(scale === 'modis' ? f.modis : scale === 'raw' ? f.raw : f.h);
    const hv = item.extra ? item.extra.h : pick(f.h);
    const normal = item.extra || item.i === null ? 0 : u.normals[(f.ym % 100) - 1][item.i];
    sub = `${known && place.text ? `${coord} · ` : ''}${formatMonth(Math.floor(f.ym / 100), f.ym % 100, lang)}`;
    const monthName = t.common.months[(f.ym % 100) - 1];
    rows = (
      <dl className="fh-ex-tip-rows">
        <div><dt>{tm.hotspots[scale]}</dt><dd className="ui-mono">{v > 0 ? countText(v, 'compact') : '0'}</dd></div>
        <div><dt>{tm.normal(monthName)}</dt><dd className="ui-mono">{normal > 0 ? countText(normal, 'compact') : '0'}</dd></div>
        <div>
          <dt>{tm.against}</dt>
          <dd className="ui-mono">{normal > 0 ? (hv > 0 ? comparedWithNormal(hv / normal) : tm.none)
            : hv > 0 ? tm.noNormal : t.kpi.noFireUsual}</dd>
        </div>
      </dl>
    );
  }
  return (
    <div ref={el} className="fh-ex-tip ui-glass" style={style} aria-hidden="true" data-tone={tone}>
      <p className="fh-ex-tip-place">{where}</p>
      <p className="fh-ex-tip-coord ui-mono">{sub}</p>
      {rows}
      <p className="fh-ex-tip-hint">{tm.click}</p>
    </div>
  );
}
