// Small programs that run on the motor controllers themselves (LispBM): ABS and
// motor sounds. They're sent through the firmware's script console (REPL), which
// starts the script engine if it isn't running and never touches a stored script.
//
// The console ignores a command sent less than half a second after the previous
// one to the same controller, or while one is still being evaluated, so everything
// goes through one queue that keeps a gap per controller. One queue also means
// printed output belongs to the command just sent.

import { create } from 'zustand'
import type { Target } from '../client/VescClient'
import type { ConfigValues } from '../config/types'
import { errorText } from '../lib/format'
import { speedPerErpm } from '../lib/rideModes'
import { ABS_ARM_RANGE, ABS_DEFAULTS, ABS_STATUS_PROGRAM, ABS_STOP_PROGRAM, absStartCommands, parseAbsStatus, SLIP_DECEL, type AbsParams, type AbsStatus } from '../onboard/abs'
import {
  parseRegenStatus,
  REGEN_MIN_SPEED,
  REGEN_STATUS_PROGRAM,
  REGEN_STOP_PROGRAM,
  regenSettingsProblem,
  regenStartCommands,
  strengthPct,
  throttleSource,
  type RegenParams,
  type RegenSettings,
  type RegenStatus,
  type ThrottleSource,
} from '../onboard/regen'
import { BUILT_IN_TUNES, MAX_NOTES, parseRtttl, playCommands, previewOnSpeaker, STOP_PROGRAM, TuneError, tuneMs, type Tune } from '../onboard/music'
import type { FwVersion } from '../protocol/messages'
import { motorDevices, useConfig, type DeviceConfig } from './config'
import { targetKey } from './devices'
import { motionBlock } from './motion'
import { activeClient, useSession } from './session'
import { useSettings } from './settings'
import { useTelemetry } from './telemetry'

/** The firmware drops console commands closer together than 0.5 s. */
const LISP_GAP_MS = 650
/** How long to listen for a result. */
const RESULT_MS = 1500

let chain: Promise<unknown> = Promise.resolve()
const lastAt = new Map<string, number>()
let internalListening = 0

/** True while one of Ohmic's own programs waits for its answer, so the LispBM console can label those lines. */
export function ohmicLispBusy(): boolean {
  return internalListening > 0
}

/**
 * Runs one expression on a controller. With waitMs > 0, returns what it printed
 * (the result line starts with "> "), or whatever arrived by then.
 */
export function runLisp(target: Target, code: string, waitMs = RESULT_MS, opts: { fromConsole?: boolean } = {}): Promise<string> {
  const job = chain.then(async () => {
    const client = activeClient()
    if (!client) throw new Error('Not connected.')
    const tk = targetKey(target)
    const wait = (lastAt.get(tk) ?? 0) + LISP_GAP_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    let text = ''
    let done: () => void = () => {}
    const finished = new Promise<void>((r) => (done = r))
    const off = client.onLispPrint((t) => {
      text += t.endsWith('\n') ? t : `${t}\n`
      if (/^> /m.test(text) || /error/i.test(t)) done()
    })
    if (!opts.fromConsole) internalListening++
    try {
      lastAt.set(tk, Date.now())
      await client.lispRepl(code, target)
      if (waitMs > 0) await Promise.race([finished, new Promise((r) => setTimeout(r, waitMs))])
    } finally {
      off()
      if (!opts.fromConsole) internalListening--
    }
    return text.trim()
  })
  chain = job.catch(() => {})
  return job
}

/** Sends several controllers' commands, alternating between them so their gaps overlap. */
async function sendInterleaved(plans: { target: Target; cmds: string[] }[], onStep?: (done: number, total: number) => void) {
  const total = plans.reduce((n, p) => n + p.cmds.length, 0)
  let done = 0
  const rounds = Math.max(0, ...plans.map((p) => p.cmds.length))
  for (let i = 0; i < rounds; i++) {
    for (const p of plans) {
      if (!p.cmds[i]) continue
      await runLisp(p.target, p.cmds[i], 0)
      onStep?.(++done, total)
    }
  }
}

const atLeast = (fw: FwVersion, major: number, minor: number) => fw.major > major || (fw.major === major && fw.minor >= minor)
const fwText = (major: number, minor: number) => `${major}.${String(minor).padStart(2, '0')}`

