// Tunes played through the motor windings with the firmware's tone player
// (LispBM foc-play-tone, firmware 6.05+). The motor works as a speaker: a small
// AC voltage at the note's frequency makes the windings hum without turning it.
//
// Volume is set as current, because current is what heats a motor. Each note's
// voltage comes from the motor's resistance and inductance (|Z| = √(R² + (2πfL)²)),
// so low notes, where the windings resist least, get less voltage.

import { li, MAX_CMD, packCommands, squash } from './lisp'

export interface Note {
  /** Hz; 0 is a rest. */
  freq: number
  /** Milliseconds. */
  ms: number
}

export interface Tune {
  id: string
  name: string
  kind: 'tune' | 'effect'
  /** Ring-tone text (RTTTL), the format most phone-ringtone sites share. */
  rtttl: string
  /** Added by the user (kept on this device). */
  custom?: boolean
}

const NOTE_INDEX: Record<string, number> = { c: 0, 'c#': 1, d: 2, 'd#': 3, e: 4, f: 5, 'f#': 6, g: 7, 'g#': 8, a: 9, 'a#': 10, b: 11 }

export function noteFreq(name: string, octave: number): number {
  const i = NOTE_INDEX[name]
  if (i === undefined) return 0
  // A4 = 440 Hz; C4 is 9 semitones below it.
  return 440 * Math.pow(2, (i - 9) / 12 + (octave - 4))
}

export class TuneError extends Error {}

