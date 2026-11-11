// Arranging the dashboard. Most of it happens on the dashboard itself: in edit mode
// a tap on anything opens a sheet to change it, and a drag moves it. The Customize
// sheet holds the rest: which pages there are and in what order, each page's
// options, and what shows everywhere.

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Plus, RotateCcw, Trash2, type LucideIcon } from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { cx } from '../../lib/format'
import {
  MAX_GAUGES,
  PAGE_IDS,
  TILE_IDS,
  useDashLayout,
  type FitCols,
  type HeroId,
  type SectionId,
  type TileId,
  type UnderId,
} from '../../state/dashboard'
import { useSettings } from '../../state/settings'
import { Dialog } from '../../ui/Dialog'
import { Button, Segmented } from '../../ui/Primitives'
import { Toggle } from '../../ui/Toggle'
import { PAGES } from './pageInfo'
import { readingText, TILES, useTileCtx } from './tiles'

const HEROES: { value: HeroId; label: string }[] = [
  { value: 'speed', label: 'Speed' },
  { value: 'power', label: 'Power' },
  { value: 'battery', label: 'Battery' },
]

const UNDER: { value: UnderId; label: string }[] = [
  { value: 'battery', label: 'Battery' },
  { value: 'power', label: 'Power' },
  { value: 'none', label: 'Nothing' },
]

const FIT_COLS: { value: FitCols; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
]

