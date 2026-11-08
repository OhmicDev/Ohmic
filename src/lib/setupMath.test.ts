import { describe, expect, it } from 'vitest'
import type { ConfigValues } from '../config/types'
import { BufferReader } from '../protocol/buffer'
import {
  decodeDetectArgs,
  decodeTempLimits,
  decodeTempLimitsBody,
  detectResult,
  encodeDetectArgs,
  encodeTempLimits,
  encodeTempLimitsReply,
  type TempLimits,
} from '../protocol/setup'
import { erpmForSpeed, limitsFor, modeIssues, sameLimits, STARTER_MODES, type RideMode } from './rideModes'
import { adcEnds, appToUse, batteryIssues, batterySettings, cellsRange, detectIssues, emptyRange, guessCells, kvFromFlux, ppmEnds, widen, type Range } from './setupMath'

const STOCK: TempLimits = {
  currentMinScale: 1,
  currentMaxScale: 1,
  minErpm: -100000,
  maxErpm: 100000,
  minDuty: 0.005,
  maxDuty: 0.95,
  wattMin: -1500000,
  wattMax: 1500000,
  inCurrentMin: -20,
  inCurrentMax: 30,
}
const MC: ConfigValues = { si_motor_poles: 30, si_gear_ratio: 1, si_wheel_diameter: 0.254 }
const eco = STARTER_MODES.find((m) => m.id === 'eco')!
const range = (...vs: number[]): Range => vs.reduce(widen, emptyRange())

describe('ride mode limits', () => {
  it('scales the stored limits and caps speed', () => {
    const l = limitsFor(STOCK, MC, eco, true, 2)
    expect(l.currentMaxScale).toBeCloseTo(0.5, 6)
    expect(l.currentMinScale).toBeCloseTo(0.7, 6)
    expect(l.inCurrentMax).toBeCloseTo(15, 6)
    expect(l.maxErpm).toBeCloseTo(erpmForSpeed(20, MC), 6)
    expect(l.minErpm).toBeCloseTo(-erpmForSpeed(20, MC), 6)
    expect(erpmForSpeed(20, MC)).toBeCloseTo(6266, 0)
    expect(l.wattMax).toBe(STOCK.wattMax)
  })

  it('leaves everything alone with no mode, and splits a power cap between driving motors', () => {
    expect(limitsFor(STOCK, MC, null, true, 2)).toEqual(STOCK)
    const capped: RideMode = { ...eco, maxPowerW: 2000 }
    expect(limitsFor(STOCK, MC, capped, true, 2).wattMax).toBe(1000)
    expect(limitsFor(STOCK, MC, capped, true, 1).wattMax).toBe(2000)
  })

  it('lets a motor switched off in single-motor mode roll freely', () => {
    const off = limitsFor(STOCK, MC, null, false, 1)
    expect(off.currentMaxScale).toBe(0)
    expect(off.currentMinScale).toBe(0)
    expect(off.inCurrentMax).toBe(STOCK.inCurrentMax)
  })

  it('refuses out-of-range values instead of clamping them', () => {
    expect(modeIssues(eco)).toEqual([])
    expect(modeIssues({ ...eco, motorPct: 150 })).toHaveLength(1)
    expect(modeIssues({ ...eco, maxSpeedKmh: NaN })[0]).toMatch(/number/)
    expect(modeIssues({ ...eco, name: ' ' })[0]).toMatch(/name/)
  })

  it('compares limits as 32-bit floats would round them', () => {
    expect(sameLimits(STOCK, { ...STOCK, maxErpm: 100000.4 })).toBe(true)
    expect(sameLimits(STOCK, { ...STOCK, currentMaxScale: 0.5 })).toBe(false)
    expect(sameLimits(STOCK, { ...STOCK, inCurrentMax: NaN })).toBe(true)
  })
})

describe('temporary limit messages', () => {
  it('round-trips the set message, with and without the battery pair', () => {
    const body = encodeTempLimits({ ...STOCK, currentMaxScale: 0.5 })
    const back = decodeTempLimitsBody(body)
    expect(back.store).toBe(false)
    expect(back.ack).toBe(true)
    expect(back.currentMaxScale).toBeCloseTo(0.5, 5)
    expect(back.minErpm).toBeCloseTo(-100000, 0)
    expect(back.inCurrentMax).toBeCloseTo(30, 4)
    const short = decodeTempLimitsBody(body.subarray(0, body.length - 8))
    expect(short.inCurrentMin).toBeNaN()
    expect(short.wattMax).toBeCloseTo(1500000, -1)
  })

  it('reads the get reply with the wheel setup', () => {
    const r = decodeTempLimits(new BufferReader(encodeTempLimitsReply(STOCK, { motorPoles: 30, gearRatio: 1, wheelDiameter: 0.254 })))
    expect(r.motorPoles).toBe(30)
    expect(r.wheelDiameter).toBeCloseTo(0.254, 5)
    expect(r.inCurrentMin).toBeCloseTo(-20, 4)
  })
})

