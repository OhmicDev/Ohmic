// Ohmic's server: serves the built app (dist/) and relays VESC's package archive,
// which is only on plain HTTP, so an HTTPS page can't load it directly.
//
//   PORT   default 8787
//
// Run: npm run server   (reads .env when present)

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT) || 8787
const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)))

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { message: 'Method not allowed.' })
  let path: string
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  } catch {
    return sendJson(res, 400, { message: 'Bad path.' })
  }
  let file = normalize(join(DIST, path))
  if (file !== DIST && !file.startsWith(DIST + sep)) return sendJson(res, 403, { message: 'Forbidden.' })
  let info = await stat(file).catch(() => null)
  if (info?.isDirectory()) {
    file = join(file, 'index.html')
    info = await stat(file).catch(() => null)
  }
  // Client-side routes get the app.
  if (!info && !extname(path)) {
    file = join(DIST, 'index.html')
    info = await stat(file).catch(() => null)
  }
  if (!info) return sendJson(res, 404, { message: 'Not found. Run npm run build first if the app is missing.' })
  const hashed = path.startsWith('/assets/')
  res.writeHead(200, {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

const ARCHIVE_UPSTREAM = 'http://home.vedder.se/vesc_pkg/vesc_pkg_all.rcc'
const ARCHIVE_TTL_MS = 3600_000
const ARCHIVE_MAX = 64 * 1024 * 1024
let archive: { data: Buffer; at: number } | null = null
let archiveFetch: Promise<Buffer> | null = null

async function fetchArchive(): Promise<Buffer> {
  const res = await fetch(ARCHIVE_UPSTREAM, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`The package archive answered ${res.status}.`)
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > ARCHIVE_MAX) throw new Error('The package archive is unexpectedly large.')
  const data = Buffer.from(await res.arrayBuffer())
  if (data.length > ARCHIVE_MAX) throw new Error('The package archive is unexpectedly large.')
  if (data.subarray(0, 4).toString('latin1') !== 'qres') throw new Error('The package archive isn’t in the expected format.')
  return data
}

async function packageArchive(req: IncomingMessage, res: ServerResponse) {
  // One download serves everyone for an hour; an old copy is better than none if VESC's server is down.
  if (!archive || Date.now() - archive.at > ARCHIVE_TTL_MS) {
    archiveFetch ??= fetchArchive().finally(() => (archiveFetch = null))
    try {
      archive = { data: await archiveFetch, at: Date.now() }
    } catch (e) {
      if (!archive) return sendJson(res, 502, { message: `Couldn’t get the package archive from VESC’s server: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': archive.data.length,
    'cache-control': 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  })
  if (req.method === 'HEAD') return res.end()
  res.end(archive.data)
}

createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  if (path === '/api/pkg/archive' && (req.method === 'GET' || req.method === 'HEAD')) return void packageArchive(req, res)
  if (path.startsWith('/api/')) return sendJson(res, 404, { message: 'Not found.' })
  void serveStatic(req, res).catch(() => {
    if (!res.headersSent) sendJson(res, 500, { message: 'Server error.' })
    else res.end()
  })
}).listen(PORT, () => {
  console.log(`Ohmic server on http://localhost:${PORT}`)
})
