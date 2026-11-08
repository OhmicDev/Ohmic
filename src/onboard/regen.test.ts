import { describe, expect, it } from 'vitest'
import { VehicleSim } from '../sim/vehicleSim'
import { MAX_CMD } from './lisp'
import {
  parseRegenStatus,
  REGEN_DEFAULTS,
  REGEN_MIN_SPEED,
  REGEN_STOP_PROGRAM,
  regenInit,
  regenSettingsProblem,
  regenStartCommands,
  regenStep,
  throttleSource,
  type RegenParams,
} from './regen'

const P: RegenParams = {
  speedPerErpm: 0.001, // 10 000 ERPM = 10 m/s
  amps: 20,
  rampS: 0.5,
  fadeSpeed: 8 / 3.6,
  minSpeed: REGEN_MIN_SPEED,
  delayS: 0.1,
  input: 0,
  lever: true,
  followers: [2],
}

function run(s = regenInit(), p = P, steps = 1, x = { throttle: 0, lever: 0, erpm: 8000, outputDisabled: false }) {
  let out: number | null = null
  for (let i = 0; i < steps; i++) out = regenStep(s, p, x)
  return out
}

describe('regen logic', () => {
  it('does nothing until the throttle has been used', () => {
    const s = regenInit()
    expect(run(s, P, 200)).toBeNull()
    expect(s.engagements).toBe(0)
  })

  it('starts after the delay once the throttle is let go, and builds up over the ramp', () => {
    const s = regenInit()
    run(s, P, 5, { throttle: 0.6, lever: 0, erpm: 8000, outputDisabled: false })
    expect(run(s, P, 10)).toBeNull() // within the 0.1 s delay
    const first = run(s, P, 1)!
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(2)
    expect(run(s, P, 49)).toBeCloseTo(20, 5) // full after 0.5 s
    expect(s.engagements).toBe(1)
  })

  it('fades out at low speed and stops below 2 km/h, disarming until the throttle is used again', () => {
    const s = regenInit()
    run(s, P, 5, { throttle: 0.6, lever: 0, erpm: 8000, outputDisabled: false })
    run(s, P, 100)
    const mid = (P.fadeSpeed + P.minSpeed) / 2 / P.speedPerErpm
    expect(run(s, P, 1, { throttle: 0, lever: 0, erpm: mid, outputDisabled: false })).toBeCloseTo(10, 0)
    expect(run(s, P, 1, { throttle: 0, lever: 0, erpm: 400, outputDisabled: false })).toBeNull()
    expect(s.armed).toBe(false)
    expect(run(s, P, 50)).toBeNull()
  })

  it('hands back at once to the throttle or the brake lever', () => {
    const s = regenInit()
    run(s, P, 5, { throttle: 0.6, lever: 0, erpm: 8000, outputDisabled: false })
    run(s, P, 100)
    expect(run(s, P, 1, { throttle: 0.2, lever: 0, erpm: 8000, outputDisabled: false })).toBeNull()
    run(s, P, 100)
    expect(run(s, P, 1, { throttle: 0, lever: 0.3, erpm: 8000, outputDisabled: false })).toBeNull()
    expect(s.engagements).toBe(2)
    // PPM: pulling back on the stick is the brake.
    const ppm = { ...P, input: 1 as const, lever: false }
    const t = regenInit()
    run(t, ppm, 5, { throttle: 0.6, lever: 0, erpm: 8000, outputDisabled: false })
    expect(run(t, ppm, 30)).toBeGreaterThan(0)
    expect(run(t, ppm, 1, { throttle: -0.4, lever: 0, erpm: 8000, outputDisabled: false })).toBeNull()
  })

  it('leaves the motor alone while something else has taken over the input app', () => {
    const s = regenInit()
    run(s, P, 5, { throttle: 0.6, lever: 0, erpm: 8000, outputDisabled: false })
    expect(run(s, P, 100, { throttle: 0, lever: 0, erpm: 8000, outputDisabled: true })).toBeNull()
  })
})

