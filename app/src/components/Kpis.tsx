// At a glance: a compact strip of three numbers under the area's name (the month on the map against normal, the year
// to that month, and the trend of yearly fire), each a button that opens the tab that tells more; and the same
// numbers in words with every detail (rank, normals, the test of the trend, the critical period) at the top of the
// Overview tab. Always on the harmonized record; the numbers glide when the month or the area changes.
//
// The trend says only what the data can support, in one word shared with the Dashboard, Rankings and the trend map
// (lib/stats.ts trendVerdict, the report's rules): a named place or a hexagon over 2001 to 2025 takes the verdict of
// its published file (web/places.json, web/trend_l3.json or trend_l4.json), so a fall that does not hold once all the
// places of its kind are tested together reads "Not clear", and a named place under 1,000 hotspots a year "Not tested";
// a drawn area or a city circle has its own test: under 100 hotspots a year no trend is read, from 100 to 1,000 a rise
// or a fall is shown with a caution.
import { useMemo, type ReactNode } from 'react';
import {
  annualTotals, anomalies, comparedWithNormal, countText, criticalMonths, latestCompleteMonth, littleFire, monthRuns, ratioDirection,
  season, shortAgainstNormal, trendText, trendVerdict, yearToMonth, LITTLE_FIRE_NORMAL, type FamilyTest, type TrendVerdict,
  type YearToDate,
} from '../lib/stats';
import { DICTS, countParts, formatMonth, useI18n, type Dict, type Lang } from '../lib/i18n';
import type { Anomaly, MonthlyPoint } from '../lib/types';
import { AnimatedNumber } from './AnimatedNumber';
import { IconAlert, IconCheck, IconFlame, IconInfo } from './icons';
import { Tooltip } from './Tooltip';
import { Delta, type DeltaDir } from './ui';
// (the words of the trend live in explorer/trendWords.ts: a module that exports only components keeps Fast Refresh)
import { trendWords } from './explorer/trendWords';

export type KpiTarget = 'calendar' | 'period' | 'overview';

/** The size class of a count: a number glides only inside its class, and jumps to a new one (a glide from 1.33 million
 *  down to 0.3, written the way 0.3 is written, would show "1,326,011.1" for a moment, far too wide for its cell). */
const magnitude = (v: number) => (Math.abs(v) >= 1e6 ? 'm' : Math.abs(v) >= 1e4 ? 'k' : Math.abs(v) >= 10 ? 'n' : 's');

/** A formatter for a count that keeps the unit of the target value while the number glides (the strip's compact style:
 *  3 significant figures; a value under 10 that is not whole is "about 2", one under 0.5 "less than 1"). */
function countFormat(target: number, lang: Lang): { format: (v: number) => string; unit: string; prefix?: string; value?: number } {
  const locale = DICTS[lang].locale;
  const a = Math.abs(target);
  if (a > 0 && a < 10 && Math.abs(a - Math.round(a)) > 1e-6) {
    const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    return a < 0.5 ? { format: () => '1', unit: '', prefix: 'less than', value: 1 }
      : { format: (v) => whole.format(Math.round(v)), unit: '', prefix: 'about', value: Math.round(a) };
  }
  const { unit } = countParts(target, lang);
  if (Math.abs(target) >= 1e6) {
    const f = new Intl.NumberFormat(locale, { maximumSignificantDigits: 3 });
    return { format: (v) => f.format(v / 1e6), unit };
  }
  if (Math.abs(target) >= 1e4) {
    const f = new Intl.NumberFormat(locale, { maximumSignificantDigits: 3 });
    return { format: (v) => f.format(v), unit };
  }
  const f = new Intl.NumberFormat(locale, { maximumFractionDigits: Math.abs(target) < 10 ? 1 : 0 });
  return { format: (v) => f.format(v), unit };
}

interface AreaNumbers {
  ym: number | null;              // the month described (yyyymm)
  latest: boolean;                // it is the latest full month
  little: boolean;                // too little fire to judge a normal month (lib/stats.ts littleFire)
  anom: Anomaly | null;
  ytd: YearToDate | null;
  verdict: TrendVerdict;
  span: [number, number] | null;  // the full years of the trend
  runs: [number, number][];       // the critical months, as runs (first, last)
  peak: number | null;
}

