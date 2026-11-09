// Records a ride: every poll cycle's values, cut down to the chosen rate, plus
// the phone's GPS and an IMU. Rows are saved every few seconds, so closing the
// app mid-ride keeps everything up to the last save.

import { create } from 'zustand'
import { emptyRow, RowBuffer, type Row } from '../logs/columns'
import { askMotionPermission, holdWakeLock, watchGps, watchPhoneMotion, type GpsFix, type GpsStatus, type PhoneMotion } from '../logs/sensors'
import { SummaryBuilder, type RideSummary } from '../logs/summary'
import { speedKmh, tachoToKm } from '../lib/vehicle'
import type { Values } from '../protocol/messages'
import { db } from './db'
import { deviceName } from './config'
import { targetKey } from './devices'
import { requestImu } from './live'
import { useRideLogs, type RideLog } from './rideLogs'
import { demoGpsFix, maxPollHz, sessionEvents, useSession, type SamplesEvent } from './session'
import { useSettings } from './settings'
import { useTelemetry } from './telemetry'

export type ImuStatus = 'off' | 'waiting' | 'controller' | 'phone' | 'none'

/** Save what's been recorded this often (ms), or sooner if this many rows build up. */
const SAVE_EVERY_MS = 10_000
const SAVE_ROWS = 2000
/** A GPS fix older than this isn't put on new rows. */
const FIX_MAX_AGE_MS = 5000
/** How long to wait for the controller's IMU before using the phone's. */
const IMU_WAIT_MS = 3000
const DEG = 180 / Math.PI

interface RecorderState {
  status: 'idle' | 'recording' | 'stopping'
  rideId: string | null
  startedAt: number | null
  rows: number
  /** Rows per second actually recorded (limited by the live data rate). */
  rateHz: number
  summary: RideSummary | null
  gps: GpsStatus
  gpsAccuracy: number | null
  imu: ImuStatus
  error: string | null
  /** Ride just saved by Stop, for "View ride". */
  lastSavedId: string | null
  start: () => Promise<boolean>
  stop: () => Promise<string | null>
}

interface Run {
  ride: RideLog
  buffer: RowBuffer
  builder: SummaryBuilder
  seq: number
  lastRowAt: number
  lastSaveAt: number
  interval: number
  /** Last counter value per "kind:target", to add up only what changed. */
  counters: Map<string, number>
  totals: { km: number; wh: number; whCharged: number; ah: number; ahCharged: number }
  fix: GpsFix | null
  phone: PhoneMotion | null
  imuSince: number
  sawControllerImu: boolean
  gpsUsed: boolean
  imuUsed: boolean
  saving: Promise<void>
  offs: (() => void)[]
}

let run: Run | null = null

const idle = {
  status: 'idle',
  rideId: null,
  startedAt: null,
  rows: 0,
  rateHz: 0,
  summary: null,
  gps: 'off',
  gpsAccuracy: null,
  imu: 'off',
} as const

