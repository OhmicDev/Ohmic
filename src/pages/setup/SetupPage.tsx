import { Link } from '@tanstack/react-router'
import { Check, ChevronRight } from 'lucide-react'
import { cx } from '../../lib/format'
import { nextStep, SETUP_ORDER, useStepsDone, useVehicleKey } from '../../state/setupProgress'
import { useSession } from '../../state/session'
import { PageTitle } from '../../ui/Primitives'
import { buttonClass } from '../../ui/buttonClass'
import { StepState } from './SetupSteps'
import { STEPS } from './steps'

export function SetupPage() {
  const status = useSession((s) => s.status)
  const connected = status === 'connected' || status === 'reconnecting'
  const vehicle = useVehicleKey()
  const done = useStepsDone(vehicle)
  const next = nextStep(done)
  const count = SETUP_ORDER.filter((s) => done?.[s]).length

  return (
    <>
      <PageTitle
        title="Setup"
        subtitle="Get a new build riding, one step at a time. Every change is shown before it’s written, and backed up first."
      />

      {!connected && (
        <div className="card mb-4 flex flex-wrap items-center gap-3 p-4 text-sm">
          <span className="min-w-[200px] flex-1 text-muted">Connect a controller to run these.</span>
          <Link to="/connect" className={buttonClass('primary', 'h-9')}>
            Connect
          </Link>
        </div>
      )}

      <section aria-labelledby="setup-steps" className="card p-4 md:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="setup-steps" className="text-base font-semibold">
            New build or new parts
          </h2>
          {connected && vehicle && (
            <span className="num text-xs text-muted">
              {count} of {SETUP_ORDER.length} done
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted">Do these in order. Each one checks what it needs first and walks you through it.</p>
        <ol className="mt-3 space-y-2">
          {SETUP_ORDER.map((id, i) => {
            const s = STEPS[id]
            const isNext = connected && id === next
            const at = done?.[id]
            const Icon = s.icon
            return (
              <li key={id}>
                <Link
                  to={s.to}
                  className={cx(
                    'focus-ring flex items-center gap-3 rounded-xl border p-3 transition-colors md:gap-4 md:p-3.5',
                    isNext ? 'border-accent/40 bg-accent/5 hover:bg-accent/10' : 'border-line hover:border-line-strong hover:bg-surface-2',
                  )}
                >
                  <span
                    className={cx(
                      'num flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
                      at ? 'border-ok/50 bg-ok/15 text-ok' : isNext ? 'border-accent/60 text-accent' : 'border-line-strong text-muted',
                    )}
                    aria-hidden
                  >
                    {at ? <Check className="size-4" /> : i + 1}
                  </span>
                  <Icon className="hidden size-5 shrink-0 text-muted sm:block" strokeWidth={1.8} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">
                      {s.title}
                      {at && <span className="sr-only"> (done)</span>}
                    </span>
                    <span className="block text-xs text-muted">{s.hint}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {at && <StepState at={at} />}
                    {isNext ? (
                      <span className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg">
                        {count === 0 ? 'Start' : 'Next'}
                      </span>
                    ) : (
                      <ChevronRight className="size-4 text-faint" aria-hidden />
                    )}
                  </span>
                </Link>
              </li>
            )
          })}
        </ol>
        {connected && vehicle && next === null && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-ok">
            <Check className="size-4" aria-hidden /> All four are done for this vehicle. Run one again after changing a motor, battery or
            throttle.
          </p>
        )}
      </section>

      <p className="mt-4 px-1 text-[13px] text-muted">
        Ride modes, regen, ABS and every setting are in{' '}
        <Link to="/tune" className="font-medium text-accent hover:underline">
          Tune
        </Link>
        .
      </p>
    </>
  )
}
