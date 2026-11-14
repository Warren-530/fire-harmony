// 6. How good the model is: the error of the simple exchange rate and of gradient boosting at every scale, how often
// the 90% range held, the bias, the bridges between satellites, and what the model leans on.
import * as Plot from '@observablehq/plot';
import type { DashboardData } from '../../lib/dashboard-types';
import { Card, PlotFigure, StatTile } from '../ui';
import { DbSection } from './DbSection';
import { importanceMarks, palette, tipLook, vgrid } from './chart';
import { dec, modelInput, pct, scaleName, share } from './format';
import { keepNames, Keys } from './parts';

const SOURCE = 'Source: Fire Harmony cross validation on held out years and regions (fireharmony/harmonize.py).';
const METHODS = ['Exchange rate', 'Gradient boosting'] as const;
type Method = (typeof METHODS)[number];

/** On narrow charts, break "Large region, one month" after the comma, so each line reads as a whole. */
const twoLines = (s: string): string => s.replace(', ', ',\n');

export function Model({ d }: { d: DashboardData }) {
  const m = d.models;
  // not one hexagon in one month: most such months have no fire, so its median error says little about the fires
  const cv = m.cv.filter((r) => r.scale !== 'cell x month');
  const rows = cv.flatMap((r) => [
    { scale: scaleName(r.scale), method: 'Exchange rate' as Method, err: r.ratio_err, ccc: r.ratio_ccc },
    { scale: scaleName(r.scale), method: 'Gradient boosting' as Method, err: r.gbm_err, ccc: r.gbm_ccc },
  ]);
  const scales = cv.map((r) => scaleName(r.scale));
  const local = cv.filter((r) => /region/.test(r.scale));
  const winsLocal = local.length > 0 && local.every((r) => r.gbm_err < r.ratio_err);
  const best = local.reduce<(typeof local)[number] | null>((b, r) => (!b || r.ratio_err / Math.max(r.gbm_err, 0.1) > b.ratio_err / Math.max(b.gbm_err, 0.1) ? r : b), null);
  const errTitle = winsLocal ? 'Gradient boosting cuts the error for regions' : 'The error of the two models at every scale';

  const cov = m.coverage.flatMap((c) => [
    ...(c.terra_aqua !== null ? [{ scale: scaleName(c.scale), years: 'Terra and Aqua years', v: c.terra_aqua }] : []),
    ...(c.terra_only !== null ? [{ scale: scaleName(c.scale), years: 'Terra only years', v: c.terra_only }] : []),
  ]);
  const covLo = Math.min(...cov.map((c) => c.v)), covHi = Math.max(...cov.map((c) => c.v));
  const covScales = m.coverage.map((c) => scaleName(c.scale));
  const imp = m.importance.map((f) => ({ name: modelInput(f.feature), pct: f.pct }));
  const b = m.bridges;

  return (
    <DbSection id="db-model" title="How good the model is"
      subtitle="Before 2012 only MODIS flew, so a model predicts what VIIRS would have seen. We tested it on years and regions it never saw while it learned.">
      <div className="db-row db-row-7-5 db-keep">
        <Card>
          <PlotFigure
            title={errTitle}
            subtitle={(
              <>
                Median error on held out data, %. Lower is better. One hexagon in one month is left out: most such months have no fire.
                {best ? ` For ${scaleName(best.scale).toLowerCase().replace(', ', ' in ')}, it falls from ${pct(best.ratio_err, 1)} to ${pct(best.gbm_err, 1)}.` : ''}
                <Keys items={[
                  { label: 'Exchange rate (one ratio per region)', colour: 'var(--text-2)', shape: 'box', opacity: 0.55 },
                  { label: 'Gradient boosting', colour: 'var(--accent)', shape: 'box' },
                ]} />
              </>
            )}
            source={SOURCE}
            height={scales.length * 50 + 24}
            deps={[d]}
            build={(width) => {
              const p = palette();
              const narrow = width < 520;
              return {
                height: scales.length * 50 + 24, marginLeft: narrow ? 112 : 168, marginRight: 46, marginTop: 4, marginBottom: 20,
                fy: { domain: scales, label: null, padding: 0.16, axis: null },
                y: { domain: [...METHODS], axis: null, padding: 0.12 },
                x: { domain: [0, Math.max(...rows.map((r) => r.err)) * 1.02], axis: null },
                color: { domain: [...METHODS], range: [p.ink2, p.accent] },
                marks: [
                  Plot.axisFy({ anchor: 'left', label: null, tickSize: 0, lineWidth: narrow ? 9 : 16, tickFormat: narrow ? twoLines : undefined, fill: p.ink, fontSize: 12, textAnchor: 'end' }),
                  Plot.barX(rows, { x: 'err', y: 'method', fy: 'scale', fill: 'method', fillOpacity: (r: (typeof rows)[number]) => (r.method === 'Exchange rate' ? 0.55 : 1), rx2: 3 }),
                  Plot.ruleX([0], { stroke: p.baseline }),
                  Plot.text(rows, { x: 'err', y: 'method', fy: 'scale', text: (r: (typeof rows)[number]) => pct(r.err, 1),
                    dx: 5, textAnchor: 'start', fill: p.ink2, fontSize: 11 }),
                  Plot.tip(rows, Plot.pointerY({ x: 'err', y: 'method', fy: 'scale', ...tipLook(p),
                    title: (r: (typeof rows)[number]) => `${r.scale}\n${r.method}: median error ${pct(r.err, 1)}\nAgreement (CCC) ${dec(r.ccc, 3)}` })),
                ],
              };
            }}
            table={{
              columns: ['Area and period', 'Exchange rate, median error', 'Gradient boosting, median error', 'Exchange rate, agreement', 'Gradient boosting, agreement'],
              rows: cv.map((r) => [scaleName(r.scale), pct(r.ratio_err, 1), pct(r.gbm_err, 1), dec(r.ratio_ccc, 3), dec(r.gbm_ccc, 3)]),
            }}
          />
        </Card>
        <Card>
          <PlotFigure
            title={`The 90% range held ${share(covLo)} to ${share(covHi)} of the time, for monthly and yearly totals`}
            subtitle={(
              <>
                Share of held out totals, monthly and yearly, from one hexagon to the world, that fell inside their 90% range. It should be about 90%.
                <Keys items={[
                  { label: 'Terra and Aqua years', colour: 'var(--accent)', shape: 'dot' },
                  { label: 'Terra only years', colour: 'var(--text-2)', shape: 'dot', open: true },
                  { label: 'Target, 90%', colour: 'var(--text)', shape: 'line' },
                ]} />
              </>
            )}
            source="Terra only years are November 2000 to June 2002, before Aqua flew. A little above 90% means the ranges are honest and slightly cautious."
            height={scales.length * 50 + 24}
            deps={[d]}
            build={(width) => {
              const p = palette();
              const narrow = width < 400;
              const lo = Math.min(0.85, Math.floor(covLo * 20) / 20);
              return {
                height: scales.length * 50 + 24, marginLeft: narrow ? 112 : 150, marginRight: 18, marginTop: 4, marginBottom: 26,
                x: { domain: [lo, 1], ticks: [lo, 0.9, 0.95, 1].filter((v, i, a) => a.indexOf(v) === i), tickFormat: (v: number) => share(v), tickSize: 0, label: null },
                y: { domain: covScales, label: null, tickSize: 0, padding: 0.4 },
                marks: [
                  vgrid(p, { ticks: [lo, 0.95, 1] }),
                  Plot.axisY({ label: null, tickSize: 0, lineWidth: narrow ? 9 : 15, tickFormat: narrow ? twoLines : undefined, fill: p.ink, fontSize: 12 }),
                  Plot.ruleX([0.9], { stroke: p.ink, strokeWidth: 1.5 }),
                  Plot.ruleY(covScales, { y: (s: string) => s, x1: lo, x2: 1, stroke: p.grid }),
                  Plot.dot(cov.filter((c) => c.years === 'Terra only years'), { x: 'v', y: 'scale', r: 5, stroke: p.ink2, strokeWidth: 2, fill: p.surface }),
                  Plot.dot(cov.filter((c) => c.years !== 'Terra only years'), { x: 'v', y: 'scale', r: 5, fill: p.accent, stroke: p.surface, strokeWidth: 1.5 }),
                  Plot.tip(cov, Plot.pointer({ x: 'v', y: 'scale', ...tipLook(p),
                    title: (c: (typeof cov)[number]) => `${c.scale}, ${c.years.toLowerCase()}\n${share(c.v, 1)} inside the 90% range` })),
                ],
              };
            }}
            table={{
              columns: ['Area and period', 'Terra and Aqua years', 'Terra only years'],
              rows: m.coverage.map((c) => [scaleName(c.scale), c.terra_aqua === null ? '–' : share(c.terra_aqua, 1), c.terra_only === null ? '–' : share(c.terra_only, 1)]),
            }}
          />
        </Card>
      </div>

      <div className="db-row db-row-7-5">
        <Card>
          <PlotFigure
            title="The model leans most on how many small patches Terra saw burning"
            subtitle={`Share of the model’s learning gain from each input, %, top ${imp.length}. Every input comes from MODIS, so it exists before 2012 too.`}
            source="Source: Fire Harmony model (LightGBM gain importance)."
            height={imp.length * 33 + 8}
            deps={[d]}
            build={(width) => { const p = palette(); return importanceMarks(imp, p.modis, p, width); }}
            table={{ columns: ['Model input', 'Share of the gain'], rows: imp.map((f) => [f.name, pct(f.pct, 1)]) }}
          />
        </Card>
        <div className="db-tiles-2x2">
          <StatTile label="Bias of the model" value={pct(m.bias_pct.terra_aqua, 1, true)}
            context={`On held out data the model’s total is ${pct(Math.abs(m.bias_pct.terra_aqua), 1)} ${m.bias_pct.terra_aqua < 0 ? 'below' : 'above'} what VIIRS saw. From Terra alone: ${pct(m.bias_pct.terra_only, 1, true)}.`} />
          <StatTile label="Suomi NPP to NOAA-20" value={dec(b.snpp_to_noaa20, 3)} unit="times"
            context={keepNames(`Suomi NPP sees ${pct(Math.abs(100 / b.snpp_to_noaa20 - 100), 1)} ${b.snpp_to_noaa20 < 1 ? 'more' : 'fewer'} hotspots than NOAA-20 in the same places and months, so its counts are scaled ${b.snpp_to_noaa20 < 1 ? 'down' : 'up'}.`)} />
          <StatTile label="NOAA-21 to NOAA-20" value={dec(b.noaa21_to_noaa20, 3)} unit="times"
            context={keepNames(`NOAA-21 sees ${pct(Math.abs(100 - 100 / b.noaa21_to_noaa20), 1)} ${b.noaa21_to_noaa20 > 1 ? 'fewer' : 'more'} hotspots than NOAA-20, so its counts are scaled ${b.noaa21_to_noaa20 > 1 ? 'up' : 'down'}.`)} />
          <StatTile label="Terra only to Terra and Aqua" value={dec(b.terra_only_to_terra_aqua, 3)} unit="times"
            context={`Before Aqua flew, the Terra only model reads ${pct(Math.abs(100 - 100 / b.terra_only_to_terra_aqua), 1)} ${b.terra_only_to_terra_aqua > 1 ? 'low' : 'high'}, so it is bridged to the main model, region by region.`} />
        </div>
      </div>
    </DbSection>
  );
}
