// Ride log files: VESC Tool CSV in and out, GPX out.
//
// VESC Tool reads and writes two CSV layouts (vesc_tool pages/pageloganalysis.cpp
// and vescinterface.cpp):
//  - Log analysis: a header of `key:name:unit:precision:isRelativeToFirst:isTimeStamp`
//    entries separated by ";". Empty cells repeat the previous row's value.
//    VESC Express and LispBM logging write this too. Exports use it, so VESC Tool
//    opens them in Log Analysis with the map, trip and energy recognised.
//  - Realtime logging (older): plain names starting with `ms_today`, one row per
//    update, ";" separated (sometimes ","), times in ms since UTC midnight.

import { speedKmh, tachoToKm, type VehicleSetup } from '../lib/vehicle'
import { allocColumns, hasGps, hasImu, type ColumnId, type RideData } from './columns'

export class LogFileError extends Error {}

export interface ImportedLog {
  data: RideData
  startedAt: number
  rateHz: number
  format: 'vesc-tool' | 'vesc-tool-realtime'
  /** Columns in the file this app doesn't use. */
  skipped: string[]
  notes: string[]
}

interface ImportOptions {
  fileName: string
  /** File's last-modified time (ms), used for the date when the name doesn't carry one. */
  lastModified?: number
  /** Turns ERPM and tachometer into speed and distance when the file only has those. */
  vehicle: VehicleSetup
}

const DAY_MS = 86_400_000
const RAD = 180 / Math.PI
/** About 3 hours at 20 Hz, or a day at 1 Hz; beyond this the browser would struggle. */
const MAX_ROWS = 250_000

/** VESC Tool names realtime logs "2024-03-15_14-22-01.csv" (local time). */
export function dateFromFileName(name: string): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})[_ T](\d{2})[-:](\d{2})[-:](\d{2})/.exec(name)
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number)
  const t = new Date(y, mo - 1, d, h, mi, s).getTime()
  return Number.isFinite(t) && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? t : null
}

export function parseVescCsv(text: string, opts: ImportOptions): ImportedLog {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length < 2) throw new LogFileError('This file has no rows of data.')
  let sep = ';'
  let header = lines[0].split(sep)
  if (header.length === 1) {
    sep = ','
    header = lines[0].split(sep)
  }
  header = header.map((h) => h.trim().replace(/^﻿/, ''))
  if (lines.length - 1 > MAX_ROWS) throw new LogFileError(`This log has ${lines.length - 1} rows; the most that can be opened is ${MAX_ROWS}. Split it in VESC Tool first.`)
  if (header[0].includes(':')) return parseAnalysis(lines, sep, header, opts)
  if (header[0] === 'ms_today') return parseRealtime(lines, sep, header, opts)
  throw new LogFileError('This doesn’t look like a VESC Tool log. Logs start with “ms_today” or with VESC Tool’s “key:name:unit” header.')
}

/** Keeps a running total from a counter that restarts at zero when the controller reboots. */
class Accumulator {
  private last: number | null = null
  total = 0
  add(v: number): number {
    if (!Number.isFinite(v)) return this.last === null ? NaN : this.total
    if (this.last !== null) this.total += v >= this.last ? v - this.last : v
    this.last = v
    return this.total
  }
}

/** Times that may wrap at midnight, made to count up from the first one (ms). */
class Clock {
  private first: number | null = null
  private prev = 0
  private wraps = 0
  at(ms: number): number {
    if (this.first === null) {
      this.first = ms
      this.prev = ms
    }
    if (ms < this.prev - DAY_MS / 2) this.wraps++
    this.prev = ms
    return ms + this.wraps * DAY_MS - this.first
  }
  get start() {
    return this.first
  }
}

function finish(data: RideData, firstDayMs: number | null, opts: ImportOptions, format: ImportedLog['format'], skipped: string[], notes: string[]): ImportedLog {
  const t = data.cols.t
  const durationMs = data.rows ? t[data.rows - 1] : 0
  // Date: the file name if VESC Tool named it, else when the file was saved, minus the ride.
  let startedAt = dateFromFileName(opts.fileName)
  if (startedAt === null) {
    const end = opts.lastModified ?? Date.now()
    startedAt = end - durationMs
    if (firstDayMs !== null) {
      // Same day as that, at the time of day the log says (UTC).
      const midnight = Math.floor(startedAt / DAY_MS) * DAY_MS
      let s = midnight + firstDayMs
      if (s > end) s -= DAY_MS
      startedAt = s
    }
  }
  return { data, startedAt, rateHz: rateOf(data), format, skipped, notes }
}

