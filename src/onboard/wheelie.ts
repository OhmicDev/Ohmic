// The auto-wheelie: its settings, the program Ohmic installs on a controller
// (wheelie.lisp with the rider's settings filled in), the console commands that
// arm and disarm it, what it reports back, and the IMU calibration.
//
// The program is too big for the controller's script memory, so unlike ABS and
// regen it isn't sent through the console each time: it's installed as the
// controller's stored script (its functions kept in flash), where it waits,
// disarmed, from every power-up. Arming sends the settings and (wl-start).

import { lf, li, packCommands } from './lisp'
import RAW_LISP from './wheelie.lisp?raw'

/** The program's source, with plain line endings however the checkout stores them. */
export const WHEELIE_LISP = RAW_LISP.replace(/\r\n/g, '\n')

/** The program version this app installs; the script's (def wl-version …) says the same. */
export const WHEELIE_VERSION = 1

/** Firmware the program needs: foc-play-tone, can-msg-age and the flash-stored functions. */
export const WHEELIE_MIN_FW: [number, number] = [6, 5]

export type Vec3 = [number, number, number]

// ---- Settings ----

export interface WheelieSettings {
  target: number
  kp: number
  ki: number
  kd: number
  catchGain: number
  kick: number
  kickRamp: number
  holdMax: number
  catchMax: number
  frontShare: number
  frontSync: number
  maxAngle: number
  minKmh: number
  maxKmh: number
  maxTime: number
  minVolts: number
  maxVolts: number
  maxAmpsIn: number
  maxFetC: number
  maxMotorC: number
  maxRoll: number
  maxYaw: number
  brakeDecel: number
  trigger: number
  pin: number
  letGo: number
  landCushion: number
  landRamp: number
  landAngle: number
  armMinutes: number
  toneVolts: number
  dry: number
  bench: number
  benchAmps: number
}

export type WheelieKey = keyof WheelieSettings

export type WheelieGroup = 'angle' | 'push' | 'trigger' | 'landing' | 'limits' | 'battery' | 'feel' | 'testing'

export const WHEELIE_GROUPS: { id: WheelieGroup; label: string; help: string }[] = [
  { id: 'angle', label: 'Angle and balance', help: 'The angle it holds, and how firmly it holds it.' },
  { id: 'push', label: 'Kick and push', help: 'How hard the motors lift the front, and the most they push or brake while holding.' },
  { id: 'trigger', label: 'Starting', help: 'How a wheelie starts and ends from the throttle.' },
  { id: 'landing', label: 'Landing', help: 'How the front wheel comes back down.' },
  { id: 'limits', label: 'Limits', help: 'Anything past these ends the wheelie.' },
  { id: 'battery', label: 'Battery and heat', help: 'Power limits that end the wheelie, or stop one starting.' },
  { id: 'feel', label: 'Tones', help: 'What you feel through the deck.' },
  { id: 'testing', label: 'Testing', help: 'Ways to try it without the front wheel leaving the ground.' },
]

export interface WheelieField {
  key: WheelieKey
  label: string
  unit: string
  min: number
  max: number
  step: number
  /** Sent as a whole number. */
  int?: boolean
  /** An on/off switch (0 or 1). */
  toggle?: boolean
  /** Named choices instead of a slider. */
  choices?: { value: number; label: string }[]
  group: WheelieGroup
  help: string
}

