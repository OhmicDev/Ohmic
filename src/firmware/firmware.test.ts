import { describe, expect, it } from 'vitest'
import { BufferReader } from '../protocol/buffer'
import { crc16 } from '../protocol/crc16'
import { bootloaderFor, downloadFirmware, firmwareFor, fitsBoard, suggestedVersion } from './archive'
import { heatshrinkDecode, heatshrinkEncode } from './heatshrink'
import {
  BOOTLOADER_OFFSET,
  bootloaderUnpack,
  CHUNK_BYTES,
  FirmwareFileError,
  MAX_IMAGE_BYTES,
  namesHardware,
  prepareBootloader,
  prepareFirmware,
  removeHeader,
  type PreparedImage,
} from './image'

/** Bytes that look a bit like firmware: code-ish runs, tables, text, and erased gaps. */
function fakeImage(size: number, seed = 1, text = 'org.vesc.75_100'): Uint8Array {
  const out = new Uint8Array(size)
  let x = seed
  const rnd = () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) >>> 24
  for (let i = 0; i < size; ) {
    const kind = rnd() % 4
    const len = 8 + (rnd() % 120)
    for (let k = 0; k < len && i < size; k++, i++) out[i] = kind === 0 ? 0xff : kind === 1 ? (i * 7) & 0xff : kind === 2 ? rnd() & 0x3f : rnd()
  }
  const t = new TextEncoder().encode(`\0${text}\0`)
  out.set(t, Math.floor(size / 2))
  return out
}

/** Puts a prepared image's chunks where the controller would store them. */
function area(p: PreparedImage): Uint8Array {
  const a = new Uint8Array(BOOTLOADER_OFFSET + 131072).fill(0xff)
  for (const c of p.chunks) a.set(c.data, c.offset)
  return a
}

describe('heatshrink', () => {
  it('round-trips firmware-like data and long runs', () => {
    for (const data of [fakeImage(50_000), new Uint8Array(5000).fill(0xab), Uint8Array.of(1), new Uint8Array(0), fakeImage(3000, 7)]) {
      const packed = heatshrinkEncode(data)
      expect(heatshrinkDecode(packed)).toEqual(data)
    }
  })

  it('compresses repetitive data', () => {
    const run = new Uint8Array(10_000).fill(0)
    expect(heatshrinkEncode(run).length).toBeLessThan(800)
    const img = fakeImage(100_000)
    expect(heatshrinkEncode(img).length).toBeLessThan(img.length)
  })
})

