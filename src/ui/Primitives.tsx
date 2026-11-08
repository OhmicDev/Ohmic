import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../lib/format'
import { buttonClass, type ButtonVariant } from './buttonClass'

export function Button({ variant = 'secondary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={buttonClass(variant, className)} {...props} />
}

/** Where a page sits: the section it belongs to, shown above its title. */
export type BackTo = '/setup' | '/more' | '/settings' | '/logs'

export function BackLink({ to, children }: { to: BackTo; children: ReactNode }) {
  return (
    <Link to={to} className="focus-ring mb-3 inline-flex items-center gap-1.5 rounded text-sm text-muted hover:text-text">
      <ArrowLeft className="size-4" /> {children}
    </Link>
  )
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="wide text-2xl font-bold tracking-tight md:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' | 'warn' }) {
  const styles = {
    muted: 'border-line-strong text-muted',
    accent: 'border-accent/40 text-accent',
    warn: 'border-warn/40 text-warn',
  }[tone]
  return <span className={cx('label inline-flex items-center rounded-full border px-2 py-0.5 text-[9.5px]', styles)}>{children}</span>
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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-line bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'focus-ring h-8 rounded-lg px-3.5 text-[13px] font-medium transition-colors',
            o.value === value ? 'bg-surface-3 text-text shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ComingSoon({ phase, title, children }: { phase: number; title: string; children: ReactNode }) {
  return (
    <div className="card p-6 md:p-8">
      <Badge tone="accent">Phase {phase}</Badge>
      <h2 className="wide mt-3 text-lg font-semibold">{title}</h2>
      <div className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{children}</div>
    </div>
  )
}
