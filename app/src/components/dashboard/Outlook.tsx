// 10. The outlook: the chance of above normal fire one to three months ahead, how much better it is than the normal
// chance (Brier skill score on years the model never saw), whether its chances can be trusted, and the highest
// chances for next month. Every place opens in the Explorer.
import type { ReactNode } from 'react';
import * as Plot from '@observablehq/plot';
import { DICTS } from '../../lib/i18n';
import type { DashboardData } from '../../lib/dashboard-types';
import { Card, PlotFigure, StatTile } from '../ui';
import { DbSection } from './DbSection';
import { hgrid, importanceMarks, palette, tipLook, vgrid } from './chart';
import { dec, int, monthName, monthYear, outlookInput, pct, share } from './format';
import { Keys, Meter, RankList } from './parts';
import { outlookSkill } from '../methods/skill';

const t = DICTS.en;
const SOURCE = 'Source: Fire Harmony outlook (fireharmony/outlook.py), scored on blocks of years the model never saw.';

type Outlook = NonNullable<DashboardData['outlook']>;
type Cal = Outlook['calibration'][number];

const leadLabel = (lead: number): string => `${lead} ${lead === 1 ? 'month' : 'months'} ahead`;
const LEAD_OPACITY: Record<number, number> = { 1: 1, 2: 0.6, 3: 0.32 };
const QUARTERS = [0, 0.25, 0.5, 0.75, 1];

