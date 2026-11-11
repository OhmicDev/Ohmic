// The Focus page, for riding: one huge number, power as a bar that fills right
// for drive and left for regen, the battery, and a few small readings.

import { useState } from 'react'
import { cx, fmt } from '../../lib/format'
import { MAX_FOCUS, TILE_IDS, useDashLayout, type HeroId, type TileId } from '../../state/dashboard'
import { TweenNumber } from '../../ui/TweenNumber'
import { AddCell, ListActions, ReadingSheet } from './Customize'
import { GAUGE_READ, useDashLimits, type GaugeCtx } from './gauges'
import { editRing } from './pageInfo'
import { BatteryLine } from './TilesPage'
import { HERO_IDS, heroReading, readingText, TILES, useTileCtx, type Tone } from './tiles'
import { useDragMove } from './useDragMove'

type Pick = { kind: 'big' } | { kind: 'small'; id: TileId } | { kind: 'add' }

/** The most characters each big reading takes ("100", "-12.3"), so the number fits across and doesn't jump in size as it changes. */
const WIDEST: Record<HeroId, number> = { speed: 3, power: 4.6, battery: 3 }

const toneText: Record<Tone, string> = { normal: '', warn: 'text-warn', danger: 'text-danger' }

export function FocusPage({ editing, phone }: { editing: boolean; phone: boolean }) {
  const ctx = useTileCtx()
  const limits = useDashLimits()
  const f = useDashLayout((s) => s.focus)
  const showBattery = useDashLayout((s) => s.show.battery)
  const [pick, setPick] = useState<Pick | null>(null)
  const l = useDashLayout.getState()
  const drag = useDragMove('data-focus', f.small, l.moveFocusSmall, l.nudgeFocusSmall)
  if (!ctx) return null
  const gctx: GaugeCtx = { ...ctx, limits }
  const big = heroReading(f.big, ctx)
  const add = editing && f.small.length < MAX_FOCUS
  const n = f.small.length + (add ? 1 : 0)

  const number = (
    <>
      <span className="label">{big.label}</span>
      <TweenNumber
        value={big.value}
        digits={big.digits}
        ms={260}
        className={cx('readout num mt-1 leading-[0.84]', toneText[big.tone])}
        style={{
          // As big as the height allows, and no wider than the card (a digit is about 0.6 of the size).
          fontSize: phone
            ? `max(64px, min(26svh, calc((100vw - 72px) / ${WIDEST[f.big] * 0.6})))`
            : `max(120px, min(32vh, calc((min(100vw, 1200px) - 160px) / ${WIDEST[f.big] * 0.75}), 300px))`,
        }}
      />
      <span className="mt-2 text-lg font-medium text-muted md:text-xl">{big.unit}</span>
    </>
  )
  const numberBox = 'relative flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl'

  return (
    <section aria-label="Focus" className={cx('card relative flex flex-col overflow-hidden', phone ? 'h-full min-h-0 p-4' : 'h-[min(540px,60vh)] min-h-[360px] p-6')}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(60% 50% at 50% 40%, color-mix(in oklab, var(--accent) 8%, transparent), transparent 72%)' }}
      />
      {editing ? (
        <button
          type="button"
          aria-label={`Big reading: ${big.label}. Press to change it`}
          onClick={() => setPick({ kind: 'big' })}
          className={cx('focus-ring', numberBox, editRing)}
        >
          {number}
        </button>
      ) : (
        <div className={numberBox}>{number}</div>
      )}

      <div className={cx('relative mx-auto w-full space-y-3', !phone && 'max-w-3xl')}>
        <PowerBar ctx={gctx} />
        {showBattery && <BatteryLine dash={ctx.dash} percent={f.big !== 'battery'} />}
      </div>

      {n > 0 && (
        <div
          className={cx('relative mt-3 grid shrink-0 border-t border-line pt-3', !phone && 'mx-auto w-full max-w-3xl')}
          style={{ gridTemplateColumns: `repeat(${n}, minmax(0,1fr))` }}
        >
          {f.small.map((id, i) => {
            const def = TILES[id]
            const read = def.read(ctx)
            const r = readingText(read)
            const body = (
              <>
                <span className="label block truncate text-[9.5px]">{def.short ?? def.label}</span>
                <span className={cx('num mt-1 block truncate text-lg md:text-2xl', toneText[read.tone ?? 'normal'])}>
                  {r.value}
                  {r.unit && <span className="ml-1 text-[11px] text-muted md:text-xs">{r.unit}</span>}
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
                data-focus={id}
                aria-label={`${def.label}. Drag to move it, or press to change it`}
                {...drag.handlers(id)}
                onClick={(e) => {
                  if (e.detail === 0 || !drag.didMove()) setPick({ kind: 'small', id })
                }}
                className={cx(box, editRing, 'focus-ring cursor-grab touch-none rounded-lg select-none', drag.dragging === id && 'opacity-55')}
              >
                {body}
              </button>
            )
          })}
          {add && <AddCell label="Add a reading" onClick={() => setPick({ kind: 'add' })} className="ml-1 min-h-12 rounded-lg" />}
        </div>
      )}

      {pick && <FocusSheet pick={pick} onClose={() => setPick(null)} />}
    </section>
  )
}

