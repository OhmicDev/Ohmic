// Pure maths for the setup wizards: battery settings, throttle calibration,
// what motor detection found. No app state here, so it's easy to test.

import type { ConfigValues } from '../config/types'

export type BatteryKind = 'liion' | 'lifepo4' | 'lead'

export const BATTERY_KINDS: { value: BatteryKind; label: string; full: number; nominal: number; cutStart: number; cutEnd: number; type: number }[] = [
  // Volts per cell. Cut-off start is where power starts to fade; end is where it stops.
  { value: 'liion', label: 'Li-ion (most scooters and e-bikes)', full: 4.2, nominal: 3.6, cutStart: 3.4, cutEnd: 3.1, type: 0 },
  { value: 'lifepo4', label: 'LiFePO4', full: 3.65, nominal: 3.2, cutStart: 2.9, cutEnd: 2.6, type: 1 },
  { value: 'lead', label: 'Lead acid', full: 2.15, nominal: 2.0, cutStart: 1.95, cutEnd: 1.8, type: 2 },
]

export const batteryKind = (kind: BatteryKind) => BATTERY_KINDS.find((b) => b.value === kind)!

export interface BatteryInput {
  kind: BatteryKind
  cells: number
  ah: number
  /** Most the battery may deliver (A), for the whole vehicle; null to leave the limit alone. */
  maxDischargeA: number | null
  /** Most it may take back when braking (A, positive); null to leave alone. */
  maxChargeA: number | null
}

export function batteryIssues(b: BatteryInput): string[] {
  const out: string[] = []
  if (!Number.isInteger(b.cells) || b.cells < 1 || b.cells > 40) out.push('Cells in series must be a whole number from 1 to 40.')
  if (!(b.ah > 0) || b.ah > 1000) out.push('Capacity must be between 0.1 and 1000 Ah.')
  if (b.maxDischargeA !== null && (!(b.maxDischargeA > 0) || b.maxDischargeA > 1000)) out.push('Battery discharge limit must be between 1 and 1000 A.')
  if (b.maxChargeA !== null && (!(b.maxChargeA >= 0) || b.maxChargeA > 500)) out.push('Battery charge limit must be between 0 and 500 A.')
  return out
}

/** Settings for one controller, sharing battery current between `controllers`. */
export function batterySettings(b: BatteryInput, controllers: number): ConfigValues {
  const k = batteryKind(b.kind)
  const n = Math.max(1, controllers)
  const v: ConfigValues = {
    si_battery_type: k.type,
    si_battery_cells: b.cells,
    si_battery_ah: b.ah,
    l_battery_cut_start: round(k.cutStart * b.cells, 1),
    l_battery_cut_end: round(k.cutEnd * b.cells, 1),
  }
  if (b.maxDischargeA !== null) v.l_in_current_max = round(b.maxDischargeA / n, 1)
  if (b.maxChargeA !== null) v.l_in_current_min = -round(b.maxChargeA / n, 1)
  return v
}

export const fullVoltage = (b: Pick<BatteryInput, 'kind' | 'cells'>) => batteryKind(b.kind).full * b.cells

/** Guesses cells in series from a resting voltage (for a starting value). */
export function guessCells(volts: number, kind: BatteryKind): number | null {
  const k = batteryKind(kind)
  if (!(volts > 0)) return null
  const n = Math.round(volts / k.nominal)
  return n >= 1 && n <= 40 ? n : null
}

/**
 * Cell counts a voltage could belong to, from a full pack down to where power fades.
 * A charged 13S pack and a flat 15S one read the same, so this is a range.
 */
export function cellsRange(volts: number, kind: BatteryKind): [number, number] | null {
  const k = batteryKind(kind)
  if (!(volts > 0)) return null
  const lo = Math.max(1, Math.ceil(volts / k.full - 1e-9))
  const hi = Math.min(40, Math.floor(volts / k.cutStart + 1e-9))
  return lo <= hi ? [lo, hi] : null
}

export interface Range {
  min: number
  max: number
}

export const emptyRange = (): Range => ({ min: Infinity, max: -Infinity })
export const widen = (r: Range, v: number): Range => (Number.isFinite(v) ? { min: Math.min(r.min, v), max: Math.max(r.max, v) } : r)

