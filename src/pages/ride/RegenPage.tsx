import { BatteryCharging, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cx } from '../../lib/format'
import { REGEN_LIMITS, regenSettingsProblem, STRENGTH_PCT, strengthPct, type RegenSettings, type RegenStrength } from '../../onboard/regen'
import { useConfig } from '../../state/config'
import { regenIsOn, regenPlan, useRegen } from '../../state/onboard'
import { useSession } from '../../state/session'
import { useSettings } from '../../state/settings'
import { BackLink, Button, PageTitle, Segmented } from '../../ui/Primitives'
import { DemoPark } from '../config/LiveStrip'

const STRENGTHS: { value: RegenStrength; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'custom', label: 'Custom' },
]

const same = (a: RegenSettings | null, b: RegenSettings) => !!a && (Object.keys(b) as (keyof RegenSettings)[]).every((k) => a[k] === b[k])

export function RegenPage() {
  const { status, busy, step, error, applied, turnOn, turnOff } = useRegen()
  const settings = useSettings((s) => s.regen)
  const acknowledged = useSettings((s) => s.regenAcknowledged)
  // Unknown only matters when this app left it on: it always starts off at power-on.
  const armed = useSettings((s) => s.regenArmed.length > 0)
  const connected = useSession((s) => s.status === 'connected')
  // The plan depends on every controller's settings.
  useConfig((s) => s.devices)
  const on = regenIsOn(status)
  const plan = connected ? regenPlan(settings) : null
  const total = Object.values(status).reduce((n, s) => n + (s.on ? s.engagements : 0), 0)
  const changed = !!on && !!applied && !same(applied, settings)

  // While on, keep the count fresh.
  useEffect(() => {
    if (!on || !connected) return
    const t = setInterval(() => {
      if (!useRegen.getState().busy) void useRegen.getState().refresh()
    }, 4000)
    return () => clearInterval(t)
  }, [on, connected])

  const press = () => {
    if (on) void turnOff()
    else {
      useSettings.getState().acknowledgeRegen()
      void turnOn()
    }
  }

  return (
    <>
      <BackLink to="/tune">Tune</BackLink>
      <PageTitle
        title="Regen"
        subtitle="One-pedal riding: let go of the throttle and the motors slow you down, charging the battery, the way an electric car does."
        actions={<DemoPark />}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="card space-y-4 p-5" aria-label="Regen on or off">
            <div className="flex flex-wrap items-center gap-4">
              <span className={cx('flex size-12 items-center justify-center rounded-2xl', on ? 'bg-ok/15 text-ok' : 'bg-accent/10 text-accent')}>
                {busy ? <Loader2 className="size-6 animate-spin" /> : <BatteryCharging className="size-6" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold">{busy ? (step ?? 'Working…') : on ? 'Regen is on' : on === null && connected && armed ? 'Checking…' : 'Regen is off'}</div>
                <div className="text-sm text-muted">
                  {on
                    ? total > 0
                      ? `It has slowed you ${total} time${total === 1 ? '' : 's'} since it was turned on.`
                      : 'Let go of the throttle while riding to feel it.'
                    : 'It always starts off when the vehicle is switched on.'}
                </div>
              </div>
              <Button variant={on ? 'secondary' : 'primary'} className="h-11" disabled={busy || !connected || (!on && !!plan && 'problem' in plan)} onClick={press}>
                {on ? 'Turn off' : acknowledged ? 'Turn on' : 'I understand, turn on'}
              </Button>
            </div>
            {changed && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-sm">
                <span>Your changes take effect once sent to the controller.</span>
                <Button variant="primary" className="h-9" disabled={busy} onClick={() => void turnOn()}>
                  Apply changes
                </Button>
              </div>
            )}
            {!connected && <p className="text-sm text-muted">Connect to your vehicle to turn regen on.</p>}
            {plan && 'problem' in plan && <p className="text-sm text-warn">{plan.problem}</p>}
            {plan && !('problem' in plan) && (
              <p className="text-sm text-muted">
                Runs on {plan.master.name}, which reads your {plan.source.label}
                {plan.followers.length > 0 && <>, and brakes {plan.followers.map((d) => d.name).join(' and ')} with it</>}. Up to{' '}
                <span className="num text-text">{plan.params.amps.toFixed(1)} A</span> of motor braking ({strengthPct(settings)} % of the motor braking limit).
              </p>
            )}
            {error && !busy && <p className="text-sm text-warn">{error}</p>}
          </section>

          <section className="card p-5 text-sm text-muted" aria-label="How it works">
            <h2 className="mb-2 text-sm font-semibold text-text">How it behaves</h2>
            <ul className="space-y-1.5">
              <li>• It starts once you let go of the throttle, and builds up smoothly rather than grabbing.</li>
              <li>• Touch the throttle or pull the brake lever and you’re straight back in control.</li>
              <li>• It fades out at low speed and never acts below 2 km/h, so you can always come to a stop.</li>
              <li>• It only acts after you’ve used the throttle, so a wheel spun on the bench is never braked.</li>
              <li>• With ABS on, a skidding wheel eases regen too.</li>
              <li>• A full battery takes less charge: the controller’s battery regen limit still applies, so regen can feel weaker when fully charged.</li>
              <li>• If the program on the controller ever stops, the throttle works normally again within 60 ms.</li>
            </ul>
          </section>
        </div>

        <RegenSettingsCard />
      </div>
    </>
  )
}

