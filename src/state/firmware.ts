// Firmware updates for the motor controllers on the connection, one at a time:
// CAN controllers first and the one on the cable last, since restarting it drops
// the link. For each: back its settings up, erase the update area, write the
// image, restart into the bootloader (which checks the image's CRC before it
// replaces anything), wait for it to come back, and check what it now runs.
//
// Until the restart, the controller keeps running its current firmware, so
// cancelling or losing the link before then changes nothing.

import { create } from 'zustand'
import type { Target } from '../client/VescClient'
import { decodeConfig } from '../config/codec'
import { fwKey } from '../config/registry'
import type { ConfigKind } from '../config/types'
import { bootloaderFor, downloadFirmware, firmwareFor, type Fetcher } from '../firmware/archive'
import { FirmwareFileError, namesHardware, prepareBootloader, prepareFirmware, type PreparedImage } from '../firmware/image'
import { errorText } from '../lib/format'
import { sleep } from '../lib/time'
import type { FwVersion } from '../protocol/messages'
import { useAbsTest } from './absTest'
import { addBackup } from './backups'
import { useConfig, type DeviceConfig } from './config'
import { targetKey, targetLabel } from './devices'
import { motionBlock } from './motion'
import { useMotorControl } from './motorControl'
import { useMotorTest } from './motorTest'
import { activeClient, claimLink, demoNextFirmware, expectReboot, useSession } from './session'
import { useTelemetry } from './telemetry'

export type FwSource = 'archive' | 'file' | 'bootloader'

export interface UpdateCandidate {
  key: string
  target: Target
  name: string
  fw: FwVersion
  version: string
  config: DeviceConfig | null
}

/** Motor controllers on the connection that answered with their firmware and hardware. */
export function updateCandidates(): UpdateCandidate[] {
  const { devices } = useSession.getState()
  const configs = Object.values(useConfig.getState().devices)
  const out: UpdateCandidate[] = []
  for (const d of devices) {
    if (!d.motor || !d.fw) continue
    const config = configs.find((c) => targetKey(c.target) === targetKey(d.target)) ?? null
    out.push({
      key: targetKey(d.target),
      target: d.target,
      name: config?.name ?? `${d.fw.hwName} · ${targetLabel(d.target)}`,
      fw: d.fw,
      version: fwKey(d.fw.major, d.fw.minor),
      config,
    })
  }
  return out
}

/** The name to look firmware up by. The demo's simulated hardware borrows a real board's. */
export function archiveName(hwName: string): string {
  return useSession.getState().transportKind === 'mock' ? hwName.replace(/^SIM_/, '') : hwName
}

export interface PlannedJob {
  key: string
  target: Target
  name: string
  hwName: string
  uuid: string
  from: string
  /** The version it should report afterwards; null when the file doesn't say (a custom file, a bootloader). */
  to: string | null
  label: string
  url: string | null
  noHwLimits: boolean
  /** Why this controller can't be updated with this choice. */
  problem: string | null
}

interface ArchiveChoice {
  version: string
  /** File name of the build, e.g. "VESC_default.bin". */
  file: string
}

export function planArchive(list: UpdateCandidate[], choice: ArchiveChoice): PlannedJob[] {
  return list.map((c) => {
    const base = baseJob(c)
    const v = firmwareFor(archiveName(c.fw.hwName)).find((x) => x.version === choice.version)
    if (!v) return { ...base, to: choice.version, label: choice.version, problem: `The archive has no ${choice.version} firmware for ${c.fw.hwName}.` }
    const f = v.files.find((x) => x.file === choice.file)
    if (!f) return { ...base, to: choice.version, label: choice.version, problem: `${c.fw.hwName} has no build called “${choice.file}” in ${choice.version}.` }
    return { ...base, to: v.version, label: `${v.version} · ${f.label}`, url: f.url, noHwLimits: f.noHwLimits }
  })
}

export function planFile(list: UpdateCandidate[], fileName: string): PlannedJob[] {
  return list.map((c) => ({ ...baseJob(c), label: fileName }))
}

export function planBootloader(list: UpdateCandidate[]): PlannedJob[] {
  return list.map((c) => {
    const b = bootloaderFor(archiveName(c.fw.hwName))
    return { ...baseJob(c), label: b.generic ? 'Bootloader (generic)' : `Bootloader (${b.file.replace(/\.bin$/, '')})`, url: b.url }
  })
}

function baseJob(c: UpdateCandidate): PlannedJob {
  return {
    key: c.key,
    target: c.target,
    name: c.name,
    hwName: c.fw.hwName,
    uuid: c.fw.uuid,
    from: c.version,
    to: null,
    label: '',
    url: null,
    noHwLimits: false,
    problem: null,
  }
}

