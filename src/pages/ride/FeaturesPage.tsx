import { BatteryCharging, Layers, ShieldCheck, TrendingUp } from 'lucide-react'
import { PageTitle } from '../../ui/Primitives'
import { LinkRow, RowGroup, type LinkRowProps } from '../../ui/RowList'

const RIDING: LinkRowProps[] = [
  { to: '/modes', icon: Layers, title: 'Ride modes', hint: 'Eco, Normal, Sport and your own; single or dual motor.' },
  { to: '/regen', icon: BatteryCharging, title: 'Regen', hint: 'Slows you down when you let go of the throttle.' },
  { to: '/abs', icon: ShieldCheck, title: 'ABS', hint: 'Eases motor braking when a wheel starts to skid.' },
  { to: '/wheelie', icon: TrendingUp, title: 'Auto-wheelie', hint: 'Pin the throttle and lean back; it holds the front up.' },
]

/** The Features tab: what the vehicle does as you ride. Every raw setting is in Tune. */
export function FeaturesPage() {
  return (
    <>
      <PageTitle title="Features" subtitle="Shape how it rides. Every change is checked and backed up." />
      <div className="max-w-2xl">
        <RowGroup id="features-riding" title="How it rides">
          {RIDING.map((item) => (
            <LinkRow key={item.to} {...item} />
          ))}
        </RowGroup>
      </div>
    </>
  )
}
