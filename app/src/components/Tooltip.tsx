// Tooltips for controls, in the theme (styles: .ui-tooltip in theme.css). They show on keyboard focus at once, on
// hover after 400 ms (at once when moving along a row of controls), and on a long press on touch screens, where the
// press then does not also click. They stay inside the window and flip above the control when there is no room below.
//
//   <Tooltip content="Switch to light mode" keys={['T']}><button aria-label="Switch to light mode">…</button></Tooltip>
//
// The child must be one element that takes a ref (a button or a link). Keep its aria-label: the tooltip adds the text
// as its description (aria-describedby) only when it says more than the label (pass describe={false} to skip it).
import {
  cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactElement, type ReactNode, type Ref,
} from 'react';
import { createPortal } from 'react-dom';

type Side = 'top' | 'bottom';

const GAP = 8;          // px between the control and the tooltip
const EDGE = 8;         // px kept free at the window's edges
const LONG_PRESS = 480; // ms
let lastClosed = 0;     // when a tooltip last closed: the next one within 500 ms opens at once

interface ChildProps {
  ref?: Ref<HTMLElement>;
  'aria-describedby'?: string;
  'aria-label'?: string;
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp?: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel?: (e: PointerEvent<HTMLElement>) => void;
  onClickCapture?: (e: MouseEvent<HTMLElement>) => void;
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}

export interface TooltipProps {
  /** What the control does, in a few words. */
  content: ReactNode;
  /** A keyboard shortcut, shown as key caps (hidden on touch screens). */
  keys?: string[];
  /** Preferred side; it flips when there is no room. */
  side?: Side;
  /** Hover delay in ms. */
  delay?: number;
  /** Add the text as the control's description. Default: only when it differs from the control's aria-label. */
  describe?: boolean;
  children: ReactElement;
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref && typeof ref === 'object') (ref as { current: T | null }).current = value;
}

export function Tooltip({ content, keys, side = 'bottom', delay = 400, describe, children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const longPressed = useRef(false);
  const props = children.props as ChildProps;

  const clear = () => { window.clearTimeout(timer.current); timer.current = 0; };
  const show = useCallback(() => { clear(); setOpen(true); }, []);
  const hide = useCallback(() => { clear(); setOpen((o) => { if (o) lastClosed = performance.now(); return false; }); }, []);
  const later = (fn: () => void, ms: number) => { clear(); timer.current = window.setTimeout(fn, ms); };

  // Place it: centred under the control (or above when there is no room), inside the window.
  useLayoutEffect(() => {
    const el = tip.current, t = trigger.current;
    if (!open || !el || !t) return;
    const r = t.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    let s: Side = side;
    if (s === 'bottom' && r.bottom + GAP + h > vh - EDGE && r.top - GAP - h >= EDGE) s = 'top';
    else if (s === 'top' && r.top - GAP - h < EDGE) s = 'bottom';
    const y = s === 'bottom' ? r.bottom + GAP : r.top - GAP - h;
    const x = Math.min(Math.max(EDGE, r.left + r.width / 2 - w / 2), Math.max(EDGE, vw - EDGE - w));
    el.style.setProperty('--tip-x', `${Math.round(x)}px`);
    el.style.setProperty('--tip-y', `${Math.round(y)}px`);
    el.dataset.side = s;
  }, [open, side, content]);

  // While open: a scroll, a resize or Escape anywhere closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    window.addEventListener('scroll', hide, { capture: true, passive: true });
    window.addEventListener('resize', hide);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', hide, { capture: true });
      window.removeEventListener('resize', hide);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, hide]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const label = typeof content === 'string' ? content : null;
  const withDescription = describe ?? (label === null || label !== props['aria-label']);
  const describedBy = withDescription ? [props['aria-describedby'], id].filter(Boolean).join(' ') : props['aria-describedby'];

  const child = cloneElement(children as ReactElement<ChildProps>, {
    ref: (el: HTMLElement | null) => { trigger.current = el; setRef(props.ref, el); },
    'aria-describedby': describedBy,
    onPointerEnter: (e) => {
      props.onPointerEnter?.(e);
      if (e.pointerType === 'touch') return;
      if (performance.now() - lastClosed < 500) show(); else later(show, delay);
    },
    onPointerLeave: (e) => { props.onPointerLeave?.(e); if (e.pointerType !== 'touch') hide(); },
    onPointerDown: (e) => {
      props.onPointerDown?.(e);
      if (e.pointerType !== 'touch') { hide(); return; }
      longPressed.current = false;
      later(() => { longPressed.current = true; show(); navigator.vibrate?.(8); }, LONG_PRESS);
    },
    onPointerUp: (e) => {
      props.onPointerUp?.(e);
      if (e.pointerType !== 'touch') return;
      if (longPressed.current) later(hide, 1500); else clear();
    },
    onPointerCancel: (e) => { props.onPointerCancel?.(e); if (e.pointerType === 'touch') { clear(); if (longPressed.current) later(hide, 1500); } },
    // a long press shows the tooltip; it does not also press the button
    onClickCapture: (e) => {
      if (longPressed.current) { longPressed.current = false; e.preventDefault(); e.stopPropagation(); return; }
      props.onClickCapture?.(e);
    },
    onContextMenu: (e) => { if (longPressed.current) e.preventDefault(); props.onContextMenu?.(e); },
    onFocus: (e) => { props.onFocus?.(e); if (e.currentTarget.matches(':focus-visible')) show(); },
    onBlur: (e) => { props.onBlur?.(e); hide(); },
    onKeyDown: (e) => { props.onKeyDown?.(e); if (e.key === 'Escape') hide(); },
  });

  return (
    <>
      {child}
      {typeof document !== 'undefined' ? createPortal(
        <div ref={tip} id={id} role="tooltip" className="ui-tooltip" data-open={open ? '' : undefined}>
          <span>{content}</span>
          {keys?.length ? <span className="ui-tooltip-keys">{keys.map((k) => <kbd key={k} className="ui-kbd">{k}</kbd>)}</span> : null}
        </div>,
        document.body,
      ) : null}
    </>
  );
}
