// VESC packages (.vescpkg), as VESC Tool's CodeLoader packs them:
//   qCompress( "VESC Packet\0"  then entries of  key\0 [i32 length][bytes] )
// Keys: name, description (rich text), description_md, lispData (a packed LispBM
// program with its imports), qmlFile, pkgDescQml, qmlIsFullscreen. Unknown keys are skipped.

import { BufferReader, BufferWriter, ProtocolError } from '../protocol/buffer'
import { qCompress, qUncompress } from '../lib/qcompress'

export interface VescPackage {
  name: string
  description: string
  descriptionMd: string
  /** Packed LispBM program (flags, code, imports), or null when the package has no script. */
  lispData: Uint8Array | null
  /** QML user interface, which a browser can't show. */
  qmlFile: string | null
  qmlFullscreen: boolean
  /** A library only provides code for other scripts to import. */
  isLibrary: boolean
}

const MAGIC = 'VESC Packet'

export async function unpackVescPackage(file: Uint8Array, opts: { isLibrary?: boolean } = {}): Promise<VescPackage> {
  let raw: Uint8Array
  try {
    raw = await qUncompress(file)
  } catch {
    throw new ProtocolError("This isn't a VESC package (it doesn't unpack).")
  }
  const r = new BufferReader(raw)
  let magic = ''
  try {
    magic = r.cstring()
  } catch {
    // falls through to the check below
  }
  if (magic !== MAGIC) throw new ProtocolError("This isn't a VESC package.")
  const pkg: VescPackage = {
    name: '',
    description: '',
    descriptionMd: '',
    lispData: null,
    qmlFile: null,
    qmlFullscreen: false,
    isLibrary: opts.isLibrary ?? false,
  }
  const text = (b: Uint8Array) => new TextDecoder().decode(b)
  while (r.remaining > 0) {
    const key = r.cstring()
    if (!key) break
    const len = r.i32()
    if (len < 0 || !r.has(len)) throw new ProtocolError(`Package entry "${key}" is cut short.`)
    const data = r.bytes(len)
    switch (key) {
      case 'name':
        pkg.name = text(data)
        break
      case 'description':
        pkg.description = text(data)
        break
      case 'description_md':
        pkg.descriptionMd = text(data)
        break
      case 'lispData':
        pkg.lispData = data.length ? data : null
        break
      case 'qmlFile':
        pkg.qmlFile = data.length ? text(data) : null
        break
      case 'qmlIsFullscreen':
        pkg.qmlFullscreen = data.length > 0 && data[0] !== 0
        break
    }
  }
  if (!pkg.name) throw new ProtocolError('The package has no name.')
  return pkg
}

/** Packs a package the way VESC Tool does (used by the demo archive and tests). */
export async function packVescPackage(pkg: Omit<VescPackage, 'isLibrary'>): Promise<Uint8Array> {
  const w = new BufferWriter().cstring(MAGIC)
  const enc = new TextEncoder()
  const entry = (key: string, data: Uint8Array) => w.cstring(key).i32(data.length).raw(data)
  entry('name', enc.encode(pkg.name))
  entry('description', enc.encode(pkg.description))
  if (pkg.descriptionMd) entry('description_md', enc.encode(pkg.descriptionMd))
  if (pkg.lispData) entry('lispData', pkg.lispData)
  if (pkg.qmlFile) entry('qmlFile', enc.encode(pkg.qmlFile))
  entry('qmlIsFullscreen', Uint8Array.of(pkg.qmlFullscreen ? 1 : 0))
  return qCompress(w.toUint8Array())
}

/** Plain text from VESC Tool's Qt rich-text descriptions, for when there's no Markdown. */
export function richTextToPlain(html: string): string {
  if (!/<[a-z!/][\s\S]*>/i.test(html)) return html.trim()
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|tr|ul|ol|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
