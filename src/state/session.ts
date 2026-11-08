// Connection lifecycle: pick a device, connect, identify it and anything on
// its CAN bus, poll live values, and reconnect by itself if the link drops.

import { create } from 'zustand'
import { ClosedError, VescClient, type Target } from '../client/VescClient'
import type { FwVersion } from '../protocol/messages'
import { demoPositionAt, type DemoFix } from '../sim/demoRoute'
import { BleTransport } from '../transport/BleTransport'
import type { MockTransport } from '../transport/MockTransport'
import { SerialTransport } from '../transport/SerialTransport'
import { Emitter, type Transport, type TransportKind } from '../transport/types'
import { isMotorController, pickPrimary, pickView, targetKey, type DeviceInfo, type View } from './devices'
import { imuAllowed } from './imuGate'
import { imuWanted, useLiveData, type LiveSample } from './live'
import { useSettings, type PollHz } from './settings'
import { useTelemetry } from './telemetry'

export type SessionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'
export type LinkHealth = 'ok' | 'slow' | 'lost'

export interface ReconnectState {
  attempt: number
  reason: string
  startedAt: number
}

interface SessionState {
  status: SessionStatus
  step: string | null
  error: string | null
  transportKind: TransportKind | null
  transportLabel: string | null
  /** The device we're plugged into (USB) or paired with (Bluetooth). */
  fw: FwVersion | null
  /** Local device first, then everything that answered on CAN. */
  devices: DeviceInfo[]
  /** Motor controller that leads speed and voltage; null if none was found. */
  primary: Target | null
  view: View
  link: LinkHealth
  reconnect: ReconnectState | null
  scanning: boolean
  /**
   * Something has the link to itself (a firmware update): polling pauses, and
   * anything that drives a motor or writes settings waits. Says what, for messages.
   */
  busy: string | null
  connectDemo: () => Promise<void>
  connectUsb: (opts?: { anyDevice?: boolean }) => Promise<void>
  connectBluetooth: (opts?: { anyDevice?: boolean }) => Promise<void>
  connectPort: (port: SerialPort) => Promise<void>
  connectBleDevice: (device: BluetoothDevice) => Promise<void>
  /** Closes the connection, or stops trying to reconnect. */
  disconnect: () => Promise<void>
  setView: (view: View) => void
  rescanCan: () => Promise<void>
}

/** How long to keep trying after a drop before giving up. */
export const RECONNECT_WINDOW_MS = 3 * 60_000

/** Bluetooth links can't keep up with more than about 20 updates a second. */
export function maxPollHz(kind: TransportKind | null): PollHz {
  return kind === 'ble' ? 20 : 50
}

export interface SamplesEvent {
  samples: LiveSample[]
  devices: DeviceInfo[]
  at: number
}

/** For modules the session must not import (fault watcher, terminal), to avoid import cycles. */
export const sessionEvents = {
  /** One poll cycle's values, after the dashboard and recorder took them. */
  samples: new Emitter<SamplesEvent>(),
  /** Text the controller printed (terminal output, warnings). */
  prints: new Emitter<{ text: string; at: number }>(),
  /** What LispBM printed (script output and console results). */
  lispPrints: new Emitter<{ text: string; at: number }>(),
  /** The connection was closed or given up on. */
  ended: new Emitter<{ at: number }>(),
}

interface Active {
  transport: Transport
  client: VescClient | null
  poll: AbortController | null
  reconnect: AbortController | null
  offDrop: () => void
  offPrint: () => void
}

let active: Active | null = null
/** Bumped by every connect and disconnect so a stale attempt can tell it lost the race. */
let generation = 0

const idleFields = {
  step: null,
  transportKind: null,
  transportLabel: null,
  fw: null,
  devices: [],
  primary: null,
  link: 'ok',
  reconnect: null,
  scanning: false,
} satisfies Partial<SessionState>

