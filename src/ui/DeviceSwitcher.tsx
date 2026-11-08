import { ChevronDown, Cpu } from 'lucide-react'
import { targetKey, targetLabel, viewFromKey, viewKey } from '../state/devices'
import { useSession } from '../state/session'

/** Picks which motor controller the dashboard shows. Only appears when there is more than one. */
export function DeviceSwitcher() {
  const status = useSession((s) => s.status)
  const devices = useSession((s) => s.devices)
  const view = useSession((s) => s.view)
  const setView = useSession((s) => s.setView)
  const motors = devices.filter((d) => d.motor)
  if ((status !== 'connected' && status !== 'reconnecting') || motors.length < 2) return null

  return (
    <label className="relative inline-flex h-9 items-center" title="Which controller the dashboard shows">
      <span className="sr-only">Show values from</span>
      <Cpu className="pointer-events-none absolute left-3 size-3.5 text-muted" aria-hidden />
      <select
        value={viewKey(view)}
        onChange={(e) => setView(viewFromKey(e.target.value))}
        className="focus-ring h-9 max-w-[9.5rem] cursor-pointer appearance-none truncate rounded-full border border-line bg-surface-2/80 pr-8 pl-8 text-[13px] font-medium text-text transition-colors hover:border-line-strong"
      >
        <option value="all">All motors</option>
        {motors.map((d) => (
          <option key={targetKey(d.target)} value={targetKey(d.target)}>
            {targetLabel(d.target)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 size-3.5 text-muted" aria-hidden />
    </label>
  )
}
