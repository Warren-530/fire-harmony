// One icon set for the whole app: simple 24 x 24 outline icons drawn for Fire Harmony (stroke follows currentColor).
// Use them with a visible label or an aria-label on the button; the SVG itself is hidden from screen readers.
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export const IconSearch = (p: IconProps) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></Svg>;
export const IconPlay = (p: IconProps) => <Svg {...p}><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" /></Svg>;
export const IconPause = (p: IconProps) => <Svg {...p}><path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor" stroke="none" /></Svg>;
export const IconStepBack = (p: IconProps) => <Svg {...p}><path d="M18 6v12l-9-6zM6 6v12" /></Svg>;
export const IconStepForward = (p: IconProps) => <Svg {...p}><path d="M6 6v12l9-6zM18 6v12" /></Svg>;
export const IconChevronLeft = (p: IconProps) => <Svg {...p}><path d="m15 5-7 7 7 7" /></Svg>;
export const IconChevronRight = (p: IconProps) => <Svg {...p}><path d="m9 5 7 7-7 7" /></Svg>;
export const IconChevronDown = (p: IconProps) => <Svg {...p}><path d="m5 9 7 7 7-7" /></Svg>;
export const IconChevronUp = (p: IconProps) => <Svg {...p}><path d="m5 15 7-7 7 7" /></Svg>;
export const IconClose = (p: IconProps) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const IconLayers = (p: IconProps) => <Svg {...p}><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></Svg>;
export const IconCube = (p: IconProps) => <Svg {...p}><path d="m12 2.8 8 4.6v9.2l-8 4.6-8-4.6V7.4z" /><path d="m4 7.4 8 4.6 8-4.6M12 12v9.2" /></Svg>;
export const IconMap = (p: IconProps) => <Svg {...p}><path d="m9 4-5 2v14l5-2 6 2 5-2V4l-5 2z" /><path d="M9 4v14M15 6v14" /></Svg>;
export const IconGlobe = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9S14.6 18.4 12 21c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" /></Svg>;
export const IconDownload = (p: IconProps) => <Svg {...p}><path d="M12 4v11M7 10.5 12 15l5-4.5M5 19.5h14" /></Svg>;
export const IconInfo = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6v.1" /></Svg>;
export const IconExternal = (p: IconProps) => <Svg {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" /></Svg>;
export const IconFlame = (p: IconProps) => <Svg {...p}><path d="M12 3c1.5 3.4 5.5 5.6 5.5 10.2a5.5 5.5 0 0 1-11 0c0-2.3 1.2-3.9 2.4-5 .2 1.7 1 2.8 2.2 3.3C10.6 8.8 11 6 12 3z" /></Svg>;
export const IconCalendar = (p: IconProps) => <Svg {...p}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></Svg>;
export const IconChart = (p: IconProps) => <Svg {...p}><path d="M4 19.5h16M7 16V10M12 16V5M17 16v-4" /></Svg>;
export const IconActivity = (p: IconProps) => <Svg {...p}><path d="M3 12h4l2.5-6 5 12 2.5-6h4" /></Svg>;
export const IconWind = (p: IconProps) => <Svg {...p}><path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h8" /></Svg>;
export const IconBook = (p: IconProps) => <Svg {...p}><path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h10" /></Svg>;
export const IconDatabase = (p: IconProps) => <Svg {...p}><ellipse cx="12" cy="6" rx="7" ry="2.8" /><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" /></Svg>;
export const IconDashboard = (p: IconProps) => <Svg {...p}><rect x="3.5" y="3.5" width="7" height="9" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="5" rx="1.5" /><rect x="13.5" y="11.5" width="7" height="9" rx="1.5" /><rect x="3.5" y="15.5" width="7" height="5" rx="1.5" /></Svg>;
export const IconRanking = (p: IconProps) => <Svg {...p}><path d="M9 6h11M9 12h7M9 18h4" /><path d="M4 5.5v1M4 11.5v1M4 17.5v1" /></Svg>;
export const IconFilter = (p: IconProps) => <Svg {...p}><path d="M4 6h16M7 12h10M10 18h4" /></Svg>;
export const IconKeyboard = (p: IconProps) => <Svg {...p}><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h.1M10 10h.1M14 10h.1M18 10h.1M7 14h10" /></Svg>;
export const IconSun = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></Svg>;
export const IconMoon = (p: IconProps) => <Svg {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></Svg>;
export const IconCommand = (p: IconProps) => <Svg {...p}><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" /></Svg>;
export const IconTarget = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" /></Svg>;
export const IconSquare = (p: IconProps) => <Svg {...p}><rect x="4.5" y="4.5" width="15" height="15" rx="1" strokeDasharray="3 2.4" /></Svg>;
export const IconPolygon = (p: IconProps) => <Svg {...p}><path d="m12 3.5 8.5 6.2-3.3 9.8H6.8L3.5 9.7z" /></Svg>;
export const IconCircle = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="8" /><path d="M12 12h8" /><circle cx="12" cy="12" r="1" fill="currentColor" /></Svg>;
export const IconArrowUp = (p: IconProps) => <Svg {...p}><path d="M7 17 17 7M9 7h8v8" /></Svg>;
export const IconArrowDown = (p: IconProps) => <Svg {...p}><path d="M7 7l10 10M17 9v8H9" /></Svg>;
export const IconMinus = (p: IconProps) => <Svg {...p}><path d="M5 12h14" /></Svg>;
export const IconPlus = (p: IconProps) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconAlert = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="9.5" /><path d="M12 7v6M12 16.5v.5" /></Svg>;
export const IconCheck = (p: IconProps) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const IconCopy = (p: IconProps) => <Svg {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></Svg>;
export const IconSettings = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>;
export const IconMenu = (p: IconProps) => <Svg {...p}><path d="M4 7h16M4 12h16M4 17h10" /></Svg>;
export const IconReport = (p: IconProps) => <Svg {...p}><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><path d="M14 3.5v5h5M8.5 12.5h7M8.5 16h5" /></Svg>;
export const IconPoster = (p: IconProps) => <Svg {...p}><rect x="4.5" y="3.5" width="15" height="17" rx="2" /><path d="m4.5 15 4-4 3.5 3.5 2.5-2.5 5 5" /><circle cx="14.5" cy="8" r="1.5" /></Svg>;
export const IconSparkle = (p: IconProps) => <Svg {...p}><path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z" /><path d="M18.5 15.5c.25 1.6 1.1 2.45 2.7 2.7-1.6.25-2.45 1.1-2.7 2.7-.25-1.6-1.1-2.45-2.7-2.7 1.6-.25 2.45-1.1 2.7-2.7z" /></Svg>;
export const IconSend = (p: IconProps) => <Svg {...p}><path d="M5 12h13M12.5 6 18.5 12l-6 6" /></Svg>;
export const IconCode = (p: IconProps) => <Svg {...p}><path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15" /></Svg>;