export const WHEELIE_FIELDS: WheelieField[] = [
  { key: 'target', label: 'Target angle', unit: '°', min: 3, max: 30, step: 0.5, group: 'angle', help: 'The front-up angle it holds, measured from riding level. Standing riders usually find 8 to 15° comfortable; much higher and the balance point is near, where leaning back a little loops it.' },
  { key: 'kp', label: 'Hold strength', unit: 'A/°', min: 1, max: 30, step: 0.5, group: 'angle', help: 'Push added for each degree the nose is below the target (P). Too low and the nose sags or drops; too high and it shakes.' },
  { key: 'ki', label: 'Settling', unit: 'A/(° s)', min: 0, max: 40, step: 0.5, group: 'angle', help: 'How quickly it finds the steady push your stance needs (I). Higher settles on the target sooner; too high and it rocks slowly.' },
  { key: 'kd', label: 'Damping', unit: 'A/(°/s)', min: 0, max: 5, step: 0.05, group: 'angle', help: 'Eases off while the nose rises and adds while it falls (D), so it doesn’t overshoot. Too high and it buzzes.' },
  { key: 'catchGain', label: 'Pull-back', unit: '×', min: 1, max: 4, step: 0.1, group: 'angle', help: 'How much harder it pulls the nose down when it’s above the target than it pushes it up when below.' },
  { key: 'kick', label: 'Kick', unit: 'A', min: 5, max: 150, step: 1, group: 'push', help: 'The push that lifts the front wheel. Lifting takes more than holding, especially standing upright: lean back as you pin the throttle.' },
  { key: 'kickRamp', label: 'Kick ramp', unit: 'A/s', min: 50, max: 2000, step: 10, group: 'push', help: 'How fast the kick builds. Faster pops the front up sharply; slower is gentler.' },
  { key: 'frontShare', label: 'Front motor in the kick', unit: '×', min: 0, max: 1, step: 0.05, group: 'push', help: 'How much of the kick the front motor adds while its wheel is still down. Once the front lifts it only keeps that wheel at road speed.' },
  { key: 'holdMax', label: 'Most push', unit: 'A', min: 5, max: 150, step: 1, group: 'push', help: 'The most push while holding. Leaning forward needs more; if it runs out, the front comes down.' },
  { key: 'catchMax', label: 'Most braking', unit: 'A', min: 5, max: 150, step: 1, group: 'push', help: 'The most braking used to bring the nose down when you lean back past the balance point. More catches further leans; no setting saves leaning all the way back.' },
  { key: 'frontSync', label: 'Front wheel spin', unit: 'A', min: 0, max: 20, step: 0.5, group: 'push', help: 'Current used to keep the airborne front wheel spinning at road speed, so it lands without a skid. 0 lets it slow down.' },
  { key: 'trigger', label: 'Start with', unit: '', min: 0, max: 1, step: 1, int: true, group: 'trigger', choices: [{ value: 0, label: 'One pin' }, { value: 1, label: 'Two pins within a second' }], help: 'One pin: snap the throttle to full while rolling. Two pins: do it twice within a second, which is harder to do by accident.' },
  { key: 'pin', label: 'Pinned at', unit: '', min: 0.8, max: 1, step: 0.01, group: 'trigger', help: 'How far the throttle must go to count as pinned (1 is all the way).' },
  { key: 'letGo', label: 'Ends below', unit: '', min: 0.3, max: 0.9, step: 0.01, group: 'trigger', help: 'Easing the throttle below this ends the wheelie.' },
  { key: 'armMinutes', label: 'Disarm after', unit: 'min', min: 1, max: 60, step: 1, group: 'trigger', help: 'It disarms itself after this long without a wheelie, so you don’t ride around armed and forget.' },
  { key: 'landCushion', label: 'Landing cushion', unit: 'A', min: 0, max: 100, step: 1, group: 'landing', help: 'After you let go, the most push used to set the front down gently (it pushes harder near the ground, as holding a low nose takes nearly as much as lifting it). 0 lets it drop.' },
  { key: 'landRamp', label: 'Cushion fades', unit: 'A/s', min: 5, max: 200, step: 5, group: 'landing', help: 'How fast that most push falls away during the landing.' },
  { key: 'landAngle', label: 'Down below', unit: '°', min: 0.5, max: 4, step: 0.1, group: 'landing', help: 'The front counts as down once the nose is below this and has stopped falling.' },
  { key: 'maxAngle', label: 'Cut-out angle', unit: '°', min: 8, max: 45, step: 0.5, group: 'limits', help: 'Above this it brakes the rear wheel to bring the nose down. Keep it well below the angle you’d loop out at.' },
  { key: 'minKmh', label: 'Slowest start', unit: 'km/h', min: 5, max: 40, step: 0.5, group: 'limits', help: 'A wheelie only starts at this speed or faster, and ends 3 km/h below it.' },
  { key: 'maxKmh', label: 'Fastest', unit: 'km/h', min: 10, max: 60, step: 0.5, group: 'limits', help: 'A wheelie won’t start above this, and ends if you reach it.' },
  { key: 'maxTime', label: 'Longest wheelie', unit: 's', min: 0.5, max: 15, step: 0.5, group: 'limits', help: 'It lands after this long.' },
  { key: 'maxRoll', label: 'Side lean', unit: '°', min: 3, max: 30, step: 0.5, group: 'limits', help: 'Leaning the scooter to the side more than this ends it.' },
  { key: 'maxYaw', label: 'Turning', unit: '°/s', min: 10, max: 120, step: 1, group: 'limits', help: 'Turning faster than this ends it.' },
  { key: 'brakeDecel', label: 'Brake detection', unit: 'm/s²', min: 1, max: 10, step: 0.5, group: 'limits', help: 'Your brakes aren’t wired to the controller, so a pulled brake is seen as the rear wheel slowing this fast while the motor pushes it. Lower notices sooner; too low and bumps end wheelies.' },
  { key: 'minVolts', label: 'Battery low', unit: 'V', min: 10, max: 100, step: 0.5, group: 'battery', help: 'Below this the battery is too low: no wheelie starts, and one going ends.' },
  { key: 'maxVolts', label: 'Battery too full', unit: 'V', min: 10, max: 100, step: 0.5, group: 'battery', help: 'Above this, braking to bring the nose down could push the battery past full, so no wheelie starts (and Ohmic won’t arm). Ride a little first.' },
  { key: 'maxAmpsIn', label: 'Battery current', unit: 'A', min: 10, max: 300, step: 1, group: 'battery', help: 'Drawing more than this from the battery (both controllers) for 0.3 s ends it.' },
  { key: 'maxFetC', label: 'Controller heat', unit: '°C', min: 40, max: 100, step: 1, group: 'battery', help: 'Either controller hotter than this ends it.' },
  { key: 'maxMotorC', label: 'Motor heat', unit: '°C', min: 50, max: 150, step: 1, group: 'battery', help: 'Either motor hotter than this ends it.' },
  { key: 'toneVolts', label: 'Tone loudness', unit: 'V', min: 0, max: 4, step: 0.1, group: 'feel', help: 'Tones through the motor tell you what it’s doing: rising when armed, a chirp when it starts, a low buzz when it says no or stops for safety. 0 turns them off.' },
  { key: 'dry', label: 'Dry run', unit: '', min: 0, max: 1, step: 1, int: true, toggle: true, group: 'testing', help: 'Does everything, tones included, but never drives the motors: your throttle works as normal and Ohmic shows what it would have done.' },
  { key: 'bench', label: 'On a stand', unit: '', min: 0, max: 1, step: 1, int: true, toggle: true, group: 'testing', help: 'For the scooter on a stand with the wheels off the ground: any speed counts, currents are capped, and there’s longer to tip it up by hand.' },
  { key: 'benchAmps', label: 'Stand current', unit: 'A', min: 1, max: 20, step: 0.5, group: 'testing', help: 'The most current on a stand.' },
]

