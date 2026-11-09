import { useNavigate } from '@tanstack/react-router'
import {
  Activity,
  ArrowRight,
  Bluetooth,
  BookOpen,
  Cable,
  Check,
  Gauge,
  Globe,
  Layers,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { APP_NAME, APP_VERSION } from '../appInfo'
import { useSettings } from '../state/settings'
import { Logo } from '../ui/Logo'
import { Button } from '../ui/Primitives'
import { IconTile } from '../ui/RowList'
import type { TileColor } from '../ui/rowStyles'

const SOURCE_URL = 'https://github.com/OhmicDev/Ohmic'

type Card = { icon: LucideIcon; color: TileColor; title: string; text: string }

const FEATURES: Card[] = [
  {
    icon: Bluetooth,
    color: 'blue',
    title: 'Connect',
    text: 'Bluetooth through a VESC Bluetooth module or VESC Express, or a USB cable. It remembers your scooter and reconnects when it’s on.',
  },
  {
    icon: Gauge,
    color: 'green',
    title: 'Ride',
    text: 'Speed, battery, power and temperatures, live. Every controller on the CAN bus, added up.',
  },
  {
    icon: Wrench,
    color: 'grey',
    title: 'Setup',
    text: 'Four guided steps for a new build: motor detection, throttle and brake, direction, battery.',
  },
  {
    icon: SlidersHorizontal,
    color: 'purple',
    title: 'Tune',
    text: 'Ride modes, regen and ABS, plus every motor and app setting with search and plain-language help.',
  },
  {
    icon: Activity,
    color: 'orange',
    title: 'Live',
    text: 'Charts of every value the controllers report, faults with what to do, and the VESC terminal.',
  },
  {
    icon: Route,
    color: 'teal',
    title: 'And more',
    text: 'Ride logs with GPS maps, firmware updates, LispBM scripts, packages, BMS, IMU and the CAN bus.',
  },
]

const PERKS: Card[] = [
  {
    icon: Globe,
    color: 'blue',
    title: 'Nothing to install',
    text: 'It’s a web page. Open it on a laptop or phone, add it to your home screen, and it works offline.',
  },
  {
    icon: Bluetooth,
    color: 'teal',
    title: 'Connects like VESC Tool',
    text: 'The same Bluetooth link VESC Tool uses, so your VESC Bluetooth module or VESC Express just works. It reconnects by itself.',
  },
  {
    icon: ShieldCheck,
    color: 'green',
    title: 'Hard to get wrong',
    text: 'Every change is checked, shown to you and backed up before it’s written, then read back. Nothing is written while a wheel turns.',
  },
  {
    icon: BookOpen,
    color: 'orange',
    title: 'Plain language',
    text: 'Settings explained for riders, not just engineers, and guided setup in four steps.',
  },
  {
    icon: Layers,
    color: 'purple',
    title: 'Made for dual motor',
    text: 'Sees every controller on the CAN bus, shows them together or one at a time, and writes to both at once.',
  },
  {
    icon: Route,
    color: 'red',
    title: 'Ride logs',
    text: 'Record a ride with GPS, then see speed, power and temperatures along the route on a map.',
  },
]

const STEPS = ['Check the limits', 'Show the change', 'Back up', 'Write', 'Read back', 'Verify']

/** The front page: what Ohmic is and does, and the way into the app. */
export function WelcomePage() {
  const navigate = useNavigate()
  const enter = () => {
    useSettings.getState().enterApp()
    void navigate({ to: '/' })
  }
  useReveal()

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <header className="glass sticky top-0 z-30 border-b border-line">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 md:px-6">
          <Logo size={28} />
          <span className="wide text-[17px] font-bold">{APP_NAME}</span>
          <nav aria-label="On this page" className="ml-auto hidden items-center gap-6 text-[13px] text-muted md:flex">
            <a href="#features" className="focus-ring rounded hover:text-text">
              What it does
            </a>
            <a href="#safety" className="focus-ring rounded hover:text-text">
              Safety
            </a>
            <a href="#why" className="focus-ring rounded hover:text-text">
              Why Ohmic
            </a>
          </nav>
          <Button variant="primary" className="ml-auto h-9 md:ml-4" onClick={enter}>
            Open {APP_NAME}
          </Button>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        {/* Hero */}
        <section className="relative isolate">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
          >
            <div className="welcome-glow absolute -top-24 left-[8%] size-[380px] rounded-full bg-accent/25 blur-[90px] md:size-[520px]" />
            <div
              className="welcome-glow absolute top-40 right-[-10%] size-[320px] rounded-full bg-[#8e5bd0]/20 blur-[90px] md:size-[440px]"
              style={{ animationDelay: '-7s' }}
            />
          </div>
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-12 pb-16 md:grid-cols-[1.05fr_1fr] md:gap-12 md:px-6 md:pt-20 md:pb-24">
            <div>
              <p
                className="welcome-in inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface/70 px-3 py-1 text-xs text-muted"
                style={i(0)}
              >
                <span className="size-1.5 rounded-full bg-ok" /> For VESC® controllers · free and open source
              </p>
              <h1 className="welcome-in wide mt-5 text-[40px] leading-[1.05] font-bold sm:text-[52px] md:text-[60px]" style={i(1)}>
                Your scooter’s controller, <span className="text-accent">in your browser.</span>
              </h1>
              <p className="welcome-in mt-5 max-w-xl text-[17px] leading-relaxed text-muted" style={i(2)}>
                {APP_NAME} connects to VESC-based motor controllers over Bluetooth or USB. Set up a new build, tune how it rides, and watch
                every value live, on your laptop or your phone.
              </p>
              <div className="welcome-in mt-8 flex flex-wrap items-center gap-3" style={i(3)}>
                <Button variant="primary" className="h-11 px-5 text-[15px]" onClick={enter}>
                  Open {APP_NAME} <ArrowRight className="size-4" />
                </Button>
                <a
                  href="#features"
                  className="focus-ring inline-flex h-11 items-center rounded-lg px-4 text-[15px] font-medium text-muted hover:text-text"
                >
                  See what it does
                </a>
              </div>
              <p className="welcome-in mt-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-faint" style={i(4)}>
                <span className="inline-flex items-center gap-1.5">
                  <Bluetooth className="size-3.5" aria-hidden /> Chrome, Edge, Samsung Internet · Bluefy on iPhone
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Cable className="size-3.5" aria-hidden /> USB in Chrome or Edge
                </span>
              </p>
            </div>
            <div className="welcome-in" style={i(3)}>
              <DashPreview />
            </div>
          </div>
        </section>

        {/* What it does */}
        <Section id="features" eyebrow="What it does" title="Everything for riding, setting up and tuning">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, n) => (
              <CardItem key={f.title} card={f} n={n} />
            ))}
          </div>
        </Section>

        {/* Safety */}
        <Section
          id="safety"
          eyebrow="Safe by design"
          title="Every write goes the same careful way"
          intro="A bad value is refused, never quietly changed. Nothing is written and no firmware installed while a wheel turns, and motor tests stop the moment you let go."
        >
          <ol className="reveal grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="How a change is written">
            {STEPS.map((s, n) => (
              <li
                key={s}
                className="welcome-step flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-3 text-[13px] font-medium text-muted"
                style={i(n)}
              >
                <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold text-text">
                  {n + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </Section>

        {/* Why */}
        <Section
          id="why"
          eyebrow="Why Ohmic"
          title="Made for riders"
          intro="VESC Tool is the complete workshop for building and testing VESC hardware, and Ohmic builds on its work. Ohmic is the rider’s side of it."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PERKS.map((p, n) => (
              <CardItem key={p.title} card={p} n={n} check />
            ))}
          </div>
        </Section>

        {/* Last call */}
        <section className="mx-auto max-w-6xl px-4 pb-16 md:px-6 md:pb-24">
          <div className="reveal card relative isolate overflow-hidden px-6 py-10 text-center md:py-14">
            <div
              aria-hidden
              className="welcome-glow absolute -bottom-24 left-1/2 -z-10 size-[360px] -translate-x-1/2 rounded-full bg-accent/20 blur-[80px]"
            />
            <h2 className="wide text-[28px] font-bold md:text-[36px]">Switch it on. Connect. Ride.</h2>
            <p className="mx-auto mt-3 max-w-md text-[15px] text-muted">
              Turn on your scooter, open {APP_NAME}, and pick your VESC Bluetooth module or plug in the cable.
            </p>
            <Button variant="primary" className="mt-7 h-11 px-6 text-[15px]" onClick={enter}>
              Open {APP_NAME} <ArrowRight className="size-4" />
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-8 text-xs leading-relaxed text-faint md:px-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-muted">
              {APP_NAME} {APP_VERSION}
            </span>
            <a
              href={SOURCE_URL}
              target="_blank"
              rel="noreferrer"
              className="focus-ring rounded underline underline-offset-2 hover:text-text"
            >
              Source code
            </a>
          </div>
          <p className="mt-2 max-w-3xl">
            {APP_NAME} is free software under the GNU GPL, version 3 or later. It builds on the open-source VESC firmware and VESC Tool by
            Benjamin Vedder and contributors, and is not affiliated with or endorsed by the VESC project. VESC is a registered trademark of
            Benjamin Vedder.
          </p>
        </div>
      </footer>
    </div>
  )
}

const i = (n: number) => ({ '--i': n }) as CSSProperties

function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
}: {
  id: string
  eyebrow: string
  title: string
  intro?: string
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mx-auto max-w-6xl scroll-mt-16 px-4 pb-16 md:px-6 md:pb-24">
      <div className="reveal mb-6 max-w-2xl md:mb-8">
        <p className="label text-accent">{eyebrow}</p>
        <h2 id={`${id}-title`} className="wide mt-2 text-[28px] leading-tight font-bold md:text-[36px]">
          {title}
        </h2>
        {intro && <p className="mt-3 text-[15px] leading-relaxed text-muted">{intro}</p>}
      </div>
      {children}
    </section>
  )
}

