// The documentation layout of the Methods and Data pages: a sticky table of contents on the left that follows the
// reading position (a bar of chips under the header on small screens), and the content on the right.
// Every section has a link of its own, "#/methods?section=tests", that scrolls to it (the hash router keeps the page).
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useCommand } from '../../lib/commands';
import { IconChevronUp, IconCopy } from '../icons';
import { useCopy } from './clipboard';

export interface DocSection { id: string; label: string }

const SMALL = '(max-width: 1023px)';
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const small = () => window.matchMedia?.(SMALL).matches ?? false;

/** The section named in the address ("#/data?section=files"), if any. */
function sectionParam(): string | null {
  const h = window.location.hash;
  const i = h.indexOf('?');
  return i < 0 ? null : new URLSearchParams(h.slice(i + 1)).get('section');
}

/** The full address of a section, to share. */
function sectionHref(page: string, id: string): string {
  return `${window.location.href.split('#')[0]}#/${page}?section=${encodeURIComponent(id)}`;
}

/** Height of what stays stuck at the top: the app header, and on small screens the bar of chips. */
function stuckHeight(nav: HTMLElement | null): number {
  const header = document.querySelector('.fh-header');
  let h = header ? header.getBoundingClientRect().height : 0;
  if (nav && small()) h += nav.getBoundingClientRect().height;
  return h;
}

export function DocLayout({ page, sections, ready = true, children }: {
  page: string; sections: DocSection[]; ready?: boolean; children: ReactNode;
}) {
  const ids = sections.map((s) => s.id);
  const key = ids.join(',');
  const nav = useRef<HTMLElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const pinned = useRef<string | null>(null);   // a section chosen in the list stays lit until the reader scrolls
  const userMoved = useRef(false);
  const [active, setActive] = useState(ids[0] ?? '');
  const root = useRef<HTMLDivElement>(null);
  const copy = useCopy();

  // The height of the app header, for the sticky contents and the scroll offsets (it changes with the width).
  useEffect(() => {
    const header = document.querySelector<HTMLElement>('.fh-header');
    const el = root.current;
    if (!header || !el) return;
    const set = () => el.style.setProperty('--fh-sticky-top', `${Math.round(header.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  const scrollToSection = (id: string, smooth: boolean) => {
    const el = document.getElementById(id);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - stuckHeight(nav.current) - 16;
    window.scrollTo({ top: Math.max(0, y), behavior: smooth && !reduceMotion() ? 'smooth' : 'auto' });
  };

  // Follow the reading position: the current section is the last one whose top has passed a line under the header.
  useEffect(() => {
    const order = key.split(',');
    let raf = 0;
    const update = () => {
      raf = 0;
      const top = stuckHeight(nav.current);
      const line = top + Math.min(160, window.innerHeight * 0.25);
      let cur = order[0] ?? '';
      for (const id of order) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) cur = id;
      }
      const doc = document.documentElement;
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 4) cur = order[order.length - 1] ?? cur;
      setActive(pinned.current ?? cur);
      // Reading progress through the content.
      const b = body.current;
      if (b && bar.current) {
        const r = b.getBoundingClientRect();
        const total = Math.max(1, r.height - (window.innerHeight - top));
        const p = Math.min(1, Math.max(0, (top - r.top) / total));
        bar.current.style.transform = `scaleX(${p.toFixed(4)})`;
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    const release = () => { userMoved.current = true; if (pinned.current) { pinned.current = null; onScroll(); } };
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) release();
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('wheel', release, { passive: true });
    window.addEventListener('touchmove', release, { passive: true });
    window.addEventListener('keydown', onKey);
    const ro = new ResizeObserver(onScroll);
    if (body.current) ro.observe(body.current);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('wheel', release);
      window.removeEventListener('touchmove', release);
      window.removeEventListener('keydown', onKey);
      ro.disconnect();
    };
  }, [key]);

  // A section named in the address: go there on arrival, again once the data has filled the page, and on a new hash.
  useEffect(() => {
    const id = sectionParam();
    if (!id || !key.split(',').includes(id) || userMoved.current) return;
    const raf = requestAnimationFrame(() => { pinned.current = id; setActive(id); scrollToSection(id, false); });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
  useEffect(() => {
    const onHash = () => {
      const id = sectionParam();
      if (id && key.split(',').includes(id)) { pinned.current = id; setActive(id); scrollToSection(id, true); }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // On small screens the bar of chips scrolls sideways so the current chip stays in view.
  useEffect(() => {
    const ol = list.current;
    if (!ol || !small()) return;
    const a = ol.querySelector<HTMLElement>('[aria-current="true"]');
    if (!a) return;
    const left = a.offsetLeft - (ol.clientWidth - a.offsetWidth) / 2;
    ol.scrollTo({ left: Math.max(0, left), behavior: reduceMotion() ? 'auto' : 'smooth' });
  }, [active]);

  const copyLink = (id: string) => { void copy(sectionHref(page, id), 'Link copied'); };
  useCommand((c) => { if (c.action === 'copy-link') copyLink(active); }, [active, page]);

  /** Go to a section (the list, the phone select): it stays lit until the reader scrolls, and gets the focus. */
  const goTo = (id: string) => {
    pinned.current = id;
    setActive(id);
    scrollToSection(id, true);
    window.history.replaceState(window.history.state, '', `#/${page}?section=${encodeURIComponent(id)}`);
    const h = document.getElementById(id)?.querySelector<HTMLElement>('h2');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  };
  const onPick = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // let "open in a new tab" work
    e.preventDefault();
    pinned.current = id;
    setActive(id);
    scrollToSection(id, true);
    window.history.replaceState(window.history.state, '', `#/${page}?section=${encodeURIComponent(id)}`);
    const h = document.getElementById(id)?.querySelector<HTMLElement>('h2');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  };

  const toTop = () => {
    pinned.current = null;
    window.history.replaceState(window.history.state, '', `#/${page}`);
    window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    const title = document.querySelector<HTMLElement>('.ui-page-title');
    if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
  };

  const activeIndex = Math.max(0, ids.indexOf(active));
  return (
    <div ref={root} className="fh-doc">
      <nav ref={nav} className="fh-doc-toc" aria-label="On this page">
        <div className="fh-doc-toc-head">
          <p className="fh-doc-toc-title">On this page</p>
          <span className="fh-doc-toc-count ui-mono" aria-hidden="true">
            {String(activeIndex + 1).padStart(2, '0')}/{String(ids.length).padStart(2, '0')}
          </span>
        </div>
        <span className="fh-doc-progress" aria-hidden="true"><span ref={bar} /></span>
        {/* phones: one select instead of a row of chips (the row stays from 768 to 1023 px, the rail from 1024) */}
        <label className="fh-doc-toc-select">
          <span className="sr-only">Go to a section</span>
          <span className="fh-doc-toc-select-n ui-mono" aria-hidden="true">{String(activeIndex + 1).padStart(2, '0')}/{String(ids.length).padStart(2, '0')}</span>
          <select value={active} onChange={(e) => goTo(e.target.value)}>
            {sections.map((s, i) => <option key={s.id} value={s.id}>{`${i + 1}. ${s.label}`}</option>)}
          </select>
        </label>
        <ol ref={list} className="fh-doc-toc-list ui-scroll-fade">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a href={`#/${page}?section=${s.id}`} aria-current={s.id === active ? 'true' : undefined}
                data-read={i < activeIndex ? '' : undefined} onClick={(e) => onPick(e, s.id)}>
                <span className="fh-doc-toc-n ui-mono" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <span className="fh-doc-toc-label">{s.label}</span>
              </a>
            </li>
          ))}
        </ol>
        <div className="fh-doc-toc-tools">
          <button type="button" className="ui-btn ui-btn-ghost" onClick={() => copyLink(active)}>
            <IconCopy size={15} />Copy a link to this section
          </button>
          <button type="button" className="ui-btn ui-btn-ghost" onClick={toTop}>
            <IconChevronUp size={15} />Back to the top
          </button>
        </div>
      </nav>
      <div ref={body} className="fh-doc-body">{children}</div>
    </div>
  );
}

