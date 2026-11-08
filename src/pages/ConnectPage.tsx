import { Link } from '@tanstack/react-router'
import { Bluetooth, Cable, Loader2, PlayCircle, Power, RefreshCw, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { cx } from '../lib/format'
import { hwTypeLabel } from '../protocol/commands'
import { fwVersionString } from '../protocol/messages'
import { deviceKind, targetKey, targetLabel, type DeviceInfo } from '../state/devices'
import { useSession } from '../state/session'
import { useSettings } from '../state/settings'
import { portName } from '../transport/SerialTransport'
import { detectSupport, supportMessage } from '../transport/support'
import { Badge, Button, PageTitle } from '../ui/Primitives'
import { buttonClass } from '../ui/buttonClass'
import { ReconnectBanner } from '../ui/ReconnectBanner'
import { useKnownDevices } from '../ui/useKnownDevices'

export function ConnectPage() {
  const status = useSession((s) => s.status)
  const live = status === 'connected' || status === 'reconnecting'
  return (
    <>
      <PageTitle
        title={live ? 'Connection' : 'Connect your controller'}
        subtitle={
          live
            ? 'The device you are connected to and everything else on its CAN bus.'
            : 'Plug in a USB cable or use Bluetooth. No hardware nearby? Try the demo scooter.'
        }
      />
      {live ? <DeviceDetails /> : <ConnectPanel />}
    </>
  )
}

export function ConnectPanel() {
  const { status, step, error, connectDemo, connectUsb, connectBluetooth, connectPort, connectBleDevice } = useSession()
  const lastConnection = useSettings((s) => s.lastConnection)
  const support = useMemo(() => detectSupport(), [])
  const usbNote = supportMessage('serial', support)
  const bleNote = supportMessage('bluetooth', support)
  const busy = status === 'connecting'
  const known = useKnownDevices(status === 'idle' || status === 'error')
  const hasKnown = known.ports.length > 0 || known.ble.length > 0

  if (status === 'reconnecting') return <ReconnectBanner />

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="card flex items-start gap-3 border-danger/30 bg-danger/5 p-4 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
          <div>
            <div className="font-semibold text-danger">Couldn't connect</div>
            <div className="mt-0.5 text-muted">{error}</div>
          </div>
        </div>
      )}

      {hasKnown && !busy && (
        <section className="card p-4" aria-label="Devices used before">
          <div className="label">Ready to connect</div>
          <ul className="mt-1.5 divide-y divide-line">
            {known.ports.map((p, i) => (
              <KnownRow key={`usb-${i}`} icon={Cable} name={portName(p)} detail="USB · plugged in" onConnect={() => void connectPort(p)} />
            ))}
            {known.ble.map((d) => (
              <KnownRow
                key={`ble-${d.id}`}
                icon={Bluetooth}
                name={d.name || 'Bluetooth device'}
                detail="Bluetooth · used before"
                onConnect={() => void connectBleDevice(d)}
              />
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <Option
          icon={Cable}
          title="USB cable"
          body="Direct and fastest. Best for setup, detection and firmware updates."
          note={usbNote ?? 'Works in this browser.'}
          noteTone={usbNote ? 'warn' : 'ok'}
          badge={usbNote ? <Badge>Unavailable</Badge> : undefined}
          onClick={() => void connectUsb()}
          disabled={busy || !!usbNote}
          highlight={!usbNote}
        />
        <Option
          icon={Bluetooth}
          title="Bluetooth"
          body="Wireless, through VESC Express or a VESC Bluetooth module. Good for riding."
          note={bleNote ?? 'Works in this browser.'}
          noteTone={bleNote ? 'warn' : 'ok'}
          badge={bleNote ? <Badge>Unavailable</Badge> : undefined}
          onClick={() => void connectBluetooth()}
          disabled={busy || !!bleNote}
          highlight={!bleNote}
        />
        <Option
          icon={PlayCircle}
          title="Demo scooter"
          body="A simulated dual-motor scooter on a looping test ride. Nothing real is changed."
          badge={<Badge tone="accent">Try it</Badge>}
          onClick={() => void connectDemo()}
          disabled={busy}
          highlight={!!usbNote && !!bleNote}
        />
      </div>

      {(!usbNote || !bleNote) && !busy && (
        <p className="flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-xs text-muted">
          <span className="text-faint">Device not in the list?</span>
          {!usbNote && (
            <button className="focus-ring rounded underline decoration-line-strong underline-offset-2 hover:text-text" onClick={() => void connectUsb({ anyDevice: true })}>
              Show every USB serial port
            </button>
          )}
          {!bleNote && (
            <button className="focus-ring rounded underline decoration-line-strong underline-offset-2 hover:text-text" onClick={() => void connectBluetooth({ anyDevice: true })}>
              Show every Bluetooth device
            </button>
          )}
        </p>
      )}

      {lastConnection && !hasKnown && !busy && (
        <p className="px-1 text-xs text-faint">
          Last time: {lastConnection.name} over {lastConnection.kind === 'serial' ? 'USB' : 'Bluetooth'}.
        </p>
      )}

      {busy && (
        <div className="card flex items-center gap-3 p-4 text-sm" aria-live="polite">
          <Loader2 className="size-4 animate-spin text-accent" />
          <span className="text-muted">{step ?? 'Connecting'}…</span>
        </div>
      )}
    </div>
  )
}

function KnownRow({ icon: Icon, name, detail, onConnect }: { icon: LucideIcon; name: string; detail: string; onConnect: () => void }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-accent">
        <Icon className="size-4" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="text-xs text-muted">{detail}</div>
      </div>
      <Button variant="primary" className="h-9 px-3.5" onClick={onConnect}>
        Connect
      </Button>
    </li>
  )
}

function Option({
  icon: Icon,
  title,
  body,
  note,
  noteTone,
  badge,
  onClick,
  disabled,
  highlight,
}: {
  icon: LucideIcon
  title: string
  body: string
  note?: string
  noteTone?: 'ok' | 'warn'
  badge?: ReactNode
  onClick?: () => void
  disabled?: boolean
  highlight?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'card focus-ring group flex flex-col items-start p-5 text-left transition',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-line-strong',
        highlight && !disabled && 'border-accent/30 shadow-[0_0_40px_-18px_var(--accent)]',
      )}
    >
      <div className="flex w-full items-center justify-between">
        <span className={cx('flex size-11 items-center justify-center rounded-xl bg-surface-3', highlight && 'text-accent')}>
          <Icon className="size-5" strokeWidth={1.8} />
        </span>
        {badge}
      </div>
      <div className="wide mt-4 text-[15px] font-semibold">{title}</div>
      <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
      {note && <p className={cx('mt-3 text-xs', noteTone === 'warn' ? 'text-warn' : 'text-ok')}>{note}</p>}
    </button>
  )
}

