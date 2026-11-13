// User preferences. These are conveniences, so browser storage is fine here;
// anything that matters (backups, logs) goes to IndexedDB.

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_VEHICLE, type Units, type VehicleSetup } from '../lib/vehicle'
import type { AbsSensitivity } from '../onboard/abs'
import { REGEN_DEFAULTS, type RegenSettings } from '../onboard/regen'
import type { WheelieCalibration, WheelieSettings } from '../onboard/wheelie'
import type { BleChunkSize } from '../transport/BleTransport'
import type { View } from './devices'

/** Flat colours, each 4.5:1 or better as text on the dark surfaces and under dark text. White
    is the default: the light theme draws it near-black (see ui/theme.ts). */
export const ACCENTS = [
  { name: 'White', value: '#f2f2f3' },
  { name: 'Blue', value: '#4c9be8' },
  { name: 'Green', value: '#2ecc71' },
  { name: 'Orange', value: '#f39c12' },
  { name: 'Purple', value: '#b07ce6' },
  { name: 'Red', value: '#ef5b4c' },
  { name: 'Teal', value: '#1abc9c' },
] as const

/** Earlier defaults: anyone still on one moves to the current default. */
const OLD_DEFAULT_ACCENTS = ['#3ee6ff', '#4c9be8']

/** 'system' follows the device's light or dark setting. */
export type ThemePref = 'system' | 'dark' | 'light'

/** 50 Hz only takes effect over USB; Bluetooth is capped at 20. */
export type PollHz = 5 | 10 | 20 | 50

/** Bench control: the most each mode may command, in the panel's units (A, %, ERPM). */
export interface BenchLimits {
  current: number
  duty: number
  rpm: number
  brake: number
  handbrake: number
}

export const DEFAULT_BENCH_LIMITS: BenchLimits = { current: 10, duty: 20, rpm: 5000, brake: 10, handbrake: 5 }

/** How long a latched bench run lasts before it stops by itself (s). */
export type LatchSeconds = 5 | 10 | 30 | 60

/** Ride log rows per second. */
export type LogRateHz = 5 | 10 | 20

interface LastConnection {
  kind: 'serial' | 'ble'
  name: string
  at: number
  /** The browser's id for a Bluetooth device, to find it again without the picker. */
  id?: string
}