/** At least this much travel (V) before a lever counts as calibrated. */
const MIN_ADC_SPAN = 0.5
/** A little dead band at each end, so "released" never creeps and "full" is always reachable. */
const DEAD_BAND = 0.04

/**
 * ADC start/end voltages from what was seen while released and while pushed fully.
 * Works for levers whose voltage falls when pushed too: start is simply higher than end.
 */
export function adcEnds(rest: Range, full: Range): { start: number; end: number } | string {
  if (!Number.isFinite(rest.min) || !Number.isFinite(full.min)) return 'Move the lever through its whole travel first.'
  const restV = (rest.min + rest.max) / 2
  const up = full.max - restV
  const down = restV - full.min
  const far = up >= down ? full.max : full.min
  const span = far - restV
  if (Math.abs(span) < MIN_ADC_SPAN) return `The lever only moved ${Math.abs(span).toFixed(2)} V. Check the wiring and push it all the way.`
  const start = restV + span * DEAD_BAND
  const end = far - span * DEAD_BAND
  return { start: round(start, 3), end: round(end, 3) }
}

/** RC remote pulse lengths (ms): centre from rest, ends from the extremes. */
export function ppmEnds(rest: Range, seen: Range): { start: number; center: number; end: number } | string {
  if (!Number.isFinite(rest.min) || !Number.isFinite(seen.min)) return 'Move the stick or trigger through its whole travel first.'
  const center = (rest.min + rest.max) / 2
  if (seen.max - center < 0.2 || center - seen.min < 0.2) return 'Push the throttle fully forward and the brake fully back, so both ends are seen.'
  return { start: round(seen.min + 0.02, 3), center: round(center, 3), end: round(seen.max - 0.02, 3) }
}

/** App setting values that keep UART (a Bluetooth module, for example) running next to the new input. */
export function appToUse(input: 'adc' | 'ppm', current: number): number {
  const keepsUart = current === 3 || current === 4 || current === 5
  if (input === 'adc') return keepsUart ? 5 : 2
  return keepsUart ? 4 : 1
}

/** Motor speed constant (rpm per volt) from flux linkage, as VESC Tool shows it. */
export function kvFromFlux(fluxWb: number, motorPoles: number): number | null {
  const pp = motorPoles / 2
  if (!(fluxWb > 0) || !(pp > 0)) return null
  return 60 / (2 * Math.PI * Math.sqrt(3) * fluxWb * pp)
}

export const DETECT_PRESETS = [
  { id: 'hub', label: 'Hub motor (scooter, e-bike)', maxPowerLoss: 75, openloopErpm: 700, sensorlessErpm: 2000 },
  { id: 'small', label: 'Small outrunner (under 300 g)', maxPowerLoss: 20, openloopErpm: 1400, sensorlessErpm: 4000 },
  { id: 'medium', label: 'Medium outrunner (0.3–1 kg)', maxPowerLoss: 70, openloopErpm: 1400, sensorlessErpm: 4000 },
  { id: 'large', label: 'Large outrunner (1–3 kg)', maxPowerLoss: 200, openloopErpm: 1400, sensorlessErpm: 4000 },
] as const

export interface DetectInput {
  maxPowerLoss: number
  minCurrentIn: number
  maxCurrentIn: number
  openloopErpm: number
  sensorlessErpm: number
}

export function detectIssues(d: DetectInput): string[] {
  const out: string[] = []
  if (!(d.maxPowerLoss >= 5) || d.maxPowerLoss > 2000) out.push('Power loss must be between 5 and 2000 W.')
  if (!(d.maxCurrentIn > 0) || d.maxCurrentIn > 500) out.push('Battery discharge limit must be between 1 and 500 A.')
  if (!(d.minCurrentIn <= 0) || d.minCurrentIn < -500) out.push('Battery charge limit must be between −500 and 0 A.')
  if (!(d.openloopErpm >= 100) || d.openloopErpm > 20000) out.push('Openloop ERPM must be between 100 and 20 000.')
  if (!(d.sensorlessErpm >= 500) || d.sensorlessErpm > 50000) out.push('Sensorless ERPM must be between 500 and 50 000.')
  return out
}

function round(n: number, digits: number) {
  const f = 10 ** digits
  return Math.round(n * f) / f
}
