import { describe, expect, it } from 'vitest'
import { DEFAULT_VEHICLE } from '../lib/vehicle'
import { allocColumns, emptyRow, hasGps, joinChunks, RowBuffer, type RideData } from './columns'
import { dateFromFileName, LogFileError, parseVescCsv, rateOf, toGpx, toVescCsv } from './logFiles'
import { averageWhPerKm, SummaryBuilder, summarize } from './summary'

const opts = { fileName: 'ride.csv', vehicle: DEFAULT_VEHICLE }

// The header VESC Tool's realtime logger writes (vescinterface.cpp), trailing ";" included.
const RT_HEADER =
  'ms_today;input_voltage;temp_mos_max;temp_mos_1;temp_mos_2;temp_mos_3;temp_motor;current_motor;current_in;d_axis_current;q_axis_current;erpm;duty_cycle;amp_hours_used;amp_hours_charged;watt_hours_used;watt_hours_charged;tachometer;tachometer_abs;encoder_position;fault_code;vesc_id;d_axis_voltage;q_axis_voltage;ms_today_setup;amp_hours_setup;amp_hours_charged_setup;watt_hours_setup;watt_hours_charged_setup;battery_level;battery_wh_tot;current_in_setup;current_motor_setup;speed_meters_per_sec;tacho_meters;tacho_abs_meters;num_vescs;ms_today_imu;roll;pitch;yaw;accX;accY;accZ;gyroX;gyroY;gyroZ;gnss_posTime;gnss_lat;gnss_lon;gnss_alt;gnss_gVel;gnss_vVel;gnss_hAcc;gnss_vAcc;'

function rtRow(o: { ms: number; v?: number; speed?: number; tacho?: number; wh?: number; batt?: number; duty?: number; fault?: number; pos?: number; lat?: number; lon?: number; imu?: number; roll?: number; setup?: number }) {
  const cells = [
    o.ms, o.v ?? 50, 40, 40, 39, 38, 55, 12, 8, 0, 12, 9000, o.duty ?? 0.5, 0.1, 0.01, 5, 0.4, 1000, 1200, 0, o.fault ?? 0, 0, 1, 2,
    o.setup ?? o.ms, 0.2, 0.02, o.wh ?? 10, 0.8, o.batt ?? 0.8, 700, 16, 24, o.speed ?? 5, 100, o.tacho ?? 120, 2,
    o.imu ?? -1, o.roll ?? 0.1, 0.05, 1.5, 0.01, 0.02, 0.98, 1, 2, 3,
    o.pos ?? -1, o.lat ?? 0, o.lon ?? 0, 44, 5.2, 0, 3.5, 6,
  ]
  return cells.join(';') + ';'
}

describe('VESC Tool realtime logs', () => {
  it('reads whole-vehicle values, GPS and IMU, and the date from the file name', () => {
    const text = [
      RT_HEADER,
      rtRow({ ms: 50_000_000, speed: 5, tacho: 120, wh: 10, pos: -1 }),
      rtRow({ ms: 50_000_100, speed: 6, tacho: 125, wh: 10.5, pos: 49_999_900, lat: 52.47, lon: 13.4, imu: 50_000_100, roll: Math.PI / 6 }),
      '1;2;3', // too short: skipped, as VESC Tool does
      rtRow({ ms: 50_000_200, speed: 6.5, tacho: 131, wh: 11, pos: 50_000_150, lat: 52.4701, lon: 13.4001, fault: 4 }),
    ].join('\n')
    const log = parseVescCsv(text, { ...opts, fileName: '2024-03-15_14-22-01.csv' })
    expect(log.format).toBe('vesc-tool-realtime')
    expect(log.data.rows).toBe(3)
    const c = log.data.cols
    expect([...c.t]).toEqual([0, 100, 200])
    expect(c.speed[0]).toBeCloseTo(18, 5) // 5 m/s
    expect(c.distance[2]).toBeCloseTo(0.011, 6) // 11 m from tacho_abs_meters
    expect(c.whUsed[2]).toBeCloseTo(1, 5)
    expect(c.soc[0]).toBeCloseTo(80, 4)
    expect(c.duty[0]).toBeCloseTo(50, 4)
    expect(c.currentIn[0]).toBe(16) // the setup (all controllers) value
    expect(c.lat[0]).toBeNaN() // no fix yet
    expect(c.lat[1]).toBeCloseTo(52.47, 6)
    expect(c.roll[1]).toBeCloseTo(30, 4)
    expect(c.roll[0]).toBeNaN()
    expect(c.fault[2]).toBe(4)
    expect(log.startedAt).toBe(new Date(2024, 2, 15, 14, 22, 1).getTime())
    expect(log.rateHz).toBe(10)
  })

  it('counts on across midnight and through a controller restart', () => {
    const text = [RT_HEADER, rtRow({ ms: 86_399_900, wh: 20 }), rtRow({ ms: 0, wh: 21 }), rtRow({ ms: 100, wh: 0.5 })].join('\n')
    const c = parseVescCsv(text, opts).data.cols
    expect([...c.t]).toEqual([0, 100, 200])
    expect(c.whUsed[2]).toBeCloseTo(1.5, 5)
  })

  it('falls back to the controller’s own values before the vehicle totals arrive', () => {
    const text = [RT_HEADER, rtRow({ ms: 1000, setup: -1 }), rtRow({ ms: 1100, setup: -1 })].join('\n')
    const log = parseVescCsv(text, opts)
    expect(log.data.cols.currentIn[0]).toBe(8)
    expect(log.notes.join(' ')).toMatch(/vehicle setup/)
  })
})

