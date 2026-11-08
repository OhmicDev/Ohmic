// The vehicle profile: what the rider told the tuning assistant (or typed in)
// about the parts the controller can't report. The battery fields set how much
// current the guardrails allow. Stored in IndexedDB.

import { create } from 'zustand'
import type { PROFILE_FIELDS } from './agentSpec'

export type ProfileField = (typeof PROFILE_FIELDS)[number]
export type VehicleType = 'scooter' | 'ebike' | 'skateboard' | 'onewheel' | 'other'
export const VEHICLE_TYPES: VehicleType[] = ['scooter', 'ebike', 'skateboard', 'onewheel', 'other']

export interface VehicleProfile {
  id: 'main'
  vehicle_type: VehicleType | null
  cells_series: number | null
  cells_parallel: number | null
  cell_model: string | null
  /** One cell's continuous discharge rating (A). */
  cell_continuous_a: number | null
  /** One cell's maximum charge current (A); sets how much regen the pack takes. */
  cell_charge_a: number | null
  /** The BMS's continuous discharge limit (A). */
  bms_limit_a: number | null
  pack_ah: number | null
  motor_model: string | null
  motor_rated_w: number | null
  wheel_diameter_mm: number | null
  rider_weight_kg: number | null
  terrain: string | null
  riding_style: string | null
  region: string | null
  /** Fields the assistant filled in from the chat (the rider may want to check them). */
  fromChat: ProfileField[]
  updatedAt: number
}

export const EMPTY_PROFILE: VehicleProfile = {
  id: 'main',
  vehicle_type: null,
  cells_series: null,
  cells_parallel: null,
  cell_model: null,
  cell_continuous_a: null,
  cell_charge_a: null,
  bms_limit_a: null,
  pack_ah: null,
  motor_model: null,
  motor_rated_w: null,
  wheel_diameter_mm: null,
  rider_weight_kg: null,
  terrain: null,
  riding_style: null,
  region: null,
  fromChat: [],
  updatedAt: 0,
}

interface FieldRule {
  label: string
  unit?: string
  /** Whole number between min and max. */
  int?: boolean
  min?: number
  max?: number
  text?: boolean
  maxLen?: number
}

export const PROFILE_RULES: Record<ProfileField, FieldRule> = {
  vehicle_type: { label: 'Vehicle' },
  cells_series: { label: 'Cells in series', unit: 'S', int: true, min: 1, max: 40 },
  cells_parallel: { label: 'Cells in parallel', unit: 'P', int: true, min: 1, max: 40 },
  cell_model: { label: 'Cell model', text: true, maxLen: 60 },
  cell_continuous_a: { label: 'Cell continuous rating', unit: 'A', min: 0.5, max: 100 },
  cell_charge_a: { label: 'Cell max charge current', unit: 'A', min: 0.1, max: 50 },
  bms_limit_a: { label: 'BMS discharge limit', unit: 'A', min: 1, max: 1000 },
  pack_ah: { label: 'Pack capacity', unit: 'Ah', min: 0.5, max: 500 },
  motor_model: { label: 'Motor model', text: true, maxLen: 60 },
  motor_rated_w: { label: 'Motor rated power', unit: 'W', min: 50, max: 50000 },
  wheel_diameter_mm: { label: 'Wheel diameter', unit: 'mm', min: 50, max: 1500 },
  rider_weight_kg: { label: 'Rider weight', unit: 'kg', min: 20, max: 300 },
  terrain: { label: 'Terrain', text: true, maxLen: 80 },
  riding_style: { label: 'Riding style', text: true, maxLen: 80 },
  region: { label: 'Region', text: true, maxLen: 60 },
}

/** Parses one field from text. Bad values are refused with a reason, never adjusted. */
export function parseProfileField(field: ProfileField, raw: string): { value: VehicleProfile[ProfileField] } | { error: string } {
  const rule = PROFILE_RULES[field]
  const t = raw.trim()
  if (t === '') return { value: null }
  if (field === 'vehicle_type') {
    const v = t.toLowerCase().replace(/[\s-]/g, '') as VehicleType
    return VEHICLE_TYPES.includes(v) ? { value: v } : { error: `${rule.label} must be one of ${VEHICLE_TYPES.join(', ')}.` }
  }
  if (rule.text) return t.length > (rule.maxLen ?? 80) ? { error: `${rule.label} is too long.` } : { value: t }
  const n = Number(t.replace(',', '.'))
  if (!Number.isFinite(n)) return { error: `${rule.label} must be a number.` }
  if (rule.int && !Number.isInteger(n)) return { error: `${rule.label} must be a whole number.` }
  if (n < (rule.min ?? -Infinity) || n > (rule.max ?? Infinity)) return { error: `${rule.label} must be ${rule.min} to ${rule.max}${rule.unit ? ` ${rule.unit}` : ''}.` }
  return { value: n }
}

/** The most current the pack can give continuously, from the profile; null when unknown. */
export function packLimitA(p: VehicleProfile): { amps: number; from: string } | null {
  const cells = p.cells_parallel && p.cell_continuous_a ? p.cells_parallel * p.cell_continuous_a : null
  const bms = p.bms_limit_a
  if (cells === null && bms === null) return null
  if (cells !== null && (bms === null || cells <= bms)) return { amps: cells, from: `${p.cells_parallel} cells in parallel × ${p.cell_continuous_a} A` }
  return { amps: bms!, from: 'the BMS limit' }
}

/** The most regen current the pack takes, from the profile; null when unknown. */
export function packChargeLimitA(p: VehicleProfile): number | null {
  return p.cells_parallel && p.cell_charge_a ? p.cells_parallel * p.cell_charge_a : null
}

const table = () => import('../state/db').then((m) => m.db.aiProfile)

interface ProfileState {
  profile: VehicleProfile
  loaded: boolean
  load: () => Promise<void>
  /** Saves fields; `fromChat` marks them as filled in by the assistant. */
  update: (patch: Partial<Omit<VehicleProfile, 'id' | 'fromChat' | 'updatedAt'>>, fromChat?: boolean) => Promise<void>
}

export const useProfile = create<ProfileState>()((set, get) => ({
  profile: EMPTY_PROFILE,
  loaded: false,
  load: async () => {
    if (get().loaded) return
    try {
      const row = await (await table()).get('main')
      set({ profile: { ...EMPTY_PROFILE, ...row }, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
  update: async (patch, fromChat = false) => {
    await get().load()
    const keys = Object.keys(patch) as ProfileField[]
    const prev = get().profile
    const marked = fromChat ? [...new Set([...prev.fromChat, ...keys])] : prev.fromChat.filter((k) => !keys.includes(k))
    const profile: VehicleProfile = { ...prev, ...patch, fromChat: marked, updatedAt: Date.now() }
    set({ profile })
    try {
      await (await table()).put(profile)
    } catch {
      // Kept in memory for this session.
    }
  },
}))
