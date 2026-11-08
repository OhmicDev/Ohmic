// What a ride log stores for every row, and how rows are packed into
// compact column chunks for IndexedDB.
//
// Values are whole-vehicle and metric: currents are summed over the motor
// controllers, temperatures and duty are the highest, speed and voltage come
// from the main controller. Missing values are NaN.

export const COLUMN_IDS = [
  't', // ms since the ride started
  'speed', // km/h, from ERPM
  'distance', // km since the ride started
  'vIn', // V
  'currentIn', // A, battery, all controllers
  'currentMotor', // A, all motors
  'power', // W, battery side
  'duty', // %, highest
  'erpm', // main controller
  'tempMotor', // °C, hottest
  'tempFet', // °C, hottest
  'soc', // %
  'whUsed', // Wh since the ride started
  'whCharged', // Wh put back by braking since the ride started
  'ahUsed',
  'ahCharged',
  'fault', // fault code, 0 = none
  'lat', // ° (phone GPS)
  'lon',
  'alt', // m
  'gpsSpeed', // km/h
  'gpsAccuracy', // m
  'roll', // °
  'pitch',
  'yaw',
  'accX', // g
  'accY',
  'accZ',
] as const

export type ColumnId = (typeof COLUMN_IDS)[number]
export type Row = Record<ColumnId, number>
export type Columns = Record<ColumnId, Float32Array | Float64Array>

/** Time and position need more than float32's 7 digits. */
const WIDE: ReadonlySet<ColumnId> = new Set(['t', 'lat', 'lon'])

export const emptyRow = (): Row => Object.fromEntries(COLUMN_IDS.map((c) => [c, NaN])) as Row

export interface RideData {
  rows: number
  cols: Columns
}

export function allocColumns(rows: number): Columns {
  return Object.fromEntries(COLUMN_IDS.map((c) => [c, WIDE.has(c) ? new Float64Array(rows) : new Float32Array(rows)])) as Columns
}

/** Collects rows, then packs them into typed arrays. */
export class RowBuffer {
  private data: Record<ColumnId, number[]> = Object.fromEntries(COLUMN_IDS.map((c) => [c, []])) as unknown as Record<ColumnId, number[]>
  size = 0

  push(row: Row) {
    for (const c of COLUMN_IDS) this.data[c].push(row[c])
    this.size++
  }

  /** Packs everything collected so far and starts empty again. */
  take(): RideData {
    const cols = allocColumns(this.size)
    for (const c of COLUMN_IDS) cols[c].set(this.data[c])
    const out = { rows: this.size, cols }
    for (const c of COLUMN_IDS) this.data[c] = []
    this.size = 0
    return out
  }
}

/** Joins chunks in order. Columns a chunk lacks (an older format) are NaN. */
export function joinChunks(chunks: RideData[]): RideData {
  const rows = chunks.reduce((n, c) => n + c.rows, 0)
  const cols = allocColumns(rows)
  let at = 0
  for (const ch of chunks) {
    for (const c of COLUMN_IDS) {
      const src = ch.cols[c]
      if (src && src.length === ch.rows) cols[c].set(src, at)
      else cols[c].fill(NaN, at, at + ch.rows)
    }
    at += ch.rows
  }
  return { rows, cols }
}

export function rowAt(d: RideData, i: number): Row {
  return Object.fromEntries(COLUMN_IDS.map((c) => [c, d.cols[c][i]])) as Row
}

/** Whether any row has a value in this column. */
export function hasColumn(d: RideData, c: ColumnId): boolean {
  const a = d.cols[c]
  for (let i = 0; i < d.rows; i++) if (Number.isFinite(a[i])) return true
  return false
}

export const hasGps = (d: RideData) => hasColumn(d, 'lat') && hasColumn(d, 'lon')
export const hasImu = (d: RideData) => hasColumn(d, 'roll') || hasColumn(d, 'accX')
