import { expect, test } from '@playwright/test'
import { openApp, skipIntro } from './helpers'

test('the intro shows once, credits VESC, and can be shown again', async ({ page }) => {
  await page.goto('/')
  const intro = page.getByRole('dialog', { name: 'Welcome to Ohmic' })
  await expect(intro).toBeVisible()
  await expect(intro).toContainText('builds on the work of the VESC project')
  await intro.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('dialog', { name: 'Connect' })).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()
  await skipIntro(page)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Ride', level: 1 })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'More' }).click()
  await page.getByRole('main').getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Show the intro again' }).click()
  await expect(page.getByRole('dialog', { name: 'Welcome to Ohmic' })).toBeVisible()
})

test('keyboard: the first Tab is a skip link to the page content', async ({ page }) => {
  await openApp(page, '/more')
  await page.reload()
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  const inMain = await page.evaluate(() => !!document.activeElement?.closest('main'))
  expect(inMain).toBe(true)
})

test('light theme applies at once and survives a reload', async ({ page }) => {
  await openApp(page, '/settings')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('radio', { name: 'Light' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).toBe('rgb(244, 246, 248)')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('every page has one main heading, and every control a name', async ({ page }) => {
  await openApp(page)
  const routes = ['/', '/live', '/live/faults', '/live/terminal', '/tune', '/config', '/config/backups', '/more', '/settings', '/connect', '/setup', '/setup/motor', '/setup/input', '/setup/direction', '/setup/battery', '/modes', '/abs', '/regen', '/sounds', '/control', '/firmware', '/logs', '/lisp', '/packages', '/bms', '/imu', '/can', '/dev/protocol', '/calc']
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
