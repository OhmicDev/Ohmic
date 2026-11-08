import { describe, expect, it } from 'vitest'
import { speedPerErpm } from '../../lib/rideModes'
import { DEFAULT_VEHICLE, speedKmh } from '../../lib/vehicle'
import { MAX_SPIN_KMH, SPOKES, spinRate, wheelKmh } from './wheelSpin'

describe('wheel spin drawing', () => {
  it('stands still when the wheel is stopped or barely creeping', () => {
    expect(spinRate(0)).toBe(0)
    expect(spinRate(0.3)).toBe(0)
    expect(spinRate(-0.3)).toBe(0)
    expect(spinRate(Number.NaN)).toBe(0)
  })

  it('turns faster with speed, and backwards when the wheel goes backwards', () => {
    expect(spinRate(20)).toBeGreaterThan(spinRate(10))
    expect(spinRate(10)).toBeGreaterThan(0)
    expect(spinRate(-10)).toBe(-spinRate(10))
  })

  it('never turns so far in one frame that the spokes seem to run backwards', () => {
    expect(spinRate(MAX_SPIN_KMH + 50)).toBe(spinRate(MAX_SPIN_KMH))
    const halfGap = 360 / SPOKES / 2
    // Even at 30 frames a second, the slowest a phone is likely to draw.
    expect(Math.abs(spinRate(200)) / 30).toBeLessThan(halfGap)
  })

  it('uses each controller’s own wheel settings, else the vehicle setup', () => {
    const mc = { si_motor_poles: 30, si_wheel_diameter: 0.254, si_gear_ratio: 1 }
    const fromController = wheelKmh(5000, speedPerErpm(mc), DEFAULT_VEHICLE)
    expect(fromController).toBeCloseTo(speedKmh(5000, DEFAULT_VEHICLE), 6)
    const bigWheel = wheelKmh(5000, speedPerErpm({ ...mc, si_wheel_diameter: 0.508 }), DEFAULT_VEHICLE)
    expect(bigWheel).toBeCloseTo(fromController * 2, 6)
    expect(wheelKmh(-5000, Number.NaN, DEFAULT_VEHICLE)).toBeCloseTo(-speedKmh(5000, DEFAULT_VEHICLE), 6)
  })
})