/** Why a controller's battery is too low to update safely, or null. */
export function batteryProblem(c: Pick<UpdateCandidate, 'key' | 'name' | 'config'>): string | null {
  const v = useTelemetry.getState().devices[c.key]?.vIn
  if (v === undefined || !Number.isFinite(v)) return `No battery reading from ${c.name} yet.`
  const mc = c.config?.mcconf.device
  const cut = mc ? Math.max(Number(mc.l_battery_cut_start) || 0, Number(mc.l_min_vin) || 0) : 0
  if (v < 9) return `${c.name} reads ${v.toFixed(1)} V. Connect and switch on the battery: USB power alone isn’t enough for an update.`
  if (cut > 0 && v < cut + 1) {
    return `${c.name}’s battery is at ${v.toFixed(1)} V, close to its cut-off of ${cut.toFixed(1)} V. Charge it first: losing power partway could leave the controller needing a repair.`
  }
  return null
}

/** Why the update can't start right now, or null. */
export function updateBlock(jobs: PlannedJob[]): string | null {
  if (useSession.getState().status !== 'connected' || !activeClient()) return 'Connect to the controllers first.'
  if (useFirmware.getState().running) return 'An update is already running.'
  if (!jobs.length) return 'Pick at least one controller.'
  const problem = jobs.find((j) => j.problem)
  if (problem) return problem.problem
  if (useMotorControl.getState().run || useMotorTest.getState().running) return 'Stop the motor first.'
  const abs = useAbsTest.getState().phase
  if (abs === 'checking' || abs === 'spinning' || abs === 'braking') return 'Wait for the ABS test to finish.'
  const motion = motionBlock(
    jobs.map((j) => j.target),
    Date.now(),
    'update firmware',
  )
  if (motion) return motion
  for (const j of jobs) {
    const c = updateCandidates().find((x) => x.key === j.key)
    const battery = c ? batteryProblem(c) : `${j.name} is no longer connected.`
    if (battery) return battery
  }
  return null
}

type JobPhase = 'waiting' | 'downloading' | 'backing-up' | 'erasing' | 'writing' | 'restarting' | 'verifying' | 'done' | 'failed' | 'skipped'

export interface JobState extends PlannedJob {
  phase: JobPhase
  /** 0..1 while writing. */
  progress: number
  uploadBytes: number
  compressed: boolean
  /** Settings backed up before the update (backup ids). */
  backups: number[]
  /** What it reports afterwards, e.g. "7.00". */
  after: string | null
  /** The controller's settings layout changed, so they were probably reset to defaults. */
  settingsReset: boolean
  error: string | null
}

interface FirmwareState {
  running: boolean
  cancelling: boolean
  jobs: JobState[]
  error: string | null
  finishedAt: number | null
}

export const useFirmware = create<FirmwareState>()(() => ({ running: false, cancelling: false, jobs: [], error: null, finishedAt: null }))

class FwError extends Error {}
class Cancelled extends Error {}

function patchJob(key: string, patch: Partial<JobState>) {
  useFirmware.setState((s) => ({ jobs: s.jobs.map((j) => (j.key === key ? { ...j, ...patch } : j)) }))
}

let abort: AbortController | null = null

/** Stops before the next controller is changed. One already restarting finishes. */
export function cancelUpdate() {
  if (!useFirmware.getState().running) return
  abort?.abort()
  useFirmware.setState({ cancelling: true })
}

export function clearUpdate() {
  if (useFirmware.getState().running) return
  useFirmware.setState({ jobs: [], error: null, finishedAt: null })
}

interface StartOptions {
  source: FwSource
  /** A custom file's bytes (source "file"). */
  file?: Uint8Array
  fetcher?: Fetcher
}

/**
 * Runs the update. Every image is downloaded and checked before any controller
 * is touched, so a bad file or a lost download changes nothing.
 */
