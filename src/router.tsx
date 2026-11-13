import { createRootRoute, createRoute, createRouter, lazyRouteComponent, redirect } from '@tanstack/react-router'
import { ConnectPage } from './pages/ConnectPage'
import { MorePage } from './pages/MorePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { RidePage } from './pages/RidePage'
import { WelcomePage } from './pages/WelcomePage'
import { useSettings } from './state/settings'
import { AppShell } from './ui/AppShell'

let opened = false

/** Opened from the home screen, as an installed app: the front page is for the browser. */
const installed = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFoundPage,
  // Opening the app at its home address the first time shows the front page. Once the app was
  // opened from it, home goes straight to Ride; links into the app always go where they point.
  beforeLoad: ({ location, preload }) => {
    if (preload) return
    const first = !opened
    opened = true
    if (first && location.pathname === '/' && !useSettings.getState().seenWelcome && !installed()) throw redirect({ to: '/welcome' })
  },
})

const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/live',
  component: lazyRouteComponent(() => import('./pages/live/LiveLayout'), 'LiveLayout'),
})

const liveChildren = [
  createRoute({ getParentRoute: () => liveRoute, path: '/', component: lazyRouteComponent(() => import('./pages/live/SignalsPage'), 'SignalsPage') }),
  createRoute({ getParentRoute: () => liveRoute, path: '/faults', component: lazyRouteComponent(() => import('./pages/live/FaultsPage'), 'FaultsPage') }),
  createRoute({ getParentRoute: () => liveRoute, path: '/terminal', component: lazyRouteComponent(() => import('./pages/live/TerminalPage'), 'TerminalPage') }),
]

const routeTree = rootRoute.addChildren([
  liveRoute.addChildren(liveChildren),
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: RidePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/connect', component: ConnectPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/welcome', component: WelcomePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/features', component: lazyRouteComponent(() => import('./pages/ride/FeaturesPage'), 'FeaturesPage') }),
  // The Tune tab is every setting (Config); old links to /tune land there.
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/tune',
    beforeLoad: () => {
      throw redirect({ to: '/config', replace: true })
    },
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/config', component: lazyRouteComponent(() => import('./pages/config/ConfigPage'), 'ConfigPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/config/backups', component: lazyRouteComponent(() => import('./pages/config/BackupsPage'), 'BackupsPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/more', component: MorePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/setup', component: lazyRouteComponent(() => import('./pages/setup/SetupPage'), 'SetupPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/setup/motor', component: lazyRouteComponent(() => import('./pages/setup/DetectWizard'), 'DetectWizard') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/setup/input', component: lazyRouteComponent(() => import('./pages/setup/InputWizard'), 'InputWizard') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/setup/direction', component: lazyRouteComponent(() => import('./pages/setup/DirectionWizard'), 'DirectionWizard') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/setup/battery', component: lazyRouteComponent(() => import('./pages/setup/BatteryWizard'), 'BatteryWizard') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/modes', component: lazyRouteComponent(() => import('./pages/ride/RideModesPage'), 'RideModesPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/abs', component: lazyRouteComponent(() => import('./pages/ride/AbsPage'), 'AbsPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/regen', component: lazyRouteComponent(() => import('./pages/ride/RegenPage'), 'RegenPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/wheelie', component: lazyRouteComponent(() => import('./pages/ride/WheeliePage'), 'WheeliePage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/sounds', component: lazyRouteComponent(() => import('./pages/ride/SoundsPage'), 'SoundsPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/control', component: lazyRouteComponent(() => import('./pages/tools/MotorControlPage'), 'MotorControlPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/firmware', component: lazyRouteComponent(() => import('./pages/tools/FirmwarePage'), 'FirmwarePage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/logs', component: lazyRouteComponent(() => import('./pages/logs/LogsPage'), 'LogsPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/logs/$rideId', component: lazyRouteComponent(() => import('./pages/logs/RideDetailPage'), 'RideDetailPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/lisp', component: lazyRouteComponent(() => import('./pages/tools/LispPage'), 'LispPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/packages', component: lazyRouteComponent(() => import('./pages/tools/PackagesPage'), 'PackagesPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/bms', component: lazyRouteComponent(() => import('./pages/tools/BmsPage'), 'BmsPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/imu', component: lazyRouteComponent(() => import('./pages/tools/ImuPage'), 'ImuPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/can', component: lazyRouteComponent(() => import('./pages/tools/CanPage'), 'CanPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: lazyRouteComponent(() => import('./pages/more/SettingsPage'), 'SettingsPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/dev/protocol', component: lazyRouteComponent(() => import('./pages/more/ProtocolLogPage'), 'ProtocolLogPage') }),
  createRoute({ getParentRoute: () => rootRoute, path: '/calc', component: lazyRouteComponent(() => import('./pages/tools/CalculatorsPage'), 'CalculatorsPage') }),
])

// The app may live in a sub-folder (GitHub Pages); links and routes are relative to it.
// Moving between pages crossfades, where the browser can (see index.css).
export const router = createRouter({ routeTree, defaultPreload: 'intent', defaultViewTransition: true, basepath: import.meta.env.BASE_URL })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
