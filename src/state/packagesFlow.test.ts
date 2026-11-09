// VESC packages: .vescpkg files and archives, and installing, configuring and
// removing one on the simulated scooter.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { demoPackages } from '../packages/demoPackages'
import { readRcc, writeRcc } from '../packages/rcc'
import { packVescPackage, unpackVescPackage } from '../packages/vescpkg'
import { connectLocal, LOCAL } from '../test/simulator'
import { waitForWithin } from '../test/waitFor'
import { useCustomConfig, customKey } from './customConfig'
import { db } from './db'
import { useLisp } from './lisp'
import { packagesFromArchive, usePackages } from './packages'
import { useSession } from './session'
import { useSettings } from './settings'
import { runWrites } from './writes'

const waitFor = waitForWithin(6000)
const lisp = () => useLisp.getState()
const pkgs = () => usePackages.getState()

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

describe('package files', () => {
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
})

describe('installing packages', () => {
  it('installs a package with a screen and settings, edits its settings and removes it', async () => {
    const bus = await connectLocal()
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
    const bus = await connectLocal()
    const [speed, lights] = demoPackages()
    await pkgs().install(lights, 'local')
    expect(bus.local.scripts.hasQml()).toBe(true)
    await pkgs().install(speed, 'local')
    expect(bus.local.scripts.hasQml()).toBe(false)
    expect(bus.local.scripts.storedProgram()).toEqual(speed.pkg.lispData)
    await waitFor(() => lisp().lines.some((l) => /Speed: \d/.test(l.text)), 4000)
  })

  it('won’t install a library on its own, or while moving', async () => {
    const bus = await connectLocal({ parked: false })
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
