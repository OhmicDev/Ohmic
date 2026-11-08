// Messages for ride modes, setup wizards and motor tests (bldc comm/commands.c):
// temporary limits, FOC detection, decoded throttle input, and direct motor commands.

import { BufferReader, BufferWriter } from './buffer'
import { faultInfo } from './faults'

// ---------------------------------------------------------------- temporary limits

/**
 * The live limits COMM_SET_MCCONF_TEMP changes. They're fields of the motor config,
 * changed in RAM only: a reboot (or a normal config write) puts the stored values back.
 */
export interface TempLimits {
  currentMinScale: number // 0..1, braking current
  currentMaxScale: number // 0..1, drive current
  minErpm: number // negative
  maxErpm: number
  minDuty: number
  maxDuty: number
  wattMin: number // negative
  wattMax: number
  inCurrentMin: number // negative, battery regen
  inCurrentMax: number
}

/** Motor config names for each temporary limit. */
export const TEMP_FIELDS: Record<keyof TempLimits, string> = {
  currentMinScale: 'l_current_min_scale',
  currentMaxScale: 'l_current_max_scale',
  minErpm: 'l_min_erpm',
  maxErpm: 'l_max_erpm',
  minDuty: 'l_min_duty',
  maxDuty: 'l_max_duty',
  wattMin: 'l_watt_min',
  wattMax: 'l_watt_max',
  inCurrentMin: 'l_in_current_min',
  inCurrentMax: 'l_in_current_max',
}

export const TEMP_KEYS = Object.keys(TEMP_FIELDS) as (keyof TempLimits)[]

/**
 * COMM_SET_MCCONF_TEMP body. Sent to one controller at a time (CAN forwarding does
 * the routing), so the firmware's own broadcast and per-controller division stay off.
 * The battery-current pair is optional on the wire; the firmware reads it when present.
 */
export function encodeTempLimits(l: TempLimits, opts: { store?: boolean; ack?: boolean } = {}): Uint8Array {
  const w = new BufferWriter()
  w.u8(opts.store ? 1 : 0) // store
  w.u8(0) // forward_can
  w.u8(opts.ack === false ? 0 : 1) // ack
  w.u8(0) // divide_by_controllers
  w.f32auto(l.currentMinScale).f32auto(l.currentMaxScale)
  w.f32auto(l.minErpm).f32auto(l.maxErpm)
  w.f32auto(l.minDuty).f32auto(l.maxDuty)
  w.f32auto(l.wattMin).f32auto(l.wattMax)
  w.f32auto(l.inCurrentMin).f32auto(l.inCurrentMax)
  return w.toUint8Array()
}

export function decodeTempLimitsBody(body: Uint8Array): TempLimits & { store: boolean; ack: boolean } {
  const r = new BufferReader(body)
  const store = r.u8() === 1
  r.u8()
  const ack = r.u8() === 1
  r.u8()
  const l: TempLimits = {
    currentMinScale: r.f32auto(),
    currentMaxScale: r.f32auto(),
    minErpm: r.f32auto(),
    maxErpm: r.f32auto(),
    minDuty: r.f32auto(),
    maxDuty: r.f32auto(),
    wattMin: r.f32auto(),
    wattMax: r.f32auto(),
    inCurrentMin: NaN,
    inCurrentMax: NaN,
  }
  if (r.has(8)) {
    l.inCurrentMin = r.f32auto()
    l.inCurrentMax = r.f32auto()
  }
  return { ...l, store, ack }
}

/** COMM_GET_MCCONF_TEMP reply: the live limits plus the wheel setup the firmware uses for speed. */
export function decodeTempLimits(r: BufferReader): TempLimits & { motorPoles: number; gearRatio: number; wheelDiameter: number } {
  return {
    currentMinScale: r.f32auto(),
    currentMaxScale: r.f32auto(),
    minErpm: r.f32auto(),
    maxErpm: r.f32auto(),
    minDuty: r.f32auto(),
    maxDuty: r.f32auto(),
    wattMin: r.f32auto(),
    wattMax: r.f32auto(),
    inCurrentMin: r.f32auto(),
    inCurrentMax: r.f32auto(),
    motorPoles: r.u8(),
    gearRatio: r.f32auto(),
    wheelDiameter: r.f32auto(),
  }
}

export function encodeTempLimitsReply(l: TempLimits, wheel: { motorPoles: number; gearRatio: number; wheelDiameter: number }): Uint8Array {
  const w = new BufferWriter()
  for (const k of TEMP_KEYS) w.f32auto(l[k])
  w.u8(wheel.motorPoles).f32auto(wheel.gearRatio).f32auto(wheel.wheelDiameter)
  return w.toUint8Array()
}

// ---------------------------------------------------------------- FOC detection

export interface DetectArgs {
  /** Also detect every motor controller on the CAN bus. */
  detectCan: boolean
  /** Watts the motor may dissipate during detection; sets the test current. */
  maxPowerLoss: number
  /** Battery current limits during detection (A; min is negative). */
  minCurrentIn: number
  maxCurrentIn: number
  /** ERPM for the open-loop spin-up and where sensorless takes over. */
  openloopErpm: number
  sensorlessErpm: number
}