export const useRecorder = create<RecorderState>()((set, get) => ({
  ...idle,
  error: null,
  lastSavedId: null,

  start: async () => {
    if (get().status !== 'idle') return false
    const s = useSettings.getState()
    // Asked first, while this still counts as part of the tap (iPhone).
    const phoneMotion = s.logImu ? askMotionPermission() : Promise.resolve(false)
    const session = useSession.getState()
    if (session.status !== 'connected' || session.primary === null) {
      set({ error: 'Connect to your vehicle first.' })
      return false
    }
    const now = Date.now()
    const rateHz = Math.min(s.logRateHz, s.pollHz, maxPollHz(session.transportKind))
    const ride: RideLog = {
      id: crypto.randomUUID(),
      startedAt: now,
      endedAt: null,
      name: null,
      source: 'recorded',
      demo: session.transportKind === 'mock',
      fileName: null,
      rateHz,
      rows: 0,
      chunks: 0,
      hasGps: false,
      hasImu: false,
      devices: session.devices.filter((d) => d.motor).map((d) => deviceName(d)),
      summary: new SummaryBuilder().get(),
    }
    try {
      await db.rides.add(ride)
    } catch {
      set({ error: 'The ride can’t be saved: this browser’s storage is full or blocked.' })
      return false
    }
    const r: Run = {
      ride,
      buffer: new RowBuffer(),
      builder: new SummaryBuilder(),
      seq: 0,
      lastRowAt: 0,
      lastSaveAt: now,
      interval: 1000 / rateHz,
      counters: new Map(),
      totals: { km: 0, wh: 0, whCharged: 0, ah: 0, ahCharged: 0 },
      fix: null,
      phone: null,
      imuSince: now,
      sawControllerImu: false,
      gpsUsed: false,
      imuUsed: false,
      saving: Promise.resolve(),
      offs: [],
    }
    run = r
    set({ ...idle, status: 'recording', rideId: ride.id, startedAt: now, rateHz, error: null, lastSavedId: null, summary: ride.summary })

    r.offs.push(sessionEvents.samples.on((e) => onSamples(r, e)))
    // The connection was closed or given up on: keep what was recorded.
    r.offs.push(sessionEvents.ended.on(() => void get().stop()))
    r.offs.push(holdWakeLock())

    if (s.logGps) {
      if (ride.demo) {
        set({ gps: 'simulated' })
        // About once a second, like a phone.
        const read = () => {
          const f = demoGpsFix()
          if (f) r.fix = { lat: f.lat, lon: f.lon, alt: f.alt, speedKmh: f.speedKmh, accuracy: f.accuracy, at: Date.now() }
        }
        read()
        const t = setInterval(read, 1000)
        r.offs.push(() => clearInterval(t))
      } else {
        r.offs.push(
          watchGps(
            (f) => {
              r.fix = f
              set({ gpsAccuracy: f.accuracy })
            },
            (gps) => set({ gps }),
          ),
        )
      }
    }
    if (s.logImu) {
      set({ imu: 'waiting' })
      r.offs.push(requestImu(targetKey(session.primary)))
      void phoneMotion.then((ok) => {
        if (ok && run === r) r.offs.push(watchPhoneMotion((m) => (r.phone = m)))
      })
    }

    // Save when the page is being hidden or closed, not only on the timer.
    const flushNow = () => {
      if (document.visibilityState === 'hidden') save(r)
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', flushNow)
      r.offs.push(() => document.removeEventListener('visibilitychange', flushNow))
    }
    const timer = setInterval(() => {
      if (Date.now() - r.lastSaveAt >= SAVE_EVERY_MS) save(r)
    }, 1000)
    r.offs.push(() => clearInterval(timer))
    void useRideLogs.getState().refresh()
    return true
  },

  stop: async () => {
    const r = run
    if (!r || get().status !== 'recording') return null
    set({ status: 'stopping' })
    for (const off of r.offs) off()
    save(r)
    await r.saving
    run = null
    const summary = r.builder.get()
    let savedId: string | null = r.ride.id
    if (r.ride.rows === 0) {
      // Nothing came in (stopped straight away, or the link was down).
      await db.rides.delete(r.ride.id).catch(() => {})
      savedId = null
    } else {
      const endedAt = r.ride.startedAt + summary.durationS * 1000
      await db.rides.update(r.ride.id, { endedAt, summary, rows: r.ride.rows, chunks: r.seq, hasGps: r.gpsUsed, hasImu: r.imuUsed }).catch(() => {})
    }
    set({ ...idle, lastSavedId: savedId, error: savedId ? get().error : 'Nothing was recorded: no live data arrived.' })
    await useRideLogs.getState().refresh()
    return savedId
  },
}))

function onSamples(r: Run, e: SamplesEvent) {
  if (run !== r) return
  // Cut down to the chosen rate, allowing for poll timing jitter.
  if (r.lastRowAt && e.at - r.lastRowAt < r.interval * 0.8) return
  const row = buildRow(r, e)
  if (!row) return
  r.lastRowAt = e.at
  r.buffer.push(row)
  r.builder.add(row)
  if (Number.isFinite(row.lat)) r.gpsUsed = true
  if (Number.isFinite(row.roll) || Number.isFinite(row.accX)) r.imuUsed = true
  r.ride.rows++
  const st = useRecorder.getState()
  const imu: ImuStatus = st.imu === 'off' ? 'off' : r.sawControllerImu ? 'controller' : r.phone ? 'phone' : e.at - r.imuSince > IMU_WAIT_MS ? 'none' : 'waiting'
  useRecorder.setState({ rows: r.ride.rows, summary: r.builder.get(), imu })
  if (r.buffer.size >= SAVE_ROWS) save(r)
}

