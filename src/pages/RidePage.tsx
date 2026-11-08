import { Link } from '@tanstack/react-router'
import { Loader2, RotateCcw, TriangleAlert, WifiOff } from 'lucide-react'
import { cx, fmt, fmtDuration, fmtThousands } from '../lib/format'
import { convertDistance, convertPerDistance, convertSpeed, convertTemp, unitLabels } from '../lib/vehicle'
import { faultInfo } from '../protocol/faults'
import { targetLabel } from '../state/devices'
import { useSession } from '../state/session'
import { useSettings } from '../state/settings'
import { useTelemetry } from '../state/telemetry'
import { BatteryGauge, PowerBar } from '../ui/Gauges'
import { Metric, type Tone } from '../ui/Metric'
import { Badge, Button } from '../ui/Primitives'
import { ReconnectBanner } from '../ui/ReconnectBanner'
import { TweenNumber } from '../ui/TweenNumber'
import { ConnectPanel } from './ConnectPage'
import { RecordButton } from './logs/RecordControls'
import { RideControls } from './ride/RideControls'
import { WheelSpeeds } from './ride/WheelSpeeds'
import { SetupPrompt } from './setup/SetupSteps'

export function RidePage() {
  const status = useSession((s) => s.status)
  const primary = useSession((s) => s.primary)
  const hasData = useTelemetry((s) => s.dash !== null)
  const live = status === 'connected' || status === 'reconnecting'
  if (live && hasData) return <Dashboard />
  return (
    <div className="space-y-5">
      <div>
        <h1 className="wide text-2xl font-bold tracking-tight md:text-[28px]">Ride</h1>
        <p className="mt-1 text-sm text-muted">Connect to see speed, battery, power and temperatures live.</p>
      </div>
      {status === 'connected' && primary === null ? (
        <div className="card p-5 text-sm">
          <div className="font-semibold">No motor controller found</div>
          <p className="mt-1 max-w-xl leading-relaxed text-muted">
            The device you're connected to isn't a motor controller, and none answered on its CAN bus. Check the CAN wiring, then scan again
            from{' '}
            <Link to="/connect" className="text-text underline decoration-line-strong underline-offset-2">
              Connection
            </Link>
            .
          </p>
        </div>
      ) : status === 'connected' ? (
        <div className="card flex items-center gap-3 p-4 text-sm" aria-live="polite">
          <Loader2 className="size-4 animate-spin text-accent" />
          <span className="text-muted">Waiting for the first values…</span>
        </div>
      ) : (
        <ConnectPanel />
      )}
    </div>
  )
}

const tempTone = (c: number, warn: number, danger: number): Tone => (c >= danger ? 'danger' : c >= warn ? 'warn' : 'normal')

