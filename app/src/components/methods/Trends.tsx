// Methods, "How we test trends": the fire floors and why, the false discovery rate at levels 3 and 4, the spatial link,
// level 3 against level 4, the record against MODIS alone, and other base periods (report sections "How sure are the
// trends?" and "Do the trends survive other choices?"). Every number comes from web/eda.json (and the step of the
// MODIS record in 2002 from dashboard.json), rounded as the report rounds it.
import { FoldSection } from './Fold';
import { TREND_LOG_NOTE } from '../pages/format';
import { useMemo, useState, type ReactNode } from 'react';
import * as Plot from '@observablehq/plot';
import { Callout, Card, DataTable, Grid, Note, PlotFigure, Segmented, StatGrid, StatTile, type Column } from '../ui';
import { IconMap, IconRanking } from '../icons';
import { Lede, MarginNote, N, Sub } from '../pages/DocLayout';
import { AreaLink, CellLabel } from '../pages/parts';
import type { DashboardData } from '../../lib/dashboard-types';
import { gridX, gridY, halo, pal, tip } from './charts';
import {
  bhAdjust, fix, int, pText, per, signed, type AgreementRow, type Eda, type FdrCounts, type FdrLevel, type HexClass,
  type RankedPlace, type SensitivityPlace,
} from './eda';

const SOURCE = 'Source: NASA FIRMS; analysis: Fire Harmony';
const yearSpan = (y: readonly [number, number] | readonly number[]) => `${y[0]} to ${y[1]}`;
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/** "about 310,000": two significant figures. */
const about = (v: number) => int(Number(v.toPrecision(2)));
const shortName = (n: string) => n.replace(/, Indonesia$/, '');
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** A name inside a sentence: "the United States". */
const inSentence = (n: string) => (/^(United|Russian Federation|DR Congo|Central African Republic|Dominican Republic)|^(Philippines|Netherlands|Gambia)$/.test(n) ? `the ${n}` : n);

export function TrendsSection({ e, d }: { e: Eda; d: DashboardData }) {
  const f = e.fdr;
  const l3 = f.l3;
  return (
    <FoldSection id="trends" title="How we test trends" subtitle="Enough fire to test, many tests at once, neighbours that agree, and other choices that could have made the trends.">
      <Lede aside={(
        <MarginNote label="Where there is enough fire to test" value={`${fix(l3.fall_per_rise_bh_005, 1)}×`} unit="falls per rise"
          foot={<TrendLinks />}>
          Fire fell in <N>{int(l3.bh_005.falling)}</N> of <N>{int(l3.hexagons)}</N> hexagons and rose in <N>{int(l3.bh_005.rising)}</N>, {yearSpan([2001, 2025])}.
        </MarginNote>
      )}>
        <p>A trend map runs one test per hexagon. Chance alone makes some hexagons look significant, and a hexagon needs enough fire for its trend to mean anything. We deal with the second problem first.</p>
        <p>Every trend is the Mann Kendall test of the yearly totals, with the Hamed and Rao correction for years that follow each other, and Sen’s slope as its size. {TREND_LOG_NOTE} The Explorer’s trend view and the Rankings page use exactly these rules, so a place reads the same everywhere.</p>
      </Lede>
      <Floors e={e} />
      <ManyTests e={e} />
      <Regions e={e} />
      <PlacesPart e={e} />
      <OtherChoices e={e} d={d} />
      <Callout title="Key finding">
        <p>Where there is enough fire to test, fire fell in <N>{fix(l3.fall_per_rise_bh_005, 1)} times</N> as many places as it rose from 2001 to 2025. Under every false discovery rule and every floor we tried, it fell in at least <N>{fix(Math.min(l3.fall_per_rise_by_005, ...f.floors_l3.filter((x) => x.floor_per_year > 0).map((x) => x.fall_per_rise)), 1)} times</N> as many. Of the countries with a significant trend, <N>{per(e.sensitivity.harmonized_vs_modis.h_significant_same_sign_pct, 0)}</N> have the same sign in a record built from MODIS alone, and so do <N>{per(f.modis_check_l3.tested.harmonized_significant_same_sign_pct, 0)}</N> of the significant hexagons. The harmonization does not make these trends.</p>
      </Callout>
    </FoldSection>
  );
}

function TrendLinks() {
  return (
    <span className="fh-mx-links">
      <a className="ui-btn ui-btn-ghost" href="#/?mode=trend"><IconMap size={15} />See the trend map</a>
      <a className="ui-btn ui-btn-ghost" href="#/rankings"><IconRanking size={15} />Rank every place</a>
    </span>
  );
}

// ------------------------------------------------------------------------------------------------ the floor

const classLabel = (c: HexClass) => (c.max_per_year === null ? `${int(c.min_per_year)} or more` : c.min_per_year === 0 ? `Under ${int(c.max_per_year)}` : `${int(c.min_per_year)} to ${int(c.max_per_year)}`);
const shareText = (v: number) => (v < 0.1 ? 'under 0.1%' : per(v, 1));

