// The dashboard's tiles, and the panel for arranging them. In edit mode each
// tile gets a handle to drag it (or move it with the arrow keys), a size button
// and a remove button. The one-screen phone layout has no room for those: there
// the whole tile drags, and a tap opens its options.

import { ArrowLeft, ArrowRight, Check, GripVertical, Maximize2, Minimize2, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { cx, fmt } from '../../lib/format'
import {
  FIT_GAP,
  FIT_ROW_MIN,
  fitColumns,
  fitMinHeight,
  packTiles,
  SECTION_IDS,
  TILE_IDS,
  useDashLayout,
  type FitCols,
  type HeroId,
  type PhoneLayout,
  type SectionId,
  type TileId,
} from '../../state/dashboard'
import { useSession } from '../../state/session'
import { useSettings } from '../../state/settings'
import { useTelemetry } from '../../state/telemetry'
import { Dialog } from '../../ui/Dialog'
import { Button, Segmented } from '../../ui/Primitives'
import { Sparkline } from '../../ui/Sparkline'
import { TweenNumber } from '../../ui/TweenNumber'
import { TILES, type TileCtx, type Tone } from './tiles'
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

function useTileCtx(): TileCtx | null {
  const dash = useTelemetry((s) => s.dash)
  const trip = useTelemetry((s) => s.trip)
  const units = useSettings((s) => s.units)
  const vehicle = useSettings((s) => s.vehicle)
  return dash ? { dash, trip, units, vehicle } : null
}

type TileDrag = ReturnType<typeof useTileDrag>

/** Dragging a tile over another puts it there. The handlers go on whatever is dragged: a handle, or the whole tile. */
function useTileDrag() {
  const [dragging, setDragging] = useState<TileId | null>(null)
  // The tile last moved onto. While the pointer rests on it nothing more moves, or tiles of
  // different widths would swap back and forth.
  const last = useRef<string | null>(null)
  const moved = useRef(false)
  const end = () => setDragging(null)
  return {
    dragging,
    /** Whether the last press moved a tile, so the click that ends a drag can be told from a tap. */
    didMove: () => moved.current,
    handlers: (id: TileId) => ({
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        last.current = null
        moved.current = false
        setDragging(id)
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        if (dragging !== id) return
        const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-tile]')?.dataset.tile
        if (!over || over === id) {
          last.current = null
          return
        }
        if (over === last.current || !TILE_IDS.includes(over as TileId)) return
        last.current = over
        moved.current = true
        useDashLayout.getState().moveTile(id, over as TileId)
      },
      onPointerUp: end,
      onPointerCancel: end,
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        const by = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0
        if (!by) return
        e.preventDefault()
        useDashLayout.getState().nudgeTile(id, by)
      },
    }),
  }
}

export function TileGrid({ editing }: { editing: boolean }) {
  const ctx = useTileCtx()
  const tiles = useDashLayout((s) => s.tiles)
  const graphs = useDashLayout((s) => s.graphs)
  const drag = useTileDrag()
  if (!ctx) return null
  return (
    <div className="grid grid-cols-2 gap-2.5 md:gap-3 lg:grid-cols-4">
      {tiles.map(({ id, wide }) => (
        <Tile key={id} id={id} wide={wide} ctx={ctx} graphs={graphs} editing={editing} drag={drag} />
      ))}
    </div>
  )
}

