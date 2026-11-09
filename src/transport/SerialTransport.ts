// USB cable connection through the Web Serial API (Chrome and Edge on desktop).
//
// VESC controllers show up as a USB virtual COM port, so the baud rate is
// ignored by the hardware; 115200 matches what VESC Tool uses.

import { ConnectError, Emitter, type Transport } from './types'

/** USB IDs VESC Tool treats as VESC devices (vescinterface.cpp, listSerialPorts). */
export const VESC_USB_IDS = [
  { usbVendorId: 0x0483, usbProductId: 0x5740, name: 'VESC' }, // STM32 virtual COM port
  { usbVendorId: 0x303a, usbProductId: 0x1001, name: 'ESP32 / VESC Express' }, // ESP32 USB serial
] as const

/** The parts of `navigator.serial` we use, so tests can pass a fake. */
export type SerialApi = Pick<Serial, 'getPorts' | 'requestPort'>

interface SerialTransportOptions {
  baudRate?: number
  serial?: SerialApi
}

const hex4 = (n: number) => n.toString(16).padStart(4, '0')

function isVescPort(port: SerialPort): boolean {
  const { usbVendorId, usbProductId } = port.getInfo()
  return VESC_USB_IDS.some((id) => id.usbVendorId === usbVendorId && id.usbProductId === usbProductId)
}

export function portName(port: SerialPort): string {
  const { usbVendorId, usbProductId } = port.getInfo()
  const known = VESC_USB_IDS.find((id) => id.usbVendorId === usbVendorId && id.usbProductId === usbProductId)
  if (known) return `${known.name} (USB)`
  if (usbVendorId !== undefined) return `USB serial ${hex4(usbVendorId)}:${hex4(usbProductId ?? 0)}`
  return 'Serial port'
}

function defaultSerial(): SerialApi | undefined {
  return typeof navigator !== 'undefined' && 'serial' in navigator ? navigator.serial : undefined
}

export class SerialTransport implements Transport {
  readonly kind = 'serial' as const
  private port: SerialPort
  private readonly info: SerialPortInfo
  private readonly serial: SerialApi | undefined
  private readonly baudRate: number
  private readonly data = new Emitter<Uint8Array>()
  private readonly lost = new Emitter<string>()
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private reading: Promise<void> | null = null
  private isOpen = false
  private closing = false

  constructor(port: SerialPort, opts: SerialTransportOptions = {}) {
    this.port = port
    this.info = port.getInfo()
    this.serial = opts.serial ?? defaultSerial()
    this.baudRate = opts.baudRate ?? 115200
  }

  get label() {
    return portName(this.port)
  }

  /** Opens the browser's port picker. By default only VESC USB IDs are listed. */
  static async request(opts: SerialTransportOptions & { anyDevice?: boolean } = {}): Promise<SerialTransport> {
    const serial = opts.serial ?? defaultSerial()
    if (!serial) throw new ConnectError("This browser can't use USB devices. Try Chrome or Edge on a computer.")
    const filters = VESC_USB_IDS.map(({ usbVendorId, usbProductId }) => ({ usbVendorId, usbProductId }))
    const port = await serial.requestPort(opts.anyDevice ? {} : { filters })
    return new SerialTransport(port, opts)
  }

  /** Ports this site was allowed to use before and that are plugged in now, VESC ones first. */
  static async granted(serial = defaultSerial()): Promise<SerialPort[]> {
    if (!serial) return []
    const ports = await serial.getPorts()
    return [...ports].sort((a, b) => Number(isVescPort(b)) - Number(isVescPort(a)))
  }

  async connect() {
    if (this.isOpen) return
    this.closing = false
    const port = await this.findPort()
    await port.open({ baudRate: this.baudRate, bufferSize: 8192 })
    this.port = port
    this.isOpen = true
    if (!port.readable || !port.writable) {
      await this.cleanup()
      throw new ConnectError('The USB port opened but cannot be used. Unplug the cable and try again.')
    }
    this.writer = port.writable.getWriter()
    this.reading = this.readLoop(port)
  }

  async disconnect() {
    this.closing = true
    if (!this.isOpen) return
    try {
      await this.reader?.cancel()
    } catch {
      // Already gone.
    }
    await this.reading
    await this.cleanup()
  }

  async write(bytes: Uint8Array) {
    const w = this.writer
    if (!w) throw new Error('Not connected')
    await w.write(bytes)
  }

  onData(cb: (bytes: Uint8Array) => void) {
    return this.data.on(cb)
  }

  onDisconnect(cb: (reason: string) => void) {
    return this.lost.on(cb)
  }

  /**
   * When a cable is unplugged and plugged back in, the browser hands out a new
   * port object. Find it by USB vendor and product ID.
   */
  private async findPort(): Promise<SerialPort> {
    if (!this.serial) return this.port
    const ports = await this.serial.getPorts()
    if (ports.includes(this.port)) return this.port
    const { usbVendorId, usbProductId } = this.info
    const same =
      usbVendorId === undefined
        ? undefined
        : ports.find((p) => {
            const i = p.getInfo()
            return i.usbVendorId === usbVendorId && i.usbProductId === usbProductId
          })
    if (!same) throw new ConnectError('The USB device is not plugged in.')
    return same
  }

  private async readLoop(port: SerialPort) {
    let ended = false
    while (port.readable && !this.closing && !ended) {
      const reader = port.readable.getReader()
      this.reader = reader
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) {
            ended = true
            break
          }
          if (value && value.length > 0) this.data.emit(value)
        }
      } catch {
        // A framing or overrun error leaves `readable` in place and we carry
        // on with a new reader. A lost device sets it to null, ending the loop.
      } finally {
        reader.releaseLock()
        this.reader = null
      }
    }
    if (!this.closing) {
      await this.cleanup()
      this.lost.emit('USB cable unplugged or the controller turned off')
    }
  }

  private async cleanup() {
    this.isOpen = false
    try {
      this.writer?.releaseLock()
    } catch {
      // Nothing to release.
    }
    this.writer = null
    try {
      await this.port.close()
    } catch {
      // Closing a lost device can fail; it is closed either way.
    }
  }
}