function Floors({ e }: { e: Eda }) {
  const f = e.fdr;
  const empty = e.overlap.harmonized_where_modis_saw_none;
  const low = f.classes_l3[0];
  const kept = f.classes_l3.filter((c) => c.min_per_year >= f.floor_per_year);
  const floor = f.floors_l3.find((x) => x.floor_per_year === f.floor_per_year);
  const changes = kept.map((c) => Math.abs(100 * (c.h_per_modis_viirs_years / c.h_per_modis_model_years - 1)));
  const signs = kept.map((c) => c.same_sign_as_modis_only_pct);
  const columns: Column<HexClass>[] = [
    { key: 'cls', label: 'Hotspots a year', render: classLabel },
    { key: 'n', label: 'Hexagons', num: true, render: (c) => <><CellLabel>Hexagons</CellLabel>{int(c.hexagons)}</> },
    { key: 'share', label: 'Share of fire', num: true, render: (c) => <><CellLabel>Share of fire</CellLabel>{shareText(c.share_of_fire_pct)}</> },
    { key: 'fall', label: 'Falling', num: true, render: (c) => <><CellLabel>Falling</CellLabel>{int(c.falling)}</> },
    { key: 'rise', label: 'Rising', num: true, render: (c) => <><CellLabel>Rising</CellLabel>{int(c.rising)}</> },
    { key: 'm', label: 'Per MODIS hotspot, 2003 to 2011', num: true, render: (c) => <><CellLabel>Per MODIS hotspot, 2003 to 2011</CellLabel>{fix(c.h_per_modis_model_years, 1)}</> },
    { key: 'v', label: 'Per MODIS hotspot, 2013 to 2021', num: true, render: (c) => <><CellLabel>Per MODIS hotspot, 2013 to 2021</CellLabel>{fix(c.h_per_modis_viirs_years, 1)}</> },
    { key: 'same', label: 'Same sign as MODIS alone', num: true, render: (c) => <><CellLabel>Same sign as MODIS alone</CellLabel>{per(c.same_sign_as_modis_only_pct, 0)}</> },
  ];
  return (
    <Sub title="Too little fire to test">
      <Lede aside={floor ? (
        <MarginNote label="The floor of a map hexagon" value={int(f.floor_per_year)} unit="hotspots a year">
          The <N>{int(floor.tested)}</N> level 3 hexagons above it hold <N>{per(floor.share_of_fire_pct, 1)}</N> of the world’s fire.
        </MarginNote>
      ) : undefined}>
        <p>Before 2012 our model gives every hexagon month a small expected value, also where MODIS saw nothing. On average that is right. In {yearSpan(empty.model_years)} the model puts <N>{per(empty.model_pct, 1)}</N> of the record into level 5 hexagon months where neither MODIS satellite saw a fire. In {yearSpan(empty.viirs_years)}, VIIRS finds <N>{per(empty.viirs_pct, 1)}</N> of its fire in such months. But the model spreads this unseen fire too evenly, over deserts and ice too, while VIIRS records 0 in an empty month. So where a hexagon has almost no fire, the record drops at 2012 although MODIS does not.</p>
        {low ? <p>The <N>{int(low.hexagons)}</N> level 3 hexagons with fewer than {int(low.max_per_year ?? 0)} hotspots a year together hold {shareText(low.share_of_fire_pct)} of the world’s fire. There, our record holds <N>{fix(low.h_per_modis_model_years, 1)}</N> hotspots for every MODIS hotspot in 2003 to 2011 but only <N>{fix(low.h_per_modis_viirs_years, 1)}</N> in 2013 to 2021. Tested without a floor, <N>{int(low.falling)}</N> of them fall and <N>{int(low.rising)}</N> rise, and only <N>{per(low.same_sign_as_modis_only_pct, 0)}</N> share the sign of their trend with MODIS alone.</p> : null}
        {floor ? <p>From {f.floor_per_year} hotspots a year up, the ratio moves by only <N>{fix(Math.min(...changes), 0)}% to {fix(Math.max(...changes), 0)}%</N> between the two periods, as it does for the world. There, <N>{fix(Math.min(...signs), 0)}% to {fix(Math.max(...signs), 0)}%</N> of the hexagons share the sign of MODIS alone. So we test a map hexagon only when it has at least <N>{f.floor_per_year}</N> hotspots a year on average. The <N>{int(floor.tested)}</N> level 3 hexagons that pass hold <N>{per(floor.share_of_fire_pct, 1)}</N> of the world’s fire. The floor also fits our 90% ranges: a modelled year of {int(f.floor_year_band.from)} to {int(f.floor_year_band.to)} hotspots has a range from <N>{fix(f.floor_year_band.below_pct, 0)}%</N> below to <N>{fix(f.floor_year_band.above_pct, 0)}%</N> above, and below about {fix(f.below_floor_year_band.from, 0)} hotspots the range reaches zero.</p> : null}
      </Lede>
      <Grid cols={2}>
        <Card>
          <PlotFigure title="Nearly empty hexagons fall at 2012 although MODIS does not"
            subtitle={<>Harmonized hotspots for every MODIS hotspot, in the model years (2003 to 2011, open) and the VIIRS years (2013 to 2021, filled), level 3 hexagons by their hotspots a year.</>}
            source={SOURCE} height={250} build={(w) => buildClasses(w, f.classes_l3, f.floor_per_year)} deps={[f]}
            table={{ columns: ['Hotspots a year', '2003 to 2011', '2013 to 2021'], rows: f.classes_l3.map((c) => [classLabel(c), fix(c.h_per_modis_model_years, 1), fix(c.h_per_modis_viirs_years, 1)]) }} />
        </Card>
        <Card title="Where the extra falls come from" subtitle={`Level 3 hexagons by their mean harmonized hotspots a year, 2001 to 2025. Falling and rising: no floor, false discovery rate 5% among all ${int(f.l3_all.hexagons)}.`}>
          <div className="fh-pg-stack fh-pg-stack-pairs fh-mx-tight">
            <DataTable columns={columns} rows={f.classes_l3} rowKey={(c) => String(c.min_per_year)}
              caption="Level 3 hexagons by their hotspots a year: trends with no floor, and our record against MODIS before and after 2012" />
          </div>
        </Card>
      </Grid>
    </Sub>
  );
}

interface ClassPt { label: string; period: 'model' | 'viirs'; v: number; kept: boolean }

function buildClasses(width: number, classes: HexClass[], floor: number): Plot.PlotOptions {
  const p = pal();
  const rows = classes.map((c) => ({ label: classLabel(c), m: c.h_per_modis_model_years, v: c.h_per_modis_viirs_years, kept: c.min_per_year >= floor }));
  const pts: ClassPt[] = rows.flatMap((r) => [{ label: r.label, period: 'model' as const, v: r.m, kept: r.kept }, { label: r.label, period: 'viirs' as const, v: r.v, kept: r.kept }]);
  const top = Math.ceil(Math.max(...pts.map((x) => x.v)) / 5) * 5;
  const narrow = width < 440;
  return {
    height: 250, marginLeft: narrow ? 84 : 96, marginRight: 40, marginTop: 8, marginBottom: 26,
    x: { domain: [0, top], ticks: narrow ? 3 : 6, label: null, tickSize: 0 },
    y: { domain: rows.map((r) => r.label), label: null, tickSize: 0, padding: 0.5 },
    marks: [
      gridX(p, { ticks: narrow ? 3 : 6 }),
      Plot.link(rows, { x1: 'm', x2: 'v', y1: 'label', y2: 'label', stroke: (r: { kept: boolean }) => (r.kept ? p.ink2 : p.accent), strokeWidth: 2, strokeOpacity: 0.7 }),
      Plot.dot(pts.filter((x) => x.period === 'model'), { x: 'v', y: 'label', r: 4.5, fill: p.surface, stroke: (x: ClassPt) => (x.kept ? p.ink : p.accent), strokeWidth: 2 }),
      Plot.dot(pts.filter((x) => x.period === 'viirs'), { x: 'v', y: 'label', r: 4.5, fill: (x: ClassPt) => (x.kept ? p.ink : p.accent), stroke: p.surface, strokeWidth: 1.5 }),
      Plot.text(rows, { x: (r: { m: number; v: number }) => Math.max(r.m, r.v), y: 'label', text: (r: { m: number; v: number }) => `${fix(r.m, 1)} → ${fix(r.v, 1)}`, dx: 10, textAnchor: 'start', fill: p.ink2, fontSize: 11, ...halo(p) }),
      Plot.tip(pts, Plot.pointer({ x: 'v', y: 'label', ...tip(p),
        title: (x: ClassPt) => `${x.label} hotspots a year\n${x.period === 'model' ? '2003 to 2011 (model)' : '2013 to 2021 (VIIRS)'}: ${fix(x.v, 1)} for every MODIS hotspot${x.kept ? '' : '\nBelow the floor: not tested'}` })),
    ],
  };
}

