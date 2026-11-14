// The Data page's "Files the app reads": the small JSON files under web/ (fireharmony/webfiles.py, placestats.py,
// eda.py) and the one archive the site is built from. Each file gets a card: what it holds, its fields, how many
// files there are and its size. Sizes are measured (a HEAD request: no file is downloaded); a server that compresses
// JSON reports the compressed size, and the card says so. Counts come from web/index.json and web/eda.json.
import { useEffect, useState } from 'react';
import { Card, Note } from '../ui';
import { IconDownload, IconExternal } from '../icons';
import { dataUrl } from '../../lib/config';
import { webJson, type WebIndex } from '../../lib/web';
import { CodeBlock, type CodeSample } from './CodeBlock';
import { fileSize, int } from './format';

export const SITE_ARCHIVE = 'https://huggingface.co/datasets/warrensaw530/fire-harmony/resolve/main/v1.0/site_data.tar.gz';
export const DATASET_PAGE = 'https://huggingface.co/datasets/warrensaw530/fire-harmony';

interface Field { name: string; text: string }
interface WebFile {
  key: string; title: string; files: { path: string; label: string; href: string; external?: boolean }[];
  what: string; fields: Field[]; count?: (ix: WebIndex | null, eda: { version: number; built: string } | null) => string | null;
}

const web = (p: string) => dataUrl(`web/${p}`);