function Dashboard() {
  const dash = useTelemetry((s) => s.dash)!
  const trip = useTelemetry((s) => s.trip)
  const resetTrip = useTelemetry((s) => s.resetTrip)
  const link = useSession((s) => s.link)
  const reconnecting = useSession((s) => s.status === 'reconnecting')
  const isDemo = useSession((s) => s.transportKind === 'mock')
  const { units, vehicle } = useSettings()
  const u = unitLabels(units)

  const speed = convertSpeed(dash.speed, units)
  const headroom = Math.max(0, (vehicle.maxDuty - dash.duty) * 100)
  const multi = dash.controllers > 1

  return (
    <>
      <h1 className="sr-only">Ride</h1>
      <div className="space-y-3">
        {reconnecting && <ReconnectBanner frozen />}
        {!reconnecting && link !== 'ok' && (
          <div role="status" className="card flex items-center gap-3 border-warn/30 bg-warn/5 p-3.5 text-sm">
            <WifiOff className="size-4 text-warn" />
            <span>
              {link === 'lost'
                ? 'The controller stopped answering. Values below are frozen.'
                : 'Connection is slow. Some updates were missed.'}
            </span>
          </div>
        )}
        {dash.faults.map((f) => {
          const info = faultInfo(f.code)
          return (
            <div
              key={`${f.target}-${f.code}`}
              role="alert"
              className="card flex items-start gap-3 border-danger/35 bg-danger/5 p-4 text-sm"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-danger">
                  {info.title}
                  {f.target !== 'local' && <span className="ml-2 font-normal text-muted">on CAN {f.target}</span>}
                </div>
                <div className="mt-0.5 text-muted">{info.help}</div>
              </div>
              <Link
                to="/live/faults"
                className="focus-ring shrink-0 self-center rounded-lg px-2 py-1 text-xs font-medium text-text underline-offset-2 hover:underline"
              >
                What to do
              </Link>
            </div>
          )
        })}

        <SetupPrompt />

        {/* Hero */}
        <div className="grid gap-3 lg:grid-cols-[1.55fr_1fr]">
          <section className="card relative overflow-hidden p-5 md:p-6" aria-label="Speed and power">
            <div className="flex items-center justify-between">
              <span className="label">Speed</span>
              <span className="flex items-center gap-2">
                {isDemo && <Badge tone="accent">Demo</Badge>}
                {dash.view !== 'all' ? (
                  <Badge>{targetLabel(dash.view)} only</Badge>
                ) : (
                  multi && <Badge>{dash.controllers} controllers</Badge>
                )}
              </span>
            </div>
            <div className="mt-1 flex items-end gap-3">
              <span className="num glow-strong wide leading-[0.85] font-bold tracking-[-0.04em]" style={{ fontSize: 'clamp(96px, 24vw, 176px)' }} aria-live="off">
                <TweenNumber value={speed} ms={260} />
              </span>
              <span className="mb-3 text-lg font-medium text-muted md:mb-5">{u.speed}</span>
              <div className="mb-3 ml-auto hidden text-right sm:block md:mb-5">
                <div className="label">Top</div>
                <div className="num text-lg font-semibold">
                  {fmt(convertSpeed(trip.maxSpeed, units), 0)} <span className="text-sm font-normal text-muted">{u.speed}</span>
                </div>
              </div>
            </div>
            <div className="mt-6">
              <PowerBar power={dash.power} peakDrive={trip.peakPower} peakRegen={trip.peakRegenPower} />
            </div>
          </section>

          <section className="card flex flex-col justify-between gap-5 p-5 md:p-6" aria-label="Battery">
            <div>
              <div className="flex items-center justify-between">
                <span className="label">Battery</span>
                <span className="num text-xs text-muted">
                  {fmt(dash.vIn, 1)} V · {fmt(dash.cellV, 2)} V/cell
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <TweenNumber
                  value={dash.soc}
                  ms={400}
                  className={cx('num glow text-[64px] leading-none font-bold tracking-tight', dash.soc < 10 ? 'text-danger' : dash.soc < 25 ? 'text-warn' : '')}
                />
                <span className="text-lg text-muted">%</span>
              </div>
              <div className="mt-4">
                <BatteryGauge soc={dash.soc} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
              <div>
                <div className="label">Range</div>
                <div className="num mt-1 text-2xl font-semibold">
                  {dash.rangeKm === null ? '—' : fmt(convertDistance(dash.rangeKm, units), 0)}
                  <span className="ml-1 text-sm font-normal text-muted">{u.distance}</span>
                </div>
                {dash.rangeKm === null && <div className="mt-0.5 text-[11px] text-faint">Ride a little to estimate</div>}
              </div>
              <div>
                <div className="label">Using</div>
                <div className="num mt-1 text-2xl font-semibold">
                  {trip.whPerKm === null ? '—' : fmt(convertPerDistance(trip.whPerKm, units), 1)}
                  <span className="ml-1 text-sm font-normal text-muted">{u.perDistance}</span>
                </div>
              </div>
            </div>
          </section>
        </div>

        <RideControls />

        {/* Live tiles */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric
            label="Battery current"
            value={dash.currentIn}
            digits={1}
            unit="A"
            spark="currentIn"
            hint={multi ? `${dash.controllers} controllers combined` : 'from the battery'}
          />
          <Metric
            label="Power"
            value={dash.power / 1000}
            digits={2}
            unit="kW"
            spark="power"
            hint={`peak ${fmt(trip.peakPower / 1000, 2)} kW`}
          />
          <Metric
            label="Motor current"
            value={dash.currentMotor}
            digits={1}
            unit="A"
            spark="currentMotor"
            hint={multi ? `sum of ${dash.controllers} motors` : 'phase current'}
          />
          <Metric
            label="Duty"
            value={dash.duty * 100}
            digits={0}
            unit="%"
            spark="duty"
            tone={dash.duty > 0.88 ? 'warn' : 'normal'}
            hint={`${fmt(headroom, 0)} % headroom`}
          />
          <Metric
            label="Motor speed"
            value={dash.erpm / 1000}
            digits={1}
            unit="k ERPM"
            spark="erpm"
            hint={`${fmtThousands(dash.motorRpm)} motor rpm`}
          />
          <Metric label="Battery voltage" value={dash.vIn} digits={1} unit="V" spark="vIn" hint={`${fmt(dash.cellV, 2)} V per cell`} />
          <Metric
            label="Motor temp"
            value={convertTemp(dash.tempMotor, units)}
            digits={0}
            unit={u.temp}
            spark="tempMotor"
            tone={tempTone(dash.tempMotor, 70, 85)}
            hint={`peak ${fmt(convertTemp(trip.peakTempMotor, units), 0)}°`}
          />
          <Metric
            label="Controller temp"
            value={convertTemp(dash.tempFet, units)}
            digits={0}
            unit={u.temp}
            spark="tempFet"
            tone={tempTone(dash.tempFet, 65, 80)}
            hint={`peak ${fmt(convertTemp(trip.peakTempFet, units), 0)}°`}
          />
        </div>

        {/* Trip */}
        <section className="card p-4 md:p-5" aria-label="Trip">
          <div className="flex items-center justify-between">
            <span className="label">This trip</span>
            <span className="flex items-center gap-1">
              <RecordButton />
              <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={resetTrip}>
                <RotateCcw className="size-3.5" /> Reset
              </Button>
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
            <TripStat label="Distance" value={fmt(convertDistance(trip.distanceKm, units), 2)} unit={u.distance} />
            <TripStat label="Riding" value={fmtDuration(trip.rideSeconds)} />
            <TripStat
              label="Average"
              value={trip.rideSeconds > 5 ? fmt(convertSpeed((trip.distanceKm / trip.rideSeconds) * 3600, units), 1) : '—'}
              unit={u.speed}
            />
            <TripStat label="Top speed" value={fmt(convertSpeed(trip.maxSpeed, units), 1)} unit={u.speed} />
            <TripStat label="Energy" value={fmt(trip.energyWh, 1)} unit="Wh" />
            <TripStat label="Regen peak" value={fmt(-trip.peakRegenPower / 1000, 2)} unit="kW" />
          </dl>
        </section>

        <p className="px-1 text-xs leading-relaxed text-faint">
          Speed, distance and battery % use your vehicle setup ({vehicle.wheelDiameterMm} mm wheel, {vehicle.motorPoles} poles,{' '}
          {vehicle.batteryCells}S {vehicle.batteryAh} Ah), read from the controller’s settings.{' '}
          <Link to="/settings" hash="vehicle" className="text-muted underline decoration-line-strong underline-offset-2 hover:text-text">
            Vehicle settings
          </Link>
        </p>
        {/* Room to scroll the last row clear of the wheels in the corner. */}
        <div aria-hidden className="h-20 md:h-24" />
      </div>
      <WheelSpeeds />
    </>
  )
}

function TripStat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <dt className="label text-[9.5px]">{label}</dt>
      <dd className="num mt-1 text-lg font-semibold">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted">{unit}</span>}
      </dd>
    </div>
  )
}
