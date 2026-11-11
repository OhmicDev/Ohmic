import { Check, ChevronDown, Loader2, RotateCcw, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { cx } from '../../lib/format'
import { convertSpeed, unitLabels } from '../../lib/vehicle'
import {
  WHEELIE_DEFAULTS,
  WHEELIE_FIELDS,
  WHEELIE_GROUPS,
  WHEELIE_REASONS,
  WHEELIE_STATES,
  WHEELIE_VERSION,
  wheelieSettingsKey,
  wheelieSettingsProblems,
  type WheelieField,
  type WheelieGroup,
  type WheelieSettings,
  type WheelieTelemetry,
} from '../../onboard/wheelie'
import { motorDevices, useConfig } from '../../state/config'
import { useSession } from '../../state/session'
import { useSettings } from '../../state/settings'
import { useWheelie, wheelieLimitsProblems, wheeliePlan, wheelieSettings, type CalStep } from '../../state/wheelie'
import { Dialog } from '../../ui/Dialog'
import { BackLink, Badge, Button, PageTitle, Segmented } from '../../ui/Primitives'
import { Tabs } from '../../ui/Tabs'
import { Toggle } from '../../ui/Toggle'
import { useNow } from '../../ui/useNow'
import { DemoPark } from '../config/LiveStrip'

/** The newest live packet, if it's recent. */
function useLatest(now: number): WheelieTelemetry | null {
  const last = useWheelie((s) => s.live.at(-1))
  return last && now - last.at < 1500 ? last.t : null
}

export function WheeliePage() {
  const connected = useSession((s) => s.status === 'connected')
  useConfig((s) => s.devices)
  useSettings((s) => s.wheelieHostWheel)
  const plan = connected ? wheeliePlan() : null
  const ok = !!plan && !('problem' in plan)
  const armed = useWheelie((s) => !!s.status && s.status !== 'missing' && s.status.on)
  const calOpen = useWheelie((s) => !!s.cal)

  // Keep the status (and, while armed, the live data) coming.
  useEffect(() => {
    if (!ok) return
    const tick = () => {
      if (!useWheelie.getState().busy && !useWheelie.getState().cal) void useWheelie.getState().refresh()
    }
    tick()
    const t = setInterval(tick, armed ? 3000 : 6000)
    return () => clearInterval(t)
  }, [ok, armed])

  return (
    <>
      <BackLink to="/tune">Tune</BackLink>
      <PageTitle
        title="Auto-wheelie"
        subtitle="Pin the throttle and lean back: it lifts the front and holds it. Lean forward to go faster, back to slow down. Let go to land."
        actions={<DemoPark />}
      />
      <div className="grid gap-3 md:gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3 md:space-y-4">
          <StatusCard />
          <LiveCard />
          <CalibrationCard />
          <SafetyCard />
          <ProgramCard />
        </div>
        <SettingsCard />
      </div>
      {calOpen && <CalibrationDialog />}
      <ReplaceDialog />
    </>
  )
}

// ---- On / off ----

function StatusCard() {
  const { status, busy, step, progress, error, notice, armedWith, arm, disarm, install, startCal } = useWheelie()
  const connected = useSession((s) => s.status === 'connected')
  const hostWheel = useSettings((s) => s.wheelieHostWheel)
  const acknowledged = useSettings((s) => s.wheelieAcknowledged)
  const userSettings = useSettings((s) => s.wheelie)
  const cals = useSettings((s) => s.wheelieCal)
  const now = useNow(500)
  const live = useLatest(now)
  const [safety, setSafety] = useState(false)
  const plan = connected ? wheeliePlan() : null
  const two = connected && motorDevices().length === 2
  const host = plan && !('problem' in plan) ? plan.host : null
  const cal = host ? cals[host.key] : undefined
  const st = status && status !== 'missing' ? status : null
  const on = !!st?.on
  const state = live?.state ?? st?.state ?? 0
  const outdated = !!st && st.version !== WHEELIE_VERSION
  const changed = on && !!armedWith && armedWith !== wheelieSettingsKey({ ...WHEELIE_DEFAULTS, ...userSettings })
  const reason = live?.reason ?? st?.reason ?? 0

  const title = busy
    ? (step ?? 'Working…')
    : !connected
      ? 'Not connected'
      : status === null
        ? plan && !('problem' in plan)
          ? 'Checking…'
          : 'Not set up'
        : status === 'missing'
          ? 'Not installed'
          : outdated
            ? 'An older version is installed'
            : on
              ? WHEELIE_STATES[state]
              : 'Disarmed'
  const sub = !connected
    ? 'Connect to set it up.'
    : on
      ? live?.dry
        ? 'Dry run: it never drives the motors.'
        : state === 1
          ? 'Roll along, lean back and pin the throttle.'
          : `${live ? `${live.pitch.toFixed(1)}° · ` : ''}${st?.count ?? 0} so far`
      : status === 'missing'
        ? 'Install it on the controller first.'
        : status === null
          ? 'Ohmic asks the controller once it knows where it runs.'
          : 'Disarmed at every power-up.'

  const press = () => {
    if (on) return void disarm()
    if (status === 'missing' || outdated) return void install()
    if (!cal) return startCal()
    if (!acknowledged) return setSafety(true)
    void arm()
  }
  const label = on ? 'Disarm' : status === null ? 'Arm' : status === 'missing' ? 'Install' : outdated ? 'Update' : !cal ? 'Calibrate first' : 'Arm'

  return (
    <section className="card space-y-4 p-4 md:p-5" aria-label="Auto-wheelie on or off">
      <div className="flex flex-wrap items-center gap-4">
        <span className={cx('flex size-12 items-center justify-center rounded-2xl', on ? 'bg-ok/15 text-ok' : 'bg-accent/10 text-accent')}>
          {busy ? <Loader2 className="size-6 animate-spin" /> : <WheelieIcon className="size-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold" aria-live="polite">
            {title}
            {busy && progress !== null && <span className="num ml-2 text-sm text-muted">{Math.round(progress * 100)} %</span>}
          </div>
          <div className="text-sm text-muted">{sub}</div>
        </div>
        <Button
          variant={on ? 'secondary' : 'primary'}
          className={cx('h-11', on && 'min-w-28')}
          disabled={busy || !connected || (!on && (!plan || 'problem' in plan || status === null))}
          onClick={press}
        >
          {label}
        </Button>
      </div>

      {two && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">The controller that reads the throttle drives the</span>
          <Segmented<'rear' | 'front' | 'unset'>
            label="Wheel the throttle controller drives"
            value={hostWheel ?? 'unset'}
            onChange={(w) => w !== 'unset' && useSettings.getState().setWheelieHostWheel(w)}
            options={[
              { value: 'rear', label: 'Rear wheel' },
              { value: 'front', label: 'Front wheel' },
            ]}
          />
        </div>
      )}

      {changed && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-sm">
          <span>Changed settings aren’t on the scooter yet.</span>
          <Button variant="primary" className="h-9" disabled={busy} onClick={() => void arm()}>
            Send them
          </Button>
        </div>
      )}

      {plan && 'problem' in plan && <p className="text-sm text-warn">{plan.problem}</p>}
      {plan && !('problem' in plan) && (
        <dl className="grid grid-cols-3 gap-2 rounded-xl border border-line p-3 text-sm">
          <Where label="Runs on" name={plan.host.name} />
          <Where label="Rear" name={plan.rear.name} />
          <Where label="Front" name={plan.front?.name ?? null} />
        </dl>
      )}
      {reason > 0 && !busy && (
        <p className="text-sm text-muted">
          <span className="font-medium text-text">Last stop:</span> {WHEELIE_REASONS[reason] ?? `Reason ${reason}.`}
        </p>
      )}
      {error && !busy && <p className="text-sm text-warn">{error}</p>}
      {notice && !busy && !error && <p className="text-sm text-ok">{notice}</p>}

      <Dialog
        open={safety}
        onClose={() => setSafety(false)}
        title="Before your first wheelie"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setSafety(false)}>Not yet</Button>
            <Button
              variant="primary"
              onClick={() => {
                setSafety(false)
                useSettings.getState().acknowledgeWheelie()
                void arm()
              }}
            >
              I understand, arm it
            </Button>
          </div>
        }
      >
        <SafetyPoints />
      </Dialog>
    </section>
  )
}

