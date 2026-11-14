// The "Ask" assistant: a chat with Gemini through our relay (assistant/apps_script.gs keeps the key; the rules are
// in public/assistant.json). The
// model may only answer from four tools, and they run here, on the app's own published data (places.json and the
// series files), so every number in an answer is a number the app shows. Each tool result carries the link that
// opens the place, which the panel offers under the answer.
import { ASSISTANT_URL, BASE_YEARS } from './config.ts';
import { seriesFile, webJson } from './web.ts';
import { areaLink, searchAreas, warmSearch } from './search.ts';
import type { PlaceRow, PlacesFile } from '../components/rankings/model.ts';

export interface Part { text?: string; thought?: boolean; functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; id?: string; response: unknown }; [k: string]: unknown }
export interface Turn { role: 'user' | 'model'; parts: Part[] }
export interface View { label: string; link: string }
export type Step = 'find' | 'facts' | 'history' | 'rank' | 'wait';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ym: number) => `${MONTHS[(ym % 100) - 1]} ${Math.floor(ym / 100)}`;
const round = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const KINDS = new Set(['world', 'continent', 'country', 'state']);

let places: Promise<PlacesFile | null> | null = null;
const placesFile = () => (places ??= webJson<PlacesFile>('places.json'));
async function row(kind: string, id: string): Promise<PlaceRow | null> {
  const f = await placesFile();
  return f?.rows.find((r) => r.kind === kind && r.id === id) ?? null;
}

/** Does a place's yearly trend pass the test? The world and the continents are one test each (p < 0.05); countries
 *  and states are many tests at once, so only those with enough fire are tested, at a 5% false discovery rate. */
function trendVerdict(r: PlaceRow): string {
  if (r.trend_pct_per_decade === null) return 'no trend computed';
  const dir = r.trend_pct_per_decade < 0 ? 'falling' : 'rising';
  if (r.kind === 'world' || r.kind === 'continent') return (r.trend_p ?? 1) < 0.05 ? `${dir}, passes the test` : 'no clear trend';
  if (!r.trend_tested) return 'not tested (too little fire, or mostly barren land)';
  return (r.trend_q ?? 1) <= 0.05 ? `${dir}, passes the false discovery test` : 'no clear trend (does not pass the false discovery test)';
}

