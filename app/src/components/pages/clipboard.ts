// Copy text to the clipboard and confirm it with a toast ("Citation copied").
import { useToast } from '../Toast';

/** Copies text. Uses the clipboard API where it is allowed, else a hidden text box. Focus stays where it was. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  box.style.position = 'fixed';
  box.style.top = '0';
  box.style.opacity = '0';
  document.body.appendChild(box);
  box.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  box.remove();
  before?.focus({ preventScroll: true });
  return ok;
}

/** Copies, then confirms with a toast. Resolves to whether it worked. */
export function useCopy(): (text: string, done: string) => Promise<boolean> {
  const toast = useToast();
  return async (text, done) => {
    const ok = await copyText(text);
    toast(ok ? done : 'Could not copy. Select the text and copy it by hand.', ok ? 'success' : 'info');
    return ok;
  };
}
