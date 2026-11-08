import { expect, test } from '@playwright/test'
import { closeConnectSheet, go, openApp, pickDemo } from './helpers'

test('after one visit the app works offline, except the parts that need the internet', async ({ page, context }) => {
  await openApp(page)
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  // The first visit installs the service worker; from the next load on it serves the app.
  await page.reload()
  await closeConnectSheet(page)
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true)

  await context.setOffline(true)
  await page.reload()
  await closeConnectSheet(page)
  await expect(page.getByRole('heading', { name: 'Ride', level: 1 })).toBeVisible()
  await expect(page.getByText(/You’re offline\. Everything works except firmware downloads/)).toBeVisible()

  // Pages that load on demand are cached too.
  await page.getByRole('link', { name: 'More' }).first().click()
  await page.getByRole('link', { name: /Calculators/ }).click()
  await expect(page.getByRole('heading', { name: 'Calculators', level: 1 })).toBeVisible()

  // So is the Tune tab.
  await page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Tune' }).click()
  await expect(page.getByRole('heading', { name: 'Tune', level: 1 })).toBeVisible()

  // The demo scooter, settings and tools need no network.
  await pickDemo(page)
  await go(page, '/config')
  await expect(page.getByPlaceholder(/^Search \d+ settings/)).toBeVisible()

  await context.setOffline(false)
  await expect(page.getByText(/You’re offline/)).toHaveCount(0)
})
