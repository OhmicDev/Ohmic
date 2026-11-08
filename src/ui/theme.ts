// Light and dark themes. The choice is stored in settings; 'system' follows the
// device. index.html applies the stored theme before the first paint, so the page
// doesn't flash dark on a light phone.

import { useEffect, useSyncExternalStore } from 'react'
import { darken } from '../lib/color'
import { useSettings, type ThemePref } from '../state/settings'

export type Theme = 'dark' | 'light'

/** How much of the accent the light theme keeps: 4.5:1 or better on every light surface for all accents. */
export const LIGHT_ACCENT_KEEP = 0.55

const BG: Record<Theme, string> = { dark: '#05070a', light: '#f4f6f8' }

const query = () => (typeof window === 'undefined' ? null : window.matchMedia?.('(prefers-color-scheme: light)'))

function subscribe(cb: () => void) {
  const q = query()
  q?.addEventListener('change', cb)
  return () => q?.removeEventListener('change', cb)
}
const systemLight = () => query()?.matches ?? false

export function resolveTheme(pref: ThemePref, prefersLight: boolean): Theme {
  return pref === 'system' ? (prefersLight ? 'light' : 'dark') : pref
}

/** The theme in effect now. */
export function useTheme(): Theme {
  const pref = useSettings((s) => s.theme)
  const light = useSyncExternalStore(subscribe, systemLight, () => false)
  return resolveTheme(pref, light)
}

/** The accent as drawn: the user's colour, darkened on the light theme. */
export function accentFor(theme: Theme, accent: string): string {
  return theme === 'light' ? darken(accent, LIGHT_ACCENT_KEEP) : accent
}

/** Applies the theme and accent to the page. Used once, by the app shell. */
export function useApplyTheme() {
  const theme = useTheme()
  const accent = useSettings((s) => s.accent)
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.style.setProperty('--accent', accentFor(theme, accent))
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BG[theme])
  }, [theme, accent])
  return theme
}

/** A CSS custom property's current value, for drawing on canvas (charts). */
export function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** Axis styling for uPlot charts, read from the current theme. */
export function chartAxis() {
  return {
    stroke: cssVar('--chart-axis', '#8b96a4'),
    font: '11px "JetBrains Mono Variable", ui-monospace, monospace',
    grid: { stroke: cssVar('--chart-grid', 'rgba(255,255,255,0.055)'), width: 1 },
    ticks: { stroke: cssVar('--chart-tick', 'rgba(255,255,255,0.08)'), width: 1, size: 4 },
  }
}
