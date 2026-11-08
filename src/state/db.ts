// The app's IndexedDB database (Dexie). Important data lives here, never in localStorage.

import Dexie, { type EntityTable, type Table } from 'dexie'
import type { AiLogEntry } from '../ai/log'
import type { VehicleProfile } from '../ai/profile'
import type { Backup } from './backups'
import type { RideChunk, RideLog } from './rideLogs'
import type { FaultEvent } from './faults'
import type { CustomTune } from './onboard'
import type { LiveLimitsRecord, RideMode } from './rideModes'

/** Text the user is working on (the LispBM editor), so a reload doesn't lose it. */
export interface Draft {
  id: string
  text: string
  name: string | null
  savedAt: number
}

/** A package's settings as they were before Ohmic wrote them. */
export interface PackageBackup {
  id: number
  createdAt: number
  deviceUuid: string | null
  deviceName: string
  /** The custom config's name, e.g. its first group. */
  configName: string
  signature: number
  changes: { name: string; label: string; from: number | string; to: number | string }[]
  raw: Uint8Array
  values: Record<string, number | string>
}

class OhmicDb extends Dexie {
  backups!: EntityTable<Backup, 'id'>
  faults!: EntityTable<FaultEvent, 'uid'>
  rideModes!: EntityTable<RideMode, 'id'>
  liveLimits!: EntityTable<LiveLimitsRecord, 'key'>
  tunes!: EntityTable<CustomTune, 'id'>
  rides!: EntityTable<RideLog, 'id'>
  rideChunks!: Table<RideChunk, [string, number]>
  aiLog!: EntityTable<AiLogEntry, 'id'>
  aiProfile!: EntityTable<VehicleProfile, 'id'>
  drafts!: EntityTable<Draft, 'id'>
  packageBackups!: EntityTable<PackageBackup, 'id'>

  constructor(name = 'ohmic') {
    super(name)
    // Only indexed fields are listed; everything else is stored as-is.
    this.version(1).stores({
      backups: '++id, createdAt, deviceUuid, kind, [deviceUuid+kind]',
    })
    this.version(2).stores({
      faults: 'uid, at, deviceUuid',
    })
    this.version(3).stores({
      rideModes: 'id, order',
      // Temporary limits sent to each controller, so a reload knows a ride mode is still active.
      liveLimits: 'key',
      // Tunes the user added for the motor sound player.
      tunes: 'id, addedAt',
    })
    this.version(4).stores({
      rides: 'id, startedAt',
      // Each ride's rows, a few thousand at a time, packed as typed-array columns.
      rideChunks: '[rideId+seq], rideId',
    })
    this.version(5).stores({
      // Every AI proposal and what the rider did with it.
      aiLog: '++id, at, proposalId',
      // What the rider told the tuning assistant about the vehicle (one row).
      aiProfile: 'id',
    })
    this.version(6).stores({
      drafts: 'id',
      packageBackups: '++id, createdAt, deviceUuid, signature',
    })
  }
}

export const db = new OhmicDb()

const FAULTS_KEPT = 500

export async function loadFaultEvents(): Promise<FaultEvent[]> {
  return db.faults.orderBy('at').reverse().limit(FAULTS_KEPT).toArray()
}

/** Adds or updates one fault, keeping the newest few hundred. */
export async function saveFaultEvent(e: FaultEvent) {
  await db.faults.put(e)
  const extra = (await db.faults.count()) - FAULTS_KEPT
  if (extra > 0) await db.faults.orderBy('at').limit(extra).delete()
}

export async function clearFaultEvents() {
  await db.faults.clear()
}
