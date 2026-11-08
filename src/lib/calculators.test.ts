import { describe, expect, it } from 'vitest'
import {
  batteryAmpsFromMotor,
  chargeHours,
  cRate,
  erpmAt,
  fieldProblem,
  gearing,
  horsepower,
  pack,
  pctChange,
  rangeKm,
  topSpeedKmh,
  whatIf,
} from './calculators'

describe('calculators', () => {
  it('refuses out-of-range values instead of trimming them', () => {
    const spec = { label: 'Cells', unit: 'S', min: 1, max: 40, integer: true }
    expect(fieldProblem(spec, '13')).toBeNull()
    expect(fieldProblem(spec, '41')).toBe('Enter 1 to 40 S.')
    expect(fieldProblem(spec, '12.5')).toMatch(/whole/)
    expect(fieldProblem(spec, '')).toMatch(/Enter a value/)
    expect(fieldProblem(spec, 'abc')).toMatch(/number/)
    expect(fieldProblem({ label: 'Ah', unit: 'Ah', min: 0.1, max: 500 }, '2,5')).toBeNull()
  })

  it('works out a pack from its cells', () => {
    const p = pack({ chemistry: 'liion', series: 13, parallel: 4, cellAh: 3.5, cellMaxA: 10 })
    expect(p.fullV).toBeCloseTo(54.6, 6)
    expect(p.nominalV).toBeCloseTo(46.8, 6)
    expect(p.ah).toBeCloseTo(14, 6)
    expect(p.wh).toBeCloseTo(655.2, 6)
    expect(p.maxA).toBe(40)
  })

  it('range, top speed and the ERPM for a speed', () => {
    expect(rangeKm(655, 90, 18)).toBeCloseTo(32.75, 6)
    // 15 rpm/V × 48 V × 95 % = 684 rpm on a 254 mm wheel.
    const v = topSpeedKmh({ volts: 48, kv: 15, wheelMm: 254, gearRatio: 1, maxDutyPct: 95 })
    expect(v).toBeCloseTo((684 * Math.PI * 0.254 * 60) / 1000, 6)
    expect(topSpeedKmh({ volts: 48, kv: 150, wheelMm: 254, gearRatio: 10, maxDutyPct: 95 })).toBeCloseTo(v, 6)
    // Round trip: the ERPM at that speed is KV × V × duty × pole pairs.
    expect(erpmAt(v, 30, 254, 1)).toBeCloseTo(684 * 15, 3)
  })

  it('charge time slows above 80 %', () => {
    expect(chargeHours(14, 2, 20, 80)).toBeCloseTo(4.2, 6)
    expect(chargeHours(14, 2, 20, 100)).toBeCloseTo(4.2 + 2.8, 6)
    expect(chargeHours(14, 2, 90, 100)).toBeCloseTo(1.4, 6)
    expect(chargeHours(14, 2, 80, 50)).toBe(0)
    expect(cRate(7, 14)).toBe(0.5)
  })

  it('gearing and power', () => {
    expect(gearing(14, 42)).toEqual({ ratio: 3, torqueX: 3, speedX: 1 / 3 })
    expect(horsepower(745.7)).toBeCloseTo(1, 6)
    expect(batteryAmpsFromMotor(60, 25)).toBe(15)
  })

  it('what if: more cells, more speed and range', () => {
    const shared = { kv: 15, gearRatio: 1, maxDutyPct: 95, whPerKm: 18, usablePct: 90 }
    const now = whatIf({ chemistry: 'liion', series: 13, ah: 14, wheelMm: 254, batteryA: 40 }, shared)
    const next = whatIf({ chemistry: 'liion', series: 16, ah: 14, wheelMm: 254, batteryA: 40 }, shared)
    expect(next.fullV).toBeCloseTo(67.2, 6)
    expect(pctChange(now.topSpeedKmh, next.topSpeedKmh)).toBeCloseTo((16 / 13 - 1) * 100, 6)
    expect(pctChange(now.wh, next.wh)).toBeCloseTo((16 / 13 - 1) * 100, 6)
    expect(pctChange(now.powerW, next.powerW)).toBeCloseTo((16 / 13 - 1) * 100, 6)
    expect(pctChange(0, 5)).toBeNull()
  })
})