describe('motor detection', () => {
  it('round-trips its arguments', () => {
    const args = { detectCan: true, maxPowerLoss: 75, minCurrentIn: -10, maxCurrentIn: 25, openloopErpm: 700, sensorlessErpm: 2000 }
    expect(decodeDetectArgs(encodeDetectArgs(args))).toEqual(args)
  })

  it('explains the result codes', () => {
    expect(detectResult(1)).toMatchObject({ ok: true, sensor: 'hall' })
    expect(detectResult(0)).toMatchObject({ ok: true, sensor: 'sensorless' })
    expect(detectResult(2)).toMatchObject({ ok: true, sensor: 'encoder' })
    const flux = detectResult(-10)
    expect(flux.ok).toBe(false)
    const fault = detectResult(-96)
    expect(!fault.ok && fault.message).toMatch(/fault/)
  })

  it('works out KV from flux linkage', () => {
    expect(kvFromFlux(0.02178, 30)).toBeCloseTo(60 / (2 * Math.PI * Math.sqrt(3) * 0.02178 * 15), 6)
    expect(kvFromFlux(0, 30)).toBeNull()
    expect(kvFromFlux(0.02, 0)).toBeNull()
  })

  it('refuses unsafe settings', () => {
    const ok = { maxPowerLoss: 75, minCurrentIn: -10, maxCurrentIn: 25, openloopErpm: 700, sensorlessErpm: 2000 }
    expect(detectIssues(ok)).toEqual([])
    expect(detectIssues({ ...ok, maxPowerLoss: 5000 })).toHaveLength(1)
    expect(detectIssues({ ...ok, minCurrentIn: 5 })).toHaveLength(1)
    expect(detectIssues({ ...ok, maxCurrentIn: NaN })).toHaveLength(1)
  })
})

describe('battery wizard', () => {
  it('works out cut-offs and splits battery current between controllers', () => {
    const v = batterySettings({ kind: 'liion', cells: 13, ah: 15, maxDischargeA: 50, maxChargeA: 12 }, 2)
    expect(v).toEqual({
      si_battery_type: 0,
      si_battery_cells: 13,
      si_battery_ah: 15,
      l_battery_cut_start: 44.2,
      l_battery_cut_end: 40.3,
      l_in_current_max: 25,
      l_in_current_min: -6,
    })
  })

  it('leaves current limits alone when not given', () => {
    const v = batterySettings({ kind: 'lifepo4', cells: 16, ah: 20, maxDischargeA: null, maxChargeA: null }, 1)
    expect(v.si_battery_type).toBe(1)
    expect('l_in_current_max' in v).toBe(false)
  })

  it('refuses impossible packs and guesses cells from voltage', () => {
    expect(batteryIssues({ kind: 'liion', cells: 13.5, ah: 15, maxDischargeA: null, maxChargeA: null })).toHaveLength(1)
    expect(batteryIssues({ kind: 'liion', cells: 13, ah: 0, maxDischargeA: null, maxChargeA: null })).toHaveLength(1)
    expect(guessCells(48, 'liion')).toBe(13)
    expect(guessCells(0, 'liion')).toBeNull()
  })

  it('gives the cell counts a voltage could mean, since charge level changes it', () => {
    expect(cellsRange(52.6, 'liion')).toEqual([13, 15])
    expect(cellsRange(54.6, 'liion')).toEqual([13, 16])
    expect(cellsRange(4.1, 'liion')).toEqual([1, 1])
    expect(cellsRange(0, 'liion')).toBeNull()
  })
})

describe('throttle calibration', () => {
  it('finds the ends with a small dead band', () => {
    expect(adcEnds(range(0.84, 0.86), range(0.85, 3.05))).toEqual({ start: 0.938, end: 2.962 })
  })

  it('handles levers whose voltage falls when pushed', () => {
    const r = adcEnds(range(3.0, 3.02), range(0.9, 3.0))
    expect(typeof r).toBe('object')
    if (typeof r === 'object') expect(r.start).toBeGreaterThan(r.end)
  })

  it('says why when the lever barely moved', () => {
    expect(adcEnds(range(0.85), range(0.85, 1.0))).toMatch(/only moved/)
    expect(adcEnds(emptyRange(), range(1))).toMatch(/whole travel/)
  })

  it('finds the centre and ends of an RC remote', () => {
    expect(ppmEnds(range(1.49, 1.51), range(1.0, 2.0))).toEqual({ start: 1.02, center: 1.5, end: 1.98 })
    expect(ppmEnds(range(1.5), range(1.5, 2.0))).toMatch(/both ends/)
  })

  it('keeps UART running next to the new input', () => {
    expect(appToUse('adc', 0)).toBe(2)
    expect(appToUse('adc', 3)).toBe(5)
    expect(appToUse('ppm', 5)).toBe(4)
    expect(appToUse('ppm', 2)).toBe(1)
  })
})
