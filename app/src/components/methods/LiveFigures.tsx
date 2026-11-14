// The report figures that the published files can draw, drawn live in the theme (they used to be light PNGs with
// small text): the seam of 2012, the model ladder, the static heat mask test and the outlook's calibration and skill.
// Numbers from dashboard.json. Each chart has an id, so the checks above can jump to it.
import { useMemo } from 'react';
import * as Plot from '@observablehq/plot';
import { Card, PlotFigure, type FigureTable } from '../ui';
import type { DashboardData } from '../../lib/dashboard-types';
import { gridX, gridY, halo, pal, textWidth, tip } from './charts';
import { fix } from './eda';
import { outlookSkill } from './skill';

const SOURCE = 'Source: NASA FIRMS; analysis: Fire Harmony';
type Dash = DashboardData;
const mil = (v: number) => fix(v / 1e6, 1);

// ------------------------------------------------------------------------------------------------ the seam

type Year = Dash['world']['yearly'][number];

export function SeamFigure({ d }: { d: Dash }) {
  const ys = d.world.yearly.filter((y) => y.complete);
  const jump = d.seam.naive_jump_2011_2012;
  const table: FigureTable = {
    columns: ['Year', 'Joined naively (million)', 'Harmonized (million)', '90% range', 'MODIS scale (million)'],
    rows: ys.map((y) => [String(y.yr), mil(y.naive), mil(y.harmonized), y.lo !== null && y.hi !== null ? `${mil(y.lo)} to ${mil(y.hi)}` : 'observed', mil(y.modis)]),
  };
  return (
    <div id="fig-seam" className="fh-mx-jump-target">
      <Card>
        <PlotFigure title={`Joined naively, the record jumps ${fix(jump, 1)} times in 2012. Harmonized, it does not`}
          subtitle={<>World hotspots per year, in millions, {ys[0]?.yr} to {ys[ys.length - 1]?.yr}. The harmonized record is on the NOAA‑20 VIIRS scale, with its 90% range where it is modelled.
            <span className="fh-pg-legend">
              <span className="fh-pg-key"><span className="fh-pg-swatch fh-pg-swatch-line fh-mx-key-naive" aria-hidden="true" />Joined naively</span>
              <span className="fh-pg-key"><span className="fh-pg-swatch fh-pg-swatch-line fh-mx-key-harm" aria-hidden="true" />Harmonized</span>
              <span className="fh-pg-key"><span className="fh-pg-swatch fh-pg-swatch-band" aria-hidden="true" />90% range</span>
              <span className="fh-pg-key"><span className="fh-pg-swatch fh-pg-swatch-line fh-mx-key-modis" aria-hidden="true" />MODIS scale</span>
            </span></>}
          source={SOURCE} height={300} build={(w) => buildSeam(w, ys)} deps={[ys]} table={table} />
      </Card>
    </div>
  );
}

