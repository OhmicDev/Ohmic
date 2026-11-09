// Turning a firmware file into what goes over the wire, the way VESC Tool does it
// (VescInterface::fwUpload) and the bootloader expects it (bldc-bootloader main.c):
//
//  1. A file that already starts with a size + CRC header has it removed (and is
//     decompressed if it was compressed), like Utility::removeFirmwareHeader.
//  2. The update area is erased for the image's size.
//  3. Images bigger than 393 208 bytes (firmware 6.0 and newer) are compressed with
//     heatshrink; the size field then carries 0xCC in its top byte.
//  4. A header goes in front: u32 size, u16 CRC16 of the data. The bootloader checks
//     both before it touches the running firmware.
//  5. It's written in 384-byte chunks, skipping chunks that are all 0xFF (erased
//     flash already reads 0xFF).
//
// A bootloader goes to the end of the update area, with no header and no compression.

import { BufferReader, BufferWriter } from '../protocol/buffer'
import { crc16 } from '../protocol/crc16'
import { heatshrinkDecode, heatshrinkEncode } from './heatshrink'

export const CHUNK_BYTES = 384
/** The update area (3 × 128 KB) less room for the header, as VESC Tool checks it. */
export const MAX_IMAGE_BYTES = 393_208
/** Bigger than this and VESC Tool assumes the file is for an ESP32 (VESC Express), not a motor controller. */
const COMPRESS_BELOW = 700_000
const COMPRESSED_FLAG = 0xcc
/** Where a motor controller's bootloader lives, relative to the update area. */
export const BOOTLOADER_OFFSET = 128 * 1024 * 3
export const MAX_BOOTLOADER_BYTES = 128 * 1024
const MIN_IMAGE_BYTES = 1024

export class FirmwareFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwareFileError'
  }
}

interface Chunk {
  offset: number
  data: Uint8Array
}

export interface PreparedImage {
  kind: 'firmware' | 'bootloader'
  /** The image as the controller will run it (header removed, decompressed). */
  image: Uint8Array
  /** Size sent with the erase command (the uncompressed image, as VESC Tool sends it). */
  eraseBytes: number
  compressed: boolean
  /** Bytes in the update area, header included. */
  uploadBytes: number
  /** What gets written, in order. All-0xFF chunks are left out. */
  chunks: Chunk[]
}

/** Utility::removeFirmwareHeader: a file saved with its upload header gets it removed. */
export function removeHeader(file: Uint8Array): Uint8Array {
  if (file.length <= 6) return file
  const r = new BufferReader(file)
  const size = r.u32()
  const crc = r.u16()
  const body = file.subarray(6)
  if (crc16(body) !== crc) return file
  return size >>> 24 === COMPRESSED_FLAG ? heatshrinkDecode(body) : body.slice()
}

function toChunks(payload: Uint8Array, start: number): Chunk[] {
  const out: Chunk[] = []
  for (let i = 0; i < payload.length; i += CHUNK_BYTES) {
    const data = payload.subarray(i, Math.min(payload.length, i + CHUNK_BYTES))
    if (data.some((b) => b !== 0xff)) out.push({ offset: start + i, data })
  }
  return out
}

export function prepareFirmware(file: Uint8Array): PreparedImage {
  const image = removeHeader(file)
  if (image.length < MIN_IMAGE_BYTES) throw new FirmwareFileError('This file is too small to be motor controller firmware.')
  if (image.length >= COMPRESS_BELOW) {
    throw new FirmwareFileError('This file is too big for a motor controller. It may be firmware for a VESC Express or another ESP32 device.')
  }
  let data = image
  let compressed = false
  if (image.length > MAX_IMAGE_BYTES) {
    data = heatshrinkEncode(image)
    compressed = true
    if (data.length > MAX_IMAGE_BYTES) throw new FirmwareFileError('This firmware is too big for the bootloader, even compressed.')
  }
  const size = compressed ? ((COMPRESSED_FLAG << 24) | data.length) >>> 0 : data.length
  const payload = new BufferWriter().u32(size).u16(crc16(data)).raw(data).toUint8Array()
  return { kind: 'firmware', image, eraseBytes: image.length, compressed, uploadBytes: payload.length, chunks: toChunks(payload, 0) }
}

export function prepareBootloader(file: Uint8Array): PreparedImage {
  if (file.length < MIN_IMAGE_BYTES) throw new FirmwareFileError('This file is too small to be a bootloader.')
  if (file.length > MAX_BOOTLOADER_BYTES) throw new FirmwareFileError('This file is too big to be a motor controller bootloader (128 KB at most).')
  return {
    kind: 'bootloader',
    image: file,
    eraseBytes: file.length,
    compressed: false,
    uploadBytes: file.length,
    chunks: toChunks(file, BOOTLOADER_OFFSET),
  }
}

const isWordByte = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95

/**
 * Whether the image names this hardware. VESC firmware carries its hardware name as
 * a C string, though the linker may merge it into the end of a longer one (7.00 has
 * it only as "org.vesc.75_100"), so the name may follow any non-word byte. A missing
 * name is a strong hint the file is for other hardware; a found one is only a hint.
 */
export function namesHardware(image: Uint8Array, hwName: string): boolean {
  if (!hwName) return false
  const needle = [...new TextEncoder().encode(hwName), 0]
  outer: for (let i = 0; i + needle.length <= image.length; i++) {
    for (let k = 0; k < needle.length; k++) if (image[i + k] !== needle[k]) continue outer
    if (i === 0 || !isWordByte(image[i - 1])) return true
  }
  return false
}

/** What the bootloader does with the update area: check the header and CRC, then unpack. Null if it would refuse. */
export function bootloaderUnpack(area: Uint8Array): Uint8Array | null {
  if (area.length < 6) return null
  const r = new BufferReader(area)
  let size = r.u32()
  const crc = r.u16()
  const compressed = size >>> 24 === COMPRESSED_FLAG
  if (compressed) size &= 0x00ffffff
  if (size === 0 || size > BOOTLOADER_OFFSET || 6 + size > area.length) return null
  const data = area.subarray(6, 6 + size)
  if (crc16(data) !== crc) return null
  return compressed ? heatshrinkDecode(data) : data.slice()
}