/** A controller by where it is ("Local", "CAN 2"), with its hardware under it. */
function Where({ label, name }: { label: string; name: string | null }) {
  const [hw, where] = name ? (name.includes(' · ') ? name.split(' · ') : [name, name]) : ['', 'No motor']
  return (
    <div className="min-w-0" title={name ?? undefined}>
      <dt className="label text-[9.5px]">{label}</dt>
      <dd className="mt-1 truncate">{where}</dd>
      {hw && hw !== where && <dd className="truncate text-xs text-faint">{hw}</dd>}
    </div>
  )
}

function WheelieIcon({ className }: { className?: string }) {
  // A scooter with its front wheel up.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="5.5" cy="17.5" r="2.5" />
      <circle cx="18" cy="11" r="2.5" />
      <path d="M8 17.5 16 13.5" />
      <path d="M16.5 9 13 2.5h2.5" />
    </svg>
  )
}

// ---- Live ----

function LiveCard() {
  const now = useNow(100)
  const live = useWheelie((s) => s.live)
  const units = useSettings((s) => s.units)
  const target = useSettings((s) => s.wheelie.target ?? WHEELIE_DEFAULTS.target)
  const maxAngle = useSettings((s) => s.wheelie.maxAngle ?? WHEELIE_DEFAULTS.maxAngle)
  const latest = useLatest(now)
  if (!latest) return null
  const u = unitLabels(units)
  const cells: { label: string; value: string; unit?: string }[] = [
    { label: 'Speed', value: convertSpeed(latest.speed * 3.6, units).toFixed(1), unit: u.speed },
    { label: 'Rear', value: latest.rear.toFixed(0), unit: 'A' },
    { label: 'Front', value: latest.front.toFixed(0), unit: 'A' },
    { label: 'Throttle', value: (latest.throttle * 100).toFixed(0), unit: '%' },
  ]
  return (
    <section className="card space-y-3 p-4 md:p-5" aria-label="Live">
      <div className="flex items-baseline gap-3">
        <span className="num text-4xl font-semibold tabular-nums">{(Math.abs(latest.pitch) < 0.05 ? 0 : latest.pitch).toFixed(1)}°</span>
        <span className="text-sm text-muted">
          front up · holds {target}°
        </span>
        <span className="ml-auto flex gap-1.5">
          {latest.dry && <Badge tone="accent">Dry run</Badge>}
          {latest.bench && <Badge tone="warn">On a stand</Badge>}
          <Badge tone={latest.state >= 2 && latest.state <= 5 ? 'ok' : latest.state === 7 ? 'danger' : 'muted'}>{WHEELIE_STATES[latest.state]}</Badge>
        </span>
      </div>
      <PitchTrace samples={live} now={now} target={target} maxAngle={maxAngle} />
      <dl className="grid grid-cols-4 gap-2 text-sm">
        {cells.map((c) => (
          <div key={c.label} className="min-w-0">
            <dt className="label text-[9.5px]">{c.label}</dt>
            <dd className="num mt-0.5 font-semibold">
              {c.value}
              {c.unit && <span className="ml-0.5 text-[11px] font-normal text-muted">{c.unit}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const TRACE_S = 10

/** The front-up angle over the last ten seconds, with the target and the cut-out angle. */
function PitchTrace({ samples, now, target, maxAngle }: { samples: { at: number; t: WheelieTelemetry }[]; now: number; target: number; maxAngle: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 300
  const H = 110
  const top = Math.max(maxAngle + 4, 20)
  const pts = samples.filter((s) => now - s.at < TRACE_S * 1000)
  const x = (at: number) => W - ((now - at) / (TRACE_S * 1000)) * W
  const y = (deg: number) => H - 4 - (Math.max(-2, Math.min(top, deg)) + 2) * ((H - 8) / (top + 2))
  const line = pts.map((s, i) => `${i ? 'L' : 'M'}${x(s.at).toFixed(1)},${y(s.t.pitch).toFixed(1)}`).join('')
  const near = hover === null ? null : pts.reduce<(typeof pts)[number] | null>((best, s) => (!best || Math.abs(x(s.at) - hover) < Math.abs(x(best.at) - hover) ? s : best), null)
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-28 w-full touch-none"
        role="img"
        aria-label={`Front-up angle over the last ${TRACE_S} seconds`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setHover(((e.clientX - r.left) / r.width) * W)
        }}
        onPointerLeave={() => setHover(null)}
      >
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--color-line-strong)" strokeWidth="1" />
        <line x1="0" x2={W} y1={y(target)} y2={y(target)} stroke="var(--color-muted)" strokeWidth="1" strokeDasharray="4 3" />
        <line x1="0" x2={W} y1={y(maxAngle)} y2={y(maxAngle)} stroke="var(--color-warn)" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {near && (
          <>
            <line x1={x(near.at)} x2={x(near.at)} y1="0" y2={H} stroke="var(--color-line-strong)" strokeWidth="1" />
            <circle cx={x(near.at)} cy={y(near.t.pitch)} r="4" fill="var(--accent)" stroke="var(--color-surface)" strokeWidth="2" />
          </>
        )}
      </svg>
      <span className="pointer-events-none absolute top-0 left-0 text-[10px] text-faint">{top}°</span>
      <span className="pointer-events-none absolute right-0 text-[10px] text-muted" style={{ top: `${(y(target) / H) * 100}%`, transform: 'translateY(-110%)' }}>
        target
      </span>
      {near && (
        <div className="pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs shadow">
          <span className="num font-semibold">{near.t.pitch.toFixed(1)}°</span>
          <span className="ml-1.5 text-muted">
            {WHEELIE_STATES[near.t.state]} · {((now - near.at) / 1000).toFixed(1)} s ago
          </span>
        </div>
      )}
    </div>
  )
}

// ---- Calibration ----

function CalibrationCard() {
  const connected = useSession((s) => s.status === 'connected')
  const cals = useSettings((s) => s.wheelieCal)
  const { status, busy, startCal } = useWheelie()
  const plan = connected ? wheeliePlan() : null
  const host = plan && !('problem' in plan) ? plan.host : null
  const cal = host ? cals[host.key] : undefined
  const installed = !!status && status !== 'missing'
  const on = installed && status.on
  return (
    <section className="card space-y-3 p-4 md:p-5" aria-label="IMU calibration">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">IMU calibration</h2>
          <p className="text-sm text-muted">
            {cal
              ? `Calibrated ${new Date(cal.at).toLocaleDateString()}. With you on it, the deck sits at ${cal.zero.toFixed(1)}°; that counts as level.`
              : 'Teaches it which way the controller faces and what level is with you standing on it. Takes a minute.'}
          </p>
        </div>
        <Button className="h-10" disabled={!host || !installed || on || busy} onClick={startCal}>
          {cal ? 'Calibrate again' : 'Calibrate'}
        </Button>
      </div>
      {host && !installed && <p className="text-xs text-faint">Install it first: the program does the measuring.</p>}
    </section>
  )
}

const CAL_STEPS: { id: CalStep; title: string; what: string }[] = [
  { id: 'level', title: 'Flat and empty', what: 'Stand the scooter on flat ground, on both wheels, with no one on it or touching it.' },
  { id: 'tipped', title: 'Front lifted', what: 'Lift the front wheel 10 to 30° (a hand or two under the tyre) and hold it still. Keep the rear wheel on the ground.' },
  { id: 'loaded', title: 'You on it', what: 'Stand on it the way you ride, on the same flat ground. Hold on to something so you keep still.' },
  { id: 'check', title: 'Check', what: 'Lift the front: the angle should go up. Tip it to the side: the side lean should change.' },
]

function CalibrationDialog() {
  const cal = useWheelie((s) => s.cal)
  const { measure, backCal, endCal, peek } = useWheelie()
  const demo = useSession((s) => s.transportKind === 'mock')
  const onCheck = cal?.step === 'check'
  useEffect(() => {
    if (!onCheck) return
    void peek()
    const t = setInterval(() => void peek(), 900)
    return () => clearInterval(t)
  }, [onCheck, peek])
  if (!cal) return null
  const at = CAL_STEPS.findIndex((s) => s.id === cal.step)
  const step = CAL_STEPS[at]
  return (
    <Dialog
      open
      onClose={endCal}
      locked={cal.measuring}
      title="Calibrate the IMU"
      subtitle={`Step ${at + 1} of ${CAL_STEPS.length}: ${step.title}`}
      footer={
        <div className="flex justify-between gap-2">
          <Button disabled={cal.measuring || at === 0} onClick={backCal}>
            Back
          </Button>
          {onCheck ? (
            <Button variant="primary" onClick={endCal}>
              Done
            </Button>
          ) : (
            <Button variant="primary" disabled={cal.measuring} onClick={() => void measure()}>
              {cal.measuring ? 'Hold still…' : 'Measure'}
            </Button>
          )}
        </div>
      }
    >
      <ol className="mb-4 flex gap-1.5" aria-hidden="true">
        {CAL_STEPS.map((s, i) => (
          <li key={s.id} className={cx('h-1 flex-1 rounded-full', i <= at ? 'bg-accent' : 'bg-surface-3')} />
        ))}
      </ol>
      <p className="text-[15px] leading-relaxed">{step.what}</p>
      {!onCheck && <p className="mt-2 text-sm text-muted">Measuring takes about a second. Keep it still until it’s done.</p>}
      {demo && <p className="mt-2 text-sm text-faint">In the demo, the scooter is held for you.</p>}
      {onCheck && (
        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-line p-3">
          <div>
            <dt className="label text-[9.5px]">Front up</dt>
            <dd className="num mt-1 text-2xl font-semibold">{cal.peek ? `${cal.peek.pitch.toFixed(1)}°` : '…'}</dd>
          </div>
          <div>
            <dt className="label text-[9.5px]">Side lean</dt>
            <dd className="num mt-1 text-2xl font-semibold">{cal.peek ? `${cal.peek.roll.toFixed(1)}°` : '…'}</dd>
          </div>
        </dl>
      )}
      {onCheck && <p className="mt-2 text-sm text-muted">If lifting the front makes the angle go down, calibrate again: the scooter probably moved during a step.</p>}
      {cal.error && <p className="mt-3 text-sm text-warn">{cal.error}</p>}
    </Dialog>
  )
}

// ---- Safety ----

function SafetyPoints() {
  return (
    <ul className="space-y-2 text-[13.5px] leading-relaxed">
      <li>
        <strong>It can throw you off.</strong> A wheelie is balanced on the rear wheel. Leaning far back, past the balance point, can’t be caught by any setting: the
        scooter loops out. If the nose keeps rising, let go of the throttle and step off the back.
      </li>
      <li>
        <strong>You lean back to lift it.</strong> Standing upright, the motors can’t lift the front. Lean back as you pin the throttle; that’s also how you hold it.
      </li>
      <li>
        <strong>Your brakes aren’t wired to the controller.</strong> It notices a pulled brake by the wheels slowing, after a few hundredths of a second. Brake
        gently while the front is up.
      </li>
      <li>
        <strong>Full gear.</strong> Helmet, gloves, knee and wrist protection. Practise in an empty car park, never in traffic or near people.
      </li>
      <li>
        <strong>Start with a dry run</strong> (under Testing): everything but the motors, with the tones, so you learn the gestures first. Then a stand test, then
        low settings.
      </li>
      <li>
        <strong>Untested on your scooter.</strong> It was tuned in a simulation of a typical dual-motor scooter. Yours is different: expect to tune it.
      </li>
    </ul>
  )
}

function SafetyCard() {
  const acknowledged = useSettings((s) => s.wheelieAcknowledged)
  return (
    <details className="group card" open={!acknowledged}>
      <summary className="focus-ring flex cursor-pointer list-none items-center gap-2 rounded-[var(--radius-card)] px-4 py-3.5 text-sm font-medium md:px-5 [&::-webkit-details-marker]:hidden">
        <TriangleAlert className="size-4 text-warn" />
        Read before riding
        <ChevronDown className="ml-auto size-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-line px-4 py-3.5 md:px-5">
        <SafetyPoints />
        <h3 className="mt-4 mb-1.5 text-sm font-medium">What ends a wheelie</h3>
        <ul className="space-y-1 text-[13px] leading-relaxed text-muted">
          <li>Easing off the throttle; the time limit; going too fast or too slow.</li>
          <li>A pulled brake, the rear wheel spinning, leaning to the side or turning hard.</li>
          <li>The nose past the cut-out angle: it brakes the nose back down.</li>
          <li>Low or full battery, too much battery current, heat, a fault, the IMU or CAN going quiet.</li>
          <li>If the program stops, the throttle has the motors back within 50 ms.</li>
        </ul>
      </div>
    </details>
  )
}

// ---- The program on the controller ----

function ProgramCard() {
  const { status, backup, busy, uninstall } = useWheelie()
  const [confirm, setConfirm] = useState(false)
  if (!status || status === 'missing') return null
  return (
    <section className="card space-y-2 p-4 md:p-5" aria-label="On the controller">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">On the controller</h2>
          <p className="text-sm text-muted">
            Version {status.version}, installed as its stored script. Ohmic sends your settings and calibration every time you arm it.
            {backup ? ' The script it replaced is kept in Ohmic and goes back when you remove this.' : ''}
          </p>
        </div>
        <Button className="h-10" disabled={busy || status.on} onClick={() => setConfirm(true)}>
          Remove
        </Button>
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Remove the auto-wheelie?"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirm(false)}>Keep it</Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirm(false)
                void uninstall()
              }}
            >
              Remove
            </Button>
          </div>
        }
      >
        <p className="text-sm">{backup ? 'The script that was there before goes back on the controller.' : 'The controller will have no stored script.'}</p>
      </Dialog>
    </section>
  )
}

function ReplaceDialog() {
  const { replace, busy, install, cancelReplace } = useWheelie()
  return (
    <Dialog
      open={!!replace}
      onClose={cancelReplace}
      locked={busy}
      title="Replace the stored script?"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={cancelReplace}>Cancel</Button>
          <Button variant="primary" onClick={() => void install({ replace: true })}>
            Keep a copy and replace it
          </Button>
        </div>
      }
    >
      {replace && (
        <div className="space-y-2 text-sm">
          <p>
            {replace.name} already has a stored script ({replace.bytes.toLocaleString()} bytes). The auto-wheelie needs that space, so it replaces it.
          </p>
          <p className="text-muted">Ohmic keeps a copy and puts it back when you remove the wheelie.</p>
          {replace.imports > 0 && <p className="text-warn">It also has {replace.imports} imported file(s). Those can’t be kept; you’d need to upload them again.</p>}
        </div>
      )}
    </Dialog>
  )
}

