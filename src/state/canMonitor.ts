// The CAN monitor. The controller on the cable is switched to comm-bridge CAN
// mode (in RAM only, so a power cycle undoes it), passes on every frame it sees,
// and is switched back to its own mode when the monitor stops. If the link drops
// first, the switch back happens on the next connection to the same controller.
//
// While it runs, the controller stops handling VESC CAN traffic itself: other
// controllers on the bus can't be reached through it, and ones that follow it
// over CAN (dual motor setups) don't get commands. So it only starts at rest.

import { create } from 'zustand'
import { CAN_MODE, describeVescFrame, MOTOR_COMMAND_PACKETS, SETTING_PACKETS, type CanFrame, type VescCanInfo } from '../protocol/can'
import { deviceKey, useConfig } from './config'
import { isMotorController } from './devices'
import { scriptSupport } from './lisp'
import { motionBlock } from './motion'
import { activeClient, useSession } from './session'

export const FRAME_LIMIT = 2000
const TICK_MS = 200
const RESTORE_KEY = 'ohmic.canRestore'

export interface FrameRow {
  seq: number
  at: number
  id: number
  extended: boolean
  data: Uint8Array
  /** Sent from here rather than received. */
  tx: boolean
  vesc: VescCanInfo | null
}

export interface IdStat {
  key: string
  id: number
  extended: boolean
  count: number
  last: Uint8Array
  lastAt: number
  /** Frames per second, smoothed. */
  rate: number
  vesc: VescCanInfo | null
  tx: number
}

interface Restore {
  uuid: string
  mode: number
}

interface CanMonitorState {
  status: 'off' | 'starting' | 'on' | 'stopping'
  error: string | null
  notice: string | null
  originalMode: number | null
  /** Bumped (at most 5× a second) when frames arrive, for the screen to redraw. */
  version: number
  paused: boolean
  startedAt: number | null
  dropped: number
  start: () => Promise<boolean>
  stop: () => Promise<void>
  send: (frame: CanFrame) => Promise<boolean>
  clear: () => void
  setPaused: (paused: boolean) => void
  dismiss: () => void
}

// Frames live outside the store so a busy bus doesn't churn React state.
const ring: (FrameRow | undefined)[] = new Array(FRAME_LIMIT)
let head = 0
let total = 0
let seq = 0
const stats = new Map<string, IdStat>()
const lastCounts = new Map<string, number>()
let changed = false
let unsub: (() => void) | null = null
let tick: ReturnType<typeof setInterval> | null = null
let lastTick = 0

/** Newest first, at most `limit`. */
export function recentFrames(limit = FRAME_LIMIT): FrameRow[] {
  const n = Math.min(limit, total, FRAME_LIMIT)
  const out: FrameRow[] = []
  for (let i = 1; i <= n; i++) out.push(ring[(head - i + FRAME_LIMIT) % FRAME_LIMIT]!)
  return out
}

export function idStats(): IdStat[] {
  return [...stats.values()].sort((a, b) => Number(a.extended) - Number(b.extended) || a.id - b.id)
}

const statKey = (f: CanFrame) => `${f.extended ? 'x' : 's'}${f.id}`

function record(f: CanFrame, tx: boolean) {
  const at = Date.now()
  const vesc = describeVescFrame(f)
  ring[head] = { seq: ++seq, at, id: f.id, extended: f.extended, data: f.data, tx, vesc }
  head = (head + 1) % FRAME_LIMIT
  total++
  const key = statKey(f)
  const s = stats.get(key)
  if (s) {
    s.count++
    s.last = f.data
    s.lastAt = at
    s.vesc = vesc
    if (tx) s.tx++
  } else stats.set(key, { key, id: f.id, extended: f.extended, count: 1, last: f.data, lastAt: at, rate: 0, vesc, tx: tx ? 1 : 0 })
  changed = true
}

function resetBuffers() {
  ring.fill(undefined)
  head = 0
  total = 0
  stats.clear()
  lastCounts.clear()
  changed = true
}

