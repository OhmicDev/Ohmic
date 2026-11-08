// Ride modes: a few limits applied on top of each controller's own settings,
// temporarily (COMM_SET_MCCONF_TEMP), so they can be switched mid-ride and are
// gone after a power cycle. Pure maths here; the store sends them.

import type { ConfigValues } from '../config/types'
import { TEMP_FIELDS, TEMP_KEYS, type TempLimits } from '../protocol/setup'

export interface RideMode {
  id: string
  name: string
  /** Shipped with the app: can be edited, not deleted. */
  starter?: boolean
  order: number
  /** Each setting is a share of what the controller is set up for, or null for "Default" (unchanged). */
  motorPct: number | null
  regenPct: number | null
  batteryPct: number | null
  maxSpeedKmh: number | null
  /** Total for the vehicle; split between the motors that are driving. */
  maxPowerW: number | null
}

export type ModeSetting = 'motorPct' | 'regenPct' | 'batteryPct' | 'maxSpeedKmh' | 'maxPowerW'

export interface SettingInfo {
  key: ModeSetting
  label: string
  unit: string
  min: number
  max: number
  step: number
  help: string
}

export const MODE_SETTINGS: SettingInfo[] = [
  {
    key: 'motorPct',
    label: 'Motor power',
    unit: '%',
    min: 5,
    max: 100,
    step: 5,
    help: 'How hard the motor pulls: a share of the motor current limit. Lower is gentler off the line and up hills.',
  },
  {
    key: 'regenPct',
    label: 'Motor braking',
    unit: '%',
    min: 0,
    max: 100,
    step: 5,
    help: 'How strongly the motor brakes (and charges the battery) when you pull the brake. 0 leaves braking to the mechanical brakes.',
  },
  {
    key: 'batteryPct',
    label: 'Battery draw',
    unit: '%',
    min: 5,
    max: 100,
    step: 5,
    help: 'A share of the battery current limit. Lower is easier on the battery and adds range, at the cost of top-end punch.',
  },
  {
    key: 'maxSpeedKmh',
    label: 'Top speed',
    unit: 'km/h',
    min: 5,
    max: 150,
    step: 1,
    help: 'The motor stops pushing above this speed. Worked out from each controller’s wheel size, gearing and motor poles.',
  },
  {
    key: 'maxPowerW',
    label: 'Power cap',
    unit: 'W',
    min: 100,
    max: 50000,
    step: 50,
    help: 'Most power drawn from the battery, for the whole vehicle. Shared between the motors that are driving.',
  },
]

const mode = (id: string, name: string, order: number, s: Partial<RideMode>): RideMode => ({
  id,
  name,
  order,
  motorPct: null,
  regenPct: null,
  batteryPct: null,
  maxSpeedKmh: null,
  maxPowerW: null,
  ...s,
})

export const STARTER_MODES: RideMode[] = [
  mode('eco', 'Eco', 0, { starter: true, motorPct: 50, regenPct: 70, batteryPct: 50, maxSpeedKmh: 20 }),
  mode('normal', 'Normal', 1, { starter: true, motorPct: 75, batteryPct: 80 }),
  mode('sport', 'Sport', 2, { starter: true }),
]

export const TEMPLATES: { name: string; about: string; settings: Partial<RideMode> }[] = [
  { name: 'Beginner', about: 'Soft starts and a low top speed for learning.', settings: { motorPct: 35, regenPct: 50, batteryPct: 40, maxSpeedKmh: 15 } },
  { name: 'Commute', about: 'Smooth and capped at 25 km/h, like many local speed limits.', settings: { motorPct: 70, batteryPct: 70, maxSpeedKmh: 25 } },
  { name: 'Range', about: 'Gentle on the battery to go further.', settings: { motorPct: 55, batteryPct: 50, maxSpeedKmh: 30 } },
  { name: 'Hill', about: 'Full pulling power with a modest top speed.', settings: { maxSpeedKmh: 30 } },
  { name: 'Track', about: 'Everything the controllers are set up for. No app limits.', settings: {} },
]

/** The temporary-limit fields of a motor config. */
export function limitsFromConfig(mc: ConfigValues): TempLimits {
  const out = {} as TempLimits
  for (const k of TEMP_KEYS) out[k] = Number(mc[TEMP_FIELDS[k]])
  return out
}

