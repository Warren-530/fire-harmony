// The outlook's skill and the forecast it is measured against, worded once for Methods, its checks and the Dashboard.
// dashboard.json gives the Brier skill score against the share of past years above normal for that month
// (outlook.bss). A newer release can add the score against a fixed 50% chance with its interval (outlook.bss_fair):
// then that one is shown, as the fairer test (a skill that fades by three months).
import type { DashboardData } from '../../lib/dashboard-types';

export interface LeadSkill { lead: number; bss: number; lo: number | null; hi: number | null }
export interface OutlookSkill {
  fair: boolean;            // against a fixed 50% chance (bss_fair), else against the share of past years above normal
  leads: LeadSkill[];
  /** "against a fixed 50% chance" or "against the share of past years above normal". */
  against: string;
  /** "a fixed 50% chance" or "always forecasting the share of past years above normal in that month". */
  reference: string;
  /** Share of areas with skill by lead ('1', '2', '3'), against the same reference; null when the release lacks it. */
  share: Record<string, number> | null;
  /** All three leads on 2022 to 2025 alone, against the same reference. */
  recent: number | null;
  /** Skill by continent and lead, against the same reference. */
  continents: Outlook['by_continent'];
}

type Outlook = NonNullable<DashboardData['outlook']>;
type FairRow = { lead?: unknown; bss?: unknown; lo?: unknown; hi?: unknown; ci?: unknown };

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The rows of outlook.bss_fair, however the release writes the interval (lo and hi, or ci: [lo, hi]). */
function fairRows(o: Outlook): LeadSkill[] {
  const raw = (o as unknown as { bss_fair?: unknown }).bss_fair;
  if (!Array.isArray(raw)) return [];
  return (raw as FairRow[]).flatMap((r) => {
    const lead = numOrNull(r.lead), bss = numOrNull(r.bss);
    if (lead === null || bss === null) return [];
    const ci = Array.isArray(r.ci) ? r.ci : [];
    return [{ lead, bss, lo: numOrNull(r.lo) ?? numOrNull(ci[0]), hi: numOrNull(r.hi) ?? numOrNull(ci[1]) }];
  }).sort((a, b) => a.lead - b.lead);
}

export function outlookSkill(o: Outlook): OutlookSkill {
  const fair = fairRows(o);
  if (fair.length) {
    return {
      fair: true, leads: fair, against: 'against a fixed 50% chance', reference: 'a fixed 50% chance',
      share: o.share_with_skill_fair ?? null, recent: numOrNull(o.bss_recent_fair), continents: o.by_continent_fair ?? [],
    };
  }
  return {
    fair: false, leads: o.bss.map((b) => ({ lead: b.lead, bss: b.bss, lo: null, hi: null })),
    against: 'against the share of past years above normal',
    reference: 'always forecasting the share of past years above normal in that month',
    share: o.share_with_skill, recent: o.bss_recent, continents: o.by_continent,
  };
}

export const leadOf = (s: OutlookSkill, n: number): LeadSkill | null => s.leads.find((l) => l.lead === n) ?? null;
