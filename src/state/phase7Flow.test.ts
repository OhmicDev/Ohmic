// Ride logs end to end against the simulated scooter: record with GPS and IMU,
// save while riding, recover after the app closed, import and delete.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasGps } from '../logs/columns'
import { parseVescCsv, toVescCsv } from '../logs/logFiles'
import { DEFAULT_VEHICLE } from '../lib/vehicle'
import { MockBus } from '../sim/mockBus'
import { MockTransport } from '../transport/MockTransport'
import { db } from './db'
import { deleteRide, finishInterruptedRides, getRide, listRides, loadRideData, renameRide, saveImportedRide } from './rideLogs'
import { useRecorder } from './rideRecorder'
import { connectWith, useSession } from './session'
import { useSettings } from './settings'
import { useTelemetry } from './telemetry'

async function waitFor(check: () => boolean, timeoutMs = 5000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}

async function connect() {
  const bus = new MockBus()
  bus.sim.rideTime = 4.5 // riding at full throttle
  await connectWith(new MockTransport({ bus, connectDelayMs: 5, latencyMs: [1, 2] }))
  await waitFor(() => useSession.getState().link === 'ok' && !!useTelemetry.getState().devices.can2)
  return bus
}

const rec = () => useRecorder.getState()
let doc: EventTarget & { visibilityState: string }

beforeEach(async () => {
  vi.stubGlobal('window', new EventTarget())
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('document', doc)
  useSettings.setState({ autoReconnect: false, pollHz: 20, logRateHz: 10, logGps: true, logImu: true, deviceViews: {}, absArmed: [], regenArmed: [] })
  useRecorder.setState({ status: 'idle', rideId: null, rows: 0, error: null, lastSavedId: null })
  await Promise.all([db.rides.clear(), db.rideChunks.clear()])
})

afterEach(async () => {
  await rec().stop()
  await useSession.getState().disconnect()
  vi.unstubAllGlobals()
})