function RegenSettingsCard() {
  const settings = useSettings((s) => s.regen)
  const setRegen = useSettings((s) => s.setRegen)
  return (
    <section className="card h-fit space-y-5 p-5" aria-label="Regen settings">
      <h2 className="text-sm font-semibold">Settings</h2>
      <div>
        <div className="label mb-1.5">Strength</div>
        <Segmented<RegenStrength> label="Strength" value={settings.strength} onChange={(strength) => setRegen({ strength })} options={STRENGTHS} />
        <p className="mt-1.5 text-xs text-muted">
          {settings.strength === 'custom'
            ? 'Your own share of the motor braking current.'
            : `${STRENGTH_PCT[settings.strength]} % of the motor braking current. ${settings.strength === 'high' ? 'Strong enough to ride with one pedal most of the time.' : settings.strength === 'low' ? 'Like rolling off a petrol engine.' : 'A gentle slow-down, close to an electric car’s standard setting.'}`}
        </p>
        {settings.strength === 'custom' && <SettingField field="customPct" label="Custom strength" unit="%" hint="Share of the motor braking current at full regen." />}
      </div>
      <SettingField field="rampS" label="Builds up over" unit="s" hint="How long it takes to reach full strength after you let go. Longer feels softer." />
      <SettingField field="delayS" label="Starts after" unit="s" hint="A short pause after letting go, so a quick throttle blip doesn’t start it." />
      <SettingField field="fadeKmh" label="Fades out below" unit="km/h" hint="Below this speed it weakens gradually until it stops at 2 km/h." />
    </section>
  )
}

/** A number setting that's only kept when it's within range; anything else is shown as a problem, never trimmed. */
function SettingField({ field, label, unit, hint }: { field: keyof typeof REGEN_LIMITS; label: string; unit: string; hint: string }) {
  const value = useSettings((s) => s.regen[field])
  const [text, setText] = useState(String(value))
  const [error, setError] = useState<string | null>(null)
  const [lo, hi] = REGEN_LIMITS[field]
  const commit = (t: string) => {
    const v = Number(t.trim().replace(',', '.'))
    const next = { ...useSettings.getState().regen, [field]: v }
    const problem = t.trim() === '' ? 'Enter a value.' : regenSettingsProblem(next)
    if (problem) return setError(problem)
    setError(null)
    useSettings.getState().setRegen({ [field]: v })
  }
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <span className="block text-xs text-muted">{hint}</span>
      <span className="mt-1 flex items-center gap-2">
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            commit(e.target.value)
          }}
          aria-invalid={!!error}
          className="focus-ring num h-10 w-28 rounded-xl border border-line-strong bg-surface-2 px-3 text-right text-sm"
        />
        <span className="text-sm text-muted">{unit}</span>
        <span className="text-xs text-faint">
          {lo}–{hi}
        </span>
      </span>
      {error && <span className="mt-1 block text-sm text-warn">{error}</span>}
    </label>
  )
}
