// 9. What drives unusual months: how much of the ups and downs of fire rain deficits and heat explain in each area
// (on years left out), where they explain the most, and where El Niño brings drought.
import { useState, type CSSProperties, type ReactNode } from 'react';
import * as Plot from '@observablehq/plot';
import type { DashboardData } from '../../lib/dashboard-types';
import { openArea } from '../../lib/commands';
import { Card, PlotFigure, StatTile } from '../ui';
import { DbSection } from './DbSection';
import { hgrid, palette, tipLook } from './chart';
import { dec, int, share } from './format';
import { AreaLink, RankList, SortableTable, type SortColumn, type SortState } from './parts';

type Drivers = NonNullable<DashboardData['drivers']>;
type Bin = Drivers['hist'][number];
type Top = Drivers['top'][number];

const r100 = (v: number): number => Math.round(v * 100);

function binLabel(b: Bin): string {
  if (b.lo < 0) return 'Below 0';
  if (b.hi >= 1) return `${r100(b.lo)}% or more`;
  return `${r100(b.lo)} to ${r100(b.hi)}%`;
}

export function Drivers({ d, note }: { d: DashboardData; note?: ReactNode }) {
  const dr = d.drivers;
  const [sort, setSort] = useState<SortState>({ key: 'r2', dir: 'desc' });
  if (!dr) return null;
  const bins = dr.hist.map((b) => ({ ...b, label: binLabel(b), strong: b.lo >= 0.2 - 1e-9 }));
  const total = bins.reduce((s, b) => s + b.n, 0);
  const strongN = bins.filter((b) => b.strong).reduce((s, b) => s + b.n, 0);
  const maxR2 = Math.max(...dr.top.map((a) => a.r2_cv), 0.01);
  const topColumns: SortColumn<Top>[] = [
    { key: 'name', label: 'State', sort: (a) => a.name, render: (a) => <AreaLink kind={a.kind} id={a.id}>{a.name}</AreaLink> },
    { key: 'r2', label: 'Weather explains', num: true, sort: (a) => a.r2_cv, className: 'db-col-share', render: (a) => (
      <span className="db-share">
        <span className="db-share-track" aria-hidden="true"><span className="db-share-fill" style={{ '--db-frac': Math.max(0, a.r2_cv) / maxR2 } as CSSProperties} /></span>
        <span className="ui-mono db-share-num">{share(a.r2_cv)}</span>
      </span>
    ) },
    { key: 'dry', label: 'Fire, one step drier', num: true, sort: (a) => Math.exp(-a.beta_rain),
      render: (a) => <span><span className="ui-mono">{dec(Math.exp(-a.beta_rain), 1)}</span><span className="db-unit"> times</span></span> },
    { key: 'enso', label: 'El Niño and rain, r', num: true, sort: (a) => a.enso_r ?? 0, first: 'asc',
      render: (a) => (a.enso_r === null ? <span className="db-muted">–</span> : <span className="ui-mono">{dec(a.enso_r, 2)}</span>) },
  ];

  return (
    <DbSection id="db-drivers" lead={note} title="What drives unusual months"
      subtitle={`For ${int(dr.areas)} areas with enough fire, we measured how strongly fire follows a rain deficit and heat, on years the model never saw.`}>
      <div className="db-row db-row-8-4 db-keep">
        <Card>
          <PlotFigure
            title={`Rain and heat explain more than a fifth of the ups and downs of fire in ${share(dr.share_r2_above_0_2)} of areas`}
            subtitle="Areas by the share of the ups and downs of monthly fire that the weather explains on years left out (R²). Below 0 means no better than expecting a normal month. The bars from 20% up are lit."
            source="Source: Fire Harmony drivers (fireharmony/drivers.py), with NASA GPM IMERG rain and MERRA-2 temperature."
            height={290}
            deps={[d]}
            build={(width) => {
              const p = palette();
              const narrow = width < 560;
              // on a phone the bands are about 30 px wide: a steeper slant keeps the bin names apart
              const steep = width < 420;
              return {
                height: 290, marginLeft: 40, marginRight: 8, marginTop: 12, marginBottom: steep ? 60 : narrow ? 50 : 34,
                x: { domain: bins.map((b) => b.label), label: null, tickSize: 0, padding: 0.22, tickRotate: steep ? -45 : narrow ? -32 : 0 },
                y: { domain: [0, Math.max(...bins.map((b) => b.n)) * 1.1], ticks: 4, tickFormat: (v: number) => int(v), tickSize: 0, label: null },
                color: { domain: [false, true], range: [p.muted, p.ember(600)] },
                marks: [
                  hgrid(p, { ticks: 4 }),
                  Plot.barY(bins, { x: 'label', y: 'n', fill: 'strong', fillOpacity: (b: (typeof bins)[number]) => (b.strong ? 1 : 0.5), ry2: 3 }),
                  Plot.ruleY([0], { stroke: p.baseline }),
                  Plot.text(bins, { x: 'label', y: 'n', text: (b: (typeof bins)[number]) => int(b.n), dy: -8, fill: p.ink2, fontSize: 11 }),
                  Plot.tip(bins, Plot.pointerX({ x: 'label', y: 'n', ...tipLook(p),
                    title: (b: (typeof bins)[number]) => `${b.label} explained\n${int(b.n)} areas (${share(b.n / total, 1)})` })),
                ],
              };
            }}
            table={{ columns: ['Share explained (R²)', 'Areas'], rows: bins.map((b) => [b.label, int(b.n)]) }}
          />
        </Card>
        <div className="db-col-fill db-wrap">
          <StatTile label="Areas with a driver model" value={int(dr.areas)}
            context="The world, continents, countries and states with enough fire for a fair test." />
          <StatTile label="Weather explains more than 20%" value={share(dr.share_r2_above_0_2)}
            context={`of these areas (${int(strongN)}), the lit bars.${dr.top[0] ? ` The most is ${share(dr.top[0].r2_cv)}, in ${dr.top[0].name}.` : ''}`} />
          <StatTile label="Median for states" value={share(dr.median_r2_state)}
            context="In most states the weather alone explains little of the ups and downs, so read their drivers as context." />
        </div>
      </div>
      <div className="db-row db-row-7-5">
        <Card title="Where the weather explains the most"
          subtitle="States with at least 3,000 hotspots a year. One step drier means rain over three months as low as in about one year in six. Select a row to open the state in the Explorer.">
          <SortableTable columns={topColumns} rows={dr.top} rowKey={(a) => `${a.kind}:${a.id}`} sort={sort} onSort={setSort}
            caption="States where the weather explains the most of the ups and downs of fire" onRowClick={(a) => openArea(a.kind, a.id)}
            className="db-table-drivers" />
        </Card>
        <Card title="Where El Niño brings drought"
          subtitle="Countries whose rain falls most in El Niño years: the correlation r of rain over three months with the El Niño index (ONI), from 0 to −1.">
          <RankList label="Countries where El Niño brings drought" colour="--anom-b3"
            items={dr.enso.map((a) => ({
              key: a.id, kind: 'country', id: a.id,
              name: a.name,
              linkLabel: `${a.name}: r = ${dec(a.enso_r, 2)}. Open in the Explorer`,
              detail: a.enso_lag === 0 ? 'In the same months' : `About ${a.enso_lag} ${a.enso_lag === 1 ? 'month' : 'months'} later`,
              value: <>r = {dec(a.enso_r, 2)}</>,
              frac: Math.min(1, Math.abs(a.enso_r)),
            }))} />
        </Card>
      </div>
    </DbSection>
  );
}
