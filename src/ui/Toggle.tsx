import { cx } from '../lib/format'

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('focus-ring relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-40', checked ? 'border-accent/50 bg-accent/25' : 'border-line-strong bg-surface-3')}
    >
      <span className={cx('absolute top-1/2 size-5 -translate-y-1/2 rounded-full transition-all', checked ? 'left-6 bg-accent' : 'left-1 bg-muted')} />
    </button>
  )
}
