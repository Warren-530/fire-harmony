// Report figures (the PNGs in public/figures) as cards that open a lightbox: a modal dialog with the figure at full
// size, its caption, the previous and next figures (arrow keys or swipe), Escape or the close button to leave, and
// focus back on the card that opened it.
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Card, Tooltip } from '../ui';
import { IconChevronLeft, IconChevronRight, IconClose, IconExternal, IconSearch } from '../icons';

export interface FigureItem {
  id: string;
  file: string;              // under public/, for example 'figures/fig03_seam_test.png'
  title: string;             // the finding
  caption: string;           // what is plotted
  alt: string;               // what the picture shows, for people who cannot see it
  w: number; h: number;      // pixel size of the file
}

interface Gallery { figures: FigureItem[]; open: (id: string, from: HTMLElement | null) => void }
const GalleryContext = createContext<Gallery | null>(null);

const src = (f: FigureItem) => `${import.meta.env.BASE_URL}${f.file}`;

export function FigureGallery({ figures, children }: { figures: FigureItem[]; children: ReactNode }) {
  const [index, setIndex] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback((id: string, from: HTMLElement | null) => {
    const i = figures.findIndex((f) => f.id === id);
    if (i < 0) return;
    opener.current = from;
    setIndex(i);
  }, [figures]);
  const close = useCallback(() => {
    setIndex(null);
    const el = opener.current;
    opener.current = null;
    if (el) requestAnimationFrame(() => el.focus({ preventScroll: true }));
  }, []);
  const value = useMemo(() => ({ figures, open }), [figures, open]);
  return (
    <GalleryContext value={value}>
      {children}
      <Lightbox figures={figures} index={index} onIndex={setIndex} onClose={close} />
    </GalleryContext>
  );
}

/** One figure as a card: the finding as its title, the picture, the caption, and a button to see it larger. */
export function FigureCard({ id }: { id: string }) {
  const g = use(GalleryContext);
  const button = useRef<HTMLButtonElement>(null);
  if (!g) return null;
  const n = g.figures.findIndex((f) => f.id === id);
  const f = g.figures[n];
  if (!f) return null;
  const open = () => g.open(id, button.current);
  return (
    <Card title={f.title}
      footer={
        <div className="fh-fig-foot">
          <span className="fh-fig-n ui-mono">Figure {n + 1}</span>
          <button ref={button} type="button" className="ui-btn ui-btn-ghost fh-fig-open" onClick={open} aria-haspopup="dialog"
            aria-label={`View figure ${n + 1} larger: ${f.title}`}>
            <IconSearch size={15} />View larger
          </button>
        </div>
      }>
      <figure className="fh-fig">
        {/* The picture opens the lightbox on a click too; keyboard users have the button below. */}
        <div className="fh-fig-plate" style={{ aspectRatio: `${f.w} / ${f.h}` }} onClick={open}>
          <img src={src(f)} alt={f.alt} width={f.w} height={f.h} loading="lazy" decoding="async" />
          <span className="fh-fig-zoom" aria-hidden="true"><IconSearch size={16} /></span>
        </div>
        <figcaption className="fh-fig-caption">{f.caption}</figcaption>
      </figure>
    </Card>
  );
}

function Lightbox({ figures, index, onIndex, onClose }: {
  figures: FigureItem[]; index: number | null; onIndex: (i: number) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [shown, setShown] = useState<number | null>(index);
  if (index !== null && index !== shown) setShown(index);   // keep the last figure while the dialog closes
  const f = shown !== null ? figures[shown] : undefined;
  const isOpen = index !== null;
  const many = figures.length > 1;   // one picture: no previous and next, and no count "of 1"

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (isOpen && !d.open) {
      d.showModal();
      document.documentElement.classList.add('fh-lightbox-open');
      closeBtn.current?.focus();
    } else if (!isOpen && d.open) {
      d.close();
    }
    if (!isOpen) document.documentElement.classList.remove('fh-lightbox-open');
  }, [isOpen]);
  useEffect(() => () => document.documentElement.classList.remove('fh-lightbox-open'), []);

  const step = (by: number) => {
    if (index === null || !many) return;
    onIndex((index + by + figures.length) % figures.length);
  };

  return (
    <dialog ref={dialog} className="fh-lightbox" aria-labelledby="fh-lightbox-title" aria-describedby="fh-lightbox-caption"
      onClose={() => { if (index !== null) onClose(); }}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      }}>
      {f ? (
        <div className="fh-lightbox-panel">
          <div className="fh-lightbox-head">
            <div className="fh-lightbox-titles">
              <p className="fh-lightbox-count ui-mono">Figure {(shown ?? 0) + 1}{many ? ` of ${figures.length}` : ''}</p>
              <h2 id="fh-lightbox-title" className="fh-lightbox-title">{f.title}</h2>
            </div>
            <div className="fh-lightbox-tools">
              <a className="ui-btn ui-btn-ghost" href={src(f)} target="_blank" rel="noreferrer">
                <IconExternal size={15} />Open the image file
              </a>
              <Tooltip content="Close the figure" keys={['Esc']}>
                <button ref={closeBtn} type="button" className="ui-btn ui-btn-icon" aria-label="Close the figure" onClick={onClose}>
                  <IconClose size={18} />
                </button>
              </Tooltip>
            </div>
          </div>
          <div className="fh-lightbox-stage"
            onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }}
            onPointerUp={(e) => {
              const s = swipe.current;
              swipe.current = null;
              if (!s || e.pointerType === 'mouse') return;
              const dx = e.clientX - s.x, dy = e.clientY - s.y;
              if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
            }}>
            {many ? (
              <Tooltip content="Previous figure" keys={['←']}>
                <button type="button" className="ui-btn ui-btn-icon fh-lightbox-nav fh-lightbox-prev" aria-label="Previous figure"
                  onClick={() => step(-1)}>
                  <IconChevronLeft size={20} />
                </button>
              </Tooltip>
            ) : null}
            <div className="fh-lightbox-plate" key={f.id}>
              <img src={src(f)} alt={f.alt} width={f.w} height={f.h} decoding="async" />
            </div>
            {many ? (
              <Tooltip content="Next figure" keys={['→']}>
                <button type="button" className="ui-btn ui-btn-icon fh-lightbox-nav fh-lightbox-next" aria-label="Next figure"
                  onClick={() => step(1)}>
                  <IconChevronRight size={20} />
                </button>
              </Tooltip>
            ) : null}
          </div>
          <div className="fh-lightbox-foot">
            <p id="fh-lightbox-caption" className="fh-lightbox-caption">{f.caption}</p>
            <p className="fh-lightbox-keys" aria-hidden="true">
              {many ? <span><kbd className="ui-kbd">←</kbd><kbd className="ui-kbd">→</kbd> other figures</span> : null}
              <span><kbd className="ui-kbd">Esc</kbd> close</span>
            </p>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
