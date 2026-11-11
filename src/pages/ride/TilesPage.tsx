// The Tiles page: the big reading with the trip under it, the battery, and the
// rider's grid of tiles. On a phone it all fits the page, the tiles sharing the room.

import { useState } from 'react'
import { cx, fmt, fmtDuration } from '../../lib/format'
import { convertDistance, convertPerDistance, convertSpeed, unitLabels } from '../../lib/vehicle'
import { useDashLayout } from '../../state/dashboard'
import { useSettings } from '../../state/settings'
import { useTelemetry, type Dashboard as Dash, type Trip } from '../../state/telemetry'
import { BatteryGauge } from '../../ui/Gauges'
import { TweenNumber } from '../../ui/TweenNumber'
import { ReadingSheet } from './Customize'
import { FitTiles, TileGrid } from './DashTiles'
import { editRing } from './pageInfo'
import { avgSpeed, HERO_IDS, heroReading, useTileCtx } from './tiles'

export function TilesPage({ editing, phone }: { editing: boolean; phone: boolean }) {
  const showBattery = useDashLayout((s) => s.show.battery)
  const hero = useDashLayout((s) => s.hero)
  const [picking, setPicking] = useState(false)
  const sheet = (
    <ReadingSheet
      open={picking}
      onClose={() => setPicking(false)}
      title="Big reading"
      options={HERO_IDS}
      value={hero}
      onPick={(id) => useDashLayout.getState().setHero(id)}
    />
  )
  if (phone)
    return (
      <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto [scrollbar-width:none]">
        <Hero compact editing={editing} onPick={() => setPicking(true)} />
        <FitTiles editing={editing} />
        {sheet}
      </div>
    )
  return (
    <div className="space-y-3">
      <div className={cx('grid gap-3', showBattery && 'lg:grid-cols-[1.55fr_1fr]')}>
        <Hero editing={editing} onPick={() => setPicking(true)} />
        {showBattery && <BatteryCard />}
      </div>
      <TileGrid editing={editing} />
      {sheet}
    </div>
  )
}

/** `compact` is the phone's: smaller, with the battery as a line of its own. While arranging, a tap picks the reading. */
function Hero({ compact = false, editing, onPick }: { compact?: boolean; editing: boolean; onPick: () => void }) {
  const ctx = useTileCtx()
  const hero = useDashLayout((s) => s.hero)
  const showTrip = useDashLayout((s) => s.show.trip)
  const showBattery = useDashLayout((s) => s.show.battery)
  if (!ctx) return null
  const { dash, trip } = ctx
  const big = heroReading(hero, ctx)
  const body = (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(90% 70% at 0% 0%, color-mix(in oklab, var(--accent) 9%, transparent), transparent 70%)' }}
      />
      <span className="label relative block">{big.label}</span>
      <div className={cx('relative flex items-stretch gap-4 md:gap-6', compact ? 'mt-1.5' : 'mt-2')}>
        <div className="flex min-w-0 flex-1 items-end gap-2 md:gap-3">
          {/* On a phone the number also gives way to a short viewport. */}
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
      {compact && showBattery && <BatteryLine dash={dash} percent={hero !== 'battery'} className="mt-3" />}
      {showTrip && <TripStrip trip={trip} compact={compact} />}
    </>
  )
  const box = cx('card relative block w-full overflow-hidden text-left', compact ? 'shrink-0 p-3.5' : 'p-4 md:p-6')
  if (editing)
    return (
      <button type="button" aria-label={`Big reading: ${big.label}. Press to change it`} onClick={onPick} className={cx(box, editRing, 'focus-ring')}>
        {body}
      </button>
    )
  return (
    <section className={box} aria-label="Speed and power">
      {body}
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
            className="absolute inset-0 origin-bottom rounded-full bg-accent transition-transform duration-150 ease-out"
            style={{ transform: `scaleY(${drive})`, boxShadow: drive ? '0 0 12px var(--accent)' : undefined }}
          />
        </div>
        <div className="relative flex-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className="absolute inset-0 origin-top rounded-full bg-regen transition-transform duration-150 ease-out"
            style={{ transform: `scaleY(${regen})`, boxShadow: regen ? '0 0 12px var(--color-regen)' : undefined }}
          />
        </div>
      </div>
    </div>
  )
}

/** The battery in one line. `percent` is off when a bigger reading already shows it. */
export function BatteryLine({ dash, percent, className }: { dash: Dash; percent: boolean; className?: string }) {
  const units = useSettings((s) => s.units)
  return (
    <div className={cx('num relative flex items-center gap-2.5 text-xs text-muted', className)}>
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
    { label: 'Trip', value: fmt(convertDistance(trip.distanceKm, units), 1), unit: u.distance },
    { label: 'Riding', value: fmtDuration(trip.rideSeconds) },
    { label: 'Average', value: avg === null ? '—' : fmt(convertSpeed(avg, units), 0), unit: u.speed },
    { label: 'Top', value: fmt(convertSpeed(trip.maxSpeed, units), 0), unit: u.speed },
  ]
  return (
    <dl
      className={cx(
        'relative grid grid-cols-4 border-t border-line',
        // On a phone the trip gives way first when the viewport is short.
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
  const dash = useTelemetry((s) => s.dash)
  const trip = useTelemetry((s) => s.trip)
  const units = useSettings((s) => s.units)
  if (!dash) return null
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