// ------------------------------------------------------------------------------------------------ many tests

const cell = (c: FdrCounts, k: 'rising' | 'falling') => `${int(c[k])} (${per(c[`${k}_pct`], 1)})`;

function ManyTests({ e }: { e: Eda }) {
  const f = e.fdr, l3 = f.l3;
  const raw = l3.raw_005.rising + l3.raw_005.falling;
  const kept = l3.bh_005.rising + l3.bh_005.falling;
  const others = f.floors_l3.filter((x) => x.floor_per_year > 0);
  const lo = Math.min(...others.map((x) => x.fall_per_rise)), hi = Math.max(...others.map((x) => x.fall_per_rise));
  type Row = { rule: string; l3: FdrLevel; l4: FdrLevel; pick: (x: FdrLevel) => FdrCounts };
  const rows: Row[] = [
    { rule: 'Every hexagon (no floor): false discovery rate 5%', l3: f.l3_all, l4: f.l4_all, pick: (x) => x.bh_005 },
    { rule: `At least ${f.floor_per_year} a year: p below 0.05`, l3: f.l3, l4: f.l4, pick: (x) => x.raw_005 },
    { rule: `At least ${f.floor_per_year} a year: false discovery rate 5%`, l3: f.l3, l4: f.l4, pick: (x) => x.bh_005 },
    { rule: `At least ${f.floor_per_year} a year: false discovery rate 10%`, l3: f.l3, l4: f.l4, pick: (x) => x.bh_010 },
    { rule: `At least ${f.floor_per_year} a year: rate 5%, any dependence`, l3: f.l3, l4: f.l4, pick: (x) => x.by_005 },
  ];
  const columns: Column<Row>[] = [
    { key: 'rule', label: 'Hexagons and rule', render: (r) => r.rule },
    { key: 'l3r', label: 'Level 3, rising', num: true, render: (r) => <><CellLabel>Level 3, rising</CellLabel>{cell(r.pick(r.l3), 'rising')}</> },
    { key: 'l3f', label: 'Level 3, falling', num: true, render: (r) => <><CellLabel>Level 3, falling</CellLabel>{cell(r.pick(r.l3), 'falling')}</> },
    { key: 'l4r', label: 'Level 4, rising', num: true, render: (r) => <><CellLabel>Level 4, rising</CellLabel>{cell(r.pick(r.l4), 'rising')}</> },
    { key: 'l4f', label: 'Level 4, falling', num: true, render: (r) => <><CellLabel>Level 4, falling</CellLabel>{cell(r.pick(r.l4), 'falling')}</> },
  ];
  const share = (iso3: string, k: 'falling_pct' | 'rising_pct') => f.l3_by_country.find((c) => c.iso3 === iso3)?.[k] ?? null;
  const fallers = ['KAZ', 'IDN', 'BRA', 'ARG'].map((iso) => ({ iso, v: share(iso, 'falling_pct'), name: f.l3_by_country.find((c) => c.iso3 === iso)?.name ?? iso }));
  const eu = f.l3_by_continent.Europe;
  const cod = share('COD', 'rising_pct'), ind = share('IND', 'rising_pct');
  return (
    <Sub title="Many tests at once">
      <Lede aside={(
        <MarginNote label="Pass false discovery control at 5%" value={int(kept)} unit={`of ${int(l3.hexagons)}`}>
          About <N>{int(l3.expected_false_raw)}</N> would pass p below 0.05 by chance alone if fire had no trend anywhere.
        </MarginNote>
      )}>
        <p>Of the <N>{int(l3.hexagons)}</N> tested hexagons, <N>{int(raw)}</N> have a trend with p below 0.05. If fire had no trend anywhere, about <N>{int(l3.expected_false_raw)}</N> would pass by chance. False discovery control at 5% (Benjamini and Hochberg) keeps <N>{int(kept)}</N>. Fire fell in <N>{int(l3.bh_005.falling)}</N> hexagons (<N>{per(l3.bh_005.falling_pct, 0)}</N>) and rose in <N>{int(l3.bh_005.rising)}</N> (<N>{per(l3.bh_005.rising_pct, 0)}</N>), so it fell in <N>{fix(l3.fall_per_rise_bh_005, 1)} times</N> as many places as it rose. Without the floor the ratio would be <N>{fix(f.l3_all.fall_per_rise_bh_005, 1)}</N>, inflated by the nearly empty hexagons. With floors from {int(others[0]?.floor_per_year ?? 0)} to {int(others[others.length - 1]?.floor_per_year ?? 0)} hotspots a year it stays between <N>{fix(lo, 1)}</N> and <N>{fix(hi, 1)}</N>. Only hexagons with p up to <N>{fix(l3.p_cut_005, 4)}</N> pass, so the rounding of p values to four decimals in our files changes nothing.</p>
        {eu && fallers.every((x) => x.v !== null) && cod !== null && ind !== null ? <p>The falls cover most of Europe, where <N>{per(eu.falling_pct, 0)}</N> of the tested hexagons fall, and large parts of {andList(fallers.map((x) => `${x.name} (${per(x.v ?? 0, 0)})`))}. The rises gather in fewer places: the Congo basin (<N>{per(cod, 0)}</N> of the tested hexagons of DR Congo rise), India (<N>{per(ind, 0)}</N>), Peru, Mozambique and Madagascar.</p> : null}
      </Lede>
      <Card title="Hexagons with a rising or falling trend of yearly fire, 2001 to 2025"
        subtitle={`Shares are of the hexagons each row tests: ${int(f.l3_all.hexagons)} at level 3 and ${int(f.l4_all.hexagons)} at level 4 with no floor; ${int(f.l3.hexagons)} and ${int(f.l4.hexagons)} with the floor.`}>
        <div className="fh-pg-stack fh-pg-stack-pairs">
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.rule}
            caption="Hexagons with a rising or falling trend under each rule, at level 3 (about 12,400 km²) and level 4 (about 1,770 km²)" />
        </div>
        <Note>False discovery rates follow Benjamini and Hochberg; “any dependence” follows Benjamini and Yekutieli. A trend that passes with a Sen’s slope of exactly 0 counts as neither.</Note>
      </Card>
      <Card>
        <PlotFigure title={`Fire fell in more places than it rose, whatever the floor`}
          subtitle="Hexagons with a falling trend for every one with a rising trend, false discovery rate 5%, by the least hotspots a year a hexagon needs to be tested. Level 3 (large) and level 4 (medium) hexagons."
          source={SOURCE} height={230} build={(w) => buildFloors(w, e)} deps={[e]}
          table={{ columns: ['Floor (hotspots a year)', 'Level 3: tested', 'Level 3: falls per rise', 'Level 4: tested', 'Level 4: falls per rise'],
            rows: f.floors_l3.map((r) => { const r4 = f.floors_l4.find((x) => x.floor_per_year === r.floor_per_year); return [r.floor_per_year ? int(r.floor_per_year) : 'No floor', int(r.tested), fix(r.fall_per_rise, 2), r4 ? int(r4.tested) : '–', r4 ? fix(r4.fall_per_rise, 2) : '–']; }) }} />
      </Card>
    </Sub>
  );
}

