// One-pedal regen: let go of the throttle and the motors brake gently, putting
// energy back in the battery, the way an electric car slows when you lift off.
//
// It runs as a small LispBM program on the controller the throttle is wired to,
// 100 times a second. While the rider has let go of the throttle (and isn't on
// the brake lever) and the vehicle is moving, it takes over from the input app
// for a moment at a time and brakes with a set current, sending the same to the
// other motor controllers over CAN. Opening the throttle, slowing below walking
// pace, or the program stopping for any reason hands control straight back to
// the input app; the brake lever takes over within 30 ms:
//   - it only ever borrows control for 60 ms at a time (app-disable-output), so
//     if the program stops, the throttle works again within 60 ms;
//   - it only acts after the throttle was used, so a wheel spun on the bench
//     (or pushed by hand) is never braked;
//   - it builds up over the ramp time and fades out at low speed, so it never
//     snatches, and you can always come to a stop;
//   - a blip on the throttle or lever reading (a noisy sensor, a thumb resting
//     on the throttle) shorter than 30 ms is ridden out at the same braking, and
//     after a short drop it carries on from where it was instead of starting
//     over, so regen doesn't pulse;
//   - braking current is still limited by the motor's braking limit, so ABS
//     (which lowers that limit in a skid) eases regen too.
//
// regenStep is the reference: the simulator runs it and the tests check it.
// regenStartCommands produces the same logic for the controller.

import type { ConfigValues } from '../config/types'
import { lf, li, packCommands, parseStatusLine, squash } from './lisp'

export interface RegenParams {
  /** Metres per second for each ERPM on this controller's wheel. */
  speedPerErpm: number
  /** Braking current at full regen (A, positive). */
  amps: number
  /** Seconds to build up to full regen after letting go. */
  rampS: number
  /** Below this speed (m/s) regen fades out... */
  fadeSpeed: number
  /** ...reaching none at this speed (m/s). */
  minSpeed: number
  /** Seconds after letting go before regen starts. */
  delayS: number
  /** Where the throttle is read: the ADC app (0) or PPM (1). */
  input: 0 | 1
  /** ADC only: the brake lever is on ADC2, so pulling it hands over to the lever. */
  lever: boolean
  /** CAN IDs of the other motor controllers the throttle drives. */
  followers: number[]
}

export type RegenStrength = 'low' | 'medium' | 'high' | 'custom'

/** Share of the motor's braking current used at full regen. */
export const STRENGTH_PCT: Record<Exclude<RegenStrength, 'custom'>, number> = { low: 25, medium: 45, high: 70 }

export const REGEN_DT = 0.01
/** Throttle (or brake) input below this counts as let go. */
const RELEASED = 0.05
/** Throttle above this counts as used, which allows regen on the next let-go. */
const PRESSED = 0.1
/** Never acts below this speed: 2 km/h, so you can always stop and stand. */
export const REGEN_MIN_SPEED = 2 / 3.6
/** Steps a blip in the inputs may last without ending regen (30 ms). */
const BLIP_STEPS = 3
/** Once regen has ended, its level falls to zero over this time; coming back sooner carries on from there. */
const FALL_S = 0.25

/** The rider's regen settings, as the app keeps them. */
export interface RegenSettings {
  strength: RegenStrength
  customPct: number
  rampS: number
  fadeKmh: number
  delayS: number
}

export const REGEN_DEFAULTS: RegenSettings = { strength: 'medium', customPct: 40, rampS: 0.6, fadeKmh: 8, delayS: 0.15 }

/** Allowed ranges. Values outside are refused, never trimmed. */
export const REGEN_LIMITS = {
  customPct: [5, 100],
  rampS: [0.1, 3],
  fadeKmh: [3, 30],
  delayS: [0, 1],
} as const

/** Why these settings can't be used, or null. */
export function regenSettingsProblem(s: RegenSettings): string | null {
  const check = (k: keyof typeof REGEN_LIMITS, label: string, unit: string) => {
    const [lo, hi] = REGEN_LIMITS[k]
    const v = s[k]
    return Number.isFinite(v) && v >= lo && v <= hi ? null : `${label} must be from ${lo} to ${hi}${unit}.`
  }
  return (
    (s.strength === 'custom' ? check('customPct', 'Strength', ' %') : null) ??
    check('rampS', 'Ramp-in time', ' s') ??
    check('fadeKmh', 'Fade-out speed', ' km/h') ??
    check('delayS', 'Delay', ' s')
  )
}

export const strengthPct = (s: RegenSettings) => (s.strength === 'custom' ? s.customPct : STRENGTH_PCT[s.strength])

export interface ThrottleSource {
  input: 0 | 1
  lever: boolean
  /** Whether the throttle also drives the other controllers over CAN. */
  multi: boolean
  label: string
}

const ADC_APPS = [2, 5, 10]
const PPM_APPS = [1, 4]
/** ADC modes where the throttle rests at 0: Current, Current Reverse Button, and the two with an ADC2 brake lever. */
const ADC_OK = [1, 3, 4, 8]
const ADC_LEVER = [4, 8]
/** PPM modes where the stick rests at the centre, forward is throttle and back is brake. */
const PPM_OK = [1, 3, 8, 9]

