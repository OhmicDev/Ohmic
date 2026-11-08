// Ride modes, ABS, motor sounds, motor detection and motor tests, end to end
// against the simulated scooter (two controllers: local + CAN 2).
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUILT_IN_TUNES } from '../onboard/music'
import { MockBus } from '../sim/mockBus'
import { MockTransport } from '../transport/MockTransport'
import { resetAbsTest, startAbsTest, stopAbsTest, useAbsTest } from './absTest'
import { db, listBackups } from './backups'
import { pendingCount, useConfig } from './config'
import { changedSince, useDetection } from './detection'
import { startMotorTest, stopMotorTest, useMotorTest } from './motorTest'
import { useAbs, useMusic } from './onboard'
import { useRideModes } from './rideModes'
import { connectWith, useSession } from './session'
import { useSettings } from './settings'
import { planWrite, runWrites } from './writes'

async function waitFor(check: () => boolean, timeoutMs = 5000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const LOCAL = 'uuid:5e1a00000000000000000001'
const CAN2 = 'uuid:5e1a00000000000000000002'
const cfg = () => useConfig.getState()
const modes = () => useRideModes.getState()
const live = (bus: MockBus, key: string) => (key === LOCAL ? bus.local : bus.remotes.get(2)!).config!.values.mcconf

async function connect({ parked = true } = {}) {
  const bus = new MockBus()
  bus.sim.parked = parked
  bus.sim.rideTime = 4.5
  bus.detectSeconds = 0.3
  await connectWith(new MockTransport({ bus, connectDelayMs: 5, latencyMs: [1, 2] }))
  await waitFor(() => cfg().devices[LOCAL]?.appconf.status === 'ready' && cfg().devices[CAN2]?.appconf.status === 'ready')
  await waitFor(() => useSession.getState().link === 'ok')
  await modes().load()
  return bus
}

beforeEach(async () => {
  useSettings.setState({ autoReconnect: true, pollHz: 20, deviceViews: {}, singleMotorKey: null, absArmed: [], soundAmps: 3 })
  await Promise.all([db.backups.clear(), db.liveLimits.clear(), db.rideModes.clear()])
  useRideModes.setState({ activeId: null, motors: 'dual', busy: false, error: null, loaded: false })
  useDetection.setState({ phase: 'idle', step: null, keys: [], result: null, error: null, note: null, before: [] })
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

describe('ABS', () => {
  it('starts on every controller, proves it runs, and stops', { timeout: 30_000 }, async () => {
    const bus = await connect()
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
    const bus = await connect({ parked: false })
    await waitFor(() => Math.abs(bus.sim.valuesFor(0, 1).rpm) > 1000)
    expect(await useAbs.getState().turnOn()).toBe(false)
    expect(bus.sim.absFor(0)).toBeNull()
  })
})

describe('motor sounds', () => {
  it('sends a tune and stops it', { timeout: 20_000 }, async () => {
    const bus = await connect()
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

describe('motor detection', () => {
  it('backs up, detects both motors over CAN, reads back and keeps the ride mode', { timeout: 30_000 }, async () => {
    const bus = await connect()
    await modes().apply('eco')
    await useDetection.getState().run(
      { detectCan: true, maxPowerLoss: 75, minCurrentIn: -10, maxCurrentIn: 25, openloopErpm: 700, sensorlessErpm: 2000 },
      'local',
      [LOCAL, CAN2],
    )
    const d = useDetection.getState()
    expect(d.error).toBeNull()
    expect(d.note).toBeNull()
    expect(d.result).toMatchObject({ ok: true, sensor: 'hall' })

    // Backups hold the stored settings, not the mode's.
    const backups = (await listBackups({ kind: 'mcconf' })).filter((b) => b.title === 'Before motor detection')
    expect(backups).toHaveLength(2)
    expect(backups.every((b) => b.values.l_current_max_scale === 1)).toBe(true)

    // The editor shows what detection found, and what changed.
    for (const key of [LOCAL, CAN2]) {
      const now = cfg().devices[key].mcconf.device!
      expect(now.foc_motor_r).toBeCloseTo(Number(live(bus, key).foc_motor_r), 6)
      expect(now.foc_sensor_mode).toBe(2)
      expect(now.l_current_max_scale).toBe(1)
      const before = d.before.find((b) => b.key === key)!
      expect(Object.keys(changedSince(before.values, now))).toContain('foc_motor_r')
    }
    // Detection stored stock limits; the mode is back on top.
    expect(modes().activeId).toBe('eco')
    expect(live(bus, LOCAL).l_current_max_scale).toBeCloseTo(0.5, 5)
  })

  it('refuses while the wheels turn, before touching anything', async () => {
    const bus = await connect({ parked: false })
    await waitFor(() => Math.abs(bus.sim.valuesFor(0, 1).rpm) > 1000)
    await useDetection
      .getState()
      .run({ detectCan: false, maxPowerLoss: 75, minCurrentIn: -10, maxCurrentIn: 25, openloopErpm: 700, sensorlessErpm: 2000 }, 'local', [LOCAL])
    expect(useDetection.getState().phase).toBe('done')
    expect(useDetection.getState().error).toMatch(/stop|moving|turn/i)
    expect(await listBackups({ kind: 'mcconf' })).toHaveLength(0)
    expect(bus.sim.detecting(0)).toBe(false)
  })
})

describe('motor test (direction wizard)', () => {
  const win = new EventTarget()
  beforeEach(() => {
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  })
  afterEach(() => {
    stopMotorTest()
    vi.unstubAllGlobals()
  })

  it('turns each wheel while held and shows the one wired backwards', async () => {
    const bus = await connect()
    expect(startMotorTest('local', 1000)).toBeNull()
    expect(useMotorTest.getState().running).toBe('local')
    await sleep(300)
    stopMotorTest()
    expect(useMotorTest.getState().running).toBeNull()
    expect(bus.sim.physicalDirection(0)).toBe(1)

    expect(startMotorTest(2, 1000)).toBeNull()
    await sleep(300)
    stopMotorTest()
    expect(bus.sim.physicalDirection(1)).toBe(-1)
  })

  it('stops when the app loses focus (dead-man)', async () => {
    await connect()
    expect(startMotorTest('local', 1000)).toBeNull()
    win.dispatchEvent(new Event('blur'))
    expect(useMotorTest.getState().running).toBeNull()
  })

  it('refuses a speed out of range', async () => {
    await connect()
    expect(startMotorTest('local', 50_000)).toMatch(/range/)
    expect(useMotorTest.getState().running).toBeNull()
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
    const bus = await connect()
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
    expect(Math.abs(bus.sim.valuesFor(0, 1).rpm)).toBeLessThan(300)
    expect(bus.sim.absFor(0)?.on).toBe(true)
  })

  it('asks for ABS to be on first', async () => {
    await connect()
    await startAbsTest(LOCAL)
    expect(useAbsTest.getState().error).toMatch(/Turn ABS on/)
  })

  it('stops the motor when let go', { timeout: 30_000 }, async () => {
    const bus = await connect()
    expect(await useAbs.getState().turnOn()).toBe(true)
    const running = startAbsTest(LOCAL)
    await waitFor(() => useAbsTest.getState().phase === 'spinning')
    await sleep(300)
    stopAbsTest()
    await running
    expect(useAbsTest.getState()).toMatchObject({ phase: 'done', stopped: true, releases: null })
    await sleep(1500)
    expect(Math.abs(bus.sim.valuesFor(0, 1).rpm)).toBeLessThan(300)
  })
})
