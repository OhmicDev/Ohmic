// The config signature, computed the way VESC Tool does (ConfigParams::getSignature):
// CRC-32C over every serialized field's name, type id, transmit id and enum names.
// The firmware build bakes the same number in as MCCONF_SIGNATURE / APPCONF_SIGNATURE.

import type { ConfigDefs } from './types'

let table: Uint32Array | null = null

function crcTable() {
  if (table) return table
  table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1
    table[n] = c >>> 0
  }
  return table
}

export function crc32c(data: Uint8Array): number {
  const t = crcTable()
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = t[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function computeSignature(defs: Pick<ConfigDefs, 'order' | 'params'>): number {
  let s = ''
  for (const name of defs.order) {
    s += name
    const p = defs.params[name]
    if (p) s += `${p.typeId}${p.txId}${p.enums.join('')}`
  }
  return crc32c(new TextEncoder().encode(s))
}