function buildSeam(width: number, ys: Year[]): Plot.PlotOptions {
  const p = pal();
  const top = Math.ceil(Math.max(...ys.flatMap((y) => [y.naive, y.harmonized, y.hi ?? 0])) / 5e6) * 5;
  const band = ys.filter((y) => y.lo !== null && y.hi !== null);
  const v = (x: number) => x / 1e6;
  const last = ys[ys.length - 1];
  const narrow = width < 480;
  return {
    height: 300, marginLeft: 34, marginRight: narrow ? 14 : 96, marginTop: 14, marginBottom: 28,
    x: { domain: [ys[0].yr, last.yr], ticks: narrow ? [2005, 2015, 2025] : [2005, 2010, 2015, 2020, 2025], tickFormat: (y: number) => String(y), label: null, tickSize: 0 },
    y: { domain: [0, top], ticks: 4, label: null, tickSize: 0 },
    marks: [
      gridY(p, { ticks: 4 }),
      Plot.ruleY([0], { stroke: p.baseline }),
      Plot.ruleX([2012], { stroke: p.baseline }),
      Plot.text([2012], { x: (y: number) => y, frameAnchor: 'top', text: () => 'VIIRS starts', dx: 4, dy: 2, textAnchor: 'start', fill: p.ink2, fontSize: 11, ...halo(p) }),
      Plot.areaY(band, { x: 'yr', y1: (y: Year) => v(y.lo ?? 0), y2: (y: Year) => v(y.hi ?? 0), fill: p.band }),
      Plot.lineY(ys, { x: 'yr', y: (y: Year) => v(y.modis), stroke: p.modis, strokeWidth: 2 }),
      Plot.lineY(ys, { x: 'yr', y: (y: Year) => v(y.naive), stroke: p.naive, strokeWidth: 2 }),
      Plot.lineY(ys, { x: 'yr', y: (y: Year) => v(y.harmonized), stroke: p.harmonized, strokeWidth: 2.6 }),
      narrow ? null : Plot.text([last], { x: 'yr', y: (y: Year) => v(y.harmonized), text: () => 'Harmonized', dx: 8, dy: -8, textAnchor: 'start', fill: p.ink, fontSize: 11, fontWeight: 600, ...halo(p) }),
      narrow ? null : Plot.text([last], { x: 'yr', y: (y: Year) => v(y.naive), text: () => 'Joined naively', dx: 8, dy: 8, textAnchor: 'start', fill: p.naive, fontSize: 11, fontWeight: 600, ...halo(p) }),
      narrow ? null : Plot.text([last], { x: 'yr', y: (y: Year) => v(y.modis), text: () => 'MODIS scale', dx: 8, textAnchor: 'start', fill: p.modisText, fontSize: 11, fontWeight: 600, ...halo(p) }),
      Plot.tip(ys, Plot.pointerX({ x: 'yr', y: (y: Year) => v(y.harmonized), ...tip(p),
        title: (y: Year) => `${y.yr}\nHarmonized ${mil(y.harmonized)} million${y.lo !== null && y.hi !== null ? ` (90% range ${mil(y.lo)} to ${mil(y.hi)})` : ''}\nJoined naively ${mil(y.naive)} million\nMODIS scale ${mil(y.modis)} million` })),
    ],
  };
}

// ------------------------------------------------------------------------------------------------ the model ladder

const SCALES: Record<string, string> = {
  'cell x month': 'One hexagon, one month', 'region L4 x month': 'Small region, one month', 'region L3 x month': 'Large region, one month',
  'continent x month': 'Continent, one month', 'world x month': 'World, one month', 'region L3 x year': 'Large region, one year',
  'continent x year': 'Continent, one year',
};
export const scaleName = (s: string) => SCALES[s] ?? s;
type Cv = Dash['models']['cv'][number];
interface CvPt { scale: string; method: string; err: number; best: boolean }

/** The scales the ladder shows: not one hexagon in one month, where most units have no fire at all, so its median
 *  error says little about the fires. */
const LADDER_SKIP = new Set(['cell x month']);

export function LadderFigure({ d }: { d: Dash }) {
  const cv = useMemo(() => d.models.cv.filter((r) => !LADDER_SKIP.has(r.scale)), [d]);
  const table: FigureTable = { columns: ['Area and period', 'One exchange rate', 'Gradient boosting'], rows: cv.map((r) => [scaleName(r.scale), `${fix(r.ratio_err, 1)}%`, `${fix(r.gbm_err, 1)}%`]) };
  return (
    <div id="fig-ladder" className="fh-mx-jump-target">
      <Card>
        <PlotFigure title="Gradient boosting beats one exchange rate for every area smaller than a continent"
          subtitle={<>Median error on held out years and regions, in the years of MODIS Terra + Aqua. Lower is better. One hexagon in one month is left out: most such months have no fire.
            <span className="fh-pg-legend">
              <span className="fh-pg-key"><span className="fh-pg-swatch" style={{ background: 'var(--text-3)' }} aria-hidden="true" />One exchange rate per region and month</span>
              <span className="fh-pg-key"><span className="fh-pg-swatch" style={{ background: 'var(--harmonized)' }} aria-hidden="true" />Gradient boosting, the model we use</span>
            </span></>}
          source={SOURCE} height={ladderHeight(cv.length, true)} build={(w) => buildLadder(w, cv)} deps={[cv]} table={table} />
      </Card>
    </div>
  );
}

