// Why was this month unusual? The month's fire against normal, next to its drivers: the rain of the last 3 months,
// the heat, El Niño and the fire weather; then what the drivers together point to, and how far to trust that here.
// A driver that is not out yet for the month shown (the newest months wait for the heat, El Niño and the fire weather)
// gives its latest value with its own month instead, never "no data yet"; a driver this place has no value of at all
// is folded into one line. A chip moves the map to the latest month that has every driver.
import { useMemo } from 'react';
import type { AreaDrivers } from '../lib/data';
import { formatMonth, formatNumber, useI18n, type Lang } from '../lib/i18n';
import { comparedWithNormal } from '../lib/stats';
import type { DriverMonth } from '../lib/types';
import { Callout, Card, Note, Skeleton } from './ui';

const pct = (v: number, lang: Lang) => `${formatNumber(Math.abs(v), lang, 0)}%`;

export interface DriversPanelProps {
  named: boolean;                              // drivers exist for named places only
  data: AreaDrivers | null | 'error';          // null while loading
  month: { yr: number; mo: number } | null;
  monthLabel: string;
  busy?: boolean;                              // a newer area is loading: nothing of the old one is shown
  onShowMonth?: (m: { yr: number; mo: number }) => void;   // the chip: show the latest month with every driver
}

type DriverKey = 'rain3_pct' | 't2m_anom' | 'oni' | 'fwi_ratio';
const DRIVERS: readonly DriverKey[] = ['rain3_pct', 't2m_anom', 'oni', 'fwi_ratio'];

