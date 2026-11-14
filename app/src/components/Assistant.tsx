// The "Ask" panel: a chat drawer on the right, on every page, opened from the header. Answers come from the app's
// data through the assistant (lib/assistant.ts); each answer offers the places it used as links into the Explorer.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ask, AssistantError, type Step, type Turn, type View } from '../lib/assistant.ts';
import { IconClose, IconMap, IconSend, IconSparkle } from './icons.tsx';
import { Tooltip } from './Tooltip.tsx';
import '../styles/assistant.css';

interface Msg { who: 'you' | 'ai'; text: string; views?: View[]; error?: boolean }

const SUGGEST = [
  'How bad was fire in Central Kalimantan in October 2026?',
  'Which countries have the fastest rising fire?',
  'Compare fire in Riau in 2015 and 2019',
  'What is the outlook for Indonesia next month?',
];
const STEP: Record<Step, string> = { find: 'Finding the place', facts: 'Reading the numbers', history: 'Reading the record', rank: 'Ranking the places',
  wait: 'The free quota is busy, waiting a few seconds' };
const FAIL = {
  busy: 'Many questions right now (the free Gemini quota is shared). Please try again in a minute.',
  quota: "Today's free AI quota is used up. It renews at midnight Pacific time (4 pm in Malaysia). Meanwhile, the search (Ctrl K) opens any place with all its numbers.",
  offline: 'The assistant cannot be reached. Check the connection, or use the search (Ctrl K).',
  failed: 'Something went wrong on the way. Please ask again.',
};

/** **bold** and lists, nothing else: safe text, no HTML from the model. */
function Rich({ text }: { text: string }) {
  const inline = (s: string, k: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/g).map((x, i) =>
    x.startsWith('**') && x.endsWith('**') ? <strong key={`${k}${i}`}>{x.slice(2, -2)}</strong> : x);
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={`l${blocks.length}`}>{list.map((l, i) => <li key={i}>{inline(l, `li${i}`)}</li>)}</ul>); list = []; } };
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { list.push(m[1]); continue; }
    flush();
    if (line.trim()) blocks.push(<p key={`p${blocks.length}`}>{inline(line.replace(/^#+\s*/, ''), `p${blocks.length}`)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

// open or closed, shared by the header button and the panel (the panel lives outside the header, which can slide away)
let isOpen = false;
const subs = new Set<() => void>();
export function setAskOpen(v: boolean) { if (v !== isOpen) { isOpen = v; for (const f of subs) f(); } }
export const useAskOpen = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => isOpen, () => false);

export function AskButton() {
  const open = useAskOpen();
  return (
    <Tooltip content="Ask Fire Harmony (AI)" describe={false}>
      <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon fh-ask-btn ui-press" aria-label="Ask Fire Harmony (AI)" aria-expanded={open}
        aria-controls="fh-ask" onClick={() => setAskOpen(!open)}>
        <IconSparkle size={18} />
      </button>
    </Tooltip>
  );
}

export function Assistant() {
  const open = useAskOpen();
  const onClose = () => setAskOpen(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const history = useRef<Turn[]>([]);
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 60); }, [open]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [msgs, busy]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setDraft('');
    setMsgs((m) => [...m, { who: 'you', text: question }]);
    setBusy('Thinking');
    const ctl = new AbortController(); abort.current = ctl;
    const keep = history.current.length;
    try {
      const r = await ask(history.current, question, (s, label) => setBusy(label ? `${STEP[s]}: ${label}` : STEP[s]), ctl.signal);
      setMsgs((m) => [...m, { who: 'ai', text: r.text, views: r.views }]);
    } catch (e) {
      history.current.length = keep;       // a failed question leaves no half turn behind
      if ((e as Error).name !== 'AbortError') setMsgs((m) => [...m, { who: 'ai', text: FAIL[e instanceof AssistantError ? e.kind : 'failed'], error: true }]);
    } finally { setBusy(null); abort.current = null; }
  }

  function reset() { abort.current?.abort(); history.current = []; setMsgs([]); setBusy(null); input.current?.focus(); }

  return (
    <aside id="fh-ask" className="fh-ask" data-open={open ? '' : undefined} aria-label="Ask Fire Harmony" aria-hidden={!open} inert={!open}>
      <header className="fh-ask-head">
        <span className="fh-ask-mark" aria-hidden="true"><IconSparkle size={18} /></span>
        <div className="fh-ask-title"><strong>Ask Fire Harmony</strong><span>Answers from this app's data</span></div>
        {msgs.length ? <button type="button" className="ui-btn ui-btn-ghost fh-ask-new" onClick={reset}>New chat</button> : null}
        <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon" aria-label="Close" onClick={onClose}><IconClose size={18} /></button>
      </header>
      <div ref={list} className="fh-ask-list" aria-live="polite">
        {!msgs.length ? (
          <div className="fh-ask-empty">
            <p>Ask about fire anywhere on Earth, from 2000 to October 2026: how unusual a month was, a place's worst years, its trend, its outlook, or which places rank highest.</p>
            <div className="fh-ask-suggest">
              {SUGGEST.map((s) => <button key={s} type="button" className="fh-ask-chip ui-press" onClick={() => void send(s)}>{s}</button>)}
            </div>
          </div>
        ) : msgs.map((m, i) => (
          <div key={i} className={`fh-ask-msg fh-ask-${m.who}`} data-error={m.error ? '' : undefined}>
            {m.who === 'ai' ? <Rich text={m.text} /> : <p>{m.text}</p>}
            {m.views?.length ? (
              <div className="fh-ask-views">
                {m.views.map((v) => (
                  <a key={v.link} className="fh-ask-view ui-press" href={v.link} onClick={() => { if (window.innerWidth < 760) onClose(); }}>
                    <IconMap size={14} />Open {v.label}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {busy ? <div className="fh-ask-msg fh-ask-ai fh-ask-busy" role="status"><span className="fh-ask-dots" aria-hidden="true"><i /><i /><i /></span>{busy}…</div> : null}
      </div>
      <form className="fh-ask-form" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
        <textarea ref={input} rows={1} value={draft} placeholder="Ask about any place or year…" aria-label="Your question" maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(draft); } }} />
        <button type="submit" className="ui-btn ui-btn-primary ui-btn-icon fh-ask-send" aria-label="Send" disabled={!draft.trim() || Boolean(busy)}>
          <IconSend size={18} />
        </button>
      </form>
      <p className="fh-ask-note">AI answers, written by Google Gemini (free tier; Google may use questions to improve its products) from Fire Harmony's numbers. Check them on the map.</p>
    </aside>
  );
}
