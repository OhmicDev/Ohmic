import { memo, useId } from 'react'
import { history, useTelemetry, type HistoryKey } from '../state/telemetry'

const MAX_POINTS = 90
/** A minute of history can't show finer steps than this, so redrawing more often is wasted work. */
const REDRAW_MS = 250

/** Last minute of one signal as a soft area chart. */
export const Sparkline = memo(function Sparkline({ k, color = 'var(--accent)', className }: { k: HistoryKey; color?: string; className?: string }) {
  // Redraw on new samples, at most every REDRAW_MS, and right away when the history is cleared.
  useTelemetry((s) => (s.historyVersion === 0 ? -1 : Math.floor(s.lastUpdate / REDRAW_MS)))
  const gradientId = useId()
  const raw = history[k]
  if (raw.length < 2) return <svg className={className} aria-hidden="true" />

  const step = Math.max(1, Math.ceil(raw.length / MAX_POINTS))
  const pts = raw.filter((_, i) => i % step === 0 || i === raw.length - 1)
  let min = Infinity
  let max = -Infinity
  for (const p of pts) {
    min = Math.min(min, p.v)
    max = Math.max(max, p.v)
  }
  if (max - min < 1e-6) {
    max += 1
    min -= 1
  }
  const W = 100
  const H = 30
  const t0 = pts[0].t
  const span = Math.max(1, pts[pts.length - 1].t - t0)
  const xy = pts.map((p) => [((p.t - t0) / span) * W, H - 2 - ((p.v - min) / (max - min)) * (H - 4)] as const)
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('')
  const area = `${line}L${W},${H}L0,${H}Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.4" strokeOpacity="0.85" vectorEffect="non-scaling-stroke" />
    </svg>
  )
})
