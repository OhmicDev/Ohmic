import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, Check, Download, Loader2, MapPinOff, Pencil, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { downloadText, safeFileName, stamp } from '../../lib/files'
import { fmt, fmtDuration } from '../../lib/format'
import { convertDistance, convertPerDistance, convertSpeed, convertTemp, unitLabels, type Units } from '../../lib/vehicle'
import { hasGps, type RideData } from '../../logs/columns'
import { toGpx, toVescCsv } from '../../logs/logFiles'
import { faultInfo } from '../../protocol/faults'
import { getRide, loadRideData, reconcileRide, renameRide, rideTitle, useRideLogs, type RideLog } from '../../state/rideLogs'
import { useRecorder } from '../../state/rideRecorder'
import { useSettings } from '../../state/settings'
import { Badge, Button, Segmented } from '../../ui/Primitives'
import { DeleteRideDialog } from './DeleteRideDialog'
import { RideCharts } from './RideCharts'
import { MAP_METRICS, type MapMetric } from '../../logs/mapMetrics'
import { RideMap } from './RideMap'

export function RideDetailPage() {
  const { rideId } = useParams({ strict: false }) as { rideId?: string }
  if (!rideId) return <Centered>No ride chosen.</Centered>
  // A new ride starts from scratch: nothing loaded, scrubbed to the start.
  return <RideDetail key={rideId} rideId={rideId} />
}

