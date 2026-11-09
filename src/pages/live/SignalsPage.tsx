import { Link } from '@tanstack/react-router'
import { Download, Pause, Play, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MAX_PLOTTED_HINT, plotPanes } from '../../live/plot'
import { seriesColor } from '../../live/palette'
import { formatSignal, SIGNAL_GROUPS, SIGNALS, unitLabel, type SignalDef } from '../../live/signals'
import { cx } from '../../lib/format'
import type { Units } from '../../lib/vehicle'
import { targetFromKey, targetKey, targetLabel } from '../../state/devices'
import { liveLogs, MAX_PLOTTED, plotKey, useLiveData, useLiveView, useLiveViewer, WINDOWS, type WindowSec } from '../../state/live'
import { maxPollHz, useSession } from '../../state/session'
import { useSettings, type PollHz } from '../../state/settings'
import { Button, Segmented } from '../../ui/Primitives'
import { ReconnectBanner } from '../../ui/ReconnectBanner'
import { ExportDialog } from './ExportDialog'
import { LiveChart } from './LiveChart'
import { useLiveTick } from './useLiveTick'

const WINDOW_LABEL: Record<WindowSec, string> = { 10: '10 s', 30: '30 s', 60: '1 min', 300: '5 min' }

const labelOf = (key: string) => targetLabel(targetFromKey(key))

