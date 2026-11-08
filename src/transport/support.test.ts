import { describe, expect, it } from 'vitest'
import { BLUEFY_URL, bluetoothHelp, chromeIntentUrl, detectBrowser, supportMessage, type BrowserSupport } from './support'

const UA = {
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
  edgeDesktop:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
}

const at = (s: Partial<BrowserSupport>): BrowserSupport => ({
  serial: false,
  bluetooth: false,
  secureContext: true,
  platform: 'desktop',
  browser: 'chrome',
  ...s,
})

describe('browser support', () => {
  it('names the browser from its user agent', () => {
    expect(detectBrowser(UA.chromeAndroid)).toBe('chrome')
    expect(detectBrowser(UA.samsung)).toBe('samsung')
    expect(detectBrowser(UA.firefoxAndroid)).toBe('firefox')
    expect(detectBrowser(UA.safariIphone)).toBe('safari')
    expect(detectBrowser(UA.chromeIphone)).toBe('chrome')
    expect(detectBrowser(UA.edgeDesktop)).toBe('edge')
    expect(detectBrowser(UA.opera)).toBe('opera')
  })

  it('has nothing to say when Bluetooth works', () => {
    expect(bluetoothHelp(at({ bluetooth: true, platform: 'android' }), 'https://x.test/')).toBeNull()
    expect(supportMessage('bluetooth', at({ bluetooth: true }))).toBeNull()
  })

  it('points iPhones to Bluefy, since no other iOS browser has Bluetooth', () => {
    const help = bluetoothHelp(at({ platform: 'ios', browser: 'safari' }), 'https://x.test/')!
    expect(help.text).toMatch(/Bluefy/)
    expect(help.actions.map((a) => a.href)).toEqual([BLUEFY_URL, 'copy'])
  })

  it('offers to reopen the page in Chrome on Android', () => {
    const help = bluetoothHelp(at({ platform: 'android', browser: 'firefox' }), 'https://ohmicdev.github.io/Ohmic/connect?x=1')!
    expect(help.actions[0].href).toBe('intent://ohmicdev.github.io/Ohmic/connect?x=1#Intent;scheme=https;package=com.android.chrome;end')
    expect(help.actions[1].href).toBe('copy')
  })

  it('names the desktop browser that lacks Bluetooth', () => {
    expect(bluetoothHelp(at({ browser: 'firefox' }), 'https://x.test/')!.text).toMatch(/^Firefox can’t/)
    expect(bluetoothHelp(at({ browser: 'safari' }), 'https://x.test/')!.text).toMatch(/^Safari can’t/)
  })

  it('asks for https before anything else', () => {
    expect(bluetoothHelp(at({ secureContext: false, bluetooth: true }), 'http://x.test/')!.text).toMatch(/https/)
  })

  it('builds Chrome intent links for any page', () => {
    expect(chromeIntentUrl('http://localhost:5173/')).toBe('intent://localhost:5173/#Intent;scheme=http;package=com.android.chrome;end')
  })
})
