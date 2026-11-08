import { Loader2 } from 'lucide-react'
import { useSession } from '../state/session'
import { Button } from './Primitives'

/** Shown while the app is trying to get a dropped connection back. */
export function ReconnectBanner({ frozen = false }: { frozen?: boolean }) {
  const reconnect = useSession((s) => s.reconnect)
  const kind = useSession((s) => s.transportKind)
  const label = useSession((s) => s.transportLabel)
  const disconnect = useSession((s) => s.disconnect)
  if (!reconnect) return null

  const hint =
    kind === 'serial'
      ? 'Plug the USB cable back in and it picks up by itself.'
      : kind === 'ble'
        ? 'Make sure the controller is switched on and close by.'
        : ''

  return (
    <div role="status" aria-live="polite" className="card flex items-center gap-3 border-warn/30 bg-warn/5 p-3.5 text-sm">
      <Loader2 className="size-4 shrink-0 animate-spin text-warn" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          Reconnecting to {label}
          {reconnect.attempt > 1 && <span className="num ml-2 font-normal text-muted">try {reconnect.attempt}</span>}
        </div>
        <div className="mt-0.5 text-muted">
          {reconnect.reason}. {hint}
          {frozen && ' Values below are from before the drop.'}
        </div>
      </div>
      <Button variant="ghost" className="h-8 shrink-0 px-3 text-xs" onClick={() => void disconnect()}>
        Stop
      </Button>
    </div>
  )
}
