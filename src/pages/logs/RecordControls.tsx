import { Link } from '@tanstack/react-router'
import { Circle, Loader2, MapPin, Square } from 'lucide-react'
import { cx, fmt, fmtDuration } from '../../lib/format'
import { convertDistance, unitLabels } from '../../lib/vehicle'
import { GPS_STATUS_TEXT } from '../../logs/sensors'
import { useRecorder, type ImuStatus } from '../../state/rideRecorder'
import { maxPollHz, useSession } from '../../state/session'
import { useSettings, type LogRateHz } from '../../state/settings'
import { Button, Segmented } from '../../ui/Primitives'
import { Toggle } from '../../ui/Toggle'
import { useNow } from '../../ui/useNow'

const IMU_TEXT: Record<ImuStatus, string> = {
  off: '',
  waiting: 'Looking for an IMU…',
  controller: 'Lean and acceleration from the controller’s IMU',
  phone: 'Lean and acceleration from this phone',
  none: 'No IMU found on the controller or this device',
}

/** Recording on the Logs page: options while stopped, progress while running. */
export function RecordCard() {
  const r = useRecorder()
  const s = useSettings()
  const connected = useSession((x) => x.status === 'connected' && x.primary !== null)
  const kind = useSession((x) => x.transportKind)
  const units = s.units
  const now = useNow(1000)
  const recording = r.status !== 'idle'
  const liveHz = Math.min(s.pollHz, maxPollHz(kind))

  return (
    <section className="card p-5" aria-label="Record a ride">
      <div className="flex flex-wrap items-center gap-4">
        <span className={cx('flex size-12 items-center justify-center rounded-2xl', recording ? 'bg-danger/12 text-danger' : 'bg-accent/10 text-accent')}>
          {r.status === 'stopping' ? <Loader2 className="size-6 animate-spin" /> : <Circle className={cx('size-6', recording && 'animate-pulse fill-current')} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold">{recording ? 'Recording' : 'Record a ride'}</div>
          <div className="text-sm text-muted">
            {recording && r.startedAt ? (
              <span className="num">
                {fmtDuration((now - r.startedAt) / 1000)} · {fmt(convertDistance(r.summary?.distanceKm ?? 0, units), 2)} {unitLabels(units).distance} · {r.rows} rows at {r.rateHz} Hz
              </span>
            ) : connected ? (
              'Saves speed, power, battery and temperatures as you ride, with your route if GPS is on.'
            ) : (
              'Connect to your vehicle to record.'
            )}
          </div>
        </div>
        {recording ? (
          <Button variant="danger" className="h-11 px-5" disabled={r.status === 'stopping'} onClick={() => void r.stop()}>
            <Square className="size-4 fill-current" /> Stop and save
          </Button>
        ) : (
          <Button variant="primary" className="h-11 px-5" disabled={!connected} onClick={() => void r.start()}>
            <Circle className="size-4 fill-current" /> Start recording
          </Button>
        )}
      </div>

      {recording && (
        <ul className="mt-4 space-y-1 border-t border-line pt-3 text-sm text-muted">
          {r.gps !== 'off' && (
            <li className={cx('flex items-center gap-2', (r.gps === 'denied' || r.gps === 'unavailable') && 'text-warn')}>
              <MapPin className="size-3.5 shrink-0" />
              {GPS_STATUS_TEXT[r.gps]}
              {r.gps === 'ok' && r.gpsAccuracy !== null && <span className="num text-faint">± {fmt(r.gpsAccuracy, 0)} m</span>}
            </li>
          )}
          {r.imu !== 'off' && <li className={cx(r.imu === 'none' && 'text-faint')}>{IMU_TEXT[r.imu]}</li>}
          <li className="text-faint">Keep this page open: the screen stays on while recording. Rows are saved every few seconds.</li>
        </ul>
      )}

      {!recording && (
        <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
          <div>
            <div className="label mb-1.5">Rows per second</div>
            <Segmented<LogRateHz>
              label="Rows per second"
              value={s.logRateHz}
              onChange={s.setLogRateHz}
              options={[
                { value: 5, label: '5 Hz' },
                { value: 10, label: '10 Hz' },
                { value: 20, label: '20 Hz' },
              ]}
            />
            {s.logRateHz > liveHz && (
              <p className="mt-1.5 text-xs text-warn">
                Live data updates {liveHz} times a second, so the log gets {liveHz}. Raise the update rate in More › Settings › Connection.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">GPS route</span>
              <span className="block text-xs text-muted">Uses this phone’s location for the map.</span>
            </span>
            <Toggle checked={s.logGps} onChange={s.setLogGps} label="Record GPS route" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">Lean and motion</span>
              <span className="block text-xs text-muted">The controller’s IMU, or this phone’s.</span>
            </span>
            <Toggle checked={s.logImu} onChange={s.setLogImu} label="Record lean and motion" />
          </div>
        </div>
      )}

      {!recording && r.lastSavedId && (
        <p className="mt-3 text-sm">
          Ride saved.{' '}
          <Link to="/logs/$rideId" params={{ rideId: r.lastSavedId }} className="font-medium text-accent underline-offset-2 hover:underline">
            View it
          </Link>
        </p>
      )}
      {r.error && <p className="mt-3 text-sm text-warn">{r.error}</p>}
    </section>
  )
}

/** Record / stop on the Ride dashboard. */
export function RecordButton() {
  const r = useRecorder()
  const now = useNow(1000)
  if (r.status === 'idle')
    return (
      <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => void r.start()}>
        <Circle className="size-3 fill-danger text-danger" /> Record
      </Button>
    )
  return (
    <span className="flex items-center gap-1">
      <Link to="/logs" className="focus-ring num flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-danger">
        <Circle className="size-2.5 animate-pulse fill-current" />
        {r.startedAt ? fmtDuration((now - r.startedAt) / 1000) : ''}
      </Link>
      <Button variant="ghost" className="h-8 px-2.5 text-xs" disabled={r.status === 'stopping'} onClick={() => void r.stop()}>
        <Square className="size-3 fill-current" /> Stop
      </Button>
    </span>
  )
}
