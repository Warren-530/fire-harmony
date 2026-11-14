// The burning calendar of the place in view, under "At a glance": the Explorer's own calendar (components/Calendar.tsx,
// used as it is) on the same monthly series, so both show the same boxes. The scope's years are its rows, and a season
// (the months of each year) keeps only those months. A month opens the Explorer there; the PNG is the Explorer's
// picture of the calendar, and a link opens the full calendar.
import { useEffect, useMemo, useState } from 'react';
import { Calendar } from '../Calendar';
import { saveCalendarPicture } from '../Downloads';
import { calendarTitle } from '../explorer/months';
import { Card, Skeleton } from '../ui';
import { IconCalendar, IconDownload } from '../icons';
import { useToast } from '../Toast';
import { areaSeries } from '../../lib/data';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme';
import { onScale } from '../../lib/stats';
import { circleLink } from '../../lib/search';
import { openLink } from '../../lib/commands';
import type { MonthlyPoint } from '../../lib/types';
import { isWorld, seasonLabel, yearsLabel, type Scope, type ScopePlace } from './scope';
import type { ScopeData } from './useScope';
import '../../styles/explorer.css';

/** The Explorer link of the place in view ("area=state:IDN-1931", "area=circle:-2.2096,113.91,50"). */
export function scopeAreaParam(place: ScopePlace): string {
  if (place.type === 'circle') return circleLink(place.lat, place.lon, place.km).replace(/^#\/\?/, '');
  return place.kind === 'world' ? 'area=world:WORLD' : `area=${place.kind}:${encodeURIComponent(place.id)}`;
}

const inSeason = (mo: number, m: [number, number] | null): boolean =>
  m === null || (m[0] <= m[1] ? mo >= m[0] && mo <= m[1] : mo >= m[0] || mo <= m[1]);

/** The world's months for the published default scope (the page then loads no series of its own). */
function useWorldPoints(need: boolean): MonthlyPoint[] | null | 'failed' {
  const [p, setP] = useState<MonthlyPoint[] | null | 'failed'>(null);
  useEffect(() => {
    if (!need) return undefined;
    let live = true;
    const world = { type: 'named' as const, area: { kind: 'world' as const, id: 'WORLD', name: 'World', country_iso3: null, lat: 0, lon: 0, cells: 0, area_km2: 0 } };
    areaSeries(world).then((x) => { if (live) setP(x); }, () => { if (live) setP('failed'); });
    return () => { live = false; };
  }, [need]);
  return p;
}

export function CalendarCard({ scope, data, lastYear }: { scope: Scope; data: ScopeData; lastYear: number }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const world = isWorld(scope.place);
  const theme = useTheme();
  const of = world ? 'the world' : data.short;   // "Burning calendar of the world", "… of Riau"
  const own = useWorldPoints(world && data.points === null);
  const points = data.points ?? (world && own !== 'failed' ? own : null);
  const area = scopeAreaParam(scope.place);
  // the months of the scope; the rest of each year is left out (not shown as "no data")
  const shown = useMemo(() => (points ? onScale(points, scope.scale).filter((p) => inSeason(p.mo, scope.months)) : null), [points, scope.scale, scope.months]);
  const title = useMemo(() => (points ? calendarTitle(onScale(points, scope.scale), t) : ''), [points, scope.scale, t]);
  const what = `${scope.months ? `${seasonLabel(scope.months)} of each year` : 'Every month'}, ${yearsLabel(scope.years)}`;
  const save = async () => {
    if (!points) return;
    const file = await saveCalendarPicture({ name: data.name, points, scale: scope.scale, mode: 'count', lastYear, t, lang });
    toast(`Saved ${file}`);
  };
  return (
    <Card className="db-cal" title={<span className="db-cal-title"><IconCalendar size={16} />Burning calendar of {of}</span>}
      subtitle={<>{title ? `${title.replace(/\.?$/, '.')} ` : ''}{what}. Each box is one month; {theme === 'light' ? 'darker' : 'brighter'} boxes had more fire. Select a month to see it on the map.</>}
      actions={points ? (
        <span className="db-cal-actions">
          <button type="button" className="ui-btn ui-btn-ghost" onClick={() => { void save(); }} aria-label={`Save the burning calendar of ${of} as a picture (PNG)`}>
            <IconDownload size={16} />PNG
          </button>
          <a className="ui-btn" href={`#/?${area}&tab=calendar&cal=full`}>Open the full calendar</a>
        </span>
      ) : undefined}>
      {shown && !data.loading ? (
        <Calendar points={shown} scale={scope.scale} mode="count" years={scope.years} selected={null} name={data.name}
          onSelect={(m) => openLink(`#/?${area}&month=${m.yr * 100 + m.mo}&tab=calendar`)} />
      ) : own === 'failed' ? <p className="db-muted">The calendar could not be loaded.</p> : <Skeleton height={Math.max(200, 30 + 15 * (scope.years[1] - scope.years[0] + 1))} />}
    </Card>
  );
}
