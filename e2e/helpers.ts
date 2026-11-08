import { expect, type Page } from '@playwright/test'

/**
 * Opens the app as a fresh browser profile does: at home that's the front page, then "Open Ohmic";
 * anywhere else, the first-run intro. Either way the Connect sheet is closed after.
 */
export async function openApp(page: Page, path = '/') {
  await page.goto(path)
  if (path === '/') {
    await expect(page).toHaveURL(/\/welcome$/)
    await page.getByRole('button', { name: 'Open Ohmic' }).first().click()
    await closeConnectSheet(page)
    return
  }
  await skipIntro(page)
}

export async function skipIntro(page: Page) {
  const skip = page.getByRole('dialog', { name: 'Welcome to Ohmic' }).getByRole('button', { name: 'Skip' })
  await skip.click()
  // Then, like VESC Tool, the app offers to connect (except on the Connect page, which already does).
  if (new URL(page.url()).pathname !== '/connect') await closeConnectSheet(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

/** Closes the Connect sheet that comes up whenever the app opens without a connection. */
export async function closeConnectSheet(page: Page) {
  const sheet = page.getByRole('dialog', { name: 'Connect your controller' })
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toHaveCount(0)
}

/** Opens the app and connects to the simulated scooter from the Connect page. */
export async function connectDemo(page: Page) {
  // The demo isn't offered to riders; ?demo turns it on for the visit.
  await openApp(page, '/connect?demo')
  await pickDemo(page)
}

/** Connects to the simulated scooter, with the app already open. */
export async function pickDemo(page: Page) {
  await page.evaluate(() => sessionStorage.setItem('ohmic.demo', '1'))
  if (new URL(page.url()).pathname !== '/connect') await go(page, '/connect')
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