/** Drive fills to the right of the mark, regen to the left, on the same scale as the power dial. */
function PowerBar({ ctx }: { ctx: GaugeCtx }) {
  const r = GAUGE_READ.power(ctx)
  const v = r.value ?? 0
  const regen = v < -0.05
  const drive = v > 0 ? Math.min(1, v / r.max) : 0
  const back = v < 0 ? Math.min(1, v / r.min) : 0
  return (
    <div role="img" aria-label={`Power ${fmt(v, 2)} kilowatts`}>
      <div className="flex items-baseline justify-between">
        <span className="label">Power</span>
        <span className={cx('num text-[15px] font-medium', regen && 'text-regen')}>
          {fmt(Math.abs(v), 1)} <span className="text-xs text-muted">{regen ? 'kW in' : 'kW'}</span>
        </span>
      </div>
      <div className="mt-1.5 flex h-2 gap-[3px]">
        <div className="relative flex-1 overflow-hidden rounded-full bg-surface-3">
          <div className="absolute inset-0 origin-right bg-regen transition-transform duration-200 ease-out" style={{ transform: `scaleX(${back})` }} />
        </div>
        <div className="relative flex-[3] overflow-hidden rounded-full bg-surface-3">
          <div className="absolute inset-0 origin-left bg-accent transition-transform duration-200 ease-out" style={{ transform: `scaleX(${drive})` }} />
        </div>
      </div>
    </div>
  )
}

function FocusSheet({ pick, onClose }: { pick: Pick; onClose: () => void }) {
  const f = useDashLayout((s) => s.focus)
  const l = useDashLayout.getState()
  const common = { open: true, onClose }
  if (pick.kind === 'big') return <ReadingSheet {...common} title="Big reading" options={HERO_IDS} value={f.big} onPick={(id) => l.setFocusBig(id)} />
  if (pick.kind === 'add')
    return <ReadingSheet {...common} title="Add a reading" options={TILE_IDS.filter((id) => !f.small.includes(id))} value={null} onPick={(id) => l.addFocusSmall(id)} />
  const i = f.small.indexOf(pick.id)
  if (i < 0) return null
  return (
    <ReadingSheet
      {...common}
      title="Reading"
      options={TILE_IDS}
      value={pick.id}
      onPick={(id) => l.setFocusSmall(i, id)}
      actions={
        <ListActions
          first={i === 0}
          last={i === f.small.length - 1}
          onMove={(by) => l.nudgeFocusSmall(pick.id, by)}
          onRemove={() => {
            l.removeFocusSmall(i)
            onClose()
          }}
        />
      }
    />
  )
}