describe('VESC Tool log analysis files', () => {
  const H = 't_day:Time:s:0:0:1;kmh_vesc:Speed VESC:km/h:2:0:0;trip_vesc_abs:Trip VESC ABS:m:3:1:0;cnt_wh:Wh Used:Wh:3:1:0;gnss_lat:Latitude:°:6:0:0;gnss_lon:Longitude:°:6:0:0;custom_thing:Mine::2:0:0'

  it('repeats the last value for empty cells and skips rows that don’t match the header', () => {
    const text = [H, '100;10;500;3;0;0;1', '100.5;;510;3.2;52.5;13.4;1', '1;2', '101;12;;3.5;;;'].join('\n')
    const log = parseVescCsv(text, opts)
    expect(log.format).toBe('vesc-tool')
    expect(log.data.rows).toBe(3)
    const c = log.data.cols
    expect([...c.t]).toEqual([0, 500, 1000])
    expect(c.speed[1]).toBe(10)
    expect(c.speed[2]).toBe(12)
    expect(c.distance[2]).toBeCloseTo(0.01, 6)
    expect(c.whUsed[2]).toBeCloseTo(0.5, 5)
    expect(c.lat[0]).toBeNaN() // 0°, 0° is "no fix"
    expect(c.lat[2]).toBeCloseTo(52.5, 6)
    expect(log.skipped).toEqual(['custom_thing'])
  })

  it('refuses files that aren’t VESC Tool logs', () => {
    expect(() => parseVescCsv('time,seconds,Local Motor current (A)\n1,2,3', opts)).toThrow(LogFileError)
    expect(() => parseVescCsv(H, opts)).toThrow(/no rows/)
  })
})

function ride(rows: number, gps = true): RideData {
  const b = new RowBuffer()
  for (let i = 0; i < rows; i++) {
    const r = emptyRow()
    r.t = i * 100
    r.speed = 20 + Math.sin(i / 10) * 5
    r.distance = i * 0.0006
    r.vIn = 50 - i * 0.01
    r.currentIn = 10
    r.currentMotor = 25
    r.power = r.vIn * r.currentIn
    r.duty = 40
    r.erpm = 9000
    r.tempMotor = 40 + i * 0.1
    r.tempFet = 35
    r.soc = 80 - i * 0.01
    r.whUsed = i * 0.013
    r.whCharged = i * 0.001
    r.ahUsed = i * 0.0003
    r.ahCharged = 0
    r.fault = 0
    if (gps && i >= 3) {
      r.lat = 52.47 + i * 1e-5
      r.lon = 13.4 + i * 1e-5
      r.alt = 45
      r.gpsSpeed = 20
      r.gpsAccuracy = 4
    }
    r.roll = 5
    r.pitch = -2
    r.yaw = 90
    r.accX = 0.1
    r.accY = 0
    r.accZ = 1
    b.push(r)
  }
  return b.take()
}

