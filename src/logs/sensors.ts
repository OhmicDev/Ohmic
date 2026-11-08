// The phone's own sensors for ride logs: GPS (Geolocation API), motion
// (DeviceOrientation / DeviceMotion), and a screen wake lock so the phone
// keeps the Bluetooth link alive while recording.

export interface GpsFix {
  lat: number
  lon: number
  alt: number
  /** km/h; NaN when the phone doesn't say. */
  speedKmh: number
  /** m */
  accuracy: number
  /** When it arrived (ms, Date.now()). */
  at: number
}

export type GpsStatus = 'off' | 'waiting' | 'ok' | 'denied' | 'unavailable' | 'simulated'

export const GPS_STATUS_TEXT: Record<GpsStatus, string> = {
  off: 'GPS off',
  waiting: 'Finding your position…',
  ok: 'GPS on',
  denied: 'Location permission was refused. Allow it in the browser’s site settings to record a map.',
  unavailable: 'This device can’t give a position, so the ride is recorded without a map.',
  simulated: 'Simulated GPS (demo)',
}

/** Watches the phone's position. Call the returned function to stop. */
export function watchGps(onFix: (f: GpsFix) => void, onStatus: (s: GpsStatus) => void): () => void {
  const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined
  if (!geo) {
    onStatus('unavailable')
    return () => {}
  }
  onStatus('waiting')
  const id = geo.watchPosition(
    (p) => {
      const c = p.coords
      onFix({
        lat: c.latitude,
        lon: c.longitude,
        alt: c.altitude ?? NaN,
        speedKmh: c.speed === null || c.speed === undefined ? NaN : c.speed * 3.6,
        accuracy: c.accuracy,
        at: Date.now(),
      })
      onStatus('ok')
    },
    (e) => {
      // A timeout just means no fix yet (indoors); keep waiting.
      if (e.code === e.PERMISSION_DENIED) onStatus('denied')
      else if (e.code === e.POSITION_UNAVAILABLE) onStatus('unavailable')
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20_000 },
  )
  return () => geo.clearWatch(id)
}

export interface PhoneMotion {
  /** ° */
  roll: number
  pitch: number
  yaw: number
  /** g */
  accX: number
  accY: number
  accZ: number
  at: number
}

type PermissionFn = () => Promise<'granted' | 'denied'>

/**
 * iPhones only give motion data after asking, and the asking must happen
 * straight from a tap. Resolves false if refused or not offered.
 */
export async function askMotionPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return false
  const ask = (window.DeviceOrientationEvent as unknown as { requestPermission?: PermissionFn }).requestPermission
  if (typeof ask !== 'function') return true
  try {
    return (await ask()) === 'granted'
  } catch {
    return false
  }
}

/** Follows the phone's orientation and acceleration. Call the returned function to stop. */
export function watchPhoneMotion(onData: (m: PhoneMotion) => void): () => void {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return () => {}
  const m: PhoneMotion = { roll: NaN, pitch: NaN, yaw: NaN, accX: NaN, accY: NaN, accZ: NaN, at: 0 }
  const orient = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return
    m.pitch = e.beta
    m.roll = e.gamma
    m.yaw = e.alpha ?? NaN
    m.at = Date.now()
    onData({ ...m })
  }
  const motion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity
    if (!a || a.x === null || a.y === null || a.z === null) return
    m.accX = a.x / 9.80665
    m.accY = a.y / 9.80665
    m.accZ = a.z / 9.80665
  }
  window.addEventListener('deviceorientation', orient)
  window.addEventListener('devicemotion', motion)
  return () => {
    window.removeEventListener('deviceorientation', orient)
    window.removeEventListener('devicemotion', motion)
  }
}

/**
 * Keeps the screen on while recording, so the browser doesn't suspend the page
 * and drop the Bluetooth link. Taken again when the page comes back into view.
 */
export function holdWakeLock(): () => void {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator) || typeof document === 'undefined') return () => {}
  let lock: WakeLockSentinel | null = null
  let done = false
  const take = async () => {
    if (done || document.visibilityState !== 'visible' || (lock && !lock.released)) return
    try {
      lock = await navigator.wakeLock.request('screen')
    } catch {
      // Refused (battery saver, or not allowed): recording still works while the screen is on.
    }
  }
  const onVisible = () => void take()
  document.addEventListener('visibilitychange', onVisible)
  void take()
  return () => {
    done = true
    document.removeEventListener('visibilitychange', onVisible)
    void lock?.release().catch(() => {})
  }
}
