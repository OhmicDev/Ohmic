// The auto-wheelie on the scooter: which controller runs it, installing it as
// that controller's stored script, arming and disarming it, calibrating the
// IMU, and the live data it sends while armed.
//
// Installing replaces the stored script, so a script that was there is kept in
// Ohmic first and put back when the wheelie is removed. Everything is checked
// before it's sent: values outside their ranges are refused, never trimmed, and
// nothing is installed or armed while a wheel turns. The program disarms itself
// at every power-up, after the set time without a wheelie, and on safety stops.

import { create } from 'zustand'
import type { ConfigValues } from '../config/types'
import { errorText } from '../lib/format'
import { speedPerErpm } from '../lib/rideModes'
import { toneVolts } from '../onboard/music'
import { throttleSource, type ThrottleSource } from '../onboard/regen'
import {
  calibrationFrom,
  decodeWheelieTelemetry,
  levelProblem,
  parseImuAverage,
  parsePeek,
  parseWheelieStatus,
  UNCALIBRATED,
  WHEELIE_CAL_READ,
  WHEELIE_CAL_START,
  WHEELIE_DEFAULTS,
  WHEELIE_LIVE_PROGRAM,
  WHEELIE_MIN_FW,
  WHEELIE_OFF_PROGRAM,
  WHEELIE_PEEK_PROGRAM,
  WHEELIE_STATUS_PROGRAM,
  WHEELIE_VERSION,
  wheelieArmCommands,
  wheelieCalCommands,
  wheelieProgram,
  wheelieSettingsKey,
  wheelieSettingsProblem,
  type ImuAverage,
  type WheelieSettings,
  type WheelieStatus,
  type WheelieTelemetry,
  type WheelieWiring,
} from '../onboard/wheelie'
import { lispStorageBlob, packLispProgram, unpackLispProgram } from '../protocol/lisp'
import { motorDevices, type DeviceConfig } from './config'
import { db } from './db'
import { targetKey } from './devices'
import { controllerErrorText } from './errors'
import { maxScriptBytes, readStoredProgram, scriptSupport, writeStorage } from './lisp'
import { motionBlock } from './motion'
import { absIsOn, cantRun, regenIsOn, runLisp, soundCapAmps, useAbs, useRegen } from './onboard'
import { activeClient, demoWheeliePose, useSession } from './session'
import { useSettings } from './settings'
import { useTelemetry } from './telemetry'

/** The rider's settings: the program's defaults with their changes on top. */
export function wheelieSettings(): WheelieSettings {
  return { ...WHEELIE_DEFAULTS, ...useSettings.getState().wheelie }
}

export interface WheeliePlan {
  /** Reads the throttle and has the IMU: the program runs here. */
  host: DeviceConfig
  /** The other motor controller, over CAN. */
  other: DeviceConfig | null
  rear: DeviceConfig
  front: DeviceConfig | null
  source: ThrottleSource
  wiring: WheelieWiring
}

const num = (mc: ConfigValues, k: string) => Number(mc[k])
const canIdOf = (d: DeviceConfig) => (d.target === 'local' ? Number(d.appconf.device?.controller_id) : d.target)

/** Seconds to wait before the throttle app has the motors back: its ramp-down time plus a margin. */
function handbackWait(app: ConfigValues, input: 0 | 1): number {
  const ramp = num(app, input === 0 ? 'app_adc_conf.ramp_time_neg' : 'app_ppm_conf.ramp_time_neg')
  return Math.min(2, Math.max(0.3, (Number.isFinite(ramp) ? ramp : 0.3) + 0.2))
}

