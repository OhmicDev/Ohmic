import { describe, expect, it } from 'vitest'
import { ABS_DEFAULTS, ABS_STOP_PROGRAM, absInit, absStartCommands, absStep, parseAbsStatus, type AbsParams } from './abs'
import { lf, li, MAX_CMD, packCommands, ProgramTooLongError } from './lisp'
import { BUILT_IN_TUNES, MAX_NOTES, noteEntries, noteFreq, parseRtttl, playCommands, STOP_PROGRAM, toneVolts, TuneError } from './music'

/** Parentheses open and close in order, and every one closes. */
function balanced(code: string): boolean {
  let depth = 0
  for (const ch of code) {
    if (ch === '(') depth++
    if (ch === ')' && --depth < 0) return false
  }
  return depth === 0
}

describe('LispBM helpers', () => {
  it('writes floats with a decimal point and integers without', () => {
    expect(lf(1)).toBe('1.0')
    expect(lf(-2)).toBe('-2.0')
    expect(lf(0.5)).toBe('0.5')
    expect(lf(1e-7)).toBe('0.000000100')
    expect(li(2.6)).toBe('3')
    expect(() => lf(NaN)).toThrow()
    expect(() => li(Infinity)).toThrow()
  })

  it('packs expressions in order into as few commands as fit', () => {
    expect(packCommands(['(a)', '(b)'], 40)).toEqual(['(progn (a) (b))'])
    const parts = Array.from({ length: 30 }, (_, i) => `(def ohm-x${i} ${i})`)
    const cmds = packCommands(parts, 100)
    expect(cmds.length).toBeGreaterThan(1)
    for (const c of cmds) expect(c.length).toBeLessThanOrEqual(100)
    expect(cmds.join(' ').match(/ohm-x\d+/g)).toEqual(parts.map((_, i) => `ohm-x${i}`))
  })

  it('refuses a part longer than one command, instead of cutting it', () => {
    expect(() => packCommands(['(' + 'x'.repeat(500) + ')'])).toThrow(ProgramTooLongError)
  })
})

const P: AbsParams = { ...ABS_DEFAULTS, speedPerErpm: 0.001, slipDecel: 12 }
const BASE = 0.9
const BRAKE = -20 // A against the direction of travel

/** Runs the ABS step against a speed profile (m/s per step) and returns what it set each step. */
function run(speeds: number[], opts: { current?: number; base?: number } = {}) {
  const s = absInit(opts.base ?? BASE)
  const out = speeds.map((v) => absStep(s, P, v / P.speedPerErpm, opts.current ?? BRAKE, s.set))
  return { s, out }
}

/** Speeds falling at `decel` m/s² for `steps` 10 ms steps. */
const falling = (from: number, decel: number, steps: number) => Array.from({ length: steps }, (_, i) => from - decel * 0.01 * i)

describe('ABS controller', () => {
  it('leaves normal hard braking alone', () => {
    const { s, out } = run(falling(10, 8, 100))
    expect(out.every((x) => x === BASE)).toBe(true)
    expect(s.interventions).toBe(0)
  })

  it('eases braking when the wheel decelerates faster than a tyre can, then brings it back', () => {
    const steady = falling(10, 6, 20)
    const skid = falling(steady[19], 40, 6)
    const grip = Array.from({ length: 60 }, () => skid[5]) // wheel spins back up to road speed and holds
    const { s, out } = run([...steady, ...skid, ...grip])
    const released = out.findIndex((x) => x < BASE)
    expect(released).toBeGreaterThanOrEqual(20)
    expect(released).toBeLessThan(26)
    expect(out[released]).toBeCloseTo(BASE * P.releaseFraction, 6)
    expect(s.interventions).toBe(1)
    // Held for a moment, then ramped back up without jumping down again.
    const after = out.slice(26)
    for (let i = 1; i < after.length; i++) expect(after[i]).toBeGreaterThanOrEqual(after[i - 1] - 1e-9)
    expect(out[out.length - 1]).toBeCloseTo(BASE, 6)
  })

  it('never interferes at walking speed or while driving', () => {
    expect(run(falling(1.5, 40, 3)).s.interventions).toBe(0)
    expect(run(falling(10, 40, 20), { current: 30 }).s.interventions).toBe(0)
  })

  it('gives full braking back if a release lasts too long, and stays out of it for a while', () => {
    const { out } = run(falling(30, 13, 400))
    const firstRelease = out.findIndex((x) => x < BASE)
    expect(firstRelease).toBeGreaterThan(0)
    const backAt = out.findIndex((x, i) => i > firstRelease && x === BASE)
    expect(backAt - firstRelease).toBeLessThanOrEqual(Math.round(P.maxReleaseS / 0.01) + 2)
    expect(out.slice(backAt, backAt + 150).every((x) => x === BASE)).toBe(true)
  })

  it('treats an outside change of the limit (a ride mode switch) as the new normal', () => {
    const s = absInit(BASE)
    expect(absStep(s, P, 5000, BRAKE, 0.5)).toBe(0.5)
    expect(s.base).toBe(0.5)
  })

  it('sends the program as short commands with this run’s ID', () => {
    const cmds = absStartCommands(P, 4242)
    expect(cmds[0]).toBe(ABS_STOP_PROGRAM)
    for (const c of cmds) {
      expect(c.length).toBeLessThanOrEqual(MAX_CMD)
      expect(balanced(c)).toBe(true)
    }
    expect(cmds.join(' ')).toContain('(def ohm-id 4242)')
    expect(cmds[cmds.length - 1]).toContain('spawn')
  })

  it('reads the status line, and knows "never started"', () => {
    expect(parseAbsStatus('(1 3 120 42)')).toEqual({ on: true, interventions: 3, beat: 120, runId: 42 })
    expect(parseAbsStatus('(0 0 5 7)')?.on).toBe(false)
    expect(parseAbsStatus('***\tEval error: variable_not_bound')).toEqual({ on: false, interventions: 0, beat: null, runId: null })
    expect(parseAbsStatus('> ')).toBeNull()
  })
})

