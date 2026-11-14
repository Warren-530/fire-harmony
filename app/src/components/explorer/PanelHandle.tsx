// The handle on the right edge of the Explorer's area panel: drag it (mouse, pen or finger) to make the panel wider or
// narrower, or focus it and press Left and Right (16 px a step, 64 with Shift); Home or a double click goes back to
// the usual width. While it is dragged the width is written straight into the page's --panel-w (no render of the
// page), once a frame, so the dock, the drawing bar and the map's free area follow at once; the map slides by half of
// each step, so what was in the middle of the free area stays there; the page takes the new width when the drag ends
// (panelSize.ts: the charts draw once then).
import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { Tooltip } from '../Tooltip';
import { PANEL_MIN, clampPanel, panelMax, setPanelResizing } from './panelSize';

const T = {
  label: 'Panel width',
  tip: 'Drag to resize the panel. Double click to reset.',
  value: (px: number) => `${px} pixels wide`,
};

export function PanelHandle({ root, width, controls, onChange, onReset, onLive }: {
  root: RefObject<HTMLElement | null>;   // the Explorer (it holds --panel-w)
  width: number;                         // the panel's width now
  controls: string;                      // the id of the panel
  onChange(px: number): void;            // a new width (the end of a drag, or a key)
  onReset(): void;                       // back to the usual width
  onLive?(dx: number): void;             // the panel grew by dx px during a drag (the map slides)
}) {
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x0: number; w0: number; last: number; want: number } | null>(null);
  const frame = useRef(0);
  useEffect(() => () => { cancelAnimationFrame(frame.current); if (drag.current) setPanelResizing(false); }, []);

  const apply = () => {
    frame.current = 0;
    const d = drag.current, r = root.current;
    if (!d || !r || d.want === d.last) return;
    r.style.setProperty('--panel-w', `${d.want}px`);
    el.current?.setAttribute('aria-valuenow', String(d.want));
    el.current?.setAttribute('aria-valuetext', T.value(d.want));
    onLive?.(d.want - d.last);
    d.last = d.want;
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    cancelAnimationFrame(frame.current);
    apply();
    drag.current = null;
    root.current?.removeAttribute('data-resizing');
    setPanelResizing(false);
    if (d.last !== d.w0) onChange(d.last);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x0: e.clientX, w0: width, last: width, want: width };
    root.current?.setAttribute('data-resizing', '');
    setPanelResizing(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.want = clampPanel(d.w0 + e.clientX - d.x0);
    if (!frame.current) frame.current = requestAnimationFrame(apply);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();          // (the Explorer's arrows step the month)
      const next = clampPanel(width + (e.key === 'ArrowRight' ? step : -step));
      if (next !== width) onChange(next);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onReset();
    }
  };
  return (
    <Tooltip content={T.tip} describe={false}>
      <div ref={el} className="fh-ex-resize" role="separator" aria-orientation="vertical" tabIndex={0} aria-label={T.label}
        aria-controls={controls} aria-valuemin={PANEL_MIN} aria-valuemax={panelMax()} aria-valuenow={width} aria-valuetext={T.value(width)}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
        onDoubleClick={onReset} onKeyDown={onKeyDown}>
        <span className="fh-ex-resize-grip" aria-hidden="true" />
      </div>
    </Tooltip>
  );
}
