// The CAN monitor store against the simulator: it switches the controller to
// comm-bridge mode, records frames, refuses motor commands, and always puts the
// controller's own CAN mode back (on stop, and on the next connection if the link dropped).
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CAN_MODE } from '../protocol/can'
import { MockBus } from '../sim/mockBus'
import { MockTransport } from '../transport/MockTransport'
import { idStats, recentFrames, refusedFrame, useCanMonitor } from './canMonitor'
import { useConfig } from './config'
import { connectWith, useSession } from './session'
import { useSettings } from './settings'

async function waitFor(check: () => boolean, timeoutMs = 6000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const LOCAL = 'uuid:5e1a00000000000000000001'
const mon = () => useCanMonitor.getState()

async function connect(bus = new MockBus(), { parked = true } = {}) {
  bus.sim.parked = parked
  bus.sim.rideTime = 4.5
  await connectWith(new MockTransport({ bus, connectDelayMs: 5, latencyMs: [1, 2] }))
  await waitFor(() => useConfig.getState().devices[LOCAL]?.appconf.status === 'ready')
  await waitFor(() => useSession.getState().link === 'ok')
  if (parked) await waitFor(() => bus.sim.speed === 0)
  await new Promise((r) => setTimeout(r, 150))
  return bus
}

beforeEach(() => {
  useSettings.setState({ autoReconnect: false, pollHz: 20, deviceViews: {} })
  useCanMonitor.setState({ status: 'off', error: null, notice: null, originalMode: null, paused: false })
})

afterEach(async () => {
  await mon().stop()
  await useSession.getState().disconnect()
})

describe('CAN monitor', () => {
  it('starts in comm-bridge mode, records frames and switches back on stop', async () => {
    const bus = await connect()
    expect(bus.canMode).toBe(CAN_MODE.VESC)
    expect(await mon().start()).toBe(true)
    expect(bus.canMode).toBe(CAN_MODE.COMM_BRIDGE)
    expect(mon().originalMode).toBe(CAN_MODE.VESC)
    const v0 = mon().version
    await waitFor(() => idStats().some((s) => s.vesc?.name === 'STATUS'))
    await waitFor(() => mon().version > v0)
    const status = idStats().find((s) => s.vesc?.name === 'STATUS')!
    expect(status.vesc?.sender).toBe(2)
    expect(recentFrames(5).length).toBeGreaterThan(0)
    await mon().stop()
    expect(mon().status).toBe('off')
    expect(bus.canMode).toBe(CAN_MODE.VESC)
    expect(mon().notice).toMatch(/back in its own CAN mode/)
  })

  it('sends frames, but refuses ones that drive a motor or carry commands', async () => {
    await connect()
    await mon().start()
    expect(refusedFrame({ id: (1 << 8) | 2, extended: true, data: new Uint8Array(4) })).toMatch(/drive a motor/)
    expect(refusedFrame({ id: (8 << 8) | 2, extended: true, data: new Uint8Array(4) })).toMatch(/command/)
    expect(refusedFrame({ id: (21 << 8) | 2, extended: true, data: new Uint8Array(8) })).toMatch(/limits/)
    expect(refusedFrame({ id: (63 << 8) | 2, extended: true, data: new Uint8Array(3) })).toMatch(/bus speed/)
    expect(refusedFrame({ id: (17 << 8) | 2, extended: true, data: new Uint8Array(1) })).toBeNull()
    expect(refusedFrame({ id: 0x123, extended: false, data: new Uint8Array(1) })).toBeNull()
    expect(await mon().send({ id: (1 << 8) | 2, extended: true, data: new Uint8Array(4) })).toBe(false)
    expect(mon().error).toMatch(/Motor control/)
    // A ping gets a pong back from controller 2.
    expect(await mon().send({ id: (17 << 8) | 2, extended: true, data: Uint8Array.of(254) })).toBe(true)
    await waitFor(() => idStats().some((s) => s.vesc?.name === 'PONG'))
    expect(idStats().find((s) => s.vesc?.name === 'PING')?.tx).toBe(1)
    expect(recentFrames().some((f) => f.tx)).toBe(true)
  })

  it('won’t start while a wheel turns', async () => {
    const bus = await connect(new MockBus(), { parked: false })
    await waitFor(() => bus.sim.speed > 1)
    await new Promise((r) => setTimeout(r, 120))
    expect(await mon().start()).toBe(false)
    expect(mon().error).toBeTruthy()
    expect(bus.canMode).toBe(CAN_MODE.VESC)
  })

  it('switches back on the next connection when the link dropped mid-monitor', async () => {
    const bus = await connect()
    await mon().start()
    expect(bus.canMode).toBe(CAN_MODE.COMM_BRIDGE)
    await useSession.getState().disconnect()
    expect(mon().status).toBe('off')
    expect(bus.canMode).toBe(CAN_MODE.COMM_BRIDGE) // nothing could be sent
    await connect(bus)
    await waitFor(() => bus.canMode === CAN_MODE.VESC)
    expect(mon().notice).toMatch(/after the last monitor session/)
  })
})
