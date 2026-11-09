// Config backups, kept in IndexedDB (Dexie) so they survive reloads and never
// depend on localStorage. One is made automatically before every write.

import type { ConfigKind, ConfigValue, ConfigValues } from '../config/types'
import { db } from './db'

export { db }

interface BackupChange {
  name: string
  label: string
  from: ConfigValue
  to: ConfigValue
}

type BackupReason = 'before-write' | 'before-update' | 'manual' | 'imported'

export interface Backup {
  id: number
  createdAt: number
  reason: BackupReason
  /** Short title shown in lists, e.g. "Before writing 3 changes". */
  title: string
  /** What the write was about to change (empty for manual backups). */
  changes: BackupChange[]
  kind: ConfigKind
  deviceUuid: string | null
  /** Hardware name plus where it was, e.g. "SIM_75_100 · CAN 2". */
  deviceName: string
  hwName: string
  /** Firmware the settings belong to, e.g. "6.06". */
  fw: string
  signature: number
  /** Exact bytes the controller sent (signature + fields), when read from a controller. */
  raw: Uint8Array | null
  values: ConfigValues
}

type NewBackup = Omit<Backup, 'id' | 'createdAt'> & { createdAt?: number }

export async function addBackup(b: NewBackup): Promise<number> {
  const id = await db.backups.add({ ...b, createdAt: b.createdAt ?? Date.now() } as Backup)
  notify()
  return id
}

/** Newest first. */
export async function listBackups(filter: { deviceUuid?: string | null; kind?: ConfigKind } = {}): Promise<Backup[]> {
  const all = await db.backups.orderBy('createdAt').reverse().toArray()
  return all.filter(
    (b) => (filter.deviceUuid === undefined || b.deviceUuid === filter.deviceUuid) && (!filter.kind || b.kind === filter.kind),
  )
}

export async function deleteBackup(id: number) {
  await db.backups.delete(id)
  notify()
}

type Listener = () => void
const listeners = new Set<Listener>()
/** Lets lists refresh when backups change. */
export function onBackupsChanged(cb: Listener): () => void {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}
function notify() {
  for (const l of listeners) l()
}
