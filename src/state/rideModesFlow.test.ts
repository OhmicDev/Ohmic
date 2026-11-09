// Ride modes and the single/dual motor switch, end to end against the simulated
// scooter (two controllers: local + CAN 2).
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MockBus } from '../sim/mockBus'
import { CAN2, LOCAL } from '../test/simulator'
import { waitForWithin } from '../test/waitFor'
import { MockTransport } from '../transport/MockTransport'
import { db, listBackups } from './backups'
import { pendingCount, useConfig } from './config'
import { useRideModes } from './rideModes'
import { connectWith, useSession } from './session'
import { useSettings } from './settings'
import { planWrite, runWrites } from './writes'

const waitFor = waitForWithin(5000)
const cfg = () => useConfig.getState()
const modes = () => useRideModes.getState()
const live = (bus: MockBus, key: string) => (key === LOCAL ? bus.local : bus.remotes.get(2)!).config!.values.mcconf

async function connect({ parked = true } = {}) {
  const bus = new MockBus()
  bus.sim.parked = parked
  bus.sim.rideTime = 4.5
  await connectWith(new MockTransport({ bus, connectDelayMs: 5, latencyMs: [1, 2] }))
  await waitFor(() => cfg().devices[LOCAL]?.appconf.status === 'ready' && cfg().devices[CAN2]?.appconf.status === 'ready')
  await waitFor(() => useSession.getState().link === 'ok')
  await modes().load()
  return bus
}

beforeEach(async () => {
  useSettings.setState({ autoReconnect: true, pollHz: 20, deviceViews: {}, singleMotorKey: null })
  await Promise.all([db.backups.clear(), db.liveLimits.clear(), db.rideModes.clear()])
  useRideModes.setState({ activeId: null, motors: 'dual', busy: false, error: null, loaded: false })
})

afterEach(async () => {
  await useSession.getState().disconnect()
})

describe('ride modes', () => {
  it('applies a mode as temporary limits and keeps the editor on the stored values', async () => {
    const bus = await connect()
    expect(await modes().apply('eco')).toBe(true)
    expect(live(bus, LOCAL).l_current_max_scale).toBeCloseTo(0.5, 5)
    expect(live(bus, CAN2).l_current_max_scale).toBeCloseTo(0.5, 5)
    expect(bus.local.config!.writes).toBe(0) // nothing stored

    // A fresh read sees the mode's limits, but the editor shows what's stored.
    await cfg().read(LOCAL, ['mcconf'])
    expect(cfg().devices[LOCAL].mcconf.device?.l_current_max_scale).toBe(1)
    expect(modes().activeId).toBe('eco')
    expect(await db.liveLimits.count()).toBe(2)
  })

  it('puts the mode aside for a settings write, so it is never stored, then back on', async () => {
    const bus = await connect()
    await modes().apply('eco')
    cfg().edit(LOCAL, 'mcconf', { l_current_max: 70 })
    const outcomes = await runWrites(planWrite(LOCAL, 'mcconf', [])!.items, () => {})
    expect(outcomes.map((o) => o.status)).toEqual(['ok'])
    expect(live(bus, LOCAL).l_current_max).toBe(70)
    expect(live(bus, LOCAL).l_current_max_scale).toBeCloseTo(0.5, 5) // back on after the write
    expect(cfg().devices[LOCAL].mcconf.device?.l_current_max_scale).toBe(1)
    expect(pendingCount(cfg().devices[LOCAL].mcconf)).toBe(0)
    const [backup] = await listBackups({ kind: 'mcconf' })
    expect(backup.values.l_current_max_scale).toBe(1)
  })

  it('switches one motor off for single-motor mode and back', async () => {
    const bus = await connect()
    expect(await modes().apply('eco', 'single')).toBe(true)
    expect(live(bus, LOCAL).l_current_max_scale).toBeCloseTo(0.5, 5)
    expect(live(bus, CAN2).l_current_max_scale).toBe(0)
    expect(live(bus, CAN2).l_current_min_scale).toBe(0)
    expect(await modes().apply(null, 'dual')).toBe(true)
    expect(live(bus, LOCAL).l_current_max_scale).toBe(1)
    expect(live(bus, CAN2).l_current_max_scale).toBe(1)
    expect(await db.liveLimits.count()).toBe(0)
  })

  it('switches modes mid-ride, but not single and dual', async () => {
    const bus = await connect({ parked: false })
    await waitFor(() => Math.abs(bus.sim.valuesFor(0, 1).rpm) > 1000)
    expect(await modes().apply('normal', 'single')).toBe(false)
    expect(modes().error).toMatch(/stop|moving|turn/i)
    modes().clearError()
    expect(await modes().apply('sport')).toBe(true)
    expect(await modes().apply('eco')).toBe(true)
    expect(live(bus, LOCAL).l_current_max_scale).toBeCloseTo(0.5, 5)
  })
})
