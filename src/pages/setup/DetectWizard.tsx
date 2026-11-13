import { Link } from '@tanstack/react-router'
import { Check, Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ConfigValues } from '../../config/types'
import { cx, fmt } from '../../lib/format'
import { DETECT_PRESETS, detectIssues, kvFromFlux, type DetectInput } from '../../lib/setupMath'
import { pendingCount, useConfig, type DeviceConfig } from '../../state/config'
import { changedSince, useDetection } from '../../state/detection'
import { markSetupDone } from '../../state/setupProgress'
import { targetKey } from '../../state/devices'
import { useMotionBlock } from '../../state/motion'
import { absIsOn, useAbs } from '../../state/onboard'
import { useSession } from '../../state/session'
import { useTelemetry } from '../../state/telemetry'
import { Button, PageTitle } from '../../ui/Primitives'
import { buttonClass } from '../../ui/buttonClass'
import { DemoPark } from '../config/LiveStrip'
import { WriteDialog } from '../config/WriteDialog'
import { BackToSetup, NotReady, NumberField, Steps } from './common'
import { NextStep } from './SetupSteps'
import { toNum, useMotorDevices } from './helpers'

const HOLD_MS = 1500
const DETECT_STEPS = ['Settings', 'Measure', 'Check the result']
const SENSORS: Record<number, string> = { 0: 'None (sensorless)', 1: 'Encoder', 2: 'Hall sensors', 3: 'HFI (sensorless)' }
const MOTOR_TYPES: Record<number, string> = { 0: 'BLDC', 1: 'DC', 2: 'FOC', 3: 'GPD' }

/** Rows of the before/after comparison. */
const ROWS: { label: string; get: (v: ConfigValues) => string }[] = [
  { label: 'Motor type', get: (v) => MOTOR_TYPES[Number(v.motor_type)] ?? String(v.motor_type ?? '—') },
  { label: 'Resistance', get: (v) => `${fmt(Number(v.foc_motor_r) * 1000, 1)} mΩ` },
  { label: 'Inductance', get: (v) => `${fmt(Number(v.foc_motor_l) * 1e6, 1)} µH` },
  { label: 'Flux linkage', get: (v) => `${fmt(Number(v.foc_motor_flux_linkage) * 1000, 2)} mWb` },
  {
    label: 'KV (from flux)',
    get: (v) => {
      const kv = kvFromFlux(Number(v.foc_motor_flux_linkage), Number(v.si_motor_poles))
      return kv === null ? '—' : `${fmt(kv, 1)} rpm/V`
    },
  },
  { label: 'Position sensor', get: (v) => SENSORS[Number(v.foc_sensor_mode)] ?? `Other (${String(v.foc_sensor_mode)})` },
  {
    label: 'Hall table',
    get: (v) => (v.foc_hall_table__0 === undefined ? '—' : Array.from({ length: 8 }, (_, i) => String(v[`foc_hall_table__${i}`])).join(' ')),
  },
  { label: 'Current gains (Kp / Ki)', get: (v) => `${fmt(Number(v.foc_current_kp), 4)} / ${fmt(Number(v.foc_current_ki), 2)}` },
  { label: 'Observer gain', get: (v) => fmt(Number(v.foc_observer_gain), 0) },
  { label: 'Motor current', get: (v) => `${fmt(Number(v.l_current_max), 1)} A` },
  { label: 'Motor braking current', get: (v) => `${fmt(Number(v.l_current_min), 1)} A` },
  { label: 'Battery current', get: (v) => `${fmt(Number(v.l_in_current_max), 1)} A` },
  { label: 'Battery regen current', get: (v) => `${fmt(Number(v.l_in_current_min), 1)} A` },
]

export function DetectWizard() {
  const list = useMotorDevices()
  const phase = useDetection((s) => s.phase)
  const ready = list.length > 0 && list.every((d) => d.mcconf.status === 'ready')
  if (phase === 'running') return <Running />
  if (phase === 'done') return <Result />
  if (!ready) return <NotReady title="Motor detection" what="detect the motor" list={list} />
  return <DetectSetup list={list} />
}

