import { deviceKind, targetKey, targetLabel, type DeviceInfo } from '../../state/devices'
import { cx } from '../../lib/format'

/** Chooses which device on the connection a tool works with. Hidden when there's only one. */
export function TargetPicker({
  devices,
  value,
  onChange,
  label = 'Device',
}: {
  devices: DeviceInfo[]
  value: string
  onChange: (key: string) => void
  label?: string
}) {
  if (devices.length < 2) return null
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {devices.map((d) => {
        const key = targetKey(d.target)
        const on = key === value
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(key)}
            className={cx(
              'focus-ring flex h-10 items-center gap-2 rounded-xl border px-3 text-left text-sm transition-colors',
              on ? 'border-accent/50 bg-accent/10 text-text' : 'border-line-strong text-muted hover:text-text',
            )}
          >
            <span className="font-medium">{targetLabel(d.target)}</span>
            <span className="text-xs text-muted">{d.fw?.hwName || deviceKind(d)}</span>
          </button>
        )
      })}
    </div>
  )
}