/** Typical rows per second, from the median gap between rows. */
export function rateOf(d: RideData): number {
  const gaps: number[] = []
  for (let i = 1; i < Math.min(d.rows, 2000); i++) {
    const g = d.cols.t[i] - d.cols.t[i - 1]
    if (g > 0) gaps.push(g)
  }
  if (!gaps.length) return 0
  gaps.sort((a, b) => a - b)
  const median = gaps[gaps.length >> 1]
  return Math.round((1000 / median) * 10) / 10
}

/** The Log Analysis keys this app reads. */
const ANALYSIS_KEYS = new Set([
  't_day', 't_day_pos', 't_trip', 'kmh_vesc', 'kmh_gnss', 'trip_vesc', 'trip_vesc_abs', 'trip_gnss',
  'setup_curr_motor', 'setup_curr_battery', 'setup_power', 'erpm', 'duty', 'fault', 'v_in', 'soc',
  't_mosfet', 't_motor', 'cnt_ah', 'cnt_ah_chg', 'cnt_wh', 'cnt_wh_chg', 'roll', 'pitch', 'yaw',
  'acc_x', 'acc_y', 'acc_z', 'v1_curr_motor', 'v1_curr_battery', 'gnss_lat', 'gnss_lon', 'gnss_alt', 'gnss_h_acc', 'num_vesc',
])

function parseAnalysis(lines: string[], sep: string, header: string[], opts: ImportOptions): ImportedLog {
  const keys = header.map((h) => h.split(':')[0].trim())
  const idx = (k: string) => keys.indexOf(k)
  const skipped = keys.filter((k) => !ANALYSIS_KEYS.has(k))
  const notes: string[] = []

  // Rows with the wrong number of cells are skipped, as VESC Tool does.
  const rows: number[][] = []
  const last = keys.map(() => NaN)
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(sep)
    if (cells.length !== keys.length) continue
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k].trim()
      if (c !== '') {
        const v = Number(c)
        last[k] = Number.isFinite(v) ? v : NaN
      }
    }
    rows.push(last.slice())
  }
  if (!rows.length) throw new LogFileError('None of the rows match the header. The file may be cut short or edited.')

  const data = { rows: rows.length, cols: allocColumns(rows.length) }
  const c = data.cols
  const get = (r: number[], k: string) => {
    const i = idx(k)
    return i < 0 ? NaN : r[i]
  }
  const has = (k: string) => idx(k) >= 0
  const timeKey = has('t_day') ? 't_day' : has('t_trip') ? 't_trip' : null
  if (!timeKey) notes.push('The log has no time column, so 10 rows per second was assumed.')
  const clock = new Clock()
  const dist = new Accumulator()
  const acc = { ah: new Accumulator(), ahc: new Accumulator(), wh: new Accumulator(), whc: new Accumulator() }
  let integrated = 0

  rows.forEach((r, i) => {
    const tSec = timeKey ? get(r, timeKey) : i / 10
    c.t[i] = clock.at(Math.round(tSec * 1000))
    const speed = has('kmh_vesc') ? Math.abs(get(r, 'kmh_vesc')) : Math.abs(speedKmh(get(r, 'erpm'), opts.vehicle))
    c.speed[i] = speed
    if (has('trip_vesc_abs') || has('trip_vesc')) c.distance[i] = dist.add(get(r, has('trip_vesc_abs') ? 'trip_vesc_abs' : 'trip_vesc')) / 1000
    else {
      if (i > 0 && Number.isFinite(speed)) integrated += (speed * (c.t[i] - c.t[i - 1])) / 3_600_000
      c.distance[i] = integrated
    }
    c.vIn[i] = get(r, 'v_in')
    c.currentIn[i] = has('setup_curr_battery') ? get(r, 'setup_curr_battery') : get(r, 'v1_curr_battery')
    c.currentMotor[i] = has('setup_curr_motor') ? get(r, 'setup_curr_motor') : get(r, 'v1_curr_motor')
    c.power[i] = has('setup_power') ? get(r, 'setup_power') : c.vIn[i] * c.currentIn[i]
    c.duty[i] = get(r, 'duty')
    c.erpm[i] = get(r, 'erpm')
    c.tempMotor[i] = get(r, 't_motor')
    c.tempFet[i] = get(r, 't_mosfet')
    c.soc[i] = get(r, 'soc')
    c.ahUsed[i] = acc.ah.add(get(r, 'cnt_ah'))
    c.ahCharged[i] = acc.ahc.add(get(r, 'cnt_ah_chg'))
    c.whUsed[i] = acc.wh.add(get(r, 'cnt_wh'))
    c.whCharged[i] = acc.whc.add(get(r, 'cnt_wh_chg'))
    c.fault[i] = get(r, 'fault')
    const lat = get(r, 'gnss_lat')
    const lon = get(r, 'gnss_lon')
    const fix = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)
    c.lat[i] = fix ? lat : NaN
    c.lon[i] = fix ? lon : NaN
    c.alt[i] = fix ? get(r, 'gnss_alt') : NaN
    c.gpsSpeed[i] = fix ? get(r, 'kmh_gnss') : NaN
    c.gpsAccuracy[i] = fix ? get(r, 'gnss_h_acc') : NaN
    c.roll[i] = get(r, 'roll') * RAD
    c.pitch[i] = get(r, 'pitch') * RAD
    c.yaw[i] = get(r, 'yaw') * RAD
    c.accX[i] = get(r, 'acc_x')
    c.accY[i] = get(r, 'acc_y')
    c.accZ[i] = get(r, 'acc_z')
  })
  return finish(data, timeKey === 't_day' ? clock.start : null, opts, 'vesc-tool', skipped, notes)
}

