// Dashboard controls a rider uses on the go: ride mode, one or both motors, regen, ABS.
// `compact` is the one-screen phone layout's: the same controls as one row of small buttons.

import { Link, useNavigate } from '@tanstack/react-router'
import { BatteryCharging, ChevronRight, Loader2, ShieldCheck, ShieldOff, X } from 'lucide-react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { cx } from '../../lib/format'
import { strengthPct } from '../../onboard/regen'
import { useConfig } from '../../state/config'
import { absIsOn, regenIsOn, useAbs, useRegen } from '../../state/onboard'
import { singleDriverKey, useRideModes, type MotorUse } from '../../state/rideModes'
import { useSettings } from '../../state/settings'
import { useMotorDevices } from '../setup/helpers'
import { AbsIntroDialog } from './AbsIntroDialog'
import { haptic } from '../../ui/haptics'
import { modeLook } from './modeLook'

const QUICK = 'focus-ring flex h-12 flex-col items-center justify-center gap-1 rounded-xl border transition-colors'

export function RideControls({ compact = false }: { compact?: boolean }) {
  const devices = useConfig((s) => s.devices)
  const list = useMotorDevices()
  const { modes, activeId, motors, busy, error, load, apply, clearError } = useRideModes()
  const [pending, setPending] = useState<{
    id: string | null
    motors: MotorUse
  } | null>(null)
  useEffect(() => void load(), [load])

  if (!list.length) return null
  const ready = list.every((d) => d.mcconf.status === 'ready')
  const readOnly = list.some((d) => d.mcconf.status === 'readonly')
  const sorted = [...modes].sort((a, b) => a.order - b.order)
  const driver = devices[singleDriverKey(list) ?? '']

  const pick = async (id: string | null, m = motors) => {
    haptic()
    setPending({ id, motors: m })
    await apply(id, m)
    setPending(null)
  }

  if (compact)
    return (
      <section className="space-y-1.5" aria-label="Ride controls">
        <div className="flex gap-1.5">
          <div role="radiogroup" aria-label="Ride mode" className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
            {sorted.length === 0 && (
              <Link to="/modes" className={cx(QUICK, 'flex-1 border-line-strong bg-surface-2 text-xs font-medium text-muted')}>
                Add ride modes
              </Link>
            )}
            {sorted.map((m, i) => {
              const on = m.id === activeId
              const { icon: Icon, color } = modeLook(m, i)
              return (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={on}
                  disabled={!ready || busy}
                  onClick={() => void pick(on ? null : m.id)}
                  style={{ '--mode': color } as CSSProperties}
                  className={cx(
                    QUICK,
                    'min-w-[44px] flex-1 basis-0 px-1 text-[var(--mode)] disabled:opacity-40',
                    on
                      ? 'border-[color-mix(in_oklab,var(--mode)_65%,transparent)] bg-[color-mix(in_oklab,var(--mode)_14%,transparent)]'
                      : 'border-line-strong bg-surface-2',
                  )}
                >
                  {pending?.id === m.id && pending.motors === motors ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
                  <span className={cx('max-w-full truncate text-[10px] leading-none font-semibold', on ? 'text-text' : 'text-muted')}>{m.name}</span>
                </button>
              )
            })}
          </div>
          {list.length > 1 && (
            <button
              role="switch"
              aria-checked={motors === 'dual'}
              aria-label="Both motors drive"
              disabled={!ready || busy}
              onClick={() => void pick(activeId, motors === 'dual' ? 'single' : 'dual')}
              className={cx(QUICK, 'w-[52px] shrink-0 border-line-strong bg-surface-2 disabled:opacity-40')}
            >
              {pending && pending.motors !== motors ? (
                <Loader2 className="size-4 animate-spin text-muted" />
              ) : (
                <span className="num text-[15px] leading-none font-semibold">{motors === 'dual' ? '2×' : '1×'}</span>
              )}
              <span className="text-[10px] leading-none font-semibold text-muted">{motors === 'dual' ? 'Dual' : 'Single'}</span>
            </button>
          )}
          <RegenButton compact />
          <AbsButton compact />
        </div>
        {!ready && readOnly && <p className="px-1 text-[11px] text-muted">Ride modes are off: a controller runs firmware Ohmic only reads.</p>}
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
            <span className="flex-1">{error}</span>
            <button onClick={clearError} aria-label="Dismiss" className="focus-ring rounded text-warn/70 hover:text-warn">
              <X className="size-3.5" />
            </button>
          </div>
        )}
        <AssistErrors />
      </section>
    )

  return (
    <section className="card space-y-4 p-3.5 md:p-4" aria-label="Ride controls">
      <div className="grid gap-x-5 gap-y-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span className="label">Ride mode</span>
            <Link to="/modes" className="text-[11px] text-faint underline-offset-2 hover:text-text hover:underline">
              Edit
            </Link>
          </div>
          <div
            role="radiogroup"
            aria-label="Ride mode"
            className={cx('grid gap-2', sorted.length <= 3 ? 'grid-cols-3' : 'grid-cols-[repeat(auto-fill,minmax(112px,1fr))]')}
          >
            {sorted.map((m, i) => {
              const on = m.id === activeId
              const { icon: Icon, color } = modeLook(m, i)
              return (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={on}
                  disabled={!ready || busy}
                  onClick={() => void pick(on ? null : m.id)}
                  title={on ? 'Tap again to go back to your controller settings' : undefined}
                  style={{ '--mode': color } as CSSProperties}
                  className={cx(
                    'focus-ring flex h-[76px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border px-2 transition-[background,border-color,box-shadow] disabled:opacity-40 sm:h-14 sm:flex-row sm:justify-start sm:gap-2.5 sm:px-3 sm:text-left',
                    on
                      ? 'border-[color-mix(in_oklab,var(--mode)_65%,transparent)] bg-[color-mix(in_oklab,var(--mode)_12%,transparent)] shadow-[0_0_26px_-10px_var(--mode)]'
                      : 'border-line-strong bg-surface-2 hover:border-[color-mix(in_oklab,var(--mode)_45%,transparent)]',
                  )}
                >
                  <span
                    className={cx(
                      'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                      on ? 'bg-[var(--mode)] text-white' : 'bg-[color-mix(in_oklab,var(--mode)_16%,transparent)] text-[var(--mode)]',
                    )}
                  >
                    {pending?.id === m.id && pending.motors === motors ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
                  </span>
                  <span className={cx('max-w-full truncate text-sm font-semibold', on ? 'text-text' : 'text-muted')}>{m.name}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {list.length > 1 && (
            <div className="w-full sm:w-auto">
              <div className="label mb-2">Motors</div>
              <div role="radiogroup" aria-label="Motors" className="flex h-12 rounded-xl border border-line bg-surface-2 p-1">
                {(['single', 'dual'] as const).map((m) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={motors === m}
                    disabled={!ready || busy}
                    onClick={() => motors !== m && void pick(activeId, m)}
                    className={cx(
                      'focus-ring inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold transition-colors disabled:opacity-40',
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
          <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
            <RegenButton />
            <AbsButton />
          </div>
        </div>
      </div>

      {motors === 'single' && list.length > 1 && driver && (
        <p className="text-xs text-muted">
          Only {driver.name} drives.{' '}
          <Link to="/modes" className="underline decoration-line-strong underline-offset-2 hover:text-text">
            Change
          </Link>
        </p>
      )}
      {!ready && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
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
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
          <span className="flex-1">{error}</span>
          <button onClick={clearError} aria-label="Dismiss" className="focus-ring rounded text-warn/70 hover:text-warn">
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </section>
  )
}

/** Regen and ABS problems, under the compact row where the switches have no room for them. */
function AssistErrors() {
  const regen = useRegen((s) => (s.busy ? null : s.error))
  const abs = useAbs((s) => (s.busy ? null : s.error))
  if (!regen && !abs) return null
  return (
    <div role="alert" className="space-y-1 px-1 text-[11px] leading-snug text-warn">
      {regen && <p>{regen}</p>}
      {abs && <p>{abs}</p>}
    </div>
  )
}

/** An on/off control with its settings one tap away. `compact` is a small button, with the settings left to the Tune tab. */
function AssistSwitch({
  name,
  on,
  shownOn,
  busy,
  state,
  icon,
  settings,
  onPress,
  error,
  title,
  compact,
}: {
  name: string
  on: boolean | null
  shownOn: boolean
  busy: boolean
  state: string
  icon: ReactNode
  settings: '/regen' | '/abs'
  onPress: () => void
  error: string | null
  title?: string
  compact: boolean
}) {
  const label = on ? `${name} is on. Turn it off` : `${name} is off. Turn it on`
  if (compact)
    return (
      <button
        role="switch"
        aria-checked={!!on}
        aria-label={label}
        onClick={() => {
          haptic()
          onPress()
        }}
        disabled={busy}
        title={title}
        className={cx(
          QUICK,
          'w-[52px] shrink-0 disabled:cursor-progress [&>svg]:size-4',
          on ? 'border-ok/45 bg-ok/10' : 'border-line-strong bg-surface-2',
        )}
      >
        {busy ? <Loader2 className="animate-spin text-muted" /> : icon}
        <span className={cx('text-[10px] leading-none font-semibold', on && !busy ? 'text-ok' : 'text-muted')}>{name}</span>
      </button>
    )
  return (
    <div className="min-w-0">
      <div
        className={cx(
          'flex h-12 overflow-hidden rounded-xl border transition-colors',
          on ? 'border-ok/45 bg-ok/10' : 'border-line-strong bg-surface-2',
        )}
      >
        <button
          role="switch"
          aria-checked={!!on}
          aria-label={label}
          onClick={() => {
            haptic()
            onPress()
          }}
          disabled={busy}
          title={title}
          className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 pr-2 pl-3 text-left disabled:cursor-progress sm:min-w-[150px]"
        >
          {busy ? <Loader2 className="size-5 shrink-0 animate-spin text-muted" /> : icon}
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-sm font-semibold text-text">{name}</span>
            <span className={cx('block truncate text-[11px]', on && !busy ? 'text-ok' : 'text-muted')}>{state}</span>
          </span>
          <SwitchKnob on={shownOn} busy={busy} />
        </button>
        <Link
          to={settings}
          aria-label={`${name} settings`}
          className="focus-ring flex w-9 shrink-0 items-center justify-center border-l border-line text-faint transition-colors hover:text-text"
        >
          <ChevronRight className="size-4" />
        </Link>
      </div>
      {error && !busy && <p className="mt-1 max-w-[280px] text-[11px] leading-snug text-warn">{error}</p>}
    </div>
  )
}

function RegenButton({ compact = false }: { compact?: boolean }) {
  const { status, busy, step, error, turnOn, turnOff } = useRegen()
  const settings = useSettings((s) => s.regen)
  const acknowledged = useSettings((s) => s.regenAcknowledged)
  const navigate = useNavigate()
  const on = regenIsOn(status)
  const turningOff = busy && !!step?.startsWith('Turning regen off')
  const strength =
    settings.strength === 'custom' ? `${strengthPct(settings)} %` : `${settings.strength[0].toUpperCase()}${settings.strength.slice(1)}`
  const press = () => {
    if (on) void turnOff()
    else if (!acknowledged) void navigate({ to: '/regen' })
    else void turnOn()
  }
  return (
    <AssistSwitch
      name="Regen"
      on={on}
      shownOn={busy ? !turningOff : !!on}
      busy={busy}
      state={busy ? (turningOff ? 'Turning off…' : 'Turning on…') : on ? strength : 'Off'}
      icon={<BatteryCharging className={cx('size-5 shrink-0', on ? 'text-ok' : 'text-muted')} />}
      settings="/regen"
      onPress={press}
      error={error}
      title={step ?? undefined}
      compact={compact}
    />
  )
}

function AbsButton({ compact = false }: { compact?: boolean }) {
  const { status, busy, step, error, turnOn, turnOff } = useAbs()
  const acknowledged = useSettings((s) => s.absAcknowledged)
  const [intro, setIntro] = useState(false)
  const on = absIsOn(status)
  const press = () => {
    if (on) void turnOff()
    else if (!acknowledged) setIntro(true)
    else void turnOn()
  }
  const total = Object.values(status).reduce((n, s) => n + (s.on ? s.interventions : 0), 0)
  // While busy the status can already read "on" mid-check, so the step says which way it's going.
  const turningOff = busy && !!step?.startsWith('Turning ABS off')
  return (
    <>
      <AssistSwitch
        name="ABS"
        on={on}
        shownOn={busy ? !turningOff : !!on}
        busy={busy}
        state={busy ? (turningOff ? 'Turning off…' : 'Turning on…') : on ? (total > 0 ? `${total} release${total === 1 ? '' : 's'}` : 'On') : 'Off'}
        icon={on ? <ShieldCheck className="size-5 shrink-0 text-ok" /> : <ShieldOff className="size-5 shrink-0 text-muted" />}
        settings="/abs"
        onPress={press}
        error={error}
        title={step ?? undefined}
        compact={compact}
      />
      <AbsIntroDialog
        open={intro}
        onClose={() => setIntro(false)}
        onAccept={() => {
          setIntro(false)
          useSettings.getState().acknowledgeAbs()
          void turnOn()
        }}
      />
    </>
  )
}

/** The switch drawn inside the Regen and ABS buttons, so they read as something to flip. */
function SwitchKnob({ on, busy }: { on: boolean; busy: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        'relative h-6 w-10 shrink-0 rounded-full border transition-colors',
        on ? 'border-ok/60 bg-ok/40' : 'border-line-strong bg-surface-3',
        busy && 'opacity-60',
      )}
    >
      <span className={cx('absolute top-0.5 size-[18px] rounded-full bg-text shadow transition-[left]', on ? 'left-[18px]' : 'left-0.5')} />
    </span>
  )
}
