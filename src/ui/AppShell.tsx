import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { Activity, Ellipsis, Gauge, SlidersHorizontal, Wrench, type LucideIcon } from 'lucide-react'
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
import { Logo } from './Logo'
import { Onboarding } from './Onboarding'
import { TILE } from './rowStyles'
import { useApplyTheme } from './theme'

type NavItem = {
  to: '/' | '/setup' | '/live' | '/tune' | '/more'
  label: MessageKey
  icon: LucideIcon
  /** The icon's coloured square in the sidebar, like macOS settings. */
  tile: string
  /** Other pages that belong to this tab, so it stays highlighted on them. */
  owns?: string[]
}

const NAV: NavItem[] = [
  { to: '/', label: 'nav.ride', icon: Gauge, tile: TILE.blue },
  { to: '/setup', label: 'nav.setup', icon: Wrench, tile: TILE.grey },
  { to: '/live', label: 'nav.live', icon: Activity, tile: TILE.green },
  { to: '/tune', label: 'nav.tune', icon: SlidersHorizontal, tile: TILE.purple, owns: ['/config', '/modes', '/abs', '/regen'] },
  {
    to: '/more',
    label: 'nav.more',
    icon: Ellipsis,
    tile: TILE.orange,
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

      {/* Sidebar on wide screens (like macOS), an icon rail on tablets. */}
      <aside className="glass sticky top-0 z-30 hidden h-dvh w-[76px] shrink-0 flex-col border-r border-line md:flex lg:w-[232px]">
        <Link
          to="/"
          className="focus-ring mx-auto mt-4 mb-5 flex items-center gap-2.5 rounded-[10px] lg:mx-4 lg:mt-5 lg:mb-6"
          aria-label={t('shell.home', { app: APP_NAME })}
        >
          <Logo size={30} />
          <span className="wide hidden text-[17px] font-bold lg:inline">{APP_NAME}</span>
        </Link>
        <nav aria-label={t('nav.main')} className="flex flex-col gap-0.5 px-2 lg:px-3">
          {NAV.map((item) => (
            <SideLink key={item.to} item={item} />
          ))}
        </nav>
        <p className="mt-auto hidden px-5 pb-4 text-[11px] leading-relaxed text-faint lg:block">
          <Link to="/welcome" className="focus-ring rounded hover:text-text">
            About {APP_NAME} {APP_VERSION}
          </Link>
          <br />
          Built on the open VESC protocol.
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-line px-4 md:h-14 md:px-6 lg:px-8">
          <Link to="/" className="focus-ring flex items-center gap-2 rounded-lg lg:hidden">
            <span className="md:hidden">
              <Logo size={24} />
            </span>
            {/* On narrow phones the device switcher needs the room; the logo stays. */}
            <span className={cx('wide text-[15px] font-bold', hasSwitcher && 'max-[419px]:sr-only')}>{APP_NAME}</span>
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
          className="relative isolate flex-1 px-4 pt-4 pb-[calc(72px+env(safe-area-inset-bottom))] outline-none md:px-6 md:pt-6 md:pb-10 lg:px-8"
        >
          <div className="mx-auto w-full max-w-[1200px]">
            <Outlet />
          </div>
        </main>
      </div>

      <UpdateToast />
      <Onboarding />
      <ConnectSheet />

      <nav aria-label={t('nav.main')} className="glass fixed inset-x-0 bottom-0 z-30 border-t border-line pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="mx-auto grid h-14 max-w-lg grid-cols-5">
          {NAV.map((item) => (
            <TabLink key={item.to} item={item} />
          ))}
        </div>
      </nav>
    </div>
  )
}

function SideLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  const under = useOwned(item)
  const t = useT()
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === '/' }}
      aria-current={under ? 'page' : undefined}
      className={cx(
        'focus-ring flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-muted transition-colors hover:bg-text/5 hover:text-text lg:flex-row lg:gap-2.5 lg:px-2 lg:py-1.5',
        'data-[status=active]:bg-accent/15 data-[status=active]:text-text',
        under && 'bg-accent/15 text-text',
      )}
    >
      <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-[9px] text-white lg:size-6 lg:rounded-[6px]', item.tile)}>
        <Icon className="size-[17px] lg:size-[15px]" strokeWidth={2.1} aria-hidden />
      </span>
      <span className="text-[10.5px] font-medium lg:text-[13px]">{t(item.label)}</span>
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
      className={cx(
        'focus-ring flex flex-col items-center justify-center gap-0.5 text-faint transition-colors active:opacity-60 data-[status=active]:text-accent',
        under && 'text-accent',
      )}
    >
      <Icon className="size-[22px]" strokeWidth={1.9} aria-hidden />
      <span className="text-[10px] font-medium">{t(item.label)}</span>
    </Link>
  )
}
