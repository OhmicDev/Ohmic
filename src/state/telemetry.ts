// Live values from every polled controller, turned into the dashboard view,
// plus trip stats (peaks, averages and energy, like VESC Tool's statistics) and
// a short history for sparklines.
//
// The dashboard follows the chosen view (all motor controllers combined, or
// one). Trip, battery % and range always cover the whole vehicle.

import { create } from 'zustand'
import type { Target } from '../client/VescClient'
import type { Values } from '../protocol/messages'
import { motorRpm, packWh, SocEstimator, speedKmh, tachoToKm } from '../lib/vehicle'
import { targetKey, type View } from './devices'
import { useSettings } from './settings'

interface DeviceSample {
  target: Target
  values: Values
}

export interface Dashboard {
  speed: number // km/h
  erpm: number
  motorRpm: number
  vIn: number
  cellV: number
  soc: number // %
  currentIn: number // A, controllers in view
  currentMotor: number // A, controllers in view
  power: number // W, battery side, controllers in view
  duty: number // 0..1, highest in view
  tempMotor: number // °C, hottest in view
  tempFet: number // °C, hottest in view
  controllers: number // in view
  view: View
  faults: { target: Target; code: number }[]
  rangeKm: number | null
}

export interface Trip {
  startedAt: number
  distanceKm: number
  /** Seconds moving faster than 1 km/h. */
  rideSeconds: number
  /** Seconds with values coming in. */
  seconds: number
  maxSpeed: number
  /** W, battery side. */
  peakPower: number
  /** W, negative. */
  peakRegenPower: number
  /** Net Wh: used minus put back. */
  energyWh: number
  whUsed: number
  whCharged: number
  ahUsed: number
  ahCharged: number
  whPerKm: number | null
  peakTempMotor: number
  peakTempFet: number
  /** Battery current, all controllers (A): highest drawn and most put back (negative). */
  maxCurrentIn: number
  minCurrentIn: number
  /** Motor current, all controllers (A): most driving and most braking (negative). */
  maxCurrentMotor: number
  minCurrentMotor: number
  /** 0..1, highest of any controller. */
  maxDuty: number
  /** Battery voltage range; null until the first reading. */
  minVIn: number | null
  maxVIn: number | null
  maxErpm: number
  /** Sums over time moving, for averages (W·s and A·s). */
  powerWs: number
  currentAs: number
  /** Sums over all time, for averages (°C·s). */
  tempMotorS: number
  tempFetS: number
}

const HISTORY_KEYS = ['speed', 'vIn', 'currentIn', 'power', 'currentMotor', 'duty', 'erpm', 'tempMotor', 'tempFet'] as const
export type HistoryKey = (typeof HISTORY_KEYS)[number]
const HISTORY_MS = 60_000
const MIN_DISTANCE_FOR_RANGE_KM = 0.3

/** Sparkline data lives outside React state; `historyVersion` signals changes. */
export const history: Record<HistoryKey, { t: number; v: number }[]> = Object.fromEntries(
  HISTORY_KEYS.map((k) => [k, []]),
) as unknown as Record<HistoryKey, { t: number; v: number }[]>

const emptyTrip = (now: number): Trip => ({
  startedAt: now,
  distanceKm: 0,
  rideSeconds: 0,
  seconds: 0,
  maxSpeed: 0,
  peakPower: 0,
  peakRegenPower: 0,
  energyWh: 0,
  whUsed: 0,
  whCharged: 0,
  ahUsed: 0,
  ahCharged: 0,
  whPerKm: null,
  peakTempMotor: 0,
  peakTempFet: 0,
  maxCurrentIn: 0,
  minCurrentIn: 0,
  maxCurrentMotor: 0,
  minCurrentMotor: 0,
  maxDuty: 0,
  minVIn: null,
  maxVIn: null,
  maxErpm: 0,
  powerWs: 0,
  currentAs: 0,
  tempMotorS: 0,
  tempFetS: 0,
})

/** The controller's own counters, which only ever go up until it restarts. */
interface CounterValues {
  tachoAbs: number
  wh: number
  whCharged: number
  ah: number
  ahCharged: number
}

const ENERGY = ['wh', 'whCharged', 'ah', 'ahCharged'] as const

