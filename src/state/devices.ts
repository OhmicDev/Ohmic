// The controllers found on a connection: the one we're plugged into ("local")
// plus anything that answered a CAN ping.

import type { Target } from '../client/VescClient'
import { HW_TYPE, hwTypeLabel } from '../protocol/commands'
import type { FwVersion } from '../protocol/messages'

/** What the dashboard shows: every motor controller combined, or one device. */
export type View = 'all' | Target

export interface DeviceInfo {
  target: Target
  fw: FwVersion | null
  /** Motor controllers answer GET_VALUES; BMS and other modules don't. */
  motor: boolean
}

export function isMotorController(fw: FwVersion | null): boolean {
  return fw?.hwType === HW_TYPE.VESC
}

export function targetKey(t: Target): string {
  return t === 'local' ? 'local' : `can${t}`
}

export function targetFromKey(key: string): Target {
  return key === 'local' ? 'local' : Number(key.slice(3))
}

export function targetLabel(t: Target): string {
  return t === 'local' ? 'Local' : `CAN ${t}`
}

export function viewKey(v: View): string {
  return v === 'all' ? 'all' : targetKey(v)
}

export function viewFromKey(key: string): View {
  return key === 'all' ? 'all' : targetFromKey(key)
}

export function deviceKind(d: DeviceInfo): string {
  if (!d.fw) return 'Unknown device'
  if (d.fw.hwType === HW_TYPE.CUSTOM_MODULE && /express/i.test(d.fw.hwName)) return 'VESC Express'
  return hwTypeLabel(d.fw.hwType)
}

/** The motor controller whose speed and voltage lead the dashboard: local if it is one, else the first on CAN. */
export function pickPrimary(devices: DeviceInfo[]): Target | null {
  return devices.find((d) => d.motor)?.target ?? null
}

function isViewValid(view: View, devices: DeviceInfo[]): boolean {
  return view === 'all' || devices.some((d) => d.motor && d.target === view)
}

/** First valid view among the candidates (a remembered choice, the current one), else all. */
export function pickView(candidates: (View | undefined)[], devices: DeviceInfo[]): View {
  for (const c of candidates) if (c !== undefined && isViewValid(c, devices)) return c
  return 'all'
}