function webFiles(lastMap: string | null): WebFile[] {
  const year = lastMap ?? '2026';
  return [
    {
      key: 'map', title: 'The map, without a database', what: 'The large hexagons of the map and their normal for each calendar month, then each year of the map as columns that point into that list. The Explorer draws its first map from these two files alone.',
      files: [{ path: 'web/universe_l3.json', label: 'universe_l3.json', href: web('universe_l3.json') }, { path: `web/map_l3/${year}.json`, label: `map_l3/${year}.json`, href: web(`map_l3/${year}.json`) }],
      fields: [
        { name: 'h3', text: 'universe_l3: every level 3 hexagon with a normal, in H3 order.' },
        { name: 'normals', text: 'universe_l3: 12 lists, the normal (median of 2001 to 2025) of each hexagon in each calendar month.' },
        { name: 'i, m', text: 'map_l3: the hexagon (its place in h3) and the month, for every hexagon month with fire.' },
        { name: 'h, d, r', text: 'map_l3: harmonized hotspots, the MODIS scale, and raw detections of all satellites.' },
        { name: 'x', text: 'map_l3: hexagons with fire but no normal, with their own h3 and the same columns.' },
      ],
      count: (ix) => (ix ? `${int(ix.map_l3.length)} year files, ${ix.map_l3[0]} to ${ix.map_l3[ix.map_l3.length - 1]}` : null),
    },
    {
      key: 'trend', title: 'The trend of every map hexagon', what: 'The trend of yearly fire, 2001 to 2025, of every large (level 3) and medium (level 4) hexagon with fire. The trend view of the Explorer colours the map with it.',
      files: [{ path: 'web/trend_l3.json', label: 'trend_l3.json', href: web('trend_l3.json') }, { path: 'web/trend_l4.json', label: 'trend_l4.json', href: web('trend_l4.json') }],
      fields: [
        { name: 'h3', text: 'The hexagon.' },
        { name: 'pct', text: 'The change per decade, in %, from Sen’s slope.' },
        { name: 'p', text: 'The Mann Kendall p value, with the Hamed and Rao correction.' },
        { name: 'mean', text: 'Mean harmonized hotspots a year: the trend is tested only at floor_per_year (100) or more.' },
        { name: 'q', text: 'The p value adjusted by Benjamini and Hochberg among the tested hexagons; empty below the floor. Rising or falling means q at most 0.05.' },
      ],
    },
    {
      key: 'places', title: 'Every place, for the Rankings page', what: 'One row per named place (the world, continents, countries and states) with its statistics: fire per year, share of the world, trend, the latest month against normal and its rank, the year so far, the outlook and the drivers.',
      files: [{ path: 'web/places.json', label: 'places.json', href: web('places.json') }],
      fields: [
        { name: 'trend_pct_per_decade, trend_p', text: 'The trend of yearly fire, 2001 to 2025, and its p value.' },
        { name: 'trend_tested', text: 'True when the place has at least 1,000 hotspots a year and less than half of its fire on barren land.' },
        { name: 'trend_q', text: 'The p value adjusted by Benjamini and Hochberg, among countries and among states each on their own.' },
        { name: 'barren_pct', text: 'The share of its fire on barren land, where lava and gas flares pass for fire.' },
        { name: 'latest_ratio, latest_rank', text: 'The latest full month against its normal, and its rank among the same months of every year.' },
      ],
    },
    {
      key: 'cities', title: 'Cities for the place search', what: 'The cities the search finds, with their country and state. A city opens as a circle of 50 km around it.',
      files: [{ path: 'web/cities.json', label: 'cities.json', href: web('cities.json') }],
      fields: [
        { name: 'name, ascii', text: 'The name, and a plain letters form where it differs.' },
        { name: 'iso3, state', text: 'The country (ISO3 code) and the state it lies in.' },
        { name: 'lat, lon', text: 'Where it is, in degrees.' },
        { name: 'pop, capital', text: 'Its population, and 1 for a state capital or 2 for a national capital.' },
      ],
    },
    {
      key: 'eda', title: 'The first look at the raw record', what: 'Every number of the analysis of the raw record and of the trend tests on the Methods page and in the report.',
      files: [{ path: 'web/eda.json', label: 'eda.json', href: web('eda.json') }],
      fields: [
        { name: 'sensors, overlap', text: 'Each satellite on its full years, and Terra, Aqua and Suomi NPP side by side in 2013 to 2019.' },
        { name: 'frp_hist, overpass', text: 'Hotspots by fire power, and the local time of the passes and their drift.' },
        { name: 'exchange_rate_l3', text: 'Suomi NPP hotspots for every Aqua hotspot, across hexagons and in 12 large fire countries.' },
        { name: 'fdr, places', text: 'The false discovery rate tests of the hexagons and the places, the floors, Moran’s I.' },
        { name: 'sensitivity', text: 'Other base periods, and the record against MODIS alone.' },
      ],
      count: (_ix, eda) => (eda ? `Version ${eda.version}, built ${eda.built.slice(0, 10)}` : null),
    },
    {
      key: 'archive', title: 'Every app file in one archive', what: 'All the files above and the Parquet files the app reads (everything but the hotspot files), in one gzip tar archive on Hugging Face. The web site is built from it.',
      files: [{ path: SITE_ARCHIVE, label: 'v1.0/site_data.tar.gz', href: SITE_ARCHIVE, external: true }],
      fields: [
        { name: 'web/', text: 'The small JSON and Parquet pieces above, one folder each.' },
        { name: '*.parquet, *.json', text: 'The published files of the table above, but not hotspots/.' },
      ],
    },
  ];
}

interface Size { bytes: number; compressed: boolean }

/** Sizes of the files from a HEAD request each (nothing is downloaded); null while they load, absent when unknown. */
function useHeadSizes(urls: string[], ready: boolean): Record<string, Size> | null {
  const key = urls.join('|');
  const [sizes, setSizes] = useState<Record<string, Size> | null>(null);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const ctl = new AbortController();
    const stop = window.setTimeout(() => ctl.abort(), 8000);
    void Promise.allSettled(key.split('|').map(async (u) => {
      const r = await fetch(u, { method: 'HEAD', signal: ctl.signal });
      const n = Number(r.headers.get('content-length'));
      if (!r.ok || !Number.isFinite(n) || n <= 0) return null;
      return [u, { bytes: n, compressed: Boolean(r.headers.get('content-encoding')) }] as const;
    })).then((res) => {
      if (!alive) return;
      const out: Record<string, Size> = {};
      for (const x of res) if (x.status === 'fulfilled' && x.value) out[x.value[0]] = x.value[1];
      setSizes(out);
    });
    return () => { alive = false; window.clearTimeout(stop); ctl.abort(); };
  }, [key, ready]);
  return sizes;
}

