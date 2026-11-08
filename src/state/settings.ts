// User preferences. These are conveniences, so browser storage is fine here;
// anything that matters (backups, logs) goes to IndexedDB in later phases.

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_VEHICLE, type Units, type VehicleSetup } from '../lib/vehicle'
import type { AbsSensitivity } from '../onboard/abs'
import { REGEN_DEFAULTS, type RegenSettings } from '../onboard/regen'
import type { BleChunkSize } from '../transport/BleTransport'
import type { View } from './devices'

export const ACCENTS = [
  { name: 'Volt', value: '#3ee6ff' },
  { name: 'Lime', value: '#b6f24a' },
  { name: 'Amber', value: '#ffb547' },
  { name: 'Signal', value: '#ff4d5e' },
  { name: 'Iris', value: '#9b8cff' },
  { name: 'Frost', value: '#e9eef5' },
] as const

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

/** What the tuning assistant may see and whether it's on. */
export interface AiSettings {
  enabled: boolean
  shareLive: boolean
  shareRides: boolean
  shareFaults: boolean
  /** For an AI server that asks for one (AI_ACCESS_CODE). */
  accessCode: string
}

export const AI_DEFAULTS: AiSettings = { enabled: true, shareLive: true, shareRides: true, shareFaults: true, accessCode: '' }

export interface LastConnection {
  kind: 'serial' | 'ble'
  name: string
  at: number
}

interface SettingsState {
  accent: string
  theme: ThemePref
  /** Interface language (a code from LANGUAGES). */
  language: string
  /** The first-run intro was seen or skipped. */
  onboarded: boolean
  /** Developer option: keep a log of every packet to and from the controller. */
  protocolLog: boolean
  units: Units
  pollHz: PollHz
  autoReconnect: boolean
  bleChunkSize: BleChunkSize
  vehicle: VehicleSetup
  lastConnection: LastConnection | null
  /** Dashboard view last picked for each local controller, by UUID. */
  deviceViews: Record<string, View>
  /** The controller (config device key) that keeps driving in single-motor mode. */
  singleMotorKey: string | null
  absSensitivity: AbsSensitivity
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
  ai: AiSettings
  setAccent: (accent: string) => void
  setTheme: (theme: ThemePref) => void
  setLanguage: (language: string) => void
  setOnboarded: (done: boolean) => void
  setProtocolLog: (on: boolean) => void
  setUnits: (units: Units) => void
  setPollHz: (hz: PollHz) => void
  setAutoReconnect: (on: boolean) => void
  setBleChunkSize: (n: BleChunkSize) => void
  updateVehicle: (patch: Partial<VehicleSetup>) => void
  resetVehicle: () => void
  setLastConnection: (c: LastConnection) => void
  rememberView: (uuid: string, view: View) => void
  setSingleMotorKey: (key: string | null) => void
  setAbsSensitivity: (s: AbsSensitivity) => void
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
  setAi: (patch: Partial<AiSettings>) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      accent: ACCENTS[0].value,
      theme: 'dark',
      language: 'en',
      onboarded: false,
      protocolLog: false,
      units: 'metric',
      pollHz: 10,
      autoReconnect: true,
      bleChunkSize: 20,
      vehicle: DEFAULT_VEHICLE,
      lastConnection: null,
      deviceViews: {},
      singleMotorKey: null,
      absSensitivity: 'normal',
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
      ai: AI_DEFAULTS,
      setAccent: (accent) => set({ accent }),
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setOnboarded: (onboarded) => set({ onboarded }),
      setProtocolLog: (protocolLog) => set({ protocolLog }),
      setUnits: (units) => set({ units }),
      setPollHz: (pollHz) => set({ pollHz }),
      setAutoReconnect: (autoReconnect) => set({ autoReconnect }),
      setBleChunkSize: (bleChunkSize) => set({ bleChunkSize }),
      updateVehicle: (patch) => set((s) => ({ vehicle: { ...s.vehicle, ...patch } })),
      resetVehicle: () => set({ vehicle: DEFAULT_VEHICLE }),
      setLastConnection: (lastConnection) => set({ lastConnection }),
      rememberView: (uuid, view) => set((s) => ({ deviceViews: { ...s.deviceViews, [uuid]: view } })),
      setSingleMotorKey: (singleMotorKey) => set({ singleMotorKey }),
      setAbsSensitivity: (absSensitivity) => set({ absSensitivity }),
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
      setAi: (patch) => set((s) => ({ ai: { ...s.ai, ...patch } })),
    }),
    {
      name: 'ohmic.settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const p = { ...((persisted ?? {}) as Partial<SettingsState> & { includeCanInTotals?: unknown }) }
        delete p.includeCanInTotals // replaced by the device switcher
        if (persisted && p.onboarded === undefined) p.onboarded = true
        return {
          ...current,
          ...p,
          vehicle: { ...DEFAULT_VEHICLE, ...(p.vehicle ?? {}) },
          benchLimits: { ...DEFAULT_BENCH_LIMITS, ...(p.benchLimits ?? {}) },
          regen: { ...REGEN_DEFAULTS, ...(p.regen ?? {}) },
          ai: { ...AI_DEFAULTS, ...(p.ai ?? {}) },
        }
      },
    },
  ),
)