interface FloorPt { level: string; floor: number; label: string; v: number; tested: number; chosen: boolean }

function buildFloors(_width: number, e: Eda): Plot.PlotOptions {
  const p = pal();
  const f = e.fdr;
  const label = (x: number) => (x === 0 ? 'No floor' : int(x));
  const pts: FloorPt[] = [
    ...f.floors_l3.map((r) => ({ level: 'Level 3', floor: r.floor_per_year, label: label(r.floor_per_year), v: r.fall_per_rise, tested: r.tested, chosen: r.floor_per_year === f.floor_per_year })),
    ...f.floors_l4.map((r) => ({ level: 'Level 4', floor: r.floor_per_year, label: label(r.floor_per_year), v: r.fall_per_rise, tested: r.tested, chosen: r.floor_per_year === f.floor_per_year })),
  ];
  const domain = f.floors_l3.map((r) => label(r.floor_per_year));
  const top = Math.ceil(Math.max(...pts.map((x) => x.v)) + 0.5);
  const colour = (lvl: string) => (lvl === 'Level 3' ? p.ink : p.modis);
  const ends = ['Level 3', 'Level 4'].map((l) => pts.find((x) => x.level === l)).filter((x): x is FloorPt => x !== undefined);
  return {
    height: 230, marginLeft: 36, marginRight: 24, marginTop: 14, marginBottom: 30,
    x: { type: 'point', domain, label: null, tickSize: 0, padding: 0.3 },
    y: { domain: [0, top], ticks: 4, label: null, tickSize: 0, tickFormat: (v: number) => `${v}×` },
    marks: [
      gridY(p, { ticks: 4 }),
      Plot.ruleY([1], { stroke: p.baseline }),
      Plot.ruleX([label(f.floor_per_year)], { stroke: p.accent, strokeOpacity: 0.6 }),
      Plot.text([label(f.floor_per_year)], { x: (v: string) => v, frameAnchor: 'top', text: () => 'our floor', dy: -2, dx: 4, textAnchor: 'start', fill: p.accentText, fontSize: 11, ...halo(p) }),
      Plot.lineY(pts, { x: 'label', y: 'v', z: 'level', stroke: (x: FloorPt) => colour(x.level), strokeWidth: 2 }),
      Plot.dot(pts, { x: 'label', y: 'v', r: (x: FloorPt) => (x.chosen ? 5.5 : 4), fill: (x: FloorPt) => colour(x.level), stroke: p.surface, strokeWidth: 1.5 }),
      Plot.text(ends, { x: 'label', y: 'v', text: 'level', dx: 10, dy: -12, textAnchor: 'start', fill: (x: FloorPt) => colour(x.level), fontSize: 11, fontWeight: 600, ...halo(p) }),
      Plot.tip(pts, Plot.pointer({ x: 'label', y: 'v', ...tip(p),
        title: (x: FloorPt) => `${x.level}, ${x.floor ? `at least ${int(x.floor)} a year` : 'no floor'}\n${int(x.tested)} hexagons tested\n${fix(x.v, 2)} falls for every rise` })),
    ],
  };
}

// ------------------------------------------------------------------------------------------------ neighbours and levels

