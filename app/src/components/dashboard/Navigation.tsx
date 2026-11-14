// The dashboard's own navigation: a sticky strip of section chips under the app header. The chip of the section in
// view lights up as you scroll (scrollspy), a thin line shows how far down the page you are, a click scrolls smoothly
// to the section, and the link to a section can be copied ("#/dashboard?s=seam"). Also: sections fade in as they come
// into view (only after the first scroll, so a page printed or captured without scrolling shows everything).
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { useToast } from '../Toast';
import { Tooltip } from '../Tooltip';
import { IconChevronUp, IconCopy } from '../icons';
import { sectionHash } from './useScope';

export interface NavItem { id: string; label: string }

const reduceMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** The height of the sticky app header (it grows on phones, where the page links wrap to a second row). */
function headerBottom(): number {
  const h = document.querySelector('.fh-header');
  return h instanceof HTMLElement ? Math.max(0, h.getBoundingClientRect().bottom) : 0;
}

const sectionEl = (id: string): HTMLElement | null => document.getElementById(`db-${id}`);

/** Scroll so that the section title sits just under the sticky header and navigation, and move the focus there. */
export function scrollToSection(id: string, smooth: boolean): boolean {
  const el = sectionEl(id);
  if (!el) return false;
  const nav = document.querySelector('.db-nav');
  const offset = headerBottom() + (nav instanceof HTMLElement ? nav.getBoundingClientRect().height : 0) + 20;
  const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset);
  window.scrollTo({ top, behavior: smooth && !reduceMotion() ? 'smooth' : 'auto' });
  const heading = el.querySelector('h2');
  if (heading instanceof HTMLElement) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
  return true;
}

/** "#/dashboard?s=seam" -> "seam". */
export function sectionFromHash(hash: string): string | null {
  const q = hash.split('?')[1] ?? '';
  return new URLSearchParams(q).get('s');
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/** The sticky bar: the scope bar on top (laptops), the section chips under it, and its tools (copy, top, and on
 *  phones the button that opens the scope sheet). */
export function SectionNav({ items, scope, tools }: { items: NavItem[]; scope?: ReactNode; tools?: ReactNode }) {
  const nav = useRef<HTMLElement>(null);
  const strip = useRef<HTMLOListElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(items[0]?.id ?? '');
  const [scrolled, setScrolled] = useState(false);
  const lock = useRef(0);   // after a click the page scrolls smoothly; the scrollspy waits until it stops
  const toast = useToast();

  // stick just under the app header, whatever its height
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    const set = () => el.style.setProperty('--db-nav-top', `${Math.round(headerBottom())}px`);
    set();
    const h = document.querySelector('.fh-header');
    const ro = new ResizeObserver(set);
    if (h) ro.observe(h);
    return () => ro.disconnect();
  }, []);

  // scrollspy and progress
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const y = window.scrollY;
      line.current?.style.setProperty('--db-progress', String(max > 0 ? Math.min(1, Math.max(0, y / max)) : 0));
      setScrolled(y > 240);
      // stuck under the header: the gap above the panel is filled (dashboard.css .db-nav[data-stuck])
      const el = nav.current;
      if (el) {
        const stuck = y > 0 && el.getBoundingClientRect().top <= (parseFloat(getComputedStyle(el).top) || 0) + 0.5;
        if (stuck !== el.hasAttribute('data-stuck')) el.toggleAttribute('data-stuck', stuck);
      }
      if (performance.now() < lock.current) return;
      const navBottom = nav.current?.getBoundingClientRect().bottom ?? 0;
      const mark = navBottom + (window.innerHeight - navBottom) * 0.28;
      let cur = items[0]?.id ?? '';
      for (const it of items) {
        const el = sectionEl(it.id);
        if (el && el.getBoundingClientRect().top <= mark) cur = it.id;
      }
      if (max > 0 && y >= max - 2) cur = items[items.length - 1]?.id ?? cur;
      setActive(cur);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    const onEnd = () => { lock.current = 0; };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('scrollend', onEnd);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scrollend', onEnd);
    };
  }, [items]);

  // keep the active chip in view inside the strip (scrolls the strip only, never the page)
  useEffect(() => {
    const s = strip.current;
    const a = s?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (!s || !a || s.scrollWidth <= s.clientWidth) return;
    const left = a.offsetLeft - s.clientWidth / 2 + a.offsetWidth / 2;
    s.scrollTo({ left: Math.max(0, left), behavior: reduceMotion() ? 'auto' : 'smooth' });
  }, [active]);

  const go = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    lock.current = performance.now() + 1600;
    setActive(id);
    if (scrollToSection(id, true)) window.history.replaceState(window.history.state, '', sectionHash(id));
  };

  const copy = async () => {
    const url = `${window.location.origin}${window.location.pathname}${sectionHash(active)}`;
    if (await copyText(url)) toast('Link copied');
    else toast('The link could not be copied', 'info');
  };

  const top = () => {
    lock.current = performance.now() + 1600;
    setActive(items[0]?.id ?? '');
    window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    window.history.replaceState(window.history.state, '', sectionHash(null));
  };

  return (
    <nav ref={nav} className={scope ? 'db-nav has-scope' : 'db-nav'} aria-label="Sections of the dashboard">
      <div className="db-nav-panel">
      {scope}
      <div className="db-nav-inner">
        <ol ref={strip} className="db-nav-strip ui-scroll-fade">
          {items.map((it, i) => (
            <li key={it.id}>
              <a href={sectionHash(it.id)} data-id={it.id} className="db-nav-chip ui-press" onClick={(e) => go(e, it.id)}
                aria-current={active === it.id ? 'location' : undefined}>
                <span className="db-nav-n ui-mono" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <span className="db-nav-label">{it.label}</span>
              </a>
            </li>
          ))}
        </ol>
        <div className="db-nav-tools">
          {tools}
          <Tooltip content="Copy a link to this section, with the place and months">
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon db-nav-tool" aria-label="Copy a link to this section" onClick={copy}>
              <IconCopy size={16} />
            </button>
          </Tooltip>
          <Tooltip content="Back to the top">
            <button type="button" className={scrolled ? 'ui-btn ui-btn-ghost ui-btn-icon db-nav-tool' : 'ui-btn ui-btn-ghost ui-btn-icon db-nav-tool is-idle'}
              aria-label="Back to the top" onClick={top}>
              <IconChevronUp size={16} />
            </button>
          </Tooltip>
        </div>
      </div>
      </div>
      <span ref={line} className="db-nav-progress" aria-hidden="true" />
    </nav>
  );
}

