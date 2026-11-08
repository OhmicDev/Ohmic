// Heatshrink compression (an LZSS), as VESC Tool and the VESC bootloader use it
// for firmware images that don't fit the update area: a window of 2^13 bytes and
// matches of up to 2^5 bytes (heatshrink_config.h in both projects).
//
// The stream is read most significant bit first:
//   literal:        1, then the byte (8 bits)
//   back-reference: 0, then (distance - 1) in 13 bits, then (length - 1) in 5 bits
// A back-reference costs 19 bits, so only matches of 3 bytes or more are used,
// as in the reference encoder. Matches may overlap the bytes they produce (runs).
// The decoder's window starts zero-filled; this encoder never refers before the start.

export const HS_WINDOW_BITS = 13
export const HS_LOOKAHEAD_BITS = 5
const WINDOW = 1 << HS_WINDOW_BITS
const MAX_LEN = 1 << HS_LOOKAHEAD_BITS
const MIN_LEN = 3
const HASH_SIZE = 1 << 16
/** Candidates looked at per position; plenty for firmware, and keeps big files fast. */
const MAX_CHAIN = 256

export function heatshrinkEncode(input: Uint8Array): Uint8Array {
  const n = input.length
  const out = new Uint8Array(Math.ceil((n * 9) / 8) + 8)
  let o = 0
  let cur = 0
  let mask = 0x80
  const push = (count: number, bits: number) => {
    for (let i = count - 1; i >= 0; i--) {
      if ((bits >> i) & 1) cur |= mask
      mask >>= 1
      if (mask === 0) {
        out[o++] = cur
        cur = 0
        mask = 0x80
      }
    }
  }

  // Hash chains over 3-byte prefixes find earlier occurrences quickly.
  const head = new Int32Array(HASH_SIZE).fill(-1)
  const prev = new Int32Array(n)
  const hash = (p: number) => ((input[p] << 8) ^ (input[p + 1] << 4) ^ (input[p + 2] * 0x9e)) & (HASH_SIZE - 1)
  const insert = (p: number) => {
    if (p + 2 >= n) return
    const h = hash(p)
    prev[p] = head[h]
    head[h] = p
  }

  let i = 0
  while (i < n) {
    const maxLen = Math.min(MAX_LEN, n - i)
    let bestLen = 0
    let bestDist = 0
    if (maxLen >= MIN_LEN) {
      let p = head[hash(i)]
      for (let steps = 0; p >= 0 && i - p <= WINDOW && steps < MAX_CHAIN; steps++) {
        if (input[p + bestLen] === input[i + bestLen]) {
          let len = 0
          while (len < maxLen && input[p + len] === input[i + len]) len++
          if (len > bestLen) {
            bestLen = len
            bestDist = i - p
            if (len === maxLen) break
          }
        }
        p = prev[p]
      }
    }
    if (bestLen >= MIN_LEN) {
      push(1, 0)
      push(HS_WINDOW_BITS, bestDist - 1)
      push(HS_LOOKAHEAD_BITS, bestLen - 1)
      for (let k = 0; k < bestLen; k++) insert(i + k)
      i += bestLen
    } else {
      push(1, 1)
      push(8, input[i])
      insert(i)
      i++
    }
  }
  if (mask !== 0x80) out[o++] = cur
  return out.slice(0, o)
}

/** The bootloader's side. A trailing partial token (padding bits) is ignored, like the reference decoder. */
export function heatshrinkDecode(input: Uint8Array): Uint8Array {
  let out = new Uint8Array(Math.max(64, input.length * 4))
  let o = 0
  const ensure = (extra: number) => {
    if (o + extra <= out.length) return
    const next = new Uint8Array(Math.max(out.length * 2, o + extra))
    next.set(out.subarray(0, o))
    out = next
  }
  const total = input.length * 8
  let pos = 0
  const read = (count: number) => {
    if (pos + count > total) return -1
    let v = 0
    for (let k = 0; k < count; k++, pos++) v = (v << 1) | ((input[pos >> 3] >> (7 - (pos & 7))) & 1)
    return v
  }
  for (;;) {
    const tag = read(1)
    if (tag < 0) break
    if (tag === 1) {
      const b = read(8)
      if (b < 0) break
      ensure(1)
      out[o++] = b
      continue
    }
    const index = read(HS_WINDOW_BITS)
    if (index < 0) break
    const count = read(HS_LOOKAHEAD_BITS)
    if (count < 0) break
    const dist = index + 1
    ensure(count + 1)
    for (let k = 0; k <= count; k++, o++) out[o] = o - dist >= 0 ? out[o - dist] : 0
  }
  return out.slice(0, o)
}
