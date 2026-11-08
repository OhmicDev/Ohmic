import { cx } from '../lib/format'

/** An on/off switch, drawn like the Apple one. */
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
      className={cx(
        'focus-ring relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40',
        checked ? 'bg-accent' : 'bg-surface-3 shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
      )}
    >
      <span
        className={cx(
          'absolute top-[3px] size-5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.35)] transition-[left] duration-200',
          checked ? 'left-[21px]' : 'left-[3px]',
        )}
      />
    </button>
  )
}