/** Parses RTTTL ("Name:d=4,o=5,b=120:8e6,8d#6,…"). Throws TuneError with a readable reason. */
export function parseRtttl(text: string): { name: string; notes: Note[] } {
  const parts = text.trim().split(':')
  if (parts.length !== 3) throw new TuneError('Expected three parts separated by colons: name, settings and notes.')
  const [rawName, settings, body] = parts
  let d = 4
  let o = 6
  let b = 63
  for (const s of settings.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    const [k, v] = s.split('=')
    const n = Number(v)
    if (!Number.isFinite(n)) throw new TuneError(`“${s}” isn’t a valid setting.`)
    if (k === 'd') d = n
    else if (k === 'o') o = n
    else if (k === 'b') b = n
  }
  if (b <= 0 || b > 900) throw new TuneError('The tempo (b=) must be between 1 and 900.')
  const whole = (60_000 / b) * 4
  const notes: Note[] = []
  for (const raw of body.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    const m = /^(\d{0,2})([a-gp]#?)(\.?)(\d?)(\.?)$/.exec(raw)
    if (!m) throw new TuneError(`“${raw}” isn’t a note this player understands.`)
    const dur = m[1] ? Number(m[1]) : d
    if (![1, 2, 4, 8, 16, 32].includes(dur)) throw new TuneError(`“${raw}”: note lengths are 1, 2, 4, 8, 16 or 32.`)
    let ms = whole / dur
    if (m[3] || m[5]) ms *= 1.5
    const octave = m[4] ? Number(m[4]) : o
    const freq = m[2] === 'p' ? 0 : noteFreq(m[2], octave)
    notes.push({ freq, ms: Math.round(ms) })
  }
  if (!notes.length) throw new TuneError('There are no notes in it.')
  return { name: rawName.trim() || 'Untitled', notes }
}

// Public-domain melodies, written out here, plus a few effects.
export const BUILT_IN_TUNES: Tune[] = [
  { id: 'startup', name: 'Start-up chime', kind: 'effect', rtttl: 'Startup:d=16,o=6,b=180:c,e,g,8c7' },
  { id: 'shutdown', name: 'Power down', kind: 'effect', rtttl: 'Shutdown:d=16,o=6,b=180:c7,g,e,8c' },
  { id: 'double', name: 'Double beep', kind: 'effect', rtttl: 'Double:d=16,o=6,b=200:a,p,a' },
  { id: 'alarm', name: 'Alarm', kind: 'effect', rtttl: 'Alarm:d=16,o=6,b=200:a,e,a,e,a,e,a,e' },
  { id: 'rise', name: 'Rising sweep', kind: 'effect', rtttl: 'Rise:d=32,o=5,b=180:c,d,e,f,g,a,b,c6,d6,e6,f6,g6,a6,b6,8c7' },
  {
    id: 'ode',
    name: 'Ode to Joy (Beethoven)',
    kind: 'tune',
    rtttl: 'OdeToJoy:d=4,o=6,b=140:e,e,f,g,g,f,e,d,c,c,d,e,e.,8d,2d,e,e,f,g,g,f,e,d,c,c,d,e,d.,8c,2c',
  },
  {
    id: 'elise',
    name: 'Für Elise (Beethoven)',
    kind: 'tune',
    rtttl: 'FurElise:d=8,o=6,b=125:e,d#,e,d#,e,b5,d,c,4a5,c5,e5,a5,4b5,e5,g#5,b5,4c,e5,e,d#,e,d#,e,b5,d,c,4a5,c5,e5,a5,4b5,e5,c,b5,2a5',
  },
  {
    id: 'hall',
    name: 'Hall of the Mountain King (Grieg)',
    kind: 'tune',
    rtttl: 'Hall:d=8,o=5,b=160:a,b,c6,d6,e6,c6,4e6,d#6,b,4d#6,d6,a#,4d6,a,b,c6,d6,e6,c6,e6,a6,g6,e6,c6,e6,2g6',
  },
  {
    id: 'twinkle',
    name: 'Twinkle Twinkle Little Star',
    kind: 'tune',
    rtttl: 'Twinkle:d=4,o=6,b=150:c,c,g,g,a,a,2g,f,f,e,e,d,d,2c',
  },
  {
    id: 'jingle',
    name: 'Jingle Bells (Pierpont)',
    kind: 'tune',
    rtttl: 'Jingle:d=8,o=6,b=180:e,e,4e,e,e,4e,e,g,c.,16d,2e,f,f,f.,16f,f,e,e,16e,16e,e,d,d,e,4d,4g',
  },
]

/** The most notes sent at once; the controller keeps the tune in its small script memory. */
export const MAX_NOTES = 80
/** Never more than this share of the battery voltage, whatever the motor values say. */
const MAX_VOLTS_OF_BATTERY = 0.25
/** A short gap between notes so repeated notes are heard as separate. */
const GAP_FRACTION = 0.12

export interface MotorElectrical {
  /** Ohms. */
  r: number
  /** Henries. */
  l: number
  /** Battery voltage now. */
  vBat: number
}

/** Volts to drive `amps` through the windings at this frequency. */
export function toneVolts(freq: number, amps: number, m: MotorElectrical): number {
  const z = Math.sqrt(m.r * m.r + Math.pow(2 * Math.PI * freq * m.l, 2))
  const cap = Math.max(0, m.vBat) * MAX_VOLTS_OF_BATTERY
  return Math.min(amps * z, cap)
}

export const tuneMs = (notes: Note[]) => notes.reduce((s, n) => s + n.ms, 0)

/** Long notes are sent in pieces, so the player checks for wheel movement often. */
const PIECE_MS = 300

/** [Hz, ms on, ms off, mV] for each piece of each note, ready to send. */
export function noteEntries(notes: Note[], amps: number, motor: MotorElectrical): number[][] {
  return notes.slice(0, MAX_NOTES).flatMap((n) => {
    const on = Math.max(10, Math.round(n.ms * (1 - GAP_FRACTION)))
    const off = Math.max(0, n.ms - on)
    const mv = n.freq > 0 ? Math.round(toneVolts(n.freq, amps, motor) * 1000) : 0
    const pieces: number[][] = []
    for (let left = on; left > 0; left -= PIECE_MS) {
      const len = Math.min(PIECE_MS, left)
      pieces.push([Math.round(n.freq), len, left - len > 0 ? 0 : off, mv])
    }
    return pieces
  })
}

// One note: stop if the wheel turns, else play it, wait, and move on. ohm-mc holds
// the rest of the current piece list, ohm-ml the lists still to come, ohm-mp the
// run that's playing (0 = stop). The names don't overlap with ABS's.
const PLAY_NOTE = (stopErpm: number) =>
  squash(`(defun ohm-mn () (let ((m (get-rpm)) (c ohm-mc))
  (if (> (* m m) ${li(stopErpm * stopErpm)}.0) (progn (foc-play-stop) (def ohm-mp 0))
    (progn
      (if (> (car c) 0) (foc-play-tone 0 (car c) (/ (car (cdr (cdr (cdr c)))) 1000.0)) (foc-play-stop))
      (sleep (/ (car (cdr c)) 1000.0))
      (if (> (car (cdr (cdr c))) 0) (progn (foc-play-stop) (sleep (/ (car (cdr (cdr c))) 1000.0))) nil)
      (def ohm-mc (cdr (cdr (cdr (cdr c)))))))))`)

const PLAYER = squash(`(defun ohm-mq (id) (progn
  (loopwhile (and (= ohm-mp id) ohm-ml) (progn
    (def ohm-mc (car ohm-ml)) (def ohm-ml (cdr ohm-ml))
    (loopwhile (and (= ohm-mp id) ohm-mc) (ohm-mn))))
  (if (= ohm-mp id) (progn (foc-play-stop) (def ohm-mp 0)) nil)))`)

/** Stops any tune. Sent on its own first, so an earlier tune has finished before a new one is loaded. */
export const STOP_PROGRAM = '(progn (def ohm-mp 0) (foc-play-stop))'

/**
 * Console commands that play the notes on channel 0 in their own thread. The tune
 * stops by itself if the motor turns faster than stopErpm.
 */
export function playCommands(notes: Note[], amps: number, motor: MotorElectrical, runId: number, stopErpm = 300): string[] {
  const entries = noteEntries(notes, amps, motor)
  // Split the data into lists that each fit in one command.
  const lists: string[] = []
  let cur: string[] = []
  const def = (i: number, xs: string[]) => `(def ohm-m${i} '(${xs.join(' ')}))`
  for (const e of entries) {
    const item = e.join(' ')
    if (cur.length && def(lists.length + 1, [...cur, item]).length > MAX_CMD - 20) {
      lists.push(def(lists.length + 1, cur))
      cur = []
    }
    cur.push(item)
  }
  if (cur.length) lists.push(def(lists.length + 1, cur))
  const names = lists.map((_, i) => `ohm-m${i + 1}`).join(' ')
  const start = `(progn (def ohm-ml (list ${names})) (def ohm-mp ${li(runId)}) (spawn (lambda () (ohm-mq ${li(runId)}))))`
  return [STOP_PROGRAM, ...packCommands([PLAY_NOTE(stopErpm), PLAYER, ...lists, start])]
}

/** Plays notes on the phone's own speaker, to hear a tune before the motor plays it. */
export function previewOnSpeaker(notes: Note[], volume = 0.08): () => void {
  if (typeof window === 'undefined') return () => {}
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return () => {}
  const ctx = new Ctx()
  let t = ctx.currentTime + 0.05
  for (const n of notes.slice(0, MAX_NOTES)) {
    const len = n.ms / 1000
    if (n.freq > 0) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      // A square-ish wave sounds closer to a humming motor than a sine.
      osc.type = 'square'
      osc.frequency.value = n.freq
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(volume, t + 0.005)
      gain.gain.setValueAtTime(volume, t + len * (1 - GAP_FRACTION) - 0.01)
      gain.gain.linearRampToValueAtTime(0, t + len * (1 - GAP_FRACTION))
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + len)
    }
    t += len
  }
  const timer = setTimeout(() => void ctx.close(), (t - ctx.currentTime) * 1000 + 200)
  return () => {
    clearTimeout(timer)
    void ctx.close()
  }
}