/** Why on-controller programs can't run on this controller, or null. */
function cantRun(d: DeviceConfig, minFw: [number, number], what: string): string | null {
  if (!atLeast(d.fw, ...minFw)) return `${what} needs firmware ${fwText(...minFw)} or newer; ${d.name} has ${fwText(d.fw.major, d.fw.minor)}.`
  if (d.mcconf.status === 'readonly') return `${d.name} runs firmware Ohmic only reads, so nothing is sent to it.`
  if (d.mcconf.status !== 'ready' || !d.mcconf.device) return `Still reading settings from ${d.name}.`
  return null
}

const num = (mc: ConfigValues, k: string) => Number(mc[k])
const newRunId = () => 1 + Math.floor(Math.random() * 99_998)

/** On when any controller reports it running (partly on counts as on, so the button offers Off); null when unknown. */
function reportedOn(status: Record<string, { on: boolean | null }>, list = motorDevices()): boolean | null {
  if (!list.length) return null
  const s = list.map((d) => status[d.key]?.on ?? null)
  if (s.some((x) => x === true)) return true
  if (s.some((x) => x === null)) return null
  return false
}

/**
 * Stops a program on every controller first, then checks each one, so normal
 * braking is back as fast as possible. True when every controller confirmed it.
 */
async function stopEverywhere(list: DeviceConfig[], stopProgram: string, read: (d: DeviceConfig) => Promise<{ on: boolean } | null>) {
  let ok = true
  for (const d of list) {
    try {
      await runLisp(d.target, stopProgram, 0)
    } catch {
      ok = false
    }
  }
  for (const d of list) {
    try {
      const st = await read(d)
      if (!st || st.on) ok = false
    } catch {
      ok = false
    }
  }
  return ok
}

/** Re-reads the status of every controller that can run programs. One that doesn't answer keeps its last status. */
async function readEach(read: (d: DeviceConfig) => Promise<unknown>): Promise<DeviceConfig[]> {
  const list = motorDevices().filter((d) => atLeast(d.fw, 6, 0) && d.mcconf.status === 'ready')
  for (const d of list) {
    try {
      await read(d)
    } catch {
      // leave as it was
    }
  }
  return list
}

interface AbsDeviceStatus {
  on: boolean | null
  interventions: number
  checkedAt: number
}

interface AbsStore {
  status: Record<string, AbsDeviceStatus>
  busy: boolean
  /** What's happening while busy, e.g. "Sending ABS to CAN 2 (3 of 8)". */
  step: string | null
  error: string | null
  /** The ABS settings last sent (absSettingsKey), so the page can offer to apply changes. */
  applied: string | null
  turnOn: () => Promise<boolean>
  turnOff: () => Promise<boolean>
  /** Asks each controller whether ABS is running and how often it has released the brake. */
  refresh: () => Promise<void>
}

/** The rider's ABS settings in one comparable string. */
export function absSettingsKey(): string {
  const { absSensitivity, absAfterRelease, absDelayS } = useSettings.getState()
  return `${absSensitivity}|${absAfterRelease ? absDelayS : 0}`
}

function absParamsFor(mc: ConfigValues): AbsParams | null {
  const spe = speedPerErpm(mc)
  if (!Number.isFinite(spe) || spe <= 0) return null
  const { absSensitivity, absAfterRelease, absDelayS } = useSettings.getState()
  return { ...ABS_DEFAULTS, speedPerErpm: spe, slipDecel: SLIP_DECEL[absSensitivity], armS: absAfterRelease ? absDelayS : 0 }
}

/** Why the ABS wait can't be used, or null. Values outside the range are refused, never trimmed. */
function absDelayProblem(): string | null {
  const { absAfterRelease, absDelayS } = useSettings.getState()
  if (!absAfterRelease) return null
  const { min, max } = ABS_ARM_RANGE
  return Number.isFinite(absDelayS) && absDelayS >= min && absDelayS <= max ? null : `The ABS wait must be from ${min} to ${max} s.`
}

export const absIsOn = reportedOn

