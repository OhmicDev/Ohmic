// What each dial on the Gauges page shows, and the range it sweeps. Ranges come from
// the controllers' own limits where they're set (current, temperature, duty), so a
// full dial means the controller is at its limit; otherwise from this ride's peaks.

import type { ConfigValues } from '../../config/types'
import { convertPerDistance, convertSpeed, convertTemp, cellVoltageRange, unitLabels } from '../../lib/vehicle'
import { motorDevices, useConfig } from '../../state/config'
import type { GaugeId } from '../../state/dashboard'
import { targetKey } from '../../state/devices'
import { useTelemetry } from '../../state/telemetry'
import type { TileCtx } from './tiles'

/** A stretch of the dial drawn in a warning colour. Values inside it show in that colour too. */
export interface Band {
  from: number
  to: number
  tone: 'warn' | 'danger'
}

export interface GaugeReading {
  /** In display units; null when there's nothing to show yet. */
  value: number | null
  digits: number
  unit: string
  min: number
  max: number
  /** Where the fill starts: zero, kept within the range. Below it the dial fills the other way, in the regen colour. */
  origin: number
  /** Small marks on the dial: this ride's highest (and lowest) values. */
  marks: number[]
  bands: Band[]
}

/** The controllers' limits, added up over those in view. NaN where not known. */
export interface DashLimits {
  motorMax: number
  motorMin: number
  batteryMax: number
  batteryMin: number
  /** 0..1, the lowest of them. */
  dutyMax: number
  fetStart: number
  fetEnd: number
  motorStart: number
  motorEnd: number
  maxErpm: number
}

export type GaugeCtx = TileCtx & { limits: DashLimits }

const num = (mc: ConfigValues, k: string) => Number(mc[k])

export function limitsOf(mcs: ConfigValues[]): DashLimits {
  if (!mcs.length) {
    const n = Number.NaN
    return { motorMax: n, motorMin: n, batteryMax: n, batteryMin: n, dutyMax: n, fetStart: n, fetEnd: n, motorStart: n, motorEnd: n, maxErpm: n }
  }
  const sum = (f: (mc: ConfigValues) => number) => mcs.reduce((a, mc) => a + f(mc), 0)
  const least = (k: string) => Math.min(...mcs.map((mc) => num(mc, k)))
  return {
    motorMax: sum((mc) => num(mc, 'l_current_max') * (num(mc, 'l_current_max_scale') || 1)),
    motorMin: sum((mc) => num(mc, 'l_current_min') * (num(mc, 'l_current_min_scale') || 1)),
    batteryMax: sum((mc) => num(mc, 'l_in_current_max')),
    batteryMin: sum((mc) => num(mc, 'l_in_current_min')),
    dutyMax: least('l_max_duty'),
    fetStart: least('l_temp_fet_start'),
    fetEnd: least('l_temp_fet_end'),
    motorStart: least('l_temp_motor_start'),
    motorEnd: least('l_temp_motor_end'),
    maxErpm: least('l_max_erpm'),
  }
}

/** Limits of the motor controllers in the dashboard's view. */
export function useDashLimits(): DashLimits {
  const view = useTelemetry((s) => s.dash?.view ?? 'all')
  const devices = useConfig((s) => s.devices)
  const order = useConfig((s) => s.order)
  const mcs = motorDevices({ devices, order })
    .filter((d) => view === 'all' || targetKey(d.target) === targetKey(view))
    .map((d) => d.mcconf.device)
    .filter((mc): mc is ConfigValues => !!mc)
  return limitsOf(mcs)
}

/** The next round number at or above x: 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 times a power of ten. */
export function niceCeil(x: number): number {
  if (!(x > 0)) return 1
  const p = 10 ** Math.floor(Math.log10(x))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= x - 1e-9) return m * p
  return 10 * p
}

/** A tick spacing that gives about five steps over the span. */
export function tickStep(span: number): number {
  const raw = span / 5
  const p = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw - 1e-9) return m * p
  return 10 * p
}

const known = (x: number) => Number.isFinite(x) && x !== 0

function signed(value: number, hi: number, lo: number, peak: number, low: number, digits: number, unit: string, scale = 1): GaugeReading {
  const max = niceCeil(hi) / scale
  const min = -niceCeil(lo) / scale
  return { value: value / scale, digits, unit, min, max, origin: 0, marks: [peak / scale, low / scale].filter((m) => m !== 0), bands: [] }
}

/** Warn from `start`, danger from halfway to `end`, on a dial to just past `end`. */
function temperature(c: number, peak: number, start: number, end: number, fallback: [number, number, number], u: TileCtx['units']): GaugeReading {
  const [warnC, dangerC, topC] = known(start) && known(end) && end > start ? [start, (start + end) / 2, end] : fallback
  const t = (x: number) => convertTemp(x, u)
  const max = niceCeil(t(topC + 5))
  return {
    value: t(c),
    digits: 0,
    unit: unitLabels(u).temp,
    min: t(0),
    max,
    origin: t(0),
    marks: [t(peak)],
    bands: [
      { from: t(warnC), to: t(dangerC), tone: 'warn' },
      { from: t(dangerC), to: max, tone: 'danger' },
    ],
  }
}

