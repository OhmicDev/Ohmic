import { CircleParking, CirclePlay } from 'lucide-react'
import { useReducer } from 'react'
import type { Target } from '../../client/VescClient'
import { cx, fmt } from '../../lib/format'
import { convertSpeed, convertTemp, speedKmh, unitLabels } from '../../lib/vehicle'
import { targetKey, targetLabel } from '../../state/devices'
import { useMotionBlock } from '../../state/motion'
import { demoSim, setDemoParked, useSession } from '../../state/session'
import { useSettings } from '../../state/settings'
import { useTelemetry } from '../../state/telemetry'

function Cell({ label, value, unit, warn }: { label: string; value: string; unit?: string; warn?: boolean }) {
  return (
    <div className="min-w-0 shrink-0 px-3 py-1.5 sm:py-2">
      <div className="label text-[9.5px]">{label}</div>
      <div className={cx('num mt-0.5 text-[15px] font-semibold', warn && 'text-warn')}>
        {value}
        {unit && <span className="ml-0.5 text-[11px] font-normal text-muted">{unit}</span>}
      </div>
    </div>
  )
}

/** Parks the simulated scooter so settings can be written in the demo. */
export function DemoPark() {
  const connected = useSession((s) => s.status === 'connected' && s.transportKind === 'mock')
  // The simulator owns this flag; re-render after flipping it.
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const sim = connected ? demoSim() : null
  if (!sim) return null
  const parked = sim.parked
  const toggle = () => {
    setDemoParked(!parked)
    rerender()
  }
  return (
    <button
      onClick={toggle}
      className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-surface-2 px-3 text-xs font-medium text-muted transition-colors hover:text-text"
      title="The demo scooter rides a loop. Park it to try writing settings."
    >
      {parked ? <CirclePlay className="size-3.5" /> : <CircleParking className="size-3.5" />}
      {parked ? 'Resume demo ride' : 'Park demo scooter'}
    </button>
  )
}

/** Live values for the controller being edited, and whether it's safe to write. */
export function LiveStrip({ target }: { target: Target }) {
  const v = useTelemetry((s) => s.devices[targetKey(target)])
  const vehicle = useSettings((s) => s.vehicle)
  const units = useSettings((s) => s.units)
  const u = unitLabels(units)
  const block = useMotionBlock([target])
  const live = useSession((s) => s.status === 'connected')

  return (
    <div className="card flex flex-col gap-1 p-1 sm:p-1.5 xl:flex-row xl:items-center">
      {/* One row that scrolls sideways on a phone, fading at the edge to show there's more; a grid on wider screens. */}
      <div className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,black_82%,transparent)] max-sm:pr-8 sm:grid sm:grid-cols-7">
        <Cell label="Speed" value={v ? fmt(convertSpeed(Math.abs(speedKmh(v.rpm, vehicle)), units), 1) : '—'} unit={u.speed} />
        <Cell label="ERPM" value={v ? fmt(v.rpm, 0) : '—'} />
        <Cell label="Battery" value={v ? fmt(v.vIn, 1) : '—'} unit="V" />
        <Cell label="Motor" value={v ? fmt(v.currentMotor, 1) : '—'} unit="A" />
        <Cell label="Batt. amps" value={v ? fmt(v.currentIn, 1) : '—'} unit="A" />
        <Cell label="Ctrl temp" value={v ? fmt(convertTemp(v.tempFet, units), 0) : '—'} unit={u.temp} warn={!!v && v.tempFet > 80} />
        <Cell label="Motor temp" value={v ? fmt(convertTemp(v.tempMotor, units), 0) : '—'} unit={u.temp} warn={!!v && v.tempMotor > 100} />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-2 pb-1.5 xl:pb-0">
        <DemoPark />
        <span
          className={cx(
            'inline-flex h-7 items-center gap-2 rounded-full border px-2.5 text-xs font-medium sm:h-8 sm:px-3',
            !live ? 'border-line-strong text-muted' : block ? 'border-warn/40 bg-warn/10 text-warn' : 'border-ok/40 bg-ok/10 text-ok',
          )}
          title={block ?? undefined}
        >
          <span className={cx('size-1.5 rounded-full', !live ? 'bg-muted' : block ? 'bg-warn' : 'bg-ok')} />
          {!live
            ? 'Offline'
            : block
              ? block.includes('turning')
                ? 'Motor turning · writes paused'
                : 'Checking the motor is stopped'
              : `${targetLabel(target)} stopped · ready to write`}
        </span>
      </div>
    </div>
  )
}