interface SettingsState {
  accent: string
  theme: ThemePref
  /** Interface language (a code from LANGUAGES). */
  language: string
  /** The first-run intro was seen or skipped. */
  onboarded: boolean
  /** The front page was seen and the app opened from it; home then opens straight to Ride. */
  seenWelcome: boolean
  /** Developer option: keep a log of every packet to and from the controller. */
  protocolLog: boolean
  units: Units
  pollHz: PollHz
  autoReconnect: boolean
  bleChunkSize: BleChunkSize
  vehicle: VehicleSetup
  lastConnection: LastConnection | null
  /** When the app opens: show Connect and reconnect to the last device if the browser allows it. */
  autoConnect: boolean
  /** Dashboard view last picked for each local controller, by UUID. */
  deviceViews: Record<string, View>
  /** The controller (config device key) that keeps driving in single-motor mode. */
  singleMotorKey: string | null
  absSensitivity: AbsSensitivity
  /** ABS waits until braking has been on for absDelayS, so the brakes coming on isn't taken for a skid. */
  absAfterRelease: boolean
  absDelayS: number
  /** The rider has read what ABS does and doesn't do. */
  absAcknowledged: boolean
  /** Motor sound volume, as current through the windings (A). */
  soundAmps: number
  /** Controllers this app last turned ABS on for, so it checks them after reconnecting. */
  absArmed: string[]
  benchLimits: BenchLimits
  latchSeconds: LatchSeconds
  regen: RegenSettings
  /** The rider has read what regen does. */
  regenAcknowledged: boolean
  /** Controllers this app last turned regen on for, so it checks them after reconnecting. */
  regenArmed: string[]
  logRateHz: LogRateHz
  /** Record the phone's position with each ride. */
  logGps: boolean
  /** Record lean and acceleration (the controller's IMU, else the phone's). */
  logImu: boolean
  /** Keep the screen from dimming or locking while the Ride dashboard is live. */
  keepAwake: boolean
  /** The sidebar is closed down to its icons (wide screens). */
  sidebarClosed: boolean
  /** Auto-wheelie settings the rider changed from the program's defaults (the rest come from the program). */
  wheelie: Partial<WheelieSettings>
  /** IMU calibration for the wheelie, by the config key of the controller that runs it. */
  wheelieCal: Record<string, WheelieCalibration>
  /** Which wheel the controller that reads the throttle drives; null until the rider says. */
  wheelieHostWheel: 'rear' | 'front' | null
  /** The rider has read the wheelie safety notes. */
  wheelieAcknowledged: boolean
  setAccent: (accent: string) => void
  setTheme: (theme: ThemePref) => void
  setLanguage: (language: string) => void
  setOnboarded: (done: boolean) => void
  /** Leaves the front page for the app (the front page already explained it, so no intro). */
  enterApp: () => void
  setProtocolLog: (on: boolean) => void
  setUnits: (units: Units) => void
  setPollHz: (hz: PollHz) => void
  setAutoReconnect: (on: boolean) => void
  setBleChunkSize: (n: BleChunkSize) => void
  updateVehicle: (patch: Partial<VehicleSetup>) => void
  resetVehicle: () => void
  setLastConnection: (c: LastConnection) => void
  setAutoConnect: (on: boolean) => void
  rememberView: (uuid: string, view: View) => void
  setSingleMotorKey: (key: string | null) => void
  setAbsSensitivity: (s: AbsSensitivity) => void
  setAbsAfterRelease: (on: boolean) => void
  setAbsDelayS: (s: number) => void
  acknowledgeAbs: () => void
  setSoundAmps: (a: number) => void
  setAbsArmed: (keys: string[]) => void
  setBenchLimit: (mode: keyof BenchLimits, value: number) => void
  setLatchSeconds: (s: LatchSeconds) => void
  setRegen: (patch: Partial<RegenSettings>) => void
  acknowledgeRegen: () => void
  setRegenArmed: (keys: string[]) => void
  setLogRateHz: (hz: LogRateHz) => void
  setLogGps: (on: boolean) => void
  setLogImu: (on: boolean) => void
  setKeepAwake: (on: boolean) => void
  setSidebarClosed: (closed: boolean) => void
  setWheelie: (patch: Partial<WheelieSettings>) => void
  resetWheelie: () => void
  setWheelieCal: (key: string, cal: WheelieCalibration | null) => void
  setWheelieHostWheel: (wheel: 'rear' | 'front') => void
  acknowledgeWheelie: () => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      accent: ACCENTS[0].value,
      theme: 'dark',
      language: 'en',
      onboarded: false,
      seenWelcome: false,
      protocolLog: false,
      units: 'metric',
      pollHz: 10,
      autoReconnect: true,
      bleChunkSize: 20,
      vehicle: DEFAULT_VEHICLE,
      lastConnection: null,
      autoConnect: true,
      deviceViews: {},
      singleMotorKey: null,
      absSensitivity: 'normal',
      absAfterRelease: false,
      absDelayS: 0.3,
      absAcknowledged: false,
      soundAmps: 3,
      absArmed: [],
      benchLimits: DEFAULT_BENCH_LIMITS,
      latchSeconds: 10,
      regen: REGEN_DEFAULTS,
      regenAcknowledged: false,
      regenArmed: [],
      logRateHz: 10,
      logGps: true,
      logImu: false,
      keepAwake: true,
      sidebarClosed: false,
      wheelie: {},
      wheelieCal: {},
      wheelieHostWheel: null,
      wheelieAcknowledged: false,
      setAccent: (accent) => set({ accent }),
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setOnboarded: (onboarded) => set({ onboarded }),
      enterApp: () => set({ seenWelcome: true, onboarded: true }),
      setProtocolLog: (protocolLog) => set({ protocolLog }),
      setUnits: (units) => set({ units }),
      setPollHz: (pollHz) => set({ pollHz }),
      setAutoReconnect: (autoReconnect) => set({ autoReconnect }),
      setBleChunkSize: (bleChunkSize) => set({ bleChunkSize }),
      updateVehicle: (patch) => set((s) => ({ vehicle: { ...s.vehicle, ...patch } })),
      resetVehicle: () => set({ vehicle: DEFAULT_VEHICLE }),
      setLastConnection: (lastConnection) => set({ lastConnection }),
      setAutoConnect: (autoConnect) => set({ autoConnect }),
      rememberView: (uuid, view) => set((s) => ({ deviceViews: { ...s.deviceViews, [uuid]: view } })),
      setSingleMotorKey: (singleMotorKey) => set({ singleMotorKey }),
      setAbsSensitivity: (absSensitivity) => set({ absSensitivity }),
      setAbsAfterRelease: (absAfterRelease) => set({ absAfterRelease }),
      setAbsDelayS: (absDelayS) => set({ absDelayS }),
      acknowledgeAbs: () => set({ absAcknowledged: true }),
      setSoundAmps: (soundAmps) => set({ soundAmps }),
      setAbsArmed: (absArmed) => set({ absArmed }),
      setBenchLimit: (mode, value) => set((s) => ({ benchLimits: { ...s.benchLimits, [mode]: value } })),
      setLatchSeconds: (latchSeconds) => set({ latchSeconds }),
      setRegen: (patch) => set((s) => ({ regen: { ...s.regen, ...patch } })),
      acknowledgeRegen: () => set({ regenAcknowledged: true }),
      setRegenArmed: (regenArmed) => set({ regenArmed }),
      setLogRateHz: (logRateHz) => set({ logRateHz }),
      setLogGps: (logGps) => set({ logGps }),
      setLogImu: (logImu) => set({ logImu }),
      setKeepAwake: (keepAwake) => set({ keepAwake }),
      setSidebarClosed: (sidebarClosed) => set({ sidebarClosed }),
      setWheelie: (patch) => set((s) => ({ wheelie: { ...s.wheelie, ...patch } })),
      resetWheelie: () => set({ wheelie: {} }),
      setWheelieCal: (key, cal) =>
        set((s) => {
          const next = { ...s.wheelieCal }
          if (cal) next[key] = cal
          else delete next[key]
          return { wheelieCal: next }
        }),
      setWheelieHostWheel: (wheelieHostWheel) => set({ wheelieHostWheel }),
      acknowledgeWheelie: () => set({ wheelieAcknowledged: true }),
    }),
    {
      name: 'ohmic.settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const p = { ...((persisted ?? {}) as Partial<SettingsState> & { includeCanInTotals?: unknown; ai?: unknown }) }
        delete p.includeCanInTotals // replaced by the device switcher
        delete p.ai // the removed tuning assistant's settings
        if (p.accent && OLD_DEFAULT_ACCENTS.includes(p.accent)) delete p.accent
        if (persisted && p.onboarded === undefined) p.onboarded = true
        return {
          ...current,
          ...p,
          vehicle: { ...DEFAULT_VEHICLE, ...(p.vehicle ?? {}) },
          benchLimits: { ...DEFAULT_BENCH_LIMITS, ...(p.benchLimits ?? {}) },
          regen: { ...REGEN_DEFAULTS, ...(p.regen ?? {}) },
        }
      },
    },
  ),
)