function Regions({ e }: { e: Eda }) {
  const f = e.fdr;
  const sp = f.spatial_l3, lv = f.l3_vs_l4;
  const by = f.l3.by_005;
  const l4floor = f.floors_l4.find((x) => x.floor_per_year === f.floor_per_year);
  return (
    <Sub title="Trends come in regions, at any size of hexagon">
      {/* the margin holds the level 4 test: Moran's I is in the text and in the first tile below */}
      <Lede aside={l4floor ? (
        <MarginNote label="Level 4 hexagons tested" value={int(l4floor.tested)} unit="above the floor">
          They hold <N>{per(l4floor.share_of_fire_pct, 0)}</N> of the world’s fire, and <N>{per(lv.l4_significant_pct, 0)}</N> of them have a trend that survives the control.
        </MarginNote>
      ) : (
        <MarginNote label="Moran’s I of the trends" value={fix(sp.moran_i, 2)} unit="neighbours agree">
          0 would mean no link between neighbouring hexagons; p = <N>{fix(sp.moran_p, 3)}</N> from {int(sp.permutations)} reshuffles.
        </MarginNote>
      )}>
        <p>Neighbouring hexagons have similar trends. Moran’s I of the trend scores of the tested hexagons is <N>{fix(sp.moran_i, 2)}</N>, where 0 would mean no link between neighbours (p = <N>{fix(sp.moran_p, 3)}</N> from <N>{int(sp.permutations)}</N> random reshuffles). Of the significant hexagons, <N>{per(sp.significant_with_same_sign_neighbour_pct, 0)}</N> touch another one with the same sign. So the {int(f.l3.bh_005.rising + f.l3.bh_005.falling)} hexagons are far fewer independent findings than their number suggests, and a single hexagon says less than the region around it. The control still holds for this kind of positive link. The strict variant that holds under any dependence keeps <N>{int(by.rising + by.falling)}</N> hexagons, and fire still falls in <N>{fix(f.l3.fall_per_rise_by_005, 1)} times</N> as many as it rises.</p>
        {l4floor ? <p>At level 4 the same floor keeps <N>{int(l4floor.tested)}</N> hexagons with <N>{per(l4floor.share_of_fire_pct, 0)}</N> of the world’s fire. Of them, <N>{per(lv.l4_significant_pct, 0)}</N> have a trend that survives the control, against <N>{per(lv.l3_significant_pct, 0)}</N> at level 3, and fire falls in <N>{fix(f.l4.fall_per_rise_bh_005, 1)} times</N> as many as it rises. Of the level 4 hexagons, <N>{per(lv.same_sign_pct, 0)}</N> share the sign of the trend of their level 3 parent. Where both are significant, <N>{per(lv.both_significant_same_sign_pct, 0)}</N> agree.</p> : null}
      </Lede>
      <div className="fh-pg-stats-4">
        <StatGrid>
          <StatTile label="Moran’s I of the trends" value={fix(sp.moran_i, 2)}
            context={`0 would mean neighbours are unrelated. p = ${fix(sp.moran_p, 3)} from ${int(sp.permutations)} reshuffles.`} />
          <StatTile label="Significant, with a neighbour that agrees" value={per(sp.significant_with_same_sign_neighbour_pct, 0)}
            context="Hexagons with a trend that touch another hexagon with a trend of the same sign." />
          <StatTile label="Level 4 with the sign of its parent" value={per(lv.same_sign_pct, 0)}
            context={`${per(lv.both_significant_same_sign_pct, 0)} where both are significant: the size of the hexagons does not decide the answer.`} />
          <StatTile label="Under any dependence" value={`${fix(f.l3.fall_per_rise_by_005, 1)}×`}
            context={`Falls per rise with the strict Benjamini and Yekutieli rule: ${int(by.falling)} falls, ${int(by.rising)} rises.`} />
        </StatGrid>
      </div>
    </Sub>
  );
}

// ------------------------------------------------------------------------------------------------ countries and states

/** The rows of the countries or the states table: as the report's tbl-places-countries (all that rise, then the 10
 *  that fall fastest) and tbl-places-states (the 10 that rise fastest, then the 10 that fall fastest). */
export function placeList(e: Eda, kind: 'countries' | 'states'): RankedPlace[] {
  const g = e.places[kind];
  return kind === 'countries' ? [...g.rising, ...g.falling.slice(0, 10)] : [...g.rising.slice(0, 10), ...g.falling.slice(0, 10)];
}

/** A row's number cells as the table shows them: hotspots a year, change per decade, p and q. */
export const placeCells = (r: RankedPlace): string[] => [int(r.mean_per_year), `${signed(r.pct_per_decade, 1)}%`, pText(r.p), pText(r.q)];

