// A small MP4 writer for one H.264 video track: ftyp, then moov (so it can start playing before
// it has fully loaded), then mdat with every frame in one chunk. Frames must be in decode order
// with no B-frames (each frame's time is its index / fps).

const u8 = (n) => Buffer.from([n & 0xff])
const u16 = (n) => {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(n & 0xffff)
  return b
}
const u32 = (n) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0)
  return b
}
const text = (s) => Buffer.from(s, 'latin1')
const box = (type, ...parts) => {
  const body = Buffer.concat(parts.flat())
  return Buffer.concat([u32(body.length + 8), text(type), body])
}
const fullBox = (type, version, flags, ...parts) => box(type, u8(version), Buffer.from([(flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...parts)
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32)

const PRIMARIES = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 }
const TRANSFER = { bt709: 1, smpte170m: 6, linear: 8, 'iec61966-2-1': 13, pq: 16, hlg: 18 }
const MATRICES = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, 'bt2020-ncl': 9 }

/**
 * @param {{ width: number, height: number, fps: number, avcC: Buffer,
 *   colorSpace?: { primaries?: string, transfer?: string, matrix?: string, fullRange?: boolean } | null,
 *   samples: { data: Buffer, key: boolean }[] }} o
 */
export function muxMp4({ width, height, fps, avcC, colorSpace, samples }) {
  const n = samples.length
  const timescale = fps * 1000
  const delta = 1000
  const mediaDuration = n * delta
  const movieDuration = Math.round((n * 1000) / fps)

  const cs = colorSpace ?? {}
  const colr =
    cs.primaries in PRIMARIES && cs.transfer in TRANSFER && cs.matrix in MATRICES
      ? [box('colr', text('nclx'), u16(PRIMARIES[cs.primaries]), u16(TRANSFER[cs.transfer]), u16(MATRICES[cs.matrix]), u8(cs.fullRange ? 0x80 : 0))]
      : []

  const ftyp = box('ftyp', text('isom'), u32(0x200), text('isom'), text('iso2'), text('avc1'), text('mp41'))

  const moov = (chunkOffset) => {
    const avc1 = box(
      'avc1',
      Buffer.alloc(6), // reserved
      u16(1), // data reference index
      Buffer.alloc(16), // pre-defined and reserved
      u16(width),
      u16(height),
      u32(0x00480000), // 72 dpi
      u32(0x00480000),
      u32(0),
      u16(1), // frames per sample
      Buffer.alloc(32), // compressor name
      u16(0x18), // depth
      Buffer.from([0xff, 0xff]),
      box('avcC', avcC),
      ...colr,
      box('pasp', u32(1), u32(1)),
    )
    const keys = samples.flatMap((s, i) => (s.key ? [i + 1] : []))
    const stbl = box(
      'stbl',
      fullBox('stsd', 0, 0, u32(1), avc1),
      fullBox('stts', 0, 0, u32(1), u32(n), u32(delta)),
      fullBox('stss', 0, 0, u32(keys.length), ...keys.map(u32)),
      fullBox('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
      fullBox('stsz', 0, 0, u32(0), u32(n), ...samples.map((s) => u32(s.data.length))),
      fullBox('stco', 0, 0, u32(1), u32(chunkOffset)),
    )
    const minf = box(
      'minf',
      fullBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)),
      box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1))),
      stbl,
    )
    const mdia = box(
      'mdia',
      fullBox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(mediaDuration), u16(0x55c4), u16(0)), // language "und"
      fullBox('hdlr', 0, 0, u32(0), text('vide'), Buffer.alloc(12), text('VideoHandler\0')),
      minf,
    )
    const tkhd = fullBox(
      'tkhd',
      0,
      3, // enabled, in movie
      u32(0),
      u32(0),
      u32(1), // track id
      u32(0),
      u32(movieDuration),
      Buffer.alloc(8),
      u16(0), // layer
      u16(0), // alternate group
      u16(0), // volume
      u16(0),
      ...MATRIX,
      u32(width * 65536),
      u32(height * 65536),
    )
    const mvhd = fullBox(
      'mvhd',
      0,
      0,
      u32(0),
      u32(0),
      u32(1000),
      u32(movieDuration),
      u32(0x00010000), // rate 1.0
      u16(0x0100), // volume 1.0
      Buffer.alloc(10),
      ...MATRIX,
      Buffer.alloc(24),
      u32(2), // next track id
    )
    return box('moov', mvhd, box('trak', tkhd, mdia))
  }

  const dataSize = samples.reduce((sum, s) => sum + s.data.length, 0)
  const offset = ftyp.length + moov(0).length + 8
  const mdat = [u32(dataSize + 8), text('mdat'), ...samples.map((s) => s.data)]
  return Buffer.concat([ftyp, moov(offset), ...mdat])
}