/** Readable prose: paragraphs of about 70 characters a line. */
export function Prose({ children }: { children: ReactNode }) {
  return <div className="fh-doc-prose">{children}</div>;
}

/** A number in a sentence, set in the number font so it stands out. */
export function N({ children }: { children: ReactNode }) {
  return <strong className="fh-doc-n">{children}</strong>;
}

/**
 * The opening text of a section with a margin note beside it on wide screens (the right column of Stripe or Vercel
 * docs, or a Tufte margin): the section's key number, so a wide page has no empty band beside the text. The note
 * sticks while its text scrolls past. On narrower screens it sits under the text as a small card.
 */
export function Lede({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="fh-doc-lede-box">
      <div className="fh-doc-lede" data-aside={aside ? '' : undefined}>
        <Prose>{children}</Prose>
        {aside ? <aside className="fh-doc-margin">{aside}</aside> : null}
      </div>
    </div>
  );
}

/** One margin note: a label, the number (and its unit, never split from it) and a sentence on what it means. */
export function MarginNote({ label, value, unit, children, foot }: {
  label: string; value: ReactNode; unit?: string; children?: ReactNode; foot?: ReactNode;
}) {
  return (
    <div className="fh-doc-note">
      <p className="fh-doc-note-label">{label}</p>
      <p className="fh-doc-note-value"><span className="ui-mono">{value}</span>{unit ? <span className="fh-doc-note-unit">{unit}</span> : null}</p>
      {children ? <p className="fh-doc-note-text">{children}</p> : null}
      {foot ? <div className="fh-doc-note-foot">{foot}</div> : null}
    </div>
  );
}

/** A titled part of a section ("VIIRS sees the weak fires"): a small heading, then its text and charts. */
export function Sub({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <div className="fh-doc-sub" id={id}>
      <h3 className="fh-doc-sub-title">{title}</h3>
      {children}
    </div>
  );
}