function PlacesPart({ e }: { e: Eda }) {
  const pl = e.places;
  const c = pl.countries, s = pl.states;
  const [kind, setKind] = useState<'countries' | 'states'>('countries');
  const rows = useMemo(() => e.sensitivity.harmonized_vs_modis.rows, [e]);
  const q = useMemo(() => bhAdjust(rows.map((r) => r.h_p)), [rows]);
  const qOf = (iso3: string) => { const i = rows.findIndex((r) => r.iso3 === iso3); return i < 0 ? null : q[i]; };
  const india = c.rising.find((r) => r.iso3 === 'IND' && r.kind === 'country');
  const brazil = rows.find((r) => r.iso3 === 'BRA'), brazilQ = qOf('BRA');
  // Brazil's own p from the sensitivity rows, which keep 5 decimals (0.02349; the agreement rows round it to 0.0235)
  const brazilP = e.sensitivity.places.find((x) => x.id === 'BRA')?.trends.find((t) => t.years[0] === 2001)?.p ?? brazil?.h_p ?? null;
  const canada = c.rising.find((r) => r.iso3 === 'CAN' && r.kind === 'country');
  const canTop = e.sensitivity.places.find((x) => x.id === 'CAN')?.top_years ?? [];
  const floors = c.floors;
  const fall = floors.map((x) => x.bh_005.falling_pct), rise = floors.map((x) => x.bh_005.rising_pct);
  const iceland = c.left_out_barren.some((x) => x.id === 'ISL');
  const riau = s.falling.find((r) => r.id === 'IDN-492'), ck = s.falling.find((r) => r.id === 'IDN-1931');
  const bihar = s.rising.find((r) => r.name.startsWith('Bihar')), raj = s.rising.find((r) => r.name.startsWith('Rajasthan'));
  const mys = c.falling.find((r) => r.iso3 === 'MYS'), idn = c.falling.find((r) => r.iso3 === 'IDN');
  const list = placeList(e, kind);
  const cell = (r: RankedPlace, i: number, label: string) => <><CellLabel>{label}</CellLabel>{placeCells(r)[i]}</>;
  const columns: Column<RankedPlace>[] = [
    { key: 'name', label: 'Place', render: (r) => <AreaLink kind={r.kind} id={r.id}>{r.name}</AreaLink> },
    { key: 'n', label: 'Hotspots a year', num: true, render: (r) => cell(r, 0, 'Hotspots a year') },
    { key: 't', label: 'Change per decade', num: true, render: (r) => cell(r, 1, 'Change per decade') },
    { key: 'p', label: 'p', num: true, render: (r) => cell(r, 2, 'p') },
    { key: 'q', label: 'q', num: true, render: (r) => cell(r, 3, 'q') },
  ];
  return (
    <Sub title="Countries and states">
      <Lede aside={(
        <MarginNote label="Countries with a clear trend" value={`${int(c.bh_005.rising + c.bh_005.falling)} of ${int(c.tested)}`} unit="tested">
          <N>{int(c.bh_005.falling)}</N> fall and <N>{int(c.bh_005.rising)}</N> rise, after false discovery control at 5%.
        </MarginNote>
      )}>
        <p>We ranked only places with at least <N>{int(pl.floor_per_year)}</N> hotspots a year on the NOAA‑20 scale. A modelled year of that size has a 90% range from <N>{fix(pl.floor_year_band.below_pct, 0)}%</N> below to <N>{fix(pl.floor_year_band.above_pct, 0)}%</N> above. Smaller years have wider ranges, from <N>{fix(pl.below_floor_year_band.below_pct, 0)}%</N> below to <N>{fix(pl.below_floor_year_band.above_pct, 0)}%</N> above for {int(pl.below_floor_year_band.from)} to {int(pl.below_floor_year_band.to)} hotspots, as wide as the trends we want to find. We also set aside places with more than half of their fire on barren land, where lava and gas flares pass for fire: {WORDS[c.left_out_barren.length] ?? int(c.left_out_barren.length)} countries{iceland ? ', Iceland among them' : ''}. That still leaves <N>{int(c.tested)}</N> countries with <N>{per(c.share_of_world_fire_pct, 1)}</N> of the world’s fire, and <N>{int(s.tested)}</N> states with <N>{per(s.share_of_world_fire_pct, 0)}</N>. With floors of {andList(floors.map((x) => int(x.floor_per_year))).replace(/ and ([^ ]+)$/, ' or $1')}, about a third of the countries still fall (<N>{fix(Math.min(...fall), 0)}% to {fix(Math.max(...fall), 0)}%</N>) and <N>{fix(Math.min(...rise), 0)}% to {fix(Math.max(...rise), 0)}%</N> rise.</p>
        <p>Of the {int(c.tested)} countries, <N>{int(c.bh_005.rising + c.bh_005.falling)}</N> have a trend that survives the control: <N>{int(c.bh_005.falling)}</N> fall and <N>{int(c.bh_005.rising)}</N> rise.{india ? <> India’s rise of <N>{fix(india.pct_per_decade, 1)}%</N> per decade is one of them (q = <N>{pText(india.q)}</N>, the p value adjusted for the number of tests).</> : null}{brazil && brazilQ !== null && brazilQ > 0.05 ? <> Brazil’s fall of <N>{fix(Math.abs(brazil.h_pct), 1)}%</N> is not. Its p value of <N>{pText(brazilP ?? brazil.h_p)}</N> would look convincing alone, but among {int(c.tested)} tests it becomes q = <N>{pText(brazilQ)}</N>, so it passes only at the looser rate of 10%.</> : null}{canada ? <> Canada rises fastest, by <N>{fix(canada.pct_per_decade, 0)}%</N> per decade, and its three biggest years are {andList(canTop.slice(0, 3).sort().map(String))}.</> : null}{mys && idn ? <> Malaysia and Indonesia fall by more than half per decade.</> : null}{riau && ck && bihar && raj ? <> Among states, Riau and Central Kalimantan fall by about <N>{fix(Math.abs((riau.pct_per_decade + ck.pct_per_decade) / 2), 0)}%</N> per decade, and Bihar and Rajasthan in India rise by <N>{fix(Math.min(bihar.pct_per_decade, raj.pct_per_decade), 0)}% to {fix(Math.max(bihar.pct_per_decade, raj.pct_per_decade), 0)}%</N>.</> : null}</p>
      </Lede>
      <Card title={kind === 'countries' ? `Countries whose trend survives false discovery control at 5%` : 'States and provinces whose trend survives the control'}
        subtitle={kind === 'countries' ? `All ${c.bh_005.rising} that rise, then the 10 that fall fastest. q is the p value adjusted by Benjamini and Hochberg.` : 'The 10 that rise fastest, then the 10 that fall fastest. Rules as for countries.'}
        actions={<Segmented label="Places" hideLabel value={kind} onChange={setKind}
          options={[{ value: 'countries', label: 'Countries' }, { value: 'states', label: 'States' }]} />}>
        <div className="fh-pg-stack fh-pg-stack-pairs">
          <DataTable columns={columns} rows={list} rowKey={(r) => `${r.kind}:${r.id}`}
            caption={`${kind === 'countries' ? 'Countries' : 'States'} with a significant trend of yearly fire, 2001 to 2025: hotspots a year, change per decade, p and q`} />
        </div>
        <Note>Only places with at least {int(pl.floor_per_year)} hotspots a year and less than half of their fire on barren land. Click a place to open it in the Explorer.</Note>
      </Card>
    </Sub>
  );
}

// ------------------------------------------------------------------------------------------------ other choices

