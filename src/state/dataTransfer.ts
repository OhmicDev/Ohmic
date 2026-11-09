// Export and import of everything the app keeps: IndexedDB tables and the app
// settings, as one JSON file. Binary data (config bytes, ride columns) is stored
// as base64 with its array type. Importing merges: nothing already here is
// deleted, records with the same key are replaced by the file's copy, and
// numbered records (backups) are added unless an identical one exists. Tables and
// settings this version doesn't have, as in files from older versions, are ignored.

import { db } from './db'
import { useSettings } from './settings'

const EXPORT_FORMAT = 'ohmic-data'
const EXPORT_VERSION = 1

/** Tables keyed by their own id: the file's copy replaces one with the same key. */
const KEYED = ['faults', 'rideModes', 'tunes', 'rides', 'rideChunks', 'drafts'] as const
/** Auto-numbered tables: added unless the same record (by these fields) is already here. */
const NUMBERED = {
  backups: ['createdAt', 'deviceUuid', 'kind', 'title'],
  packageBackups: ['createdAt', 'deviceUuid', 'signature'],
} as const

type TableName = (typeof KEYED)[number] | keyof typeof NUMBERED
const TABLES: TableName[] = [...KEYED, ...(Object.keys(NUMBERED) as (keyof typeof NUMBERED)[])]

/** Per-device memory, left out of the file: it doesn't travel. */
const SETTINGS_SKIPPED = ['lastConnection', 'deviceViews', 'absArmed', 'regenArmed', 'singleMotorKey'] as const

interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: number
  app: string
  exportedAt: number
  settings: Record<string, unknown>
  tables: Partial<Record<TableName, unknown[]>>
}

type ArrayName = 'Uint8Array' | 'Int8Array' | 'Uint16Array' | 'Int16Array' | 'Uint32Array' | 'Int32Array' | 'Float32Array' | 'Float64Array'
const ARRAYS: Record<ArrayName, new (b: ArrayBuffer) => ArrayBufferView> = {
  Uint8Array,
  Int8Array,
  Uint16Array,
  Int16Array,
  Uint32Array,
  Int32Array,
  Float32Array,
  Float64Array,
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** Copies a value into plain JSON, turning typed arrays into {$array, $b64}. */
function encode(v: unknown): unknown {
  if (ArrayBuffer.isView(v)) {
    const type = v.constructor.name as ArrayName
    if (!(type in ARRAYS)) throw new Error(`Can’t export a ${type}.`)
    return { $array: type, $b64: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) }
  }
  if (Array.isArray(v)) return v.map(encode)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]))
  return v
}

function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.$array === 'string' && typeof o.$b64 === 'string') {
      const Ctor = ARRAYS[o.$array as ArrayName]
      if (!Ctor) throw new Error(`Unknown data type in the file: ${o.$array}.`)
      const bytes = fromBase64(o.$b64)
      return new Ctor(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]))
  }
  return v
}

function exportableSettings(): Record<string, unknown> {
  const s = useSettings.getState() as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === 'function' || (SETTINGS_SKIPPED as readonly string[]).includes(k)) continue
    out[k] = v
  }
  return out
}

export async function exportAll(app: string): Promise<ExportFile> {
  const tables: ExportFile['tables'] = {}
  for (const name of TABLES) tables[name] = (await db.table(name).toArray()).map(encode)
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, app, exportedAt: Date.now(), settings: exportableSettings(), tables }
}

export interface ImportPlan {
  file: ExportFile
  /** Records per table in the file. */
  counts: Partial<Record<TableName, number>>
  rides: number
  backups: number
  exportedAt: number
}

/** Reads and checks a file; nothing is changed yet. */
export function readExport(text: string): ImportPlan {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This isn’t an Ohmic data file (it isn’t JSON).')
  }
  const f = raw as Partial<ExportFile>
  if (!f || f.format !== EXPORT_FORMAT) throw new Error('This isn’t an Ohmic data file.')
  if (typeof f.version !== 'number' || f.version > EXPORT_VERSION) throw new Error('This file comes from a newer version of Ohmic. Update the app first.')
  if (!f.tables || typeof f.tables !== 'object') throw new Error('The file has no data in it.')
  const counts: ImportPlan['counts'] = {}
  for (const name of TABLES) {
    const rows = f.tables[name]
    if (rows === undefined) continue
    if (!Array.isArray(rows)) throw new Error(`The file is damaged (${name}).`)
    counts[name] = rows.length
  }
  return { file: f as ExportFile, counts, rides: counts.rides ?? 0, backups: counts.backups ?? 0, exportedAt: f.exportedAt ?? 0 }
}

export interface ImportResult {
  added: number
  replaced: number
  skipped: number
}

const sameBy = (fields: readonly string[], a: Record<string, unknown>, b: Record<string, unknown>) => fields.every((k) => a[k] === b[k])

/** Merges a checked file into this device's data. */
export async function importAll(plan: ImportPlan, { settings = true } = {}): Promise<ImportResult> {
  const result: ImportResult = { added: 0, replaced: 0, skipped: 0 }
  const tables = plan.file.tables
  await db.transaction('rw', TABLES.map((n) => db.table(n)), async () => {
    for (const name of KEYED) {
      const rows = tables[name]
      if (!rows?.length) continue
      const table = db.table(name)
      const decoded = rows.map(decode) as Record<string, unknown>[]
      const keys = decoded.map((r) => keyOf(table.schema.primKey.keyPath, r))
      const existing = await table.bulkGet(keys as never[])
      result.replaced += existing.filter(Boolean).length
      result.added += existing.filter((x) => !x).length
      await table.bulkPut(decoded)
    }
    for (const [name, fields] of Object.entries(NUMBERED) as [keyof typeof NUMBERED, readonly string[]][]) {
      const rows = tables[name]
      if (!rows?.length) continue
      const table = db.table(name)
      const here = (await table.toArray()) as Record<string, unknown>[]
      const fresh: Record<string, unknown>[] = []
      for (const r of rows.map(decode) as Record<string, unknown>[]) {
        if (here.some((h) => sameBy(fields, h, r)) || fresh.some((h) => sameBy(fields, h, r))) {
          result.skipped++
          continue
        }
        const { id: _id, ...rest } = r
        void _id
        fresh.push(rest)
      }
      if (fresh.length) await table.bulkAdd(fresh)
      result.added += fresh.length
    }
  })
  if (settings && plan.file.settings) {
    const cur = useSettings.getState()
    const incoming = { ...plan.file.settings } as Record<string, unknown>
    for (const k of SETTINGS_SKIPPED) delete incoming[k]
    for (const k of Object.keys(incoming)) if (!(k in cur) || typeof (cur as unknown as Record<string, unknown>)[k] === 'function') delete incoming[k]
    useSettings.setState(incoming as Partial<typeof cur>)
  }
  return result
}

function keyOf(keyPath: string | string[] | null | undefined, r: Record<string, unknown>): unknown {
  if (Array.isArray(keyPath)) return keyPath.map((k) => r[k])
  return keyPath ? r[keyPath] : undefined
}
