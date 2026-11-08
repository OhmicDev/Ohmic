// VESC packet framing (see bldc comm/packet.c):
//   0x02 len(1)  payload crc16(2, big-endian) 0x03   for len <= 255
//   0x03 len(2)  payload crc16 0x03                  for len <= 65535
//   0x04 len(3)  payload crc16 0x03                  for longer payloads
// The CRC covers the payload only.

import { crc16 } from './crc16'

export const DEFAULT_MAX_PAYLOAD = 4096

export function encodePacket(payload: Uint8Array): Uint8Array {
  const len = payload.length
  if (len === 0) throw new Error('Cannot send an empty packet')
  const header =
    len <= 255
      ? [2, len]
      : len <= 65535
        ? [3, len >> 8, len & 0xff]
        : [4, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]
  const crc = crc16(payload)
  const out = new Uint8Array(header.length + len + 3)
  out.set(header, 0)
  out.set(payload, header.length)
  const tail = header.length + len
  out[tail] = crc >> 8
  out[tail + 1] = crc & 0xff
  out[tail + 2] = 3
  return out
}

export interface DecoderStats {
  packets: number
  crcErrors: number
  droppedBytes: number
}

type Frame =
  | { kind: 'packet'; total: number; payload: Uint8Array }
  | { kind: 'incomplete' }
  | { kind: 'invalid' }

/**
 * Turns a byte stream into packets. Handles packets split across many chunks,
 * several packets in one chunk, and junk between packets (it resyncs on the
 * next valid packet).
 */
export class PacketDecoder {
  readonly stats: DecoderStats = { packets: 0, crcErrors: 0, droppedBytes: 0 }
  private buf = new Uint8Array(1024)
  private len = 0
  private readonly maxPayload: number
  private readonly onPacket: (payload: Uint8Array) => void

  constructor(onPacket: (payload: Uint8Array) => void, opts: { maxPayload?: number } = {}) {
    this.onPacket = onPacket
    this.maxPayload = opts.maxPayload ?? DEFAULT_MAX_PAYLOAD
  }

  reset() {
    this.len = 0
  }

  push(chunk: Uint8Array) {
    this.append(chunk)
    this.drain()
  }

  private append(chunk: Uint8Array) {
    if (this.len + chunk.length > this.buf.length) {
      let size = this.buf.length
      while (size < this.len + chunk.length) size *= 2
      const next = new Uint8Array(size)
      next.set(this.buf.subarray(0, this.len))
      this.buf = next
    }
    this.buf.set(chunk, this.len)
    this.len += chunk.length
  }

  private drop(n: number) {
    this.buf.copyWithin(0, n, this.len)
    this.len -= n
  }

  private drain() {
    while (this.len > 0) {
      // Skip to the next possible start byte.
      let skip = 0
      while (skip < this.len && !isStartByte(this.buf[skip])) skip++
      if (skip > 0) {
        this.stats.droppedBytes += skip
        this.drop(skip)
        continue
      }

      const frame = this.tryFrame(0)
      if (frame.kind === 'packet') {
        this.stats.packets++
        this.drop(frame.total)
        this.onPacket(frame.payload)
        continue
      }
      if (frame.kind === 'invalid') {
        this.stats.droppedBytes++
        this.drop(1)
        continue
      }

      // Incomplete at offset 0. If a complete, valid packet already exists
      // further along, the byte at 0 was a false start: resync to it.
      const next = this.findCompletePacketAfter(0)
      if (next > 0) {
        this.stats.droppedBytes += next
        this.drop(next)
        continue
      }
      return
    }
  }

  private findCompletePacketAfter(from: number): number {
    for (let i = from + 1; i < this.len; i++) {
      if (!isStartByte(this.buf[i])) continue
      if (this.tryFrame(i, false).kind === 'packet') return i
    }
    return -1
  }

  private tryFrame(at: number, countCrcErrors = true): Frame {
    const start = this.buf[at]
    const lenBytes = start - 1 // 0x02 -> 1, 0x03 -> 2, 0x04 -> 3
    const avail = this.len - at
    if (avail < 1 + lenBytes) return { kind: 'incomplete' }

    let plen = 0
    for (let k = 0; k < lenBytes; k++) plen = plen * 256 + this.buf[at + 1 + k]

    const lenOk =
      plen >= 1 &&
      plen <= this.maxPayload &&
      (start === 2 || (start === 3 && plen >= 255) || (start === 4 && plen >= 65535))
    if (!lenOk) return { kind: 'invalid' }

    const dataStart = at + 1 + lenBytes
    const total = 1 + lenBytes + plen + 3
    if (avail < total) return { kind: 'incomplete' }

    const crcHi = this.buf[dataStart + plen]
    const crcLo = this.buf[dataStart + plen + 1]
    const end = this.buf[dataStart + plen + 2]
    if (end !== 3 || crc16(this.buf, dataStart, dataStart + plen) !== ((crcHi << 8) | crcLo)) {
      if (countCrcErrors) this.stats.crcErrors++
      return { kind: 'invalid' }
    }
    return { kind: 'packet', total, payload: this.buf.slice(dataStart, dataStart + plen) }
  }
}

function isStartByte(b: number): boolean {
  return b === 2 || b === 3 || b === 4
}
