/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import sirv from 'sirv'
import os from 'node:os'
import path from 'node:path'

// In development, serve the published data files (outside the repo, about 420 MB) at /data/ with HTTP range
// requests, so DuckDB in the browser reads only the parts it needs. Nothing is copied into the build.
const DATA_DIR = process.env.FIRE_DATA_DIR ?? path.join(os.homedir(), 'nasa_work/data/products/v1.0')

// A missing data file is a 404, as on GitHub Pages; without this Vite answers with index.html and status 200, and the
// app reads that page as broken JSON (a place with no fire record then showed the previous place's numbers)
function notFound(res: import('node:http').ServerResponse): void {
  res.statusCode = 404
  res.setHeader('Content-Type', 'text/plain')
  res.end('Not found')
}

function serveData(): Plugin {
  const serve = sirv(DATA_DIR, { dev: true, etag: true })
  return {
    name: 'fire-harmony-data',
    configureServer(server) {
      server.middlewares.use('/data', (req, res) => serve(req, res, () => notFound(res)))
    },
    configurePreviewServer(server) {
      server.middlewares.use('/data', (req, res) => serve(req, res, () => notFound(res)))
    },
  }
}

export default defineConfig({
  plugins: [react(), serveData()],
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  server: { host: '127.0.0.1', port: 5173 },
  build: { chunkSizeWarningLimit: 4000 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