function OtherChoices({ e, d }: { e: Eda; d: DashboardData }) {
  const sv = e.sensitivity;
  const places = sv.places;
  const hv = sv.harmonized_vs_modis, hv3 = sv.harmonized_vs_modis_2003_2025;
  const mc = e.fdr.modis_check_l3;
  const world = places.find((x) => x.kind === 'world');
  const sig = (t: { p: number }) => t.p < 0.05;
  const changed = places.filter((x) => x.trends[0] && x.trends[1] && Math.sign(x.trends[0].pct_per_decade) !== Math.sign(x.trends[1].pct_per_decade));
  const lost = places.filter((x) => x.trends[0] && x.trends[1] && sig(x.trends[0]) && !sig(x.trends[1]));
  const keptSign = places.every((x) => !x.trends[0] || !sig(x.trends[0]) || Math.sign(x.trends[1]?.pct_per_decade ?? 0) === Math.sign(x.trends[0].pct_per_decade));
  const changedSig = changed.some((x) => sig(x.trends[0]));
  const bra = places.find((x) => x.id === 'BRA'), ind = places.find((x) => x.id === 'IND');
  const q = useMemo(() => bhAdjust(hv.rows.map((r) => r.h_p)), [hv]);
  const sigRows = hv.rows.filter((_, i) => q[i] <= 0.05);
  const sameSig = sigRows.filter((r) => Math.sign(r.h_pct) === Math.sign(r.modis_pct)).length;
  const m = sv.world_h_per_modis_mean;
  const step2002 = d.seam.steps['2002_modis_scale'];
  const gap01 = hv.world.h.pct_per_decade - hv.world.modis.pct_per_decade;
  const gap03 = hv3.world.h.pct_per_decade - hv3.world.modis.pct_per_decade;
  const name = (x: SensitivityPlace) => inSentence(shortName(x.name));
  return (
    <Sub title="Do the trends survive other choices?">
      <Lede aside={(
        <MarginNote label="Countries with a significant trend" value={`${sameSig} of ${sigRows.length}`} unit="same sign">
          Have the same sign in a record built from MODIS alone, which never touches VIIRS. None has significant trends of opposite sign.
        </MarginNote>
      )}>
        <p>A trend that holds up should not depend on choices we made along the way. We changed two of them: the years and the record.</p>
        {world ? <p><strong>The years.</strong> Leaving out 2001 and 2002, the Terra only years, changes little. The world trend stays at <N>{fix(world.trends[1]?.pct_per_decade ?? 0, 1)}%</N> per decade.{keptSign ? <> Every trend that was significant keeps its sign{lost.length ? <>, though {andList(lost.map(name))} fall short of significance</> : null}.</> : null}{changed.length ? <> Only {andList(changed.map(name))} change sign{changedSig ? '' : ', and none of their trends was significant'}.</> : null} The VIIRS years alone, 2012 to 2025, tell a different story for some places, and that is expected: fourteen years give much less power than 25, and fire does not change at a steady rate.{bra && ind ? <> Brazil burned most in the 2000s, with <N>{fix((bra.mean_per_year['2001_2007'] ?? 0) / 1e6, 1)} million</N> hotspots a year in 2001 to 2007 against <N>{fix((bra.mean_per_year['2012_2025'] ?? 0) / 1e6, 1)} million</N> in 2012 to 2025. India rose from about <N>{about(ind.mean_per_year['2001_2007'] ?? 0)}</N> a year to about <N>{about(ind.mean_per_year['2012_2025'] ?? 0)}</N> over the same two periods.</> : null} A trend from 2001 is exactly what harmonization makes possible.</p> : null}
        <p><strong>The record.</strong> If the harmonization made trends, a record built on MODIS alone would disagree with ours. That record never touches VIIRS: it is the mean of Terra and Aqua on their own scale. From {yearSpan(hv.years)}, the two records give the same sign of trend in <N>{per(hv.same_sign_pct, 0)}</N> of the {int(hv.countries)} countries, with a rank correlation of <N>{fix(hv.spearman, 2)}</N>. Of the <N>{sigRows.length}</N> countries with a significant trend in our record, <N>{sameSig}</N> have the same sign in MODIS alone.{hv.both_significant_opposite === 0 ? ' No country has significant trends of opposite sign in the two records.' : null}{hv3.h_significant_same_sign_pct >= 99.95 ? <> From 2003, when both MODIS satellites fly, the agreement among significant trends is complete ({hv3.h_significant} of {hv3.h_significant}).</> : null} Hexagon by hexagon the test is harder, because one hexagon holds far fewer hotspots than a country. Of the <N>{int(mc.tested.hexagons)}</N> tested level 3 hexagons with a trend in both records from {yearSpan(mc.tested.years)}, <N>{per(mc.tested.same_sign_pct, 0)}</N> share the sign. Among those with a significant trend in our record, <N>{per(mc.tested.harmonized_significant_same_sign_pct, 0)}</N> have the same sign in MODIS alone, and only <N>{int(mc.tested.both_significant_opposite)}</N> hexagons have significant trends of opposite sign. Without the floor, <N>{int(mc.all.both_significant_opposite)}</N> would, <N>{int(mc.all.both_significant_opposite - mc.tested.both_significant_opposite)}</N> of them below it.</p>
        <p>The two records do part slowly. Our record holds <N>{fix(m['2003_2012'] ?? 0, 1)}</N> hotspots for every MODIS hotspot in 2003 to 2012, <N>{fix(m['2013_2019'] ?? 0, 1)}</N> in 2013 to 2019 and <N>{fix(m['2025'] ?? 0, 1)}</N> in 2025. Three things move the ratio. In 2001 and 2002, before Aqua flew, the MODIS record is Terra scaled by a fixed ratio, and it steps down by <N>{fix(Math.abs(step2002), 0)}%</N> when Aqua joins. From 2012 to 2021, when both records are observations, the ratio rose by <N>{per(sv.world_h_per_modis_change_2012_2021_pct, 1)}</N>, and we cannot yet say which sensor moved. After 2021, the drifting MODIS orbits miss more of the afternoon fire. So the world trend is <N>{fix(hv.world.h.pct_per_decade, 1)}%</N> per decade in our record and <N>{fix(hv.world.modis.pct_per_decade, 1)}%</N> in MODIS alone, or <N>{fix(hv3.world.modis.pct_per_decade, 1)}%</N> from 2003. Country by country, our trends sit a median of <N>{fix(hv.median_difference_pct_points, 1)} points</N> per decade above those of MODIS alone. For the world the gap is <N>{fix(gap01, 1)} points</N> from 2001 and <N>{fix(gap03, 1)} points</N> from 2003. We take about 5 points per decade as the honest margin of a trend: a smaller trend should be read with care.</p>
      </Lede>
      <Grid cols={2}>
        <Card>
          <PlotFigure title="The trends do not come from the harmonization"
            subtitle={<>The trend of every country with at least {int(e.places.floor_per_year)} hotspots a year, in our record and in the record built from MODIS alone, {yearSpan(hv.years)}, in % per decade. Filled: significant in our record after false discovery control. The diagonal is perfect agreement.</>}
            source={SOURCE} height={340} build={(w) => buildAgreement(w, hv.rows, q)} deps={[hv, q]}
            table={{ columns: ['Country', 'Our record', 'MODIS alone', 'Significant (q ≤ 0.05)'], rows: hv.rows.map((r, i) => [r.name, `${signed(r.h_pct, 1)}%`, `${signed(r.modis_pct, 1)}%`, q[i] <= 0.05 ? 'yes' : 'no']) }} />
        </Card>
        <Card>
          <PlotFigure title="The two records part slowly"
            subtitle="Harmonized hotspots for every MODIS hotspot, world, per year."
            source={SOURCE} height={340} build={(w) => buildRatio(w, sv.world_h_per_modis_by_year)} deps={[sv]}
            table={{ columns: ['Year', 'Harmonized per MODIS hotspot'], rows: Object.entries(sv.world_h_per_modis_by_year).map(([y, v]) => [y, fix(v, 2)]) }} />
        </Card>
      </Grid>
      <SensitivityTable e={e} />
    </Sub>
  );
}

const LABEL_LEFT = new Set(['IDN']);

