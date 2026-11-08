// Whether a controller's IMU is worth asking for. The config store fills this
// in (IMU type "off" in the app settings means no); without settings, try.
// Kept separate so the session doesn't import the config store (which imports it).

import type { DeviceInfo } from './devices'

let gate: (d: DeviceInfo) => boolean = () => true

export function setImuGate(fn: (d: DeviceInfo) => boolean) {
  gate = fn
}

export function imuAllowed(d: DeviceInfo): boolean {
  return gate(d)
}
