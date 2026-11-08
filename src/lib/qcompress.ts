// Qt's qCompress / qUncompress: a big-endian u32 with the uncompressed size,
// then a zlib stream. VESC packages, package archives and custom-config XML use it.

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

export async function qUncompress(data: Uint8Array): Promise<Uint8Array> {
  if (data.length < 4) throw new Error('Compressed data is too short')
  const expected = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, false)
  let out: Uint8Array
  try {
    out = await pipe(data.subarray(4), new DecompressionStream('deflate'))
  } catch {
    throw new Error('Compressed data is damaged')
  }
  if (out.length !== expected) throw new Error(`Compressed data is damaged: expected ${expected} bytes, got ${out.length}`)
  return out
}

export async function qCompress(data: Uint8Array): Promise<Uint8Array> {
  const z = await pipe(data, new CompressionStream('deflate'))
  const out = new Uint8Array(4 + z.length)
  new DataView(out.buffer).setUint32(0, data.length, false)
  out.set(z, 4)
  return out
}

/**
 * qCompress without compression (zlib "stored" blocks), done synchronously.
 * Any zlib reader unpacks it; the simulator uses it where it can't wait.
 */
export function qCompressStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 65535))
  const out = new Uint8Array(4 + 2 + blocks * 5 + data.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length, false)
  out[4] = 0x78
  out[5] = 0x01
  let o = 6
  for (let b = 0; b < blocks; b++) {
    const chunk = data.subarray(b * 65535, (b + 1) * 65535)
    out[o++] = b === blocks - 1 ? 1 : 0
    view.setUint16(o, chunk.length, true)
    view.setUint16(o + 2, ~chunk.length & 0xffff, true)
    o += 4
    out.set(chunk, o)
    o += chunk.length
  }
  let a = 1
  let s = 0
  for (const byte of data) {
    a = (a + byte) % 65521
    s = (s + a) % 65521
  }
  view.setUint32(o, ((s << 16) | a) >>> 0, false)
  return out
}