/** Where the program would run and how it's wired, or why it can't. */
export function wheeliePlan(): WheeliePlan | { problem: string } {
  const list = motorDevices()
  if (!list.length || !activeClient()) return { problem: 'Connect to the scooter first.' }
  if (list.length > 2) return { problem: `The auto-wheelie drives one rear and one front motor; this scooter has ${list.length} motor controllers.` }
  const inputs: { d: DeviceConfig; src: ThrottleSource }[] = []
  for (const d of list) {
    const why = cantRun(d, WHEELIE_MIN_FW, 'The auto-wheelie')
    if (why) return { problem: why }
    if (d.appconf.status !== 'ready' || !d.appconf.device) return { problem: `Still reading app settings from ${d.name}.` }
    const src = throttleSource(d.appconf.device)
    if (src && 'problem' in src) return { problem: `${d.name}: its throttle mode isn’t one the auto-wheelie can read. Use a current mode with the throttle resting at zero.` }
    if (src) inputs.push({ d, src })
  }
  if (!inputs.length) return { problem: 'The auto-wheelie needs the throttle wired to a motor controller (its ADC or PPM input). Set it up under Setup → Throttle and brake.' }
  if (inputs.length > 1) return { problem: `${inputs.map((x) => x.d.name).join(' and ')} each read a throttle. The auto-wheelie works when one controller reads it.` }
  const { d: host, src } = inputs[0]
  const other = list.find((d) => d.key !== host.key) ?? null
  const hostWheel = useSettings.getState().wheelieHostWheel
  if (other && !hostWheel) return { problem: `Say which wheel ${host.name} drives.` }
  if (!other && hostWheel === 'front') return { problem: 'With one motor, it must drive the rear wheel to lift the front.' }
  const rear = !other || hostWheel === 'rear' ? host : other
  const front = !other ? null : rear === host ? other : host
  const otherId = other ? canIdOf(other) : -1
  if (other && !(Number.isInteger(otherId) && otherId >= 0 && otherId <= 254)) return { problem: `${other.name}’s CAN ID couldn’t be read.` }
  for (const d of list) if (d.mcconf.status !== 'ready' || !d.mcconf.device) return { problem: `Still reading motor settings from ${d.name}.` }
  const spe = speedPerErpm(rear.mcconf.device!)
  if (!Number.isFinite(spe) || spe <= 0) return { problem: `${rear.name} has no wheel size or motor poles set, so the program can’t tell how fast you’re going.` }
  return {
    host,
    other,
    rear,
    front,
    source: src,
    wiring: {
      rear: rear === host ? -1 : otherId,
      front: !front ? -2 : front === host ? -1 : otherId,
      input: src.input,
      speedPerErpm: spe,
      handbackWait: handbackWait(host.appconf.device!, src.input),
    },
  }
}

/** Everything in these settings the motors can't take on this scooter. Refused, never trimmed. */
export function wheelieLimitsProblems(plan: WheeliePlan, s: WheelieSettings): string[] {
  const out: string[] = []
  const limits = (d: DeviceConfig) => {
    const mc = d.mcconf.device!
    return { most: num(mc, 'l_current_max'), brake: Math.abs(num(mc, 'l_current_min')) }
  }
  const over = (what: string, amps: number, d: DeviceConfig, lim: number, kind: string) => {
    if (amps > lim) out.push(`${what} (${amps} A) is more than ${d.name}’s ${kind} limit (${lim} A). Lower it, or raise the limit in Tune.`)
  }
  const r = limits(plan.rear)
  over('The kick', s.kick, plan.rear, r.most, 'motor current')
  over('Most push', s.holdMax, plan.rear, r.most, 'motor current')
  over('The landing cushion', s.landCushion, plan.rear, r.most, 'motor current')
  over('Most braking', s.catchMax, plan.rear, r.brake, 'motor braking')
  if (plan.front) {
    const f = limits(plan.front)
    over('The front motor’s share of the kick', Number((s.kick * s.frontShare).toFixed(1)), plan.front, f.most, 'motor current')
    over('Front wheel spin', s.frontSync, plan.front, f.most, 'motor current')
  }
  if (s.toneVolts > 0) {
    const mc = plan.host.mcconf.device!
    const res = num(mc, 'foc_motor_r')
    const ind = num(mc, 'foc_motor_l')
    if (num(mc, 'motor_type') !== 2) out.push(`${plan.host.name} isn’t set to FOC, so it can’t play tones. Set the tone loudness to 0.`)
    else if (!(res > 0) || !(ind > 0)) out.push(`Run motor detection on ${plan.host.name} first: the tone loudness is checked against the motor’s resistance and inductance.`)
    else {
      // The lowest tone (400 Hz) puts the most current through the windings.
      const cap = soundCapAmps(mc)
      const most = toneVolts(400, cap, { r: res, l: ind, vBat: Infinity })
      if (s.toneVolts > most) out.push(`Tone loudness above ${most.toFixed(2)} V would put more than ${cap.toFixed(1)} A through ${plan.host.name}’s motor.`)
    }
  }
  return out
}

