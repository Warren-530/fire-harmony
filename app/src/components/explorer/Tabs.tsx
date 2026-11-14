// Tabs of the area panel (.ui-tabs): arrow keys, Home and End move between them and show the tab at once. The strip
// sits in a frosted bar (.fh-ex-tabbar holds the background, so the strip itself can fade at an edge that has more
// tabs to show), and the picked tab scrolls fully into view. The panel slides in from the side of the tab that was
// picked (from the right when it lies to the right of the last one), unless motion is reduced.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useScrollEnds } from '../ScrollFade';

export interface TabItem<K extends string> { key: K; label: string; icon?: ReactNode }

export const tabId = (base: string, key: string) => `${base}-tab-${key}`;
export const panelId = (base: string, key: string) => `${base}-panel-${key}`;

export function Tabs<K extends string>({ label, items, value, onChange, idBase }: {
  label: string; items: readonly TabItem<K>[]; value: K; onChange(key: K): void; idBase: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const ends = useScrollEnds(strip);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((it) => it.key === value);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = items.length - 1;
    if (n < 0) return;
    e.preventDefault();
    onChange(items[n].key);
    refs.current[n]?.focus();
  };
  // the picked tab is always whole in view (a strip that scrolls on a narrow screen)
  useEffect(() => {
    const i = items.findIndex((it) => it.key === value);
    const el = refs.current[i];
    if (!el || !strip || strip.scrollWidth <= strip.clientWidth + 1) return;
    const l = el.offsetLeft, r = l + el.offsetWidth;
    if (l < strip.scrollLeft) strip.scrollLeft = l - 8;
    else if (r > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = r - strip.clientWidth + 8;
  }, [value, items, strip]);
  return (
    <div className="fh-ex-tabbar" data-more={ends.start || ends.end ? '' : undefined}>
      <div ref={setStrip} className="ui-tabs fh-ex-tabs ui-scroll-x" role="tablist" aria-label={label} onKeyDown={onKey}>
        {items.map((it, i) => (
          <button key={it.key} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" className="ui-tab"
            id={tabId(idBase, it.key)} aria-controls={panelId(idBase, it.key)} aria-selected={it.key === value}
            tabIndex={it.key === value ? 0 : -1} onClick={() => onChange(it.key)}>
            {it.icon}
            <span>{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The panel of the tab in view. `from` is the side its content slides in from (none on the first show). */
export function TabPanel({ idBase, tab, from = null, children }: {
  idBase: string; tab: string; from?: 'left' | 'right' | null; children: ReactNode;
}) {
  return (
    <div key={tab} role="tabpanel" id={panelId(idBase, tab)} aria-labelledby={tabId(idBase, tab)} className="fh-ex-tabpanel"
      data-from={from ?? undefined} tabIndex={0}>
      {children}
    </div>
  );
}