const lispName = (key: string) => `wl-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`

/** A block of the script, between ";; @name" and ";; @end". */
function block(src: string, name: string): { start: number; end: number; text: string } {
  const open = `;; @${name}\n`
  const start = src.indexOf(open)
  const end = src.indexOf(';; @end', start)
  if (start < 0 || end < 0) throw new Error(`wheelie.lisp has no @${name} block.`)
  return { start: start + open.length, end, text: src.slice(start + open.length, end) }
}

/** The (def wl-… value) lines of a block, by name. */
function defsIn(text: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of text.matchAll(/\(def (wl-[a-z0-9-]+) (-?[\d.]+)\)/g)) out.set(m[1], Number(m[2]))
  return out
}

/** The script's own defaults, so the app and the file can't disagree. */
export const WHEELIE_DEFAULTS: WheelieSettings = (() => {
  const defs = defsIn(block(WHEELIE_LISP, 'settings').text)
  const out = {} as WheelieSettings
  for (const f of WHEELIE_FIELDS) {
    const v = defs.get(lispName(f.key))
    if (v === undefined) throw new Error(`wheelie.lisp has no default for ${lispName(f.key)}.`)
    out[f.key] = v
  }
  return out
})()

/** The names in the script's settings block, for checking it matches the fields here. */
export const scriptSettingNames = () => [...defsIn(block(WHEELIE_LISP, 'settings').text).keys()]
export { lispName as wheelieLispName }

