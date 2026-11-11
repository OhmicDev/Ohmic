// How the rider has arranged the Ride dashboard: which pages it has and in what
// order, what each gauge and tile shows, and which sections are shown.
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

/** Readings that make sense on a dial: each has a range to sweep. */
export const GAUGE_IDS = [
  'speed',
  'power',
  'batteryCurrent',
  'motorCurrent',
  'duty',
  'battery',
  'voltage',
  'motorTemp',
  'fetTemp',
  'efficiency',
  'motorSpeed',
] as const satisfies readonly TileId[]
export type GaugeId = (typeof GAUGE_IDS)[number]

/** The dashboard's pages, swiped between on a phone. */
export const PAGE_IDS = ['gauges', 'tiles', 'focus'] as const
export type PageId = (typeof PAGE_IDS)[number]

export type HeroId = 'speed' | 'power' | 'battery'
/** What sits in the open bottom of the big gauge. */
export type UnderId = 'battery' | 'power' | 'none'
/** Tiles per row on a phone. Auto picks two or three to suit the room. */
export type FitCols = 'auto' | 2 | 3

export interface TileSlot {
  id: TileId
  /** Takes two columns. */
  wide: boolean
}

export const SECTION_IDS = ['battery', 'controls', 'trip', 'stats', 'wheels'] as const
export type SectionId = (typeof SECTION_IDS)[number]

export const MAX_GAUGES = 6
export const MAX_STRIP = 4
export const MAX_FOCUS = 4

export interface DashLayout {
  pages: PageId[]
  /** The page last shown. */
  page: PageId
  gauges: {
    center: GaugeId
    under: UnderId
    /** The small dials, in order: the first half above the big one, the rest below. */
    small: GaugeId[]
    /** Readings along the bottom. */
    strip: TileId[]
  }
  focus: { big: HeroId; small: TileId[] }
  hero: HeroId
  tiles: TileSlot[]
  /** A small chart of the last minute under each tile. */
  graphs: boolean
  fitCols: FitCols
  show: Record<SectionId, boolean>
}

export const DEFAULT_LAYOUT: DashLayout = {
  pages: ['gauges', 'tiles', 'focus'],
  page: 'gauges',
  gauges: {
    center: 'speed',
    under: 'battery',
    small: ['batteryCurrent', 'power', 'duty', 'fetTemp', 'efficiency', 'motorTemp'],
    strip: ['distance', 'rideTime', 'range'],
  },
  focus: { big: 'speed', small: ['power', 'batteryCurrent', 'motorTemp'] },
  hero: 'speed',
  tiles: (['power', 'batteryCurrent', 'motorCurrent', 'duty', 'motorSpeed', 'voltage', 'motorTemp', 'fetTemp'] as const).map((id) => ({
    id,
    wide: false,
  })),
  graphs: true,
  fitCols: 'auto',
  show: {
    battery: true,
    controls: true,
    trip: true,
    stats: true,
    wheels: true,
  },
}

/** Puts the item `id` where `over` is, shifting the rest along. */
export function moveOver<T>(list: T[], key: (t: T) => string, id: string, over: string): T[] {
  const from = list.findIndex((t) => key(t) === id)
  const to = list.findIndex((t) => key(t) === over)
  if (from < 0 || to < 0 || from === to) return list
  const out = [...list]
  out.splice(to, 0, ...out.splice(from, 1))
  return out
}

/** Moves the item `id` one place earlier (-1) or later (+1). */
export function nudge<T>(list: T[], key: (t: T) => string, id: string, by: -1 | 1): T[] {
  const from = list.findIndex((t) => key(t) === id)
  const to = from + by
  if (from < 0 || to < 0 || to >= list.length) return list
  const out = [...list]
  out.splice(to, 0, ...out.splice(from, 1))
  return out
}

/** Sets slot `i` to `id`. A reading already in another slot swaps into this one's place, so none shows twice. */
export function setSlot<T>(list: T[], i: number, id: T): T[] {
  if (i < 0 || i >= list.length) return list
  const out = [...list]
  const was = out.indexOf(id)
  if (was >= 0 && was !== i) out[was] = out[i]
  out[i] = id
  return out
}

const same = <T>(t: T) => String(t)

interface DashStore extends DashLayout {
  setPage: (page: PageId) => void
  /** Turns a page on or off. The last page can't be turned off. */
  showPage: (page: PageId, on: boolean) => void
  nudgePage: (page: PageId, by: -1 | 1) => void

