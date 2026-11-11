import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { seriesColor } from '../../live/palette'
import type { ChartPaneSpec, ChartSeries } from '../../live/plot'
import { formatSignal, SIGNAL_INDEX, toDisplay } from '../../live/signals'
import type { Units } from '../../lib/vehicle'
import { liveLogs, useLiveData, useLiveView } from '../../state/live'
import { useSettings } from '../../state/settings'
import { chartAxis, cssVar, useTheme } from '../../ui/theme'

const clock = (sec: number, withTenths: boolean) => {
  const d = new Date(sec * 1000)
  const base = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  return withTenths ? `${base}.${Math.floor(d.getMilliseconds() / 100)}` : base
}

/** Visible time range in ms: the zoom, the moment it was paused, or the live edge. */
function viewRange(): [number, number] {
  const { windowSec, pausedAt, zoom } = useLiveView.getState()
  if (zoom) return zoom
  const end = pausedAt ?? (useLiveData.getState().lastAt || Date.now())
  return [end - windowSec * 1000, end]
}

/** One pane per unit, stacked, with a shared crosshair. */
export function LiveChart({ panes }: { panes: ChartPaneSpec[] }) {
  const height = panes.length === 1 ? 260 : panes.length === 2 ? 190 : 150
  const multiDevice = new Set(panes.flatMap((p) => p.series.map((s) => s.target))).size > 1
  return (
    <div className="space-y-4">
      {panes.map((p) => (
        <ChartPane key={p.unit} pane={p} height={height} multiDevice={multiDevice} />
      ))}
    </div>
  )
}

interface Hover {
  t: number
  values: (number | null)[]
}

function ChartPane({ pane, height, multiDevice }: { pane: ChartPaneSpec; height: number; multiDevice: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const units = useSettings((s) => s.units)
  // Latest values for the legend when the pointer isn't over the chart.
  useLiveData((s) => s.version)
  const signature = pane.series.map((s) => `${s.key}#${s.slot}`).join('|')
  // Redrawn with the new colours when the theme changes.
  const theme = useTheme()

  useEffect(() => {
    const el = box.current
    if (!el) return
    const series = pane.series
    let lastSig = ''

    const opts: uPlot.Options = {
      width: Math.max(200, el.clientWidth),
      height,
      legend: { show: false },
      padding: [10, 26, 0, 0], // Room on the right for the last time label, centred on its tick.
      cursor: {
        // Crosshairs follow each other across panes; drags (zoom) stay in the pane they started in.
        sync: { key: 'ohmic-live', setSeries: false, filters: { pub: (type) => type !== 'mousedown' && type !== 'mouseup' } },
        drag: { x: true, y: false, setScale: false },
        points: { size: 8, width: 2 },
      },
      scales: { x: { time: true, auto: false } },
      axes: [
        {
          ...chartAxis(),
          space: 70,
          values: (u, splits) => {
            const span = (u.scales.x.max ?? 0) - (u.scales.x.min ?? 0)
            return splits.map((s) => clock(s, span < 8))
          },
        },
        { ...chartAxis(), size: 56, values: (_u, splits) => splits.map((s) => trimNumber(s)) },
      ],
      series: [
        {},
        ...series.map((s) => ({
          label: s.def.label,
          stroke: seriesColor(s.slot),
          width: 2,
          points: { show: false },
          spanGaps: false,
        })),
      ],
      hooks: {
        setSelect: [
          (u) => {
            if (u.select.width > 6) {
              const a = u.posToVal(u.select.left, 'x')
              const b = u.posToVal(u.select.left + u.select.width, 'x')
              const { min = 0, max = 0 } = u.scales.x
              // Only a range inside what's on screen, and at least a tenth of a second.
              if (a >= min - 1 && b <= max + 1 && b - a >= 0.1) useLiveView.getState().setZoom([a * 1000, b * 1000])
            }
            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false)
          },
        ],
        setCursor: [
          (u) => {
            const i = u.cursor.idx
            if (i === null || i === undefined) setHover(null)
            else setHover({ t: u.data[0][i], values: series.map((_, k) => (u.data[k + 1][i] as number | null | undefined) ?? null) })
          },
        ],
        draw: [
          (u) => {
            // Zero line, when the range crosses it (currents and power go negative).
            const { min, max } = u.scales.y ?? {}
            if (min === undefined || max === undefined || min >= 0 || max <= 0) return
            const y = Math.round(u.valToPos(0, 'y', true)) + 0.5
            const ctx = u.ctx
            ctx.save()
            ctx.strokeStyle = cssVar('--chart-marker', 'rgba(255,255,255,0.22)')
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(u.bbox.left, y)
            ctx.lineTo(u.bbox.left + u.bbox.width, y)
            ctx.stroke()
            ctx.restore()
          },
        ],
      },
    }

    const u = new uPlot(opts, [[], ...series.map(() => [])] as uPlot.AlignedData, el)

    const draw = () => {
      const [from, to] = viewRange()
      const { pausedAt, zoom } = useLiveView.getState()
      const unitsNow = useSettings.getState().units
      const sig = `${from}|${to}|${unitsNow}`
      // Frozen views only need a redraw when the range or units change.
      if ((pausedAt || zoom) && sig === lastSig) return
      lastSig = sig
      u.setData(buildData(series, from, to, unitsNow), false)
      u.setScale('x', { min: from / 1000, max: to / 1000 })
    }

    let raf = 0
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0
        draw()
      })
    }
    const offData = useLiveData.subscribe(schedule)
    const offView = useLiveView.subscribe(schedule)
    const offUnits = useSettings.subscribe((s, p) => {
      if (s.units !== p.units) schedule()
    })
    const ro = new ResizeObserver(() => u.setSize({ width: Math.max(200, el.clientWidth), height }))
    ro.observe(el)
    const onDbl = () => useLiveView.getState().resume()
    el.addEventListener('dblclick', onDbl)
    draw()

    return () => {
      offData()
      offView()
      offUnits()
      ro.disconnect()
      cancelAnimationFrame(raf)
      el.removeEventListener('dblclick', onDbl)
      u.destroy()
    }
    // The plot is rebuilt when its series change (by signature, not array identity); everything else is read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, height, theme])

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
        <span className="label text-[9.5px]">{pane.unit || 'count'}</span>
        {pane.series.map((s, k) => (
          <LegendItem
            key={s.key}
            s={s}
            units={units}
            multiDevice={multiDevice}
            value={hover ? hover.values[k] : latestStored(s)}
            hovering={!!hover}
          />
        ))}
        {hover && <span className="num ml-auto text-[11px] text-faint">{clock(hover.t, true)}</span>}
      </div>
      <div ref={box} className="live-chart" aria-label={`${pane.unit} chart`} role="img" />
    </div>
  )
}