export function encodeDetectArgs(a: DetectArgs): Uint8Array {
  return new BufferWriter()
    .u8(a.detectCan ? 1 : 0)
    .f32(a.maxPowerLoss, 1e3)
    .f32(a.minCurrentIn, 1e3)
    .f32(a.maxCurrentIn, 1e3)
    .f32(a.openloopErpm, 1e3)
    .f32(a.sensorlessErpm, 1e3)
    .toUint8Array()
}

export function decodeDetectArgs(body: Uint8Array): DetectArgs {
  const r = new BufferReader(body)
  return {
    detectCan: r.u8() === 1,
    maxPowerLoss: r.f32(1e3),
    minCurrentIn: r.f32(1e3),
    maxCurrentIn: r.f32(1e3),
    openloopErpm: r.f32(1e3),
    sensorlessErpm: r.f32(1e3),
  }
}

export type DetectSensor = 'sensorless' | 'hall' | 'encoder'

export type DetectResult =
  | { ok: true; code: number; sensor: DetectSensor }
  | { ok: false; code: number; message: string }

/** Meaning of the int16 COMM_DETECT_APPLY_ALL_FOC returns (conf_general.c). */
export function detectResult(code: number): DetectResult {
  if (code >= 0) return { ok: true, code, sensor: code === 1 ? 'hall' : code === 2 ? 'encoder' : 'sensorless' }
  if (code === -10) return { ok: false, code, message: 'Measuring the motor’s magnets (flux linkage) failed. The motor may not have spun up: check the wheel turns freely and try a higher power setting.' }
  if (code === -50) return { ok: false, code, message: 'A controller on the CAN bus didn’t report back in time.' }
  if (code === -51) return { ok: false, code, message: 'Detection failed on a controller on the CAN bus. Run it on that controller on its own to see why.' }
  // A fault during detection comes back as (fault code - 100).
  if (code >= -100 && code < -60) {
    const fault = faultInfo(code + 100)
    return { ok: false, code, message: `The controller reported a fault during detection: ${fault.title}. ${fault.help}` }
  }
  return { ok: false, code, message: `Detection failed (code ${code}).` }
}

// ---------------------------------------------------------------- throttle and brake input

export interface DecodedAdc {
  /** Throttle (ADC1) as the app maps it: 0..1, or -1..1 with reverse/centre modes. */
  level: number
  voltage: number
  /** Brake (ADC2). */
  level2: number
  voltage2: number
}

export function decodeDecodedAdc(r: BufferReader): DecodedAdc {
  return { level: r.i32() / 1e6, voltage: r.i32() / 1e6, level2: r.i32() / 1e6, voltage2: r.i32() / 1e6 }
}

export function encodeDecodedAdc(d: DecodedAdc): Uint8Array {
  return new BufferWriter()
    .i32(Math.round(d.level * 1e6))
    .i32(Math.round(d.voltage * 1e6))
    .i32(Math.round(d.level2 * 1e6))
    .i32(Math.round(d.voltage2 * 1e6))
    .toUint8Array()
}

export interface DecodedPpm {
  level: number
  /** Last pulse length in milliseconds. */
  pulseMs: number
}

export function decodeDecodedPpm(r: BufferReader): DecodedPpm {
  return { level: r.i32() / 1e6, pulseMs: r.i32() / 1e6 }
}

export function encodeDecodedPpm(d: DecodedPpm): Uint8Array {
  return new BufferWriter().i32(Math.round(d.level * 1e6)).i32(Math.round(d.pulseMs * 1e6)).toUint8Array()
}

// ---------------------------------------------------------------- motor commands

/** COMM_SET_RPM: hold an electrical RPM. Resets the controller's command timeout. */
export const encodeSetRpm = (erpm: number) => new BufferWriter().i32(Math.round(erpm)).toUint8Array()

/** COMM_SET_CURRENT: motor current in amps (sent as mA). Zero releases the motor. */
export const encodeSetCurrent = (amps: number) => new BufferWriter().i32(Math.round(amps * 1000)).toUint8Array()

/** COMM_SET_DUTY: duty cycle as a fraction (-1..1), sent ×100 000. */
export const encodeSetDuty = (duty: number) => new BufferWriter().i32(Math.round(duty * 100_000)).toUint8Array()

/** COMM_SET_POS: rotor position in degrees, sent ×1 000 000. */
export const encodeSetPos = (deg: number) => new BufferWriter().i32(Math.round(deg * 1_000_000)).toUint8Array()

/** COMM_SET_HANDBRAKE: holding current in amps (a float the firmware reads ×1000, so the same as mA). */
export const encodeSetHandbrake = (amps: number) => new BufferWriter().i32(Math.round(amps * 1000)).toUint8Array()

// ---------------------------------------------------------------- LispBM REPL

const enc = new TextEncoder()
const dec = new TextDecoder()

/** COMM_LISP_REPL_CMD body: the expression as a NUL-terminated string. */
export function encodeReplCmd(code: string): Uint8Array {
  const bytes = enc.encode(code)
  const out = new Uint8Array(bytes.length + 1)
  out.set(bytes)
  return out
}

export function decodeReplCmd(body: Uint8Array): string {
  const end = body.indexOf(0)
  return dec.decode(end === -1 ? body : body.subarray(0, end))
}

/** COMM_LISP_PRINT body: text, no terminator. */
export function decodeLispPrint(body: Uint8Array): string {
  return dec.decode(body).replace(/\0+$/, '')
}
