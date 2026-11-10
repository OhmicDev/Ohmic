import { useSyncExternalStore } from 'react'

/** True while the media query matches. False where matchMedia is missing (tests in Node). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia?.(query)
      m?.addEventListener('change', onChange)
      return () => m?.removeEventListener('change', onChange)
    },
    () => !!window.matchMedia?.(query).matches,
    () => false,
  )
}

/** The phone layout, with the tab bar along the bottom: anything narrower than Tailwind's md. */
export const useIsPhone = () => useMediaQuery('(max-width: 47.99rem)')
