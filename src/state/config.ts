// Settings for every motor controller on the bus: what the controller has, the
// user's local edits (with undo), and the hardware defaults. Edits stay here until
// they go through the write pipeline. They survive a dropped connection, because
// controllers are keyed by UUID.

import { create } from 'zustand'
import type { Target } from '../client/VescClient'
import { decodeConfig, peekSignature, sameOnWire, xmlDefaults } from '../config/codec'
import { fwKey, resolveDefs } from '../config/registry'
import type { ConfigDefs, ConfigKind, ConfigValues } from '../config/types'
import { diffValues } from '../config/write'
import type { FwVersion } from '../protocol/messages'
import { targetKey, targetLabel, type DeviceInfo } from './devices'
import { setImuGate } from './imuGate'
import { activeClient, useSession } from './session'
import { useSettings } from './settings'
import { errorText } from '../lib/format'

type KindStatus = 'idle' | 'loading' | 'ready' | 'readonly' | 'unsupported' | 'error'

export interface KindState {
  status: KindStatus
  /** Why it's read-only, unsupported or failed. */
  reason: string | null
  defs: ConfigDefs | null
  /** Last values read from (or confirmed written to) the controller. */
  device: ConfigValues | null
  /** The controller's own defaults for its hardware (falls back to VESC Tool's). */
  defaults: ConfigValues | null
  draft: ConfigValues | null
  undo: ConfigValues[]
  redo: ConfigValues[]
  readAt: number | null
}

export interface DeviceConfig {
  key: string
  target: Target
  fw: FwVersion
  /** "SIM_75_100 · CAN 2" */
  name: string
  mcconf: KindState
  appconf: KindState
}

const UNDO_LIMIT = 200

const emptyKind = (): KindState => ({
  status: 'idle',
  reason: null,
  defs: null,
  device: null,
  defaults: null,
  draft: null,
  undo: [],
  redo: [],
  readAt: null,
})

export function deviceKey(d: Pick<DeviceInfo, 'target' | 'fw'>): string {
  return d.fw?.uuid ? `uuid:${d.fw.uuid}` : `target:${targetKey(d.target)}`
}

export function deviceName(d: Pick<DeviceInfo, 'target' | 'fw'>): string {
  return `${d.fw?.hwName || 'Controller'} · ${targetLabel(d.target)}`
}

interface ConfigState {
  devices: Record<string, DeviceConfig>
  /** Device keys in bus order (local first). */
  order: string[]
  read: (key: string, kinds?: ConfigKind[]) => Promise<void>
  /** Applies a set of values as one undo step. */
  edit: (key: string, kind: ConfigKind, patch: ConfigValues) => void
  undo: (key: string, kind: ConfigKind) => void
  redo: (key: string, kind: ConfigKind) => void
  discard: (key: string, kind: ConfigKind) => void
  /**
   * After a write: the controller holds `stored` (what it read back after `written`).
   * Edits beyond what was written stay in the draft; values the controller adjusted show as stored.
   */
  confirmWritten: (key: string, kind: ConfigKind, written: ConfigValues, stored: ConfigValues) => void
  /** Fresh values from the controller (e.g. the write found they changed); edits are kept on top. */
  rebase: (key: string, kind: ConfigKind, values: ConfigValues) => void
  reset: () => void
}

function patchKind(key: string, kind: ConfigKind, fn: (k: KindState) => Partial<KindState> | null) {
  useConfig.setState((s) => {
    const d = s.devices[key]
    if (!d) return s
    const next = fn(d[kind])
    if (!next) return s
    return { devices: { ...s.devices, [key]: { ...d, [kind]: { ...d[kind], ...next } } } }
  })
}

/** Keeps the user's edits (relative to `oldBase`) on top of `newBase`. */
function rebaseDraft(defs: ConfigDefs, draft: ConfigValues | null, oldBase: ConfigValues | null, newBase: ConfigValues) {
  if (!draft || !oldBase) return { ...newBase }
  const out = { ...newBase }
  for (const n of diffValues(defs, draft, oldBase)) out[n] = draft[n]
  return out
}

const reading = new Map<string, Promise<void>>()

type McconfReadFilter = (key: string, values: ConfigValues) => Promise<ConfigValues>
let mcconfFilter: McconfReadFilter = async (_key, values) => values

