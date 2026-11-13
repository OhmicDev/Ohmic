import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { Activity, Gauge, LayoutGrid, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, Sparkles, Wrench, type LucideIcon } from 'lucide-react'
import { useEffect } from 'react'
import { APP_NAME, APP_VERSION } from '../appInfo'
import { useT, type MessageKey } from '../i18n'
import { cx } from '../lib/format'
import { useSession } from '../state/session'
import { useSettings } from '../state/settings'
import { OfflineStrip, UpdateToast } from './AppNotices'
import { ConnectionChip } from './ConnectionChip'
import { ConnectSheet } from './ConnectSheet'
import { DeviceSwitcher } from './DeviceSwitcher'
import { haptic } from './haptics'
import { Logo } from './Logo'
import { Onboarding } from './Onboarding'
import { useApplyTheme } from './theme'
import { useMediaQuery } from './useMediaQuery'

type NavItem = {
  to: '/' | '/setup' | '/live' | '/features' | '/config' | '/more'
  label: MessageKey
  icon: LucideIcon
  /** Other pages that belong to this tab, so it stays highlighted on them. */
  owns?: string[]
}

const NAV: NavItem[] = [
  { to: '/', label: 'nav.ride', icon: Gauge },
  { to: '/setup', label: 'nav.setup', icon: Wrench },
  { to: '/live', label: 'nav.live', icon: Activity },
  { to: '/features', label: 'nav.features', icon: Sparkles, owns: ['/modes', '/abs', '/regen', '/wheelie'] },
  { to: '/config', label: 'nav.tune', icon: SlidersHorizontal },
  {
    to: '/more',
    label: 'nav.more',
    icon: LayoutGrid,
    owns: ['/logs', '/sounds', '/calc', '/control', '/firmware', '/lisp', '/packages', '/bms', '/imu', '/can', '/settings', '/dev'],
  },
]

function useOwned(item: NavItem): boolean {
  const path = useRouterState({ select: (s) => s.location.pathname })
  return !!item.owns?.some((p) => path === p || path.startsWith(`${p}/`))
}

export function AppShell() {
  const language = useSettings((s) => s.language)
  const hasSwitcher = useSession((s) => (s.status === 'connected' || s.status === 'reconnecting') && s.devices.filter((d) => d.motor).length > 1)
  const t = useT()
  const path = useRouterState({ select: (s) => s.location.pathname })
  useApplyTheme()
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  // The front page is a page of its own, without the app around it.
  if (path === '/welcome') {
    return (
      <>
        <Outlet />
        <UpdateToast />
      </>
    )
  }

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="skip-link focus-ring">
        {t('shell.skip')}
      </a>

      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Under the status bar when installed on a phone, so it reaches the top edge. */}
        <header className="glass sticky top-0 z-20 flex h-[calc(3rem+env(safe-area-inset-top))] items-center gap-3 border-b border-line px-4 pt-[env(safe-area-inset-top)] [view-transition-name:app-header] md:h-[calc(3.5rem+env(safe-area-inset-top))] md:px-6 lg:px-8">
          <Link to="/" className="focus-ring flex items-center gap-2 rounded-lg md:hidden">
            <Logo size={24} />
            {/* On narrow phones the device switcher needs the room; the logo stays. */}
            <span className={cx('wide text-[15px] font-semibold', hasSwitcher && 'max-[419px]:sr-only')}>{APP_NAME}</span>
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <DeviceSwitcher />
            <ConnectionChip />
          </div>
        </header>
        <OfflineStrip />

        <main
          id="main"
          tabIndex={-1}
          className="relative isolate flex-1 px-4 pt-4 pb-[calc(84px+env(safe-area-inset-bottom))] outline-none md:px-6 md:pt-7 md:pb-10 lg:px-10"
        >
          <div className="mx-auto w-full max-w-[1200px]">
            <Outlet />
          </div>
        </main>
      </div>

      <UpdateToast />
      <Onboarding />
      <ConnectSheet />

      <nav
        aria-label={t('nav.main')}
        className="glass fixed inset-x-0 bottom-0 z-30 border-t border-line pb-[env(safe-area-inset-bottom)] [view-transition-name:app-tabs] md:hidden"
      >
        <div className="mx-auto grid h-16 max-w-lg grid-cols-6 px-1">
          {NAV.map((item) => (
            <TabLink key={item.to} item={item} />
          ))}
        </div>
      </nav>
    </div>
  )
}

