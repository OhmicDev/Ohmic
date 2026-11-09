// Bluetooth LE connection through the Web Bluetooth API, using the Nordic UART
// Service that VESC Express and the VESC BLE modules expose (bleuart.cpp in
// VESC Tool). Bytes go out on RX and come back as notifications on TX.

import { ConnectError, Emitter, type Transport } from './types'

export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
export const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e' // we write
export const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e' // we get notifications

/**
 * Phones often fail the first GATT connection or service lookup with a passing error
 * ("GATT operation failed for unknown reason"); a moment later it works. Tries this many times.
 */
const CONNECT_ATTEMPTS = 3
const RETRY_MS = 250

/** Write sizes offered in settings. 20 bytes fits every BLE link; VESC Express negotiates a larger MTU. */
const BLE_CHUNK_SIZES = [20, 128] as const
export type BleChunkSize = (typeof BLE_CHUNK_SIZES)[number]

/** The parts of `navigator.bluetooth` we use, so tests can pass a fake. */
export type BluetoothApi = Pick<Bluetooth, 'requestDevice'> & { getDevices?: () => Promise<BluetoothDevice[]> }

interface BleTransportOptions {
  chunkSize?: number
  connectTimeoutMs?: number
}

function defaultBluetooth(): BluetoothApi | undefined {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator ? navigator.bluetooth : undefined
}

export class BleTransport implements Transport {
  readonly kind = 'ble' as const
  readonly device: BluetoothDevice
  private chunk: number
  private readonly connectTimeoutMs: number
  private readonly data = new Emitter<Uint8Array>()
  private readonly lost = new Emitter<string>()
  private rx: BluetoothRemoteGATTCharacteristic | null = null
  private tx: BluetoothRemoteGATTCharacteristic | null = null
  private writing: Promise<void> = Promise.resolve()
  private connected = false
  private closing = false

  constructor(device: BluetoothDevice, opts: BleTransportOptions = {}) {
    this.device = device
    this.chunk = clampChunk(opts.chunkSize ?? 20)
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 12_000
    device.addEventListener('gattserverdisconnected', this.onGattDisconnected)
  }

  get label() {
    return this.device.name || 'Bluetooth device'
  }

  get chunkSize() {
    return this.chunk
  }

  set chunkSize(n: number) {
    this.chunk = clampChunk(n)
  }

  /** Opens the browser's device picker. By default only devices offering the VESC UART service are listed. */
  static async request(
    opts: BleTransportOptions & { anyDevice?: boolean; bluetooth?: BluetoothApi } = {},
  ): Promise<BleTransport> {
    const bt = opts.bluetooth ?? defaultBluetooth()
    if (!bt) throw new ConnectError("This browser can't use Bluetooth devices. Try Chrome or Edge.")
    const device = await bt.requestDevice(
      opts.anyDevice
        ? { acceptAllDevices: true, optionalServices: [NUS_SERVICE] }
        : { filters: [{ services: [NUS_SERVICE] }, { namePrefix: 'VESC' }], optionalServices: [NUS_SERVICE] },
    )
    return new BleTransport(device, opts)
  }

  /** Devices this site was allowed before. Only some browsers support this; others return none. */
  static async granted(bluetooth = defaultBluetooth()): Promise<BluetoothDevice[]> {
    if (!bluetooth?.getDevices) return []
    try {
      return await bluetooth.getDevices()
    } catch {
      return []
    }
  }

  async connect() {
    if (this.connected) return
    for (let attempt = 1; ; attempt++) {
      try {
        await this.connectOnce()
        return
      } catch (e) {
        if (attempt >= CONNECT_ATTEMPTS || !isPassing(e)) throw e
        await new Promise((r) => setTimeout(r, RETRY_MS * attempt))
      }
    }
  }

