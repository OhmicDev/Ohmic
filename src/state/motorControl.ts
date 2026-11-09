// Bench control: drive a motor from the app in any of the firmware's control
// modes, with the wheel off the ground. Safety, in order:
//
//  - It starts only with the wheel confirmed lifted and stopped, and never during
//    a firmware update, motor test or ABS test.
//  - Values outside the test limit are refused, never trimmed. The test limit is
//    the rider's bench limit or the controller's own, whichever is lower.
//  - It runs while held, or latched for a set time at most. Letting go, Escape,
//    the app losing focus or being hidden, a dropped link, stale live data or a
//    fault all stop it.
//  - Commands repeat every 100 ms with a keep-alive, so if the app freezes the
//    controller's own timeout stops the motor within about a second.

import { create } from 'zustand'
import type { Target, VescClient } from '../client/VescClient'
import type { ConfigValues } from '../config/types'
import { faultInfo } from '../protocol/faults'
import { stopAbsTest, useAbsTest } from './absTest'
import { useConfig, type DeviceConfig } from './config'
import { targetKey } from './devices'
import { motionBlock } from './motion'
import { stopMotorTest, useMotorTest } from './motorTest'
import { activeClient, useSession } from './session'
import { useSettings, type BenchLimits } from './settings'
import { useTelemetry } from './telemetry'

export type ControlMode = 'current' | 'duty' | 'rpm' | 'pos' | 'brake' | 'handbrake'

interface ModeSpec {
  mode: ControlMode
  label: string
  unit: string
  /** Negative values turn the motor the other way. */
  signed: boolean
  digits: number
  /** What ↑ and ↓ change it by (Shift: ten times as much). */
  step: number
  help: string
  /** The controller's own limit for this mode, in the panel's units. */
  own: (mc: ConfigValues) => number
}

const n = (mc: ConfigValues, k: string) => Number(mc[k])
/** A current limit's scale setting, or 1 when the firmware has none. */
const scaleOf = (mc: ConfigValues, k: string) => (Number.isFinite(n(mc, k)) ? n(mc, k) : 1)
const driveAmps = (mc: ConfigValues) => n(mc, 'l_current_max') * scaleOf(mc, 'l_current_max_scale')

export const MODES: ModeSpec[] = [
  {
    mode: 'current',
    label: 'Current',
    unit: 'A',
    signed: true,
    digits: 1,
    step: 0.5,
    help: 'Pushes with a set motor current. A lifted wheel keeps speeding up until the battery voltage runs out, so start low.',
    own: driveAmps,
  },
  {
    mode: 'duty',
    label: 'Duty',
    unit: '%',
    signed: true,
    digits: 0,
    step: 1,
    help: 'Applies a set share of the battery voltage. The wheel settles at a speed that follows it.',
    own: (mc) => n(mc, 'l_max_duty') * 100,
  },
  {
    mode: 'rpm',
    label: 'Speed',
    unit: 'ERPM',
    signed: true,
    digits: 0,
    step: 100,
    help: 'Holds an electrical RPM, using as much current as it takes.',
    own: (mc) => Math.min(n(mc, 'l_max_erpm'), Math.abs(n(mc, 'l_min_erpm'))),
  },
  {
    mode: 'pos',
    label: 'Position',
    unit: '°',
    signed: false,
    digits: 0,
    step: 5,
    help: 'Turns the rotor to an angle and holds it there. Meant for motors with an encoder; without one it can jump or buzz.',
    own: () => 360,
  },
  {
    mode: 'brake',
    label: 'Brake',
    unit: 'A',
    signed: false,
    digits: 1,
    step: 0.5,
    help: 'Brakes a turning motor with a set current. Spin the wheel up in another mode first, let go, then brake it.',
    own: (mc) => Math.abs(n(mc, 'l_current_min')) * scaleOf(mc, 'l_current_min_scale'),
  },
  {
    mode: 'handbrake',
    label: 'Handbrake',
    unit: 'A',
    signed: false,
    digits: 1,
    step: 0.5,
    help: 'Holds the motor still with current, even when stopped. It heats the motor, so keep it short.',
    own: driveAmps,
  },
]

export const modeSpec = (mode: ControlMode) => MODES.find((m) => m.mode === mode)!

/** Bench limits the rider sets (position always spans a full turn). */
export const benchLimitOf = (mode: ControlMode, limits: BenchLimits) => (mode === 'pos' ? 360 : limits[mode])

