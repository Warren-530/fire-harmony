// Methods, "A first look at the raw record": the record as NASA publishes it, before harmonizing (report Section 3,
// fireharmony/eda.py). Every number comes from web/eda.json, or from dashboard.json for the physics test, with the
// rounding the report uses, so the page and report/report.qmd read the same (eda.test.ts checks the sentences).
import { FoldSection } from './Fold';
import { useMemo, type ReactNode } from 'react';
import * as Plot from '@observablehq/plot';
import { Callout, Card, DataTable, Grid, Note, PlotFigure, type Column, type FigureTable } from '../ui';
import { Lede, MarginNote, N, Sub } from '../pages/DocLayout';
import { CellLabel } from '../pages/parts';
import type { DashboardData } from '../../lib/dashboard-types';
import { halo, mwFormat, mwTicks, pal, tip, gridY, gridX } from './charts';
import {
  SENSOR_NAME, clock, fix, frpShares, int, mil2, per, perWhole, type Eda, type EdaSensor, type FrpPoint, type SensorId,
} from './eda';

const SOURCE = 'Source: NASA FIRMS; analysis: Fire Harmony';
const PART = { day: 'By day', night: 'At night' } as const;
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

const yearSpan = (y: [number, number]) => `${y[0]} to ${y[1]}`;

// ------------------------------------------------------------------------------------------------ the section

export function RawRecordSection({ e, d }: { e: Eda; d: DashboardData }) {
  const s = (id: SensorId) => e.sensors.find((x) => x.id === id);
  const viirs = e.sensors.filter((x) => x.family === 'VIIRS');
  const modis = e.sensors.filter((x) => x.family === 'MODIS');
  const terra = s('terra'), aqua = s('aqua');
  const spa = e.overlap.snpp_per_aqua;
  const range = (xs: number[], unit = '', digits = 0) => {
    const lo = fix(Math.min(...xs), digits), hi = fix(Math.max(...xs), digits);
    return lo === hi ? `${lo}${unit}` : `${lo}${unit} to ${hi}${unit}`;
  };
  const mean = (xs: number[]) => xs.reduce((a, v) => a + v, 0) / xs.length;
  return (
    <FoldSection id="raw-record" title="A first look at the raw record" subtitle="Five satellites and two kinds of hotspot, before we changed a single number.">
      <Lede aside={(
        <MarginNote label="Suomi NPP against Aqua, same hour" value={`${fix(spa.hotspots, 1)}×`} unit="hotspots">
          But only <N>{fix(spa.frp, 1)}</N>× the fire power: VIIRS adds weak fires and splits large ones, {yearSpan(e.overlap.years)}.
        </MarginNote>
      )}>
        <p>Before we changed a single number, we studied the record as NASA publishes it. We read all <N>{int(e.record.hotspots)}</N> hotspots once, region file by region file, and counted them by satellite, year, day or night, confidence, NASA’s type label, fire radiative power (FRP) and local time. So every number here covers the whole archive, not a sample.</p>
        <p>The two families behave like different instruments, because they are. A VIIRS satellite counts about <N>{fix(mean(viirs.map((v) => v.hotspots_per_year)) / 1e6, 0)} million</N> hotspots a year{terra && aqua ? <>, Terra <N>{fix(terra.hotspots_per_year / 1e6, 1)} million</N> and Aqua <N>{fix(aqua.hotspots_per_year / 1e6, 1)} million</N></> : null}. Its hotspots are also much weaker. Of the hotspots that enter our record, the median VIIRS hotspot carries <N>{range(viirs.map((v) => v.frp_q_day.p50))} MW</N> by day, against <N>{range(modis.map((v) => v.frp_q_day.p50))} MW</N> for MODIS, and <N>{range(viirs.map((v) => v.below_10mw_pct), '%')}</N> are below 10 MW.</p>
      </Lede>

      <Sub title="Five satellites, two kinds of hotspot">
        <SensorTable e={e} />
        <Lede>
          <p>The labels differ too. MODIS calls <N>{range(modis.map((v) => v.confidence_pct.high), '%')}</N> of its hotspots high confidence, but VIIRS only <N>{range(viirs.map((v) => v.confidence_pct.high), '%')}</N>. The two families set their confidence with different tests, so the classes are not one scale. We keep what each sensor itself calls nominal or high. NASA labels <N>{range(e.sensors.filter((v) => v.static_labels_pct > 0).map((v) => v.static_labels_pct), '%')}</N> of the hotspots as volcanoes, gas flares, other static sources or offshore. NOAA‑21 has no such label at all, which is one reason we built our own mask of static sources.</p>
        </Lede>
      </Sub>

      <WeakFires e={e} d={d} />
      <PassHour e={e} />
      <ExchangeRate e={e} finding={(
        <Callout title="Key finding">
          <p>The raw record is two records. At the same hour, Suomi NPP counts <N>{fix(spa.hotspots, 1)} times</N> as many hotspots as Aqua but only <N>{fix(spa.frp, 1)} times</N> the fire power: VIIRS adds weak fires and splits large ones. In 9 hexagons out of 10 the rate lies between <N>{fix(e.exchange_rate_l3.q05, 1)}</N> and <N>{fix(e.exchange_rate_l3.q95, 1)}</N>, and it moves mostly with the share of fire that burns at night.{firstShift(e, 'night') !== null ? <> From {firstShift(e, 'night')} the MODIS orbits drift.</> : null}</p>
        </Callout>
      )} />
    </FoldSection>
  );
}

// ------------------------------------------------------------------------------------------------ the table

