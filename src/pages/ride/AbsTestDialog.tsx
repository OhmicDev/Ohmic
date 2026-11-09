import { Check, Loader2, OctagonX, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cx, fmt } from '../../lib/format'
import { absTestBlock, resetAbsTest, startAbsTest, stopAbsTest, useAbsTest } from '../../state/absTest'
import { useConfig } from '../../state/config'
import { targetKey } from '../../state/devices'
import { useAbs } from '../../state/onboard'
import { useSession } from '../../state/session'
import { useSettings } from '../../state/settings'
import { useTelemetry } from '../../state/telemetry'
import { Dialog } from '../../ui/Dialog'
import { Button } from '../../ui/Primitives'
import { DemoPark } from '../config/LiveStrip'
import { DevicePicker } from '../setup/common'
import { useMotorDevices } from '../setup/helpers'

const PHASE_TEXT = {
  checking: 'Checking ABS is running…',
  spinning: 'Spinning the wheel up…',
  braking: 'Braking hard…',
  reading: 'Reading what ABS did…',
} as const

/** Tests ABS with the wheel lifted: hold to spin up and brake hard, then see if ABS stepped in. */
export function AbsTestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const devices = useConfig((s) => s.devices)
  const list = useMotorDevices()
  const [key, setKey] = useState<string | null>(null)
  const [lifted, setLifted] = useState(false)
  const test = useAbsTest()
  const absStatus = useAbs((s) => s.status)
  const absBusy = useAbs((s) => s.busy)
  const acknowledged = useSettings((s) => s.absAcknowledged)
  const isDemo = useSession((s) => s.transportKind === 'mock')
  const live = useTelemetry((s) => s.devices)
  // Re-check what blocks the test as the wheel slows and ABS changes.
  const [, tick] = useState(0)
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [open])
  // Never leave a motor running behind a closed dialog.
  useEffect(() => () => resetAbsTest(), [])

  const d = devices[key ?? ''] ?? list[0]
  if (!d) return null
  const running = test.phase === 'checking' || test.phase === 'spinning' || test.phase === 'braking' || test.phase === 'reading'
  const mine = test.key === d.key
  const block = running ? null : absTestBlock(d)
  const absOff = !absStatus[d.key]?.on
  const erpmNow = Math.abs(live[targetKey(d.target)]?.rpm ?? 0)

  const close = () => {
    resetAbsTest()
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} locked={running} size="md" title="Test ABS" subtitle="With the wheel off the ground, so you don’t need to ride">
      <div className="space-y-4 text-sm">
        <div className="flex gap-3 rounded-xl border border-warn/30 bg-warn/5 p-3.5">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
          <div>
            <div className="font-semibold text-warn">Lift the wheel off the ground first</div>
            <p className="mt-0.5 text-muted">
              While you hold the button, the wheel spins up to about 20 km/h, then the motor brakes it hard. Letting go stops it at
              any time. Keep hands, feet and cables clear.
            </p>
          </div>
        </div>

        <DevicePicker list={list} value={d.key} onChange={(k) => !running && setKey(k)} label="Wheel to test" />

        <label className="flex items-start gap-2">
          <input type="checkbox" checked={lifted} disabled={running} onChange={(e) => setLifted(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          The wheel is off the ground and free to spin.
        </label>

        {isDemo && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <DemoPark /> The demo scooter must be parked first.
          </div>
        )}

        {absOff && !running && (
          <div className="flex flex-wrap items-center gap-2 text-warn">
            ABS is off on {d.name}.
            {acknowledged ? (
              <Button className="h-8 px-2.5 text-xs" disabled={absBusy} onClick={() => void useAbs.getState().turnOn()}>
                {absBusy && <Loader2 className="size-3.5 animate-spin" />} Turn ABS on
              </Button>
            ) : (
              <span className="text-muted">Turn it on with the ABS switch on the Ride page first.</span>
            )}
          </div>
        )}
        {block && !absOff && <p className="text-warn">{block}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <HoldToTest disabled={!lifted || !!block || (running && !mine)} running={running && mine} keyToTest={d.key} />
          <button
            onClick={stopAbsTest}
            className="focus-ring inline-flex h-16 items-center gap-2 rounded-2xl border border-danger/50 bg-danger/15 px-6 text-base font-bold text-danger"
          >
            <OctagonX className="size-5" /> Stop
          </button>
        </div>

        {running && mine && (
          <p className="flex items-center gap-2 text-muted" aria-live="polite">
            <Loader2 className="size-4 animate-spin" />
            {PHASE_TEXT[test.phase as keyof typeof PHASE_TEXT]}
            {test.phase === 'spinning' && (
              <span className="num">
                {fmt(erpmNow, 0)} / {fmt(test.erpm, 0)} ERPM
              </span>
            )}
          </p>
        )}

        {test.phase === 'done' && mine && <Result releases={test.releases} error={test.error} stopped={test.stopped} name={d.name} />}
      </div>
    </Dialog>
  )
}

function Result({ releases, error, stopped, name }: { releases: number | null; error: string | null; stopped: boolean; name: string }) {
  if (stopped) return <p className="text-muted">Stopped before the test finished. Hold the button until the result shows.</p>
  if (error) return <p className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-warn">{error}</p>
  if (releases === null) return null
  if (releases > 0)
    return (
      <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/5 p-3 text-ok">
        <Check className="mt-0.5 size-4 shrink-0" />
        <span>
          ABS stepped in {releases} time{releases === 1 ? '' : 's'} while braking. It’s working on {name}.
        </span>
      </p>
    )
  return (
    <p className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-warn">
      The wheel stopped without ABS stepping in. The braking wasn’t hard enough to slow it faster than a tyre could. Try the Sensitive
      setting on the ABS page, or a higher motor braking current, then test again.
    </p>
  )
}

/** Runs the test only while held (pointer, Space or Enter). */
function HoldToTest({ disabled, running, keyToTest }: { disabled: boolean; running: boolean; keyToTest: string }) {
  const start = () => {
    if (!disabled) void startAbsTest(keyToTest)
  }
  return (
    <button
      disabled={disabled}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        start()
      }}
      onPointerUp={stopAbsTest}
      onPointerCancel={stopAbsTest}
      onLostPointerCapture={stopAbsTest}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault()
          start()
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') stopAbsTest()
      }}
      onBlur={stopAbsTest}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'none' }}
      className={cx(
        'focus-ring h-16 min-w-[220px] flex-1 rounded-2xl border px-6 text-base font-semibold transition-colors select-none disabled:opacity-40',
        running ? 'border-accent bg-accent/25 text-accent' : 'border-accent/50 bg-accent/10 text-text hover:bg-accent/15',
      )}
    >
      {running ? 'Testing… keep holding' : 'Hold to test ABS'}
    </button>
  )
}
