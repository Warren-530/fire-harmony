// Numbers, months and sizes for people, for the Methods, Data and Haze pages (British English, true minus signs).
// The published numbers are already rounded (dashboard.json keeps 2 to 4 digits), so a value that sits exactly on a
// half step gets one more digit instead of being rounded a second time: 0.85 stays "0.85", never "0.8" or "0.9".

const LOCALE = 'en-GB';
const formats = new Map<string, Intl.NumberFormat>();

function nf(digits: number, signed: boolean): Intl.NumberFormat {
  const key = `${digits}:${signed}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: signed ? 'exceptZero' : 'auto',
    });
    formats.set(key, f);
  }
  return f;
}

const minus = (s: string): string => s.replace(/-/g, '−');

/** The digits to show: one more when the value sits on a half step at `digits` (it was rounded before). */
function safeDigits(v: number, digits: number): number {
  const scaled = Math.abs(v) * 10 ** digits;
  return Math.abs(scaled - Math.floor(scaled) - 0.5) < 1e-6 ? digits + 1 : digits;
}

/** A number with fixed decimals: num(8.406, 1) -> "8.4"; num(-0.655, 2) -> "−0.655". */
export function num(v: number, digits = 0, signed = false): string {
  return minus(nf(safeDigits(v, digits), signed).format(v));
}

/** A value already in percent: pct(37.8) -> "37.8%"; pct(0.55, 1, true) -> "+0.55%". */
export function pct(v: number, digits = 1, signed = false): string {
  return `${num(v, digits, signed)}%`;
}

/** A share from 0 to 1 as a percent: share(0.44) -> "44%"; share(0.0145, 1) -> "1.45%". */
export function share(v: number, digits = 0): string {
  return pct(v * 100, digits);
}

/** A count for people: 443 million, 1.33 million, 4,333. */
export function count(v: number): string {
  const sig = (x: number) => minus(new Intl.NumberFormat(LOCALE, { maximumSignificantDigits: 3 }).format(x));
  const a = Math.abs(v);
  if (a >= 1e9) return `${sig(v / 1e9)} billion`;
  if (a >= 1e6) return `${sig(v / 1e6)} million`;
  return minus(new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(v));
}

/** Millions with three figures, for a column that says "in millions": 18270924 -> "18.3", 2163000 -> "2.16". */
export function millions(v: number): string {
  return minus(new Intl.NumberFormat(LOCALE, { maximumSignificantDigits: 3, minimumSignificantDigits: 3 }).format(v / 1e6));
}

/** A whole number with thousands separators: 13654998 -> "13,654,998". */
export function int(v: number): string {
  return minus(new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(v));
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'] as const;

/** yyyymm -> "October 2026". */
export function monthName(yyyymm: number): string {
  return `${MONTHS[(yyyymm % 100) - 1] ?? ''} ${Math.floor(yyyymm / 100)}`;
}

/** yyyymm -> "Oct 2026". */
export function monthShort(yyyymm: number): string {
  return `${(MONTHS[(yyyymm % 100) - 1] ?? '').slice(0, 3)} ${Math.floor(yyyymm / 100)}`;
}

/** yyyymm plus n months. */
export function addMonths(yyyymm: number, n: number): number {
  const t = Math.floor(yyyymm / 100) * 12 + (yyyymm % 100) - 1 + n;
  return Math.floor(t / 12) * 100 + (t % 12) + 1;
}

/** Number of months from a to b, both included. */
export function monthsBetween(a: number, b: number): number {
  return (Math.floor(b / 100) - Math.floor(a / 100)) * 12 + (b % 100) - (a % 100) + 1;
}

/** yyyymm -> a fractional year for a time axis (the start of that month). */
export function yearOf(yyyymm: number): number {
  return Math.floor(yyyymm / 100) + ((yyyymm % 100) - 1) / 12;
}

/**
 * A file size for people: 7.39 MB -> "7.4 MB", 44836 bytes -> "45 kB", 250.4 MB -> "250 MB", 6.48 GB -> "6.5 GB"
 * (plain rounding; from 999.5 MB on in GB, so it never shows "1,000 MB").
 */
export function fileSize(bytes: number): string {
  const f = (v: number, d: number) => new Intl.NumberFormat(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  const mb = bytes / 1e6;
  if (mb >= 999.5) { const gb = bytes / 1e9; return `${f(gb, gb >= 99.95 ? 0 : 1)} GB`; }
  if (mb >= 100) return `${f(mb, 0)} MB`;
  if (mb >= 1) return `${f(mb, 1)} MB`;
  const kb = bytes / 1e3;
  return kb >= 1 ? `${f(kb, 0)} kB` : `${int(bytes)} bytes`;
}

/** How to read a trend per decade (Methods, and the tooltip of every trend label): Sen's slope of the logarithm. */
export const TREND_LOG_NOTE = 'We fit Sen’s slope to the logarithm of yearly fire, so −76% per decade means each decade ends with about a quarter of the fire it started with.';

/** The two totals of the record, said the same way on the Dashboard, the Data page and the hub: every raw detection
 *  of five satellites (meta.json files.hotspots.rows) and the harmonized hotspots (dashboard.json record.hotspots_total). */
export const TOTALS = {
  read: 'Detections read',
  scale: 'Hotspots on the NOAA‑20 scale',
  readValue: (rows: number): string => `${num(rows / 1e6, 1)} million`,
  link: (read: string, scale: string): string => `All ${read} detections of five satellites were read. On the scale of one NOAA‑20 VIIRS satellite, where more satellites never means more fire, they make ${scale} hotspots.`,
};