function Tile({ id, wide, ctx, graphs, editing, drag }: { id: TileId; wide: boolean; ctx: TileCtx; graphs: boolean; editing: boolean; drag: TileDrag }) {
  const def = TILES[id]
  const r = def.read(ctx)
  const tone = r.tone ?? 'normal'
  const Icon = def.icon
  const layout = useDashLayout.getState()
  return (
    <div
      data-tile={id}
      className={cx(
        'card relative flex min-w-0 flex-col overflow-hidden p-3.5 pb-0 transition-[box-shadow,opacity] md:p-4 md:pb-0',
        wide && 'col-span-2',
        editing && 'shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_35%,transparent)]',
        drag.dragging === id && 'opacity-70 shadow-[inset_0_0_0_2px_var(--accent)]',
      )}
    >
      <div className="flex min-h-5 items-center gap-1.5">
        {editing ? (
          <button
            aria-label={`Move ${def.label}. Drag, or use the arrow keys`}
            {...drag.handlers(id)}
            className="focus-ring -m-1.5 flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted hover:text-text active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </button>
        ) : (
          <Icon className={cx('size-3.5 shrink-0', tone === 'normal' ? 'text-faint' : toneText[tone])} aria-hidden />
        )}
        <span className="label truncate">{def.label}</span>
        {editing && (
          <span className="-my-1.5 -mr-1.5 ml-auto flex shrink-0">
            <button
              aria-label={wide ? `Make ${def.label} narrow` : `Make ${def.label} wide`}
              onClick={() => layout.toggleWide(id)}
              className="focus-ring flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-text"
            >
              {wide ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </button>
            <button
              aria-label={`Remove ${def.label}`}
              onClick={() => layout.removeTile(id)}
              className="focus-ring flex size-8 items-center justify-center rounded-lg text-muted hover:bg-danger/15 hover:text-danger"
            >
              <X className="size-4" />
            </button>
          </span>
        )}
      </div>
      <div className={cx('mt-2.5 flex min-w-0 items-baseline gap-1', toneText[tone])}>
        {r.text !== undefined ? (
          <span className={cx('num leading-none tracking-[-0.03em]', wide ? 'text-[36px] sm:text-[42px]' : 'text-[28px] sm:text-[34px]')}>
            {r.text}
          </span>
        ) : (
          <TweenNumber
            value={r.value}
            digits={r.digits}
            className={cx('num leading-none tracking-[-0.03em]', wide ? 'text-[36px] sm:text-[42px]' : 'text-[28px] sm:text-[34px]')}
          />
        )}
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
    </div>
  )
}

/** Tiles for the one-screen phone layout: they share the height left over, and each shows more as it gets taller. */
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
  const drag = useTileDrag()
  const [picked, setPicked] = useState<TileId | null>(null)

  const grid = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const el = grid.current
    if (!el) return
    const read = () => setHeight(Math.round(el.getBoundingClientRect().height))
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The wheels take the last cell, or two with more than a pair of motors.
  const wheelSpan = showWheels && motors > 0 ? (motors > 2 ? 2 : 1) : 0
  const spans = [...tiles.map((t) => (t.wide ? 2 : 1)), ...(wheelSpan ? [wheelSpan] : [])]
  const cols = fitColumns(spans, height, pref)
  const packed = packTiles(spans, cols)
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
          <FitTile key={id} id={id} span={packed.spans[i]} ctx={ctx} graphs={graphs} editing={editing} drag={drag} onPick={setPicked} />
        ))}
        {wheelSpan > 0 && <WheelSpeeds inline span={packed.spans[tiles.length]} />}
      </div>
      <TileOptions id={editing ? picked : null} onClose={() => setPicked(null)} />
    </>
  )
}

