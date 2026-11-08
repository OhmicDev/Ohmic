import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { Activity, Ellipsis, Gauge, Sparkles, Wrench, type LucideIcon } from 'lucide-react'
import { useEffect } from 'react'
import { APP_NAME } from '../appInfo'
import { useT, type MessageKey } from '../i18n'
import { cx } from '../lib/format'
import { useSession } from '../state/session'
import { useSettings } from '../state/settings'
import { ConnectionChip } from './ConnectionChip'
import { DeviceSwitcher } from './DeviceSwitcher'
import { OfflineStrip, UpdateToast } from './AppNotices'
import { Logo } from './Logo'
import { Onboarding } from './Onboarding'
import { useApplyTheme } from './theme'

type NavItem = {
  to: '/' | '/setup' | '/live' | '/tune' | '/more'
  label: MessageKey
  icon: LucideIcon
  /** Other pages that belong to this tab, so it stays highlighted on them. */
  owns?: string[]
}

const NAV: NavItem[] = [
  { to: '/', label: 'nav.ride', icon: Gauge },
  { to: '/setup', label: 'nav.setup', icon: Wrench, owns: ['/config', '/modes', '/abs', '/regen'] },
  { to: '/live', label: 'nav.live', icon: Activity },
  { to: '/tune', label: 'nav.tune', icon: Sparkles },
  {
    to: '/more',
    label: 'nav.more',
    icon: Ellipsis,
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
  useApplyTheme()
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="skip-link focus-ring">
        {t('shell.skip')}
      </a>
      {/* Desktop / tablet rail */}
      <aside className="sticky top-0 hidden h-dvh w-[88px] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface/60 py-4 md:flex">
        <Link to="/" className="focus-ring mb-5 rounded-[10px]" aria-label={t('shell.home', { app: APP_NAME })}>
          <Logo size={34} />
        </Link>
        <nav aria-label={t('nav.main')} className="flex flex-col items-center gap-1">
          {NAV.map((item) => (
            <RailLink key={item.to} item={item} />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-bg/75 px-4 backdrop-blur-md md:px-8">
          <Link to="/" className="focus-ring flex items-center gap-2.5 rounded-lg md:pointer-events-none">
            <span className="md:hidden">
              <Logo size={26} />
            </span>
            {/* On narrow phones the device switcher needs the room; the logo stays. */}
            <span className={cx('wide text-[15px] font-bold tracking-tight', hasSwitcher && 'max-[419px]:sr-only')}>{APP_NAME}</span>
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <DeviceSwitcher />
            <ConnectionChip />
          </div>
        </header>
        <OfflineStrip />

        <main id="main" tabIndex={-1} className="relative isolate flex-1 px-4 pt-5 pb-28 outline-none md:px-8 md:pb-10">
          <div className="bg-dots pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px]" />
          <div className="mx-auto w-full max-w-[1200px]">
            <Outlet />
          </div>
        </main>
      </div>

      <UpdateToast />
      <Onboarding />

      {/* Phone tab bar */}
      <nav aria-label={t('nav.main')} className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {NAV.map((item) => (
            <TabLink key={item.to} item={item} />
          ))}
        </div>
      </nav>
    </div>
  )
}

function RailLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  const under = useOwned(item)
  const t = useT()
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === '/' }}
      aria-current={under ? 'page' : undefined}
      className={cx(
        'focus-ring group flex w-[72px] flex-col items-center gap-1.5 rounded-xl py-2.5 text-muted transition-colors hover:text-text data-[status=active]:text-text',
        under && 'text-text',
      )}
    >
      {({ isActive: active }) => {
        const isActive = active || under
        return (
          <>
            <span
              className={
                'flex size-10 items-center justify-center rounded-xl transition-colors ' +
                (isActive ? 'bg-accent/12 text-accent shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_35%,transparent)]' : 'group-hover:bg-surface-3')
              }
            >
              <Icon className="size-[19px]" strokeWidth={1.8} aria-hidden />
            </span>
            <span className="text-[10.5px] font-medium">{t(item.label)}</span>
          </>
        )
      }}
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
        'focus-ring flex flex-col items-center gap-1 pt-2.5 pb-2 text-muted transition-colors data-[status=active]:text-accent',
        under && 'text-accent',
      )}
    >
      {({ isActive: active }) => {
        const isActive = active || under
        return (
          <>
            <span className={'relative flex h-7 w-12 items-center justify-center rounded-full transition-colors ' + (isActive ? 'bg-accent/12' : '')}>
              <Icon className="size-[19px]" strokeWidth={1.8} aria-hidden />
            </span>
            <span className="text-[10.5px] font-medium">{t(item.label)}</span>
          </>
        )
      }}
    </Link>
  )
}
