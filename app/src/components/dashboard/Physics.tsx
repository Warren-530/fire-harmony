// 7. Why VIIRS sees more fire: the share of VIIRS fires that MODIS also saw, by fire strength, and by test tile.
// 8. Removing heat that is not fire: the static source mask, tested on years it never saw.
import { useState, type CSSProperties } from 'react';
import * as Plot from '@observablehq/plot';
import type { DashboardData } from '../../lib/dashboard-types';
import { Card, PlotFigure, StatTile } from '../ui';
import { DbSection } from './DbSection';
import { hgrid, palette, tipLook } from './chart';
import { dec, int, share, tilePlace } from './format';
import { Keys, Meter, SortableTable, type SortColumn, type SortState } from './parts';

type Physics = NonNullable<DashboardData['physics']>;
type CurvePoint = Physics['curve'][number];
type TileRow = Physics['tiles'][number];
type SeriesKey = 'aqua_night' | 'aqua_day' | 'terra_night' | 'terra_day';

const SERIES: { key: SeriesKey; label: string; night: boolean; main: boolean }[] = [
  { key: 'aqua_night', label: 'Aqua, night', night: true, main: true },
  { key: 'aqua_day', label: 'Aqua, day', night: false, main: true },
  { key: 'terra_night', label: 'Terra, night', night: true, main: false },
  { key: 'terra_day', label: 'Terra, day', night: false, main: false },
];

const mw = (v: number): string => `${v < 10 ? dec(v, 1).replace(/\.0$/, '') : int(v)} MW`;

function BarCell({ value, max, text, colour }: { value: number; max: number; text: string; colour: string }) {
  return (
    <span className="db-share">
      <span className="db-share-track" aria-hidden="true">
        <span className="db-share-fill" style={{ '--db-frac': value / max, background: `var(${colour})` } as CSSProperties} />
      </span>
      <span className="ui-mono db-share-num">{text}</span>
    </span>
  );
}

