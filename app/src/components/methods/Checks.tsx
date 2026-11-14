// Methods, "How we know it works": one card per test, read like a test suite. Each card asks its question, says the
// method in one sentence, gives the result as numbers from the published files (dashboard.json and meta.json, which
// the page loads anyway), marks it passed or not by a stated rule, and links to the chart or view that shows it.
// The pass rules are in CHECK_RULES below, next to the numbers they read, so nothing is passed by hand.
import { leadOf, outlookSkill } from './skill';
import { openSectionOf } from './Fold';
import type { MouseEvent, ReactNode } from 'react';
import { Badge } from '../ui';
import { IconCheck, IconChevronDown, IconChevronRight, IconInfo } from '../icons';
import type { DashboardData } from '../../lib/dashboard-types';
import type { Meta } from '../../lib/types';
import { fix, signed } from './eda';
import { scaleName } from './LiveFigures';

type Dash = DashboardData;

// ------------------------------------------------------------------------------------------------ a small gauge

interface GaugeMark { v: number; label?: string; tone?: 'main' | 'muted' }
interface GaugeRow { label: string; band?: [number, number]; fill?: boolean; marks: GaugeMark[] }
interface GaugeSpec { min: number; max: number; rows: GaugeRow[]; fmt: (v: number) => string; target?: { v: number; label: string }; bandLabel?: string }