const REPEAT_MS = 100
/** Holding down runs at most this long. */
const HOLD_MAX_MS = 60_000
/** Live data older than this while running stops the motor. */
const STALE_MS = 2000
/** A wheel still coasting from a run here may be driven again this soon after. */
const COAST_GRACE_MS = 10_000

const PRESETS = [0.1, 0.25, 0.5, 0.75, 1] as const

interface TestLimit {
  limit: number
  /** What sets it: the rider's bench limit, or a controller's own. */
  by: string
}

/** The test limit for driving these controllers in this mode, or why there isn't one. */
export function testLimit(mode: ControlMode, devices: DeviceConfig[], limits = useSettings.getState().benchLimits): TestLimit | { error: string } {
  const spec = modeSpec(mode)
  let limit = benchLimitOf(mode, limits)
  let by = mode === 'pos' ? 'a full turn' : 'your bench limit'
  for (const d of devices) {
    const mc = d.mcconf.device
    if (!mc) return { error: `${d.name}’s settings haven’t been read, so its limits aren’t known.` }
    const own = spec.own(mc)
    if (!Number.isFinite(own) || own <= 0) return { error: `${d.name} has no ${spec.label.toLowerCase()} limit set in its motor settings.` }
    if (own < limit) {
      limit = own
      by = `${d.name}’s own limit`
    }
  }
  return { limit, by }
}

export const fmtValue = (mode: ControlMode, v: number) => {
  const spec = modeSpec(mode)
  const s = v.toFixed(spec.digits)
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s
}

/** Reads a typed value. Refuses anything outside the test limit rather than trimming it. */
export function parseValue(mode: ControlMode, text: string, limit: number): { value: number } | { error: string } {
  const spec = modeSpec(mode)
  const t = text.trim().replace(',', '.')
  if (!t) return { error: 'Enter a value.' }
  const v = Number(t)
  if (!Number.isFinite(v)) return { error: 'That isn’t a number.' }
  if (mode === 'pos') return v >= 0 && v <= 360 ? { value: v } : { error: 'Pick an angle from 0 to 360°.' }
  if (!spec.signed && v < 0) return { error: `Use a positive value. ${spec.label} works the same either way the motor turns.` }
  if (Math.abs(v) > limit + 1e-9) {
    return { error: `${fmtValue(mode, v)} ${spec.unit} is over the test limit of ${spec.signed ? '±' : ''}${fmtValue(mode, limit)} ${spec.unit}.` }
  }
  return { value: v }
}

/** Preset values: shares of the test limit, rounded down to the step so none goes over. */
export function presetValues(mode: ControlMode, limit: number): number[] {
  const step = modeSpec(mode).step
  return PRESETS.map((p) => Math.floor((limit * p) / step + 1e-9) * step)
}

interface BenchRun {
  mode: ControlMode
  value: number
  limit: number
  keys: string[]
  targets: Target[]
  latched: boolean
  startedAt: number
  endsAt: number
}

interface ControlState {
  mode: ControlMode
  /** What's typed in the value box, per mode. */
  inputs: Record<ControlMode, string>
  /** The controller the panel drives (config device key). */
  key: string | null
  /** Others driven with the same command. */
  also: string[]
  latch: boolean
  /** The rider confirmed the wheel is off the ground. */
  lifted: boolean
  run: BenchRun | null
  /** Why it couldn't start, or why it stopped by itself. */
  error: string | null
  /** A value typed while running that was refused (the motor keeps the last good one). */
  inputError: string | null
}

const initialInputs: Record<ControlMode, string> = { current: '2', duty: '5', rpm: '1000', pos: '90', brake: '3', handbrake: '2' }

export const useMotorControl = create<ControlState>()(() => ({
  mode: 'current',
  inputs: { ...initialInputs },
  key: null,
  also: [],
  latch: false,
  lifted: false,
  run: null,
  error: null,
  inputError: null,
}))

const set = useMotorControl.setState
const get = useMotorControl.getState

/** The controllers a run would drive: the chosen one first, then any also driven. */
export function runDevices(s: Pick<ControlState, 'key' | 'also'> = get()): DeviceConfig[] {
  const { devices, order } = useConfig.getState()
  const main = s.key && devices[s.key] ? s.key : (order[0] ?? null)
  if (!main) return []
  return [main, ...s.also.filter((k) => k !== main && order.includes(k))].map((k) => devices[k]).filter(Boolean)
}

