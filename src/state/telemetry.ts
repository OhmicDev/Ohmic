// Live values from every polled controller, turned into the dashboard view,
// plus trip stats and a short history for sparklines.
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
  rideSeconds: number
  maxSpeed: number
  peakPower: number
  peakRegenPower: number
  energyWh: number
  whPerKm: number | null
  peakTempMotor: number
  peakTempFet: number
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
  maxSpeed: 0,
  peakPower: 0,
  peakRegenPower: 0,
  energyWh: 0,
  whPerKm: null,
  peakTempMotor: 0,
  peakTempFet: 0,
})

interface CounterValues {
  tachoAbs: number
  wh: number
  whCharged: number
}

interface Counter {
  base: CounterValues
  last: CounterValues
  carriedKm: number
  carriedWh: number
}

const netWh = (now: CounterValues, base: CounterValues) => now.wh - base.wh - (now.whCharged - base.whCharged)

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
    let energyWh = 0
    for (const s of samples) {
      const k = targetKey(s.target)
      const cur: CounterValues = {
        tachoAbs: s.values.tachometerAbs,
        wh: s.values.wattHours,
        whCharged: s.values.wattHoursCharged,
      }
      let c = counters.get(k)
      if (!c) {
        c = { base: cur, last: cur, carriedKm: 0, carriedWh: 0 }
        counters.set(k, c)
      } else if (cur.tachoAbs < c.last.tachoAbs || cur.wh < c.last.wh) {
        // The controller rebooted and its counters restarted. Keep what this
        // trip already counted and continue from the new values.
        c.carriedKm += tachoToKm(c.last.tachoAbs - c.base.tachoAbs, vehicle)
        c.carriedWh += netWh(c.last, c.base)
        c.base = cur
      }
      c.last = cur
      if (s.target === primary) distanceKm = c.carriedKm + tachoToKm(cur.tachoAbs - c.base.tachoAbs, vehicle)
      energyWh += c.carriedWh + netWh(cur, c.base)
    }
    trip.distanceKm = distanceKm
    trip.energyWh = energyWh
    if (vehicleSpeed > 1) trip.rideSeconds += dt
    trip.maxSpeed = Math.max(trip.maxSpeed, vehicleSpeed)
    trip.peakPower = Math.max(trip.peakPower, vehiclePower)
    trip.peakRegenPower = Math.min(trip.peakRegenPower, vehiclePower)
    trip.peakTempMotor = Math.max(trip.peakTempMotor, max(all, (v) => v.tempMotor))
    trip.peakTempFet = Math.max(trip.peakTempFet, max(all, (v) => v.tempFet))
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
