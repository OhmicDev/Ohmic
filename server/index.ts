// Ohmic's AI server: holds the Anthropic API key, so it never reaches the browser,
// and passes each step of the AI Tune conversation to Claude. The agent loop and
// the tools run in the browser (they need the controller); this only relays model
// calls, rate-limited per IP. It also serves the built app (dist/).
//
//   ANTHROPIC_API_KEY   required for AI Tune
//   AI_MODEL            default claude-opus-5-5
//   AI_ACCESS_CODE      optional: riders must enter it in More › AI Tune
//   AI_RATE_PER_MIN     model calls per IP per minute (default 30)
//   AI_RATE_PER_HOUR    model calls per IP per hour (default 300)
//   TRUST_PROXY=1       take the client IP from X-Forwarded-For (behind a reverse proxy)
//   PORT                default 8787
//
// Run: npm run server   (reads .env when present)

import Anthropic from '@anthropic-ai/sdk'
import type { BetaMessageParam, BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { timingSafeEqual } from 'node:crypto'
import { DEFAULT_MODEL, MAX_TOKENS, SYSTEM_PROMPT, TOOLS } from '../src/ai/agentSpec.ts'

const env = process.env
const PORT = Number(env.PORT) || 8787
const MODEL = env.AI_MODEL?.trim() || DEFAULT_MODEL
const ACCESS_CODE = env.AI_ACCESS_CODE?.trim() || ''
const PER_MIN = Number(env.AI_RATE_PER_MIN) || 30
const PER_HOUR = Number(env.AI_RATE_PER_HOUR) || 300
const TRUST_PROXY = env.TRUST_PROXY === '1'
const MAX_BODY = 2 * 1024 * 1024
const MAX_MESSAGES = 400
const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)))

const client = env.ANTHROPIC_API_KEY ? new Anthropic() : null
// The browser only ever gets finished tool calls, so eager input streaming wouldn't help here.

// ---------------------------------------------------------------- rate limit

const calls = new Map<string, number[]>()

function clientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for']
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim()
    if (first) return first
  }
  return req.socket.remoteAddress ?? 'unknown'
}

/** Seconds to wait, or 0 when the call may go ahead (and is counted). */
function rateLimit(ip: string, now = Date.now()): number {
  const list = (calls.get(ip) ?? []).filter((t) => t > now - 3600_000)
  const lastMinute = list.filter((t) => t > now - 60_000)
  if (lastMinute.length >= PER_MIN) return Math.ceil((lastMinute[0] + 60_000 - now) / 1000)
  if (list.length >= PER_HOUR) return Math.ceil((list[0] + 3600_000 - now) / 1000)
  list.push(now)
  calls.set(ip, list)
  return 0
}

setInterval(() => {
  const cutoff = Date.now() - 3600_000
  for (const [ip, list] of calls) if (!list.some((t) => t > cutoff)) calls.delete(ip)
}, 600_000).unref()

// ---------------------------------------------------------------- helpers

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

