import { expect, test } from '@playwright/test'
import { connectDemo, go } from './helpers'

test('the demo scooter streams live values to Ride and Live', async ({ page }) => {
  await connectDemo(page)
  await go(page, '/')
  // The dashboard opens on its dials.
  const gauges = page.getByRole('region', { name: 'Gauges' })
  await expect(gauges).toBeVisible()
  // The values move: the speed changes within a few seconds of riding.
  const dial = gauges.getByRole('img', { name: /^Speed: / })
  const speed = () => dial.getAttribute('aria-label')
  const first = await speed()
  await expect.poll(speed, { timeout: 8000 }).not.toBe(first)

  await page.getByRole('tab', { name: 'Tiles' }).click()
  await expect(page.getByRole('region', { name: 'Speed and power' })).toBeVisible()
  await expect(page.getByText('Battery current')).toBeVisible()

  await page.getByRole('link', { name: 'Live' }).first().click()
  await expect(page.getByRole('heading', { name: 'Live', level: 1 })).toBeVisible()
})

test('the wheels in the dashboard corner turn with each motor’s speed', async ({ page }) => {
  await connectDemo(page)
  await go(page, '/')
  const corner = page.getByRole('complementary', { name: 'Wheel speeds' })
  await expect(corner).toBeVisible()
  // The demo scooter has two motor controllers: a wheel for each, named the way the device switcher names them.
  await expect(corner.locator('svg')).toHaveCount(2)
  await expect(corner.getByText('Local')).toBeVisible()
  await expect(corner.getByText('CAN 2')).toBeVisible()

  // Once the demo ride gets going, the wheels turn.
  const kmh = async () => Number((await corner.textContent())?.match(/\d+/)?.[0] ?? 0)
  await expect.poll(kmh, { timeout: 10_000 }).toBeGreaterThan(3)
  const turns = () => corner.locator('svg > g').evaluateAll((gs) => gs.map((g) => g.getAttribute('transform')))
  const first = await turns()
  await expect.poll(turns).not.toEqual(first)

  // They belong to the dashboard only.
  await go(page, '/setup')
  await expect(corner).toHaveCount(0)
})

test('on a phone the dashboard is pages on one screen, swiped between and arranged in place', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await connectDemo(page)
  await go(page, '/')
  await page.getByRole('button', { name: /already set up/ }).click()

  // The dials and the ride controls sit above the tab bar, without scrolling.
  const controls = page.getByRole('region', { name: 'Ride controls' })
  await expect(controls.getByRole('radio', { name: 'Eco' })).toBeVisible()
  const tabBar = await page.getByRole('navigation', { name: 'Main' }).last().boundingBox()
  const bottom = await controls.evaluate((el) => el.getBoundingClientRect().bottom)
  expect(bottom).toBeLessThanOrEqual(tabBar!.y)
  await expect(page.getByRole('region', { name: 'Gauges' })).toBeInViewport()

  // On the Tiles page every tile fits too, and the wheels move into the grid instead of floating over it.
  await page.getByRole('tab', { name: 'Tiles' }).click()
  await expect(page.locator('[data-tile]')).toHaveCount(8)
  await expect(page.locator('[data-tile="power"]')).toBeInViewport()
  for (const tile of await page.locator('[data-tile]').all()) expect((await tile.boundingBox())!.y).toBeLessThan(tabBar!.y)
  await expect(page.getByRole('complementary', { name: 'Wheel speeds' })).toHaveCSS('position', 'static')

  // A swipe moves to the next page.
  await page.locator('[data-page]').first().evaluate((el) => el.parentElement!.scrollTo({ left: 2 * el.parentElement!.clientWidth }))
  await expect(page.getByRole('tab', { name: 'Focus' })).toHaveAttribute('aria-selected', 'true')

  // While arranging, a tap on a tile offers to change, move, resize or remove it.
  await page.getByRole('tab', { name: 'Tiles' }).click()
  await page.getByRole('button', { name: 'Customize' }).click()
  await page.locator('[data-tile="duty"]').click()
  await page.getByRole('dialog', { name: 'Tile' }).getByRole('button', { name: 'Remove' }).click()
  await expect(page.locator('[data-tile]')).toHaveCount(7)

  // A tap on a dial changes what it shows.
  await page.getByRole('tab', { name: 'Gauges' }).click()
  await page.locator('[data-gauge="duty"]').click()
  await page.getByRole('dialog', { name: 'Dial' }).getByRole('radio', { name: /^Battery voltage/ }).click()
  await expect(page.locator('[data-gauge="voltage"]')).toBeVisible()
  await expect(page.locator('[data-gauge="duty"]')).toHaveCount(0)

  // Pages turn off in the options.
  await page.getByRole('button', { name: 'Options' }).click()
  await page.getByRole('dialog', { name: 'Customize' }).getByRole('switch', { name: 'Show the Focus page' }).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await ctx.close()
})

