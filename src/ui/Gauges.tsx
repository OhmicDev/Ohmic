import { cx } from '../lib/format'

const BATTERY_SEGMENTS = 12

export function BatteryGauge({ soc, slim = false }: { soc: number; slim?: boolean }) {
  const filled = (soc / 100) * BATTERY_SEGMENTS
  const color = soc < 10 ? 'bg-danger' : soc < 25 ? 'bg-warn' : 'bg-accent'
  return (
    <div className={cx('flex gap-[3px]', slim ? 'h-1.5' : 'h-3')} role="meter" aria-valuenow={Math.round(soc)} aria-valuemin={0} aria-valuemax={100} aria-label="Battery">
      {Array.from({ length: BATTERY_SEGMENTS }, (_, i) => {
        const fill = Math.max(0, Math.min(1, filled - i))
        return (
          <div key={i} className="relative flex-1 overflow-hidden rounded-[3px] bg-surface-3">
            <div className={cx('absolute inset-y-0 left-0', color)} style={{ width: `${fill * 100}%`, opacity: 0.55 + fill * 0.45 }} />
          </div>
        )
      })}
    </div>
  )
}
