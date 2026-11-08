import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { Target } from '../../client/VescClient'
import { seriesColor } from '../../live/palette'
import { targetKey } from '../../state/devices'
import { sessionEvents } from '../../state/session'
import { chartAxis, cssVar, useTheme } from '../../ui/theme'

const WINDOW_S = 20

interface Row {
  t: number
  motor: number
  battery: number
  duty: number
}

interface PaneSpec {
  unit: string
  series: { label: string; slot: number; get: (r: Row) => number }[]
}

// One axis per chart: currents together in amps, duty on its own in percent.
const PANES: PaneSpec[] = [
  {
    unit: 'A',
    series: [
      { label: 'Motor current', slot: 0, get: (r) => r.motor },
      { label: 'Battery current', slot: 1, get: (r) => r.battery },
    ],
  },
  { unit: '%', series: [{ label: 'Duty', slot: 2, get: (r) => r.duty * 100 }] },
]

/** The last 20 seconds of how the motor responds, from live data. Give it a key per target so it starts fresh. */
export function BenchChart({ target }: { target: Target }) {
  const [rows, setRows] = useState<Row[]>([])
  const key = targetKey(target)

  useEffect(() => {
    const list: Row[] = []
    let raf = 0
    const off = sessionEvents.samples.on(({ samples, at }) => {
      const s = samples.find((x) => targetKey(x.target) === key)
      if (!s) return
      list.push({ t: at / 1000, motor: s.values.currentMotor, battery: s.values.currentIn, duty: s.values.dutyNow })
      const from = at / 1000 - WINDOW_S
      while (list.length && list[0].t < from) list.shift()
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0
          setRows(list.slice())
        })
      }
    })
    return () => {
      off()
      cancelAnimationFrame(raf)
    }
  }, [key])

  return (
    <div className="space-y-4">
      {PANES.map((p) => (
        <Pane key={p.unit} pane={p} rows={rows} />
      ))}
    </div>
  )
}

function Pane({ pane, rows }: { pane: PaneSpec; rows: Row[] }) {
  const box = useRef<HTMLDivElement>(null)
  const plot = useRef<uPlot | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  // Redrawn with the new colours when the theme changes.
  const theme = useTheme()

  useEffect(() => {
    const el = box.current
    if (!el) return
    const u = new uPlot(
      {
        width: Math.max(200, el.clientWidth),
        height: 150,
        legend: { show: false },
        padding: [10, 8, 0, 0],
        cursor: { sync: { key: 'ohmic-bench', setSeries: false }, drag: { x: false, y: false }, points: { size: 8, width: 2 } },
        scales: { x: { time: true, auto: false } },
        axes: [
          { ...chartAxis(), space: 70, values: (_u, splits) => splits.map((s) => new Date(s * 1000).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })) },
          { ...chartAxis(), size: 48 },
        ],
        series: [{}, ...pane.series.map((s) => ({ label: s.label, stroke: seriesColor(s.slot), width: 2, points: { show: false } }))],
        hooks: {
          setCursor: [(u) => setHover(u.cursor.idx ?? null)],
          draw: [
            (u) => {
              const { min, max } = u.scales.y ?? {}
              if (min === undefined || max === undefined || min >= 0 || max <= 0) return
              const y = Math.round(u.valToPos(0, 'y', true)) + 0.5
              u.ctx.save()
              u.ctx.strokeStyle = cssVar('--chart-marker', 'rgba(255,255,255,0.22)')
              u.ctx.lineWidth = 1
              u.ctx.beginPath()
              u.ctx.moveTo(u.bbox.left, y)
              u.ctx.lineTo(u.bbox.left + u.bbox.width, y)
              u.ctx.stroke()
              u.ctx.restore()
            },
          ],
        },
      },
      [[], ...pane.series.map(() => [])] as uPlot.AlignedData,
      el,
    )
    plot.current = u
    const ro = new ResizeObserver(() => u.setSize({ width: Math.max(200, el.clientWidth), height: 150 }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.destroy()
      plot.current = null
    }
  }, [pane, theme])

  useEffect(() => {
    const u = plot.current
    if (!u) return
    const end = rows.length ? rows[rows.length - 1].t : Date.now() / 1000
    u.setData([rows.map((r) => r.t), ...pane.series.map((s) => rows.map(s.get))] as uPlot.AlignedData, false)
    u.setScale('x', { min: end - WINDOW_S, max: end })
  }, [rows, pane])

  const at = hover !== null && rows[hover] ? rows[hover] : rows[rows.length - 1]
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
        <span className="label text-[9.5px]">{pane.unit}</span>
        {pane.series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-[12.5px]">
            <span className="h-[3px] w-3.5 rounded-full" style={{ background: seriesColor(s.slot) }} aria-hidden />
            <span className="text-muted">{s.label}</span>
            <span className="num font-medium text-text">{at ? s.get(at).toFixed(1) : '—'}</span>
          </span>
        ))}
      </div>
      <div ref={box} className="live-chart" role="img" aria-label={`${pane.series.map((s) => s.label).join(' and ')} over the last ${WINDOW_S} seconds`} />
    </div>
  )
}