test('settings are in tabs: groups, then their sections, and search shows across them', async ({ page }) => {
  await connectDemo(page)
  await go(page, '/config')
  const groups = page.getByRole('tablist', { name: 'Setting groups' })
  await expect(groups.getByRole('tab', { name: 'General', selected: true })).toBeVisible()

  await groups.getByRole('tab', { name: 'FOC' }).click()
  const sections = page.getByRole('tablist', { name: 'FOC sections' })
  await sections.getByRole('tab', { name: 'Hall Sensors' }).click()
  const panel = page.getByRole('tabpanel', { name: 'Hall Sensors' })
  await expect(panel.getByText('Hall Interpolation ERPM')).toBeVisible()

  // Arrow keys move along the row.
  await sections.getByRole('tab', { name: 'Hall Sensors' }).press('ArrowRight')
  await expect(sections.getByRole('tab', { name: 'Encoder', selected: true })).toBeFocused()

  // App settings have their own groups; coming back to Motor lands on the same tab.
  await page.getByRole('tab', { name: 'App' }).click()
  await expect(groups.getByRole('tab', { name: 'PPM' })).toBeVisible()
  await page.getByRole('tab', { name: 'Motor' }).click()
  await expect(sections.getByRole('tab', { name: 'Encoder', selected: true })).toBeVisible()

  // A search lists matches from every tab; Clear goes back to the tabs.
  await page.getByPlaceholder(/^Search \d+ settings/).fill('Motor Current Max')
  await expect(page.getByRole('status').filter({ hasText: /settings? match/ })).toBeVisible()
  await expect(groups.getByRole('tab', { selected: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.getByRole('tabpanel', { name: 'Encoder' })).toBeVisible()
})

test('a settings write: refused while the wheel turns, then reviewed, backed up, written and verified', async ({ page }) => {
  await connectDemo(page)
  await go(page, '/config')
  await page.getByPlaceholder(/^Search \d+ settings/).fill('Motor Current Max')
  const input = page.getByRole('textbox', { name: 'Motor Current Max', exact: true })
  await expect(input).toBeVisible()
  const before = await input.inputValue()

  // A value outside the firmware's range is refused, not clamped.
  await input.fill('9999')
  await input.press('Enter')
  await expect(page.getByText(/Must be between/).first()).toBeVisible()
  await expect(input).toHaveValue('9999')
  await input.press('Escape')
  await expect(input).toHaveValue(before)

  const next = Number(before) === 60 ? '61' : '60'
  await input.fill(next)
  await input.press('Enter')
  await page.getByRole('button', { name: /Review & write/ }).click()

  const dialog = page.getByRole('dialog', { name: 'Write 1 change to the controller?' })
  await expect(dialog).toContainText('Motor Current Max')
  // The demo is riding: the write is held back with the reason shown.
  await expect(dialog.getByText(/is turning .* Stop the wheel/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Write 1 change' })).toBeDisabled()
  // On the demo, the dialog itself offers to park the scooter; once it stops, the write is allowed.
  await dialog.getByRole('button', { name: 'Park demo scooter' }).click()
  await expect(dialog.getByRole('button', { name: 'Write 1 change' })).toBeEnabled({ timeout: 15_000 })
  await dialog.getByRole('button', { name: 'Write 1 change' }).click()
  const done = page.getByRole('dialog', { name: 'Write finished' })
  await expect(done).toContainText('Written and verified', { timeout: 20_000 })
  await done.getByRole('button', { name: 'Done' }).click()

  // The backup made before the write is listed.
  await go(page, '/config/backups')
  await expect(page.getByText(/Before writing/).first()).toBeVisible()
})
