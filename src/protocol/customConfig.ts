// Settings that packages and custom hardware add (bldc conf_custom.c, VESC Tool
// commands.cpp). The controller describes them with VESC Tool parameter XML,
// qCompressed, read in chunks:
//   GET_CUSTOM_CONFIG_XML  [i8 index][i32 length][i32 offset] → [i8 index][i32 total][i32 offset][data]
//   GET_CUSTOM_CONFIG(_DEFAULT) [i8 index] → [i8 index][signature + fields]
//   SET_CUSTOM_CONFIG [i8 index][signature + fields] → [i8 index]

import { BufferReader, BufferWriter } from './buffer'

/** Bytes per XML chunk request. */
export const CUSTOM_XML_CHUNK = 400

export function encodeCustomXmlRequest(index: number, len: number, offset: number): Uint8Array {
  return new BufferWriter().i8(index).i32(len).i32(offset).toUint8Array()
}

export function decodeCustomXmlChunk(r: BufferReader): { index: number; total: number; offset: number; data: Uint8Array } {
  const index = r.i8()
  const total = r.i32()
  const offset = r.i32()
  return { index, total, offset, data: r.rest() }
}

export function encodeCustomIndex(index: number, body: Uint8Array = new Uint8Array()): Uint8Array {
  return new BufferWriter().i8(index).raw(body).toUint8Array()
}
