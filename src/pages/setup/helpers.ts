import { useConfig, type DeviceConfig } from '../../state/config'

/** Every motor controller whose settings Ohmic knows about, in bus order. */
export function useMotorDevices(): DeviceConfig[] {
  const order = useConfig((s) => s.order)
  const devices = useConfig((s) => s.devices)
  return order.map((k) => devices[k]).filter(Boolean)
}

/** A typed number, or NaN when the field is empty. */
export const toNum = (s: string) => (s.trim() === '' ? NaN : Number(s))
