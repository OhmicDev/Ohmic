// Ride modes and the single/dual motor switch, sent to every motor controller as
// temporary limits (COMM_SET_MCCONF_TEMP): instant, never saved, gone after a power
// cycle. Mode switches work mid-ride (that's what they're for); turning a motor on
// or off waits until the vehicle is stopped, because it changes braking too.
//
// A controller reports temporary limits as if they were its settings, so the app
// remembers what it sent (IndexedDB). When settings are read, a controller still
// running a mode shows its own stored values in the editor, never the mode's. Before
// any motor-settings write (or detection, which saves the config), the stored values
// go back first, so a mode can't be saved by accident; afterwards the mode returns.

import { create } from 'zustand'
import type { ConfigValues } from '../config/types'
import {
  limitsFor,
  limitsFromConfig,
  modeIssues,
  sameLimits,
  STARTER_MODES,
  TEMPLATES,
  withLimits,
  type MotorUse,
  type RideMode,
} from '../lib/rideModes'
import { TEMP_KEYS, type TempLimits } from '../protocol/setup'
import { setMcconfReadFilter, useConfig, type DeviceConfig } from './config'
import { motionBlock } from './motion'
import { activeClient, useSession } from './session'
import { useSettings } from './settings'

export type { MotorUse, RideMode }

export interface LiveLimitsRecord {
  /** Device key (config store). */
  key: string
  /** The controller's own stored limits when the mode was sent. */
  stock: TempLimits
  /** What the app sent. */
  sent: TempLimits
  modeId: string | null
  motors: MotorUse
  /** A test of AI-proposed limits running on top (see LimitTest). */
  test?: { id: string; label: string; limits: Partial<TempLimits>; startedAt: number } | null
  at: number
}

/**
 * Limits under test (an AI proposal tried before saving): they replace these
 * fields for each controller, on top of the stored settings and any ride mode.
 * Memory only, like ride modes: a power cycle ends the test.
 */
export interface LimitTest {
  id: string
  label: string
  startedAt: number
  /** By device key. */
  limits: Record<string, Partial<TempLimits>>
}

interface RideModeState {
  modes: RideMode[]
  loaded: boolean
  /** The mode the controllers are running now; null means their own settings. */
  activeId: string | null
  motors: MotorUse
  /** Limits under test, or null. */
  test: LimitTest | null
  busy: boolean
  error: string | null
  load: () => Promise<void>
  /**
   * Sends a mode (and motor choice, and limit test) to every motor controller.
   * `test` left out keeps the current one. Resolves false on failure (see `error`).
   */
  apply: (modeId: string | null, motors?: MotorUse, test?: LimitTest | null) => Promise<boolean>
  /** Starts a limit test on top of the current mode. Resolves false on failure (see `error`). */
  startTest: (test: LimitTest) => Promise<boolean>
  /** Ends the limit test: the stored settings (and the mode) come back. */
  endTest: () => Promise<boolean>
  /** Forgets the test without sending anything (a write is about to put the stored limits back anyway). */
  dropTest: () => void
  /** Saves a mode after checking it. Returns the problems, or [] when saved. */
  save: (m: RideMode) => Promise<string[]>
  remove: (id: string) => Promise<void>
  /** Adds a copy of a template and returns it. */
  addFromTemplate: (index: number) => Promise<RideMode>
  clearError: () => void
}

const db = () => import('./db').then((m) => m.db)

/** In-memory copy of the liveLimits table. */
const records = new Map<string, LiveLimitsRecord>()

async function putRecord(r: LiveLimitsRecord) {
  records.set(r.key, r)
  try {
    await (await db()).liveLimits.put(r)
  } catch {
    // No IndexedDB (private mode): it still works until the page reloads.
  }
}

async function dropRecord(key: string) {
  records.delete(key)
  try {
    await (await db()).liveLimits.delete(key)
  } catch {
    // see above
  }
}

let recordsLoaded: Promise<void> | null = null
function loadRecords() {
  recordsLoaded ??= (async () => {
    try {
      for (const r of await (await db()).liveLimits.toArray()) if (!records.has(r.key)) records.set(r.key, r)
    } catch {
      // see above
    }
  })()
  return recordsLoaded
}

/** Motor controllers in bus order, as the config store knows them. */
function motorDevices(): DeviceConfig[] {
  const { devices, order } = useConfig.getState()
  return order.map((k) => devices[k]).filter((d): d is DeviceConfig => !!d)
}

function notReadyReason(d: DeviceConfig): string | null {
  switch (d.mcconf.status) {
    case 'ready':
      return null
    case 'idle':
    case 'loading':
      return `Still reading settings from ${d.name}. Try again in a moment.`
    case 'readonly':
      return `${d.name} runs firmware Ohmic only reads, so ride modes can’t be sent to it.`
    default:
      return `${d.name}: its settings couldn’t be read, so ride modes can’t be worked out.`
  }
}

/** Which controller keeps driving in single-motor mode. */
export function singleDriverKey(list = motorDevices()): string | null {
  const want = useSettings.getState().singleMotorKey
  return list.find((d) => d.key === want)?.key ?? list[0]?.key ?? null
}

