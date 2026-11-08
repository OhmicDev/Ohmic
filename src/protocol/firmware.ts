// Firmware update commands (bldc commands.c), as VESC Tool sends them:
//   COMM_ERASE_NEW_APP       u32 image size          → u8 ok
//   COMM_WRITE_NEW_APP_DATA  u32 offset, then bytes  → u8 ok [, u32 offset]
//   COMM_ERASE_BOOTLOADER    (nothing)               → u8 ok
//   COMM_JUMP_TO_BOOTLOADER  (nothing)               → no reply: it restarts
// Writes land in the update area; offsets at 393 216 and up reach the bootloader.

import { BufferReader, BufferWriter } from './buffer'

export const encodeEraseNewApp = (bytes: number) => new BufferWriter().u32(bytes).toUint8Array()

export const encodeWriteNewAppData = (offset: number, data: Uint8Array) => new BufferWriter().u32(offset).raw(data).toUint8Array()

export function decodeWriteNewAppData(body: Uint8Array): { offset: number; data: Uint8Array } {
  const r = new BufferReader(body)
  const offset = r.u32()
  return { offset, data: r.rest() }
}

/** A write reply: ok, and (firmware 5.3 and newer) the offset it was for. */
export function decodeWriteReply(r: BufferReader): { ok: boolean; offset: number | null } {
  const ok = r.u8() === 1
  return { ok, offset: r.has(4) ? r.u32() : null }
}