function samples(): CodeSample[] {
  const base = dataUrl('web/');
  return [
    {
      id: 'js', label: 'JavaScript', lang: 'js', done: 'JavaScript copied',
      code: `// The hexagons whose trend passes the test: enough fire, and q at most 0.05
const base = "${base}";
const t = await (await fetch(base + "trend_l3.json")).json();
const clear = t.h3
  .map((h3, i) => ({ h3, pct: t.pct[i], q: t.q[i], mean: t.mean[i] }))
  .filter((r) => r.mean >= t.floor_per_year && r.q !== null && r.q <= 0.05);
console.log(clear.length, "of", t.h3.length, "hexagons rise or fall");`,
    },
    {
      id: 'python', label: 'Python', lang: 'python', done: 'Python copied',
      code: `import json, urllib.request

base = "${base}"
places = json.load(urllib.request.urlopen(base + "places.json"))["rows"]
# countries ranked by the report's rules: tested, and q at most 0.05
clear = [r for r in places if r["kind"] == "country" and r["trend_tested"]
         and r["trend_q"] is not None and r["trend_q"] <= 0.05]
for r in sorted(clear, key=lambda r: r["trend_pct_per_decade"])[:5]:
    print(r["name"], r["trend_pct_per_decade"], r["trend_q"])`,
    },
  ];
}

export function WebFilesSection({ ready }: { ready: boolean }) {
  const [ix, setIx] = useState<WebIndex | null>(null);
  const [eda, setEda] = useState<{ version: number; built: string } | null>(null);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    webJson<WebIndex>('index.json').then((x) => { if (alive) setIx(x); }, () => undefined);
    webJson<{ version: number; built: string }>('eda.json').then((x) => { if (alive) setEda(x); }, () => undefined);
    return () => { alive = false; };
  }, [ready]);
  const lastMap = ix ? [...ix.map_l3].sort().pop() ?? null : null;
  const files = webFiles(lastMap);
  const urls = files.flatMap((f) => f.files.map((x) => x.href));
  const sizes = useHeadSizes(urls, ready && ix !== null);
  const sizeText = (href: string) => {
    if (sizes === null) return '…';
    const s = sizes[href];
    return s ? `${fileSize(s.bytes)}${s.compressed ? ' compressed' : ''}` : '–';
  };
  return (
    <>
      <ul className="fh-wf-grid">
        {files.map((f) => {
          const count = f.count?.(ix, eda) ?? null;
          return (
            <li key={f.key} className="fh-wf-card" data-file={f.key}>
              <h3 className="fh-wf-title">{f.title}</h3>
              <ul className="fh-wf-files">
                {f.files.map((x) => (
                  <li key={x.path}>
                    <a className="fh-wf-file" href={x.href} target="_blank" rel="noreferrer" {...(x.external ? {} : { download: '' })}>
                      {x.external ? <IconExternal size={14} /> : <IconDownload size={14} />}<code>{x.label}</code>
                      {x.external ? <span className="sr-only"> (opens in a new tab)</span> : null}
                    </a>
                    <span className="fh-wf-size ui-mono">{sizeText(x.href)}</span>
                  </li>
                ))}
              </ul>
              <p className="fh-wf-what">{f.what}</p>
              <dl className="fh-wf-fields">
                {f.fields.map((x) => <div key={x.name}><dt><code>{x.name}</code></dt><dd>{x.text}</dd></div>)}
              </dl>
              {count ? <p className="fh-wf-count ui-mono">{count}</p> : null}
            </li>
          );
        })}
      </ul>
      <Card title="Read the app’s files yourself" subtitle="Plain JSON: any language can read them, with no database.">
        <CodeBlock samples={samples()} label="Code examples for the app’s files" />
        <Note>Columns are stored as lists of the same length, so the row of item <code>i</code> is <code>h3[i]</code>, <code>pct[i]</code> and so on. The archive and every file are also on the <a className="fh-pg-link" href={DATASET_PAGE} target="_blank" rel="noreferrer">Hugging Face dataset</a>.</Note>
      </Card>
    </>
  );
}
