// The app's service worker: whether a new version is waiting, whether the app
// works offline yet, and whether the device is online. A new version is never
// switched to on its own: reloading mid-write could leave a controller half
// written, so the user picks the moment.

import { create } from 'zustand'

interface PwaState {
  /** A new version is downloaded and waiting. */
  needRefresh: boolean
  /** Everything the app needs offline is cached. */
  offlineReady: boolean
  online: boolean
  update: () => Promise<void>
  dismiss: () => void
}

let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null

export const usePwa = create<PwaState>()((set) => ({
  needRefresh: false,
  offlineReady: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  update: async () => {
    if (applyUpdate) await applyUpdate(true)
    else location.reload()
  },
  dismiss: () => set({ needRefresh: false, offlineReady: false }),
}))

export async function startPwa() {
  if (typeof window === 'undefined') return
  window.addEventListener('online', () => usePwa.setState({ online: true }))
  window.addEventListener('offline', () => usePwa.setState({ online: false }))
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  try {
    const { registerSW } = await import('virtual:pwa-register')
    applyUpdate = registerSW({
      immediate: true,
      onNeedRefresh: () => usePwa.setState({ needRefresh: true }),
      onOfflineReady: () => usePwa.setState({ offlineReady: true }),
      onRegisteredSW: (_url, reg) => {
        // Look for a new version every hour while the app stays open.
        if (reg) setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000)
      },
    })
  } catch {
    // No service worker (private window, blocked): the app still works online.
  }
}
