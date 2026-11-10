// ABS for motor braking.
//
// It runs on each motor controller as a small LispBM program, 100 times a second,
// because a phone link is far too slow and can drop. Each controller watches its
// own wheel: when the wheel slows down faster than tyres can stop a vehicle, the
// wheel is skidding, so it briefly lowers that motor's braking current, then
// brings it back. Only motor (regen) braking is affected, never mechanical brakes.
//
// It works through the "Min Current Scale" limit (l_current_min_scale), changed
// with conf-set: applied instantly, never saved. So any brake input (ADC lever,
// remote, CAN from the other controller) is covered, and a power cycle always
// brings back normal braking. Safety rules built in:
//   - below a minimum speed it never interferes, so you can always stop;
//   - it can wait until braking has been on for a moment (armS), so the jolt
//     of regen or the brake coming on isn't mistaken for a skid;
//   - one release can't last longer than maxReleaseS: full braking comes back and
//     ABS stands down for 2 s;
//   - when switched off, it puts the braking limit back before it exits.
//
// absStep below is the reference: the simulator runs it and the tests check it.
// absStartCommands produces the same logic for the controller.

import { lf, li, packCommands, parseStatusLine, squash } from './lisp'

export interface AbsParams {
  /** Metres per second for each ERPM on this controller's wheel. */
  speedPerErpm: number
  /** Wheel deceleration (m/s²) that means the wheel is skidding. */
  slipDecel: number
  /** Below this speed (m/s) ABS never interferes. */
  minSpeed: number
  /** Braking kept while releasing, as a share of normal. */
  releaseFraction: number
  /** How long a release is held (s). */
  holdS: number
  /** Time to bring braking back to normal after a release (s). */
  rampS: number
  /** The longest one release may last before full braking returns (s). */
  maxReleaseS: number
  /** Braking must have been on this long before ABS may act (s); 0 = straight away. */
  armS: number
}

export type AbsSensitivity = 'gentle' | 'normal' | 'sensitive'

/** Wheel deceleration thresholds. Tyres on dry tarmac stop at about 8–9 m/s² (0.9 g). */
export const SLIP_DECEL: Record<AbsSensitivity, number> = { gentle: 15, normal: 12, sensitive: 9 }

export const ABS_DEFAULTS: Omit<AbsParams, 'speedPerErpm' | 'slipDecel'> = {
  minSpeed: 2, // 7 km/h
  releaseFraction: 0.3,
  holdS: 0.08,
  rampS: 0.25,
  maxReleaseS: 1,
  armS: 0,
}

/** The wait after the brakes come on that riders may choose, in seconds. */
export const ABS_ARM_RANGE = { min: 0.1, max: 1 }

export const ABS_DT = 0.01
const WINDOW = 4 // deceleration over the last 40 ms, which smooths ERPM noise
const LOCKOUT_STEPS = 200
/** Motor current (A) against the direction of travel that counts as braking. */
const BRAKING_A = 2

export interface AbsState {
  /** The braking limit the rider's settings (or ride mode) want. */
  base: number
  /** What ABS last set. */
  set: number
  speeds: number[]
  hold: number
  releasedSteps: number
  lockout: number
  /** Steps braking has been on. */
  braking: number
  releasing: boolean
  interventions: number
}

export function absInit(scale: number): AbsState {
  return { base: scale, set: scale, speeds: Array(WINDOW).fill(0), hold: 0, releasedSteps: 0, lockout: 0, braking: 0, releasing: false, interventions: 0 }
}

/**
 * One 10 ms step. `scaleNow` is the live limit (someone else may have changed it,
 * e.g. a ride mode switch, which becomes the new normal). Returns the limit to set.
 */