// ---- Settings ----

function SettingsCard() {
  const [group, setGroup] = useState<WheelieGroup>('angle')
  const userSettings = useSettings((s) => s.wheelie)
  const settings = useMemo(() => ({ ...WHEELIE_DEFAULTS, ...userSettings }), [userSettings])
  const tabsId = useId()
  const changed = WHEELIE_FIELDS.filter((f) => settings[f.key] !== WHEELIE_DEFAULTS[f.key]).length
  const info = WHEELIE_GROUPS.find((g) => g.id === group)!
  // Settings that were fine may not suit this scooter's motors.
  useConfig((s) => s.devices)
  const connected = useSession((s) => s.status === 'connected')
  const problems = connected ? problemsWith(settings) : []
  return (
    <section className="card h-fit space-y-4 p-4 md:p-5" aria-label="Wheelie settings">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 font-semibold">Settings</h2>
        {changed > 0 && (
          <Button className="h-8 text-xs" onClick={() => useSettings.getState().resetWheelie()}>
            <RotateCcw className="size-3.5" /> Defaults
          </Button>
        )}
      </div>
      {problems.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn">
          {problems.map((p) => (
            <li key={p} className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {p}
            </li>
          ))}
        </ul>
      )}
      <Tabs<WheelieGroup>
        label="Setting groups"
        look="pill"
        tabs={WHEELIE_GROUPS.map((g) => ({
          id: g.id,
          label: g.label,
          count: WHEELIE_FIELDS.filter((f) => f.group === g.id && settings[f.key] !== WHEELIE_DEFAULTS[f.key]).length || undefined,
          countLabel: 'changed',
        }))}
        value={group}
        onChange={setGroup}
        tabId={(id) => `${tabsId}-${id}`}
        panelId={`${tabsId}-panel`}
      />
      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${group}`} className="space-y-5">
        <p className="text-sm text-muted">{info.help}</p>
        {WHEELIE_FIELDS.filter((f) => f.group === group).map((f) => (
          <FieldRow key={f.key} field={f} settings={settings} />
        ))}
      </div>
    </section>
  )
}

const shown = (f: WheelieField, v: number) => (f.unit === '' && f.max <= 1 && !f.toggle && !f.choices ? `${Math.round(v * 100)} %` : `${Number(v.toFixed(3))}${f.unit ? ` ${f.unit}` : ''}`)

/** Everything wrong with these settings, checked against each other and against the motors. */
function problemsWith(next: WheelieSettings): string[] {
  const bad = wheelieSettingsProblems(next)
  if (bad.length) return bad
  const plan = useSession.getState().status === 'connected' ? wheeliePlan() : null
  return plan && !('problem' in plan) ? wheelieLimitsProblems(plan, next) : []
}

function FieldRow({ field: f, settings }: { field: WheelieField; settings: WheelieSettings }) {
  const stored = settings[f.key]
  const [draft, setDraft] = useState<number | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const value = draft ?? stored
  const changed = stored !== WHEELIE_DEFAULTS[f.key]

  const commit = (v: number) => {
    setDraft(v)
    if (!Number.isFinite(v)) return setError('Enter a number.')
    // Refused only for a problem this change makes; ones already there show above.
    const before = new Set(problemsWith(wheelieSettings()))
    const problem = problemsWith({ ...wheelieSettings(), [f.key]: v }).find((p) => !before.has(p))
    if (problem) return setError(problem)
    setError(null)
    setDraft(null)
    useSettings.getState().setWheelie({ [f.key]: v })
  }

  const head = (
    <div className="flex items-baseline gap-2">
      <span className="text-sm font-medium">{f.label}</span>
      {changed && <span className="size-1.5 rounded-full bg-accent" title="Changed from the default" />}
      {!f.toggle && !f.choices && <span className="num ml-auto text-sm font-semibold">{shown(f, value)}</span>}
    </div>
  )

  if (f.toggle) {
    return (
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {head}
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{f.help}</p>
          {error && <p className="mt-1 text-sm text-warn">{error}</p>}
        </div>
        <Toggle label={f.label} checked={stored === 1} onChange={(v) => commit(v ? 1 : 0)} />
      </div>
    )
  }
  if (f.choices) {
    return (
      <div>
        {head}
        <div className="mt-1.5">
          <Segmented<number> label={f.label} value={stored} onChange={commit} options={f.choices} />
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">{f.help}</p>
        {error && <p className="mt-1 text-sm text-warn">{error}</p>}
      </div>
    )
  }
  return (
    <div>
      {head}
      <div className="mt-1.5 flex items-center gap-3">
        <input
          type="range"
          aria-label={f.label}
          min={f.min}
          max={f.max}
          step={f.step}
          value={value}
          onChange={(e) => {
            setText(null)
            commit(Number(e.target.value))
          }}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[var(--accent)]"
        />
        <input
          inputMode="decimal"
          aria-label={`${f.label}, exact value`}
          value={text ?? String(Number((f.unit === '' && f.max <= 1 ? value * 100 : value).toFixed(3)))}
          onChange={(e) => {
            setText(e.target.value)
            const n = Number(e.target.value.trim().replace(',', '.'))
            if (e.target.value.trim() === '') return setError('Enter a number.')
            commit(f.unit === '' && f.max <= 1 ? n / 100 : n)
          }}
          onBlur={() => {
            setText(null)
            if (error) {
              setDraft(null)
              setError(null)
            }
          }}
          aria-invalid={!!error}
          className="focus-ring num h-9 w-20 rounded-xl border border-line-strong bg-surface-2 px-2.5 text-right text-sm"
        />
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">{f.help}</p>
      {error && (
        <p className="mt-1 flex items-start gap-1.5 text-sm text-warn">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {error} Not saved.
        </p>
      )}
      {!error && draft === null && changed && (
        <button className="focus-ring mt-1 inline-flex items-center gap-1 rounded text-xs text-faint hover:text-text" onClick={() => commit(WHEELIE_DEFAULTS[f.key])}>
          <Check className="size-3" /> Default is {shown(f, WHEELIE_DEFAULTS[f.key])}
        </button>
      )}
    </div>
  )
}
