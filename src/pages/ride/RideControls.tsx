// Dashboard controls a rider uses on the go: ride mode, one or both motors, regen, ABS.

import { Link, useNavigate } from '@tanstack/react-router'
import { BatteryCharging, FlaskConical, Loader2, ShieldCheck, ShieldOff, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cx } from '../../lib/format'
import { useConfig } from '../../state/config'
import { STRENGTH_PCT, strengthPct } from '../../onboard/regen'
import { absIsOn, regenIsOn, useAbs, useRegen } from '../../state/onboard'
import { singleDriverKey, useRideModes, type MotorUse } from '../../state/rideModes'
import { useSettings } from '../../state/settings'
import { AbsIntroDialog } from './AbsIntroDialog'
import { AbsTestDialog } from './AbsTestDialog'

export function RideControls() {
  const order = useConfig((s) => s.order)
  const devices = useConfig((s) => s.devices)
  const { modes, activeId, motors, busy, error, load, apply, clearError } = useRideModes()
  const [pending, setPending] = useState<{ id: string | null; motors: MotorUse } | null>(null)
  useEffect(() => void load(), [load])

  const list = order.map((k) => devices[k]).filter(Boolean)
  if (!list.length) return null
  const ready = list.every((d) => d.mcconf.status === 'ready')
  const readOnly = list.some((d) => d.mcconf.status === 'readonly')
  const sorted = [...modes].sort((a, b) => a.order - b.order)
  const driver = devices[singleDriverKey(list) ?? '']

  const pick = async (id: string | null, m = motors) => {
    setPending({ id, motors: m })
    await apply(id, m)
    setPending(null)
  }

  return (
    <section className="card p-3 md:p-4" aria-label="Ride controls">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="label">Ride mode</span>
            <Link to="/modes" className="text-[11px] text-faint underline-offset-2 hover:text-text hover:underline">
              Edit
            </Link>
          </div>
          <div role="radiogroup" aria-label="Ride mode" className="flex flex-wrap gap-1.5">
            {sorted.map((m) => {
              const on = m.id === activeId
              return (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={on}
                  disabled={!ready || busy}
                  onClick={() => void pick(on ? null : m.id)}
                  title={on ? 'Tap again to go back to your controller settings' : undefined}
                  className={cx(
                    'focus-ring inline-flex h-11 min-w-[76px] items-center justify-center gap-1.5 rounded-xl border px-4 text-sm font-semibold transition-colors disabled:opacity-40',
                    on
                      ? 'border-accent/60 bg-accent/15 text-accent shadow-[0_0_20px_-8px_var(--accent)]'
                      : 'border-line-strong bg-surface-2 text-muted hover:text-text',
                  )}
                >
                  {pending?.id === m.id && pending.motors === motors && <Loader2 className="size-3.5 animate-spin" />}
                  {m.name}
                </button>
              )
            })}
          </div>
        </div>

        {list.length > 1 && (
          <div>
            <div className="label mb-1.5">Motors</div>
            <div role="radiogroup" aria-label="Motors" className="inline-flex rounded-xl border border-line bg-surface-2 p-1">
              {(['single', 'dual'] as const).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={motors === m}
                  disabled={!ready || busy}
                  onClick={() => motors !== m && void pick(activeId, m)}
                  className={cx(
                    'focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold transition-colors disabled:opacity-40',
                    motors === m ? 'bg-surface-3 text-text shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-muted hover:text-text',
                  )}
                >
                  {pending?.motors === m && motors !== m && <Loader2 className="size-3.5 animate-spin" />}
                  {m === 'single' ? 'Single' : 'Dual'}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ml-auto flex flex-wrap items-end gap-3">
          <RegenButton />
          <AbsButton />
        </div>
      </div>

      {motors === 'single' && list.length > 1 && driver && (
        <p className="mt-2 text-xs text-muted">
          Only {driver.name} drives and brakes; the other motor rolls freely.{' '}
          <Link to="/modes" className="underline decoration-line-strong underline-offset-2 hover:text-text">
            Change
          </Link>
        </p>
      )}
      {!ready && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          {readOnly ? (
            'Ride modes are off: a controller runs firmware Ohmic only reads.'
          ) : (
            <>
              <Loader2 className="size-3 animate-spin" /> Reading controller settings…
            </>
          )}
        </p>
      )}
      {error && (
        <div role="alert" className="mt-2.5 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
          <span className="flex-1">{error}</span>
          <button onClick={clearError} aria-label="Dismiss" className="focus-ring rounded text-warn/70 hover:text-warn">
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </section>
  )
}

function RegenButton() {
  const { status, busy, step, error, turnOn, turnOff } = useRegen()
  const settings = useSettings((s) => s.regen)
  const acknowledged = useSettings((s) => s.regenAcknowledged)
  const navigate = useNavigate()
  const on = regenIsOn(status)
  const turningOff = busy && !!step?.startsWith('Turning regen off')
  const shownOn = busy ? !turningOff : !!on
  const strength = settings.strength === 'custom' ? `${strengthPct(settings)} %` : `${settings.strength[0].toUpperCase()}${settings.strength.slice(1)}`
  const press = () => {
    if (on) void turnOff()
    else if (!acknowledged) void navigate({ to: '/regen' })
    else void turnOn()
  }
  const hint = busy ? (turningOff ? 'Turning off…' : 'Turning on…') : on ? `On · ${strength}` : 'Off · tap to turn on'
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="label">Regen</span>
        <Link to="/regen" className="text-[11px] text-faint underline-offset-2 hover:text-text hover:underline">
          Settings
        </Link>
      </div>
      <button
        role="switch"
        aria-checked={!!on}
        aria-label={on ? 'Regen is on. Turn it off' : 'Regen is off. Turn it on'}
        onClick={press}
        disabled={busy}
        title={step ?? error ?? (settings.strength === 'custom' ? undefined : `${STRENGTH_PCT[settings.strength]} % of motor braking when you let go of the throttle`)}
        className={cx(
          'focus-ring inline-flex h-12 min-w-[176px] items-center gap-2.5 rounded-xl border pr-2.5 pl-3 text-left transition-colors disabled:cursor-progress',
          on ? 'border-ok/50 bg-ok/12' : 'border-line-strong bg-surface-2 hover:border-text/25',
        )}
      >
        {busy ? <Loader2 className="size-5 shrink-0 animate-spin text-muted" /> : <BatteryCharging className={cx('size-5 shrink-0', on ? 'text-ok' : 'text-muted')} />}
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-sm font-semibold text-text">Regen</span>
          <span className={cx('block text-[11px]', on && !busy ? 'text-ok' : 'text-muted')}>{hint}</span>
        </span>
        <span
          aria-hidden
          className={cx('relative h-6 w-10 shrink-0 rounded-full border transition-colors', shownOn ? 'border-ok/60 bg-ok/40' : 'border-line-strong bg-surface-3', busy && 'opacity-60')}
        >
          <span className={cx('absolute top-0.5 size-[18px] rounded-full bg-text shadow transition-[left]', shownOn ? 'left-[18px]' : 'left-0.5')} />
        </span>
      </button>
      {error && !busy && <p className="mt-1 max-w-[240px] text-[11px] leading-snug text-warn">{error}</p>}
    </div>
  )
}

function AbsButton() {
  const { status, busy, step, error, turnOn, turnOff } = useAbs()
  const acknowledged = useSettings((s) => s.absAcknowledged)
  const [intro, setIntro] = useState(false)
  const [testing, setTesting] = useState(false)
  const on = absIsOn(status)

  const press = () => {
    if (on) void turnOff()
    else if (!acknowledged) setIntro(true)
    else void turnOn()
  }
  const total = Object.values(status).reduce((n, s) => n + (s.on ? s.interventions : 0), 0)
  // While busy the status can already read "on" mid-check, so the step says which way it's going.
  const turningOff = busy && !!step?.startsWith('Turning ABS off')
  const shownOn = busy ? !turningOff : !!on
  const hint = busy
    ? turningOff
      ? 'Turning off…'
      : 'Turning on…'
    : on
      ? total > 0
        ? `On · ${total} brake release${total === 1 ? '' : 's'}`
        : 'On · tap to turn off'
      : 'Off · tap to turn on'

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="label">ABS</span>
        <Link to="/abs" className="text-[11px] text-faint underline-offset-2 hover:text-text hover:underline">
          About
        </Link>
      </div>
      <div className="flex items-stretch gap-1.5">
        <button
          role="switch"
          aria-checked={!!on}
          aria-label={on ? 'ABS is on. Turn it off' : 'ABS is off. Turn it on'}
          onClick={press}
          disabled={busy}
          title={step ?? error ?? undefined}
          className={cx(
            'focus-ring inline-flex h-12 min-w-[196px] items-center gap-2.5 rounded-xl border pr-2.5 pl-3 text-left transition-colors disabled:cursor-progress',
            on ? 'border-ok/50 bg-ok/12' : 'border-accent/50 bg-accent/10 hover:bg-accent/15',
          )}
        >
          {busy ? (
            <Loader2 className="size-5 shrink-0 animate-spin text-muted" />
          ) : on ? (
            <ShieldCheck className="size-5 shrink-0 text-ok" />
          ) : (
            <ShieldOff className="size-5 shrink-0 text-accent" />
          )}
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-sm font-semibold text-text">ABS</span>
            <span className={cx('block text-[11px]', on && !busy ? 'text-ok' : 'text-muted')}>{hint}</span>
          </span>
          {/* The switch itself, so it reads as something to flip. */}
          <span
            aria-hidden
            className={cx(
              'relative h-6 w-10 shrink-0 rounded-full border transition-colors',
              shownOn ? 'border-ok/60 bg-ok/40' : 'border-line-strong bg-surface-3',
              busy && 'opacity-60',
            )}
          >
            <span className={cx('absolute top-0.5 size-[18px] rounded-full bg-text shadow transition-[left]', shownOn ? 'left-[18px]' : 'left-0.5')} />
          </span>
        </button>
        <button
          onClick={() => setTesting(true)}
          title="Test ABS with the wheel off the ground"
          className="focus-ring inline-flex h-12 items-center gap-1.5 rounded-xl border border-line-strong bg-surface-2 px-3 text-sm font-semibold text-muted transition-colors hover:text-text"
        >
          <FlaskConical className="size-4" /> Test
        </button>
      </div>
      <AbsTestDialog open={testing} onClose={() => setTesting(false)} />
      {error && !busy && <p className="mt-1 max-w-[260px] text-[11px] leading-snug text-warn">{error}</p>}
      <AbsIntroDialog
        open={intro}
        onClose={() => setIntro(false)}
        onAccept={() => {
          setIntro(false)
          useSettings.getState().acknowledgeAbs()
          void turnOn()
        }}
      />
    </div>
  )
}
