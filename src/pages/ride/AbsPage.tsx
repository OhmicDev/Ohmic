import { CloudRain, FlaskConical, Loader2, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cx } from '../../lib/format'
import { SLIP_DECEL, type AbsSensitivity } from '../../onboard/abs'
import { useConfig } from '../../state/config'
import { absIsOn, useAbs } from '../../state/onboard'
import { demoSkidTest, useSession } from '../../state/session'
import { useSettings } from '../../state/settings'
import { BackLink, Badge, Button, PageTitle, Segmented } from '../../ui/Primitives'
import { useNow } from '../../ui/useNow'
import { DemoPark } from '../config/LiveStrip'
import { AbsIntroDialog } from './AbsIntroDialog'
import { AbsTestDialog } from './AbsTestDialog'

const SENSITIVITY: { value: AbsSensitivity; label: string; help: string }[] = [
  { value: 'gentle', label: 'Gentle', help: 'Steps in only on a clear skid. Best on dry roads with grippy tyres.' },
  { value: 'normal', label: 'Normal', help: 'A balance for most riding.' },
  { value: 'sensitive', label: 'Sensitive', help: 'Steps in earlier. Better in the wet, but may ease braking during a hard stop on dry roads.' },
]

export function AbsPage() {
  const { status, busy, step, error, turnOn, turnOff, refresh } = useAbs()
  const sensitivity = useSettings((s) => s.absSensitivity)
  const setSensitivity = useSettings((s) => s.setAbsSensitivity)
  const acknowledged = useSettings((s) => s.absAcknowledged)
  const order = useConfig((s) => s.order)
  const devices = useConfig((s) => s.devices)
  const connected = useSession((s) => s.status === 'connected')
  const isDemo = useSession((s) => s.transportKind === 'mock')
  const [intro, setIntro] = useState(false)
  const [demoNote, setDemoNote] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const now = useNow(1000)
  const list = order.map((k) => devices[k]).filter(Boolean)
  const on = absIsOn(status, list)

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

  return (
    <>
      <BackLink to="/setup">Setup</BackLink>
      <PageTitle
        title="ABS"
        subtitle="Anti-lock for motor braking. When a wheel starts to skid, that motor’s braking eases for a moment so the tyre grips again."
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section className="card p-5">
          <div className="flex flex-wrap items-center gap-4">
            <span className={cx('flex size-12 items-center justify-center rounded-2xl', on ? 'bg-ok/15 text-ok' : 'bg-surface-3 text-muted')}>
              {on ? <ShieldCheck className="size-6" /> : <ShieldOff className="size-6" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold">{on ? 'ABS is on' : on === false ? 'ABS is off' : 'ABS status unknown'}</div>
              <div className="text-sm text-muted">
                {busy ? step : on ? 'Running on every motor controller.' : 'Turn it on while stopped. It switches off at power-off.'}
              </div>
            </div>
            <Button variant={on ? 'secondary' : 'primary'} disabled={busy || !connected} onClick={press}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {on ? 'Turn off' : 'Turn on'}
            </Button>
          </div>
          {error && <p className="mt-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn">{error}</p>}

          <div className="mt-4 overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-3 py-2 font-normal">Controller</th>
                  <th className="px-3 py-2 font-normal">State</th>
                  <th className="px-3 py-2 text-right font-normal">Brake releases</th>
                </tr>
              </thead>
              <tbody>
                {list.map((d) => {
                  const st = status[d.key]
                  return (
                    <tr key={d.key} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-2">{d.name}</td>
                      <td className="px-3 py-2">
                        {st?.on ? <Badge tone="accent">On</Badge> : st?.on === false ? <Badge>Off</Badge> : <span className="text-faint">Not checked</span>}
                        {st && <span className="ml-2 text-[11px] text-faint">{Math.max(0, Math.round((now - st.checkedAt) / 1000))} s ago</span>}
                      </td>
                      <td className="num px-3 py-2 text-right">{st?.on ? st.interventions : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="ghost" className="h-8 px-2.5 text-xs" disabled={busy || !connected} onClick={() => void refresh()}>
              <RefreshCw className="size-3.5" /> Check now
            </Button>
            <Button className="h-8 px-2.5 text-xs" disabled={!connected} onClick={() => setTesting(true)}>
              <FlaskConical className="size-3.5" /> Test ABS (wheel lifted)
            </Button>
            {isDemo && (
              <Button
                variant="ghost"
                className="h-8 px-2.5 text-xs"
                onClick={() => {
                  const ok = demoSkidTest()
                  setDemoNote(
                    ok
                      ? 'The demo rider brakes hard on a wet patch now. Watch the speed on the dashboard and the release count.'
                      : 'The demo scooter needs to be riding at over 15 km/h. Resume the ride if it’s parked, then try again.',
                  )
                }}
              >
                <CloudRain className="size-3.5" /> Demo: hard brake in the wet
              </Button>
            )}
            {isDemo && <DemoPark />}
          </div>
          {demoNote && <p className="mt-2 text-xs text-muted">{demoNote}</p>}
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold">Sensitivity</h2>
          <div className="mt-2">
            <Segmented label="ABS sensitivity" value={sensitivity} onChange={setSensitivity} options={SENSITIVITY.map((s) => ({ value: s.value, label: s.label }))} />
          </div>
          <p className="mt-2 text-sm text-muted">
            {SENSITIVITY.find((s) => s.value === sensitivity)?.help} It steps in when a wheel slows faster than {SLIP_DECEL[sensitivity]} m/s², which
            a tyre can’t do while gripping.
          </p>
          {on && <p className="mt-2 text-xs text-warn">Turn ABS off and on again to use a new sensitivity.</p>}

          <h2 className="mt-5 text-sm font-semibold">How it works</h2>
          <ul className="mt-1.5 space-y-1.5 text-sm leading-relaxed text-muted">
            <li>· A small program runs on each motor controller, 100 times a second, watching its own wheel.</li>
            <li>· On a skid it lowers that motor’s braking to 30 % for 80 ms, then ramps back over a quarter second.</li>
            <li>· Below 7 km/h it never interferes. One release lasts at most a second; then full braking returns.</li>
            <li>· It only changes motor braking, works with any brake input, and is never saved. Power off and it’s gone.</li>
            <li>· It needs firmware 6.00 or newer and the wheel size set in the motor settings.</li>
          </ul>
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
