import { expect, test } from '@playwright/test'
import { connectDemo, go, parkDemo } from './helpers'

test('LispBM: upload and run a script, read its console and stats, stop it', async ({ page }) => {
  await connectDemo(page)
  await go(page, '/lisp')
  await parkDemo(page)
  await page.getByRole('button', { name: 'Upload and run' }).click()
  await expect(page.getByText(/Uploaded and running/)).toBeVisible({ timeout: 20_000 })
  const consoleLog = page.getByRole('log')
  await expect(consoleLog).toContainText('Hello from LispBM', { timeout: 10_000 })
  await expect(page.getByRole('meter', { name: /CPU use/ })).toBeVisible({ timeout: 10_000 })

  const repl = page.getByRole('textbox', { name: 'LispBM expression' })
  await repl.fill('(+ 1 2)')
  await repl.press('Enter')
  await expect(consoleLog).toContainText('(+ 1 2)')

  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.getByText(/Stopped|not running/i).first()).toBeVisible({ timeout: 10_000 })
})

test('Packages: install a package, write its settings, refuse a bad value, remove it', async ({ page }) => {
  await connectDemo(page)
  await go(page, '/packages')
  await parkDemo(page)
  await page.getByRole('button', { name: /^Lights \(demo\)/ }).click()
  const details = page.getByRole('dialog', { name: 'Lights (demo)' })
  await details.getByRole('button', { name: 'Install' }).click()
  await page.getByRole('dialog', { name: 'Install Lights (demo)?' }).getByRole('button', { name: 'Install' }).click()
  await expect(page.getByText('Installed Lights (demo) on Local.')).toBeVisible({ timeout: 30_000 })

  const panel = page.getByRole('region', { name: 'Lights settings' })
  const brightness = panel.getByRole('textbox', { name: 'Brightness', exact: true })
  await expect(brightness).toBeVisible()
  await brightness.fill('150')
  await brightness.press('Enter')
  await expect(panel.getByText(/Must be between 10 % and 100 %/)).toBeVisible()
  await brightness.press('Escape')

  await brightness.fill('50')
  await brightness.press('Enter')
  await panel.getByRole('button', { name: 'Write 1' }).click()
  const write = page.getByRole('dialog', { name: 'Write 1 change to the controller?' })
  await expect(write).toContainText('Brightness')
  await write.getByRole('button', { name: 'Write 1 change' }).click()
  await expect(page.getByRole('dialog', { name: 'Write finished' })).toContainText('Written and verified', { timeout: 20_000 })
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('region', { name: 'Installed package' }).getByRole('button', { name: 'Remove' }).click()
  await page.getByRole('dialog', { name: 'Remove the package?' }).getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText('Local has no package now.')).toBeVisible({ timeout: 30_000 })
})

test('CAN: the monitor decodes frames, refuses motor and settings frames, and restores the CAN mode', async ({ page }) => {
  await connectDemo(page)
  await go(page, '/can')
  await expect(page.getByRole('cell', { name: 'Motor controller' }).first()).toBeVisible()

  // Starting the monitor changes the controller's CAN mode, so it isn't allowed while riding.
  await expect(page.getByText(/is turning .* Stop the wheel to start the CAN monitor/)).toBeVisible()
  await parkDemo(page)
  await page.getByRole('button', { name: 'Start monitor' }).click()
  await page.getByRole('dialog', { name: 'Start the CAN monitor?' }).getByRole('button', { name: 'Start' }).click()
  await expect(page.getByText('Listening')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('STATUS_5').first()).toBeVisible({ timeout: 10_000 })

  const id = page.getByRole('textbox', { name: /ID \(hex\)/ })
  const data = page.getByRole('textbox', { name: /Data \(hex bytes\)/ })
  await id.fill('0102')
  await data.fill('00 00 10 00')
  await expect(page.getByText(/would drive a motor/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled()
  await id.fill('1502')
  await expect(page.getByText(/changes a controller’s limits/)).toBeVisible()
  await id.fill('1102')
  await data.fill('FE')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('PONG').first()).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.getByText('Monitor stopped. The controller is back in its own CAN mode.')).toBeVisible({ timeout: 10_000 })
})

test('BMS: pack, cells and temperatures', async ({ page }) => {
  await connectDemo(page)
  await go(page, '/bms')
  await expect(page.getByText(/^13 cells/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('heading', { name: 'Temperatures' })).toBeVisible()
  await expect(page.getByRole('meter').first()).toBeVisible()
  await expect(page.getByText('Lowest').first()).toBeVisible()
})

test('IMU: live orientation, calibration measured and written through the review', async ({ page }) => {
  await connectDemo(page)
  await go(page, '/imu')
  await expect(page.getByText('Roll', { exact: true })).toBeVisible()
  await expect(page.getByText(/Stop the wheel to calibrate/)).toBeVisible()
  await parkDemo(page)

  const yaw = page.getByRole('textbox', { name: /Mounting yaw/ })
  await yaw.fill('400')
  await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled()
  await yaw.fill('0')
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('button', { name: 'Review and write' }).click({ timeout: 20_000 })
  const write = page.getByRole('dialog', { name: /Write \d+ changes to the controller\?/ })
  await expect(write).toContainText('imu_conf.rot_roll')
  await write.getByRole('button', { name: /Write \d+ changes/ }).click()
  await expect(page.getByRole('dialog', { name: 'Write finished' })).toContainText('Written and verified', { timeout: 20_000 })
})
