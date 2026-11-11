// The auto-wheelie end to end against the simulated scooter (two controllers:
// local + CAN 2), with the demo controller running the real program: install
// over an existing script (keeping it), calibrate, arm, a wheelie by the demo
// rider, disarm, and removal putting the old script back. Plus the refusals.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sleep } from '../lib/time'
import { UNCALIBRATED } from '../onboard/wheelie'
import { lispStorageBlob, packLispProgram } from '../protocol/lisp'
import type { MockBus } from '../sim/mockBus'
import { connectBoth, LOCAL } from '../test/simulator'
import { useSession } from './session'
import { useSettings } from './settings'
import { useWheelie } from './wheelie'

/** The demo motors take 55 A and brake with 40 A: the defaults ask a little more, so these fit. */
const FITS = { holdMax: 50, catchMax: 40 }

beforeEach(() => {
  useSettings.setState({ wheelie: { ...FITS }, wheelieCal: {}, wheelieHostWheel: 'rear', wheelieAcknowledged: true, absArmed: [], regenArmed: [] })
  useWheelie.setState({ status: null, live: [], busy: false, step: null, progress: null, error: null, notice: null, replace: null, backup: null, armedWith: null, cal: null })
})

afterEach(async () => {
  await useSession.getState().disconnect()
})

/** Puts a script in the local controller's storage, as if the rider had uploaded it. */
function storeOwnScript(bus: MockBus, code: string) {
  const area = new Uint8Array(128 * 1024).fill(0xff)
  area.set(lispStorageBlob(packLispProgram(code)))
  bus.local.scripts.lispArea = area
}

describe('auto-wheelie', () => {
  it('installs over a stored script (keeping it), calibrates, arms, holds a wheelie, disarms and puts the script back', { timeout: 120_000 }, async () => {
    const bus = await connectBoth()
    const own = '(print "my lights")'
    storeOwnScript(bus, own)
    const w = () => useWheelie.getState()

    await w().refresh()
    expect(w().status).toBe('missing')

    // It asks before replacing the rider's script, and changes nothing until then.
    expect(await w().install()).toBe(false)
    expect(w().replace).toMatchObject({ bytes: expect.any(Number), imports: 0 })
    expect(bus.local.scripts.storedCode()).toBe(own)
    expect(await w().install({ replace: true })).toBe(true)
    expect(w().error).toBeNull()
    expect(bus.local.scripts.storedCode()).toContain('(def wl-version ')
    expect(w().backup).not.toBeNull()
    expect(w().status).toMatchObject({ on: false })

    // Not calibrated: it won't arm.
    expect(await w().arm()).toBe(false)
    expect(w().error).toMatch(/Calibrate/)

    w().startCal()
    for (const step of ['level', 'tipped', 'loaded']) {
      expect(w().cal?.step).toBe(step)
      await w().measure()
      expect(w().cal?.error ?? null).toBeNull()
    }
    expect(w().cal?.step).toBe('check')
    // The demo holds the front 12° up for the check.
    await w().peek()
    expect(w().cal?.peek?.pitch).toBeCloseTo(12, 0)
    w().endCal()
    expect(useSettings.getState().wheelieCal[LOCAL]?.zero).toBeGreaterThan(0)

    expect(await w().arm()).toBe(true)
    expect(w().error).toBeNull()
    expect(w().status).toMatchObject({ on: true })
    // The console's gap between commands was kept.
    expect(bus.local.lisp.dropped).toBe(0)

    // The demo rider pins it six seconds after arming; the live data shows the hold.
    const deadline = Date.now() + 25_000
    while (!w().live.some((x) => x.t.state === 3 && x.t.took > 1) && Date.now() < deadline) {
      await w().refresh()
      await sleep(800)
    }
    const held = w().live.filter((x) => x.t.state === 3 && x.t.took > 1)
    expect(held.length).toBeGreaterThan(0)
    expect(held.at(-1)!.t.pitch).toBeGreaterThan(7)
    expect(held.at(-1)!.t.pitch).toBeLessThan(13)

    expect(await w().disarm()).toBe(true)
    expect(w().status).toMatchObject({ on: false })
    expect(await w().uninstall()).toBe(true)
    expect(bus.local.scripts.storedCode()).toBe(own)
    expect(w().backup).toBeNull()
  })

  it('refuses settings the motors can’t take, arming on a full battery, and installing while moving', { timeout: 60_000 }, async () => {
    const bus = await connectBoth()
    const w = () => useWheelie.getState()

    // Most push above the motor's 55 A limit: refused, nothing written.
    useSettings.getState().setWheelie({ holdMax: 60 })
    expect(await w().install()).toBe(false)
    expect(w().error).toMatch(/Most push \(60 A\)/)
    expect(bus.local.scripts.storedCode()).toBeNull()
    useSettings.getState().setWheelie({ holdMax: 50 })

    expect(await w().install()).toBe(true)
    useSettings.getState().setWheelieCal(LOCAL, { ...UNCALIBRATED, at: 1, device: LOCAL })
    // The demo battery is above 45 V: too full for that setting.
    useSettings.getState().setWheelie({ minVolts: 30, maxVolts: 45 })
    expect(await w().arm()).toBe(false)
    expect(w().error).toMatch(/above “Battery too full”/)
    expect(w().status).toMatchObject({ on: false })

    // Riding along: nothing is installed or removed.
    bus.sim.parked = false
    await sleep(3000)
    expect(await w().uninstall()).toBe(false)
    expect(bus.local.scripts.storedCode()).toContain('(def wl-version ')
  })
})
