import { BatteryCharging, ChevronDown, Loader2 } from 'lucide-react'
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
        subtitle="Let go of the throttle and the motors slow you down, charging the battery."
        actions={<DemoPark />}
      />
      <div className="grid gap-3 md:gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3 md:space-y-4">
          <section className="card space-y-4 p-4 md:p-5" aria-label="Regen on or off">
            <div className="flex flex-wrap items-center gap-4">
              <span className={cx('flex size-12 items-center justify-center rounded-2xl', on ? 'bg-ok/15 text-ok' : 'bg-accent/10 text-accent')}>
                {busy ? <Loader2 className="size-6 animate-spin" /> : <BatteryCharging className="size-6" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold">{busy ? (step ?? 'Working…') : on ? 'Regen is on' : on === null && connected && armed ? 'Checking…' : 'Regen is off'}</div>
                <div className="text-sm text-muted">
                  {on ? (total > 0 ? `Slowed you ${total} time${total === 1 ? '' : 's'}` : 'Let go of the throttle to feel it.') : 'Off at every power-up.'}
                </div>
              </div>
              <Button variant={on ? 'secondary' : 'primary'} className="h-11" disabled={busy || !connected || (!on && !!plan && 'problem' in plan)} onClick={press}>
                {on ? 'Turn off' : acknowledged ? 'Turn on' : 'I understand, turn on'}
              </Button>
            </div>
            {changed && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-sm">
                <span>New settings are ready.</span>
                <Button variant="primary" className="h-9" disabled={busy} onClick={() => void turnOn()}>
                  Apply
                </Button>
              </div>
            )}
            {!connected && <p className="text-sm text-muted">Connect to turn regen on.</p>}
            {plan && 'problem' in plan && <p className="text-sm text-warn">{plan.problem}</p>}
            {plan && !('problem' in plan) && (
              <dl className="grid grid-cols-3 gap-2 rounded-xl border border-line p-3 text-sm">
                <div className="min-w-0">
                  <dt className="label text-[9.5px]">Runs on</dt>
                  <dd className="mt-1 truncate">{plan.master.name}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="label text-[9.5px]">Reads</dt>
                  <dd className="mt-1 truncate">{plan.source.label}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="label text-[9.5px]">Braking</dt>
                  <dd className="num mt-1 truncate">
                    {plan.params.amps.toFixed(1)} A <span className="text-xs text-muted">{strengthPct(settings)} %</span>
                  </dd>
                </div>
                {plan.followers.length > 0 && (
                  <div className="col-span-3 min-w-0">
                    <dt className="label text-[9.5px]">Also brakes</dt>
                    <dd className="mt-1 truncate">{plan.followers.map((d) => d.name).join(', ')}</dd>
                  </div>
                )}
              </dl>
            )}
            {error && !busy && <p className="text-sm text-warn">{error}</p>}
          </section>

          <details className="group card">
            <summary className="focus-ring flex cursor-pointer list-none items-center gap-2 rounded-[var(--radius-card)] px-4 py-3.5 text-sm font-medium md:px-5 [&::-webkit-details-marker]:hidden">
              How it works
              <ChevronDown className="ml-auto size-4 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <ul className="space-y-1.5 border-t border-line px-4 py-3.5 text-[13px] leading-relaxed text-muted md:px-5">
              <li>Builds up smoothly after you let go. Never grabs.</li>
              <li>The throttle hands back at once; the brake lever within 30 ms.</li>
              <li>A sensor blip is ridden out, so it doesn’t pulse.</li>
              <li>Fades out at low speed. Never below 2 km/h.</li>
              <li>Only after the throttle was used, so a bench spin is never braked.</li>
              <li>Weaker on a full battery: the battery regen limit still applies.</li>
              <li>If the program stops, the throttle works again within 60 ms.</li>
            </ul>
          </details>
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
    <section className="card h-fit space-y-5 p-4 md:p-5" aria-label="Regen settings">
      <div>
        <div className="label mb-1.5">Strength</div>
        <Segmented<RegenStrength> label="Strength" value={settings.strength} onChange={(strength) => setRegen({ strength })} options={STRENGTHS} />
        <p className="mt-1.5 text-xs text-muted">
          {settings.strength === 'custom'
            ? 'Your own share of motor braking.'
            : `${STRENGTH_PCT[settings.strength]} % of motor braking. ${settings.strength === 'high' ? 'Nearly one-pedal.' : settings.strength === 'low' ? 'Like rolling off a petrol engine.' : 'Like an electric car.'}`}
        </p>
        {settings.strength === 'custom' && <SettingField field="customPct" label="Custom strength" unit="%" hint="Share of motor braking at full regen." />}
      </div>
      <SettingField field="rampS" label="Builds up over" unit="s" hint="Longer feels softer." />
      <SettingField field="delayS" label="Starts after" unit="s" hint="So a quick throttle blip doesn’t start it." />
      <SettingField field="fadeKmh" label="Fades out below" unit="km/h" hint="Weakens gradually down to 2 km/h." />
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
