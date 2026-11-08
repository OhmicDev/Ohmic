// Bench motor control, firmware updates and regen, end to end against the
// simulated scooter (two controllers: local + CAN 2).
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REGEN_DEFAULTS } from '../onboard/regen'
import { COMM } from '../protocol/commands'
import { MockBus } from '../sim/mockBus'
import { MockTransport } from '../transport/MockTransport'
import { db, listBackups } from './backups'
import { useConfig } from './config'
import { batteryProblem, cancelUpdate, planArchive, planFile, startUpdate, updateBlock, updateCandidates, useFirmware } from './firmware'
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
import { regenPlan, useRegen } from './onboard'
import { connectWith, useSession } from './session'
import { DEFAULT_BENCH_LIMITS, useSettings, type LatchSeconds } from './settings'
import { useTelemetry } from './telemetry'

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
const mc = () => useMotorControl.getState()

async function connect({ parked = true } = {}) {
  const bus = new MockBus()
  bus.sim.parked = parked
  bus.sim.rideTime = 4.5
  await connectWith(new MockTransport({ bus, connectDelayMs: 5, latencyMs: [1, 2] }))
  await waitFor(() => cfg().devices[LOCAL]?.appconf.status === 'ready' && cfg().devices[CAN2]?.appconf.status === 'ready')
  await waitFor(() => useSession.getState().link === 'ok')
  await waitFor(() => !!useTelemetry.getState().devices.local && !!useTelemetry.getState().devices.can2)
  return bus
}

/** Bytes that pass as firmware for the demo's hardware. */
function image(size: number, seed = 3): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size)
  let x = seed
  for (let i = 0; i < size; i++) out[i] = i % 7 === 0 ? 0xff : (x = (Math.imul(x, 1103515245) + 12345) >>> 0) >>> 24
  out.set(new TextEncoder().encode('\0org.vesc.75_100\0'), 1000)
  return out
}

const rpm = (bus: MockBus, motor: number) => Math.abs(bus.sim.valuesFor(motor, motor + 1).rpm)

const win = new EventTarget()

beforeEach(async () => {
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  useSettings.setState({
    autoReconnect: true,
    pollHz: 20,
    deviceViews: {},
    singleMotorKey: null,
    absArmed: [],
    regenArmed: [],
    benchLimits: { ...DEFAULT_BENCH_LIMITS },
    latchSeconds: 10,
    regen: { ...REGEN_DEFAULTS },
    regenAcknowledged: false,
  })
  await Promise.all([db.backups.clear(), db.liveLimits.clear(), db.rideModes.clear()])
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
  useFirmware.setState({ running: false, cancelling: false, jobs: [], error: null, finishedAt: null })
  useRegen.setState({ status: {}, applied: null, busy: false, step: null, error: null })
})

afterEach(async () => {
  stopControl()
  await useSession.getState().disconnect()
  vi.unstubAllGlobals()
})

