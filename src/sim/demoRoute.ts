// The demo scooter's GPS: a loop on an open field (Tempelhofer Feld, Berlin),
// so the route looks believable on a real map. Position follows the distance
// the simulator has travelled.

const CENTER = { lat: 52.4738, lon: 13.4032 }
const M_PER_DEG_LAT = 111_320
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((CENTER.lat * Math.PI) / 180)
const STEPS = 720

// Points in metres east (x) and north (y) of the centre, and the distance to each.
const xs: number[] = []
const ys: number[] = []
const along: number[] = [0]
for (let i = 0; i <= STEPS; i++) {
  const a = (i / STEPS) * 2 * Math.PI
  xs.push(520 * Math.cos(a) * (1 + 0.07 * Math.sin(3 * a)))
  ys.push(300 * Math.sin(a) * (1 + 0.06 * Math.cos(2 * a)))
  if (i > 0) along.push(along[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]))
}

/** Length of one lap (m). */
const ROUTE_LENGTH_M = along[STEPS]

export interface DemoFix {
  lat: number
  lon: number
  /** m */
  alt: number
  /** m */
  accuracy: number
}

export function demoPositionAt(distanceM: number): DemoFix {
  const s = ((distanceM % ROUTE_LENGTH_M) + ROUTE_LENGTH_M) % ROUTE_LENGTH_M
  let lo = 0
  let hi = STEPS
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (along[mid] <= s) lo = mid
    else hi = mid
  }
  const f = (s - along[lo]) / (along[hi] - along[lo] || 1)
  const x = xs[lo] + (xs[hi] - xs[lo]) * f
  const y = ys[lo] + (ys[hi] - ys[lo]) * f
  return {
    lat: CENTER.lat + y / M_PER_DEG_LAT,
    lon: CENTER.lon + x / M_PER_DEG_LON,
    alt: 46 + 1.5 * Math.sin((2 * Math.PI * s) / ROUTE_LENGTH_M),
    accuracy: 4,
  }
}