/** A choice of readings, each with its live value. Used for every "change this" on the dashboard. */
export function ReadingSheet<T extends TileId>({
  open,
  title,
  options,
  value,
  onPick,
  onClose,
  actions,
}: {
  open: boolean
  title: string
  options: readonly T[]
  value: T | null
  onPick: (id: T) => void
  onClose: () => void
  /** Under the choices: moving or removing the thing being changed. */
  actions?: ReactNode
}) {
  const ctx = useTileCtx()
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-4">
        {options.length === 0 ? (
          <p className="text-sm text-muted">Every reading is already showing.</p>
        ) : (
          <div role="radiogroup" aria-label={title} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {options.map((id) => {
              const def = TILES[id]
              const r = ctx ? readingText(def.read(ctx)) : null
              const Icon = def.icon
              const on = id === value
              return (
                <button
                  key={id}
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    onPick(id)
                    onClose()
                  }}
                  className={cx(
                    'focus-ring flex min-w-0 flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors active:scale-[0.98]',
                    on ? 'border-accent/60 bg-accent/10' : 'border-line-strong bg-surface-2 hover:border-accent/40',
                  )}
                >
                  <span className="flex w-full items-center gap-1.5">
                    <Icon className={cx('size-3.5 shrink-0', on ? 'text-accent' : 'text-faint')} aria-hidden />
                    <span className="label truncate">{def.label}</span>
                  </span>
                  <span className="num truncate text-lg leading-tight">
                    {r?.value ?? '—'}
                    {r?.unit && <span className="ml-1 text-xs text-muted">{r.unit}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {actions && <div className="grid grid-cols-2 gap-2 border-t border-line pt-4">{actions}</div>}
      </div>
    </Dialog>
  )
}

/** The usual moves for something in a list: earlier, later, remove. `extra` goes before Remove. */
export function ListActions({
  first,
  last,
  onMove,
  onRemove,
  extra,
}: {
  first: boolean
  last: boolean
  onMove: (by: -1 | 1) => void
  onRemove: () => void
  extra?: ReactNode
}) {
  return (
    <>
      <Button className="h-11" disabled={first} onClick={() => onMove(-1)}>
        <ArrowLeft className="size-4" /> Earlier
      </Button>
      <Button className="h-11" disabled={last} onClick={() => onMove(1)}>
        Later <ArrowRight className="size-4" />
      </Button>
      {extra}
      <Button variant="danger" className="h-11" onClick={onRemove}>
        <Trash2 className="size-4" /> Remove
      </Button>
    </>
  )
}

/** A dashed space for adding one more, shown while arranging. */
export function AddCell({ label, onClick, className, style }: { label: string; onClick: () => void; className?: string; style?: CSSProperties }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={style}
      className={cx(
        'focus-ring flex min-h-0 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-line-strong text-muted transition-colors hover:border-accent/60 hover:text-accent active:scale-[0.98]',
        className,
      )}
    >
      <Plus className="size-5" />
      <span className="text-[11px] font-medium">Add</span>
    </button>
  )
}

const SECTION_LABELS: Partial<Record<SectionId, string>> = {
  battery: 'Battery',
  trip: 'Trip bar',
  wheels: 'Wheels',
}

/** Everything about the layout that isn't changed by tapping the dashboard itself. */
export function CustomizeSheet({ open, onClose, phone }: { open: boolean; onClose: () => void; phone: boolean }) {
  const l = useDashLayout()
  const keepAwake = useSettings((s) => s.keepAwake)
  const [adding, setAdding] = useState(false)
  const order = [...l.pages, ...PAGE_IDS.filter((p) => !l.pages.includes(p))]
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Customize"
      subtitle="Tap anything on the dashboard to change it, or drag it to move it."
      size="md"
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => l.reset()}>
            <RotateCcw className="size-4" /> Reset layout
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <Group title="Pages" note={phone ? 'Swipe between them on the dashboard.' : undefined}>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-2">
            {order.map((id) => {
              const p = PAGES[id]
              const on = l.pages.includes(id)
              const at = l.pages.indexOf(id)
              return (
                <li key={id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-lg', on ? 'bg-accent/15 text-accent' : 'bg-surface-3 text-faint')}>
                    <p.icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cx('block text-sm font-semibold', !on && 'text-muted')}>{p.label}</span>
                    <span className="block truncate text-xs text-muted">{p.about}</span>
                  </span>
                  {on && (
                    <span className="flex">
                      <IconButton label={`Move ${p.label} earlier`} disabled={at === 0} onClick={() => l.nudgePage(id, -1)} icon={ArrowUp} />
                      <IconButton label={`Move ${p.label} later`} disabled={at === l.pages.length - 1} onClick={() => l.nudgePage(id, 1)} icon={ArrowDown} />
                    </span>
                  )}
                  <Toggle label={`Show the ${p.label} page`} checked={on} disabled={on && l.pages.length === 1} onChange={(v) => l.showPage(id, v)} />
                </li>
              )
            })}
          </ul>
        </Group>

        {l.pages.includes('gauges') && (
          <Group title="Gauges">
            <Field label="Under the middle dial">
              <Segmented<UnderId> label="Under the middle dial" value={l.gauges.under} onChange={(u) => l.setUnder(u)} options={UNDER} />
            </Field>
            <p className="text-xs text-muted">
              {l.gauges.small.length} of {MAX_GAUGES} small dials. Add, change or move them on the page.
            </p>
          </Group>
        )}

        {l.pages.includes('tiles') && (
          <Group title="Tiles">
            <div className="flex flex-wrap gap-x-6 gap-y-4">
              <Field label="Big reading">
                <Segmented<HeroId> label="Big reading" value={l.hero} onChange={(h) => l.setHero(h)} options={HEROES} />
              </Field>
              {phone && (
                <Field label="Tiles per row">
                  <Segmented<FitCols> label="Tiles per row" value={l.fitCols} onChange={(c) => l.setFitCols(c)} options={FIT_COLS} />
                </Field>
              )}
            </div>
            <Field label="Show">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(SECTION_LABELS) as SectionId[]).map((k) => (
                  <Chip key={k} on={l.show[k]} onChange={(on) => l.setShown(k, on)}>
                    {SECTION_LABELS[k]!}
                  </Chip>
                ))}
                <Chip on={l.graphs} onChange={(on) => l.setGraphs(on)}>
                  Graphs
                </Chip>
              </div>
            </Field>
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add a tile
            </Button>
          </Group>
        )}

        {l.pages.includes('focus') && (
          <Group title="Focus">
            <Field label="Big reading">
              <Segmented<HeroId> label="Focus big reading" value={l.focus.big} onChange={(h) => l.setFocusBig(h)} options={HEROES} />
            </Field>
          </Group>
        )}

        <Group title="Everywhere">
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-2">
            <SwitchRow label="Ride controls" about="Modes, motors, regen and ABS under the page" on={l.show.controls} onChange={(v) => l.setShown('controls', v)} />
            <SwitchRow label="Ride stats" about="Peaks, energy and averages, a scroll below" on={l.show.stats} onChange={(v) => l.setShown('stats', v)} />
            <SwitchRow
              label="Keep the screen on"
              about="While the dashboard is showing live values"
              on={keepAwake}
              onChange={(v) => useSettings.getState().setKeepAwake(v)}
            />
          </div>
        </Group>
      </div>
      <AddTileDialog open={adding} onClose={() => setAdding(false)} />
    </Dialog>
  )
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="label">{title}</h3>
        {note && <span className="text-xs text-faint">{note}</span>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted">{label}</div>
      {children}
    </div>
  )
}

function SwitchRow({ label, about, on, onChange }: { label: string; about: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{about}</span>
      </span>
      <Toggle label={label} checked={on} onChange={onChange} />
    </div>
  )
}

function IconButton({ label, icon: Icon, onClick, disabled }: { label: string; icon: LucideIcon; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="focus-ring flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-text disabled:opacity-30"
    >
      <Icon className="size-4" />
    </button>
  )
}

export function Chip({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: string }) {
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

export function AddTileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tiles = useDashLayout((s) => s.tiles)
  const hidden = TILE_IDS.filter((id) => !tiles.some((t) => t.id === id))
  return <ReadingSheet open={open} onClose={onClose} title="Add a tile" options={hidden} value={null} onPick={(id) => useDashLayout.getState().addTile(id)} />
}
