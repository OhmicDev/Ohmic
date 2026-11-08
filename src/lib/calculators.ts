// Maths for the calculators page. Inputs are checked by the page against each
// field's range first (out-of-range values are refused, not trimmed), so these
// functions can assume sensible numbers.

import { BATTERY_KINDS, type BatteryKind } from './setupMath'

export interface FieldSpec {
  label: string
  unit: string
  min: number
  max: number
  /** Whole numbers only. */
  integer?: boolean
}

/** Why a typed value can't be used, or null when it's fine. */
export function fieldProblem(spec: FieldSpec, text: string): string | null {
  const t = text.trim().replace(',', '.')
  if (t === '') return 'Enter a value.'
  const v = Number(t)
  if (!Number.isFinite(v)) return 'Enter a number.'
  if (spec.integer && !Number.isInteger(v)) return 'Enter a whole number.'
  if (v < spec.min || v > spec.max) return `Enter ${spec.min} to ${spec.max}${spec.unit ? ` ${spec.unit}` : ''}.`
  return null
}

export const parseField = (text: string) => Number(text.trim().replace(',', '.'))

const kind = (k: BatteryKind) => BATTERY_KINDS.find((b) => b.value === k)!

// ---------------------------------------------------------------- battery

export interface PackInput {
  chemistry: BatteryKind
  series: number
  parallel: number
  /** One cell's capacity (Ah). */
  cellAh: number
  /** One cell's continuous discharge rating (A). */
  cellMaxA: number
}

export interface PackResult {
  fullV: number
  nominalV: number
  /** Where a typical cut-off stops the motor. */
  emptyV: number
  ah: number
  wh: number
  /** Most the pack can deliver continuously (A). */
  maxA: number
  /** At nominal voltage (W). */
  maxPowerW: number
}

export function pack(p: PackInput): PackResult {
  const k = kind(p.chemistry)
  const ah = p.parallel * p.cellAh
  const nominalV = p.series * k.nominal
  const maxA = p.parallel * p.cellMaxA
  return {
    fullV: p.series * k.full,
    nominalV,
    emptyV: p.series * k.cutEnd,
    ah,
    wh: nominalV * ah,
    maxA,
    maxPowerW: nominalV * maxA,
  }
}

/** Pack energy (Wh) from cells in series and the pack's amp hours. */
export const packWhFrom = (chemistry: BatteryKind, series: number, ah: number) => series * kind(chemistry).nominal * ah
export const fullVoltage = (chemistry: BatteryKind, series: number) => series * kind(chemistry).full

// ---------------------------------------------------------------- range

/** Distance (km) on a charge, using only part of it (a pack is rarely run flat). */
export function rangeKm(wh: number, usablePct: number, whPerKm: number): number {
  return (wh * usablePct) / 100 / whPerKm
}

/** Typical consumption for a vehicle type at a steady speed, before you have rides of your own (Wh/km). */
export const TYPICAL_WH_PER_KM = [
  { label: 'E-bike', value: 10 },
  { label: 'Scooter', value: 18 },
  { label: 'Skateboard', value: 15 },
  { label: 'Fast scooter', value: 30 },
] as const

// ---------------------------------------------------------------- speed

export interface SpeedInput {
  volts: number
  /** Motor rpm per volt. */
  kv: number
  wheelMm: number
  /** Motor turns per wheel turn (1 for hub motors). */
  gearRatio: number
  maxDutyPct: number
}

/** Under load you get about this share of the no-load speed (air, rolling and copper losses). */
export const LOADED_SHARE = 0.85

/** Top speed with no load (km/h): motor rpm = KV × volts × duty. */
export function topSpeedKmh(s: SpeedInput): number {
  const motorRpm = s.kv * s.volts * (s.maxDutyPct / 100)
  const wheelRpm = motorRpm / s.gearRatio
  return (wheelRpm * Math.PI * (s.wheelMm / 1000) * 60) / 1000
}

/** Motor speed limit as ERPM for a top speed: what the controller's ERPM limit means on the road. */
export function erpmAt(kmh: number, poles: number, wheelMm: number, gearRatio: number): number {
  const wheelRpm = (kmh * 1000) / 60 / (Math.PI * (wheelMm / 1000))
  return wheelRpm * gearRatio * (poles / 2)
}

// ---------------------------------------------------------------- charging

/** Most chargers give full current up to about here, then taper. */
const CV_FROM_PCT = 80

/**
 * Hours to charge from one % to another: full current to 80 %, then the current
 * tapers, which takes about twice as long per % (a common rule of thumb).
 */
export function chargeHours(packAh: number, chargerA: number, fromPct: number, toPct: number): number {
  if (toPct <= fromPct) return 0
  const cc = Math.max(0, Math.min(toPct, CV_FROM_PCT) - Math.min(fromPct, CV_FROM_PCT))
  const cv = Math.max(0, Math.max(toPct, CV_FROM_PCT) - Math.max(fromPct, CV_FROM_PCT))
  return ((cc / 100) * packAh) / chargerA + ((cv / 100) * packAh) / (chargerA * 0.5)
}

/** Charge rate as a multiple of capacity (1 C fills the pack in about an hour). */
export const cRate = (chargerA: number, packAh: number) => chargerA / packAh

// ---------------------------------------------------------------- gearing

export interface GearResult {
  ratio: number
  /** Wheel torque compared to direct drive. */
  torqueX: number
  /** Speed compared to direct drive. */
  speedX: number
}

export function gearing(motorTeeth: number, wheelTeeth: number): GearResult {
  const ratio = wheelTeeth / motorTeeth
  return { ratio, torqueX: ratio, speedX: 1 / ratio }
}

// ---------------------------------------------------------------- power

export const watts = (volts: number, amps: number) => volts * amps
export const amps = (volts: number, w: number) => w / volts
export const horsepower = (w: number) => w / 745.7

/**
 * Battery current for a motor current at a duty cycle: power in ≈ power out, and the
 * motor sees the battery voltage × duty, so battery A ≈ motor A × duty (losses ignored).
 */
export const batteryAmpsFromMotor = (motorA: number, dutyPct: number) => (motorA * dutyPct) / 100

// ---------------------------------------------------------------- what if

export interface WhatIfSetup {
  chemistry: BatteryKind
  series: number
  ah: number
  wheelMm: number
  /** Whole vehicle (A). */
  batteryA: number
}

export interface WhatIfShared {
  kv: number
  gearRatio: number
  maxDutyPct: number
  whPerKm: number
  usablePct: number
}

export interface WhatIfResult {
  fullV: number
  nominalV: number
  wh: number
  rangeKm: number
  topSpeedKmh: number
  /** Battery power at the current limit, at nominal voltage (W). */
  powerW: number
}

export function whatIf(s: WhatIfSetup, shared: WhatIfShared): WhatIfResult {
  const k = kind(s.chemistry)
  const nominalV = s.series * k.nominal
  const wh = nominalV * s.ah
  return {
    fullV: s.series * k.full,
    nominalV,
    wh,
    // Same riding style: consumption per km stays about the same (a little more at a higher top speed).
    rangeKm: rangeKm(wh, shared.usablePct, shared.whPerKm),
    topSpeedKmh: topSpeedKmh({ volts: nominalV, kv: shared.kv, wheelMm: s.wheelMm, gearRatio: shared.gearRatio, maxDutyPct: shared.maxDutyPct }),
    powerW: nominalV * s.batteryA,
  }
}

/** Change from a to b as a signed %, or null when a is zero. */
export const pctChange = (a: number, b: number) => (a === 0 ? null : ((b - a) / a) * 100)
