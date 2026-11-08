// CRC-16/XMODEM (CCITT polynomial 0x1021, initial value 0), as used by the
// VESC packet framing. Computed over the payload only.

const TABLE = (() => {
  const table = new Uint16Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i << 8
    for (let j = 0; j < 8; j++) {
      c = c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1
    }
    table[i] = c & 0xffff
  }
  return table
})()

export function crc16(data: Uint8Array, start = 0, end = data.length): number {
  let crc = 0
  for (let i = start; i < end; i++) {
    crc = (TABLE[((crc >> 8) ^ data[i]) & 0xff] ^ (crc << 8)) & 0xffff
  }
  return crc
}
