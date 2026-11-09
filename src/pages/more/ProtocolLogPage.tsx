import { Download, Eraser, Pause, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { downloadText, stamp } from '../../lib/files'
import { cx } from '../../lib/format'
import { protocolEntries, protocolLogText, useProtocolLog, type ProtocolEntry } from '../../state/protocolLog'
import { useSettings } from '../../state/settings'
import { BackLink, Badge, Button, PageTitle } from '../../ui/Primitives'
import { Toggle } from '../../ui/Toggle'

const SHOWN = 400
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ')

/** Developer option: every packet to and from the controllers. */
export function ProtocolLogPage() {
  const on = useSettings((s) => s.protocolLog)
  const setOn = useSettings((s) => s.setProtocolLog)
  const version = useProtocolLog((s) => s.version)
  const count = useProtocolLog((s) => s.count)
  const clear = useProtocolLog((s) => s.clear)
  const [frozen, setFrozen] = useState<ProtocolEntry[] | null>(null)
  const [filter, setFilter] = useState('')
  const [hidePolls, setHidePolls] = useState(true)
  const live = useMemo(() => protocolEntries(4000), [version]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = frozen ?? live
  const query = filter.trim().toUpperCase()
  const shown = rows.filter((e) => (!hidePolls || !/^(GET_VALUES|GET_IMU_DATA|ALIVE)$/.test(e.name)) && (!query || e.name.includes(query))).slice(0, SHOWN)
  const timeouts = rows.filter((e) => e.dir === 'timeout').length

  return (
    <>
      <BackLink to="/settings">Settings</BackLink>
      <PageTitle
        title="Protocol log"
        subtitle="Every packet between Ohmic and the controllers, newest first. For finding out why something doesn’t work, and for bug reports."
        actions={
          <div className="flex flex-wrap gap-1">
            <Button variant="ghost" onClick={() => setFrozen(frozen ? null : live)} disabled={!on && !frozen} aria-pressed={!!frozen}>
              {frozen ? <Play className="size-4" /> : <Pause className="size-4" />} {frozen ? 'Resume' : 'Freeze'}
            </Button>
            <Button variant="ghost" onClick={() => downloadText(`ohmic-protocol_${stamp()}.txt`, protocolLogText(), 'text/plain')} disabled={!count}>
              <Download className="size-4" /> Save
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                clear()
                setFrozen(null)
              }}
              disabled={!count}
            >
              <Eraser className="size-4" /> Clear
            </Button>
          </div>
        }
      />
      <div className="card mb-3 flex flex-wrap items-center gap-x-5 gap-y-3 p-4">
        <label className="flex items-center gap-2.5 text-sm">
          <Toggle checked={on} onChange={setOn} label="Record packets" /> Record packets
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={hidePolls} onChange={(e) => setHidePolls(e.target.checked)} className="accent-[var(--accent)]" />
          Hide live-data polling
        </label>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by command, e.g. CONF"
          aria-label="Filter by command name"
          className="focus-ring h-9 min-w-48 flex-1 rounded-lg border border-line-strong bg-surface-2 px-3 font-mono text-sm placeholder:font-sans placeholder:text-faint"
        />
        <span className="num text-xs text-faint">
          {count.toLocaleString()} kept{timeouts ? ` · ${timeouts} unanswered` : ''}
        </span>
      </div>
      {!on && !count && <p className="card p-6 text-sm text-muted">Turn on Record packets, then use the app as usual. The log is kept in memory only, and cleared when the app closes.</p>}
      {rows.length > 0 && shown.length === 0 && (
        <p className="card p-6 text-sm text-muted">
          {query ? `Nothing matches “${filter.trim()}”.` : 'So far there’s only live-data polling, which is hidden. Untick Hide live-data polling to see it.'}
        </p>
      )}
      {shown.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-faint">
                <th className="px-4 py-2 font-normal">Time</th>
                <th className="px-4 py-2 font-normal">Way</th>
                <th className="px-4 py-2 font-normal">Command</th>
                <th className="px-4 py-2 text-right font-normal">Bytes</th>
                <th className="px-4 py-2 font-normal">Data</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.seq} className="border-t border-line align-top">
                  <td className="num px-4 py-1.5 text-xs whitespace-nowrap text-faint">{new Date(e.at).toLocaleTimeString([], { hour12: false })}.{String(e.at % 1000).padStart(3, '0')}</td>
                  <td className="px-4 py-1.5">
                    {e.dir === 'timeout' ? <Badge tone="warn">No reply</Badge> : <span className={cx('text-xs', e.dir === 'tx' ? 'text-accent' : 'text-muted')}>{e.dir === 'tx' ? 'Sent' : 'Received'}</span>}
                  </td>
                  <td className="px-4 py-1.5 font-mono text-xs">
                    {e.name}
                    {e.target !== 'local' && <span className="ml-1 font-sans text-faint">→ CAN {e.target}</span>}
                  </td>
                  <td className="num px-4 py-1.5 text-right text-xs text-muted">{e.length}</td>
                  <td className="px-4 py-1.5 font-mono text-[11px] break-all text-muted">
                    {hex(e.bytes)}
                    {e.length > e.bytes.length && ' …'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > SHOWN && <p className="mt-2 text-xs text-faint">Showing the newest {SHOWN}. Save the log to see all of it.</p>}
    </>
  )
}
