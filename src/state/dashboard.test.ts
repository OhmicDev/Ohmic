import { beforeEach, describe, expect, it } from 'vitest'
import { emptyValues, type Values } from '../protocol/messages'
import { cleanLayout, DEFAULT_LAYOUT, fitColumns, packTiles, setSlot, splitGauges, useDashLayout } from './dashboard'
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
    expect(l.fitCols).toBe('auto')
    expect(cleanLayout(undefined)).toEqual(DEFAULT_LAYOUT)
    expect(cleanLayout({ fitCols: 3 })).toMatchObject({ fitCols: 3 })
    expect(cleanLayout({ fitCols: 5 as never })).toMatchObject({ fitCols: 'auto' })
  })

  it('keeps pages, dials and readings this version knows', () => {
    const l = cleanLayout({
      pages: ['focus', 'nope' as never, 'focus', 'gauges'],
      page: 'tiles',
      gauges: {
        center: 'range' as never,
        under: 'power',
        small: ['duty', 'distance' as never, 'duty', 'voltage', 'power', 'battery', 'fetTemp', 'motorTemp', 'efficiency'],
        strip: ['range', 'range', 'gone' as never],
      },
      focus: { big: 'duty' as never, small: ['power'] },
    })
    expect(l.pages).toEqual(['focus', 'gauges'])
    // The page last shown is gone, so the first one shows.
    expect(l.page).toBe('focus')
    // Range has no dial to sweep.
    expect(l.gauges.center).toBe('speed')
    expect(l.gauges.under).toBe('power')
    expect(l.gauges.small).toEqual(['duty', 'voltage', 'power', 'battery', 'fetTemp', 'motorTemp'])
    expect(l.gauges.strip).toEqual(['range'])
    expect(l.focus).toEqual({ big: 'speed', small: ['power'] })
    // No pages at all would leave nothing to show.
    expect(cleanLayout({ pages: [] }).pages).toEqual(DEFAULT_LAYOUT.pages)
  })

  it('turns pages on and off, keeping one', () => {
    const s = () => useDashLayout.getState()
    s().setPage('focus')
    s().showPage('focus', false)
    expect(s().pages).toEqual(['gauges', 'tiles'])
    expect(s().page).toBe('gauges')
    s().showPage('tiles', false)
    s().showPage('gauges', false)
    expect(s().pages).toEqual(['gauges'])
    s().showPage('focus', true)
    s().nudgePage('focus', -1)
    expect(s().pages).toEqual(['focus', 'gauges'])
    // A page that's off can't be shown.
    s().setPage('tiles')
    expect(s().page).toBe('gauges')
  })

  it('changes, adds and moves dials without showing one twice', () => {
    const s = () => useDashLayout.getState()
    const small = [...s().gauges.small]
    // Picking a dial that's already shown swaps the two.
    s().setGauge(0, small[2])
    expect(s().gauges.small.slice(0, 3)).toEqual([small[2], small[1], small[0]])
    s().removeGauge(small[1])
    s().addGauge('voltage')
    s().addGauge('voltage')
    expect(s().gauges.small.filter((g) => g === 'voltage')).toHaveLength(1)
    s().addGauge('motorSpeed')
    expect(s().gauges.small).toHaveLength(6)
    s().moveGauge('voltage', small[2])
    expect(s().gauges.small[0]).toBe('voltage')
    s().setStrip(0, 'range')
    expect(s().gauges.strip).toEqual(['range', 'rideTime', 'distance'])
    s().nudgeStrip('range', 1)
    expect(s().gauges.strip[1]).toBe('range')
  })

  it('swaps a tile for another', () => {
    const s = () => useDashLayout.getState()
    s().setTile('power', 'range')
    expect(s().tiles[0].id).toBe('range')
    // Already a tile: the two trade places.
    s().setTile('range', 'duty')
    expect(s().tiles[0].id).toBe('duty')
    expect(s().tiles[3].id).toBe('range')
  })

  it('splits the small dials above and below the big one', () => {
    expect(splitGauges([1, 2, 3])).toEqual({ top: [], bottom: [1, 2, 3] })
    expect(splitGauges([1, 2, 3, 4])).toEqual({ top: [1, 2], bottom: [3, 4] })
    expect(splitGauges([1, 2, 3, 4, 5])).toEqual({ top: [1, 2, 3], bottom: [4, 5] })
    expect(setSlot(['a', 'b'], 5, 'c')).toEqual(['a', 'b'])
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