export function DriversPanel({ named, data, month, monthLabel, busy, onShowMonth }: DriversPanelProps) {
  const { t, lang } = useI18n();
  const d = t.drivers;
  const months = data && data !== 'error' ? data.months : null;
  // the latest month of each driver, and the latest month with every driver and the fire
  const latest = useMemo(() => {
    const out: Partial<Record<DriverKey, DriverMonth>> = {};
    let all: DriverMonth | null = null;
    if (!months) return { out, all };
    for (let i = months.length - 1; i >= 0; i--) {
      const x = months[i];
      for (const k of DRIVERS) if (!out[k] && x[k] !== null) out[k] = x;
      if (!all && x.ratio !== null && DRIVERS.every((k) => x[k] !== null)) all = x;
      if (all && DRIVERS.every((k) => out[k])) break;
    }
    return { out, all };
  }, [months]);

  if (!named) {
    return <Card title={d.drawnTitle}><Note>{d.drawnArea}</Note></Card>;
  }
  // a newer area loads: nothing of the old one is worded under the new name
  if (busy) {
    return <div className="fh-ex-wait" aria-busy="true"><Skeleton height={22} /><Skeleton height={180} /></div>;
  }
  if (data === 'error') {
    return <Card title={d.title(monthLabel)}><p className="fh-ex-error" role="alert">{d.error}</p></Card>;
  }
  if (!data) {
    return <Card title={d.title(monthLabel)} subtitle={d.subtitle}><Skeleton height={220} /></Card>;
  }
  if (!data.model) {
    return <Card title={d.title(monthLabel)}><Note>{d.noModel}</Note></Card>;
  }
  const m: DriverMonth | undefined = month ? data.months.find((x) => x.yr === month.yr && x.mo === month.mo) : undefined;
  const model = data.model;
  const title = !m || m.ratio === null ? d.title(monthLabel)
    : m.ratio >= 1.5 ? d.title(monthLabel) : m.ratio <= 1 / 1.5 ? d.titleQuiet(monthLabel) : d.titleNormal(monthLabel);
  const ensoText = (oni: number) => {
    const s = d.ensoState;
    const state = oni >= 1.5 ? s.strongNino : oni >= 0.5 ? s.nino : oni <= -1.5 ? s.strongNina : oni <= -0.5 ? s.nina : s.neutral;
    return `${oni > 0 ? '+' : oni < 0 ? '−' : ''}${formatNumber(Math.abs(oni), lang, 1)} (${state})`;
  };
  const short = (yr: number, mo: number) => `${t.common.monthsShort[mo - 1]} ${yr}`;
  /** The months of a driver's value: ONI is the season of three months centred on its month ("Jul to Sep 2026"). */
  const whenOf = (k: DriverKey, x: DriverMonth) => {
    if (k !== 'oni') return short(x.yr, x.mo);
    const a = x.mo === 1 ? { yr: x.yr - 1, mo: 12 } : { yr: x.yr, mo: x.mo - 1 };
    const b = x.mo === 12 ? { yr: x.yr + 1, mo: 1 } : { yr: x.yr, mo: x.mo + 1 };
    return a.yr === b.yr ? `${t.common.monthsShort[a.mo - 1]} to ${short(b.yr, b.mo)}` : `${short(a.yr, a.mo)} to ${short(b.yr, b.mo)}`;
  };
  const valueOf = (k: DriverKey, x: DriverMonth): string => {
    switch (k) {
      case 'rain3_pct': {
        const v = x.rain3_pct as number;
        return Math.abs(v) < 5 ? d.aboutNormal : v < 0 ? d.pctBelow(pct(v, lang)) : d.pctAbove(pct(v, lang));
      }
      case 't2m_anom': {
        const v = x.t2m_anom as number;
        return v >= 0 ? d.warmer(formatNumber(v, lang, 1)) : d.cooler(formatNumber(-v, lang, 1));
      }
      case 'oni': return ensoText(x.oni as number);
      default: return comparedWithNormal(x.fwi_ratio as number);
    }
  };
  const labelOf: Record<DriverKey, string> = { rain3_pct: d.rain, t2m_anom: d.heat, oni: d.enso, fwi_ratio: d.fireWeather };
  const nameOf: Record<DriverKey, string> = {
    rain3_pct: d.shortNames.rain, t2m_anom: d.shortNames.heat, oni: d.shortNames.enso, fwi_ratio: d.shortNames.fireWeather,
  };
  const rows: { key: string; label: string; value: string; latest?: boolean }[] = [];
  const missing: string[] = [];
  if (m) {
    if (m.ratio !== null) rows.push({ key: 'fire', label: d.fire, value: comparedWithNormal(m.ratio) });
    else missing.push(d.shortNames.fire);
    for (const k of DRIVERS) {
      if (m[k] !== null) { rows.push({ key: k, label: labelOf[k], value: valueOf(k, m) }); continue; }
      const last = latest.out[k];
      if (last) rows.push({ key: k, label: d.latestOf(labelOf[k], whenOf(k, last)), value: valueOf(k, last), latest: true });
      else missing.push(nameOf[k]);
    }
  }
  const points: string[] = [];
  if (m) {
    if (!m.in_season) points.push(d.offSeason);
    if (m.in_season && m.f_rain !== null) points.push(m.f_rain > 10 ? d.rainPointsHigh : d.pointsTo.rain(comparedWithNormal(m.f_rain)));
    if (m.in_season && model.uses_heat && m.heat_known && m.f_drivers !== null) {
      points.push(m.f_drivers > 10 ? d.bothPointHigh : d.pointsTo.both(comparedWithNormal(m.f_drivers)));
    }
    if (m.ratio !== null) points.push(d.pointsTo.actual(comparedWithNormal(m.ratio)));
  }
  // the latest month with every driver, when the month shown lacks some
  const all = latest.all;
  const showAll = m && all && (missing.length > 0 || rows.some((r) => r.latest)) && !(all.yr === m.yr && all.mo === m.mo) ? all : null;
  const skillPct = `${formatNumber(Math.max(0, model.r2_cv) * 100, lang, 0)}%`;
  const ensoLine = model.enso_r !== null && model.enso_lag !== null && Math.abs(model.enso_r) >= 0.3
    ? (model.enso_r < 0 ? d.ensoDry(model.enso_lag) : d.ensoWet(model.enso_lag)) : null;
  return (
    <Card title={title} subtitle={d.subtitle}>
      <div className="fh-ex-drivers">
        {m ? (
          <>
            <dl className="fh-ex-dl">
              {rows.map((r) => (
                <div key={r.key} data-driver={r.key} data-latest={r.latest ? '' : undefined}>
                  <dt>{r.label}</dt><dd>{r.value}</dd>
                </div>
              ))}
            </dl>
            {missing.length ? <Note>{d.notOut(missing, monthLabel)}</Note> : null}
            {showAll && onShowMonth ? (
              <button type="button" className="ui-chip fh-ex-drivers-chip" onClick={() => onShowMonth({ yr: showAll.yr, mo: showAll.mo })}>
                {d.showLatest(formatMonth(showAll.yr, showAll.mo, lang))}
              </button>
            ) : null}
            {points.length ? <Callout title={d.pointsTitle}>{points.join(' ')}</Callout> : null}
          </>
        ) : <Note>{d.noMonth(monthLabel)}</Note>}
        <Note>{model.r2_cv >= 0.1 ? d.skill(skillPct) : d.lowSkill}</Note>
        {ensoLine ? <Note>{ensoLine}</Note> : null}
        {!model.uses_heat ? <Note>{d.heatNotDriver}</Note> : null}
        {/* (the end of the fire weather data for the whole world: a place's own last value can be older, where its
            normal is zero in the latest months, so it is not read from this place's file) */}
        <Note>{d.fwiNote}</Note>
      </div>
    </Card>
  );
}