function LegendItem({ s, units, multiDevice, value, hovering }: { s: ChartSeries; units: Units; multiDevice: boolean; value: number | null; hovering: boolean }) {
  // Hover values are already converted for display; stored ones aren't.
  const shown = value === null ? '—' : hovering ? trimTo(value, s.def.digits) : formatSignal(s.def, units, value)
  return (
    <span className="flex items-center gap-1.5 text-[12.5px]">
      <span className="h-[3px] w-3.5 rounded-full" style={{ background: seriesColor(s.slot) }} aria-hidden />
      <span className="text-muted">
        {multiDevice && <span className="text-faint">{s.deviceLabel} · </span>}
        {s.def.label}
      </span>
      <span className="num font-medium text-text">{shown}</span>
    </span>
  )
}

function latestStored(s: ChartSeries): number | null {
  const log = liveLogs.get(s.target)
  const k = SIGNAL_INDEX.get(s.def.id)
  if (!log || k === undefined) return null
  const v = log.latestFinite(k)
  return Number.isFinite(v) ? v : null
}

/** Joins each controller's rows on time and converts to display units. */
function buildData(series: ChartSeries[], from: number, to: number, units: Units): uPlot.AlignedData {
  const targets = [...new Set(series.map((s) => s.target))]
  const tables: uPlot.AlignedData[] = []
  const column = new Map<string, number>()
  let col = 1
  for (const target of targets) {
    const mine = series.filter((s) => s.target === target)
    const log = liveLogs.get(target)
    const idx = mine.map((s) => SIGNAL_INDEX.get(s.def.id) ?? 0)
    const { t, cols } = log ? log.slice(from - 1000, to, idx) : { t: [] as number[], cols: idx.map(() => [] as (number | null)[]) }
    mine.forEach((s, k) => {
      const c = cols[k]
      for (let i = 0; i < c.length; i++) {
        const v = c[i]
        if (v !== null) c[i] = toDisplay(s.def.unit, units, v)
      }
      column.set(s.key, col++)
    })
    tables.push([t, ...cols] as uPlot.AlignedData)
  }
  const joined = tables.length === 1 ? tables[0] : uPlot.join(tables)
  return [joined[0], ...series.map((s) => joined[column.get(s.key) ?? 1])] as uPlot.AlignedData
}

function trimTo(v: number, digits: number) {
  const s = v.toFixed(digits)
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s
}

function trimNumber(v: number) {
  const a = Math.abs(v)
  if (a >= 10_000) return `${(v / 1000).toFixed(0)}k`
  if (a >= 100 || Number.isInteger(v)) return v.toFixed(0)
  if (a >= 1) return v.toFixed(1).replace(/\.0$/, '')
  return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
