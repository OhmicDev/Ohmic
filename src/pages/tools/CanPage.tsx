import { Network, Pause, Play, RefreshCw, Send, Square, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cx } from '../../lib/format'
import { parseCanId, parseHexBytes } from '../../protocol/can'
import { canMonitorBlock, FRAME_LIMIT, idStats, recentFrames, refusedFrame, useCanMonitor, type FrameRow, type IdStat } from '../../state/canMonitor'
import { fwLabel } from '../../state/config'
import { deviceKind, targetKey } from '../../state/devices'
import { useSession } from '../../state/session'
import { Dialog } from '../../ui/Dialog'
import { Badge, Button, PageTitle, Segmented } from '../../ui/Primitives'
import { useNow } from '../../ui/useNow'
import { DemoPark } from '../config/LiveStrip'
import { BackToMore, Banner } from './ToolBits'

const hex = (d: Uint8Array) => Array.from(d, (b) => b.toString(16).padStart(2, '0')).join(' ')
const idText = (id: number, ext: boolean) => id.toString(16).toUpperCase().padStart(ext ? 8 : 3, '0')

export function CanPage() {
  const devices = useSession((x) => x.devices)
  const connected = useSession((x) => x.status === 'connected')
  const isDemo = useSession((x) => x.transportKind === 'mock')
  const scanning = useSession((x) => x.busy)
  const m = useCanMonitor()
  const [confirmStart, setConfirmStart] = useState(false)
  useNow(1000) // keeps the "moving" check current
  const block = connected ? canMonitorBlock() : null

  // Leaving the page stops the monitor and puts the controller back.
  useEffect(() => () => void useCanMonitor.getState().stop(), [])

  const on = m.status === 'on'
  return (
    <>
      <BackToMore />
      <PageTitle title="CAN bus" subtitle="Devices on the bus and the raw traffic." />
      {!connected && <Banner tone="info">Connect to a controller to see its CAN bus.</Banner>}
      {m.error && (
        <Banner tone="danger" onClose={m.dismiss}>
          {m.error}
        </Banner>
      )}
      {m.notice && !m.error && (
        <Banner tone="ok" onClose={m.dismiss}>
          {m.notice}
        </Banner>
      )}

      {connected && (
        <section className="card mb-4 overflow-hidden" aria-label="Devices">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Network className="size-5 text-accent" />
            <h2 className="font-semibold">Devices</h2>
            <span className="text-xs text-faint">{devices.length}</span>
            <Button
              variant="ghost"
              className="ml-auto h-8 px-2 text-xs"
              disabled={!!scanning || on}
              title={on ? 'Stop the monitor first: the controller can’t reach the others while it runs.' : undefined}
              onClick={() => void useSession.getState().rescanCan()}
            >
              <RefreshCw className={cx('size-3.5', !!scanning && 'animate-spin')} /> Scan again
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs text-faint">
                  <th className="px-4 py-2 font-normal">ID</th>
                  <th className="px-4 py-2 font-normal">Device</th>
                  <th className="px-4 py-2 font-normal">Hardware</th>
                  <th className="px-4 py-2 font-normal">Firmware</th>
                  <th className="px-4 py-2 font-normal">Link</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={targetKey(d.target)} className="border-t border-line">
                    <td className="num px-4 py-2.5">{d.target === 'local' ? 'Cable' : d.target}</td>
                    <td className="px-4 py-2.5">{deviceKind(d)}</td>
                    <td className="px-4 py-2.5 text-muted">{d.fw?.hwName || '–'}</td>
                    <td className="num px-4 py-2.5 text-muted">{d.fw ? fwLabel(d.fw) : '–'}</td>
                    <td className="px-4 py-2.5">
                      {d.target === 'local' ? <Badge tone="accent">Connected</Badge> : on ? <Badge tone="warn">Paused by monitor</Badge> : <Badge>Over CAN</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {devices.length === 1 && <p className="border-t border-line px-4 py-3 text-xs text-muted">No other devices answered on CAN.</p>}
        </section>
      )}

      {connected && (
        <section className="card overflow-hidden" aria-label="CAN monitor">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <h2 className="font-semibold">Monitor</h2>
            {on && (
              <span className="label inline-flex items-center gap-1.5 rounded-full border border-ok/40 px-2.5 py-1 text-[10px] text-ok" role="status">
                <span className="live-dot size-1.5 rounded-full bg-ok" style={{ '--pulse-color': 'var(--color-ok)' } as React.CSSProperties} /> Listening
              </span>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              {on && (
                <>
                  <Button variant="ghost" className="h-9" onClick={() => m.setPaused(!m.paused)} aria-pressed={m.paused}>
                    {m.paused ? <Play className="size-4" /> : <Pause className="size-4" />} {m.paused ? 'Resume view' : 'Freeze view'}
                  </Button>
                  <Button variant="ghost" className="h-9" onClick={m.clear}>
                    <Trash2 className="size-4" /> Clear
                  </Button>
                </>
              )}
              {on || m.status === 'stopping' ? (
                <Button variant="danger" className="h-9" disabled={m.status === 'stopping'} onClick={() => void m.stop()}>
                  <Square className="size-4" /> Stop
                </Button>
              ) : (
                <Button variant="primary" className="h-9" disabled={!!block || m.status === 'starting'} onClick={() => setConfirmStart(true)}>
                  <Play className="size-4" /> {m.status === 'starting' ? 'Starting…' : 'Start monitor'}
                </Button>
              )}
            </div>
          </div>
          {!on && block && (
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-sm text-warn">
              <span className="min-w-0 flex-1">{block}</span>
              {isDemo && <DemoPark />}
            </div>
          )}
          {on ? <MonitorView version={m.version} /> : <p className="px-4 py-6 text-sm text-muted">Start the monitor to see every frame on the bus, grouped by ID or as a running log.</p>}
          <SendForm />
        </section>
      )}

      <Dialog
        open={confirmStart}
        onClose={() => setConfirmStart(false)}
        size="sm"
        title="Start the CAN monitor?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmStart(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmStart(false)
                void m.start()
              }}
            >
              Start
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-muted">
          <p>To pass frames on, the controller on the cable switches to its comm-bridge CAN mode until you stop. While it does:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>it stops talking VESC CAN itself, so other controllers can’t be read through it;</li>
            <li>controllers that follow it over CAN (dual motor) get no commands. Don’t ride.</li>
          </ul>
          <p>Stopping, leaving this page or reconnecting puts it back. The change isn’t saved, so turning the controller off and on also undoes it.</p>
        </div>
      </Dialog>
    </>
  )
}

function MonitorView({ version }: { version: number }) {
  const [view, setView] = useState<'ids' | 'log'>('ids')
  const [filter, setFilter] = useState('')
  const f = filter.trim().toLowerCase()
  const stats = useMemo(() => idStats(), [version]) // eslint-disable-line react-hooks/exhaustive-deps
  const frames = useMemo(() => (view === 'log' ? recentFrames(300) : []), [version, view]) // eslint-disable-line react-hooks/exhaustive-deps
  const matches = (id: number, ext: boolean, name: string | null) => !f || idText(id, ext).toLowerCase().includes(f) || (name ?? '').toLowerCase().includes(f)
  const total = stats.reduce((n, s) => n + s.count, 0)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <Segmented
          label="Monitor view"
          value={view}
          onChange={setView}
          options={[
            { value: 'ids', label: 'By ID' },
            { value: 'log', label: 'Log' },
          ]}
        />
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by ID or type"
          aria-label="Filter frames by ID or type"
          className="focus-ring h-9 min-w-40 flex-1 rounded-lg border border-line-strong bg-surface-2 px-3 font-mono text-sm placeholder:font-sans placeholder:text-faint"
        />
        <span className="num text-xs text-faint">
          {total.toLocaleString()} frames · {stats.length} IDs
        </span>
      </div>
      <div className="max-h-[50dvh] overflow-auto">
        {view === 'ids' ? (
          <IdTable stats={stats.filter((s) => matches(s.id, s.extended, s.vesc?.name ?? null))} />
        ) : (
          <LogTable frames={frames.filter((r) => matches(r.id, r.extended, r.vesc?.name ?? null))} />
        )}
      </div>
      {view === 'log' && <p className="border-t border-line px-4 py-2 text-xs text-faint">The newest 300 shown; the last {FRAME_LIMIT.toLocaleString()} are kept.</p>}
    </div>
  )
}

