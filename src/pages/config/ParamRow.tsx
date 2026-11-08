import { Info, Minus, Plus, RotateCcw, Undo2 } from 'lucide-react'
import { memo, useId, useState, type KeyboardEvent } from 'react'
import { sameOnWire } from '../../config/codec'
import { displaySpec, formatNumber, fromDisplay } from '../../config/display'
import { curatedHelp, optionLabel } from '../../config/help'
import { CFG, type ConfigValue, type ParamDef } from '../../config/types'
import { validateValue } from '../../config/validate'
import { cx } from '../../lib/format'
import { Toggle } from '../../ui/Toggle'
import { describeValue } from './describe'

export interface ParamRowProps {
  p: ParamDef
  value: ConfigValue | undefined
  /** What the controller has. */
  device: ConfigValue | undefined
  defaultValue: ConfigValue | undefined
  compare?: { label: string; value: ConfigValue | undefined }
  readOnly: boolean
  /** Cross-setting problems that mention this setting. */
  issues?: { level: 'error' | 'warning'; message: string }[]
  onCommit: (name: string, value: ConfigValue) => void
}

/** Shown value for a number in the editor's units, without the unit. */
function shownNumber(p: ParamDef, v: number) {
  const s = displaySpec(p)
  return formatNumber(v * s.factor, s.decimals)
}

function sliderSpec(p: ParamDef) {
  const s = displaySpec(p)
  if (p.typeId !== CFG.DOUBLE && p.typeId !== CFG.INT) return null
  const steps = (s.max - s.min) / (s.step || 1)
  // A slider only helps when the whole range is meaningful (percentages, small ranges).
  if (!(p.percent || (steps > 1 && steps <= 200))) return null
  return s
}

function NumberEditor({ p, value, readOnly, onCommit }: { p: ParamDef; value: number; readOnly: boolean; onCommit: (v: number) => void }) {
  const spec = displaySpec(p)
  const id = useId()
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const slider = sliderSpec(p)
  const shown = shownNumber(p, value)

  const tryCommit = (raw: string): boolean => {
    const n = Number(raw.trim().replace(',', '.'))
    if (raw.trim() === '' || !Number.isFinite(n)) {
      setError('Enter a number')
      return false
    }
    const v = fromDisplay(p, n)
    const problem = validateValue(p, v)
    if (problem) {
      setError(problem)
      return false
    }
    setError(null)
    setText(null)
    if (!sameOnWire(p, v, value)) onCommit(v)
    return true
  }

  const stepBy = (dir: 1 | -1) => {
    const step = spec.step > 0 ? spec.step : 1
    // Move to the next point on the step grid, so 54.3 + 1 gives 55 and 54.3 − 1 gives 54.
    const x = (value * spec.factor) / step
    const next = (dir > 0 ? Math.floor(x + 1 + 1e-9) : Math.ceil(x - 1 - 1e-9)) * step
    const rounded = Number(next.toFixed(Math.max(spec.decimals, 6)))
    const v = fromDisplay(p, rounded)
    if (validateValue(p, v)) return
    setText(null)
    setError(null)
    onCommit(v)
  }

  const atMin = value * spec.factor <= spec.min + 1e-9
  const atMax = value * spec.factor >= spec.max - 1e-9

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (tryCommit(e.currentTarget.value)) e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      setText(null)
      setError(null)
      e.currentTarget.blur()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      stepBy(e.key === 'ArrowUp' ? 1 : -1)
    }
  }

  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:items-end">
      <div className="flex items-center gap-2">
        {slider && (
          <input
            type="range"
            aria-label={`${p.label} slider`}
            min={slider.min}
            max={slider.max}
            step={slider.step}
            disabled={readOnly}
            value={drag ?? value * spec.factor}
            onChange={(e) => setDrag(Number(e.target.value))}
            onPointerUp={() => {
              if (drag !== null) tryCommit(String(drag))
              setDrag(null)
            }}
            onKeyUp={() => {
              if (drag !== null) tryCommit(String(drag))
              setDrag(null)
            }}
            onBlur={() => setDrag(null)}
            className="h-1.5 w-full min-w-24 cursor-pointer accent-[var(--accent)] sm:w-32 disabled:opacity-40"
          />
        )}
        <div
          className={cx(
            'flex h-9 items-stretch overflow-hidden rounded-lg border bg-surface-2 transition-colors focus-within:border-accent/60',
            error ? 'border-danger/70' : 'border-line-strong',
            readOnly && 'opacity-70',
          )}
        >
          {!readOnly && (
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Decrease ${p.label}`}
              disabled={atMin}
              onClick={() => stepBy(-1)}
              className="px-2 text-muted transition-colors hover:bg-surface-3 hover:text-text disabled:opacity-30"
            >
              <Minus className="size-3.5" />
            </button>
          )}
          <input
            id={id}
            aria-label={p.label}
            aria-invalid={!!error}
            inputMode="decimal"
            readOnly={readOnly}
            value={drag !== null ? formatNumber(drag, spec.decimals) : (text ?? shown)}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            onBlur={(e) => {
              if (text !== null) tryCommit(e.target.value)
            }}
            onKeyDown={onKey}
            className="num w-24 bg-transparent px-1 text-right text-sm text-text outline-none"
          />
          <span className="flex min-w-6 items-center pr-2 pl-1 text-xs text-muted">{spec.unit}</span>
          {!readOnly && (
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Increase ${p.label}`}
              disabled={atMax}
              onClick={() => stepBy(1)}
              className="border-l border-line px-2 text-muted transition-colors hover:bg-surface-3 hover:text-text disabled:opacity-30"
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
          {text !== null && (
            <button
              className="ml-2 underline decoration-danger/40 underline-offset-2"
              onClick={() => {
                setText(null)
                setError(null)
              }}
            >
              Undo typing
            </button>
          )}
        </p>
      )}
    </div>
  )
}

