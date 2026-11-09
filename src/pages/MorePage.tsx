import { Link } from '@tanstack/react-router'
import { Battery, Boxes, Calculator, Code2, Compass, Cpu, Gamepad2, Music, Network, Route, Settings } from 'lucide-react'
import { APP_NAME, APP_VERSION } from '../appInfo'
import { buttonClass } from '../ui/buttonClass'
import { PageTitle } from '../ui/Primitives'
import { LinkRow, RowGroup, type LinkRowProps } from '../ui/RowList'

const GROUPS: { id: string; title: string; items: LinkRowProps[] }[] = [
  {
    id: 'riding',
    title: 'Riding',
    items: [
      { to: '/logs', icon: Route, color: 'green', title: 'Ride logs', hint: 'Record rides with GPS, maps and charts' },
      { to: '/sounds', icon: Music, color: 'red', title: 'Motor sounds', hint: 'Tunes and effects through the motor' },
      { to: '/calc', icon: Calculator, color: 'grey', title: 'Calculators', hint: 'Range, top speed, battery and charging' },
    ],
  },
  {
    id: 'controller',
    title: 'Controller tools',
    items: [
      { to: '/control', icon: Gamepad2, color: 'orange', title: 'Motor control', hint: 'Drive a motor on the bench' },
      { to: '/firmware', icon: Cpu, color: 'blue', title: 'Firmware', hint: 'Update controllers on USB and CAN' },
      { to: '/lisp', icon: Code2, color: 'purple', title: 'LispBM scripts', hint: 'Write, upload and run scripts' },
      { to: '/packages', icon: Boxes, color: 'teal', title: 'Packages', hint: 'Add features from the VESC package archive' },
    ],
  },
  {
    id: 'sensors',
    title: 'Battery, sensors and CAN bus',
    items: [
      { to: '/bms', icon: Battery, color: 'green', title: 'Battery (BMS)', hint: 'Cells, balancing, temperatures and charge' },
      { to: '/imu', icon: Compass, color: 'blue', title: 'IMU', hint: 'Live orientation and calibration' },
      { to: '/can', icon: Network, color: 'grey', title: 'CAN bus', hint: 'Devices on the bus and a traffic monitor' },
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
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {GROUPS.map((g) => (
          <RowGroup key={g.id} id={`more-${g.id}`} title={g.title}>
            {g.items.map((item) => (
              <LinkRow key={item.to} {...item} />
            ))}
          </RowGroup>
        ))}
      </div>
      <p className="mt-8 px-1 text-xs leading-relaxed text-faint">
        {APP_NAME} {APP_VERSION} · Built on the open-source VESC project by Benjamin Vedder and contributors.{' '}
        <Link to="/welcome" className="underline decoration-line-strong underline-offset-2 hover:text-text">
          What {APP_NAME} is
        </Link>
        {' · '}
        <Link to="/settings" hash="about" className="underline decoration-line-strong underline-offset-2 hover:text-text">
          About and credits
        </Link>
      </p>
    </>
  )
}
