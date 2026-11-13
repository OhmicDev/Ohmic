// App settings: saved settings, data export and import, translations and theme colours.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addCatalog, translate } from '../i18n'
import { contrastRatio } from '../lib/color'
import { ACCENTS, useSettings } from './settings'
import { db } from './db'
import { exportAll, importAll, readExport } from './dataTransfer'
import { lightAccent, resolveTheme } from '../ui/theme'

// Settings saved by an older version, with the removed tuning assistant's settings. Node has no
// localStorage, so this stands in for it before the settings store loads.
vi.hoisted(() => {
  const saved = new Map([['ohmic.settings', JSON.stringify({ state: { logRateHz: 20, ai: { enabled: true, accessCode: 'old' } }, version: 1 })]])
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => saved.set(k, v),
    removeItem: (k: string) => saved.delete(k),
  })
})

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('saved settings', () => {
  it('loads settings from an older version and drops the ones this version no longer has', () => {
    expect(useSettings.getState().logRateHz).toBe(20)
    expect(useSettings.getState()).not.toHaveProperty('ai')
  })
})

describe('data export and import', () => {
  it('round-trips records, binary data and settings, and merges without duplicates', async () => {
    await db.backups.add({
      createdAt: 1000,
      reason: 'manual',
      title: 'Manual backup',
      changes: [],
      kind: 'mcconf',
      deviceUuid: 'u1',
      deviceName: 'SIM',
      hwName: 'SIM',
      fw: '6.06',
      signature: 1,
      raw: Uint8Array.of(1, 2, 3, 250),
      values: { l_current_max: 60 },
    } as never)
    await db.rides.put({ id: 'r1', startedAt: 5, endedAt: 9, name: 'Loop', source: 'recorded', demo: true, fileName: null, rateHz: 10, rows: 3, chunks: 1, hasGps: false } as never)
    await db.rideChunks.put({ rideId: 'r1', seq: 0, rows: 3, cols: { speed: Float32Array.of(1.5, 2.5, 3.5) } } as never)
    await db.drafts.put({ id: 'lisp', text: '(print 1)', name: null, savedAt: 3 })
    useSettings.setState({ units: 'imperial' })

    const file = await exportAll('Ohmic test')
    const text = JSON.stringify(file)

    // A fresh device.
    await Promise.all(db.tables.map((t) => t.clear()))
    useSettings.setState({ units: 'metric' })
    const plan = readExport(text)
    expect(plan.rides).toBe(1)
    expect(plan.backups).toBe(1)
    const res = await importAll(plan)
    expect(res.added).toBe(4)

    const b = (await db.backups.toArray())[0] as unknown as { raw: Uint8Array; values: Record<string, number> }
    expect(b.raw).toBeInstanceOf(Uint8Array)
    expect([...b.raw]).toEqual([1, 2, 3, 250])
    const chunk = (await db.rideChunks.get(['r1', 0])) as unknown as { cols: { speed: Float32Array } }
    expect(chunk.cols.speed).toBeInstanceOf(Float32Array)
    expect([...chunk.cols.speed]).toEqual([1.5, 2.5, 3.5])
    expect(useSettings.getState().units).toBe('imperial')

    // Importing the same file again adds nothing new.
    const again = await importAll(readExport(text))
    expect(again.added).toBe(0)
    expect(again.skipped).toBe(1)
    expect(await db.backups.count()).toBe(1)
  })

  it('imports a file from an older version, skipping tables and settings this version no longer has', async () => {
    useSettings.setState({ units: 'metric' })
    const old = {
      format: 'ohmic-data',
      version: 1,
      app: 'Ohmic 0.9',
      exportedAt: 1,
      settings: { units: 'imperial', ai: { enabled: true, shareLive: true, shareRides: true, shareFaults: true, accessCode: '' } },
      tables: {
        drafts: [{ id: 'lisp', text: '(print 1)', name: null, savedAt: 3 }],
        aiLog: [{ id: 1, at: 2, proposalId: 'p1', event: 'applied' }],
        aiProfile: [{ id: 'vehicle', type: 'scooter' }],
      },
    }
    const plan = readExport(JSON.stringify(old))
    expect(plan.counts).toEqual({ drafts: 1 })
    const res = await importAll(plan)
    expect(res.added).toBe(1)
    expect(await db.drafts.get('lisp')).toMatchObject({ text: '(print 1)' })
    expect(useSettings.getState().units).toBe('imperial')
    expect(useSettings.getState()).not.toHaveProperty('ai')
  })

  it('rejects files that aren’t Ohmic data', () => {
    expect(() => readExport('not json')).toThrow(/isn’t an Ohmic data file/)
    expect(() => readExport('{"format":"other"}')).toThrow(/isn’t an Ohmic data file/)
    expect(() => readExport('{"format":"ohmic-data","version":99,"tables":{}}')).toThrow(/newer version/)
  })
})

describe('translations', () => {
  it('falls back to English and fills in values', () => {
    addCatalog('xx', { 'nav.ride': 'Fahren' })
    expect(translate('xx', 'nav.ride')).toBe('Fahren')
    expect(translate('xx', 'nav.live')).toBe('Live')
    expect(translate('en', 'intro.step', { n: 2, total: 3 })).toBe('Step 2 of 3')
  })
})

describe('theme', () => {
  it('follows the device when set to automatic', () => {
    expect(resolveTheme('system', true)).toBe('light')
    expect(resolveTheme('system', false)).toBe('dark')
    expect(resolveTheme('light', false)).toBe('light')
  })

  it('keeps every accent readable on the light theme’s surfaces', () => {
    for (const a of ACCENTS) {
      const c = lightAccent(a.value)
      for (const surface of ['#ffffff', '#f5f5f7', '#f2f2f4', '#e8e8ec']) expect(contrastRatio(c, surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps every accent readable on the dark theme, as text and under the dark text of a button', () => {
    for (const a of ACCENTS) {
      for (const surface of ['#050505', '#0e0e0f', '#151516', '#1d1d1f']) expect(contrastRatio(a.value, surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio('#050505', a.value)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
