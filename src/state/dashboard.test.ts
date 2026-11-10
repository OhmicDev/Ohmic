import { beforeEach, describe, expect, it } from 'vitest'
import { emptyValues, type Values } from '../protocol/messages'
import { cleanLayout, DEFAULT_LAYOUT, fitColumns, packTiles, useDashLayout } from './dashboard'
import { useTelemetry } from './telemetry'

describe('dashboard layout', () => {
  beforeEach(() => useDashLayout.getState().reset())

  it('keeps only tiles this version knows, once each', () => {
    const l = cleanLayout({
      hero: 'nonsense' as never,
      tiles: [
        { id: 'power', wide: true },
        { id: 'gone' as never, wide: false },
        { id: 'power', wide: false },
        { id: 'duty', wide: 1 as never },
      ],
      show: { stats: false } as never,
    })
    expect(l.hero).toBe('speed')
    expect(l.tiles).toEqual([
      { id: 'power', wide: true },
      { id: 'duty', wide: false },
    ])
    expect(l.show).toEqual({ ...DEFAULT_LAYOUT.show, stats: false })
    expect(l.phone).toBe('fit')
    expect(l.fitCols).toBe('auto')
    expect(cleanLayout(undefined)).toEqual(DEFAULT_LAYOUT)
    expect(cleanLayout({ phone: 'scroll', fitCols: 3 })).toMatchObject({ phone: 'scroll', fitCols: 3 })
    expect(cleanLayout({ phone: 'big' as never, fitCols: 5 as never })).toMatchObject({ phone: 'fit', fitCols: 'auto' })
  })

  it('moves, resizes, adds and removes tiles', () => {
    const s = () => useDashLayout.getState()
    s().moveTile('fetTemp', 'power')
    expect(s().tiles[0].id).toBe('fetTemp')
    expect(s().tiles[1].id).toBe('power')
    s().nudgeTile('fetTemp', -1)
    expect(s().tiles[0].id).toBe('fetTemp')
    s().nudgeTile('fetTemp', 1)
    expect(s().tiles[1].id).toBe('fetTemp')
    s().toggleWide('duty')
    expect(s().tiles.find((t) => t.id === 'duty')?.wide).toBe(true)
    s().removeTile('duty')
    expect(s().tiles.some((t) => t.id === 'duty')).toBe(false)
    s().addTile('range')
    s().addTile('range')
    expect(s().tiles.filter((t) => t.id === 'range')).toHaveLength(1)
    expect(s().tiles[s().tiles.length - 1].id).toBe('range')
  })
})

describe('one-screen layout', () => {
  it('ends every row square', () => {
    // A wide tile that doesn't fit what's left of a row starts the next, and the tile before it fills the gap.
    expect(packTiles([1, 1, 2, 1], 3)).toEqual({ spans: [1, 2, 2, 1], rows: 2, stretched: 1 })
    // The last tile fills its row.
    expect(packTiles([1, 1, 1, 1], 3)).toEqual({ spans: [1, 1, 1, 3], rows: 2, stretched: 2 })
    expect(packTiles([1, 1, 1], 3)).toEqual({ spans: [1, 1, 1], rows: 1, stretched: 0 })
    // Never wider than the grid.
    expect(packTiles([2, 2], 2).spans).toEqual([2, 2])
    expect(packTiles([], 3)).toEqual({ spans: [], rows: 0, stretched: 0 })
  })

  it('picks three tiles a row when two would be cramped or leave a gap', () => {
    const nine = Array<number>(9).fill(1)
    // Two a row: 5 rows. Three a row: 3 rows, with no tile stretched.
    expect(fitColumns(nine, 600, 'auto')).toBe(3)
    expect(fitColumns(nine, 200, 'auto')).toBe(3)
    const eight = Array<number>(8).fill(1)
    // Two a row fill it exactly and there's room for them.
    expect(fitColumns(eight, 600, 'auto')).toBe(2)
    // Too short for four roomy rows.
    expect(fitColumns(eight, 250, 'auto')).toBe(3)
    // The rider's choice wins.
    expect(fitColumns(nine, 600, 2)).toBe(2)
    expect(fitColumns(eight, 600, 3)).toBe(3)
  })
})

describe('ride stats', () => {
  const v = (patch: Partial<Values>): Values => ({ ...emptyValues(), vIn: 50, ...patch })

  it('keeps peaks, energy both ways and the voltage range', () => {
    const t = useTelemetry.getState()
    t.clear()
    t.ingest([{ target: 'local', values: v({ wattHours: 10, wattHoursCharged: 1, ampHours: 0.2 }) }], 1000)
    t.ingest(
      [
        {
          target: 'local',
          values: v({ currentIn: 40, currentMotor: 90, vIn: 46, dutyNow: 0.6, rpm: 9000, wattHours: 12, wattHoursCharged: 1, ampHours: 0.2 }),
        },
      ],
      2000,
    )
    t.ingest(
      [{ target: 'local', values: v({ currentIn: -12, currentMotor: -30, vIn: 52, wattHours: 12, wattHoursCharged: 1.5, ampHours: 0.25 }) }],
      3000,
    )
    const trip = useTelemetry.getState().trip
    expect(trip.maxCurrentIn).toBe(40)
    expect(trip.minCurrentIn).toBe(-12)
    expect(trip.maxCurrentMotor).toBe(90)
    expect(trip.minCurrentMotor).toBe(-30)
    expect(trip.peakPower).toBe(46 * 40)
    expect(trip.peakRegenPower).toBe(52 * -12)
    expect(trip.minVIn).toBe(46)
    expect(trip.maxVIn).toBe(52)
    expect(trip.maxDuty).toBeCloseTo(0.6)
    expect(trip.maxErpm).toBe(9000)
    expect(trip.whUsed).toBeCloseTo(2)
    expect(trip.whCharged).toBeCloseTo(0.5)
    expect(trip.energyWh).toBeCloseTo(1.5)
    expect(trip.ahUsed).toBeCloseTo(0.05)
    expect(trip.seconds).toBeCloseTo(2)
  })

  it('carries energy over a controller restart', () => {
    const t = useTelemetry.getState()
    t.clear()
    t.ingest([{ target: 'local', values: v({ wattHours: 5 }) }], 1000)
    t.ingest([{ target: 'local', values: v({ wattHours: 8 }) }], 2000)
    // Restarted: its counters begin again from zero.
    t.ingest([{ target: 'local', values: v({ wattHours: 0 }) }], 3000)
    t.ingest([{ target: 'local', values: v({ wattHours: 2 }) }], 4000)
    expect(useTelemetry.getState().trip.whUsed).toBeCloseTo(5)
  })
})
