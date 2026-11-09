// Live data recording and the Live screen's view state.
//
// The poll loop feeds every sample in here; the ring buffers live outside React
// state and `version` tells subscribers something new arrived.

import { useEffect } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Target } from '../client/VescClient'
import type { VehicleSetup } from '../lib/vehicle'
import { DeviceLog } from '../live/recorder'
import { signalDef } from '../live/signals'
import type { ImuData } from '../protocol/imu'
import type { Values } from '../protocol/messages'
import { targetKey } from './devices'

export interface LiveSample {
  target: Target
  values: Values
  imu: ImuData | null
}

/** Ring buffers by target key ("local", "can2"). */
export const liveLogs = new Map<string, DeviceLog>()

interface LiveDataState {
  version: number
  /** When the newest row was recorded. */
  lastAt: number
  record: (samples: LiveSample[], at: number, vehicle: VehicleSetup) => void
  resetMinMax: () => void
  clear: () => void
}

export const useLiveData = create<LiveDataState>()((set) => ({
  version: 0,
  lastAt: 0,
  record: (samples, at, vehicle) => {
    for (const s of samples) {
      const key = targetKey(s.target)
      let log = liveLogs.get(key)
      if (!log) {
        log = new DeviceLog()
        liveLogs.set(key, log)
      }
      log.push(at, { values: s.values, imu: s.imu, vehicle })
    }
    set((st) => ({ version: st.version + 1, lastAt: at }))
  },
  resetMinMax: () => {
    for (const log of liveLogs.values()) log.resetMinMax()
    set((st) => ({ version: st.version + 1 }))
  },
  clear: () => {
    liveLogs.clear()
    set((st) => ({ version: st.version + 1, lastAt: 0 }))
  },
}))

/** A plotted signal: which controller, which signal, and its colour slot (fixed while plotted). */
export interface Plotted {
  key: string // "local:currentMotor"
  slot: number
}

export const MAX_PLOTTED = 8
export const WINDOWS = [10, 30, 60, 300] as const
export type WindowSec = (typeof WINDOWS)[number]

export const plotKey = (target: string, signal: string) => `${target}:${signal}`
export function parsePlotKey(key: string): { target: string; signal: string } {
  const i = key.lastIndexOf(':')
  return { target: key.slice(0, i), signal: key.slice(i + 1) }
}

interface LiveViewState {
  plotted: Plotted[]
  /** Set once the default plot has been filled in, so clearing it sticks. */
  seeded: boolean
  windowSec: WindowSec
  /** Target key whose signals the list shows. */
  device: string | null
  /** Wall-clock ms the view froze at, or null when following live. */
  pausedAt: number | null
  /** Zoomed time range in ms; implies paused. */
  zoom: [number, number] | null
  toggle: (key: string) => void
  clearPlot: () => void
  seed: (target: string) => void
  setWindow: (w: WindowSec) => void
  setDevice: (key: string) => void
  pause: () => void
  resume: () => void
  setZoom: (range: [number, number] | null) => void
}

export const useLiveView = create<LiveViewState>()(
  persist(
    (set, get) => ({
      plotted: [],
      seeded: false,
      windowSec: 30,
      device: null,
      pausedAt: null,
      zoom: null,
      toggle: (key) => {
        const { plotted } = get()
        if (plotted.some((p) => p.key === key)) {
          set({ plotted: plotted.filter((p) => p.key !== key) })
          return
        }
        if (plotted.length >= MAX_PLOTTED) return
        // Lowest free colour slot, so colours never shift when others are removed.
        let slot = 0
        while (plotted.some((p) => p.slot === slot)) slot++
        set({ plotted: [...plotted, { key, slot }] })
      },
      clearPlot: () => set({ plotted: [] }),
      seed: (target) => {
        if (get().seeded) return
        set({
          seeded: true,
          plotted: [
            { key: plotKey(target, 'currentMotor'), slot: 0 },
            { key: plotKey(target, 'currentIn'), slot: 1 },
          ],
        })
      },
      setWindow: (windowSec) => set({ windowSec, zoom: null }),
      setDevice: (device) => set({ device }),
      pause: () => set({ pausedAt: useLiveData.getState().lastAt || Date.now() }),
      resume: () => set({ pausedAt: null, zoom: null }),
      setZoom: (zoom) => set((s) => ({ zoom, pausedAt: zoom ? (s.pausedAt ?? (useLiveData.getState().lastAt || Date.now())) : s.pausedAt })),
    }),
    {
      name: 'ohmic.live',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ plotted: s.plotted, seeded: s.seeded, windowSec: s.windowSec }),
    },
  ),
)

let viewers = 0

/** The IMU is only read while the Live screen is open, so riding isn't slowed down by it. */
export function useLiveViewer() {
  useEffect(() => addLiveViewer(), [])
}

/** Counts a viewer of the Live screen; call the returned function when it closes. */
export function addLiveViewer(): () => void {
  viewers++
  let open = true
  return () => {
    if (open) viewers--
    open = false
  }
}

const imuRequests = new Map<string, number>()

/** Asks for a controller's IMU to be read every cycle (the ride recorder); call the returned function to stop. */
export function requestImu(key: string): () => void {
  imuRequests.set(key, (imuRequests.get(key) ?? 0) + 1)
  let open = true
  return () => {
    if (!open) return
    open = false
    const n = (imuRequests.get(key) ?? 1) - 1
    if (n > 0) imuRequests.set(key, n)
    else imuRequests.delete(key)
  }
}

/** Target keys whose IMU should be read this cycle. */
export function imuWanted(): Set<string> {
  const out = new Set<string>(imuRequests.keys())
  if (viewers === 0) return out
  const { device, plotted } = useLiveView.getState()
  if (device) out.add(device)
  for (const p of plotted) {
    const { target, signal } = parsePlotKey(p.key)
    if (signalDef(signal)?.group === 'IMU') out.add(target)
  }
  return out
}