/** Everything the strip and the details show, for the month on the map (else the latest full month). */
function useAreaNumbers(points: readonly MonthlyPoint[], ym: number | null, family: FamilyTest | null): AreaNumbers {
  const latest = useMemo(() => latestCompleteMonth(points, 'harmonized'), [points]);
  const anoms = useMemo(() => anomalies(points, 'harmonized'), [points]);
  const index = useMemo(() => new Map(points.map((p, i) => [p.yr * 100 + p.mo, i])), [points]);
  const verdict = useMemo(() => trendVerdict(points, 'harmonized', family), [points, family]);
  const span = useMemo((): [number, number] | null => {
    const full = annualTotals(points, 'harmonized').filter((y) => y.complete && y.yr >= 2001 && y.yr <= 2025).map((y) => y.yr);
    return full.length ? [full[0], full[full.length - 1]] : null;
  }, [points]);
  const runs = useMemo(() => monthRuns(criticalMonths(points, 'harmonized')), [points]);
  const peak = useMemo(() => season(points, 'harmonized').peakMonth, [points]);
  const little = useMemo(() => littleFire(points), [points]);
  const latestYm = latest ? latest.yr * 100 + latest.mo : null;
  const wanted = ym !== null && index.has(ym) && anoms[index.get(ym) ?? -1]?.value !== null ? ym : latestYm;
  const anom = wanted !== null ? anoms[index.get(wanted) ?? -1] ?? null : null;
  const yr = wanted !== null ? Math.floor(wanted / 100) : null, mo = wanted !== null ? wanted % 100 : null;
  const ytd = useMemo(() => (yr !== null && mo !== null ? yearToMonth(points, 'harmonized', yr, mo) : null), [points, yr, mo]);
  return { ym: wanted, latest: wanted !== null && wanted === latestYm, little, anom, ytd, verdict, span, runs, peak };
}

/** The change from normal as a pill: a direction, short words and the full words for screen readers. */
function against(ratio: number | null, value: number, normal: number | null, t: Dict):
  { dir: DeltaDir; short: string; long: string } | null {
  if (ratio !== null) return { dir: ratioDirection(ratio), short: shortAgainstNormal(ratio), long: comparedWithNormal(ratio) };
  if (normal === 0) {
    return value > 0 ? { dir: 'up', short: t.exPanel.strip.noneNormal, long: t.kpi.fireUnusual }
      : { dir: 'flat', short: t.exPanel.strip.asUsual, long: t.kpi.noFireUsual };
  }
  return null;
}

/** A text with a short form for a narrow strip ("Sep 2015" for "September 2015"): never a word cut off. */
function LongShort({ long, short }: { long: string; short?: string }) {
  return short && short !== long ? <><span className="fh-ex-kpi-long">{long}</span><span className="fh-ex-kpi-short">{short}</span></> : <>{long}</>;
}

function Cell({ label, short, value, pill, tip, onOpen, kind, children }: {
  label: string; short?: string; value: ReactNode; pill: ReactNode; tip: string; onOpen?: () => void; kind: string; children?: ReactNode;
}) {
  const body = (
    <>
      <span className="ui-stat-label fh-ex-kpi-label"><LongShort long={label} short={short} /></span>
      <span className="ui-stat-value fh-ex-kpi-value">{value}</span>
      <span className="fh-ex-kpi-pill">{pill}</span>
      {children}
    </>
  );
  if (!onOpen) return <div className="ui-stat fh-ex-kpi" data-kpi={kind} role="group" aria-label={tip}>{body}</div>;
  return (
    <Tooltip content={tip} describe={false}>
      <button type="button" className="ui-stat fh-ex-kpi ui-press" data-kpi={kind} aria-label={tip} onClick={onOpen}>{body}</button>
    </Tooltip>
  );
}

export interface KpisProps {
  points: readonly MonthlyPoint[];   // harmonized
  ym: number | null;                 // the month on the map (yyyymm); null: the latest full month
  family?: FamilyTest | null;        // a named place's test among all the places (web/places.json), or a hexagon's
  onOpen?: (target: KpiTarget) => void;
  loading?: string | null;           // a new area loads ("Loading Australia…"): the old numbers stay, dimmed, under this label
}