export async function startUpdate(planned: PlannedJob[], opts: StartOptions): Promise<void> {
  const block = updateBlock(planned)
  if (block) {
    useFirmware.setState({ error: block })
    return
  }
  // CAN controllers first; the one on the cable drops the link when it restarts.
  const jobs: JobState[] = [...planned]
    .sort((a, b) => Number(a.target === 'local') - Number(b.target === 'local'))
    .map((j) => ({ ...j, phase: 'waiting', progress: 0, uploadBytes: 0, compressed: false, backups: [], after: null, settingsReset: false, error: null }))
  abort = new AbortController()
  const signal = abort.signal
  useFirmware.setState({ running: true, cancelling: false, jobs, error: null, finishedAt: null })

  const guard = (e: BeforeUnloadEvent) => {
    e.preventDefault()
    e.returnValue = ''
  }
  window.addEventListener('beforeunload', guard)
  let wake: { release: () => Promise<void> } | null = null
  try {
    wake = (await navigator.wakeLock?.request('screen').catch(() => null)) ?? null
  } catch {
    wake = null
  }
  const release = claimLink('the firmware update')

  try {
    // 1. Every image, ready and checked.
    const images = new Map<string, PreparedImage>()
    for (const j of jobs) {
      if (signal.aborted) throw new Cancelled()
      patchJob(j.key, { phase: 'downloading' })
      let prepared: PreparedImage
      try {
        if (opts.source === 'file') {
          if (!opts.file) throw new FwError('Choose a firmware file first.')
          prepared = prepareFirmware(opts.file)
        } else {
          const url = j.url!
          const cached = images.get(url)
          const bytes = cached ? null : await downloadFirmware(url, opts.fetcher)
          prepared = cached ?? (opts.source === 'bootloader' ? prepareBootloader(bytes!) : prepareFirmware(bytes!))
          images.set(url, prepared)
        }
      } catch (e) {
        throw new FwError(e instanceof FirmwareFileError ? e.message : errorText(e))
      }
      images.set(j.key, prepared)
      patchJob(j.key, { phase: 'waiting', uploadBytes: prepared.uploadBytes, compressed: prepared.compressed })
    }

    // 2. One controller at a time.
    for (const j of jobs) {
      if (signal.aborted) throw new Cancelled()
      try {
        await updateOne(j, images.get(j.key)!, signal)
      } catch (e) {
        if (e instanceof Cancelled) throw e
        patchJob(j.key, { phase: 'failed', error: errorText(e) })
        for (const rest of useFirmware.getState().jobs) if (rest.phase === 'waiting') patchJob(rest.key, { phase: 'skipped' })
        useFirmware.setState({ error: `${j.name}: ${errorText(e)}` })
        return
      }
    }
  } catch (e) {
    for (const rest of useFirmware.getState().jobs) {
      if (rest.phase !== 'done' && rest.phase !== 'failed') patchJob(rest.key, { phase: 'skipped', progress: 0 })
    }
    useFirmware.setState({ error: e instanceof Cancelled ? 'Cancelled. Controllers that hadn’t restarted keep their current firmware.' : errorText(e) })
  } finally {
    release()
    window.removeEventListener('beforeunload', guard)
    void wake?.release().catch(() => {})
    abort = null
    useFirmware.setState({ running: false, cancelling: false, finishedAt: Date.now() })
    // Refresh what's on CAN, so the new versions (and settings) are read.
    void useSession.getState().rescanCan()
  }
}

async function backup(j: JobState): Promise<number[]> {
  const d = Object.values(useConfig.getState().devices).find((c) => targetKey(c.target) === j.key)
  const client = activeClient()
  if (!d || !client) return []
  const ids: number[] = []
  for (const kind of ['mcconf', 'appconf'] as ConfigKind[]) {
    const k = d[kind]
    if (!k.defs || !k.device) continue
    let raw: Uint8Array | null = null
    let values = k.device
    try {
      raw = await client.getConfig(kind, { target: d.target })
      values = decodeConfig(k.defs, raw)
    } catch {
      raw = null // keep the last values read
    }
    ids.push(
      await addBackup({
        reason: 'before-update',
        title: j.to ? `Before updating firmware to ${j.to}` : `Before installing ${j.label}`,
        changes: [],
        kind,
        deviceUuid: d.fw.uuid || null,
        deviceName: d.name,
        hwName: d.fw.hwName,
        fw: fwKey(d.fw.major, d.fw.minor),
        signature: k.defs.signature,
        raw,
        values,
      }),
    )
  }
  return ids
}

