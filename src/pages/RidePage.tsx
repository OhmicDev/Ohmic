import { Link } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useSession } from '../state/session'
import { useTelemetry } from '../state/telemetry'
import { ConnectPanel } from './ConnectPage'
import { Dashboard } from './ride/Dashboard'

export function RidePage() {
  const status = useSession((s) => s.status)
  const primary = useSession((s) => s.primary)
  const hasData = useTelemetry((s) => s.dash !== null)
  const live = status === 'connected' || status === 'reconnecting'
  if (live && hasData) return <Dashboard />
  return (
    <div className="space-y-5">
      <div>
        <h1 className="wide text-[26px] font-bold md:text-[28px]">Ride</h1>
        <p className="mt-1 text-sm text-muted">Connect to see your ride live.</p>
      </div>
      {status === 'connected' && primary === null ? (
        <div className="card p-5 text-sm">
          <div className="font-semibold">No motor controller found</div>
          <p className="mt-1 max-w-xl leading-relaxed text-muted">
            This device isn't a motor controller and none answered on CAN. Check the wiring, then scan again from{' '}
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
        <div className="max-w-xl">
          <ConnectPanel />
        </div>
      )}
    </div>
  )
}