function DetectSetup({ list }: { list: DeviceConfig[] }) {
  const isDemo = useSession((s) => s.transportKind === 'mock')
  const [scope, setScope] = useState<string>(list.length > 1 ? 'all' : list[0].key)
  const chosen = scope === 'all' ? list : list.filter((d) => d.key === scope)
  const first = chosen[0] ?? list[0]
  const mc = first.mcconf.device!
  const [preset, setPreset] = useState<string>(DETECT_PRESETS[0].id)
  const p = DETECT_PRESETS.find((x) => x.id === preset) ?? DETECT_PRESETS[0]
  const [loss, setLoss] = useState(String(p.maxPowerLoss))
  const [openloop, setOpenloop] = useState(String(p.openloopErpm))
  const [sensorless, setSensorless] = useState(String(p.sensorlessErpm))
  const [inMax, setInMax] = useState(() => String(Math.round(Number(mc.l_in_current_max)) || 20))
  const [inMin, setInMin] = useState(() => String(Math.round(Math.abs(Number(mc.l_in_current_min))) || 10))
  const [lifted, setLifted] = useState(false)
  const motion = useMotionBlock(
    chosen.map((d) => d.target),
    'detect the motor',
  )
  const absOn = useAbs((s) => absIsOn(s.status, chosen))
  const pending = chosen.some((d) => pendingCount(d.mcconf) > 0)

  const pickPreset = (id: string) => {
    const x = DETECT_PRESETS.find((q) => q.id === id) ?? DETECT_PRESETS[0]
    setPreset(id)
    setLoss(String(x.maxPowerLoss))
    setOpenloop(String(x.openloopErpm))
    setSensorless(String(x.sensorlessErpm))
  }

  const input: DetectInput = {
    maxPowerLoss: toNum(loss),
    maxCurrentIn: toNum(inMax),
    minCurrentIn: -Math.abs(toNum(inMin)),
    openloopErpm: toNum(openloop),
    sensorlessErpm: toNum(sensorless),
  }
  const issues = detectIssues(input)
  const blocker = issues.length
    ? null
    : pending
      ? 'There are motor-setting edits that aren’t written yet. Write or discard them in Tune first.'
      : absOn
        ? 'ABS is on. Turn it off first: it changes the braking settings while it runs.'
        : motion
  const canStart = !issues.length && !blocker && lifted

  const start = () => {
    // "All at once" runs on the controller you're connected to, which passes it on over CAN.
    const all = scope === 'all' && list.length > 1
    void useDetection.getState().run({ ...input, detectCan: all }, all ? 'local' : first.target, chosen.map((d) => d.key))
  }

  return (
    <>
      <BackToSetup />
      <PageTitle title="Motor detection" subtitle="Measures each motor and sets it up. About a minute each." />
      <Steps steps={DETECT_STEPS} at={0} />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section className="card space-y-4 p-5">
          {list.length > 1 && (
            <div>
              <div className="text-sm font-medium">Which motors?</div>
              <div role="radiogroup" className="mt-1.5 flex flex-wrap gap-1.5">
                {[{ key: 'all', name: `All ${list.length} at once` }, ...list].map((d) => (
                  <button
                    key={d.key}
                    role="radio"
                    aria-checked={scope === d.key}
                    onClick={() => setScope(d.key)}
                    className={cx('focus-ring h-9 rounded-lg border px-3 text-sm', scope === d.key ? 'border-accent/50 bg-accent/10' : 'border-line-strong text-muted hover:text-text')}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
              {scope === 'all' && <p className="mt-1.5 text-xs text-muted">The controller you’re connected to runs detection on the others over CAN, one after another.</p>}
            </div>
          )}
          <div>
            <div className="text-sm font-medium">What kind of motor?</div>
            <div role="radiogroup" className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              {DETECT_PRESETS.map((x) => (
                <button
                  key={x.id}
                  role="radio"
                  aria-checked={preset === x.id}
                  onClick={() => pickPreset(x.id)}
                  className={cx('focus-ring rounded-lg border px-3 py-2 text-left text-sm', preset === x.id ? 'border-accent/50 bg-accent/10' : 'border-line-strong text-muted hover:text-text')}
                >
                  {x.label}
                </button>
              ))}
            </div>
          </div>
          <NumberField label="Most power the motor may turn into heat" unit="W" value={loss} onChange={setLoss} hint="Sets the motor current limit. Bigger motors take more." />
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField label="Battery current" unit="A" value={inMax} onChange={setInMax} hint="Per controller, while measuring and after." />
            <NumberField label="Battery regen current" unit="A" value={inMin} onChange={setInMin} hint="Per controller." />
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Spin-up speeds</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <NumberField label="Open-loop speed" unit="ERPM" value={openloop} onChange={setOpenloop} />
              <NumberField label="Sensorless from" unit="ERPM" value={sensorless} onChange={setSensorless} />
            </div>
          </details>
          {issues.length > 0 && (
            <ul className="space-y-1 text-sm text-danger">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="card space-y-4 p-5">
          <div className="flex gap-3 rounded-xl border border-warn/30 bg-warn/5 p-3.5 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
            <div>
              <div className="font-semibold text-warn">The wheel will spin on its own</div>
              <p className="mt-0.5 text-muted">
                The motor beeps, then spins up and slows down a few times. Once started it can’t be stopped from the app: to stop it, switch
                the power off.
              </p>
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={lifted} onChange={(e) => setLifted(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            The {chosen.length > 1 ? 'wheels are' : 'wheel is'} off the ground and free to spin, and nothing is touching {chosen.length > 1 ? 'them' : 'it'}.
          </label>
          {isDemo && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <DemoPark /> The demo scooter must be parked first.
            </div>
          )}
          {blocker && (
            <p className="text-sm text-warn">
              {blocker}
              {absOn && !pending && (
                <>
                  {' '}
                  <Link to="/abs" className="underline underline-offset-2">
                    ABS
                  </Link>
                </>
              )}
            </p>
          )}
          <p className="text-xs text-muted">
            A backup of the current settings is saved first. When it’s done you’ll see what changed and can put the old settings back.
          </p>
          <HoldToStart disabled={!canStart} onStart={start} label="Hold to start detection" />
          {!blocker && !issues.length && !lifted && (
            <p className="text-xs text-muted">Tick the box above once the {chosen.length > 1 ? 'wheels are' : 'wheel is'} off the ground.</p>
          )}
          {issues.length > 0 && <p className="text-xs text-muted">Fix the values marked in red first.</p>}
        </section>
      </div>
    </>
  )
}

function HoldToStart({ disabled, onStart, label }: { disabled: boolean; onStart: () => void; label: string }) {
  const [progress, setProgress] = useState(0)
  const frame = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const began = useRef(0)
  const startRef = useRef(onStart)
  useEffect(() => {
    startRef.current = onStart
  })
  const clear = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    if (timer.current !== null) clearTimeout(timer.current)
    frame.current = null
    timer.current = null
  }
  const cancel = () => {
    clear()
    setProgress(0)
  }
  const begin = () => {
    if (disabled || timer.current !== null) return
    began.current = performance.now()
    // A timer starts it; animation frames only draw the progress (they pause in background tabs).
    timer.current = setTimeout(() => {
      cancel()
      startRef.current()
    }, HOLD_MS)
    const tick = () => {
      setProgress(Math.min(1, (performance.now() - began.current) / HOLD_MS))
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }
  useEffect(() => clear, [])
  return (
    <button
      disabled={disabled}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        begin()
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault()
          begin()
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') cancel()
      }}
      onBlur={cancel}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'none' }}
      className="focus-ring relative h-14 w-full overflow-hidden rounded-2xl border border-accent/50 bg-accent/10 text-base font-semibold select-none disabled:opacity-40"
    >
      <span className="absolute inset-y-0 left-0 bg-accent/30" style={{ width: `${progress * 100}%` }} />
      <span className="relative">{progress > 0 ? 'Keep holding…' : label}</span>
    </button>
  )
}

function Running() {
  const step = useDetection((s) => s.step)
  const startedAt = useDetection((s) => s.startedAt)
  const keys = useDetection((s) => s.keys)
  const devices = useConfig((s) => s.devices)
  const live = useTelemetry((s) => s.devices)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => {
      clearInterval(t)
      window.removeEventListener('beforeunload', warn)
    }
  }, [])
  return (
    <>
      <PageTitle title="Motor detection" subtitle="Keep clear of the wheel until this finishes." />
      <Steps steps={DETECT_STEPS} at={1} />
      <section className="card space-y-4 p-5" aria-live="polite">
        <div className="flex items-center gap-3">
          <Loader2 className="size-6 animate-spin text-accent" />
          <div>
            <div className="text-base font-semibold">{step}</div>
            <div className="num text-sm text-muted">{Math.max(0, Math.floor((now - startedAt) / 1000))} s</div>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {keys.map((k) => {
            const d = devices[k]
            const v = d ? live[targetKey(d.target)] : undefined
            return (
              <div key={k} className="rounded-xl border border-line p-3 text-sm">
                <div className="font-medium">{d?.name ?? k}</div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-muted">
                  <span>
                    Motor <span className="num text-text">{fmt(v?.currentMotor, 1)}</span> A
                  </span>
                  <span>
                    Speed <span className="num text-text">{fmt(v ? Math.abs(v.rpm) : null, 0)}</span> ERPM
                  </span>
                </div>
              </div>
            )
          })}
        </div>
        <p className="flex items-center gap-2 text-sm text-warn">
          <TriangleAlert className="size-4 shrink-0" /> To stop it, switch the power off. The app can’t interrupt detection.
        </p>
      </section>
    </>
  )
}