describe('motor control on the bench', () => {
  it('spins the lifted wheel while running and lets it go on stop', async () => {
    const bus = await connect()
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
    await connect()
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
    const bus = await connect({ parked: false })
    await waitFor(() => rpm(bus, 0) > 1000)
    setControlKey(LOCAL)
    setLifted(true)
    expect(startControl()).toMatch(/turning/)
    setMode('brake')
    expect(startControl()).toBeNull()
    expect(mc().run?.mode).toBe('brake')
  })

  it('runs again straight away while the wheel still coasts from a run here', async () => {
    const bus = await connect()
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
    await connect()
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
    const bus = await connect()
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
    const bus = await connect()
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

describe('firmware update', () => {
  it('updates CAN 2, then the controller on the cable, to 7.00 and checks both', { timeout: 60_000 }, async () => {
    const bus = await connect()
    const list = updateCandidates()
    expect(list.map((c) => c.version)).toEqual(['6.06', '6.06'])
    const jobs = planArchive(list, { version: '7.00', file: 'VESC_default.bin' })
    expect(jobs.map((j) => j.problem)).toEqual([null, null])
    expect(updateBlock(jobs)).toBeNull()

    const img = image(40_000)
    const urls: string[] = []
    await startUpdate(jobs, {
      source: 'archive',
      fetcher: async (url) => {
        urls.push(url)
        return new Response(img.slice())
      },
    })
    const f = useFirmware.getState()
    expect(f.error).toBeNull()
    expect(f.jobs.map((j) => [j.target, j.phase, j.after])).toEqual([
      [2, 'done', '7.00'],
      ['local', 'done', '7.00'],
    ])
    expect(f.jobs.every((j) => j.settingsReset)).toBe(true)
    expect(urls).toHaveLength(1) // the same build for both, downloaded once
    expect(bus.remotes.get(2)!.installed.at(-1)).toEqual(img)
    expect(bus.local.installed.at(-1)).toEqual(img)
    // Both settings of both controllers were saved first.
    expect((await listBackups()).filter((b) => b.reason === 'before-update')).toHaveLength(4)
    await waitFor(() => useSession.getState().status === 'connected' && useSession.getState().fw?.major === 7, 15_000)
    expect(useSession.getState().busy).toBeNull()
  })

  it('installs a custom file on one controller, which keeps reporting its version', { timeout: 30_000 }, async () => {
    const bus = await connect()
    const can2 = updateCandidates().filter((c) => c.target === 2)
    const img = image(20_000, 9)
    await startUpdate(planFile(can2, 'my-build.bin'), { source: 'file', file: img })
    const [job] = useFirmware.getState().jobs
    expect(useFirmware.getState().error).toBeNull()
    expect(job).toMatchObject({ phase: 'done', after: '6.06', settingsReset: false })
    expect(bus.remotes.get(2)!.installed).toEqual([img])
    expect(bus.local.installed).toEqual([])
  })

  it('won’t start while moving or on a low battery', async () => {
    const bus = await connect({ parked: false })
    await waitFor(() => rpm(bus, 0) > 1000)
    const list = updateCandidates()
    expect(updateBlock(planArchive(list, { version: '7.00', file: 'VESC_default.bin' }))).toMatch(/turning/)

    const c = list.find((x) => x.target === 'local')!
    const v = useTelemetry.getState().devices.local.vIn
    const near = { ...c, config: { ...c.config!, mcconf: { ...c.config!.mcconf, device: { ...c.config!.mcconf.device!, l_battery_cut_start: v - 0.5 } } } }
    expect(batteryProblem(near)).toMatch(/cut-off/)
    expect(batteryProblem({ ...c, key: 'can99' })).toMatch(/No battery reading/)
    useTelemetry.setState((s) => ({ devices: { ...s.devices, local: { ...s.devices.local, vIn: 5 } } }))
    expect(batteryProblem(c)).toMatch(/USB power alone/)
  })

  it('cancelling while writing leaves every controller on its firmware', { timeout: 30_000 }, async () => {
    const bus = await connect()
    const jobs = planArchive(updateCandidates(), { version: '7.00', file: 'VESC_default.bin' })
    const run = startUpdate(jobs, { source: 'archive', fetcher: async () => new Response(image(150_000)) })
    await waitFor(() => useFirmware.getState().jobs.some((j) => j.phase === 'writing'))
    cancelUpdate()
    await run
    const f = useFirmware.getState()
    expect(f.error).toMatch(/Cancelled/)
    expect(f.jobs.map((j) => j.phase)).toEqual(['skipped', 'skipped'])
    expect(bus.remotes.get(2)!.installed).toEqual([])
    expect(bus.local.installed).toEqual([])
    expect(useSession.getState().busy).toBeNull()
  })

  it('says so when a controller restarts on its old firmware', { timeout: 30_000 }, async () => {
    const bus = await connect()
    // Its bootloader refuses the image (as an old one does with a compressed image).
    const dev = bus.remotes.get(2)!
    const handle = dev.handle.bind(dev)
    dev.handle = (payload) => {
      if (payload[0] === COMM.JUMP_TO_BOOTLOADER && dev.updateArea) dev.updateArea[10] ^= 0xff
      return handle(payload)
    }
    const jobs = planArchive(
      updateCandidates().filter((c) => c.target === 2),
      { version: '7.00', file: 'VESC_default.bin' },
    )
    await startUpdate(jobs, { source: 'archive', fetcher: async () => new Response(image(20_000)) })
    const [job] = useFirmware.getState().jobs
    expect(job.phase).toBe('failed')
    expect(job.error).toMatch(/old firmware \(6\.06\)/)
    expect(useFirmware.getState().error).toMatch(/old firmware/)
    expect(dev.installed).toEqual([])
    expect(dev.fw.major).toBe(6)
  })
})

describe('regen', () => {
  it('runs on the throttle’s controller, brakes CAN 2 with it, counts each time, and turns off', { timeout: 40_000 }, async () => {
    const bus = await connect()
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
    const bus = await connect({ parked: false })
    await waitFor(() => rpm(bus, 0) > 1000)
    expect(await useRegen.getState().turnOn()).toBe(false)
    expect(useRegen.getState().error).toMatch(/turning/)
    expect(bus.sim.regenFor(0)).toBeNull()
  })
})
