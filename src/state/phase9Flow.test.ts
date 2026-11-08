// Phase 9 (advanced tools) against the simulated scooter: LispBM scripts, packages
// and their settings, the BMS, IMU calibration and the CAN monitor.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { qCompress, qCompressStored, qUncompress } from '../lib/qcompress'
import { demoPackages } from '../packages/demoPackages'
import { readRcc, writeRcc } from '../packages/rcc'
import { packVescPackage, unpackVescPackage } from '../packages/vescpkg'
import { BufferReader } from '../protocol/buffer'
import { cellSummary, decodeBmsValues, encodeBmsValues, hasBms } from '../protocol/bms'
import { CAN_MODE, describeVescFrame, parseCanId, parseHexBytes, type CanFrame } from '../protocol/can'
import { decodeLispStats, encodeLispStats, lispStorageBlob, packLispProgram, parseLispStorage, unpackLispProgram } from '../protocol/lisp'
import { MockBus } from '../sim/mockBus'
import { MockTransport } from '../transport/MockTransport'
import { useConfig } from './config'
import { useCustomConfig, customKey } from './customConfig'
import { db } from './db'
import { useLisp } from './lisp'
import { packagesFromArchive, usePackages } from './packages'
import { activeClient, connectWith, useSession } from './session'
import { useSettings } from './settings'
import { runWrites } from './writes'

