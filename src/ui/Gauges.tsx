import { cx, fmt } from '../lib/format'

/** Regen on the left, drive on the right, zero in the middle. */
export function PowerBar({ power, peakDrive, peakRegen }: { power: number; peakDrive: number; peakRegen: number }) {
  const driveScale = Math.max(1500, peakDrive)
  const regenScale = Math.max(600, -peakRegen)
  const drive = power > 0 ? Math.min(1, power / driveScale) : 0
  const regen = power < 0 ? Math.min(1, -power / regenScale) : 0
  return (
    <div>
      <div className="relative flex h-2.5 items-center gap-1">
        <div className="relative h-full flex-[1] overflow-hidden rounded-full bg-surface-3">
          <div
            className="absolute inset-y-0 right-0 rounded-full bg-regen transition-[width] duration-150 ease-out"
            style={{ width: `${regen * 100}%`, boxShadow: regen ? '0 0 14px var(--color-regen)' : undefined }}
          />
        </div>
        <div className="h-4 w-px bg-line-strong" />
        <div className="relative h-full flex-[2.4] overflow-hidden rounded-full bg-surface-3">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-150 ease-out"
            style={{ width: `${drive * 100}%`, boxShadow: drive ? '0 0 16px var(--accent)' : undefined }}
          />
        </div>
      </div>
      <div className="num mt-2 flex justify-between text-[11px] text-muted">
        <span>
          <span className="label mr-1.5 text-[9.5px]">Regen</span>
          {fmt(Math.max(0, -power) / 1000, 2)} kW
        </span>
        <span>
          <span className="label mr-1.5 text-[9.5px]">Drive</span>
          {fmt(Math.max(0, power) / 1000, 2)} kW
        </span>
      </div>
    </div>
  )
}

export function BatteryGauge({ soc, segments = 12 }: { soc: number; segments?: number }) {
  const filled = (soc / 100) * segments
  const color = soc < 10 ? 'bg-danger' : soc < 25 ? 'bg-warn' : 'bg-accent'
  return (
    <div className="flex h-3 gap-[3px]" role="meter" aria-valuenow={Math.round(soc)} aria-valuemin={0} aria-valuemax={100} aria-label="Battery">
      {Array.from({ length: segments }, (_, i) => {
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