/** The first thing the motors can't take, or null. */
export const wheelieLimitsProblem = (plan: WheeliePlan, s: WheelieSettings): string | null => wheelieLimitsProblems(plan, s)[0] ?? null

export type CalStep = 'level' | 'tipped' | 'loaded' | 'check'

interface CalState {
  step: CalStep
  level: ImuAverage | null
  tipped: ImuAverage | null
  measuring: boolean
  error: string | null
  /** What the controller reads through the new calibration, on the check step. */
  peek: { pitch: number; roll: number } | null
}

export interface WheelieBackup {
  name: string
  bytes: number
  savedAt: number
}

interface WheelieStore {
  /** What the controller running it last said; 'missing' when the program isn't there. */
  status: WheelieStatus | 'missing' | null
  checkedAt: number
  /** Live data, newest last, about the last 12 s. */
  live: { at: number; t: WheelieTelemetry }[]
  busy: boolean
  step: string | null
  progress: number | null
  error: string | null
  notice: string | null
  /** Installing would replace this script: waits for the rider to say yes. */
  replace: { name: string; bytes: number; imports: number } | null
  /** The script the wheelie replaced, kept in Ohmic. */
  backup: WheelieBackup | null
  /** The settings it was last armed with (wheelieSettingsKey), to offer sending changes. */
  armedWith: string | null
  cal: CalState | null
  refresh: () => Promise<void>
  install: (opts?: { replace?: boolean }) => Promise<boolean>
  cancelReplace: () => void
  uninstall: () => Promise<boolean>
  arm: () => Promise<boolean>
  disarm: () => Promise<boolean>
  startCal: () => void
  measure: () => Promise<void>
  backCal: () => void
  endCal: () => void
  peek: () => Promise<void>
  dismiss: () => void
}

const LIVE_KEEP_MS = 12_000
const backupId = (key: string) => `wheelie-replaced:${key}`
const newRunId = () => 1 + Math.floor(Math.random() * 99_998)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function readStatus(plan: WheeliePlan, program = WHEELIE_STATUS_PROGRAM): Promise<WheelieStatus | 'missing' | null> {
  const st = parseWheelieStatus(await runLisp(plan.host.target, program))
  useWheelie.setState({ status: st ?? useWheelie.getState().status, checkedAt: Date.now() })
  return st
}

async function loadBackup(key: string): Promise<WheelieBackup | null> {
  try {
    const d = await db.drafts.get(backupId(key))
    return d ? { name: d.name ?? 'The earlier script', bytes: d.text.length, savedAt: d.savedAt } : null
  } catch {
    return null
  }
}

/** Writes a script as the stored one, reads it back to check, and starts it. */
async function storeScript(plan: WheeliePlan, code: string, onStep: (what: string, p: number | null) => void) {
  const client = activeClient()
  if (!client) throw new Error('Not connected.')
  const target = plan.host.target
  const program = packLispProgram(code)
  const blob = lispStorageBlob(program)
  const max = maxScriptBytes(plan.host.fw)
  if (blob.length > max) throw new Error(`The script is ${blob.length.toLocaleString()} bytes; ${plan.host.name} has room for ${max.toLocaleString()}.`)
  onStep('Erasing the stored script', null)
  await writeStorage(
    { erase: (n) => client.lispErase(n, target), write: (o, d) => client.lispWrite(o, d, target) },
    blob,
    program.length + 100,
    (p) => onStep('Writing', p),
  )
  onStep('Reading it back', null)
  const back = await readStoredProgram(client, target)
  if (!back || back.length !== program.length || back.some((b, i) => b !== program[i])) throw new Error('What was read back differs from what was written.')
  onStep('Starting it', null)
  if (!(await client.lispSetRunning(true, target))) throw new Error(`${plan.host.name} didn’t start the script.`)
}

/** Common checks before changing the stored script. */
function readyToStore(action: string): WheeliePlan | string {
  const plan = wheeliePlan()
  if ('problem' in plan) return plan.problem
  const support = scriptSupport(plan.host.fw)
  if (!support.ok) return support.reason!
  const moving = motionBlock(
    motorDevices().map((d) => d.target),
    Date.now(),
    action,
  )
  if (moving) return moving
  const st = useWheelie.getState().status
  if (st && st !== 'missing' && st.on) return 'Disarm it first.'
  return plan
}

