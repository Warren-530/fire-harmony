// 11. Haze from fires upwind: how well the fires explain PM2.5 in the haze link's cities, where the smoke comes from (Sumatra or
// Borneo), and the smoke of August to October in 2015, 2019 and 2026.
import * as Plot from '@observablehq/plot';
import type { DashboardData } from '../../lib/dashboard-types';
import { Card, PlotFigure, StatTile, cssVar } from '../ui';
import { DbSection } from './DbSection';
import { IconWind } from '../icons';
import { palette, tipLook } from './chart';
import { dec, monthName, share } from './format';
import { Keys, Meter } from './parts';

type City = NonNullable<DashboardData['haze']>['cities'][number];
const SOURCE = 'Source: Fire Harmony haze link (fireharmony/haze.py), with NASA MERRA-2 PM2.5 (bias corrected) and harmonized hotspots.';
const UG = 'µg/m³';
const YEARS = [2015, 2019, 2026] as const;
type SmokeYear = (typeof YEARS)[number];

const smoke = (c: City, y: SmokeYear): number | null => (y === 2015 ? c.smoke_2015 : y === 2019 ? c.smoke_2019 : c.smoke_2026);
/** "eight cities", "28 cities": the number of cities of the haze link (haze_cities.py adds the region's other cities). */
const cityCount = (n: number): string => (n === 8 ? 'eight' : String(n));
/** A share of the smoke for people: the model's split is not exact enough for "100%". */
const shareWords = (v: number): string => (v >= 0.95 ? 'nearly all' : v <= 0.05 ? 'very little' : share(v));

