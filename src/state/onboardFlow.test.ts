// Programs that run on the controllers (ABS, regen, motor sounds) and the
// lifted-wheel ABS test, end to end against the simulated scooter (two
// controllers: local + CAN 2).
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sleep } from '../lib/time'
import { BUILT_IN_TUNES } from '../onboard/music'
import { REGEN_DEFAULTS } from '../onboard/regen'
import { CAN2, connectBoth, LOCAL, rpm } from '../test/simulator'
import { waitForWithin } from '../test/waitFor'
import { resetAbsTest, startAbsTest, stopAbsTest, useAbsTest } from './absTest'
import { regenPlan, useAbs, useMusic, useRegen } from './onboard'
import { useSession } from './session'
import { useSettings } from './settings'

const waitFor = waitForWithin(5000)

beforeEach(() => {
  useSettings.setState({
    autoReconnect: true,
    pollHz: 20,
    deviceViews: {},
    absArmed: [],
    regenArmed: [],
    soundAmps: 3,
    regen: { ...REGEN_DEFAULTS },
    regenAcknowledged: false,
  })
  useRegen.setState({ status: {}, applied: null, busy: false, step: null, error: null })
})

afterEach(async () => {
  await useSession.getState().disconnect()
})

describe('ABS', () => {
  it('starts on every controller, proves it runs, and stops', { timeout: 30_000 }, async () => {
    const bus = await connectBoth()
    expect(await useAbs.getState().turnOn()).toBe(true)
    expect(useAbs.getState().error).toBeNull()
    expect(bus.sim.absFor(0)?.on).toBe(true)
    expect(bus.sim.absFor(1)?.on).toBe(true)
    expect(useSettings.getState().absArmed).toEqual([LOCAL, CAN2])
    // The console's gap between commands was kept on both controllers.
    expect(bus.local.lisp.dropped).toBe(0)
    expect(bus.remotes.get(2)!.lisp.dropped).toBe(0)

    expect(await useAbs.getState().turnOff()).toBe(true)
    expect(bus.sim.absFor(0)).toBeNull()
    expect(bus.sim.absFor(1)).toBeNull()
    expect(useAbs.getState().status[LOCAL]?.on).toBe(false)
  })

  it('refuses to start while moving', async () => {
    const bus = await connectBoth({ parked: false })
    await waitFor(() => rpm(bus, 0) > 1000)
    expect(await useAbs.getState().turnOn()).toBe(false)
    expect(bus.sim.absFor(0)).toBeNull()
  })
})

describe('ABS test with the wheel lifted', () => {
  const win = new EventTarget()
  beforeEach(() => {
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
    useAbsTest.setState({ phase: 'idle', key: null, releases: null, error: null, stopped: false })
  })
  afterEach(() => {
    resetAbsTest()
    vi.unstubAllGlobals()
  })

  it('spins the wheel up, brakes hard and sees ABS step in', { timeout: 30_000 }, async () => {
    const bus = await connectBoth()
    expect(await useAbs.getState().turnOn()).toBe(true)
    await startAbsTest(LOCAL)
    const t = useAbsTest.getState()
    expect(t.error).toBeNull()
    expect(t.stopped).toBe(false)
    expect(t.phase).toBe('done')
    expect(t.releases).toBeGreaterThan(0)
    expect(bus.sim.absFor(0)!.interventions).toBe(t.releases)
    // The wheel is let go afterwards, and ABS is still on.
    await sleep(200)
    expect(rpm(bus, 0)).toBeLessThan(300)
    expect(bus.sim.absFor(0)?.on).toBe(true)
  })

  it('asks for ABS to be on first', async () => {
    await connectBoth()
    await startAbsTest(LOCAL)
    expect(useAbsTest.getState().error).toMatch(/Turn ABS on/)
  })

  it('stops the motor when let go', { timeout: 30_000 }, async () => {
    const bus = await connectBoth()
    expect(await useAbs.getState().turnOn()).toBe(true)
    const running = startAbsTest(LOCAL)
    await waitFor(() => useAbsTest.getState().phase === 'spinning')
    await sleep(300)
    stopAbsTest()
    await running
    expect(useAbsTest.getState()).toMatchObject({ phase: 'done', stopped: true, releases: null })
    await sleep(1500)
    expect(rpm(bus, 0)).toBeLessThan(300)
  })
})

describe('regen', () => {
  it('runs on the throttle’s controller, brakes CAN 2 with it, counts each time, and turns off', { timeout: 40_000 }, async () => {
    const bus = await connectBoth()
    const plan = regenPlan()
    expect('problem' in plan ? plan.problem : null).toBeNull()
    if ('problem' in plan) return
    expect(plan.master.key).toBe(LOCAL)
    expect(plan.followers.map((d) => d.key)).toEqual([CAN2])
    expect(plan.params.followers).toEqual([2])

    expect(await useRegen.getState().turnOn()).toBe(true)
    expect(useRegen.getState().error).toBeNull()
    expect(bus.sim.regenFor(0)?.on).toBe(true)
    expect(useSettings.getState().regenArmed).toEqual([LOCAL])
    expect(bus.local.lisp.dropped).toBe(0)

    // Ride off with the throttle, then let go.
    bus.sim.parked = false
    bus.sim.handInput = { throttle: 0.9, brake: 0 }
    await waitFor(() => bus.sim.speed > 4, 10_000)
    bus.sim.handInput = { throttle: 0, brake: 0 }
    await waitFor(() => bus.sim.valuesFor(0, 1).currentMotor < -3 && bus.sim.valuesFor(1, 2).currentMotor < -3, 3000)
    await useRegen.getState().refresh()
    expect(useRegen.getState().status[LOCAL]?.engagements).toBeGreaterThanOrEqual(1)

    // Off works while moving: it only hands the throttle back.
    expect(await useRegen.getState().turnOff()).toBe(true)
    expect(bus.sim.regenFor(0)).toBeNull()
    expect(useSettings.getState().regenArmed).toEqual([])
  })

  it('won’t turn on while moving', async () => {
    const bus = await connectBoth({ parked: false })
    await waitFor(() => rpm(bus, 0) > 1000)
    expect(await useRegen.getState().turnOn()).toBe(false)
    expect(useRegen.getState().error).toMatch(/turning/)
    expect(bus.sim.regenFor(0)).toBeNull()
  })
})

describe('motor sounds', () => {
  it('sends a tune and stops it', { timeout: 20_000 }, async () => {
    const bus = await connectBoth()
    await waitFor(() => (useSession.getState().devices.length > 0 && bus.local.config ? true : false))
    const tune = BUILT_IN_TUNES.find((t) => t.kind === 'tune') ?? BUILT_IN_TUNES[0]
    expect(await useMusic.getState().play(tune, LOCAL)).toBe(true)
    expect(useMusic.getState().error).toBeNull()
    expect(bus.local.tune).not.toBeNull()
    expect(bus.local.lisp.dropped).toBe(0)
    await useMusic.getState().stop()
    expect(bus.local.tune).toBeNull()
  })
})