async function updateOne(j: JobState, image: PreparedImage, signal: AbortSignal) {
  const client = () => {
    const c = activeClient()
    if (!c) throw new FwError('The connection was lost before the restart, so the controller keeps its current firmware.')
    return c
  }
  const check = () => {
    if (signal.aborted) throw new Cancelled()
  }

  patchJob(j.key, { phase: 'backing-up' })
  const backups = await backup(j).catch(() => [] as number[])
  patchJob(j.key, { backups })
  check()

  // Erase the update area (not the running firmware).
  patchJob(j.key, { phase: 'erasing' })
  const erased = image.kind === 'bootloader' ? await client().eraseBootloader(j.target) : await client().eraseNewApp(image.eraseBytes, j.target)
  if (!erased) throw new FwError('The controller refused to erase its update area. Make sure the motor is stopped, then try again.')
  check()

  patchJob(j.key, { phase: 'writing', progress: 0 })
  const total = image.chunks.reduce((s, c) => s + c.data.length, 0)
  let done = 0
  let shown = 0
  for (const chunk of image.chunks) {
    check()
    let ok: boolean
    try {
      ok = await client().writeNewAppData(chunk.offset, chunk.data, j.target)
    } catch (e) {
      throw new FwError(`Writing stopped at ${Math.round((done / total) * 100)} %: ${errorText(e)}. The controller keeps its current firmware; try again.`)
    }
    if (!ok) throw new FwError(`The controller refused the data at byte ${chunk.offset.toLocaleString()}. It keeps its current firmware.`)
    done += chunk.data.length
    if (done - shown > total / 200 || done === total) {
      shown = done
      patchJob(j.key, { progress: done / total })
    }
  }

  if (image.kind === 'bootloader') {
    patchJob(j.key, { phase: 'done', progress: 1, after: j.from })
    return
  }

  // From here on there's no going back: the bootloader takes over.
  patchJob(j.key, { phase: 'restarting', progress: 1 })
  const before = j.from
  const expected = j.to ? j.to.split('.').map(Number) : null
  if (expected) demoNextFirmware(j.target, { major: expected[0], minor: expected[1] })
  if (j.target === 'local') expectReboot(120_000)
  await client().jumpToBootloader(j.target)
  const back = j.target === 'local' ? await waitForLocal() : await waitForCan(j.target, j.uuid)

  patchJob(j.key, { phase: 'verifying' })
  const now = fwKey(back.major, back.minor)
  if (back.hwName !== j.hwName) throw new FwError(`It came back as ${back.hwName}, not ${j.hwName}. Check it before riding.`)
  if (j.to && now !== j.to) {
    throw new FwError(
      now === before
        ? `It restarted on its old firmware (${now}), so the bootloader didn’t install the new one. ${image.compressed ? 'This image is compressed, which older bootloaders can’t unpack: update the bootloader first, then try again.' : 'Try again; if it keeps happening, update the bootloader.'}`
        : `It now reports ${now}, not ${j.to}.`,
    )
  }
  patchJob(j.key, { phase: 'done', after: now, settingsReset: now !== before })
}

/** The controller on the cable restarts: the link drops and the session reconnects. */
async function waitForLocal(): Promise<FwVersion> {
  const start = Date.now()
  let dropped = false
  while (Date.now() - start < 120_000) {
    const s = useSession.getState()
    if (s.status === 'error' || s.status === 'idle') throw new FwError('The controller didn’t come back after restarting. Reconnect it; if it doesn’t answer, it may need its bootloader repaired.')
    if (s.status !== 'connected') dropped = true
    else if (dropped && s.fw) return s.fw
    else if (!dropped && Date.now() - start > 10_000) {
      // Some links survive a restart; ask directly.
      const c = activeClient()
      const fw = c ? await c.getFwVersion({ retries: 0, timeoutMs: 500 }).catch(() => null) : null
      if (fw) return fw
    }
    await sleep(200)
  }
  throw new FwError('The controller didn’t come back within two minutes. Reconnect it; if it doesn’t answer, it may need its bootloader repaired.')
}

/** A CAN controller restarts on its own; find it again (new firmware may give it a new CAN ID). */
async function waitForCan(id: number, uuid: string): Promise<FwVersion> {
  const start = Date.now()
  await sleep(1500)
  for (let i = 0; Date.now() - start < 60_000; i++) {
    const c = activeClient()
    if (!c) throw new FwError('The connection was lost while the controller restarted. Reconnect to check it.')
    const fw = await c.getFwVersion({ target: id, retries: 0, timeoutMs: 400, priority: 'high' }).catch(() => null)
    if (fw && (!uuid || fw.uuid === uuid)) return fw
    if (i % 5 === 4) {
      const ids = await c.pingCan().catch(() => [] as number[])
      for (const other of ids) {
        const o = await c.getFwVersion({ target: other, retries: 0, timeoutMs: 400 }).catch(() => null)
        if (o && uuid && o.uuid === uuid) return o
      }
    }
    await sleep(700)
  }
  throw new FwError(`CAN ${id} didn’t answer within a minute of restarting. Check its power and CAN wiring, then rescan.`)
}

/** Whether a prepared custom file names this hardware (a hint, not proof). */
export const fileNamesHardware = (image: PreparedImage, hwName: string) => namesHardware(image.image, archiveName(hwName)) || namesHardware(image.image, hwName)