/** The strip of three numbers. */
export function Kpis({ points, ym, family = null, onOpen, loading = null }: KpisProps) {
  const { t, lang } = useI18n();
  const s = t.exPanel.strip;
  const n = useAreaNumbers(points, ym, family);
  const yr = n.ym !== null ? Math.floor(n.ym / 100) : null, mo = n.ym !== null ? n.ym % 100 : null;
  const monthLabel = yr !== null && mo !== null ? formatMonth(yr, mo, lang) : '';
  const monthShort = yr !== null && mo !== null ? `${t.common.monthsShort[mo - 1]} ${yr}` : '';
  const count = (v: number) => {
    const f = countFormat(v, lang);
    return (
      <>
        {f.prefix ? <span className="ui-stat-unit fh-ex-kpi-about">{f.prefix}</span> : null}
        <AnimatedNumber key={f.prefix ?? magnitude(v)} value={f.value ?? v} format={f.format} />
        {f.unit ? <span className="ui-stat-unit">{f.unit}</span> : null}
      </>
    );
  };
  const pill = (a: ReturnType<typeof against>) => (a ? <Delta dir={a.dir} text={a.short} /> : null);

  // (a place with little fire has no normal to judge a month by: no change from normal)
  const mA = n.anom && n.anom.value !== null && !n.little ? against(n.anom.ratio, n.anom.value, n.anom.median, t) : null;
  const ytdA = n.ytd && !n.little ? against(n.ytd.ratio, n.ytd.total, n.ytd.normal, t) : null;
  const ytdLabel = n.ytd ? (n.ytd.lastMonth === 12 ? s.wholeYear(n.ytd.yr)
    : n.ytd.lastMonth === 1 ? formatMonth(n.ytd.yr, 1, lang) : s.ytd(t.common.monthsShort[n.ytd.lastMonth - 1], n.ytd.yr)) : t.ex.yearTile;
  const ytdShort = n.ytd && n.ytd.lastMonth > 1 && n.ytd.lastMonth < 12 ? s.ytdShort(t.common.monthsShort[n.ytd.lastMonth - 1])
    : n.ytd && n.ytd.lastMonth === 1 ? `Jan ${n.ytd.yr}` : ytdLabel;
  const tw = trendWords(n.verdict, t, lang, family);
  const pct = n.verdict.trend.pct_per_decade;
  const pending = n.verdict.cls === 'pending';
  const showPct = pct !== null && !pending && !n.little && (n.verdict.reading === 'caution' || n.verdict.reading === 'full');

  const monthTip = n.anom && n.anom.value !== null
    ? s.monthTip(monthLabel, countText(n.anom.value, 'compact'), mA?.long ?? (n.little ? LITTLE_FIRE_NORMAL.replace(/\.$/, '') : null)) : s.noMonth;
  const ytdTip = n.ytd ? s.ytdTip(ytdLabel, countText(n.ytd.total, 'compact'), ytdA?.long ?? null) : s.noMonth;
  // the tooltip leaves out the line of the test itself for a rise or a fall (the word says it), never the reason
  const tipNotes = (n.verdict.cls === 'rising' || n.verdict.cls === 'falling' ? tw.notes.slice(1) : tw.notes).join(' ');
  const trendTip = showPct && pct !== null ? s.trendTip(trendText(pct, 'detail'), tw.word, tipNotes)
    : `${tw.word}.${tipNotes ? ` ${tipNotes}` : ''}`;
  // the strip's own words for the trend (short enough for the narrowest cell)
  const stripWord = tw.dir === 'flat' ? t.exPanel.trend.flatShort : tw.word;
  const withOpen = (tip: string, open: string) => (onOpen ? `${tip} ${open}` : tip);

  return (
    <div className="fh-ex-kpis" role="group" aria-label={loading ?? s.label} aria-busy={loading ? true : undefined}
      data-trend={n.verdict.reading} data-verdict={n.verdict.cls} data-loading={loading ? '' : undefined}>
      {/* the unit of the two counts, where the screen has room (each number's label and tooltip say it too); while a
          new area loads, its name */}
      <p className="fh-ex-kpis-caption" aria-hidden="true"><IconFlame size={13} />{loading ?? s.unit}</p>
      <Cell kind="month" label={monthLabel || t.kpi.month('')} short={monthShort} tip={withOpen(monthTip, s.open.calendar)}
        value={n.anom && n.anom.value !== null ? count(n.anom.value) : '–'} pill={pill(mA)}
        onOpen={onOpen ? () => onOpen('calendar') : undefined} />
      <Cell kind="ytd" label={ytdLabel} short={ytdShort} tip={withOpen(ytdTip, s.open.period)}
        value={n.ytd ? count(n.ytd.total) : '–'} pill={pill(ytdA)} onOpen={onOpen ? () => onOpen('period') : undefined} />
      <Cell kind="trend" label={s.trend} short={s.trendShort} tip={withOpen(trendTip, s.open.overview)}
        value={showPct && pct !== null ? (
          <>
            <AnimatedNumber value={pct} format={(v) => trendText(v, 'strip')} />
            {/* the caution sits by the number it is about, so it is never pushed out of the cell */}
            {tw.caution ? <span className="fh-ex-kpi-caution" data-caution="" aria-hidden="true"><IconAlert size={14} /></span> : null}
          </>
        ) : null}
        pill={pending ? <span className="fh-ex-kpi-pending" aria-hidden="true" />
          : tw.dir ? <Delta dir={tw.dir} text={stripWord} />
            : <span className="fh-ex-kpi-quiet"><LongShort long={tw.word} short={n.verdict.cls === 'little' ? t.exPanel.trend.littleShort : undefined} /></span>}
        onOpen={onOpen ? () => onOpen('overview') : undefined} />
    </div>
  );
}

