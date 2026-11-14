// Keyboard shortcuts dialog: opens with "?" (or the palette action), closes with Escape or a click outside.
import { useEffect, useRef, useState } from 'react';
import { useCommand } from '../lib/commands';
import { IconClose } from './icons';
import { MOD_KEY } from './platform';

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  { title: 'Anywhere', rows: [[[MOD_KEY, 'K'], 'Go to a place, a page or an action'], [['/'], 'Find a place (on the map, the panel search)'], [['T'], 'Switch light or dark'], [['?'], 'This list']] },
  { title: 'Explorer', rows: [
    [['Space'], 'Play or pause the months'], [['←', '→'], 'Previous or next month'], [['Shift', '←'], 'One year back'],
    [['Shift', '→'], 'One year forward'], [['D'], 'Switch 2D or 3D hexagons'], [['C'], 'Colour by fire count'], [['A'], 'Colour against normal'], [['R'], 'Colour by trend, 2001 to 2025'],
    [['+', '−'], 'Zoom the map in or out'], [['Esc'], 'Close map settings or cancel drawing'],
  ] },
];

export function Shortcuts() {
  const [open, setOpen] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useCommand((c) => { if (c.action === 'show-shortcuts') setOpen(true); });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (typing) return;
      if (e.key === '?') { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (open) closeBtn.current?.focus(); }, [open]);
  if (!open) return null;
  return (
    <div className="ui-palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="ui-palette ui-shortcuts" role="dialog" aria-modal="true" aria-labelledby="fh-shortcuts-title">
        <div className="ui-shortcuts-head">
          <h2 id="fh-shortcuts-title">Keyboard shortcuts</h2>
          <button ref={closeBtn} type="button" className="ui-btn ui-btn-ghost ui-btn-icon" aria-label="Close the shortcuts" onClick={() => setOpen(false)}>
            <IconClose />
          </button>
        </div>
        <div className="ui-shortcuts-body">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.rows.map(([keys, what]) => (
                  <div key={what}>
                    <dt>{keys.map((k) => <kbd key={k} className="ui-kbd">{k}</kbd>)}</dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