/** Asks one controller for its ABS status (and keeps the store's copy fresh). */
export async function readAbs(d: DeviceConfig): Promise<AbsStatus | null> {
  const st = parseAbsStatus(await runLisp(d.target, ABS_STATUS_PROGRAM))
  useAbs.setState((s) => ({
    status: { ...s.status, [d.key]: { on: st ? st.on : null, interventions: st?.interventions ?? 0, checkedAt: Date.now() } },
  }))
  return st
}

export const useAbs = create<AbsStore>()((set, get) => ({
  status: {},
  busy: false,
  step: null,
  error: null,
  applied: null,

  turnOn: async () => {
    if (get().busy) return false
    const fail = (error: string) => {
      set({ busy: false, step: null, error })
      return false
    }
    const list = motorDevices()
    if (!list.length || !activeClient()) return fail('Connect to a controller first.')
    for (const d of list) {
      const why = cantRun(d, [6, 0], 'ABS')
      if (why) return fail(why)
    }
    const block = motionBlock(
      list.map((d) => d.target),
      Date.now(),
      'turn ABS on',
    )
    if (block) return fail(block)
    const badDelay = absDelayProblem()
    if (badDelay) return fail(badDelay)
    const params = list.map((d) => ({ d, p: absParamsFor(d.mcconf.device!) }))
    const noWheel = params.find((x) => !x.p)
    if (noWheel) return fail(`${noWheel.d.name} has no wheel size or motor poles set, so ABS can’t tell how fast the wheel turns.`)

    const runId = newRunId()
    set({ busy: true, error: null, step: 'Sending ABS to the controllers' })
    try {
      await sendInterleaved(
        params.map(({ d, p }) => ({ target: d.target, cmds: absStartCommands(p!, runId) })),
        (n, total) => set({ step: `Sending ABS to the controllers (${n} of ${total})` }),
      )
      // Proof it runs: this arming's ID comes back, and the loop counter moves.
      set({ step: 'Checking ABS is running' })
      const first = new Map<string, AbsStatus | null>()
      for (const { d } of params) first.set(d.key, await readAbs(d))
      for (const { d } of params) {
        const a = first.get(d.key)
        const b = await readAbs(d)
        if (!a?.on || !b?.on || b.runId !== runId) throw new Error(`${d.name} didn’t confirm ABS is running.`)
        if (a.beat === b.beat) throw new Error(`ABS on ${d.name} started but isn’t running its checks.`)
      }
      useSettings.getState().setAbsArmed(list.map((d) => d.key))
      set({ busy: false, step: null, applied: absSettingsKey() })
      return true
    } catch (e) {
      // Half-on ABS would brake unevenly: switch it off everywhere.
      set({ busy: false, step: null })
      await get().turnOff()
      return fail(`ABS wasn’t turned on: ${errorText(e)}`)
    }
  },

  turnOff: async () => {
    if (!activeClient()) return false
    set({ busy: true, step: 'Turning ABS off' })
    const ok = await stopEverywhere(motorDevices(), ABS_STOP_PROGRAM, readAbs)
    if (ok) useSettings.getState().setAbsArmed([])
    set({
      busy: false,
      step: null,
      error: ok ? null : 'A controller didn’t confirm ABS is off. Try again, or power-cycle the vehicle (ABS always starts off).',
    })
    return ok
  },

  refresh: async () => {
    const list = await readEach(readAbs)
    if (list.length && list.every((d) => get().status[d.key]?.on === false)) useSettings.getState().setAbsArmed([])
  },
}))

interface RegenPlan {
  /** The controller the throttle is wired to; regen runs there. */
  master: DeviceConfig
  source: ThrottleSource
  params: RegenParams
  /** The other controllers it brakes along with the master. */
  followers: DeviceConfig[]
}

