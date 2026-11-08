import { useEffect, useId, useRef } from 'react'
import type { Target } from '../../client/VescClient'
import { cx, fmt } from '../../lib/format'
import { speedPerErpm } from '../../lib/rideModes'
import { convertSpeed, unitLabels } from '../../lib/vehicle'
import { useConfig } from '../../state/config'
import { targetKey, targetLabel } from '../../state/devices'
import { useSession } from '../../state/session'
import { useSettings } from '../../state/settings'
import { useTelemetry } from '../../state/telemetry'
import { SPOKES, spinRate, wheelKmh } from './wheelSpin'

/** Tyre radius in the drawing; the road under it moves at this radius times the turn rate. */
const R = 26
/** One dash plus one gap on the road line. */
const DASH = 12
/** When the device asks for less motion, the drawing turns at this fraction of its usual rate. */
const CALM = 0.25
const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Bottom corner of the dashboard: a little wheel for each motor controller, turning with
 * that wheel's speed. One wheel on a single-motor vehicle, two on a dual.
 */
export function WheelSpeeds() {
  const devices = useSession((s) => s.devices)
  // Values stop when the link drops: the wheels stop too, rather than spin on at the last speed.
  const frozen = useSession((s) => s.status === 'reconnecting' || s.link === 'lost')
  const motors = devices.filter((d) => d.motor)
  if (motors.length === 0) return null
  const many = motors.length > 1
  return (
    <aside
      aria-label={many ? 'Wheel speeds' : 'Wheel speed'}
      className={cx(
        'card pointer-events-none fixed right-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 flex gap-2 px-2.5 py-2 shadow-xl transition-opacity md:right-6 md:bottom-6',
        frozen && 'opacity-55',
      )}
    >
      {motors.map((d) => (
        <Wheel key={targetKey(d.target)} target={d.target} label={many ? targetLabel(d.target) : null} frozen={frozen} />
      ))}
    </aside>
  )
}

function Wheel({ target, label, frozen }: { target: Target; label: string | null; frozen: boolean }) {
  const key = targetKey(target)
  const erpm = useTelemetry((s) => s.devices[key]?.rpm ?? 0)
  const perErpm = useConfig((s) => {
    const mc = Object.values(s.devices).find((d) => d.target === target)?.mcconf.device
    return mc ? speedPerErpm(mc) : Number.NaN
  })
  const vehicle = useSettings((s) => s.vehicle)
  const units = useSettings((s) => s.units)
  const kmh = wheelKmh(erpm, perErpm, vehicle)
  const backwards = kmh < -1

  const spin = useRef<SVGGElement>(null)
  const tread = useRef<SVGGElement>(null)
  const blur = useRef<SVGCircleElement>(null)
  const road = useRef<SVGLineElement>(null)
  const rate = useRef(0)
  useEffect(() => {
    rate.current = frozen ? 0 : spinRate(kmh)
  }, [kmh, frozen])

  // Turned by hand each frame, so React renders once per new value, not 60 times a second.
  useEffect(() => {
    // Asked for less motion: still turn (the turn is the reading), but slowly and without the blur.
    const calm = reducedMotion()
    let frame = 0
    let last = performance.now()
    let shown = 0
    let angle = 0
    let offset = 0
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      // Values come 10 to 50 times a second; ease between them so the wheel doesn't jerk.
      const want = calm ? rate.current * CALM : rate.current
      shown += (want - shown) * (1 - Math.exp(-dt / 0.25))
      if (Math.abs(shown) < 0.5 && want === 0) shown = 0
      angle = (angle + shown * dt) % 360
      offset = (((offset + ((shown * Math.PI) / 180) * R * dt) % DASH) + DASH) % DASH
      const fast = calm ? 0 : Math.min(1, Math.abs(shown) / 700)
      spin.current?.setAttribute('transform', `rotate(${angle.toFixed(2)} 32 32)`)
      tread.current?.setAttribute('opacity', (1 - fast * 0.85).toFixed(2))
      blur.current?.setAttribute('opacity', (fast * 0.22).toFixed(3))
      road.current?.setAttribute('stroke-dashoffset', offset.toFixed(2))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  const fade = `fade-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const angles = (n: number) => Array.from({ length: n }, (_, i) => (i * 360) / n)

  return (
    <div className="flex w-14 flex-col items-center md:w-16">
      <svg viewBox="0 0 64 70" className="h-auto w-full" aria-hidden>
        <defs>
          <linearGradient id={fade} x1="0" x2="64" y1="0" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="currentColor" stopOpacity="0" />
            <stop offset="0.25" stopColor="currentColor" />
            <stop offset="0.75" stopColor="currentColor" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          ref={road}
          x1="0"
          x2="64"
          y1="66.5"
          y2="66.5"
          stroke={`url(#${fade})`}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={`${DASH * 0.55} ${DASH * 0.45}`}
          className="text-faint"
        />
        <circle cx="32" cy="32" r={R} fill="none" strokeWidth="7" className="stroke-text/15" />
        <circle ref={blur} cx="32" cy="32" r="12" fill="none" strokeWidth="16" opacity="0" className="stroke-accent" />
        <g ref={spin}>
          <g ref={tread}>
            {angles(16).map((a) => (
              <line
                key={a}
                x1="32"
                x2="32"
                y1={32 - R - 2.5}
                y2={32 - R + 2.5}
                strokeWidth="1.6"
                className="stroke-text/30"
                transform={`rotate(${a} 32 32)`}
              />
            ))}
          </g>
          <circle cx="32" cy="32" r="20.5" fill="none" strokeWidth="2" className="stroke-accent" />
          {angles(SPOKES).map((a) => (
            <line
              key={a}
              x1="32"
              x2="32"
              y1="27"
              y2="12"
              strokeWidth="2.2"
              strokeLinecap="round"
              className="stroke-accent/75"
              transform={`rotate(${a} 32 32)`}
            />
          ))}
          {/* The valve: one mark that isn't repeated, so a slow turn is easy to see. */}
          <circle cx="32" cy="11.5" r="1.6" className="fill-text/70" transform="rotate(36 32 32)" />
          <circle cx="32" cy="32" r="5" className="fill-accent" />
          <circle cx="32" cy="32" r="1.8" className="fill-surface" />
        </g>
      </svg>
      <div className="num mt-0.5 text-sm leading-tight font-semibold whitespace-nowrap">
        {fmt(convertSpeed(Math.abs(kmh), units), 0)}
        <span className="ml-0.5 text-[10px] font-normal text-muted">{unitLabels(units).speed}</span>
      </div>
      {(label || backwards) && (
        <div className="text-[10px] leading-tight whitespace-nowrap text-faint">
          {label}
          {backwards && <span className="text-muted">{label ? ' · ' : ''}backwards</span>}
        </div>
      )}
    </div>
  )
}
