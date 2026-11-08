import { expect, type Page } from '@playwright/test'

/** Opens the app and closes the first-run intro, which every fresh browser profile sees. */
export async function openApp(page: Page, path = '/') {
  await page.goto(path)
  await skipIntro(page)
}

export async function skipIntro(page: Page) {
  const skip = page.getByRole('dialog', { name: 'Welcome to Ohmic' }).getByRole('button', { name: 'Skip' })
  await skip.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

/** Opens the app and connects to the simulated scooter from the Connect page. */
export async function connectDemo(page: Page) {
  await openApp(page, '/connect')
  await pickDemo(page)
}

/** Connects to the simulated scooter, with the app already open. */
export async function pickDemo(page: Page) {
  if (!page.url().endsWith('/connect')) await go(page, '/connect')
  await page.getByRole('button', { name: /Demo scooter/ }).click()
  await expect(page.getByRole('banner').getByRole('link', { name: /^Demo/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Connection', level: 1 })).toBeVisible()
}

/**
 * In-app navigation. A full page load would drop the connection, the same as closing the tab,
 * so this goes through the router the way a link does.
 */
export async function go(page: Page, path: string) {
  await page.evaluate((p) => {
    history.pushState({}, '', p)
    dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[/$]/g, '\\$&')}$`))
}

/** The demo scooter rides a loop; most writes need it parked. */
export async function parkDemo(page: Page) {
  const park = page.getByRole('button', { name: 'Park demo scooter' })
  await park.first().click()
  await expect(page.getByRole('button', { name: 'Resume demo ride' }).first()).toBeVisible()
}
