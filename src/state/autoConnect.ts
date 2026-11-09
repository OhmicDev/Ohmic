// When the app opens: the Connect sheet comes up by itself, and the last device is
// reconnected without the browser's picker where the browser allows it (like VESC Tool
// reconnecting on start). Browsers only open their device picker from a tap, so a device
// they don't remember still takes one tap.

import { create } from 'zustand'
import { BleTransport } from '../transport/BleTransport'
import { SerialTransport } from '../transport/SerialTransport'
import { useSession } from './session'
import { useSettings } from './settings'

/** How long to look for the last Bluetooth device before leaving it to the rider. */
export const LOOK_MS = 20_000

type AutoPhase = 'idle' | 'looking' | 'missing'

interface ConnectSheetState {
  open: boolean
  /** Looking for the last Bluetooth device, or it wasn't found. */
  phase: AutoPhase
  /** The device being looked for. */
  name: string | null
  show: () => void
  hide: () => void
}

let looking: AbortController | null = null

export const useConnectSheet = create<ConnectSheetState>()((set) => ({
  open: false,
  phase: 'idle',
  name: null,
  show: () => set({ open: true }),
  hide: () => {
    stopLooking()
    set({ open: false })
  },
}))

/** Stops waiting for the last device (the rider picked another way, or closed the sheet). */
export function stopLooking() {
  looking?.abort()
  looking = null
  if (useConnectSheet.getState().phase === 'looking') useConnectSheet.setState({ phase: 'idle' })
}

/**
 * Reconnects to the last device without a picker, if the browser still allows this site to
 * use it: a USB port that's plugged in, or a Bluetooth device once it's in range.
 * Returns whether a connection was started.
 */
export async function autoConnect(): Promise<boolean> {
  const { lastConnection: last, autoConnect: on } = useSettings.getState()
  if (!on || !last || useSession.getState().status !== 'idle') return false

  if (last.kind === 'serial') {
    const ports = await SerialTransport.granted().catch(() => [])
    // Only when it's unambiguous: one remembered port, plugged in now.
    if (ports.length !== 1 || useSession.getState().status !== 'idle') return false
    await useSession.getState().connectPort(ports[0])
    return true
  }

  const devices = await BleTransport.granted()
  const device = devices.find((d) => (last.id ? d.id === last.id : d.name === last.name))
  if (!device) return false

  stopLooking()
  const ac = new AbortController()
  looking = ac
  useConnectSheet.setState({ phase: 'looking', name: device.name || last.name })
  const found = await inRange(device, ac.signal, LOOK_MS)
  if (looking === ac) looking = null
  if (ac.signal.aborted || useSession.getState().status !== 'idle') return false
  if (!found) {
    useConnectSheet.setState({ phase: 'missing' })
    return false
  }
  useConnectSheet.setState({ phase: 'idle' })
  await useSession.getState().connectBleDevice(device)
  return true
}

/**
 * Waits until the device advertises nearby. Browsers that can't watch advertisements
 * answer straight away, and the connection attempt itself finds out.
 */
function inRange(device: BluetoothDevice, signal: AbortSignal, ms: number): Promise<boolean> {
  if (typeof device.watchAdvertisements !== 'function') return Promise.resolve(true)
  const watch = new AbortController()
  return new Promise<boolean>((resolve) => {
    const done = (found: boolean) => {
      clearTimeout(timer)
      device.removeEventListener('advertisementreceived', heard)
      signal.removeEventListener('abort', cancel)
      watch.abort()
      resolve(found)
    }
    const heard = () => done(true)
    const cancel = () => done(false)
    const timer = setTimeout(() => done(false), ms)
    device.addEventListener('advertisementreceived', heard)
    signal.addEventListener('abort', cancel)
    // Some browsers have the method but refuse it; then just try connecting.
    device.watchAdvertisements({ signal: watch.signal }).catch(() => done(true))
  })
}
