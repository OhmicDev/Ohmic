// The LispBM script on a controller: upload, read back, start, stop and remove
// it, the console (what scripts print, plus a REPL), and the engine's stats.
//
// Uploading erases the stored script first, and erasing stops the script
// engine, which also ends anything Ohmic itself runs there (ABS, regen, sounds).

import { create } from 'zustand'
import { ClosedError, TimeoutError, type Target, type VescClient } from '../client/VescClient'
import { HW_TYPE } from '../protocol/commands'
import {
  LISP_CHUNK,
  LISP_MAX_OTHER,
  LISP_MAX_VESC,
  LISP_READ_CHUNK,
  lispStorageBlob,
  packLispProgram,
  parseLispStorage,
  unpackLispProgram,
  type LispStats,
} from '../protocol/lisp'
import type { FwVersion } from '../protocol/messages'
import { db } from './db'
import { targetFromKey, targetKey, targetLabel, type DeviceInfo } from './devices'
import { motionBlock } from './motion'
import { ohmicLispBusy, runLisp } from './onboard'
import { activeClient, sessionEvents, useSession } from './session'

export type ConsoleKind = 'out' | 'in' | 'note' | 'error' | 'ohmic'

export interface ConsoleLine {
  id: number
  kind: ConsoleKind
  text: string
  /** Target key the line belongs to. */
  target: string
  at: number
}

export interface StatsEntry {
  stats: LispStats | null
  /** True when the engine answered, false after it stayed quiet (no script running), null before asking. */
  running: boolean | null
  at: number
}

interface Busy {
  what: string
  /** 0..1 when known. */
  progress: number | null
}

interface LispState {
  code: string
  fileName: string | null
  /** True when the editor differs from what was last uploaded, read or opened. */
  dirty: boolean
  target: string
  lines: ConsoleLine[]
  showOhmic: boolean
  stats: Record<string, StatsEntry>
  busy: Busy | null
  error: string | null
  notice: string | null
  setCode: (code: string, opts?: { fileName?: string | null; clean?: boolean }) => void
  setTarget: (key: string) => void
  setShowOhmic: (v: boolean) => void
  upload: () => Promise<boolean>
  readBack: () => Promise<string | null>
  setRunning: (running: boolean) => Promise<boolean>
  removeStored: () => Promise<boolean>
  repl: (text: string) => Promise<void>
  pollStats: () => Promise<void>
  clearConsole: () => void
  dismiss: () => void
}

const MAX_LINES = 2000
/** How often to check for a script while none runs. */
const STATS_IDLE_MS = 5000
let statsInFlight = false
let nextId = 1

const STARTER = `; LispBM runs on the controller itself. Upload sends this script and starts it.
; Output from (print ...) shows in the console below.

(print "Hello from LispBM")

(loopwhile t
  (progn
    (print (str-from-n (get-vin) "Battery: %.1f V"))
    (sleep 5)))
`

/** Whether this device can take scripts, and why not. */
export function scriptSupport(fw: FwVersion | null | undefined): { ok: boolean; reason: string | null } {
  if (!fw) return { ok: false, reason: 'This device didn’t say which firmware it runs.' }
  if (fw.major < 6) return { ok: false, reason: `LispBM scripts need firmware 6.0 or newer; this device runs ${fw.major}.${String(fw.minor).padStart(2, '0')}.` }
  if (fw.major > 7)
    return { ok: false, reason: `Firmware ${fw.major}.${String(fw.minor).padStart(2, '0')} is newer than this app knows, so scripts are read-only here.` }
  if (fw.hwType === HW_TYPE.VESC_BMS) return { ok: false, reason: 'The VESC BMS doesn’t run LispBM scripts.' }
  return { ok: true, reason: null }
}

export function maxScriptBytes(fw: FwVersion | null | undefined): number {
  return fw?.hwType === HW_TYPE.VESC ? LISP_MAX_VESC : LISP_MAX_OTHER
}

/** Every motor controller must be stopped: a script can drive any of them. */
export function scriptMotionBlock(devices: DeviceInfo[], action: string): string | null {
  const motors = devices.filter((d) => d.motor).map((d) => d.target)
  return motors.length ? motionBlock(motors, Date.now(), action) : null
}

const errText = (e: unknown) =>
  e instanceof TimeoutError ? 'The controller didn’t answer.' : e instanceof ClosedError ? 'The connection closed.' : e instanceof Error ? e.message : String(e)

function makeLines(kind: ConsoleKind, text: string, target: string, at = Date.now()): ConsoleLine[] {
  const parts = text.replace(/\n$/, '').split('\n')
  return parts.map((t) => ({ id: nextId++, kind, text: t, target, at }))
}

