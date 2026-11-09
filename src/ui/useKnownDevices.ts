import { useEffect, useState } from 'react'
import { BleTransport } from '../transport/BleTransport'
import { SerialTransport } from '../transport/SerialTransport'

/**
 * Devices this site was allowed to use before, so they can be connected in one
 * tap without the browser's picker. USB ports refresh as cables come and go.
 */
export function useKnownDevices(enabled: boolean) {
  const [ports, setPorts] = useState<SerialPort[]>([])
  const [ble, setBle] = useState<BluetoothDevice[]>([])

  useEffect(() => {
    if (!enabled) return
    let live = true
    const refresh = () => {
      SerialTransport.granted()
        .then((p) => live && setPorts(p))
        .catch(() => {})
      void BleTransport.granted().then((d) => live && setBle(d))
    }
    refresh()
    const serial = 'serial' in navigator ? navigator.serial : undefined
    serial?.addEventListener('connect', refresh)
    serial?.addEventListener('disconnect', refresh)
    return () => {
      live = false
      serial?.removeEventListener('connect', refresh)
      serial?.removeEventListener('disconnect', refresh)
    }
  }, [enabled])

  return { ports, ble }
}
