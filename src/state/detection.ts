// Motor detection (COMM_DETECT_APPLY_ALL_FOC). The firmware measures the motor and
// stores the result itself, so Ohmic wraps it: back up first, put any ride mode
// aside, run, read the settings back, show what changed and offer to undo it.
// Kept outside the page so a run finishes properly even if you navigate away.

import { create } from 'zustand'
import type { Target } from '../client/VescClient'
import { decodeConfig } from '../config/codec'
import { fwKey } from '../config/registry'
import type { ConfigValues } from '../config/types'
import { detectResult, type DetectArgs, type DetectResult } from '../protocol/setup'
import { addBackup } from './backups'
import { useConfig } from './config'
import { motionBlock } from './motion'
import { useMotorTest } from './motorTest'
import { absIsOn, useAbs } from './onboard'
import { pauseRideMode, useRideModes, withoutRideMode, type MotorUse } from './rideModes'
import { activeClient, useSession } from './session'

export interface DetectBefore {
  key: string
  backupId: number
  values: ConfigValues
}

interface DetectionState {
  phase: 'idle' | 'running' | 'done'
  step: string | null
  startedAt: number
  keys: string[]
  result: DetectResult | null
  /** Something went wrong outside the firmware's own result. */
  error: string | null
  /** For example: the ride mode couldn't be switched back on. */
  note: string | null
  before: DetectBefore[]
  run: (args: DetectArgs, target: Target, keys: string[]) => Promise<void>
  reset: () => void
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** What blocks a detection run on these controllers right now, if anything. */
export function detectBlock(keys: string[]): string | null {
  const cfg = useConfig.getState()
  const list = keys.map((k) => cfg.devices[k])
  if (!activeClient() || useSession.getState().status !== 'connected') return 'Not connected.'
  if (list.some((d) => !d || d.mcconf.status !== 'ready' || !d.mcconf.defs)) return 'The controller settings aren’t read yet.'
  if (useMotorTest.getState().running) return 'A motor test is running.'
  if (absIsOn(useAbs.getState().status, list)) return 'ABS is on. Turn it off first: it changes the braking settings while it runs.'
  return motionBlock(
    list.map((d) => d.target),
    undefined,
    'detect the motor',
  )
}

/** Switches the ride mode that was on before back on, once the wheels have stopped. */
async function restoreRide(ride: { activeId: string | null; motors: MotorUse }, targets: Target[]): Promise<string | null> {
  if (ride.activeId === null && ride.motors === 'dual') return null
  for (let i = 0; i < 40 && motionBlock(targets); i++) await sleep(250)
  const ok = await useRideModes.getState().apply(ride.activeId, ride.motors)
  return ok ? null : `The ride mode wasn’t switched back on: ${useRideModes.getState().error ?? 'unknown error'}. Pick it again on the dashboard.`
}

export const useDetection = create<DetectionState>()((set, get) => ({
  phase: 'idle',
  step: null,
  startedAt: 0,
  keys: [],
  result: null,
  error: null,
  note: null,
  before: [],
  reset: () => {
    if (get().phase === 'running') return
    set({ phase: 'idle', step: null, keys: [], result: null, error: null, note: null, before: [] })
  },
  run: async (args, target, keys) => {
    if (get().phase === 'running') return
    const blocked = detectBlock(keys)
    if (blocked) {
      set({ phase: 'done', keys, result: null, error: blocked, note: null, before: [] })
      return
    }
    const client = activeClient()!
    const devices = keys.map((k) => useConfig.getState().devices[k])
    const targets = devices.map((d) => d.target)
    const rides = useRideModes.getState()
    const ride = { activeId: rides.activeId, motors: rides.motors }
    set({ phase: 'running', step: 'Backing up the settings…', startedAt: Date.now(), keys, result: null, error: null, note: null, before: [] })

    // 1. A backup of what each controller has stored, from a fresh read.
    const before: DetectBefore[] = []
    try {
      for (const d of devices) {
        const defs = d.mcconf.defs!
        const raw = await client.getConfig('mcconf', { target: d.target })
        const decoded = decodeConfig(defs, raw)
        const stored = withoutRideMode(d.key, decoded)
        const values = stored ?? decoded
        const backupId = await addBackup({
          reason: 'before-write',
          title: 'Before motor detection',
          changes: [],
          kind: 'mcconf',
          deviceUuid: d.fw.uuid || null,
          deviceName: d.name,
          hwName: d.fw.hwName,
          fw: fwKey(d.fw.major, d.fw.minor),
          signature: defs.signature,
          raw: stored ? null : raw,
          values,
        })
        before.push({ key: d.key, backupId, values })
      }
      // 2. Detection stores whatever is live, so the ride mode's limits go first.
      set({ before, step: 'Putting the ride mode aside…' })
      for (const d of devices) await pauseRideMode(d.key)
    } catch (e) {
      const note = await restoreRide(ride, targets).catch(() => null)
      set({ phase: 'done', step: null, before, error: `Couldn’t get ready, so nothing was measured: ${msg(e)}`, note })
      return
    }

    // 3. Run it. The firmware can't be told to stop part-way.
    set({ step: 'Measuring the motor…', startedAt: Date.now() })
    let result: DetectResult | null = null
    let error: string | null = null
    try {
      result = detectResult(await client.detectApplyAllFoc(args, target))
    } catch (e) {
      error = `No answer from the controller (${msg(e)}). It may still have changed its settings; they’re compared below.`
    }

    // 4. Read back what the controllers now hold, then put the ride mode back on top.
    set({ step: 'Reading the new settings…' })
    for (const d of devices) {
      try {
        await useConfig.getState().read(d.key, ['mcconf'])
      } catch {
        // The config page shows a failed read; the comparison skips it.
      }
    }
    const note = await restoreRide(ride, targets).catch((e) => `The ride mode wasn’t switched back on: ${msg(e)}`)
    set({ phase: 'done', step: null, result, error, note })
  },
}))

/** Settings that differ between the backup and what the controller holds now. */
export function changedSince(before: ConfigValues, now: ConfigValues): ConfigValues {
  const out: ConfigValues = {}
  for (const [k, v] of Object.entries(before)) {
    if (!(k in now)) continue
    const n = now[k]
    const same = typeof v === 'number' && typeof n === 'number' ? Math.abs(v - n) <= Math.max(1e-9, Math.abs(v) * 1e-6) : v === n
    if (!same) out[k] = v
  }
  return out
}

// A finished result belongs to that connection.
useSession.subscribe((s, prev) => {
  if (s.status === 'idle' && prev.status !== 'idle' && useDetection.getState().phase === 'done') useDetection.getState().reset()
})
