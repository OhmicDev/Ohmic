// Stand-ins for the browser's Web Serial and Web Bluetooth objects, wired to
// the simulated controllers, so the real transports can be tested end to end.
// They copy the behaviour that matters: Chrome hands out a new port object
// after a re-plug, BLE writes must not overlap, notifications come in chunks.

import { encodePacket, PacketDecoder } from '../protocol/packet'
import { MockBus, replyData } from '../sim/mockBus'
import { NUS_RX, NUS_SERVICE, NUS_TX, type BluetoothApi } from '../transport/BleTransport'
import type { SerialApi } from '../transport/SerialTransport'

const later = (ms = 1) => new Promise((r) => setTimeout(r, ms))

function bytesOf(data: BufferSource): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0))
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
}

// ------------------------------------------------------------------ Serial

export class FakeSerialPort {
  readonly info: { usbVendorId?: number; usbProductId?: number }
  readonly bus: MockBus
  readable: ReadableStream<Uint8Array> | null = null
  writable: WritableStream<Uint8Array> | null = null
  present = true
  isOpen = false
  baudRate: number | null = null
  private ctrl: ReadableStreamDefaultController<Uint8Array> | null = null
  private readonly decoder: PacketDecoder

  constructor(bus = new MockBus(), info: { usbVendorId?: number; usbProductId?: number } = { usbVendorId: 0x0483, usbProductId: 0x5740 }) {
    this.bus = bus
    this.info = info
    this.decoder = new PacketDecoder((payload) => {
      for (const reply of this.bus.handle(payload)) this.feed(encodePacket(replyData(reply)))
    })
  }

  getInfo() {
    return { ...this.info }
  }

  async open(opts: { baudRate: number }) {
    if (!this.present) throw new DOMException('Failed to open serial port.', 'NetworkError')
    if (this.isOpen) throw new DOMException('The port is already open.', 'InvalidStateError')
    this.isOpen = true
    this.baudRate = opts.baudRate
    this.readable = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.ctrl = c
      },
      cancel: () => {
        this.ctrl = null
      },
    })
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        if (!this.present) throw new DOMException('The device has been lost.', 'NetworkError')
        this.decoder.push(chunk)
      },
    })
  }

  async close() {
    if (this.readable?.locked || this.writable?.locked) throw new TypeError('Cannot close a port with locked streams')
    this.isOpen = false
    this.readable = null
    this.writable = null
    this.ctrl = null
  }

  /** Pull the cable: the pending read fails and the port's streams go away, as in Chrome. */
  unplug() {
    this.present = false
    this.ctrl?.error(new DOMException('The device has been lost.', 'NetworkError'))
    this.ctrl = null
    this.readable = null
  }

  private feed(packet: Uint8Array) {
    void later().then(() => {
      for (let i = 0; i < packet.length; i += 64) {
        try {
          this.ctrl?.enqueue(packet.slice(i, i + 64))
        } catch {
          // Stream already closed.
        }
      }
    })
  }
}

export class FakeSerial {
  ports: FakeSerialPort[] = []
  /** What the browser's picker returns; null means the user cancelled. */
  pick: FakeSerialPort | null = null
  lastRequest: SerialPortRequestOptions | undefined

  async getPorts() {
    return this.ports.filter((p) => p.present) as unknown as SerialPort[]
  }

  async requestPort(opts?: SerialPortRequestOptions) {
    this.lastRequest = opts
    if (!this.pick) throw new DOMException('No port selected by the user.', 'NotFoundError')
    if (!this.ports.includes(this.pick)) this.ports.push(this.pick)
    return this.pick as unknown as SerialPort
  }

  /** Plug the same device back in. The browser hands out a new port object. */
  replug(old: FakeSerialPort): FakeSerialPort {
    const port = new FakeSerialPort(old.bus, old.info)
    this.ports = [...this.ports.filter((p) => p !== old), port]
    return port
  }

  get api(): SerialApi {
    return this as unknown as SerialApi
  }
}

// --------------------------------------------------------------- Bluetooth

class FakeCharacteristic extends EventTarget {
  readonly uuid: string
  readonly properties = { write: true, writeWithoutResponse: true, notify: true }
  value: DataView | null = null
  notifying = false
  /** Size of every write, to check chunking. */
  writes: number[] = []
  /** Writes that started while another was still running. Web Bluetooth rejects these. */
  overlaps = 0
  maxWrite = 20
  private busy = false
  private readonly device: FakeBluetoothDevice

  constructor(uuid: string, device: FakeBluetoothDevice) {
    super()
    this.uuid = uuid
    this.device = device
  }

