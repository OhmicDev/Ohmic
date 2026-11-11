// Every reading a dashboard tile can show. Each tile has one number, a unit and
// a short grey line under it (a peak, a limit, the headroom left).

import {
  Activity,
  BatteryCharging,
  BatteryFull,
  Cpu,
  Flame,
  Gauge,
  Leaf,
  MapPin,
  Navigation,
  RotateCw,
  Route,
  Thermometer,
  Timer,
  TrendingUp,
  Trophy,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { fmt, fmtDuration, fmtThousands } from '../../lib/format'
import { convertDistance, convertPerDistance, convertSpeed, convertTemp, unitLabels, type Units, type VehicleSetup } from '../../lib/vehicle'
import type { HeroId, TileId } from '../../state/dashboard'
import { useSettings } from '../../state/settings'
import { useTelemetry, type Dashboard, type HistoryKey, type Trip } from '../../state/telemetry'

export type Tone = 'normal' | 'warn' | 'danger'

export interface TileCtx {
  dash: Dashboard
  trip: Trip
  units: Units
  vehicle: VehicleSetup
}

/** What every reading is worked out from; null until the first values arrive. */
export function useTileCtx(): TileCtx | null {
  const dash = useTelemetry((s) => s.dash)
  const trip = useTelemetry((s) => s.trip)
  const units = useSettings((s) => s.units)
  const vehicle = useSettings((s) => s.vehicle)
  return dash ? { dash, trip, units, vehicle } : null
}

export const HERO_IDS = ['speed', 'power', 'battery'] as const satisfies readonly HeroId[]

/** A big reading: power gets an extra digit while it's small. */
export function heroReading(id: HeroId, c: TileCtx) {
  const r = TILES[id].read(c)
  return {
    label: TILES[id].label,
    value: r.value ?? 0,
    digits: id === 'power' ? (Math.abs(c.dash.power) < 10_000 ? 2 : 1) : r.digits,
    unit: r.unit ?? '',
    tone: r.tone ?? 'normal',
  }
}

/** A reading as text: its number (or time) and unit. */
export function readingText(r: TileReading): { value: string; unit?: string } {
  return { value: r.text ?? fmt(r.value, r.digits), unit: r.unit }
}

export interface TileReading {
  value: number | null
  digits: number
  unit?: string
  /** Shown instead of the number (a time). */
  text?: string
  sub?: string
  tone?: Tone
}

export interface TileDef {
  label: string
  /** For the small tiles of the one-screen layout, where the label doesn't fit. */
  short?: string
  icon: LucideIcon
  spark?: HistoryKey
  read: (c: TileCtx) => TileReading
}

const tempTone = (c: number, warn: number, danger: number): Tone => (c >= danger ? 'danger' : c >= warn ? 'warn' : 'normal')
/** km/h while moving, once there's enough riding to say. */
export const avgSpeed = (t: Trip) => (t.rideSeconds > 5 ? (t.distanceKm / t.rideSeconds) * 3600 : null)
const kw = (w: number) => fmt(w / 1000, Math.abs(w) < 10_000 ? 2 : 1)

export const TILES: Record<TileId, TileDef> = {
  power: {
    label: 'Power',
    icon: Zap,
    spark: 'power',
    read: ({ dash, trip }) => ({
      value: dash.power / 1000,
      digits: 2,
      unit: 'kW',
      sub: `peak ${kw(trip.peakPower)} kW`,
    }),
  },
  batteryCurrent: {
    label: 'Battery current',
    short: 'Battery A',
    icon: BatteryCharging,
    spark: 'currentIn',
    read: ({ dash, trip }) => ({
      value: dash.currentIn,
      digits: 1,
      unit: 'A',
      sub: `peak ${fmt(trip.maxCurrentIn, 0)} A`,
    }),
  },
  motorCurrent: {
    label: 'Motor current',
    short: 'Motor A',
    icon: Activity,
    spark: 'currentMotor',
    read: ({ dash, trip }) => ({
      value: dash.currentMotor,
      digits: 1,
      unit: 'A',
      sub: `peak ${fmt(trip.maxCurrentMotor, 0)} A`,
    }),
  },
  duty: {
    label: 'Duty',
    icon: Gauge,
    spark: 'duty',
    read: ({ dash, vehicle }) => ({
      value: dash.duty * 100,
      digits: 0,
      unit: '%',
      sub: `${fmt(Math.max(0, (vehicle.maxDuty - dash.duty) * 100), 0)} % headroom`,
      tone: dash.duty > 0.88 ? 'warn' : 'normal',
    }),
  },
  motorSpeed: {
    label: 'Motor speed',
    short: 'ERPM',
    icon: RotateCw,
    spark: 'erpm',
    read: ({ dash }) => ({
      value: dash.erpm / 1000,
      digits: 1,
      unit: 'k ERPM',
      sub: `${fmtThousands(dash.motorRpm)} motor rpm`,
    }),
  },
  voltage: {
    label: 'Battery voltage',
    short: 'Voltage',
    icon: Waves,
    spark: 'vIn',
    read: ({ dash, trip }) => ({
      value: dash.vIn,
      digits: 1,
      unit: 'V',
      sub: `${fmt(dash.cellV, 2)} V/cell · low ${fmt(trip.minVIn, 1)}`,
    }),
  },
  motorTemp: {
    label: 'Motor temp',
    icon: Thermometer,
    spark: 'tempMotor',
    read: ({ dash, trip, units }) => ({
      value: convertTemp(dash.tempMotor, units),
      digits: 0,
      unit: unitLabels(units).temp,
      sub: `peak ${fmt(convertTemp(trip.peakTempMotor, units), 0)}°`,
      tone: tempTone(dash.tempMotor, 70, 85),
    }),
  },
  fetTemp: {
    label: 'Controller temp',
    short: 'Controller',
    icon: Cpu,
    spark: 'tempFet',
    read: ({ dash, trip, units }) => ({
      value: convertTemp(dash.tempFet, units),
      digits: 0,
      unit: unitLabels(units).temp,
      sub: `peak ${fmt(convertTemp(trip.peakTempFet, units), 0)}°`,
      tone: tempTone(dash.tempFet, 65, 80),
    }),
  },
  speed: {
    label: 'Speed',
    icon: Navigation,
    spark: 'speed',
    read: ({ dash, trip, units }) => ({
      value: convertSpeed(dash.speed, units),
      digits: 0,
      unit: unitLabels(units).speed,
      sub: `top ${fmt(convertSpeed(trip.maxSpeed, units), 0)}`,
    }),
  },
  battery: {
    label: 'Battery',
    icon: BatteryFull,
    read: ({ dash }) => ({
      value: dash.soc,
      digits: 0,
      unit: '%',
      sub: `${fmt(dash.vIn, 1)} V`,
      tone: dash.soc < 10 ? 'danger' : dash.soc < 25 ? 'warn' : 'normal',
    }),
  },
  range: {
    label: 'Range',
    icon: Route,
    read: ({ dash, units }) => ({
      value: dash.rangeKm === null ? null : convertDistance(dash.rangeKm, units),
      digits: 0,
      unit: unitLabels(units).distance,
      sub: dash.rangeKm === null ? 'ride a little first' : 'at this trip’s use',
    }),
  },
  efficiency: {
    label: 'Using',
    icon: Leaf,
    read: ({ trip, units }) => ({
      value: trip.whPerKm === null ? null : convertPerDistance(trip.whPerKm, units),
      digits: 1,
      unit: unitLabels(units).perDistance,
      sub: 'this trip',
    }),
  },
  energy: {
    label: 'Energy used',
    short: 'Used',
    icon: Flame,
    read: ({ trip }) => ({
      value: trip.whUsed,
      digits: 1,
      unit: 'Wh',
      sub: `${fmt(trip.ahUsed, 2)} Ah`,
    }),
  },
  regen: {
    label: 'Regenerated',
    short: 'Regen',
    icon: BatteryCharging,
    read: ({ trip }) => ({
      value: trip.whCharged,
      digits: 1,
      unit: 'Wh',
      sub: `peak ${kw(-trip.peakRegenPower)} kW`,
    }),
  },
  distance: {
    label: 'Trip',
    icon: MapPin,
    read: ({ trip, units }) => ({
      value: convertDistance(trip.distanceKm, units),
      digits: 2,
      unit: unitLabels(units).distance,
      sub: 'since reset',
    }),
  },
  rideTime: {
    label: 'Riding',
    icon: Timer,
    read: ({ trip }) => ({
      value: null,
      digits: 0,
      text: fmtDuration(trip.rideSeconds),
      sub: `${fmtDuration(trip.seconds)} on`,
    }),
  },
  avgSpeed: {
    label: 'Average',
    icon: TrendingUp,
    read: ({ trip, units }) => {
      const v = avgSpeed(trip)
      return {
        value: v === null ? null : convertSpeed(v, units),
        digits: 1,
        unit: unitLabels(units).speed,
        sub: 'while moving',
      }
    },
  },
  topSpeed: {
    label: 'Top speed',
    icon: Trophy,
    read: ({ trip, units }) => ({
      value: convertSpeed(trip.maxSpeed, units),
      digits: 1,
      unit: unitLabels(units).speed,
      sub: 'this trip',
    }),
  },
}