function buildLadder(width: number, cv: Cv[]): Plot.PlotOptions {
  const p = pal();
  const names = cv.map((r) => scaleName(r.scale));
  const pts: CvPt[] = cv.flatMap((r) => [
    { scale: scaleName(r.scale), method: 'One exchange rate', err: r.ratio_err, best: r.ratio_err < r.gbm_err },
    { scale: scaleName(r.scale), method: 'Gradient boosting', err: r.gbm_err, best: r.gbm_err <= r.ratio_err },
  ]);
  const narrow = width < 520;
  const top = Math.ceil(Math.max(...pts.map((x) => x.err)) / 20) * 20;
  // Each area's name sits beside its pair of bars when the bars keep at least 220 px (the margin is measured on the
  // names, so a long name never runs past the card), else above them, so the bars keep the full width on a phone.
  const label = textWidth(names);
  const side = width - (label + 14) - 46 >= 220;
  const height = ladderHeight(cv.length, side);
  return {
    height, marginLeft: side ? label + 14 : 10, marginRight: 46, marginTop: side ? 4 : 12, marginBottom: 26,
    x: { domain: [0, top], ticks: narrow ? 3 : 5, tickFormat: (v: number) => `${v}%`, label: null, tickSize: 0 },
    y: { domain: ['One exchange rate', 'Gradient boosting'], axis: null, padding: 0.1 },
    fy: { domain: names, axis: null, label: null, padding: side ? 0.3 : 0.4 },
    marks: [
      gridX(p, { ticks: narrow ? 3 : 5 }),
      Plot.barX(pts, { x: 'err', y: 'method', fy: 'scale', fill: (x: CvPt) => (x.method === 'Gradient boosting' ? p.harmonized : p.muted), rx: 2 }),
      side
        ? Plot.text(names, { fy: (t: string) => t, frameAnchor: 'left', text: (t: string) => t, dx: -12, textAnchor: 'end', fill: p.ink2, fontSize: 12, fontWeight: 600 })
        : Plot.text(names, { fy: (t: string) => t, frameAnchor: 'top-left', text: (t: string) => t, dy: -17, fill: p.ink2, fontSize: 12, fontWeight: 600 }),
      Plot.text(pts, { x: 'err', y: 'method', fy: 'scale', text: (x: CvPt) => `${fix(x.err, 1)}%`, dx: 5, textAnchor: 'start',
        fill: (x: CvPt) => (x.method === 'Gradient boosting' ? p.ink : p.ink2), fontSize: 11, fontWeight: 600 }),
      Plot.tip(pts, Plot.pointer({ x: 'err', y: 'method', fy: 'scale', ...tip(p), title: (x: CvPt) => `${x.scale}\n${x.method}: ${fix(x.err, 1)}% median error` })),
    ],
  };
}

/** Two bars per area, and a line for its name when the name sits above them. */
const ladderHeight = (n: number, side: boolean) => (side ? 30 + n * 40 : 38 + n * 54);

// ------------------------------------------------------------------------------------------------ the mask

interface MaskPt { test: string; sensor: 'VIIRS' | 'MODIS'; v: number }

export function MaskFigure({ d }: { d: Dash }) {
  const m = d.mask;
  const pts: MaskPt[] = [
    { test: 'Static heat caught', sensor: 'VIIRS', v: 100 * m.viirs.recall }, { test: 'Static heat caught', sensor: 'MODIS', v: 100 * m.modis.recall },
    { test: 'Real fires removed', sensor: 'VIIRS', v: 100 * m.viirs.fire_loss }, { test: 'Real fires removed', sensor: 'MODIS', v: 100 * m.modis.fire_loss },
  ];
  return (
    <div id="fig-mask" className="fh-mx-jump-target">
      <Card>
        <PlotFigure title="The mask catches most static heat and keeps almost every fire"
          subtitle="Built from data up to 2022 (GIHS up to 2023) and tested on 2024 and 2025, years it never saw."
          source="Source: NASA FIRMS, GIHS; analysis: Fire Harmony" height={210} build={(w) => buildMask(w, pts)} deps={[d]}
          table={{ columns: ['Test', 'VIIRS', 'MODIS'], rows: [['Static heat caught', `${fix(pts[0].v, 1)}%`, `${fix(pts[1].v, 1)}%`], ['Real fires removed', `${fix(pts[2].v, 2)}%`, `${fix(pts[3].v, 2)}%`]] }} />
      </Card>
    </div>
  );
}

