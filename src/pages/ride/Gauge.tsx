// A dial: a 270° arc that fills from zero (the other way, in the regen colour, below
// zero), warning bands along its outside edge, notches at this ride's peaks and the
// number in the middle. The fill glides to each new value. Like TweenNumber it's drawn
// by writing attributes directly, so React renders once per value rather than per frame.

import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { fmt } from '../../lib/format'
import { prefersReducedMotion } from '../../ui/reducedMotion'
import { tickStep, toneAt, type GaugeReading } from './gauges'

const C = 100
const START = 135
const SWEEP = 270
const TWEEN_MS = 240

const COLOR = {
  normal: 'var(--accent)',
  regen: 'var(--color-regen)',
  warn: 'var(--color-warn)',
  danger: 'var(--color-danger)',
}
const TEXT = { normal: 'var(--color-text)', regen: 'var(--color-regen)', warn: 'var(--color-warn)', danger: 'var(--color-danger)' }

const point = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const
}

function arcPath(r: number, from: number, to: number): string {
  const [x0, y0] = point(r, from)
  const [x1, y1] = point(r, to)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/** The big dial has a scale and room under the number; the small ones keep to the essentials. */
const GEO = {
  big: { r: 86, w: 10, height: 200 },
  small: { r: 80, w: 14, height: 186 },
}

export function Gauge({
  reading,
  label,
  size,
  under,
  className,
}: {
  reading: GaugeReading
  label: string
  size: 'big' | 'small'
  /** Drawn in the open bottom of the big dial, in its 200-wide coordinates. */
  under?: ReactNode
  className?: string
}) {
  const { min, max, origin, digits } = reading
  const g = GEO[size]
  const span = max - min || 1
  const frac = (v: number) => (Math.min(max, Math.max(min, v)) - min) / span
  const angle = (v: number) => START + frac(v) * SWEEP
  const full = arcPath(g.r, START, START + SWEEP)

  const fill = useRef<SVGPathElement>(null)
  const tip = useRef<SVGGElement>(null)
  const halo = useRef<SVGCircleElement>(null)
  const text = useRef<SVGTextElement>(null)
  const shown = useRef(Number.NaN)
  const raf = useRef(0)

  useLayoutEffect(() => {
    const els = { fill: fill.current, tip: tip.current, halo: halo.current, text: text.current }
    if (!els.fill || !els.tip || !els.halo || !els.text) return
    // The fraction of the sweep a value sits at.
    const frac = (v: number) => (Math.min(max, Math.max(min, v)) - min) / (max - min || 1)
    const f0 = frac(origin)
    let tone = ''
    const draw = (v: number) => {
      const has = Number.isFinite(v)
      const f = has ? frac(v) : f0
      const lo = Math.min(f0, f)
      const hi = Math.max(f0, f)
      els.fill!.setAttribute('stroke-dasharray', `${((hi - lo) * 1000).toFixed(1)} 3000`)
      // An empty dash still draws its round cap as a dot.
      els.fill!.style.opacity = hi - lo > 0.0005 ? '' : '0'
      els.fill!.setAttribute('stroke-dashoffset', (-lo * 1000).toFixed(1))
      els.tip!.setAttribute('transform', `rotate(${(START + f * SWEEP).toFixed(2)} ${C} ${C})`)
      els.tip!.style.opacity = has ? '' : '0'
      const t = !has ? 'normal' : v < origin - 1e-9 ? 'regen' : toneAt(reading, v)
      if (t !== tone) {
        tone = t
        const c = COLOR[t as keyof typeof COLOR]
        els.fill!.style.stroke = c
        els.halo!.style.fill = c
        els.text!.style.fill = TEXT[t as keyof typeof TEXT]
      }
      const s = has ? fmt(v, digits) : '—'
      if (els.text!.textContent !== s) els.text!.textContent = s
    }
    const target = reading.value ?? Number.NaN
    cancelAnimationFrame(raf.current)
    const from = shown.current
    if (prefersReducedMotion() || !Number.isFinite(target) || !Number.isFinite(from)) {
      shown.current = target
      draw(target)
      return
    }
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / TWEEN_MS)
      const v = from + (target - from) * (1 - (1 - p) ** 3)
      shown.current = v
      draw(v)
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
    // A new reading object comes with every update; only these change what's drawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading.value, min, max, origin, digits])

  const edge = g.r + g.w / 2
  const big = size === 'big'
  const step = big ? tickStep(span) : 0
  const ticks: number[] = []
  if (big) for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Math.round(v / step) * step)

  return (
    <svg
      viewBox={`0 0 200 ${g.height}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label={`${label}: ${fmt(reading.value, digits)} ${reading.unit}`}
    >
      <path d={full} fill="none" strokeWidth={g.w} strokeLinecap="round" className="stroke-surface-3" />
      {reading.bands.map((b) =>
        b.to > b.from ? (
          <path
            key={`${b.tone}${b.from}`}
            d={arcPath(edge + 4.5, angle(b.from), angle(b.to))}
            fill="none"
            strokeWidth={2.5}
            strokeLinecap="round"
            className={b.tone === 'danger' ? 'stroke-danger/80' : 'stroke-warn/70'}
          />
        ) : null,
      )}
      {ticks.map((v) => {
        const [x0, y0] = point(g.r - g.w / 2 - 4, angle(v))
        const [x1, y1] = point(g.r - g.w / 2 - 10, angle(v))
        const [lx, ly] = point(g.r - g.w / 2 - 21, angle(v))
        return (
          <g key={v}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} strokeWidth={1.5} strokeLinecap="round" className="stroke-faint/70" />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fontSize={9.5} className="num fill-faint/80">
              {fmt(v, step < 1 ? 1 : 0)}
            </text>
          </g>
        )
      })}
      {big &&
        ticks.slice(0, -1).map((v) => {
          const [x0, y0] = point(g.r - g.w / 2 - 4, angle(v + step / 2))
          const [x1, y1] = point(g.r - g.w / 2 - 7, angle(v + step / 2))
          return <line key={`m${v}`} x1={x0} y1={y0} x2={x1} y2={y1} strokeWidth={1} className="stroke-faint/45" />
        })}
      <path ref={fill} d={full} fill="none" strokeWidth={g.w} strokeLinecap="round" strokeDasharray="0 3000" pathLength={1000} />
      {min < 0 && (
        <line
          x1={point(g.r - g.w / 2 - 1, angle(origin))[0]}
          y1={point(g.r - g.w / 2 - 1, angle(origin))[1]}
          x2={point(edge + 1, angle(origin))[0]}
          y2={point(edge + 1, angle(origin))[1]}
          strokeWidth={1.5}
          className="stroke-faint"
        />
      )}
      {reading.marks
        .filter((m) => Number.isFinite(m) && m > min && m < max)
        .map((m, i) => {
          const [x0, y0] = point(g.r - g.w / 2, angle(m))
          const [x1, y1] = point(edge, angle(m))
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} strokeWidth={2} strokeLinecap="round" className="stroke-text/55" />
        })}
      <g ref={tip}>
        <circle ref={halo} cx={C + g.r} cy={C} r={g.w * 0.95} opacity={0.22} />
        <circle cx={C + g.r} cy={C} r={g.w * 0.3} className="fill-white" />
      </g>

      {big ? (
        <>
          <text x={C} y={69} textAnchor="middle" fontSize={10} fontWeight={600} letterSpacing="0.14em" className="fill-muted">
            {label.toUpperCase()}
          </text>
          <text ref={text} x={C} y={119} textAnchor="middle" fontSize={60} fontWeight={300} letterSpacing="-0.03em" className="num" />
          <text x={C} y={141} textAnchor="middle" fontSize={13} fontWeight={500} className="fill-muted">
            {reading.unit}
          </text>
          {under}
        </>
      ) : (
        <>
          <text ref={text} x={C} y={114} textAnchor="middle" fontSize={44} fontWeight={500} letterSpacing="-0.03em" className="num" />
          <text x={C} y={140} textAnchor="middle" fontSize={17} fontWeight={500} className="fill-muted">
            {reading.unit}
          </text>
          <text x={C} y={177} textAnchor="middle" fontSize={16} fontWeight={600} letterSpacing="0.08em" className="fill-muted">
            {label.toUpperCase()}
          </text>
        </>
      )}
    </svg>
  )
}