export const useSession = create<SessionState>()((set, get) => ({
  status: 'idle',
  error: null,
  view: 'all',
  busy: null,
  ...idleFields,

  connectDemo: async () => {
    // The simulator is only downloaded when someone tries the demo.
    const { MockTransport } = await import('../transport/MockTransport')
    await connectWith(new MockTransport())
  },

  // The browser pickers must open straight from the click, before anything else is awaited.
  connectUsb: async (opts) => {
    let t: SerialTransport
    try {
      t = await SerialTransport.request(opts)
    } catch (e) {
      if (!isCancel(e)) set({ status: 'error', error: friendlyError(e, 'serial') })
      return
    }
    await connectWith(t)
  },

  connectBluetooth: async (opts) => {
    let t: BleTransport
    try {
      t = await BleTransport.request({ ...opts, chunkSize: useSettings.getState().bleChunkSize })
    } catch (e) {
      if (!isCancel(e)) set({ status: 'error', error: friendlyError(e, 'ble') })
      return
    }
    await connectWith(t)
  },

  connectPort: (port) => connectWith(new SerialTransport(port)),

  connectBleDevice: (device) => connectWith(new BleTransport(device, { chunkSize: useSettings.getState().bleChunkSize })),

  disconnect: async () => {
    generation++
    await teardown()
    set({ status: 'idle', error: null, ...idleFields })
  },

  setView: (view) => {
    if (get().view === view) return
    set({ view })
    useTelemetry.getState().clearHistory()
    const uuid = get().fw?.uuid
    if (uuid) useSettings.getState().rememberView(uuid, view)
  },

  rescanCan: async () => {
    const a = active
    const client = a?.client
    if (!a || !client || get().status !== 'connected' || get().scanning) return
    set({ scanning: true })
    try {
      const known = get().devices.find((d) => d.target === 'local')
      const fw = await client.getFwVersion({ retries: 1 }).catch((e: unknown) => {
        if (e instanceof ClosedError) throw e
        return known?.fw ?? null
      })
      const local: DeviceInfo | undefined = fw ? { target: 'local', fw, motor: isMotorController(fw) } : known
      const devices = [...(local ? [local] : []), ...(await scanCan(client))]
      if (active !== a) return
      const view = pickView([get().view], devices)
      set({ devices, primary: pickPrimary(devices), view, ...(fw ? { fw } : {}) })
    } catch {
      // The connection dropped mid-scan; the reconnect logic takes it from here.
    } finally {
      set({ scanning: false })
    }
  },
}))

/** Connects through any transport. Exported for tests and the demo. */
export async function connectWith(transport: Transport) {
  const set = useSession.setState
  if (useSession.getState().status === 'connecting') return
  const token = ++generation
  await teardown()
  set({
    status: 'connecting',
    error: null,
    ...idleFields,
    step: 'Opening connection',
    transportKind: transport.kind,
    transportLabel: transport.label,
  })

  let client: VescClient | null = null
  try {
    await transport.connect()
    if (token !== generation) throw new Cancelled()
    client = new VescClient(transport)
    const found = await identify(client, (step) => set({ step }))
    if (token !== generation) throw new Cancelled()

    const a: Active = { transport, client, poll: null, reconnect: null, offDrop: () => {}, offPrint: () => {} }
    active = a
    a.offDrop = transport.onDisconnect((reason) => void onDrop(a, reason))
    useTelemetry.getState().clear()
    useLiveData.getState().clear()
    goLive(a, found)
    if (transport.kind === 'serial' || transport.kind === 'ble') {
      useSettings.getState().setLastConnection({ kind: transport.kind, name: transport.label, at: Date.now() })
    }
  } catch (e) {
    client?.close()
    await transport.disconnect().catch(() => {})
    if (e instanceof Cancelled || token !== generation) return
    set({ status: 'error', ...idleFields, error: friendlyError(e, transport.kind) })
  }
}

interface Found {
  fw: FwVersion
  devices: DeviceInfo[]
}

class Cancelled extends Error {}