export const useWheelie = create<WheelieStore>()((set, get) => {
  const fail = (error: string) => {
    set({ busy: false, step: null, progress: null, error, notice: null })
    return false
  }
  const onStep = (step: string, progress: number | null) => set({ step, progress })

  return {
    status: null,
    checkedAt: 0,
    live: [],
    busy: false,
    step: null,
    progress: null,
    error: null,
    notice: null,
    replace: null,
    backup: null,
    armedWith: null,
    cal: null,

    refresh: async () => {
      const plan = wheeliePlan()
      if ('problem' in plan || get().busy) return
      try {
        const st = await readStatus(plan, get().status && get().status !== 'missing' && (get().status as WheelieStatus).on ? WHEELIE_LIVE_PROGRAM : WHEELIE_STATUS_PROGRAM)
        if (st && st !== 'missing' && !st.on) set({ armedWith: null })
        set({ backup: await loadBackup(plan.host.key) })
      } catch {
        // keep the last status
      }
    },

    install: async (opts = {}) => {
      if (get().busy) return false
      const ready = readyToStore('install the wheelie')
      if (typeof ready === 'string') return fail(ready)
      const plan = ready
      const s = wheelieSettings()
      const bad = wheelieSettingsProblem(s) ?? wheelieLimitsProblem(plan, s)
      if (bad) return fail(bad)
      const client = activeClient()!
      set({ busy: true, error: null, notice: null, step: `Looking at ${plan.host.name}’s stored script`, progress: null })
      try {
        const existing = await readStoredProgram(client, plan.host.target)
        if (existing) {
          const { code, imports } = unpackLispProgram(existing)
          if (!code.includes('(def wl-version ')) {
            if (!opts.replace) {
              set({ busy: false, step: null, replace: { name: plan.host.name, bytes: existing.length, imports } })
              return false
            }
            // Keep it before anything is erased.
            await db.drafts.put({ id: backupId(plan.host.key), text: code, name: `The script that was on ${plan.host.name}`, savedAt: Date.now() })
          }
        }
        set({ replace: null })
        const cal = useSettings.getState().wheelieCal[plan.host.key] ?? UNCALIBRATED
        await storeScript(plan, wheelieProgram(s, cal, plan.wiring), onStep)
        onStep('Checking it answers', null)
        await sleep(1200)
        let st: WheelieStatus | 'missing' | null = null
        for (let i = 0; i < 3 && (!st || st === 'missing'); i++) {
          st = await readStatus(plan)
          if (!st || st === 'missing') await sleep(800)
        }
        if (!st || st === 'missing') throw new Error(`${plan.host.name} has it stored but it didn’t answer. Check the LispBM console for errors.`)
        if (st.version !== WHEELIE_VERSION) throw new Error(`It answered as version ${st.version}, not ${WHEELIE_VERSION}.`)
        set({ busy: false, step: null, progress: null, backup: await loadBackup(plan.host.key), notice: `Installed on ${plan.host.name}. It stays disarmed until you arm it here, and at every power-up.` })
        return true
      } catch (e) {
        return fail(`Not installed: ${controllerErrorText(e)}`)
      }
    },

    cancelReplace: () => set({ replace: null }),

    uninstall: async () => {
      if (get().busy) return false
      const ready = readyToStore('remove the wheelie')
      if (typeof ready === 'string') return fail(ready)
      const plan = ready
      const client = activeClient()!
      set({ busy: true, error: null, notice: null, step: 'Removing the wheelie', progress: null })
      try {
        const kept = await db.drafts.get(backupId(plan.host.key)).catch(() => undefined)
        if (kept) {
          await storeScript(plan, kept.text, onStep)
          await db.drafts.delete(backupId(plan.host.key))
          set({ busy: false, step: null, progress: null, status: 'missing', backup: null, notice: `Removed. ${plan.host.name} has its earlier script back.` })
        } else {
          if (!(await client.lispErase(16, plan.host.target))) throw new Error('The controller refused to erase its script storage.')
          set({ busy: false, step: null, progress: null, status: 'missing', notice: `Removed. ${plan.host.name} has no stored script now.` })
        }
        return true
      } catch (e) {
        return fail(`Couldn’t remove it: ${controllerErrorText(e)}`)
      }
    },

    arm: async () => {
      if (get().busy) return false
      const plan = wheeliePlan()
      if ('problem' in plan) return fail(plan.problem)
      const s = wheelieSettings()
      const bad = wheelieSettingsProblem(s) ?? wheelieLimitsProblem(plan, s)
      if (bad) return fail(bad)
      const cal = useSettings.getState().wheelieCal[plan.host.key]
      if (!cal) return fail('Calibrate the IMU first.')
      const moving = motionBlock(
        motorDevices().map((d) => d.target),
        Date.now(),
        'arm the wheelie',
      )
      if (moving) return fail(moving)
      if (regenIsOn(useRegen.getState().status)) return fail('Turn regen off first: both would drive the motors.')
      if (absIsOn(useAbs.getState().status)) return fail('Turn ABS off first: it changes the braking limit the wheelie relies on.')
      const vIn = useTelemetry.getState().devices[targetKey(plan.host.target)]?.vIn ?? 0
      if (!(vIn > 5)) return fail('Waiting for a battery voltage reading.')
      if (vIn > s.maxVolts) return fail(`The battery is at ${vIn.toFixed(1)} V, above “Battery too full” (${s.maxVolts} V). Braking the nose down could overcharge it. Ride a little first.`)
      if (vIn < s.minVolts) return fail(`The battery is at ${vIn.toFixed(1)} V, below “Battery low” (${s.minVolts} V).`)
      const runId = newRunId()
      set({ busy: true, error: null, notice: null, step: 'Checking the program', progress: null })
      try {
        const st = await readStatus(plan)
        if (st === 'missing') throw new Error('it isn’t installed. Install it first.')
        if (!st) throw new Error(`${plan.host.name} didn’t answer.`)
        if (st.version !== WHEELIE_VERSION) throw new Error(`the installed program is version ${st.version}; install it again.`)
        const cmds = wheelieArmCommands(s, cal, plan.wiring, runId)
        for (let i = 0; i < cmds.length; i++) {
          set({ step: `Sending settings (${i + 1} of ${cmds.length})`, progress: (i + 1) / cmds.length })
          await runLisp(plan.host.target, cmds[i], 0)
        }
        set({ step: 'Checking it’s armed', progress: null })
        const a = await readStatus(plan)
        const b = await readStatus(plan)
        if (!a || a === 'missing' || !b || b === 'missing' || !a.on || !b.on || b.runId !== runId) throw new Error(`${plan.host.name} didn’t confirm it’s armed.`)
        if (a.beat === b.beat) throw new Error('it armed but its loop isn’t running.')
        set({ busy: false, step: null, armedWith: wheelieSettingsKey(s), notice: s.dry ? 'Armed for a dry run: it never drives the motors.' : 'Armed. Roll above the slowest start, lean back and pin the throttle.' })
        return true
      } catch (e) {
        set({ busy: false, step: null })
        await get().disarm()
        return fail(`Not armed: ${errorText(e)}`)
      }
    },

    disarm: async () => {
      // Sent to every motor controller, so it works whatever the plan says now.
      const list = motorDevices()
      if (!list.length || !activeClient()) return fail('Connect to the scooter first.')
      const plan = wheeliePlan()
      const hostKey = 'problem' in plan ? null : plan.host.key
      set({ busy: true, step: 'Disarming', progress: null })
      try {
        for (const d of list) await runLisp(d.target, WHEELIE_OFF_PROGRAM, 0)
        // Mid-wheelie it lands first.
        for (let i = 0; i < 6; i++) {
          let allOff = true
          for (const d of list) {
            const st = parseWheelieStatus(await runLisp(d.target, WHEELIE_STATUS_PROGRAM))
            if (st === null || (st !== 'missing' && st.on)) allOff = false
            if (d.key === hostKey && st) set({ status: st, checkedAt: Date.now() })
          }
          if (allOff) {
            set({ busy: false, step: null, armedWith: null, error: null, notice: 'Disarmed.' })
            return true
          }
          await sleep(500)
        }
        return fail('It didn’t confirm it’s disarmed. Try again, or power-cycle the scooter (it always starts disarmed).')
      } catch (e) {
        return fail(`Couldn’t disarm: ${errorText(e)}. Power-cycle the scooter to be sure (it always starts disarmed).`)
      }
    },

    startCal: () => {
      const plan = wheeliePlan()
      if ('problem' in plan) return void fail(plan.problem)
      const st = get().status
      if (!st || st === 'missing') return void fail('Install the wheelie first: it measures the IMU.')
      if (st.on) return void fail('Disarm it first.')
      set({ error: null, notice: null, cal: { step: 'level', level: null, tipped: null, measuring: false, error: null, peek: null } })
      demoWheeliePose(plan.host.target, 'level')
    },

    measure: async () => {
      const cal = get().cal
      const plan = wheeliePlan()
      if (!cal || cal.measuring || cal.step === 'check') return
      const setCal = (patch: Partial<CalState>) => set((s) => ({ cal: s.cal ? { ...s.cal, ...patch } : s.cal }))
      if ('problem' in plan) return setCal({ error: plan.problem })
      setCal({ measuring: true, error: null })
      try {
        demoWheeliePose(plan.host.target, cal.step)
        await runLisp(plan.host.target, WHEELIE_CAL_START)
        await sleep(1300)
        let avg: ImuAverage | null = null
        for (let i = 0; i < 4 && !avg; i++) {
          const a = parseImuAverage(await runLisp(plan.host.target, WHEELIE_CAL_READ))
          if (a === 'missing') throw new Error('The wheelie program isn’t running there.')
          if (a && typeof a === 'object') avg = a
          else await sleep(400)
        }
        if (!avg) throw new Error('The controller didn’t finish measuring. Try again.')
        if (cal.step === 'level') {
          // Checked on its own now, so a bad reading is caught at this step.
          const p = levelProblem(avg)
          if (p) return setCal({ measuring: false, error: p })
          setCal({ measuring: false, level: avg, step: 'tipped' })
          demoWheeliePose(plan.host.target, 'tipped')
        } else if (cal.step === 'tipped') {
          const p = calibrationFrom(cal.level!, avg, cal.level!, '')
          if ('problem' in p) return setCal({ measuring: false, error: p.problem })
          setCal({ measuring: false, tipped: avg, step: 'loaded' })
          demoWheeliePose(plan.host.target, 'loaded')
        } else {
          const result = calibrationFrom(cal.level!, cal.tipped!, avg, plan.host.key)
          if ('problem' in result) return setCal({ measuring: false, error: result.problem })
          useSettings.getState().setWheelieCal(plan.host.key, result)
          for (const c of wheelieCalCommands(result)) await runLisp(plan.host.target, c, 0)
          setCal({ measuring: false, step: 'check' })
          demoWheeliePose(plan.host.target, 'check')
        }
      } catch (e) {
        setCal({ measuring: false, error: errorText(e) })
      }
    },

    backCal: () => {
      const cal = get().cal
      const plan = wheeliePlan()
      if (!cal || cal.measuring) return
      const prev: Record<CalStep, CalStep> = { level: 'level', tipped: 'level', loaded: 'tipped', check: 'loaded' }
      const step = prev[cal.step]
      set({ cal: { ...cal, step, error: null, peek: null } })
      if (!('problem' in plan)) demoWheeliePose(plan.host.target, step)
    },

    endCal: () => {
      const plan = wheeliePlan()
      set({ cal: null })
      if (!('problem' in plan)) demoWheeliePose(plan.host.target, null)
    },

    peek: async () => {
      const cal = get().cal
      const plan = wheeliePlan()
      if (!cal || cal.step !== 'check' || 'problem' in plan) return
      try {
        const p = parsePeek(await runLisp(plan.host.target, WHEELIE_PEEK_PROGRAM))
        set((s) => ({ cal: s.cal ? { ...s.cal, peek: p } : s.cal }))
      } catch {
        // try again next time
      }
    },

    dismiss: () => set({ error: null, notice: null }),
  }
})

// Live data from the program, while connected.
let offLive: (() => void) | null = null
function listen() {
  offLive?.()
  offLive =
    activeClient()?.onCustomAppData((data) => {
      const t = decodeWheelieTelemetry(data)
      if (!t) return
      const now = Date.now()
      useWheelie.setState((st) => ({ live: [...st.live.filter((x) => now - x.at < LIVE_KEEP_MS), { at: now, t }] }))
    }) ?? null
}
// This module loads with the Wheelie page, often after connecting.
if (useSession.getState().status === 'connected') listen()
useSession.subscribe((s, prev) => {
  if (s.status === 'connected' && prev.status !== 'connected') listen()
  if (s.status === 'idle' && prev.status !== 'idle') {
    offLive?.()
    offLive = null
    useWheelie.setState({ status: null, live: [], busy: false, step: null, progress: null, error: null, notice: null, replace: null, armedWith: null, cal: null })
  }
})
