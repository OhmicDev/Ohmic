// The Ride dashboard while connected: alerts, the big reading with the trip
// under it, battery, ride controls, the rider's tiles and the ride stats.
// The rider arranges it in Customize (state/dashboard.ts). On a phone it can
// all sit on one screen, with the stats a scroll below.

import { Link } from '@tanstack/react-router'
import { LayoutGrid, TriangleAlert, WifiOff } from 'lucide-react'
import { useState } from 'react'
import { cx, fmt, fmtDuration } from '../../lib/format'
import { convertDistance, convertPerDistance, convertSpeed, unitLabels } from '../../lib/vehicle'
import { faultInfo } from '../../protocol/faults'
import { useDashLayout, type HeroId } from '../../state/dashboard'
import { targetLabel } from '../../state/devices'
import { useSession } from '../../state/session'
import { useSettings } from '../../state/settings'
import { useTelemetry, type Dashboard as Dash, type Trip } from '../../state/telemetry'
import { BatteryGauge } from '../../ui/Gauges'
import { Badge, Button } from '../../ui/Primitives'
import { ReconnectBanner } from '../../ui/ReconnectBanner'
import { TweenNumber } from '../../ui/TweenNumber'
import { useIsPhone } from '../../ui/useMediaQuery'
import { RecordButton } from '../logs/RecordControls'
import { SetupPrompt } from '../setup/SetupSteps'
import { CustomizePanel, FitTiles, TileGrid } from './DashTiles'
import { RideControls } from './RideControls'
import { RideStats } from './RideStats'
import { avgSpeed } from './tiles'
import { WheelSpeeds } from './WheelSpeeds'

export function Dashboard() {
  const show = useDashLayout((s) => s.show)
  const fit = useDashLayout((s) => s.phone === 'fit')
  const phone = useIsPhone()
  const [editing, setEditing] = useState(false)

  if (phone && fit)
    return (
      <>
        <h1 className="sr-only">Ride</h1>
        <div className="space-y-3">
          {editing && <CustomizePanel phone onDone={() => setEditing(false)} />}
          {/* One screen: the small viewport, less the header, the tab bar and the page's padding. */}
          <div className="flex min-h-[calc(100svh_-_144px_-_env(safe-area-inset-bottom))] flex-col gap-2">
            <Alerts />
            <SetupPrompt compact />
            <Hero compact onCustomize={editing ? undefined : () => setEditing(true)} />
            <FitTiles editing={editing} />
            {show.controls && <RideControls compact />}
          </div>
          {show.stats && (
            <>
              <RideStats />
              <VehicleNote />
            </>
          )}
        </div>
      </>
    )

  return (
    <>
      <h1 className="sr-only">Ride</h1>
      <div className="space-y-3">
        <Alerts />
        <SetupPrompt />

        <div className={cx('grid gap-3', show.battery && 'lg:grid-cols-[1.55fr_1fr]')}>
          <Hero />
          {show.battery && <BatteryCard />}
        </div>

        {show.controls && <RideControls />}

        {editing ? (
          <CustomizePanel phone={phone} onDone={() => setEditing(false)} />
        ) : (
          <div className="flex items-center gap-2 px-1 pt-2">
            <h2 className="label">Live</h2>
            <Button variant="ghost" className="ml-auto h-8 px-2.5 text-xs" onClick={() => setEditing(true)}>
              <LayoutGrid className="size-3.5" /> Customize
            </Button>
          </div>
        )}
        <TileGrid editing={editing} />

        {show.stats && <RideStats />}

        <VehicleNote />
        {/* Room to scroll the last row clear of the wheels in the corner. */}
        {show.wheels && <div aria-hidden className="h-16 md:h-24" />}
      </div>
      {show.wheels && <WheelSpeeds />}
    </>
  )
}

/** The vehicle numbers the readings are worked out from. */
function VehicleNote() {
  const vehicle = useSettings((s) => s.vehicle)
  return (
    <p className="num flex flex-wrap items-center gap-x-2 px-1 text-[11px] text-faint">
      <span>
        {vehicle.wheelDiameterMm} mm wheel · {vehicle.motorPoles} poles · {vehicle.batteryCells}S {vehicle.batteryAh} Ah
      </span>
      <Link to="/settings" hash="vehicle" className="text-muted underline decoration-line-strong underline-offset-2 hover:text-text">
        Vehicle
      </Link>
    </p>
  )
}

const NO_FAULTS: Dash['faults'] = []