async function identify(client: VescClient, onStep: (step: string) => void): Promise<Found> {
  onStep('Reading controller info')
  const fw = await client.getFwVersion()
  onStep('Looking for other controllers on CAN')
  const devices: DeviceInfo[] = [{ target: 'local', fw, motor: isMotorController(fw) }, ...(await scanCan(client))]
  return { fw, devices }
}

async function scanCan(client: VescClient): Promise<DeviceInfo[]> {
  let ids: number[] = []
  try {
    ids = await client.pingCan()
  } catch (e) {
    if (e instanceof ClosedError) throw e
    // Older firmware or no CAN bus: carry on with just the local device.
  }
  const out: DeviceInfo[] = []
  for (const id of ids) {
    const fw = await client.getFwVersion({ target: id, retries: 1 }).catch((e: unknown) => {
      if (e instanceof ClosedError) throw e
      return null
    })
    out.push({ target: id, fw, motor: isMotorController(fw) })
  }
  return out
}

function goLive(a: Active, found: Found) {
  const { deviceViews } = useSettings.getState()
  const remembered = found.fw.uuid ? deviceViews[found.fw.uuid] : undefined
  const view = pickView([remembered, useSession.getState().view], found.devices)
  useSession.setState({
    status: 'connected',
    step: null,
    error: null,
    fw: found.fw,
    devices: found.devices,
    primary: pickPrimary(found.devices),
    view,
    link: 'ok',
    reconnect: null,
  })
  a.offPrint()
  const client = a.client
  if (client) {
    const offA = client.onPrint((text) => sessionEvents.prints.emit({ text, at: Date.now() }))
    const offB = client.onLispPrint((text) => sessionEvents.lispPrints.emit({ text, at: Date.now() }))
    a.offPrint = () => (offA(), offB())
  } else a.offPrint = () => {}
  a.poll = new AbortController()
  void pollLoop(a, a.poll.signal)
}

async function onDrop(a: Active, reason: string) {
  if (active !== a || a.reconnect) return
  const set = useSession.setState
  a.poll?.abort()
  a.poll = null
  a.offPrint()
  a.client?.close()
  a.client = null

  // A controller restarting after a firmware update comes back by itself; wait for it.
  if (!useSettings.getState().autoReconnect && Date.now() > rebootExpectedUntil) {
    await teardown()
    set({ status: 'error', ...idleFields, error: `Disconnected: ${reason}.` })
    return
  }

  const ctrl = new AbortController()
  a.reconnect = ctrl
  const startedAt = Date.now()
  const previousUuid = useSession.getState().fw?.uuid
  set({ status: 'reconnecting', link: 'lost', reconnect: { attempt: 0, reason, startedAt } })

  for (let attempt = 1; !ctrl.signal.aborted && Date.now() - startedAt < RECONNECT_WINDOW_MS; attempt++) {
    set({ reconnect: { attempt, reason, startedAt } })
    try {
      await a.transport.connect()
      if (ctrl.signal.aborted) break
      const client = new VescClient(a.transport)
      a.client = client
      const found = await identify(client, () => {})
      if (ctrl.signal.aborted) break
      // A different controller answered (cable moved to another board): start fresh.
      if (previousUuid && found.fw.uuid !== previousUuid) {
        useTelemetry.getState().clear()
        useLiveData.getState().clear()
      }
      a.reconnect = null
      goLive(a, found)
      return
    } catch {
      a.client?.close()
      a.client = null
      await a.transport.disconnect().catch(() => {})
      await sleep(retryDelay(a.transport.kind, attempt), ctrl.signal)
    }
  }

  if (ctrl.signal.aborted) {
    // Stopped by the user or a new connection; make sure this attempt leaves nothing open.
    a.client?.close()
    a.client = null
    await a.transport.disconnect().catch(() => {})
    return
  }
  if (active === a) {
    await teardown()
    set({
      status: 'error',
      ...idleFields,
      error: `Lost the connection (${reason}) and couldn't get it back. Check the controller is on, then connect again.`,
    })
  }
}

