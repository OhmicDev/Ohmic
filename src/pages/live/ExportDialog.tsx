import { Download } from 'lucide-react'
import { useState } from 'react'
import { buildCsv, type CsvColumn } from '../../live/csv'
import { SIGNAL_INDEX, SIGNALS } from '../../live/signals'
import { downloadText, stamp } from '../../lib/files'
import { fmtDuration } from '../../lib/format'
import { liveLogs, parsePlotKey, useLiveView } from '../../state/live'
import { useSettings } from '../../state/settings'
import { Dialog } from '../../ui/Dialog'
import { Button, Segmented } from '../../ui/Primitives'

type What = 'plotted' | 'device' | 'all'
type Range = 'view' | 'all'

/** CSV export of recorded live data: what's plotted, one controller, or everything. */
export function ExportDialog({
  open,
  onClose,
  selected,
  targets,
  labelOf,
}: {
  open: boolean
  onClose: () => void
  selected: string | null
  targets: string[]
  labelOf: (key: string) => string
}) {
  const plotted = useLiveView((s) => s.plotted)
  const units = useSettings((s) => s.units)
  const [what, setWhat] = useState<What>(plotted.length ? 'plotted' : 'device')
  const [range, setRange] = useState<Range>('view')

  const columns = (): CsvColumn[] => {
    if (what === 'plotted') {
      return [...plotted]
        .sort((a, b) => a.slot - b.slot)
        .map((p) => {
          const { target, signal } = parsePlotKey(p.key)
          return { target, deviceLabel: labelOf(target), signal: SIGNAL_INDEX.get(signal) ?? -1 }
        })
        .filter((c) => c.signal >= 0)
    }
    const list = what === 'device' ? (selected ? [selected] : []) : targets
    return list.flatMap((target) => SIGNALS.map((_, signal) => ({ target, deviceLabel: labelOf(target), signal })))
  }

  const span = (): [number, number] => {
    if (range === 'all') return [0, Infinity]
    const { windowSec, pausedAt, zoom } = useLiveView.getState()
    if (zoom) return zoom
    const end = pausedAt ?? Date.now()
    return [end - windowSec * 1000, end]
  }

  const recorded = [...liveLogs.values()].reduce((m, l) => Math.max(m, l.size ? (l.lastTime() - l.t[l.index(0)]) / 1000 : 0), 0)
  const cols = columns()

  const download = () => {
    const [from, to] = span()
    downloadText(`ohmic-live-${stamp()}.csv`, buildCsv(liveLogs, cols, from, to, units), 'text/csv')
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export live data"
      subtitle="A CSV file you can open in a spreadsheet. Values are in the units shown on screen."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={download} disabled={cols.length === 0}>
            <Download className="size-4" /> Download CSV
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <p className="label text-[9.5px]">Signals</p>
          <Segmented<What>
            label="Signals to export"
            value={what}
            onChange={setWhat}
            options={[
              { value: 'plotted', label: `Plotted (${plotted.length})` },
              { value: 'device', label: selected ? `All · ${labelOf(selected)}` : 'All · one controller' },
              ...(targets.length > 1 ? [{ value: 'all' as const, label: 'All controllers' }] : []),
            ]}
          />
        </div>
        <div className="space-y-1.5">
          <p className="label text-[9.5px]">Time</p>
          <Segmented<Range>
            label="Time range"
            value={range}
            onChange={setRange}
            options={[
              { value: 'view', label: 'What’s on the chart' },
              { value: 'all', label: `Everything recorded (${fmtDuration(recorded)})` },
            ]}
          />
        </div>
        <p className="text-xs text-faint">
          {cols.length} column{cols.length === 1 ? '' : 's'}. The app keeps roughly the last 10 to 25 minutes, depending on the update rate.
        </p>
      </div>
    </Dialog>
  )
}