export function HazeSummary({ d }: { d: DashboardData }) {
  const hz = d.haze;
  if (!hz) return null;
  const cities = [...hz.cities].sort((a, b) => b.share_sumatra - a.share_sumatra || b.r2_cv - a.r2_cv);
  const names = cities.map((c) => c.name);
  const r2 = cities.map((c) => c.r2_cv);
  const kl = hz.cities.find((c) => c.name === 'Kuala Lumpur') ?? hz.cities[0];
  // one segmented bar per city: Sumatra first, then Borneo (parts at zero draw nothing)
  const shares = cities.flatMap((c) => [
    { city: c.name, src: 'Sumatra', v: c.share_sumatra, x1: 0, x2: c.share_sumatra },
    { city: c.name, src: 'Borneo', v: c.share_borneo, x1: c.share_sumatra, x2: c.share_sumatra + c.share_borneo },
  ]).filter((r) => r.v > 0);
  const dots = cities.flatMap((c) => YEARS.flatMap((y) => {
    const v = smoke(c, y);
    return v === null ? [] : [{ city: c.name, yr: y, v }];
  }));
  // the city where 2026 came closest to 2015
  const close = cities.filter((c) => c.smoke_2026 !== null && c.smoke_2015 !== null && c.smoke_2015 > 0)
    .sort((a, b) => (b.smoke_2026 as number) / (b.smoke_2015 as number) - (a.smoke_2026 as number) / (a.smoke_2015 as number))[0];
  const same = cities.filter((a) => cities.some((b) => b !== a && b.r2_cv === a.r2_cv && b.share_sumatra === a.share_sumatra && b.smoke_2015 === a.smoke_2015));
  const [m1, m2] = hz.season_months;

  return (
    <DbSection id="db-haze" title="Haze from fires upwind"
      subtitle={`How much of the fine particle pollution (PM2.5) in ${cityCount(cities.length)} cities is smoke from fires in Sumatra and in Borneo, in the fire season (${monthName(m1)} to ${monthName(m2)}).`}>
      <div className="db-row db-row-3">
        <StatTile label="Year to year changes explained, with the month of year" value={`${share(Math.min(...r2))} to ${share(Math.max(...r2))}`}
          context={`of the ups and downs of fire season PM2.5 in the ${cityCount(cities.length)} cities, on years the model never saw. The month of year is part of the model, so this is not the fires alone.`} />
        {kl ? (
          <StatTile label={`${kl.name}: smoke from Sumatra`} value={share(kl.share_sumatra)}
            context={<>of its smoke from fires, in the fire seasons of 2002 to 2025. The rest, {share(kl.share_borneo)}, comes from Borneo.
              <Meter value={kl.share_sumatra} colour="--fh-sumatra" label={`${share(kl.share_sumatra)} from Sumatra`} /></>} />
        ) : null}
        {close && close.smoke_2026 !== null && close.smoke_2015 !== null ? (
          <StatTile label={`${close.name}: smoke in 2026`} value={dec(close.smoke_2026, 1)} unit={UG}
            context={`August to October mean, close to 2015 (${dec(close.smoke_2015, 1)}). ${kl && kl !== close && kl.smoke_2026 !== null && kl.smoke_2015 !== null
              ? `${kl.name} stayed well below 2015: ${dec(kl.smoke_2026, 1)} against ${dec(kl.smoke_2015, 1)}.` : ''}`} />
        ) : null}
      </div>

      <div className="db-row db-row-6-6">
        <Card>
          <PlotFigure
            title="Smoke on the Malay Peninsula comes mostly from Sumatra; in Borneo, from Borneo"
            subtitle={(
              <>
                Share of each city’s smoke from fires, by where the fires burned, fire seasons 2002 to 2025.
                <Keys items={[
                  { label: 'Sumatra', colour: 'var(--fh-sumatra)', shape: 'box' },
                  { label: 'Borneo', colour: 'var(--fh-borneo)', shape: 'box' },
                ]} />
              </>
            )}
            source={SOURCE}
            height={names.length * 38 + 34}
            deps={[d]}
            build={(width) => {
              const p = palette();
              const ml = width < 420 ? 96 : 108, mr = 18;
              const fits = (r: (typeof shares)[number]) => r.v * (width - ml - mr) >= Math.max(38, shareWords(r.v).length * 6.5 + 12);
              const mid = (r: (typeof shares)[number]) => (r.x1 + r.x2) / 2;
              return {
                height: names.length * 38 + 34, marginLeft: ml, marginRight: mr, marginTop: 4, marginBottom: 28,
                x: { domain: [0, 1], ticks: [0, 0.5, 1], tickFormat: (v: number) => share(v), tickSize: 0, label: null },
                y: { domain: names, label: null, tickSize: 0, padding: 0.36 },
                color: { domain: ['Sumatra', 'Borneo'], range: [p.sumatra, p.borneo] },
                marks: [
                  Plot.barX(shares, { x1: 'x1', x2: 'x2', y: 'city', fill: 'src', insetLeft: 1, insetRight: 1, r: 3 }),
                  Plot.text(shares.filter(fits), { x: mid, y: 'city', text: (r: (typeof shares)[number]) => shareWords(r.v),
                    fill: cssVar('--fh-on-region', '#0d1118'), fontSize: 11, fontWeight: 600 }),
                  Plot.tip(shares, Plot.pointer({ x: mid, y: 'city', ...tipLook(p),
                    title: (r: (typeof shares)[number]) => `${r.city}\nFrom ${r.src}: ${shareWords(r.v)} of the smoke` })),
                ],
              };
            }}
            table={{
              columns: ['City', 'From Sumatra', 'From Borneo', 'Changes explained, with the month of year', 'Fire season PM2.5, µg/m³'],
              rows: cities.map((c) => [c.name, shareWords(c.share_sumatra), shareWords(c.share_borneo), share(c.r2_cv), dec(c.pm25_mean, 1)]),
            }}
          />
        </Card>
        <Card>
          <PlotFigure
            title={close ? `In 2026, smoke in ${close.name} came close to 2015` : 'Smoke from fires in three fire seasons'}
            subtitle={(
              <>
                Smoke from fires, mean of August to October, {UG}.
                <Keys items={[
                  { label: '2015', colour: 'var(--text)', shape: 'dot' },
                  { label: '2019', colour: 'var(--text-2)', shape: 'dot', opacity: 0.7 },
                  { label: '2026', colour: 'var(--accent)', shape: 'dot' },
                ]} />
              </>
            )}
            source={SOURCE}
            height={names.length * 38 + 34}
            deps={[d]}
            build={(width) => {
              const p = palette();
              const xMax = Math.ceil(Math.max(...dots.map((x) => x.v)) / 5) * 5;
              return {
                height: names.length * 38 + 34, marginLeft: width < 420 ? 96 : 108, marginRight: 16, marginTop: 4, marginBottom: 28,
                x: { domain: [0, xMax], ticks: 5, tickSize: 0, label: null },
                y: { domain: names, label: null, tickSize: 0, padding: 0.36 },
                color: { domain: [...YEARS], range: [p.ink, p.ink2, p.accent] },
                marks: [
                  Plot.gridX({ stroke: p.grid, strokeOpacity: 1 }),
                  Plot.ruleX([0], { stroke: p.baseline }),
                  Plot.ruleY(cities, { y: 'name', x1: (c: City) => Math.min(...YEARS.map((y) => smoke(c, y) ?? Infinity)),
                    x2: (c: City) => Math.max(...YEARS.map((y) => smoke(c, y) ?? -Infinity)), stroke: p.border, strokeWidth: 2 }),
                  Plot.dot(dots, { x: 'v', y: 'city', fill: 'yr', fillOpacity: (x: (typeof dots)[number]) => (x.yr === 2019 ? 0.7 : 1), r: 5.5, stroke: p.surface, strokeWidth: 2 }),
                  Plot.tip(dots, Plot.pointer({ x: 'v', y: 'city', ...tipLook(p),
                    title: (x: (typeof dots)[number]) => `${x.city}, ${x.yr}\n${dec(x.v, 1)} ${UG} of smoke from fires` })),
                ],
              };
            }}
            table={{
              columns: ['City', ...YEARS.map((y) => `${y}, ${UG}`)],
              rows: cities.map((c) => [c.name, ...YEARS.map((y) => { const v = smoke(c, y); return v === null ? '–' : dec(v, 1); })]),
            }}
          />
        </Card>
      </div>
      <div className="db-haze-foot">
        <p className="db-card-note">
          {same.length >= 2 ? `${same.map((c) => c.name).join(' and ')} share one grid cell of the PM2.5 data, so their numbers are the same. ` : ''}
          A share is the smoke the model gives each region over the fire seasons, out of all the smoke from fires. Monthly means hide the worst days: the Haze page counts the days above the WHO 24 hour guideline of {dec(hz.who_daily_guideline, 0)} {UG}.
        </p>
        <a className="ui-btn" href="#/haze"><IconWind size={16} />Open the Haze page</a>
      </div>
    </DbSection>
  );
}
