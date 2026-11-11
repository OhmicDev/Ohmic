import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { fmt } from '../lib/format'
import { prefersReducedMotion } from './reducedMotion'

/**
 * A live number that glides to each new value instead of jumping. The animation writes the text
 * directly, so React renders once per new value rather than on every animation frame.
 */
export function TweenNumber({
  value,
  digits = 0,
  ms = 220,
  className,
  style,
}: {
  value: number | null
  digits?: number
  ms?: number
  className?: string
  style?: CSSProperties
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const current = useRef(Number.NaN)
  const raf = useRef(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const target = value ?? Number.NaN
    const show = (v: number) => {
      const text = fmt(v, digits)
      if (el.textContent !== text) el.textContent = text
    }
    cancelAnimationFrame(raf.current)
    if (prefersReducedMotion() || !Number.isFinite(target) || !Number.isFinite(current.current)) {
      current.current = target
      show(target)
      return
    }
    const from = current.current
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms)
      const v = from + (target - from) * (1 - (1 - p) ** 3)
      current.current = v
      show(v)
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [value, digits, ms])

  // The text is owned by the effect above; React never writes it, so the two can't disagree.
  return <span ref={ref} className={className} style={style} />
}
