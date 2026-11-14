// The columns of the Rankings table: what each header says, the line of help in its tooltip, what it sorts by, and how
// a cell reads (on a laptop as a table cell, on a phone as one fact of a card, with its label).
import { TREND_LOG_NOTE } from '../pages/format';
import type { CSSProperties, ReactNode } from 'react';
import { IconArrowDown, IconArrowUp, IconMinus } from '../icons';
import { anomalyVar, count, monthShort, ordinal, pct, ratioNum } from '../dashboard/format';
import {
  FAR_MIN_NORMAL, FAR_RATIO, monthName, monthYear, SMALL_NORMAL, TEST_FLOOR, TREND_WORD, trendVerdict, type Ranked, type SortKey,
} from './model';

export interface ColumnContext {
  latestYm: number;       // the latest full month (yyyymm)
  outlookYm: number | null;
}

export interface RankColumn {
  key: SortKey;
  label: (c: ColumnContext) => string;
  short?: (c: ColumnContext) => string;   // the label on a card (phones)
  help: (c: ColumnContext) => string;
  num?: boolean;
  render: (r: Ranked, c: ColumnContext) => ReactNode;
}

/** "1.6%", "0.21%", "<0.01%". */
export function sharePct(v: number | null): string {
  if (v === null) return '–';
  if (v > 0 && v < 0.01) return '<0.01%';
  return pct(v, v < 1 ? 2 : v < 10 ? 1 : 0);
}

/** A count for a cell: 1.48 million, 271,567, 36.3 (small places keep a decimal). */
export function fire(v: number | null): string {
  if (v === null) return '–';
  return v > 0 && v < 10 ? v.toFixed(1) : count(v);
}

function Ratio({ ratio, normal, sub }: { ratio: number | null; normal: number | null; sub?: ReactNode }) {
  if (ratio === null || !Number.isFinite(ratio)) {
    return <span className="rk-val rk-muted">{normal === 0 ? 'No fire in a normal month' : 'No data'}</span>;
  }
  const weak = normal === null || normal < SMALL_NORMAL;
  return (
    <span className={weak ? 'rk-val rk-weak' : 'rk-val'}>
      <span className="rk-ratio">
        <span className="rk-swatch" style={{ background: `var(${anomalyVar(ratio)})` }} aria-hidden="true" />
        <span className="ui-mono">{ratioNum(ratio)}</span><span className="rk-unit">times</span>
      </span>
      {weak ? <span className="rk-sub">Rough: few fires</span> : sub ? <span className="rk-sub">{sub}</span> : null}
    </span>
  );
}

function Trend({ r }: { r: Ranked }) {
  const v = r.trend_pct_per_decade;
  if (v === null) return <span className="rk-val rk-muted">Too few years</span>;
  const cls = r.trendClass;
  const Icon = cls === 'rising' ? IconArrowUp : cls === 'falling' ? IconArrowDown : IconMinus;
  return (
    <span className={`rk-val rk-trend rk-trend-${cls}`}>
      <span className="rk-trend-top">
        <Icon size={14} />
        <span className="ui-mono">{pct(v, Math.abs(v) < 10 ? 1 : 0, true)}</span>
        {TREND_WORD[cls] ? <span className="rk-trend-word">{TREND_WORD[cls]}</span> : null}
      </span>
      <span className="rk-sub">{trendVerdict(r)}</span>
    </span>
  );
}

function Outlook({ r }: { r: Ranked }) {
  if (r.outlook_p === null) return <span className="rk-val rk-muted">No outlook</span>;
  const p = r.outlook_p, clim = r.outlook_p_clim;
  const up = clim !== null && p >= clim;
  return (
    <span className="rk-val">
      <span className="rk-ratio">
        <span className={up ? 'ui-mono rk-strong rk-above' : 'ui-mono rk-strong'}>{pct(p * 100, 0)}</span>
        <span className="rk-unit">chance</span>
      </span>
      <span className="rk-meter" aria-hidden="true">
        <span className="rk-meter-fill" style={{ '--rk-frac': p } as CSSProperties} />
        {clim !== null ? <span className="rk-meter-tick" style={{ left: `calc(${clim * 100}% - 1px)` }} /> : null}
      </span>
      {clim !== null ? <span className="rk-sub">Normal <span className="ui-mono">{pct(clim * 100, 0)}</span></span> : null}
    </span>
  );
}

