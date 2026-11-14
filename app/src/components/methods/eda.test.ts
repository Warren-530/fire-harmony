// The Methods sections drawn from web/eda.json must say what the report says. Each number set in the number font
// (<N>, class fh-doc-n) in "A first look at the raw record" and "How we test trends" is rendered from the published
// files and looked up in report/report.qmd. The formatters are checked on their own too.
// Needs the published data (FIRE_DATA_DIR or ~/nasa_work/data/products/v1.0) and the report; skipped without them.
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { bhAdjust, clock, fix, frpShares, pText, round, signed, type Eda } from './eda';
import { RawRecordSection } from './RawRecord';
import { TrendsSection, placeCells, placeList } from './Trends';
import type { DashboardData } from '../../lib/dashboard-types';

const DATA = process.env.FIRE_DATA_DIR ?? path.join(os.homedir(), 'nasa_work/data/products/v1.0');
const REPORT = path.resolve(__dirname, '../../../../report/report.qmd');
const have = existsSync(path.join(DATA, 'web/eda.json')) && existsSync(path.join(DATA, 'dashboard.json')) && existsSync(REPORT);

describe('eda formatters', () => {
  it('round half up on the published digits', () => {
    expect(fix(6.85, 1)).toBe('6.9');
    expect(fix(1.53, 1)).toBe('1.5');
    expect(fix(44.5, 0)).toBe('45');
    expect(fix(-6.29, 1)).toBe('−6.3');
    expect(fix(2272, 0)).toBe('2,272');
    expect(signed(109.35, 1)).toBe('+109.4');
    expect(round(0.555, 2)).toBe(0.56);
  });
  it('local solar time to the nearest minute', () => {
    expect(clock(10.648)).toBe('10:39');
    expect(clock(22.391)).toBe('22:23');
    expect(clock(1.653)).toBe('01:39');
    expect(clock(15.399)).toBe('15:24');
  });
  it('p values as the report writes them', () => {
    expect(pText(4e-5)).toBe('below 0.0001');
    expect(pText(0.00098)).toBe('0.0010');
    expect(pText(0.0108)).toBe('0.011');
    expect(pText(0.010047)).toBe('0.010');   // the trailing zero stays, as in the report
    expect(pText(0.02349)).toBe('0.023');
    expect(pText(0.46906)).toBe('0.469');
  });
  it('Benjamini and Hochberg', () => {
    const q = bhAdjust([0.01, 0.04, 0.03, 0.2]);
    expect(q.map((v) => Number(v.toFixed(4)))).toEqual([0.04, 0.0533, 0.0533, 0.2]);
  });
});

describe.skipIf(!have)('the Methods numbers match eda.json and the report', () => {
  const eda = have ? (JSON.parse(readFileSync(path.join(DATA, 'web/eda.json'), 'utf8')) as Eda) : null;
  const dash = have ? (JSON.parse(readFileSync(path.join(DATA, 'dashboard.json'), 'utf8')) as DashboardData) : null;
  // the report's text without markdown emphasis, thin spaces as spaces
  const report = have ? readFileSync(REPORT, 'utf8').replace(/\*\*/g, '').replace(/[  ]/g, ' ') : '';
  // the rows of a report table (by its label), each as its cells
  const tableRows = (label: string): string[][] => {
    const lines = report.split('\n');
    const at = lines.findIndex((l) => l.includes(`{#${label} `) || l.includes(`{#${label}}`));
    const out: string[][] = [];
    for (let i = at - 1; i >= 0; i--) {
      const l = lines[i].trim();
      if (!l && !out.length) continue;
      if (!l.startsWith('|')) break;
      out.unshift(l.slice(1, -1).split('|').map((c) => c.trim()));
    }
    return out.slice(2);   // without the header and the alignment row
  };
  const numbersOf = (html: string) => [...html.matchAll(/<strong class="fh-doc-n">(.*?)<\/strong>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[‑]/g, '-').trim());

  it('each curve of the FRP histogram sums to 100%', () => {
    const pts = frpShares(eda as Eda);
    for (const id of ['terra', 'aqua', 'snpp'] as const) {
      for (const part of ['day', 'night'] as const) {
        const sum = pts.filter((p) => p.sensor === id && p.part === part).reduce((a, p) => a + p.share, 0);
        expect(sum).toBeCloseTo(100, 6);
      }
    }
  });

  it('BH over the 129 countries gives the published counts', () => {
    const hv = (eda as Eda).sensitivity.harmonized_vs_modis;
    const q = bhAdjust(hv.rows.map((r) => r.h_p));
    expect(q.filter((v) => v <= 0.05).length).toBe(hv.h_significant);
  });

  for (const [kind, label] of [['countries', 'tbl-places-countries'], ['states', 'tbl-places-states']] as const) {
    it(`the ${kind} table equals ${label} cell for cell`, () => {
      const want = tableRows(label);
      const list = placeList(eda as Eda, kind);
      expect(want.length).toBe(list.length);
      expect(list.map(placeCells)).toEqual(want.map((r) => r.slice(1)));
    });
  }

  for (const [name, el] of [
    ['A first look at the raw record', () => createElement(RawRecordSection, { e: eda as Eda, d: dash as DashboardData })],
    ['How we test trends', () => createElement(TrendsSection, { e: eda as Eda, d: dash as DashboardData })],
  ] as const) {
    it(`${name}: every number is in the report`, () => {
      const html = renderToStaticMarkup(el());
      const nums = numbersOf(html);
      expect(nums.length).toBeGreaterThan(30);
      // a whole number in the report: "6.1" does not match inside "16.1" or "6.15"
      const inReport = (n: string) => new RegExp(`(?<![\\d.,])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d|[.,]\\d)`).test(report);
      const missing = nums.filter((n) => !inReport(n));
      expect(missing).toEqual([]);
    });
  }
});
