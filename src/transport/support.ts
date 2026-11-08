// What this browser can do, so the UI can explain it instead of failing.

export interface BrowserSupport {
  serial: boolean
  bluetooth: boolean
  secureContext: boolean
  platform: 'ios' | 'android' | 'desktop'
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
  }
}

export function supportMessage(kind: 'serial' | 'bluetooth', s: BrowserSupport): string | null {
  if (!s.secureContext) return 'Needs a secure (https) page.'
  if (kind === 'serial' && !s.serial) {
    if (s.platform === 'ios') return "iPhone and iPad browsers can't use USB devices."
    if (s.platform === 'android') return 'USB is limited on Android. Use Bluetooth instead.'
    return "This browser can't use USB devices. Try Chrome or Edge."
  }
  if (kind === 'bluetooth' && !s.bluetooth) {
    if (s.platform === 'ios') return 'Safari has no Web Bluetooth. A Bluetooth-capable browser such as Bluefy works.'
    return "This browser can't use Bluetooth devices. Try Chrome or Edge."
  }
  return null
}
