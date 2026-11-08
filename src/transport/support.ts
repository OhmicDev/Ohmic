// What this browser can do, so the UI can explain it and point to one that works
// instead of failing.

export type Platform = 'ios' | 'android' | 'desktop'
export type BrowserName = 'chrome' | 'edge' | 'samsung' | 'opera' | 'firefox' | 'safari' | 'other'

export interface BrowserSupport {
  serial: boolean
  bluetooth: boolean
  secureContext: boolean
  platform: Platform
  browser: BrowserName
}

/** Bluefy: a free iPhone and iPad browser with Web Bluetooth (every other iOS browser lacks it). */
export const BLUEFY_URL = 'https://apps.apple.com/app/id1492822055'

export function detectBrowser(ua: string): BrowserName {
  if (/SamsungBrowser/i.test(ua)) return 'samsung'
  if (/EdgA?\/|EdgiOS/i.test(ua)) return 'edge'
  if (/OPR\/|Opera|OPT\//i.test(ua)) return 'opera'
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox'
  if (/Chrome\/|CriOS/i.test(ua)) return 'chrome'
  if (/Safari\//i.test(ua)) return 'safari'
  return 'other'
}

export function detectSupport(): BrowserSupport {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const ua = nav?.userAgent ?? ''
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && (nav?.maxTouchPoints ?? 0) > 1)
  return {
    serial: !!nav && 'serial' in nav,
    bluetooth: !!nav && 'bluetooth' in nav,
    secureContext: typeof window !== 'undefined' && window.isSecureContext,
    platform: isIos ? 'ios' : /Android/i.test(ua) ? 'android' : 'desktop',
    browser: detectBrowser(ua),
  }
}

/** Opens a page in Chrome on Android, from any other browser. */
export function chromeIntentUrl(pageUrl: string): string {
  const u = new URL(pageUrl)
  return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;end`
}

export interface HelpAction {
  label: string
  /** A link to open, or 'copy' to copy the page address. */
  href: string | 'copy'
}

export interface Help {
  text: string
  actions: HelpAction[]
}

/** Why Bluetooth can't be used here and what to do about it, or null when it can. */
export function bluetoothHelp(s: BrowserSupport, pageUrl: string): Help | null {
  if (!s.secureContext) return { text: 'Bluetooth needs a secure (https) page.', actions: [] }
  if (s.bluetooth) return null
  if (s.platform === 'ios')
    return {
      text: 'iPhone and iPad browsers can’t use Bluetooth devices. Open this page in Bluefy, a free browser that can.',
      actions: [
        { label: 'Get Bluefy', href: BLUEFY_URL },
        { label: 'Copy link', href: 'copy' },
      ],
    }
  if (s.platform === 'android')
    return {
      text: 'This browser can’t use Bluetooth devices. Chrome, Edge and Samsung Internet can.',
      actions: [
        { label: 'Open in Chrome', href: chromeIntentUrl(pageUrl) },
        { label: 'Copy link', href: 'copy' },
      ],
    }
  return {
    text: `${s.browser === 'firefox' ? 'Firefox' : s.browser === 'safari' ? 'Safari' : 'This browser'} can’t use Bluetooth devices. Open this page in Chrome or Edge.`,
    actions: [{ label: 'Copy link', href: 'copy' }],
  }
}

export function supportMessage(kind: 'serial' | 'bluetooth', s: BrowserSupport): string | null {
  if (!s.secureContext) return 'Needs a secure (https) page.'
  if (kind === 'serial' && !s.serial) {
    if (s.platform === 'ios') return "iPhone and iPad browsers can't use USB devices."
    if (s.platform === 'android') return 'USB is limited on Android. Use Bluetooth instead.'
    return "This browser can't use USB devices. Try Chrome or Edge."
  }
  if (kind === 'bluetooth' && !s.bluetooth) return bluetoothHelp(s, 'https://localhost/')?.text ?? null
  return null
}
