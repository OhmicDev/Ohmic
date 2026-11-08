// Phase 10: moving data between devices, translations, theme colours, and the protocol log.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { addCatalog, translate } from '../i18n'
import { contrastRatio, darken } from '../lib/color'
import { ACCENTS, useSettings } from './settings'
import { db } from './db'
import { exportAll, importAll, readExport } from './dataTransfer'
import { LIGHT_ACCENT_KEEP, resolveTheme } from '../ui/theme'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
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
    useSettings.setState({ units: 'imperial', ai: { ...useSettings.getState().ai, accessCode: 'secret' } })

    const file = await exportAll('Ohmic test')
    const text = JSON.stringify(file)
    expect(text).not.toContain('secret')

    // A fresh device.
    await Promise.all(db.tables.map((t) => t.clear()))
    useSettings.setState({ units: 'metric', ai: { ...useSettings.getState().ai, accessCode: 'mine' } })
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
    expect(useSettings.getState().ai.accessCode).toBe('mine')

    // Importing the same file again adds nothing new.
    const again = await importAll(readExport(text))
    expect(again.added).toBe(0)
    expect(again.skipped).toBe(1)
    expect(await db.backups.count()).toBe(1)
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
      const c = darken(a.value, LIGHT_ACCENT_KEEP)
      for (const surface of ['#ffffff', '#f4f6f8', '#f3f5f8', '#e8ecf1']) expect(contrastRatio(c, surface)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
