// The Ride dashboard while connected. It has pages the rider picks and puts in
// order: Gauges, Tiles and Focus. On a phone they sit side by side and swipe like
// a car's instrument cluster, all on one screen with the ride controls under them;
// on a wider screen the tabs switch between them. In edit mode a tap on anything
// changes it and a drag moves it; Customize (Customize.tsx) holds the rest.

import { Link } from '@tanstack/react-router'
import { Check, SlidersHorizontal, TriangleAlert, WifiOff } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cx } from '../../lib/format'
import { faultInfo } from '../../protocol/faults'
import { useDashLayout, type PageId } from '../../state/dashboard'
import { targetLabel } from '../../state/devices'
import { useSession } from '../../state/session'
import { useSettings } from '../../state/settings'
import { useTelemetry, type Dashboard as Dash } from '../../state/telemetry'
import { haptic } from '../../ui/haptics'
import { Badge, Button } from '../../ui/Primitives'
import { prefersReducedMotion } from '../../ui/reducedMotion'
import { ReconnectBanner } from '../../ui/ReconnectBanner'
import { useIsPhone } from '../../ui/useMediaQuery'
import { useWakeLock } from '../../ui/useWakeLock'
import { RecordButton } from '../logs/RecordControls'
import { SetupPrompt } from '../setup/SetupSteps'
import { CustomizeSheet } from './Customize'
import { FocusPage } from './FocusPage'
import { GaugesPage } from './GaugesPage'
import { PAGES } from './pageInfo'
import { RideControls } from './RideControls'
import { RideStats } from './RideStats'
import { TilesPage } from './TilesPage'
import { WheelSpeeds } from './WheelSpeeds'

export function Dashboard() {
  const phone = useIsPhone()
  const show = useDashLayout((s) => s.show)
  const keepAwake = useSettings((s) => s.keepAwake)
  const [editing, setEditing] = useState(false)
  const [options, setOptions] = useState(false)
  useWakeLock(keepAwake)

  const bar = <DashBar phone={phone} editing={editing} onEdit={setEditing} onOptions={() => setOptions(true)} />
  const sheet = <CustomizeSheet open={options} onClose={() => setOptions(false)} phone={phone} />

  if (phone)
    return (
      <>
        <h1 className="sr-only">Ride</h1>
        <div className="space-y-3">
          {/* One screen: the small viewport, less the header, the tab bar, the page's padding and the status bar when installed. */}
          <div className="flex h-[calc(100svh_-_144px_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] min-h-[460px] flex-col gap-2">
            <Alerts />
            <SetupPrompt compact />
            {bar}
            <Pager editing={editing} />
            {show.controls && <RideControls compact />}
          </div>
          {show.stats && (
            <>
              <RideStats />
              <VehicleNote />
            </>
          )}
        </div>
        {sheet}
      </>
    )

  return (
    <>
      <h1 className="sr-only">Ride</h1>
      <div className="space-y-3">
        <Alerts />
        <SetupPrompt />
        {bar}
        <SinglePage editing={editing} />
        {show.controls && <RideControls />}
        {show.stats && <RideStats />}
        <VehicleNote />
        {/* Room to scroll the last row clear of the wheels in the corner. */}
        {show.wheels && <div aria-hidden className="h-16 md:h-24" />}
      </div>
      {show.wheels && <WheelSpeeds />}
      {sheet}
    </>
  )
}

function PageBody({ id, editing, phone }: { id: PageId; editing: boolean; phone: boolean }) {
  if (id === 'gauges') return <GaugesPage editing={editing} phone={phone} />
  if (id === 'focus') return <FocusPage editing={editing} phone={phone} />
  return <TilesPage editing={editing} phone={phone} />
}

const tabId = (id: PageId) => `dash-tab-${id}`
const panelId = (id: PageId) => `dash-page-${id}`