function EnumEditor({ p, value, readOnly, onCommit }: { p: ParamDef; value: number; readOnly: boolean; onCommit: (v: number) => void }) {
  return (
    <select
      aria-label={p.label}
      disabled={readOnly}
      value={value}
      onChange={(e) => onCommit(Number(e.target.value))}
      className="focus-ring h-9 w-full max-w-72 cursor-pointer truncate rounded-lg border border-line-strong bg-surface-2 px-2.5 text-sm text-text disabled:opacity-70 sm:w-auto"
    >
      {p.enums.map((name, i) => (
        <option key={i} value={i}>
          {optionLabel(p.name, i, name)}
        </option>
      ))}
      {(value < 0 || value >= p.enums.length) && <option value={value}>Unknown ({value})</option>}
    </select>
  )
}

function BitfieldEditor({ p, value, readOnly, onCommit }: { p: ParamDef; value: number; readOnly: boolean; onCommit: (v: number) => void }) {
  return (
    <div className="flex max-w-md flex-wrap justify-end gap-1.5" role="group" aria-label={p.label}>
      {p.enums.map((name, i) => {
        const on = ((value >> i) & 1) === 1
        return (
          <button
            key={i}
            type="button"
            aria-pressed={on}
            disabled={readOnly}
            onClick={() => onCommit(on ? value & ~(1 << i) : value | (1 << i))}
            className={cx(
              'focus-ring rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60',
              on ? 'border-accent/50 bg-accent/15 text-text' : 'border-line-strong text-muted hover:text-text',
            )}
          >
            {name}
          </button>
        )
      })}
    </div>
  )
}

function TextEditor({ p, value, readOnly, onCommit }: { p: ParamDef; value: string; readOnly: boolean; onCommit: (v: string) => void }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const commit = (t: string) => {
    const problem = validateValue(p, t)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setText(null)
    if (t !== value) onCommit(t)
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <input
        aria-label={p.label}
        readOnly={readOnly}
        value={text ?? value}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          if (text !== null) commit(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value)
        }}
        className="focus-ring h-9 w-56 rounded-lg border border-line-strong bg-surface-2 px-2.5 text-sm"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}

function Editor({ p, value, readOnly, onCommit }: { p: ParamDef; value: ConfigValue; readOnly: boolean; onCommit: (v: ConfigValue) => void }) {
  if (typeof value === 'string') return <TextEditor p={p} value={value} readOnly={readOnly} onCommit={onCommit} />
  switch (p.typeId) {
    case CFG.BOOL:
      return <Toggle checked={value !== 0} onChange={(on) => onCommit(on ? 1 : 0)} label={p.label} disabled={readOnly} />
    case CFG.ENUM:
      return <EnumEditor p={p} value={value} readOnly={readOnly} onCommit={onCommit} />
    case CFG.BITFIELD:
      return <BitfieldEditor p={p} value={value} readOnly={readOnly} onCommit={onCommit} />
    default:
      return <NumberEditor p={p} value={value} readOnly={readOnly} onCommit={onCommit} />
  }
}