/** Braking modes only slow a motor down, so they may start while it turns. */
export const slowsOnly = (mode: ControlMode) => mode === 'brake' || mode === 'handbrake'

/** The last run here: its controllers, and when it ended. */
let lastRun: { keys: string[]; at: number } = { keys: [], at: 0 }
// A new connection starts a new bench session.
useSession.subscribe((s, prev) => {
  if (s.status !== 'connected' && prev.status === 'connected') lastRun = { keys: [], at: 0 }
})

/** Why bench control can't start right now, or null. */
function controlBlock(devs: DeviceConfig[], mode: ControlMode = get().mode): string | null {
  if (useSession.getState().status !== 'connected' || !activeClient()) return 'Connect to a motor controller first.'
  const busy = useSession.getState().busy
  if (busy) return `Wait until ${busy} is done.`
  if (!devs.length) return 'No motor controller found.'
  if (useMotorTest.getState().running) return 'A motor test is running.'
  const abs = useAbsTest.getState().phase
  if (abs === 'checking' || abs === 'spinning' || abs === 'braking') return 'The ABS test is running.'
  if (!get().lifted) return 'Lift the wheel off the ground and tick the box to confirm.'
  // A wheel still coasting from a run here is the bench's own doing, so it may be driven again.
  const coasting = Date.now() - lastRun.at < COAST_GRACE_MS && devs.every((d) => lastRun.keys.includes(d.key))
  if (slowsOnly(mode) || coasting) {
    const t = useTelemetry.getState()
    if (Date.now() - t.lastUpdate > STALE_MS) return 'Waiting for live data from the controller.'
    const missing = devs.find((d) => !t.devices[targetKey(d.target)])
    return missing ? `No live data from ${missing.name} yet.` : null
  }
  return motionBlock(
    devs.map((d) => d.target),
    Date.now(),
    'start bench control',
  )
}

function send(client: VescClient, mode: ControlMode, value: number, t: Target) {
  switch (mode) {
    case 'current':
      return client.setCurrent(value, t)
    case 'duty':
      return client.setDuty(value / 100, t)
    case 'rpm':
      return client.setRpm(value, t)
    case 'pos':
      return client.setPos(value, t)
    case 'brake':
      return client.setCurrentBrake(value, t)
    case 'handbrake':
      return client.setHandbrake(value, t)
  }
}

/** Lets motors coast: zero current, twice in case one is lost on a busy link. */
function release(targets: Target[]) {
  const client = activeClient()
  if (!client) return
  for (const t of targets) void client.setCurrent(0, t).catch(() => {})
  setTimeout(() => {
    for (const t of targets) void client.setCurrent(0, t).catch(() => {})
  }, 60)
}

let timer: ReturnType<typeof setInterval> | null = null
let deadline: ReturnType<typeof setTimeout> | null = null
let unlisten: (() => void) | null = null