/** The page tabs, and what applies to the whole dashboard: recording, and arranging it. */
function DashBar({ phone, editing, onEdit, onOptions }: { phone: boolean; editing: boolean; onEdit: (on: boolean) => void; onOptions: () => void }) {
  const pages = useDashLayout((s) => s.pages)
  const page = useDashLayout((s) => s.page)
  const view = useTelemetry((s) => s.dash?.view ?? 'all')
  const tabs = useRef<HTMLDivElement>(null)
  const go = (id: PageId) => useDashLayout.getState().setPage(id)
  const onKey = (e: KeyboardEvent) => {
    const at = pages.indexOf(page)
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? pages.length - 1 : null
    if (to === null) return
    e.preventDefault()
    const next = pages[(to + pages.length) % pages.length]
    go(next)
    tabs.current?.querySelector<HTMLElement>(`#${tabId(next)}`)?.focus()
  }
  return (
    <div className="space-y-2">
      <div className="flex min-h-10 items-center gap-2">
        <div ref={tabs} role="tablist" aria-label="Dashboard pages" onKeyDown={onKey} className="flex shrink-0 rounded-xl border border-line bg-surface-2 p-0.5">
          {pages.map((id) => {
            const p = PAGES[id]
            const on = id === page
            return (
              <button
                key={id}
                id={tabId(id)}
                role="tab"
                aria-selected={on}
                aria-controls={panelId(id)}
                aria-label={p.label}
                tabIndex={on ? 0 : -1}
                onClick={() => go(id)}
                className={cx(
                  'focus-ring flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-200 md:px-3',
                  on ? 'bg-surface-3 text-text shadow-[0_1px_2px_rgb(0_0_0/0.25),inset_0_0_0_1px_var(--color-line-strong)]' : 'text-muted hover:text-text',
                )}
              >
                <p.icon className={cx('size-4', on && 'text-accent')} aria-hidden />
                {/* On a phone only the page shown is named, to leave room. */}
                {(!phone || on) && <span>{p.label}</span>}
              </button>
            )
          })}
        </div>
        {view !== 'all' && <Badge>{phone ? targetLabel(view) : `${targetLabel(view)} only`}</Badge>}
        <span className="ml-auto flex items-center gap-1">
          {editing ? (
            <>
              <Button variant="ghost" aria-label="Options" className={cx('h-8 text-xs', phone ? 'w-8 px-0' : 'px-2.5')} onClick={onOptions}>
                <SlidersHorizontal className="size-4" />
                {!phone && 'Options'}
              </Button>
              <Button variant="primary" className="h-8 px-3 text-xs" onClick={() => onEdit(false)}>
                <Check className="size-3.5" /> Done
              </Button>
            </>
          ) : (
            <>
              <RecordButton />
              <Button variant="ghost" aria-label="Customize" className={cx('h-8 text-xs', phone ? 'w-8 px-0' : 'px-2.5')} onClick={() => onEdit(true)}>
                <SlidersHorizontal className="size-4" />
                {!phone && 'Customize'}
              </Button>
            </>
          )}
        </span>
      </div>
      {editing && (
        <p role="status" className="px-1 text-xs text-muted">
          Tap anything to change it. Drag to move it.
        </p>
      )}
    </div>
  )
}

/** A wider screen shows one page at a time; the tabs switch them. */
function SinglePage({ editing }: { editing: boolean }) {
  const page = useDashLayout((s) => s.page)
  return (
    <div key={page} id={panelId(page)} role="tabpanel" aria-labelledby={tabId(page)} className="page-in">
      <PageBody id={page} editing={editing} phone={false} />
    </div>
  )
}

/**
 * On a phone the pages sit side by side and snap into place as they're swiped. Only the pages
 * in view are drawn, so the ones off to the side cost nothing while values stream in.
 * While arranging, swiping is off so a drag moves what's under it instead; the tabs still work.
 */
