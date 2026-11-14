// One DuckDB-WASM database for the whole app. Remote Parquet files are registered by URL, so DuckDB reads only the
// byte ranges a query needs (HTTP range requests), never whole files unless the query needs them.
import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { dataUrl } from './config';

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
};

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let connPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;
const registered = new Map<string, Promise<void>>();

/**
 * Load the two extensions the app uses (the Parquet reader and JSON) as soon as the engine starts, from our own copy
 * (public/duckdb-ext/: the official signed builds of DuckDB's extension host for this engine version), so they are
 * ready before the first query and the app does not depend on a third server. Then automatic loading points back to
 * DuckDB's host, for anything else. If our copy cannot load, DuckDB's host is used for these too.
 */
async function loadExtensions(db: duckdb.AsyncDuckDB): Promise<void> {
  const c = await db.connect();
  const reset = async () => {
    await c.query('RESET custom_extension_repository');
    await c.query('RESET autoinstall_extension_repository');
  };
  try {
    const repo = new URL(`${import.meta.env.BASE_URL}duckdb-ext`, window.location.href).href;
    await c.query(`SET custom_extension_repository = '${repo}'`);
    await c.query(`SET autoinstall_extension_repository = '${repo}'`);
    await c.query('LOAD parquet');
    await c.query('LOAD json');
    await reset();
  } catch {
    try {
      await reset();
      await c.query('LOAD parquet');
      await c.query('LOAD json');
    } catch { /* the first query that needs them loads them, or reports the error */ }
  } finally {
    await c.close();
  }
}

/** The single database instance (created on first use). */
export function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const bundle = await duckdb.selectBundle(BUNDLES);
      if (!bundle.mainWorker) throw new Error('No DuckDB worker for this browser');
      const worker = new Worker(bundle.mainWorker);
      const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      await loadExtensions(db);
      return db;
    })();
    dbPromise.catch(() => { dbPromise = null; });   // allow a retry after a failure
  }
  return dbPromise;
}

function getConn(): Promise<duckdb.AsyncDuckDBConnection> {
  if (!connPromise) {
    connPromise = getDb().then((db) => db.connect());
    connPromise.catch(() => { connPromise = null; });
  }
  return connPromise;
}

/**
 * Make a data file (path relative to DATA_URL, e.g. 'web/map_l3/2026.parquet') queryable under that same name.
 * Files are fetched whole (in parallel with the engine start) and handed to DuckDB as a buffer: one request, and it
 * works on hosts that compress on the fly, such as GitHub Pages, where byte ranges cannot be used (the files under
 * web/ are small for that reason). The hotspot files (up to hundreds of MB, on the Hugging Face dataset, which serves
 * real byte ranges) are registered by URL, so DuckDB reads only the row groups of the months asked for.
 */
export function registerData(path: string): Promise<void> {
  let p = registered.get(path);
  if (!p) {
    p = path.startsWith('hotspots/')
      ? getDb().then((db) => db.registerFileURL(path, dataUrl(path), duckdb.DuckDBDataProtocol.HTTP, false))
      : Promise.all([getDb(), fetch(dataUrl(path)).then(async (r) => {
          if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
          return new Uint8Array(await r.arrayBuffer());
        })]).then(([db, bytes]) => db.registerFileBuffer(path, bytes));
    p.catch(() => registered.delete(path));
    registered.set(path, p);
  }
  return p;
}

/** Register a small in-memory JSON document (for example a list of hexagons) under `name`. */
export async function registerJson(name: string, rows: unknown[]): Promise<void> {
  const db = await getDb();
  await db.registerFileText(name, JSON.stringify(rows));
}

function plain(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Uint8Array) return Array.from(v);
  return v;
}

/** Run SQL and return plain objects (BigInt turned into number). */
export async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const conn = await getConn();
  const table = await conn.query(sql);
  const names = table.schema.fields.map((f) => f.name);
  const out: T[] = [];
  for (const row of table) {
    const o: Record<string, unknown> = {};
    const r = row as unknown as Record<string, unknown>;
    for (const n of names) o[n] = plain(r[n]);
    out.push(o as T);
  }
  return out;
}

/** Quote a text value for SQL (single quotes doubled). */
export const sqlText = (s: string): string => `'${s.replaceAll("'", "''")}'`;

let exportSeq = 0;

/**
 * Run a query into a CSV file inside DuckDB and return the bytes and the number of data rows. No JavaScript object is
 * made per row, so an export of a million hotspots stays light in memory.
 */
export async function exportCsv(sql: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; rows: number }> {
  const db = await getDb();
  const conn = await getConn();
  const name = `export_${++exportSeq}.csv`;
  await db.registerEmptyFileBuffer(name);
  try {
    await conn.query(`COPY (${sql}) TO '${name}' (FORMAT csv, HEADER true)`);
    // a copy sent from the worker, so a plain ArrayBuffer (never shared memory): fine for a Blob
    const bytes = (await db.copyFileToBuffer(name)) as Uint8Array<ArrayBuffer>;
    let lines = 0;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) lines += 1;
    return { bytes, rows: Math.max(0, lines - 1) };
  } finally {
    await db.dropFile(name);
  }
}
