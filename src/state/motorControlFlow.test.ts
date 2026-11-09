// Bench motor control end to end against the simulated scooter (two
// controllers: local + CAN 2).
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sleep } from '../lib/time'
import { CAN2, connectBoth, LOCAL, rpm } from '../test/simulator'
import { waitForWithin } from '../test/waitFor'
import {
  setControlKey,
  setInput,
  setLatch,
  setLifted,
  setMode,
  startControl,
  stopAll,
  stopControl,
  toggleAlso,
  useMotorControl,
} from './motorControl'
import { useSession } from './session'
import { DEFAULT_BENCH_LIMITS, useSettings, type LatchSeconds } from './settings'
import { useTelemetry } from './telemetry'

const waitFor = waitForWithin(5000)
const mc = () => useMotorControl.getState()

const win = new EventTarget()

beforeEach(() => {
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  useSettings.setState({
    autoReconnect: true,
    pollHz: 20,
    deviceViews: {},
    absArmed: [],
    regenArmed: [],
    benchLimits: { ...DEFAULT_BENCH_LIMITS },
    latchSeconds: 10,
  })
  useMotorControl.setState({
    mode: 'current',
    inputs: { current: '2', duty: '5', rpm: '1000', pos: '90', brake: '3', handbrake: '2' },
    key: null,
    also: [],
    latch: false,
    lifted: false,
    run: null,
    error: null,
    inputError: null,
  })
})

afterEach(async () => {
  stopControl()
  await useSession.getState().disconnect()
  vi.unstubAllGlobals()
})

describe('bench motor control', () => {
  it('spins the lifted wheel while running and lets it go on stop', async () => {
    const bus = await connectBoth()
    setControlKey(LOCAL)
    expect(startControl()).toMatch(/Lift the wheel/)
    setLifted(true)
    setInput('4')
    expect(startControl()).toBeNull()
    expect(mc().run).toMatchObject({ mode: 'current', value: 4, latched: false })
    await waitFor(() => rpm(bus, 0) > 500)
    expect(rpm(bus, 1)).toBeLessThan(50) // the other wheel isn't driven
    stopControl()
    expect(mc().run).toBeNull()
    await sleep(200)
    expect(Math.abs(bus.sim.valuesFor(0, 1).currentMotor)).toBeLessThan(0.5)
  })

  it('refuses a value over the test limit, and keeps the last good one while running', async () => {
    await connectBoth()
    setControlKey(LOCAL)
    setLifted(true)
    setInput('25') // the bench limit is 10 A
    expect(startControl()).toMatch(/over the test limit/)
    expect(mc().run).toBeNull()
    setInput('3')
    expect(startControl()).toBeNull()
    setInput('40')
    expect(mc().inputError).toMatch(/keeps 3/)
    expect(mc().run?.value).toBe(3)
    setInput('5')
    expect(mc().run?.value).toBe(5)
    expect(mc().inputError).toBeNull()
  })

  it('won’t start driving while the wheel turns, but a brake may', async () => {
    const bus = await connectBoth({ parked: false })
    await waitFor(() => rpm(bus, 0) > 1000)
    setControlKey(LOCAL)
    setLifted(true)
    expect(startControl()).toMatch(/turning/)
    setMode('brake')
    expect(startControl()).toBeNull()
    expect(mc().run?.mode).toBe('brake')
  })

  it('runs again straight away while the wheel still coasts from a run here', async () => {
    const bus = await connectBoth()
    setControlKey(LOCAL)
    setLifted(true)
    setInput('4')
    expect(startControl()).toBeNull()
    await waitFor(() => Math.abs(useTelemetry.getState().devices.local.rpm) > 1000)
    stopControl()
    expect(startControl()).toBeNull() // still coasting from that run
    stopControl()
    // Unticking the box ends the bench session: a turning wheel blocks again.
    setLifted(false)
    setLifted(true)
    expect(rpm(bus, 0)).toBeGreaterThan(300)
    expect(startControl()).toMatch(/turning/)
  })

  it('stops on Escape, on losing focus, and when the latch time runs out', async () => {
    await connectBoth()
    setControlKey(LOCAL)
    setLifted(true)
    expect(startControl()).toBeNull()
    win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
    expect(mc().run).toBeNull()

    expect(startControl()).toBeNull()
    win.dispatchEvent(new Event('blur'))
    expect(mc().run).toBeNull()

    useSettings.setState({ latchSeconds: 1 as LatchSeconds })
    setLatch(true)
    expect(startControl()).toBeNull()
    expect(mc().run?.latched).toBe(true)
    await sleep(600)
    expect(mc().run).not.toBeNull() // latched: keeps going with nothing held
    await sleep(700)
    expect(mc().run).toBeNull()
    expect(mc().error).toBeNull()
  })

  it('drives a second controller too, and Stop all stops both', async () => {
    const bus = await connectBoth()
    setControlKey(LOCAL)
    toggleAlso(CAN2)
    setLifted(true)
    setInput('4')
    expect(startControl()).toBeNull()
    expect(mc().run?.keys).toEqual([LOCAL, CAN2])
    await waitFor(() => rpm(bus, 0) > 300 && rpm(bus, 1) > 300)
    stopAll()
    expect(mc().run).toBeNull()
    await sleep(200)
    expect(Math.abs(bus.sim.valuesFor(0, 1).currentMotor)).toBeLessThan(0.5)
    expect(Math.abs(bus.sim.valuesFor(1, 2).currentMotor)).toBeLessThan(0.5)
  })

  it('holds a position, runs on duty cycle, and brakes a spinning wheel', async () => {
    const bus = await connectBoth()
    setControlKey(LOCAL)
    setLifted(true)

    setMode('pos')
    setInput('200')
    expect(startControl()).toBeNull()
    await waitFor(() => Math.abs(bus.sim.valuesFor(0, 1).pidPos - 200) < 0.5)
    // Holding still, as the live data shows, so the next mode may start.
    await waitFor(() => rpm(bus, 0) < 50 && Math.abs(useTelemetry.getState().devices.local.rpm) < 100)
    stopControl()

    setMode('duty')
    setInput('15')
    expect(startControl()).toBeNull()
    await waitFor(() => rpm(bus, 0) > 1000)
    stopControl()

    setMode('brake')
    setInput('5')
    expect(startControl()).toBeNull()
    await waitFor(() => bus.sim.valuesFor(0, 1).currentMotor < -1)
    await waitFor(() => rpm(bus, 0) < 200, 8000)
    stopControl()
  })
})