function buildAgreement(width: number, rows: AgreementRow[], q: number[]): Plot.PlotOptions {
  const p = pal();
  const pts = rows.map((r, i) => ({ ...r, sig: q[i] <= 0.05 }));
  const lim = Math.ceil(Math.max(...pts.flatMap((r) => [Math.abs(r.h_pct), Math.abs(r.modis_pct)])) / 25) * 25;
  // round steps that stop short of the frame's edge, so the top tick never meets the axis label "Our record"
  const step = width < 420 ? 100 : 50;
  const ticks: number[] = [];
  for (let v = -Math.floor(lim / step) * step; v <= lim - step / 4; v += step) if (Math.abs(v) <= lim - step / 4) ticks.push(v);
  const labelled = pts.filter((r) => ['CAN', 'IND', 'IDN', 'MYS', 'BRA'].includes(r.iso3));
  return {
    height: 340, marginLeft: 44, marginRight: 14, marginTop: 14, marginBottom: 36,
    x: { domain: [-lim, lim], ticks, tickFormat: (v: number) => `${v > 0 ? '+' : ''}${v}%`.replace('-', '−'), label: 'MODIS alone', labelAnchor: 'center', labelOffset: 30, tickSize: 0 },
    y: { domain: [-lim, lim], ticks, tickFormat: (v: number) => `${v > 0 ? '+' : ''}${v}%`.replace('-', '−'), label: 'Our record', labelAnchor: 'top', tickSize: 0 },
    marks: [
      gridX(p, { ticks }), gridY(p, { ticks }),
      Plot.ruleX([0], { stroke: p.baseline }), Plot.ruleY([0], { stroke: p.baseline }),
      Plot.line([[-lim, -lim], [lim, lim]], { stroke: p.ink2, strokeWidth: 1 }),
      Plot.dot(pts.filter((r) => !r.sig), { x: 'modis_pct', y: 'h_pct', r: 3.5, fill: 'none', stroke: p.ink2, strokeWidth: 1.2 }),
      Plot.dot(pts.filter((r) => r.sig), { x: 'modis_pct', y: 'h_pct', r: 4, fill: p.accent, stroke: p.surface, strokeWidth: 1 }),
      // Malaysia and Indonesia sit almost on one point: Indonesia takes its label on the left, so the two never overlap
      Plot.text(labelled.filter((r) => !LABEL_LEFT.has(r.iso3)), { x: 'modis_pct', y: 'h_pct', text: 'name', dx: 7, textAnchor: 'start', fill: p.ink, fontSize: 11, fontWeight: 600, ...halo(p) }),
      Plot.text(labelled.filter((r) => LABEL_LEFT.has(r.iso3)), { x: 'modis_pct', y: 'h_pct', text: 'name', dx: -7, textAnchor: 'end', fill: p.ink, fontSize: 11, fontWeight: 600, ...halo(p) }),
      Plot.tip(pts, Plot.pointer({ x: 'modis_pct', y: 'h_pct', ...tip(p),
        title: (r: AgreementRow & { sig: boolean }) => `${r.name}\nOur record ${signed(r.h_pct, 1)}% a decade${r.sig ? ' (significant)' : ''}\nMODIS alone ${signed(r.modis_pct, 1)}% a decade` })),
    ],
  };
}

function buildRatio(width: number, byYear: Record<string, number>): Plot.PlotOptions {
  const p = pal();
  const pts = Object.entries(byYear).map(([y, v]) => ({ yr: Number(y), v }));
  const lo = Math.floor(Math.min(...pts.map((x) => x.v)) * 2) / 2, hi = Math.ceil(Math.max(...pts.map((x) => x.v)) * 2) / 2;
  const last = pts[pts.length - 1];
  return {
    height: 340, marginLeft: 36, marginRight: 40, marginTop: 14, marginBottom: 28,
    x: { domain: [pts[0].yr, last.yr], ticks: width < 420 ? [2005, 2015, 2025] : [2005, 2010, 2015, 2020, 2025], tickFormat: (v: number) => String(v), label: null, tickSize: 0 },
    y: { domain: [lo, hi], ticks: 4, label: null, tickSize: 0, tickFormat: (v: number) => fix(v, 1) },
    marks: [
      gridY(p, { ticks: 4 }),
      Plot.ruleX([2012], { stroke: p.baseline }),
      Plot.text([2012], { x: (v: number) => v, frameAnchor: 'top', text: () => 'VIIRS from 2012', dx: 4, dy: 2, textAnchor: 'start', fill: p.ink2, fontSize: 11, ...halo(p) }),
      Plot.lineY(pts, { x: 'yr', y: 'v', stroke: p.harmonized, strokeWidth: 2.6 }),
      Plot.dot(pts, { x: 'yr', y: 'v', r: 2.5, fill: p.harmonized }),
      Plot.text([last], { x: 'yr', y: 'v', text: (x: { v: number }) => fix(x.v, 1), dx: 7, textAnchor: 'start', fill: p.ink, fontSize: 11, fontWeight: 600 }),
      Plot.tip(pts, Plot.pointerX({ x: 'yr', y: 'v', ...tip(p), title: (x: { yr: number; v: number }) => `${x.yr}\n${fix(x.v, 2)} harmonized hotspots for every MODIS hotspot` })),
    ],
  };
}

function SensitivityTable({ e }: { e: Eda }) {
  const sv = e.sensitivity;
  const star = (t: { pct_per_decade: number; p: number } | undefined): ReactNode => (t ? (
    <span className={t.p < 0.05 ? 'fh-mx-sig' : undefined}>{signed(t.pct_per_decade, 1)}%{t.p < 0.05 ? <span aria-label=", p below 0.05">*</span> : null}</span>
  ) : '–');
  const cols = sv.base_periods.map((y, i) => ({ key: `h${i}`, label: yearSpan(y), get: (x: SensitivityPlace) => x.trends[i] }));
  const mcols = [0, 1].map((i) => ({ key: `m${i}`, get: (x: SensitivityPlace) => x.modis_only[i] }));
  const columns: Column<SensitivityPlace>[] = [
    { key: 'name', label: 'Place', render: (x) => (x.kind === 'world' ? x.name : <AreaLink kind={x.kind} id={x.id}>{shortName(x.name)}</AreaLink>) },
    ...cols.map((c) => ({ key: c.key, label: c.label, num: true, render: (x: SensitivityPlace) => <><CellLabel>{c.label}</CellLabel>{star(c.get(x))}</> })),
    ...mcols.map((c, i) => {
      const yrs = sv.places[0]?.modis_only[i]?.years ?? [2001, 2025];
      const label = `MODIS only, ${yearSpan(yrs)}`;
      return { key: c.key, label, num: true, render: (x: SensitivityPlace) => <><CellLabel>{label}</CellLabel>{star(c.get(x))}</> };
    }),
  ];
  return (
    <Card title="The trend of yearly fire for other years, and for the record built from MODIS alone"
      subtitle="In % per decade. A star marks p below 0.05 for that place alone.">
      <div className="fh-pg-stack fh-pg-stack-pairs fh-mx-sens">
        <DataTable columns={columns} rows={sv.places} rowKey={(x) => `${x.kind}:${x.id}`}
          caption="The trend of yearly fire in % per decade for three base periods and for the record built from MODIS alone" />
      </div>
    </Card>
  );
}
