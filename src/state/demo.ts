// The simulated scooter isn't offered to riders. Tests and development open it by adding
// ?demo to the address; it stays available for the rest of that tab's visit.

const KEY = 'ohmic.demo'

export function demoAllowed(): boolean {
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')) sessionStorage.setItem(KEY, '1')
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
