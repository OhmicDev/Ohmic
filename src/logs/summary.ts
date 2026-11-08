// A ride's headline numbers. Built row by row, so the recorder keeps it up to
// date while riding and imports compute it the same way.

import type { RideData, Row } from './columns'
import { rowAt } from './columns'

export interface RideSummary {
  durationS: number
  /** Time spent above walking pace. */
  movingS: number
  distanceKm: number
  maxSpeed: number
  /** While moving (km/h). */
  avgSpeed: number | null
  whUsed: number
  whCharged: number
  /** Net energy per km, once the ride is long enough to mean something. */
  whPerKm: number | null
  peakPower: number
  /** Most power put back while braking (W, zero or negative). */
  peakRegenPower: number
  maxCurrentIn: number
  maxCurrentMotor: number
  maxTempMotor: number | null
  maxTempFet: number | null
  minVoltage: number | null
  startSoc: number | null
  endSoc: number | null
  /** Times a fault appeared. */
  faults: number
  gpsDistanceKm: number | null
  /** [south, west, north, east] of the GPS track. */
  bounds: [number, number, number, number] | null
}

const MOVING_KMH = 1.5
/** A gap longer than this (a dropped link) doesn't count as riding time. */
const MAX_GAP_S = 2
const MIN_KM_FOR_RATE = 0.3
/** GPS fixes worse than this are left out of the GPS distance. */
const GPS_MAX_ACCURACY_M = 30

const fin = Number.isFinite

export class SummaryBuilder {
  private s: RideSummary = {
    durationS: 0,
    movingS: 0,
    distanceKm: 0,
    maxSpeed: 0,
    avgSpeed: null,
    whUsed: 0,
    whCharged: 0,
    whPerKm: null,
    peakPower: 0,
    peakRegenPower: 0,
    maxCurrentIn: 0,
    maxCurrentMotor: 0,
    maxTempMotor: null,
    maxTempFet: null,
    minVoltage: null,
    startSoc: null,
    endSoc: null,
    faults: 0,
    gpsDistanceKm: null,
    bounds: null,
  }
  private lastT: number | null = null
  private lastFault = 0
  private lastFix: { lat: number; lon: number } | null = null

  add(r: Row) {
    const s = this.s
    if (this.lastT !== null && fin(r.t)) {
      const dt = (r.t - this.lastT) / 1000
      if (dt > 0 && dt <= MAX_GAP_S && fin(r.speed) && r.speed > MOVING_KMH) s.movingS += dt
    }
    if (fin(r.t)) {
      this.lastT = r.t
      s.durationS = Math.max(s.durationS, r.t / 1000)
    }
    if (fin(r.distance)) s.distanceKm = Math.max(s.distanceKm, r.distance)
    if (fin(r.speed)) s.maxSpeed = Math.max(s.maxSpeed, r.speed)
    if (fin(r.whUsed)) s.whUsed = Math.max(s.whUsed, r.whUsed)
    if (fin(r.whCharged)) s.whCharged = Math.max(s.whCharged, r.whCharged)
    if (fin(r.power)) {
      s.peakPower = Math.max(s.peakPower, r.power)
      s.peakRegenPower = Math.min(s.peakRegenPower, r.power)
    }
    if (fin(r.currentIn)) s.maxCurrentIn = Math.max(s.maxCurrentIn, r.currentIn)
    if (fin(r.currentMotor)) s.maxCurrentMotor = Math.max(s.maxCurrentMotor, Math.abs(r.currentMotor))
    if (fin(r.tempMotor)) s.maxTempMotor = Math.max(s.maxTempMotor ?? -Infinity, r.tempMotor)
    if (fin(r.tempFet)) s.maxTempFet = Math.max(s.maxTempFet ?? -Infinity, r.tempFet)
    // A reading of 0 V is a controller that didn't answer, not a flat battery.
    if (fin(r.vIn) && r.vIn > 1) s.minVoltage = Math.min(s.minVoltage ?? Infinity, r.vIn)
    if (fin(r.soc)) {
      if (s.startSoc === null) s.startSoc = r.soc
      s.endSoc = r.soc
    }
    const fault = fin(r.fault) ? r.fault : 0
    if (fault !== 0 && this.lastFault === 0) s.faults++
    this.lastFault = fault

    if (fin(r.lat) && fin(r.lon)) {
      const b = s.bounds
      s.bounds = b
        ? [Math.min(b[0], r.lat), Math.min(b[1], r.lon), Math.max(b[2], r.lat), Math.max(b[3], r.lon)]
        : [r.lat, r.lon, r.lat, r.lon]
      if (!fin(r.gpsAccuracy) || r.gpsAccuracy <= GPS_MAX_ACCURACY_M) {
        if (this.lastFix) s.gpsDistanceKm = (s.gpsDistanceKm ?? 0) + haversineKm(this.lastFix.lat, this.lastFix.lon, r.lat, r.lon)
        else s.gpsDistanceKm = s.gpsDistanceKm ?? 0
        this.lastFix = { lat: r.lat, lon: r.lon }
      }
    }
  }

  get(): RideSummary {
    const s = { ...this.s }
    s.avgSpeed = s.movingS > 5 ? (s.distanceKm / s.movingS) * 3600 : null
    s.whPerKm = s.distanceKm >= MIN_KM_FOR_RATE ? Math.max(0, s.whUsed - s.whCharged) / s.distanceKm : null
    return s
  }
}

export function summarize(d: RideData): RideSummary {
  const b = new SummaryBuilder()
  for (let i = 0; i < d.rows; i++) b.add(rowAt(d, i))
  return b.get()
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Net Wh per km over many rides, weighting each by its distance. */
export function averageWhPerKm(rides: { summary: RideSummary }[]): number | null {
  let wh = 0
  let km = 0
  for (const { summary: s } of rides) {
    if (s.distanceKm < MIN_KM_FOR_RATE) continue
    wh += Math.max(0, s.whUsed - s.whCharged)
    km += s.distanceKm
  }
  return km >= MIN_KM_FOR_RATE && wh > 0 ? wh / km : null
}
