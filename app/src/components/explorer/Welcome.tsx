// The card of a first visit, at the top of the area panel (in the sheet on phones) while the world is shown: what a
// hexagon and "normal" mean, the three steps of the Explorer, and three stories to start from. Closing it is kept in
// localStorage (fh_welcome_seen), so it does not come back.
import { useI18n } from '../../lib/i18n';
import { Tooltip } from '../Tooltip';
import { IconChevronRight, IconClose } from '../icons';

const SEEN_KEY = 'fh_welcome_seen';

/** Whether the card was closed before (a private window that cannot keep it shows the card each visit). */
export function welcomeSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}

/** The stories it offers: a place, a month and the tab that tells it. */
const STORIES = [
  { key: 'kalimantan', href: '#/?area=state:IDN-1931&month=201509&tab=calendar' },
  { key: 'corrientes', href: '#/?area=state:ARG-1308&month=202202&tab=calendar' },
  { key: 'kualaLumpur', href: '#/haze?city=Kuala+Lumpur' },
] as const;

export function Welcome({ onClose }: { onClose(): void }) {
  const { t } = useI18n();
  const w = t.ex.welcome;
  const close = () => {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: closed for this visit */ }
    onClose();
  };
  return (
    <section className="fh-ex-welcome" aria-labelledby="fh-ex-welcome-title" data-welcome="">
      <div className="fh-ex-welcome-head">
        <h2 id="fh-ex-welcome-title" className="fh-ex-welcome-title">{w.title}</h2>
        <Tooltip content={w.close}>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon fh-ex-welcome-close" aria-label={w.close} onClick={close}>
            <IconClose size={16} />
          </button>
        </Tooltip>
      </div>
      <p className="fh-ex-welcome-lead">{w.lead}</p>
      <ol className="fh-ex-welcome-steps" aria-label={w.stepsLabel}>
        {w.steps.map((s, i) => (
          <li key={s}><span className="fh-ex-welcome-n ui-mono" aria-hidden="true">{i + 1}</span>{s}</li>
        ))}
      </ol>
      <p className="fh-ex-welcome-start">{w.start}</p>
      <ul className="fh-ex-welcome-stories">
        {STORIES.map((s) => (
          <li key={s.key}>
            <a className="fh-ex-welcome-story ui-press" href={s.href} data-story={s.key}>
              <span>{w.stories[s.key]}</span><IconChevronRight size={15} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