function finiteLimits(l: TempLimits): boolean {
  return TEMP_KEYS.every((k) => Number.isFinite(l[k]))
}

/** Limits for one controller, worked out from its stored settings. */
function plan(d: DeviceConfig, mode: RideMode | null, motors: MotorUse, list: DeviceConfig[], singleKey: string | null, test: LimitTest | null) {
  const mc = d.mcconf.device as ConfigValues
  const stock = limitsFromConfig(mc)
  const driving = motors === 'dual' || d.key === singleKey
  const sent = limitsFor(stock, mc, mode, driving, motors === 'dual' ? list.length : 1)
  const tested = test?.limits[d.key]
  if (tested) {
    Object.assign(sent, tested)
    // A motor switched off in single-motor mode stays off.
    if (!driving) {
      sent.currentMaxScale = 0
      sent.currentMinScale = 0
    }
  }
  return { stock, sent }
}

function recordTest(test: LimitTest | null, key: string): LiveLimitsRecord['test'] {
  const limits = test?.limits[key]
  return test && limits ? { id: test.id, label: test.label, limits, startedAt: test.startedAt } : null
}

async function sendLimits(d: DeviceConfig, l: TempLimits) {
  const client = activeClient()
  if (!client) throw new Error('Not connected.')
  await client.setTempLimits(l, { target: d.target, priority: 'high', retries: 1 })
  let back: TempLimits | null = null
  try {
    back = await client.getTempLimits({ target: d.target, priority: 'high' })
  } catch {
    // Older firmware can't report them; the controller already confirmed it took them.
  }
  if (back && !sameLimits(back, l)) throw new Error(`${d.name} didn’t take the limits (it reported different values back).`)
}