function parseRealtime(lines: string[], sep: string, header: string[], opts: ImportOptions): ImportedLog {
  const at = new Map(header.map((h, i) => [h, i]))
  const known = new Set(REALTIME_NAMES)
  const skipped = header.filter((h) => h !== '' && !known.has(h))
  const rows: string[][] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(sep)
    if (cells.length >= 22) rows.push(cells) // as VESC Tool: shorter rows are skipped
  }
  if (!rows.length) throw new LogFileError('None of the rows are complete. The file may be cut short.')

  const data = { rows: rows.length, cols: allocColumns(rows.length) }
  const c = data.cols
  const num = (r: string[], name: string) => {
    const i = at.get(name)
    if (i === undefined || i >= r.length) return NaN
    const s = r[i].trim()
    return s === '' ? NaN : Number(s)
  }
  const clock = new Clock()
  const dist = new Accumulator()
  const tacho = new Accumulator()
  const acc = { ah: new Accumulator(), ahc: new Accumulator(), wh: new Accumulator(), whc: new Accumulator() }
  const notes: string[] = []
  let usedLocalOnly = false

  rows.forEach((r, i) => {
    c.t[i] = clock.at(num(r, 'ms_today'))
    // "Setup" values cover the whole vehicle; -1 means they hadn't arrived yet.
    const setup = num(r, 'ms_today_setup') >= 0
    if (!setup) usedLocalOnly = true
    const erpm = num(r, 'erpm')
    c.erpm[i] = erpm
    c.speed[i] = setup ? Math.abs(num(r, 'speed_meters_per_sec') * 3.6) : Math.abs(speedKmh(erpm, opts.vehicle))
    const tachoKm = tachoToKm(tacho.add(num(r, 'tachometer_abs')), opts.vehicle)
    c.distance[i] = setup ? dist.add(num(r, 'tacho_abs_meters')) / 1000 : tachoKm
    c.vIn[i] = num(r, 'input_voltage')
    c.currentIn[i] = setup ? num(r, 'current_in_setup') : num(r, 'current_in')
    c.currentMotor[i] = setup ? num(r, 'current_motor_setup') : num(r, 'current_motor')
    c.power[i] = c.vIn[i] * c.currentIn[i]
    c.duty[i] = num(r, 'duty_cycle') * 100
    c.tempMotor[i] = num(r, 'temp_motor')
    c.tempFet[i] = num(r, 'temp_mos_max')
    c.soc[i] = setup ? num(r, 'battery_level') * 100 : NaN
    c.ahUsed[i] = acc.ah.add(setup ? num(r, 'amp_hours_setup') : num(r, 'amp_hours_used'))
    c.ahCharged[i] = acc.ahc.add(setup ? num(r, 'amp_hours_charged_setup') : num(r, 'amp_hours_charged'))
    c.whUsed[i] = acc.wh.add(setup ? num(r, 'watt_hours_setup') : num(r, 'watt_hours_used'))
    c.whCharged[i] = acc.whc.add(setup ? num(r, 'watt_hours_charged_setup') : num(r, 'watt_hours_charged'))
    c.fault[i] = num(r, 'fault_code')
    const imu = num(r, 'ms_today_imu') >= 0
    c.roll[i] = imu ? num(r, 'roll') * RAD : NaN
    c.pitch[i] = imu ? num(r, 'pitch') * RAD : NaN
    c.yaw[i] = imu ? num(r, 'yaw') * RAD : NaN
    c.accX[i] = imu ? num(r, 'accX') : NaN
    c.accY[i] = imu ? num(r, 'accY') : NaN
    c.accZ[i] = imu ? num(r, 'accZ') : NaN
    const lat = num(r, 'gnss_lat')
    const lon = num(r, 'gnss_lon')
    const fix = num(r, 'gnss_posTime') >= 0 && Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)
    c.lat[i] = fix ? lat : NaN
    c.lon[i] = fix ? lon : NaN
    c.alt[i] = fix ? num(r, 'gnss_alt') : NaN
    c.gpsSpeed[i] = fix ? num(r, 'gnss_gVel') * 3.6 : NaN
    c.gpsAccuracy[i] = fix ? num(r, 'gnss_hAcc') : NaN
  })
  if (usedLocalOnly) notes.push('Some rows only had the connected controller’s values, so speed and distance there come from your vehicle setup.')
  return finish(data, clock.start, opts, 'vesc-tool-realtime', skipped, notes)
}

