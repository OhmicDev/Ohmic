// How the rider has arranged the Ride dashboard: what the big reading shows,
// which tiles appear and in what order, and which sections are shown.
// Kept in this browser only.

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const TILE_IDS = [
  'power',
  'batteryCurrent',
  'motorCurrent',
  'duty',
  'motorSpeed',
  'voltage',
  'motorTemp',
  'fetTemp',
  'speed',
  'battery',
  'range',
  'efficiency',
  'energy',
  'regen',
  'distance',
  'rideTime',
  'avgSpeed',
  'topSpeed',
] as const
export type TileId = (typeof TILE_IDS)[number]

export type HeroId = 'speed' | 'power' | 'battery'

export interface TileSlot {
  id: TileId
  /** Takes two columns. */
  wide: boolean
}

export const SECTION_IDS = ['battery', 'controls', 'trip', 'stats', 'wheels'] as const
export type SectionId = (typeof SECTION_IDS)[number]

/** On a phone: everything on one screen, or a page to scroll. */
export type PhoneLayout = 'fit' | 'scroll'
/** Tiles per row on the one-screen layout. Auto picks two or three to suit the room. */
export type FitCols = 'auto' | 2 | 3

export interface DashLayout {
  hero: HeroId
  tiles: TileSlot[]
  /** A small chart of the last minute under each tile. */
  graphs: boolean
  show: Record<SectionId, boolean>
  phone: PhoneLayout
  fitCols: FitCols
}

export const DEFAULT_LAYOUT: DashLayout = {
  hero: 'speed',
  tiles: (['power', 'batteryCurrent', 'motorCurrent', 'duty', 'motorSpeed', 'voltage', 'motorTemp', 'fetTemp'] as const).map((id) => ({
    id,
    wide: false,
  })),
  graphs: true,
  show: {
    battery: true,
    controls: true,
    trip: true,
    stats: true,
    wheels: true,
  },
  phone: 'fit',
  fitCols: 'auto',
}

interface DashStore extends DashLayout {
  setHero: (hero: HeroId) => void
  addTile: (id: TileId) => void
  removeTile: (id: TileId) => void
  /** Puts `id` where `over` is, shifting the rest along. */
  moveTile: (id: TileId, over: TileId) => void
  /** Moves a tile one place earlier (-1) or later (+1). */
  nudgeTile: (id: TileId, by: -1 | 1) => void
  toggleWide: (id: TileId) => void
  setGraphs: (on: boolean) => void
  setShown: (section: SectionId, on: boolean) => void
  setPhone: (phone: PhoneLayout) => void
  setFitCols: (fitCols: FitCols) => void
  reset: () => void
}

const isTile = (id: unknown): id is TileId => TILE_IDS.includes(id as TileId)

/** Keeps a stored layout to what this version knows: unknown or repeated tiles are dropped. */
export function cleanLayout(saved: Partial<DashLayout> | undefined): DashLayout {
  const seen = new Set<TileId>()
  const tiles = Array.isArray(saved?.tiles)
    ? saved.tiles
        .filter((t): t is TileSlot => !!t && isTile(t.id) && !seen.has(t.id) && !!seen.add(t.id))
        .map((t) => ({ id: t.id, wide: t.wide === true }))
    : DEFAULT_LAYOUT.tiles
  const hero = saved?.hero === 'power' || saved?.hero === 'battery' ? saved.hero : 'speed'
  const show = { ...DEFAULT_LAYOUT.show }
  for (const k of SECTION_IDS) if (typeof saved?.show?.[k] === 'boolean') show[k] = saved.show[k]
  return {
    hero,
    tiles,
    graphs: saved?.graphs !== false,
    show,
    phone: saved?.phone === 'scroll' ? 'scroll' : 'fit',
    fitCols: saved?.fitCols === 2 || saved?.fitCols === 3 ? saved.fitCols : 'auto',
  }
}