interface Counter {
  base: CounterValues
  last: CounterValues
  /** Counted before the controller last restarted. */
  carried: { km: number; wh: number; whCharged: number; ah: number; ahCharged: number }
}

interface IngestOptions {
  /** Motor controller that leads speed, voltage and distance. */
  primary: Target
  view: View
}

interface TelemetryState {
  devices: Record<string, Values>
  dash: Dashboard | null
  trip: Trip
  lastUpdate: number
  historyVersion: number
  ingest: (samples: DeviceSample[], now: number, opts?: IngestOptions) => void
  resetTrip: () => void
  clearHistory: () => void
  clear: () => void
}

const soc = new SocEstimator()
let counters = new Map<string, Counter>()

export const useTelemetry = create<TelemetryState>()((set, get) => ({
  devices: {},
  dash: null,
  trip: emptyTrip(Date.now()),
  lastUpdate: 0,
  historyVersion: 0,

  ingest: (samples, now, opts = { primary: 'local', view: 'all' }) => {
    const { primary, view } = opts
    const lead = samples.find((s) => s.target === primary)?.values
    if (!lead) return
    const inView = view === 'all' ? samples : samples.filter((s) => s.target === view)
    if (inView.length === 0) return
    const shown = view === 'all' ? lead : inView[0].values
    const vehicle = useSettings.getState().vehicle
    const prev = get()
    const dt = prev.lastUpdate ? Math.min(2, (now - prev.lastUpdate) / 1000) : 0

    const all = samples.map((s) => s.values)
    const viewed = inView.map((s) => s.values)
    const sum = (list: Values[], f: (v: Values) => number) => list.reduce((n, v) => n + f(v), 0)
    const max = (list: Values[], f: (v: Values) => number) => Math.max(...list.map(f))

    // Whole vehicle.
    const vehicleSpeed = Math.abs(speedKmh(lead.rpm, vehicle))
    const vehicleCurrent = sum(all, (v) => v.currentIn)
    const vehiclePower = lead.vIn * vehicleCurrent
    const socPct = soc.update(lead.vIn, vehicleCurrent, dt, vehicle)

    // What the dashboard shows.
    const speed = view === 'all' ? vehicleSpeed : Math.abs(speedKmh(shown.rpm, vehicle))
    const currentIn = sum(viewed, (v) => v.currentIn)
    const power = shown.vIn * currentIn

    // Trip: distance from the primary controller's tachometer, energy from all.
    const trip = { ...prev.trip }
    let distanceKm = 0
    const used = { wh: 0, whCharged: 0, ah: 0, ahCharged: 0 }
    for (const s of samples) {
      const k = targetKey(s.target)
      const cur: CounterValues = {
        tachoAbs: s.values.tachometerAbs,
        wh: s.values.wattHours,
        whCharged: s.values.wattHoursCharged,
        ah: s.values.ampHours,
        ahCharged: s.values.ampHoursCharged,
      }
      let c = counters.get(k)
      if (!c) {
        c = { base: cur, last: cur, carried: { km: 0, wh: 0, whCharged: 0, ah: 0, ahCharged: 0 } }
        counters.set(k, c)
      } else if (cur.tachoAbs < c.last.tachoAbs || cur.wh < c.last.wh || cur.whCharged < c.last.whCharged) {
        // The controller rebooted and its counters restarted. Keep what this
        // trip already counted and continue from the new values.
        c.carried.km += tachoToKm(c.last.tachoAbs - c.base.tachoAbs, vehicle)
        for (const f of ENERGY) c.carried[f] += c.last[f] - c.base[f]
        c.base = cur
      }
      c.last = cur
      if (s.target === primary) distanceKm = c.carried.km + tachoToKm(cur.tachoAbs - c.base.tachoAbs, vehicle)
      for (const f of ENERGY) used[f] += c.carried[f] + cur[f] - c.base[f]
    }
    const energyWh = used.wh - used.whCharged
    const vehicleMotorCurrent = sum(all, (v) => v.currentMotor)
    trip.distanceKm = distanceKm
    trip.energyWh = energyWh
    trip.whUsed = used.wh
    trip.whCharged = used.whCharged
    trip.ahUsed = used.ah
    trip.ahCharged = used.ahCharged
    trip.seconds += dt
    if (vehicleSpeed > 1) {
      trip.rideSeconds += dt
      trip.powerWs += vehiclePower * dt
      trip.currentAs += vehicleCurrent * dt
    }
    trip.maxSpeed = Math.max(trip.maxSpeed, vehicleSpeed)
    trip.peakPower = Math.max(trip.peakPower, vehiclePower)
    trip.peakRegenPower = Math.min(trip.peakRegenPower, vehiclePower)
    const hotMotor = max(all, (v) => v.tempMotor)
    const hotFet = max(all, (v) => v.tempFet)
    trip.peakTempMotor = Math.max(trip.peakTempMotor, hotMotor)
    trip.peakTempFet = Math.max(trip.peakTempFet, hotFet)
    trip.tempMotorS += hotMotor * dt
    trip.tempFetS += hotFet * dt
    trip.maxCurrentIn = Math.max(trip.maxCurrentIn, vehicleCurrent)
    trip.minCurrentIn = Math.min(trip.minCurrentIn, vehicleCurrent)
    trip.maxCurrentMotor = Math.max(trip.maxCurrentMotor, vehicleMotorCurrent)
    trip.minCurrentMotor = Math.min(trip.minCurrentMotor, vehicleMotorCurrent)
    trip.maxDuty = Math.max(trip.maxDuty, max(all, (v) => Math.abs(v.dutyNow)))
    trip.minVIn = trip.minVIn === null ? lead.vIn : Math.min(trip.minVIn, lead.vIn)
    trip.maxVIn = trip.maxVIn === null ? lead.vIn : Math.max(trip.maxVIn, lead.vIn)
    trip.maxErpm = Math.max(trip.maxErpm, Math.abs(lead.rpm))
    trip.whPerKm = distanceKm >= MIN_DISTANCE_FOR_RANGE_KM ? Math.max(0, energyWh) / distanceKm : null

    const remainingWh = (packWh(vehicle) * socPct) / 100
    const rangeKm = trip.whPerKm && trip.whPerKm > 0.5 ? remainingWh / trip.whPerKm : null

    const dash: Dashboard = {
      speed,
      erpm: shown.rpm,
      motorRpm: motorRpm(shown.rpm, vehicle),
      vIn: shown.vIn,
      cellV: shown.vIn / vehicle.batteryCells,
      soc: socPct,
      currentIn,
      currentMotor: sum(viewed, (v) => v.currentMotor),
      power,
      duty: max(viewed, (v) => Math.abs(v.dutyNow)),
      tempMotor: max(viewed, (v) => v.tempMotor),
      tempFet: max(viewed, (v) => v.tempFet),
      controllers: inView.length,
      view,
      // Faults from every controller, whatever the view: they matter.
      faults: samples.filter((s) => s.values.fault !== 0).map((s) => ({ target: s.target, code: s.values.fault })),
      rangeKm,
    }

    const point: Record<HistoryKey, number> = {
      speed,
      vIn: dash.vIn,
      currentIn,
      power,
      currentMotor: dash.currentMotor,
      duty: dash.duty,
      erpm: dash.erpm,
      tempMotor: dash.tempMotor,
      tempFet: dash.tempFet,
    }
    for (const k of HISTORY_KEYS) {
      const h = history[k]
      h.push({ t: now, v: point[k] })
      while (h.length && h[0].t < now - HISTORY_MS) h.shift()
    }

    set({
      devices: Object.fromEntries(samples.map((s) => [targetKey(s.target), s.values])),
      dash,
      trip,
      lastUpdate: now,
      historyVersion: prev.historyVersion + 1,
    })
  },

  resetTrip: () => {
    counters = new Map()
    set({ trip: emptyTrip(Date.now()) })
  },

  clearHistory: () => {
    for (const k of HISTORY_KEYS) history[k].length = 0
    set((s) => ({ historyVersion: s.historyVersion + 1 }))
  },

  clear: () => {
    counters = new Map()
    soc.reset()
    for (const k of HISTORY_KEYS) history[k].length = 0
    set({ devices: {}, dash: null, trip: emptyTrip(Date.now()), lastUpdate: 0, historyVersion: 0 })
  },
}))
