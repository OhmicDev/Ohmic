// How fast the little wheels in the dashboard corner turn.
//
// A real wheel at riding speed turns about ten times a second, far too fast to draw: the
// spokes would strobe and seem to stand still or run backwards. The drawing turns in
// proportion to road speed instead, up to a cap.

import { speedKmh, type VehicleSetup } from '../../lib/vehicle'

/** A wheel slower than this is drawn standing still (km/h). */
export const STILL_KMH = 0.5
/** Degrees per second the drawing turns for each km/h. */
export const DEG_PER_KMH = 20
/** Above this speed the drawing turns no faster (km/h). */
export const MAX_SPIN_KMH = 45
/** Spokes in the drawing, evenly spaced. */
export const SPOKES = 5

/** Degrees per second for the drawing; negative turns it backwards. */
export function spinRate(kmh: number): number {
  if (!Number.isFinite(kmh) || Math.abs(kmh) < STILL_KMH) return 0
  return Math.sign(kmh) * Math.min(Math.abs(kmh), MAX_SPIN_KMH) * DEG_PER_KMH
}

/**
 * Road speed of one controller's wheel (km/h, negative backwards): from that controller's own
 * wheel settings once they're read, else from the vehicle setup.
 */
export function wheelKmh(erpm: number, metresPerSecondPerErpm: number, vehicle: VehicleSetup): number {
  if (Number.isFinite(metresPerSecondPerErpm) && metresPerSecondPerErpm > 0) return erpm * metresPerSecondPerErpm * 3.6
  return speedKmh(erpm, vehicle)
}
