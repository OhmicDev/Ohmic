// The Gauges page: a big dial in the middle with small ones around it and a strip
// of readings along the bottom. On a phone the small dials sit in rows above and
// below; on a wider screen, in columns either side. While arranging, a tap on
// any dial or reading changes it, a drag moves it, and the dashed spaces add one.

import { useState, type ReactNode } from 'react'
import { cx, fmt } from '../../lib/format'
import { convertDistance, unitLabels } from '../../lib/vehicle'
import { GAUGE_IDS, MAX_GAUGES, MAX_STRIP, splitGauges, TILE_IDS, useDashLayout, type GaugeId, type TileId, type UnderId } from '../../state/dashboard'
import { AddCell, ListActions, ReadingSheet } from './Customize'
import { Gauge } from './Gauge'
import { GAUGE_READ, useDashLimits, type GaugeCtx } from './gauges'
import { editRing } from './pageInfo'
import { readingText, TILES, useTileCtx } from './tiles'
import { useDragMove, type DragMove } from './useDragMove'

type Pick = { kind: 'center' } | { kind: 'gauge'; id: GaugeId } | { kind: 'addGauge' } | { kind: 'strip'; id: TileId } | { kind: 'addStrip' }
type Cell = GaugeId | 'add'

const glow = { background: 'radial-gradient(48% 44% at 50% 46%, color-mix(in oklab, var(--accent) 8%, transparent), transparent 72%)' }

export function GaugesPage({ editing, phone }: { editing: boolean; phone: boolean }) {
  const ctx = useTileCtx()
  const limits = useDashLimits()
  const g = useDashLayout((s) => s.gauges)
  const [pick, setPick] = useState<Pick | null>(null)
  const l = useDashLayout.getState()
  const drag = useDragMove('data-gauge', g.small, l.moveGauge, l.nudgeGauge)
  const stripDrag = useDragMove('data-strip', g.strip, l.moveStrip, l.nudgeStrip)
  if (!ctx) return null
  const gctx: GaugeCtx = { ...ctx, limits }

  const cells: Cell[] = editing && g.small.length < MAX_GAUGES ? [...g.small, 'add'] : g.small
  const cell = (c: Cell) =>
    c === 'add' ? (
      <AddCell key="add" label="Add a dial" onClick={() => setPick({ kind: 'addGauge' })} />
    ) : (
      <SmallGauge key={c} id={c} ctx={gctx} editing={editing} drag={drag} onPick={() => setPick({ kind: 'gauge', id: c })} />
    )

  const centerLabel = TILES[g.center].label
  const bigDial = (
    <Gauge
      reading={GAUGE_READ[g.center](gctx)}
      label={centerLabel}
      size="big"
      under={<Under kind={g.under} center={g.center} ctx={gctx} />}
      className="h-full w-full"
    />
  )
  const big = editing ? (
    <button
      type="button"
      aria-label={`Middle dial: ${centerLabel}. Press to change it`}
      onClick={() => setPick({ kind: 'center' })}
      className={cx('focus-ring min-h-0 min-w-0 rounded-2xl', editRing)}
    >
      {bigDial}
    </button>
  ) : (
    <div className="min-h-0 min-w-0">{bigDial}</div>
  )

  const strip = (
    <Strip
      ids={g.strip}
      ctx={gctx}
      editing={editing}
      drag={stripDrag}
      onPick={(id) => setPick({ kind: 'strip', id })}
      onAdd={() => setPick({ kind: 'addStrip' })}
    />
  )

  let dials: ReactNode
  if (phone) {
    const { top, bottom } = splitGauges(cells)
    const rows = top.length ? 'minmax(0,1fr) minmax(0,1.85fr) minmax(0,1fr)' : bottom.length ? 'minmax(0,2.3fr) minmax(0,1fr)' : 'minmax(0,1fr)'
    dials = (
      <div className="relative grid min-h-0 flex-1 gap-1.5" style={{ gridTemplateRows: rows }}>
        {top.length > 0 && <Row cells={top} render={cell} />}
        {big}
        {bottom.length > 0 && <Row cells={bottom} render={cell} />}
      </div>
    )
  } else {
    const half = Math.ceil(cells.length / 2)
    const left = cells.slice(0, half)
    const right = cells.slice(half)
    const per = Math.max(2, left.length)
    dials = (
      <div
        className="relative grid h-[min(540px,60vh)] min-h-[340px] gap-4 lg:gap-8"
        style={{ gridTemplateColumns: cells.length ? 'minmax(0,1fr) minmax(0,1.9fr) minmax(0,1fr)' : 'minmax(0,1fr)' }}
      >
        {cells.length > 0 && <Column cells={left} per={per} render={cell} />}
        {big}
        {cells.length > 0 && <Column cells={right} per={per} render={cell} />}
      </div>
    )
  }

  return (
    <section aria-label="Gauges" className={cx('card relative flex flex-col overflow-hidden', phone ? 'h-full min-h-0 p-2.5' : 'p-4 md:p-6')}>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={glow} />
      {dials}
      {strip}
      {pick && <GaugeSheet pick={pick} onClose={() => setPick(null)} />}
    </section>
  )
}