export function SignalsPage() {
  useLiveViewer()
  useLiveTick(150)
  const status = useSession((s) => s.status)
  const devices = useSession((s) => s.devices)
  const primary = useSession((s) => s.primary)
  const kind = useSession((s) => s.transportKind)
  const view = useLiveView()
  const units = useSettings((s) => s.units)
  const pollHz = useSettings((s) => s.pollHz)
  const setPollHz = useSettings((s) => s.setPollHz)
  const lastAt = useLiveData((s) => s.lastAt)
  const [exporting, setExporting] = useState(false)

  const connected = status === 'connected' || status === 'reconnecting'
  // Controllers with data: anything recorded, plus motor controllers on this connection.
  const targets = [...new Set([...devices.filter((d) => d.motor).map((d) => targetKey(d.target)), ...liveLogs.keys()])]
  const fallback = primary !== null ? targetKey(primary) : (targets[0] ?? null)
  const selected = view.device && targets.includes(view.device) ? view.device : fallback

  // First visit: plot motor and battery current of the main controller.
  const seed = view.seed
  useEffect(() => {
    if (primary !== null) seed(targetKey(primary))
  }, [primary, seed])

  if (!connected && liveLogs.size === 0) {
    return (
      <div className="card p-6 md:p-8">
        <h2 className="wide text-lg font-semibold">Nothing to show yet</h2>
        <p className="mt-2 max-w-xl text-sm text-muted">Connect a controller to see every value it reports, plotted live.</p>
        <Link to="/connect" className="focus-ring mt-4 inline-flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-bg">
          Connect
        </Link>
      </div>
    )
  }

  const panes = plotPanes(view.plotted, units, labelOf)
  const log = selected ? liveLogs.get(selected) : undefined
  const rate = log && connected ? log.rate(lastAt) : 0
  const maxHz = maxPollHz(kind)
  const rateOptions = ([5, 10, 20, 50] as PollHz[]).filter((r) => r <= maxHz)
  const frozen = view.pausedAt !== null || view.zoom !== null

  return (
    <div className="space-y-4">
      {status === 'reconnecting' && <ReconnectBanner frozen />}
      {!connected && (
        <p role="status" className="card border-warn/30 bg-warn/5 px-4 py-3 text-sm">
          Not connected. Showing what was recorded before; you can still look through it and export it.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {targets.length > 1 && (
          <Segmented
            label="Controller"
            value={selected ?? ''}
            onChange={(k) => view.setDevice(k)}
            options={targets.map((k) => ({ value: k, label: labelOf(k) }))}
          />
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="num hidden text-xs text-faint sm:inline" title="Updates per second actually received">
            {connected ? `${rate.toFixed(1)}/s` : 'offline'}
          </span>
          <Segmented<PollHz>
            label="Update rate"
            value={Math.min(pollHz, maxHz) as PollHz}
            onChange={setPollHz}
            options={rateOptions.map((r) => ({ value: r, label: `${r} Hz` }))}
          />
          <Button onClick={() => setExporting(true)} className="h-10">
            <Download className="size-4" /> <span className="max-sm:sr-only">Export CSV</span>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="card min-w-0 self-start p-3 md:p-5" aria-label="Chart">
          <div className="mb-3 flex flex-wrap items-center gap-2 md:mb-4">
            <Segmented<WindowSec>
              label="Time window"
              value={view.windowSec}
              onChange={view.setWindow}
              options={WINDOWS.map((w) => ({ value: w, label: WINDOW_LABEL[w] }))}
            />
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted" role="status">
                {view.zoom ? 'Zoomed in' : view.pausedAt ? 'Paused · still recording' : connected ? 'Live' : 'Recorded'}
              </span>
              {frozen ? (
                <Button variant="primary" className="h-9" onClick={view.resume}>
                  <Play className="size-4" /> Back to live
                </Button>
              ) : (
                <Button className="h-9 max-sm:w-9 max-sm:px-0" onClick={view.pause} disabled={!connected}>
                  <Pause className="size-4" /> <span className="max-sm:sr-only">Pause</span>
                </Button>
              )}
            </div>
          </div>
          {panes.length ? (
            <>
              <LiveChart panes={panes} />
              <p className="mt-3 text-xs text-faint">Drag across the chart to zoom in. Double-click to go back to live.</p>
            </>
          ) : (
            <div className="flex h-56 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-center text-sm text-muted">
              <span>Nothing plotted.</span>
              <span className="text-xs text-faint">Tap signals in the list to plot them, up to {MAX_PLOTTED} at once.</span>
            </div>
          )}
        </section>

        <SignalList
          target={selected}
          title={selected ? labelOf(selected) : 'Signals'}
          subtitle={devices.find((d) => targetKey(d.target) === selected)?.fw?.hwName}
          onReset={() => useLiveData.getState().resetMinMax()}
        />
      </div>

      <ExportDialog open={exporting} onClose={() => setExporting(false)} selected={selected} targets={targets} labelOf={labelOf} />
    </div>
  )
}

function SignalList({ target, title, subtitle, onReset }: { target: string | null; title: string; subtitle?: string; onReset: () => void }) {
  const plotted = useLiveView((s) => s.plotted)
  const toggle = useLiveView((s) => s.toggle)
  const clearPlot = useLiveView((s) => s.clearPlot)
  const units = useSettings((s) => s.units)
  const log = target ? liveLogs.get(target) : undefined
  const full = plotted.length >= MAX_PLOTTED

  return (
    <section className="card self-start overflow-hidden" aria-label="Signals">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="min-w-0 truncate text-sm font-semibold">
          {title}
          {subtitle && <span className="block truncate text-xs font-normal text-muted">{subtitle}</span>}
        </h2>
        <div className="flex shrink-0 items-center">
          {plotted.length > 0 && (
            <Button variant="ghost" className="h-8 px-2 text-xs" onClick={clearPlot} title="Remove everything from the chart">
              <X className="size-3.5" /> Clear plot
            </Button>
          )}
          <Button variant="ghost" className="h-8 px-2 text-xs" onClick={onReset} title="Start min and max over from now">
            <RotateCcw className="size-3.5" /> Min/max
          </Button>
        </div>
      </div>
      {full && <p className="border-b border-line bg-surface-2/60 px-4 py-2 text-xs text-muted">{MAX_PLOTTED_HINT}</p>}
      <div className="max-h-none lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto">
        {SIGNAL_GROUPS.map((g) => {
          const defs = SIGNALS.filter((s) => s.group === g)
          const imuEmpty = g === 'IMU' && (!log || defs.every((d) => !Number.isFinite(log.latestFinite(SIGNALS.indexOf(d)))))
          return (
            <div key={g}>
              <div className="label sticky top-0 z-[1] bg-surface-2/95 px-4 py-2 text-[9.5px] text-faint backdrop-blur">{g}</div>
              {imuEmpty && (
                <p className="px-4 pt-2 text-xs text-faint">
                  Read while this screen is open. If it stays empty, this controller has no IMU, or it’s off in App settings.
                </p>
              )}
              <ul>
                {defs.map((d) => {
                  const key = target ? plotKey(target, d.id) : ''
                  const slot = plotted.find((p) => p.key === key)?.slot
                  const i = SIGNALS.indexOf(d)
                  return (
                    <li key={d.id}>
                      <SignalRow
                        def={d}
                        units={units}
                        value={log ? log.latestFinite(i) : NaN}
                        min={log ? log.min[i] : NaN}
                        max={log ? log.max[i] : NaN}
                        slot={slot}
                        disabled={!target || (slot === undefined && full)}
                        onToggle={() => target && toggle(key)}
                      />
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function SignalRow({
  def,
  units,
  value,
  min,
  max,
  slot,
  disabled,
  onToggle,
}: {
  def: SignalDef
  units: Units
  value: number
  min: number
  max: number
  slot: number | undefined
  disabled: boolean
  onToggle: () => void
}) {
  const plotted = slot !== undefined
  const unit = unitLabel(def.unit, units)
  const hasRange = Number.isFinite(min) && Number.isFinite(max)
  return (
    <button
      type="button"
      aria-pressed={plotted}
      disabled={disabled}
      onClick={onToggle}
      title={def.hint ?? (plotted ? 'Remove from the chart' : 'Add to the chart')}
      className={cx(
        'focus-ring flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-3/60 disabled:opacity-45',
        plotted && 'bg-surface-3/40',
      )}
    >
      <span
        className={cx('size-3 shrink-0 rounded-[4px] border', plotted ? 'border-transparent' : 'border-line-strong')}
        style={plotted ? { background: seriesColor(slot) } : undefined}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px]">{def.label}</span>
        <span className="num block text-[11px] text-faint">
          {hasRange ? `${formatSignal(def, units, min)} … ${formatSignal(def, units, max)}` : 'no data yet'}
        </span>
      </span>
      <span className="num shrink-0 text-right text-[15px] font-medium">
        {formatSignal(def, units, value)}
        {unit && <span className="ml-1 text-[11px] font-normal text-faint">{unit}</span>}
      </span>
    </button>
  )
}
