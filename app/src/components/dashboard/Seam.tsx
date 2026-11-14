// 5. The seam test, the core result: joined naively, MODIS and VIIRS make world fire jump in 2012; the harmonized
// record has no jump, measured against satellites that flew on both sides of each seam. A switch shows the naive join,
// the harmonized record or both; the 2001 to 2012 part of the line moves between the two (CSS transitions of the SVG
// path, so nothing is drawn again).
import { useState } from 'react';
import * as Plot from '@observablehq/plot';
import type { DashboardData } from '../../lib/dashboard-types';
import { Callout, Card, PlotFigure, Segmented, StatTile } from '../ui';
import { DbSection } from './DbSection';
import { AnimatedNumber } from '../AnimatedNumber';
import { hgrid, palette, svgEl, tipLook } from './chart';
import { addMonths, andList, count, dec, int, millions, monthYear, pct, satellite, yearOf } from './format';
import { Keys } from './parts';

const SOURCE = 'Source: Fire Harmony v1.0, from NASA FIRMS hotspots (MODIS and VIIRS).';

type Year = DashboardData['world']['yearly'][number];
type Mode = 'naive' | 'harmonized' | 'both';

/** "2011-11-01" -> "November 2011". */
const isoMonth = (s: string): string => monthYear(Number(s.slice(0, 4)) * 100 + Number(s.slice(5, 7)));

/** The 2001 to 2012 part of the naive join and of the harmonized record, as two paths that can move into each other,
 *  and the shared part from 2012 on (where the naive join is VIIRS, the same as the record). */