/** Reads the whole stored blob. Null when the controller has no script. */
export async function readStoredProgram(client: VescClient, target: Target, onProgress?: (p: number) => void): Promise<Uint8Array | null> {
  const first = await client.lispRead(LISP_READ_CHUNK, 0, target)
  if (first.total <= 0) return null
  const all = new Uint8Array(first.total)
  all.set(first.data.subarray(0, first.total), 0)
  let have = Math.min(first.data.length, first.total)
  while (have < first.total) {
    const part = await client.lispRead(Math.min(LISP_READ_CHUNK, first.total - have), have, target)
    if (part.offset !== have || part.data.length === 0) throw new Error('The controller sent the script out of order.')
    all.set(part.data.subarray(0, first.total - have), have)
    have += part.data.length
    onProgress?.(have / first.total)
  }
  return parseLispStorage(all)
}

/** Erases the storage and writes a blob in chunks (shared with package installs). */
export async function writeStorage(
  ops: { erase: (size: number) => Promise<boolean>; write: (offset: number, data: Uint8Array) => Promise<boolean> },
  blob: Uint8Array,
  eraseSize: number,
  onProgress?: (p: number) => void,
): Promise<void> {
  if (!(await ops.erase(eraseSize))) throw new Error('The controller refused to erase its script storage.')
  for (let offset = 0; offset < blob.length; offset += LISP_CHUNK) {
    const chunk = blob.subarray(offset, offset + LISP_CHUNK)
    if (!(await ops.write(offset, chunk))) throw new Error(`Writing failed at byte ${offset}.`)
    onProgress?.(Math.min(1, (offset + chunk.length) / blob.length))
  }
}

