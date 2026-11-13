import { expect, test } from '@playwright/test'
import { closeConnectSheet, go, openApp, skipIntro } from './helpers'

test('a first visit home shows the front page; Open Ohmic goes to Ride and Connect, and home opens there after', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/welcome$/)
  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { level: 1 })).toContainText('in your browser')
  await expect(page.getByRole('contentinfo')).toContainText('not affiliated with or endorsed by the VESC project')
  await expect(main.getByRole('heading', { name: 'Made for riders', level: 2 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Open Ohmic' }).first().click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('dialog', { name: 'Connect your controller' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Welcome to Ohmic' })).toHaveCount(0)
  await closeConnectSheet(page)
  await expect(page.getByRole('heading', { name: 'Ride', level: 1 })).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL(/\/$/)
  await closeConnectSheet(page)
  await expect(page.getByRole('heading', { name: 'Ride', level: 1 })).toBeVisible()

  // It stays one link away.
  await go(page, '/more')
  await page.getByRole('main').getByRole('link', { name: 'What Ohmic is' }).click()
  await expect(page).toHaveURL(/\/welcome$/)
})

test('the intro shows once, credits VESC, and can be shown again', async ({ page }) => {
  await page.goto('/more')
  const intro = page.getByRole('dialog', { name: 'Welcome to Ohmic' })
  await expect(intro).toBeVisible()
  await expect(intro).toContainText('builds on the work of the VESC project')
  await intro.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('dialog', { name: 'Connect' })).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()
  await skipIntro(page)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'More', level: 1 })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Welcome to Ohmic' })).toHaveCount(0)
  await closeConnectSheet(page)

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'More' }).click()
  await page.getByRole('main').getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Show the intro again' }).click()
  await expect(page.getByRole('dialog', { name: 'Welcome to Ohmic' })).toBeVisible()
})

test('the Connect sheet comes up when the app opens; the demo is hidden unless asked for', async ({ page }) => {
  await page.goto('/setup')
  await page.getByRole('dialog', { name: 'Welcome to Ohmic' }).getByRole('button', { name: 'Skip' }).click()
  const sheet = page.getByRole('dialog', { name: 'Connect your controller' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^Bluetooth/ })).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^USB cable/ })).toBeVisible()
  await expect(sheet.getByRole('button', { name: /Demo scooter/ })).toHaveCount(0)
  await closeConnectSheet(page)

  // The header button brings it back.
  await page.getByRole('banner').getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(sheet).toBeVisible()
  await closeConnectSheet(page)

  // Switched off in Settings, it stays away the next time the app opens.
  await go(page, '/settings')
  await page.getByRole('switch', { name: 'Connect when the app opens' }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // ?demo turns the simulated scooter on, for development and tests.
  await page.goto('/connect?demo')
  await expect(page.getByRole('main').getByRole('button', { name: /Demo scooter/ })).toBeVisible()
})

test('keyboard: the Connect sheet takes focus first, then the first Tab is a skip link to the page content', async ({ page }) => {
  await openApp(page, '/more')
  await page.reload()
  // Opening the app without a connection: focus starts in the Connect sheet, and Escape closes it.
  const sheet = page.getByRole('dialog', { name: 'Connect your controller' })
  await expect(sheet).toBeVisible()
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  // With the sheet switched off, a fresh page starts at the skip link.
  await go(page, '/settings')
  await page.getByRole('switch', { name: 'Connect when the app opens' }).click()
  await go(page, '/more')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'More', level: 1 })).toBeVisible()
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => !!document.activeElement?.closest('main'))).toBe(true)
})

test('light theme applies at once and survives a reload', async ({ page }) => {
  await openApp(page, '/settings')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('radio', { name: 'Light' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).toBe('rgb(245, 245, 247)')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await closeConnectSheet(page)
  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('every page has one main heading, and every control a name', async ({ page }) => {
  await openApp(page)
  const routes = ['/', '/live', '/live/faults', '/live/terminal', '/features', '/tune', '/welcome', '/config', '/config/backups', '/more', '/settings', '/connect', '/setup', '/setup/motor', '/setup/input', '/setup/direction', '/setup/battery', '/modes', '/abs', '/regen', '/wheelie', '/sounds', '/control', '/firmware', '/logs', '/lisp', '/packages', '/bms', '/imu', '/can', '/dev/protocol', '/calc']
  const problems: string[] = []
  for (const r of routes) {
    await page.evaluate((p) => {
      history.pushState({}, '', p)
      dispatchEvent(new PopStateEvent('popstate'))
    }, r)
    await expect(page.locator('main h1')).toHaveCount(1)
    const unnamed = await page.evaluate(() => {
      const out: string[] = []
      const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=switch], [role=radio], [role=tab]'
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const r = el.getBoundingClientRect()
        if (!r.width || !r.height || el.closest('[aria-hidden=true]')) continue
        const labelled =
          el.getAttribute('aria-label')?.trim() ||
          el.getAttribute('aria-labelledby') ||
          (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
          el.closest('label')?.textContent?.trim() ||
          el.innerText?.trim() ||
          el.title
        if (!labelled) out.push(el.outerHTML.slice(0, 120))
      }
      return out
    })
    problems.push(...unnamed.map((u) => `${r}: ${u}`))
  }
  expect(problems).toEqual([])
})

test('an unknown address shows a not-found page', async ({ page }) => {
  await openApp(page, '/no-such-page')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await page.getByRole('link', { name: 'Go to Ride' }).click()
  await expect(page.getByRole('heading', { name: 'Ride', level: 1 })).toBeVisible()
})
