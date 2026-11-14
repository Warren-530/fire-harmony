// The words of a trend verdict for the Explorer's strip and details (Kpis.tsx): the one word shared with the Dashboard,
// Rankings and the trend map, its arrow, and the notes on the test. Pure, so tested (explorer/verdict.test.ts); apart
// from Kpis.tsx so that module exports only components and keeps React Fast Refresh.
import { formatQ, TREND_FLOOR_PER_YEAR, TREND_TESTED_PER_YEAR, type FamilyTest, type TrendVerdict } from '../../lib/stats';
import { DICTS, formatCountWords, formatNumber, type Dict, type Lang } from '../../lib/i18n';
import type { DeltaDir } from '../ui';

/** A p value as the panel writes it ("= 0.02", "< 0.001"). */
const pText = (p: number | null) => (p === null ? '' : p < 0.001 ? '< 0.001' : `= ${p.toFixed(p < 0.01 ? 3 : 2)}`);
/** The trend in % per decade, signed, rounded as the brief and the chart title round it ("−6.3%", "+22%"). */
export function trendPercent(pct: number, lang: Lang): string {
  return new Intl.NumberFormat(DICTS[lang].locale, { style: 'percent', maximumFractionDigits: Math.abs(pct) < 9.95 ? 1 : 0, signDisplay: 'exceptZero' })
    .format(pct / 100).replace('-', '−');
}

/** The trend in words: the word of the pill (the one verdict, the same as on the Dashboard and in Rankings), its
 *  direction (an arrow only for a rise or a fall the rules support, flat for "not clear", none when no trend is read
 *  or the test is loading) and the notes. */
export function trendWords(v: TrendVerdict, t: Dict, lang: Lang, family: FamilyTest | null):
  { word: string; dir: DeltaDir | null; notes: string[]; caution: boolean } {
  const x = t.exPanel.trend;
  const tr = v.trend;
  const p = pText(tr.p);
  const kind = family ? x.kinds[family.kind] : '';
  const n = family ? formatNumber(family.of, lang) : '';
  switch (v.cls) {
    case 'pending': return { word: x.pending, dir: null, notes: [], caution: false };
    case 'none': return { word: x.none, dir: null, notes: [t.kpi.tooFew], caution: false };
    case 'little': {
      // (a mean the file rounds up to the floor, such as 99.96 written 100.0, is just under it; one that rounds to
      // nothing is almost none, never "about 0")
      const m = v.mean ?? 0;
      const shown = formatNumber(m, lang, m < 10 ? 1 : 0);
      const floor = formatNumber(TREND_FLOOR_PER_YEAR, lang);
      const here = m >= TREND_FLOOR_PER_YEAR || shown === floor ? x.justUnder(floor) : m < 0.05 ? x.almostNone : x.about(shown);
      return { word: x.little, dir: null, notes: [x.littleWhy(here)], caution: false };
    }
    case 'untested':
      return {
        word: x.untested, dir: null, caution: false,
        notes: [v.why === 'barren' ? x.barren : x.untestedWhy(formatNumber(TREND_TESTED_PER_YEAR, lang))],
      };
    case 'unclear': {
      // clear on its own test but not once all the places of its kind are tested together (Brazil), or not clear at all
      if (v.family === 'fails' && family) {
        return { word: x.flat, dir: 'flat', caution: false, notes: [x.ownClear(p), `${x.fails(n, kind)} (q ${formatQ(family.q ?? 1)}).`] };
      }
      return { word: x.flat, dir: 'flat', caution: false, notes: [`${t.kpi.trendWithin} ${t.kpi.trendTest(p)}.`] };
    }
    default: {
      const notes = [`${t.kpi.trendClear} ${t.kpi.trendTest(p)}.`];
      if (v.reading === 'caution') notes.push(x.caution(formatCountWords(v.mean ?? 0, lang)));
      if (v.family === 'holds' && family) notes.push(`${x.holds(n, kind)} (q ${formatQ(family.q ?? 0)}).`);
      return { word: v.cls === 'rising' ? x.rising : x.falling, dir: v.cls === 'rising' ? 'up' : 'down', notes, caution: v.reading === 'caution' };
    }
  }
}

/** The title of the yearly chart (SeriesChart.tsx), in the same voice as the card: it never states a rise or a fall the
 *  card's word does not give (a place not tested, a fall that is not clear among all the places of its kind). `pct` is
 *  the size of the change per decade as the title writes it ("22%"). */
export function chartTitle(v: TrendVerdict, name: string, pct: string, t: Dict, family: FamilyTest | null): string {
  const c = t.chart.title, x = t.exPanel.trend;
  const dir = v.trend.direction;
  switch (v.cls) {
    case 'pending': case 'none': case 'little': return c.few(name);
    case 'untested': return v.why === 'barren' ? x.chartBarren(name) : x.chartUntested(name);
    case 'unclear': {
      const kind = v.family === 'fails' && family ? x.kinds[family.kind] : null;
      if (kind && dir === 'increasing') return x.chartUpUnsure(name, pct, kind);
      if (kind && dir === 'decreasing') return x.chartDownUnsure(name, pct, kind);
      return c.flat(name);
    }
    default: {
      const up = v.cls === 'rising';
      if (v.reading === 'caution') return up ? x.chartUp(name, pct) : x.chartDown(name, pct);
      return up ? c.up(name, pct) : c.down(name, pct);
    }
  }
}
