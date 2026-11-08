import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { autoConnect, LOOK_MS, stopLooking, useConnectSheet } from './autoConnect'
import { useSession } from './session'
import { useSettings } from './settings'

/** A remembered Bluetooth device that can be made to advertise. */
class FakeDevice extends EventTarget {
  watching = false
  readonly id: string
  readonly name: string
  constructor(id: string, name: string) {
    super()
    this.id = id
    this.name = name
  }
  watchAdvertisements = vi.fn(async ({ signal }: { signal?: AbortSignal } = {}) => {
    this.watching = true
    signal?.addEventListener('abort', () => (this.watching = false))
  })
  advertise() {
    this.dispatchEvent(new Event('advertisementreceived'))
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('connecting when the app opens', () => {
  const connectBleDevice = vi.fn(async () => {})
  const connectPort = vi.fn(async () => {})
  let devices: FakeDevice[] = []

  beforeEach(() => {
    devices = []
    vi.stubGlobal('navigator', { bluetooth: { getDevices: async () => devices } })
    useSession.setState({ status: 'idle', connectBleDevice, connectPort } as never)
    useSettings.setState({ autoConnect: true, lastConnection: { kind: 'ble', name: 'VESC BLE UART', at: 1, id: 'dev-1' } })
    useConnectSheet.setState({ open: false, phase: 'idle', name: null })
    connectBleDevice.mockClear()
    connectPort.mockClear()
  })

  afterEach(() => {
    stopLooking()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('waits for the last Bluetooth device to show up, then connects to it without a picker', async () => {
    const dongle = new FakeDevice('dev-1', 'VESC BLE UART')
    devices = [new FakeDevice('other', 'Something else'), dongle]
    const done = autoConnect()
    await flush()
    expect(useConnectSheet.getState()).toMatchObject({ phase: 'looking', name: 'VESC BLE UART' })
    expect(connectBleDevice).not.toHaveBeenCalled()

    dongle.advertise()
    await expect(done).resolves.toBe(true)
    expect(connectBleDevice).toHaveBeenCalledWith(dongle)
    expect(useConnectSheet.getState().phase).toBe('idle')
    expect(dongle.watching).toBe(false)
  })

  it('says so when the device stays away, and leaves the choice to the rider', async () => {
    vi.useFakeTimers()
    devices = [new FakeDevice('dev-1', 'VESC BLE UART')]
    const done = autoConnect()
    await vi.advanceTimersByTimeAsync(LOOK_MS + 10)
    await expect(done).resolves.toBe(false)
    expect(useConnectSheet.getState().phase).toBe('missing')
    expect(connectBleDevice).not.toHaveBeenCalled()
  })

  it('stops looking when the rider picks something else', async () => {
    const dongle = new FakeDevice('dev-1', 'VESC BLE UART')
    devices = [dongle]
    const done = autoConnect()
    await flush()
    stopLooking()
    await expect(done).resolves.toBe(false)
    dongle.advertise()
    await flush()
    expect(connectBleDevice).not.toHaveBeenCalled()
    expect(useConnectSheet.getState().phase).toBe('idle')
  })

  it('does nothing when switched off, already connected, or the browser forgot the device', async () => {
    devices = [new FakeDevice('dev-1', 'VESC BLE UART')]
    useSettings.setState({ autoConnect: false })
    await expect(autoConnect()).resolves.toBe(false)

    useSettings.setState({ autoConnect: true })
    useSession.setState({ status: 'connected' } as never)
    await expect(autoConnect()).resolves.toBe(false)

    useSession.setState({ status: 'idle' } as never)
    devices = []
    await expect(autoConnect()).resolves.toBe(false)
    expect(useConnectSheet.getState().phase).toBe('idle')
    expect(connectBleDevice).not.toHaveBeenCalled()
  })

  it('tries straight away where the browser can’t watch for the device', async () => {
    const dongle = Object.assign(new EventTarget(), { id: 'dev-1', name: 'VESC BLE UART' })
    devices = [dongle as unknown as FakeDevice]
    await expect(autoConnect()).resolves.toBe(true)
    expect(connectBleDevice).toHaveBeenCalledWith(dongle)
  })
})