describe('regen on the controller', () => {
  it('sends short commands, stopping any earlier run first', () => {
    const cmds = regenStartCommands(P, 4242)
    expect(cmds[0]).toBe(REGEN_STOP_PROGRAM)
    for (const c of cmds) expect(c.length).toBeLessThanOrEqual(MAX_CMD)
    const all = cmds.join(' ')
    expect(all).toContain("(def ohm-gc '(2))")
    expect(all).toContain('(app-disable-output 60)')
    expect(all).toContain('(canset-brake i ohm-gi)')
    expect(all).toContain('(app-disable-output 0)')
    expect(all).toContain('(def ohm-gid 4242)')
    expect(regenStartCommands({ ...P, followers: [] }, 1).join(' ')).toContain('(def ohm-gc nil)')
    // Balanced parentheses in every command.
    for (const c of cmds) expect([...c].reduce((n, ch) => n + (ch === '(' ? 1 : ch === ')' ? -1 : 0), 0)).toBe(0)
  })

  it('reads the status, including never started', () => {
    expect(parseRegenStatus('> (1 3 1200 4242)')).toEqual({ on: true, engagements: 3, beat: 1200, runId: 4242 })
    expect(parseRegenStatus('***\tEval error: variable_not_bound\n***\tSymbol: ohm-regen-on')?.on).toBe(false)
    expect(parseRegenStatus('')).toBeNull()
  })

  it('finds the throttle input it can work with', () => {
    expect(throttleSource({ app_to_use: 5, 'app_adc_conf.ctrl_type': 8, 'app_adc_conf.multi_esc': 1 })).toMatchObject({ input: 0, lever: true, multi: true })
    expect(throttleSource({ app_to_use: 2, 'app_adc_conf.ctrl_type': 1, 'app_adc_conf.multi_esc': 0 })).toMatchObject({ input: 0, lever: false, multi: false })
    expect(throttleSource({ app_to_use: 2, 'app_adc_conf.ctrl_type': 2 })).toHaveProperty('problem')
    expect(throttleSource({ app_to_use: 1, 'app_ppm_conf.ctrl_type': 3, 'app_ppm_conf.multi_esc': 1 })).toMatchObject({ input: 1 })
    expect(throttleSource({ app_to_use: 4, 'app_ppm_conf.ctrl_type': 2 })).toHaveProperty('problem')
    expect(throttleSource({ app_to_use: 3 })).toBeNull()
  })

  it('refuses settings out of range rather than trimming them', () => {
    expect(regenSettingsProblem(REGEN_DEFAULTS)).toBeNull()
    expect(regenSettingsProblem({ ...REGEN_DEFAULTS, rampS: 0 })).toMatch(/Ramp/)
    expect(regenSettingsProblem({ ...REGEN_DEFAULTS, strength: 'custom', customPct: 150 })).toMatch(/Strength/)
    expect(regenSettingsProblem({ ...REGEN_DEFAULTS, strength: 'high', customPct: 150 })).toBeNull()
    expect(regenSettingsProblem({ ...REGEN_DEFAULTS, fadeKmh: NaN })).toMatch(/Fade/)
  })
})

describe('regen in the simulator', () => {
  const ride = (regen: boolean) => {
    const sim = new VehicleSim()
    sim.rideTime = 4 // full throttle
    if (regen) sim.startRegen(0, [1], { ...P, speedPerErpm: 1 / sim.erpmFor(1), amps: 15 })
    sim.handInput = { throttle: 0.9, brake: 0 }
    for (let i = 0; i < 500; i++) sim.step(0.01)
    const v0 = sim.speed
    sim.handInput = { throttle: 0, brake: 0 }
    for (let i = 0; i < 100; i++) sim.step(0.01)
    return { sim, v0 }
  }

  it('slows the scooter on both motors when the throttle is let go, charging the battery', () => {
    const { sim, v0 } = ride(true)
    expect(v0).toBeGreaterThan(5)
    expect(sim.regenFor(0)?.active).toBe(true)
    expect(sim.regenFor(0)?.engagements).toBe(1)
    const a = sim.valuesFor(0, 1)
    const b = sim.valuesFor(1, 2)
    expect(a.currentMotor).toBeLessThan(-5)
    expect(b.currentMotor).toBeLessThan(-5)
    expect(a.currentIn).toBeLessThan(0)
    expect(sim.speed).toBeLessThan(v0)
    // Without regen, the scripted rider keeps the throttle open and it keeps going.
    expect(ride(false).sim.speed).toBeGreaterThan(sim.speed)
  })

  it('stops when switched off', () => {
    const { sim } = ride(true)
    sim.stopRegen(0)
    expect(sim.regenFor(0)).toBeNull()
  })
})
