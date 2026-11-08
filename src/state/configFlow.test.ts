import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MockBus } from '../sim/mockBus'
import { MockTransport } from '../transport/MockTransport'
import { db, listBackups } from './backups'
import { pendingCount, useConfig } from './config'
import { connectWith, useSession } from './session'
import { useSettings } from './settings'
import { planWrite, runWrites } from './writes'

async function waitFor(check: () => boolean, timeoutMs = 4000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const LOCAL = 'uuid:5e1a00000000000000000001'
const CAN2 = 'uuid:5e1a00000000000000000002'
const cfg = () => useConfig.getState()

async function connect({ parked = true } = {}) {
  const bus = new MockBus()
  bus.sim.parked = parked
  bus.sim.rideTime = 4.5 // skip the standing start of the scripted ride
  await connectWith(new MockTransport({ bus, connectDelayMs: 5, latencyMs: [1, 2] }))
  await waitFor(() => cfg().devices[LOCAL]?.appconf.status === 'ready' && cfg().devices[CAN2]?.appconf.status === 'ready')
  return bus
}

beforeEach(async () => {
  useSettings.setState({ autoReconnect: true, pollHz: 20, deviceViews: {} })
  await db.backups.clear()
})

afterEach(async () => {
  await useSession.getState().disconnect()
})

describe('config editing and writing', () => {
  it('reads both controllers and fills the vehicle setup from the primary', async () => {
    await connect()
    expect(cfg().order).toEqual([LOCAL, CAN2])
    const mc = cfg().devices[LOCAL].mcconf
    expect(mc.defs?.fw).toBe('6.06')
    expect(mc.device?.l_current_max).toBe(55)
    expect(mc.defaults?.l_current_max).toBe(60)
    expect(useSettings.getState().vehicle).toMatchObject({ motorPoles: 30, wheelDiameterMm: 254, batteryCells: 13 })
  })

  it('keeps edits local with undo and redo until written', async () => {
    const bus = await connect()
    cfg().edit(LOCAL, 'mcconf', { l_current_max: 70 })
    cfg().edit(LOCAL, 'mcconf', { l_in_current_max: 35 })
    expect(pendingCount(cfg().devices[LOCAL].mcconf)).toBe(2)
    cfg().undo(LOCAL, 'mcconf')
    expect(cfg().devices[LOCAL].mcconf.draft?.l_in_current_max).toBe(30)
    cfg().redo(LOCAL, 'mcconf')
    expect(cfg().devices[LOCAL].mcconf.draft?.l_in_current_max).toBe(35)
    expect(bus.local.config?.writes).toBe(0)
    cfg().discard(LOCAL, 'mcconf')
    expect(pendingCount(cfg().devices[LOCAL].mcconf)).toBe(0)
  })

  it('backs up, writes, reads back and confirms; can include the other controller', async () => {
    const bus = await connect()
    await waitFor(() => useSession.getState().link === 'ok')
    cfg().edit(LOCAL, 'mcconf', { l_current_max: 70, foc_motor_r: 0.05 })
    const plan = planWrite(LOCAL, 'mcconf', [CAN2])!
    expect(plan.items.map((i) => i.changes.map((c) => c.name))).toEqual([['l_current_max', 'foc_motor_r'], ['l_current_max']])
    expect(plan.skipped[CAN2]).toEqual(['foc_motor_r'])

    const outcomes = await runWrites(plan.items, () => {})
    expect(outcomes.map((o) => o.status)).toEqual(['ok', 'ok'])
    expect(bus.local.config?.values.mcconf.l_current_max).toBe(70)
    expect(bus.remotes.get(2)?.config?.values.mcconf.l_current_max).toBe(70)
    expect(bus.remotes.get(2)?.config?.values.mcconf.foc_motor_r).toBeCloseTo(0.09, 6)
    expect(pendingCount(cfg().devices[LOCAL].mcconf)).toBe(0)
    expect(pendingCount(cfg().devices[CAN2].mcconf)).toBe(0)

    const backups = await listBackups()
    expect(backups).toHaveLength(2)
    const local = backups.find((b) => b.deviceUuid === '5e1a00000000000000000001')!
    expect(local.title).toBe('Before writing 2 changes')
    expect(local.values.l_current_max).toBe(55) // the state before the write
    const round = (v: unknown) => (typeof v === 'number' ? Number(v.toPrecision(6)) : v)
    expect(local.changes.map((c) => [c.name, round(c.from), round(c.to)])).toEqual([
      ['l_current_max', 55, 70],
      ['foc_motor_r', 0.09, 0.05],
    ])
    expect(local.raw?.length).toBeGreaterThan(400)
  })

  it('reports values the controller stored differently', async () => {
    await connect()
    await waitFor(() => useSession.getState().link === 'ok')
    cfg().edit(LOCAL, 'mcconf', { l_current_max: 140 })
    const [outcome] = await runWrites(planWrite(LOCAL, 'mcconf')!.items, () => {})
    expect(outcome.status).toBe('adjusted')
    if (outcome.status !== 'adjusted') return
    expect(outcome.adjusted).toEqual([{ name: 'l_current_max', wanted: 140, got: 100 }])
    expect(cfg().devices[LOCAL].mcconf.draft?.l_current_max).toBe(100)
  })

  it('stops if the settings changed on the controller since they were read, keeping the edits', async () => {
    const bus = await connect()
    await waitFor(() => useSession.getState().link === 'ok')
    cfg().edit(LOCAL, 'mcconf', { l_in_current_max: 35 })
    bus.local.config!.values.mcconf.l_current_max = 33 // someone else wrote this
    const [outcome] = await runWrites(planWrite(LOCAL, 'mcconf')!.items, () => {})
    expect(outcome.status).toBe('stale')
    expect(bus.local.config?.writes).toBe(0)
    const mc = cfg().devices[LOCAL].mcconf
    expect(mc.device?.l_current_max).toBe(33)
    expect(mc.draft).toMatchObject({ l_current_max: 33, l_in_current_max: 35 })
    expect(await listBackups()).toHaveLength(0)
  })

  it('refuses to write while the motor turns', async () => {
    const bus = await connect({ parked: false })
    await waitFor(() => bus.sim.speed > 1)
    await waitFor(() => useSession.getState().link === 'ok')
    cfg().edit(LOCAL, 'mcconf', { l_current_max: 70 })
    await new Promise((r) => setTimeout(r, 200))
    const [outcome] = await runWrites(planWrite(LOCAL, 'mcconf')!.items, () => {})
    expect(outcome.status).toBe('failed')
    if (outcome.status === 'failed') expect(outcome.error).toMatch(/turning|live data/)
    expect(bus.local.config?.writes).toBe(0)
    expect(pendingCount(cfg().devices[LOCAL].mcconf)).toBe(1)
  })

  it('keeps unwritten edits through a dropped connection', async () => {
    const bus = await connect()
    cfg().edit(LOCAL, 'mcconf', { l_current_max: 66 })
    const t = (await import('./session')).activeClient()!.transport as MockTransport
    t.simulateDrop()
    await waitFor(() => useSession.getState().status === 'reconnecting')
    await waitFor(() => useSession.getState().status === 'connected')
    await waitFor(() => cfg().devices[LOCAL]?.mcconf.status === 'ready' && !!cfg().devices[LOCAL].mcconf.readAt)
    expect(cfg().devices[LOCAL].mcconf.draft?.l_current_max).toBe(66)
    expect(bus.local.config?.writes).toBe(0)
  })

  it('forgets everything on a deliberate disconnect', async () => {
    await connect()
    cfg().edit(LOCAL, 'mcconf', { l_current_max: 66 })
    await useSession.getState().disconnect()
    expect(cfg().order).toEqual([])
  })
})