  private async connectOnce() {
    this.closing = false
    const gatt = this.device.gatt
    if (!gatt) throw new ConnectError("This device doesn't offer Bluetooth LE services.")

    let tx: BluetoothRemoteGATTCharacteristic | null = null
    try {
      const server = await withTimeout(gatt.connect(), this.connectTimeoutMs, () => gatt.disconnect())
      let service: BluetoothRemoteGATTService
      try {
        service = await server.getPrimaryService(NUS_SERVICE)
      } catch (e) {
        // Only a definite "not there" means it's the wrong device; anything else may pass.
        if (!(e instanceof Error) || e.name !== 'NotFoundError') throw e
        throw new ConnectError(
          `${this.label} doesn't have the VESC UART service. Pick a VESC Express or a VESC Bluetooth module.`,
        )
      }
      const rx = await service.getCharacteristic(NUS_RX)
      tx = await service.getCharacteristic(NUS_TX)
      tx.addEventListener('characteristicvaluechanged', this.onNotify)
      await tx.startNotifications()
      this.rx = rx
      this.tx = tx
      this.writing = Promise.resolve()
      this.connected = true
    } catch (e) {
      // Our own cleanup fires a disconnect event; don't report it as a drop.
      this.closing = true
      tx?.removeEventListener('characteristicvaluechanged', this.onNotify)
      try {
        gatt.disconnect()
      } catch {
        // Not connected.
      }
      throw e
    }
  }

  async disconnect() {
    this.closing = true
    const tx = this.tx
    this.release()
    if (tx) {
      try {
        await tx.stopNotifications()
      } catch {
        // The link may already be gone.
      }
    }
    try {
      this.device.gatt?.disconnect()
    } catch {
      // Not connected.
    }
  }

  /** Writes are queued so two never overlap (Web Bluetooth rejects that), then split into chunks. */
  write(bytes: Uint8Array): Promise<void> {
    const run = this.writing.then(() => this.writeChunks(bytes))
    this.writing = run.catch(() => {})
    return run
  }

  onData(cb: (bytes: Uint8Array) => void) {
    return this.data.on(cb)
  }

  onDisconnect(cb: (reason: string) => void) {
    return this.lost.on(cb)
  }

  private async writeChunks(bytes: Uint8Array) {
    for (let i = 0; i < bytes.length; i += this.chunk) {
      const rx = this.rx
      if (!rx) throw new Error('Not connected')
      await writeChunk(rx, bytes.slice(i, i + this.chunk))
    }
  }

  private release() {
    this.connected = false
    this.tx?.removeEventListener('characteristicvaluechanged', this.onNotify)
    this.rx = null
    this.tx = null
  }

  private readonly onNotify = (e: Event) => {
    const v = (e.target as BluetoothRemoteGATTCharacteristic).value
    if (!v || v.byteLength === 0) return
    // Copy: some browsers reuse the buffer for the next notification.
    this.data.emit(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)))
  }

  private readonly onGattDisconnected = () => {
    const wasConnected = this.connected
    this.release()
    if (this.closing || !wasConnected) return
    this.lost.emit('Bluetooth connection lost')
  }
}

/** Errors worth another try: the radio or the phone's Bluetooth stack, not the device or the user. */
function isPassing(e: unknown): boolean {
  return e instanceof Error && (e.name === 'NetworkError' || e.name === 'OperationError' || e.name === 'UnknownError')
}

function clampChunk(n: number) {
  return Math.max(20, Math.min(244, Math.floor(n)))
}

async function writeChunk(rx: BluetoothRemoteGATTCharacteristic, chunk: Uint8Array<ArrayBuffer>) {
  const noResponse = rx.properties.writeWithoutResponse && typeof rx.writeValueWithoutResponse === 'function'
  for (let attempt = 0; ; attempt++) {
    try {
      if (noResponse) await rx.writeValueWithoutResponse(chunk)
      else if (typeof rx.writeValueWithResponse === 'function') await rx.writeValueWithResponse(chunk)
      else await rx.writeValue(chunk)
      return
    } catch (e) {
      // "GATT operation already in progress" or a full radio buffer: wait a moment and retry.
      if (attempt >= 3) throw e
      await new Promise((r) => setTimeout(r, 15 * (attempt + 1)))
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      onTimeout()
      reject(new ConnectError("The Bluetooth device didn't respond. Make sure it's switched on and nearby."))
    }, ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}
