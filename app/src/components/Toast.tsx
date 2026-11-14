// Short confirmations ("CSV saved", "Link copied") in the corner (at the bottom on a phone), announced to screen
// readers. Wrap the app in <ToastProvider> and call useToast()("Link copied"). A toast rises in, stays 3.6 s and
// fades out a little faster than it came. On the Explorer the toasts ride above the timeline dock (and the phone
// sheet): the Explorer sets --fh-toast-lift on the page, explorer.css adds it to their place.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { IconCheck, IconInfo } from './icons';

type Tone = 'success' | 'info';
interface Item { id: number; text: string; tone: Tone; leaving: boolean }
const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => undefined);

const SHOWN = 3600, EXIT = 160;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, tone: Tone = 'success') => {
    const id = ++seq.current;
    setItems((xs) => [...xs.filter((x) => !x.leaving).slice(-2), { id, text, tone, leaving: false }]);
    window.setTimeout(() => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, leaving: true } : x))), SHOWN);
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), SHOWN + EXIT);
  }, []);
  return (
    <ToastContext value={push}>
      {children}
      <div className="ui-toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`ui-toast ui-toast-${t.tone}${t.leaving ? ' is-leaving' : ''}`}>
            <span className="ui-toast-icon" aria-hidden="true">{t.tone === 'success' ? <IconCheck size={14} /> : <IconInfo size={14} />}</span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