function FitTile({
  id,
  span,
  ctx,
  graphs,
  editing,
  drag,
  onPick,
}: {
  id: TileId
  /** Columns it takes. */
  span: number
  ctx: TileCtx
  graphs: boolean
  editing: boolean
  drag: TileDrag
  onPick: (id: TileId) => void
}) {
  const def = TILES[id]
  const r = def.read(ctx)
  const tone = r.tone ?? 'normal'
  const Icon = def.icon
  const style: CSSProperties | undefined = span > 1 ? { gridColumn: `span ${span}` } : undefined
  const box = 'card fit-tile relative flex min-w-0 flex-col justify-center gap-[3px] overflow-hidden px-2.5 py-2 text-left'
  const value = 'fit-value num leading-none tracking-[-0.03em]'
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-1">
        <Icon className={cx('fit-icon size-3 shrink-0', tone === 'normal' ? 'text-faint' : toneText[tone])} aria-hidden />
        <span className="label truncate text-[9.5px]">{def.short ?? def.label}</span>
      </span>
      <span className={cx('flex min-w-0 items-baseline gap-1', toneText[tone])}>
        {r.text !== undefined ? <span className={value}>{r.text}</span> : <TweenNumber value={r.value} digits={r.digits} className={value} />}
        {r.unit && <span className="truncate text-[11px] font-medium text-muted">{r.unit}</span>}
      </span>
      <span className="fit-sub num truncate text-[10.5px] leading-tight text-faint">{r.sub}</span>
      {/* In a tall tile the graph takes the room under the text. A tile without one keeps the gap, so a row's numbers line up. */}
      {graphs &&
        (def.spark ? (
          <Sparkline
            k={def.spark}
            color={toneColor[tone]}
            className="fit-spark pointer-events-none -mx-2.5 mt-0.5 -mb-2 min-h-0 w-[calc(100%+20px)] flex-1 opacity-70"
          />
        ) : (
          <span className="fit-spark flex-1" aria-hidden />
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
    <button
      type="button"
      data-tile={id}
      style={style}
      aria-label={`${def.label}. Drag to move it, or press for more`}
      {...drag.handlers(id)}
      onClick={(e) => {
        // A press from the keyboard has no drag before it.
        if (e.detail === 0 || !drag.didMove()) onPick(id)
      }}
      className={cx(
        box,
        'focus-ring cursor-grab touch-none shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_40%,transparent)] transition-opacity select-none active:cursor-grabbing',
        drag.dragging === id && 'opacity-60',
      )}
    >
      {body}
      <GripVertical className="absolute top-1.5 right-1 size-3.5 text-muted" aria-hidden />
    </button>
  )
}

/** What a tap on a tile offers while the one-screen layout is being arranged. */
function TileOptions({ id, onClose }: { id: TileId | null; onClose: () => void }) {
  const tiles = useDashLayout((s) => s.tiles)
  const at = tiles.findIndex((t) => t.id === id)
  const slot = at < 0 ? null : tiles[at]
  const l = useDashLayout.getState()
  return (
    <Dialog
      open={!!slot}
      onClose={onClose}
      size="sm"
      title={slot ? TILES[slot.id].label : ''}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {slot && (
        <div className="grid grid-cols-2 gap-2">
          <Button className="h-11" disabled={at === 0} onClick={() => l.nudgeTile(slot.id, -1)}>
            <ArrowLeft className="size-4" /> Earlier
          </Button>
          <Button className="h-11" disabled={at === tiles.length - 1} onClick={() => l.nudgeTile(slot.id, 1)}>
            Later <ArrowRight className="size-4" />
          </Button>
          <Button className="h-11" onClick={() => l.toggleWide(slot.id)}>
            {slot.wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            {slot.wide ? 'Make narrow' : 'Make wide'}
          </Button>
          <Button
            variant="danger"
            className="h-11"
            onClick={() => {
              l.removeTile(slot.id)
              onClose()
            }}
          >
            <Trash2 className="size-4" /> Remove
          </Button>
        </div>
      )}
    </Dialog>
  )
}

const HEROES: { value: HeroId; label: string }[] = [
  { value: 'speed', label: 'Speed' },
  { value: 'power', label: 'Power' },
  { value: 'battery', label: 'Battery' },
]

const PHONE_LAYOUTS: { value: PhoneLayout; label: string }[] = [
  { value: 'fit', label: 'One screen' },
  { value: 'scroll', label: 'Scrolling' },
]

const FIT_COLS: { value: FitCols; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
]

const SECTION_LABELS: Record<SectionId, string> = {
  battery: 'Battery',
  controls: 'Controls',
  trip: 'Trip bar',
  stats: 'Stats',
  wheels: 'Wheels',
}

/** Shown above the dashboard while it's being arranged. On a phone it also picks between one screen and a page to scroll. */
export function CustomizePanel({ onDone, phone = false }: { onDone: () => void; phone?: boolean }) {
  const hero = useDashLayout((s) => s.hero)
  const show = useDashLayout((s) => s.show)
  const graphs = useDashLayout((s) => s.graphs)
  const phoneLayout = useDashLayout((s) => s.phone)
  const fitCols = useDashLayout((s) => s.fitCols)
  const [adding, setAdding] = useState(false)
  const l = useDashLayout.getState()
  const fit = phone && phoneLayout === 'fit'
  return (
    <section className="card space-y-4 p-4 md:p-5" aria-label="Customize the dashboard">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold">Customize</h2>
        <span className="ml-auto flex gap-1.5">
          <Button variant="ghost" className="h-9 px-2.5" onClick={() => l.reset()}>
            <RotateCcw className="size-3.5" /> Reset
          </Button>
          <Button variant="primary" className="h-9" onClick={onDone}>
            <Check className="size-4" /> Done
          </Button>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        {phone && (
          <div>
            <div className="label mb-1.5">Layout</div>
            <Segmented<PhoneLayout> label="Layout" value={phoneLayout} onChange={(p) => l.setPhone(p)} options={PHONE_LAYOUTS} />
          </div>
        )}
        {fit && (
          <div>
            <div className="label mb-1.5">Tiles per row</div>
            <Segmented<FitCols> label="Tiles per row" value={fitCols} onChange={(c) => l.setFitCols(c)} options={FIT_COLS} />
          </div>
        )}
        <div>
          <div className="label mb-1.5">Big reading</div>
          <Segmented<HeroId> label="Big reading" value={hero} onChange={(h) => l.setHero(h)} options={HEROES} />
        </div>
        <div className="min-w-0">
          <div className="label mb-1.5">Show</div>
          <div className="flex flex-wrap gap-1.5">
            {SECTION_IDS.map((k) => (
              <Chip key={k} on={show[k]} onChange={(on) => l.setShown(k, on)}>
                {SECTION_LABELS[k]}
              </Chip>
            ))}
            <Chip on={graphs} onChange={(on) => l.setGraphs(on)}>
              Graphs
            </Chip>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Add tile
        </Button>
        <span className="flex items-center gap-1 text-xs text-faint">
          <GripVertical className="size-3.5" /> {fit ? 'drag a tile to move it, tap it for more' : 'drag to reorder'}
        </span>
      </div>
      <AddTileDialog open={adding} onClose={() => setAdding(false)} />
    </section>
  )
}

function Chip({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cx(
        'focus-ring inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors',
        on ? 'border-accent/45 bg-accent/12 text-text' : 'border-line-strong text-muted hover:text-text',
      )}
    >
      <span className={cx('size-1.5 rounded-full', on ? 'bg-accent' : 'bg-faint/50')} aria-hidden />
      {children}
    </button>
  )
}

function AddTileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tiles = useDashLayout((s) => s.tiles)
  const ctx = useTileCtx()
  const hidden = TILE_IDS.filter((id) => !tiles.some((t) => t.id === id))
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a tile"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {hidden.length === 0 ? (
        <p className="text-sm text-muted">Every tile is on the dashboard.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {hidden.map((id) => {
            const def = TILES[id]
            const r = ctx ? def.read(ctx) : null
            const Icon = def.icon
            return (
              <button
                key={id}
                onClick={() => useDashLayout.getState().addTile(id)}
                className="focus-ring flex min-w-0 flex-col items-start gap-2 rounded-xl border border-line-strong bg-surface-2 p-3 text-left transition-colors hover:border-accent/50"
              >
                <span className="flex w-full items-center gap-1.5">
                  <Icon className="size-3.5 text-faint" aria-hidden />
                  <span className="label truncate">{def.label}</span>
                  <Plus className="ml-auto size-4 text-accent" aria-hidden />
                </span>
                <span className="num truncate text-lg">
                  {r ? (r.text ?? fmt(r.value, r.digits)) : '—'}
                  {r?.unit && <span className="ml-1 text-xs text-muted">{r.unit}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </Dialog>
  )
}