/**
 * The main sections down the left on tablets and computers. On wide screens it can close down to
 * its icons (remembered); narrower than that it's always just the icons.
 */
function Sidebar() {
  const t = useT()
  const wide = useMediaQuery('(min-width: 64rem)')
  const closed = useSettings((s) => s.sidebarClosed)
  const setClosed = useSettings((s) => s.setSidebarClosed)
  const open = wide && !closed
  const Toggle = open ? PanelLeftClose : PanelLeftOpen

  return (
    <aside
      data-open={open || undefined}
      className={cx(
        'sticky top-0 z-30 hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-line bg-bg pt-[env(safe-area-inset-top)] transition-[width] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] [view-transition-name:app-side] md:flex',
        open ? 'w-56' : 'w-16',
      )}
    >
      <Link
        to="/"
        className="focus-ring mx-2.5 flex h-14 shrink-0 items-center gap-2.5 rounded-lg px-2"
        aria-label={t('shell.home', { app: APP_NAME })}
        title={open ? undefined : APP_NAME}
      >
        <Logo size={28} />
        <span className={cx('wide text-[16px] font-semibold whitespace-nowrap transition-opacity', !open && 'opacity-0')}>{APP_NAME}</span>
      </Link>

      <nav aria-label={t('nav.main')} className="mt-3 flex flex-col gap-1 px-2.5">
        {NAV.map((item) => (
          <SideLink key={item.to} item={item} open={open} />
        ))}
      </nav>

      <div className="mt-auto px-2.5 pb-3">
        {open && (
          <p className="mb-2 px-2.5 text-[11px] leading-relaxed whitespace-nowrap text-faint">
            <Link to="/welcome" className="focus-ring rounded hover:text-text">
              {APP_NAME} {APP_VERSION}
            </Link>
            <br />
            Built on the open VESC protocol.
          </p>
        )}
        {wide && (
          <button
            type="button"
            onClick={() => setClosed(!closed)}
            aria-label={t(open ? 'shell.closeSidebar' : 'shell.openSidebar')}
            aria-expanded={open}
            title={t(open ? 'shell.closeSidebar' : 'shell.openSidebar')}
            className="focus-ring flex size-11 items-center justify-center rounded-lg text-faint transition-colors hover:bg-text/[0.06] hover:text-text"
          >
            <Toggle className="size-[18px]" strokeWidth={1.8} aria-hidden />
          </button>
        )}
      </div>
    </aside>
  )
}

function SideLink({ item, open }: { item: NavItem; open: boolean }) {
  const Icon = item.icon
  const under = useOwned(item)
  const t = useT()
  const label = t(item.label)
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === '/' }}
      aria-current={under ? 'page' : undefined}
      title={open ? undefined : label}
      className={cx(
        'group focus-ring flex h-10 items-center gap-3 rounded-lg px-[13px] text-[13.5px] font-medium text-muted transition-colors hover:bg-text/[0.05] hover:text-text',
        'data-[status=active]:bg-text/[0.08] data-[status=active]:text-text',
        under && 'bg-text/[0.08] text-text',
      )}
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={1.8} aria-hidden />
      <span className={cx('whitespace-nowrap transition-opacity', !open && 'opacity-0')}>{label}</span>
    </Link>
  )
}

function TabLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  const under = useOwned(item)
  const t = useT()
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === '/' }}
      aria-current={under ? 'page' : undefined}
      onClick={() => haptic(5)}
      className={cx(
        'group focus-ring flex min-w-0 flex-col items-center justify-center gap-1 text-faint transition-colors active:opacity-60 data-[status=active]:text-text',
        under && 'text-text',
      )}
    >
      <span
        className={cx(
          'flex h-7 w-12 items-center justify-center rounded-full transition-colors group-data-[status=active]:bg-text/10',
          under && 'bg-text/10',
        )}
      >
        <Icon className="size-[20px]" strokeWidth={1.8} aria-hidden />
      </span>
      <span className="max-w-full truncate text-[10px] leading-none font-medium">{t(item.label)}</span>
    </Link>
  )
}