export const COLUMNS: readonly RankColumn[] = [
  {
    key: 'mean', num: true,
    label: () => 'Fire a year', short: () => 'Fire a year',
    help: () => 'Hotspots a year, the mean of 2001 to 2025, on the NOAA-20 VIIRS scale. Select to sort.',
    render: (r) => (
      <span className="rk-val">
        <span className="ui-mono rk-strong">{fire(r.mean_per_year)}</span>
        <span className="rk-sub rk-share-sub"><span className="ui-mono">{sharePct(r.share_pct)}</span> of world</span>
      </span>
    ),
  },
  {
    key: 'share', num: true,
    label: () => 'World share', short: () => 'World share',
    help: () => 'This place’s part of all the hotspots in the world, 2001 to 2025.',
    render: (r) => {
      const v = r.share_pct ?? 0;
      return (
        <span className="rk-val">
          <span className="ui-mono">{sharePct(r.share_pct)}</span>
          <span className="rk-bar" aria-hidden="true"><span style={{ '--rk-frac': Math.min(1, Math.sqrt(v / 100)) } as CSSProperties} /></span>
        </span>
      );
    },
  },
  {
    key: 'trend',
    label: () => 'Trend per decade, 2001 to 2025', short: () => 'Trend per decade',
    help: () => `Change in the yearly totals per decade, 2001 to 2025. ${TREND_LOG_NOTE} It holds when it stays clear after all places are tested together (false discovery rate 5%). Places with under ${count(TEST_FLOOR)} hotspots a year are not tested.`,
    render: (r) => <Trend r={r} />,
  },
  {
    key: 'latest', num: true,
    label: (c) => monthYear(c.latestYm), short: (c) => `${monthShort(c.latestYm % 100)} ${Math.floor(c.latestYm / 100)}`,
    help: (c) => `${monthYear(c.latestYm)} against a normal ${monthName(c.latestYm % 100)} (the median of 2001 to 2025), and its rank among every ${monthName(c.latestYm % 100)} since 2001. Far above normal is ${FAR_RATIO} times or more, where a normal month has ${FAR_MIN_NORMAL} hotspots or more.`,
    render: (r) => (
      <Ratio ratio={r.latest_ratio} normal={r.latest_normal}
        sub={r.latest_rank && r.latest_years ? <>{ordinal(r.latest_rank)} of <span className="ui-mono">{r.latest_years}</span></> : undefined} />
    ),
  },
  {
    key: 'ytd', num: true,
    label: (c) => `${Math.floor(c.latestYm / 100)} so far`, short: (c) => `${Math.floor(c.latestYm / 100)} so far`,
    help: (c) => `January to ${monthName(c.latestYm % 100)} ${Math.floor(c.latestYm / 100)} against the same months in a normal year.`,
    render: (r) => <Ratio ratio={r.ytd_ratio} normal={r.ytd_normal} sub={r.ytd !== null ? <span className="ui-mono">{fire(r.ytd)}</span> : undefined} />,
  },
  {
    key: 'record', num: true,
    label: () => 'Record year', short: () => 'Record year',
    help: () => 'The year with the most fire, 2001 to 2025, and its hotspots.',
    render: (r) => (
      <span className="rk-val">
        <span className="ui-mono">{r.record_year ?? '–'}</span>
        <span className="rk-sub rk-peak-sub">{r.record_total !== null ? <span className="ui-mono">{fire(r.record_total)}</span> : null}</span>
        <span className="rk-sub rk-peak-merged">{r.peak_month ? `Peak in ${monthShort(r.peak_month)}` : ''}</span>
      </span>
    ),
  },
  {
    key: 'peak',
    label: () => 'Peak month', short: () => 'Peak month',
    help: () => 'The month with the most fire in a normal year.',
    render: (r) => <span className="rk-val">{r.peak_month ? monthName(r.peak_month) : <span className="rk-muted">No usual peak</span>}</span>,
  },
  {
    key: 'outlook', num: true,
    label: (c) => (c.outlookYm ? `${monthShort(c.outlookYm % 100)} ${Math.floor(c.outlookYm / 100)} outlook` : 'Outlook'),
    short: (c) => (c.outlookYm ? `${monthShort(c.outlookYm % 100)} outlook` : 'Outlook'),
    help: (c) => `The model’s chance that ${c.outlookYm ? monthYear(c.outlookYm) : 'next month'} has more fire than normal, against the normal chance. Shown where the outlook model covers the place.`,
    render: (r) => <Outlook r={r} />,
  },
];