/** One line for the small phone sheet: the month, its count and the change from normal. */
export function KpiLine({ points, ym }: { points: readonly MonthlyPoint[]; ym: number | null }) {
  const { t, lang } = useI18n();
  const n = useAreaNumbers(points, ym, null);
  const yr = n.ym !== null ? Math.floor(n.ym / 100) : null, mo = n.ym !== null ? n.ym % 100 : null;
  const a = n.anom && n.anom.value !== null ? against(n.anom.ratio, n.anom.value, n.anom.median, t) : null;
  const f = n.anom && n.anom.value !== null ? countFormat(n.anom.value, lang) : null;
  return (
    <p className="fh-ex-kpi-line">
      <span className="fh-ex-kpi-line-month">{yr !== null && mo !== null ? `${t.common.monthsShort[mo - 1]} ${yr}` : '–'}</span>
      {f && n.anom && n.anom.value !== null ? (
        <span className="fh-ex-kpi-line-value">
          {f.prefix ? <span className="ui-stat-unit">{f.prefix} </span> : null}
          <AnimatedNumber key={f.prefix ?? magnitude(n.anom.value)} value={f.value ?? n.anom.value} format={f.format} />
          <span className="ui-stat-unit">{f.unit ? `${f.unit} ${t.kpi.hotspots}` : t.kpi.hotspots}</span></span>
      ) : null}
      {a && !n.little ? <Delta dir={a.dir} text={a.short} /> : null}
    </p>
  );
}

