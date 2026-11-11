import { useEffect, useMemo, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { fmt, fmtDuration } from '../../lib/format'
import { useLatest } from '../../lib/useLatest'
import { convertSpeed, convertTemp, unitLabels, type Units } from '../../lib/vehicle'
import { seriesColor } from '../../live/palette'
import { hasColumn, type ColumnId, type RideData } from '../../logs/columns'
import { chartAxis, cssVar, useTheme } from '../../ui/theme'

const HEIGHT = 140
const SYNC = 'ohmic-ride'
const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]

interface ChartSeries {
  label: string
  /** Colour slot: the same thing keeps the same colour across charts (motor blue, battery orange). */
  slot: number
  col: ColumnId
  conv?: (v: number, u: Units) => number
  digits: number
}

interface ChartSpec {
  id: string
  title: string
  unit: (u: Units) => string
  series: ChartSeries[]
}

// One measure per chart, so nothing shares an axis with a different unit.
const RIDE_CHARTS: ChartSpec[] = [
  {
    id: 'speed',
    title: 'Speed',
    unit: (u) => unitLabels(u).speed,
    series: [
      { label: 'Speed', slot: 0, col: 'speed', conv: convertSpeed, digits: 1 },
      { label: 'GPS speed', slot: 3, col: 'gpsSpeed', conv: convertSpeed, digits: 1 },
    ],
  },
  {
    id: 'current',
    title: 'Current',
    unit: () => 'A',
    series: [
      { label: 'Motor', slot: 0, col: 'currentMotor', digits: 1 },
      { label: 'Battery', slot: 1, col: 'currentIn', digits: 1 },
    ],
  },
  { id: 'battery', title: 'Battery', unit: () => 'V', series: [{ label: 'Voltage', slot: 1, col: 'vIn', digits: 1 }] },
  {
    id: 'temp',
    title: 'Temperature',
    unit: (u) => unitLabels(u).temp,
    series: [
      { label: 'Motor', slot: 0, col: 'tempMotor', conv: convertTemp, digits: 0 },
      { label: 'Controller', slot: 2, col: 'tempFet', conv: convertTemp, digits: 0 },
    ],
  },
  { id: 'duty', title: 'Duty', unit: () => '%', series: [{ label: 'Duty', slot: 0, col: 'duty', digits: 0 }] },
]

/** Moves the cursor without firing hooks or telling the other charts (each places its own). */
function setCursorQuiet(u: uPlot, left: number) {
  ;(u.setCursor as (opts: { left: number; top: number }, fire: boolean, pub: boolean) => void)({ left, top: 10 }, false, false)
}

/** Every chart, sharing one cursor. Hovering a chart moves `index`; changing `index` moves the cursor. */
export function RideCharts({ data, units, index, onIndex }: { data: RideData; units: Units; index: number; onIndex: (i: number) => void }) {
  const x = useMemo(() => Array.from(data.cols.t, (t) => t / 1000), [data])
  // Built once per ride: a new spec object would make each chart rebuild on every cursor move.
  const charts = useMemo(
    () =>
      RIDE_CHARTS.map((spec) => ({ ...spec, series: spec.series.filter((s) => hasColumn(data, s.col)) })).filter((spec) => spec.series.length),
    [data],
  )
  return (
    <div className="space-y-5">
      {charts.map((spec) => (
        <Chart key={spec.id} spec={spec} data={data} x={x} units={units} index={index} onIndex={onIndex} />
      ))}
    </div>
  )
}

function Chart({
  spec,
  data,
  x,
  units,
  index,
  onIndex,
}: {
  spec: ChartSpec
  data: RideData
  x: number[]
  units: Units
  index: number
  onIndex: (i: number) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const plot = useRef<uPlot | null>(null)
  const indexRef = useLatest(index)
  const onIndexRef = useLatest(onIndex)
  // Redrawn with the new colours when the theme changes.
  const theme = useTheme()

  const cols = useMemo(
    () =>
      spec.series.map((s) =>
        Array.from(data.cols[s.col], (v) => (Number.isFinite(v) ? (s.conv ? s.conv(v, units) : v) : null)),
      ),
    [spec, data, units],
  )

  useEffect(() => {
    const el = box.current
    if (!el) return
    // Only the chart under the pointer moves the ride position. Cursor moves made
    // here (and the copies other charts get through sync) must not feed back.
    let hovering = false
    const place = (u: uPlot) => {
      const i = indexRef.current
      if (x[i] === undefined || hovering) return
      setCursorQuiet(u, u.valToPos(x[i], 'x'))
    }
    const u = new uPlot(
      {
        width: Math.max(200, el.clientWidth),
        height: HEIGHT,
        legend: { show: false },
        padding: [10, 26, 0, 0], // Room on the right for the last time label, centred on its tick.
        cursor: { y: false, sync: { key: SYNC, setSeries: false }, drag: { x: false, y: false }, points: { size: 8, width: 2 } },
        scales: { x: { time: false } },
        axes: [
          // Ticks on whole seconds and minutes, so labels read 0:05, 0:10, 1:00.
          { ...chartAxis(), space: 70, incrs: TIME_STEPS, values: (_u, splits) => splits.map((s) => fmtDuration(s)) },
          { ...chartAxis(), size: 48 },
        ],
        series: [{}, ...spec.series.map((s) => ({ label: s.label, stroke: seriesColor(s.slot), width: 2, points: { show: false } }))],
        hooks: {
          setCursor: [
            (u) => {
              const i = u.cursor.idx
              // The pointer left this chart or the one it follows: back to the scrubbed position.
              if (i === null || i === undefined) requestAnimationFrame(() => plot.current === u && place(u))
              else if (hovering && i !== indexRef.current) onIndexRef.current(i)
            },
          ],
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
          ready: [(u) => place(u)],
        },
      },
      [x, ...cols] as uPlot.AlignedData,
      el,
    )
    plot.current = u
    const enter = () => (hovering = true)
    // Leaving hides the cursor: put it back where the ride is scrubbed to.
    const leave = () => {
      hovering = false
      requestAnimationFrame(() => plot.current === u && place(u))
    }
    u.over.addEventListener('mouseenter', enter)
    u.over.addEventListener('mouseleave', leave)
    const ro = new ResizeObserver(() => {
      u.setSize({ width: Math.max(200, el.clientWidth), height: HEIGHT })
      place(u)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.over.removeEventListener('mouseenter', enter)
      u.over.removeEventListener('mouseleave', leave)
      u.destroy()
      plot.current = null
    }
  }, [spec, x, cols, indexRef, onIndexRef, theme])

  useEffect(() => {
    const u = plot.current
    if (!u || u.cursor.idx === index || x[index] === undefined) return
    setCursorQuiet(u, u.valToPos(x[index], 'x'))
  }, [index, x])

  const unit = spec.unit(units)
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
        <span className="text-[13px] font-semibold">{spec.title}</span>
        <span className="label text-[9.5px]">{unit}</span>
        {spec.series.map((s, k) => {
          const v = cols[k][index]
          return (
            <span key={s.label} className="flex items-center gap-1.5 text-[12.5px]">
              {spec.series.length > 1 && <span className="h-[3px] w-3.5 rounded-full" style={{ background: seriesColor(s.slot) }} aria-hidden />}
              <span className="text-muted">{s.label}</span>
              <span className="num font-medium text-text">{v === null || v === undefined ? '—' : fmt(v, s.digits)}</span>
            </span>
          )
        })}
      </div>
      <div ref={box} className="live-chart" role="img" aria-label={`${spec.title} through the ride, in ${unit}`} />
    </div>
  )
}
