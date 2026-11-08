// Keeps the last stretch of every signal, per controller, in fixed-size ring
// buffers. Charts, min/max and CSV export read from here.

import { SIGNALS, type SignalInput } from './signals'

/** Rows kept per controller: about 11 minutes at 50 Hz, 27 at 20 Hz. */
export const CAPACITY = 32_768

export class DeviceLog {
  readonly capacity: number
  readonly t: Float64Array
  readonly cols: Float32Array[]
  readonly min: Float64Array
  readonly max: Float64Array
  /** Index the next row goes to. */
  private head = 0
  size = 0

  constructor(capacity = CAPACITY) {
    this.capacity = capacity
    this.t = new Float64Array(capacity)
    this.cols = SIGNALS.map(() => new Float32Array(capacity))
    this.min = new Float64Array(SIGNALS.length).fill(Infinity)
    this.max = new Float64Array(SIGNALS.length).fill(-Infinity)
  }

  push(at: number, input: SignalInput) {
    const i = this.head
    this.t[i] = at
    SIGNALS.forEach((s, k) => {
      const value = s.get(input)
      this.cols[k][i] = value
      if (Number.isFinite(value)) {
        if (value < this.min[k]) this.min[k] = value
        if (value > this.max[k]) this.max[k] = value
      }
    })
    this.head = (i + 1) % this.capacity
    this.size = Math.min(this.size + 1, this.capacity)
  }

  /** Ring index of the i-th oldest row. */
  index(i: number): number {
    return (this.head - this.size + i + this.capacity) % this.capacity
  }

  latest(k: number): number {
    return this.size ? this.cols[k][this.index(this.size - 1)] : NaN
  }

  /** Latest value that isn't missing (IMU is only read while someone is looking). */
  latestFinite(k: number): number {
    for (let i = this.size - 1; i >= Math.max(0, this.size - 50); i--) {
      const value = this.cols[k][this.index(i)]
      if (Number.isFinite(value)) return value
    }
    return NaN
  }

  lastTime(): number {
    return this.size ? this.t[this.index(this.size - 1)] : 0
  }

  /** First row index (0 = oldest) with time >= at. */
  firstAtOrAfter(at: number): number {
    let lo = 0
    let hi = this.size
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.t[this.index(mid)] < at) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** Rows in [from, to] as plain arrays: times in seconds, values with null for missing. */
  slice(from: number, to: number, signals: number[]): { t: number[]; cols: (number | null)[][] } {
    const a = this.firstAtOrAfter(from)
    const b = this.firstAtOrAfter(to + 1e-6)
    const t: number[] = []
    const cols: (number | null)[][] = signals.map(() => [])
    for (let i = a; i < b; i++) {
      const j = this.index(i)
      t.push(this.t[j] / 1000)
      signals.forEach((k, n) => {
        const value = this.cols[k][j]
        cols[n].push(Number.isFinite(value) ? value : null)
      })
    }
    return { t, cols }
  }

  /** Updates per second over the last couple of seconds. */
  rate(now: number, spanMs = 2000): number {
    if (this.size < 2) return 0
    const first = this.firstAtOrAfter(now - spanMs)
    const n = this.size - first
    if (n < 2) return 0
    const span = this.t[this.index(this.size - 1)] - this.t[this.index(first)]
    return span > 0 ? ((n - 1) * 1000) / span : 0
  }

  resetMinMax() {
    this.min.fill(Infinity)
    this.max.fill(-Infinity)
  }
}