function CardItem({ card, n, check }: { card: Card; n: number; check?: boolean }) {
  return (
    <div className="reveal card flex gap-3.5 p-4 md:p-5" style={i(n)}>
      <IconTile icon={card.icon} color={card.color} />
      <div className="min-w-0">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold">
          {card.title}
          {check && <Check className="size-4 text-ok" aria-hidden />}
        </h3>
        <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{card.text}</p>
      </div>
    </div>
  )
}

/** Shows each .reveal element once it scrolls into view. */
function useReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.reveal')]
    if (typeof IntersectionObserver === 'undefined') {
      for (const el of els) el.classList.add('is-in')
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          e.target.classList.add('is-in')
          io.unobserve(e.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
    )
    for (const el of els) io.observe(el)
    return () => io.disconnect()
  }, [])
}

/**
 * A pretend dashboard on a pretend ride: the speed rises and falls, the power bar follows and the
 * wheels turn. Drawn by hand each frame (no React renders), and only while it's on screen.
 */
function DashPreview() {
  const box = useRef<HTMLDivElement>(null)
  const speed = useRef<HTMLSpanElement>(null)
  const power = useRef<HTMLSpanElement>(null)
  const drive = useRef<HTMLDivElement>(null)
  const wheels = useRef<(SVGGElement | null)[]>([])

  useEffect(() => {
    const calm = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    let visible = true
    let t = 0
    let angle = 0
    let last = performance.now()
    const draw = (kmh: number, kw: number) => {
      if (speed.current) speed.current.textContent = String(Math.round(kmh))
      if (power.current) power.current.textContent = kw.toFixed(1)
      if (drive.current) drive.current.style.transform = `scaleX(${Math.max(0.02, Math.min(1, kw / 3))})`
      for (const w of wheels.current) w?.setAttribute('transform', `rotate(${angle.toFixed(1)} 32 32)`)
    }
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      t += dt
      const kmh = Math.max(0, 27 + 13 * Math.sin(t * 0.42) + 4 * Math.sin(t * 1.27))
      const accel = 13 * 0.42 * Math.cos(t * 0.42) + 4 * 1.27 * Math.cos(t * 1.27)
      const kw = Math.max(0.15, 0.4 + kmh / 30 + accel / 6)
      angle = (angle + kmh * 22 * dt) % 360
      draw(kmh, kw)
      frame = visible && !document.hidden ? requestAnimationFrame(tick) : 0
    }
    const resume = () => {
      if (frame || calm || !visible || document.hidden) return
      last = performance.now()
      frame = requestAnimationFrame(tick)
    }
    if (calm) {
      draw(27, 1.3)
      return
    }
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([e]) => {
            visible = e.isIntersecting
            resume()
          })
    if (box.current) io?.observe(box.current)
    document.addEventListener('visibilitychange', resume)
    resume()
    return () => {
      cancelAnimationFrame(frame)
      io?.disconnect()
      document.removeEventListener('visibilitychange', resume)
    }
  }, [])

  // One stretch of a "live" line that ends where it starts, drawn twice so it can scroll forever.
  const stretch = (x: number) =>
    `M${x} 30 C ${x + 20} 30, ${x + 30} 12, ${x + 50} 16 S ${x + 80} 36, ${x + 100} 28 S ${x + 130} 6, ${x + 150} 14 S ${x + 180} 30, ${x + 200} 30`
  return (
    <div
      ref={box}
      className="card relative mx-auto max-w-md p-5 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.6)] md:p-6"
      aria-label="Example dashboard"
      role="img"
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="live-dot size-2 rounded-full bg-ok" style={{ ['--pulse-color' as string]: 'var(--color-ok)' }} />
        <span className="font-medium">VESC BLE UART</span>
        <span className="ml-auto rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-semibold text-ok">Connected</span>
      </div>
      <div className="mt-5 flex items-end gap-2">
        <span ref={speed} className="num wide text-[88px] leading-[0.85] font-bold tracking-[-0.04em]">
          27
        </span>
        <span className="mb-1.5 text-lg text-muted">km/h</span>
        <div className="mb-1 ml-auto flex gap-1.5" aria-hidden>
          {[0, 1].map((n) => (
            <svg key={n} viewBox="0 0 64 64" className="size-11">
              <circle cx="32" cy="32" r="27" fill="none" strokeWidth="7" className="stroke-text/15" />
              <g ref={(el) => void (wheels.current[n] = el)}>
                <circle cx="32" cy="32" r="20" fill="none" strokeWidth="2.5" className="stroke-accent" />
                {[0, 72, 144, 216, 288].map((a) => (
                  <line
                    key={a}
                    x1="32"
                    x2="32"
                    y1="27"
                    y2="13"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="stroke-accent/80"
                    transform={`rotate(${a} 32 32)`}
                  />
                ))}
                <circle cx="32" cy="32" r="5" className="fill-accent" />
              </g>
            </svg>
          ))}
        </div>
      </div>
      <div className="mt-5">
        <div className="flex justify-between text-[11px] text-muted">
          <span className="label">Power</span>
          <span className="num">
            <span ref={power}>1.3</span> kW
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-3">
          <div ref={drive} className="h-full origin-left rounded-full bg-accent" style={{ transform: 'scaleX(0.4)' }} />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
        <Stat label="Battery" value="86" unit="%" />
        <Stat label="Motor" value="41" unit="°C" />
        <Stat label="Range" value="32" unit="km" />
      </div>
      <div className="mt-4 h-12 overflow-hidden rounded-lg bg-surface-2" aria-hidden>
        <svg viewBox="0 0 400 44" preserveAspectRatio="none" className="welcome-scroll h-full w-[200%]">
          <path
            d={`${stretch(0)} ${stretch(200)}`}
            fill="none"
            strokeWidth="2"
            className="stroke-accent"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
  )
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <div className="label text-[10px]">{label}</div>
      <div className="num mt-1 text-xl font-semibold">
        {value}
        <span className="ml-0.5 text-xs font-normal text-muted">{unit}</span>
      </div>
    </div>
  )
}
