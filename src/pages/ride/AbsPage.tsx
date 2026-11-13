import { ChevronDown, CloudRain, FlaskConical, Loader2, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cx } from '../../lib/format'
import { SLIP_DECEL, type AbsSensitivity } from '../../onboard/abs'
import { absIsOn, absSettingsKey, useAbs } from '../../state/onboard'
import { demoSkidTest, useSession } from '../../state/session'
import { useSettings } from '../../state/settings'
import { BackLink, Badge, Button, PageTitle, Segmented } from '../../ui/Primitives'
import { useNow } from '../../ui/useNow'
import { DemoPark } from '../config/LiveStrip'
import { useMotorDevices } from '../setup/helpers'
import { AbsIntroDialog } from './AbsIntroDialog'
import { AbsTestDialog } from './AbsTestDialog'

const SENSITIVITY: { value: AbsSensitivity; label: string; help: string }[] = [
  {
    value: 'gentle',
    label: 'Gentle',
    help: 'Only clear skids. Dry roads, grippy tyres.',
  },
  { value: 'normal', label: 'Normal', help: 'A balance for most riding.' },
  {
    value: 'sensitive',
    label: 'Sensitive',
    help: 'Steps in earlier. Best in the wet.',
  },
]

type Start = 'now' | 'later'
const STARTS: { value: Start; label: string }[] = [
  { value: 'now', label: 'Straight away' },
  { value: 'later', label: 'After letting go' },
]
const DELAYS = [0.2, 0.3, 0.5, 0.8]

