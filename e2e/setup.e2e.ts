import { expect, test } from '@playwright/test'
import { connectDemo, go } from './helpers'

test('Setup is a main tab, and the dashboard leads a new vehicle through it step by step', async ({ page }) => {
  await connectDemo(page)
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link')).toHaveText(['Ride', 'Setup', 'Live', 'Tune', 'More'])

  // The dashboard offers setup first.
  await go(page, '/')
  const prompt = page.getByRole('region', { name: 'Setup' })
  await expect(prompt).toContainText('Set it up first')
  await prompt.getByRole('link', { name: 'Start setup' }).click()
  await expect(page.getByRole('heading', { name: 'Setup', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Motor detection/ })).toContainText('Start')

  // One step through: the battery, reviewed, written to both controllers and verified.
  await page.getByRole('link', { name: /^Battery/ }).click()
  await page.getByRole('button', { name: 'Review changes' }).click()
  const write = page.getByRole('dialog', { name: /Write \d+ changes to 2 controllers\?/ })
  await write.getByRole('button', { name: 'Park demo scooter' }).click()
  await write.getByRole('button', { name: /Write \d+ changes/ }).click({ timeout: 20_000 })
  const done = page.getByRole('dialog', { name: 'Write finished' })
  await expect(done).toContainText('Written and verified', { timeout: 20_000 })
  await done.getByRole('button', { name: 'Done' }).click()

  // It leads on to the next step, and Setup and the dashboard keep count.
  const finished = page.getByRole('region', { name: 'Battery set up' })
  await expect(finished).toContainText('1 of 4 steps done')
  await expect(finished.getByRole('link', { name: 'Next: Motor detection' })).toBeVisible()
  await finished.getByRole('link', { name: 'Back to Setup' }).click()
  await expect(page.getByText('1 of 4 done')).toBeVisible()
  await expect(page.getByRole('link', { name: /^Battery/ })).toContainText(/Done/)

  await go(page, '/')
  await expect(prompt).toContainText('1 of 4 steps done')
  await expect(prompt.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/setup/motor')
  await prompt.getByRole('button', { name: 'It’s already set up' }).click()
  await expect(prompt).toHaveCount(0)
})

test('Ride settings, Config and its backups belong to Tune; tools and app settings to More', async ({ page }) => {
  await connectDemo(page)
  const tab = (name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name })

  const main = page.getByRole('main')
  await go(page, '/config')
  await expect(tab('Tune')).toHaveAttribute('aria-current', 'page')
  await main.getByRole('link', { name: 'Tune', exact: true }).click()
  await expect(page).toHaveURL(/\/tune$/)
  await expect(main.getByRole('link', { name: /^Ride modes/ })).toBeVisible()
  await expect(main.getByRole('link', { name: /^Backups/ })).toBeVisible()

  // Setup is just the steps for a new build.
  await tab('Setup').click()
  await expect(main.getByRole('link', { name: /^Ride modes/ })).toHaveCount(0)
  await expect(tab('Setup')).toHaveAttribute('aria-current', 'page')
  await tab('More').click()
  await main.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Light' })).toBeVisible()
  await expect(tab('More')).toHaveAttribute('aria-current', 'page')
  await main.getByRole('link', { name: 'More', exact: true }).click()
  await expect(page).toHaveURL(/\/more$/)
})