export const useLisp = create<LispState>()((set, get) => {
  const device = () => {
    const { devices, status } = useSession.getState()
    const t = targetFromKey(get().target)
    return { info: devices.find((d) => d.target === t) ?? null, devices, connected: status === 'connected', target: t }
  }

  /** Common checks before anything that changes the stored script. Returns the client or sets an error. */
  const ready = (action: string) => {
    const { info, devices, connected, target } = device()
    const client = activeClient()
    const fail = (error: string) => (set({ error, notice: null }), null)
    if (!connected || !client) return fail('Connect to a controller first.')
    if (get().busy) return fail('Wait for the current step to finish.')
    if (!info) return fail(`${targetLabel(target)} isn’t on this connection any more.`)
    const support = scriptSupport(info.fw)
    if (!support.ok) return fail(support.reason!)
    const moving = scriptMotionBlock(devices, action)
    if (moving) return fail(moving)
    return { client, target, info }
  }

  const note = (kind: ConsoleKind, text: string) => set((s) => ({ lines: [...s.lines, ...makeLines(kind, text, s.target)].slice(-MAX_LINES) }))

  return {
    code: STARTER,
    fileName: null,
    dirty: false,
    target: 'local',
    lines: [],
    showOhmic: false,
    stats: {},
    busy: null,
    error: null,
    notice: null,

    setCode: (code, opts = {}) => {
      set((s) => ({ code, dirty: !opts.clean, fileName: opts.fileName !== undefined ? opts.fileName : s.fileName }))
      saveDraft()
    },
    setTarget: (target) => set({ target, error: null, notice: null }),
    setShowOhmic: (showOhmic) => set({ showOhmic }),

    upload: async () => {
      const r = ready('upload a script')
      if (!r) return false
      const { client, target, info } = r
      const code = get().code
      const program = packLispProgram(code)
      const blob = lispStorageBlob(program)
      const max = maxScriptBytes(info.fw)
      if (blob.length > max) {
        set({ error: `The script is ${blob.length.toLocaleString()} bytes; ${targetLabel(target)} has room for ${max.toLocaleString()}.`, notice: null })
        return false
      }
      set({ busy: { what: 'Erasing the stored script', progress: null }, error: null, notice: null })
      try {
        await writeStorage(
          { erase: (n) => client.lispErase(n, target), write: (o, d) => client.lispWrite(o, d, target) },
          blob,
          program.length + 100,
          (p) => set({ busy: { what: 'Uploading', progress: p } }),
        )
        set({ busy: { what: 'Starting', progress: null } })
        const started = await client.lispSetRunning(true, target)
        note('note', `Uploaded ${blob.length.toLocaleString()} bytes to ${targetLabel(target)}${started ? ' and started it' : ''}.`)
        set({
          busy: null,
          dirty: false,
          notice: started ? `Uploaded and running on ${targetLabel(target)}.` : `Uploaded to ${targetLabel(target)}, but it didn’t start. Check the console for errors.`,
          stats: { ...get().stats, [targetKey(target)]: { stats: null, running: started ? true : null, at: Date.now() } },
        })
        return true
      } catch (e) {
        set({ busy: null, error: `Upload failed: ${errText(e)} The controller’s stored script may now be empty or partial; upload again.` })
        return false
      }
    },

    readBack: async () => {
      const { connected, target, info } = device()
      const client = activeClient()
      if (!connected || !client || !info) {
        set({ error: 'Connect to a controller first.', notice: null })
        return null
      }
      const support = scriptSupport(info.fw)
      if (!support.ok && (info.fw?.major ?? 0) < 6) {
        set({ error: support.reason, notice: null })
        return null
      }
      set({ busy: { what: 'Reading the stored script', progress: null }, error: null, notice: null })
      try {
        const program = await readStoredProgram(client, target, (p) => set({ busy: { what: 'Reading the stored script', progress: p } }))
        set({ busy: null })
        if (!program) {
          set({ notice: `${targetLabel(target)} has no stored script.` })
          return ''
        }
        const { code, imports } = unpackLispProgram(program)
        set({ notice: imports ? `Read from ${targetLabel(target)}. It also has ${imports} imported file(s), which aren’t shown and won’t be kept if you upload from here.` : `Read from ${targetLabel(target)}.` })
        return code
      } catch (e) {
        set({ busy: null, error: `Couldn’t read the script: ${errText(e)}` })
        return null
      }
    },

    setRunning: async (running) => {
      // Stopping is always allowed (a misbehaving script must be stoppable); starting checks like an upload.
      const { connected, target, info } = device()
      const client = activeClient()
      if (!connected || !client || !info) {
        set({ error: 'Connect to a controller first.', notice: null })
        return false
      }
      if (running && !ready('start a script')) return false
      set({ busy: { what: running ? 'Starting' : 'Stopping', progress: null }, error: null, notice: null })
      try {
        const ok = await client.lispSetRunning(running, target)
        note('note', ok ? `${running ? 'Started' : 'Stopped'} the script on ${targetLabel(target)}.` : `${targetLabel(target)} couldn’t ${running ? 'start' : 'stop'} the script.`)
        set({
          busy: null,
          stats: { ...get().stats, [targetKey(target)]: { stats: running ? (get().stats[targetKey(target)]?.stats ?? null) : null, running: ok ? running : null, at: Date.now() } },
        })
        if (!ok) set({ error: running ? 'The script didn’t start. Is one stored? Check the console for errors.' : 'The controller didn’t stop the script.' })
        return ok
      } catch (e) {
        set({ busy: null, error: errText(e) })
        return false
      }
    },

    removeStored: async () => {
      const r = ready('remove the script')
      if (!r) return false
      const { client, target } = r
      set({ busy: { what: 'Removing the stored script', progress: null }, error: null, notice: null })
      try {
        const ok = await client.lispErase(16, target)
        set({ busy: null })
        if (!ok) {
          set({ error: 'The controller refused to erase its script storage.' })
          return false
        }
        note('note', `Removed the stored script from ${targetLabel(target)}.`)
        set({ notice: `${targetLabel(target)} has no stored script now.`, stats: { ...get().stats, [targetKey(target)]: { stats: null, running: false, at: Date.now() } } })
        return true
      } catch (e) {
        set({ busy: null, error: errText(e) })
        return false
      }
    },

    repl: async (text) => {
      const line = text.trim()
      if (!line) return
      const { connected, target } = device()
      if (!connected || !activeClient()) {
        set({ error: 'Connect to a controller first.' })
        return
      }
      note('in', line)
      try {
        // Through the shared queue, so the console keeps the firmware's gap between commands.
        await runLisp(target, line, 0, { fromConsole: true })
      } catch (e) {
        note('error', errText(e))
      }
    },

    pollStats: async () => {
      const { connected, target } = device()
      const client = activeClient()
      if (!connected || !client || get().busy) return
      const key = targetKey(target)
      // Nothing answers while no script runs; ask again only every few seconds then.
      const prev = get().stats[key]
      if (statsInFlight || (prev?.running === false && Date.now() - prev.at < STATS_IDLE_MS)) return
      statsInFlight = true
      try {
        const stats = await client.lispStats({ target })
        set((s) => ({ stats: { ...s.stats, [key]: { stats, running: true, at: Date.now() } } }))
      } catch (e) {
        if (e instanceof TimeoutError) set((s) => ({ stats: { ...s.stats, [key]: { stats: null, running: false, at: Date.now() } } }))
      } finally {
        statsInFlight = false
      }
    },

    clearConsole: () => set({ lines: [] }),
    dismiss: () => set({ error: null, notice: null }),
  }
})

// Everything LispBM prints goes to the console, under the controller the page is set to
// (prints don't say where they came from). Lines answering Ohmic's own programs are marked.
sessionEvents.lispPrints.on(({ text, at }) => {
  const kind: ConsoleKind = ohmicLispBusy() ? 'ohmic' : /^\*\*\*/.test(text) ? 'error' : 'out'
  useLisp.setState((s) => ({ lines: [...s.lines, ...makeLines(kind, text, s.target, at)].slice(-MAX_LINES) }))
})

// ------------------------------------------------------------------ draft

const DRAFT_ID = 'lisp'
let draftTimer: ReturnType<typeof setTimeout> | null = null

function saveDraft() {
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    const { code, fileName } = useLisp.getState()
    void db.drafts.put({ id: DRAFT_ID, text: code, name: fileName, savedAt: Date.now() }).catch(() => {})
  }, 600)
}

/** Brings back the editor text from last time. */
export async function loadLispDraft() {
  try {
    const d = await db.drafts.get(DRAFT_ID)
    if (d && d.text !== useLisp.getState().code) useLisp.setState({ code: d.text, fileName: d.name, dirty: true })
  } catch {
    // IndexedDB unavailable (private mode): start with the example.
  }
}

export const LISP_STARTER = STARTER