export const GAUGE_READ: Record<GaugeId, (c: GaugeCtx) => GaugeReading> = {
  speed: ({ dash, trip, units }) => {
    const metric = units === 'metric'
    const step = metric ? 10 : 5
    const top = convertSpeed(trip.maxSpeed, units)
    const max = Math.ceil(Math.max(metric ? 40 : 25, top * 1.1) / step) * step
    return { value: convertSpeed(dash.speed, units), digits: 0, unit: unitLabels(units).speed, min: 0, max, origin: 0, marks: [top], bands: [] }
  },
  power: ({ dash, trip, limits, vehicle }) => {
    const full = vehicle.batteryCells * cellVoltageRange(vehicle.batteryChemistry)[1]
    const drive = known(limits.batteryMax) ? limits.batteryMax * full : 0
    const regen = known(limits.batteryMin) ? -limits.batteryMin * full : 0
    const r = signed(
      dash.power,
      Math.max(drive, trip.peakPower * 1.1, 1000),
      Math.max(regen, -trip.peakRegenPower * 1.1, 300),
      trip.peakPower,
      trip.peakRegenPower,
      2,
      'kW',
      1000,
    )
    return { ...r, digits: r.max < 10 ? 2 : 1 }
  },
  batteryCurrent: ({ dash, trip, limits }) =>
    signed(
      dash.currentIn,
      Math.max(known(limits.batteryMax) ? limits.batteryMax : 0, trip.maxCurrentIn * 1.1, 10),
      Math.max(known(limits.batteryMin) ? -limits.batteryMin : 0, -trip.minCurrentIn * 1.1, 5),
      trip.maxCurrentIn,
      trip.minCurrentIn,
      1,
      'A',
    ),
  motorCurrent: ({ dash, trip, limits }) =>
    signed(
      dash.currentMotor,
      Math.max(known(limits.motorMax) ? limits.motorMax : 0, trip.maxCurrentMotor * 1.1, 20),
      Math.max(known(limits.motorMin) ? -limits.motorMin : 0, -trip.minCurrentMotor * 1.1, 10),
      trip.maxCurrentMotor,
      trip.minCurrentMotor,
      1,
      'A',
    ),
  duty: ({ dash, trip, limits, vehicle }) => {
    const top = (known(limits.dutyMax) ? limits.dutyMax : vehicle.maxDuty) * 100
    return {
      value: dash.duty * 100,
      digits: 0,
      unit: '%',
      min: 0,
      max: 100,
      origin: 0,
      marks: [trip.maxDuty * 100],
      bands: [
        { from: top - 8, to: top - 3, tone: 'warn' },
        { from: top - 3, to: 100, tone: 'danger' },
      ],
    }
  },
  battery: ({ dash }) => ({
    value: dash.soc,
    digits: 0,
    unit: '%',
    min: 0,
    max: 100,
    origin: 0,
    marks: [],
    bands: [
      { from: 0, to: 10, tone: 'danger' },
      { from: 10, to: 25, tone: 'warn' },
    ],
  }),
  voltage: ({ dash, trip, vehicle }) => {
    const [empty, full] = cellVoltageRange(vehicle.batteryChemistry)
    const min = Math.floor(vehicle.batteryCells * empty)
    const max = Math.ceil(vehicle.batteryCells * full)
    const low = vehicle.batteryCells * (empty + (full - empty) * 0.12)
    return {
      value: dash.vIn,
      digits: 1,
      unit: 'V',
      min,
      max,
      origin: min,
      marks: [trip.minVIn, trip.maxVIn].filter((v): v is number => v !== null),
      bands: [{ from: min, to: low, tone: 'danger' }],
    }
  },
  motorTemp: ({ dash, trip, limits, units }) => temperature(dash.tempMotor, trip.peakTempMotor, limits.motorStart, limits.motorEnd, [70, 85, 100], units),
  fetTemp: ({ dash, trip, limits, units }) => temperature(dash.tempFet, trip.peakTempFet, limits.fetStart, limits.fetEnd, [65, 80, 95], units),
  efficiency: ({ trip, units }) => {
    const v = trip.whPerKm === null ? null : convertPerDistance(trip.whPerKm, units)
    return {
      value: v,
      digits: 1,
      unit: unitLabels(units).perDistance,
      min: 0,
      max: niceCeil(Math.max(units === 'metric' ? 30 : 50, (v ?? 0) * 1.25)),
      origin: 0,
      marks: [],
      bands: [],
    }
  },
  motorSpeed: ({ dash, trip, limits }) => {
    // The stock ERPM limit is far above any real top speed, so it only sets the dial when it's been lowered.
    const top = known(limits.maxErpm) && limits.maxErpm < 150_000 ? limits.maxErpm : Math.max(trip.maxErpm * 1.25, 20_000)
    return {
      value: dash.erpm / 1000,
      digits: 1,
      unit: 'k ERPM',
      min: 0,
      max: niceCeil(top) / 1000,
      origin: 0,
      marks: [trip.maxErpm / 1000],
      bands: [],
    }
  },
}

export const toneAt = (r: GaugeReading, v: number): 'normal' | 'warn' | 'danger' =>
  r.bands.find((b) => b.tone === 'danger' && v >= b.from && v <= b.to)?.tone ?? r.bands.find((b) => v >= b.from && v <= b.to)?.tone ?? 'normal'