const REALTIME_NAMES = [
  'ms_today', 'input_voltage', 'temp_mos_max', 'temp_mos_1', 'temp_mos_2', 'temp_mos_3', 'temp_motor', 'current_motor', 'current_in',
  'd_axis_current', 'q_axis_current', 'erpm', 'duty_cycle', 'amp_hours_used', 'amp_hours_charged', 'watt_hours_used', 'watt_hours_charged',
  'tachometer', 'tachometer_abs', 'encoder_position', 'fault_code', 'vesc_id', 'd_axis_voltage', 'q_axis_voltage', 'ms_today_setup',
  'amp_hours_setup', 'amp_hours_charged_setup', 'watt_hours_setup', 'watt_hours_charged_setup', 'battery_level', 'battery_wh_tot',
  'current_in_setup', 'current_motor_setup', 'speed_meters_per_sec', 'tacho_meters', 'tacho_abs_meters', 'num_vescs', 'ms_today_imu',
  'roll', 'pitch', 'yaw', 'accX', 'accY', 'accZ', 'gyroX', 'gyroY', 'gyroZ', 'gnss_posTime', 'gnss_lat', 'gnss_lon', 'gnss_alt',
  'gnss_gVel', 'gnss_vVel', 'gnss_hAcc', 'gnss_vAcc',
]

interface ExportColumn {
  key: string
  name: string
  unit: string
  precision: number
  relative: boolean
  timestamp: boolean
  value: (i: number) => number
}

