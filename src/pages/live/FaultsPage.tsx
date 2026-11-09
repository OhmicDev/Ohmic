import { CircleCheck, FlaskConical, Loader2, ScrollText, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { convertSpeed, convertTemp, unitLabels, type Units } from '../../lib/vehicle'
import { cx, fmt, fmtThousands } from '../../lib/format'
import { FAULTS, faultFirmwareName, faultInfo, type FaultInfo } from '../../protocol/faults'
import type { FaultLogEntry } from '../../protocol/terminal'
import { targetKey, targetLabel, type DeviceInfo } from '../../state/devices'
import { useFaults, type FaultEvent } from '../../state/faults'
import { injectDemoFault, useSession } from '../../state/session'
import { useSettings } from '../../state/settings'
import { Dialog } from '../../ui/Dialog'
import { Button } from '../../ui/Primitives'
import { useNow } from '../../ui/useNow'

export function FaultsPage() {
  const events = useFaults((s) => s.events)
  const active = useFaults((s) => s.active)
  const loaded = useFaults((s) => s.loaded)
  const load = useFaults((s) => s.load)
  const status = useSession((s) => s.status)
  const devices = useSession((s) => s.devices)
  const isDemo = useSession((s) => s.transportKind === 'mock')
  const units = useSettings((s) => s.units)
  const now = useNow(1000)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const connected = status === 'connected'
  const motors = devices.filter((d) => d.motor)
  const activeList = Object.values(active)
  const past = events.filter((e) => !activeList.some((a) => a.uid === e.uid))

  return (
    <div className="space-y-4">
      {activeList.length > 0 ? (
        activeList.map((e) => <ActiveFault key={e.uid} e={e} now={now} units={units} />)
      ) : connected ? (
        <div className="card flex items-center gap-3 p-4 text-sm" role="status">
          <CircleCheck className="size-5 text-ok" />
          <span>
            No active faults{motors.length > 1 ? ` on any of the ${motors.length} controllers` : ''}.
          </span>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4 md:p-5" aria-labelledby="fault-logs">
          <div className="flex items-center gap-2">
            <ScrollText className="size-4 text-accent" />
            <h2 id="fault-logs" className="text-sm font-semibold">
              Controller fault log
            </h2>
          </div>
          <p className="mt-1 text-[13px] text-muted">
            Each controller remembers the faults since it was switched on, with the conditions at that moment. It also catches
            faults too short for the app to see. Times aren’t stored, so they’re listed oldest first.
          </p>
          {connected && motors.length ? (
            <div className="mt-3 space-y-3">
              {motors.map((d) => (
                <ControllerLog key={targetKey(d.target)} d={d} />
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-faint">Connect a controller to read its fault log.</p>
          )}
        </section>

        {isDemo && connected && <DemoFaults motors={motors} />}
      </div>

      <section className="card overflow-hidden" aria-labelledby="fault-history">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 md:px-5">
          <div>
            <h2 id="fault-history" className="text-sm font-semibold">
              Fault history
            </h2>
            <p className="text-xs text-muted">Every fault the app saw while connected, kept on this device.</p>
          </div>
          {past.length > 0 && (
            <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => setConfirmClear(true)}>
              <Trash2 className="size-3.5" /> Clear history
            </Button>
          )}
        </div>
        {!loaded ? (
          <p className="px-5 py-4 text-sm text-faint">Loading…</p>
        ) : past.length === 0 ? (
          <p className="px-5 py-6 text-sm text-faint">No faults recorded yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {past.map((e) => (
              <HistoryRow key={e.uid} e={e} now={now} units={units} />
            ))}
          </ul>
        )}
      </section>

      <FaultLibrary />

      <Dialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear fault history?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void useFaults.getState().clearHistory()
                setConfirmClear(false)
              }}
            >
              Clear {past.length} fault{past.length === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">This removes the app’s record of past faults on this device. It can’t be undone. The controllers’ own fault logs aren’t touched.</p>
      </Dialog>
    </div>
  )
}

function ActiveFault({ e, now, units }: { e: FaultEvent; now: number; units: Units }) {
  const info = faultInfo(e.code)
  return (
    <section role="alert" className="card border-danger/40 bg-danger/[0.06] p-4 md:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-danger">{info.title}</h2>
          <p className="text-sm text-muted">
            {e.deviceName} · active for {duration(now - e.at)} ·{' '}
            <span className="font-mono text-xs break-all" title="The name the firmware and VESC Tool use">
              {faultFirmwareName(e.code)}
            </span>
          </p>
          <p className="mt-2 text-sm">{info.help} The motor output is off until it clears.</p>
        </div>
      </div>
      <Snapshot e={e} units={units} />
      <CausesFixes info={info} />
    </section>
  )
}

function HistoryRow({ e, now, units }: { e: FaultEvent; now: number; units: Units }) {
  const info = faultInfo(e.code)
  const lasted = e.endedAt !== null ? `lasted ${duration(e.endedAt - e.at)}` : e.lostAt ? 'connection ended while active' : 'still active'
  return (
    <li>
      <details className="group">
        <summary className="focus-ring flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-surface-3/40 md:px-5">
          <span className={cx('size-2 shrink-0 rounded-full', info.severity === 'danger' ? 'bg-danger' : 'bg-warn')} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{info.title}</span>
            <span className="block truncate text-xs text-muted">
              {e.deviceName} · {lasted}
            </span>
          </span>
          <span className="shrink-0 text-right text-xs text-muted">
            <span className="block">{ago(now - e.at)}</span>
            <span className="num block text-faint">{new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </span>
        </summary>
        <div className="px-4 pb-4 md:px-5">
          <p className="text-sm text-muted">{info.help}</p>
          <Snapshot e={e} units={units} />
          <CausesFixes info={info} />
        </div>
      </details>
    </li>
  )
}

function Snapshot({ e, units }: { e: FaultEvent; units: Units }) {
  const s = e.snapshot
  const u = unitLabels(units)
  const items: [string, string][] = [
    ['Battery', `${fmt(s.vIn, 1)} V`],
    ['Motor current', `${fmt(s.currentMotor, 1)} A`],
    ['Battery current', `${fmt(s.currentIn, 1)} A`],
    ['Duty', `${fmt(Math.abs(s.duty) * 100, 0)} %`],
    ['Speed', `${fmt(convertSpeed(s.speed, units), 1)} ${u.speed}`],
    ['ERPM', fmtThousands(s.erpm)],
    ['Controller', `${fmt(convertTemp(s.tempFet, units), 0)} ${u.temp}`],
    ['Motor', `${fmt(convertTemp(s.tempMotor, units), 0)} ${u.temp}`],
  ]
  return (
    <div className="mt-3">
      <p className="label text-[9.5px] text-faint">{e.snapshotDuring ? 'When the app first saw it' : 'Just before it started'}</p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] text-muted">{k}</dt>
            <dd className="num text-sm font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function CausesFixes({ info }: { info: FaultInfo }) {
  if (!info.causes.length && !info.fixes.length) return null
  return (
    <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
      <div>
        <p className="label text-[9.5px] text-faint">Likely causes</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-muted marker:text-faint">
          {info.causes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="label text-[9.5px] text-faint">What to try</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-muted marker:text-faint">
          {info.fixes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function ControllerLog({ d }: { d: DeviceInfo }) {
  const key = targetKey(d.target)
  const state = useFaults((s) => s.logs[key])
  const readLog = useFaults((s) => s.readLog)
  const reading = state?.status === 'reading'
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">
          {targetLabel(d.target)}
          {d.fw?.hwName && <span className="font-normal text-muted"> · {d.fw.hwName}</span>}
        </span>
        <Button className="h-8 shrink-0 px-3 text-xs" onClick={() => void readLog(d.target)} disabled={reading}>
          {reading && <Loader2 className="size-3.5 animate-spin" />}
          {state?.status === 'ok' ? 'Read again' : 'Read fault log'}
        </Button>
      </div>
      {state?.status === 'error' && <p className="mt-2 text-sm text-danger">{state.error}</p>}
      {state?.status === 'ok' && state.log && (
        <div className="mt-2">
          {state.log.entries.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-ok">
              <CircleCheck className="size-4" /> No faults since it was switched on.
            </p>
          ) : (
            <ol className="space-y-2">
              {state.log.entries.map((e, i) => (
                <LogEntry key={i} e={e} n={i + 1} />
              ))}
            </ol>
          )}
          {state.log.active !== null && <p className="mt-2 text-xs text-danger">Active right now: {faultInfo(state.log.active).title}</p>}
        </div>
      )}
    </div>
  )
}

function LogEntry({ e, n }: { e: FaultLogEntry; n: number }) {
  const info = e.code >= 0 ? faultInfo(e.code) : null
  const parts = [
    e.motor !== null && e.motor > 1 ? `motor ${e.motor}` : null,
    e.current !== null ? `${fmt(e.current, 1)} A` : null,
    e.voltage !== null ? `${fmt(e.voltage, 1)} V` : null,
    e.duty !== null ? `duty ${fmt(Math.abs(e.duty) * 100, 0)} %` : null,
    e.rpm !== null ? `${fmtThousands(e.rpm)} ERPM` : null,
    e.temperature !== null ? `${fmt(e.temperature, 0)} °C` : null,
  ].filter(Boolean)
  return (
    <li className="text-sm">
      <span className="num mr-2 text-xs text-faint">#{n}</span>
      <span className="font-medium">{info?.title ?? e.name}</span>
      {parts.length > 0 && <span className="num block pl-6 text-xs text-muted">{parts.join(' · ')}</span>}
      {e.info && <span className="block pl-6 text-xs text-faint">{e.info}</span>}
    </li>
  )
}

const DEMO_FAULTS = [2, 5, 4, 6, 1, 3]

function DemoFaults({ motors }: { motors: DeviceInfo[] }) {
  const [code, setCode] = useState(DEMO_FAULTS[0])
  const [target, setTarget] = useState(motors[0] ? targetKey(motors[0].target) : 'local')
  const device = motors.find((d) => targetKey(d.target) === target) ?? motors[0]
  return (
    <section className="card p-4 md:p-5" aria-labelledby="demo-faults">
      <div className="flex items-center gap-2">
        <FlaskConical className="size-4 text-accent" />
        <h2 id="demo-faults" className="text-sm font-semibold">
          Try a fault
        </h2>
        <span className="label rounded-full border border-accent/40 px-2 py-0.5 text-[9px] text-accent">Demo</span>
      </div>
      <p className="mt-1 text-[13px] text-muted">Make a simulated controller report a fault for a couple of seconds and watch how the app handles it.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          aria-label="Fault"
          value={code}
          onChange={(e) => setCode(Number(e.target.value))}
          className="focus-ring h-10 rounded-xl border border-line-strong bg-surface-2 px-3 text-sm"
        >
          {DEMO_FAULTS.map((c) => (
            <option key={c} value={c}>
              {faultInfo(c).title}
            </option>
          ))}
        </select>
        {motors.length > 1 && (
          <select
            aria-label="Controller"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="focus-ring h-10 rounded-xl border border-line-strong bg-surface-2 px-3 text-sm"
          >
            {motors.map((d) => (
              <option key={targetKey(d.target)} value={targetKey(d.target)}>
                {targetLabel(d.target)}
              </option>
            ))}
          </select>
        )}
        <Button onClick={() => device && injectDemoFault(device.target, code)}>Trigger fault</Button>
      </div>
    </section>
  )
}

function FaultLibrary() {
  return (
    <details className="card group overflow-hidden">
      <summary className="focus-ring flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold md:px-5">
        All fault codes
        <span className="text-xs font-normal text-muted group-open:hidden">What each one means</span>
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {FAULTS.slice(1).map((f) => (
          <li key={f.code} className="px-4 py-3 md:px-5">
            <div className="flex items-baseline gap-2">
              <span className="num w-6 shrink-0 text-xs text-faint">{f.code}</span>
              <span className="text-sm font-medium">{f.title}</span>
              <span className="hidden truncate font-mono text-[11px] text-faint sm:inline">{f.id}</span>
            </div>
            <p className="pl-8 text-[13px] text-muted">{f.help}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}

function duration(ms: number): string {
  const s = Math.max(0, ms) / 1000
  if (s < 10) return `${s.toFixed(1)} s`
  if (s < 90) return `${Math.round(s)} s`
  const m = s / 60
  if (m < 90) return `${Math.round(m)} min`
  return `${(m / 60).toFixed(1)} h`
}

function ago(ms: number): string {
  const s = Math.max(0, ms) / 1000
  if (s < 45) return 'just now'
  const m = s / 60
  if (m < 60) return `${Math.round(m)} min ago`
  const h = m / 60
  if (h < 24) return `${Math.round(h)} h ago`
  return `${Math.round(h / 24)} d ago`
}