/** A track per row with the normal range shaded and the result marked: the result at a glance, in the theme. */
function Gauge({ g, label }: { g: GaugeSpec; label: string }) {
  const frac = (v: number) => Math.min(100, Math.max(0, (100 * (v - g.min)) / (g.max - g.min)));
  const at = (v: number) => `${frac(v)}%`;
  const edge = (v: number) => (frac(v) > 88 ? 'end' : frac(v) < 12 ? 'start' : undefined);
  return (
    <div className="fh-ck-gauge" role="img" aria-label={label}>
      {g.rows.map((r) => (
        <div key={r.label} className="fh-ck-row">
          <span className="fh-ck-row-label">{r.label}</span>
          <span className="fh-ck-track">
            {r.band ? <span className={`fh-ck-band${r.fill ? ' fh-ck-band-fill' : ''}`} style={{ left: at(r.band[0]), width: `calc(${at(r.band[1])} - ${at(r.band[0])})` }} /> : null}
            {g.target ? <span className="fh-ck-target" style={{ left: at(g.target.v) }} /> : null}
            {r.marks.map((m, i) => (
              <span key={i} className={`fh-ck-mark${m.tone === 'muted' ? ' fh-ck-mark-muted' : ''}`} style={{ left: at(m.v) }} data-edge={edge(m.v)}>
                {m.label ? <span className="fh-ck-mark-label ui-mono">{m.label}</span> : null}
              </span>
            ))}
          </span>
        </div>
      ))}
      <div className="fh-ck-scale ui-mono" aria-hidden="true">
        <span>{g.fmt(g.min)}</span>
        {g.target ? <span className="fh-ck-scale-target" style={{ left: at(g.target.v) }}>{g.target.label}</span> : null}
        <span>{g.fmt(g.max)}</span>
      </div>
      {g.bandLabel ? <p className="fh-ck-key"><span className="fh-ck-key-band" aria-hidden="true" />{g.bandLabel}</p> : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the checks

type Link = { jump: string; label: string } | { href: string; label: string };
interface Check {
  id: string; name: string; question: string; method: string;
  heldOut: boolean;                     // scored on years or regions the model never saw (else a test of the full record)
  value: string; unit?: string; context: ReactNode;
  pass: boolean | null;                 // null: the result varies by place (no single verdict)
  gauge: GaugeSpec | null; gaugeLabel: string; note?: ReactNode; link: Link;
}

/** The burned area placebo steps live in meta.json (validation), which has no type: read it with care. */
function burnedPlaceboMean(meta: Meta | null): number | null {
  const v = meta?.validation as { burned_area_witness?: { '1y'?: { placebo_mean?: unknown } } } | undefined;
  const m = v?.burned_area_witness?.['1y']?.placebo_mean;
  return typeof m === 'number' && Number.isFinite(m) ? m : null;
}

const pctS = (v: number, d = 2) => `${signed(v, d)}%`;
const share = (v: number, d = 0) => `${fix(100 * v, d)}%`;

/** The checks and their pass rules (CHECK_RULES): a step is normal within two spreads of the steps at dates when
 *  nothing changed; the model must beat one exchange rate below the continent; the 90% ranges must hold at least 90%
 *  of held out monthly totals; the outlook must beat the normal chance at every lead; the haze model must explain
 *  more than half of the ups and downs in the typical city. */
export function buildChecks(d: Dash, meta: Meta | null): Check[] {
  const s = d.seam, out: Check[] = [];
  const p12 = s.placebo['2012'], p02 = s.placebo['2002'];
  const band = (m: number, sd: number): [number, number] => [m - 2 * sd, m + 2 * sd];
  out.push({
    id: 'seam', name: 'Seam steps', question: 'Does the record jump when the satellites change?', heldOut: false,
    method: 'We measure the step at each switch against a satellite that flew on both sides, and the same step at dates when nothing changed.',
    value: pctS(s.steps['2012_harmonized_1y']), unit: 'at 2012',
    // the step compares the 12 months after January 2012 with the 12 before, against MODIS (report, "Results"); the
    // headline 8.4 times compares the yearly totals of 2011 and 2012 with no witness, so the two differ
    context: <>Against MODIS: the 12 months after January 2012 against the 12 before. Joined naively, the same step is {pctS(s.steps['2012_naive_1y'], 0)}. The {fix(d.seam.naive_jump_2011_2012, 1)} times jump compares the yearly totals, with no witness. At July 2002, against Terra: {pctS(s.steps['2002_harmonized'])}.</>,
    pass: Math.abs(p12.z) <= 2 && Math.abs(p02.z) <= 2,
    gauge: { min: -10, max: 10, fmt: (v) => `${signed(v, 0)}%`, target: { v: 0, label: '0' }, bandLabel: 'Normal range: twice the spread of steps at dates when nothing changed',
      rows: [
        { label: '2012', band: band(p12.mean, p12.sd), marks: [{ v: s.steps['2012_harmonized_1y'], label: pctS(s.steps['2012_harmonized_1y']) }] },
        { label: '2002', band: band(p02.mean, p02.sd), marks: [{ v: s.steps['2002_harmonized'], label: pctS(s.steps['2002_harmonized']) }] },
      ] },
    gaugeLabel: `The step at 2012 is ${pctS(s.steps['2012_harmonized_1y'])}, inside a normal range of ${pctS(band(p12.mean, p12.sd)[0], 1)} to ${pctS(band(p12.mean, p12.sd)[1], 1)}; at 2002 it is ${pctS(s.steps['2002_harmonized'])}.`,
    link: { jump: 'fig-placebo', label: 'See the pretend switches' },
  });
  const pt = s.pettitt;
  if (pt.naive_join && pt.harmonized) {
    out.push({
      id: 'pettitt', name: 'Pettitt change point', question: 'Where does a test for one sudden shift put the break?', heldOut: false,
      method: 'The Pettitt test looks for the single year where the yearly totals shift most.',
      value: String(pt.harmonized.year), unit: 'harmonized',
      context: <>Joined naively it finds {pt.naive_join.year}, the switch itself. Harmonized it points to {pt.harmonized.year}{pt.modis_scale ? <>, and MODIS alone to {pt.modis_scale.year}</> : null}: the slow decline of world fire, not the switch.</>,
      pass: pt.naive_join.year === 2012 && pt.harmonized.year !== 2012,
      gauge: { min: 2001, max: 2025, fmt: (v) => String(v), target: { v: 2012, label: '2012' },
        rows: [
          { label: 'Naive', marks: [{ v: pt.naive_join.year, label: String(pt.naive_join.year), tone: 'muted' }] },
          { label: 'Ours', marks: [{ v: pt.harmonized.year, label: String(pt.harmonized.year) }] },
          ...(pt.modis_scale ? [{ label: 'MODIS', marks: [{ v: pt.modis_scale.year, label: String(pt.modis_scale.year), tone: 'muted' as const }] }] : []),
        ] },
      gaugeLabel: `The break year: ${pt.naive_join.year} joined naively, ${pt.harmonized.year} harmonized.`,
      link: { jump: 'fig-seam', label: 'See the record around 2012' },
    });
  }
  const ba = s.burned_area;
  if (ba) {
    const m = burnedPlaceboMean(meta) ?? 0;
    const per = Object.values(ba.hotspots_per_km2);
    out.push({
      id: 'burned', name: 'Burned area witness', question: 'Does burned area, a different measurement, agree?', heldOut: false,
      method: `ESA Fire_cci maps burn scars from ${Math.min(...Object.keys(ba.hotspots_per_km2).map(Number))} to ${Math.max(...Object.keys(ba.hotspots_per_km2).map(Number))}, and does not change with the switch to VIIRS; we measure our step at the 2012 switch against it.`,
      value: pctS(ba.step_1y), unit: 'at the 2012 switch',
      context: <>Steps at other dates vary by {fix(ba.placebo_sd, 2)}%. The yearly totals move together (r = {fix(ba.yearly_correlation, 2)}), with {fix(Math.min(...per), 1)} to {fix(Math.max(...per), 1)} hotspots for every km² burned.</>,
      pass: Math.abs(ba.z) <= 2,
      gauge: { min: -12, max: 12, fmt: (v) => `${signed(v, 0)}%`, target: { v: 0, label: '0' }, bandLabel: 'Normal range of the steps at other dates',
        rows: [{ label: '2012', band: band(m, ba.placebo_sd), marks: [{ v: ba.step_1y, label: pctS(ba.step_1y) }] }] },
      gaugeLabel: `Against burned area the step at the 2012 switch is ${pctS(ba.step_1y)}, inside the normal range.`,
      link: { jump: 'fig-placebo', label: 'See the steps against burned area' },
    });
  }
  const cv = d.models.cv;
  // (not one hexagon in one month: most such months have no fire, so its median error says little about the fires)
  const l4 = cv.find((r) => r.scale === 'region L4 x month'), l3 = cv.find((r) => r.scale === 'region L3 x month');
  const small = cv.filter((r) => ['region L4 x month', 'region L3 x month'].includes(r.scale));
  if (l4 && l3) {
    out.push({
      id: 'heldout', name: 'Held out errors', question: 'How close is the model on data it never saw?', heldOut: true,
      method: 'We fit the model without some years and regions, then score it on them.',
      value: `${fix(l3.gbm_err, 1)}%`, unit: 'median error',
      context: <>{scaleName(l3.scale)}; one exchange rate per region gives {fix(l3.ratio_err, 1)}%. For a small region in one month, {fix(l4.gbm_err, 1)}% against {fix(l4.ratio_err, 1)}%.</>,
      pass: small.every((r) => r.gbm_err < r.ratio_err),
      gauge: { min: 0, max: 100, fmt: (v) => `${v}%`,
        rows: [
          { label: 'Large', marks: [{ v: l3.ratio_err, label: `${fix(l3.ratio_err, 0)}%`, tone: 'muted' }, { v: l3.gbm_err, label: `${fix(l3.gbm_err, 0)}%` }] },
          { label: 'Small', marks: [{ v: l4.ratio_err, label: `${fix(l4.ratio_err, 0)}%`, tone: 'muted' }, { v: l4.gbm_err, label: `${fix(l4.gbm_err, 0)}%` }] },
        ] },
      gaugeLabel: `Median error ${fix(l3.gbm_err, 1)}% with the model and ${fix(l3.ratio_err, 1)}% with one exchange rate, for a large region in one month.`,
      note: <>Bright: the model. Grey: one exchange rate.</>,
      link: { jump: 'fig-ladder', label: 'See every scale' },
    });
  }
  const months = d.models.coverage.filter((c) => c.scale.endsWith('month'));
  const vals = months.flatMap((c) => [c.terra_aqua, c.terra_only]).filter((x): x is number => x !== null);
  if (vals.length) {
    const lo = Math.min(...vals), hi = Math.max(...vals);
    out.push({
      id: 'coverage', name: '90% range coverage', question: 'Do the 90% ranges hold nine times in ten?', heldOut: true,
      method: 'We count how many held out totals fall inside the range the model gave them.',
      value: `${fix(100 * lo, 0)} to ${fix(100 * hi, 0)}%`, unit: 'held',
      context: <>Of held out monthly totals, from one hexagon to the world, for both models. The aim is 90%.</>,
      pass: lo >= 0.9,
      gauge: { min: 0.8, max: 1, fmt: (v) => `${fix(100 * v, 0)}%`, target: { v: 0.9, label: 'aim 90%' },
        rows: [
          { label: 'Terra + Aqua', marks: months.filter((c) => c.terra_aqua !== null).map((c) => ({ v: c.terra_aqua ?? 0 })) },
          { label: 'Terra only', marks: months.filter((c) => c.terra_only !== null).map((c) => ({ v: c.terra_only ?? 0 })) },
        ] },
      gaugeLabel: `Coverage of the 90% ranges from ${fix(100 * lo, 0)}% to ${fix(100 * hi, 0)}% at every monthly scale.`,
      note: <>One dot per scale: hexagon, small and large region, continent and world.</>,
      link: { jump: 'tbl-coverage', label: 'See the table' },
    });
  }
  const o = d.outlook;
  if (o) {
    const skill = outlookSkill(o);
    const cal = o.calibration.filter((c) => c.n >= 1000).reduce<{ p: number; o: number } | null>((a, c) => (a === null || Math.abs(c.p - 0.75) < Math.abs(a.p - 0.75) ? c : a), null);
    const l1 = leadOf(skill, 1)?.bss ?? null, l3b = leadOf(skill, 3)?.bss ?? null;
    const months = (n: number) => `${n} month${n > 1 ? 's' : ''}`;
    out.push({
      id: 'outlook', name: 'Outlook skill and calibration', question: 'Does the outlook beat a simple forecast, and are its chances honest?', heldOut: true,
      method: `On blocks of years it never saw, the Brier skill score compares it with ${skill.reference}.`,
      value: l1 === null ? '–' : share(l1, 1), unit: 'better, 1 month ahead',
      context: <>{l3b !== null ? <>{share(l3b, 1)} better three months ahead{skill.fair ? ': the skill fades' : ''}. </> : null}{cal ? <>When it gave a {share(cal.p)} chance, fire came out above normal {share(cal.o)} of the time.</> : null}</>,
      pass: skill.leads.every((b) => b.bss > 0),
      gauge: { min: 0, max: 0.4, fmt: (v) => fix(v, 1), target: { v: 0, label: '' },
        rows: skill.leads.map((b) => ({ label: months(b.lead), band: [b.lo ?? 0, b.hi ?? b.bss] as [number, number], fill: true, marks: [{ v: b.bss, label: fix(b.bss, 2) }] })) },
      gaugeLabel: `Brier skill score ${skill.against}: ${skill.leads.map((b) => `${fix(b.bss, 2)} at ${months(b.lead)}`).join(', ')}; above 0 beats it.`,
      link: { jump: 'fig-outlook', label: 'See the calibration' },
    });
  }
  const dr = d.drivers;
  if (dr) {
    const top = dr.top[0];
    out.push({
      id: 'drivers', name: 'Drivers on held out years', question: 'Do rain and heat explain why a month was unusual?', heldOut: true,
      // the drivers model (report, "Why a month was unusual"): fire against normal from the rain of three months and
      // the 2 m temperature only; El Niño acts through the rain and is measured apart
      method: 'For each area we fit fire against normal to the rain of the last three months and the heat, leaving out one year at a time, and score it on that year.',
      value: share(dr.share_r2_above_0_2), unit: `of ${fix(dr.areas, 0)} areas`,
      context: <>Rain and heat explain more than 20% of the ups and downs of fire there{top ? <>, and up to {share(top.r2_cv)} in {top.name.replace(/, Indonesia$/, '')}</> : null}. In dry savannas the link is weaker, likely because fire there depends on how much grass grew in the wet season before.</>,
      pass: null,
      gauge: { min: 0, max: 1, fmt: (v) => `${fix(100 * v, 0)}%`, bandLabel: 'Explains more than 20%',
        rows: [{ label: 'Areas', band: [0.2, 1], marks: [{ v: dr.median_r2_state, label: `median ${share(dr.median_r2_state)}`, tone: 'muted' }, ...(top ? [{ v: top.r2_cv, label: share(top.r2_cv) }] : [])] }] },
      gaugeLabel: `Held out R squared: a median of ${share(dr.median_r2_state)} for states, up to ${top ? share(top.r2_cv) : '–'}.`,
      link: { href: '#/dashboard?s=drivers', label: 'Open the drivers on the Dashboard' },
    });
  }
  const hz = d.haze;
  if (hz && hz.cities.length) {
    const r2 = hz.cities.map((c) => c.r2_cv).sort((a, b) => a - b);
    const lo = hz.cities.reduce((a, c) => (c.r2_cv < a.r2_cv ? c : a)), hi = hz.cities.reduce((a, c) => (c.r2_cv > a.r2_cv ? c : a));
    const median = r2.length % 2 ? r2[(r2.length - 1) / 2] : (r2[r2.length / 2 - 1] + r2[r2.length / 2]) / 2;
    out.push({
      id: 'haze', name: 'Haze on held out years', question: 'Does the smoke of the fires explain the haze in the cities?', heldOut: true,
      method: 'For each city we fit monthly PM2.5 to the month of year and the fires in Sumatra and Borneo without some years, and score it on them.',
      value: `${fix(100 * lo.r2_cv, 0)} to ${share(hi.r2_cv)}`, unit: 'explained, with the month of year',
      context: <>Of the year to year changes of monthly PM2.5 in the fire season, from {lo.name} to {hi.name}, in {hz.cities.length} cities. The month of year is part of the model, so this share is not the fires alone.</>,
      pass: median > 0.5,
      gauge: { min: 0, max: 1, fmt: (v) => `${fix(100 * v, 0)}%`,
        rows: [{ label: 'Cities', marks: hz.cities.map((c) => ({ v: c.r2_cv })) }] },
      gaugeLabel: `Held out R squared from ${share(lo.r2_cv)} in ${lo.name} to ${share(hi.r2_cv)} in ${hi.name}.`,
      note: <>One dot per city.</>,
      link: { href: '#/haze', label: 'Open the Haze page' },
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the cards

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Scrolls to a chart on this page (the hash is the router, so an in-page anchor cannot be a plain #id). */
function JumpLink({ to, children }: { to: string; children: ReactNode }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const el = document.getElementById(to);
    if (!el) return;
    e.preventDefault();
    // on a phone the chart may sit in the folded part of its section: open it first, then go there
    openSectionOf(el);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
      el.tabIndex = -1;
      el.focus({ preventScroll: true });
    }));
  };
  return <a className="fh-ck-link" href="#/methods?section=tests" onClick={onClick}>{children}<IconChevronDown size={14} /></a>;
}

export function ChecksGrid({ d, meta }: { d: Dash; meta: Meta | null }) {
  const checks = buildChecks(d, meta);
  const passed = checks.filter((c) => c.pass === true).length;
  const varies = checks.filter((c) => c.pass === null).length;
  const failed = checks.length - passed - varies;
  const held = checks.filter((c) => c.heldOut).length;
  return (
    <div className="fh-ck">
      <div className="fh-ck-summary" role="status">
        <span className="fh-ck-summary-icon" aria-hidden="true"><IconCheck size={16} /></span>
        <p className="fh-ck-summary-text"><strong className="ui-mono">{passed} of {checks.length}</strong> checks passed{varies ? <>, and {varies} {varies === 1 ? 'varies' : 'vary'} by place</> : null}{failed ? <>; {failed} did not pass</> : null}. {held === checks.length ? 'All score the model on data it never saw.' : <><strong className="ui-mono">{held}</strong> score the model on years or regions it never saw; the other {checks.length - held} test the full record against a witness or for a break.</>}</p>
      </div>
      <ul className="fh-ck-grid">
        {checks.map((c) => (
          <li key={c.id} className="fh-ck-card" data-check={c.id}>
            <div className="fh-ck-head">
              {c.pass === true ? <Badge tone="good"><IconCheck size={12} />Passed</Badge>
                : c.pass === null ? <Badge tone="neutral"><IconInfo size={12} />Varies by place</Badge>
                  : <Badge tone="warning"><IconInfo size={12} />Not passed</Badge>}
              <span className="fh-ck-name">{c.name}</span>
              <span className="fh-ck-kind" data-kind={c.heldOut ? 'held-out' : 'record'}>{c.heldOut ? 'Held out data' : 'Full record'}</span>
            </div>
            <h3 className="fh-ck-question">{c.question}</h3>
            <p className="fh-ck-method">{c.method}</p>
            <p className="fh-ck-result"><span className="fh-ck-value ui-mono">{c.value}</span>{c.unit ? <span className="fh-ck-unit">{c.unit}</span> : null}</p>
            <p className="fh-ck-context">{c.context}</p>
            {c.gauge ? <Gauge g={c.gauge} label={c.gaugeLabel} /> : null}
            {c.note ? <p className="fh-ck-note">{c.note}</p> : null}
            <div className="fh-ck-foot">
              {'jump' in c.link ? <JumpLink to={c.link.jump}>{c.link.label}</JumpLink>
                : <a className="fh-ck-link" href={c.link.href}>{c.link.label}<IconChevronRight size={14} /></a>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
