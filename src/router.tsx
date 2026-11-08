import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from '@tanstack/react-router'
import { ConnectPage } from './pages/ConnectPage'
import { MorePage } from './pages/MorePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { RidePage } from './pages/RidePage'
import { AppShell } from './ui/AppShell'

const rootRoute = createRootRoute({ component: AppShell, notFoundComponent: NotFoundPage })

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
  createRoute({ getParentRoute: () => rootRoute, path: '/tune', component: lazyRouteComponent(() => import('./pages/tune/TunePage'), 'TunePage') }),
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
export const router = createRouter({ routeTree, defaultPreload: 'intent', basepath: import.meta.env.BASE_URL })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
