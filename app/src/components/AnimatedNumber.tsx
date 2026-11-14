// A number that glides to its new value (ease out, 600 ms) so a change is easy to follow. With "reduce motion"
// switched on in the system settings it changes at once. The final text is always exact (format of the target).
// The glide never leaves the range between the old and the new value: progress is clamped to 0..1 and timed from
// the first frame, and a glide that is interrupted starts again from the number on screen.
import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Ease out quart from a to b at progress k (clamped to 0..1); the result always lies between a and b. */
export function glide(a: number, b: number, k: number): number {
  const t = Math.min(1, Math.max(0, k));
  const v = a + (b - a) * (1 - Math.pow(1 - t, 4));
  return Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b));
}

export function AnimatedNumber({ value, format, duration = 600 }: { value: number; format: (v: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const current = useRef(value);   // the value on screen right now
  const raf = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(value) || !Number.isFinite(current.current) || prefersReducedMotion() || current.current === value) {
      current.current = value;
      setShown(value);
      return;
    }
    const a = current.current, b = value;
    let start = -1;
    const tick = (t: number) => {
      if (start < 0) start = t;   // time from the first frame: its timestamp can be earlier than performance.now()
      const k = (t - start) / duration;
      const v = k >= 1 ? b : glide(a, b, k);
      current.current = v;
      setShown(v);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);
  return <span className="ui-num-anim">{format(shown === value ? value : shown)}</span>;
}
