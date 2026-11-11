import { describe, expect, it } from 'vitest'
import { DEFAULT_VEHICLE } from '../../lib/vehicle'
import { useTelemetry, type Dashboard } from '../../state/telemetry'
import { GAUGE_READ, limitsOf, niceCeil, tickStep, toneAt, type GaugeCtx } from './gauges'

const dash: Dashboard = {
  speed: 32,
  erpm: 12_000,
  motorRpm: 800,
  vIn: 50,
  cellV: 3.85,
  soc: 70,
  currentIn: -8,
  currentMotor: 40,
  power: -400,
  duty: 0.6,
  tempMotor: 72,
  tempFet: 40,
  controllers: 2,
  view: 'all',
  faults: [],
  rangeKm: 20,
}

function ctx(mcs: Record<string, number>[] = []): GaugeCtx {
  useTelemetry.getState().clear()
  return { dash, trip: useTelemetry.getState().trip, units: 'metric', vehicle: DEFAULT_VEHICLE, limits: limitsOf(mcs) }
}

const mc = {
  l_current_max: 60,
  l_current_max_scale: 0.5,
  l_current_min: -40,
  l_current_min_scale: 1,
  l_in_current_max: 30,
  l_in_current_min: -10,
  l_max_duty: 0.9,
  l_temp_fet_start: 85,
  l_temp_fet_end: 100,
  l_temp_motor_start: 80,
  l_temp_motor_end: 100,
  l_max_erpm: 100_000,
}

describe('gauge scales', () => {
  it('rounds a range up to a number that reads well', () => {
    expect(niceCeil(37)).toBe(40)
    expect(niceCeil(1200)).toBe(1500)
    expect(niceCeil(0.7)).toBeCloseTo(0.8)
    expect(niceCeil(0)).toBe(1)
    expect(tickStep(40)).toBe(10)
    expect(tickStep(100)).toBe(20)
  })

  it('adds up the limits of the motors in view, and takes the strictest', () => {
    const l = limitsOf([mc, { ...mc, l_max_duty: 0.85, l_temp_fet_start: 70 }])
    expect(l.motorMax).toBe(60)
    expect(l.motorMin).toBe(-80)
    expect(l.batteryMax).toBe(60)
    expect(l.dutyMax).toBe(0.85)
    expect(l.fetStart).toBe(70)
    expect(Number.isNaN(limitsOf([]).motorMax)).toBe(true)
  })
})

describe('gauge readings', () => {
  it('fills to the controller’s limits where they’re known', () => {
    const c = ctx([mc])
    // Motor current: 30 A each way per motor here, so ±30 rounds to the dial's ends.
    const motor = GAUGE_READ.motorCurrent(c)
    expect(motor.max).toBe(30)
    expect(motor.min).toBe(-40)
    // Regen shows below zero.
    expect(GAUGE_READ.batteryCurrent(c).value).toBe(-8)
    expect(GAUGE_READ.batteryCurrent(c).min).toBe(-10)
  })

  it('warns as duty nears its limit and temperatures near the cut-back', () => {
    const c = ctx([mc])
    const duty = GAUGE_READ.duty(c)
    expect(toneAt(duty, 60)).toBe('normal')
    expect(toneAt(duty, 84)).toBe('warn')
    expect(toneAt(duty, 89)).toBe('danger')
    // The motor starts cutting back at 80 °C: 72 is fine, 85 warns, past 90 is danger.
    const motor = GAUGE_READ.motorTemp(c)
    expect(toneAt(motor, 72)).toBe('normal')
    expect(toneAt(motor, 85)).toBe('warn')
    expect(toneAt(motor, 95)).toBe('danger')
  })

  it('falls back to usual values without a controller config', () => {
    const c = ctx()
    expect(GAUGE_READ.motorTemp(c).bands[0].from).toBe(70)
    expect(GAUGE_READ.speed(c).max).toBe(40)
    expect(GAUGE_READ.power(c).value).toBeCloseTo(-0.4)
    // Nothing to show until there's some riding.
    expect(GAUGE_READ.efficiency(c).value).toBeNull()
  })
})
