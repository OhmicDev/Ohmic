import { Link } from '@tanstack/react-router'
import { ArrowRight, Check, Wrench, X } from 'lucide-react'
import { useConfig } from '../../state/config'
import { nextStep, SETUP_ORDER, useSetupProgress, useStepsDone, useVehicleKey, type SetupStep } from '../../state/setupProgress'
import { buttonClass } from '../../ui/buttonClass'
import { countDone, STEPS } from './steps'

/**
 * The end of a setup step: says how far setup has got and leads on to the next step,
 * or to the dashboard once all are done.
 */
export function NextStep({ step }: { step: SetupStep }) {
  const done = useStepsDone(useVehicleKey())
  const next = nextStep(done, step)
  const count = countDone(done)
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {next
          ? `Setup: ${count} of ${SETUP_ORDER.length} steps done.`
          : 'All four setup steps are done. Try it gently with the wheel lifted first, then go for a short, slow ride.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {next ? (
          <Link to={STEPS[next].to} className={buttonClass('primary')}>
            Next: {STEPS[next].title} <ArrowRight className="size-4" />
          </Link>
        ) : (
          <Link to="/" className={buttonClass('primary')}>
            Go to Ride <ArrowRight className="size-4" />
          </Link>
        )}
        <Link to="/setup" className={buttonClass('ghost')}>
          Back to Setup
        </Link>
      </div>
    </div>
  )
}

/**
 * On the dashboard, until the vehicle is set up (or the rider says it already is):
 * the way into Setup, so it's one of the first things a new build sees.
 */
export function SetupPrompt() {
  const vehicle = useVehicleKey()
  const done = useStepsDone(vehicle)
  const dismissed = useSetupProgress((s) => (vehicle ? !!s.dismissed[vehicle] : true))
  const dismiss = useSetupProgress((s) => s.dismiss)
  // Firmware Ohmic only reads can't be set up from here.
  const readOnly = useConfig((s) => s.order.some((k) => s.devices[k]?.mcconf.status === 'readonly'))
  const next = nextStep(done)
  if (!vehicle || dismissed || readOnly || next === null) return null
  const count = countDone(done)
  return (
    <section aria-label="Setup" className="card flex flex-wrap items-center gap-x-4 gap-y-3 border-accent/30 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <Wrench className="size-5" strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-[180px] flex-1">
        <div className="text-sm font-semibold">
          {count === 0 ? 'New build or new parts? Set it up first' : `Setup: ${count} of ${SETUP_ORDER.length} steps done`}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          {count === 0 ? 'Motor detection, throttle and brake, direction and battery, one step at a time.' : `Next: ${STEPS[next].title}.`}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Link to={count === 0 ? '/setup' : STEPS[next].to} className={buttonClass('primary', 'h-9')}>
          {count === 0 ? 'Start setup' : 'Continue'}
        </Link>
        <button
          type="button"
          onClick={() => dismiss(vehicle)}
          className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs text-muted hover:bg-surface-3 hover:text-text"
          title="Stop showing this for this vehicle. Setup stays in the Setup tab."
        >
          <X className="size-3.5" aria-hidden /> It’s already set up
        </button>
      </div>
    </section>
  )
}

export function StepState({ at }: { at: number | undefined }) {
  if (!at) return null
  return (
    <span className="hidden items-center gap-1 text-xs text-ok sm:inline-flex">
      <Check className="size-3.5" aria-hidden /> Done {new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
    </span>
  )
}