/** Where regen would run and with what, or why it can't. */
export function regenPlan(settings: RegenSettings = useSettings.getState().regen): RegenPlan | { problem: string } {
  const list = motorDevices()
  if (!list.length || !activeClient()) return { problem: 'Connect to a motor controller first.' }
  const inputs: { d: DeviceConfig; src: ThrottleSource }[] = []
  for (const d of list) {
    const why = cantRun(d, [6, 0], 'Regen')
    if (why) return { problem: why }
    if (d.appconf.status !== 'ready' || !d.appconf.device) return { problem: `Still reading app settings from ${d.name}.` }
    const src = throttleSource(d.appconf.device)
    if (src && 'problem' in src) return { problem: `${d.name}: ${src.problem}` }
    if (src) inputs.push({ d, src })
  }
  if (!inputs.length) {
    return { problem: 'Regen needs the throttle wired to a motor controller (its ADC or PPM input), and none of yours reads one. Set it up under Setup → Throttle and brake.' }
  }
  if (inputs.length > 1) {
    return { problem: `${inputs.map((x) => x.d.name).join(' and ')} each read a throttle. Regen works when one controller reads it and drives the others over CAN.` }
  }
  const { d: master, src } = inputs[0]
  const mc = master.mcconf.device!
  const spe = speedPerErpm(mc)
  if (!Number.isFinite(spe) || spe <= 0) return { problem: `${master.name} has no wheel size or motor poles set, so regen can’t tell how fast you’re going.` }
  const brakeAmps = Math.abs(num(mc, 'l_current_min'))
  if (!(brakeAmps > 0)) return { problem: `${master.name} has no motor braking current set.` }
  const problem = regenSettingsProblem(settings)
  if (problem) return { problem }
  const followers = src.multi ? list.filter((d) => d.key !== master.key) : []
  const ids = followers.map((d) => (d.target === 'local' ? Number(d.appconf.device?.controller_id) : d.target))
  if (ids.some((id) => !Number.isInteger(id) || id < 0 || id > 254)) return { problem: 'A controller’s CAN ID couldn’t be read.' }
  return {
    master,
    source: src,
    followers,
    params: {
      speedPerErpm: spe,
      amps: (strengthPct(settings) / 100) * brakeAmps,
      rampS: settings.rampS,
      fadeSpeed: settings.fadeKmh / 3.6,
      minSpeed: REGEN_MIN_SPEED,
      delayS: settings.delayS,
      input: src.input,
      lever: src.lever,
      followers: ids,
    },
  }
}

interface RegenDeviceStatus {
  on: boolean | null
  engagements: number
  checkedAt: number
}

interface RegenStore {
  status: Record<string, RegenDeviceStatus>
  /** The settings it was last turned on with, to offer applying changes. */
  applied: RegenSettings | null
  busy: boolean
  step: string | null
  error: string | null
  turnOn: () => Promise<boolean>
  turnOff: () => Promise<boolean>
  refresh: () => Promise<void>
}

export const regenIsOn = reportedOn

async function readRegen(d: DeviceConfig): Promise<RegenStatus | null> {
  const st = parseRegenStatus(await runLisp(d.target, REGEN_STATUS_PROGRAM))
  useRegen.setState((s) => ({
    status: { ...s.status, [d.key]: { on: st ? st.on : null, engagements: st?.engagements ?? 0, checkedAt: Date.now() } },
  }))
  return st
}

export const useRegen = create<RegenStore>()((set, get) => ({
  status: {},
  applied: null,
  busy: false,
  step: null,
  error: null,

  turnOn: async () => {
    if (get().busy) return false
    const fail = (error: string) => {
      set({ busy: false, step: null, error })
      return false
    }
    const settings = useSettings.getState().regen
    const plan = regenPlan(settings)
    if ('problem' in plan) return fail(plan.problem)
    const block = motionBlock(
      motorDevices().map((d) => d.target),
      Date.now(),
      'turn regen on',
    )
    if (block) return fail(block)
    const runId = newRunId()
    set({ busy: true, error: null, step: `Sending regen to ${plan.master.name}` })
    try {
      // Another controller may still run an earlier regen (the throttle moved): stop it.
      for (const d of motorDevices()) if (d.key !== plan.master.key && get().status[d.key]?.on) await runLisp(d.target, REGEN_STOP_PROGRAM, 0)
      await sendInterleaved([{ target: plan.master.target, cmds: regenStartCommands(plan.params, runId) }], (n, total) =>
        set({ step: `Sending regen to ${plan.master.name} (${n} of ${total})` }),
      )
      set({ step: 'Checking regen is running' })
      const a = await readRegen(plan.master)
      const b = await readRegen(plan.master)
      if (!a?.on || !b?.on || b.runId !== runId) throw new Error(`${plan.master.name} didn’t confirm regen is running.`)
      if (a.beat === b.beat) throw new Error(`Regen on ${plan.master.name} started but isn’t running its checks.`)
      useSettings.getState().setRegenArmed([plan.master.key])
      set({ busy: false, step: null, applied: settings })
      return true
    } catch (e) {
      set({ busy: false, step: null })
      await get().turnOff()
      return fail(`Regen wasn’t turned on: ${errorText(e)}`)
    }
  },

  turnOff: async () => {
    if (!activeClient()) return false
    set({ busy: true, step: 'Turning regen off' })
    const ok = await stopEverywhere(motorDevices(), REGEN_STOP_PROGRAM, readRegen)
    if (ok) useSettings.getState().setRegenArmed([])
    set({
      busy: false,
      step: null,
      applied: ok ? null : get().applied,
      error: ok ? null : 'A controller didn’t confirm regen is off. Try again, or power-cycle the vehicle (regen always starts off).',
    })
    return ok
  },

  refresh: async () => {
    const list = await readEach(readRegen)
    if (list.length && list.every((d) => get().status[d.key]?.on === false)) {
      useSettings.getState().setRegenArmed([])
      set({ applied: null })
    }
  },
}))