function rangeText(p: ParamDef): string | null {
  if (p.typeId !== CFG.DOUBLE && p.typeId !== CFG.INT) return null
  const s = displaySpec(p)
  const u = s.unit ? ` ${s.unit}` : ''
  return `${formatNumber(s.min, s.decimals)} to ${formatNumber(s.max, s.decimals)}${u}, step ${formatNumber(s.step, Math.max(s.decimals, 2))}`
}

export const ParamRow = memo(function ParamRow({ p, value, device, defaultValue, compare, readOnly, issues, onCommit }: ParamRowProps) {
  const [open, setOpen] = useState(false)
  const helpId = useId()
  if (value === undefined) return null
  const changed = device !== undefined && !sameOnWire(p, value, device)
  const isDefault = defaultValue === undefined || sameOnWire(p, value, defaultValue)
  const differs = compare && compare.value !== undefined && !sameOnWire(p, value, compare.value)
  const curated = curatedHelp(p.name)
  const range = rangeText(p)
  const commit = (v: ConfigValue) => onCommit(p.name, v)

  return (
    <div
      className={cx(
        'relative border-b border-line px-4 py-3.5 last:border-b-0 md:px-5',
        changed && 'bg-accent/[0.04] before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r before:bg-accent',
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[14.5px] font-medium">{p.label}</span>
            <button
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls={helpId}
              aria-label={`Help for ${p.label}`}
              className={cx('focus-ring rounded-md p-0.5 transition-colors', open ? 'text-accent' : 'text-faint hover:text-muted')}
            >
              <Info className="size-3.5" />
            </button>
          </div>
          <div className="mt-0.5 font-mono text-[11px] break-all text-faint">{p.name}</div>
          {curated && !open && <p className="mt-1 line-clamp-1 text-[12.5px] text-muted">{curated.plain}</p>}
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {changed && (
              <button
                onClick={() => commit(device!)}
                disabled={readOnly}
                className="inline-flex items-center gap-1 text-accent hover:underline"
                title="Put back what the controller has"
              >
                <Undo2 className="size-3" />
                was {describeValue(p, device)}
              </button>
            )}
            {differs && (
              <span className="text-warn">
                {compare.label}: {describeValue(p, compare.value)}
              </span>
            )}
            {issues?.map((i) => (
              <span key={i.message} className={i.level === 'error' ? 'text-danger' : 'text-warn'}>
                {i.message}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-start gap-1.5 sm:justify-end">
          <Editor p={p} value={value} readOnly={readOnly} onCommit={commit} />
          {!readOnly && (
            <button
              onClick={() => defaultValue !== undefined && commit(defaultValue)}
              disabled={isDefault}
              aria-label={`Reset ${p.label} to default`}
              title={defaultValue !== undefined ? `Default: ${describeValue(p, defaultValue)}` : undefined}
              className="focus-ring mt-0.5 rounded-lg p-2 text-faint transition-colors hover:bg-surface-3 hover:text-text disabled:pointer-events-none disabled:opacity-25"
            >
              <RotateCcw className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {open && (
        <div id={helpId} className="mt-3 space-y-2 rounded-xl border border-line bg-surface-2/60 p-3.5 text-[13px] leading-relaxed">
          {curated && <p>{curated.plain}</p>}
          {p.help && p.help !== p.label && (
            <div>
              <div className="label mb-1 text-[9.5px]">From VESC Tool</div>
              <p className="whitespace-pre-line text-muted">{p.help}</p>
            </div>
          )}
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            {range && (
              <div>
                <dt className="inline text-faint">Range </dt>
                <dd className="inline">{range}</dd>
              </div>
            )}
            {defaultValue !== undefined && (
              <div>
                <dt className="inline text-faint">Default </dt>
                <dd className="inline">{describeValue(p, defaultValue)}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  )
})