/**
 * How this controller reads the throttle, if regen can work with it. Returns
 * null when it has no throttle input, or a reason when it has one regen can't use.
 */
export function throttleSource(app: ConfigValues): ThrottleSource | { problem: string } | null {
  const use = Number(app.app_to_use)
  if (ADC_APPS.includes(use)) {
    const t = Number(app['app_adc_conf.ctrl_type'])
    if (!ADC_OK.includes(t)) {
      return { problem: 'Its ADC throttle mode isn’t one regen can work with. Use a current mode with the throttle resting at zero (Current, or Current No Reverse Brake ADC2).' }
    }
    return { input: 0, lever: ADC_LEVER.includes(t), multi: Number(app['app_adc_conf.multi_esc']) === 1, label: 'ADC throttle' }
  }
  if (PPM_APPS.includes(use)) {
    const t = Number(app['app_ppm_conf.ctrl_type'])
    if (!PPM_OK.includes(t)) {
      return { problem: 'Its remote (PPM) mode isn’t one regen can work with. Use a current mode with the stick resting in the middle.' }
    }
    return { input: 1, lever: false, multi: Number(app['app_ppm_conf.multi_esc']) === 1, label: 'PPM remote' }
  }
  return null
}

export interface RegenState {
  /** The throttle was used since the vehicle last stopped. */
  armed: boolean
  active: boolean
  /** 0..1, how far regen has built up. */
  level: number
  /** Steps since letting go. */
  wait: number
  /** Steps the inputs have said "stop" while regen was on. */
  blip: number
  /** The braking current last applied (A). */
  amps: number
  /** How many times regen has started. */
  engagements: number
}

export const regenInit = (): RegenState => ({ armed: false, active: false, level: 0, wait: 0, blip: 0, amps: 0, engagements: 0 })

interface RegenInputs {
  /** 0..1 for ADC; -1..1 for PPM. */
  throttle: number
  /** The ADC2 lever, 0..1 (ignored for PPM, where it's the back half of the stick). */
  lever: number
  erpm: number
  /** Someone else (VESC Tool, a detection) has taken over from the input app. */
  outputDisabled: boolean
}

/** One 10 ms step. Returns the braking current to apply (A), or null to leave the motor to the input app. */
export function regenStep(s: RegenState, p: RegenParams, x: RegenInputs): number | null {
  const v = p.speedPerErpm * Math.abs(x.erpm)
  const brake = p.input === 1 ? -x.throttle : p.lever ? x.lever : 0
  if (x.throttle > PRESSED) s.armed = true
  if (v < p.minSpeed) s.armed = false
  const letGo = s.armed && x.throttle < RELEASED && brake < RELEASED && v > p.minSpeed && (s.active || !x.outputDisabled)
  if (!letGo) {
    s.blip++
    if (s.active && s.armed && x.throttle < PRESSED && s.blip <= BLIP_STEPS) return s.amps
    s.blip = 0
    s.wait = 0
    s.level = !s.armed || x.throttle > PRESSED ? 0 : Math.max(0, s.level - REGEN_DT / FALL_S)
    s.active = false
    return null
  }
  s.blip = 0
  s.wait++
  if (s.level === 0 && s.wait <= Math.round(p.delayS / REGEN_DT)) return null
  if (!s.active) s.engagements++
  s.active = true
  s.level = Math.min(1, s.level + REGEN_DT / p.rampS)
  const fade = v >= p.fadeSpeed ? 1 : (v - p.minSpeed) / (p.fadeSpeed - p.minSpeed)
  s.amps = p.amps * s.level * fade
  return s.amps
}

// Settings live in globals (ohm-g*), so the functions don't change between runs;
// ohm-gk counts loop runs (to prove the loop is alive) and ohm-gid echoes the
// run that started it (to prove these settings took).

const REGEN_READ = squash(`(defun ohm-g1 () (progn
  (def ohm-gq (if (= ohm-gs 0) (get-adc-decoded 0) (get-ppm)))
  (def ohm-gb (if (= ohm-gs 0) (if (= ohm-gl 1) (get-adc-decoded 1) 0.0) (- 0.0 ohm-gq)))
  (def ohm-ge (get-rpm))
  (def ohm-gv (* ohm-gp (if (< ohm-ge 0) (- 0 ohm-ge) ohm-ge)))
  (if (> ohm-gq ${lf(PRESSED)}) (def ohm-gx 1) nil)
  (if (< ohm-gv ohm-gm) (def ohm-gx 0) nil)))`)

const REGEN_DECIDE = squash(`(defun ohm-g2 () (if (and (= ohm-gx 1) (< ohm-gq ${lf(RELEASED)}) (< ohm-gb ${lf(RELEASED)}) (> ohm-gv ohm-gm)
    (or (= ohm-gy 1) (not (app-is-output-disabled))))
  (progn (def ohm-go 0) (def ohm-gt (+ ohm-gt 1)) (if (or (> ohm-gz 0.0) (> ohm-gt ohm-gw)) (ohm-g3) nil))
  (progn (def ohm-go (+ ohm-go 1))
    (if (and (= ohm-gy 1) (= ohm-gx 1) (< ohm-gq ${lf(PRESSED)}) (< ohm-go ${BLIP_STEPS + 1})) (ohm-g4) (ohm-g6)))))`)

