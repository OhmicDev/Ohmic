import { Archive, BatteryCharging, Layers, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { PageTitle } from '../../ui/Primitives'
import { LinkRow, RowGroup, type LinkRowProps } from '../../ui/RowList'

const RIDING: LinkRowProps[] = [
  { to: '/modes', icon: Layers, color: 'blue', title: 'Ride modes', hint: 'Eco, Normal, Sport and your own; single or dual motor.' },
  { to: '/regen', icon: BatteryCharging, color: 'green', title: 'Regen', hint: 'Slows you down when you let go of the throttle.' },
  { to: '/abs', icon: ShieldCheck, color: 'orange', title: 'ABS', hint: 'Eases motor braking when a wheel starts to skid.' },
]

const EVERY: LinkRowProps[] = [
  { to: '/config', icon: SlidersHorizontal, color: 'grey', title: 'Config', hint: 'Every motor and app setting, searchable, with help.' },
  { to: '/config/backups', icon: Archive, color: 'teal', title: 'Backups', hint: 'Saved before every write. Compare, restore, export.' },
]

/** The Tune tab: how the vehicle rides, and every setting behind it. */
export function TuneHubPage() {
  return (
    <>
      <PageTitle title="Tune" subtitle="Shape how it rides. Every change is checked and backed up." />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <RowGroup id="tune-riding" title="How it rides">
          {RIDING.map((item) => (
            <LinkRow key={item.to} {...item} />
          ))}
        </RowGroup>
        <RowGroup id="tune-every" title="Every setting">
          {EVERY.map((item) => (
            <LinkRow key={item.to} {...item} />
          ))}
        </RowGroup>
      </div>
    </>
  )
}
