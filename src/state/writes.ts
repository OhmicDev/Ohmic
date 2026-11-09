// Runs reviewed writes, one controller at a time, through the write pipeline,
// and keeps the config store in step with what the controllers now hold.

import { fwKey } from '../config/registry'
import type { ConfigKind } from '../config/types'
import { makeItem, shareChanges, writeConfig, type WriteItem, type WriteOutcome, type WriteStep } from '../config/write'
import { plural } from '../lib/format'
import { addBackup } from './backups'
import { useConfig, type DeviceConfig } from './config'
import { motionBlock } from './motion'
import { pauseRideMode } from './rideModes'
import { activeClient } from './session'

interface PlannedWrite {
  items: WriteItem[]
  /** Settings left out for each extra controller, by device key. */
  skipped: Record<string, string[]>
}

function baseItem(d: DeviceConfig, kind: ConfigKind) {
  const k = d[kind]
  if (k.status !== 'ready' || !k.defs || !k.device || !k.draft) return null
  return { key: d.key, target: d.target, deviceName: d.name, kind, defs: k.defs, before: k.device }
}

/** The write for one controller's edits, plus the same edits for `alsoKeys`. */
export function planWrite(key: string, kind: ConfigKind, alsoKeys: string[] = []): PlannedWrite | null {
  const devices = useConfig.getState().devices
  const d = devices[key]
  const base = d && baseItem(d, kind)
  if (!base) return null
  const main = makeItem({ ...base, after: { ...d[kind].draft! } })
  const items = [main]
  const skipped: Record<string, string[]> = {}
  for (const other of alsoKeys) {
    const od = devices[other]
    const ob = od && baseItem(od, kind)
    if (!ob || other === key) continue
    const shared = shareChanges(main, ob)
    skipped[other] = shared.skipped
    if (shared.item.changes.length) items.push(shared.item)
  }
  return { items, skipped }
}

/** Each controller's own edits, written together (e.g. a ride mode made permanent). */
export function planWriteEach(keys: string[], kind: ConfigKind): PlannedWrite | null {
  const devices = useConfig.getState().devices
  const items: WriteItem[] = []
  for (const key of keys) {
    const d = devices[key]
    const base = d && baseItem(d, kind)
    if (!base) continue
    const item = makeItem({ ...base, after: { ...d[kind].draft! } })
    if (item.changes.length) items.push(item)
  }
  return items.length ? { items, skipped: {} } : null
}

/** Other controllers the same edits could also go to. */
export function shareTargets(key: string, kind: ConfigKind): DeviceConfig[] {
  const { devices, order } = useConfig.getState()
  return order.filter((k) => k !== key).map((k) => devices[k]).filter((d) => d && d[kind].status === 'ready')
}

export interface WriteProgress {
  step: WriteStep | 'waiting' | 'done'
  outcome?: WriteOutcome
}

function confirm(item: WriteItem, outcome: WriteOutcome) {
  const store = useConfig.getState()
  if (outcome.status === 'ok' || outcome.status === 'adjusted') store.confirmWritten(item.key, item.kind, item.after, outcome.values)
  else if (outcome.status === 'stale') store.rebase(item.key, item.kind, outcome.values)
}

async function writeOne(item: WriteItem, onStep: (step: WriteStep) => void): Promise<WriteOutcome> {
  const client = activeClient()
  if (!client) return { status: 'failed', backupId: null, error: 'Not connected.' }
  const blocked = motionBlock([item.target])
  if (blocked) return { status: 'failed', backupId: null, error: blocked }
  const custom = item.custom
  if (custom) {
    const outcome = await writeConfig(item, {
      client: { getConfig: () => custom.read(), setConfig: (_kind, body) => custom.write(body) },
      onStep,
      backup: custom.backup,
    })
    custom.onWritten?.(outcome)
    return outcome
  }
  // A running ride mode is put aside first, so it can't be saved as a setting.
  let resume: (() => Promise<void>) | null = null
  try {
    resume = item.kind === 'mcconf' ? await pauseRideMode(item.key) : null
  } catch (e) {
    return { status: 'failed', backupId: null, error: `Couldn’t pause the ride mode before writing: ${e instanceof Error ? e.message : String(e)}` }
  }
  const device = useConfig.getState().devices[item.key]
  const outcome = await writeConfig(item, {
    client,
    onStep,
    backup: (it, current) =>
      addBackup({
        reason: 'before-write',
        title: `Before writing ${plural(it.changes.length, 'change')}`,
        changes: it.changes.map((c) => ({ ...c, label: it.defs.params[c.name]?.label ?? c.name })),
        kind: it.kind,
        deviceUuid: device?.fw.uuid || null,
        deviceName: it.deviceName,
        hwName: device?.fw.hwName ?? '',
        fw: device ? fwKey(device.fw.major, device.fw.minor) : it.defs.fw,
        signature: it.defs.signature,
        raw: current.raw,
        values: current.values,
      }),
  })
  confirm(item, outcome)
  // The mode comes back on top of whatever the controller now has stored.
  await resume?.()
  return outcome
}

export async function runWrites(items: WriteItem[], onProgress: (index: number, p: WriteProgress) => void): Promise<WriteOutcome[]> {
  const outcomes: WriteOutcome[] = []
  for (let i = 0; i < items.length; i++) {
    const outcome = await writeOne(items[i], (step) => onProgress(i, { step }))
    onProgress(i, { step: 'done', outcome })
    outcomes.push(outcome)
  }
  return outcomes
}
