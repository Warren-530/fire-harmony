// The fire outlook: always the next three months. A month in the fire season the outlook covers has its chance of
// above normal fire, written as a sentence ("80% chance of an above normal November"), next to how often these months
// were above normal in past years, and how the outlook did in the past here (Brier skill score on years the model never
// saw). A month outside that season is a muted row with the fire it usually has. A city circle shows the outlook of
// the state around the city.
import { useMemo } from 'react';
import { formatMonth, formatNumber, useI18n } from '../lib/i18n';
import { addMonths, climatology, countText } from '../lib/stats';
import type { MonthlyPoint, OutlookRow } from '../lib/types';
import { Badge, Card, Note, Skeleton, type BadgeTone } from './ui';

export interface OutlookCardProps {
  named: boolean;                          // there is a place to give the outlook of (a named place, or a circle's state)
  rows: OutlookRow[] | null | 'error';     // null while loading
  busy?: boolean;
  points?: readonly MonthlyPoint[] | null; // the series of that place (the usual fire of a month outside the season)
  lastYm?: number | null;                  // the latest month of the record (yyyymm): the outlook starts after it
  forLabel?: string | null;                // "Outlook for Selangor, the state around Kuala Lumpur"
}

export function OutlookCard({ named, rows, busy, points = null, lastYm = null, forLabel = null }: OutlookCardProps) {
  const { t, lang } = useI18n();
  const o = t.outlook;
  const medians = useMemo(() => (points ? climatology(points, 'harmonized').map((n) => n.median) : null), [points]);
  if (!named) return <Card title={o.title}><Note>{forLabel ?? o.drawnArea}</Note></Card>;
  if (busy) return <div className="fh-ex-wait" aria-busy="true"><Skeleton height={22} /><Skeleton height={180} /></div>;
  if (rows === 'error') return <Card title={o.title}><p className="fh-ex-error" role="alert">{o.error}</p></Card>;
  if (!rows) return <Card title={o.title}><Skeleton height={180} /></Card>;
  const issue = rows.length ? rows[0].issue_yr * 100 + rows[0].issue_mo : lastYm;
  if (issue === null) return <Card title={o.title}><Note>{o.none}</Note></Card>;
  const pc = (p: number) => `${formatNumber(p * 100, lang, 0)}%`;
  const skill = (b: number | null): { tone: BadgeTone; text: string } => (b === null || b < 0.05
    ? { tone: 'neutral', text: o.skillLabel.none } : b < 0.2 ? { tone: 'neutral', text: o.skillLabel.some } : { tone: 'good', text: o.skillLabel.good });
  // the next three months, each with its outlook or, outside the season it covers, its usual fire
  const targets = [1, 2, 3].map((lead) => {
    const ym = addMonths(issue, lead);
    const yr = Math.floor(ym / 100), mo = ym % 100;
    const row = rows.find((r) => r.target_yr === yr && r.target_mo === mo) ?? null;
    return { lead, yr, mo, row };
  });
  return (
    <Card title={o.title} subtitle={o.subtitle3(formatMonth(Math.floor(issue / 100), issue % 100, lang))}>
      <div>
        {forLabel ? <p className="fh-ex-outlook-for" data-for="">{forLabel}</p> : null}
        <ul className="fh-ex-outlook">
          {targets.map(({ lead, yr, mo, row }) => {
            const month = formatMonth(yr, mo, lang);
            if (!row) {
              const n = medians?.[mo - 1] ?? null;
              return (
                <li key={lead} className="fh-ex-outlook-item is-off" data-off="">
                  <p className="fh-ex-outlook-off">{n === null || n < 0.5 ? o.offSeasonNone(month)
                    : o.offSeason(month, countText(n, 'compact').replace(/^about /, ''))}</p>
                </li>
              );
            }
            const s = skill(row.bss);
            return (
              <li key={lead} className="fh-ex-outlook-item" data-chance="">
                <p className="fh-ex-outlook-month">{o.headline(pc(row.p), t.common.months[mo - 1])}</p>
                <p className="fh-ex-outlook-p">{pc(row.p)}</p>
                <p className="fh-ex-outlook-what">{month}</p>
                <div className="fh-ex-outlook-bar" role="img" aria-label={`${o.headline(pc(row.p), month)}. ${o.pastAbove(pc(row.p_clim))}.`}>
                  <span className="fh-ex-outlook-fill" style={{ width: `${Math.round(row.p * 100)}%` }} />
                  <span className="fh-ex-outlook-normal" style={{ left: `${Math.round(row.p_clim * 100)}%` }} />
                </div>
                <p className="fh-ex-outlook-normal-text">{o.pastAbove(pc(row.p_clim))}</p>
                <Badge tone={s.tone}>
                  {s.tone === 'good' ? <CheckIcon /> : null}
                  {s.text}
                </Badge>
              </li>
            );
          })}
        </ul>
        <Note>{o.note}</Note>
      </div>
    </Card>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
      <path d="M2 6.5 5 9l5-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
