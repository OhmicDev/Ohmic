import { Link, type LinkProps } from '@tanstack/react-router'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../lib/format'
import { ICON_TILE, ROW_FOCUS } from './rowStyles'

export function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className={ICON_TILE}>
      <Icon className="size-[17px]" strokeWidth={1.8} aria-hidden />
    </span>
  )
}

/** A grouped list: a small heading over rows in one card. */
export function RowGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="label mb-1.5 px-1">
        {title}
      </h2>
      <ul className="card divide-y divide-line overflow-hidden">{children}</ul>
    </section>
  )
}

export type LinkRowProps = { to: LinkProps['to']; icon: LucideIcon; title: string; hint: string }

export function LinkRow({ to, icon, title, hint }: LinkRowProps) {
  return (
    <li>
      <Link
        to={to}
        className={cx('flex min-h-14 items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2 active:bg-surface-3', ROW_FOCUS)}
      >
        <IconTile icon={icon} />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium">{title}</span>
          <span className="block text-[12.5px] leading-snug text-muted">{hint}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
      </Link>
    </li>
  )
}
