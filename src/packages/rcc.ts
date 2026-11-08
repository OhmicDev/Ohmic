// Reads Qt binary resource files (.rcc), the format of VESC's package archive
// (vesc_pkg_all.rcc). Layout, big-endian:
//   "qres" [u32 version][u32 tree][u32 data][u32 names] ([u32 flags] from version 3)
// Tree nodes are 14 bytes (22 from version 2, with a u64 modification time):
//   [u32 name][u16 flags] then a directory's [u32 child count][u32 first child]
//   or a file's [u16 country][u16 language][u32 data offset]
// Names: [u16 length][u32 hash][UTF-16BE]. Data: [u32 size][bytes], qCompressed when flag 1 is set.

import { qUncompress } from '../lib/qcompress'

const FLAG_COMPRESSED = 0x01
const FLAG_DIRECTORY = 0x02
const FLAG_ZSTD = 0x04

export interface RccFile {
  path: string
  read: () => Promise<Uint8Array>
}

export class RccError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RccError'
  }
}

export function readRcc(bytes: Uint8Array): RccFile[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (o: number) => view.getUint16(o, false)
  const u32 = (o: number) => view.getUint32(o, false)
  if (bytes.length < 20 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'qres') throw new RccError("This isn't a Qt resource file.")
  const version = u32(4)
  if (version < 1 || version > 3) throw new RccError(`Unsupported resource file version ${version}.`)
  const tree = u32(8)
  const data = u32(12)
  const names = u32(16)
  const nodeSize = version >= 2 ? 22 : 14
  const check = (o: number, n: number) => {
    if (o < 0 || o + n > bytes.length) throw new RccError('The resource file is damaged.')
  }

  const nameAt = (off: number) => {
    const o = names + off
    check(o, 6)
    const len = u16(o)
    check(o + 6, len * 2)
    let s = ''
    for (let i = 0; i < len; i++) s += String.fromCharCode(u16(o + 6 + i * 2))
    return s
  }

  const out: RccFile[] = []
  const walk = (index: number, prefix: string, depth: number) => {
    if (depth > 32) throw new RccError('The resource file is damaged.')
    const o = tree + index * nodeSize
    check(o, nodeSize)
    const flags = u16(o + 4)
    const name = index === 0 ? '' : nameAt(u32(o))
    const path = index === 0 ? '' : `${prefix}/${name}`
    if (flags & FLAG_DIRECTORY) {
      const count = u32(o + 6)
      const first = u32(o + 10)
      if (count > 100_000) throw new RccError('The resource file is damaged.')
      for (let i = 0; i < count; i++) walk(first + i, path, depth + 1)
      return
    }
    const dataOff = data + u32(o + 10)
    check(dataOff, 4)
    const size = u32(dataOff)
    check(dataOff + 4, size)
    const raw = bytes.subarray(dataOff + 4, dataOff + 4 + size)
    out.push({
      path,
      read: async () => {
        if (flags & FLAG_ZSTD) throw new RccError(`${path} uses zstd compression, which this app can't read.`)
        return flags & FLAG_COMPRESSED ? qUncompress(raw) : raw.slice()
      },
    })
  }
  walk(0, '', 0)
  return out
}

/** Builds an uncompressed version-2 resource file (tests and the demo archive). */
export function writeRcc(files: { path: string; data: Uint8Array }[]): Uint8Array {
  interface Dir {
    name: string
    dirs: Map<string, Dir>
    files: { name: string; data: Uint8Array }[]
  }
  const root: Dir = { name: '', dirs: new Map(), files: [] }
  for (const f of files) {
    const parts = f.path.replace(/^\/+/, '').split('/')
    let d = root
    for (const p of parts.slice(0, -1)) {
      if (!d.dirs.has(p)) d.dirs.set(p, { name: p, dirs: new Map(), files: [] })
      d = d.dirs.get(p)!
    }
    d.files.push({ name: parts[parts.length - 1], data: f.data })
  }

  type Node = { name: string; dir?: Dir; data?: Uint8Array }
  const nodes: Node[] = [{ name: '', dir: root }]
  const children = new Map<number, [number, number]>()
  // Breadth-first so each directory's children sit next to each other.
  for (let i = 0; i < nodes.length; i++) {
    const d = nodes[i].dir
    if (!d) continue
    const kids: Node[] = [...[...d.dirs.values()].map((x) => ({ name: x.name, dir: x })), ...d.files.map((f) => ({ name: f.name, data: f.data }))]
    children.set(i, [kids.length, nodes.length])
    nodes.push(...kids)
  }

  const nameBytes: number[] = []
  const nameOff = new Map<string, number>()
  const dataBytes: number[] = []
  const push32 = (arr: number[], v: number) => arr.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)
  const push16 = (arr: number[], v: number) => arr.push((v >>> 8) & 0xff, v & 0xff)
  const nameIndex = (n: string) => {
    if (!nameOff.has(n)) {
      nameOff.set(n, nameBytes.length)
      push16(nameBytes, n.length)
      push32(nameBytes, 0)
      for (const ch of n) push16(nameBytes, ch.charCodeAt(0))
    }
    return nameOff.get(n)!
  }
  const treeBytes: number[] = []
  nodes.forEach((n, i) => {
    push32(treeBytes, i === 0 ? 0 : nameIndex(n.name))
    if (n.dir) {
      push16(treeBytes, FLAG_DIRECTORY)
      const [count, first] = children.get(i)!
      push32(treeBytes, count)
      push32(treeBytes, first)
    } else {
      push16(treeBytes, 0)
      push16(treeBytes, 0)
      push16(treeBytes, 0)
      push32(treeBytes, dataBytes.length)
      push32(dataBytes, n.data!.length)
      dataBytes.push(...n.data!)
    }
    for (let k = 0; k < 8; k++) treeBytes.push(0)
  })

  const header = 20
  const tree = header
  const names = tree + treeBytes.length
  const data = names + nameBytes.length
  const out: number[] = [...'qres'].map((c) => c.charCodeAt(0))
  push32(out, 2)
  push32(out, tree)
  push32(out, data)
  push32(out, names)
  out.push(...treeBytes, ...nameBytes, ...dataBytes)
  return Uint8Array.from(out)
}