function Row({ cells, render }: { cells: Cell[]; render: (c: Cell) => ReactNode }) {
  return (
    <div className="grid min-h-0 gap-1.5" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0,1fr))` }}>
      {cells.map(render)}
    </div>
  )
}

function Column({ cells, per, render }: { cells: Cell[]; per: number; render: (c: Cell) => ReactNode }) {
  return (
    <div className="grid min-h-0 content-center gap-3" style={{ gridTemplateRows: `repeat(${per}, minmax(0,1fr))` }}>
      {cells.map(render)}
    </div>
  )
}

function SmallGauge({ id, ctx, editing, drag, onPick }: { id: GaugeId; ctx: GaugeCtx; editing: boolean; drag: DragMove<GaugeId>; onPick: () => void }) {
  const def = TILES[id]
  const dial = <Gauge reading={GAUGE_READ[id](ctx)} label={def.short ?? def.label} size="small" className="h-full w-full" />
  if (!editing)
    return (
      <div data-gauge={id} className="min-h-0 min-w-0">
        {dial}
      </div>
    )
  return (
    <button
      type="button"
      data-gauge={id}
      aria-label={`${def.label}. Drag to move it, or press to change it`}
      {...drag.handlers(id)}
      onClick={(e) => {
        // A press from the keyboard has no drag before it.
        if (e.detail === 0 || !drag.didMove()) onPick()
      }}
      className={cx(
        'focus-ring min-h-0 min-w-0 cursor-grab touch-none rounded-2xl transition-opacity select-none active:cursor-grabbing',
        editRing,
        drag.dragging === id && 'opacity-55',
      )}
    >
      {dial}
    </button>
  )
}

/** What sits in the open bottom of the big dial, drawn in its 200-wide coordinates. */
function Under({ kind, center, ctx }: { kind: UnderId; center: GaugeId; ctx: GaugeCtx }) {
  const { dash } = ctx
  if (kind === 'none' || kind === center) return null
  if (kind === 'battery') {
    const soc = Math.max(0, Math.min(100, dash.soc))
    const color = soc < 10 ? 'var(--color-danger)' : soc < 25 ? 'var(--color-warn)' : 'var(--accent)'
    const range = dash.rangeKm === null ? null : `${fmt(convertDistance(dash.rangeKm, ctx.units), 0)} ${unitLabels(ctx.units).distance}`
    return (
      <g role="img" aria-label={`Battery ${fmt(soc, 0)} percent`}>
        <path d="M70 164H130" fill="none" strokeWidth={5} strokeLinecap="round" className="stroke-surface-3" />
        <path
          d="M70 164H130"
          fill="none"
          strokeWidth={5}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${soc} 200`}
          style={{ stroke: color, transition: 'stroke-dasharray 300ms ease-out' }}
        />
        <text x={100} y={185} textAnchor="middle" fontSize={11.5} fontWeight={500} className="num fill-muted">
          {fmt(soc, 0)}%{range ? ` · ${range}` : ''}
        </text>
      </g>
    )
  }
  const r = GAUGE_READ.power(ctx)
  const v = r.value ?? 0
  const drive = v > 0 ? Math.min(1, v / r.max) : 0
  const regen = v < 0 ? Math.min(1, v / r.min) : 0
  // Regen gets a quarter of the bar, to the left of the mark; drive the rest.
  return (
    <g role="img" aria-label={`Power ${fmt(v, 2)} kilowatts`}>
      <path d="M66 164H134" fill="none" strokeWidth={5} strokeLinecap="round" className="stroke-surface-3" />
      <path
        d="M83 164H134"
        fill="none"
        strokeWidth={5}
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${drive * 100} 200`}
        className="stroke-accent"
        style={{ transition: 'stroke-dasharray 200ms ease-out' }}
      />
      <path
        d="M83 164H66"
        fill="none"
        strokeWidth={5}
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${regen * 100} 200`}
        className="stroke-regen"
        style={{ transition: 'stroke-dasharray 200ms ease-out' }}
      />
      <line x1={83} x2={83} y1={158} y2={170} strokeWidth={1.5} className="stroke-faint" />
      <text x={100} y={185} textAnchor="middle" fontSize={11.5} fontWeight={500} className={cx('num', v < -0.05 ? 'fill-regen' : 'fill-muted')}>
        {fmt(Math.abs(v), 1)} {v < -0.05 ? 'kW in' : 'kW'}
      </text>
    </g>
  )
}