/** Regen stops: the level falls away (or resets after the throttle or a stop), then control goes back. */
const REGEN_END = squash(`(defun ohm-g6 () (progn (def ohm-go 0) (def ohm-gt 0)
  (def ohm-gz (if (or (= ohm-gx 0) (> ohm-gq ${lf(PRESSED)})) 0.0 (if (> ohm-gz ${lf(REGEN_DT / FALL_S)}) (- ohm-gz ${lf(REGEN_DT / FALL_S)}) 0.0)))
  (if (= ohm-gy 1) (ohm-g5) nil)))`)

const REGEN_APPLY = squash(`(defun ohm-g3 () (progn
  (if (= ohm-gy 0) (def ohm-regen-n (+ ohm-regen-n 1)) nil)
  (def ohm-gy 1)
  (def ohm-gz (if (< (+ ohm-gz ohm-gu) 1.0) (+ ohm-gz ohm-gu) 1.0))
  (def ohm-gi (* ohm-ga ohm-gz (if (> ohm-gv ohm-gh) 1.0 (/ (- ohm-gv ohm-gm) (- ohm-gh ohm-gm)))))
  (ohm-g4)))`)

/** Applies (or keeps applying) the current braking on this controller and the others. */
const REGEN_HOLD = squash(`(defun ohm-g4 () (progn
  (app-disable-output 60)
  (set-brake ohm-gi)
  (loopforeach i ohm-gc (canset-brake i ohm-gi))))`)

/** Hands back to the input app: zero current first, so nothing keeps braking. */
const REGEN_RELEASE = squash(`(defun ohm-g5 () (progn
  (def ohm-gy 0)
  (set-current 0.0)
  (loopforeach i ohm-gc (canset-current i 0.0))
  (app-disable-output 0)))`)

const REGEN_START = squash(`(progn (def ohm-regen-on 1) (spawn (lambda () (progn
  (loopwhile (> ohm-regen-on 0) (progn (ohm-g1) (ohm-g2) (def ohm-gk (if (> ohm-gk 99999) 0 (+ ohm-gk 1))) (sleep ${lf(REGEN_DT)})))
  (if (= ohm-gy 1) (ohm-g5) nil)))))`)

/** Switches regen off; the loop hands control back before it exits. */
export const REGEN_STOP_PROGRAM = '(def ohm-regen-on 0)'

/**
 * Console commands that (re)start regen on the throttle's controller, in order.
 * The first stops any earlier run and must be sent on its own, so that run has
 * handed control back before the new one starts.
 */
export function regenStartCommands(p: RegenParams, runId: number): string[] {
  const settings = [
    `(def ohm-gp ${lf(p.speedPerErpm)})`,
    `(def ohm-ga ${lf(p.amps)})`,
    `(def ohm-gu ${lf(REGEN_DT / p.rampS)})`,
    `(def ohm-gh ${lf(p.fadeSpeed)})`,
    `(def ohm-gm ${lf(p.minSpeed)})`,
    `(def ohm-gw ${li(p.delayS / REGEN_DT)})`,
    `(def ohm-gs ${li(p.input)})`,
    `(def ohm-gl ${p.lever ? 1 : 0})`,
    p.followers.length ? `(def ohm-gc '(${p.followers.map(li).join(' ')}))` : '(def ohm-gc nil)',
    `(def ohm-gid ${li(runId)})`,
  ]
  const state = ['(def ohm-regen-n 0)', '(def ohm-gk 0)', '(def ohm-gz 0.0)', '(def ohm-gi 0.0)', ...['x', 'y', 't', 'o'].map((v) => `(def ohm-g${v} 0)`)]
  return [
    REGEN_STOP_PROGRAM,
    ...packCommands([...settings, ...state, REGEN_READ, REGEN_DECIDE, REGEN_END, REGEN_APPLY, REGEN_HOLD, REGEN_RELEASE, REGEN_START]),
  ]
}

/** Prints "(on n k id)": on 1/0, n = times regen started, k = loop runs, id = the run. */
export const REGEN_STATUS_PROGRAM = '(list ohm-regen-on ohm-regen-n ohm-gk ohm-gid)'

export interface RegenStatus {
  on: boolean
  engagements: number
  /** Loop runs (wraps at 100 000); null when regen was never started since power-on. */
  beat: number | null
  runId: number | null
}

/** Reads REGEN_STATUS_PROGRAM's output. */
export function parseRegenStatus(text: string): RegenStatus | null {
  const st = parseStatusLine(text)
  if (st === 'unbound') return { on: false, engagements: 0, beat: null, runId: null }
  return st && { on: st.on, engagements: st.count, beat: st.beat, runId: st.runId }
}
