// A Transport backed by the simulated controllers. Replies are split into
// BLE-sized chunks with a little latency, so the decoder gets real exercise.

import { encodePacket, PacketDecoder } from '../protocol/packet'
import { MockBus, type MockReply } from '../sim/mockBus'
import { Emitter, type Transport } from './types'

export interface MockTransportOptions {
  latencyMs?: [number, number]
  chunkSize?: number
  connectDelayMs?: number
  bus?: MockBus
  label?: string
}

export class MockTransport implements Transport {
  readonly kind = 'mock' as const
  readonly label: string
  readonly bus: MockBus
  private readonly opts: Required<Omit<MockTransportOptions, 'bus' | 'label'>>
  private readonly data = new Emitter<Uint8Array>()
  private readonly closed = new Emitter<string>()
  private readonly decoder: PacketDecoder
  private connected = false
  private timers = new Set<ReturnType<typeof setTimeout>>()
  /** Replies leave in order, like bytes on one wire, whatever their latency. */
  private lastDeliveryAt = 0
  /** The controller is restarting: it can't be reached until then (performance.now time). */
  private downUntil = 0

  constructor(opts: MockTransportOptions = {}) {
    this.bus = opts.bus ?? new MockBus()
    this.label = opts.label ?? 'Demo scooter (simulated)'
    this.opts = {
      latencyMs: opts.latencyMs ?? [4, 18],
      chunkSize: opts.chunkSize ?? 20,
      connectDelayMs: opts.connectDelayMs ?? 350,
    }
    this.decoder = new PacketDecoder((payload) => {
      for (const reply of this.bus.handle(payload)) this.send(reply)
    })
    // A restart (new firmware) drops the link the way a USB device disappears.
    this.bus.onLocalReboot = (ms) => {
      this.downUntil = performance.now() + ms
      setTimeout(() => this.simulateDrop('The controller restarted'), 20)
    }
  }

  async connect() {
    await new Promise((r) => setTimeout(r, this.opts.connectDelayMs))
    if (performance.now() < this.downUntil) throw new Error('Device not found')
    this.connected = true
  }

  async disconnect() {
    this.connected = false
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    this.decoder.reset()
  }

  async write(bytes: Uint8Array) {
    if (!this.connected) throw new Error('Not connected')
    this.decoder.push(bytes)
  }

  onData(cb: (bytes: Uint8Array) => void) {
    return this.data.on(cb)
  }

  onDisconnect(cb: (reason: string) => void) {
    return this.closed.on(cb)
  }

  /** Test helper: pretend the link dropped. */
  simulateDrop(reason = 'Connection lost') {
    void this.disconnect()
    this.closed.emit(reason)
  }

  private send(reply: MockReply) {
    const [min, max] = this.opts.latencyMs
    const extra = reply instanceof Uint8Array ? 0 : reply.delayMs
    const packet = encodePacket(reply instanceof Uint8Array ? reply : reply.data)
    const now = performance.now()
    const at = Math.max(now + extra + min + Math.random() * (max - min), this.lastDeliveryAt + 0.5)
    // Replies arrive in order, except one the firmware sends later on its own (detection,
    // calibration): the controller keeps answering other requests meanwhile.
    if (!extra) this.lastDeliveryAt = at
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      if (!this.connected) return
      for (let i = 0; i < packet.length; i += this.opts.chunkSize) {
        this.data.emit(packet.slice(i, i + this.opts.chunkSize))
      }
    }, at - now)
    this.timers.add(timer)
  }
}
