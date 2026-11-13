// Captures the app footage for the TikTok promo from the demo scooter: phone screens at 3x, short
// frame sequences of the live dashboards and the auto-wheelie, and a desktop window.
// Run with the dev server up (npx vite --port 5199):  node promo/tiktok/capture.mjs
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.APP_URL ?? 'http://localhost:5199'
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots')
const manifest = {}

const seed = (theme) => {
  // First load only: skip the front page and intro, and set the demo up for the wheelie.
  if (localStorage.getItem('promo.seeded')) return
  localStorage.setItem('promo.seeded', '1')
  localStorage.setItem(
    'ohmic.settings',
    JSON.stringify({
      version: 1,
      state: {
        seenWelcome: true,
        onboarded: true,
        theme,
        pollHz: 20,
        keepAwake: false,
        autoConnect: false,
        wheelie: { holdMax: 50, catchMax: 40, target: 10 },
        wheelieHostWheel: 'rear',
        wheelieAcknowledged: true,
      },
    }),
  )
}

async function go(page, path) {
  await page.evaluate((p) => {
    history.pushState({}, '', p)
    dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await page.waitForTimeout(700)
}

async function shot(page, name, opts = {}) {
  const file = `${name}.${opts.type ?? 'png'}`
  await page.screenshot({ path: join(OUT, file), type: opts.type ?? 'png', quality: opts.type === 'jpeg' ? 92 : undefined, clip: opts.clip })
  manifest[name] = { file }
  console.log('  ', file)
}

/** A run of frames a set time apart, for screens that move. */
async function sequence(page, name, count, everyMs, opts = {}) {
  const files = []
  const times = []
  const t0 = Date.now()
  for (let i = 0; i < count; i++) {
    const due = t0 + i * everyMs
    const wait = due - Date.now()
    if (wait > 0) await page.waitForTimeout(wait)
    const file = `${name}-${String(i).padStart(2, '0')}.jpeg`
    times.push((Date.now() - t0) / 1000)
    if (opts.element) await opts.element.screenshot({ path: join(OUT, file), type: 'jpeg', quality: 92 })
    else await page.screenshot({ path: join(OUT, file), type: 'jpeg', quality: 92 })
    files.push(file)
  }
  manifest[name] = { files, times }
  console.log('  ', name, `${count} frames`)
}

/** Clicks through the DOM, so a sticky header or a moving layout can't catch it. */
const tap = (locator) => locator.evaluate((el) => el.click())

async function connect(page) {
  await page.goto(`${BASE}/connect?demo`)
  await page.getByRole('button', { name: /Demo scooter/ }).waitFor()
  await page.waitForTimeout(600)
}

async function phone(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  })
  await ctx.addInitScript(seed, 'dark')
  const page = await ctx.newPage()
  await connect(page)
  await shot(page, 'connect')
  await page.getByRole('button', { name: /Demo scooter/ }).click()
  await page.getByRole('heading', { name: 'Connection', level: 1 }).waitFor()

  // The dashboards, moving.
  await go(page, '/')
  await page.getByRole('button', { name: /already set up/ }).click()
  await page.waitForTimeout(3500)
  await sequence(page, 'gauges', 24, 200)
  await page.getByRole('tab', { name: 'Tiles' }).click()
  await page.waitForTimeout(1500)
  await sequence(page, 'tiles', 16, 220)
  await page.getByRole('tab', { name: 'Focus' }).click()
  await page.waitForTimeout(1500)
  await sequence(page, 'focus', 16, 220)

  await go(page, '/setup')
  await shot(page, 'setup')
  await go(page, '/features')
  await shot(page, 'features')
  await go(page, '/modes')
  await page.waitForTimeout(500)
  await shot(page, 'modes')

  // Tune: every setting, searched, then a write reviewed and verified.
  await go(page, '/config')
  await page.waitForTimeout(800)
  await shot(page, 'tune')
  await page.getByRole('button', { name: 'Park demo scooter' }).first().click()
  const search = page.getByPlaceholder(/^Search \d+ settings/)
  await search.fill('current')
  await page.waitForTimeout(500)
  await shot(page, 'tune-search')
  await search.fill('Motor Current Max')
  const input = page.getByRole('textbox', { name: 'Motor Current Max', exact: true })
  await input.waitFor()
  const before = await input.inputValue()
  await input.fill(Number(before) === 60 ? '61' : '60')
  await input.press('Enter')
  await page.waitForTimeout(300)
  await shot(page, 'tune-edit')
  await page.getByRole('button', { name: /^(Review & write|Write) ?\(1\)$/ }).click()
  const review = page.getByRole('dialog', { name: /Write 1 change/ })
  await review.getByRole('button', { name: 'Write 1 change' }).waitFor()
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('dialog button')].find((x) => x.textContent?.trim() === 'Write 1 change')
    return b && !b.disabled
  }, null, { timeout: 20_000 })
  await page.waitForTimeout(400)
  await shot(page, 'review')
  await review.getByRole('button', { name: 'Write 1 change' }).click()
  const done = page.getByRole('dialog', { name: 'Write finished' })
  await done.getByText('Written and verified').waitFor({ timeout: 20_000 })
  await page.waitForTimeout(400)
  await shot(page, 'verified')
  await done.getByRole('button', { name: 'Done' }).click()
  // Still parked: nothing is installed or armed while a wheel turns. Once armed, the demo rider rides.

  // The auto-wheelie: install, calibrate, arm, and the demo rider's wheelie on the live trace.
  await go(page, '/wheelie')
  console.log('   viewport scale', await page.evaluate(() => [visualViewport.scale, scrollY, innerWidth]))
  await shot(page, 'wheelie-page')
  await tap(page.getByRole('button', { name: 'Install' }))
  await page.getByRole('button', { name: 'Calibrate first' }).waitFor({ timeout: 30_000 })
  await tap(page.getByRole('button', { name: 'Calibrate', exact: true }))
  const cal = page.getByRole('dialog', { name: 'Calibrate the IMU' })
  for (let i = 0; i < 3; i++) {
    await tap(cal.getByRole('button', { name: 'Measure' }))
    await cal.getByRole('button', { name: 'Measure' }).or(cal.getByRole('button', { name: 'Done' })).first().waitFor({ timeout: 20_000 })
    await page.waitForTimeout(600)
  }
  await tap(cal.getByRole('button', { name: 'Done' }))
  await tap(page.getByRole('button', { name: 'Arm', exact: true }).first())
  await page.getByRole('button', { name: 'Disarm' }).first().waitFor({ timeout: 30_000 })
  const live = page.getByRole('region', { name: 'Live' })
  await live.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.evaluate(() => window.scrollBy(0, -70))
  // The demo rider pins it a few seconds after arming; catch it lifting.
  await page.getByText(/^Lifting$|^Holding$/).first().waitFor({ timeout: 30_000 })
  await sequence(page, 'wheelie', 18, 200)
  await sequence(page, 'wheelie-card', 1, 0, { element: live })
  await tap(page.getByRole('button', { name: 'Disarm' }).first())
  await page.waitForTimeout(800)

  // The light theme, for the "your look" beat.
  await go(page, '/settings')
  await page.getByRole('radio', { name: 'Light' }).click()
  await go(page, '/')
  await page.getByRole('tab', { name: 'Tiles' }).click()
  await page.waitForTimeout(1500)
  await shot(page, 'tiles-light', { type: 'jpeg' })
  await go(page, '/settings')
  await page.getByRole('radio', { name: 'Dark' }).click()
  await page.waitForTimeout(300)
  await shot(page, 'settings-look')
  await ctx.close()
}

async function desktop(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' })
  await ctx.addInitScript(seed, 'dark')
  const page = await ctx.newPage()
  await connect(page)
  await page.getByRole('button', { name: /Demo scooter/ }).click()
  await page.getByRole('heading', { name: 'Connection', level: 1 }).waitFor()
  await go(page, '/')
  await page.getByRole('button', { name: /already set up/ }).click()
  await page.getByRole('tab', { name: 'Tiles' }).click()
  await page.waitForTimeout(3000)
  await shot(page, 'desk-tiles', { type: 'jpeg' })
  await go(page, '/config')
  await page.waitForTimeout(1200)
  await shot(page, 'desk-tune', { type: 'jpeg' })
  await ctx.close()
}

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge' })
try {
  console.log('phone')
  await phone(browser)
  console.log('desktop')
  await desktop(browser)
} finally {
  await browser.close()
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
}
