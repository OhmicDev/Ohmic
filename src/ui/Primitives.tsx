import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from '../lib/format'
import { buttonClass, type ButtonVariant } from './buttonClass'

export function Button({ variant = 'secondary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={buttonClass(variant, className)} {...props} />
}

/** Where a page sits: the section it belongs to, shown above its title. */
type BackTo = '/setup' | '/tune' | '/more' | '/settings' | '/logs'

export function BackLink({ to, children }: { to: BackTo; children: ReactNode }) {
  return (
    <Link to={to} className="focus-ring -ml-1 mb-2 inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-[13px] font-medium text-accent hover:brightness-110">
      <ArrowLeft className="size-4" /> {children}
    </Link>
  )
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  // On a phone a long description would push the page down; it shows two lines until tapped.
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-3 gap-y-2 md:mb-5">
      <div className="min-w-0">
        <h1 className="wide text-[26px] leading-tight font-bold md:text-[28px]">{title}</h1>
        {subtitle && (
          <p
            className={cx('mt-1 max-w-2xl text-[13px] leading-relaxed text-muted md:text-sm', !open && 'max-md:line-clamp-2')}
            onClick={() => setOpen(true)}
          >
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' | 'warn' | 'ok' | 'danger' }) {
  const styles = {
    muted: 'bg-surface-3 text-muted',
    accent: 'bg-accent/15 text-accent',
    warn: 'bg-warn/15 text-warn',
    ok: 'bg-ok/15 text-ok',
    danger: 'bg-danger/15 text-danger',
  }[tone]
  return (
    <span className={cx('inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] leading-tight font-semibold tracking-[0.02em] uppercase', styles)}>
      {children}
    </span>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-surface-2 p-0.5 [scrollbar-width:none]"
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'focus-ring h-8 shrink-0 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors md:h-7 md:px-3',
            o.value === value ? 'bg-surface-3 text-text shadow-[0_1px_2px_rgb(0_0_0/0.25),inset_0_0_0_1px_var(--color-line-strong)]' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
