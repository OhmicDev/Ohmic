// The motor setup steps, end to end against the simulated scooter (two
// controllers: local + CAN 2): motor detection, and the wheel direction test.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sleep } from '../lib/time'
import { MockBus } from '../sim/mockBus'
import { CAN2, LOCAL } from '../test/simulator'
import { waitForWithin } from '../test/waitFor'
import { MockTransport } from '../transport/MockTransport'
import { db, listBackups } from './backups'
import { useConfig } from './config'
import { changedSince, useDetection } from './detection'
import { startMotorTest, stopMotorTest, useMotorTest } from './motorTest'
import { useRideModes } from './rideModes'
import { connectWith, useSession } from './session'
import { useSettings } from './settings'

const waitFor = waitForWithin(5000)
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
  useSettings.setState({ autoReconnect: true, pollHz: 20, deviceViews: {}, singleMotorKey: null, absArmed: [] })
  await Promise.all([db.backups.clear(), db.liveLimits.clear(), db.rideModes.clear()])
  useRideModes.setState({ activeId: null, motors: 'dual', busy: false, error: null, loaded: false })
  useDetection.setState({ phase: 'idle', step: null, keys: [], result: null, error: null, note: null, before: [] })
})

afterEach(async () => {
  await useSession.getState().disconnect()
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

describe('motor direction test', () => {
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
