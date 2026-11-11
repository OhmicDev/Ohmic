import { useEffect } from 'react'

/**
 * Keeps the screen on while `on`, where the browser supports it. The browser lets go of the
 * lock whenever the page is hidden, so it's asked for again each time the page comes back.
 */
export function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let done = false
    const ask = async () => {
      if (done || lock || document.visibilityState !== 'visible') return
      try {
        const l = await navigator.wakeLock.request('screen')
        if (done) return void l.release()
        lock = l
        l.addEventListener('release', () => {
          if (lock === l) lock = null
        })
      } catch {
        /* refused, e.g. in battery saver */
      }
    }
    void ask()
    document.addEventListener('visibilitychange', ask)
    return () => {
      done = true
      document.removeEventListener('visibilitychange', ask)
      void lock?.release()
    }
  }, [on])
}
