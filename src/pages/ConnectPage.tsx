import { Link } from '@tanstack/react-router'
import {
  Bluetooth,
  BluetoothOff,
  Cable,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  PlayCircle,
  Power,
  RefreshCw,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { cx } from '../lib/format'
import { hwTypeLabel } from '../protocol/commands'
import { fwVersionString } from '../protocol/messages'
import { stopLooking, useConnectSheet } from '../state/autoConnect'
import { demoAllowed } from '../state/demo'
import { deviceKind, targetKey, targetLabel, type DeviceInfo } from '../state/devices'
import { useSession } from '../state/session'
import { useSettings } from '../state/settings'
import { portName } from '../transport/SerialTransport'
import { bluetoothHelp, detectSupport, supportMessage, type Help } from '../transport/support'
import { Badge, Button, PageTitle } from '../ui/Primitives'
import { ROW_FOCUS, TILE } from '../ui/rowStyles'
import { buttonClass } from '../ui/buttonClass'
import { ReconnectBanner } from '../ui/ReconnectBanner'
import { useKnownDevices } from '../ui/useKnownDevices'

export function ConnectPage() {
  const status = useSession((s) => s.status)
  const live = status === 'connected' || status === 'reconnecting'
  return (
    <>
      <PageTitle
        title={live ? 'Connection' : 'Connect'}
        subtitle={
          live ? 'The device you are connected to and everything else on its CAN bus.' : 'Bluetooth or a USB cable. Ohmic remembers your device for next time.'
        }
      />
      {live ? (
        <DeviceDetails />
      ) : (
        <div className="max-w-xl">
          <ConnectPanel />
        </div>
      )}
    </>
  )
}

/** True when the browser says Bluetooth is switched off (or missing) on this device. */
function useBluetoothOff(check: boolean): boolean {
  const [off, setOff] = useState(false)
  useEffect(() => {
    const bt = check && typeof navigator !== 'undefined' && 'bluetooth' in navigator ? navigator.bluetooth : null
    if (!bt || typeof bt.getAvailability !== 'function') return
    let live = true
    const update = () =>
      void bt.getAvailability().then(
        (a) => live && setOff(!a),
        () => {},
      )
    update()
    bt.addEventListener('availabilitychanged', update)
    return () => {
      live = false
      bt.removeEventListener('availabilitychanged', update)
    }
  }, [check])
  return off
}

export function ConnectPanel() {
  const { status, step, error, connectDemo, connectUsb, connectBluetooth, connectPort, connectBleDevice } = useSession()
  const lastConnection = useSettings((s) => s.lastConnection)
  const phase = useConnectSheet((s) => s.phase)
  const lookingFor = useConnectSheet((s) => s.name)
  const support = useMemo(() => detectSupport(), [])
  const usbNote = supportMessage('serial', support)
  const bleHelp = useMemo(() => bluetoothHelp(support, typeof location === 'undefined' ? 'https://localhost/' : location.href), [support])
  const bleOff = useBluetoothOff(!bleHelp)
  const busy = status === 'connecting'
  const known = useKnownDevices(status === 'idle' || status === 'error')
  const hasKnown = known.ports.length > 0 || known.ble.length > 0
  const demo = demoAllowed()
  // A choice made by hand replaces waiting for the last device.
  const pick = (go: () => Promise<void>) => () => {
    stopLooking()
    void go()
  }

  if (status === 'reconnecting') return <ReconnectBanner />

  return (
    <div className="space-y-5">
      {error && (
        <div role="alert" className="card flex items-start gap-3 border-danger/30 bg-danger/5 p-3.5 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
          <div>
            <div className="font-semibold text-danger">Couldn't connect</div>
            <div className="mt-0.5 text-muted">{error}</div>
          </div>
        </div>
      )}

      {busy ? (
        <div className="card flex items-center gap-3 p-4 text-sm" aria-live="polite">
          <Loader2 className="size-4 animate-spin text-accent" />
          <span className="text-muted">{step ?? 'Connecting'}…</span>
        </div>
      ) : phase === 'looking' ? (
        <div className="card flex items-center gap-3 p-3.5 text-sm" aria-live="polite">
          <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
          <span className="min-w-0 flex-1 text-muted">
            Looking for <span className="font-medium text-text">{lookingFor}</span>. Switch it on nearby.
          </span>
          <Button variant="ghost" className="h-8 px-2.5" onClick={stopLooking}>
            Stop
          </Button>
        </div>
      ) : (
        phase === 'missing' && (
          <p className="px-1 text-[13px] text-muted" role="status">
            {lookingFor} isn’t nearby. Switch it on, then pick it below.
          </p>
        )
      )}

      {hasKnown && !busy && (
        <Group title="Your devices">
          {known.ble.map((d) => (
            <Choice
              key={`ble-${d.id}`}
              icon={Bluetooth}
              tile={TILE.blue}
              title={d.name || 'Bluetooth device'}
              detail="Bluetooth · used before"
              onClick={pick(() => connectBleDevice(d))}
            />
          ))}
          {known.ports.map((port, i) => (
            <Choice
              key={`usb-${i}`}
              icon={Cable}
              tile={TILE.green}
              title={portName(port)}
              detail="USB · plugged in"
              onClick={pick(() => connectPort(port))}
            />
          ))}
        </Group>
      )}

      <Group title={hasKnown ? 'Find another device' : 'Find your controller'}>
        <Choice
          icon={Bluetooth}
          tile={TILE.blue}
          title="Bluetooth"
          detail={bleHelp ? 'Not in this browser' : 'VESC Express or a VESC Bluetooth module'}
          onClick={pick(() => connectBluetooth())}
          disabled={busy || !!bleHelp}
        >
          {bleHelp && <HelpBox help={bleHelp} />}
        </Choice>
        <Choice
          icon={Cable}
          tile={TILE.green}
          title="USB cable"
          detail={usbNote ?? 'Fastest. Best for setup and firmware updates.'}
          onClick={pick(() => connectUsb())}
          disabled={busy || !!usbNote}
        />
        {demo && (
          <Choice
            icon={PlayCircle}
            tile={TILE.grey}
            title="Demo scooter"
            detail="Simulated, for testing"
            onClick={pick(() => connectDemo())}
            disabled={busy}
          />
        )}
      </Group>

      {bleOff && !bleHelp && (
        <p className="flex items-start gap-2 px-1 text-[13px] text-warn" role="status">
          <BluetoothOff className="mt-0.5 size-4 shrink-0" aria-hidden /> Bluetooth is off on this device. Turn it on, then try again.
        </p>
      )}

      {(!usbNote || !bleHelp) && !busy && (
        <p className="flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-xs text-muted">
          <span className="text-faint">Not in the list?</span>
          {!bleHelp && (
            <button className="focus-ring rounded text-accent hover:underline" onClick={pick(() => connectBluetooth({ anyDevice: true }))}>
              Show every Bluetooth device
            </button>
          )}
          {!usbNote && (
            <button className="focus-ring rounded text-accent hover:underline" onClick={pick(() => connectUsb({ anyDevice: true }))}>
              Show every USB serial port
            </button>
          )}
        </p>
      )}

      {lastConnection && !hasKnown && !busy && phase === 'idle' && (
        <p className="px-1 text-xs text-faint">
          Last time: {lastConnection.name} over {lastConnection.kind === 'serial' ? 'USB' : 'Bluetooth'}.
        </p>
      )}
    </div>
  )
}

/** A grouped list, like iOS settings: a small heading over rows in one card. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="label mb-1.5 px-1">{title}</h2>
      <ul className="card divide-y divide-line overflow-hidden">{children}</ul>
    </section>
  )
}

function Choice({
  icon: Icon,
  tile,
  title,
  detail,
  onClick,
  disabled,
  children,
}: {
  icon: LucideIcon
  /** The icon's coloured square, like macOS settings. */
  tile: string
  title: string
  detail: string
  onClick: () => void
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <li>
      <button
        onClick={onClick}
        disabled={disabled}
        className={cx(
          'flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2 active:bg-surface-3 disabled:cursor-not-allowed disabled:hover:bg-transparent',
          ROW_FOCUS,
        )}
      >
        <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-lg text-white', tile, disabled && 'opacity-50')}>
          <Icon className="size-[18px]" strokeWidth={2} aria-hidden />
        </span>
        <span className={cx('min-w-0 flex-1', disabled && 'opacity-60')}>
          <span className="block truncate text-[15px] font-medium">{title}</span>
          <span className="block text-[12.5px] text-muted">{detail}</span>
        </span>
        {!disabled && <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />}
      </button>
      {children}
    </li>
  )
}

/** Why something isn't available here, with a way out (another browser, the link to copy). */
function HelpBox({ help }: { help: Help }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    void navigator.clipboard?.writeText(location.href).then(
      () => setCopied(true),
      () => {},
    )
  return (
    <div className="px-3.5 pb-3 pl-[58px]">
      <p className="text-[13px] leading-relaxed text-warn">{help.text}</p>
      {help.actions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {help.actions.map((a) =>
            a.href === 'copy' ? (
              <Button key={a.label} className="h-8 px-3 text-xs" onClick={copy}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : a.label}
              </Button>
            ) : (
              <a key={a.label} href={a.href} target="_blank" rel="noreferrer" className={buttonClass('primary', 'h-8 px-3 text-xs')}>
                <ExternalLink className="size-3.5" /> {a.label}
              </a>
            ),
          )}
        </div>
      )}
    </div>
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
        <div className="card p-4 md:p-5">
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
                : 'Live values come from the motor controllers on its CAN bus.'}
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

        <div className="card p-4 md:p-5">
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
