import { describe, expect, it } from 'vitest'
import { BufferReader, BufferWriter } from './buffer'
import { COMM } from './commands'
import { crc16 } from './crc16'
import {
  decodeFwVersion,
  decodeValues,
  decodeValuesSelective,
  emptyValues,
  encodeFwVersion,
  encodeValues,
  encodeValuesSelective,
  type FwVersion,
} from './messages'
import { encodePacket, PacketDecoder } from './packet'

const bytes = (...b: number[]) => Uint8Array.from(b)
const payloadOf = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff)

function collect(opts?: { maxPayload?: number }) {
  const out: Uint8Array[] = []
  const decoder = new PacketDecoder((p) => out.push(p), opts)
  return { out, decoder }
}

describe('crc16', () => {
  it('matches the CRC-16/XMODEM check value', () => {
    expect(crc16(new TextEncoder().encode('123456789'))).toBe(0x31c3)
  })
})

describe('packet framing', () => {
  it('frames a short packet', () => {
    const p = encodePacket(bytes(COMM.FW_VERSION))
    expect(Array.from(p)).toEqual([2, 1, 0, 0, 0, 3]) // crc16([0]) = 0
  })

  it('uses 2-byte length above 255 bytes and 3-byte length above 65535', () => {
    expect(encodePacket(payloadOf(255))[0]).toBe(2)
    expect(encodePacket(payloadOf(256))[0]).toBe(3)
    expect(encodePacket(payloadOf(70000))[0]).toBe(4)
  })

  it.each([1, 2, 100, 255, 256, 1000, 4096])('round-trips a %i-byte payload', (n) => {
    const { out, decoder } = collect()
    const payload = payloadOf(n)
    decoder.push(encodePacket(payload))
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(payload)
  })

  it('round-trips a long (3-byte length) packet when allowed', () => {
    const { out, decoder } = collect({ maxPayload: 100_000 })
    const payload = payloadOf(70000)
    decoder.push(encodePacket(payload))
    expect(out[0]).toEqual(payload)
  })

  it('reassembles a packet delivered one byte at a time', () => {
    const { out, decoder } = collect()
    const payload = payloadOf(300)
    for (const b of encodePacket(payload)) decoder.push(bytes(b))
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(payload)
  })

  it('reassembles packets split into BLE-sized 20-byte chunks', () => {
    const { out, decoder } = collect()
    const packets = [payloadOf(40, 1), payloadOf(3, 2), payloadOf(500, 3)]
    const stream = concat(packets.map(encodePacket))
    for (let i = 0; i < stream.length; i += 20) decoder.push(stream.subarray(i, i + 20))
    expect(out).toEqual(packets)
  })

  it('decodes several packets in one chunk', () => {
    const { out, decoder } = collect()
    const packets = [payloadOf(5, 1), payloadOf(6, 2), payloadOf(7, 3)]
    decoder.push(concat(packets.map(encodePacket)))
    expect(out).toEqual(packets)
  })

  it('skips junk before and between packets', () => {
    const { out, decoder } = collect()
    const a = payloadOf(10, 1)
    const b = payloadOf(10, 2)
    decoder.push(concat([bytes(0xff, 0x00, 0x99), encodePacket(a), bytes(0x55, 0x03, 0x77), encodePacket(b)]))
    expect(out).toEqual([a, b])
    expect(decoder.stats.droppedBytes).toBeGreaterThan(0)
  })

  it('drops a packet with a bad CRC and recovers on the next one', () => {
    const { out, decoder } = collect()
    const bad = encodePacket(payloadOf(10, 1))
    bad[5] ^= 0xff
    const good = payloadOf(10, 2)
    decoder.push(concat([bad, encodePacket(good)]))
    expect(out).toEqual([good])
    expect(decoder.stats.crcErrors).toBeGreaterThanOrEqual(1)
  })

  it('does not get stuck on a false start byte that claims a long length', () => {
    const { out, decoder } = collect()
    // 0x03 0x0f 0xa0 looks like the start of a 4000-byte packet.
    const good = [payloadOf(20, 1), payloadOf(20, 2)]
    decoder.push(concat([bytes(0x03, 0x0f, 0xa0), ...good.map(encodePacket)]))
    expect(out).toEqual(good)
  })
})