/** The numbers in words, with every detail: the top of the Overview tab. */
export function KpiDetails({ points, ym, family = null }: Omit<KpisProps, 'onOpen'>) {
  const { t, lang } = useI18n();
  const d = t.exPanel.details;
  const n = useAreaNumbers(points, ym, family);
  const yr = n.ym !== null ? Math.floor(n.ym / 100) : null, mo = n.ym !== null ? n.ym % 100 : null;
  const monthName = mo !== null ? t.common.months[mo - 1] : '';
  const monthLabel = yr !== null && mo !== null ? formatMonth(yr, mo, lang) : '';
  const mA = n.anom && n.anom.value !== null && !n.little ? against(n.anom.ratio, n.anom.value, n.anom.median, t) : null;
  const ytdA = n.ytd && !n.little ? against(n.ytd.ratio, n.ytd.total, n.ytd.normal, t) : null;
  const exact = (v: number) => countText(v, 'exact');
  const tw = trendWords(n.verdict, t, lang, family);
  const pct = n.verdict.trend.pct_per_decade;
  const pending = n.verdict.cls === 'pending';
  const showPct = pct !== null && !pending && !n.little && (n.verdict.reading === 'caution' || n.verdict.reading === 'full');
  const runs = n.little ? [] : n.runs.map(([a, b]) => t.kpi.runText(t.common.monthsShort[a - 1], t.common.monthsShort[b - 1]));
  const cls = n.verdict.cls;
  const trendIcon = pending ? null : cls === 'little' || cls === 'none' || cls === 'untested' ? <IconInfo size={14} />
    : tw.caution ? <IconAlert size={14} /> : n.verdict.family === 'holds' ? <IconCheck size={14} /> : null;

  return (
    <dl className="fh-ex-facts" aria-label={d.label}>
      <div>
        <dt>{n.latest ? t.kpi.month(monthLabel) : t.ex.monthOnMap(monthLabel)}</dt>
        <dd>
          <span className="fh-ex-fact-value ui-mono">{n.anom && n.anom.value !== null ? t.calendar.units.harmonized(exact(n.anom.value)) : '–'}</span>
          {mA ? <span className="fh-ex-fact-note">{mA.long}{n.anom?.median ? `, ${d.normalOf(exact(n.anom.median))}` : ''}</span> : null}
          {n.little ? <span className="fh-ex-fact-note" data-little="">{LITTLE_FIRE_NORMAL}</span>
            : n.anom?.rank && (n.anom.value ?? 0) > 0 ? <span className="fh-ex-fact-note">{t.calendar.rank(n.anom.rank, n.anom.years, monthName)}</span> : null}
        </dd>
      </div>
      <div>
        <dt>{n.ytd ? (n.ytd.lastMonth === 12 ? t.kpi.wholeYear(n.ytd.yr) : t.kpi.ytd(t.common.months[n.ytd.lastMonth - 1], n.ytd.yr)) : t.ex.yearTile}</dt>
        <dd>
          <span className="fh-ex-fact-value ui-mono">{n.ytd ? t.calendar.units.harmonized(exact(n.ytd.total)) : '–'}</span>
          {ytdA ? <span className="fh-ex-fact-note">{ytdA.long}</span> : null}
          {n.ytd && n.ytd.normal !== null && n.ytd.normal > 0 && !n.little ? <span className="fh-ex-fact-note">{t.kpi.ytdNormal(exact(n.ytd.normal))}</span> : null}
        </dd>
      </div>
      <div data-trend={n.verdict.reading} data-verdict={cls} aria-busy={pending || undefined}>
        <dt>{n.span ? t.kpi.trend(n.span[0], n.span[1]) : t.kpi.trendFew}</dt>
        <dd>
          <span className="fh-ex-fact-value">
            {showPct && pct !== null ? <span className="ui-mono">{trendText(pct, 'detail')} {t.kpi.perDecade}</span> : null}
            {pending ? <span className="fh-ex-kpi-pending" aria-hidden="true" />
              : <span className={`fh-ex-fact-word${tw.dir ? '' : ' is-quiet'}`}>{trendIcon}{tw.word}</span>}
            {pending ? <span className="sr-only">{tw.word}</span> : null}
          </span>
          {n.verdict.mean !== null && !pending && !n.little && n.verdict.reading !== 'little' ? <span className="fh-ex-fact-note">{d.mean(exact(n.verdict.mean))}</span> : null}
          {tw.notes.map((note) => <span key={note} className="fh-ex-fact-note">{note}</span>)}
        </dd>
      </div>
      <div>
        <dt>{t.kpi.critical}</dt>
        <dd>
          <span className="fh-ex-fact-value">{runs.length ? t.kpi.runs(runs) : '–'}</span>
          <span className="fh-ex-fact-note">{n.little ? LITTLE_FIRE_NORMAL
            : runs.length && n.peak ? t.kpi.criticalContext(t.common.months[n.peak - 1]) : t.kpi.criticalNone}</span>
        </dd>
      </div>
    </dl>
  );
}
