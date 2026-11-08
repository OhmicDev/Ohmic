import { Link } from '@tanstack/react-router'
import {
  Battery,
  Boxes,
  Calculator,
  ChevronRight,
  Code2,
  Compass,
  Cpu,
  Gamepad2,
  Music,
  Network,
  Route,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { APP_NAME, APP_VERSION } from '../appInfo'
import { buttonClass } from '../ui/buttonClass'
import { PageTitle } from '../ui/Primitives'

type MoreRoute = '/logs' | '/sounds' | '/calc' | '/control' | '/firmware' | '/lisp' | '/packages' | '/bms' | '/imu' | '/can'

type Item = { to: MoreRoute; icon: LucideIcon; title: string; hint: string }

const GROUPS: { id: string; title: string; items: Item[] }[] = [
  {
    id: 'riding',
    title: 'Riding',
    items: [
      { to: '/logs', icon: Route, title: 'Ride logs', hint: 'Record rides with GPS, maps and charts' },
      { to: '/sounds', icon: Music, title: 'Motor sounds', hint: 'Tunes and effects through the motor' },
      { to: '/calc', icon: Calculator, title: 'Calculators', hint: 'Range, top speed, battery and charging' },
    ],
  },
  {
    id: 'controller',
    title: 'Controller tools',
    items: [
      { to: '/control', icon: Gamepad2, title: 'Motor control', hint: 'Drive a motor on the bench' },
      { to: '/firmware', icon: Cpu, title: 'Firmware', hint: 'Update controllers on USB and CAN' },
      { to: '/lisp', icon: Code2, title: 'LispBM scripts', hint: 'Write, upload and run scripts' },
      { to: '/packages', icon: Boxes, title: 'Packages', hint: 'Add features from the VESC package archive' },
    ],
  },
  {
    id: 'sensors',
    title: 'Battery, sensors and CAN bus',
    items: [
      { to: '/bms', icon: Battery, title: 'Battery (BMS)', hint: 'Cells, balancing, temperatures and charge' },
      { to: '/imu', icon: Compass, title: 'IMU', hint: 'Live orientation and calibration' },
      { to: '/can', icon: Network, title: 'CAN bus', hint: 'Devices on the bus and a traffic monitor' },
    ],
  },
]

export function MorePage() {
  return (
    <>
      <PageTitle
        title="More"
        subtitle="Ride logs, controller tools, add-ons, and the app’s settings."
        actions={
          <Link to="/settings" className={buttonClass('secondary')}>
            <Settings className="size-4" aria-hidden /> Settings
          </Link>
        }
      />
      <div className="space-y-6">
        {GROUPS.map((g) => (
          <section key={g.id} aria-labelledby={`more-${g.id}`}>
            <h2 id={`more-${g.id}`} className="label mb-2">
              {g.title}
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((item) => (
                <li key={item.to}>
                  <ToolLink {...item} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-8 px-1 text-xs leading-relaxed text-faint">
        {APP_NAME} {APP_VERSION} · Built on the open-source VESC project by Benjamin Vedder and contributors.{' '}
        <Link to="/settings" hash="about" className="underline decoration-line-strong underline-offset-2 hover:text-text">
          About and credits
        </Link>
      </p>
    </>
  )
}

function ToolLink({ to, icon: Icon, title, hint }: Item) {
  return (
    <Link to={to} className="card focus-ring flex h-full items-center gap-3 p-4 transition-colors hover:border-line-strong">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <Icon className="size-[18px]" strokeWidth={1.9} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
    </Link>
  )
}
