// Fault history. Watches the fault code in every poll, records when each fault
// started and cleared with a snapshot of the conditions, and keeps that history
// in IndexedDB. Also reads the controller's own fault log (`faults` command),
// which catches faults too short to show up between polls.

import { create } from 'zustand'
import type { Target } from '../client/VescClient'
import { speedKmh } from '../lib/vehicle'
import { parseFaultLog, type FaultLog } from '../protocol/terminal'
import { targetKey, targetLabel } from './devices'
import { sessionEvents, useSession, type SamplesEvent } from './session'
import { useSettings } from './settings'
import { runCommand } from './terminal'

export interface FaultSnapshot {
  vIn: number
  currentMotor: number
  currentIn: number
  duty: number // 0..1
  erpm: number
  speed: number // km/h
  tempFet: number
  tempMotor: number
}

export interface FaultEvent {
  uid: string
  /** When the app first saw it. */
  at: number
  /** When it cleared; null while active (or if the connection ended first, see `lostAt`). */
  endedAt: number | null
  /** The connection ended while the fault was still showing. */
  lostAt?: number
  code: number
  deviceUuid: string | null
  /** "SIM_75_100 · CAN 2" */
  deviceName: string
  target: string
  /** Conditions from the last reading before the fault, or from the first one that showed it. */
  snapshot: FaultSnapshot
  /** True when no reading from just before was available, so the snapshot is from during the fault. */
  snapshotDuring?: boolean
}

export interface ControllerFaultLog {
  status: 'reading' | 'ok' | 'error'
  log: FaultLog | null
  readAt: number | null
  error: string | null
}

interface FaultsState {
  /** Newest first. */
  events: FaultEvent[]
  loaded: boolean
  /** Faults showing right now, by target key. */
  active: Record<string, FaultEvent>
  /** Fault logs read from the controllers, by target key. */
  logs: Record<string, ControllerFaultLog>
  load: () => Promise<void>
  observe: (e: SamplesEvent) => void
  endAll: (at: number) => void
  clearHistory: () => Promise<void>
  readLog: (target: Target) => Promise<void>
}

const MAX_EVENTS = 500
/** A reading older than this isn't "just before" the fault any more. */
const BEFORE_MS = 1500
let seq = 0
// Last fault-free reading per controller. A fault turns the output off at once,
// so the reading that shows the fault already has zero current.
const lastClean = new Map<string, { values: SamplesEvent['samples'][number]['values']; at: number }>()

const persist = (e: FaultEvent) =>
  import('./db').then(({ saveFaultEvent }) => saveFaultEvent(e)).catch(() => {
    // Storage can be unavailable (private mode); the in-memory history still works.
  })

export const useFaults = create<FaultsState>()((set, get) => ({
  events: [],
  loaded: false,
  active: {},
  logs: {},

  load: async () => {
    if (get().loaded) return
    try {
      const { loadFaultEvents } = await import('./db')
      const stored = await loadFaultEvents()
      // Anything seen this session already is newer and wins.
      const seen = new Set(get().events.map((e) => e.uid))
      const events = [...get().events, ...stored.filter((e) => !seen.has(e.uid))].sort((a, b) => b.at - a.at).slice(0, MAX_EVENTS)
      set({ events, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  observe: ({ samples, devices, at }) => {
    const { active } = get()
    let next = active
    let events = get().events
    const vehicle = useSettings.getState().vehicle
    const changed: FaultEvent[] = []

    for (const s of samples) {
      const key = targetKey(s.target)
      const code = s.values.fault
      const cur = active[key]
      const before = lastClean.get(key)
      if (code === 0) lastClean.set(key, { values: s.values, at })
      if (cur && cur.code === code) continue
      if (!cur && code === 0) continue
      if (next === active) next = { ...active }
      if (cur) {
        const ended = { ...cur, endedAt: at }
        events = events.map((e) => (e.uid === cur.uid ? ended : e))
        changed.push(ended)
        delete next[key]
      }
      if (code !== 0) {
        const d = devices.find((x) => x.target === s.target)
        // A fault replacing another fault has no clean reading in between.
        const fresh = !cur && before && at - before.at <= BEFORE_MS
        const v = fresh ? before.values : s.values
        const e: FaultEvent = {
          uid: `${at.toString(36)}-${key}-${(seq++).toString(36)}`,
          at,
          endedAt: null,
          code,
          deviceUuid: d?.fw?.uuid || null,
          deviceName: `${d?.fw?.hwName || 'Controller'} · ${targetLabel(s.target)}`,
          target: key,
          snapshot: {
            vIn: v.vIn,
            currentMotor: v.currentMotor,
            currentIn: v.currentIn,
            duty: v.dutyNow,
            erpm: v.rpm,
            speed: Math.abs(speedKmh(v.rpm, vehicle)),
            tempFet: v.tempFet,
            tempMotor: v.tempMotor,
          },
          ...(fresh ? {} : { snapshotDuring: true }),
        }
        next[key] = e
        events = [e, ...events].slice(0, MAX_EVENTS)
        changed.push(e)
      }
    }
    if (next === active) return
    set({ active: next, events })
    for (const e of changed) void persist(e)
  },

  endAll: (at) => {
    const open = Object.values(get().active)
    if (open.length === 0) return
    const lost = new Map(open.map((e) => [e.uid, { ...e, lostAt: at }]))
    set((s) => ({ active: {}, events: s.events.map((e) => lost.get(e.uid) ?? e) }))
    for (const e of lost.values()) void persist(e)
  },

  clearHistory: async () => {
    // Faults still showing stay; everything else goes.
    set((s) => ({ events: Object.values(s.active) }))
    try {
      const { clearFaultEvents, saveFaultEvent } = await import('./db')
      await clearFaultEvents()
      for (const e of Object.values(get().active)) await saveFaultEvent(e)
    } catch {
      // Nothing stored to clear.
    }
  },

  readLog: async (target) => {
    const key = targetKey(target)
    const blank: ControllerFaultLog = { status: 'reading', log: null, readAt: null, error: null }
    const update = (patch: Partial<ControllerFaultLog>) =>
      set((s) => ({ logs: { ...s.logs, [key]: { ...blank, ...s.logs[key], ...patch } } }))
    update({ status: 'reading', error: null })
    try {
      const text = await runCommand('faults', target, { source: 'Faults' })
      const log = parseFaultLog(text)
      if (!log) {
        update({
          status: 'error',
          error: text.trim() ? 'The controller answered, but not with a fault log this app understands.' : 'The controller didn’t answer the `faults` command.',
        })
        return
      }
      update({ status: 'ok', log, readAt: Date.now() })
    } catch (e) {
      update({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },
}))

sessionEvents.samples.on((e) => useFaults.getState().observe(e))
sessionEvents.ended.on(({ at }) => useFaults.getState().endAll(at))
// A drop that turns into a reconnect: faults still showing may clear while we can't see.
useSession.subscribe((s, prev) => {
  if (s.status === 'reconnecting' && prev.status === 'connected') useFaults.getState().endAll(Date.now())
  if (s.status === 'idle' && prev.status !== 'idle') {
    set({ logs: {} })
    lastClean.clear()
  }
})

function set(patch: Partial<FaultsState>) {
  useFaults.setState(patch)
}