export const useRideModes = create<RideModeState>()((set, get) => ({
  modes: STARTER_MODES,
  loaded: false,
  activeId: null,
  motors: 'dual',
  test: null,
  busy: false,
  error: null,

  load: async () => {
    if (get().loaded) return
    try {
      const t = (await db()).rideModes
      let modes = await t.orderBy('order').toArray()
      if (!modes.length) {
        await t.bulkPut(STARTER_MODES)
        modes = STARTER_MODES
      }
      set({ modes, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  apply: async (modeId, motorsArg, testArg) => {
    if (get().busy) return false
    const test = testArg === undefined ? get().test : testArg
    const fail = (error: string) => {
      set({ busy: false, error })
      return false
    }
    if (!activeClient() || useSession.getState().status !== 'connected') return fail('Connect to a controller first.')
    const mode = modeId === null ? null : (get().modes.find((m) => m.id === modeId) ?? null)
    if (modeId !== null && !mode) return fail('That ride mode no longer exists.')
    if (mode) {
      const issues = modeIssues(mode)
      if (issues.length) return fail(`${mode.name}: ${issues[0]}`)
    }
    const list = motorDevices()
    if (!list.length) return fail('No motor controllers found.')
    for (const d of list) {
      const why = notReadyReason(d)
      if (why) return fail(why)
    }
    const motors: MotorUse = list.length < 2 ? 'dual' : (motorsArg ?? get().motors)
    if (motors !== get().motors) {
      const block = motionBlock(
        list.map((d) => d.target),
        Date.now(),
        'switch motors',
      )
      if (block) return fail(block)
    }
    const singleKey = singleDriverKey(list)
    const plans = list.map((d) => ({ d, ...plan(d, mode, motors, list, singleKey, test) }))
    const bad = plans.find((p) => !finiteLimits(p.sent))
    if (bad) return fail(`${bad.d.name}: its settings gave limits that aren’t numbers, so nothing was sent.`)

    set({ busy: true, error: null })
    await loadRecords()
    const done: typeof plans = []
    try {
      for (const p of plans) {
        await sendLimits(p.d, p.sent)
        done.push(p)
        const t = recordTest(test, p.d.key)
        if (modeId === null && motors === 'dual' && !t) await dropRecord(p.d.key)
        else await putRecord({ key: p.d.key, stock: p.stock, sent: p.sent, modeId, motors, test: t, at: Date.now() })
      }
    } catch (e) {
      // Don't leave the motors on different modes: put back what the others had.
      for (const p of done) {
        const prev = get()
        const back = plan(p.d, prev.activeId ? (prev.modes.find((m) => m.id === prev.activeId) ?? null) : null, prev.motors, list, singleKey, prev.test)
        try {
          await sendLimits(p.d, back.sent)
          const t = recordTest(prev.test, p.d.key)
          if (prev.activeId === null && prev.motors === 'dual' && !t) await dropRecord(p.d.key)
          else await putRecord({ key: p.d.key, ...back, modeId: prev.activeId, motors: prev.motors, test: t, at: Date.now() })
        } catch {
          // Reported below; a power cycle always brings back the stored settings.
        }
      }
      return fail(`Couldn’t switch: ${e instanceof Error ? e.message : String(e)}`)
    }
    set({ busy: false, activeId: modeId, motors, test })
    return true
  },

  startTest: async (test) => {
    const s = get()
    return s.apply(s.activeId, s.motors, test)
  },

  endTest: async () => {
    const s = get()
    if (!s.test) return true
    return s.apply(s.activeId, s.motors, null)
  },

  dropTest: () => set({ test: null }),

  save: async (m) => {
    const issues = modeIssues(m)
    if (issues.length) return issues
    const modes = get().modes.some((x) => x.id === m.id) ? get().modes.map((x) => (x.id === m.id ? m : x)) : [...get().modes, m]
    set({ modes })
    try {
      await (await db()).rideModes.put(m)
    } catch {
      // kept in memory
    }
    // Editing the mode in force updates the controllers straight away.
    if (get().activeId === m.id && useSession.getState().status === 'connected') await get().apply(m.id)
    return []
  },

  remove: async (id) => {
    const m = get().modes.find((x) => x.id === id)
    if (!m || m.starter) return
    if (get().activeId === id) {
      const ok = await get().apply(null)
      if (!ok) return
    }
    set({ modes: get().modes.filter((x) => x.id !== id) })
    try {
      await (await db()).rideModes.delete(id)
    } catch {
      // kept in memory
    }
  },

  addFromTemplate: async (index) => {
    const t = TEMPLATES[index]
    const order = Math.max(0, ...get().modes.map((m) => m.order)) + 1
    const names = new Set(get().modes.map((m) => m.name))
    let name = t.name
    for (let i = 2; names.has(name); i++) name = `${t.name} ${i}`
    const m: RideMode = {
      id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name,
      order,
      motorPct: null,
      regenPct: null,
      batteryPct: null,
      maxSpeedKmh: null,
      maxPowerW: null,
      ...t.settings,
    }
    await get().save(m)
    return m
  },

  clearError: () => set({ error: null }),
}))

/**
 * When settings are read from a controller still running a mode, show (and keep)
 * its stored values. If the live limits no longer match what was sent, it was power
 * cycled or changed elsewhere, so the record is dropped.
 */
setMcconfReadFilter(async (key, values) => {
  await loadRecords()
  const rec = records.get(key)
  if (!rec) return values
  if (!sameLimits(limitsFromConfig(values), rec.sent)) {
    await dropRecord(key)
    if (![...records.values()].length) useRideModes.setState({ activeId: null, motors: 'dual' })
    return values
  }
  const s = useRideModes.getState()
  const known = rec.modeId === null || s.modes.some((m) => m.id === rec.modeId) || !s.loaded
  // A limit test still running from before a reload or reconnect.
  const test = rec.test
    ? {
        id: rec.test.id,
        label: rec.test.label,
        startedAt: rec.test.startedAt,
        limits: { ...(s.test?.id === rec.test.id ? s.test.limits : {}), [key]: rec.test.limits },
      }
    : s.test
  useRideModes.setState({ activeId: known ? rec.modeId : null, motors: rec.motors, test })
  return withLimits(values, rec.stock)
})

/**
 * Before a motor-settings write (or anything that saves the config on the
 * controller): puts that controller's stored limits back. Returns a function that
 * brings the mode back afterwards, using whatever the controller now has stored.
 */
export async function pauseRideMode(key: string): Promise<(() => Promise<void>) | null> {
  await loadRecords()
  const rec = records.get(key)
  const d = useConfig.getState().devices[key]
  if (!rec || !d) return null
  if (!sameLimits(rec.sent, rec.stock)) await sendLimits(d, rec.stock)
  return async () => {
    const s = useRideModes.getState()
    const dev = useConfig.getState().devices[key]
    if (!dev || dev.mcconf.status !== 'ready' || !dev.mcconf.device) {
      await dropRecord(key)
      return
    }
    const list = motorDevices()
    const mode = s.activeId ? (s.modes.find((m) => m.id === s.activeId) ?? null) : null
    const p = plan(dev, mode, s.motors, list, singleDriverKey(list), s.test)
    const t = recordTest(s.test, key)
    try {
      await sendLimits(dev, p.sent)
      if (s.activeId === null && s.motors === 'dual' && !t) await dropRecord(key)
      else await putRecord({ key, ...p, modeId: s.activeId, motors: s.motors, test: t, at: Date.now() })
    } catch (e) {
      await dropRecord(key)
      useRideModes.setState({ error: `The ride mode couldn’t be put back on ${dev.name}: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
}

/** Is a ride mode (or single-motor mode) changing this controller's limits right now? */
export function rideModeActiveOn(key: string): boolean {
  const r = records.get(key)
  return !!r && !sameLimits(r.sent, r.stock)
}

/** Motor settings just read from a controller, with its stored limits in place of a running mode's (null when none is running). */
export function withoutRideMode(key: string, values: ConfigValues): ConfigValues | null {
  const r = records.get(key)
  if (!r || sameLimits(r.sent, r.stock) || !sameLimits(limitsFromConfig(values), r.sent)) return null
  return withLimits(values, r.stock)
}

// On a deliberate disconnect the controllers keep their limits until power-off; the
// next connection finds them again when it reads the settings.
useSession.subscribe((s, prev) => {
  if (s.status === 'idle' && prev.status !== 'idle') useRideModes.setState({ busy: false, error: null, activeId: null, motors: 'dual', test: null })
})