/** A one-screen tile is never shorter than this. */
export const FIT_ROW_MIN = 54
/** Tall enough for the small print under the number. */
const FIT_ROW_ROOMY = 72
export const FIT_GAP = 8

const rowsHeight = (rows: number, each: number) => (rows ? rows * each + (rows - 1) * FIT_GAP : 0)

/**
 * Lays cells of these widths out in order on a grid of `cols` columns, so that every row ends square:
 * when a cell doesn't fit the room left in a row, it starts the next one and the cell before it
 * widens to fill the gap. The last cell fills its row the same way. `stretched` counts the columns added.
 */
export function packTiles(spans: number[], cols: number): { spans: number[]; rows: number; stretched: number } {
  const out: number[] = []
  let rows = 0
  let free = 0
  let stretched = 0
  const fill = () => {
    if (!out.length) return
    out[out.length - 1] += free
    stretched += free
  }
  for (const span of spans) {
    const w = Math.min(span, cols)
    if (w > free) {
      fill()
      rows++
      free = cols
    }
    out.push(w)
    free -= w
  }
  fill()
  return { spans: out, rows, stretched }
}

/**
 * Columns for the one-screen layout with `height` px for its tiles. Three when two would make the
 * rows too short for the small print, or when three fill the grid without stretching any tile and two don't.
 */
export function fitColumns(spans: number[], height: number, pref: FitCols): 2 | 3 {
  if (pref !== 'auto') return pref
  const two = packTiles(spans, 2)
  const three = packTiles(spans, 3)
  if (three.rows === two.rows) return 2
  if (rowsHeight(two.rows, FIT_ROW_ROOMY) > height) return 3
  return two.stretched > 0 && three.stretched === 0 ? 3 : 2
}

/** The least height the one-screen tiles need; past it the page scrolls. */
export const fitMinHeight = (rows: number) => rowsHeight(rows, FIT_ROW_MIN)

export const useDashLayout = create<DashStore>()(
  persist(
    (set) => ({
      ...DEFAULT_LAYOUT,
      setHero: (hero) => set({ hero }),
      addTile: (id) => set((s) => (s.tiles.some((t) => t.id === id) ? s : { tiles: [...s.tiles, { id, wide: false }] })),
      removeTile: (id) => set((s) => ({ tiles: s.tiles.filter((t) => t.id !== id) })),
      moveTile: (id, over) =>
        set((s) => {
          const from = s.tiles.findIndex((t) => t.id === id)
          const to = s.tiles.findIndex((t) => t.id === over)
          if (from < 0 || to < 0 || from === to) return s
          const tiles = [...s.tiles]
          tiles.splice(to, 0, ...tiles.splice(from, 1))
          return { tiles }
        }),
      nudgeTile: (id, by) =>
        set((s) => {
          const from = s.tiles.findIndex((t) => t.id === id)
          const to = from + by
          if (from < 0 || to < 0 || to >= s.tiles.length) return s
          const tiles = [...s.tiles]
          tiles.splice(to, 0, ...tiles.splice(from, 1))
          return { tiles }
        }),
      toggleWide: (id) =>
        set((s) => ({
          tiles: s.tiles.map((t) => (t.id === id ? { ...t, wide: !t.wide } : t)),
        })),
      setGraphs: (graphs) => set({ graphs }),
      setShown: (section, on) => set((s) => ({ show: { ...s.show, [section]: on } })),
      setPhone: (phone) => set({ phone }),
      setFitCols: (fitCols) => set({ fitCols }),
      reset: () => set({ ...DEFAULT_LAYOUT }),
    }),
    {
      name: 'ohmic.dashboard',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ hero, tiles, graphs, show, phone, fitCols }) => ({ hero, tiles, graphs, show, phone, fitCols }),
      merge: (persisted, current) => ({
        ...current,
        ...cleanLayout(persisted as Partial<DashLayout> | undefined),
      }),
    },
  ),
)