/** A ride as a VESC Tool Log Analysis CSV. */
export function toVescCsv(d: RideData, startedAt: number): string {
  const c = d.cols
  const col = (key: string, name: string, unit: string, precision: number, id: ColumnId, scale = 1, relative = false): ExportColumn => ({
    key,
    name,
    unit,
    precision,
    relative,
    timestamp: false,
    value: (i) => c[id][i] * scale,
  })
  const cols: ExportColumn[] = [
    { key: 't_day', name: 'Time', unit: 's', precision: 3, relative: false, timestamp: true, value: (i) => (((startedAt + c.t[i]) % DAY_MS) + DAY_MS) % DAY_MS / 1000 },
    { key: 't_trip', name: 'Time of trip', unit: 's', precision: 3, relative: true, timestamp: true, value: (i) => c.t[i] / 1000 },
    col('kmh_vesc', 'Speed VESC', 'km/h', 2, 'speed'),
    col('trip_vesc', 'Trip VESC', 'm', 3, 'distance', 1000, true),
    col('trip_vesc_abs', 'Trip VESC ABS', 'm', 3, 'distance', 1000, true),
    col('setup_curr_motor', 'Current Motors', 'A', 2, 'currentMotor'),
    col('setup_curr_battery', 'Current Battery', 'A', 2, 'currentIn'),
    col('setup_power', 'Power', 'W', 0, 'power'),
    col('erpm', 'ERPM', '', 0, 'erpm'),
    col('duty', 'Duty', '%', 1, 'duty'),
    col('fault', 'Fault Code', '', 0, 'fault'),
    col('v_in', 'Input Voltage', 'V', 2, 'vIn'),
    col('soc', 'Battery Level', '%', 1, 'soc'),
    col('t_mosfet', 'Temp MOSFET', '°C', 1, 'tempFet'),
    col('t_motor', 'Temp Motor', '°C', 1, 'tempMotor'),
    col('cnt_ah', 'Ah Used', 'Ah', 3, 'ahUsed', 1, true),
    col('cnt_ah_chg', 'Ah Charged', 'Ah', 3, 'ahCharged', 1, true),
    col('cnt_wh', 'Wh Used', 'Wh', 3, 'whUsed', 1, true),
    col('cnt_wh_chg', 'Wh Charged', 'Wh', 3, 'whCharged', 1, true),
  ]
  if (hasImu(d)) {
    cols.push(
      col('roll', 'Roll', 'rad', 3, 'roll', 1 / RAD),
      col('pitch', 'Pitch', 'rad', 3, 'pitch', 1 / RAD),
      col('yaw', 'Yaw', 'rad', 3, 'yaw', 1 / RAD),
      col('acc_x', 'Accel X', 'G', 3, 'accX'),
      col('acc_y', 'Accel Y', 'G', 3, 'accY'),
      col('acc_z', 'Accel Z', 'G', 3, 'accZ'),
    )
  }
  if (hasGps(d)) {
    // VESC Tool repeats the last value for an empty cell, starting from 0, so rows
    // before the first fix take the first fix, marked as poor, rather than 0°, 0°.
    let first = 0
    while (first < d.rows && !Number.isFinite(c.lat[first])) first++
    const at = (i: number) => (i < first ? first : i)
    const poor = (i: number) => i < first
    cols.push(
      { key: 'gnss_lat', name: 'Latitude', unit: '°', precision: 7, relative: false, timestamp: false, value: (i) => c.lat[at(i)] },
      { key: 'gnss_lon', name: 'Longitude', unit: '°', precision: 7, relative: false, timestamp: false, value: (i) => c.lon[at(i)] },
      { key: 'gnss_alt', name: 'Altitude', unit: 'm', precision: 1, relative: false, timestamp: false, value: (i) => c.alt[at(i)] },
      { key: 'kmh_gnss', name: 'Speed GNSS', unit: 'km/h', precision: 2, relative: false, timestamp: false, value: (i) => (poor(i) ? 0 : c.gpsSpeed[i]) },
      { key: 'gnss_h_acc', name: 'H. Accuracy GNSS', unit: 'm', precision: 1, relative: false, timestamp: false, value: (i) => (poor(i) ? 999 : c.gpsAccuracy[i]) },
    )
  }
  const head = cols.map((x) => `${x.key}:${x.name}:${x.unit}:${x.precision}:${x.relative ? 1 : 0}:${x.timestamp ? 1 : 0}`).join(';')
  const out = [head]
  for (let i = 0; i < d.rows; i++) out.push(cols.map((x) => cell(x.value(i), x.precision)).join(';'))
  return out.join('\n') + '\n'
}

/** Fixed decimals with trailing zeros dropped; empty when missing (VESC Tool then repeats the last value). */
function cell(v: number, precision: number): string {
  if (!Number.isFinite(v)) return ''
  const s = v.toFixed(precision)
  const t = precision > 0 ? s.replace(/\.?0+$/, '') : s
  return t === '-0' ? '0' : t
}

/** The GPS track as GPX 1.1, with speed in Garmin's track point extension. */
export function toGpx(d: RideData, startedAt: number, name: string): string {
  const c = d.cols
  const pts: string[] = []
  let lastLat = NaN
  let lastLon = NaN
  for (let i = 0; i < d.rows; i++) {
    const lat = c.lat[i]
    const lon = c.lon[i]
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    // GPS updates about once a second; rows in between repeat the same fix.
    if (lat === lastLat && lon === lastLon) continue
    lastLat = lat
    lastLon = lon
    const ele = Number.isFinite(c.alt[i]) ? `<ele>${c.alt[i].toFixed(1)}</ele>` : ''
    const speed = Number.isFinite(c.speed[i])
      ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>${(c.speed[i] / 3.6).toFixed(2)}</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions>`
      : ''
    pts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}">${ele}<time>${new Date(startedAt + c.t[i]).toISOString()}</time>${speed}</trkpt>`)
  }
  if (!pts.length) throw new LogFileError('This ride has no GPS positions.')
  const title = escapeXml(name)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Ohmic" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2">',
    `<metadata><name>${title}</name><time>${new Date(startedAt).toISOString()}</time></metadata>`,
    `<trk><name>${title}</name><trkseg>`,
    ...pts,
    '</trkseg></trk>',
    '</gpx>',
    '',
  ].join('\n')
}

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch]!)
}