function Result() {
  const { result, error, note, before, keys, reset } = useDetection()
  const devices = useConfig((s) => s.devices)
  const [restoring, setRestoring] = useState(false)
  const [restored, setRestored] = useState(false)
  const rows = before.map((b) => {
    const d = devices[b.key]
    const now = d?.mcconf.status === 'ready' ? d.mcconf.device : null
    return { b, d, now, changed: now ? changedSince(b.values, now) : {} }
  })
  const anyChanged = rows.some((r) => Object.keys(r.changed).length > 0)
  const pending = rows.some((r) => r.d && pendingCount(r.d.mcconf) > 0)
  const ok = !!result?.ok && !restored
  useEffect(() => {
    if (result?.ok) markSetupDone('motor')
  }, [result])

  const restore = () => {
    const cfg = useConfig.getState()
    for (const r of rows) if (Object.keys(r.changed).length) cfg.edit(r.b.key, 'mcconf', r.changed)
    setRestoring(true)
  }

  return (
    <>
      <BackToSetup />
      <PageTitle title="Motor detection" subtitle="Compare what was measured with what was set before." />
      <Steps steps={DETECT_STEPS} at={2} />
      <section className="card space-y-4 p-5">
        {error && <p className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
        {result && !result.ok && <p className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm text-warn">{result.message}</p>}
        {result?.ok && (
          <p className="flex items-center gap-2 text-sm text-ok">
            <Check className="size-4" /> Detection finished.{' '}
            {result.sensor === 'hall' ? 'Hall sensors were found and set up.' : result.sensor === 'encoder' ? 'An encoder was found.' : 'No position sensors: it runs sensorless.'}
          </p>
        )}
        {note && <p className="text-sm text-warn">{note}</p>}
        {restored && <p className="text-sm text-ok">The old settings are back.</p>}

        {rows.map(({ b, d, now, changed }) => (
          <div key={b.key}>
            <h2 className="mb-1.5 text-sm font-semibold">{d?.name ?? b.key}</h2>
            {!now ? (
              <p className="text-sm text-muted">The new settings couldn’t be read back. Check them in Tune before riding.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="py-1 font-normal">Setting</th>
                      <th className="py-1 text-right font-normal">Before</th>
                      <th className="py-1 text-right font-normal">Now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((row) => {
                      const was = row.get(b.values)
                      const is = row.get(now)
                      return (
                        <tr key={row.label} className="border-t border-line">
                          <td className="py-1.5 text-muted">{row.label}</td>
                          <td className="num py-1.5 text-right text-muted">{was}</td>
                          <td className={cx('num py-1.5 text-right', was !== is && 'font-semibold text-accent')}>{is}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <p className="mt-1 text-xs text-faint">{Object.keys(changed).length} setting(s) differ from the backup in total.</p>
              </div>
            )}
          </div>
        ))}

        {pending && <p className="text-xs text-warn">There are motor-setting edits waiting in Tune; write or discard them before putting the old settings back.</p>}
        {ok ? (
          <NextStep step="motor" />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={reset}>
              {restored ? 'Run detection again' : 'Try again'}
            </Button>
            <Link to="/setup" className={buttonClass('ghost')}>
              Back to Setup
            </Link>
          </div>
        )}
        {ok && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {anyChanged && (
              <Button disabled={pending} onClick={restore}>
                Put the old settings back
              </Button>
            )}
            <Button variant="ghost" onClick={reset}>
              Run detection again
            </Button>
          </div>
        )}
        <p className="text-xs text-muted">
          A backup from just before detection is in{' '}
          <Link to="/config/backups" className="underline underline-offset-2">
            Backups
          </Link>
          .
        </p>
      </section>
      {restoring && keys.length > 0 && (
        <WriteDialog
          open
          deviceKey={keys[0]}
          deviceKeys={keys}
          kind="mcconf"
          onClose={() => {
            setRestoring(false)
            const cfg = useConfig.getState()
            const done = keys.every((k) => pendingCount(cfg.devices[k]?.mcconf) === 0)
            // Not written: drop the restore edits so they don't linger in Config.
            if (!done) for (const k of keys) cfg.discard(k, 'mcconf')
            setRestored(done)
          }}
        />
      )}
    </>
  )
}