describe('firmware images', () => {
  it('adds the size and CRC header and writes in 384-byte chunks', () => {
    const img = fakeImage(2000)
    const p = prepareFirmware(img)
    expect(p.compressed).toBe(false)
    expect(p.uploadBytes).toBe(2006)
    expect(p.eraseBytes).toBe(2000)
    const first = new BufferReader(p.chunks[0].data)
    expect(first.u32()).toBe(2000)
    expect(first.u16()).toBe(crc16(img))
    expect(p.chunks.every((c) => c.data.length <= CHUNK_BYTES)).toBe(true)
    expect(bootloaderUnpack(area(p))).toEqual(img)
  })

  it('skips chunks that are all erased flash', () => {
    const img = fakeImage(CHUNK_BYTES * 3).fill(0x11)
    img.fill(0xff, CHUNK_BYTES - 6, 2 * CHUNK_BYTES - 6) // the payload's second chunk
    const p = prepareFirmware(img)
    expect(p.chunks.map((c) => c.offset)).toEqual([0, 2 * CHUNK_BYTES, 3 * CHUNK_BYTES])
    expect(bootloaderUnpack(area(p))).toEqual(img)
  })

  it('compresses images that are too big for the update area, as 6.0+ firmware needs', () => {
    const img = fakeImage(MAX_IMAGE_BYTES + 40_000)
    const p = prepareFirmware(img)
    expect(p.compressed).toBe(true)
    expect(p.uploadBytes).toBeLessThanOrEqual(MAX_IMAGE_BYTES + 6)
    expect(new BufferReader(p.chunks[0].data).u32() >>> 24).toBe(0xcc)
    expect(p.eraseBytes).toBe(img.length)
    expect(bootloaderUnpack(area(p))).toEqual(img)
  })

  it('refuses files that are too small, too big, or too big even compressed', () => {
    expect(() => prepareFirmware(new Uint8Array(100))).toThrow(FirmwareFileError)
    expect(() => prepareFirmware(new Uint8Array(700_000).fill(0x11))).toThrow(/VESC Express/)
    const noise = new Uint8Array(450_000)
    let x = 9
    for (let i = 0; i < noise.length; i++) noise[i] = (x = (Math.imul(x, 1103515245) + 12345) >>> 0) >>> 24
    expect(() => prepareFirmware(noise)).toThrow(/even compressed/)
  })

  it('takes a file that already has its header, compressed or not', () => {
    for (const img of [fakeImage(5000), fakeImage(MAX_IMAGE_BYTES + 20_000)]) {
      const p = prepareFirmware(img)
      const payload = area(p).subarray(0, p.uploadBytes)
      expect(removeHeader(payload)).toEqual(img)
      expect(prepareFirmware(payload).image).toEqual(img)
    }
  })

  it('the bootloader refuses a damaged image', () => {
    const p = prepareFirmware(fakeImage(4000))
    const a = area(p)
    a[100] ^= 0xff
    expect(bootloaderUnpack(a)).toBeNull()
  })

  it('finds the hardware name, even merged into a longer string', () => {
    const enc = (s: string) => new TextEncoder().encode(s)
    expect(namesHardware(enc('xx\0org.vesc.75_100\0yy'), '75_100')).toBe(true)
    expect(namesHardware(enc('\x0175_100\0'), '75_100')).toBe(true)
    expect(namesHardware(enc('ab75_100\0'), '75_100')).toBe(false)
    expect(namesHardware(enc('\x0075_100X\0'), '75_100')).toBe(false)
  })

  it('writes a bootloader to the end of the update area, as it is', () => {
    const bl = fakeImage(20_000)
    const p = prepareBootloader(bl)
    expect(p.chunks[0].offset).toBe(BOOTLOADER_OFFSET)
    expect(area(p).subarray(BOOTLOADER_OFFSET, BOOTLOADER_OFFSET + bl.length)).toEqual(bl)
    expect(() => prepareBootloader(new Uint8Array(200_000))).toThrow(FirmwareFileError)
  })
})

describe('firmware archive', () => {
  it('matches hardware names the way VESC Tool does', () => {
    expect(fitsBoard('410_o_411_o_412', '411')).toBe(true)
    expect(fitsBoard('60_MK6', '60_mk6')).toBe(true)
    expect(fitsBoard('60', '60_MK6')).toBe(false)
    expect(fitsBoard('60_o_75_300_o_HD60.bin', 'hd60')).toBe(true)
  })

  it('lists versions for a board, standard build first and the no-limits build last', () => {
    const versions = firmwareFor('75_100')
    expect(versions.map((v) => v.version)).toContain('7.00')
    for (const v of versions) {
      expect(v.files[0].standard).toBe(true)
      const nl = v.files.findIndex((f) => f.noHwLimits)
      if (nl >= 0) expect(nl).toBe(v.files.length - 1)
      expect(v.files[0].url).toMatch(new RegExp(`^https://raw\\.githubusercontent\\.com/vedderb/vesc_fw_archive/main/${v.version}/`))
    }
    // The newest Ohmic can still edit settings on is offered first.
    expect(suggestedVersion(versions)?.configurable).toBe(true)
    expect(firmwareFor('NOT_A_BOARD')).toEqual([])
  })

  it('picks a bootloader made for the hardware, else the generic one', () => {
    expect(bootloaderFor('75_100').generic).toBe(true)
    expect(bootloaderFor('HD60').generic).toBe(false)
  })

  it('downloads with readable errors', async () => {
    const ok = await downloadFirmware('x', async () => new Response(Uint8Array.of(1, 2, 3)))
    expect(ok).toEqual(Uint8Array.of(1, 2, 3))
    await expect(downloadFirmware('x', async () => new Response('', { status: 404 }))).rejects.toThrow(/HTTP 404/)
    await expect(
      downloadFirmware('x', async () => {
        throw new TypeError('Failed to fetch')
      }),
    ).rejects.toThrow(/internet/)
  })
})
