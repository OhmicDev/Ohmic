import { Link, Outlet } from '@tanstack/react-router'
import { Activity, SquareTerminal, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useFaults } from '../../state/faults'
import { PageTitle } from '../../ui/Primitives'

type TabTo = '/live' | '/live/faults' | '/live/terminal'

/** Shared header for the Live screens: signals, faults and the terminal. */
export function LiveLayout() {
  const activeFaults = useFaults((s) => Object.keys(s.active).length)
  return (
    <>
      <PageTitle title="Live" subtitle="Every value the controllers report, their faults, and the VESC terminal." />
      <nav aria-label="Live sections" className="-mt-1 mb-5 flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-line)]">
        <Tab to="/live" icon={Activity} label="Signals" exact />
        <Tab to="/live/faults" icon={TriangleAlert} label="Faults" badge={activeFaults} />
        <Tab to="/live/terminal" icon={SquareTerminal} label="Terminal" />
      </nav>
      <Outlet />
    </>
  )
}

function Tab({ to, icon: Icon, label, exact, badge }: { to: TabTo; icon: LucideIcon; label: string; exact?: boolean; badge?: number }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: !!exact }}
      className="focus-ring relative flex h-10 shrink-0 items-center gap-2 rounded-t-lg border-b-2 border-transparent px-3.5 text-sm text-muted transition-colors hover:text-text data-[status=active]:border-accent data-[status=active]:text-text"
    >
      <Icon className="size-4" strokeWidth={1.9} />
      {label}
      {!!badge && (
        <span className="num rounded-full bg-danger px-1.5 text-[11px] leading-[18px] font-semibold text-bg" aria-label={`${badge} active`}>
          {badge}
        </span>
      )}
    </Link>
  )
}