export function absStep(s: AbsState, p: AbsParams, erpm: number, currentDir: number, scaleNow: number): number {
  const v = p.speedPerErpm * Math.abs(erpm)
  const decel = (s.speeds[WINDOW - 1] - v) / (WINDOW * ABS_DT)
  s.speeds = [v, ...s.speeds.slice(0, WINDOW - 1)]
  if (Math.abs(scaleNow - s.set) > 0.002) {
    s.base = scaleNow
    s.set = scaleNow
  }
  const holdSteps = Math.round(p.holdS / ABS_DT)
  const rampStep = (s.base * (1 - p.releaseFraction) * ABS_DT) / p.rampS
  const maxSteps = Math.round(p.maxReleaseS / ABS_DT)
  let target = s.base
  if (s.lockout > 0) {
    s.lockout--
  } else if ((erpm < 0 ? -1 : 1) * currentDir < -BRAKING_A && v > p.minSpeed) {
    s.braking = Math.min(s.braking + 1, 100000)
    if (s.braking > Math.round(p.armS / ABS_DT)) {
      if (decel > p.slipDecel) {
        target = s.base * p.releaseFraction
        s.hold = holdSteps
      } else if (s.hold > 0) {
        s.hold--
        target = s.base * p.releaseFraction
      } else {
        target = Math.min(s.base, s.set + rampStep)
      }
      s.releasedSteps = target < s.base - 0.001 ? s.releasedSteps + 1 : 0
      if (s.releasedSteps > maxSteps) {
        s.lockout = LOCKOUT_STEPS
        s.releasedSteps = 0
        s.hold = 0
        target = s.base
      }
    }
  } else {
    s.braking = 0
    s.hold = 0
    s.releasedSteps = 0
  }
  const releasing = target < s.base - 0.001
  if (releasing && !s.releasing) s.interventions++
  s.releasing = releasing
  s.set = target
  return target
}

// The same logic for the controller. Settings live in globals (ohm-p*), so the
// functions don't change between arming runs; ohm-k counts loop runs (to prove the
// loop is alive) and ohm-id echoes the arming run (to prove these settings took).

/** Absolute difference, used by the loop. */
const ABS_DIFF = '(defun ohm-d (a b) (if (< a b) (- b a) (- a b)))'

const ABS_MEASURE = squash(`(defun ohm-a1 () (progn
  (def ohm-e (get-rpm))
  (def ohm-v (* ohm-pe (if (< ohm-e 0) (- 0 ohm-e) ohm-e)))
  (def ohm-a (/ (- ohm-v4 ohm-v) ${lf(WINDOW * ABS_DT)}))
  (def ohm-v4 ohm-v3) (def ohm-v3 ohm-v2) (def ohm-v2 ohm-v1) (def ohm-v1 ohm-v)
  (def ohm-c (conf-get 'l-current-min-scale))
  (if (> (ohm-d ohm-c ohm-s) 0.002) (progn (def ohm-b ohm-c) (def ohm-s ohm-c)) nil)
  (def ohm-t ohm-b)))`)

const ABS_DECIDE = squash(`(defun ohm-a2 () (if (> ohm-l 0) (def ohm-l (- ohm-l 1))
  (if (and (< (* (if (< ohm-e 0) -1.0 1.0) (get-current-dir)) ${lf(-BRAKING_A)}) (> ohm-v ohm-pm))
    (progn (def ohm-q (if (< ohm-q 100000) (+ ohm-q 1) ohm-q)) (if (> ohm-q ohm-pa) (ohm-a5) nil))
    (progn (def ohm-q 0) (def ohm-h 0) (def ohm-r 0)))))`)

/** Braking for long enough: release on a skid, and stand down if a release runs too long. */
const ABS_ACT = squash(`(defun ohm-a5 () (progn (ohm-a3)
  (if (< ohm-t (- ohm-b 0.001)) (def ohm-r (+ ohm-r 1)) (def ohm-r 0))
  (if (> ohm-r ohm-px) (progn (def ohm-l ${LOCKOUT_STEPS}) (def ohm-r 0) (def ohm-h 0) (def ohm-t ohm-b)) nil)))`)

