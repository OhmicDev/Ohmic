import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_VEHICLE } from '../lib/vehicle'
import { emptyValues, type Values } from '../protocol/messages'
import { emptyImu } from '../protocol/imu'
import { addLiveViewer, imuWanted, MAX_PLOTTED, plotKey, useLiveView } from '../state/live'
import { buildCsv } from './csv'
import { plotPanes } from './plot'
import { DeviceLog } from './recorder'
import { SIGNAL_INDEX, SIGNALS } from './signals'

const idx = (id: string) => SIGNAL_INDEX.get(id)!
const row = (patch: Partial<Values>, imu = false) => ({
  values: { ...emptyValues(), ...patch },
  imu: imu ? { ...emptyImu(), roll: Math.PI / 6 } : null,
  vehicle: DEFAULT_VEHICLE,
})

describe('recorder', () => {
  it('keeps rows in order, slices by time and tracks min and max', () => {
    const log = new DeviceLog(8)
    for (let i = 0; i < 5; i++) log.push(1000 + i * 100, row({ currentMotor: i * 10 - 20, vIn: 50 }))
    expect(log.size).toBe(5)
    expect(log.latest(idx('currentMotor'))).toBe(20)
    expect(log.min[idx('currentMotor')]).toBe(-20)
    expect(log.max[idx('currentMotor')]).toBe(20)
    // Derived signals come out of the same row.
    expect(log.latest(idx('power'))).toBe(0)

    const s = log.slice(1100, 1300, [idx('currentMotor')])
    expect(s.t).toEqual([1.1, 1.2, 1.3])
    expect(s.cols[0]).toEqual([-10, 0, 10])

    log.resetMinMax()
    expect(log.min[idx('currentMotor')]).toBe(Infinity)
    log.push(1500, row({ currentMotor: 3 }))
    expect(log.min[idx('currentMotor')]).toBe(3)
    expect(log.max[idx('currentMotor')]).toBe(3)
  })

  it('wraps around when full and keeps only the newest rows', () => {
    const log = new DeviceLog(4)
    for (let i = 0; i < 10; i++) log.push(i * 100, row({ vIn: i }))
    expect(log.size).toBe(4)
    expect(log.t[log.index(0)]).toBe(600)
    expect(log.lastTime()).toBe(900)
    expect(log.slice(0, 2000, [idx('vIn')]).cols[0]).toEqual([6, 7, 8, 9])
    expect(log.firstAtOrAfter(750)).toBe(2)
  })

  it('measures the update rate and skips missing IMU values', () => {
    const log = new DeviceLog(64)
    for (let i = 0; i <= 20; i++) log.push(i * 100, row({}, i === 5))
    expect(log.rate(2000)).toBeCloseTo(10, 5)
    // IMU read only once: missing rows are NaN, the last real reading still shows.
    expect(Number.isNaN(log.latest(idx('roll')))).toBe(true)
    expect(log.latestFinite(idx('roll'))).toBeCloseTo(30, 5)
    expect(log.slice(400, 600, [idx('roll')]).cols[0].map((v) => (v === null ? null : Math.round(v)))).toEqual([null, 30, null])
  })
})

describe('CSV export', () => {
  it('lines up controllers by time, in display units, with blanks for missing values', () => {
    const local = new DeviceLog(16)
    const can2 = new DeviceLog(16)
    local.push(1000, row({ currentMotor: 12.345, tempFet: 30 }))
    can2.push(1000, row({ currentMotor: 11 }))
    local.push(1100, row({ currentMotor: 13, tempFet: 31 }))
    const logs = new Map([
      ['local', local],
      ['can2', can2],
    ])
    const csv = buildCsv(
      logs,
      [
        { target: 'local', deviceLabel: 'Local', signal: idx('currentMotor') },
        { target: 'can2', deviceLabel: 'CAN 2', signal: idx('currentMotor') },
        { target: 'local', deviceLabel: 'Local', signal: idx('tempFet') },
      ],
      0,
      5000,
      'imperial',
    )
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('time,seconds,Local Motor current (A),CAN 2 Motor current (A),Local Controller (°F)')
    expect(lines[1]).toBe(`${new Date(1000).toISOString()},0.000,12.345,11,86`)
    expect(lines[2]).toBe(`${new Date(1100).toISOString()},0.100,13,,87.8`)
  })

  it('keeps only the asked time range', () => {
    const log = new DeviceLog(16)
    for (let i = 0; i < 6; i++) log.push(i * 1000, row({ vIn: 40 + i }))
    const csv = buildCsv(new Map([['local', log]]), [{ target: 'local', deviceLabel: 'Local', signal: idx('vIn') }], 2000, 3000, 'metric')
    expect(csv.trim().split('\n').slice(1).map((l) => l.split(',').at(-1))).toEqual(['42', '43'])
  })
})

describe('plotting', () => {
  beforeEach(() => {
    useLiveView.setState({ plotted: [], seeded: false, pausedAt: null, zoom: null, device: null })
  })

  it('gives each unit its own pane, never two measures on one axis', () => {
    const panes = plotPanes(
      [
        { key: plotKey('local', 'currentMotor'), slot: 0 },
        { key: plotKey('local', 'vIn'), slot: 1 },
        { key: plotKey('can2', 'currentMotor'), slot: 2 },
        { key: plotKey('local', 'tachometer'), slot: 3 },
      ],
      'metric',
      (t) => t.toUpperCase(),
    )
    expect(panes.map((p) => p.unit)).toEqual(['A', 'V', 'count'])
    expect(panes[0].series.map((s) => s.deviceLabel)).toEqual(['LOCAL', 'CAN2'])
  })

  it('keeps colours with their signal and stops at the limit', () => {
    const v = () => useLiveView.getState()
    for (const s of SIGNALS.slice(0, MAX_PLOTTED + 2)) v().toggle(plotKey('local', s.id))
    expect(v().plotted).toHaveLength(MAX_PLOTTED)
    // Removing one frees its colour; the others keep theirs.
    v().toggle(plotKey('local', SIGNALS[2].id))
    expect(v().plotted.find((p) => p.key === plotKey('local', SIGNALS[3].id))?.slot).toBe(3)
    v().toggle(plotKey('can2', 'vIn'))
    expect(v().plotted.find((p) => p.key === plotKey('can2', 'vIn'))?.slot).toBe(2)
  })

  it('fills in a default plot once, and zooming freezes the view until back to live', () => {
    const v = () => useLiveView.getState()
    v().seed('local')
    expect(v().plotted.map((p) => p.key)).toEqual(['local:currentMotor', 'local:currentIn'])
    v().clearPlot()
    v().seed('local')
    expect(v().plotted).toEqual([])

    v().setZoom([1000, 2000])
    expect(v().pausedAt).not.toBeNull()
    v().resume()
    expect(v().zoom).toBeNull()
    expect(v().pausedAt).toBeNull()
  })

  it('asks for IMU data only while the Live screen is open', () => {
    useLiveView.setState({ device: 'local', plotted: [{ key: plotKey('can2', 'pitch'), slot: 0 }] })
    expect(imuWanted().size).toBe(0)
    const close = addLiveViewer()
    expect([...imuWanted()].sort()).toEqual(['can2', 'local'])
    close()
    close()
    expect(imuWanted().size).toBe(0)
  })
})