function Describe({ v }: { v: FrameRow['vesc'] }) {
  if (!v) return <span className="text-faint">–</span>
  return (
    <span>
      <span className="text-text">{v.name ?? `Type ${v.type}`}</span>
      <span className="text-faint"> from {v.sender}</span>
      {v.text && <span className="block text-xs text-muted">{v.text}</span>}
    </span>
  )
}

function IdTable({ stats }: { stats: IdStat[] }) {
  if (!stats.length) return <p className="px-4 py-6 text-sm text-muted">No frames yet.</p>
  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead className="sticky top-0 bg-surface">
        <tr className="text-left text-xs text-faint">
          <th className="px-4 py-2 font-normal">ID</th>
          <th className="px-4 py-2 font-normal">VESC message</th>
          <th className="px-4 py-2 text-right font-normal">Count</th>
          <th className="px-4 py-2 text-right font-normal">Rate</th>
          <th className="px-4 py-2 font-normal">Last data</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((s) => (
          <tr key={s.key} className="border-t border-line align-top">
            <td className="num px-4 py-2 font-mono text-xs">
              {idText(s.id, s.extended)}
              {!s.extended && <span className="ml-1 font-sans text-faint">std</span>}
            </td>
            <td className="px-4 py-2">
              <Describe v={s.vesc} />
            </td>
            <td className="num px-4 py-2 text-right">{s.count.toLocaleString()}</td>
            <td className="num px-4 py-2 text-right text-muted">{s.rate >= 0.05 ? `${s.rate.toFixed(s.rate < 10 ? 1 : 0)} /s` : '–'}</td>
            <td className="px-4 py-2 font-mono text-xs text-muted">{hex(s.last) || '(empty)'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function LogTable({ frames }: { frames: FrameRow[] }) {
  if (!frames.length) return <p className="px-4 py-6 text-sm text-muted">No frames yet.</p>
  const t0 = frames[frames.length - 1].at
  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead className="sticky top-0 bg-surface">
        <tr className="text-left text-xs text-faint">
          <th className="px-4 py-2 font-normal">Time</th>
          <th className="px-4 py-2 font-normal">
            <span className="sr-only">Direction</span>
          </th>
          <th className="px-4 py-2 font-normal">ID</th>
          <th className="px-4 py-2 font-normal">Data</th>
          <th className="px-4 py-2 font-normal">VESC message</th>
        </tr>
      </thead>
      <tbody>
        {frames.map((r) => (
          <tr key={r.seq} className="border-t border-line align-top">
            <td className="num px-4 py-1.5 text-xs text-faint">+{((r.at - t0) / 1000).toFixed(3)}</td>
            <td className="px-4 py-1.5">{r.tx ? <Badge tone="accent">Sent</Badge> : null}</td>
            <td className="num px-4 py-1.5 font-mono text-xs">{idText(r.id, r.extended)}</td>
            <td className="px-4 py-1.5 font-mono text-xs text-muted">{hex(r.data) || '(empty)'}</td>
            <td className="px-4 py-1.5 text-xs">
              <Describe v={r.vesc} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SendForm() {
  const send = useCanMonitor((s) => s.send)
  const [idInput, setIdInput] = useState('')
  const [ext, setExt] = useState(true)
  const [dataInput, setDataInput] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  // Always hex here, as CAN tools show IDs; a leading 0x is fine too.
  const idHex = idInput.trim().replace(/^0x/i, '')
  const id = /^[0-9a-f]+$/i.test(idHex) ? parseCanId(`0x${idHex}`, ext) : null
  const bytes = parseHexBytes(dataInput)
  const idError = idInput.trim() && id === null ? (ext ? 'A hex ID up to 1FFFFFFF.' : 'A hex ID up to 7FF.') : null
  const dataError = dataInput.trim() && bytes === null ? 'Up to 8 bytes in hex, e.g. 01 a2 ff.' : null
  const frame = id !== null && bytes ? { id, extended: ext, data: bytes } : null
  const refused = frame ? refusedFrame(frame) : null

  return (
    <form
      className="border-t border-line px-4 py-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!frame || refused) return
        if (await send(frame)) setSent(`Sent ${idText(frame.id, frame.extended)} [${hex(frame.data)}]`)
      }}
    >
      <h3 className="mb-2 text-sm font-medium">Send a frame</h3>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-xs text-muted">ID (hex)</span>
          <input
            value={idInput}
            onChange={(e) => setIdInput(e.target.value)}
            aria-invalid={!!idError}
            placeholder={ext ? '00001B0A' : '123'}
            className={cx('focus-ring mt-1 block h-9 w-32 rounded-lg border bg-surface-2 px-2.5 font-mono text-sm', idError ? 'border-danger/60' : 'border-line-strong')}
          />
        </label>
        <label className="flex h-9 items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" checked={ext} onChange={(e) => setExt(e.target.checked)} className="accent-[var(--accent)]" /> 29-bit
        </label>
        <label className="block min-w-40 flex-1">
          <span className="text-xs text-muted">Data (hex bytes)</span>
          <input
            value={dataInput}
            onChange={(e) => setDataInput(e.target.value)}
            aria-invalid={!!dataError}
            placeholder="01 02 03"
            className={cx('focus-ring mt-1 block h-9 w-full rounded-lg border bg-surface-2 px-2.5 font-mono text-sm', dataError ? 'border-danger/60' : 'border-line-strong')}
          />
        </label>
        <Button type="submit" className="h-9" disabled={!frame || !!refused}>
          <Send className="size-4" /> Send
        </Button>
      </div>
      {(idError || dataError || refused) && <p className="mt-1.5 text-xs text-danger">{idError ?? dataError ?? refused}</p>}
      {sent && !idError && !dataError && !refused && <p className="mt-1.5 text-xs text-muted">{sent}</p>}
      <p className="mt-1.5 text-xs text-faint">Goes out on the bus of the controller on the cable. Frames that drive a motor, carry commands or change limits are refused.</p>
    </form>
  )
}
