// The platform, for key hints: Apple keyboards show ⌘ where others show Ctrl.
interface NavigatorUAData { platform?: string }

/** True on macOS, iOS and iPadOS. */
export function isApple(): boolean {
  if (typeof navigator === 'undefined') return false;
  const p = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(p);
}

/** The name of the command key: '⌘' on Apple keyboards, 'Ctrl' elsewhere. */
export const MOD_KEY: string = isApple() ? '⌘' : 'Ctrl';