/** Adds up how much a counter moved since the last row; a controller that restarted counts from zero. */
function moved(r: Run, key: string, value: number): number {
  if (!Number.isFinite(value)) return 0
  const last = r.counters.get(key)
  r.counters.set(key, value)
  if (last === undefined) return 0
  return value >= last ? value - last : value
}

function buildRow(r: Run, e: SamplesEvent): Row | null {
  const primary = useSession.getState().primary
  const lead = e.samples.find((s) => s.target === primary)
  if (!lead) return null
  const vehicle = useSettings.getState().vehicle
  const v = lead.values
  const t = r.totals
  t.km += tachoToKm(moved(r, `tacho:${targetKey(lead.target)}`, v.tachometerAbs), vehicle)
  for (const s of e.samples) {
    const k = targetKey(s.target)
    t.wh += moved(r, `wh:${k}`, s.values.wattHours)
    t.whCharged += moved(r, `whc:${k}`, s.values.wattHoursCharged)
    t.ah += moved(r, `ah:${k}`, s.values.ampHours)
    t.ahCharged += moved(r, `ahc:${k}`, s.values.ampHoursCharged)
  }
  const sum = (f: (x: Values) => number) => e.samples.reduce((n, s) => n + f(s.values), 0)
  const max = (f: (x: Values) => number) => Math.max(...e.samples.map((s) => f(s.values)))

  const row = emptyRow()
  row.t = e.at - r.ride.startedAt
  row.speed = Math.abs(speedKmh(v.rpm, vehicle))
  row.distance = t.km
  row.vIn = v.vIn
  row.currentIn = sum((x) => x.currentIn)
  row.currentMotor = sum((x) => x.currentMotor)
  row.power = v.vIn * row.currentIn
  row.duty = max((x) => Math.abs(x.dutyNow)) * 100
  row.erpm = v.rpm
  row.tempMotor = max((x) => x.tempMotor)
  row.tempFet = max((x) => x.tempFet)
  row.soc = useTelemetry.getState().dash?.soc ?? NaN
  row.whUsed = t.wh
  row.whCharged = t.whCharged
  row.ahUsed = t.ah
  row.ahCharged = t.ahCharged
  row.fault = e.samples.find((s) => s.values.fault !== 0)?.values.fault ?? 0

  const f = r.fix
  if (f && e.at - f.at <= FIX_MAX_AGE_MS) {
    row.lat = f.lat
    row.lon = f.lon
    row.alt = f.alt
    row.gpsSpeed = f.speedKmh
    row.gpsAccuracy = f.accuracy
  }
  const imu = lead.imu ?? e.samples.find((s) => s.imu)?.imu ?? null
  if (imu) {
    r.sawControllerImu = true
    row.roll = imu.roll * DEG
    row.pitch = imu.pitch * DEG
    row.yaw = imu.yaw * DEG
    row.accX = imu.accX
    row.accY = imu.accY
    row.accZ = imu.accZ
  } else if (r.phone && e.at - r.phone.at <= 1000) {
    row.roll = r.phone.roll
    row.pitch = r.phone.pitch
    row.yaw = r.phone.yaw
    row.accX = r.phone.accX
    row.accY = r.phone.accY
    row.accZ = r.phone.accZ
  }
  return row
}

/** Queues the rows collected so far for saving, after any save already running. */
function save(r: Run) {
  r.lastSaveAt = Date.now()
  if (r.buffer.size === 0) return
  const chunk = { rideId: r.ride.id, seq: r.seq++, ...r.buffer.take() }
  const patch = { rows: r.ride.rows, chunks: r.seq, summary: r.builder.get(), hasGps: r.gpsUsed, hasImu: r.imuUsed }
  r.saving = r.saving.then(async () => {
    try {
      await db.transaction('rw', db.rides, db.rideChunks, async () => {
        await db.rideChunks.put(chunk)
        await db.rides.update(r.ride.id, patch)
      })
    } catch {
      useRecorder.setState({ error: 'Some of the ride couldn’t be saved: this browser’s storage may be full.' })
    }
  })
}