describe('recording a ride', () => {
  it('needs a connection', async () => {
    expect(await rec().start()).toBe(false)
    expect(rec().error).toMatch(/Connect/)
  })

  it('records whole-vehicle rows at the chosen rate, with simulated GPS and the controller’s IMU', async () => {
    await connect()
    expect(await rec().start()).toBe(true)
    expect(rec().gps).toBe('simulated')
    await waitFor(() => rec().rows >= 15, 4000)
    const id = await rec().stop()
    expect(id).not.toBeNull()
    expect(rec().lastSavedId).toBe(id)

    const ride = (await getRide(id!))!
    expect(ride.endedAt).not.toBeNull()
    expect(ride.rateHz).toBe(10)
    expect(ride.hasGps).toBe(true)
    expect(ride.hasImu).toBe(true)
    expect(ride.devices).toHaveLength(2)
    expect(ride.demo).toBe(true)

    const d = await loadRideData(id!)
    expect(d.rows).toBe(ride.rows)
    expect(d.rows).toBeGreaterThanOrEqual(15)
    // About 10 rows a second, though live data comes 20 times a second.
    const gaps = [...d.cols.t].slice(1).map((t, i) => t - d.cols.t[i])
    const median = gaps.sort((a, b) => a - b)[gaps.length >> 1]
    expect(median).toBeGreaterThan(80)
    expect(median).toBeLessThan(130)
    const last = d.rows - 1
    expect(d.cols.speed[last]).toBeGreaterThan(5)
    expect(d.cols.distance[last]).toBeGreaterThan(0)
    expect(d.cols.whUsed[last]).toBeGreaterThan(0)
    // Two motors: battery current is the sum of both controllers.
    const local = useTelemetry.getState().devices.local
    expect(Math.abs(d.cols.currentIn[last])).toBeGreaterThan(Math.abs(local.currentIn) * 1.2)
    expect(hasGps(d)).toBe(true)
    expect(d.cols.lat[last]).toBeCloseTo(52.47, 1)
    expect(d.cols.roll[last]).not.toBeNaN()
    expect(ride.summary.maxSpeed).toBeGreaterThan(5)
    expect(ride.summary.distanceKm).toBeCloseTo(d.cols.distance[last], 6)
  })

  it('saves as it goes, so a ride survives the app closing', async () => {
    await connect()
    await rec().start()
    const id = rec().rideId!
    await waitFor(() => rec().rows >= 8, 4000)
    // The page is hidden (phone locked, app switched): everything so far is saved.
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    await new Promise((r) => setTimeout(r, 50))
    const saved = await loadRideData(id)
    expect(saved.rows).toBeGreaterThanOrEqual(8)
    expect((await getRide(id))!.endedAt).toBeNull()

    // The app is killed here: next time, the open ride is closed where its rows end.
    expect(await finishInterruptedRides(null)).toBe(1)
    const r = (await getRide(id))!
    expect(r.endedAt).toBe(r.startedAt + saved.cols.t[saved.rows - 1])
    expect(r.rows).toBe(saved.rows)
    // While it's still being recorded, it's left alone.
    doc.visibilityState = 'visible'
    expect(await finishInterruptedRides(id)).toBe(0)
  })

  it('keeps the ride when the connection ends', async () => {
    await connect()
    await rec().start()
    await waitFor(() => rec().rows >= 5, 4000)
    await useSession.getState().disconnect()
    await waitFor(() => rec().status === 'idle')
    const rides = await listRides()
    expect(rides).toHaveLength(1)
    expect(rides[0].endedAt).not.toBeNull()
    expect(rides[0].rows).toBeGreaterThanOrEqual(5)
  })

  it('throws away a ride with no rows', async () => {
    await connect()
    await rec().start()
    useSession.setState({ busy: 'test' }) // the poll loop pauses (as during a firmware update)
    const id = rec().rideId!
    await rec().stop()
    useSession.setState({ busy: null })
    // A row may have slipped in before the pause; either way nothing empty is left.
    const left = await getRide(id)
    if (left) expect(left.rows).toBeGreaterThan(0)
    else expect(rec().error).toMatch(/Nothing was recorded/)
  })
})

describe('saved rides', () => {
  it('imports a VESC Tool log, renames and deletes it', async () => {
    const csv = [
      't_day:Time:s:0:0:1;kmh_vesc:Speed VESC:km/h:2:0:0;trip_vesc_abs:Trip VESC ABS:m:3:1:0;cnt_wh:Wh Used:Wh:3:1:0',
      ...Array.from({ length: 9000 }, (_, i) => `${1000 + i * 0.1};${20 + (i % 50) / 10};${i * 0.55};${i * 0.012}`),
    ].join('\n')
    const log = parseVescCsv(csv, { fileName: '2025-06-01_09-30-00.csv', vehicle: DEFAULT_VEHICLE })
    const id = await saveImportedRide(log, '2025-06-01_09-30-00.csv')
    const r = (await getRide(id))!
    expect(r.source).toBe('imported')
    expect(r.chunks).toBe(3) // stored a few thousand rows at a time
    expect(r.summary.distanceKm).toBeCloseTo(4.949, 2)
    expect(r.summary.whPerKm).toBeCloseTo(107.99 / 4.9445, 0)
    const back = await loadRideData(id)
    expect(back.rows).toBe(9000)
    expect(back.cols.speed[8999]).toBeCloseTo(log.data.cols.speed[8999], 5)
    // And out again in VESC Tool's format.
    expect(toVescCsv(back, r.startedAt).split('\n')).toHaveLength(9002)

    await renameRide(id, '  Morning loop  ')
    expect((await getRide(id))!.name).toBe('Morning loop')
    await renameRide(id, '')
    expect((await getRide(id))!.name).toBeNull()

    await deleteRide(id)
    expect(await getRide(id)).toBeUndefined()
    expect(await db.rideChunks.where('rideId').equals(id).count()).toBe(0)
  })
})