function seamLines(years: Year[], seamYear: number): Plot.RenderFunction {
  return (_index, scales) => {
    const x = scales.x as (v: number) => number;
    const y = scales.y as (v: number) => number;
    const path = (rows: Year[], f: (r: Year) => number) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(r.yr).toFixed(1)},${y(f(r)).toFixed(1)}`).join('');
    const pre = years.filter((r) => r.yr <= seamYear);
    const post = years.filter((r) => r.yr >= seamYear);
    const dNaive = path(pre, (r) => r.naive), dHarm = path(pre, (r) => r.harmonized);
    const g = svgEl('g', { class: 'db-morph', 'aria-hidden': 'true' });
    g.style.setProperty('--d-naive', `path("${dNaive}")`);
    g.style.setProperty('--d-harm', `path("${dHarm}")`);
    g.append(
      svgEl('path', { class: 'db-morph-post', d: path(post, (r) => r.harmonized) }),
      svgEl('path', { class: 'db-morph-naive', d: dNaive }),
      svgEl('path', { class: 'db-morph-harm', d: dHarm }),
    );
    return g;
  };
}

export function Seam({ d }: { d: DashboardData }) {
  const s = d.seam;
  const [mode, setMode] = useState<Mode>('both');
  const years = d.world.yearly.filter((y) => y.complete);
  const band = years.filter((y): y is Year & { lo: number; hi: number } => y.lo !== null && y.hi !== null);
  const viirs = d.record.satellites.filter((x) => satellite(x.satellite).sensor === 'VIIRS').sort((a, b) => a.first - b.first)[0];
  const seamYear = viirs ? Math.floor(viirs.first / 100) : 2012;
  const yBefore = years.find((y) => y.yr === seamYear - 1), yAt = years.find((y) => y.yr === seamYear);

  const sats = d.record.satellites.map((x) => ({ ...satellite(x.satellite), x1: yearOf(x.first), x2: yearOf(addMonths(x.last, 1)),
    first: x.first, last: x.last }));
  const aqua = d.record.satellites.find((x) => x.satellite === 'Aqua');
  const seams = [
    ...(aqua ? [{ x: yearOf(aqua.first), label: `Aqua joins, ${monthYear(aqua.first)}` }] : []),
    ...(viirs ? [{ x: yearOf(viirs.first), label: `VIIRS joins, ${monthYear(viirs.first)}` }] : []),
  ];

  const tests = (['2012', '2002'] as const).map((k) => ({
    key: k, label: k === '2012' ? 'The 2012 seam, against MODIS' : 'The 2002 seam, against Terra',
    short: k === '2012' ? '2012, against MODIS' : '2002, against Terra', ...s.placebo[k],
  }));
  // the real step first, so the dodge puts it in the middle of its row and moves the others around it
  const dots = tests.flatMap((tt) => [
    { test: tt.label, yr: Number(tt.key), step: tt.real, kind: 'real' as const },
    ...Object.entries(tt.steps).map(([yr, step]) => ({ test: tt.label, yr: Number(yr), step, kind: 'placebo' as const })),
  ]);
  const placeboBands = tests.map((tt) => ({ test: tt.label, lo: tt.mean - tt.sd, hi: tt.mean + tt.sd }));
  const lim = Math.max(10, Math.ceil(Math.max(...dots.map((x) => Math.abs(x.step))) / 5) * 5);
  const nPlacebo = Object.keys(s.placebo['2012'].steps).length;

  const ba = s.burned_area;
  const ratio = ba ? Object.entries(ba.hotspots_per_km2).map(([yr, v]) => ({ yr: Number(yr), v })).sort((a, b) => a.yr - b.yr) : [];
  const rMin = ratio.length ? Math.min(...ratio.map((r) => r.v)) : 0, rMax = ratio.length ? Math.max(...ratio.map((r) => r.v)) : 0;

  const pelt = s.pelt_near_seams;
  const naiveBreaks = Object.values(pelt).flatMap((v) => v.naive_join ?? []);
  const harmBreaks = Object.values(pelt).flatMap((v) => v.harmonized ?? []);
  const step12 = s.steps['2012_harmonized_1y'], naive12 = s.steps['2012_naive_1y'];
  const stepFmt = (v: number) => pct(v, Math.abs(v) >= 10 ? 0 : 2, true);

  return (
    <DbSection id="db-seam" title="The seam test"
      subtitle="When a new satellite joins, a record joined naively jumps. We measure the step of the harmonized record against a satellite that flew on both sides of each seam, and compare it with steps at dates when nothing changed.">
      <div className="db-row db-row-8-4 db-keep">
        <Card>
          <div className="db-seam" data-mode={mode}>
            <div className="db-seam-tools">
              <Segmented label="Show" hideLabel value={mode} onChange={setMode} options={[
                { value: 'naive', label: 'Naive join', title: 'MODIS to 2011, then VIIRS, with no correction' },
                { value: 'harmonized', label: 'Harmonized', title: 'The Fire Harmony record' },
                { value: 'both', label: 'Both' },
              ]} />
              <p className="db-seam-readout">
                {/* screen readers hear the final numbers once; the gliding number is for the eyes only */}
                <span className="db-sr" aria-live="polite">
                  {`Step at the ${seamYear} seam: ${mode === 'harmonized' ? `${stepFmt(step12)}, harmonized` : mode === 'naive' ? `${stepFmt(naive12)}, joined naively` : `${stepFmt(naive12)} joined naively, ${stepFmt(step12)} harmonized`}.`}
                </span>
                <span className="db-seam-readout-label" aria-hidden="true">Step at the {seamYear} seam</span>
                {mode === 'both' ? (
                  <span className="db-seam-readout-vals" aria-hidden="true">
                    <span className="db-seam-v db-seam-v-naive ui-mono">{stepFmt(naive12)}</span>
                    <span className="db-seam-vs">naive,</span>
                    <span className="db-seam-v ui-mono">{stepFmt(step12)}</span>
                    <span className="db-seam-vs">harmonized</span>
                  </span>
                ) : (
                  <span className={mode === 'naive' ? 'db-seam-v db-seam-v-naive ui-mono' : 'db-seam-v ui-mono'} aria-hidden="true">
                    <AnimatedNumber value={mode === 'naive' ? naive12 : step12} format={stepFmt} duration={700} />
                  </span>
                )}
              </p>
            </div>
            <PlotFigure
              title={`Joined naively, world fire jumps ${dec(s.naive_jump_2011_2012, 1)} times in ${seamYear}. The harmonized record does not jump.`}
              subtitle={(
                <>
                  World hotspots per year, millions, on one axis.
                  <Keys items={[
                    { label: 'Harmonized record', colour: 'var(--harmonized)', shape: 'line' },
                    { label: `Naive join: MODIS to ${seamYear - 1}, then VIIRS`, colour: 'var(--fh-naive)', shape: 'line' },
                    { label: '90% range', colour: 'var(--band)', shape: 'band' },
                  ]} />
                </>
              )}
              source={SOURCE}
              height={340}
              deps={[d]}
              build={(width) => {
                const p = palette();
                const yMax = Math.ceil((Math.max(...years.map((y) => y.hi ?? y.harmonized)) * 1.04) / 2.5e6) * 2.5e6;
                const mid = yBefore && yAt ? (yBefore.naive + yAt.naive) / 2 : yMax / 2;
                const first = years[0];
                const yTicks = [0, 5e6, 10e6, 15e6, 20e6].filter((v) => v <= yMax);
                return {
                  height: 340, marginLeft: 30, marginRight: 14, marginTop: 22, marginBottom: 30,
                  x: { domain: [2000.5, (years[years.length - 1]?.yr ?? 2025) + 0.5], tickFormat: 'd', tickSize: 0, label: null,
                    ticks: width < 480 ? [2005, 2012, 2020] : [2001, 2005, 2008, 2012, 2016, 2020, 2025] },
                  y: { domain: [0, yMax], ticks: yTicks, tickFormat: (v: number) => millions(v, 0), tickSize: 0, label: null },
                  marks: [
                    hgrid(p, { ticks: yTicks }),
                    Plot.areaY(band, { x: 'yr', y1: 'lo', y2: 'hi', fill: p.band, className: 'db-seam-band' }),
                    Plot.ruleX([seamYear - 0.5], { stroke: p.baseline, strokeWidth: 1, insetTop: -14 }),
                    Plot.text([seamYear - 0.5], { x: (v: number) => v, frameAnchor: 'top', text: () => 'VIIRS joins', dy: -20, dx: 5, textAnchor: 'start', fill: p.ink2 }),
                    Plot.ruleY([0], { stroke: p.baseline }),
                    seamLines(years, seamYear),
                    ...(first ? [
                      Plot.text([first], { x: 'yr', y: 'naive', text: () => 'Naive join', dy: -12, dx: -2, textAnchor: 'start', fill: p.naive, fontWeight: 600, className: 'db-seam-naive-label' }),
                      Plot.text([first], { x: 'yr', y: (r: Year) => r.hi ?? r.harmonized, text: () => 'Harmonized record', dy: -10, dx: -2, textAnchor: 'start', fill: p.ink, fontWeight: 600, className: 'db-seam-harm-label' }),
                    ] : []),
                    Plot.text([{ x: seamYear - 0.5, y: mid }], { x: 'x', y: 'y', text: () => `${dec(s.naive_jump_2011_2012, 1)} times in one year`,
                      dx: 10, textAnchor: 'start', fill: p.ink2, className: 'db-seam-jump' }),
                    Plot.ruleX(years, Plot.pointerX({ x: 'yr', stroke: p.baseline, strokeWidth: 1 })),
                    Plot.dot(years, Plot.pointerX({ x: 'yr', y: 'naive', r: 4, fill: p.naive, stroke: p.surface, strokeWidth: 2, className: 'db-seam-dot-naive' })),
                    Plot.dot(years, Plot.pointerX({ x: 'yr', y: 'harmonized', r: 4.5, fill: p.harmonized, stroke: p.surface, strokeWidth: 2, className: 'db-seam-dot-harm' })),
                    Plot.tip(years, Plot.pointerX({
                      x: 'yr', frameAnchor: 'top', ...tipLook(p),
                      title: (y: Year) => [String(y.yr), `Harmonized ${count(y.harmonized)}`,
                        ...(y.lo !== null && y.hi !== null ? [`90% range ${count(y.lo)} to ${count(y.hi)}`] : []),
                        `Naive join ${count(y.naive)}`].join('\n'),
                    })),
                  ],
                };
              }}
              table={{
                columns: ['Year', 'Harmonized record', '90% range', 'Naive join', 'MODIS alone'],
                rows: years.map((y) => [String(y.yr), int(y.harmonized), y.lo !== null && y.hi !== null ? `${int(y.lo)} to ${int(y.hi)}` : '',
                  int(y.naive), int(y.modis)]),
              }}
            />
          </div>
        </Card>
        <Card>
          <PlotFigure
            title={`${sats.length} satellites, two seams`}
            subtitle="The months each satellite adds to the record. Blue is MODIS; the other colours are the three VIIRS satellites."
            source="Source: NASA FIRMS archive."
            height={340}
            deps={[d]}
            build={(width) => {
              const p = palette();
              const colour: Record<string, string> = { '--sensor-modis': p.modis, '--sensor-snpp': p.snpp, '--sensor-noaa20': p.noaa20,
                '--sensor-noaa21': p.noaa21, '--muted': p.muted };
              const x1 = Math.floor(Math.min(...sats.map((x) => x.x1)));
              return {
                height: 340, marginLeft: 78, marginRight: 14, marginTop: 44, marginBottom: 30,
                x: { domain: [x1, Math.ceil(Math.max(...sats.map((x) => x.x2)))], tickFormat: 'd', tickSize: 0, label: null,
                  ticks: width < 360 ? [2005, 2015, 2025] : [2000, 2005, 2010, 2015, 2020, 2025] },
                y: { domain: sats.map((x) => x.name), label: null, tickSize: 0, padding: 0.5 },
                color: { domain: sats.map((x) => x.name), range: sats.map((x) => colour[x.colour] ?? p.muted) },
                marks: [
                  Plot.ruleX(seams, { x: 'x', stroke: p.ink2, strokeWidth: 1, insetTop: -28 }),
                  Plot.text(seams.slice(0, 1), { x: 'x', frameAnchor: 'top', text: () => 'Aqua joins', dy: -34, dx: -4, textAnchor: 'end', fill: p.ink2, lineAnchor: 'top' }),
                  Plot.text(seams.slice(1, 2), { x: 'x', frameAnchor: 'top', text: () => 'VIIRS joins', dy: -34, dx: 4, textAnchor: 'start', fill: p.ink2, lineAnchor: 'top' }),
                  Plot.barX(sats, { x1: 'x1', x2: 'x2', y: 'name', fill: 'name', r: 4 }),
                  Plot.tip(sats, Plot.pointerY({
                    x1: 'x1', x2: 'x2', y: 'name', ...tipLook(p),
                    title: (x: (typeof sats)[number]) => `${x.name} (${x.sensor})\nFrom ${monthYear(x.first)}${x.last >= d.record.latest_full_month ? ', still flying' : ` to ${monthYear(x.last)}`}`,
                  })),
                ],
              };
            }}
            table={{
              columns: ['Satellite', 'Sensor', 'First month', 'Last month'],
              rows: sats.map((x) => [x.name, x.sensor, monthYear(x.first), monthYear(x.last)]),
            }}
          />
        </Card>
      </div>

      <div className="db-row db-row-4">
        <StatTile label={`The ${seamYear} seam`} value={pct(step12, 2, true)}
          context={`Step of the harmonized record in January ${seamYear}, against MODIS, which flew on both sides. Joined naively: ${pct(naive12, 0, true)}.`} />
        <StatTile label="The 2002 seam" value={pct(s.steps['2002_harmonized'], 2, true)}
          context={`Step in July 2002, when Aqua joined, against Terra. Without the Terra only bridge it would be ${pct(s.steps['2002_without_bridge'], 1, true)}.`} />
        <StatTile label="Normal spread of steps" value={pct(s.placebo['2012'].sd, 1)} unit="against MODIS"
          context={`Steps at ${nPlacebo} dates with no satellite change vary this much, and ${pct(s.placebo['2002'].sd, 1)} against Terra. Both real steps sit well inside.`} />
        {ba ? (
          <StatTile label="Burned area witness" value={pct(ba.step_1y, 1, true)}
            context={`Step at ${seamYear} against burned area mapped by ESA, inside its normal spread of ${pct(ba.placebo_sd, 1)}. The record holds ${dec(rMin, 1)} to ${dec(rMax, 1)} hotspots per km² burned.`} />
        ) : null}
      </div>

      <div className="db-row db-row-6-6">
        <Card>
          <PlotFigure
            title="Both real steps are as small as steps at dates when nothing changed"
            subtitle={(
              <>
                Step of the harmonized record from one year to the next, %, at the seam and at {nPlacebo} dates with no satellite change.
                <Keys items={[
                  { label: 'Real seam', colour: 'var(--accent)', shape: 'dot' },
                  { label: 'Date with no change', colour: 'var(--text-2)', shape: 'dot' },
                  { label: 'Normal spread (one standard deviation)', colour: 'var(--band)', shape: 'band' },
                ]} />
              </>
            )}
            source="Source: Fire Harmony validation (fireharmony/validate.py)."
            height={270}
            deps={[d]}
            build={(width) => {
              const p = palette();
              return {
                height: 270, marginLeft: 20, marginRight: 20, marginTop: 6, marginBottom: 30,
                fy: { domain: tests.map((tt) => tt.label), axis: null, padding: 0.12 },
                x: { domain: [-lim, lim], ticks: width < 420 ? [-lim, 0, lim] : [-lim, -lim / 2, 0, lim / 2, lim], tickSize: 0, label: null,
                  tickFormat: (v: number) => (v === 0 ? '0' : pct(v, 0, true)) },
                color: { domain: ['placebo', 'real'], range: [p.ink2, p.accent] },
                r: { type: 'identity' },
                marks: [
                  Plot.barX(placeboBands, { x1: 'lo', x2: 'hi', fy: 'test', fill: p.band, insetTop: 32, insetBottom: 26, r: 4 }),
                  Plot.ruleX([0], { stroke: p.baseline, insetTop: 28, insetBottom: 22 }),
                  Plot.dot(dots, Plot.dodgeY({ anchor: 'middle', padding: 1.5 }, {
                    x: 'step', fy: 'test', r: (x: (typeof dots)[number]) => (x.kind === 'real' ? 7 : 4.5), fill: 'kind',
                    stroke: p.surface, strokeWidth: 2, tip: tipLook(p),
                    title: (x: (typeof dots)[number]) => `${x.kind === 'real' ? `The real seam, ${x.yr}` : `No change, ${x.yr}`}\nStep ${pct(x.step, 2, true)}`,
                  })),
                  Plot.text(tests, { fy: 'label', frameAnchor: 'top-left', text: width < 460 ? 'short' : 'label', fill: p.ink, fontWeight: 600, dy: 2 }),
                  Plot.text(tests, { fy: 'label', frameAnchor: 'top-right', text: (tt: (typeof tests)[number]) => `${width < 460 ? '' : 'Real step '}${pct(tt.real, 2, true)}`, dy: 2, fill: p.accentText, fontWeight: 600 }),
                ],
              };
            }}
            table={{
              columns: ['Seam', 'Date', 'Step', 'What changed'],
              rows: dots.map((x) => [x.test, String(x.yr), pct(x.step, 2, true), x.kind === 'real' ? 'A satellite joined' : 'Nothing']),
            }}
          />
          <p className="db-card-note">Joined naively, the {seamYear} step is {pct(naive12, 0, true)}, far off this scale.</p>
        </Card>
        {ba && ratio.length ? (
          <Card>
            <PlotFigure
              title={`Hotspots per km² burned stay level across the ${seamYear} seam`}
              subtitle={`World harmonized hotspots for every km² of burned area mapped by ESA (Fire_cci), ${ratio[0].yr} to ${ratio[ratio.length - 1].yr}. Burned area is a different measurement, and its maps do not change with the switch to VIIRS, so it is a second witness at the ${seamYear} seam.`}
              source="Source: Fire Harmony; ESA Climate Change Initiative, Fire_cci burned area."
              height={270}
              deps={[d]}
              build={(width) => {
                const p = palette();
                const lo = Math.floor(rMin * 4) / 4 - 0.25, hi = Math.ceil(rMax * 4) / 4 + 0.25;
                return {
                  height: 270, marginLeft: 38, marginRight: 14, marginTop: 26, marginBottom: 30,
                  x: { domain: [ratio[0].yr - 0.5, ratio[ratio.length - 1].yr + 0.5], tickFormat: 'd', tickSize: 0, label: null,
                    ticks: width < 420 ? [2004, 2010, 2016] : [2004, 2006, 2008, 2010, 2012, 2014, 2016, 2018] },
                  y: { domain: [lo, hi], ticks: 5, tickFormat: (v: number) => dec(v, 2), tickSize: 0, label: null },
                  marks: [
                    hgrid(p, { ticks: 5 }),
                    Plot.ruleX([seamYear - 0.5], { stroke: p.baseline, strokeWidth: 1, insetTop: -16 }),
                    Plot.text([seamYear - 0.5], { x: (v: number) => v, frameAnchor: 'top', text: () => 'VIIRS joins', dy: -22, dx: 5, textAnchor: 'start', fill: p.ink2, lineAnchor: 'top' }),
                    Plot.lineY(ratio, { x: 'yr', y: 'v', stroke: p.harmonized, strokeWidth: 2.6, strokeLinejoin: 'round', strokeLinecap: 'round' }),
                    Plot.dot(ratio, { x: 'yr', y: 'v', r: 3.2, fill: p.harmonized, stroke: p.surface, strokeWidth: 1.5 }),
                    Plot.ruleX(ratio, Plot.pointerX({ x: 'yr', stroke: p.baseline, strokeWidth: 1 })),
                    Plot.tip(ratio, Plot.pointerX({ x: 'yr', y: 'v', ...tipLook(p),
                      title: (r: { yr: number; v: number }) => `${r.yr}\n${dec(r.v, 2)} hotspots per km² burned` })),
                  ],
                };
              }}
              table={{ columns: ['Year', 'Hotspots per km² burned'], rows: ratio.map((r) => [String(r.yr), dec(r.v, 3)]) }}
            />
          </Card>
        ) : null}
      </div>

      <Callout title="A second test: a search for sudden breaks">
        <p className="db-callout-p">
          A search for sudden breaks in the monthly world series finds {naiveBreaks.length
            ? `${naiveBreaks.length === 1 ? 'one' : naiveBreaks.length === 2 ? 'two' : int(naiveBreaks.length)} within 12 months of a seam in the naive join (${andList(naiveBreaks.map(isoMonth))})`
            : 'none near a seam in the naive join'}
          {harmBreaks.length ? `, and ${int(harmBreaks.length)} in the harmonized record (${andList(harmBreaks.map(isoMonth))}).` : ', and none in the harmonized record.'}
        </p>
      </Callout>
    </DbSection>
  );
}