  setCenter: (id: GaugeId) => void
  setUnder: (under: UnderId) => void
  setGauge: (i: number, id: GaugeId) => void
  addGauge: (id: GaugeId) => void
  removeGauge: (id: GaugeId) => void
  moveGauge: (id: GaugeId, over: GaugeId) => void
  nudgeGauge: (id: GaugeId, by: -1 | 1) => void
  setStrip: (i: number, id: TileId) => void
  addStrip: (id: TileId) => void
  removeStrip: (i: number) => void
  moveStrip: (id: TileId, over: TileId) => void
  nudgeStrip: (id: TileId, by: -1 | 1) => void

  setFocusBig: (id: HeroId) => void
  setFocusSmall: (i: number, id: TileId) => void
  addFocusSmall: (id: TileId) => void
  removeFocusSmall: (i: number) => void
  moveFocusSmall: (id: TileId, over: TileId) => void
  nudgeFocusSmall: (id: TileId, by: -1 | 1) => void

  setHero: (hero: HeroId) => void
  addTile: (id: TileId) => void
  /** Shows `to` where `id` is. If `to` is already a tile, the two swap places. */
  setTile: (id: TileId, to: TileId) => void
  removeTile: (id: TileId) => void
  /** Puts `id` where `over` is, shifting the rest along. */
  moveTile: (id: TileId, over: TileId) => void
  /** Moves a tile one place earlier (-1) or later (+1). */
  nudgeTile: (id: TileId, by: -1 | 1) => void
  toggleWide: (id: TileId) => void
  setGraphs: (on: boolean) => void
  setFitCols: (fitCols: FitCols) => void
  setShown: (section: SectionId, on: boolean) => void
  reset: () => void
}

const isIn =
  <T extends string>(ids: readonly T[]) =>
  (v: unknown): v is T =>
    ids.includes(v as T)
const isTile = isIn(TILE_IDS)
const isGauge = isIn(GAUGE_IDS)
const isPage = isIn(PAGE_IDS)
const isHero = isIn(['speed', 'power', 'battery'] as const)
const isUnder = isIn(['battery', 'power', 'none'] as const)

/** Each known value once, in order, at most `max`. */
function cleanList<T>(saved: unknown, ok: (v: unknown) => v is T, max: number, fallback: T[], unique = true): T[] {
  if (!Array.isArray(saved)) return fallback
  const out: T[] = []
  for (const v of saved) if (ok(v) && !(unique && out.includes(v)) && out.length < max) out.push(v)
  return out
}

type Saved = Partial<Omit<DashLayout, 'gauges' | 'focus'>> & {
  gauges?: Partial<DashLayout['gauges']>
  focus?: Partial<DashLayout['focus']>
}