/** Starts driving. Held runs stop on release (call stopControl); latched ones after the latch time. */
export function startControl(latched = get().latch): string | null {
  const s = get()
  if (s.run) return null
  const devs = runDevices()
  const fail = (error: string) => {
    set({ error })
    return error
  }
  const block = controlBlock(devs, s.mode)
  if (block) return fail(block)
  const lim = testLimit(s.mode, devs)
  if ('error' in lim) return fail(lim.error)
  const parsed = parseValue(s.mode, s.inputs[s.mode], lim.limit)
  if ('error' in parsed) return fail(parsed.error)
  const client = activeClient()!
  const now = Date.now()
  const runMs = latched ? useSettings.getState().latchSeconds * 1000 : HOLD_MAX_MS
  const run: BenchRun = {
    mode: s.mode,
    value: parsed.value,
    limit: lim.limit,
    keys: devs.map((d) => d.key),
    targets: devs.map((d) => d.target),
    latched,
    startedAt: now,
    endsAt: now + runMs,
  }

  const tick = () => {
    const r = get().run
    if (!r) return
    const t = useTelemetry.getState()
    if (Date.now() - t.lastUpdate > STALE_MS) return stopControl('Live data stopped coming in, so the motor was stopped.')
    for (const target of r.targets) {
      const fault = t.devices[targetKey(target)]?.fault ?? 0
      if (fault) return stopControl(`${devs.find((d) => d.target === target)?.name ?? 'A controller'} reported a fault (${faultInfo(fault).title}), so the motor was stopped.`)
    }
    for (const target of r.targets) {
      void send(client, r.mode, r.value, target).catch(() => stopControl('A command didn’t go through, so the motor was stopped.'))
      void client.sendAlive(target).catch(() => {})
    }
  }

  // Dead-man: anything that takes the rider's attention away stops the motor.
  const stop = () => stopControl()
  const onHidden = () => document.visibilityState !== 'visible' && stop()
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stop()
  window.addEventListener('blur', stop)
  window.addEventListener('pagehide', stop)
  document.addEventListener('visibilitychange', onHidden)
  window.addEventListener('keydown', onKey)
  const offSession = useSession.subscribe((st) => (st.status !== 'connected' || st.busy) && stopControl('The connection changed, so the motor was stopped.'))
  unlisten = () => {
    window.removeEventListener('blur', stop)
    window.removeEventListener('pagehide', stop)
    document.removeEventListener('visibilitychange', onHidden)
    window.removeEventListener('keydown', onKey)
    offSession()
  }

  set({ run, error: null, inputError: null })
  tick()
  timer = setInterval(tick, REPEAT_MS)
  deadline = setTimeout(() => stopControl(latched ? null : 'Stopped after a minute of holding. Press again to carry on.'), runMs)
  return null
}

/** Stops driving and lets the motors coast. Safe to call any time. */
export function stopControl(error: string | null = null) {
  if (timer) clearInterval(timer)
  if (deadline) clearTimeout(deadline)
  timer = null
  deadline = null
  unlisten?.()
  unlisten = null
  const r = get().run
  if (!r) {
    if (error) set({ error })
    return
  }
  release(r.targets)
  lastRun = { keys: r.keys, at: Date.now() }
  set({ run: null, error, inputError: null })
}

/** Stops everything that may be turning a motor, on every controller. */
export function stopAll() {
  stopControl()
  stopMotorTest()
  stopAbsTest()
  release(useSession.getState().devices.filter((d) => d.motor).map((d) => d.target))
}

export function setMode(mode: ControlMode) {
  if (get().mode === mode) return
  stopControl()
  set({ mode, error: null, inputError: null })
}

export function setControlKey(key: string) {
  if (get().key === key) return
  stopControl()
  set((s) => ({ key, also: s.also.filter((k) => k !== key), error: null }))
}

export function toggleAlso(key: string) {
  stopControl()
  set((s) => ({ also: s.also.includes(key) ? s.also.filter((k) => k !== key) : [...s.also, key], error: null }))
}

export function setLatch(latch: boolean) {
  stopControl()
  set({ latch })
}

export function setLifted(lifted: boolean) {
  if (!lifted) {
    stopControl()
    lastRun = { keys: [], at: 0 }
  }
  set({ lifted, error: null })
}

/** Changes the value; while running, the motor follows it if it's within the test limit. */
export function setInput(text: string) {
  const s = get()
  set({ inputs: { ...s.inputs, [s.mode]: text } })
  const r = s.run
  if (!r || r.mode !== s.mode) return
  const parsed = parseValue(r.mode, text, r.limit)
  if ('error' in parsed) set({ inputError: `${parsed.error} The motor keeps ${fmtValue(r.mode, r.value)} ${modeSpec(r.mode).unit}.` })
  else set({ run: { ...r, value: parsed.value }, inputError: null })
}

/** ↑ / ↓: one step (or ten), stopping at the test limit. */
export function nudge(direction: 1 | -1, big = false) {
  const s = get()
  const spec = modeSpec(s.mode)
  const limit = s.run?.limit ?? (() => {
    const l = testLimit(s.mode, runDevices())
    return 'error' in l ? null : l.limit
  })()
  if (limit === null) return
  const typed = Number(s.inputs[s.mode].trim().replace(',', '.'))
  const base = Number.isFinite(typed) ? typed : 0
  const lo = spec.signed ? -limit : 0
  let next = Math.round((base + direction * spec.step * (big ? 10 : 1)) / spec.step) * spec.step
  if (s.mode === 'pos') next = ((next % 360) + 360) % 360
  else next = Math.max(lo, Math.min(limit, next))
  setInput(fmtValue(s.mode, next))
}