export function Physics({ d }: { d: DashboardData }) {
  const ph = d.physics;
  const [sort, setSort] = useState<SortState>({ key: 'ratio', dir: 'desc' });
  if (!ph) return null;
  const long = ph.curve.flatMap((c) => SERIES.flatMap((s) => (c[s.key] === null ? [] : [{ frp: c.frp, series: s.label, key: s.key, v: c[s.key] as number }])));
  const ends = SERIES.map((s) => long.filter((x) => x.key === s.key).slice(-1)[0]).filter((x): x is (typeof long)[number] => x !== undefined);
  // The fire strength at which Aqua sees one VIIRS fire in two, marked on its night and day lines.
  const halves = (['aqua_night', 'aqua_day'] as const).flatMap((key) => {
    const frp = ph.half_mw[key];
    return frp === null ? [] : [{ frp, key, value: mw(frp), when: key === 'aqua_day' ? 'by day' : 'at night' }];
  });
  const most = [...ph.tiles].sort((a, b) => b.viirs_per_aqua - a.viirs_per_aqua)[0];
  const maxRatio = Math.max(...ph.tiles.map((r) => r.viirs_per_aqua));
  const tileColumns: SortColumn<TileRow>[] = [
    { key: 'place', label: 'Test tile', sort: (r) => tilePlace(r.tile, r.lat, r.lon), render: (r) => (
      <span className="db-place"><span>{tilePlace(r.tile, r.lat, r.lon)}</span><span className="db-place-sub ui-mono">{r.tile}</span></span>
    ) },
    { key: 'weak', label: 'Weak fires, below 5 MW', num: true, sort: (r) => r.weak_share,
      render: (r) => <BarCell value={r.weak_share} max={1} text={share(r.weak_share)} colour="--anom-b3" />, className: 'db-col-share' },
    { key: 'ratio', label: 'VIIRS fires per Aqua fire', num: true, sort: (r) => r.viirs_per_aqua,
      render: (r) => <BarCell value={r.viirs_per_aqua} max={maxRatio} text={dec(r.viirs_per_aqua, 1)} colour="--sensor-noaa20" />, className: 'db-col-share' },
    { key: 'n', label: 'VIIRS fires checked', num: true, sort: (r) => r.points, render: (r) => <span className="ui-mono">{int(r.points)}</span> },
  ];

  return (
    <DbSection id="db-physics" title="Why VIIRS sees more fire"
      subtitle={`We took ${int(ph.points)} Suomi NPP VIIRS fires on ${ph.tiles.length} test tiles in 2019 and checked which ones MODIS also saw, from a clear view on the same day. VIIRS has smaller pixels, so it finds small and weak fires that MODIS misses.`}>
      <div className="db-row db-row-8-4 db-keep">
        <Card>
          <PlotFigure
            title="MODIS sees strong fires and misses most weak ones"
            subtitle={(
              <>
                Share of VIIRS fires that MODIS also saw, by fire strength (fire radiative power, MW, log scale). Aqua passes at the same hours as Suomi NPP; Terra about three hours earlier.
                <Keys items={[
                  { label: 'Aqua, night', colour: 'var(--anom-b4)', shape: 'line' },
                  { label: 'Aqua, day', colour: 'var(--sensor-modis)', shape: 'line' },
                  { label: 'Terra, night', colour: 'var(--anom-b4)', shape: 'line', opacity: 0.45 },
                  { label: 'Terra, day', colour: 'var(--sensor-modis)', shape: 'line', opacity: 0.45 },
                  ...(halves.length ? [{ label: 'Aqua sees one fire in two', colour: 'var(--sensor-modis)', shape: 'dot' as const }] : []),
                ]} />
              </>
            )}
            source="Source: Fire Harmony physics check (fireharmony/physics.py), NASA FIRMS MODIS and VIIRS, 2019."
            height={320}
            deps={[d]}
            build={(width) => {
              const p = palette();
              const colour = (key: SeriesKey) => (key.endsWith('night') ? p.modisNight : p.modis);
              const narrow = width < 480;
              const marginLeft = 44, marginRight = narrow ? 72 : 84;
              // The labels of the two half points sit just below and to the right of each point, between the lines.
              // The room there grows with the width of a decade on the log scale: the full label on one line when it
              // fits, on two lines when it fits that way, and the number alone (with the key explaining the dots).
              const perDecade = (width - marginLeft - marginRight) / Math.log10(330 / 0.6);
              const fit = perDecade >= 180 ? 'line' : perDecade >= 140 ? 'two' : 'short';
              const halfText = (h: (typeof halves)[number]) => (fit === 'line' ? `${h.value} ${h.when}` : fit === 'two' ? `${h.value}\n${h.when}` : h.value);
              return {
                height: 320, marginLeft, marginRight, marginTop: 14, marginBottom: 34,
                x: { type: 'log', domain: [0.6, 330], ticks: narrow ? [1, 10, 100] : [1, 3, 10, 30, 100, 300], tickSize: 0, label: null,
                  tickFormat: (v: number) => mw(v) },
                y: { domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1], tickFormat: (v: number) => share(v), tickSize: 0, label: null },
                marks: [
                  hgrid(p, { ticks: [0, 0.25, 0.5, 0.75, 1] }),
                  Plot.ruleY([0], { stroke: p.baseline }),
                  ...SERIES.slice().reverse().map((s) => Plot.lineY(long.filter((x) => x.key === s.key), {
                    x: 'frp', y: 'v', stroke: colour(s.key), strokeWidth: s.main ? 2.2 : 1.6, strokeOpacity: s.main ? 1 : 0.45,
                    strokeLinejoin: 'round', strokeLinecap: 'round',
                  })),
                  Plot.dot(halves, { x: 'frp', y: () => 0.5, r: 4.5, fill: (h: (typeof halves)[number]) => colour(h.key), stroke: p.surface, strokeWidth: 2 }),
                  Plot.text(halves, { x: 'frp', y: () => 0.5, text: halfText, dx: fit === 'short' ? 6 : 8, dy: fit === 'line' ? 12 : fit === 'two' ? 6 : 3,
                    lineAnchor: fit === 'two' ? 'top' : 'middle', lineHeight: 1.15, textAnchor: 'start', fill: p.ink, fontWeight: 600,
                    stroke: p.surface, strokeWidth: 4 }),
                  Plot.text(ends, { x: 'frp', y: 'v', text: 'series', dx: 8, textAnchor: 'start', fill: p.ink2 }),
                  Plot.ruleX(ph.curve, Plot.pointerX({ x: 'frp', stroke: p.baseline, strokeWidth: 1 })),
                  Plot.tip(ph.curve, Plot.pointerX({
                    x: 'frp', y: (c: CurvePoint) => c.aqua_day ?? c.aqua_night ?? 0, ...tipLook(p),
                    title: (c: CurvePoint) => [`Fires of about ${mw(c.frp)}`,
                      ...SERIES.map((s) => `${s.label}: ${c[s.key] === null ? 'too few fires' : share(c[s.key] as number)}`)].join('\n'),
                  })),
                ],
              };
            }}
            table={{
              columns: ['Fire strength', ...SERIES.map((s) => s.label)],
              rows: ph.curve.map((c) => [mw(c.frp), ...SERIES.map((s) => (c[s.key] === null ? '–' : share(c[s.key] as number)))]),
            }}
          />
        </Card>
        <div className="db-col-fill db-wrap">
          <StatTile label="VIIRS fires that Aqua also saw, by day" value={share(ph.seen.aqua_day)}
            context={<>{share(ph.seen.aqua_night)} at night. Terra, three hours earlier, saw {share(ph.seen.terra_day)} by day and {share(ph.seen.terra_night)} at night.<Meter value={ph.seen.aqua_day} colour="--sensor-modis" label={`${share(ph.seen.aqua_day)} of VIIRS fires`} /></>} />
          {ph.half_mw.aqua_day !== null && ph.half_mw.aqua_night !== null ? (
            <StatTile label="Aqua sees one fire in two at" value={mw(ph.half_mw.aqua_day).replace(' MW', '')} unit="MW by day"
              context={`and at ${mw(ph.half_mw.aqua_night)} at night. MODIS misses most fires weaker than this.`} />
          ) : null}
          <StatTile label="VIIRS fires under cloud at the Aqua pass" value={share(ph.cloud_share, 1)}
            context="So cloud is not the reason MODIS sees fewer fires. Weak fires are." />
        </div>
      </div>
      <Card title={most ? `Where most fires are weak, VIIRS sees many more: ${dec(most.viirs_per_aqua, 1)} for every Aqua fire in ${tilePlace(most.tile, most.lat, most.lon)}` : 'By test tile'}
        subtitle="Each test tile is one MODIS tile, about 1,100 km across. Clear view only. Select a column to sort.">
        <SortableTable columns={tileColumns} rows={ph.tiles} rowKey={(r) => r.tile} sort={sort} onSort={setSort}
          caption="Test tiles: share of weak fires, VIIRS fires per Aqua fire and the number of fires checked" className="db-table-tiles" />
      </Card>
    </DbSection>
  );
}