function buildMask(width: number, pts: MaskPt[]): Plot.PlotOptions {
  const p = pal();
  return {
    height: 210, marginLeft: 56, marginRight: 52, marginTop: 22, marginBottom: 26,
    x: { domain: [0, 100], ticks: width < 420 ? [0, 50, 100] : [0, 25, 50, 75, 100], tickFormat: (v: number) => `${v}%`, label: null, tickSize: 0 },
    y: { domain: ['VIIRS', 'MODIS'], label: null, tickSize: 0, padding: 0.28 },
    fy: { domain: ['Static heat caught', 'Real fires removed'], axis: null, label: null, padding: 0.3 },
    marks: [
      gridX(p, { ticks: width < 420 ? [0, 50, 100] : [0, 25, 50, 75, 100] }),
      Plot.barX(pts, { x: 'v', y: 'sensor', fy: 'test', fill: (x: MaskPt) => (x.sensor === 'VIIRS' ? p.noaa20 : p.modis), rx: 3 }),
      Plot.text(pts, { x: 'v', y: 'sensor', fy: 'test', text: (x: MaskPt) => `${fix(x.v, x.v < 5 ? 2 : 1)}%`, dx: 6, textAnchor: 'start', fill: p.ink, fontSize: 12, fontWeight: 600 }),
      Plot.text(['Static heat caught', 'Real fires removed'], { fy: (t: string) => t, frameAnchor: 'top-left', text: (t: string) => t, dx: -52, dy: -18, fill: p.ink2, fontSize: 12, fontWeight: 600 }),
    ],
  };
}

// ------------------------------------------------------------------------------------------------ the outlook

type Cal = NonNullable<Dash['outlook']>['calibration'][number];
type Cont = NonNullable<Dash['outlook']>['by_continent'][number];

export function OutlookFigures({ d }: { d: Dash }) {
  const o = d.outlook;
  if (!o) return null;
  const cal = o.calibration;
  // the skill against the reference the release scores (a fixed 50% chance when it has one), worded from the data
  const skill = outlookSkill(o);
  const conts = skill.continents.length ? skill.continents : o.by_continent;
  const ref = skill.against.replace(/^against /, '');
  const beat1 = conts.filter((c) => c.l1 > 0).length;
  const skillTitle = conts.every((c) => c.l1 > 0 && c.l2 > 0 && c.l3 > 0) ? `It beats ${ref} on every continent`
    : beat1 === conts.length ? `It beats ${ref} on every continent one month ahead`
      : `One month ahead it beats ${ref} on ${beat1} of ${conts.length} continents`;
  return (
    <div id="fig-outlook" className="fh-mx-jump-target ui-grid ui-grid-2">
      <Card>
        <PlotFigure title="The outlook’s chances can be trusted"
          subtitle="The chance the outlook gave against how often fire then came out above normal, on held out years, 1 to 3 months ahead together, in the months of the fire season. Dots on the diagonal are honest chances; dot size shows how often a chance was given."
          source="Source: NASA FIRMS, GPM IMERG, MERRA‑2, NOAA; analysis: Fire Harmony" height={280} build={(w) => buildCalibration(w, cal)} deps={[cal]}
          table={{ columns: ['Chance given', 'Above normal', 'Months'], rows: cal.map((c) => [`${fix(100 * c.p, 0)}%`, `${fix(100 * c.o, 0)}%`, fix(c.n, 0)]) }} />
      </Card>
      <Card>
        <PlotFigure title={skillTitle}
          subtitle={<>Brier skill score by continent, on held out years, {skill.against}{skill.fair ? '' : ' for that month'}. Above 0 beats it.
            <span className="fh-pg-legend">{LEADS.map((l, i) => <span key={l} className="fh-pg-key"><span className="fh-pg-swatch fh-mx-lead" data-i={i} aria-hidden="true" />{l} ahead</span>)}</span></>}
          source="Source: NASA FIRMS, GPM IMERG, MERRA‑2, NOAA; analysis: Fire Harmony" height={280} build={(w) => buildSkill(w, conts)} deps={[o]}
          table={{ columns: ['Continent', '1 month', '2 months', '3 months'], rows: conts.map((c) => [c.name, fix(c.l1, 2), fix(c.l2, 2), fix(c.l3, 2)]) }} />
      </Card>
    </div>
  );
}

