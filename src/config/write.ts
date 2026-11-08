// The one way settings reach a controller:
//   validate → review the diff → backup → write → read back → verify → report.
// Nothing here clamps or "fixes" a value; differences after the write are reported.

import { ConfigRejectedError, TimeoutError, type Target, type VescClient } from '../client/VescClient'
import { decodeConfig, encodeConfig, sameOnWire } from './codec'
import type { ConfigDefs, ConfigKind, ConfigValue, ConfigValues } from './types'
import { validateConfig, type Issue } from './validate'

export interface Change {
  name: string
  from: ConfigValue
  to: ConfigValue
}

/** Names whose values differ on the wire between two configs, in serialization order. */
export function diffValues(defs: ConfigDefs, a: ConfigValues, b: ConfigValues): string[] {
  return defs.order.filter((n) => !sameOnWire(defs.params[n], a[n], b[n]))
}

export function changesBetween(defs: ConfigDefs, before: ConfigValues, after: ConfigValues): Change[] {
  return diffValues(defs, before, after).map((name) => ({ name, from: before[name], to: after[name] }))
}

/**
 * Settings that belong to one controller and its motor, never copied to others
 * when writing "to all controllers": its CAN id, calibration and measured motor values.
 */
export function isPerDeviceParam(name: string): boolean {
  return (
    name === 'controller_id' ||
    name === 'm_invert_direction' ||
    name.startsWith('foc_offsets_') ||
    name.startsWith('hall_table__') ||
    name.startsWith('foc_hall_table__') ||
    name === 'foc_encoder_offset' ||
    name === 'foc_encoder_inverted' ||
    name === 'foc_encoder_ratio' ||
    name === 'foc_motor_r' ||
    name === 'foc_motor_l' ||
    name === 'foc_motor_ld_lq_diff' ||
    name === 'foc_motor_flux_linkage' ||
    name === 'foc_observer_gain' ||
    name === 'foc_current_kp' ||
    name === 'foc_current_ki' ||
    name.startsWith('m_encoder_') ||
    name.startsWith('imu_conf.')
  )
}

export interface WriteItem {
  /** Device key in the config store (UUID when known). */
  key: string
  target: Target
  deviceName: string
  kind: ConfigKind
  defs: ConfigDefs
  /** What the controller had when the user started editing. */
  before: ConfigValues
  /** What will be written. */
  after: ConfigValues
  changes: Change[]
  issues: Issue[]
  /**
   * Settings outside the motor and app configs (a package's custom config). They go
   * through the same steps, with their own read, write and backup.
   */
  custom?: CustomWriteIo
}

export interface CustomWriteIo {
  /** Shown where "motor" or "app" settings would be. */
  label: string
  read: () => Promise<Uint8Array>
  write: (body: Uint8Array) => Promise<void>
  backup: (item: WriteItem, current: { raw: Uint8Array; values: ConfigValues }) => Promise<number>
  onWritten?: (outcome: WriteOutcome) => void
}

export function makeItem(base: Omit<WriteItem, 'changes' | 'issues'>): WriteItem {
  return {
    ...base,
    changes: changesBetween(base.defs, base.before, base.after),
    issues: validateConfig(base.defs, base.after, { base: base.before }),
  }
}

/**
 * The same edit for another controller: the changed settings applied over that
 * controller's own values, skipping per-controller settings and any setting its
 * firmware doesn't have.
 */
export function shareChanges(
  source: WriteItem,
  other: Omit<WriteItem, 'after' | 'changes' | 'issues'>,
): { item: WriteItem; skipped: string[] } {
  const after = { ...other.before }
  const skipped: string[] = []
  for (const c of source.changes) {
    const p = other.defs.params[c.name]
    const mine = source.defs.params[c.name]
    if (isPerDeviceParam(c.name) || !p || p.typeId !== mine.typeId) {
      skipped.push(c.name)
      continue
    }
    after[c.name] = c.to
  }
  return { item: makeItem({ ...other, after }), skipped }
}

export type WriteStep = 'checking' | 'backup' | 'writing' | 'verifying'

export interface Adjustment {
  name: string
  wanted: ConfigValue
  got: ConfigValue
}

export type WriteOutcome =
  | { status: 'ok'; backupId: number; values: ConfigValues }
  /** Written, but the controller stored some values differently (hardware limits etc.). */
  | { status: 'adjusted'; backupId: number; values: ConfigValues; adjusted: Adjustment[] }
  /** Nothing was written. */
  | { status: 'failed'; backupId: number | null; error: string; values?: ConfigValues }
  /** The controller changed underneath us; nothing was written. */
  | { status: 'stale'; backupId: null; values: ConfigValues; changedOnDevice: string[] }

export interface WriteDeps {
  client: Pick<VescClient, 'getConfig' | 'setConfig'>
  /** Saves a backup of the controller's current settings; returns its id. */
  backup: (item: WriteItem, current: { raw: Uint8Array; values: ConfigValues }) => Promise<number>
  onStep?: (step: WriteStep) => void
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function writeConfig(item: WriteItem, deps: WriteDeps): Promise<WriteOutcome> {
  const { client, onStep } = deps
  const opts = { target: item.target }

  // 1. Read what's on the controller right now. If it no longer matches what the
  //    user reviewed (changed from another app or controller), stop.
  onStep?.('checking')
  let raw: Uint8Array
  let current: ConfigValues
  try {
    raw = await client.getConfig(item.kind, opts)
    current = decodeConfig(item.defs, raw)
  } catch (e) {
    return { status: 'failed', backupId: null, error: `Couldn't read the current settings: ${errText(e)}` }
  }
  const changedOnDevice = diffValues(item.defs, current, item.before)
  if (changedOnDevice.length) return { status: 'stale', backupId: null, values: current, changedOnDevice }

  // 2. Backup first. No backup, no write.
  onStep?.('backup')
  let backupId: number
  try {
    backupId = await deps.backup(item, { raw, values: current })
  } catch (e) {
    return { status: 'failed', backupId: null, error: `Couldn't save a backup, so nothing was written: ${errText(e)}` }
  }

  // 3. Write.
  onStep?.('writing')
  let body: Uint8Array
  try {
    body = encodeConfig(item.defs, item.after)
  } catch (e) {
    return { status: 'failed', backupId, error: errText(e) }
  }
  let writeError: unknown = null
  try {
    await client.setConfig(item.kind, body, opts)
  } catch (e) {
    if (e instanceof ConfigRejectedError) return { status: 'failed', backupId, error: `The controller refused the settings: ${e.message}` }
    // A lost reply doesn't mean a lost write; the read-back below decides.
    if (!(e instanceof TimeoutError)) return { status: 'failed', backupId, error: errText(e) }
    writeError = e
  }

  // 4. Read back and compare.
  onStep?.('verifying')
  let stored: ConfigValues
  try {
    stored = decodeConfig(item.defs, await client.getConfig(item.kind, opts))
  } catch (e) {
    return { status: 'failed', backupId, error: `Written, but couldn't read the settings back to check them: ${errText(e)}` }
  }
  const adjusted = diffValues(item.defs, item.after, stored).map((name) => ({
    name,
    wanted: item.after[name],
    got: stored[name],
  }))
  if (writeError && diffValues(item.defs, stored, item.before).length === 0) {
    return { status: 'failed', backupId, error: "The controller didn't confirm the write and its settings are unchanged.", values: stored }
  }
  return adjusted.length ? { status: 'adjusted', backupId, values: stored, adjusted } : { status: 'ok', backupId, values: stored }
}
