import { targetKey, type DeviceInfo } from '../../state/devices'

/** The picked device if it's still in the list, else the first one. */
export function pickTarget(devices: DeviceInfo[], key: string): DeviceInfo | null {
  return devices.find((d) => targetKey(d.target) === key) ?? devices[0] ?? null
}
