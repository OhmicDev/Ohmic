// Renders the TikTok promo (index.html) to a 1080×1920, 30 fps H.264 MP4 with no extra tools:
// Edge draws each frame, its own WebCodecs encoder encodes it, and mp4.mjs writes the file.
//
//   node promo/tiktok/capture.mjs         footage from the demo (dev server on :5199)
//   node promo/tiktok/render.mjs          → promo/tiktok/out/ohmic-tiktok.mp4, cover.png, contact.png
//   node promo/tiktok/render.mjs --stills=1.2,3,9.8   single frames, for checking a moment
//   node promo/tiktok/render.mjs --check              only re-checks the MP4 (contact.png)
//   node promo/tiktok/render.mjs --preview            plays it at http://localhost:5300
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { muxMp4 } from './mp4.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FONTS = resolve(HERE, '..', '..', 'node_modules', '@fontsource-variable')
const OUT = join(HERE, 'out')
const FPS = 30
const WIDTH = 1080
const HEIGHT = 1920
const BITRATE = 14_000_000
const args = process.argv.slice(2)
const PREVIEW = args.includes('--preview')
const STILLS = args.find((a) => a.startsWith('--stills='))?.slice(9).split(',').map(Number)
const CHECK_ONLY = args.includes('--check')
const TYPES = { '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.mp4': 'video/mp4' }

let frame = Buffer.alloc(0)
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path === '/frame') {
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
    return res.end(frame)
  }
  const file = path.startsWith('/fonts/') ? resolve(FONTS, path.slice(7).replace('/', `${sep}files${sep}`)) : resolve(HERE, `.${path === '/' ? '/index.html' : path}`)
  if (!file.startsWith(HERE) && !file.startsWith(FONTS)) {
    res.writeHead(403)
    return res.end()
  }
  try {
    const body = await readFile(file)
    const type = TYPES[extname(file)] ?? 'application/octet-stream'
    // Browsers only seek in a video when the server can send part of it.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
      res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1, 'cache-control': 'no-store' })
      return res.end(body.subarray(start, end + 1))
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': body.length, 'cache-control': 'no-store' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((r) => server.listen(PREVIEW ? 5300 : 0, 'localhost', r))
const base = `http://localhost:${server.address().port}`
if (PREVIEW) {
  console.log(`Playing at ${base}/  (add ?t=5 to hold a moment). Ctrl+C to stop.`)
} else {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' })
  try {
    if (!CHECK_ONLY) await render(browser)
    if (!STILLS) await check(browser)
  } finally {
    await browser.close()
    server.close()
  }
}

async function render(browser) {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('page error:', e.message))
  page.on('console', (m) => m.type() === 'error' && console.log('page:', m.text()))
  await page.goto(`${base}/index.html?render`)
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60_000 })
  const duration = await page.evaluate(() => window.DURATION)

  if (STILLS) {
    for (const t of STILLS) {
      await page.evaluate((s) => window.renderAt(s), t)
      await page.screenshot({ path: join(OUT, `still-${t.toFixed(2)}.png`) })
      console.log(`still-${t.toFixed(2)}.png`)
    }
    return
  }

  const enc = await ctx.newPage()
  enc.on('pageerror', (e) => console.log('encoder error:', e.message))
  await enc.goto(`${base}/encoder.html`)
  const codec = await enc.evaluate((o) => window.setup(o), { fps: FPS, width: WIDTH, height: HEIGHT, bitrate: BITRATE })
  console.log(`encoding with ${codec}`)

  const frames = Math.round(duration * FPS)
  const chunks = []
  const started = Date.now()
  for (let i = 0; i < frames; i++) {
    await page.evaluate((s) => window.renderAt(s), i / FPS)
    frame = await page.screenshot({ type: 'png' })
    if (i === Math.round(1.25 * FPS)) await writeFile(join(OUT, 'cover.png'), frame)
    chunks.push(...(await enc.evaluate((n) => window.encodeFrame(n), i)))
    if (i % 60 === 0) console.log(`frame ${i}/${frames}  ${((Date.now() - started) / 1000).toFixed(0)} s`)
  }
  const end = await enc.evaluate(() => window.finish())
  chunks.push(...end.chunks)

  if (chunks.length !== frames) throw new Error(`expected ${frames} frames, got ${chunks.length}`)
  chunks.forEach((c, i) => {
    // Without B-frames, frames come out in the order they're shown.
    if (i && c.ts <= chunks[i - 1].ts) throw new Error('the encoder reordered frames (B-frames); this writer needs them in order')
  })
  if (!chunks[0].key) throw new Error('the first frame is not a key frame')

  const mp4 = muxMp4({
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    avcC: Buffer.from(end.avcC, 'base64'),
    colorSpace: end.colorSpace,
    samples: chunks.map((c) => ({ key: c.key, data: Buffer.from(c.b64, 'base64') })),
  })
  const file = join(OUT, 'ohmic-tiktok.mp4')
  await writeFile(file, mp4)
  console.log(`${file}  ${(mp4.length / 1e6).toFixed(1)} MB, ${frames} frames, ${duration} s, ${end.codec}, colour ${JSON.stringify(end.colorSpace)}`)
  await ctx.close()
}

/** Plays the MP4 back in the browser and lays out frames from across it, to check the file itself. */
async function check(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 960 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.goto(`${base}/encoder.html`)
  // A tab in the background doesn't update its video frames.
  await page.bringToFront()
  const info = await page.evaluate(async (src) => {
    document.body.style.margin = '0'
    document.body.style.background = '#222'
    const v = document.createElement('video')
    v.muted = true
    v.style.cssText = 'position:fixed;left:0;top:0;width:90px;height:160px'
    document.body.append(v)
    v.src = src
    await new Promise((ok, fail) => {
      v.onloadeddata = ok
      v.onerror = () => fail(new Error(`the browser can't play it: ${v.error?.message}`))
    })
    const cols = 6
    const times = Array.from({ length: 18 }, (_, k) => 0.4 + (k * (v.duration - 0.6)) / 17)
    const c = document.createElement('canvas')
    c.width = 1080
    c.height = 960
    const g = c.getContext('2d')
    for (const [k, t] of times.entries()) {
      const shown = new Promise((r) => {
        v.requestVideoFrameCallback(() => r())
        setTimeout(r, 2000)
      })
      v.currentTime = t
      await new Promise((r) => (v.onseeked = r))
      await shown
      g.drawImage(v, (k % cols) * 180, Math.floor(k / cols) * 320, 180, 320)
      g.fillStyle = '#fff'
      g.font = '600 16px sans-serif'
      g.fillText(`${t.toFixed(1)} s`, (k % cols) * 180 + 8, Math.floor(k / cols) * 320 + 20)
    }
    document.body.replaceChildren(c)
    return { duration: v.duration, width: v.videoWidth, height: v.videoHeight }
  }, '/out/ohmic-tiktok.mp4')
  await page.screenshot({ path: join(OUT, 'contact.png') })
  console.log(`plays back: ${info.width}×${info.height}, ${info.duration.toFixed(2)} s`)
}