/** The most current tunes may use: a quarter of the motor limit, and never more than 10 A. */
export function soundCapAmps(mc: ConfigValues): number {
  const lim = num(mc, 'l_current_max')
  return Math.max(0.5, Math.min(10, Number.isFinite(lim) && lim > 0 ? lim * 0.25 : 2))
}

export const SOUND_MIN_AMPS = 0.5

export function soundIssues(d: DeviceConfig, amps: number): string | null {
  const why = cantRun(d, [6, 5], 'Motor sounds')
  if (why) return why
  const mc = d.mcconf.device!
  if (num(mc, 'motor_type') !== 2) return `${d.name} isn’t set to FOC, and only FOC can play tones.`
  if (!(num(mc, 'foc_motor_r') > 0) || !(num(mc, 'foc_motor_l') > 0))
    return `Run motor detection on ${d.name} first: the volume is worked out from the motor’s resistance and inductance.`
  const cap = soundCapAmps(mc)
  if (!(amps >= SOUND_MIN_AMPS) || amps > cap) return `Volume must be between ${SOUND_MIN_AMPS} and ${cap.toFixed(1)} A for this motor.`
  return null
}

export interface CustomTune {
  id: string
  rtttl: string
  addedAt: number
}

interface MusicStore {
  custom: Tune[]
  loaded: boolean
  playing: { tuneId: string; key: string; until: number } | null
  /** The id of the tune being sent. */
  sending: string | null
  error: string | null
  load: () => Promise<void>
  /** Checks and keeps a tune. Throws TuneError with a readable reason. */
  addTune: (rtttl: string) => Promise<Tune>
  removeTune: (id: string) => Promise<void>
  play: (tune: Tune, key: string) => Promise<boolean>
  stop: () => Promise<void>
}

const db = () => import('./db').then((m) => m.db)

function toTune(c: CustomTune): Tune | null {
  try {
    return { id: c.id, name: parseRtttl(c.rtttl).name, kind: 'tune', rtttl: c.rtttl, custom: true }
  } catch {
    return null
  }
}

export const allTunes = (custom: Tune[]) => [...BUILT_IN_TUNES, ...custom]

let stopDemoSound: (() => void) | null = null
let endTimer: ReturnType<typeof setTimeout> | null = null

