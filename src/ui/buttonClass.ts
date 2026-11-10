import { twMerge } from 'tailwind-merge'
import { cx } from '../lib/format'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-bg font-semibold hover:brightness-110 active:brightness-95 shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_2px_rgb(0_0_0/0.3)]',
  secondary: 'bg-surface-3 text-text border border-line-strong shadow-[0_1px_1px_rgb(0_0_0/0.15)] hover:border-text/25',
  ghost: 'text-muted hover:text-text hover:bg-surface-3',
  danger: 'bg-danger/12 text-danger border border-danger/30 hover:bg-danger/20',
}

/**
 * Button looks, for links that act as buttons. A size passed in `className` (h-8, px-2.5, text-xs)
 * replaces the default rather than fighting it; on phones every button stays at least 36 px tall to tap.
 */
export function buttonClass(variant: ButtonVariant = 'secondary', className?: string) {
  return twMerge(
    cx(
      'focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-xl px-3.5 text-[13px] font-medium whitespace-nowrap transition select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 max-md:min-h-9 md:h-9',
      BUTTON_STYLES[variant],
    ),
    className,
  )
}
