import { describe, expect, it } from 'vitest'
import { VehicleSim } from './vehicleSim'

describe('VehicleSim', () => {
  it('accelerates under throttle and tops out at a sensible speed', () => {
    const sim = new VehicleSim()
    let top = 0
    for (let i = 0; i < 100 * 25; i++) {
      sim.step(0.01)
      top = Math.max(top, sim.speed * 3.6)
    }
    expect(top).toBeGreaterThan(25)
    expect(top).toBeLessThan(50)
  })

  it('keeps battery current steady at top speed (no oscillation)', () => {
    const sim = new VehicleSim()
    // Ride into the cruise/top-speed part of the loop, then sample.
    for (let i = 0; i < 100 * 9; i++) sim.step(0.01)
    const samples: number[] = []
    for (let i = 0; i < 100; i++) {
      sim.step(0.01)
      samples.push(sim.valuesFor(0, 1).currentIn)
    }
    let maxJump = 0
    for (let i = 1; i < samples.length; i++) maxJump = Math.max(maxJump, Math.abs(samples[i] - samples[i - 1]))
    expect(maxJump).toBeLessThan(2)
  })

  it('never lets battery current exceed the limit per controller', () => {
    const sim = new VehicleSim()
    for (let i = 0; i < 100 * 60; i++) {
      sim.step(0.01)
      expect(sim.valuesFor(0, 1).currentIn).toBeLessThanOrEqual(sim.p.batteryCurrentMax + 0.5)
    }
  })
})