/** Lets ride modes swap their temporary limits for the stored ones when motor settings are read. */
export function setMcconfReadFilter(fn: McconfReadFilter) {
  mcconfFilter = fn
}

async function readKind(key: string, kind: ConfigKind) {
  const client = activeClient()
  const d = useConfig.getState().devices[key]
  if (!client || !d) return
  const target = d.target
  patchKind(key, kind, () => ({ status: 'loading', reason: null }))
  try {
    const raw = await client.getConfig(kind, { target })
    const res = await resolveDefs(d.fw, kind, peekSignature(raw))
    if (res.status === 'unsupported') {
      patchKind(key, kind, () => ({ status: 'unsupported', reason: res.reason, defs: null, device: null, draft: null }))
      return
    }
    const defs = res.defs
    const decoded = decodeConfig(defs, raw)
    const values = kind === 'mcconf' ? await mcconfFilter(key, decoded) : decoded
    let defaults: ConfigValues | null = null
    try {
      defaults = decodeConfig(defs, await client.getConfig(kind, { target, defaults: true }))
    } catch {
      defaults = xmlDefaults(defs)
    }
    patchKind(key, kind, (k) => {
      const sameLayout = k.defs?.signature === defs.signature
      return {
        status: res.status === 'ok' ? 'ready' : 'readonly',
        reason: res.status === 'readonly' ? res.reason : null,
        defs,
        device: values,
        defaults,
        draft: sameLayout && res.status === 'ok' ? rebaseDraft(defs, k.draft, k.device, values) : { ...values },
        undo: sameLayout ? k.undo : [],
        redo: sameLayout ? k.redo : [],
        readAt: Date.now(),
      }
    })
    if (kind === 'mcconf') syncVehicle(key, values)
  } catch (e) {
    patchKind(key, kind, (k) => ({
      status: k.device ? (k.defs ? 'ready' : 'error') : 'error',
      reason: `Couldn't read ${kind === 'mcconf' ? 'motor' : 'app'} settings: ${errorText(e)}`,
    }))
  }
}

/** The speed, range and battery maths use the primary controller's own setup. */
function syncVehicle(key: string, mc: ConfigValues) {
  const { devices, primary } = useSession.getState()
  const lead = devices.find((d) => d.target === primary)
  if (!lead || deviceKey(lead) !== key) return
  // Values arrive as float32, so 0.254 m reads as 0.2540000081: keep 6 significant digits.
  const n = (k: string) => (typeof mc[k] === 'number' ? Number((mc[k] as number).toPrecision(6)) : NaN)
  const patch = {
    motorPoles: n('si_motor_poles'),
    wheelDiameterMm: Number((n('si_wheel_diameter') * 1000).toPrecision(6)),
    gearRatio: n('si_gear_ratio'),
    batteryCells: n('si_battery_cells'),
    batteryAh: n('si_battery_ah'),
    maxDuty: n('l_max_duty'),
  }
  const sane = Object.fromEntries(Object.entries(patch).filter(([, v]) => Number.isFinite(v) && v > 0))
  const type = mc.si_battery_type
  const chem = type === 1 ? { batteryChemistry: 'lifepo4' as const } : type === 0 ? { batteryChemistry: 'liion' as const } : {}
  useSettings.getState().updateVehicle({ ...sane, ...chem })
}