  async writeValueWithoutResponse(data: BufferSource) {
    if (this.busy) {
      this.overlaps++
      throw new DOMException('GATT operation already in progress.', 'NetworkError')
    }
    if (!this.device.gatt.connected) throw new DOMException('GATT Server is disconnected.', 'NetworkError')
    const bytes = bytesOf(data)
    if (bytes.length > this.maxWrite) throw new DOMException('Value is longer than the link allows.', 'NotSupportedError')
    this.busy = true
    await later(0)
    this.busy = false
    this.writes.push(bytes.length)
    this.device.received(bytes)
  }

  async startNotifications() {
    this.notifying = true
    return this
  }

  async stopNotifications() {
    this.notifying = false
    return this
  }

  notify(bytes: Uint8Array) {
    if (!this.notifying) return
    this.value = new DataView(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    this.dispatchEvent(new Event('characteristicvaluechanged'))
  }
}

class FakeGattServer {
  connected = false
  connects = 0
  /** Connection attempts that fail with a passing error first, like a phone's first try. */
  failConnects = 0
  /** Service lookups that fail with a passing error first. */
  failServiceLookups = 0
  private readonly device: FakeBluetoothDevice

  constructor(device: FakeBluetoothDevice) {
    this.device = device
  }

  async connect() {
    this.connects++
    await later(2)
    if (!this.device.inRange) throw new DOMException('Bluetooth Device is no longer in range.', 'NetworkError')
    if (this.failConnects > 0) {
      this.failConnects--
      throw new DOMException('GATT operation failed for unknown reason.', 'NetworkError')
    }
    this.connected = true
    return this
  }

  disconnect() {
    if (!this.connected) return
    this.connected = false
    this.device.dispatchEvent(new Event('gattserverdisconnected'))
  }

  async getPrimaryService(uuid: string) {
    if (!this.connected) throw new DOMException('GATT Server is disconnected.', 'NetworkError')
    if (this.failServiceLookups > 0) {
      this.failServiceLookups--
      throw new DOMException('GATT Server is disconnected. Cannot retrieve services.', 'NetworkError')
    }
    if (uuid !== NUS_SERVICE || !this.device.hasNus) {
      throw new DOMException('No Services matching UUID found in Device.', 'NotFoundError')
    }
    return {
      uuid,
      getCharacteristic: async (c: string) => {
        if (c === NUS_RX) return this.device.rx
        if (c === NUS_TX) return this.device.tx
        throw new DOMException('No Characteristics matching UUID found.', 'NotFoundError')
      },
    }
  }
}

export class FakeBluetoothDevice extends EventTarget {
  readonly id = 'fake-ble-1'
  readonly name: string
  readonly bus: MockBus
  readonly gatt: FakeGattServer
  readonly rx: FakeCharacteristic
  readonly tx: FakeCharacteristic
  inRange = true
  hasNus = true
  /** Size of each notification the device sends back. */
  notifySize = 20
  private readonly decoder: PacketDecoder

  constructor(bus = new MockBus({ layout: 'express' }), name = 'VESC Express T') {
    super()
    this.bus = bus
    this.name = name
    this.gatt = new FakeGattServer(this)
    this.rx = new FakeCharacteristic(NUS_RX, this)
    this.tx = new FakeCharacteristic(NUS_TX, this)
    this.decoder = new PacketDecoder((payload) => {
      for (const reply of this.bus.handle(payload)) this.send(encodePacket(replyData(reply)))
    })
  }

  received(bytes: Uint8Array) {
    this.decoder.push(bytes)
  }

  /** Walk out of range: the link drops by itself. */
  goAway() {
    this.inRange = false
    this.gatt.disconnect()
  }

  comeBack() {
    this.inRange = true
  }

  private send(packet: Uint8Array) {
    void later().then(() => {
      for (let i = 0; i < packet.length; i += this.notifySize) {
        if (this.gatt.connected) this.tx.notify(packet.slice(i, i + this.notifySize))
      }
    })
  }
}

export class FakeBluetooth {
  device: FakeBluetoothDevice | null
  lastOptions: RequestDeviceOptions | undefined

  constructor(device: FakeBluetoothDevice | null = new FakeBluetoothDevice()) {
    this.device = device
  }

  async requestDevice(opts?: RequestDeviceOptions) {
    this.lastOptions = opts
    if (!this.device) throw new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError')
    return this.device as unknown as BluetoothDevice
  }

  get api(): BluetoothApi {
    return this as unknown as BluetoothApi
  }
}

export function asBluetoothDevice(d: FakeBluetoothDevice): BluetoothDevice {
  return d as unknown as BluetoothDevice
}
