// Saved rides in IndexedDB: the list, loading one ride's rows, imports,
// renaming and deleting. The recorder writes through here too.

import { create } from 'zustand'
import { hasGps, hasImu, joinChunks, type Columns, type RideData } from '../logs/columns'
import type { ImportedLog } from '../logs/logFiles'
import { summarize, type RideSummary } from '../logs/summary'
import { db } from './db'

export interface RideLog {
  id: string
  startedAt: number
  /** Null while recording, or if the app closed before the ride was finished. */
  endedAt: number | null
  /** Null shows the date instead. */
  name: string | null
  source: 'recorded' | 'imported'
  /** Recorded from the demo scooter. */
  demo: boolean
  fileName: string | null
  rateHz: number
  rows: number
  chunks: number
  hasGps: boolean
  hasImu: boolean
  /** "SIM_75_100 · Local", "CAN 2" */
  devices: string[]
  summary: RideSummary
}

export interface RideChunk {
  rideId: string
  seq: number
  rows: number
  cols: Columns
}

/** Rows per stored chunk for imports (the recorder saves every few seconds instead). */
const IMPORT_CHUNK_ROWS = 4000

export function rideTitle(r: Pick<RideLog, 'name' | 'startedAt'>): string {
  if (r.name) return r.name
  const d = new Date(r.startedAt)
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `Ride on ${day}, ${time}`
}

export async function listRides(): Promise<RideLog[]> {
  return db.rides.orderBy('startedAt').reverse().toArray()
}

export async function getRide(id: string): Promise<RideLog | undefined> {
  return db.rides.get(id)
}

export async function loadRideData(id: string): Promise<RideData> {
  const chunks = await db.rideChunks.where('rideId').equals(id).sortBy('seq')
  return joinChunks(chunks)
}

export async function deleteRide(id: string) {
  await db.transaction('rw', db.rides, db.rideChunks, async () => {
    await db.rideChunks.where('rideId').equals(id).delete()
    await db.rides.delete(id)
  })
  await useRideLogs.getState().refresh()
}

/** Renames a ride; an empty name goes back to showing the date. */
export async function renameRide(id: string, name: string) {
  const n = name.trim()
  await db.rides.update(id, { name: n === '' ? null : n.slice(0, 80) })
  await useRideLogs.getState().refresh()
}

/** Splits rows into chunks for storage. */
function* chunksOf(d: RideData, size: number): Generator<{ rows: number; cols: Columns }> {
  for (let from = 0; from < d.rows; from += size) {
    const to = Math.min(d.rows, from + size)
    const cols = Object.fromEntries(Object.entries(d.cols).map(([k, a]) => [k, a.slice(from, to)])) as Columns
    yield { rows: to - from, cols }
  }
}

/** Saves an imported log as a ride. Returns its id. */
export async function saveImportedRide(log: ImportedLog, fileName: string): Promise<string> {
  const id = crypto.randomUUID()
  const durationMs = log.data.rows ? log.data.cols.t[log.data.rows - 1] : 0
  const ride: RideLog = {
    id,
    startedAt: log.startedAt,
    endedAt: log.startedAt + durationMs,
    name: fileName.replace(/\.[^.]+$/, '') || null,
    source: 'imported',
    demo: false,
    fileName,
    rateHz: log.rateHz,
    rows: log.data.rows,
    chunks: 0,
    hasGps: hasGps(log.data),
    hasImu: hasImu(log.data),
    devices: [],
    summary: summarize(log.data),
  }
  await db.transaction('rw', db.rides, db.rideChunks, async () => {
    let seq = 0
    for (const ch of chunksOf(log.data, IMPORT_CHUNK_ROWS)) await db.rideChunks.put({ rideId: id, seq: seq++, ...ch })
    ride.chunks = seq
    await db.rides.put(ride)
  })
  await useRideLogs.getState().refresh()
  return id
}

/**
 * Rides left open when the app closed mid-recording: their saved rows are kept
 * and the ride is closed where they end. Empty ones are removed.
 */
export async function finishInterruptedRides(activeId: string | null): Promise<number> {
  const open = (await db.rides.toArray()).filter((r) => r.endedAt === null && r.id !== activeId)
  for (const r of open) {
    const data = await loadRideData(r.id)
    if (data.rows === 0) {
      await db.rides.delete(r.id)
      continue
    }
    await db.rides.update(r.id, {
      endedAt: r.startedAt + data.cols.t[data.rows - 1],
      rows: data.rows,
      hasGps: hasGps(data),
      hasImu: hasImu(data),
      summary: summarize(data),
    })
  }
  return open.length
}

/**
 * A finished ride whose saved rows don't match its summary (the last save landed
 * after the ride was closed, when the app was closed mid-recording) gets its
 * numbers worked out again. Returns the ride as it is now.
 */
export async function reconcileRide(ride: RideLog, data: RideData): Promise<RideLog> {
  if (ride.endedAt === null || ride.rows === data.rows || data.rows === 0) return ride
  const patch = {
    endedAt: ride.startedAt + data.cols.t[data.rows - 1],
    rows: data.rows,
    hasGps: hasGps(data),
    hasImu: hasImu(data),
    summary: summarize(data),
  }
  await db.rides.update(ride.id, patch)
  await useRideLogs.getState().refresh()
  return { ...ride, ...patch }
}

interface RideLogsState {
  rides: RideLog[]
  loaded: boolean
  refresh: () => Promise<void>
}

export const useRideLogs = create<RideLogsState>()((set) => ({
  rides: [],
  loaded: false,
  refresh: async () => {
    try {
      set({ rides: await listRides(), loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
}))
