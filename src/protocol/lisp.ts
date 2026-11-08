// LispBM scripts stored on the controller (bldc lispBM/lispif.c, VESC Tool
// codeloader.cpp). A script goes up as one blob:
//
//   program = [u16 flags = 0][code text][0x00][i16 import count][imports…]
//   stored  = [u32 program.length - 2][u16 crc16(program)][program]
//
// written in 384-byte chunks after the storage area is erased. The firmware
// stops the script engine when the area is erased.

import { BufferReader, BufferWriter, ProtocolError } from './buffer'
import { crc16 } from './crc16'

/** Bytes per LISP_WRITE_CODE, as VESC Tool sends them. */
export const LISP_CHUNK = 384
/** Bytes per LISP_READ_CODE reply (the firmware caps it at its packet size minus headers). */
export const LISP_READ_CHUNK = 502
/** Room for scripts on an STM32 motor controller: one 128 KB flash page, minus the size and CRC. */
export const LISP_MAX_VESC = 128 * 1024 - 6
/** ESP32-based devices (VESC Express) have far more. */
export const LISP_MAX_OTHER = 8 * 1024 * 1024 - 6

/** The program part: flags, the code as UTF-8, a terminator and an empty import table. */
export function packLispProgram(code: string): Uint8Array {
  return new BufferWriter().u16(0).raw(new TextEncoder().encode(code)).u8(0).i16(0).toUint8Array()
}

/** What goes into the controller's script storage, size and CRC first. */
export function lispStorageBlob(program: Uint8Array): Uint8Array {
  return new BufferWriter()
    .u32(program.length - 2)
    .u16(crc16(program))
    .raw(program)
    .toUint8Array()
}

/** Code text from a program (flags, text up to the first 0x00). Imports aren't shown. */
export function unpackLispProgram(program: Uint8Array): { code: string; imports: number } {
  if (program.length < 3) return { code: '', imports: 0 }
  const body = program.subarray(2)
  let end = body.indexOf(0)
  if (end < 0) end = body.length
  const code = new TextDecoder().decode(body.subarray(0, end))
  const rest = body.subarray(end + 1)
  const imports = rest.length >= 2 ? new BufferReader(rest).i16() : 0
  return { code, imports }
}

/** Splits stored bytes back into the program, checking size and CRC. Null for an empty area. */
export function parseLispStorage(stored: Uint8Array): Uint8Array | null {
  if (stored.length < 6) return null
  const r = new BufferReader(stored)
  const size = r.u32()
  const crc = r.u16()
  if (size === 0xffffffff || size === 0) return null
  const program = stored.subarray(6, 6 + size + 2)
  if (program.length !== size + 2) throw new ProtocolError(`Stored script is cut short: expected ${size + 2} bytes, got ${program.length}`)
  if (crc16(program) !== crc) throw new ProtocolError('Stored script fails its checksum')
  return program
}

export function encodeLispErase(size: number): Uint8Array {
  return new BufferWriter().i32(size).toUint8Array()
}

export function encodeLispWrite(offset: number, data: Uint8Array): Uint8Array {
  return new BufferWriter().u32(offset).raw(data).toUint8Array()
}

export function decodeLispWriteReply(r: BufferReader): { ok: boolean; offset: number | null } {
  const ok = r.i8() === 1
  return { ok, offset: r.has(4) ? r.u32() : null }
}

export function encodeLispRead(len: number, offset: number): Uint8Array {
  return new BufferWriter().i32(len).i32(offset).toUint8Array()
}

export function decodeLispReadReply(r: BufferReader): { total: number; offset: number; data: Uint8Array } {
  const total = r.i32()
  const offset = r.i32()
  return { total, offset, data: r.rest() }
}

export function encodeLispRunning(running: boolean): Uint8Array {
  return Uint8Array.of(running ? 1 : 0)
}

export interface LispStats {
  /** Percent of the script thread's time spent evaluating. */
  cpu: number
  /** Percent of the cons heap in use after the last garbage collection. */
  heap: number
  /** Percent of LispBM memory (arrays, strings) in use. */
  mem: number
  /** Global variables holding numbers, as the firmware lists them. */
  bindings: { name: string; value: number }[]
}

export function decodeLispStats(r: BufferReader): LispStats {
  const cpu = r.f16(1e2)
  const heap = r.f16(1e2)
  const mem = r.f16(1e2)
  r.f16(1e2) // stack: unused by the firmware
  if (r.has(1)) r.cstring() // result of the last context: unused
  const bindings: LispStats['bindings'] = []
  while (r.remaining > 0) {
    const name = r.cstring()
    if (!r.has(4)) break
    bindings.push({ name, value: r.f32auto() })
  }
  return { cpu, heap, mem, bindings }
}

export function encodeLispStats(s: LispStats): Uint8Array {
  const w = new BufferWriter().f16(s.cpu, 1e2).f16(s.heap, 1e2).f16(s.mem, 1e2).f16(0, 1e2).u8(0)
  for (const b of s.bindings) w.cstring(b.name).f32auto(b.value)
  return w.toUint8Array()
}