// --- the tools ---------------------------------------------------------------------------------------------------
async function findPlace({ query }: { query?: string }) {
  warmSearch();
  for (let i = 0; i < 40; i++) {           // the index loads with the place list (about a second the first time)
    const hits = searchAreas(String(query ?? ''), 5);
    if (hits.length || i === 39) {
      return { matches: hits.map((h) => (h.area
        ? { name: h.label, kind: h.area.kind, id: h.area.id, about: h.hint }
        : { name: h.label, kind: 'city', about: `${h.hint}; only the 50 km area in the app, no numbers here`, link: h.link })) };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { matches: [] };
}

async function resolve(a: { place?: string; kind?: string; id?: string }): Promise<{ kind: string; id: string } | null> {
  if (a.kind && a.id && KINDS.has(a.kind)) return { kind: a.kind, id: a.id };
  const name = String(a.place ?? '').trim();
  if (!name) return null;
  if (/^(the )?(world|earth|globe|global)$/i.test(name)) return { kind: 'world', id: 'WORLD' };
  warmSearch();
  for (let i = 0; i < 40; i++) {
    const hit = searchAreas(name, 5).find((h) => h.area && KINDS.has(h.area.kind));
    if (hit?.area) return { kind: hit.area.kind, id: hit.area.id };
    if (searchAreas(name, 5).length) return null;      // the index is ready and has no named place for it
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function placeFacts(a: { place?: string; kind?: string; id?: string }) {
  const p = await resolve(a);
  const r = p ? await row(p.kind, p.id) : null;
  if (!r) return { error: `No country, state, continent or the world matches "${a.place ?? ''}".` };
  return {
    name: r.name, kind: r.kind, id: r.id, link: areaLink(r.kind, r.id),
    latest_month: r.latest_ym ? monthName(r.latest_ym) : null, latest_hotspots: round(r.latest), latest_normal: round(r.latest_normal),
    latest_times_normal: round(r.latest_ratio, 1), latest_rank: r.latest_rank ? `${r.latest_rank} of ${r.latest_years} years (1 = most fire)` : null,
    year_so_far: round(r.ytd), year_so_far_normal: round(r.ytd_normal), year_so_far_times_normal: round(r.ytd_ratio, 2),
    hotspots_a_year: round(r.mean_per_year), record_year: r.record_year, record_year_hotspots: round(r.record_total),
    trend_percent_per_decade_2001_2025: round(r.trend_pct_per_decade, 1), trend: trendVerdict(r),
    peak_month: r.peak_month ? MONTHS[r.peak_month - 1] : null, critical_months: (r.critical_months ?? []).map((m) => MONTHS[m - 1]),
    share_of_world_fire_percent: round(r.share_pct, 2), area_km2: round(r.area_km2),
    outlook: r.outlook_p === null ? 'no outlook (outside the fire season or too little fire)'
      : { month: r.outlook_target ? monthName(r.outlook_target) : null, chance_above_normal: `${Math.round(r.outlook_p * 100)}%`,
          normal_chance: r.outlook_p_clim === null ? null : `${Math.round(r.outlook_p_clim * 100)}%` },
    weather_explains_percent_of_swings: r.drivers_r2 === null || r.drivers_r2 <= 0 ? null : Math.round(r.drivers_r2 * 100),
  };
}

async function fireHistory({ by = 'year', from_ym, to_ym, ...a }: { place?: string; kind?: string; id?: string; by?: string; from_ym?: number; to_ym?: number }) {
  // the model may give a year (2019) where a month is asked (201901): take both
  if (from_ym && from_ym < 10000) from_ym = from_ym * 100 + 1;
  if (to_ym && to_ym < 10000) to_ym = to_ym * 100 + 12;
  const p = await resolve(a);
  if (!p) return { error: `No country, state, continent or the world matches "${a.place ?? ''}".` };
  const { kind, id } = p;
  const f = await seriesFile(kind, id);
  if (!f) return { error: 'The record of this place did not load.' };
  const pts = f.ym.map((ym, i) => ({ ym, h: f.h[i] })).filter((p): p is { ym: number; h: number } => p.h !== null && p.h !== undefined);
  const name = (await row(kind, id))?.name ?? id;
  const link = areaLink(kind, id);
  if (by === 'month') {
    const normal = new Map<number, number>();           // the median of each calendar month in 2001 to 2025
    for (let m = 1; m <= 12; m++) {
      const v = pts.filter((p) => p.ym % 100 === m && p.ym >= BASE_YEARS[0] * 100 && p.ym < (BASE_YEARS[1] + 1) * 100).map((p) => p.h).sort((a, b) => a - b);
      if (v.length) normal.set(m, v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2);
    }
    const lo = from_ym ?? pts.at(-12)?.ym ?? 0, hi = to_ym ?? pts.at(-1)?.ym ?? 0;
    const rows = pts.filter((p) => p.ym >= lo && p.ym <= hi).slice(-72).map((p) => {
      const n = normal.get(p.ym % 100) ?? null;
      return { month: monthName(p.ym), hotspots: round(p.h), normal: round(n), times_normal: n ? round(p.h / n, 1) : null };
    });
    return { name, link, months: rows };
  }
  const years = new Map<number, { sum: number; n: number }>();
  for (const p of pts) { const y = Math.floor(p.ym / 100); const e = years.get(y) ?? { sum: 0, n: 0 }; e.sum += p.h; e.n++; years.set(y, e); }
  const full = [...years].filter(([y, e]) => y >= 2001 && e.n === 12);
  const order = [...full].sort((a, b) => b[1].sum - a[1].sum).map(([y]) => y);
  const lo = from_ym ? Math.floor(from_ym / 100) : 2001, hi = to_ym ? Math.floor(to_ym / 100) : 2026;
  const rows = [...years].filter(([y]) => y >= Math.max(lo, 2001) && y <= hi).map(([y, e]) => ({
    year: y, hotspots: round(e.sum), months: e.n, rank: e.n === 12 ? `${order.indexOf(y) + 1} of ${order.length} full years (1 = most fire)` : `partial year (${e.n} months so far)`,
  }));
  return { name, link, years: rows };
}

async function rankPlaces({ kind = 'country', order = 'most_fire', continent, country_iso3, limit = 5 }: { kind?: string; order?: string; continent?: string; country_iso3?: string; limit?: number }) {
  const f = await placesFile();
  if (!f) return { error: 'The place list did not load.' };
  let rows = f.rows.filter((r) => r.kind === kind && (r.mean_per_year ?? 0) >= 100);
  if (continent) rows = rows.filter((r) => (r.continent ?? '').toLowerCase() === continent.toLowerCase());
  if (country_iso3) rows = rows.filter((r) => (r.iso3 ?? r.id.split('-')[0]).toUpperCase() === country_iso3.toUpperCase());
  const passes = (r: PlaceRow) => r.trend_tested && (r.trend_q ?? 1) <= 0.05;
  const n = Math.min(Math.max(Number(limit) || 5, 1), 10);
  const sorted = order === 'rising' ? rows.filter((r) => passes(r) && (r.trend_pct_per_decade ?? 0) > 0).sort((a, b) => (b.trend_pct_per_decade ?? 0) - (a.trend_pct_per_decade ?? 0))
    : order === 'falling' ? rows.filter((r) => passes(r) && (r.trend_pct_per_decade ?? 0) < 0).sort((a, b) => (a.trend_pct_per_decade ?? 0) - (b.trend_pct_per_decade ?? 0))
    : order === 'above_normal_now' ? rows.filter((r) => (r.latest_normal ?? 0) >= 1000 && (r.mean_per_year ?? 0) >= 1000).sort((a, b) => (b.latest_ratio ?? 0) - (a.latest_ratio ?? 0))
    : order === 'outlook' ? rows.filter((r) => r.outlook_p !== null).sort((a, b) => (b.outlook_p ?? 0) - (a.outlook_p ?? 0))
    : rows.sort((a, b) => (b.mean_per_year ?? 0) - (a.mean_per_year ?? 0));
  return {
    latest_month: monthName(f.latest_month), order,
    places: sorted.slice(0, n).map((r) => ({ name: r.name, kind: r.kind, id: r.id, hotspots_a_year: round(r.mean_per_year),
      trend_percent_per_decade: round(r.trend_pct_per_decade, 1), trend: trendVerdict(r), latest_times_normal: round(r.latest_ratio, 1),
      outlook_chance_above_normal: r.outlook_p === null ? null : `${Math.round(r.outlook_p * 100)}%`, link: areaLink(r.kind, r.id) })),
  };
}

const TOOLS: Record<string, { step: Step; run: (a: Record<string, unknown>) => Promise<unknown> }> = {
  find_place: { step: 'find', run: findPlace },
  place_facts: { step: 'facts', run: placeFacts },
  fire_history: { step: 'history', run: fireHistory },
  rank_places: { step: 'rank', run: rankPlaces },
};

// --- the conversation ----------------------------------------------------------------------------------------------
export type FailKind = 'busy' | 'quota' | 'offline' | 'failed';
export class AssistantError extends Error {
  kind: FailKind;
  constructor(kind: FailKind) { super(kind); this.kind = kind; }
}

async function post(contents: Turn[], signal?: AbortSignal): Promise<Turn> {
  let r: Response;
  try {
    // an Apps Script relay (…/exec) takes the body as plain text (no preflight) and always answers 200 with a JSON body
    const apps = ASSISTANT_URL.includes('script.google.com');
    r = await fetch(apps ? ASSISTANT_URL : `${ASSISTANT_URL.replace(/\/$/, '')}/chat`,
      { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ contents }),
        // a model that hangs must not leave the panel waiting for ever: after 70 s the question counts as busy
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(70000)]) : AbortSignal.timeout(70000) });
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') throw new AssistantError('busy');
    if ((e as Error).name === 'AbortError') throw e;
    throw new AssistantError('offline');
  }
  if (r.status === 429) throw new AssistantError('busy');
  if (!r.ok) throw new AssistantError('failed');
  const d = await r.json().catch(() => ({})) as { content?: Turn; error?: string };
  if (d.error === 'busy' || d.error === 'quota') throw new AssistantError(d.error);
  if (!d.content?.parts) throw new AssistantError('failed');
  return { role: 'model', parts: d.content.parts };
}

