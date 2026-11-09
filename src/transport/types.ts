export type TransportKind = 'serial' | 'ble' | 'mock'

/**
 * A raw byte pipe to a controller. Framing and commands live above this.
 *
 * A transport is tied to one chosen device. After a drop, calling `connect()`
 * again reconnects to that same device without asking the user to pick it.
 */
export interface Transport {
  readonly kind: TransportKind
  /** Human-readable name of what we're connected to (port or BLE device name). */
  readonly label: string
  connect(): Promise<void>
  disconnect(): Promise<void>
  write(bytes: Uint8Array): Promise<void>
  /** Returns an unsubscribe function. */
  onData(cb: (bytes: Uint8Array) => void): () => void
  /** Fires when the link is lost unexpectedly. Not fired after `disconnect()`. */
  onDisconnect(cb: (reason: string) => void): () => void
}

/** Thrown with a message that is already written for the rider. */
export class ConnectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectError'
  }
}

export class Emitter<T> {
  private listeners = new Set<(value: T) => void>()

  on(cb: (value: T) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  emit(value: T) {
    for (const cb of [...this.listeners]) cb(value)
  }
}