function Alerts() {
  const faults = useTelemetry((s) => s.dash?.faults ?? NO_FAULTS)
  const link = useSession((s) => s.link)
  const reconnecting = useSession((s) => s.status === 'reconnecting')
  return (
    <>
      {reconnecting && <ReconnectBanner frozen />}
      {!reconnecting && link !== 'ok' && (
        <div role="status" className="card flex items-center gap-3 border-warn/30 bg-warn/5 p-3.5 text-sm">
          <WifiOff className="size-4 shrink-0 text-warn" />
          <span>{link === 'lost' ? 'No answer from the controller. Values are frozen.' : 'Slow connection. Some updates were missed.'}</span>
        </div>
      )}
      {faults.map((f) => {
        const info = faultInfo(f.code)
        return (
          <div key={`${f.target}-${f.code}`} role="alert" className="card flex items-start gap-3 border-danger/35 bg-danger/5 p-4 text-sm">
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
    </>
  )
}

const HERO: Record<
  HeroId,
  {
    label: string
    read: (d: Dash, units: 'metric' | 'imperial') => { value: number; digits: number; unit: string }
  }
> = {
  speed: {
    label: 'Speed',
    read: (d, u) => ({
      value: convertSpeed(d.speed, u),
      digits: 0,
      unit: unitLabels(u).speed,
    }),
  },
  power: {
    label: 'Power',
    read: (d) => ({
      value: d.power / 1000,
      digits: Math.abs(d.power) < 10_000 ? 2 : 1,
      unit: 'kW',
    }),
  },
  battery: {
    label: 'Battery',
    read: (d) => ({ value: d.soc, digits: 0, unit: '%' }),
  },
}

/** `compact` is the one-screen layout's: smaller, with the battery as a line of its own and the Customize button. */
function Hero({ compact = false, onCustomize }: { compact?: boolean; onCustomize?: () => void }) {
  const dash = useTelemetry((s) => s.dash)!
  const trip = useTelemetry((s) => s.trip)
  const units = useSettings((s) => s.units)
  const hero = useDashLayout((s) => s.hero)
  const showTrip = useDashLayout((s) => s.show.trip)
  const showBattery = useDashLayout((s) => s.show.battery)
  const isDemo = useSession((s) => s.transportKind === 'mock')
  const big = HERO[hero].read(dash, units)
  return (
    <section className={cx('card relative overflow-hidden', compact ? 'p-3.5' : 'p-4 md:p-6')} aria-label="Speed and power">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(90% 70% at 0% 0%, color-mix(in oklab, var(--accent) 9%, transparent), transparent 70%)',
        }}
      />
      <div className="relative flex items-center gap-2">
        <span className="label">{HERO[hero].label}</span>
        {isDemo && <Badge tone="accent">Demo</Badge>}
        {dash.view !== 'all' ? (
          <Badge>{targetLabel(dash.view)} only</Badge>
        ) : (
          dash.controllers > 1 && !compact && <Badge>{dash.controllers} motors</Badge>
        )}
        <span className="ml-auto -my-1 -mr-1.5 flex items-center">
          <RecordButton />
          {onCustomize && (
            <button
              aria-label="Customize"
              onClick={onCustomize}
              className="focus-ring flex size-8 items-center justify-center rounded-xl text-muted hover:bg-surface-3 hover:text-text"
            >
              <LayoutGrid className="size-4" />
            </button>
          )}
        </span>
      </div>
      <div className={cx('relative flex items-stretch gap-4 md:gap-6', compact ? 'mt-1.5' : 'mt-2')}>
        <div className="flex min-w-0 flex-1 items-end gap-2 md:gap-3">
          {/* On one screen the number also gives way to a short viewport. */}
          <span
            className="readout leading-[0.8]"
            style={{ fontSize: compact ? 'clamp(56px, min(24vw, 13svh), 120px)' : 'clamp(100px, 29vw, 188px)' }}
            aria-live="off"
          >
            <TweenNumber value={big.value} digits={big.digits} ms={260} className="num" />
          </span>
          <span className="mb-1 text-lg font-medium text-muted md:mb-3 md:text-xl">{big.unit}</span>
        </div>
        <PowerColumn power={dash.power} peakDrive={trip.peakPower} peakRegen={trip.peakRegenPower} compact={compact} />
      </div>
      {compact && showBattery && <BatteryLine dash={dash} percent={hero !== 'battery'} />}
      {showTrip && <TripStrip trip={trip} compact={compact} />}
    </section>
  )
}

/** Drive fills upward from the mark, regen downward. Scaled to this trip's peaks. */
function PowerColumn({ power, peakDrive, peakRegen, compact }: { power: number; peakDrive: number; peakRegen: number; compact: boolean }) {
  const drive = power > 0 ? Math.min(1, power / Math.max(1500, peakDrive)) : 0
  const regen = power < 0 ? Math.min(1, -power / Math.max(600, -peakRegen)) : 0
  return (
    <div className="flex shrink-0 items-end gap-2.5" role="img" aria-label={`Power ${fmt(power / 1000, 2)} kilowatts`}>
      <div className="pb-0.5 text-right leading-none">
        <div className={cx('num text-[15px] font-medium md:text-base', power < -50 && 'text-regen')}>{fmt(Math.abs(power) / 1000, 1)}</div>
        <div className="label mt-1 text-[9px]">{power < -50 ? 'kW in' : 'kW'}</div>
      </div>
      <div className={cx('flex h-full w-1.5 flex-col gap-[3px]', compact ? 'min-h-14' : 'min-h-20')}>
        <div className="relative flex-[2.6] overflow-hidden rounded-full bg-surface-3">
          <div
            className="absolute inset-x-0 bottom-0 rounded-full bg-accent transition-[height] duration-150 ease-out"
            style={{
              height: `${drive * 100}%`,
              boxShadow: drive ? '0 0 12px var(--accent)' : undefined,
            }}
          />
        </div>
        <div className="relative flex-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className="absolute inset-x-0 top-0 rounded-full bg-regen transition-[height] duration-150 ease-out"
            style={{
              height: `${regen * 100}%`,
              boxShadow: regen ? '0 0 12px var(--color-regen)' : undefined,
            }}
          />
        </div>
      </div>
    </div>
  )
}

/** The battery in one line, for the one-screen layout. `percent` is off when the big reading already shows it. */
function BatteryLine({ dash, percent }: { dash: Dash; percent: boolean }) {
  const units = useSettings((s) => s.units)
  return (
    <div className="num relative mt-3 flex items-center gap-2.5 text-xs text-muted">
      <div className="min-w-0 flex-1">
        <BatteryGauge soc={dash.soc} slim />
      </div>
      {percent && (
        <span className={cx('text-[13px] font-semibold', dash.soc < 10 ? 'text-danger' : dash.soc < 25 ? 'text-warn' : 'text-text')}>
          {fmt(dash.soc, 0)} %
        </span>
      )}
      <span>{fmt(dash.vIn, 1)} V</span>
      {dash.rangeKm !== null && (
        <span>
          {fmt(convertDistance(dash.rangeKm, units), 0)} {unitLabels(units).distance}
        </span>
      )}
    </div>
  )
}

function TripStrip({ trip, compact }: { trip: Trip; compact: boolean }) {
  const units = useSettings((s) => s.units)
  const u = unitLabels(units)
  const avg = avgSpeed(trip)
  const stats = [
    {
      label: 'Trip',
      value: fmt(convertDistance(trip.distanceKm, units), 1),
      unit: u.distance,
    },
    { label: 'Riding', value: fmtDuration(trip.rideSeconds) },
    {
      label: 'Average',
      value: avg === null ? '—' : fmt(convertSpeed(avg, units), 0),
      unit: u.speed,
    },
    {
      label: 'Top',
      value: fmt(convertSpeed(trip.maxSpeed, units), 0),
      unit: u.speed,
    },
  ]
  return (
    <dl
      className={cx(
        'relative grid grid-cols-4 border-t border-line',
        // On one screen the trip gives way first when the viewport is short.
        compact ? 'mt-3 pt-2.5 [@media(max-height:600px)]:hidden' : 'mt-5 pt-3.5 md:mt-6 md:pt-4',
      )}
    >
      {stats.map((s, i) => (
        <div key={s.label} className={cx('min-w-0 px-2 md:px-4', i === 0 ? 'pl-0 md:pl-0' : 'border-l border-line')}>
          <dt className="label text-[9.5px]">{s.label}</dt>
          <dd className="num mt-1 truncate text-[15px] md:text-lg">
            {s.value}
            {s.unit && <span className="ml-1 text-[11px] text-muted">{s.unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function BatteryCard() {
  const dash = useTelemetry((s) => s.dash)!
  const trip = useTelemetry((s) => s.trip)
  const units = useSettings((s) => s.units)
  const u = unitLabels(units)
  return (
    <section className="card flex flex-col justify-between gap-3 p-4 md:gap-5 md:p-6" aria-label="Battery">
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="label">Battery</span>
          <span className="num text-xs text-muted">
            {fmt(dash.vIn, 1)} V · {fmt(dash.cellV, 2)} V/cell
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <TweenNumber
            value={dash.soc}
            ms={400}
            className={cx('readout text-[52px] leading-none md:text-[72px]', dash.soc < 10 ? 'text-danger' : dash.soc < 25 ? 'text-warn' : '')}
          />
          <span className="text-lg text-muted">%</span>
        </div>
        <div className="mt-3 md:mt-4">
          <BatteryGauge soc={dash.soc} />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 border-t border-line pt-3 md:pt-4">
        <div>
          <dt className="label text-[9.5px]">Range</dt>
          <dd className="num mt-1 text-2xl">
            {dash.rangeKm === null ? '—' : fmt(convertDistance(dash.rangeKm, units), 0)}
            <span className="ml-1 text-sm text-muted">{u.distance}</span>
          </dd>
          {dash.rangeKm === null && <dd className="mt-0.5 text-[11px] text-faint">ride a little first</dd>}
        </div>
        <div>
          <dt className="label text-[9.5px]">Using</dt>
          <dd className="num mt-1 text-2xl">
            {trip.whPerKm === null ? '—' : fmt(convertPerDistance(trip.whPerKm, units), 1)}
            <span className="ml-1 text-sm text-muted">{u.perDistance}</span>
          </dd>
        </div>
      </dl>
    </section>
  )
}
