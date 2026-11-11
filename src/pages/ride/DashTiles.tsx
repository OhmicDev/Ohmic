// The dashboard's tiles. While arranging, a whole tile drags to move it (or moves
// with the arrow keys), a tap on it opens a sheet to change what it shows, and a
// dashed space at the end adds one.

import { Maximize2, Minimize2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cx } from '../../lib/format'
import { FIT_GAP, FIT_ROW_MIN, fitColumns, fitMinHeight, packTiles, TILE_IDS, useDashLayout, type TileId } from '../../state/dashboard'
import { useSession } from '../../state/session'
import { Button } from '../../ui/Primitives'
import { Sparkline } from '../../ui/Sparkline'
import { TweenNumber } from '../../ui/TweenNumber'
import { AddCell, AddTileDialog, ListActions, ReadingSheet } from './Customize'
import { editRing } from './pageInfo'
import { TILES, useTileCtx, type TileCtx, type Tone } from './tiles'
import { useDragMove, type DragMove } from './useDragMove'
import { WheelSpeeds } from './WheelSpeeds'

const toneText: Record<Tone, string> = {
  normal: 'text-text',
  warn: 'text-warn',
  danger: 'text-danger',
}
const toneColor: Record<Tone, string> = {
  normal: 'var(--accent)',
  warn: 'var(--color-warn)',
  danger: 'var(--color-danger)',
}

function useTileMove() {
  const ids = useDashLayout((s) => s.tiles).map((t) => t.id)
  const l = useDashLayout.getState()
  return useDragMove('data-tile', ids, l.moveTile, l.nudgeTile)
}

/** In edit mode the tile is one big button: drag it to move it, press it to change it. */
function EditableTile({
  id,
  drag,
  onPick,
  style,
  className,
  children,
}: {
  id: TileId
  drag: DragMove<TileId>
  onPick: (id: TileId) => void
  style?: CSSProperties
  className: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      data-tile={id}
      style={style}
      aria-label={`${TILES[id].label}. Drag to move it, or press to change it`}
      {...drag.handlers(id)}
      onClick={(e) => {
        // A press from the keyboard has no drag before it.
        if (e.detail === 0 || !drag.didMove()) onPick(id)
      }}
      className={cx(
        className,
        editRing,
        'focus-ring cursor-grab touch-none text-left transition-opacity select-none active:cursor-grabbing',
        drag.dragging === id && 'opacity-55',
      )}
    >
      {children}
    </button>
  )
}