function codeOk(req: IncomingMessage): boolean {
  if (!ACCESS_CODE) return true
  const got = String(req.headers['x-ohmic-access-code'] ?? '')
  const a = Buffer.from(got)
  const b = Buffer.from(ACCESS_CODE)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new Error('too-big')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** The conversation, checked for shape only (the API checks the rest). */
function messagesProblem(m: unknown): string | null {
  if (!Array.isArray(m) || m.length === 0) return 'messages must be a non-empty list.'
  if (m.length > MAX_MESSAGES) return 'The conversation is too long. Start a new chat.'
  for (const [i, msg] of m.entries()) {
    if (!msg || typeof msg !== 'object') return `Message ${i + 1} isn’t an object.`
    const { role, content } = msg as { role?: unknown; content?: unknown }
    if (role !== 'user' && role !== 'assistant') return `Message ${i + 1} has an unknown role.`
    if (!Array.isArray(content) || !content.length) return `Message ${i + 1} has no content.`
    if (!content.every((b) => b && typeof b === 'object' && typeof (b as { type?: unknown }).type === 'string')) return `Message ${i + 1} has a malformed block.`
  }
  if ((m[0] as { role: string }).role !== 'user') return 'The conversation must start with the rider.'
  return null
}

function errorText(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'The AI server’s API key was rejected. The server owner needs to check ANTHROPIC_API_KEY.'
  if (e instanceof Anthropic.PermissionDeniedError) return 'The AI server’s API key isn’t allowed to use this model.'
  if (e instanceof Anthropic.RateLimitError) return 'Claude is rate-limited right now. Wait a minute and try again.'
  if (e instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${e.message}`
  if (e instanceof Anthropic.APIConnectionError) return 'The AI server couldn’t reach Claude. Try again shortly.'
  if (e instanceof Anthropic.InternalServerError) return 'Claude had a problem on its side (it may be overloaded). Try again shortly.'
  if (e instanceof Anthropic.APIError) return `Claude returned an error (${e.status ?? 'unknown'}). Try again.`
  return 'The AI request failed on the server.'
}

// ---------------------------------------------------------------- AI routes

function status(req: IncomingMessage, res: ServerResponse) {
  if (!client) return sendJson(res, 200, { ok: false, reason: 'The AI server is running but has no ANTHROPIC_API_KEY set.' })
  if (!codeOk(req)) return sendJson(res, 200, { ok: false, reason: 'This AI server needs an access code. Enter it in More › AI Tune.', needsCode: true })
  sendJson(res, 200, { ok: true, model: MODEL })
}

async function chat(req: IncomingMessage, res: ServerResponse) {
  if (!client) return sendJson(res, 503, { message: 'The AI server has no ANTHROPIC_API_KEY set.' })
  if (!codeOk(req)) return sendJson(res, 401, { message: 'Wrong or missing access code (More › AI Tune).' })
  const wait = rateLimit(clientIp(req))
  if (wait) return sendJson(res, 429, { message: `Too many AI requests from your connection. Try again in ${wait} s.` }, { 'retry-after': String(wait) })

  let body: { messages?: unknown }
  try {
    body = JSON.parse(await readBody(req))
  } catch (e) {
    return sendJson(res, e instanceof Error && e.message === 'too-big' ? 413 : 400, { message: e instanceof Error && e.message === 'too-big' ? 'The conversation is too large. Start a new chat.' : 'The request wasn’t valid JSON.' })
  }
  const problem = messagesProblem(body.messages)
  if (problem) return sendJson(res, 400, { message: problem })

  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
  const send = (ev: unknown) => res.write(`${JSON.stringify(ev)}\n`)
  const abort = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) abort.abort()
  })

  try {
    // Tools and the system prompt never change, so they're cached; the top-level
    // cache_control also caches the conversation so far, step after step.
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        cache_control: { type: 'ephemeral' },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS as unknown as BetaTool[],
        tool_choice: { type: 'auto' },
        messages: body.messages as BetaMessageParam[],
      },
      { signal: abort.signal },
    )
    for await (const ev of stream) {
      if (ev.type === 'content_block_start') {
        const t = ev.content_block.type
        if (t === 'thinking' || t === 'redacted_thinking') send({ type: 'thinking' })
        else if (t === 'tool_use') send({ type: 'tool', name: ev.content_block.name })
      } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        send({ type: 'text', text: ev.delta.text })
      }
    }
    const msg = await stream.finalMessage()
    send({ type: 'message', message: { content: msg.content, stop_reason: msg.stop_reason, model: msg.model } })
  } catch (e) {
    if (abort.signal.aborted) return
    console.error('[ai]', e instanceof Error ? e.message : e)
    send({ type: 'error', message: errorText(e) })
  } finally {
    if (!res.writableEnded) res.end()
  }
}

// ---------------------------------------------------------------- static files

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

// ---------------------------------------------------------------- package archive

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

// ---------------------------------------------------------------- server

createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  if (path === '/api/ai/status' && req.method === 'GET') return status(req, res)
  if (path === '/api/ai' && req.method === 'POST') return void chat(req, res)
  if (path === '/api/pkg/archive' && (req.method === 'GET' || req.method === 'HEAD')) return void packageArchive(req, res)
  if (path.startsWith('/api/')) return sendJson(res, 404, { message: 'Not found.' })
  void serveStatic(req, res).catch(() => {
    if (!res.headersSent) sendJson(res, 500, { message: 'Server error.' })
    else res.end()
  })
}).listen(PORT, () => {
  console.log(`Ohmic server on http://localhost:${PORT}`)
  console.log(client ? `AI Tune: on (model ${MODEL}${ACCESS_CODE ? ', access code required' : ''})` : 'AI Tune: off (set ANTHROPIC_API_KEY to turn it on)')
})