describe('buffer helpers', () => {
  it('round-trips signed and scaled values big-endian', () => {
    const w = new BufferWriter().i16(-2).u16(0xbeef).i32(-123456).u32(0xdeadbeef).f16(-12.3, 1e1).f32(3.14159, 1e4).f32auto(1.5)
    const r = new BufferReader(w.toUint8Array())
    expect(r.i16()).toBe(-2)
    expect(r.u16()).toBe(0xbeef)
    expect(r.i32()).toBe(-123456)
    expect(r.u32()).toBe(0xdeadbeef)
    expect(r.f16(1e1)).toBeCloseTo(-12.3, 5)
    expect(r.f32(1e4)).toBeCloseTo(3.1415, 5)
    expect(r.f32auto()).toBe(1.5)
    expect(r.remaining).toBe(0)
  })

  it('writes int16 big-endian', () => {
    expect(Array.from(new BufferWriter().i16(0x1234).toUint8Array())).toEqual([0x12, 0x34])
  })
})

const sampleFw: FwVersion = {
  major: 6,
  minor: 6,
  hwName: '75_100',
  uuid: '00112233445566778899aabb',
  pairingDone: false,
  testVersion: 0,
  hwType: 0,
  customConfigCount: 1,
  hasPhaseFilters: true,
  qmlHw: 0,
  qmlApp: 1,
  nrfFlags: 0,
  fwName: 'test',
  hwCrc: 0x12345678,
}

describe('FW_VERSION', () => {
  it('round-trips every field', () => {
    const payload = encodeFwVersion(sampleFw)
    expect(payload[0]).toBe(COMM.FW_VERSION)
    expect(decodeFwVersion(new BufferReader(payload, 1))).toEqual(sampleFw)
  })

  it('accepts the shorter reply from older firmware', () => {
    const w = new BufferWriter().u8(COMM.FW_VERSION).u8(3).u8(40).cstring('410')
    const fw = decodeFwVersion(new BufferReader(w.toUint8Array(), 1))
    expect(fw).toMatchObject({ major: 3, minor: 40, hwName: '410', uuid: '', hwCrc: null })
  })
})

describe('GET_VALUES', () => {
  const v = {
    ...emptyValues(),
    tempFet: 31.4,
    tempMotor: 45.2,
    currentMotor: -12.34,
    currentIn: 8.5,
    id: -0.5,
    iq: 12.25,
    dutyNow: 0.421,
    rpm: 15800,
    vIn: 49.5,
    ampHours: 1.2345,
    ampHoursCharged: 0.0123,
    wattHours: 60.5,
    wattHoursCharged: 0.75,
    tachometer: -12345,
    tachometerAbs: 99999,
    fault: 5,
    pidPos: 123.456789,
    controllerId: 11,
    tempMos1: 30.1,
    tempMos2: 30.2,
    tempMos3: 30.3,
    vd: -1.234,
    vq: 20.5,
    status: 2,
  }

  it('round-trips all fields with firmware scaling', () => {
    const payload = encodeValues(v)
    expect(payload[0]).toBe(COMM.GET_VALUES)
    const d = decodeValues(new BufferReader(payload, 1))
    for (const [k, expected] of Object.entries(v)) {
      expect(d[k as keyof typeof d], k).toBeCloseTo(expected, 2)
    }
  })

  it('has the firmware byte layout (temps first, int16 x10)', () => {
    const payload = encodeValues({ ...emptyValues(), tempFet: 25.6 })
    expect(Array.from(payload.subarray(1, 3))).toEqual([0x01, 0x00]) // 256
  })

  it('stops quietly when older firmware sends fewer fields', () => {
    const full = encodeValues(v)
    const short = full.subarray(0, 1 + 2 + 2 + 4 + 4) // temps + 2 currents
    const d = decodeValues(new BufferReader(short, 1))
    expect(d.currentIn).toBeCloseTo(8.5)
    expect(d.vIn).toBe(0)
  })

  it('decodes the selective variant using the echoed mask', () => {
    const mask = (1 << 0) | (1 << 7) | (1 << 8) | (1 << 15)
    const payload = encodeValuesSelective(v, mask)
    const { mask: m, values } = decodeValuesSelective(new BufferReader(payload, 1))
    expect(m).toBe(mask)
    expect(values.tempFet).toBeCloseTo(31.4)
    expect(values.rpm).toBe(15800)
    expect(values.vIn).toBeCloseTo(49.5)
    expect(values.fault).toBe(5)
    expect(values.currentIn).toBe(0)
  })
})

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