function Strip({
  ids,
  ctx,
  editing,
  drag,
  onPick,
  onAdd,
}: {
  ids: TileId[]
  ctx: GaugeCtx
  editing: boolean
  drag: DragMove<TileId>
  onPick: (id: TileId) => void
  onAdd: () => void
}) {
  const add = editing && ids.length < MAX_STRIP
  const n = ids.length + (add ? 1 : 0)
  if (!n) return null
  return (
    <div className="relative mt-2 grid shrink-0 border-t border-line pt-2" style={{ gridTemplateColumns: `repeat(${n}, minmax(0,1fr))` }}>
      {ids.map((id, i) => {
        const def = TILES[id]
        const r = readingText(def.read(ctx))
        const body = (
          <>
            <span className="label block truncate text-[9.5px]">{def.short ?? def.label}</span>
            <span className="num mt-0.5 block truncate text-[15px] md:text-lg">
              {r.value}
              {r.unit && <span className="ml-1 text-[11px] text-muted">{r.unit}</span>}
            </span>
          </>
        )
        const box = cx('min-w-0 px-2 py-1 text-center', i > 0 && 'border-l border-line')
        if (!editing)
          return (
            <div key={id} className={box}>
              {body}
            </div>
          )
        return (
          <button
            key={id}
            type="button"
            data-strip={id}
            aria-label={`${def.label}. Drag to move it, or press to change it`}
            {...drag.handlers(id)}
            onClick={(e) => {
              if (e.detail === 0 || !drag.didMove()) onPick(id)
            }}
            className={cx(box, editRing, 'focus-ring cursor-grab touch-none rounded-lg select-none', drag.dragging === id && 'opacity-55')}
          >
            {body}
          </button>
        )
      })}
      {add && <AddCell label="Add a reading" onClick={onAdd} className="ml-1 min-h-11 rounded-lg" />}
    </div>
  )
}

/** Choosing what a dial or reading shows, with moving and removing it. */
function GaugeSheet({ pick, onClose }: { pick: Pick; onClose: () => void }) {
  const g = useDashLayout((s) => s.gauges)
  const l = useDashLayout.getState()
  const common = { open: true, onClose }
  switch (pick.kind) {
    case 'center':
      return (
        <ReadingSheet
          {...common}
          title="Middle dial"
          options={GAUGE_IDS}
          value={g.center}
          onPick={(id) => {
            // A dial already among the small ones trades places with the middle one.
            const i = g.small.indexOf(id)
            if (i >= 0) l.setGauge(i, g.center)
            l.setCenter(id)
          }}
        />
      )
    case 'gauge': {
      const i = g.small.indexOf(pick.id)
      if (i < 0) return null
      return (
        <ReadingSheet
          {...common}
          title="Dial"
          options={GAUGE_IDS.filter((id) => id !== g.center)}
          value={pick.id}
          onPick={(id) => l.setGauge(i, id)}
          actions={
            <ListActions
              first={i === 0}
              last={i === g.small.length - 1}
              onMove={(by) => l.nudgeGauge(pick.id, by)}
              onRemove={() => {
                l.removeGauge(pick.id)
                onClose()
              }}
            />
          }
        />
      )
    }
    case 'addGauge':
      return (
        <ReadingSheet
          {...common}
          title="Add a dial"
          options={GAUGE_IDS.filter((id) => id !== g.center && !g.small.includes(id))}
          value={null}
          onPick={(id) => l.addGauge(id)}
        />
      )
    case 'strip': {
      const i = g.strip.indexOf(pick.id)
      if (i < 0) return null
      return (
        <ReadingSheet
          {...common}
          title="Reading"
          options={TILE_IDS}
          value={pick.id}
          onPick={(id) => l.setStrip(i, id)}
          actions={
            <ListActions
              first={i === 0}
              last={i === g.strip.length - 1}
              onMove={(by) => l.nudgeStrip(pick.id, by)}
              onRemove={() => {
                l.removeStrip(i)
                onClose()
              }}
            />
          }
        />
      )
    }
    case 'addStrip':
      return <ReadingSheet {...common} title="Add a reading" options={TILE_IDS.filter((id) => !g.strip.includes(id))} value={null} onPick={(id) => l.addStrip(id)} />
  }
}
