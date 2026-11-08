import { cx } from '../lib/format'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-bg font-semibold hover:brightness-110 shadow-[0_0_24px_-6px_var(--accent)]',
  secondary: 'bg-surface-3 text-text border border-line-strong hover:border-text/25',
  ghost: 'text-muted hover:text-text hover:bg-surface-3',
  danger: 'bg-danger/12 text-danger border border-danger/30 hover:bg-danger/20',
}

/** Button looks, for links that act as buttons. */
export function buttonClass(variant: ButtonVariant = 'secondary', className?: string) {
  return cx(
    'focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm transition disabled:pointer-events-none disabled:opacity-40',
    BUTTON_STYLES[variant],
    className,
  )
}
