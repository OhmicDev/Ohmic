import { Link } from '@tanstack/react-router'
import { ChevronRight, FileUp, MapPin, Route, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { pickFiles } from '../../lib/files'
import { fmt, fmtDuration } from '../../lib/format'
import { convertDistance, convertPerDistance, convertSpeed, unitLabels } from '../../lib/vehicle'
import { LogFileError, parseVescCsv } from '../../logs/logFiles'
import { averageWhPerKm } from '../../logs/summary'
import { finishInterruptedRides, rideTitle, saveImportedRide, useRideLogs, type RideLog } from '../../state/rideLogs'
import { useRecorder } from '../../state/rideRecorder'
import { useSettings } from '../../state/settings'
import { BackLink, Badge, Button, PageTitle } from '../../ui/Primitives'
import { DeleteRideDialog } from './DeleteRideDialog'
import { RecordCard } from './RecordControls'

interface ImportResult {
  name: string
  id?: string
  error?: string
  notes: string[]
}

export function LogsPage() {
  const { rides: saved, loaded, refresh } = useRideLogs()
  const recordingId = useRecorder((s) => s.rideId)
  const liveSummary = useRecorder((s) => s.summary)
  // The ride being recorded shows its numbers as they come in, not as last saved.
  const rides = useMemo(
    () => saved.map((r) => (r.id === recordingId && liveSummary ? { ...r, summary: liveSummary } : r)),
    [saved, recordingId, liveSummary],
  )
  const units = useSettings((s) => s.units)
  const u = unitLabels(units)
  const [confirm, setConfirm] = useState<RideLog | null>(null)
  const [results, setResults] = useState<ImportResult[] | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    void finishInterruptedRides(useRecorder.getState().rideId).finally(() => void refresh())
  }, [refresh])

  const importFiles = async () => {
    const files = await pickFiles('.csv,text/csv,text/plain')
    if (!files.length) return
    setImporting(true)
    const out: ImportResult[] = []
    for (const file of files) {
      try {
        const log = parseVescCsv(await file.text(), { fileName: file.name, lastModified: file.lastModified, vehicle: useSettings.getState().vehicle })
        const id = await saveImportedRide(log, file.name)
        const notes = [...log.notes]
        if (log.skipped.length) notes.push(`${log.skipped.length} column${log.skipped.length === 1 ? '' : 's'} this app doesn’t use ${log.skipped.length === 1 ? 'was' : 'were'} left out.`)
        out.push({ name: file.name, id, notes })
      } catch (e) {
        out.push({ name: file.name, error: e instanceof LogFileError ? e.message : 'The file couldn’t be read.', notes: [] })
      }
    }
    setImporting(false)
    setResults(out)
  }

  const totalKm = rides.reduce((n, r) => n + r.summary.distanceKm, 0)
  const totalS = rides.reduce((n, r) => n + r.summary.movingS, 0)
  const avg = averageWhPerKm(rides)

  return (
    <>
      <BackLink to="/more">More</BackLink>
      <PageTitle
        title="Ride logs"
        subtitle="Your rides, routes and charts. Works with VESC Tool logs."
        actions={
          <Button onClick={() => void importFiles()} disabled={importing}>
            <FileUp className="size-4" /> {importing ? 'Importing…' : 'Import VESC Tool log'}
          </Button>
        }
      />
      <div className="space-y-4">
        <RecordCard />

        {results && (
          <section className="card space-y-2 p-4 text-sm" aria-live="polite">
            {results.map((r) => (
              <div key={r.name}>
                {r.id ? (
                  <>
                    Imported <span className="font-medium">{r.name}</span>.{' '}
                    <Link to="/logs/$rideId" params={{ rideId: r.id }} className="text-accent underline-offset-2 hover:underline">
                      Open it
                    </Link>
                  </>
                ) : (
                  <span className="text-warn">
                    {r.name}: {r.error}
                  </span>
                )}
                {r.notes.map((n) => (
                  <div key={n} className="text-xs text-muted">
                    {n}
                  </div>
                ))}
              </div>
            ))}
            <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => setResults(null)}>
              Dismiss
            </Button>
          </section>
        )}

        {rides.length > 0 && (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Total label="Rides" value={String(rides.length)} />
            <Total label="Distance" value={fmt(convertDistance(totalKm, units), 1)} unit={u.distance} />
            <Total label="Riding time" value={fmtDuration(totalS)} />
            <Total label="Average use" value={avg === null ? '—' : fmt(convertPerDistance(avg, units), 1)} unit={u.perDistance} />
          </dl>
        )}

        {loaded && rides.length === 0 && (
          <div className="card flex flex-col items-center gap-2 p-8 text-center">
            <Route className="size-8 text-faint" />
            <div className="font-semibold">No rides yet</div>
            <p className="max-w-md text-sm text-muted">Start recording before you ride, or import a CSV log from VESC Tool or a VESC Express.</p>
          </div>
        )}

        {rides.length > 0 && (
          <ul className="card divide-y divide-line" aria-label="Saved rides">
            {rides.map((r) => (
              <li key={r.id} className="flex items-center gap-2 pr-2">
                <Link to="/logs/$rideId" params={{ rideId: r.id }} className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl p-4 transition-colors hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{rideTitle(r)}</span>
                      {r.id === recordingId && <Badge tone="warn">Recording</Badge>}
                      {r.source === 'imported' && <Badge>Imported</Badge>}
                      {r.demo && <Badge tone="accent">Demo</Badge>}
                      {r.hasGps && <MapPin className="size-3.5 text-faint" aria-label="Has a GPS route" />}
                    </div>
                    <div className="num mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                      {r.name && <span>{new Date(r.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>}
                      <span>{fmtDuration(r.summary.durationS)}</span>
                      <span>
                        {fmt(convertDistance(r.summary.distanceKm, units), 2)} {u.distance}
                      </span>
                      <span>
                        top {fmt(convertSpeed(r.summary.maxSpeed, units), 0)} {u.speed}
                      </span>
                      <span>{fmt(Math.max(0, r.summary.whUsed - r.summary.whCharged), 0)} Wh</span>
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-faint" />
                </Link>
                <button
                  onClick={() => setConfirm(r)}
                  disabled={r.id === recordingId}
                  aria-label={`Delete ${rideTitle(r)}`}
                  className="focus-ring shrink-0 rounded-lg p-2 text-faint transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-30"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <DeleteRideDialog ride={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}

function Total({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="card p-4">
      <dt className="label text-[9.5px]">{label}</dt>
      <dd className="num mt-1 text-xl font-semibold">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted">{unit}</span>}
      </dd>
    </div>
  )
}