function RideDetail({ rideId }: { rideId: string }) {
  const navigate = useNavigate()
  const units = useSettings((s) => s.units)
  const recordingId = useRecorder((s) => s.rideId)
  // Refreshes when the ride is renamed (or saved again while recording).
  const listed = useRideLogs((s) => s.rides.find((r) => r.id === rideId))
  const [ride, setRide] = useState<RideLog | null | undefined>(undefined)
  const [data, setData] = useState<RideData | null>(null)
  const [index, setIndex] = useState(0)
  const [metric, setMetric] = useState<MapMetric>('speed')
  const [deleting, setDeleting] = useState<RideLog | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const r = await getRide(rideId)
      if (!live) return
      setRide(r ?? null)
      if (!r) return
      const d = await loadRideData(rideId)
      if (!live) return
      setData(d)
      if (r.id !== useRecorder.getState().rideId) {
        const fixed = await reconcileRide(r, d)
        if (live && fixed !== r) setRide(fixed)
      }
    })()
    return () => {
      live = false
    }
  }, [rideId])

  if (ride === undefined) return <Centered>Loading ride…</Centered>
  if (ride === null)
    return (
      <Centered>
        This ride isn’t saved in this browser.{' '}
        <Link to="/logs" className="text-accent underline-offset-2 hover:underline">
          Back to rides
        </Link>
      </Centered>
    )

  const shown = listed ?? ride
  const s = shown.summary
  const u = unitLabels(units)
  const recording = shown.id === recordingId
  const title = rideTitle(shown)

  const exportCsv = () => data && downloadText(`${safeFileName(title)}_${stamp(shown.startedAt)}.csv`, toVescCsv(data, shown.startedAt), 'text/csv')
  const exportGpx = () => data && downloadText(`${safeFileName(title)}_${stamp(shown.startedAt)}.gpx`, toGpx(data, shown.startedAt, title), 'application/gpx+xml')

  return (
    <>
      <Link to="/logs" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Ride logs
      </Link>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <TitleEditor ride={shown} />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{new Date(shown.startedAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}</span>
            {recording && <Badge tone="warn">Recording</Badge>}
            {shown.source === 'imported' && <Badge>Imported{shown.fileName ? ` · ${shown.fileName}` : ''}</Badge>}
            {shown.demo && <Badge tone="accent">Demo</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportCsv} disabled={!data}>
            <Download className="size-4" /> CSV for VESC Tool
          </Button>
          <Button onClick={exportGpx} disabled={!data || !shown.hasGps}>
            <Download className="size-4" /> GPX
          </Button>
          <Button variant="ghost" onClick={() => setDeleting(shown)} disabled={recording} aria-label="Delete ride">
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {recording && <p className="mb-4 text-sm text-muted">This ride is still being recorded. Showing what had been saved when you opened it.</p>}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Distance" value={fmt(convertDistance(s.distanceKm, units), 2)} unit={u.distance} />
        <Stat label="Riding time" value={fmtDuration(s.movingS)} hint={`of ${fmtDuration(s.durationS)}`} />
        <Stat label="Average" value={s.avgSpeed === null ? '—' : fmt(convertSpeed(s.avgSpeed, units), 1)} unit={u.speed} hint="while moving" />
        <Stat label="Top speed" value={fmt(convertSpeed(s.maxSpeed, units), 1)} unit={u.speed} />
        <Stat label="Energy" value={fmt(Math.max(0, s.whUsed - s.whCharged), 0)} unit="Wh" hint={s.whCharged > 0.5 ? `${fmt(s.whCharged, 0)} Wh back from braking` : undefined} />
        <Stat label="Using" value={s.whPerKm === null ? '—' : fmt(convertPerDistance(s.whPerKm, units), 1)} unit={u.perDistance} />
        <Stat label="Peak power" value={fmt(s.peakPower / 1000, 2)} unit="kW" hint={s.peakRegenPower < -50 ? `${fmt(-s.peakRegenPower / 1000, 2)} kW braking` : undefined} />
        <Stat label="Peak current" value={fmt(s.maxCurrentIn, 0)} unit="A" hint={`motor ${fmt(s.maxCurrentMotor, 0)} A`} />
        <Stat label="Motor temp" value={s.maxTempMotor === null ? '—' : fmt(convertTemp(s.maxTempMotor, units), 0)} unit={u.temp} hint="hottest" />
        <Stat label="Controller temp" value={s.maxTempFet === null ? '—' : fmt(convertTemp(s.maxTempFet, units), 0)} unit={u.temp} hint="hottest" />
        <Stat label="Lowest voltage" value={s.minVoltage === null ? '—' : fmt(s.minVoltage, 1)} unit="V" />
        <Stat
          label="Battery"
          value={s.startSoc === null || s.endSoc === null ? '—' : `${fmt(s.startSoc, 0)} → ${fmt(s.endSoc, 0)}`}
          unit={s.startSoc === null ? undefined : '%'}
          hint={s.faults ? `${s.faults} fault${s.faults === 1 ? '' : 's'}` : undefined}
          warn={s.faults > 0}
        />
      </dl>

      {!data ? (
        <Centered>
          <Loader2 className="size-4 animate-spin text-accent" /> Loading rows…
        </Centered>
      ) : data.rows === 0 ? (
        <Centered>This ride has no rows.</Centered>
      ) : (
        <RideBody data={data} units={units} index={Math.min(index, data.rows - 1)} setIndex={setIndex} metric={metric} setMetric={setMetric} />
      )}

      <DeleteRideDialog ride={deleting} onClose={() => setDeleting(null)} onDeleted={() => void navigate({ to: '/logs' })} />
    </>
  )
}