/** The same config with these limits in place of its own. */
export function withLimits(mc: ConfigValues, l: TempLimits): ConfigValues {
  const out = { ...mc }
  for (const k of TEMP_KEYS) out[TEMP_FIELDS[k]] = l[k]
  return out
}

/** Values travel as 32-bit floats, so compare loosely. */
export function sameLimits(a: TempLimits, b: TempLimits): boolean {
  return TEMP_KEYS.every((k) => {
    const x = a[k]
    const y = b[k]
    if (!Number.isFinite(x) || !Number.isFinite(y)) return true // optional pair not reported
    return Math.abs(x - y) <= Math.max(1e-4, Math.abs(x) * 1e-5)
  })
}

/** Electrical RPM at a road speed, for one controller's wheel setup. */
export function erpmForSpeed(kmh: number, mc: ConfigValues): number {
  const poles = Number(mc.si_motor_poles) || 0
  const gear = Number(mc.si_gear_ratio) || 1
  const wheel = Number(mc.si_wheel_diameter) || 0
  if (poles <= 0 || wheel <= 0) return NaN
  return ((kmh / 3.6) / (Math.PI * wheel)) * 60 * gear * (poles / 2)
}

/** Metres per second for each ERPM, for one controller's wheel setup. */
export function speedPerErpm(mc: ConfigValues): number {
  const one = erpmForSpeed(3.6, mc) // ERPM at 1 m/s
  return Number.isFinite(one) && one > 0 ? 1 / one : NaN
}

export type MotorUse = 'dual' | 'single'

/**
 * Limits for one controller: its stored settings with the mode applied on top.
 * `driving` is false for a motor switched off in single-motor mode: no drive and
 * no motor braking, so it rolls freely.
 */
export function limitsFor(stock: TempLimits, mc: ConfigValues, m: RideMode | null, driving: boolean, drivingCount: number): TempLimits {
  const l = { ...stock }
  if (m) {
    if (m.motorPct !== null) l.currentMaxScale = stock.currentMaxScale * (m.motorPct / 100)
    if (m.regenPct !== null) l.currentMinScale = stock.currentMinScale * (m.regenPct / 100)
    if (m.batteryPct !== null && Number.isFinite(stock.inCurrentMax)) l.inCurrentMax = stock.inCurrentMax * (m.batteryPct / 100)
    if (m.maxSpeedKmh !== null) {
      const erpm = erpmForSpeed(m.maxSpeedKmh, mc)
      if (Number.isFinite(erpm)) {
        l.maxErpm = Math.min(stock.maxErpm, erpm)
        l.minErpm = Math.max(stock.minErpm, -erpm)
      }
    }
    if (m.maxPowerW !== null) l.wattMax = Math.min(stock.wattMax, m.maxPowerW / Math.max(1, drivingCount))
  }
  if (!driving) {
    l.currentMaxScale = 0
    l.currentMinScale = 0
  }
  return l
}

/** Problems with a mode's values; out-of-range numbers are refused, never clamped. */
export function modeIssues(m: RideMode): string[] {
  const out: string[] = []
  if (!m.name.trim()) out.push('Give the mode a name.')
  for (const s of MODE_SETTINGS) {
    const v = m[s.key]
    if (v === null) continue
    if (!Number.isFinite(v)) out.push(`${s.label}: enter a number.`)
    else if (v < s.min || v > s.max) out.push(`${s.label}: must be between ${s.min} and ${s.max} ${s.unit}.`)
  }
  return out
}

export function describeMode(m: RideMode, fmtSpeed: (kmh: number) => string): string {
  const parts: string[] = []
  if (m.motorPct !== null) parts.push(`${m.motorPct} % power`)
  if (m.maxSpeedKmh !== null) parts.push(fmtSpeed(m.maxSpeedKmh))
  if (m.batteryPct !== null) parts.push(`${m.batteryPct} % battery`)
  if (m.regenPct !== null) parts.push(`${m.regenPct} % braking`)
  if (m.maxPowerW !== null) parts.push(`${m.maxPowerW} W`)
  return parts.length ? parts.join(' · ') : 'Your full settings'
}