export const useConfig = create<ConfigState>()((set) => ({
  devices: {},
  order: [],

  read: (key, kinds = ['mcconf', 'appconf']) => {
    const id = `${key}|${kinds.join(',')}`
    const running = reading.get(id)
    if (running) return running
    const p = (async () => {
      for (const kind of kinds) await readKind(key, kind)
    })().finally(() => reading.delete(id))
    reading.set(id, p)
    return p
  },

  edit: (key, kind, patch) =>
    patchKind(key, kind, (k) => {
      const draft = k.draft
      if (k.status !== 'ready' || !draft) return null
      if (Object.keys(patch).every((n) => draft[n] === patch[n])) return null
      return { draft: { ...draft, ...patch }, undo: [...k.undo, draft].slice(-UNDO_LIMIT), redo: [] }
    }),

  undo: (key, kind) =>
    patchKind(key, kind, (k) => {
      const prev = k.undo[k.undo.length - 1]
      if (!prev || !k.draft) return null
      return { draft: prev, undo: k.undo.slice(0, -1), redo: [...k.redo, k.draft] }
    }),

  redo: (key, kind) =>
    patchKind(key, kind, (k) => {
      const next = k.redo[k.redo.length - 1]
      if (!next || !k.draft) return null
      return { draft: next, redo: k.redo.slice(0, -1), undo: [...k.undo, k.draft] }
    }),

  discard: (key, kind) =>
    patchKind(key, kind, (k) => {
      if (!k.device || !k.draft || !k.defs || diffValues(k.defs, k.draft, k.device).length === 0) return null
      return { draft: { ...k.device }, undo: [...k.undo, k.draft].slice(-UNDO_LIMIT), redo: [] }
    }),

  confirmWritten: (key, kind, written, stored) =>
    patchKind(key, kind, (k) => {
      const { defs, device, draft } = k
      if (!defs || !device) return null
      const next = { ...stored }
      // Edits that went out in this write now show what the controller stored;
      // any other edits (or ones changed again meanwhile) stay pending.
      for (const n of draft ? diffValues(defs, draft, device) : []) {
        const p = defs.params[n]
        const wasWritten = !sameOnWire(p, written[n], device[n])
        if (wasWritten && sameOnWire(p, draft![n], written[n])) continue
        next[n] = draft![n]
      }
      return { device: stored, draft: next, readAt: Date.now() }
    }),

  rebase: (key, kind, values) =>
    patchKind(key, kind, (k) => (k.defs ? { device: values, draft: rebaseDraft(k.defs, k.draft, k.device, values), readAt: Date.now() } : null)),

  reset: () => {
    reading.clear()
    set({ devices: {}, order: [] })
  },
}))

/** Motor controllers in bus order, as the config store knows them. */
export function motorDevices({ devices, order }: Pick<ConfigState, 'devices' | 'order'> = useConfig.getState()): DeviceConfig[] {
  return order.map((k) => devices[k]).filter((d): d is DeviceConfig => !!d)
}

/** Number of unwritten edits for one device and config. */
export function pendingCount(k: KindState | undefined): number {
  if (!k?.defs || !k.draft || !k.device) return 0
  return diffValues(k.defs, k.draft, k.device).length
}

// IMU type "off" in the app settings: don't ask that controller for IMU data.
setImuGate((d) => useConfig.getState().devices[deviceKey(d)]?.appconf.device?.['imu_conf.type'] !== 0)

// Follow the connection: add controllers as they're found and read their settings
// in the background. Disconnecting on purpose forgets everything; a dropped link keeps edits.
useSession.subscribe((s, prev) => {
  if (s.status === 'idle' && prev.status !== 'idle') {
    useConfig.getState().reset()
    return
  }
  if (s.status !== 'connected') return
  if (prev.status === 'connected' && s.devices === prev.devices) return

  const motors = s.devices.filter((d) => d.motor && d.fw)
  const current = useConfig.getState().devices
  const devices: Record<string, DeviceConfig> = {}
  for (const d of motors) {
    const key = deviceKey(d)
    const had = current[key]
    devices[key] = had
      ? { ...had, target: d.target, fw: d.fw!, name: deviceName(d) }
      : { key, target: d.target, fw: d.fw!, name: deviceName(d), mcconf: emptyKind(), appconf: emptyKind() }
  }
  // Keep entries for controllers that vanished only while they still hold edits.
  for (const [key, d] of Object.entries(current)) {
    if (!devices[key] && pendingCount(d.mcconf) + pendingCount(d.appconf) > 0) devices[key] = d
  }
  const order = motors.map(deviceKey)
  useConfig.setState({ devices, order })

  // Primary first, so the dashboard's vehicle setup arrives quickly.
  const lead = motors.find((d) => d.target === s.primary)
  const queue = [...(lead ? [lead] : []), ...motors.filter((d) => d !== lead)]
  void (async () => {
    for (const d of queue) {
      if (useSession.getState().status !== 'connected') return
      await useConfig.getState().read(deviceKey(d))
    }
  })()
})

export const fwLabel = (fw: FwVersion) => fwKey(fw.major, fw.minor)