function RideBody({
  data,
  units,
  index,
  setIndex,
  metric,
  setMetric,
}: {
  data: RideData
  units: Units
  index: number
  setIndex: (i: number) => void
  metric: MapMetric
  setMetric: (m: MapMetric) => void
}) {
  const gps = useMemo(() => hasGps(data), [data])
  const c = data.cols
  const u = unitLabels(units)
  const fault = c.fault[index]
  return (
    <div className="mt-4 space-y-4">
      <section className="card p-4 md:p-5" aria-label="Route">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Route</h2>
          {gps && (
            <Segmented<MapMetric>
              label="Colour the route by"
              value={metric}
              onChange={setMetric}
              options={(Object.keys(MAP_METRICS) as MapMetric[]).map((m) => ({ value: m, label: MAP_METRICS[m].label }))}
            />
          )}
        </div>
        {gps ? (
          <RideMap data={data} metric={metric} units={units} index={index} onPick={setIndex} />
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-line-strong p-5 text-sm text-muted">
            <MapPinOff className="size-5 shrink-0 text-faint" />
            No GPS in this ride. Turn on “GPS route” before recording to see it on a map.
          </div>
        )}

        <div className="mt-4">
          <input
            type="range"
            min={0}
            max={data.rows - 1}
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
            className="scrubber w-full"
            aria-label="Position in the ride"
            aria-valuetext={fmtDuration(c.t[index] / 1000)}
          />
          <dl className="num mt-2 grid grid-cols-3 gap-x-4 gap-y-2 text-sm sm:grid-cols-4 lg:grid-cols-8">
            <Reading label="Time" value={fmtDuration(c.t[index] / 1000)} />
            <Reading label="Distance" value={`${fmt(convertDistance(c.distance[index], units), 2)} ${u.distance}`} />
            <Reading label="Speed" value={`${fmt(convertSpeed(c.speed[index], units), 1)} ${u.speed}`} />
            <Reading label="Power" value={`${fmt(c.power[index] / 1000, 2)} kW`} />
            <Reading label="Battery" value={`${fmt(c.vIn[index], 1)} V${Number.isFinite(c.soc[index]) ? ` · ${fmt(c.soc[index], 0)} %` : ''}`} />
            <Reading label="Motor" value={`${fmt(convertTemp(c.tempMotor[index], units), 0)} ${u.temp}`} />
            <Reading label="Controller" value={`${fmt(convertTemp(c.tempFet[index], units), 0)} ${u.temp}`} />
            <Reading label="Duty" value={`${fmt(c.duty[index], 0)} %`} />
          </dl>
          {Number.isFinite(fault) && fault !== 0 && <p className="mt-2 text-sm text-danger">Fault here: {faultInfo(fault).title}</p>}
        </div>
      </section>

      <section className="card p-4 md:p-5" aria-label="Charts">
        <RideCharts data={data} units={units} index={index} onIndex={setIndex} />
      </section>
    </div>
  )
}

function TitleEditor({ ride }: { ride: RideLog }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  if (!editing)
    return (
      <div className="flex items-center gap-2">
        <h1 className="wide truncate text-2xl font-bold tracking-tight md:text-[28px]">{rideTitle(ride)}</h1>
        <button
          onClick={() => {
            setText(ride.name ?? '')
            setEditing(true)
          }}
          aria-label="Rename ride"
          className="focus-ring rounded-lg p-1.5 text-faint transition-colors hover:bg-surface-3 hover:text-text"
        >
          <Pencil className="size-4" />
        </button>
      </div>
    )
  const save = async () => {
    await renameRide(ride.id, text)
    setEditing(false)
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
        maxLength={80}
        placeholder="Name (empty shows the date)"
        aria-label="Ride name"
        className="focus-ring h-11 w-[min(420px,70vw)] rounded-xl border border-line-strong bg-surface-2 px-3 text-lg font-semibold"
      />
      <Button type="submit" variant="primary" className="h-11" aria-label="Save name">
        <Check className="size-4" />
      </Button>
      <Button type="button" variant="ghost" className="h-11" onClick={() => setEditing(false)} aria-label="Cancel">
        <X className="size-4" />
      </Button>
    </form>
  )
}

function Stat({ label, value, unit, hint, warn }: { label: string; value: string; unit?: string; hint?: string; warn?: boolean }) {
  return (
    <div className="card p-4">
      <dt className="label text-[9.5px]">{label}</dt>
      <dd className="num mt-1 text-xl font-semibold">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted">{unit}</span>}
      </dd>
      {hint && <dd className={warn ? 'mt-0.5 text-[11px] text-warn' : 'mt-0.5 text-[11px] text-faint'}>{hint}</dd>}
    </div>
  )
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label text-[9px]">{label}</dt>
      <dd className="mt-0.5 whitespace-nowrap">{value}</dd>
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="card mt-4 flex items-center justify-center gap-2 p-8 text-sm text-muted">{children}</div>
}
