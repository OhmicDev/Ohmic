import { Link } from '@tanstack/react-router'
import { Loader2, Plug } from 'lucide-react'
import { cx, fmt } from '../lib/format'
import { useConnectSheet } from '../state/autoConnect'
import { useSession } from '../state/session'
import { useTelemetry } from '../state/telemetry'

export function ConnectionChip() {
  const status = useSession((s) => s.status)
  const step = useSession((s) => s.step)
  const fw = useSession((s) => s.fw)
  const kind = useSession((s) => s.transportKind)
  const link = useSession((s) => s.link)
  const vIn = useTelemetry((s) => s.dash?.vIn)
  const soc = useTelemetry((s) => s.dash?.soc)

  const show = useConnectSheet((s) => s.show)

  const base =
    'focus-ring inline-flex h-8 items-center gap-2 rounded-full border border-line bg-surface-2 pl-2.5 pr-3 text-[13px] transition-colors hover:border-line-strong md:h-9 md:gap-2.5 md:pl-3 md:pr-3.5'

  if (status === 'connecting') {
    return (
      <button onClick={show} className={base}>
        <Loader2 className="size-3.5 animate-spin text-accent" />
        <span className="max-w-[9rem] truncate text-muted md:max-w-[11rem]">{step ?? 'Connecting'}…</span>
      </button>
    )
  }

  if (status === 'reconnecting') {
    return (
      <Link to="/connect" className={cx(base, 'border-warn/40')} title="Trying to reconnect">
        <Loader2 className="size-3.5 animate-spin text-warn" />
        <span className="text-warn">Reconnecting…</span>
      </Link>
    )
  }

  if (status !== 'connected') {
    return (
      <button onClick={show} className={cx(base, status === 'error' ? 'border-danger/40' : 'border-accent/40 bg-accent/10')}>
        {status === 'error' ? <span className="size-2 rounded-full bg-danger" /> : <Plug className="size-3.5 text-accent" />}
        <span className={status === 'error' ? 'text-danger' : 'font-medium text-accent'}>{status === 'error' ? 'Disconnected' : 'Connect'}</span>
      </button>
    )
  }

  const dot = link === 'ok' ? 'bg-ok' : link === 'slow' ? 'bg-warn' : 'bg-danger'
  return (
    <Link to="/connect" className={base} title="Connection details">
      <span className={cx('live-dot size-2 rounded-full', dot)} style={{ ['--pulse-color' as string]: `var(--color-${link === 'ok' ? 'ok' : link === 'slow' ? 'warn' : 'danger'})` }} />
      <span className="max-w-[9rem] truncate font-medium">{kind === 'mock' ? 'Demo' : fw?.hwName}</span>
      {vIn !== undefined && (
        <span className="num hidden text-muted min-[380px]:inline">
          {fmt(vIn, 1)} V · {fmt(soc, 0)} %
        </span>
      )}
    </Link>
  )
}