export const useMusic = create<MusicStore>()((set, get) => ({
  custom: [],
  loaded: false,
  playing: null,
  sending: null,
  error: null,

  load: async () => {
    if (get().loaded) return
    try {
      const rows = await (await db()).tunes.orderBy('addedAt').toArray()
      set({ custom: rows.map(toTune).filter((t): t is Tune => !!t), loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  addTune: async (rtttl) => {
    const text = rtttl.trim()
    const parsed = parseRtttl(text)
    if (parsed.notes.length > MAX_NOTES) throw new TuneError(`That tune has ${parsed.notes.length} notes; the motor player takes up to ${MAX_NOTES}.`)
    const row: CustomTune = { id: `t${Date.now().toString(36)}`, rtttl: text, addedAt: Date.now() }
    try {
      await (await db()).tunes.put(row)
    } catch {
      // kept until reload
    }
    const tune = toTune(row)!
    set((s) => ({ custom: [...s.custom, tune] }))
    return tune
  },

  removeTune: async (id) => {
    set((s) => ({ custom: s.custom.filter((t) => t.id !== id) }))
    try {
      await (await db()).tunes.delete(id)
    } catch {
      // gone from the list anyway
    }
  },

  play: async (tune, key) => {
    if (get().sending) return false
    const fail = (error: string) => {
      set({ sending: null, error })
      return false
    }
    const d = useConfig.getState().devices[key]
    if (!d || !activeClient()) return fail('Connect to a controller first.')
    const amps = useSettings.getState().soundAmps
    const issue = soundIssues(d, amps)
    if (issue) return fail(issue)
    const block = motionBlock([d.target], Date.now(), 'play sounds')
    if (block) return fail(block)
    let notes
    try {
      notes = parseRtttl(tune.rtttl).notes.slice(0, MAX_NOTES)
    } catch (e) {
      return fail(errorText(e))
    }
    const mc = d.mcconf.device!
    const vBat = useTelemetry.getState().devices[targetKey(d.target)]?.vIn ?? 0
    if (!(vBat > 5)) return fail('Waiting for a battery voltage reading.')
    set({ sending: tune.id, error: null })
    try {
      const cmds = playCommands(notes, amps, { r: num(mc, 'foc_motor_r'), l: num(mc, 'foc_motor_l'), vBat }, newRunId())
      await sendInterleaved([{ target: d.target, cmds }])
      const ms = tuneMs(notes)
      if (useSession.getState().transportKind === 'mock') {
        // The demo motor is imaginary; play it here so there's something to hear.
        stopDemoSound?.()
        stopDemoSound = previewOnSpeaker(notes, 0.05)
      }
      if (endTimer) clearTimeout(endTimer)
      endTimer = setTimeout(() => set({ playing: null }), ms + 300)
      set({ sending: null, playing: { tuneId: tune.id, key, until: Date.now() + ms } })
      return true
    } catch (e) {
      return fail(`Couldn’t play: ${errorText(e)}`)
    }
  },

  stop: async () => {
    stopDemoSound?.()
    stopDemoSound = null
    if (endTimer) clearTimeout(endTimer)
    const p = get().playing
    set({ playing: null })
    const dev = p ? useConfig.getState().devices[p.key] : null
    const targets = dev ? [dev.target] : motorDevices().map((d) => d.target)
    for (const t of targets) {
      try {
        await runLisp(t, STOP_PROGRAM, 0)
      } catch {
        // The tune also stops on its own when it ends or the wheel turns.
      }
    }
  },
}))

// After connecting, if this app last left ABS or regen on, check whether it still
// is (a power cycle switches both off). Nothing is sent to controllers otherwise.
let absCheckedFor: string | null = null
let regenCheckedFor: string | null = null
useConfig.subscribe((s) => {
  if (useSession.getState().status !== 'connected') return
  const ready = (keys: string[]) => keys.length > 0 && keys.every((k) => s.devices[k]?.mcconf.status === 'ready')
  const abs = s.order.filter((k) => useSettings.getState().absArmed.includes(k))
  if (ready(abs) && absCheckedFor !== abs.join(',')) {
    absCheckedFor = abs.join(',')
    void useAbs.getState().refresh()
  }
  const regen = s.order.filter((k) => useSettings.getState().regenArmed.includes(k))
  if (ready(regen) && regenCheckedFor !== regen.join(',')) {
    regenCheckedFor = regen.join(',')
    void useRegen.getState().refresh()
  }
})

useSession.subscribe((s, prev) => {
  if (s.status === 'idle' && prev.status !== 'idle') {
    absCheckedFor = null
    regenCheckedFor = null
    lastAt.clear()
    stopDemoSound?.()
    useAbs.setState({ status: {}, busy: false, step: null, error: null })
    useRegen.setState({ status: {}, busy: false, step: null, error: null })
    useMusic.setState({ playing: null, sending: null, error: null })
  }
})