/**
 * Sections below the fold fade in, with a short stagger, as they come into view. Nothing is hidden until the reader
 * first scrolls (so printing, screenshots and "find in page" before scrolling see every section), and nothing moves
 * when the system asks for reduced motion. Uses the shared .ui-reveal animation.
 */
export function useReveal(root: RefObject<HTMLElement | null>, ready: boolean): void {
  useEffect(() => {
    const el = root.current;
    if (!ready || !el || reduceMotion() || typeof IntersectionObserver === 'undefined') return;
    const blocks = Array.from(el.querySelectorAll<HTMLElement>(':scope > .db-reveal'));
    const show = (b: HTMLElement) => {
      if (!b.classList.contains('db-pending')) return;
      const kids = Array.from(b.querySelectorAll<HTMLElement>(':scope > .ui-section > *, :scope > .db-block > *'));
      kids.forEach((k, i) => { k.style.setProperty('--i', String(Math.min(i, 6))); k.classList.add('ui-reveal'); });
      b.classList.remove('db-pending');
    };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { show(e.target as HTMLElement); io.unobserve(e.target); }
      }
    }, { rootMargin: '0px 0px -6% 0px' });
    let armed = false;
    const arm = () => {
      if (armed) return;
      armed = true;
      const vh = window.innerHeight;
      for (const b of blocks) {
        if (b.getBoundingClientRect().top > vh) { b.classList.add('db-pending'); io.observe(b); }
      }
    };
    window.addEventListener('scroll', arm, { passive: true });
    return () => {
      window.removeEventListener('scroll', arm);
      io.disconnect();
      for (const b of blocks) b.classList.remove('db-pending');
    };
  }, [root, ready]);
}
