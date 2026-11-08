import { Link } from '@tanstack/react-router'
import { Check, Loader2, OctagonX } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import type { Target } from '../../client/VescClient'
import { cx } from '../../lib/format'
import type { DeviceConfig } from '../../state/config'
import { targetKey } from '../../state/devices'
import { startMotorTest, stopMotorTest, useMotorTest } from '../../state/motorTest'
import { useSession } from '../../state/session'
import { buttonClass } from '../../ui/buttonClass'
import { BackLink, PageTitle } from '../../ui/Primitives'

/** Shown until every motor controller's settings have been read. */
export function NotReady({ title, what, list }: { title: string; what: string; list: DeviceConfig[] }) {
  const connected = useSession((s) => s.status === 'connected')
  const readOnly = list.find((d) => d.mcconf.status === 'readonly')
  return (
    <>
      <BackToSetup />
      <PageTitle title={title} />
      <p className="card flex flex-wrap items-center gap-2 p-5 text-sm text-muted">
        {!connected || !list.length ? (
          <>
            <span className="min-w-[200px] flex-1">Connect to a motor controller, or the demo scooter, to {what}.</span>
            {!connected && (
              <Link to="/connect" className={buttonClass('primary', 'h-9')}>
                Connect
              </Link>
            )}
          </>
        ) : readOnly ? (
          `${readOnly.name} runs firmware Ohmic only reads, so wizards that write settings are off for it.`
        ) : (
          <>
            <Loader2 className="size-4 animate-spin" /> Reading controller settings…
          </>
        )}
      </p>
    </>
  )
}

export function BackToSetup() {
  return <BackLink to="/setup">Setup</BackLink>
}

export function Steps({ steps, at }: { steps: string[]; at: number }) {
  return (
    <ol className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s} aria-current={i === at ? 'step' : undefined} className={cx('flex items-center gap-1.5', i === at ? 'text-text' : i < at ? 'text-muted' : 'text-faint')}>
          <span
            className={cx(
              'flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold',
              i < at ? 'border-ok/50 bg-ok/15 text-ok' : i === at ? 'border-accent/60 text-accent' : 'border-line-strong',
            )}
          >
            {i < at ? <Check className="size-3" /> : i + 1}
          </span>
          {s}
        </li>
      ))}
    </ol>
  )
}

export function DevicePicker({ list, value, onChange, label = 'Controller' }: { list: DeviceConfig[]; value: string | null; onChange: (k: string) => void; label?: string }) {
  if (list.length < 2) return null
  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {list.map((d) => (
          <button
            key={d.key}
            role="radio"
            aria-checked={value === d.key}
            onClick={() => onChange(d.key)}
            className={cx(
              'focus-ring h-9 rounded-lg border px-3 text-sm',
              value === d.key ? 'border-accent/50 bg-accent/10' : 'border-line-strong text-muted hover:text-text',
            )}
          >
            {d.name}
          </button>
        ))}
      </div>
    </div>
  )
}

export function NumberField({
  label,
  unit,
  value,
  onChange,
  hint,
}: {
  label: string
  unit?: string
  value: string
  onChange: (v: string) => void
  hint?: ReactNode
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="block text-xs text-muted">{hint}</span>}
      <span className="mt-1 flex items-center gap-2">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="focus-ring num h-10 w-32 rounded-xl border border-line-strong bg-surface-2 px-3 text-right text-sm"
        />
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </span>
    </label>
  )
}

/**
 * Hold-to-run: the motor turns only while this is held (pointer, Space or Enter).
 * The big Stop beside it always stops every test.
 */
export function HoldToRun({ target, erpm, label, disabled }: { target: Target; erpm: number; label: string; disabled?: boolean }) {
  const running = useMotorTest((s) => s.running)
  const error = useMotorTest((s) => s.error)
  const mine = running === targetKey(target)
  useEffect(() => () => stopMotorTest(), [])
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={disabled}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            startMotorTest(target, erpm)
          }}
          onPointerUp={stopMotorTest}
          onPointerCancel={stopMotorTest}
          onLostPointerCapture={stopMotorTest}
          onKeyDown={(e) => {
            if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
              e.preventDefault()
              startMotorTest(target, erpm)
            }
          }}
          onKeyUp={(e) => {
            if (e.key === ' ' || e.key === 'Enter') stopMotorTest()
          }}
          onBlur={stopMotorTest}
          onContextMenu={(e) => e.preventDefault()}
          style={{ touchAction: 'none' }}
          className={cx(
            'focus-ring h-16 min-w-[220px] rounded-2xl border px-6 text-base font-semibold transition-colors select-none disabled:opacity-40',
            mine ? 'border-accent bg-accent/25 text-accent' : 'border-accent/50 bg-accent/10 text-text hover:bg-accent/15',
          )}
        >
          {mine ? 'Turning… let go to stop' : label}
        </button>
        <button
          onClick={stopMotorTest}
          className="focus-ring inline-flex h-16 items-center gap-2 rounded-2xl border border-danger/50 bg-danger/15 px-6 text-base font-bold text-danger"
        >
          <OctagonX className="size-5" /> Stop
        </button>
      </div>
      {error && !running && <p className="mt-2 text-sm text-warn">{error}</p>}
    </div>
  )
}
