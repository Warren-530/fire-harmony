// Rows that scroll sideways (chips, contents bars, tab strips) with a cue: the edges fade where there is more to see,
// and only there, and items snap into place. On a laptop, small arrow buttons at the ends scroll by most of a row.
//
// The fades are CSS (.ui-scroll-x in theme.css, driven by the scroll position); this component adds the arrows, and
// sets the fades itself in browsers without scroll driven animations. For a row whose own CSS makes it scroll only
// on small screens, put the class "ui-scroll-fade" on it instead of using this component.
//
//   <ScrollFade as="ul" className="db-chips" arrows>…</ScrollFade>   (arrows: mouse only; keyboard users scroll with Tab)
import { useEffect, useRef, useState, type ElementType, type HTMLAttributes, type ReactNode } from 'react';
import { IconChevronLeft, IconChevronRight } from './icons';

const cssFades = () => typeof CSS !== 'undefined' && CSS.supports?.('animation-timeline: scroll()');

/** Keeps an element's fade variables and scroll state up to date. Returns which ends have more to show. */
export function useScrollEnds(el: HTMLElement | null): { start: boolean; end: boolean } {
  const [ends, setEnds] = useState({ start: false, end: false });
  useEffect(() => {
    if (!el) return;
    let raf = 0;
    const own = !cssFades();
    const update = () => {
      raf = 0;
      const max = el.scrollWidth - el.clientWidth;
      const x = Math.abs(el.scrollLeft);
      const start = max > 1 && x > 1, end = max > 1 && x < max - 1;
      if (own) {
        el.dataset.fade = '';
        el.style.setProperty('--fade-l', start ? '28px' : '0px');
        el.style.setProperty('--fade-r', end ? '32px' : '0px');
      }
      setEnds((o) => (o.start === start && o.end === end ? o : { start, end }));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    return () => { cancelAnimationFrame(raf); el.removeEventListener('scroll', onScroll); ro.disconnect(); };
  }, [el]);
  return ends;
}

export function ScrollFade({ as: Tag = 'div', className, arrows = false, children, ...rest }: HTMLAttributes<HTMLElement> & {
  as?: ElementType; arrows?: boolean; children: ReactNode;
}) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const ends = useScrollEnds(el);
  const reduce = useRef(false);
  useEffect(() => { reduce.current = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false; }, []);
  const go = (dir: 1 | -1) => el?.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reduce.current ? 'auto' : 'smooth' });
  const row = <Tag ref={setEl} className={`ui-scroll-x${className ? ` ${className}` : ''}`} {...rest}>{children}</Tag>;
  if (!arrows) return row;
  return (
    <div className="ui-scroll-wrap">
      {row}
      <button type="button" className="ui-scroll-arrow ui-scroll-arrow-start" tabIndex={-1} aria-hidden="true" hidden={!ends.start}
        onClick={() => go(-1)}><IconChevronLeft size={16} /></button>
      <button type="button" className="ui-scroll-arrow ui-scroll-arrow-end" tabIndex={-1} aria-hidden="true" hidden={!ends.end}
        onClick={() => go(1)}><IconChevronRight size={16} /></button>
    </div>
  );
}