const fmt = (f: WheelieField, v: number) => `${Number(v.toFixed(3))}${f.unit && f.unit !== '×' ? ` ${f.unit}` : f.unit}`

/** Everything wrong with these settings. Values outside the ranges are refused, never trimmed. */
export function wheelieSettingsProblems(s: WheelieSettings): string[] {
  const out: string[] = []
  for (const f of WHEELIE_FIELDS) {
    const v = s[f.key]
    if (typeof v !== 'number' || !Number.isFinite(v)) out.push(`${f.label} isn’t set.`)
    else if (v < f.min || v > f.max) out.push(`${f.label} must be from ${fmt(f, f.min)} to ${fmt(f, f.max)}.`)
    else if ((f.int || f.toggle || f.choices) && !Number.isInteger(v)) out.push(`${f.label} must be a whole number.`)
  }
  if (out.length) return out
  if (s.maxAngle < s.target + 4) out.push(`The cut-out angle (${s.maxAngle}°) must be at least 4° above the target (${s.target}°), or holding would trip it.`)
  if (s.landAngle > s.target - 2) out.push(`“Down below” (${s.landAngle}°) must be at least 2° under the target angle.`)
  if (s.maxKmh < s.minKmh + 5) out.push(`The fastest speed (${s.maxKmh} km/h) must be at least 5 km/h above the slowest start (${s.minKmh} km/h).`)
  if (s.letGo > s.pin - 0.1) out.push(`“Ends below” must be at least 0.1 under “Pinned at”, so a pinned throttle doesn’t end it.`)
  if (s.minVolts >= s.maxVolts) out.push('Battery low must be under battery too full.')
  return out
}

/** The first thing wrong with these settings, or null. */
export const wheelieSettingsProblem = (s: WheelieSettings): string | null => wheelieSettingsProblems(s)[0] ?? null

// ---- Calibration and wiring ----

export interface WheelieCalibration {
  /** The scooter's forward, up and nose-up turning axes, in the IMU's own axes. */
  forward: Vec3
  up: Vec3
  side: Vec3
  /** deg/s the gyro reads at rest. */
  gyroBias: Vec3
  /** deg: the deck's angle with the rider standing on it, on flat ground. */
  zero: number
  /** When, and on which controller (its key). */
  at: number
  device: string
}

export interface WheelieWiring {
  /** -1: the rear motor is on the controller running the program; else its CAN ID. */
  rear: number
  /** -1: on that controller; -2: no front motor; else its CAN ID. */
  front: number
  /** 0 ADC throttle, 1 PPM. */
  input: 0 | 1
  /** m/s per ERPM of the rear motor. */
  speedPerErpm: number
  /** s: the throttle app's ramp-down time plus a margin, waited out before handing control back. */
  handbackWait: number
}

