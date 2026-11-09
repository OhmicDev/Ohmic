// Big-endian byte helpers matching the firmware's buffer.c.
// "Scaled" floats are fixed-point integers: value * scale, truncated toward zero.

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProtocolError'
  }
}

export class BufferWriter {
  private bytes: number[] = []

  u8(v: number): this {
    this.bytes.push(v & 0xff)
    return this
  }

  /** Same bytes as u8; named for readability where the field is signed. */
  i8(v: number): this {
    return this.u8(v)
  }

  i16(v: number): this {
    const x = v & 0xffff
    this.bytes.push((x >> 8) & 0xff, x & 0xff)
    return this
  }

  u16(v: number): this {
    return this.i16(v)
  }

  i32(v: number): this {
    const x = v | 0
    this.bytes.push((x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff)
    return this
  }

  u32(v: number): this {
    return this.i32(v >>> 0)
  }

  f16(v: number, scale: number): this {
    return this.i16(clampInt(Math.trunc(v * scale), -0x8000, 0x7fff))
  }

  f32(v: number, scale: number): this {
    return this.i32(clampInt(Math.trunc(v * scale), -0x80000000, 0x7fffffff))
  }

  /** IEEE-754-compatible float encoding used for config values (buffer_append_float32_auto). */
  f32auto(v: number): this {
    const view = new DataView(new ArrayBuffer(4))
    view.setFloat32(0, Math.abs(v) < 1.5e-38 ? 0 : v, false)
    for (let i = 0; i < 4; i++) this.bytes.push(view.getUint8(i))
    return this
  }

  cstring(s: string): this {
    for (const b of new TextEncoder().encode(s)) this.bytes.push(b)
    this.bytes.push(0)
    return this
  }

  raw(data: ArrayLike<number>): this {
    for (let i = 0; i < data.length; i++) this.bytes.push(data[i] & 0xff)
    return this
  }

  get length(): number {
    return this.bytes.length
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

export class BufferReader {
  readonly data: Uint8Array
  private view: DataView
  pos: number

  constructor(data: Uint8Array, offset = 0) {
    this.data = data
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    this.pos = offset
  }

  get remaining(): number {
    return this.data.length - this.pos
  }

  has(n: number): boolean {
    return this.remaining >= n
  }

  private need(n: number) {
    if (!this.has(n)) {
      throw new ProtocolError(`Packet too short: needed ${n} more byte(s) at offset ${this.pos}`)
    }
  }

  u8(): number {
    this.need(1)
    return this.view.getUint8(this.pos++)
  }

  i8(): number {
    this.need(1)
    return this.view.getInt8(this.pos++)
  }

  i16(): number {
    this.need(2)
    const v = this.view.getInt16(this.pos, false)
    this.pos += 2
    return v
  }

  u16(): number {
    this.need(2)
    const v = this.view.getUint16(this.pos, false)
    this.pos += 2
    return v
  }

  i32(): number {
    this.need(4)
    const v = this.view.getInt32(this.pos, false)
    this.pos += 4
    return v
  }

  u32(): number {
    this.need(4)
    const v = this.view.getUint32(this.pos, false)
    this.pos += 4
    return v
  }

  f16(scale: number): number {
    return this.i16() / scale
  }

  f32(scale: number): number {
    return this.i32() / scale
  }

  f32auto(): number {
    this.need(4)
    const v = this.view.getFloat32(this.pos, false)
    this.pos += 4
    return v
  }

  cstring(): string {
    let end = this.pos
    while (end < this.data.length && this.data[end] !== 0) end++
    if (end >= this.data.length) throw new ProtocolError('Unterminated string in packet')
    const s = new TextDecoder().decode(this.data.subarray(this.pos, end))
    this.pos = end + 1
    return s
  }

  bytes(n: number): Uint8Array {
    this.need(n)
    const out = this.data.slice(this.pos, this.pos + n)
    this.pos += n
    return out
  }

  rest(): Uint8Array {
    return this.bytes(this.remaining)
  }
}

function clampInt(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