function Pager({ editing }: { editing: boolean }) {
  const pages = useDashLayout((s) => s.pages)
  const page = useDashLayout((s) => s.page)
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState<ReadonlySet<PageId>>(() => new Set())
  const index = Math.max(0, pages.indexOf(page))
  const first = useRef(true)

  // Go to the page when it's picked another way: a tab, or the pages changing.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !el.clientWidth) return
    const x = index * el.clientWidth
    const jump = first.current || prefersReducedMotion()
    first.current = false
    if (Math.abs(el.scrollLeft - x) > 1) el.scrollTo({ left: x, behavior: jump ? 'instant' : 'smooth' })
  }, [index, pages])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Once a swipe comes to rest, the page it rests on is the page shown.
    let timer = 0
    const onScroll = () => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        const s = useDashLayout.getState()
        const next = s.pages[Math.round(el.scrollLeft / el.clientWidth)]
        if (next && next !== s.page) {
          haptic()
          s.setPage(next)
        }
      }, 100)
    }
    // A new width (turning the phone) keeps the same page in place.
    const ro = new ResizeObserver(() => {
      const s = useDashLayout.getState()
      el.scrollTo({ left: Math.max(0, s.pages.indexOf(s.page)) * el.clientWidth, behavior: 'instant' })
    })
    el.addEventListener('scroll', onScroll, { passive: true })
    ro.observe(el)
    return () => {
      clearTimeout(timer)
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) =>
        setInView((prev) => {
          const next = new Set(prev)
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.page as PageId
            if (e.isIntersecting) next.add(id)
            else next.delete(id)
          }
          return next.size === prev.size && [...next].every((id) => prev.has(id)) ? prev : next
        }),
      // Pages that only touch the edge aren't in view.
      { root: el, rootMargin: '0px -1px' },
    )
    for (const child of el.children) io.observe(child)
    return () => io.disconnect()
  }, [pages])

  return (
    <div
      ref={ref}
      className={cx(
        // Edge to edge, so a page slides off the screen rather than being cut at the margin.
        '-mx-4 flex min-h-0 flex-1 snap-x snap-mandatory overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        editing ? 'overflow-x-hidden' : 'overflow-x-auto',
      )}
    >
      {pages.map((id) => (
        <div
          key={id}
          data-page={id}
          id={panelId(id)}
          role="tabpanel"
          aria-labelledby={tabId(id)}
          inert={id !== page}
          className="h-full w-full shrink-0 snap-start snap-always px-4"
        >
          {(id === page || inView.has(id)) && <PageBody id={id} editing={editing} phone />}
        </div>
      ))}
    </div>
  )
}

/** The vehicle numbers the readings are worked out from. */
function VehicleNote() {
  const vehicle = useSettings((s) => s.vehicle)
  return (
    <p className="num flex flex-wrap items-center gap-x-2 px-1 text-[11px] text-faint">
      <span>
        {vehicle.wheelDiameterMm} mm wheel · {vehicle.motorPoles} poles · {vehicle.batteryCells}S {vehicle.batteryAh} Ah
      </span>
      <Link to="/settings" hash="vehicle" className="text-muted underline decoration-line-strong underline-offset-2 hover:text-text">
        Vehicle
      </Link>
    </p>
  )
}

const NO_FAULTS: Dash['faults'] = []

function Alerts() {
  const faults = useTelemetry((s) => s.dash?.faults ?? NO_FAULTS)
  const link = useSession((s) => s.link)
  const reconnecting = useSession((s) => s.status === 'reconnecting')
  return (
    <>
      {reconnecting && <ReconnectBanner frozen />}
      {!reconnecting && link !== 'ok' && (
        <div role="status" className="card flex items-center gap-3 border-warn/30 bg-warn/5 p-3.5 text-sm">
          <WifiOff className="size-4 shrink-0 text-warn" />
          <span>{link === 'lost' ? 'No answer from the controller. Values are frozen.' : 'Slow connection. Some updates were missed.'}</span>
        </div>
      )}
      {faults.map((f) => {
        const info = faultInfo(f.code)
        return (
          <div key={`${f.target}-${f.code}`} role="alert" className="card flex items-start gap-3 border-danger/35 bg-danger/5 p-4 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-danger">
                {info.title}
                {f.target !== 'local' && <span className="ml-2 font-normal text-muted">on CAN {f.target}</span>}
              </div>
              <div className="mt-0.5 text-muted">{info.help}</div>
            </div>
            <Link
              to="/live/faults"
              className="focus-ring shrink-0 self-center rounded-lg px-2 py-1 text-xs font-medium text-text underline-offset-2 hover:underline"
            >
              What to do
            </Link>
          </div>
        )
      })}
    </>
  )
}
