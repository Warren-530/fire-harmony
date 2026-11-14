// Code examples: a few tabs (DuckDB SQL, Python...), quiet syntax colours from the theme, and a copy button.
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CopyButton } from './Copy';

export type Lang = 'sql' | 'python' | 'js';
export interface CodeSample { id: string; label: string; lang: Lang; code: string; done: string }

const SQL_WORDS = new Set(['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'ORDER', 'GROUP', 'BY', 'AS', 'BETWEEN', 'IN',
  'LIMIT', 'JOIN', 'ON', 'WITH', 'DESC', 'ASC', 'IS', 'NULL', 'INSTALL', 'LOAD', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END']);
const PY_WORDS = new Set(['import', 'from', 'as', 'def', 'return', 'for', 'in', 'if', 'else', 'with', 'print', 'None', 'True', 'False', 'and', 'or', 'not', 'is', 'lambda']);
const JS_WORDS = new Set(['const', 'let', 'await', 'async', 'return', 'new', 'of', 'in', 'if', 'else', 'null', 'true', 'false', 'function', 'import', 'from']);

const RULES: Record<Lang, RegExp> = {
  // comment | string | number | word (a word followed by "(" is a function)
  sql: /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g,
  python: /(#[^\n]*)|([rf]?"""[\s\S]*?"""|[rf]?"[^"\n]*"|[rf]?'[^'\n]*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g,
  js: /(\/\/[^\n]*)|(`[^`]*`|"[^"\n]*"|'[^'\n]*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)/g,
};

/** Splits code into coloured spans (comments, strings, numbers, keywords, functions). */
function highlight(code: string, lang: Lang): ReactNode[] {
  const out: ReactNode[] = [];
  const words = lang === 'sql' ? SQL_WORDS : lang === 'js' ? JS_WORDS : PY_WORDS;
  const re = new RegExp(RULES[lang]);
  let last = 0, k = 0;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const [text, comment, str, number, word] = m;
    let cls: string | null = null;
    if (comment) cls = 'fh-code-comment';
    else if (str) cls = 'fh-code-string';
    else if (number) cls = 'fh-code-number';
    else if (word && (lang === 'sql' ? words.has(word.toUpperCase()) && word === word.toUpperCase() : words.has(word))) cls = 'fh-code-key';
    else if (word && code[re.lastIndex] === '(') cls = 'fh-code-fn';
    out.push(cls ? <span key={k++} className={cls}>{text}</span> : text);
    last = re.lastIndex;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function CodeBlock({ samples, label }: { samples: CodeSample[]; label: string }) {
  const [tab, setTab] = useState(0);
  const base = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const s = samples[tab] ?? samples[0];
  if (!s) return null;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const n = (tab + step + samples.length) % samples.length;
    setTab(n);
    tabs.current[n]?.focus();
  };
  return (
    <div className="fh-code-box">
      <div className="fh-code-bar">
        {samples.length > 1 ? (
          <div className="ui-tabs fh-code-tabs ui-scroll-fade" role="tablist" aria-label={label} onKeyDown={onKey}>
            {samples.map((x, i) => (
              <button key={x.id} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" className="ui-tab"
                id={`${base}-tab-${i}`} aria-selected={i === tab} aria-controls={`${base}-panel`} tabIndex={i === tab ? 0 : -1}
                onClick={() => setTab(i)}>
                {x.label}
              </button>
            ))}
          </div>
        ) : <p className="fh-code-label">{s.label}</p>}
        <CopyButton text={s.code} done={s.done} className="ui-btn-ghost fh-code-copy" ariaLabel={`Copy the ${s.label} example`} tip={`Copy the ${s.label} example`} />
      </div>
      <pre id={`${base}-panel`} className="fh-code" tabIndex={0} role={samples.length > 1 ? 'tabpanel' : undefined}
        aria-labelledby={samples.length > 1 ? `${base}-tab-${tab}` : undefined} aria-label={samples.length > 1 ? undefined : label}>
        <code>{highlight(s.code, s.lang)}</code>
      </pre>
    </div>
  );
}