/** Keeps a stored layout to what this version knows: unknown or repeated entries are dropped. */
export function cleanLayout(saved: Saved | undefined): DashLayout {
  const d = DEFAULT_LAYOUT
  const seen = new Set<TileId>()
  const tiles = Array.isArray(saved?.tiles)
    ? saved.tiles
        .filter((t): t is TileSlot => !!t && isTile(t.id) && !seen.has(t.id) && !!seen.add(t.id))
        .map((t) => ({ id: t.id, wide: t.wide === true }))
    : d.tiles
  const pages = cleanList(saved?.pages, isPage, PAGE_IDS.length, d.pages)
  if (!pages.length) pages.push(...d.pages)
  const show = { ...d.show }
  for (const k of SECTION_IDS) if (typeof saved?.show?.[k] === 'boolean') show[k] = saved.show[k]
  const g = saved?.gauges
  const f = saved?.focus
  return {
    pages,
    page: isPage(saved?.page) && pages.includes(saved.page) ? saved.page : pages[0],
    gauges: {
      center: isGauge(g?.center) ? g.center : d.gauges.center,
      under: isUnder(g?.under) ? g.under : d.gauges.under,
      small: cleanList(g?.small, isGauge, MAX_GAUGES, d.gauges.small),
      strip: cleanList(g?.strip, isTile, MAX_STRIP, d.gauges.strip),
    },
    focus: {
      big: isHero(f?.big) ? f.big : d.focus.big,
      small: cleanList(f?.small, isTile, MAX_FOCUS, d.focus.small),
    },
    hero: isHero(saved?.hero) ? saved.hero : d.hero,
    tiles,
    graphs: saved?.graphs !== false,
    fitCols: saved?.fitCols === 2 || saved?.fitCols === 3 ? saved.fitCols : 'auto',
    show,
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

/** The small dials above the big one and below it: none above until there are more than three. */
export function splitGauges<T>(small: T[]): { top: T[]; bottom: T[] } {
  if (small.length <= 3) return { top: [], bottom: small }
  const top = Math.ceil(small.length / 2)
  return { top: small.slice(0, top), bottom: small.slice(top) }
}

export const useDashLayout = create<DashStore>()(
  persist(
    (set) => {
      const gauges = (fn: (g: DashLayout['gauges']) => Partial<DashLayout['gauges']>) => set((s) => ({ gauges: { ...s.gauges, ...fn(s.gauges) } }))
      const focus = (fn: (f: DashLayout['focus']) => Partial<DashLayout['focus']>) => set((s) => ({ focus: { ...s.focus, ...fn(s.focus) } }))
      return {
        ...DEFAULT_LAYOUT,
        setPage: (page) => set((s) => (s.pages.includes(page) ? { page } : s)),
        showPage: (page, on) =>
          set((s) => {
            if (on) return s.pages.includes(page) ? s : { pages: [...s.pages, page] }
            if (s.pages.length <= 1) return s
            const pages = s.pages.filter((p) => p !== page)
            return { pages, page: s.page === page ? pages[0] : s.page }
          }),
        nudgePage: (page, by) => set((s) => ({ pages: nudge(s.pages, same, page, by) })),

        setCenter: (center) => gauges(() => ({ center })),
        setUnder: (under) => gauges(() => ({ under })),
        setGauge: (i, id) => gauges((g) => ({ small: setSlot(g.small, i, id) })),
        addGauge: (id) => gauges((g) => (g.small.length >= MAX_GAUGES || g.small.includes(id) ? {} : { small: [...g.small, id] })),
        removeGauge: (id) => gauges((g) => ({ small: g.small.filter((x) => x !== id) })),
        moveGauge: (id, over) => gauges((g) => ({ small: moveOver(g.small, same, id, over) })),
        nudgeGauge: (id, by) => gauges((g) => ({ small: nudge(g.small, same, id, by) })),
        setStrip: (i, id) => gauges((g) => ({ strip: setSlot(g.strip, i, id) })),
        addStrip: (id) => gauges((g) => (g.strip.length >= MAX_STRIP || g.strip.includes(id) ? {} : { strip: [...g.strip, id] })),
        removeStrip: (i) => gauges((g) => ({ strip: g.strip.filter((_, j) => j !== i) })),
        moveStrip: (id, over) => gauges((g) => ({ strip: moveOver(g.strip, same, id, over) })),
        nudgeStrip: (id, by) => gauges((g) => ({ strip: nudge(g.strip, same, id, by) })),

        setFocusBig: (big) => focus(() => ({ big })),
        setFocusSmall: (i, id) => focus((f) => ({ small: setSlot(f.small, i, id) })),
        addFocusSmall: (id) => focus((f) => (f.small.length >= MAX_FOCUS || f.small.includes(id) ? {} : { small: [...f.small, id] })),
        removeFocusSmall: (i) => focus((f) => ({ small: f.small.filter((_, j) => j !== i) })),
        moveFocusSmall: (id, over) => focus((f) => ({ small: moveOver(f.small, same, id, over) })),
        nudgeFocusSmall: (id, by) => focus((f) => ({ small: nudge(f.small, same, id, by) })),

        setHero: (hero) => set({ hero }),
        addTile: (id) => set((s) => (s.tiles.some((t) => t.id === id) ? s : { tiles: [...s.tiles, { id, wide: false }] })),
        setTile: (id, to) => set((s) => ({ tiles: s.tiles.map((t) => (t.id === id ? { ...t, id: to } : t.id === to ? { ...t, id } : t)) })),
        removeTile: (id) => set((s) => ({ tiles: s.tiles.filter((t) => t.id !== id) })),
        moveTile: (id, over) => set((s) => ({ tiles: moveOver(s.tiles, (t) => t.id, id, over) })),
        nudgeTile: (id, by) => set((s) => ({ tiles: nudge(s.tiles, (t) => t.id, id, by) })),
        toggleWide: (id) => set((s) => ({ tiles: s.tiles.map((t) => (t.id === id ? { ...t, wide: !t.wide } : t)) })),
        setGraphs: (graphs) => set({ graphs }),
        setFitCols: (fitCols) => set({ fitCols }),
        setShown: (section, on) => set((s) => ({ show: { ...s.show, [section]: on } })),
        reset: () => set({ ...DEFAULT_LAYOUT }),
      }
    },
    {
      name: 'ohmic.dashboard',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ pages, page, gauges, focus, hero, tiles, graphs, fitCols, show }) => ({
        pages,
        page,
        gauges,
        focus,
        hero,
        tiles,
        graphs,
        fitCols,
        show,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...cleanLayout(persisted as Saved | undefined),
      }),
    },
  ),
)