const ABS_RELEASE = squash(`(defun ohm-a3 () (if (> ohm-a ohm-pd) (progn (def ohm-t (* ohm-b ohm-pr)) (def ohm-h ohm-ph))
  (if (> ohm-h 0) (progn (def ohm-h (- ohm-h 1)) (def ohm-t (* ohm-b ohm-pr)))
    (def ohm-t (if (< (+ ohm-s (* ohm-b ohm-ps)) ohm-b) (+ ohm-s (* ohm-b ohm-ps)) ohm-b)))))`)

const ABS_APPLY = squash(`(defun ohm-a4 () (progn
  (if (and (< ohm-t (- ohm-b 0.001)) (= ohm-w 0)) (def ohm-abs-n (+ ohm-abs-n 1)) nil)
  (def ohm-w (if (< ohm-t (- ohm-b 0.001)) 1 0))
  (if (> (ohm-d ohm-t ohm-s) 0.001) (progn (conf-set 'l-current-min-scale ohm-t) (def ohm-s ohm-t)) nil)
  (def ohm-k (if (> ohm-k 99999) 0 (+ ohm-k 1)))))`)

const ABS_START = squash(`(progn (def ohm-abs-on 1) (spawn (lambda () (progn
  (loopwhile (> ohm-abs-on 0) (progn (ohm-a1) (ohm-a2) (ohm-a4) (sleep ${lf(ABS_DT)})))
  (conf-set 'l-current-min-scale ohm-b)))))`)

/** Switches ABS off; the loop puts normal braking back before it exits. */
export const ABS_STOP_PROGRAM = '(def ohm-abs-on 0)'

/**
 * Console commands that (re)start ABS on one controller, in order. The first stops
 * any earlier run; it must be sent on its own so that run has exited (it restores
 * normal braking) before the new one reads the braking limit.
 */
export function absStartCommands(p: AbsParams, runId: number): string[] {
  const settings = [
    `(def ohm-pe ${lf(p.speedPerErpm)})`,
    `(def ohm-pd ${lf(p.slipDecel)})`,
    `(def ohm-pm ${lf(p.minSpeed)})`,
    `(def ohm-pr ${lf(p.releaseFraction)})`,
    `(def ohm-ps ${lf(((1 - p.releaseFraction) * ABS_DT) / p.rampS)})`,
    `(def ohm-ph ${li(p.holdS / ABS_DT)})`,
    `(def ohm-px ${li(p.maxReleaseS / ABS_DT)})`,
    `(def ohm-pa ${li(p.armS / ABS_DT)})`,
    `(def ohm-id ${li(runId)})`,
  ]
  const state = [
    '(def ohm-abs-n 0)',
    '(def ohm-k 0)',
    "(def ohm-b (conf-get 'l-current-min-scale))",
    '(def ohm-s ohm-b)',
    ...['v1', 'v2', 'v3', 'v4'].map((v) => `(def ohm-${v} 0.0)`),
    ...['h', 'r', 'l', 'w', 'q'].map((v) => `(def ohm-${v} 0)`),
  ]
  return [ABS_STOP_PROGRAM, ...packCommands([...settings, ...state, ABS_DIFF, ABS_MEASURE, ABS_DECIDE, ABS_ACT, ABS_RELEASE, ABS_APPLY, ABS_START])]
}

/** Prints "(on n k id)": on 1/0, n = brake releases, k = loop runs, id = arming run. */
export const ABS_STATUS_PROGRAM = '(list ohm-abs-on ohm-abs-n ohm-k ohm-id)'

export interface AbsStatus {
  on: boolean
  interventions: number
  /** Loop runs (wraps at 100 000); null when ABS was never started since power-on. */
  beat: number | null
  runId: number | null
}

/** Reads ABS_STATUS_PROGRAM's output. */
export function parseAbsStatus(text: string): AbsStatus | null {
  const st = parseStatusLine(text)
  if (st === 'unbound') return { on: false, interventions: 0, beat: null, runId: null }
  return st && { on: st.on, interventions: st.count, beat: st.beat, runId: st.runId }
}