// Kept in memory too, for when storage is blocked: then it lasts as long as the tab.
let memRestore: Restore | null = null

function saveRestore(r: Restore | null) {
  memRestore = r
  try {
    if (r) localStorage.setItem(RESTORE_KEY, JSON.stringify(r))
    else localStorage.removeItem(RESTORE_KEY)
  } catch {
    // Storage blocked: the switch back still happens in this tab.
  }
}

function loadRestore(): Restore | null {
  try {
    const raw = localStorage.getItem(RESTORE_KEY)
    const r = raw ? (JSON.parse(raw) as Restore) : null
    return r && typeof r.uuid === 'string' && typeof r.mode === 'number' ? r : memRestore
  } catch {
    return memRestore
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function localDevice() {
  return useSession.getState().devices.find((d) => d.target === 'local') ?? null
}

/** Why the monitor can't start now, or null. */
export function canMonitorBlock(): string | null {
  const s = useSession.getState()
  if (s.status !== 'connected' || !activeClient()) return 'Connect to a controller first.'
  const local = localDevice()
  if (!local?.fw) return 'Waiting for the controller to identify itself.'
  if (!isMotorController(local.fw)) return 'The CAN monitor needs a motor controller on the cable; this device can’t pass CAN frames on.'
  const support = scriptSupport(local.fw)
  if (!support.ok) return support.reason ?? 'Not supported on this firmware.'
  return motionBlock(
    s.devices.filter((d) => d.motor).map((d) => d.target),
    Date.now(),
    'start the CAN monitor',
  )
}

/** Whether a raw frame would drive a motor or carry a command, which this tool won't send. */
export function refusedFrame(f: CanFrame): string | null {
  if (!f.extended) return null
  const type = (f.id >> 8) & 0xff
  if (f.id >> 16 !== 0) return null // not VESC's id layout
  if (MOTOR_COMMAND_PACKETS.has(type))
    return 'This frame would drive a motor. Ohmic doesn’t send those by hand: use Motor control, which stops the motor when you let go.'
  if (type >= 5 && type <= 8) return 'This frame carries a command to another controller (VESC’s buffer packets). Ohmic doesn’t send those by hand.'
  if (SETTING_PACKETS.has(type))
    return 'This frame changes a controller’s limits, power or bus speed without the review, backup and check that settings writes get. Change it in Config instead.'
  return null
}

export const useCanMonitor = create<CanMonitorState>()((set, get) => {
  const stopListening = () => {
    unsub?.()
    unsub = null
    if (tick) clearInterval(tick)
    tick = null
  }

  const startTick = () => {
    lastTick = Date.now()
    tick = setInterval(() => {
      const now = Date.now()
      const dt = Math.max(0.05, (now - lastTick) / 1000)
      lastTick = now
      for (const s of stats.values()) {
        const prev = lastCounts.get(s.key) ?? s.count
        const inst = (s.count - prev) / dt
        s.rate = s.rate === 0 ? inst : s.rate * 0.7 + inst * 0.3
        if (s.rate !== 0 && s.rate < 0.05 && now - s.lastAt > 5000) s.rate = 0
        lastCounts.set(s.key, s.count)
      }
      if (changed && !get().paused) {
        changed = false
        set((st) => ({ version: st.version + 1 }))
      }
    }, TICK_MS)
  }

  return {
    status: 'off',
    error: null,
    notice: null,
    originalMode: null,
    version: 0,
    paused: false,
    startedAt: null,
    dropped: 0,

    start: async () => {
      if (get().status !== 'off') return false
      const block = canMonitorBlock()
      if (block) {
        set({ error: block, notice: null })
        return false
      }
      const client = activeClient()!
      const local = localDevice()!
      const key = deviceKey(local)
      set({ status: 'starting', error: null, notice: null })
      try {
        let app = useConfig.getState().devices[key]?.appconf
        if (!app?.device) {
          await useConfig.getState().read(key, ['appconf'])
          app = useConfig.getState().devices[key]?.appconf
        }
        const mode = app?.device?.can_mode
        if (typeof mode !== 'number') throw new Error('Couldn’t read the controller’s CAN mode from its app settings, so it couldn’t be put back afterwards.')
        resetBuffers()
        unsub = client.onCanFrame((f) => record(f, false))
        if (mode !== CAN_MODE.COMM_BRIDGE) {
          saveRestore({ uuid: local.fw!.uuid, mode })
          await client.setCanMode(CAN_MODE.COMM_BRIDGE, false)
        }
        startTick()
        set({ status: 'on', originalMode: mode, startedAt: Date.now(), paused: false })
        return true
      } catch (e) {
        stopListening()
        // It may have switched before the reply was lost: try to put it back.
        const r = loadRestore()
        if (r) await client.setCanMode(r.mode, false).then(() => saveRestore(null), () => {})
        set({ status: 'off', error: `Couldn’t start the monitor: ${errText(e)}` })
        return false
      }
    },

    stop: async () => {
      const st = get().status
      if (st !== 'on' && st !== 'starting') return
      set({ status: 'stopping' })
      stopListening()
      const mode = get().originalMode
      const client = activeClient()
      if (mode !== null && mode !== CAN_MODE.COMM_BRIDGE && client && useSession.getState().status === 'connected') {
        try {
          await client.setCanMode(mode, false)
          saveRestore(null)
          set({ status: 'off', notice: 'Monitor stopped. The controller is back in its own CAN mode.' })
          return
        } catch (e) {
          set({
            status: 'off',
            error: `Couldn’t switch the controller back to its CAN mode: ${errText(e)} Ohmic tries again on the next connection; turning the controller off and on also does it.`,
          })
          return
        }
      }
      set({ status: 'off' })
    },

    send: async (frame) => {
      const refused = refusedFrame(frame)
      if (refused) {
        set({ error: refused, notice: null })
        return false
      }
      const client = activeClient()
      if (!client || useSession.getState().status !== 'connected') {
        set({ error: 'Connect to a controller first.', notice: null })
        return false
      }
      try {
        await client.sendCanFrame(frame)
        record(frame, true)
        set({ error: null })
        return true
      } catch (e) {
        set({ error: `Sending failed: ${errText(e)}` })
        return false
      }
    },

    clear: () => {
      resetBuffers()
      set((s) => ({ version: s.version + 1 }))
    },
    setPaused: (paused) => set((s) => ({ paused, version: s.version + 1 })),
    dismiss: () => set({ error: null, notice: null }),
  }
})

// Losing the link ends the monitor; the controller stays in bridge mode until
// the next connection to it (or a power cycle), when it's switched back.
useSession.subscribe((s, prev) => {
  const m = useCanMonitor.getState()
  if (s.status !== 'connected' && prev.status === 'connected' && (m.status === 'on' || m.status === 'starting')) {
    unsub?.()
    unsub = null
    if (tick) clearInterval(tick)
    tick = null
    useCanMonitor.setState({ status: 'off', error: 'The connection dropped while the monitor ran. Ohmic switches the controller back when you reconnect.' })
  }
  const local = s.devices.find((d) => d.target === 'local')
  const pending = loadRestore()
  if (s.status === 'connected' && pending && local?.fw?.uuid === pending.uuid && m.status === 'off' && !restoring) {
    restoring = true
    const client = activeClient()
    void client
      ?.setCanMode(pending.mode, false)
      .then(() => {
        saveRestore(null)
        useCanMonitor.setState({ notice: 'Switched the controller back to its own CAN mode after the last monitor session.', error: null })
        return useSession.getState().rescanCan()
      })
      .catch(() => {})
      .finally(() => {
        restoring = false
      })
  }
})
let restoring = false

// Closing the tab mid-monitor: try to switch back on the way out.
if (typeof window !== 'undefined')
  window.addEventListener('pagehide', () => {
    const m = useCanMonitor.getState()
    if (m.status === 'on' && m.originalMode !== null && m.originalMode !== CAN_MODE.COMM_BRIDGE) void activeClient()?.setCanMode(m.originalMode, false).catch(() => {})
  })