function DeviceDetails() {
  const { status, fw, devices, primary, view, scanning, transportLabel, transportKind, disconnect, rescanCan, setView } = useSession()
  if (!fw) return null
  const local = devices.find((d) => d.target === 'local')
  const others = devices.filter((d) => d.target !== 'local')
  const motors = devices.filter((d) => d.motor).length
  const rows: [string, ReactNode][] = [
    ['Hardware', fw.hwName],
    ['Firmware', fwVersionString(fw)],
    ['Type', hwTypeLabel(fw.hwType)],
    ['Connection', transportLabel],
    ['UUID', <span key="uuid" className="font-mono text-xs break-all">{fw.uuid || '—'}</span>],
  ]

  return (
    <div className="space-y-4">
      {status === 'reconnecting' && <ReconnectBanner />}
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div className="label">Connected to</div>
            {transportKind === 'mock' && <Badge tone="accent">Simulated</Badge>}
          </div>
          <dl className="mt-3 divide-y divide-line">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <dt className="shrink-0 text-muted">{k}</dt>
                <dd className="min-w-0 text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {local && !local.motor && (
            <p className="mt-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-xs leading-relaxed text-muted">
              This is a {deviceKind(local)}, not a motor controller.{' '}
              {primary === null
                ? 'No motor controller answered on its CAN bus, so there are no riding values to show.'
                : `Live values come from the motor controllers on its CAN bus.`}
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/" className={buttonClass('primary')}>
              Open dashboard
            </Link>
            <Link to="/setup" className={buttonClass('secondary')}>
              <Wrench className="size-4" aria-hidden /> Set up
            </Link>
            <Button variant="danger" onClick={() => void disconnect()}>
              <Power className="size-4" /> Disconnect
            </Button>
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div className="label">On the CAN bus</div>
            <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => void rescanCan()} disabled={scanning || status !== 'connected'}>
              <RefreshCw className={cx('size-3.5', scanning && 'animate-spin')} /> {scanning ? 'Scanning' : 'Scan again'}
            </Button>
          </div>
          {others.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No other devices answered.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {others.map((d) => (
                <CanRow key={targetKey(d.target)} d={d} showing={view === d.target} canShow={d.motor && motors > 1} onShow={() => setView(d.target)} />
              ))}
            </ul>
          )}
          {motors > 1 && (
            <p className="mt-4 text-xs leading-relaxed text-faint">
              The dashboard adds up current, power and energy from all {motors} motor controllers. Pick one from the switcher at
              the top to see it on its own.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function CanRow({ d, showing, canShow, onShow }: { d: DeviceInfo; showing: boolean; canShow: boolean; onShow: () => void }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate">
          <span className="font-medium">{d.fw?.hwName ?? 'Unknown device'}</span>
          <span className="ml-2 text-muted">{d.fw ? fwVersionString(d.fw) : ''}</span>
        </div>
        <div className="text-xs text-faint">{deviceKind(d)}</div>
      </div>
      {canShow &&
        (showing ? (
          <Badge tone="accent">Showing</Badge>
        ) : (
          <button className="focus-ring rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-3 hover:text-text" onClick={onShow}>
            Show
          </button>
        ))}
      <Badge>{targetLabel(d.target)}</Badge>
    </li>
  )
}