const def = (name: string, v: number, int = false) => `(def ${name} ${int ? li(v) : lf(v)})`

function settingDefs(s: WheelieSettings): string[] {
  return WHEELIE_FIELDS.map((f) => def(lispName(f.key), s[f.key], f.int || f.toggle || !!f.choices))
}

function calibrationDefs(c: WheelieCalibration): string[] {
  const axes: [string, Vec3][] = [
    ['f', c.forward],
    ['u', c.up],
    ['s', c.side],
    ['gb', c.gyroBias],
  ]
  return [...axes.flatMap(([p, v]) => v.map((x, i) => def(`wl-${p}${'xyz'[i]}`, x))), def('wl-zero', c.zero)]
}

function wiringDefs(w: WheelieWiring): string[] {
  return [
    def('wl-rear', w.rear, true),
    def('wl-front', w.front, true),
    def('wl-input', w.input, true),
    def('wl-spe', w.speedPerErpm),
    def('wl-handback-wait', w.handbackWait),
  ]
}

/** Fills a block's (def …) values in, keeping each line's comment. */
function fill(src: string, name: string, defs: string[]): string {
  const b = block(src, name)
  const values = new Map(defs.map((d) => [/\(def (\S+) /.exec(d)![1], d]))
  const text = b.text.replace(/\(def (wl-[a-z0-9-]+) (-?[\d.]+)\)/g, (_whole, n: string) => {
    const d = values.get(n)
    if (!d) throw new Error(`No value for ${n}.`)
    values.delete(n)
    return d
  })
  if (values.size) throw new Error(`wheelie.lisp’s @${name} block has no place for ${[...values.keys()].join(', ')}.`)
  return src.slice(0, b.start) + text + src.slice(b.end)
}

/** The script to install as the controller's stored script, with these settings in it. */
export function wheelieProgram(s: WheelieSettings, c: WheelieCalibration, w: WheelieWiring): string {
  let src = fill(WHEELIE_LISP, 'settings', settingDefs(s))
  src = fill(src, 'calibration', calibrationDefs(c))
  return fill(src, 'wiring', wiringDefs(w))
}

/** Console commands that arm it: the settings, then (wl-start). Re-arming while armed just updates them. */
export function wheelieArmCommands(s: WheelieSettings, c: WheelieCalibration, w: WheelieWiring, runId: number): string[] {
  return packCommands([...settingDefs(s), ...calibrationDefs(c), ...wiringDefs(w), `(progn (def wl-run ${li(runId)}) (wl-start))`])
}

/** Console commands that send just the calibration, so the check (WHEELIE_PEEK_PROGRAM) reads through it. */
export function wheelieCalCommands(c: WheelieCalibration): string[] {
  return packCommands(calibrationDefs(c))
}

/** An IMU flat and facing forward, with no offsets: what's installed until the rider calibrates. Arming refuses it. */
export const UNCALIBRATED: WheelieCalibration = { forward: [1, 0, 0], up: [0, 0, 1], side: [0, -1, 0], gyroBias: [0, 0, 0], zero: 0, at: 0, device: '' }

/** The settings in one comparable string. */
export const wheelieSettingsKey = (s: WheelieSettings) => WHEELIE_FIELDS.map((f) => s[f.key]).join('|')

/** Disarms it; mid-wheelie it lands first. */
export const WHEELIE_OFF_PROGRAM = '(wl-off)'
/** Asks for 5 s more of live data (20 a second). */
export const WHEELIE_TELEMETRY_PROGRAM = '(def wl-tele 100)'
/** Prints "(version on state reason count beat run)". */
export const WHEELIE_STATUS_PROGRAM = '(list wl-version wl-on wl-state wl-reason wl-count wl-beat wl-run)'
/** The status, and 5 s more of live data. */
export const WHEELIE_LIVE_PROGRAM = `(progn ${WHEELIE_TELEMETRY_PROGRAM} ${WHEELIE_STATUS_PROGRAM})`
/** Starts a one-second IMU average; read the result with WHEELIE_CAL_READ about 1.2 s later. */
export const WHEELIE_CAL_START = '(wl-cal)'
export const WHEELIE_CAL_READ = 'wl-cal-out'
/** Prints the pitch and roll (deg × 10) gravity shows right now, through the installed calibration. */
export const WHEELIE_PEEK_PROGRAM = '(wl-peek)'

// ---- What it reports ----

export const WHEELIE_STATES = ['Off', 'Armed', 'Lifting', 'Holding', 'Catching', 'Landing', 'Waiting for you to let go', 'Stopped by a fault'] as const

export const WHEELIE_REASONS: Record<number, string> = {
  1: 'You let go of the throttle.',
  2: 'The time limit ran out.',
  3: 'Too fast.',
  4: 'Too slow.',
  5: 'The nose went past the cut-out angle, so it braked to bring it down.',
  6: 'The scooter leaned to the side.',
  7: 'The scooter turned too sharply.',
  8: 'A brake was pulled (the rear wheel slowed while pushed).',
  9: 'The front brake was pulled (the front wheel stopped in the air).',
  10: 'The battery is too low.',
  11: 'The battery current stayed too high.',
  12: 'A controller is too hot.',
  13: 'A motor is too hot.',
  14: 'The IMU stopped giving readings.',
  15: 'The program fell behind (its loop ran late).',
  16: 'The other controller stopped answering over CAN.',
  17: 'The front wheel didn’t lift. Lean back as you pin it, or raise the kick.',
  18: 'The rear wheel spun.',
  19: 'Switched off.',
  20: 'Disarmed: armed too long without a wheelie.',
  21: 'A controller reported a fault.',
  22: 'The battery is too full to brake safely. Ride a little first.',
  23: 'The scooter wasn’t level when you pinned the throttle.',
  24: 'The front wheel came back down (it needed more push than it has).',
}

export interface WheelieStatus {
  version: number
  on: boolean
  state: number
  reason: number
  count: number
  beat: number
  runId: number
}

/** Reads WHEELIE_STATUS_PROGRAM's output: 'missing' when the program isn't installed. */
export function parseWheelieStatus(text: string): WheelieStatus | 'missing' | null {
  const m = /\(\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*\)/.exec(text)
  if (m) {
    const [version, on, state, reason, count, beat, runId] = m.slice(1).map(Number)
    return { version, on: on === 1, state, reason, count, beat, runId }
  }
  return /not.?bound|undefined|variable|wl-/i.test(text) ? 'missing' : null
}

export interface ImuAverage {
  /** g. */
  acc: Vec3
  /** deg/s. */
  gyro: Vec3
  /** g: how far gravity's size moved while averaging. */
  spread: number
}

/** Reads WHEELIE_CAL_READ's output: 'busy' while the average is still being taken. */
export function parseImuAverage(text: string): ImuAverage | 'busy' | 'missing' | null {
  const m = /\(\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*\)/.exec(text)
  if (m) {
    const n = m.slice(1).map((x) => Number(x) / 10000)
    return { acc: [n[0], n[1], n[2]], gyro: [n[3], n[4], n[5]], spread: n[6] }
  }
  if (/>\s*0\s*$/m.test(text)) return 'busy'
  return /not.?bound|undefined|variable|wl-/i.test(text) ? 'missing' : null
}

/** Reads WHEELIE_PEEK_PROGRAM's output: degrees. */
export function parsePeek(text: string): { pitch: number; roll: number } | null {
  const m = /\(\s*(-?\d+)\s+(-?\d+)\s*\)/.exec(text)
  return m ? { pitch: Number(m[1]) / 10, roll: Number(m[2]) / 10 } : null
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: Vec3) => Math.hypot(...a)
const unit = (a: Vec3): Vec3 => a.map((x) => x / norm(a)) as Vec3
const DEG = 180 / Math.PI

/** What's wrong with the first still moment (flat ground, no one on it), or null. */
export function levelProblem(level: ImuAverage): string | null {
  const g1 = norm(level.acc)
  if (g1 < 0.85 || g1 > 1.15) return `The IMU read ${g1.toFixed(2)} g standing still instead of about 1 g. Check the controller’s IMU is working.`
  if (level.spread > 0.03) return 'The scooter moved while it was being measured. Keep it still, with no one touching it.'
  if (norm(level.gyro) > 10) return 'The gyro reads a large turn while still. Check the IMU.'
  return null
}

/**
 * The calibration from three still moments: the scooter on flat ground with no
 * one on it; the same with the front lifted by hand (10° or more); and you
 * standing on it, level. Up comes from the first, the axis the nose turns
 * around from the first two, and the angle to call level from the third.
 */
export function calibrationFrom(level: ImuAverage, tipped: ImuAverage, loaded: ImuAverage, device: string, at = Date.now()): WheelieCalibration | { problem: string } {
  const bad = levelProblem(level)
  if (bad) return { problem: bad }
  if (tipped.spread > 0.03) return { problem: 'The scooter moved while the lifted angle was measured. Hold it still.' }
  const up = unit(level.acc)
  const a2 = unit(tipped.acc)
  const tilt = Math.acos(Math.max(-1, Math.min(1, dot(up, a2)))) * DEG
  if (tilt < 8) return { problem: `The front was only ${tilt.toFixed(0)}° up. Lift it 10° or more (about a hand’s width at the front wheel) and hold it still.` }
  if (tilt > 60) return { problem: `That was ${tilt.toFixed(0)}° from level. Lift only the front, 10 to 30°.` }
  const side = unit(cross(a2, up))
  const forward = cross(up, side)
  if (loaded.spread > 0.06) return { problem: 'You moved while standing on it. Hold on to something and stand still.' }
  const a3 = unit(loaded.acc)
  const zero = Math.atan2(dot(forward, a3), dot(up, a3)) * DEG
  const roll = Math.atan2(-dot(side, a3), dot(up, a3)) * DEG
  if (Math.abs(zero) > 8) return { problem: `Standing on it, the deck tipped ${zero.toFixed(1)}°. That’s more than rear suspension sag; stand on flat ground and try again.` }
  if (Math.abs(roll) > 6) return { problem: `Standing on it, the scooter leaned ${roll.toFixed(1)}° to the side. Stand it upright and try again.` }
  return { forward, up, side, gyroBias: level.gyro, zero, at, device }
}

// ---- Live data ----

export interface WheelieTelemetry {
  version: number
  state: number
  reason: number
  dry: boolean
  bench: boolean
  count: number
  /** deg, nose up from riding level. */
  pitch: number
  /** deg/s. */
  rate: number
  roll: number
  /** deg/s. */
  yaw: number
  /** A: rear and front; negative brakes. */
  rear: number
  front: number
  /** m/s. */
  speed: number
  throttle: number
  /** s in control so far. */
  took: number
  /** s between runs of the loop. */
  loopDt: number
}

/** Reads one packet of the program's custom app data, or null when it isn't one. */
export function decodeWheelieTelemetry(data: Uint8Array): WheelieTelemetry | null {
  if (data.length < 48 || data[0] !== 87 || data[1] !== 76) return null
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const f = (i: number) => v.getFloat32(i)
  return {
    version: data[2],
    state: data[3],
    reason: data[4],
    dry: (data[5] & 1) === 1,
    bench: (data[5] & 2) === 2,
    count: v.getInt16(6),
    pitch: f(8),
    rate: f(12),
    roll: f(16),
    yaw: f(20),
    rear: f(24),
    front: f(28),
    speed: f(32),
    throttle: f(36),
    took: f(40),
    loopDt: f(44),
  }
}
