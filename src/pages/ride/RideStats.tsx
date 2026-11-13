// The ride's statistics, under the dashboard: peaks, averages and energy since
// the trip was last reset, like the statistics page in VESC Tool.

import { Activity, Check, Copy, Flame, Navigation, RotateCcw, Route, Thermometer, Waves, Zap, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { fmt, fmtDuration, fmtThousands } from '../../lib/format'
import { convertDistance, convertPerDistance, convertSpeed, convertTemp, unitLabels, type Units, type VehicleSetup } from '../../lib/vehicle'
import { useSettings } from '../../state/settings'
import { useTelemetry, type Trip } from '../../state/telemetry'
import { Button } from '../../ui/Primitives'
import { avgSpeed } from './tiles'

interface Row {
  label: string
  value: string
  unit?: string
  /** The same in other units, or what it's out of. */
  sub?: string
}

interface Group {
  title: string
  icon: LucideIcon
  rows: Row[]
}

const watts = (w: number) => `${fmtThousands(Math.abs(w) < 0.5 ? 0 : w)} W`
const kw = (w: number) => fmt(w / 1000, 2)

function statGroups(t: Trip, units: Units, vehicle: VehicleSetup, soc: number | null): Group[] {
  const u = unitLabels(units)
  const avg = avgSpeed(t)
  const avgPower = t.rideSeconds > 5 ? t.powerWs / t.rideSeconds : null
  const avgCurrent = t.rideSeconds > 5 ? t.currentAs / t.rideSeconds : null
  const temp = (c: number | null) => (c === null ? '—' : fmt(convertTemp(c, units), 0))
  const cells = vehicle.batteryCells
  return [
    {
      title: 'Speed',
      icon: Navigation,
      rows: [
        {
          label: 'Top speed',
          value: fmt(convertSpeed(t.maxSpeed, units), 1),
          unit: u.speed,
        },
        {
          label: 'Average',
          value: avg === null ? '—' : fmt(convertSpeed(avg, units), 1),
          unit: u.speed,
          sub: 'while moving',
        },
        {
          label: 'Top motor speed',
          value: fmtThousands(t.maxErpm),
          unit: 'ERPM',
        },
        { label: 'Top duty', value: fmt(t.maxDuty * 100, 0), unit: '%' },
      ],
    },
    {
      title: 'Power',
      icon: Zap,
      rows: [
        {
          label: 'Peak',
          value: kw(t.peakPower),
          unit: 'kW',
          sub: watts(t.peakPower),
        },
        {
          label: 'Peak regen',
          value: kw(-t.peakRegenPower),
          unit: 'kW',
          sub: watts(-t.peakRegenPower),
        },
        {
          label: 'Average',
          value: avgPower === null ? '—' : kw(avgPower),
          unit: 'kW',
          sub: avgPower === null ? undefined : watts(avgPower),
        },
      ],
    },
    {
      title: 'Current',
      icon: Activity,
      rows: [
        { label: 'Battery peak', value: fmt(t.maxCurrentIn, 1), unit: 'A' },
        {
          label: 'Battery regen peak',
          value: fmt(-t.minCurrentIn, 1),
          unit: 'A',
        },
        {
          label: 'Battery average',
          value: fmt(avgCurrent, 1),
          unit: 'A',
          sub: 'while moving',
        },
        { label: 'Motor peak', value: fmt(t.maxCurrentMotor, 1), unit: 'A' },
        {
          label: 'Motor braking peak',
          value: fmt(-t.minCurrentMotor, 1),
          unit: 'A',
        },
      ],
    },
    {
      title: 'Battery',
      icon: Waves,
      rows: [
        {
          label: 'Lowest',
          value: fmt(t.minVIn, 1),
          unit: 'V',
          sub: t.minVIn === null ? undefined : `${fmt(t.minVIn / cells, 2)} V/cell`,
        },
        {
          label: 'Highest',
          value: fmt(t.maxVIn, 1),
          unit: 'V',
          sub: t.maxVIn === null ? undefined : `${fmt(t.maxVIn / cells, 2)} V/cell`,
        },
        {
          label: 'Biggest sag',
          value: t.minVIn === null || t.maxVIn === null ? '—' : fmt(t.maxVIn - t.minVIn, 1),
          unit: 'V',
        },
        { label: 'Charge now', value: fmt(soc, 0), unit: '%' },
      ],
    },
    {
      title: 'Temperature',
      icon: Thermometer,
      rows: [
        { label: 'Motor peak', value: temp(t.peakTempMotor), unit: u.temp },
        {
          label: 'Motor average',
          value: temp(t.seconds > 0 ? t.tempMotorS / t.seconds : null),
          unit: u.temp,
        },
        { label: 'Controller peak', value: temp(t.peakTempFet), unit: u.temp },
        {
          label: 'Controller average',
          value: temp(t.seconds > 0 ? t.tempFetS / t.seconds : null),
          unit: u.temp,
        },
      ],
    },
    {
      title: 'Energy',
      icon: Flame,
      rows: [
        {
          label: 'Used',
          value: fmt(t.whUsed, 1),
          unit: 'Wh',
          sub: `${fmt(t.ahUsed, 2)} Ah`,
        },
        {
          label: 'Regenerated',
          value: fmt(t.whCharged, 1),
          unit: 'Wh',
          sub: `${fmt(t.ahCharged, 2)} Ah`,
        },
        { label: 'Net', value: fmt(t.energyWh, 1), unit: 'Wh' },
        {
          label: 'Got back',
          value: t.whUsed > 0.5 ? fmt((t.whCharged / t.whUsed) * 100, 0) : '—',
          unit: '%',
        },
        {
          label: 'Efficiency',
          value: t.whPerKm === null ? '—' : fmt(convertPerDistance(t.whPerKm, units), 1),
          unit: u.perDistance,
        },
      ],
    },
    {
      title: 'Trip',
      icon: Route,
      rows: [
        {
          label: 'Distance',
          value: fmt(convertDistance(t.distanceKm, units), 2),
          unit: u.distance,
        },
        { label: 'Riding', value: fmtDuration(t.rideSeconds) },
        { label: 'Switched on', value: fmtDuration(t.seconds) },
      ],
    },
  ]
}

/** The stats as plain text, for pasting into a message or a forum post. */
function statsText(groups: Group[]): string {
  return groups
    .map((g) => [g.title, ...g.rows.map((r) => `  ${r.label}: ${r.value}${r.unit ? ` ${r.unit}` : ''}${r.sub ? ` (${r.sub})` : ''}`)].join('\n'))
    .join('\n')
}

export function RideStats() {
  const trip = useTelemetry((s) => s.trip)
  const soc = useTelemetry((s) => s.dash?.soc ?? null)
  const resetTrip = useTelemetry((s) => s.resetTrip)
  const units = useSettings((s) => s.units)
  const vehicle = useSettings((s) => s.vehicle)
  const [copied, setCopied] = useState(false)
  const groups = statGroups(trip, units, vehicle, soc)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(statsText(groups))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked: nothing to do.
    }
  }

  return (
    <section aria-label="Ride stats" className="space-y-2.5 pt-2 md:space-y-3">
      <div className="flex items-center gap-2 px-1">
        <h2 className="label">Ride stats</h2>
        <span className="num text-[11px] text-faint">
          since{' '}
          {new Date(trip.startedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <span className="ml-auto flex gap-1">
          <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => void copy()}>
            {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={resetTrip}>
            <RotateCcw className="size-3.5" /> Reset
          </Button>
        </span>
      </div>
      <div className="columns-1 gap-2.5 sm:columns-2 md:gap-3 xl:columns-3">
        {groups.map((g) => (
          <StatGroup key={g.title} group={g} />
        ))}
      </div>
    </section>
  )
}

function StatGroup({ group }: { group: Group }) {
  const Icon = group.icon
  return (
    <div className="card mb-2.5 break-inside-avoid overflow-hidden md:mb-3">
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2 md:px-4">
        <span className="flex size-6 items-center justify-center rounded-md bg-surface-3 text-text ring-1 ring-line ring-inset">
          <Icon className="size-3.5" aria-hidden />
        </span>
        <h3 className="text-[13px] font-semibold">{group.title}</h3>
      </div>
      <dl>
        {group.rows.map((r) => (
          <div key={r.label} className="flex items-baseline gap-3 border-t border-line px-3.5 py-2 md:px-4">
            <dt className="min-w-0 flex-1 truncate text-[13px] text-muted">{r.label}</dt>
            <dd className="num shrink-0 text-right">
              <span className="text-[15px] font-medium">{r.value}</span>
              {r.unit && <span className="ml-1 text-xs text-muted">{r.unit}</span>}
              {r.sub && <span className="block text-[11px] leading-tight text-faint">{r.sub}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