export function TileGrid({ editing }: { editing: boolean }) {
  const ctx = useTileCtx()
  const tiles = useDashLayout((s) => s.tiles)
  const graphs = useDashLayout((s) => s.graphs)
  const drag = useTileMove()
  const [picked, setPicked] = useState<TileId | null>(null)
  const [adding, setAdding] = useState(false)
  if (!ctx) return null
  return (
    <>
    <div className="grid grid-cols-2 gap-2.5 md:gap-3 lg:grid-cols-4">
      {tiles.map(({ id, wide }) => {
        const box = cx('card relative flex min-w-0 flex-col overflow-hidden p-3.5 pb-0 md:p-4 md:pb-0', wide && 'col-span-2')
        const body = <TileBody id={id} wide={wide} ctx={ctx} graphs={graphs} />
        return editing ? (
          <EditableTile key={id} id={id} drag={drag} onPick={setPicked} className={box}>
            {body}
          </EditableTile>
        ) : (
          <div key={id} data-tile={id} className={box}>
            {body}
          </div>
        )
      })}
      {editing && tiles.length < TILE_IDS.length && <AddCell label="Add a tile" onClick={() => setAdding(true)} className="min-h-[120px]" />}
    </div>
      <TileSheet id={editing ? picked : null} onClose={() => setPicked(null)} />
      <AddTileDialog open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

function TileBody({ id, wide, ctx, graphs }: { id: TileId; wide: boolean; ctx: TileCtx; graphs: boolean }) {
  const def = TILES[id]
  const r = def.read(ctx)
  const tone = r.tone ?? 'normal'
  const Icon = def.icon
  const size = cx('num leading-none tracking-[-0.03em]', wide ? 'text-[36px] sm:text-[42px]' : 'text-[28px] sm:text-[34px]')
  return (
    <>
      <div className="flex min-h-5 items-center gap-1.5">
        <Icon className={cx('size-3.5 shrink-0', tone === 'normal' ? 'text-faint' : toneText[tone])} aria-hidden />
        <span className="label truncate">{def.label}</span>
      </div>
      <div className={cx('mt-2.5 flex min-w-0 items-baseline gap-1', toneText[tone])}>
        {r.text !== undefined ? <span className={size}>{r.text}</span> : <TweenNumber value={r.value} digits={r.digits} className={size} />}
        {r.unit && <span className="truncate text-[13px] font-medium text-muted">{r.unit}</span>}
      </div>
      <div className="num mt-1.5 min-h-4 truncate text-[11.5px] text-faint">{r.sub}</div>
      {graphs && def.spark ? (
        <Sparkline
          k={def.spark}
          color={toneColor[tone]}
          className="pointer-events-none -mx-3.5 mt-1 h-7 w-[calc(100%+28px)] opacity-80 md:-mx-4 md:h-8 md:w-[calc(100%+32px)]"
        />
      ) : (
        <div className="h-3.5 md:h-4" />
      )}
    </>
  )
}

/** Tiles for a phone: they share the height left over, and each shows more as it gets taller. */
export function FitTiles({ editing }: { editing: boolean }) {
  const ctx = useTileCtx()
  return ctx ? <FitGrid ctx={ctx} editing={editing} /> : null
}

function FitGrid({ ctx, editing }: { ctx: TileCtx; editing: boolean }) {
  const tiles = useDashLayout((s) => s.tiles)
  const graphs = useDashLayout((s) => s.graphs)
  const pref = useDashLayout((s) => s.fitCols)
  const showWheels = useDashLayout((s) => s.show.wheels)
  const motors = useSession((s) => s.devices.filter((d) => d.motor).length)
  const drag = useTileMove()
  const [picked, setPicked] = useState<TileId | null>(null)
  const [adding, setAdding] = useState(false)

  const grid = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = grid.current
    if (!el) return
    const read = () => {
      const r = el.getBoundingClientRect()
      const next = { width: Math.round(r.width), height: Math.round(r.height) }
      setBox((b) => (b.width === next.width && b.height === next.height ? b : next))
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The wheels take the last cell, or two with more than a pair of motors. While arranging, a space to add a tile comes after.
  const wheelSpan = showWheels && motors > 0 ? (motors > 2 ? 2 : 1) : 0
  const canAdd = editing && tiles.length < TILE_IDS.length
  const spans = [...tiles.map((t) => (t.wide ? 2 : 1)), ...(wheelSpan ? [wheelSpan] : []), ...(canAdd ? [1] : [])]
  const cols = fitColumns(spans, box.height, pref)
  const packed = packTiles(spans, cols)
  // Every row is the same height, so one measurement sizes every tile. Worked out here rather than
  // with CSS container queries, which made the browser restyle each tile on every new value.
  const rowHeight = packed.rows ? (box.height - (packed.rows - 1) * FIT_GAP) / packed.rows : 0
  const colWidth = (box.width - (cols - 1) * FIT_GAP) / cols
  const cell = (span: number): CellSize => ({ width: span * colWidth + (span - 1) * FIT_GAP, height: rowHeight })
  const addSpan = packed.spans[spans.length - 1]
  return (
    <>
      <div
        ref={grid}
        className="grid flex-1"
        style={{
          gap: FIT_GAP,
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridAutoRows: 'minmax(0, 1fr)',
          // Past this the tiles stop shrinking and the page scrolls instead.
          minHeight: Math.max(FIT_ROW_MIN, fitMinHeight(packed.rows)),
        }}
      >
        {spans.length === 0 && (
          <p className="col-span-full flex items-center justify-center rounded-2xl border border-dashed border-line-strong px-4 text-center text-sm text-muted">
            No tiles yet. Add some in Customize.
          </p>
        )}
        {tiles.map(({ id }, i) => (
          <FitTile key={id} id={id} span={packed.spans[i]} size={cell(packed.spans[i])} ctx={ctx} graphs={graphs} editing={editing} drag={drag} onPick={setPicked} />
        ))}
        {wheelSpan > 0 && <WheelSpeeds inline span={packed.spans[tiles.length]} cellHeight={rowHeight} />}
        {canAdd && (
          <AddCell
            label="Add a tile"
            onClick={() => setAdding(true)}
            className="[contain:size_layout]"
            style={addSpan > 1 ? { gridColumn: `span ${addSpan}` } : undefined}
          />
        )}
      </div>
      <TileSheet id={editing ? picked : null} onClose={() => setPicked(null)} />
      <AddTileDialog open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

interface CellSize {
  width: number
  height: number
}

/** What a phone tile has room for, from its outer size: the number's size, and which extras fit. */
function fitLook({ width, height }: CellSize) {
  // Inside the padding and border.
  const w = width - 22
  const h = height - 18
  const base = h >= 124 ? 42 : h >= 96 ? 33 : h >= 44 ? 27 : 22
  return {
    valuePx: Math.max(14, Math.min(base, w * (base === 42 ? 0.26 : 0.24))),
    icon: w >= 100,
    sub: h >= 56,
    graph: h >= 76,
  }
}

function FitTile({
  id,
  span,
  size,
  ctx,
  graphs,
  editing,
  drag,
  onPick,
}: {
  id: TileId
  /** Columns it takes. */
  span: number
  size: CellSize
  ctx: TileCtx
  graphs: boolean
  editing: boolean
  drag: DragMove<TileId>
  onPick: (id: TileId) => void
}) {
  const def = TILES[id]
  const r = def.read(ctx)
  const tone = r.tone ?? 'normal'
  const Icon = def.icon
  const look = fitLook(size)
  const style: CSSProperties | undefined = span > 1 ? { gridColumn: `span ${span}` } : undefined
  // Size containment: what a tile shows depends on its size, so its contents mustn't change that size,
  // or the grid could settle taller than the screen.
  const box = 'card relative flex min-w-0 flex-col justify-center gap-[3px] overflow-hidden px-2.5 py-2 text-left [contain:size_layout]'
  const value = 'num leading-none tracking-[-0.03em]'
  const valueStyle = { fontSize: look.valuePx }
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-1">
        {look.icon && <Icon className={cx('size-3 shrink-0', tone === 'normal' ? 'text-faint' : toneText[tone])} aria-hidden />}
        <span className="label truncate text-[9.5px]">{def.short ?? def.label}</span>
      </span>
      <span className={cx('flex min-w-0 items-baseline gap-1', toneText[tone])}>
        {r.text !== undefined ? (
          <span className={value} style={valueStyle}>
            {r.text}
          </span>
        ) : (
          <TweenNumber value={r.value} digits={r.digits} className={value} style={valueStyle} />
        )}
        {r.unit && <span className="truncate text-[11px] font-medium text-muted">{r.unit}</span>}
      </span>
      {look.sub && <span className="num truncate text-[10.5px] leading-tight text-faint">{r.sub}</span>}
      {/* In a tall tile the graph takes the room under the text. A tile without one keeps the gap, so a row's numbers line up. */}
      {graphs &&
        look.graph &&
        (def.spark ? (
          <Sparkline k={def.spark} color={toneColor[tone]} className="pointer-events-none -mx-2.5 mt-0.5 -mb-2 min-h-0 w-[calc(100%+20px)] flex-1 opacity-70" />
        ) : (
          <span className="flex-1" aria-hidden />
        ))}
    </>
  )
  if (!editing)
    return (
      <div data-tile={id} style={style} className={box}>
        {body}
      </div>
    )
  return (
    <EditableTile id={id} drag={drag} onPick={onPick} style={style} className={box}>
      {body}
    </EditableTile>
  )
}

/** What a press on a tile offers while arranging: what it shows, where it sits, its size. */
function TileSheet({ id, onClose }: { id: TileId | null; onClose: () => void }) {
  const tiles = useDashLayout((s) => s.tiles)
  const at = tiles.findIndex((t) => t.id === id)
  const slot = at < 0 ? null : tiles[at]
  const l = useDashLayout.getState()
  if (!slot) return null
  return (
    <ReadingSheet
      open
      onClose={onClose}
      title="Tile"
      options={TILE_IDS}
      value={slot.id}
      onPick={(to) => l.setTile(slot.id, to)}
      actions={
        <ListActions
          first={at === 0}
          last={at === tiles.length - 1}
          onMove={(by) => l.nudgeTile(slot.id, by)}
          onRemove={() => {
            l.removeTile(slot.id)
            onClose()
          }}
          extra={
            <Button className="h-11" onClick={() => l.toggleWide(slot.id)}>
              {slot.wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              {slot.wide ? 'Make narrow' : 'Make wide'}
            </Button>
          }
        />
      }
    />
  )
}