function SensorTable({ e }: { e: Eda }) {
  const columns: Column<EdaSensor>[] = [
    { key: 'name', label: 'Satellite', render: (r) => (
      <span className="fh-mx-sat"><i className="fh-mx-swatch" data-s={r.id} aria-hidden="true" />{SENSOR_NAME[r.id]} ({r.family})<span className="fh-mx-sat-years ui-mono">{yearSpan(r.years)}</span></span>) },
    { key: 'n', label: 'Hotspots a year (million)', num: true, render: (r) => <><CellLabel>Hotspots a year (million)</CellLabel>{mil2(r.hotspots_per_year)}</> },
    { key: 'counted', label: 'Counted', num: true, render: (r) => <><CellLabel>Counted</CellLabel>{per(r.counted_pct)}</> },
    { key: 'night', label: 'At night', num: true, render: (r) => <><CellLabel>At night</CellLabel>{per(r.counted_night_pct)}</> },
    { key: 'frp', label: 'Median FRP, day and night (MW)', num: true, render: (r) => <><CellLabel>Median FRP, day and night (MW)</CellLabel>{fix(r.frp_q_day.p50, 1)} and {fix(r.frp_q_night.p50, 1)}</> },
    { key: 'b10', label: 'Below 10 MW', num: true, render: (r) => <><CellLabel>Below 10 MW</CellLabel>{per(r.below_10mw_pct)}</> },
    { key: 'high', label: 'High confidence', num: true, render: (r) => <><CellLabel>High confidence</CellLabel>{per(r.confidence_pct.high)}</> },
    { key: 'static', label: 'Static labels', num: true, render: (r) => <><CellLabel>Static labels</CellLabel>{r.near_real_time_pct >= 99.5 ? 'no label' : per(r.static_labels_pct)}</> },
  ];
  return (
    <Card>
      <div className="fh-pg-stack fh-pg-stack-pairs fh-mx-sensors">
        <DataTable columns={columns} rows={e.sensors} rowKey={(r) => r.id}
          caption="The raw record of each satellite over its full calendar years" />
      </div>
      <Note>Counted: the share of the hotspots that enter our record (vegetation fires that are not low confidence and not in open water). At night, median FRP and below 10 MW describe the counted hotspots; high confidence and static labels describe all of them. Static labels: NASA’s volcano, static source and offshore types. All NOAA‑21 data so far are near real time, which carries no type label.</Note>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ weak fires

function WeakFires({ e, d }: { e: Eda; d: DashboardData }) {
  const ov = e.overlap;
  const o = (id: SensorId) => ov.sensors.find((x) => x.id === id);
  const snpp = o('snpp'), aqua = o('aqua');
  const ph = d.physics;
  const spa = ov.snpp_per_aqua;
  const frp = useMemo(() => frpShares(e), [e]);
  if (!snpp || !aqua) return null;
  return (
    <Sub title="VIIRS sees the weak fires">
      <Lede>
        <p>To compare like with like, we took {yearSpan(ov.years)}, when Terra, Aqua and Suomi NPP all flew at their usual hours. Aqua and Suomi NPP even pass at the same local time. By day, the median Suomi NPP hotspot carries <N>{fix(snpp.day.frp_p50, 1)} MW</N> and the median Aqua hotspot <N>{fix(aqua.day.frp_p50, 1)} MW</N>. By night the medians are <N>{fix(snpp.night.frp_p50, 1)} MW</N> and <N>{fix(aqua.night.frp_p50, 1)} MW</N>.</p>
      </Lede>
      <Card>
        <PlotFigure
          title="VIIRS splits fire into many more and much weaker hotspots than MODIS"
          subtitle={<>How each satellite’s counted hotspots spread over FRP, {yearSpan(ov.years)}; each curve sums to 100%. The rule marks the FRP at which MODIS sees half of the fires.<Legend ids={['terra', 'aqua', 'snpp']} /></>}
          source={SOURCE} height={300} build={(w) => buildFrp(w, frp, ov.modis_limit_mw)} deps={[frp]}
          table={frpTable(frp)} />
      </Card>
      {ph ? (
        <Lede>
          <p>Our physics test explains the gap. On <N>{ph.tiles.length}</N> test areas with a clear view, Aqua saw only <N>{fix(100 * ph.seen.aqua_day, 0)}%</N> of the fires that Suomi NPP saw by day and <N>{fix(100 * ph.seen.aqua_night, 0)}%</N> by night. Strong fires are almost always seen, and weak ones mostly are not.{ph.half_mw.aqua_day !== null ? <> By day, Aqua has an even chance of seeing a fire of about <N>{fix(ph.half_mw.aqua_day, 0)} MW</N>.</> : null}{ph.half_mw.aqua_night !== null ? <> At night the even chance comes at about <N>{fix(ph.half_mw.aqua_night, 0)} MW</N>, because a hot pixel stands out more against a cool night.</> : null} Of Suomi NPP’s hotspots, <N>{fix(snpp.day.below_modis_limit_pct, 0)}%</N> by day and <N>{fix(snpp.night.below_modis_limit_pct, 0)}%</N> by night are weaker than these limits. For Aqua the shares are <N>{perWhole(aqua.day.below_modis_limit_pct)}</N> and <N>{perWhole(aqua.night.below_modis_limit_pct)}</N>.</p>
        </Lede>
      ) : null}
      <Grid cols={2}>
        {ph ? (
          <Card>
            <PlotFigure title="MODIS sees strong fires and misses most weak ones"
              subtitle={<>Share of Suomi NPP hotspots that MODIS also saw on the same day, by the FRP VIIRS measured, {ph.tiles.length} test areas in 2019, clear view only.<Legend ids={['terra', 'aqua']} /></>}
              source="Source: NASA FIRMS, MOD14A1, MYD14A1; analysis: Fire Harmony" height={280}
              build={(w) => buildDetection(w, ph.curve)} deps={[ph]} table={detectionTable(ph.curve)} />
          </Card>
        ) : null}
        <Card>
          <PlotFigure title={`Most Suomi NPP hotspots are weaker than MODIS can reliably see`}
            subtitle={<>Share of the counted hotspots below the FRP at which MODIS sees half of the fires ({fix(ov.modis_limit_mw.day, 0)} MW by day, {fix(ov.modis_limit_mw.night, 0)} MW at night), {yearSpan(ov.years)}.</>}
            source={SOURCE} height={270} build={(w) => buildWeak(w, ov.sensors)} deps={[ov]} table={weakTable(ov.sensors)} />
        </Card>
      </Grid>
      <Lede aside={(
        <MarginNote label="At the same hour, at night" value={`${fix(spa.night_hotspots, 0)}×`} unit="hotspots">
          Suomi NPP against Aqua at night, against <N>{fix(spa.day_hotspots, 0)}</N>× by day.
        </MarginNote>
      )}>
        <p>At night the gap is extreme. At the same hour, Suomi NPP records <N>{fix(spa.night_hotspots, 0)} times</N> as many night hotspots as Aqua, against <N>{fix(spa.day_hotspots, 0)} times</N> by day. So of the hotspots our record counts in these years, <N>{fix(snpp.night_pct, 0)}%</N> of Suomi NPP’s come at night and only <N>{fix(aqua.night_pct, 1)}%</N> of Aqua’s. The more of a place’s fire burns at night, the larger the gap between the two sensors.</p>
        <p>Yet the two satellites measure almost the same total fire power. Over a year, Suomi NPP counts <N>{fix(spa.hotspots, 1)} times</N> as many hotspots as Aqua but records only <N>{fix(spa.frp, 1)} times</N> its FRP. So most of the extra VIIRS hotspots carry little power. Some are small fires below the reach of MODIS. Others are pieces of large fires: a 375 m pixel splits a fire front into several hotspots where a 1 km MODIS pixel shows one.</p>
      </Lede>
      <Card>
        <PlotFigure title={`Suomi NPP counts ${fix(spa.hotspots, 1)} times the hotspots of Aqua, but only ${fix(spa.frp, 1)} times the fire power`}
          subtitle={`Suomi NPP for every Aqua hotspot (or megawatt), ${yearSpan(ov.years)}, the hotspots our record counts. Both pass at about the same hour.`}
          source={SOURCE} height={200} build={(w) => buildPerAqua(w, spa)} deps={[spa]}
          table={{ columns: ['Measure', 'Suomi NPP for every Aqua'], rows: perAquaRows(spa).map((r) => [r.label, `${fix(r.v, 1)}×`]) }} />
      </Card>
    </Sub>
  );
}

function Legend({ ids }: { ids: SensorId[] }) {
  return (
    <span className="fh-pg-legend">
      {ids.map((id) => <span key={id} className="fh-pg-key"><span className="fh-pg-swatch fh-pg-swatch-line fh-mx-swatch" data-s={id} aria-hidden="true" />{SENSOR_NAME[id]}</span>)}
    </span>
  );
}

function binText(p: FrpPoint): string {
  const f = (v: number) => (v < 1 ? fix(v, 2) : v < 10 ? fix(v, 1) : fix(v, 0));
  return `${f(p.lo)} to ${f(p.hi)} MW`;
}

function buildFrp(width: number, pts: FrpPoint[], limit: { day: number; night: number }): Plot.PlotOptions {
  const p = pal();
  const narrow = width < 620;
  const data = pts.filter((x) => x.share > 0 || x.mw > 0.3).map((x) => ({ ...x, facet: PART[x.part] }));
  const rules = [{ facet: PART.day, mw: limit.day }, { facet: PART.night, mw: limit.night }];
  const facet = narrow ? { fy: 'facet' } : { fx: 'facet' };
  const top = Math.ceil(Math.max(...data.map((x) => x.share)) / 5) * 5;
  return {
    height: narrow ? 480 : 300, marginLeft: 40, marginRight: 12, marginTop: narrow ? 34 : 24, marginBottom: 36,
    x: { type: 'log', domain: [0.1, 4000], ticks: mwTicks(0.1, 4000), tickFormat: mwFormat, label: 'FRP (MW), log scale', labelAnchor: 'center', labelOffset: 30, tickSize: 0 },
    y: { domain: [0, top], label: '% of hotspots', ticks: 4, tickSize: 0, labelAnchor: 'top' },
    fx: narrow ? undefined : { label: null, padding: 0.1, domain: [PART.day, PART.night] },
    fy: narrow ? { label: null, padding: 0.2, domain: [PART.day, PART.night], axis: null } : undefined,
    marks: [
      gridY(p, { ticks: 4 }),
      Plot.ruleY([0], { stroke: p.baseline }),
      narrow ? Plot.text([PART.day, PART.night], { fy: (f: string) => f, frameAnchor: 'top-left', text: (f: string) => f, dy: -16, fill: p.ink, fontSize: 12, fontWeight: 600 }) : null,
      Plot.ruleX(rules, { x: 'mw', ...facet, stroke: p.ink2, strokeWidth: 1 }),
      Plot.text(rules, { x: 'mw', ...facet, frameAnchor: 'top', text: () => 'MODIS sees half', dx: 4, dy: 2, textAnchor: 'start', fill: p.ink2, fontSize: 11, ...halo(p) }),
      Plot.lineY(data, { x: 'mw', y: 'share', z: 'sensor', ...facet, stroke: (x: FrpPoint) => p.sensor(x.sensor), strokeWidth: 2, curve: 'monotone-x' }),
      Plot.tip(data, Plot.pointer({ x: 'mw', y: 'share', ...facet, ...tip(p),
        title: (x: FrpPoint) => `${SENSOR_NAME[x.sensor]}, ${x.part === 'day' ? 'by day' : 'at night'}\n${fix(x.share, 1)}% of its hotspots\n${binText(x)}` })),
    ],
  };
}

function frpTable(pts: FrpPoint[]): FigureTable {
  const bins = [...new Set(pts.map((x) => binText(x)))];
  const val = (id: SensorId, part: 'day' | 'night', bin: string) => {
    const x = pts.find((q) => q.sensor === id && q.part === part && binText(q) === bin);
    return x ? `${fix(x.share, 1)}%` : '–';
  };
  return {
    columns: ['FRP', 'Terra by day', 'Aqua by day', 'Suomi NPP by day', 'Terra at night', 'Aqua at night', 'Suomi NPP at night'],
    rows: bins.map((b) => [b, val('terra', 'day', b), val('aqua', 'day', b), val('snpp', 'day', b), val('terra', 'night', b), val('aqua', 'night', b), val('snpp', 'night', b)]),
  };
}

type CurveRow = NonNullable<DashboardData['physics']>['curve'][number];
interface DetPt { sensor: 'terra' | 'aqua'; part: 'day' | 'night'; facet: string; frp: number; seen: number }

function detectionPoints(curve: CurveRow[]): DetPt[] {
  const out: DetPt[] = [];
  for (const r of curve) {
    for (const sensor of ['terra', 'aqua'] as const) {
      for (const part of ['day', 'night'] as const) {
        const v = r[`${sensor}_${part}`];
        if (v !== null && v !== undefined) out.push({ sensor, part, facet: PART[part], frp: r.frp, seen: v });
      }
    }
  }
  return out;
}

function buildDetection(width: number, curve: CurveRow[]): Plot.PlotOptions {
  const p = pal();
  const pts = detectionPoints(curve);
  const narrow = width < 420;
  const facet = narrow ? { fy: 'facet' } : { fx: 'facet' };
  const lo = Math.min(...pts.map((x) => x.frp)), hi = Math.max(...pts.map((x) => x.frp));
  return {
    height: narrow ? 440 : 280, marginLeft: 40, marginRight: 12, marginTop: narrow ? 30 : 20, marginBottom: 36,
    x: { type: 'log', domain: [lo * 0.8, hi * 1.25], ticks: mwTicks(lo, hi), tickFormat: mwFormat, label: 'FRP seen by VIIRS (MW)', labelAnchor: 'center', labelOffset: 30, tickSize: 0 },
    y: { domain: [0, 1], ticks: [0, 0.5, 1], tickFormat: (v: number) => `${fix(100 * v, 0)}%`, label: null, tickSize: 0 },
    fx: narrow ? undefined : { label: null, padding: 0.12, domain: [PART.day, PART.night] },
    fy: narrow ? { label: null, padding: 0.24, domain: [PART.day, PART.night], axis: null } : undefined,
    marks: [
      gridY(p, { ticks: [0, 0.5, 1] }),
      narrow ? Plot.text([PART.day, PART.night], { fy: (f: string) => f, frameAnchor: 'top-left', text: (f: string) => f, dy: -14, fill: p.ink, fontSize: 12, fontWeight: 600 }) : null,
      Plot.ruleY([0.5], { stroke: p.ink2, strokeWidth: 1 }),
      Plot.lineY(pts, { x: 'frp', y: 'seen', z: 'sensor', ...facet, stroke: (x: DetPt) => p.sensor(x.sensor), strokeWidth: 2, curve: 'monotone-x' }),
      Plot.dot(pts, { x: 'frp', y: 'seen', ...facet, r: 3, fill: (x: DetPt) => p.sensor(x.sensor), stroke: p.surface, strokeWidth: 1.5 }),
      Plot.tip(pts, Plot.pointer({ x: 'frp', y: 'seen', ...facet, ...tip(p),
        title: (x: DetPt) => `${SENSOR_NAME[x.sensor]}, ${x.part === 'day' ? 'by day' : 'at night'}\nFires near ${fix(x.frp, 1)} MW: ${fix(100 * x.seen, 0)}% seen` })),
    ],
  };
}

function detectionTable(curve: CurveRow[]): FigureTable {
  const s = (v: number | null) => (v === null ? '–' : `${fix(100 * v, 0)}%`);
  return {
    columns: ['FRP (MW)', 'Aqua by day', 'Aqua at night', 'Terra by day', 'Terra at night'],
    rows: curve.map((r) => [fix(r.frp, 1), s(r.aqua_day), s(r.aqua_night), s(r.terra_day), s(r.terra_night)]),
  };
}

interface WeakRow { sensor: SensorId; part: 'day' | 'night'; facet: string; v: number }

function weakRows(sensors: Eda['overlap']['sensors']): WeakRow[] {
  return sensors.flatMap((s) => (['day', 'night'] as const).map((part) => ({ sensor: s.id, part, facet: PART[part], v: s[part].below_modis_limit_pct })));
}

function buildWeak(width: number, sensors: Eda['overlap']['sensors']): Plot.PlotOptions {
  const p = pal();
  const rows = weakRows(sensors);
  const names = sensors.map((s) => SENSOR_NAME[s.id]);
  return {
    height: 270, marginLeft: 76, marginRight: 40, marginTop: 24, marginBottom: 26,
    x: { domain: [0, 100], ticks: width < 420 ? [0, 50, 100] : [0, 25, 50, 75, 100], tickFormat: (v: number) => `${v}%`, label: null, tickSize: 0 },
    y: { domain: names, label: null, tickSize: 0, padding: 0.3 },
    fy: { domain: [PART.day, PART.night], label: null, padding: 0.22, axis: null },
    marks: [
      gridX(p, { ticks: width < 420 ? [0, 50, 100] : [0, 25, 50, 75, 100] }),
      Plot.barX(rows, { x: 'v', y: (r: WeakRow) => SENSOR_NAME[r.sensor], fy: 'facet', fill: (r: WeakRow) => p.sensor(r.sensor), rx: 3 }),
      Plot.text(rows, { x: 'v', y: (r: WeakRow) => SENSOR_NAME[r.sensor], fy: 'facet', text: (r: WeakRow) => `${fix(r.v, r.v < 1 ? 1 : 0)}%`, dx: 6, textAnchor: 'start', fill: p.ink, fontSize: 12, fontWeight: 600 }),
      Plot.text([PART.day, PART.night], { fy: (f: string) => f, frameAnchor: 'top-left', text: (f: string) => f, dx: -72, dy: -16, fill: p.ink2, fontSize: 12, fontWeight: 600 }),
    ],
  };
}

function weakTable(sensors: Eda['overlap']['sensors']): FigureTable {
  return { columns: ['Satellite', 'By day', 'At night'], rows: sensors.map((s) => [SENSOR_NAME[s.id], per(s.day.below_modis_limit_pct), per(s.night.below_modis_limit_pct)]) };
}

function perAquaRows(spa: Eda['overlap']['snpp_per_aqua']): { label: string; v: number; key: string }[] {
  return [
    { key: 'night', label: 'Hotspots at night', v: spa.night_hotspots },
    { key: 'day', label: 'Hotspots by day', v: spa.day_hotspots },
    { key: 'all', label: 'All hotspots', v: spa.hotspots },
    { key: 'frp', label: 'Fire power (FRP)', v: spa.frp },
  ];
}

function buildPerAqua(width: number, spa: Eda['overlap']['snpp_per_aqua']): Plot.PlotOptions {
  const p = pal();
  const rows = perAquaRows(spa);
  const top = Math.ceil(spa.night_hotspots / 5) * 5;
  const narrow = width < 460;
  return {
    height: 200, marginLeft: narrow ? 112 : 128, marginRight: 44, marginTop: 8, marginBottom: 26,
    x: { domain: [0, top], ticks: narrow ? 3 : 6, label: null, tickSize: 0, tickFormat: (v: number) => `${v}×` },
    y: { domain: rows.map((r) => r.label), label: null, tickSize: 0, padding: 0.32 },
    marks: [
      gridX(p, { ticks: narrow ? 3 : 6 }),
      Plot.barX(rows, { x: 'v', y: 'label', fill: (r: { key: string }) => (r.key === 'frp' ? p.harmonized : p.snpp), rx: 3 }),
      Plot.ruleX([1], { stroke: p.ink2 }),
      Plot.text(rows, { x: 'v', y: 'label', text: (r: { v: number }) => `${fix(r.v, 1)}×`, dx: 6, textAnchor: 'start', fill: p.ink, fontSize: 12, fontWeight: 600 }),
    ],
  };
}

// ------------------------------------------------------------------------------------------------ the hour of the pass

type Pass = NonNullable<Eda['overpass']['sensors']['terra']>;

/** How far a satellite's median hotspot of one year moved from its base years, in minutes. */
function shiftMinutes(x: Pass, y: number, part: 'day' | 'night'): number | null {
  const r = x.by_year.find((b) => b.yr === y);
  return r ? Math.abs(part === 'day' ? r.day_median_local - x.day_median_local : r.night_median_local - x.night_median_local) * 60 : null;
}

/** The first year after the base years when both MODIS satellites moved by at least 5 minutes (at night: 2021). */
export function firstShift(e: Eda, part: 'day' | 'night'): number | null {
  const t = e.overpass.sensors.terra, a = e.overpass.sensors.aqua;
  if (!t || !a) return null;
  const end = Math.floor(e.record.last_month / 100);
  for (let y = Math.max(t.years_for_median[1], a.years_for_median[1]) + 1; y <= end; y++) {
    if ((shiftMinutes(t, y, part) ?? 0) >= 5 && (shiftMinutes(a, y, part) ?? 0) >= 5) return y;
  }
  return null;
}

function PassHour({ e }: { e: Eda }) {
  const ov = e.overpass.sensors;
  const t = ov.terra, a = ov.aqua, s = ov.snpp;
  if (!t || !a || !s) return null;
  const before = t.years_for_median[1] + 1;
  const near = (['noaa20', 'noaa21'] as const).map((id) => ov[id]).filter((x) => x !== undefined);
  const gapMin = Math.ceil(Math.max(...near.flatMap((x) => [Math.abs(x.day_median_local - s.day_median_local), Math.abs(x.night_median_local - s.night_median_local)])) * 60);
  const yr = (x: typeof t, y: number) => x.by_year.find((r) => r.yr === y)?.day_median_local ?? null;
  const lastFull = e.record.last_month % 100 === 12 ? Math.floor(e.record.last_month / 100) : Math.floor(e.record.last_month / 100) - 1;
  const partial = lastFull + 1;
  const t1 = yr(t, lastFull), t2 = yr(t, partial), a1 = yr(a, lastFull), a2 = yr(a, partial);
  const nightYr = firstShift(e, 'night'), dayYr = firstShift(e, 'day');
  const tn = nightYr !== null ? shiftMinutes(t, nightYr, 'night') : null, an = nightYr !== null ? shiftMinutes(a, nightYr, 'night') : null;
  return (
    <Sub title="The hour of the pass">
      <Lede aside={t1 !== null && a1 !== null ? (
        <MarginNote label={`Aqua’s daytime hotspots, ${lastFull}`} value={clock(a1)} unit="local time">
          Against <N>{clock(a.day_median_local)}</N> before {before}. Terra’s moved from <N>{clock(t.day_median_local)}</N> to <N>{clock(t1)}</N>.
        </MarginNote>
      ) : undefined}>
        <p>Each satellite crosses a place at about the same local solar time every day. Before {before}, the median Terra hotspot was seen at <N>{clock(t.day_median_local)}</N> by day and <N>{clock(t.night_median_local)}</N> by night, and the median Aqua hotspot at <N>{clock(a.day_median_local)}</N> and <N>{clock(a.night_median_local)}</N>. Suomi NPP sees its median hotspot at <N>{clock(s.day_median_local)}</N> and <N>{clock(s.night_median_local)}</N>{near.length ? <>, and NOAA‑20 and NOAA‑21 within {NUMBER_WORDS[gapMin] ?? gapMin} minutes of that</> : null}. Fire has a daily cycle and burns most in the early afternoon. So Aqua and VIIRS see the same burning hour, and Terra a quieter one.</p>
        {t1 !== null && t2 !== null && a1 !== null && a2 !== null ? <p>The MODIS orbits no longer keep their hours.{nightYr !== null && tn !== null && an !== null ? <> The first shift shows at night in {nightYr}, when the median night hotspot moved by <N>{fix(tn, 0)} minutes</N> for Terra and <N>{fix(an, 0)} minutes</N> for Aqua.</> : null}{dayYr !== null ? <> By day the drift begins in {dayYr}.</> : null} Terra’s median daytime hotspot moved earlier, to <N>{clock(t1)}</N> in {lastFull} and <N>{clock(t2)}</N> in {partial} so far. Aqua’s moved later, to <N>{clock(a1)}</N> in {lastFull} and <N>{clock(a2)}</N> in {partial}. A satellite that passes an hour away from its old time sees a different part of the daily fire cycle. So MODIS counts from {nightYr ?? before} on do not compare with earlier ones. Our record uses VIIRS for every month from 2012, so the drift does not touch it.</p> : null}
      </Lede>
      <Grid cols={2}>
        <Card>
          <PlotFigure title="Aqua and VIIRS see the afternoon fire; Terra passes in the quieter morning"
            subtitle={<>When each satellite records its hotspots, in local solar time, {yearSpan(e.overlap.years)}; share of each satellite’s hotspots per half hour.<Legend ids={['terra', 'aqua', 'snpp', 'noaa20']} /></>}
            source={SOURCE} height={260} build={(w) => buildHours(w, e)} deps={[e]} table={hoursTable(e)} />
        </Card>
        <Card>
          <PlotFigure title={`Terra and Aqua drift from their set hours after ${before}, while VIIRS keeps its time`}
            subtitle={<>The median local time of daytime hotspots, per year ({partial} so far).<Legend ids={['terra', 'aqua', 'snpp', 'noaa20', 'noaa21']} /></>}
            source={SOURCE} height={260} build={(w) => buildDrift(w, e)} deps={[e]} table={driftTable(e)} />
        </Card>
      </Grid>
    </Sub>
  );
}

const HOUR_IDS: SensorId[] = ['terra', 'aqua', 'snpp', 'noaa20'];
interface HourPt { sensor: SensorId; h: number; share: number }

function hourPoints(e: Eda): HourPt[] {
  return HOUR_IDS.flatMap((id) => (e.overpass.hour_share_2013_2019[id] ?? []).map((share, i) => ({ sensor: id, h: i / 2 + 0.25, share })));
}

function buildHours(width: number, e: Eda): Plot.PlotOptions {
  const p = pal();
  const pts = hourPoints(e);
  const top = Math.ceil(Math.max(...pts.map((x) => x.share)) / 10) * 10;
  const ticks = width < 420 ? [0, 12, 24] : [0, 6, 12, 18, 24];
  return {
    height: 260, marginLeft: 36, marginRight: 14, marginTop: 14, marginBottom: 28,
    x: { domain: [0, 24], ticks, tickFormat: (h: number) => `${String(h % 24).padStart(2, '0')}:00`, label: null, tickSize: 0 },
    y: { domain: [0, top], ticks: 4, tickFormat: (v: number) => `${v}%`, label: null, tickSize: 0 },
    marks: [
      gridY(p, { ticks: 4 }),
      Plot.ruleY([0], { stroke: p.baseline }),
      Plot.lineY(pts, { x: 'h', y: 'share', z: 'sensor', stroke: (x: HourPt) => p.sensor(x.sensor), strokeWidth: 2, curve: 'monotone-x' }),
      Plot.tip(pts, Plot.pointer({ x: 'h', y: 'share', ...tip(p),
        title: (x: HourPt) => `${SENSOR_NAME[x.sensor]}\n${clock(x.h - 0.25)} to ${clock(x.h + 0.25)}: ${fix(x.share, 1)}% of its hotspots` })),
    ],
  };
}

function hoursTable(e: Eda): FigureTable {
  const pts = hourPoints(e);
  const hours = [...new Set(pts.map((x) => x.h))].filter((h) => pts.some((x) => x.h === h && x.share >= 0.05));
  return {
    columns: ['Local time', ...HOUR_IDS.map((id) => SENSOR_NAME[id])],
    rows: hours.map((h) => [`${clock(h - 0.25)} to ${clock(h + 0.25)}`, ...HOUR_IDS.map((id) => {
      const x = pts.find((q) => q.sensor === id && q.h === h);
      return x ? `${fix(x.share, 1)}%` : '–';
    })]),
  };
}

interface DriftPt { sensor: SensorId; yr: number; h: number }
const DRIFT_IDS: SensorId[] = ['terra', 'aqua', 'snpp', 'noaa20', 'noaa21'];

function driftPoints(e: Eda): DriftPt[] {
  return DRIFT_IDS.flatMap((id) => (e.overpass.sensors[id]?.by_year ?? []).map((r) => ({ sensor: id, yr: r.yr, h: r.day_median_local })));
}

function buildDrift(width: number, e: Eda): Plot.PlotOptions {
  const p = pal();
  const pts = driftPoints(e);
  const lo = Math.floor(Math.min(...pts.map((x) => x.h))), hi = Math.ceil(Math.max(...pts.map((x) => x.h)));
  const ends = DRIFT_IDS.filter((id) => id === 'terra' || id === 'aqua').map((id) => pts.filter((x) => x.sensor === id).pop()).filter((x): x is DriftPt => x !== undefined);
  const y0 = Math.min(...pts.map((x) => x.yr)), y1 = Math.max(...pts.map((x) => x.yr));
  return {
    height: 260, marginLeft: 44, marginRight: width < 420 ? 52 : 60, marginTop: 14, marginBottom: 28,
    x: { domain: [y0, y1], ticks: width < 420 ? [2005, 2015, 2025] : [2005, 2010, 2015, 2020, 2025], tickFormat: (v: number) => String(v), label: null, tickSize: 0 },
    y: { domain: [lo, hi], ticks: Array.from({ length: hi - lo + 1 }, (_, i) => lo + i), tickFormat: (v: number) => clock(v), label: null, tickSize: 0 },
    marks: [
      gridY(p, { ticks: Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) }),
      Plot.lineY(pts, { x: 'yr', y: 'h', z: 'sensor', stroke: (x: DriftPt) => p.sensor(x.sensor), strokeWidth: 2 }),
      Plot.text(ends, { x: 'yr', y: 'h', text: (x: DriftPt) => clock(x.h), dx: 6, textAnchor: 'start', fill: (x: DriftPt) => p.sensor(x.sensor), fontSize: 11, fontWeight: 600, ...halo(p) }),
      Plot.tip(pts, Plot.pointer({ x: 'yr', y: 'h', ...tip(p), title: (x: DriftPt) => `${SENSOR_NAME[x.sensor]}, ${x.yr}\nMedian daytime hotspot at ${clock(x.h)}` })),
    ],
  };
}

function driftTable(e: Eda): FigureTable {
  const pts = driftPoints(e);
  const years = [...new Set(pts.map((x) => x.yr))].sort((a, b) => a - b);
  return {
    columns: ['Year', ...DRIFT_IDS.map((id) => SENSOR_NAME[id])],
    rows: years.map((y) => [String(y), ...DRIFT_IDS.map((id) => { const x = pts.find((q) => q.sensor === id && q.yr === y); return x ? clock(x.h) : '–'; })]),
  };
}

// ------------------------------------------------------------------------------------------------ the exchange rate

function ExchangeRate({ e, finding }: { e: Eda; finding: ReactNode }) {
  const x = e.exchange_rate_l3;
  const parts = x.parts;
  const names = useMemo(() => new Map(e.sensitivity.harmonized_vs_modis.rows.map((r) => [r.iso3, r.name])), [e]);
  const c = (iso3: string) => parts.countries.find((r) => r.iso3 === iso3);
  const cod = c('COD'), ago = c('AGO'), rus = c('RUS'), can = c('CAN'), ind = c('IND');
  const byDay = [...parts.countries].sort((a, b) => b.rate_day - a.rate_day);
  const indRank = ind ? byDay.findIndex((r) => r.iso3 === 'IND') + 1 : 0;
  const weakTop = [...parts.countries].sort((a, b) => b.snpp_weak_day - a.snpp_weak_day)[0];
  const low: ReactNode = cod && ago ? <>In {names.get('COD') ?? 'DR Congo'} and {names.get('AGO') ?? 'Angola'}, fewer than <N>{fix(Math.ceil(Math.max(cod.snpp_night, ago.snpp_night)), 0)}%</N> of Suomi NPP’s hotspots come at night, and the rate is <N>{fix(cod.rate, 1)}</N> and <N>{fix(ago.rate, 1)}</N>. </> : null;
  return (
    <Sub title="No single exchange rate">
      <Lede aside={(
        <MarginNote label="The middle half of the places" value={`${fix(x.q25, 1)} to ${fix(x.q75, 1)}`} unit="per Aqua hotspot">
          Suomi NPP hotspots for every Aqua hotspot in <N>{int(x.hexagons)}</N> large hexagons. The world: <N>{fix(x.world, 1)}</N>.
        </MarginNote>
      )}>
        <p>How many VIIRS hotspots stand for one MODIS hotspot? In {yearSpan(x.years)} the world answer is <N>{fix(x.world, 1)}</N> Suomi NPP hotspots for every Aqua hotspot. But the answer changes from place to place. Across the <N>{int(x.hexagons)}</N> level 3 hexagons with at least {x.min_aqua_per_year} Aqua hotspots a year, the middle half of the rates runs from <N>{fix(x.q25, 1)}</N> to <N>{fix(x.q75, 1)}</N>. One hexagon in twenty is below <N>{fix(x.q05, 1)}</N>, and one in twenty above <N>{fix(x.q95, 1)}</N>.</p>
        <p>Most of this spread comes from the night. Suomi NPP adds far more hotspots at night than by day, so the rate <i>R</i> of a place splits exactly into its day rate and a night factor:</p>
        <p className="fh-mx-formula" role="math" aria-label="R equals R day times, one minus nu A, over, one minus nu S">
          <i>R</i> = <i>R</i><sub>day</sub> × (1 − <i>ν</i><sub>A</sub>) / (1 − <i>ν</i><sub>S</sub>)
        </p>
        <p>where <i>ν</i><sub>S</sub> and <i>ν</i><sub>A</sub> are the shares of Suomi NPP’s and Aqua’s hotspots that come at night. Across the hexagons, the rate follows Suomi NPP’s night share closely (Spearman’s rank correlation <N>{fix(parts.spearman_rate_snpp_night, 2)}</N>) and hardly follows the share of weak fires by day (<N>{fix(parts.spearman_rate_snpp_weak_day, 2)}</N>). The day rate varies much less, with a middle half from <N>{fix(parts.rate_day.q25, 1)}</N> to <N>{fix(parts.rate_day.q75, 1)}</N>. It is the day rate that rises where more of the fires are weak (<N>{fix(parts.spearman_rate_day_snpp_weak_day, 2)}</N>).</p>
        <p>The big fire countries show the same pattern. {low}{rus ? <>In {names.get('RUS') ?? 'Russia'} <N>{fix(rus.snpp_night, 0)}%</N> come at night, and the rate is <N>{fix(rus.rate, 1)}</N>. </> : null}{can ? <>In {names.get('CAN') ?? 'Canada'} about half do, and the rate is <N>{fix(can.rate, 1)}</N>. </> : null}{ind && weakTop?.iso3 === 'IND' ? <>India shows the day effect. There, <N>{fix(ind.snpp_weak_day, 0)}%</N> of Suomi NPP’s daytime hotspots are below 10 MW, more than in any other of the {parts.countries.length} large fire countries we compared.{indRank === 2 ? <> Its day rate of <N>{fix(ind.rate_day, 1)}</N> is second only to {names.get(byDay[0].iso3) ?? byDay[0].iso3}’s.</> : null}</> : null}</p>
        <p>The rate also changes with land cover and with the season. Our model reads what Terra and Aqua saw by day and by night, where and when, so it can follow these changes, and one fixed rate cannot.</p>
      </Lede>
      <Grid cols={2}>
        <div className="fh-mx-col">
        <Card>
          <PlotFigure title="The exchange rate between VIIRS and MODIS changes from place to place"
            subtitle={`Suomi NPP hotspots for every Aqua hotspot, ${yearSpan(x.years)}, across ${int(x.hexagons)} level 3 hexagons with at least ${x.min_aqua_per_year} Aqua hotspots a year (${per(x.share_of_aqua_fire_covered_pct, 0)} of Aqua’s fire). Thick: the middle half; thin: 90% of the hexagons; tick: the median.`}
            source={SOURCE} height={190} build={(w) => buildRange(w, e)} deps={[e]} table={rangeTable(e)} />
        </Card>
        {finding}
        </div>
        <Card>
          <PlotFigure title="The more fire burns at night, the higher the rate"
            subtitle={`The ${parts.countries.length} large fire countries: the day rate (open) and the rate of all hotspots (filled). The gap between them is the night. Labels: the share of Suomi NPP’s hotspots at night.`}
            source={SOURCE} height={380} build={(w) => buildCountries(w, e, names)} deps={[e, names]} table={countriesTable(e, names)} />
        </Card>
      </Grid>
    </Sub>
  );
}

interface RangeRow { label: string; q05: number; q25: number; q50: number; q75: number; q95: number }

function rangeRows(e: Eda): RangeRow[] {
  const p = e.exchange_rate_l3.parts;
  return [{ label: 'All hotspots', ...p.rate }, { label: 'By day only', ...p.rate_day }];
}

function buildRange(width: number, e: Eda): Plot.PlotOptions {
  const p = pal();
  const rows = rangeRows(e);
  const x = e.exchange_rate_l3;
  const top = Math.ceil(Math.max(...rows.map((r) => r.q95)) + 1);
  const narrow = width < 440;
  return {
    height: 190, marginLeft: narrow ? 84 : 92, marginRight: 20, marginTop: 26, marginBottom: 28,
    x: { domain: [0, top], ticks: narrow ? 4 : 8, label: null, tickSize: 0 },
    y: { domain: rows.map((r) => r.label), label: null, tickSize: 0, padding: 0.4 },
    marks: [
      gridX(p, { ticks: narrow ? 4 : 8 }),
      Plot.ruleY(rows, { y: 'label', x1: 'q05', x2: 'q95', stroke: p.snpp, strokeWidth: 2, strokeOpacity: 0.6 }),
      Plot.barX(rows, { y: 'label', x1: 'q25', x2: 'q75', fill: p.snpp, rx: 3, insetTop: 4, insetBottom: 4 }),
      Plot.tickX(rows, { y: 'label', x: 'q50', stroke: p.surface, strokeWidth: 3 }),
      Plot.text(rows, { y: 'label', x: 'q50', text: (r: RangeRow) => fix(r.q50, 1), dy: -18, fill: p.ink, fontSize: 12, fontWeight: 600 }),
      Plot.ruleX([x.world], { stroke: p.ink2, strokeWidth: 1 }),
      Plot.text([x.world], { x: (v: number) => v, frameAnchor: 'top', text: (v: number) => `world ${fix(v, 1)}`, dy: -20, dx: 4, textAnchor: 'start', fill: p.ink2, fontSize: 11, ...halo(p) }),
      Plot.tip(rows, Plot.pointerY({ y: 'label', x: 'q50', ...tip(p),
        title: (r: RangeRow) => `${r.label}\nMedian ${fix(r.q50, 1)}\nMiddle half ${fix(r.q25, 1)} to ${fix(r.q75, 1)}\n90% of hexagons ${fix(r.q05, 1)} to ${fix(r.q95, 1)}` })),
    ],
  };
}

function rangeTable(e: Eda): FigureTable {
  return { columns: ['Hotspots', '5%', '25%', 'Median', '75%', '95%'], rows: rangeRows(e).map((r) => [r.label, fix(r.q05, 1), fix(r.q25, 1), fix(r.q50, 1), fix(r.q75, 1), fix(r.q95, 1)]) };
}

type CountryRow = Eda['exchange_rate_l3']['parts']['countries'][number] & { name: string };

function countryRows(e: Eda, names: Map<string, string>): CountryRow[] {
  return [...e.exchange_rate_l3.parts.countries].sort((a, b) => b.rate - a.rate).map((r) => ({ ...r, name: names.get(r.iso3) ?? r.iso3 }));
}

function buildCountries(width: number, e: Eda, names: Map<string, string>): Plot.PlotOptions {
  const p = pal();
  const rows = countryRows(e, names);
  const top = Math.ceil(Math.max(...rows.map((r) => r.rate)) + 1.5);
  const narrow = width < 440;
  return {
    height: 380, marginLeft: narrow ? 92 : 104, marginRight: 52, marginTop: 8, marginBottom: 28,
    x: { domain: [0, top], ticks: narrow ? 4 : 7, label: null, tickSize: 0 },
    y: { domain: rows.map((r) => r.name), label: null, tickSize: 0, padding: 0.5 },
    marks: [
      gridX(p, { ticks: narrow ? 4 : 7 }),
      Plot.link(rows, { x1: 'rate_day', x2: 'rate', y1: 'name', y2: 'name', stroke: p.snpp, strokeOpacity: 0.55, strokeWidth: 2 }),
      Plot.dot(rows, { x: 'rate_day', y: 'name', r: 4, fill: p.surface, stroke: p.snpp, strokeWidth: 2 }),
      Plot.dot(rows, { x: 'rate', y: 'name', r: 4.5, fill: p.snpp, stroke: p.surface, strokeWidth: 1.5 }),
      Plot.text(rows, { x: 'rate', y: 'name', text: (r: CountryRow) => `${fix(r.snpp_night, 0)}%`, dx: 9, textAnchor: 'start', fill: p.ink2, fontSize: 11 }),
      Plot.tip(rows, Plot.pointerY({ x: 'rate', y: 'name', ...tip(p),
        title: (r: CountryRow) => `${r.name}\nRate ${fix(r.rate, 1)}, by day ${fix(r.rate_day, 1)}\n${fix(r.snpp_night, 0)}% of Suomi NPP hotspots at night (Aqua ${fix(r.aqua_night, 1)}%)\n${fix(r.snpp_weak_day, 0)}% of its daytime hotspots below 10 MW` })),
    ],
  };
}

function countriesTable(e: Eda, names: Map<string, string>): FigureTable {
  return {
    columns: ['Country', 'Rate', 'Day rate', 'Suomi NPP at night', 'Aqua at night', 'Weak by day'],
    rows: countryRows(e, names).map((r) => [r.name, fix(r.rate, 1), fix(r.rate_day, 1), `${fix(r.snpp_night, 0)}%`, `${fix(r.aqua_night, 1)}%`, `${fix(r.snpp_weak_day, 0)}%`]),
  };
}
