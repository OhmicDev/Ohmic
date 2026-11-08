import { describe, expect, it } from 'vitest'
import { DEFAULT_VEHICLE, packWh, SocEstimator, socFromCellVoltage, speedKmh, tachoToKm } from './vehicle'

const v = { ...DEFAULT_VEHICLE, motorPoles: 30, wheelDiameterMm: 254, gearRatio: 1 }

describe('vehicle math', () => {
  it('converts ERPM to speed', () => {
    // 15 pole pairs, 10" wheel: 1 rev/s of the wheel = 0.798 m/s = 2.873 km/h
    expect(speedKmh(15 * 60, v)).toBeCloseTo(2.873, 2)
  })

  it('applies the gear ratio', () => {
    expect(speedKmh(15 * 60 * 4, { ...v, gearRatio: 4 })).toBeCloseTo(2.873, 2)
  })

  it('converts tachometer counts to distance', () => {
    // one wheel revolution = 6 * 15 counts = 0.798 m
    expect(tachoToKm(90 * 1000, v)).toBeCloseTo(0.798, 2)
  })

  it('maps cell voltage to battery %', () => {
    expect(socFromCellVoltage(4.2, 'liion')).toBe(100)
    expect(socFromCellVoltage(3.74, 'liion')).toBeCloseTo(50)
    expect(socFromCellVoltage(2.9, 'liion')).toBe(0)
    expect(socFromCellVoltage(3.29, 'lifepo4')).toBeCloseTo(60)
  })

  it('computes pack energy', () => {
    expect(packWh({ ...v, batteryCells: 13, batteryAh: 14 })).toBeCloseTo(655.2)
  })

  it('ignores voltage sag under load', () => {
    const est = new SocEstimator()
    const start = est.update(13 * 4.0, 0, 0.1, v)
    // Big current draw makes the voltage dip; the estimate should barely move.
    let soc = start
    for (let i = 0; i < 20; i++) soc = est.update(13 * 3.7, 40, 0.1, v)
    expect(start - soc).toBeLessThan(1)
  })
})
