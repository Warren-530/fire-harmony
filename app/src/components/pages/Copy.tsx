// A copy button: copies a text, then for 1.5 s its icon turns to a check and its label to "Copied" (a 140 ms
// crossfade; the button keeps its width), and a toast confirms it ("Citation copied"). The toast region is polite
// live (Toast.tsx), so screen readers hear the confirmation once. One look everywhere: a ghost button at the top right
// of the block it copies (styles: .fh-copy in pages.css). In a code bar on a narrow phone it shows its icon only, so it
// keeps its corner; it then has a tooltip (tip) and its aria-label.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconCheck, IconCopy } from '../icons';
import { Tooltip } from '../Tooltip';
import { useCopy } from './clipboard';

const SHOWN_MS = 1500;

/** A button that copies `text` (or the result of `text()`), shows "Copied" for a moment and a toast. */
export function CopyButton({ text, done, label = 'Copy', ariaLabel, className = '', icon = true, tip, children }: {
  text: string | (() => string); done: string; label?: string; ariaLabel?: string; className?: string; icon?: boolean;
  tip?: string; children?: ReactNode;
}) {
  const copy = useCopy();
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onClick = async () => {
    const ok = await copy(typeof text === 'function' ? text() : text, done);
    if (!ok) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), SHOWN_MS);
  };
  const button = (
    <button type="button" className={`ui-btn fh-copy ${className}`.trim()} onClick={onClick} aria-label={ariaLabel}
      data-copied={copied ? '' : undefined}>
      <span className="fh-copy-faces">
        <span className="fh-copy-face" data-on={copied ? undefined : ''}>{icon ? <IconCopy size={16} /> : null}<span className="fh-copy-text">{children ?? label}</span></span>
        <span className="fh-copy-face" data-on={copied ? '' : undefined}>{icon ? <IconCheck size={16} /> : null}<span className="fh-copy-text">Copied</span></span>
      </span>
    </button>
  );
  return tip ? <Tooltip content={tip}>{button}</Tooltip> : button;
}