describe('exports', () => {
  it('writes VESC Tool’s format and reads it back', () => {
    const d = ride(50)
    const start = Date.UTC(2026, 10, 7, 13, 0, 0)
    const csv = toVescCsv(d, start)
    const head = csv.split('\n')[0]
    expect(head.startsWith('t_day:Time:s:3:0:1;t_trip:Time of trip:s:3:1:1;kmh_vesc:Speed VESC:km/h')).toBe(true)
    expect(head).toContain('gnss_lat:Latitude:°:7:0:0')
    // Rows before the first fix take the first fix, marked as poor, not 0°, 0°.
    const firstRow = csv.split('\n')[1].split(';')
    const keys = head.split(';').map((h) => h.split(':')[0])
    expect(Number(firstRow[keys.indexOf('gnss_lat')])).toBeCloseTo(52.47003, 5)
    expect(firstRow[keys.indexOf('gnss_h_acc')]).toBe('999')

    const back = parseVescCsv(csv, { ...opts, lastModified: start + 10_000 }).data
    expect(back.rows).toBe(50)
    for (const k of ['t', 'speed', 'distance', 'vIn', 'currentIn', 'tempMotor', 'soc', 'whUsed', 'roll', 'accZ'] as const) {
      for (let i = 0; i < 50; i += 7) expect(back.cols[k][i]).toBeCloseTo(d.cols[k][i], 1)
    }
    // Power is whole watts, as VESC Tool writes it.
    expect(Math.abs(back.cols.power[3] - d.cols.power[3])).toBeLessThanOrEqual(0.5)
    expect(back.cols.lat[10]).toBeCloseTo(d.cols.lat[10], 6)
    expect(summarize(back).distanceKm).toBeCloseTo(summarize(d).distanceKm, 3)
  })

  it('leaves out GPS columns when a ride has no positions', () => {
    const csv = toVescCsv(ride(5, false), 0)
    expect(csv).not.toContain('gnss_lat')
    expect(() => toGpx(ride(5, false), 0, 'x')).toThrow(/no GPS/)
  })

  it('writes the GPS track as GPX, once per fix', () => {
    const d = ride(10)
    // Two rows on the same fix.
    d.cols.lat[6] = d.cols.lat[5]
    d.cols.lon[6] = d.cols.lon[5]
    const gpx = toGpx(d, Date.UTC(2026, 0, 1), 'Ride <one> & "two"')
    expect(gpx.match(/<trkpt /g)).toHaveLength(6)
    expect(gpx).toContain('<name>Ride &lt;one&gt; &amp; &quot;two&quot;</name>')
    expect(gpx).toContain('<time>2026-01-01T00:00:00.300Z</time>')
    expect(gpx).toMatch(/<gpxtpx:speed>[\d.]+<\/gpxtpx:speed>/)
  })
})

describe('ride summary', () => {
  it('adds up moving time, skipping gaps, and counts faults once each', () => {
    const b = new SummaryBuilder()
    const at = (t: number, speed: number, fault = 0) => b.add({ ...emptyRow(), t, speed, fault })
    at(0, 0)
    at(1000, 10)
    at(2000, 10)
    at(10_000, 10) // 8 s gap: the link dropped
    at(11_000, 0, 5)
    at(12_000, 0, 5)
    at(13_000, 0, 0)
    at(14_000, 0, 5)
    const s = b.get()
    expect(s.movingS).toBe(2)
    expect(s.durationS).toBe(14)
    expect(s.faults).toBe(2)
    expect(s.whPerKm).toBeNull() // too short to mean anything
  })

  it('measures the GPS track and its bounds', () => {
    const s = summarize(ride(20))
    expect(s.bounds![0]).toBeCloseTo(52.47003, 5)
    expect(s.gpsDistanceKm).toBeGreaterThan(0.015)
    expect(s.gpsDistanceKm).toBeLessThan(0.025)
    expect(s.maxTempMotor).toBeCloseTo(41.9, 4)
  })

  it('averages Wh per km over rides, weighted by distance', () => {
    const r = (km: number, wh: number) => ({ summary: { ...new SummaryBuilder().get(), distanceKm: km, whUsed: wh } })
    expect(averageWhPerKm([r(10, 200), r(30, 300), r(0.1, 50)])).toBeCloseTo(12.5, 6)
    expect(averageWhPerKm([r(0.1, 5)])).toBeNull()
  })
})

describe('row storage', () => {
  it('joins chunks and fills columns an older chunk lacks', () => {
    const a = ride(5)
    const b = ride(2)
    delete (b.cols as Partial<typeof b.cols>).accZ
    const j = joinChunks([a, b])
    expect(j.rows).toBe(7)
    expect(j.cols.accZ[4]).toBe(1)
    expect(j.cols.accZ[5]).toBeNaN()
    expect(hasGps(j)).toBe(true)
    expect(allocColumns(2).lat).toBeInstanceOf(Float64Array)
    expect(rateOf(j)).toBe(10)
  })

  it('reads dates from VESC Tool’s file names', () => {
    expect(dateFromFileName('logs/2025-12-31_23-59-58.csv')).toBe(new Date(2025, 11, 31, 23, 59, 58).getTime())
    expect(dateFromFileName('ride.csv')).toBeNull()
  })
})
