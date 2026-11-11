/** A short tap of the phone's vibration motor, where the browser allows it (Android). Nothing elsewhere. */
export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not allowed here */
  }
}