function retryDelay(kind: TransportKind, attempt: number) {
  // USB fails fast when unplugged, so check often. Bluetooth attempts are slow, so back off.
  if (kind === 'serial') return 1000
  if (kind === 'mock') return 300
  return Math.min(5000, 1000 * attempt)
}

async function teardown() {
  const a = active
  active = null
  if (!a) return
  sessionEvents.ended.emit({ at: Date.now() })
  a.offDrop()
  a.offPrint()
  a.reconnect?.abort()
  a.poll?.abort()
  a.client?.close()
  await a.transport.disconnect().catch(() => {})
}

/**
 * Polls every motor controller each cycle so trip and energy cover the whole
 * vehicle. While the Live screen is open, the IMU of the controllers it shows is read too.
 */
async function pollLoop(a: Active, signal: AbortSignal) {
  const client = a.client
  if (!client) return
  const misses = new Map<string, number>()
  const imuMisses = new Map<string, number>()
  for (let cycle = 0; !signal.aborted; cycle++) {
    const started = performance.now()
    const pollHz = Math.min(useSettings.getState().pollHz, maxPollHz(a.transport.kind))
    const { devices, primary, view, busy } = useSession.getState()
    if (busy) {
      // A firmware update has the link: stay quiet until it's done.
      await sleep(100, signal)
      continue
    }

    if (primary !== null) {
      const samples: LiveSample[] = []
      const imuKeys = imuWanted()
      for (const d of devices) {
        if (!d.motor) continue
        const key = targetKey(d.target)
        const missed = misses.get(key) ?? 0
        // A controller that keeps failing (maybe switched off) is only retried now and then.
        if (d.target !== primary && missed >= 3 && cycle % 10 !== 0) continue
        let values
        try {
          values = await client.getValues({ target: d.target, priority: 'low', timeoutMs: 400, retries: 0 })
          misses.set(key, 0)
        } catch (e) {
          if (e instanceof ClosedError || signal.aborted) return
          misses.set(key, missed + 1)
          continue
        }
        let imu = null
        // Firmware without an IMU (or without the command) stops being asked after a few misses.
        if (imuKeys.has(key) && (imuMisses.get(key) ?? 0) < 3 && imuAllowed(d)) {
          try {
            imu = await client.getImu({ target: d.target, priority: 'low', timeoutMs: 300, retries: 0 })
            imuMisses.set(key, 0)
          } catch (e) {
            if (e instanceof ClosedError || signal.aborted) return
            imuMisses.set(key, (imuMisses.get(key) ?? 0) + 1)
          }
        }
        samples.push({ target: d.target, values, imu })
      }
      if (signal.aborted) return
      if (samples.some((s) => s.target === primary)) {
        const now = Date.now()
        useTelemetry.getState().ingest(samples, now, { primary, view })
        useLiveData.getState().record(samples, now, useSettings.getState().vehicle)
        sessionEvents.samples.emit({ samples, devices, at: now })
      }
      const missed = misses.get(targetKey(primary)) ?? 0
      const link: LinkHealth = missed === 0 ? 'ok' : missed < 4 ? 'slow' : 'lost'
      if (useSession.getState().link !== link) useSession.setState({ link })
    }

    const wait = 1000 / pollHz - (performance.now() - started)
    if (wait > 0) await sleep(wait, signal)
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done() {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

/** The user closed the browser's device picker without choosing. */
function isCancel(e: unknown) {
  return e instanceof Error && e.name === 'NotFoundError' && !/adapter/i.test(e.message)
}

export function friendlyError(e: unknown, kind: TransportKind | null = null): string {
  if (!(e instanceof Error)) return String(e)
  switch (e.name) {
    case 'ConnectError':
      return e.message
    case 'TimeoutError':
      return `The device didn't answer (${e.message}). Check it's powered on and is a VESC-based controller.`
    case 'NotFoundError':
      return /adapter/i.test(e.message)
        ? 'Bluetooth is turned off, or this device has no Bluetooth.'
        : 'No device was chosen.'
    case 'SecurityError':
      return 'The browser blocked access to the device. The page must be served over https.'
    case 'InvalidStateError':
      return kind === 'serial'
        ? 'That USB port is already open. Close VESC Tool or any other tab using it, then try again.'
        : e.message
    case 'NetworkError':
      if (kind === 'serial')
        return "Couldn't open the USB port. Another app (like VESC Tool) may be using it, or the cable was unplugged."
      if (kind === 'ble') return "Couldn't reach the Bluetooth device. Make sure it's switched on and nearby."
      return e.message
    default:
      return e.message
  }
}

// Apply a changed Bluetooth write size to a live connection.
useSettings.subscribe((s, prev) => {
  if (s.bleChunkSize !== prev.bleChunkSize && active?.transport instanceof BleTransport) {
    active.transport.chunkSize = s.bleChunkSize
  }
})

/**
 * Takes the link for something that must not be interrupted (a firmware update).
 * Returns the release, which is safe to call more than once.
 */
export function claimLink(what: string): () => void {
  useSession.setState({ busy: what })
  let released = false
  return () => {
    if (released) return
    released = true
    if (useSession.getState().busy === what) useSession.setState({ busy: null })
  }
}

let rebootExpectedUntil = 0

/** The controller is about to restart (new firmware): reconnect when it drops, even with auto-reconnect off. */
export function expectReboot(withinMs = 60_000) {
  rebootExpectedUntil = Date.now() + withinMs
}

/** For tests and devtools. */
export function activeClient(): VescClient | null {
  return active?.client ?? null
}

/** The simulated scooter when connected to the demo, so the UI can park it. */
export function demoSim() {
  return active?.transport.kind === 'mock' ? (active.transport as MockTransport).bus.sim : null
}

/** Demo only: where the simulated scooter is on its route, as a phone's GPS would say. */
export function demoGpsFix(): (DemoFix & { speedKmh: number }) | null {
  const sim = demoSim()
  return sim ? { ...demoPositionAt(sim.distanceM), speedKmh: sim.speed * 3.6 } : null
}

/** Demo only: makes one simulated controller report a fault for a few seconds. */
export function injectDemoFault(target: Target, code: number, seconds = 2.5): boolean {
  if (active?.transport.kind !== 'mock') return false
  const bus = (active.transport as MockTransport).bus
  const device = target === 'local' ? bus.local : bus.remotes.get(target)
  return device?.injectFault(code, seconds) ?? false
}

/** Parks (or un-parks) the demo scooter. Returns the new state, or null when not on the demo. */
export function setDemoParked(parked: boolean): boolean | null {
  const sim = demoSim()
  if (!sim) return null
  sim.parked = parked
  return parked
}

/** Demo only: brake hard on a wet road. Null when not on the demo, false when going too slowly. */
export function demoSkidTest(): boolean | null {
  const sim = demoSim()
  return sim ? sim.skidTest() : null
}

/** Demo only: which way the simulated wheel really turned in the last motor test (1 forward, -1 backwards). */
export function demoWheelDirection(target: Target): number | null {
  if (active?.transport.kind !== 'mock') return null
  const bus = (active.transport as MockTransport).bus
  const device = target === 'local' ? bus.local : bus.remotes.get(target)
  if (!device || device.motorIndex === null) return null
  return bus.sim.physicalDirection(device.motorIndex)
}

/** Demo only: what the next firmware installed on this simulated controller reports (a real image doesn't say). */
export function demoNextFirmware(target: Target, version: { major: number; minor: number } | null): boolean {
  if (active?.transport.kind !== 'mock') return false
  const bus = (active.transport as MockTransport).bus
  const device = target === 'local' ? bus.local : bus.remotes.get(target)
  if (!device) return false
  device.nextVersion = version
  return true
}

/** Demo only: a hand on the throttle and brake (0..1), or null to let the demo rider ride. */
export function setDemoHandInput(input: { throttle: number; brake: number } | null) {
  const sim = demoSim()
  if (sim) sim.handInput = input
}