export function AbsPage() {
  const { status, busy, step, error, applied, turnOn, turnOff, refresh } = useAbs()
  const sensitivity = useSettings((s) => s.absSensitivity)
  const afterRelease = useSettings((s) => s.absAfterRelease)
  const delay = useSettings((s) => s.absDelayS)
  const acknowledged = useSettings((s) => s.absAcknowledged)
  const list = useMotorDevices()
  const connected = useSession((s) => s.status === 'connected')
  const isDemo = useSession((s) => s.transportKind === 'mock')
  const [intro, setIntro] = useState(false)
  const [demoNote, setDemoNote] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const now = useNow(1000)
  const on = absIsOn(status)
  const total = Object.values(status).reduce((n, s) => n + (s.on ? s.interventions : 0), 0)
  // Settings changed since ABS was turned on take a restart: offer it.
  const changed = !!on && applied !== null && applied !== absSettingsKey()

  // While on, keep the count of brake releases fresh.
  useEffect(() => {
    if (!on || !connected) return
    const t = setInterval(() => {
      if (!useAbs.getState().busy) void useAbs.getState().refresh()
    }, 4000)
    return () => clearInterval(t)
  }, [on, connected])

  const press = () => {
    if (on) void turnOff()
    else if (!acknowledged) setIntro(true)
    else void turnOn()
  }
  const s = useSettings.getState()

  return (
    <>
      <BackLink to="/features">Features</BackLink>
      <PageTitle title="ABS" subtitle="Eases motor braking for a moment when a wheel skids." actions={isDemo ? <DemoPark /> : undefined} />

      <div className="grid gap-3 md:gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section className="card p-4 md:p-5" aria-label="ABS on or off">
          <div className="flex flex-wrap items-center gap-4">
            <span className={cx('flex size-12 items-center justify-center rounded-2xl', on ? 'bg-ok/15 text-ok' : 'bg-surface-3 text-muted')}>
              {busy ? <Loader2 className="size-6 animate-spin" /> : on ? <ShieldCheck className="size-6" /> : <ShieldOff className="size-6" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold">{busy ? (step ?? 'Working…') : on ? 'ABS is on' : on === false ? 'ABS is off' : 'ABS'}</div>
              <div className="text-sm text-muted">
                {on ? `${total} brake release${total === 1 ? '' : 's'}` : 'Turn on while stopped. Off at power-off.'}
              </div>
            </div>
            <Button variant={on ? 'secondary' : 'primary'} className="h-11" disabled={busy || !connected} onClick={press}>
              {on ? 'Turn off' : 'Turn on'}
            </Button>
          </div>
          {changed && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-sm">
              <span>New settings are ready.</span>
              <Button variant="primary" className="h-9" disabled={busy} onClick={() => void turnOn()}>
                Apply
              </Button>
            </div>
          )}
          {!connected && <p className="mt-3 text-sm text-muted">Connect to turn ABS on.</p>}
          {error && <p className="mt-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn">{error}</p>}

          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line">
            {list.map((d) => {
              const st = status[d.key]
              return (
                <li key={d.key} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  {st && <span className="num text-[11px] text-faint">{Math.max(0, Math.round((now - st.checkedAt) / 1000))} s ago</span>}
                  {st?.on ? <Badge tone="ok">On · {st.interventions}</Badge> : st?.on === false ? <Badge>Off</Badge> : <Badge>—</Badge>}
                </li>
              )
            })}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="ghost" className="h-8 px-2.5 text-xs" disabled={busy || !connected} onClick={() => void refresh()}>
              <RefreshCw className="size-3.5" /> Check
            </Button>
            <Button className="h-8 px-2.5 text-xs" disabled={!connected} onClick={() => setTesting(true)}>
              <FlaskConical className="size-3.5" /> Test, wheel lifted
            </Button>
            {isDemo && (
              <Button
                variant="ghost"
                className="h-8 px-2.5 text-xs"
                onClick={() =>
                  setDemoNote(
                    demoSkidTest() ? 'Braking hard on a wet patch now. Watch the release count.' : 'Get the demo riding above 15 km/h first.',
                  )
                }
              >
                <CloudRain className="size-3.5" /> Demo: wet brake
              </Button>
            )}
          </div>
          {demoNote && <p className="mt-2 text-xs text-muted">{demoNote}</p>}
        </section>

        <section className="card space-y-5 p-4 md:p-5" aria-label="ABS settings">
          <div>
            <div className="label mb-2">Sensitivity</div>
            <Segmented
              label="ABS sensitivity"
              value={sensitivity}
              onChange={s.setAbsSensitivity}
              options={SENSITIVITY.map(({ value, label }) => ({
                value,
                label,
              }))}
            />
            <p className="mt-1.5 text-xs text-muted">
              {SENSITIVITY.find((x) => x.value === sensitivity)?.help} <span className="num text-faint">Skid at {SLIP_DECEL[sensitivity]} m/s²</span>
            </p>
          </div>
          <div>
            <div className="label mb-2">Starts</div>
            <Segmented<Start>
              label="ABS starts"
              value={afterRelease ? 'later' : 'now'}
              onChange={(v) => s.setAbsAfterRelease(v === 'later')}
              options={STARTS}
            />
            <p className="mt-1.5 text-xs text-muted">
              {afterRelease
                ? 'Waits until you’ve been braking a moment, so regen kicking in isn’t taken for a skid.'
                : 'Acts the moment braking starts.'}
            </p>
            {afterRelease && (
              <div className="mt-3">
                <div className="label mb-2">Wait</div>
                <Segmented<number>
                  label="ABS wait"
                  value={delay}
                  onChange={s.setAbsDelayS}
                  options={DELAYS.map((d) => ({ value: d, label: `${d} s` }))}
                />
              </div>
            )}
          </div>

          <details className="group rounded-xl border border-line">
            <summary className="focus-ring flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
              How it works
              <ChevronDown className="ml-auto size-4 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <ul className="space-y-1.5 border-t border-line px-3 py-3 text-[13px] leading-relaxed text-muted">
              <li>Runs on each controller, 100 times a second.</li>
              <li>On a skid: braking drops to 30 % for 80 ms, then ramps back.</li>
              <li>Never below 7 km/h. One release lasts 1 s at most.</li>
              <li>Motor braking only, never saved. Needs firmware 6.00+ and the wheel size set.</li>
            </ul>
          </details>
        </section>
      </div>

      <AbsTestDialog open={testing} onClose={() => setTesting(false)} />
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
