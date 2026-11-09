// Firmware updates end to end against the simulated scooter (two controllers:
// local + CAN 2).
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMM } from '../protocol/commands'
import { connectBoth, rpm } from '../test/simulator'
import { waitForWithin } from '../test/waitFor'
import { db, listBackups } from './backups'
import { batteryProblem, cancelUpdate, planArchive, planFile, startUpdate, updateBlock, updateCandidates, useFirmware } from './firmware'
import { useSession } from './session'
import { useSettings } from './settings'
import { useTelemetry } from './telemetry'

const waitFor = waitForWithin(5000)

/** Bytes that pass as firmware for the demo's hardware. */
function image(size: number, seed = 3): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size)
  let x = seed
  for (let i = 0; i < size; i++) out[i] = i % 7 === 0 ? 0xff : (x = (Math.imul(x, 1103515245) + 12345) >>> 0) >>> 24
  out.set(new TextEncoder().encode('\0org.vesc.75_100\0'), 1000)
  return out
}

beforeEach(async () => {
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  useSettings.setState({ autoReconnect: true, pollHz: 20, deviceViews: {}, absArmed: [], regenArmed: [] })
  await db.backups.clear()
  useFirmware.setState({ running: false, cancelling: false, jobs: [], error: null, finishedAt: null })
})

afterEach(async () => {
  await useSession.getState().disconnect()
  vi.unstubAllGlobals()
})

describe('firmware update', () => {
  it('updates CAN 2, then the controller on the cable, to 7.00 and checks both', { timeout: 60_000 }, async () => {
    const bus = await connectBoth()
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
    const bus = await connectBoth()
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
    const bus = await connectBoth({ parked: false })
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
    const bus = await connectBoth()
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
    const bus = await connectBoth()
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