function buildCalibration(width: number, cal: Cal[]): Plot.PlotOptions {
  const p = pal();
  const maxN = Math.max(...cal.map((c) => c.n));
  const size = Math.min(width, 380);
  return {
    height: 280, width: size, marginLeft: 40, marginRight: 14, marginTop: 10, marginBottom: 34,
    x: { domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1], tickFormat: (v: number) => `${fix(100 * v, 0)}%`, label: 'Chance given', labelAnchor: 'center', labelOffset: 30, tickSize: 0 },
    y: { domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1], tickFormat: (v: number) => `${fix(100 * v, 0)}%`, label: null, tickSize: 0 },
    r: { type: 'sqrt', domain: [0, maxN], range: [2.5, 10] },
    marks: [
      gridX(p, { ticks: [0, 0.25, 0.5, 0.75, 1] }), gridY(p, { ticks: [0, 0.25, 0.5, 0.75, 1] }),
      Plot.line([[0, 0], [1, 1]], { stroke: p.ink2, strokeWidth: 1 }),
      Plot.line(cal, { x: 'p', y: 'o', stroke: p.accent, strokeWidth: 2 }),
      Plot.dot(cal, { x: 'p', y: 'o', r: 'n', fill: p.accent, fillOpacity: 0.85, stroke: p.surface, strokeWidth: 1 }),
      Plot.tip(cal, Plot.pointer({ x: 'p', y: 'o', ...tip(p), title: (c: Cal) => `Chance given ${fix(100 * c.p, 0)}%\nCame out above normal ${fix(100 * c.o, 0)}% of the time\n${fix(c.n, 0)} months` })),
    ],
  };
}

interface SkillPt { name: string; lead: string; v: number }
const LEADS = ['1 month', '2 months', '3 months'];
const LEAD_OPACITY: Record<string, number> = { '1 month': 1, '2 months': 0.62, '3 months': 0.36 };   // fainter further ahead, in both themes

function buildSkill(width: number, rows: Cont[]): Plot.PlotOptions {
  const p = pal();
  const pts: SkillPt[] = rows.flatMap((c) => [{ name: c.name, lead: LEADS[0], v: c.l1 }, { name: c.name, lead: LEADS[1], v: c.l2 }, { name: c.name, lead: LEADS[2], v: c.l3 }]);
  const narrow = width < 460;
  const top = Math.ceil(Math.max(...pts.map((x) => x.v)) * 10) / 10 + 0.05;
  // a lead can score below 0 (worse than the reference): the axis then starts below 0, so the bar shows
  const low = Math.min(0, Math.floor(Math.min(...pts.map((x) => x.v)) * 20) / 20);
  return {
    height: 280, marginLeft: narrow ? 96 : 108, marginRight: 40, marginTop: 6, marginBottom: 26,
    x: { domain: [low, top], ticks: 4, tickFormat: (v: number) => fix(v, 1), label: null, tickSize: 0 },
    y: { domain: LEADS, axis: null, padding: 0.08 },
    fy: { domain: rows.map((c) => c.name), label: null, padding: 0.24, axis: 'left', tickSize: 0 },
    marks: [
      gridX(p, { ticks: 4 }),
      Plot.ruleX([0], { stroke: p.baseline }),
      Plot.barX(pts, { x: 'v', y: 'lead', fy: 'name', fill: p.accent, fillOpacity: (x: SkillPt) => LEAD_OPACITY[x.lead] ?? 1, rx: 2 }),
      Plot.text(pts.filter((x) => x.lead === LEADS[0]), { x: 'v', y: 'lead', fy: 'name', text: (x: SkillPt) => fix(x.v, 2), dx: 5, textAnchor: 'start', fill: p.ink, fontSize: 11, fontWeight: 600 }),
      Plot.tip(pts, Plot.pointer({ x: 'v', y: 'lead', fy: 'name', ...tip(p), title: (x: SkillPt) => `${x.name}, ${x.lead} ahead\nBrier skill score ${fix(x.v, 2)}` })),
    ],
  };
}