const MOTOR = { r: 0.09, l: 0.00015, vBat: 50 }

describe('motor music', () => {
  it('knows note pitches', () => {
    expect(noteFreq('a', 4)).toBeCloseTo(440, 6)
    expect(noteFreq('a', 5)).toBeCloseTo(880, 6)
    expect(noteFreq('c', 4)).toBeCloseTo(261.63, 1)
  })

  it('reads ring-tone text', () => {
    const t = parseRtttl('Test:d=4,o=5,b=120:c,8e,p,g.')
    expect(t.name).toBe('Test')
    expect(t.notes.map((n) => n.ms)).toEqual([500, 250, 500, 750])
    expect(t.notes[2].freq).toBe(0)
    expect(t.notes[0].freq).toBeCloseTo(523.25, 1)
  })

  it('explains bad tunes instead of guessing', () => {
    expect(() => parseRtttl('just words')).toThrow(TuneError)
    expect(() => parseRtttl('x:b=0:c')).toThrow(TuneError)
    expect(() => parseRtttl('x:d=4:3c')).toThrow(TuneError)
    expect(() => parseRtttl('x:d=4:')).toThrow(TuneError)
  })

  it('drives just enough voltage for the current, never more than a quarter of the battery', () => {
    const z = Math.sqrt(0.1 ** 2 + (2 * Math.PI * 1000 * 0.0001) ** 2)
    expect(toneVolts(1000, 2, { r: 0.1, l: 0.0001, vBat: 50 })).toBeCloseTo(2 * z, 6)
    expect(toneVolts(1000, 2, { r: 0.1, l: 0.0001, vBat: 4 })).toBe(1)
  })

  it('splits long notes so the player checks the wheel often', () => {
    const pieces = noteEntries([{ freq: 440, ms: 1000 }], 3, MOTOR)
    expect(pieces.map((p) => p[1])).toEqual([300, 300, 280])
    expect(pieces.map((p) => p[2])).toEqual([0, 0, 120])
  })

  it('fits every tune into short console commands', () => {
    const long = parseRtttl(`Long:d=8,o=5,b=200:${Array.from({ length: 120 }, (_, i) => ['c', 'e', 'g', '2a'][i % 4]).join(',')}`)
    const tunes = [...BUILT_IN_TUNES.map((t) => parseRtttl(t.rtttl).notes), long.notes]
    for (const notes of tunes) {
      const cmds = playCommands(notes, 3, MOTOR, 77)
      expect(cmds[0]).toBe(STOP_PROGRAM)
      for (const c of cmds) {
        expect(c.length).toBeLessThanOrEqual(MAX_CMD)
        expect(balanced(c)).toBe(true)
      }
      expect(cmds[cmds.length - 1]).toContain('(ohm-mq 77)')
    }
    // Only the first MAX_NOTES notes are sent.
    const sent = playCommands(long.notes, 3, MOTOR, 1).join(' ')
    const numbers = [...sent.matchAll(/\(def ohm-m\d+ '\(([\d\s-]*)\)\)/g)].flatMap((m) => m[1].trim().split(/\s+/))
    expect(numbers.length / 4).toBe(noteEntries(long.notes, 3, MOTOR).length)
    expect(noteEntries(long.notes, 3, MOTOR).length).toBeLessThanOrEqual(MAX_NOTES * 2)
  })
})