async function waitFor(check: () => boolean, timeoutMs = 6000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const LOCAL = 'uuid:5e1a00000000000000000001'
const lisp = () => useLisp.getState()
const pkgs = () => usePackages.getState()

async function connect({ parked = true } = {}) {
  const bus = new MockBus()
  bus.sim.parked = parked
  bus.sim.rideTime = 4.5
  await connectWith(new MockTransport({ bus, connectDelayMs: 5, latencyMs: [1, 2] }))
  await waitFor(() => useConfig.getState().devices[LOCAL]?.appconf.status === 'ready')
  await waitFor(() => useSession.getState().link === 'ok')
  if (parked) await waitFor(() => bus.sim.speed === 0)
  // Let a fresh poll confirm the wheels are still.
  await new Promise((r) => setTimeout(r, 150))
  return bus
}

beforeEach(async () => {
  useSettings.setState({ autoReconnect: false, pollHz: 20, deviceViews: {} })
  useLisp.setState({ lines: [], busy: null, error: null, notice: null, stats: {}, target: 'local' })
  usePackages.setState({ installed: {}, busy: null, error: null, notice: null, demo: [], files: [] })
  useCustomConfig.setState({ configs: {} })
  await db.packageBackups.clear()
})

afterEach(async () => {
  await useSession.getState().disconnect()
})

describe('formats', () => {
  it('packs a LispBM script the way VESC Tool does, with size and CRC first', () => {
    const program = packLispProgram('(print "hi")')
    expect([...program.subarray(0, 2)]).toEqual([0, 0])
    expect(program.at(-3)).toBe(0) // end of code
    const blob = lispStorageBlob(program)
    expect(new BufferReader(blob).u32()).toBe(program.length - 2)
    expect(parseLispStorage(blob)).toEqual(program)
    expect(unpackLispProgram(program)).toEqual({ code: '(print "hi")', imports: 0 })
    const bad = blob.slice()
    bad[8] ^= 1
    expect(() => parseLispStorage(bad)).toThrow(/checksum/)
    expect(parseLispStorage(new Uint8Array(16).fill(0xff))).toBeNull()
  })

  it('reads LispBM stats', () => {
    const s = decodeLispStats(new BufferReader(encodeLispStats({ cpu: 12.5, heap: 30.25, mem: 8, bindings: [{ name: 'speed', value: 4.5 }] })))
    expect(s.cpu).toBeCloseTo(12.5)
    expect(s.heap).toBeCloseTo(30.25)
    expect(s.bindings).toEqual([{ name: 'speed', value: 4.5 }])
  })

  it('round-trips qCompress, including the simulator’s uncompressed form', async () => {
    const text = new TextEncoder().encode('hello '.repeat(500))
    expect(await qUncompress(await qCompress(text))).toEqual(text)
    expect(await qUncompress(qCompressStored(text))).toEqual(text)
    const big = new Uint8Array(70_000).map((_, i) => i % 251)
    expect(await qUncompress(qCompressStored(big))).toEqual(big)
    await expect(qUncompress(Uint8Array.of(0, 0, 0, 9, 1, 2, 3))).rejects.toThrow(/damaged/)
  })

  it('packs and unpacks .vescpkg files and reads an archive', async () => {
    const [speed, lights] = demoPackages()
    const file = await packVescPackage(lights.pkg)
    const back = await unpackVescPackage(file)
    expect(back.name).toBe('Lights (demo)')
    expect(back.lispData).toEqual(lights.pkg.lispData)
    expect(back.qmlFile).toBe(lights.pkg.qmlFile)
    await expect(unpackVescPackage(Uint8Array.of(1, 2, 3, 4, 5))).rejects.toThrow(/VESC package/)

    const rcc = writeRcc([
      { path: 'vesc_packages/speed/speed.vescpkg', data: await packVescPackage(speed.pkg) },
      { path: 'vesc_packages/lights/lights.vescpkg', data: file },
      { path: 'vesc_packages/lib_util/util.vescpkg', data: await packVescPackage({ ...speed.pkg, name: 'Util' }) },
      { path: 'other/readme.txt', data: new TextEncoder().encode('x') },
    ])
    expect(readRcc(rcc).map((f) => f.path).sort()).toEqual([
      '/other/readme.txt',
      '/vesc_packages/lib_util/util.vescpkg',
      '/vesc_packages/lights/lights.vescpkg',
      '/vesc_packages/speed/speed.vescpkg',
    ])
    const entries = await packagesFromArchive(rcc)
    expect(entries.map((e) => [e.pkg.name, e.pkg.isLibrary])).toEqual([
      ['Lights (demo)', false],
      ['Speed readout (demo)', false],
      ['Util', true],
    ])
    expect(() => readRcc(new Uint8Array(30))).toThrow(/resource/)
  })

  it('reads BMS values, newest fields optional', () => {
    const v = decodeBmsValues(
      new BufferReader(
        encodeBmsValues({
          vTotal: 48.2,
          vCharge: 0,
          current: 3.4,
          currentIc: 3.4,
          ahCount: 1.2,
          whCount: 55,
          cells: [3.701, 3.712, 3.695],
          balancing: [false, true, false],
          temps: [25.5, 26],
          tempIc: 30,
          tempHumSensor: 22,
          humidity: 40,
          tempCellsHighest: 26,
          soc: 0.62,
          soh: 0.98,
          canId: 20,
          ahChargeTotal: 10,
          whChargeTotal: 480,
          ahDischargeTotal: 12,
          whDischargeTotal: 560,
          pressure: null,
          dataVersion: 1,
          status: 'Idle',
        }),
      ),
    )
    expect(v.vTotal).toBeCloseTo(48.2, 5)
    expect(v.cells).toEqual([3.701, 3.712, 3.695])
    expect(v.balancing).toEqual([false, true, false])
    expect(v.soc).toBeCloseTo(0.62)
    expect(v.canId).toBe(20)
    expect(v.status).toBe('Idle')
    expect(hasBms(v)).toBe(true)
    expect(cellSummary(v)).toMatchObject({ minIndex: 2, maxIndex: 1, balancing: 1 })
    expect(cellSummary(v)!.spread).toBeCloseTo(0.017)
  })

  it('names VESC CAN traffic and parses hand-typed frames', () => {
    const f: CanFrame = { id: (9 << 8) | 2, extended: true, data: Uint8Array.of(0, 0, 0x13, 0x88, 0, 105, 0x01, 0xf4) }
    expect(describeVescFrame(f)).toEqual({ sender: 2, type: 9, name: 'STATUS', text: '5000 ERPM · 10.5 A · duty 50.0 %' })
    expect(describeVescFrame({ ...f, extended: false })).toBeNull()
    expect(parseHexBytes('01 02 ff')).toEqual(Uint8Array.of(1, 2, 255))
    expect(parseHexBytes('0102ff')).toEqual(Uint8Array.of(1, 2, 255))
    expect(parseHexBytes('0x01,0x02')).toEqual(Uint8Array.of(1, 2))
    expect(parseHexBytes('zz')).toBeNull()
    expect(parseHexBytes('00 '.repeat(9))).toBeNull()
    expect(parseCanId('0x902', true)).toBe(0x902)
    expect(parseCanId('2048', false)).toBeNull()
    expect(parseCanId('-1', true)).toBeNull()
  })
})

describe('LispBM scripts', () => {
  it('uploads, starts, prints, reads back, reports stats, stops and removes', async () => {
    const bus = await connect()
    const code = '(print "Hello from the test")\n(def answer 42)\n'
    lisp().setCode(code)
    expect(await lisp().upload()).toBe(true)
    expect(bus.local.scripts.storedCode()).toBe(code)
    expect(bus.local.scripts.running).toBe(true)
    await waitFor(() => lisp().lines.some((l) => l.text === 'Hello from the test' && l.kind === 'out'))
    expect(lisp().dirty).toBe(false)

    expect(await lisp().readBack()).toBe(code)

    await lisp().pollStats()
    const st = lisp().stats.local
    expect(st.running).toBe(true)
    expect(st.stats?.bindings).toContainEqual({ name: 'answer', value: 42 })

    expect(await lisp().setRunning(false)).toBe(true)
    expect(bus.local.scripts.running).toBe(false)
    expect(await lisp().removeStored()).toBe(true)
    expect(bus.local.scripts.storedCode()).toBeNull()
    expect(await lisp().readBack()).toBe('')
  })

  it('sends REPL lines through the shared console queue', async () => {
    const bus = await connect()
    await lisp().repl('(+ 1 2)')
    await waitFor(() => lisp().lines.some((l) => l.kind === 'out' && l.text.startsWith('>')))
    expect(lisp().lines.find((l) => l.kind === 'in')?.text).toBe('(+ 1 2)')
    expect(bus.local.lisp.dropped).toBe(0)
  })

  it('refuses to upload while a wheel turns, or a script too big for the controller', async () => {
    const bus = await connect({ parked: false })
    await waitFor(() => bus.sim.speed > 2)
    await new Promise((r) => setTimeout(r, 120))
    lisp().setCode('(print "x")')
    expect(await lisp().upload()).toBe(false)
    expect(lisp().error).toMatch(/turning/)
    expect(bus.local.scripts.erases).toHaveLength(0)
    // Stopping a script is always allowed.
    expect(await lisp().setRunning(false)).toBe(true)

    bus.sim.parked = true
    await waitFor(() => bus.sim.speed === 0, 15000)
    await new Promise((r) => setTimeout(r, 150))
    lisp().setCode(`(def big "${'x'.repeat(132_000)}")`)
    expect(await lisp().upload()).toBe(false)
    expect(lisp().error).toMatch(/room for 131,066/)
  }, 20000)

  it('marks lines that answer Ohmic’s own programs', async () => {
    await connect()
    const { runLisp } = await import('./onboard')
    await runLisp('local', '(list ohm-abs-on 0)')
    expect(lisp().lines.at(-1)?.kind).toBe('ohmic')
  })
})

describe('packages', () => {
  it('installs a package with a screen and settings, edits its settings and removes it', async () => {
    const bus = await connect()
    const [, lights] = demoPackages()
    pkgs().setDemo(demoPackages())
    expect(await pkgs().install(lights, 'local')).toBe(true)
    expect(bus.local.scripts.storedProgram()).toEqual(lights.pkg.lispData)
    expect(bus.local.scripts.hasQml()).toBe(true)
    expect(bus.local.scripts.running).toBe(true)
    // The package registered its settings, and the app re-read the device info.
    const local = useSession.getState().devices.find((d) => d.target === 'local')!
    expect(local.fw?.customConfigCount).toBe(1)
    expect(pkgs().installed.local.matchId).toBe('demo:lights')

    await useCustomConfig.getState().load('local', 0)
    const key = customKey(LOCAL, 0)
    const c = useCustomConfig.getState().configs[key]
    expect(c.status).toBe('ready')
    expect(c.name).toBe('Lights')
    expect(c.defs!.order).toEqual(['lights_mode', 'lights_brightness', 'lights_auto_speed', 'lights_brake_flash'])
    expect(c.device!.lights_brightness).toBeCloseTo(0.8)

    useCustomConfig.getState().edit(key, 'lights_brightness', 0.5)
    const item = useCustomConfig.getState().writeItem(key)!
    expect(item.changes.map((x) => x.name)).toEqual(['lights_brightness'])
    const [outcome] = await runWrites([item], () => {})
    expect(outcome.status).toBe('ok')
    expect(useCustomConfig.getState().configs[key].device!.lights_brightness).toBeCloseTo(0.5)
    const backups = await db.packageBackups.toArray()
    expect(backups).toHaveLength(1)
    expect(backups[0].values.lights_brightness).toBeCloseTo(0.8)

    // Out-of-range values never reach the controller.
    useCustomConfig.getState().edit(key, 'lights_brightness', 1.5)
    const bad = useCustomConfig.getState().writeItem(key)!
    expect(bad.issues.some((i) => i.level === 'error')).toBe(true)

    expect(await pkgs().remove('local')).toBe(true)
    expect(bus.local.scripts.storedProgram()).toBeNull()
    expect(bus.local.scripts.hasQml()).toBe(false)
    expect(useSession.getState().devices.find((d) => d.target === 'local')!.fw?.customConfigCount).toBe(0)
  })

  it('installing a script-only package erases the old screen', async () => {
    const bus = await connect()
    const [speed, lights] = demoPackages()
    await pkgs().install(lights, 'local')
    expect(bus.local.scripts.hasQml()).toBe(true)
    await pkgs().install(speed, 'local')
    expect(bus.local.scripts.hasQml()).toBe(false)
    expect(bus.local.scripts.storedProgram()).toEqual(speed.pkg.lispData)
    await waitFor(() => lisp().lines.some((l) => /Speed: \d/.test(l.text)), 4000)
  })

  it('won’t install a library on its own, or while moving', async () => {
    const bus = await connect({ parked: false })
    const [speed] = demoPackages()
    expect(await pkgs().install({ ...speed, pkg: { ...speed.pkg, isLibrary: true } }, 'local')).toBe(false)
    expect(pkgs().error).toMatch(/library/)
    await waitFor(() => bus.sim.speed > 2)
    await new Promise((r) => setTimeout(r, 120))
    expect(await pkgs().install(speed, 'local')).toBe(false)
    expect(pkgs().error).toMatch(/turning/)
    expect(bus.local.scripts.erases).toHaveLength(0)
  })
})

describe('BMS, IMU and CAN', () => {
  it('reads the BMS through the controller', async () => {
    await connect()
    const v = await activeClient()!.bmsValues()
    expect(v.cells).toHaveLength(13)
    expect(v.soc).toBeGreaterThan(0)
    expect(hasBms(v)).toBe(true)
    // Parked, so the high cells balance.
    expect(v.balancing.some(Boolean)).toBe(true)
  })

  it('calibrates the IMU', async () => {
    await connect()
    const cal = await activeClient()!.imuCalibration(90)
    expect(cal).toHaveLength(9)
    expect(cal[2]).toBeCloseTo(90)
  })

  it('monitors CAN in comm-bridge mode and sends frames', async () => {
    const bus = await connect()
    const client = activeClient()!
    const frames: CanFrame[] = []
    const off = client.onCanFrame((f) => frames.push(f))
    await client.setCanMode(CAN_MODE.COMM_BRIDGE)
    expect(bus.canMode).toBe(CAN_MODE.COMM_BRIDGE)
    await waitFor(() => frames.some((f) => describeVescFrame(f)?.name === 'STATUS'))
    expect(frames.every((f) => (f.id & 0xff) === 2)).toBe(true)
    await client.sendCanFrame({ id: (17 << 8) | 2, extended: true, data: Uint8Array.of(254) })
    await waitFor(() => frames.some((f) => describeVescFrame(f)?.name === 'PONG'))
    await client.setCanMode(CAN_MODE.VESC)
    // Frames already on their way still arrive; after that, nothing.
    await new Promise((r) => setTimeout(r, 100))
    const n = frames.length
    await new Promise((r) => setTimeout(r, 300))
    expect(frames.length).toBe(n)
    off()
  })
})