function skillWord(bss: number): string {
  return bss < 0.05 ? t.outlook.skillLabel.none : bss < 0.2 ? t.outlook.skillLabel.some : t.outlook.skillLabel.good;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function OutlookSection({ d, note }: { d: DashboardData; note?: ReactNode }) {
  const o = d.outlook;
  if (!o) return null;
  const issued = Number(o.issued_from.slice(0, 4)) * 100 + Number(o.issued_from.slice(5, 7));
  const target = o.top_now[0] ? o.top_now[0].target_yr * 100 + o.top_now[0].target_mo : null;
  const near = o.calibration.reduce<Cal | null>((b, c) => (c.n >= 1000 && (!b || Math.abs(c.p - 0.75) < Math.abs(b.p - 0.75)) ? c : b), null);
  const calTitle = near
    ? `When the outlook says ${share(near.p)}, fire comes out above normal ${share(near.o)} of the time`
    : 'The chances of the outlook can be trusted';
  // the skill against the reference the release scores: a fixed 50% chance when dashboard.json has it (as in the
  // report), else the share of past years above normal ("the normal chance")
  const skill = outlookSkill(o);
  const refName = skill.fair ? 'a fixed 50% chance' : 'the normal chance';
  const conts = [...(skill.continents.length ? skill.continents : o.by_continent)].sort((a, b) => b.l1 - a.l1);
  const contRows = conts.flatMap((c) => [1, 2, 3].map((lead) => ({ name: c.name, lead, bss: lead === 1 ? c.l1 : lead === 2 ? c.l2 : c.l3 })));
  const bestCont = conts.slice(0, 2).map((c) => c.name), worstCont = conts[conts.length - 1]?.name;
  const maxBss = Math.max(0.01, ...skill.leads.map((b) => b.bss), skill.recent ?? 0);
  const imp = o.importance.map((f) => ({ name: outlookInput(f.feature), pct: f.pct }));

  return (
    <DbSection id="db-outlook" lead={note} title="The outlook"
      subtitle={`The chance of above normal fire in each of ${int(o.areas)} areas, one to three months ahead, for months of the fire season. Above normal means more fire than in half of the years 2001 to 2025 for that month.`}>
      <div className="db-row db-row-4">
        {skill.leads.map((b) => {
          const better = skill.share?.[String(b.lead)];
          return (
            <StatTile key={b.lead} label={leadLabel(b.lead)} value={share(b.bss)} unit="better"
              context={<>than {refName} (Brier skill score {dec(b.bss, 2)}).{better !== undefined ? <> Better in {share(better, 1)} of areas.</> : null}
                <Meter value={Math.max(0, b.bss) / maxBss} colour="--accent" label={`Skill ${share(b.bss)}`} /></>} />
          );
        })}
        {skill.recent !== null ? (
          <StatTile label="On 2022 to 2025 alone" value={share(skill.recent)} unit="better"
            context={<>The newest years, all three leads together. The skill holds on years the model never saw.
              <Meter value={Math.max(0, skill.recent) / maxBss} colour="--accent" label={`Skill ${share(skill.recent)}`} /></>} />
        ) : null}
      </div>

      <div className="db-row db-row-3 db-row-3-charts">
        <Card>
          <PlotFigure
            title={calTitle}
            subtitle={(
              <>
                Chance given (across), against the share of times fire came out above normal (up), in {o.calibration.length} groups. On the diagonal, the chances can be trusted.
                <Keys items={[
                  { label: 'Outlook (dot size: number of cases)', colour: 'var(--text)', shape: 'dot' },
                  { label: 'Perfect trust', colour: 'var(--text-2)', shape: 'line' },
                ]} />
              </>
            )}
            source={SOURCE}
            height={330}
            deps={[d]}
            build={() => {
              const p = palette();
              return {
                height: 330, marginLeft: 44, marginRight: 20, marginTop: 14, marginBottom: 30,
                x: { domain: [0, 1], ticks: QUARTERS, tickFormat: (v: number) => share(v), tickSize: 0, label: null },
                y: { domain: [0, 1], ticks: QUARTERS, tickFormat: (v: number) => share(v), tickSize: 0, label: null },
                r: { range: [2.5, 10] },
                marks: [
                  hgrid(p, { ticks: QUARTERS }),
                  vgrid(p, { ticks: QUARTERS }),
                  Plot.line([[0, 0], [1, 1]], { stroke: p.ink2, strokeWidth: 1.2, strokeOpacity: 0.8 }),
                  Plot.lineY(o.calibration, { x: 'p', y: 'o', stroke: p.ink, strokeWidth: 2, strokeLinejoin: 'round' }),
                  Plot.dot(o.calibration, { x: 'p', y: 'o', r: 'n', fill: p.ink, stroke: p.surface, strokeWidth: 2 }),
                  Plot.tip(o.calibration, Plot.pointer({ x: 'p', y: 'o', ...tipLook(p),
                    title: (c: Cal) => `Chance given ${share(c.p)}\nAbove normal ${share(c.o)} of the time\n${int(c.n)} cases` })),
                ],
              };
            }}
            table={{ columns: ['Chance given', 'Came out above normal', 'Cases'],
              rows: o.calibration.map((c) => [share(c.p, 1), share(c.o, 1), int(c.n)]) }}
          />
        </Card>
        <Card>
          <PlotFigure
            title={`Skill is highest in ${bestCont.join(' and ')}${worstCont ? `, lowest in ${worstCont}` : ''}`}
            subtitle={(
              <>
                How much better than {refName}, by continent and lead, %. Zero is no better.
                <Keys items={[1, 2, 3].map((lead) => ({ label: leadLabel(lead), colour: 'var(--accent)', shape: 'dot' as const, opacity: LEAD_OPACITY[lead] }))} />
              </>
            )}
            source={SOURCE}
            height={330}
            deps={[d]}
            build={(width) => {
              const p = palette();
              const xMax = Math.max(0.1, Math.ceil(Math.max(...contRows.map((r) => r.bss)) * 20) / 20);
              return {
                height: 330, marginLeft: width < 420 ? 98 : 112, marginRight: 18, marginTop: 10, marginBottom: 30,
                x: { domain: [Math.min(0, ...contRows.map((r) => r.bss)), xMax], ticks: 4, tickFormat: (v: number) => share(v), tickSize: 0, label: null },
                y: { domain: conts.map((c) => c.name), label: null, tickSize: 0, padding: 0.4 },
                marks: [
                  vgrid(p, { ticks: 4 }),
                  Plot.ruleX([0], { stroke: p.baseline }),
                  Plot.ruleY(conts, { y: 'name', x1: (c: (typeof conts)[number]) => Math.min(c.l1, c.l2, c.l3),
                    x2: (c: (typeof conts)[number]) => Math.max(c.l1, c.l2, c.l3), stroke: p.border, strokeWidth: 2 }),
                  Plot.dot(contRows.slice().reverse(), { x: 'bss', y: 'name', fill: p.accent, fillOpacity: (r: (typeof contRows)[number]) => LEAD_OPACITY[r.lead],
                    r: 6.5, stroke: p.surface, strokeWidth: 1.5 }),
                  Plot.text(conts, { x: 'l1', y: 'name', text: (c: (typeof conts)[number]) => share(c.l1), dy: -14, fill: p.ink, fontSize: 11 }),
                  Plot.tip(contRows, Plot.pointer({ x: 'bss', y: 'name', ...tipLook(p),
                    title: (r: (typeof contRows)[number]) => `${r.name}, ${leadLabel(r.lead)}\n${share(r.bss)} better than ${refName}` })),
                ],
              };
            }}
            table={{ columns: ['Continent', ...[1, 2, 3].map(leadLabel)], rows: conts.map((c) => [c.name, share(c.l1), share(c.l2), share(c.l3)]) }}
          />
        </Card>
        <Card>
          <PlotFigure
            title="Fire now is the best guide to fire next month"
            subtitle={`What the outlook model leans on: share of its learning gain from each input, %, top ${imp.length}.`}
            source="Source: Fire Harmony outlook model (LightGBM gain importance)."
            height={imp.length * 33 + 8}
            deps={[d]}
            build={(width) => { const p = palette(); return importanceMarks(imp, p.ember(600), p, width); }}
            table={{ columns: ['Input', 'Share of the gain'], rows: imp.map((f) => [f.name, pct(f.pct, 1)]) }}
          />
        </Card>
      </div>

      <div className="db-row">
        <Card title={target ? `Highest chances of above normal fire in ${monthYear(target)}` : 'Highest chances of above normal fire next month'}
          subtitle={`From the data to ${monthYear(issued)}. Areas whose outlook was useful in past tests. The tick marks the normal chance for ${target ? monthName(target % 100) : 'that month'}. Select a row to open it in the Explorer.`}>
          <RankList label="Highest chances of above normal fire next month" colour="--ember-600" tickLabel="Normal chance" columns={2}
            items={o.top_now.map((a) => ({
              key: `${a.kind}:${a.id}`, kind: a.kind, id: a.id,
              name: a.name,
              linkLabel: `${a.name}: ${share(a.p)} chance of above normal fire, ${t.outlook.normalChance(share(a.p_clim))}. Open in the Explorer`,
              detail: `${cap(t.outlook.normalChance(share(a.p_clim)))}. ${skillWord(a.bss)}.`,
              value: share(a.p),
              frac: a.p,
              tick: a.p_clim,
            }))} />
        </Card>
      </div>
    </DbSection>
  );
}