/** One question: the model's turns and the tool results go into `history` (kept whole, thought signatures included,
 *  as Gemini asks); returns the answer's text and the places it used. */
export async function ask(history: Turn[], question: string, onStep: (s: Step, label?: string) => void, signal?: AbortSignal): Promise<{ text: string; views: View[] }> {
  history.push({ role: 'user', parts: [{ text: question }] });
  const views = new Map<string, View>();
  for (let round = 0; round < 6; round++) {
    let turn: Turn | null = null;
    for (let wait = 0; !turn; wait += 4) {
      try { turn = await post(history, signal); } catch (e) {
        if (!(e instanceof AssistantError) || e.kind !== 'busy' || wait >= 12) throw e;
        onStep('wait');
        await new Promise((r) => setTimeout(r, (wait + 4) * 1000));
      }
    }
    history.push(turn);
    const calls = turn.parts.filter((p) => p.functionCall);
    if (!calls.length) {
      const text = turn.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
      return { text: text || 'Sorry, I could not find an answer in the record.', views: [...views.values()].slice(0, 3) };
    }
    const parts = await Promise.all(calls.map(async (p) => {
      const { name, args = {}, id } = p.functionCall!;
      const tool = TOOLS[name];
      onStep(tool?.step ?? 'facts', typeof args.query === 'string' ? args.query : typeof args.place === 'string' ? args.place : undefined);
      let response: unknown;
      try { response = tool ? await tool.run(args) : { error: `unknown tool ${name}` }; } catch { response = { error: 'The data did not load.' }; }
      const res = response as { name?: string | null; link?: string };
      if ((name === 'place_facts' || name === 'fire_history') && res.link && res.name) views.set(res.link, { label: res.name, link: res.link });
      return { functionResponse: { name, ...(id ? { id } : {}), response: response as Record<string, unknown> } } as Part;
    }));
    history.push({ role: 'user', parts });
  }
  return { text: 'That took too many steps. Try a simpler question, or open the place in the Explorer.', views: [...views.values()].slice(0, 3) };
}

export const assistantOn = () => Boolean(ASSISTANT_URL);