function Score({ label, value, frac, colour, note }: { label: string; value: string; frac: number; colour: string; note?: string }) {
  return (
    <div className="db-score-row">
      <dt>{label}</dt>
      <dd>
        <span className="db-score-value ui-mono">{value}</span>
        <Meter value={frac} colour={colour} label={`${label}: ${value}`} />
        {note ? <span className="db-score-note">{note}</span> : null}
      </dd>
    </div>
  );
}

export function Mask({ d }: { d: DashboardData }) {
  const cards = (['viirs', 'modis'] as const).map((k) => ({ k, name: k === 'viirs' ? 'VIIRS' : 'MODIS', colour: k === 'viirs' ? '--sensor-noaa20' : '--sensor-modis', ...d.mask[k] }));
  return (
    <DbSection id="db-mask" title="Removing heat that is not fire"
      subtitle="Gas flares, volcanoes and factories are hot every day, so satellites mark them too. NASA labels most of them, but the newest months have no label yet. For those we use a mask of known hot places, built from data up to 2022 and tested on 2024 and 2025.">
      <div className="db-row db-row-6-6">
        {cards.map((c) => (
          <Card key={c.k} title={<span className="db-sensor-title"><span className="db-dot" style={{ background: `var(${c.colour})` }} />{c.name}</span>}
            subtitle="Tested on 2024 and 2025, years the mask never saw.">
            <dl className="db-score">
              <Score label="Static heat caught" value={share(c.recall, 1)} frac={c.recall} colour={c.colour}
                note="of detections at gas flares, volcanoes and factories fall inside the mask" />
              <Score label="Removed that is really static heat" value={share(c.precision, 1)} frac={c.precision} colour={c.colour}
                note="of what the mask removes" />
              <Score label="Real fires removed by mistake" value={share(c.fire_loss, 2)} frac={c.fire_loss} colour="--text-2"
                note="of vegetation fires" />
            </dl>
          </Card>
        ))}
      </div>
    </DbSection>
  );
}
